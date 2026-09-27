import { expect, vi } from 'vitest';
import { newBlockState } from '../../src/obsidian/block-state';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import DynastyTreePlugin from '../../src/obsidian/main';
import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, device, dispatch, flushFrames, pointer, resizeAll, settle } from './fake-dom';
import { events, openModals, type Plugin as FakePlugin } from './fake-obsidian';

/*
 * The plugin side of the fakes: an app, a block handle, a host, and the ways a test opens a tree
 * (embedded in a note, full screen, the real plugin). A test file that imports this must mock
 * `obsidian` with fake-obsidian.ts, and `@codemirror/language` and `@codemirror/view` (main.ts
 * imports the Live Preview extension):
 *
 *   vi.mock('obsidian', () => import('./fake-obsidian'));
 *   vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
 *   vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
 */

/**
 * A phone in portrait (an iPhone, 390 × 844): `(pointer: coarse)`, a viewport narrower than 600 px
 * (spec §7), height greater than width. From WP5.5b it draws the tree sideways (D24).
 */
export function phone(): void {
	device.coarse = true;
	device.width = 390;
	device.height = 844;
}

/**
 * The same phone on its side (844 × 390): still a phone (shorter side under 600 px: D20, D23), but
 * it keeps the `down` layout (D24). Tests of the `down` geometry on a phone use it (the decision notes
 * "WP5.5b rules").
 */
export function phoneOnSide(): void {
	device.coarse = true;
	device.width = 844;
	device.height = 390;
}

/** A desktop: a mouse and a wide viewport. */
export function desktop(): void {
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
}

/**
 * A card that the first view of a view does not show whole: one cut at the edge if there is one,
 * else one outside the view. For the Tab rule of a static touch embed (D1: a Tab onto such a card
 * pans the embed), in any orientation.
 */
export function cutCard(root: FEl): string {
	const t = root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '';
	const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t);
	if (!m) throw new Error(`transform ${t}`);
	const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const vp = root.querySelector('.dynasty-viewport')!;
	let outside: string | null = null;
	for (const card of root.querySelectorAll('.dynasty-card')) {
		const bg = card.querySelector('.dynasty-card-bg')!;
		const x = tx + Number(bg.getAttribute('x')) * s;
		const y = ty + Number(bg.getAttribute('y')) * s;
		const r = x + Number(bg.getAttribute('width')) * s;
		const b = y + Number(bg.getAttribute('height')) * s;
		const whole = x >= 0 && y >= 0 && r <= vp.clientWidth && b <= vp.clientHeight;
		const seen = r > 0 && x < vp.clientWidth && b > 0 && y < vp.clientHeight;
		if (seen && !whole) return card.getAttribute('data-person')!;
		if (!whole) outside ??= card.getAttribute('data-person');
	}
	if (!outside) throw new Error('every card is shown whole');
	return outside;
}

interface FakeVault {
	on(name: string, fn: (...args: unknown[]) => void): { name: string; fn: (...args: unknown[]) => void };
	offref(ref: { name: string; fn: (...args: unknown[]) => void }): void;
	cachedRead(): Promise<string>;
	fire(name: string, ...args: unknown[]): void;
}

export function fakeApp() {
	const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
	const vault: FakeVault = {
		on(name, fn) {
			handlers.set(name, [...(handlers.get(name) ?? []), fn]);
			return { name, fn };
		},
		offref(ref) {
			handlers.set(
				ref.name,
				(handlers.get(ref.name) ?? []).filter((f) => f !== ref.fn),
			);
		},
		cachedRead: async () => '',
		fire(name, ...args) {
			for (const fn of [...(handlers.get(name) ?? [])]) fn(...args);
		},
	};
	const workspace = {
		openLinkText: vi.fn(async (...args: unknown[]) => {
			events.push(`open-link ${String(args[0])}`);
		}),
		trigger: vi.fn(),
		getActiveFile: () => null,
		on: (name: string, fn: unknown) => ({ name, fn }),
		onLayoutReady: (fn: () => void) => fn(),
	};
	const metadataCache = { getFirstLinkpathDest: () => null };
	return { vault, workspace, metadataCache };
}

export function fakeHandle(path: string, body: string) {
	const listeners: ((body: string) => void)[] = [];
	return {
		key: { path, ordinal: 0 },
		body,
		detached: false,
		canUndo: false,
		state: newBlockState(),
		onChanged: (fn: (body: string) => void) => {
			listeners.push(fn);
			return () => {};
		},
		/** The note changed outside the plugin (sync, another pane): the handle reports the new body. */
		change(next: string) {
			this.body = next;
			for (const fn of [...listeners]) fn(next);
		},
		refresh: async () => {},
		write: vi.fn(async () => ({ ok: false, code: 'missing' })),
		undo: vi.fn(async () => ({ ok: false, code: 'empty' })),
	};
}

export type FakeApp = ReturnType<typeof fakeApp>;
export type FakeHandle = ReturnType<typeof fakeHandle>;

/** What the tree view needs from the plugin (TreeHost), on fakes. `renders` counts the renders (layout runs). */
export interface Host {
	app: FakeApp;
	handles: object;
	views: Set<TreeView>;
	looseStates: Map<string, unknown>;
	renders?: number;
	recordTiming(): void;
}

