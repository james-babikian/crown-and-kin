import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { hardErrorText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { chooseFocus, type FocusFacts } from '../src/view/focus-mode';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearStops, rememberStop } from '../src/view/large-tree';
import { cardShown, type View } from '../src/render/view-math';
import { BLOCK_UI, FOCUS_UI } from '../src/render/ui-text';
import { TOOLBAR_UI } from '../src/render/view-text';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { TreeView } from '../src/obsidian/tree-view';
import { desktop, embed, fakeHandle, fakeHost, phone, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

// 0.3.1 WP-S group S-A (the decision notes "0.3.1" WP-S): the small points F4, F5, F8 and F13. F2 waits for a ruling of the supervisor.

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	clearStops();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const press = async (el: FEl | null) => {
	dispatch(el!, 'click', { button: 0, detail: 1 });
	await settle();
	resizeAll();
	flushFrames();
};

const SMALL = 'people:\n  - id: aldric\n    name: Aldric Valmont\n  - id: roderick\n    name: Roderick Valmont\n    parents: [aldric]\n';

/** A tree of one chain of couples, with more people than the phone rule of D20 needs (it opens a family). */
function bigTree(n: number): string {
	const lines = ['people:'];
	for (let i = 0; i < n; i++) {
		lines.push(`  - id: p${i}`, `    name: Person ${i}`);
		if (i > 0) lines.push(`    parents: [p${Math.floor((i - 1) / 2)}]`);
	}
	return `${lines.join('\n')}\n`;
}

describe('F4: a saved view with no card on the screen is not kept', () => {
	const boxes = [
		{ x: 0, y: 0, w: 100, h: 50 },
		{ x: 200, y: 0, w: 100, h: 50 },
	];
	const size = { w: 400, h: 300 };

	it('cardShown is true when a card meets the screen and false when none does', () => {
		expect(cardShown({ scale: 1, cx: 150, cy: 25 }, size, boxes)).toBe(true);
		// A pinch that moved the tree out of the screen.
		expect(cardShown({ scale: 1, cx: 5000, cy: 5000 }, size, boxes)).toBe(false);
		expect(cardShown({ scale: 1, cx: -5000, cy: 25 }, size, boxes)).toBe(false);
	});

	it('a card that only touches the edge of the screen does not count', () => {
		// The screen shows x from -200 to 200 at centre 0: the first card spans 0..100 and is in; at centre 300 the screen is 100..500, which only touches the first card at x = 100.
		expect(cardShown({ scale: 1, cx: 300, cy: 25 }, { w: 400, h: 300 }, [boxes[0]])).toBe(false);
	});

	it('the bars of the full-screen view are not part of the screen', () => {
		const lone = [{ x: 0, y: 0, w: 100, h: 20 }];
		// The card is at the top of the view; a top bar of 100 px covers it.
		const view: View = { scale: 1, cx: 50, cy: 140 };
		expect(cardShown(view, size, lone)).toBe(true);
		expect(cardShown(view, size, lone, { top: 100, bottom: 0 })).toBe(false);
	});

	it('a view that is not a view shows nothing', () => {
		expect(cardShown({ scale: 0, cx: 0, cy: 0 }, size, boxes)).toBe(false);
		expect(cardShown({ scale: 1, cx: Number.NaN, cy: 0 }, size, boxes)).toBe(false);
		expect(cardShown({ scale: 1, cx: 0, cy: 0 }, { w: 0, h: 0 }, boxes)).toBe(false);
	});

	/** True when a card of the tree shows in the 360 × 400 box of the test. */
	const cardOnScreen = (root: FEl): boolean => {
		const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '');
		if (!m) throw new Error('no transform');
		const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
		return root.querySelectorAll('.dynasty-card').some((card) => {
			const bg = card.querySelector('.dynasty-card-bg')!;
			const x = tx + Number(bg.getAttribute('x')) * s;
			const y = ty + Number(bg.getAttribute('y')) * s;
			return x + Number(bg.getAttribute('width')) * s > 0 && x < 360 && y + Number(bg.getAttribute('height')) * s > 0 && y < 400;
		});
	};

	it('a note opens on the first view when the saved view shows no card', async () => {
		desktop();
		const handle = fakeHandle('n.md', SMALL);
		const gone: View = { scale: 1, cx: 90_000, cy: 90_000 };
		handle.state.view = gone;
		handle.state.viewFor = '';
		handle.state.views = { down: { view: gone, viewFor: '' } };
		const { el } = await embed(SMALL, { handle });
		expect(cardOnScreen(el)).toBe(true);
	});

	it('a saved view that shows a card is still used', async () => {
		desktop();
		const probe = await embed(SMALL, { handle: fakeHandle('n.md', SMALL) });
		const first = probe.el.querySelector('.dynasty-scene')?.getAttribute('transform');
		// A view of the same tree, a little to the side: it shows a card and so it is kept.
		const handle = fakeHandle('n.md', SMALL);
		const near: View = { scale: 0.5, cx: 40, cy: 30 };
		handle.state.view = near;
		handle.state.viewFor = '';
		handle.state.views = { down: { view: near, viewFor: '' } };
		const { el } = await embed(SMALL, { handle });
		expect(el.querySelector('.dynasty-scene')?.getAttribute('transform')).not.toBe(first);
		expect(cardOnScreen(el)).toBe(true);
	});
});

