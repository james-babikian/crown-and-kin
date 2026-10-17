import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import DynastyTreePlugin from '../src/obsidian/main';
import { START_LIMIT_MS, TreeView } from '../src/obsidian/tree-view';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { resetObsidian, type Plugin as FakePlugin } from './acceptance/fake-obsidian';
import { fakeApp, fakeHandle, phone, type Host } from './acceptance/tree-view-fakes';

/*
 * Review r028-ios-start, cause (a): the phone list draws before styles.css is applied.
 * Obsidian's loadPlugin does `await plugin.load(); await plugin.loadCSS();` (obsidian.asar app.js): the style sheet is read from disk AFTER onload and can
 * come late on a cold iPhone. The probe (`.dynasty-css-probe`) is the right signal, but both start gates give up after START_LIMIT_MS (2 s) whatever the probe says:
 * main.ts startReady (`performance.now() - startedAt >= START_LIMIT_MS`, counted from the construction of the plugin) and tree-view.ts waitingToStart
 * (`performance.now() - startAt >= START_LIMIT_MS`, counted from the start of the view). Then the list is built with no style sheet.
 */

const SRC = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
`;

const css = { in: false };

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	css.in = false;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	// The page has the plugin style sheet only when the test says so (the shared fake always says yes).
	(globalThis as Record<string, unknown>).getComputedStyle = () => ({ fontSize: '16px', fontFamily: 'sans-serif', paddingTop: '0px', getPropertyValue: (n: string) => (css.in && n === '--dynasty-css-ready' ? '1' : '') });
});

afterEach(() => vi.restoreAllMocks());

async function realPlugin() {
	const app = fakeApp();
	const p = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
	await (p as unknown as FakePlugin).load();
	const h = fakeHandle('n.md', SRC);
	Object.assign((p as unknown as Host).handles, { quickOrdinal: () => 0, peek: () => h, resolve: async () => h, resolveByBody: () => h, inEditorOf: () => false });
	return p;
}

function listView(p: DynastyTreePlugin) {
	const el = new FEl('div');
	const info = { lineStart: 0, lineEnd: 4, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
	const view = new TreeView(p as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
	view.load();
	return { el, view };
}

describe('r028-ios-start (a): the list must not be built before the style sheet is applied', () => {
	it('control: while the probe says "no style sheet" and the limit has not passed, the box stands in', async () => {
		phone();
		const p = await realPlugin();
		const { el } = listView(p);
		await settle();
		expect(el.querySelector('.dynasty-placeholder')).not.toBeNull();
		runTimers(1000);
		expect(el.querySelector('.dynasty-list-root')).toBeNull();
	});

	it('the style sheet comes after the 2 s limit (slow read of styles.css): the list was already built with no style', async () => {
		phone();
		const p = await realPlugin();
		const { el } = listView(p);
		await settle();
		runTimers(START_LIMIT_MS + 100);
		flushFrames();
		// The style sheet is still not applied: nothing may be drawn yet (the list would have no style, D183 / spec 13.22 rule 6).
		expect({ listDrawn: !!el.querySelector('.dynasty-list-root'), probeSaysStyled: css.in }).toEqual({ listDrawn: false, probeSaysStyled: false });
	});

	it('a view that starts more than 2 s after the plugin was made draws at once, with no style sheet (plugin-level limit)', async () => {
		phone();
		const p = await realPlugin();
		// A cold iPhone: the first render of the note comes late (other plugins are still loading), and loadCSS has not finished.
		clock.now += START_LIMIT_MS + 500;
		const { el } = listView(p);
		await settle();
		flushFrames();
		expect({ listDrawn: !!el.querySelector('.dynasty-list-root'), placeholder: !!el.querySelector('.dynasty-placeholder') }).toEqual({ listDrawn: false, placeholder: true });
	});
});