export function fakeHost(): Host {
	return {
		app: fakeApp(),
		handles: {},
		views: new Set<TreeView>(),
		looseStates: new Map(),
		renders: 0,
		recordTiming() {
			this.renders = (this.renders ?? 0) + 1;
		},
	};
}

/**
 * Opens the full-screen view of a block of note `path`, as Expand does (spec §7.1), and lets it
 * lay out. `readOnly`: a block with no handle (transclusion, Canvas card, ...).
 */
export async function openFullScreen(source: string, o: { readOnly?: boolean; path?: string; host?: Host } = {}) {
	const host = o.host ?? fakeHost();
	const app = host.app;
	const path = o.path ?? 'n.md';
	const handle = o.readOnly ? null : fakeHandle(path, source);
	const views = host.views;
	const from = { key: `${path}\u0000#0`, sourcePath: path, source, handle, peeked: null, readOnly: !!o.readOnly };
	const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
	modal.open();
	await settle();
	resizeAll();
	flushFrames();
	const root = modal.containerEl as unknown as FEl;
	const vp = root.querySelector('.dynasty-viewport');
	return { app, handle, host, views, modal, root, vp };
}

/**
 * An embedded tree in note n.md, as the plugin's code-block processor makes it, in a 360 × 400
 * viewport. With `handle`, Obsidian reports the block's section and the block can be edited;
 * without, it is read-only.
 */
export async function embed(source: string, o: { host?: Host; handle?: FakeHandle | null } = {}) {
	const host = o.host ?? fakeHost();
	const handle = o.handle ?? null;
	// The parts of the handle registry an embed uses (spec §6.1).
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
	const vp = el.querySelector('.dynasty-viewport')!;
	vp.clientWidth = 360;
	vp.clientHeight = 400;
	resizeAll();
	flushFrames();
	return { el, vp, view, host };
}

/** The real plugin (main.ts), loaded; it is also the host of the views the test makes. */
export async function loadPlugin() {
	const app = fakeApp();
	const plugin = new DynastyTreePlugin(app as never, { id: 'dynasty-tree' } as never);
	await (plugin as unknown as FakePlugin).load();
	return { app, plugin, host: plugin as unknown as Host };
}

export const isOpen = (m: unknown) => openModals.includes(m as never);
export const sheets = () => openModals.filter((m) => (m as unknown) instanceof EditSheet);
export const fullViews = () => openModals.filter((m) => (m as unknown) instanceof FullScreenModal);
/** The transform of the tree on screen. */
export const shown = (root: FEl) => root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? null;

/** Opens the edit sheet of person `id` with a tap (touch) or a click (mouse) on the card. */
export async function openSheetOn(root: FEl, id: string, type: 'touch' | 'mouse') {
	const card = root.querySelector(`.dynasty-card[data-person="${id}"]`)!;
	if (type === 'touch') {
		dispatch(card, 'pointerdown', pointer('touch', 5, 300, 200));
		dispatch(card, 'pointerup', pointer('touch', 5, 300, 200));
	} else {
		dispatch(card, 'pointerdown', pointer('mouse', 1, 300, 200));
		dispatch(card, 'pointerup', pointer('mouse', 1, 300, 200));
		dispatch(card, 'click', { button: 0, clientX: 300, clientY: 200 });
	}
	await settle();
	expect(sheets()).toHaveLength(1);
	return sheets()[0];
}

// Three houses of five cousins. Aldo, the first Ardent, marries Cara, the last Corwin: the couple is
// far (D10, D11) in `down` and in `sideways` (D24; in a column they are 14 cards apart), so each has
// a far-couple tag with one partner (a tap jumps at once).
export const FAR = [
	'people:',
	...[
		['rolf', 'Rolf Ardent'],
		['rosa', 'Rosa Ardent'],
		['saul', 'Saul Blackmere'],
		['sibyl', 'Sibyl Blackmere'],
		['tam', 'Tam Corwin'],
		['tessa', 'Tessa Corwin'],
	].flatMap(([id, name]) => [`  - id: ${id}`, `    name: ${name}`]),
	...[
		['aldo', 'Aldo Ardent', 'rolf, rosa'],
		['anna', 'Anna Ardent', 'rolf, rosa'],
		['arno', 'Arno Ardent', 'rolf, rosa'],
		['ada', 'Ada Ardent', 'rolf, rosa'],
		['abel', 'Abel Ardent', 'rolf, rosa'],
		['bella', 'Bella Blackmere', 'saul, sibyl'],
		['bram', 'Bram Blackmere', 'saul, sibyl'],
		['bess', 'Bess Blackmere', 'saul, sibyl'],
		['bert', 'Bert Blackmere', 'saul, sibyl'],
		['bea', 'Bea Blackmere', 'saul, sibyl'],
		['cole', 'Cole Corwin', 'tam, tessa'],
		['cyra', 'Cyra Corwin', 'tam, tessa'],
		['cid', 'Cid Corwin', 'tam, tessa'],
		['cora', 'Cora Corwin', 'tam, tessa'],
		['cara', 'Cara Corwin', 'tam, tessa'],
	].flatMap(([id, name, parents]) => [`  - id: ${id}`, `    name: ${name}`, `    parents: [${parents}]`]),
	'unions:',
	...['rolf, rosa', 'saul, sibyl', 'tam, tessa', 'aldo, cara'].map((p) => `  - partners: [${p}]`),
	'',
].join('\n');