describe('F5: after a stopped draw, Expand opens the family', () => {
	const facts = (over: Partial<FocusFacts>): FocusFacts => ({
		session: { id: null },
		pin: undefined,
		phone: true,
		auto: null,
		has: () => true,
		large: () => true,
		start: () => 'p0',
		...over,
	});

	it('a session choice of the whole tree is kept while no draw stopped', () => {
		expect(chooseFocus(facts({})).id).toBeNull();
	});

	it('a new view after a stopped draw drops the choice of the whole tree on a phone', () => {
		const c = chooseFocus(facts({ stopped: true }));
		expect(c.id).toBe('p0');
		expect(c.from).toBe('phone');
		expect(c.dropSession).toBe(true);
	});

	it('the pin still comes first, and a session focus on a person is kept', () => {
		expect(chooseFocus(facts({ stopped: true, pin: 'p3' })).id).toBe('p3');
		expect(chooseFocus(facts({ stopped: true, session: { id: 'p5' } })).id).toBe('p5');
	});

	it('with no rule that gives a family, the whole tree stays', () => {
		const c = chooseFocus(facts({ stopped: true, phone: false }));
		expect(c.id).toBeNull();
		expect(c.dropSession).toBe(true);
	});

	const SRC = bigTree(160);

	it('the phone full-screen view opens on cards, not on the stop bar (the block keeps its stop)', async () => {
		phone();
		const host = fakeHost();
		const handle = fakeHandle('n.md', SRC);
		handle.state.focus = { id: null };
		rememberStop('n.md\u0000#0', 160, SRC);
		const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source: SRC, handle, peeked: null, readOnly: false };
		const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
		modal.open();
		await settle();
		resizeAll();
		flushFrames();
		const root = modal.containerEl as unknown as FEl;
		expect(root.querySelector('.dynasty-large-bar')).toBeNull();
		expect(root.querySelectorAll('.dynasty-card').length).toBeGreaterThan(0);
		// The session no longer holds the choice of the whole tree.
		expect(handle.state.focus).toBeNull();
		// Clear focus brings the stop bar back, because the user asks for the whole tree again.
		expect(root.querySelector('.dynasty-focus')?.getAttribute('aria-pressed')).toBe('true');
		await press(root.querySelector('.dynasty-focus'));
		await press(root.querySelector('.dynasty-focus-clear'));
		expect(root.querySelector('.dynasty-large-bar')?.getAttribute('data-dynasty-large')).toBe('slow');
	});

	it('a block with no stop opens the way it did: the session choice of the whole tree stays', async () => {
		phone();
		const host = fakeHost();
		const handle = fakeHandle('n.md', SRC);
		handle.state.focus = { id: null };
		const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source: SRC, handle, peeked: null, readOnly: false };
		const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
		modal.open();
		await settle();
		resizeAll();
		flushFrames();
		expect(handle.state.focus).toEqual({ id: null });
	});

});

