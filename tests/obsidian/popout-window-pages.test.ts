import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeViewBase } from '../../src/obsidian/tree-view-base';
import { pageFontEnv } from '../../src/obsidian/save-font';
import { saveWhenLeaving } from '../../src/obsidian/fence-vault';
import DynastyTreePlugin from '../../src/obsidian/main';
import { clock, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { resetObsidian, type Plugin as FakePlugin } from '../acceptance/fake-obsidian';
import { fakeApp } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

// Version 0.6.1 (D380): in a pop-out window the plugin works on that window's page, not on the page of the main window.

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

type Handler = (...args: unknown[]) => void;

/** A page of a second window: a body that keeps its style properties, and a font set that counts its listeners. */
function popPage() {
	const props = new Map<string, string>();
	const fontListeners = new Set<Handler>();
	const body = {
		isConnected: true,
		style: {
			setProperty: (k: string, v: string) => void props.set(k, v),
			removeProperty: (k: string) => void props.delete(k),
			getPropertyValue: (k: string) => props.get(k) ?? '',
		},
	};
	const fonts = {
		addEventListener: (_t: string, fn: Handler) => void fontListeners.add(fn),
		removeEventListener: (_t: string, fn: Handler) => void fontListeners.delete(fn),
	};
	const page = {
		body,
		fonts,
		styleSheets: [],
		baseURI: 'app://pop-out/',
		defaultView: { getComputedStyle: () => ({ getPropertyValue: () => '' }) },
	};
	return { page: page as unknown as Document, props, fontListeners };
}

async function loadWithWindows() {
	const app = fakeApp();
	const handlers = new Map<string, Handler>();
	(app.workspace as unknown as { on: (n: string, fn: Handler) => unknown }).on = (name, fn) => {
		handlers.set(name, fn);
		return { name, fn };
	};
	const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
	const fake = plugin as unknown as FakePlugin;
	await fake.load();
	const open = (page: Document) => handlers.get('window-open')!({}, { document: page });
	const close = (page: Document) => handlers.get('window-close')!({}, { document: page });
	return { fake, open, close };
}

describe('the pop-out window has its own page', () => {
	it('a window that opens gets the font listener, and a window that closes or the unload takes it off', async () => {
		const { fake, open, close } = await loadWithWindows();
		const a = popPage();
		const b = popPage();
		open(a.page);
		open(b.page);
		expect(a.fontListeners.size).toBe(1);
		expect(b.fontListeners.size).toBe(1);
		close(a.page);
		expect(a.fontListeners.size).toBe(0);
		fake.unload();
		expect(b.fontListeners.size).toBe(0);
	});

	it('the colour tokens go on the body of the pop-out window and come off when the plugin unloads', async () => {
		const { fake, open } = await loadWithWindows();
		const a = popPage();
		const cs = { getPropertyValue: (n: string) => ({ '--text-normal': '#000000', '--background-primary': '#ffffff', '--background-secondary': '#ffffff' })[n] ?? '' };
		(a.page as unknown as { defaultView: unknown }).defaultView = { getComputedStyle: () => cs };
		a.props.set('--dynasty-muted', 'stale');
		open(a.page);
		// The old value was taken off first, and nothing was written on the body of the main page for this window.
		expect(a.props.get('--dynasty-muted')).not.toBe('stale');
		a.props.set('--dynasty-on-accent', '#fff');
		a.props.set('--dynasty-edge', '#123456');
		fake.unload();
		expect(a.props.size).toBe(0);
	});

	it('saved-picture fonts and the fence save default to the active window, not the main one', () => {
		const a = popPage();
		vi.stubGlobal('activeDocument', a.page);
		expect(pageFontEnv().baseURI).toBe('app://pop-out/');
		const added: string[] = [];
		const target = (tag: string) => ({ addEventListener: (t: string) => void added.push(`${tag}:${t}`), removeEventListener: () => {} });
		vi.stubGlobal('activeWindow', target('win'));
		vi.stubGlobal('activeDocument', Object.assign(target('doc'), { visibilityState: 'visible' }));
		saveWhenLeaving({ flush: () => {} });
		expect(added).toEqual(['win:pagehide', 'doc:visibilitychange']);
	});

	it('the focus restore with no tree to look at reads the active page, not the main page', () => {
		let reads = 0;
		const page = {
			body: {},
			get activeElement() {
				reads++;
				return null;
			},
		};
		vi.stubGlobal('activeDocument', page);
		fakeDoc.activeElement = null;
		TreeViewBase.refocusAfterRedraw({ views: new Set() } as never, () => true, () => null, false);
		expect(reads).toBeGreaterThan(0);
	});
});
