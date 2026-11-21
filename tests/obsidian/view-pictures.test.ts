import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { clock, flushFrames, resetDom, runTimers, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The pictures of a tree view as one owned part (review step 11): what starts them, what a redraw in place keeps, what the end of the view
 * releases, which problems the badge gets and when the store is asked again. The tests read the view through `peek`, which knows both the
 * old place of the state (fields of the view chain) and the new one (`view.pictures`), so the same cases ran on the code before the move.
 */
useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}
options: {me: ann}
people:
  - {id: ann, name: Ann, house: va, born: 1100, portrait: "[[ann.png]]"}
  - {id: bob, name: Bob, parents: [ann], born: 1120}
`;

type Live = { destroy(): void; pause(): void; resume(): void; refresh(p: readonly string[]): void };
interface Inside {
	timers: Set<number>;
	pictures?: { started: boolean; token: number; live: Live | null; info: unknown; allIssues(): { code?: string }[]; port?: { timers: Set<number> } };
	picturesOn?: boolean;
	pictureToken?: number;
	live?: Live | null;
	allIssues?(): { code?: string }[];
	foldsChanged(anchor: null, targets: string[]): void;
	pausePictures(): void;
	resumePictures(): void;
	unload(): void;
}
const peek = (v: unknown) => {
	const x = v as Inside;
	return {
		on: x.pictures ? x.pictures.started : x.picturesOn!,
		token: x.pictures ? x.pictures.token : x.pictureToken!,
		live: x.pictures ? x.pictures.live : x.live!,
		issues: () => (x.pictures ? x.pictures.allIssues() : x.allIssues!()),
		timers: x.timers,
		view: x,
	};
};

interface Store {
	resolves: number;
	acquires: number;
	checks: number;
	hear: ((p: readonly string[]) => void) | null;
	missing: Set<string>;
	problem: string | null;
}
function makeStore(): Store & Record<string, unknown> {
	const s: Store & Record<string, unknown> = {
		resolves: 0,
		acquires: 0,
		checks: 0,
		hear: null,
		missing: new Set<string>(),
		problem: null,
		resolve: (link: string) => {
			s.resolves++;
			const path = link.replace(/[[\]]/g, '');
			return s.missing.has(path) ? { ok: false, code: 'missing-picture', file: link } : { ok: true, file: { path, name: 'x.png' }, format: 'png' };
		},
		check: async () => (s.checks++, s.problem ? { ok: false, code: s.problem, file: 'x' } : null),
		acquire: async () => (s.acquires++, { url: 'blob:x', w: 10, h: 10, release: () => {} }),
		onChange: (fn: (p: readonly string[]) => void) => ((s.hear = fn), () => {}),
		peek: () => null,
		transient: async () => null,
	};
	return s;
}

async function open(src = SRC, store = makeStore()) {
	desktop();
	const host = fakeHost(DEFAULT_SETTINGS);
	(host as unknown as { pictures: unknown }).pictures = store;
	const r = await embed(src, { host, handle: fakeHandle('n.md', src) });
	runTimers(600);
	flushFrames();
	await settle();
	return { ...r, store, p: peek(r.view) };
}

describe('the pictures of a view: start, redraw, end', () => {
	it('start: the pictures start after the first view, and one file check ends with the mark on the box', async () => {
		const { el, store, p } = await open();
		expect(p.on).toBe(true);
		expect(p.live).not.toBeNull();
		expect(store.checks).toBeGreaterThan(0);
		expect((el as unknown as { querySelector(s: string): { getAttribute(n: string): string | null } | null }).querySelector('.dynasty-root, [data-dynasty-pictures]')).not.toBeNull();
	});

	it('redraw keeps the pictures started: same token, a new live set, and the new scene loads its pictures', async () => {
		const { view, store, p } = await open();
		const token = p.token;
		const before = p.live;
		const loaded = store.acquires;
		p.view.foldsChanged(null, []);
		runTimers(600);
		flushFrames();
		await settle();
		const now = peek(view);
		expect(now.on).toBe(true);
		expect(now.token).toBe(token);
		expect(now.live).not.toBeNull();
		expect(now.live).not.toBe(before);
		expect(store.acquires).toBeGreaterThanOrEqual(loaded);
	});

	it('the end of the view (unload) stops the start, raises the token and destroys the live pictures', async () => {
		const { view, p } = await open();
		const token = p.token;
		const live = p.live!;
		const destroy = vi.spyOn(live, 'destroy');
		view.unload();
		const now = peek(view);
		expect(now.on).toBe(false);
		expect(now.token).toBeGreaterThan(token);
		expect(now.live).toBeNull();
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it('a render raises the token and the pictures start again only after the next first view', async () => {
		const { view, p } = await open();
		const token = p.token;
		(view as unknown as { onCssChange(): void }).onCssChange();
		runTimers(600);
		flushFrames();
		await settle();
		const now = peek(view);
		expect(now.token).toBeGreaterThanOrEqual(token);
		expect(now.on).toBe(true);
	});

	it('pause stops the requests that wait, and resume loads again unless a full-screen view still covers the block', async () => {
		const { view, p } = await open();
		const live = p.live!;
		const pause = vi.spyOn(live, 'pause');
		const resume = vi.spyOn(live, 'resume');
		peek(view).view.pausePictures();
		expect(pause).toHaveBeenCalledTimes(1);
		peek(view).view.resumePictures();
		expect(resume).toHaveBeenCalledTimes(1);
		const cover = vi.spyOn(FullScreenModal, 'isOpenFor').mockReturnValue(true);
		peek(view).view.resumePictures();
		expect(resume).toHaveBeenCalledTimes(1);
		cover.mockRestore();
	});
});

describe('the pictures of a view: problems and the store', () => {
	it('the badge problems: the tree text first, then a picture problem; a missing file is no problem until the metadata cache is ready (D183)', async () => {
		const src = `${SRC}  - {id: cy, name: Cy, parents: [cy]}\n`;
		const store = makeStore();
		store.missing.add('ann.png');
		const { p } = await open(src, store);
		const codes = p.issues().map((i) => i.code);
		expect(codes.length).toBeGreaterThan(1);
		// The tree text's own problems come first, the picture warnings after them, in tree order.
		expect(codes[codes.length - 1]).toBe('missing-picture');
		expect(codes.indexOf('missing-picture')).toBeGreaterThan(0);
	});

	it('a picture that the file check finds wrong adds its warning to the badge', async () => {
		const store = makeStore();
		store.problem = 'picture-too-large';
		const { p } = await open(SRC, store);
		expect(p.issues().map((i) => i.code)).toContain('picture-too-large');
	});

	it('a change of a path no tree link uses asks the store nothing', async () => {
		const { store } = await open();
		const asked = store.resolves;
		store.hear!(['other/unrelated.png']);
		await settle();
		expect(store.resolves).toBe(asked);
	});

	it('a change of a path a link uses resolves the links again', async () => {
		const { store } = await open();
		const asked = store.resolves;
		store.hear!(['ann.png']);
		await settle();
		expect(store.resolves).toBeGreaterThan(asked);
	});

	it('a view with no picture store has no pictures and the plain text problems', async () => {
		desktop();
		const host = fakeHost(DEFAULT_SETTINGS);
		const { view } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		runTimers(600);
		flushFrames();
		await settle();
		const p = peek(view);
		expect(p.on).toBe(false);
		expect(p.live).toBeNull();
		expect(p.issues()).toEqual([]);
	});
});

describe('the pictures object on its own, with a port of fakes', () => {
	it('the port of a real view gives the same timers Set as the view, not a copy', async () => {
		const { p } = await open();
		const port = (p.view.pictures as unknown as { port: { timers: Set<number> } }).port;
		expect(port.timers).toBe(p.timers);
	});

	it('the first start waits two frames and a timer; a release before it ends makes it do nothing', async () => {
		const { ViewPictures } = await import('../../src/obsidian/view-pictures');
		const timers = new Set<number>();
		const frames: (() => void)[] = [];
		const timeouts: (() => void)[] = [];
		const win = {
			requestAnimationFrame: (f: () => void) => (frames.push(f), frames.length),
			setTimeout: (f: () => void) => (timeouts.push(f), timeouts.length),
		};
		let checks = 0;
		const store = { resolve: () => ({ ok: true, file: { path: 'a.png' }, format: 'png' }), check: async () => (checks++, null) };
		const port = {
			host: { pictures: store, isFullOpenFor: () => false },
			containerEl: { win },
			key: 'k',
			sourcePath: 'n.md',
			unloaded: false,
			full: null,
			whole: { houses: new Map(), people: [{ id: 'a', name: 'A', portrait: '[[a.png]]' }], byId: new Map() },
			g: null,
			scene: null,
			viewport: { parentElement: { isConnected: true, removeAttribute() {}, setAttribute() {}, getAttribute: () => null } },
			panZoom: null,
			lod: null,
			timers,
			guard: (fn: () => void) => fn(),
			updateBadge() {},
			refillList() {},
		};
		const pics = new ViewPictures(port as never);
		pics.resolve(port.whole as never);
		expect(pics.info?.uses.length).toBe(1);
		pics.start();
		frames.splice(0).forEach((f) => f());
		frames.splice(0).forEach((f) => f());
		expect(timeouts.length).toBe(1);
		expect(timers.size).toBe(1);
		pics.release();
		timeouts.splice(0).forEach((f) => f());
		expect(pics.started).toBe(false);
		expect(checks).toBe(0);
		// A start that nothing cancels switches the pictures on and runs the one file check.
		pics.start();
		frames.splice(0).forEach((f) => f());
		frames.splice(0).forEach((f) => f());
		timeouts.splice(0).forEach((f) => f());
		expect(pics.started).toBe(true);
		expect(checks).toBe(1);
		// A second start does nothing once the pictures are on.
		pics.start();
		expect(frames.length).toBe(0);
	});

	it('dropLive keeps the start state and the token; release raises the token and ends the start state', async () => {
		const { ViewPictures } = await import('../../src/obsidian/view-pictures');
		const pics = new ViewPictures({} as never);
		let destroyed = 0;
		pics.live = { destroy: () => destroyed++ } as never;
		pics.started = true;
		pics.dropLive();
		expect([pics.live, pics.started, pics.token, destroyed]).toEqual([null, true, 0, 1]);
		pics.live = { destroy: () => destroyed++ } as never;
		pics.release();
		expect([pics.live, pics.started, pics.token, destroyed]).toEqual([null, false, 1, 2]);
	});
});
