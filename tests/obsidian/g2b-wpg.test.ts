import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The picker answers from a script: the test decides which person the user chooses (or none).
const answers: unknown[] = [];
const asked: unknown[][] = [];
vi.mock('../../src/obsidian/person-picker', () => ({
	pickPerson: async (...a: unknown[]) => {
		asked.push(a);
		return answers.length ? answers.shift() : null;
	},
}));

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { forgetHeights, lastHeight, rememberHeight } from '../../src/obsidian/block-height';
import { PHONE_WHOLE_LIMIT, SECOND_LIMIT, clearStops } from '../../src/view/large-tree';
import { TreeView } from '../../src/obsidian/tree-view';
import { clearLayoutCache } from '../../src/layout/index';
import { groupCount } from '../../src/render/ui-text';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, openFullScreen, phone, type FakeHandle, type Host } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

// WP-G fix round (spec §0 D227 items 2 and 3): the bar that does not draw has the button "Choose a person"; the family of the chosen person shows, and
// the bar shows again if that family passes the top. A focus family above the top shows the bar. The helpers are those of tests/obsidian/r030-g-large-tree.test.ts.

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearLayoutCache();
	clearStops();
	forgetHeights();
	answers.length = 0;
	asked.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const flat = (n: number): string => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;
/** One person r with `k` children: the family of r is the whole tree. */
const star = (k: number, pin = ''): string => `${pin}people:\n  - {id: r, name: R}\n${Array.from({ length: k }, (_, i) => `  - {id: c${i}, name: C${i}, parents: [r]}`).join('\n')}\n`;
const bar = (root: FEl) => root.querySelector('.dynasty-large-bar');
const kind = (root: FEl) => bar(root)?.getAttribute('data-dynasty-large') ?? null;
const barText = (root: FEl) => root.querySelector('.dynasty-large-text')!.getText();
const click = (el: FEl, detail = 1) => dispatch(el, 'click', { button: 0, clientX: 10, clientY: 10, detail });

function sized(root: FEl): void {
	const vp = root.querySelector('.dynasty-viewport');
	if (vp && !vp.clientWidth) {
		vp.clientWidth = 360;
		vp.clientHeight = 400;
	}
	resizeAll();
	flushFrames();
}

async function mount(source: string, o: { host?: Host; handle?: FakeHandle | null } = {}) {
	const host = o.host ?? fakeHost();
	const handle = o.handle ?? null;
	const registry: Record<string, () => unknown> = handle
		? { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false }
		: { inEditorOf: () => false };
	Object.assign(host.handles, registry);
	const el = new FEl('div');
	const info = { lineStart: 0, lineEnd: source.split('\n').length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => (handle ? info : null), addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	sized(el);
	return { el, view, host };
}


async function clearFocusPhone(root: FEl): Promise<void> {
	// D263 B2: one tap on Focus clears the focus.
	click(root.querySelector('.dynasty-focus')!);
	await settle();
	resizeAll();
	flushFrames();
}

describe('G2b: findings on r030/g-large-tree 2dc60aed', () => {
	it('F1: the bar of a pin family above the top does not give the size of the family as the size of the tree', async () => {
		desktop();
		// A tree of 8 101 people; the pin names a family of 5 101 of them.
		const loose = Array.from({ length: 3000 }, (_, i) => `  - {id: z${i}, name: Z${i}}`).join('\n');
		const source = `${star(SECOND_LIMIT + 100, 'options:\n  focus: r\n  generations: 2\n')}${loose}\n`;
		const { el } = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(kind(el)).toBe('top');
		// The tree has 8 101 people. The bar must not say "This tree has 5,101 people".
		expect(barText(el)).not.toContain('This tree has ' + groupCount(SECOND_LIMIT + 101) + ' people');
	});

	it('F2: the bar in the full-screen view of a phone does not erase the height that the note kept for its block', async () => {
		const host = fakeHost();
		const key = 'n.md\u0000#0';
		rememberHeight(host.app as never, key, 420);
		phone();
		const { root } = await openFullScreen(flat(PHONE_WHOLE_LIMIT + 1), { host });
		await clearFocusPhone(root);
		expect(kind(root)).toBe('top');
		// The height belongs to the block in the note (the list on a phone); the full-screen view is not that place (keepHeight skips it).
		expect(lastHeight(host.app as never, key)).toBe(420);
	});
});

describe('G2b control', () => {
	it('control for F2: a small tree in the full-screen view of a phone keeps the height', async () => {
		const host = fakeHost();
		const key = 'n.md\u0000#0';
		rememberHeight(host.app as never, key, 420);
		phone();
		await openFullScreen(flat(50), { host });
		expect(lastHeight(host.app as never, key)).toBe(420);
	});
});
