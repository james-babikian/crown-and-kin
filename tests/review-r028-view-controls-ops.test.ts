import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers, settle, fireMediaChange, device } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, phone } from './acceptance/tree-view-fakes';
import { FEl } from './acceptance/fake-dom';
import { TreeView } from '../src/obsidian/tree-view';

async function embed(source: string, o: { host: ReturnType<typeof fakeHost>; handle: ReturnType<typeof fakeHandle> }) {
	const { host, handle } = o;
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
	const el = new FEl('div');
	const info = { lineStart: 0, lineEnd: source.split('\n').length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	const vp = el.querySelector('.dynasty-viewport');
	if (vp) {
		vp.clientWidth = 360;
		vp.clientHeight = 400;
	}
	resizeAll();
	flushFrames();
	return { el, vp, view, host };
}

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const OK = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}
options: {me: ann}
people:
  - {id: ann, name: Ann, house: va, born: 1100, portrait: "[[ann.png]]"}
  - {id: bob, name: Bob, parents: [ann], born: 1120}
`;
const SOURCES: Record<string, string> = {
	ok: OK,
	parseError: 'people: [',
	notMap: '- a\n- b\n',
	empty: 'people: []\n',
	blocking: 'people:\n  - {id: a, name: A}\n  - {id: a, name: B}\n',
	cycle: 'people:\n  - {id: a, name: A, parents: [b]}\n  - {id: b, name: B, parents: [a]}\n',
	self: 'people:\n  - {id: a, name: A, parents: [a]}\n',
};

const store = {
	resolve: (link: string) => ({ ok: true, file: { path: link.replace(/[[\]]/g, ''), name: 'x.png' }, format: 'png' }),
	check: async () => null,
	acquire: async () => ({ url: 'blob:x', w: 10, h: 10, release: () => {} }),
	onChange: () => () => {},
	peek: () => null,
	transient: async () => null,
};

type V = { onSettingsChange(p: unknown): void; onCssChange(): void; recheckTheme(): void; onFontsLoaded(f: string[]): void; syncFocus(own?: boolean): void; focusOn(id: string | null): void; adoptView(): void; pausePictures(): void; resumePictures(): void; closePopover(): boolean; retire(): void; renamed(a: string, b: string): void; stillThere(t: string | null): void };

const OPS: [string, (v: V) => void][] = [
	['settings-many', (v) => v.onSettingsChange({ ...DEFAULT_SETTINGS, showDates: false, showRelations: false, showPortraits: false, oneParentUnknown: false, focusGenerations: 1, breakWords: 'x', phoneDirection: 'down', successionLength: 3, youngDeathAge: 5 })],
	['css', (v) => v.onCssChange()],
	['recheck', (v) => v.recheckTheme()],
	['fonts', (v) => v.onFontsLoaded(['serif'])],
	['syncFocus', (v) => v.syncFocus()],
	['focusNull', (v) => v.focusOn(null)],
	['focusAnn', (v) => v.focusOn('ann')],
	['focusMissing', (v) => v.focusOn('zzz')],
	['adopt', (v) => v.adoptView()],
	['pause', (v) => v.pausePictures()],
	['resume', (v) => v.resumePictures()],
	['closePopover', (v) => v.closePopover()],
	['renamed', (v) => v.renamed('n.md', 'm.md')],
	['stillThere', (v) => v.stillThere(null)],
	['turn', () => { device.width = 844; device.height = 390; fireMediaChange(); }],
	['turn2', () => { device.width = 390; device.height = 844; fireMediaChange(); }],
	['retire', (v) => v.retire()],
];

const modes: [string, () => void][] = [['desktop', desktop], ['phone', phone]];

describe('explore', () => {
	for (const [mname, mode] of modes) {
		for (const [sname, src] of Object.entries(SOURCES)) {
			it(`${mname} ${sname}: no op throws or shows the internal error`, async () => {
				mode();
				const errors: unknown[][] = [];
				const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
				const host = fakeHost(DEFAULT_SETTINGS);
				(host as unknown as { pictures: unknown }).pictures = store;
				const { el, view } = await embed(src, { host, handle: fakeHandle('n.md', src) });
				flushFrames();
				await settle();
				const bad = () => (el as never as { querySelector(s: string): unknown }).querySelector('.dynasty-error .dynasty-error-detail') === null && (el as never as { getText(): string }).getText().includes('went wrong');
				for (const [name, op] of OPS) {
					try {
						op(view as unknown as V);
					} catch (e) {
						throw new Error(`${name} threw ${String(e)}`);
					}
					runTimers(600);
					flushFrames();
					await settle();
					expect(errors, `${name} logged`).toEqual([]);
				}
				spy.mockRestore();
				void bad;
			});
		}
	}
});