/** A tree in a note whose text cannot be read: there is no viewport, so the shared `embed` helper does not fit. */
async function errorEmbed(source: string, o: { host?: Host; handle?: FakeHandle | null } = {}) {
	const host = o.host ?? fakeHost();
	const handle = o.handle ?? null;
	const inEditorOf = (): boolean => false;
	Object.assign(host.handles, handle ? { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf } : { inEditorOf });
	const el = new FEl('div');
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => (handle ? { lineStart: 0, lineEnd: source.split('\n').length + 1, text: '' } : null), addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	resizeAll();
	flushFrames();
	return { el, host };
}

describe('F8: error boxes', () => {
	const BAD = 'people:\n  - id: aldric\n    name: [Aldric Valmont\n';

	/** The real parser messages of a set of broken texts. */
	const BROKEN: Record<string, string> = {
		'a list that is not closed': 'people:\n  - id: a\n    name: [A\n',
		'a group that is not closed': 'people:\n  - id: a\n    name: {A: 1\n',
		'a wrong indent': 'people:\n  - id: a\n   name: A\n',
		'a second colon': 'people:\n  - id: a\n    name: A: B\n',
		'a tab': 'people:\n\t- id: a\n',
		'a quote mark that is not closed': 'people:\n  - id: "a\n    name: A\n',
		'a reserved character': 'people:\n  - id: @a\n',
		'two documents': 'people: []\n---\nopts: 1\n',
		'an alias with no anchor': 'people:\n  - id: a\n    house: *h\n',
		'items at different columns': 'people:\n  - id: a\n  name: x\n x: y\n',
	};

	/** Words of the parser that the box must not show. */
	const RAW = /\b(sequence|mapping|mappings|indicator|scalar|collection|collections|column|alias|flow|implicit|document|documents|YAML|compact|indentation)\b/i;

	for (const [name, source] of Object.entries(BROKEN)) {
		it(`${name}: the details are in plain words`, () => {
			const r = parseDynasty(source);
			expect(r.ok).toBe(false);
			if (r.ok) return;
			const text = hardErrorText(r.error, source);
			const [, details] = text.split(' Details: ');
			expect(details, text).toBeTruthy();
			expect(details, text).not.toMatch(RAW);
			// Plain sentences: at most 20 words each, at most 5 of them (G4: the alias text has five short ones).
			const sentences = details.split(/(?<=[.!?])\s+(?=[A-Z])/);
			expect(sentences.length, text).toBeLessThanOrEqual(5);
			for (const s of sentences) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
			// The word list: no "-ing" word as a verb, no contraction.
			expect(details).not.toMatch(/\b(don't|can't|isn't|doesn't|won't)\b/i);
			expect(details, 'no -ing word').not.toMatch(/\b[a-z]+ing\b/i);
		});
	}

	it('a message that the plugin does not know is not shown in the parser words', () => {
		const text = hardErrorText({ code: 'yaml-invalid', line: 2, detail: 'Something odd in the parser sequence collection' }, 'a\nb\n');
		expect(text).not.toMatch(RAW);
		expect(text).toContain('Details: ');
	});

	it('the G4 texts: alias name, comma in square and in curly brackets, the fallback', () => {
		const say = (detail: string) => hardErrorText({ code: 'yaml-invalid', line: 2, detail }, 'a\nb\n').split(' Details: ')[1];
		expect(say('Unresolved alias (the anchor must be set before the alias): house')).toBe(
			'The mark “*house” repeats text. No text above it has the mark “&house”. Put “&house” at the start of the text to repeat, above “*house”. Or delete “*house”. Check that both marks have the same name.',
		);
		expect(say('Missing , between flow sequence items')).toBe('Two items in brackets have no comma between them. Add a comma “,” between the items.');
		expect(say('Missing , or : between flow map items')).toBe(
			'Two items in curly brackets have no comma or colon between them. Add a comma “,” between two items. Or add a colon “:” between a name and its value.',
		);
		expect(say('Invalid escape sequence \\q')).toBe('A text in double quote marks has a backslash “\\” that the plugin cannot read. Delete the backslash, or write it two times.');
		expect(say('Something the plugin does not know')).toBe(
			'The plugin cannot say more. Check the text lines of the tree text for a quote mark or a bracket that is not closed. Start with the text line that the box names and go up.',
		);
	});

	it('the plugin own details stay as they are', () => {
		const text = hardErrorText({ code: 'yaml-invalid', line: 4, detail: 'One person or section has the field “name:” two times. Delete one of the text lines, or change the name of the field.' }, 'a\nb\nc\nd\n');
		expect(text).toContain('One person or section has the field “name:” two times.');
	});

	it('the text line is a text line that the tree text has', () => {
		// The parser reports the end of the text, one text line after the last, for a list that is never closed.
		const withBreak = 'people:\n  - id: a\n    name: [A\n';
		const r = parseDynasty(withBreak);
		if (r.ok) throw new Error('parsed');
		expect((r.error.line ?? 0) > 3).toBe(true);
		expect(hardErrorText(r.error, withBreak)).toMatch(/^Text line 3 of the tree text /);
		// The same text with no line break at its end names the same text line.
		const bare = withBreak.slice(0, -1);
		const r2 = parseDynasty(bare);
		if (r2.ok) throw new Error('parsed');
		expect(hardErrorText(r2.error, bare)).toMatch(/^Text line 3 of the tree text /);
	});

	it('a text line that is inside the text stays as the parser says it', () => {
		const text = 'people:\n  - id: a\n   name: A\n  - id: b\n';
		const r = parseDynasty(text);
		if (r.ok) throw new Error('parsed');
		expect(hardErrorText(r.error, text)).toMatch(/^Text line 3 of the tree text /);
	});

	it('with a CRLF text the count is the same', () => {
		const text = 'people:\r\n  - id: a\r\n    name: [A\r\n';
		const r = parseDynasty(text);
		if (r.ok) throw new Error('parsed');
		expect(hardErrorText(r.error, text)).toMatch(/^Text line 3 of the tree text /);
	});

	it('the error box of a note that can be edited has the button "Show the tree text"', async () => {
		desktop();
		const handle = fakeHandle('n.md', BAD);
		const host = fakeHost();
		const { el } = await errorEmbed(BAD, { host, handle });
		const showSource = vi.fn(async () => true);
		Object.assign(host.handles, { showSource });
		const box = el.querySelector('.dynasty-error');
		expect(box).not.toBeNull();
		const button = box!.querySelector('.dynasty-error-button');
		expect(button).not.toBeNull();
		expect(button!.getText()).toBe(BLOCK_UI.showText);
		await press(button);
		expect(showSource).toHaveBeenCalledWith('n.md', 0);
	});

	it('a block that cannot be edited here has no such button', async () => {
		desktop();
		const { el } = await errorEmbed(BAD, { handle: null });
		expect(el.querySelector('.dynasty-error')).not.toBeNull();
		expect(el.querySelector('.dynasty-error-button')).toBeNull();
	});

	it('the box still shows the line and the details', async () => {
		desktop();
		const { el } = await errorEmbed(BAD, { handle: fakeHandle('n.md', BAD) });
		const detail = el.querySelector('.dynasty-error-detail')!.getText();
		expect(detail).toMatch(/^Text line 3 of the tree text has an error\./);
		expect(detail).not.toMatch(RAW);
	});
});

describe('F13: the toolbar tooltip', () => {
	it('names what the bar holds, not only "Tree"', () => {
		expect(TOOLBAR_UI.region).not.toBe('Tree');
		expect(TOOLBAR_UI.region.split(/\s+/).length).toBeGreaterThanOrEqual(3);
	});

	it('the toolbar of the computer carries that name', async () => {
		desktop();
		const { el } = await embed(SMALL, { handle: fakeHandle('n.md', SMALL) });
		expect(el.querySelector('.dynasty-toolbar')?.getAttribute('aria-label')).toBe(TOOLBAR_UI.region);
	});

	it('the Focus labels did not change', () => {
		expect(FOCUS_UI.clear).toBe('Clear focus');
	});
});
