import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { createLivePictures } from '../src/obsidian/live-pictures';
import { createPictureStore, type CopyBox, type PictureCopy, type PictureIO, type PictureStore } from '../src/obsidian/picture-store';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';
import type { PictureSlot } from '../src/render/dom/pictures';
import { Popover } from '../src/render/dom/widgets';
import { FEl, dispatch, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fixtureSource } from './acceptance/load';
import { pngHead } from './acceptance/m9-support';
import { embed, fakeHandle, fakeHost, openFullScreen } from './acceptance/tree-view-fakes';

/*
 * M9 fix round, the Obsidian side: the store's queue order (copies the owner waits for first) and
 * `alone` (B13), the live pictures paused under a full-screen view, and the popover close hook that
 * lets the legend give back its arms copies.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

function file(path: string, size = 1000, mtime = 1): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime, ctime: 1, size } }) as VaultFile;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(done: () => boolean, what: string): Promise<void> {
	for (let k = 0; k < 200; k++) {
		if (done()) return;
		await tick();
	}
	throw new Error(`timed out waiting for ${what}`);
}
async function drain(): Promise<void> {
	for (let k = 0; k < 20; k++) {
		flushFrames();
		runTimers(16);
		await tick();
	}
}

/** A browser seam whose decodes wait until the test lets them go; it logs the order of the decodes. */
function heldIO(coarse: boolean) {
	const state = { order: [] as string[], release: [] as (() => void)[], open: 0 };
	const io: PictureIO = {
		read: async (f) => {
			const b = pngHead(400, 600);
			// The path goes with the bytes, so the decode can log which file it is.
			(b as Uint8Array & { path?: string }).path = f.path;
			state.order.push(`read:${f.path}`);
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		decode: async () => {
			await new Promise<void>((r) => state.release.push(r));
			state.open++;
			return {
				width: 400,
				height: 600,
				source: {} as CanvasImageSource,
				close() {
					state.open--;
				},
			};
		},
		encode: async () => new Blob([new Uint8Array(100)], { type: 'image/png' }),
		rgba: async (_s, w, h) => new Uint8ClampedArray(w * h * 4),
		coarse: () => coarse,
		dpr: () => 1,
	};
	return { io, state };
}

const storeApp = () => ({ metadataCache: { getFirstLinkpathDest: () => null } });
const BOX: CopyBox = { w: 24, h: 24, fit: 'portrait' };
const isCopy = (x: unknown): x is PictureCopy => !!x && typeof x === 'object' && 'url' in x;

describe('the picture store queue (fix round)', () => {
	it('a transient copy (the sheet, the picker) goes before the live copies that wait', async () => {
		const { io, state } = heldIO(true);
		const store = createPictureStore(storeApp() as never, io);
		const first = store.acquire(file('a.png'), BOX);
		await until(() => state.release.length === 1, 'the first decode');
		const live = [store.acquire(file('b.png'), BOX), store.acquire(file('c.png'), BOX)];
		const sheet = store.transient(file('sheet.png'), { w: 96, h: 96, fit: 'portrait' });
		await tick();
		state.release.shift()!();
		await first;
		await until(() => state.release.length === 1, 'the second decode');
		// The file read before the second decode is the sheet's, not the live copies' that came first.
		expect(state.order.filter((x) => x.startsWith('read:')).slice(0, 2)).toEqual(['read:a.png', 'read:sheet.png']);
		state.release.shift()!();
		expect(isCopy(await sheet)).toBe(true);
		for (let k = 0; k < 2; k++) {
			await until(() => state.release.length === 1, 'a live decode');
			state.release.shift()!();
		}
		expect((await Promise.all(live)).every(isCopy)).toBe(true);
	});

	it('B13: alone waits for the running decodes; no decode starts before its work ends; its result and error go to the caller', async () => {
		const { io, state } = heldIO(false);
		const store = createPictureStore(storeApp() as never, io);
		const first = store.acquire(file('a.png'), BOX);
		await until(() => state.release.length === 1, 'the first decode');
		const log: string[] = [];
		let endWork!: () => void;
		const work = store.alone(async () => {
			log.push(`start open=${state.open}`);
			await new Promise<void>((r) => (endWork = r));
			log.push('end');
			return 42;
		});
		const later = store.acquire(file('b.png'), BOX);
		await tick();
		// Not coarse, so a second decode could run beside the first; it waits behind `alone`.
		expect(log).toEqual([]);
		expect(state.release.length).toBe(1);
		state.release.shift()!();
		await first;
		await until(() => log.length === 1, 'the start of the work');
		expect(log).toEqual(['start open=0']);
		await tick();
		expect(state.release.length).toBe(0);
		endWork();
		expect(await work).toBe(42);
		await until(() => state.release.length === 1, 'the decode after the work');
		state.release.shift()!();
		expect(isCopy(await later)).toBe(true);
		await expect(store.alone(async () => Promise.reject(new Error('no canvas')))).rejects.toThrow('no canvas');
		// The queue goes on after an error.
		const after = store.acquire(file('c.png'), BOX);
		await until(() => state.release.length === 1, 'a decode after the error');
		state.release.shift()!();
		expect(isCopy(await after)).toBe(true);
	});

	it('B13: after clear (the plugin unloads), alone still runs its work', async () => {
		const { io } = heldIO(false);
		const store = createPictureStore(storeApp() as never, io);
		store.clear();
		expect(await store.alone(async () => 'done')).toBe('done');
	});
});

describe('live pictures: pause and resume', () => {
	/** Two portrait slots and a store whose copies come when the test lets them go. */
	function setup() {
		const asks: { path: string; signal?: AbortSignal; give: (c: PictureCopy | null) => void }[] = [];
		const store = {
			acquire: (f: VaultFile, _b: CopyBox, signal?: AbortSignal) => new Promise<PictureCopy | null>((give) => asks.push({ path: f.path, signal, give })),
			peek: () => null,
		} as unknown as PictureStore;
		const slot = (person: string, x: number): PictureSlot =>
			({ kind: 'portrait', person, lod: 'full', rect: { x, y: 0, w: 20, h: 20 }, el: new FEl('g') }) as unknown as PictureSlot;
		const slots = [slot('a', 0), slot('b', 40)];
		const live = createLivePictures(slots, store, (s) => file(`${s.person}.png`));
		return { live, asks };
	}
	const view = { x: -10, y: -10, w: 200, h: 100 };

	it('pause stops the requests that wait and starts no new one; resume asks for the pictures of the last view', async () => {
		const { live, asks } = setup();
		live.update(view, 'full');
		expect(asks.length).toBe(2);
		expect(live.pending).toBe(2);
		live.pause();
		expect(asks.every((a) => a.signal?.aborted)).toBe(true);
		expect(live.pending).toBe(0);
		live.update({ ...view, x: -5 }, 'full');
		live.refresh(['a.png']);
		expect(asks.length).toBe(2);
		live.resume();
		expect(asks.length).toBe(4);
		expect(asks.slice(2).map((a) => a.path).sort()).toEqual(['a.png', 'b.png']);
		expect(live.pending).toBe(2);
		live.destroy();
	});
});

describe('the popover close hook', () => {
	it('whenClosed runs once when the popover closes: by close, by a new popover, and at once when none is open', () => {
		const host = new FEl('div');
		fakeDoc.body.appendChild(host);
		const pop = new Popover(host as unknown as HTMLElement);
		let n = 0;
		pop.open('legend', () => {}, null);
		pop.whenClosed(() => n++);
		pop.close();
		pop.close();
		expect(n).toBe(1);
		pop.open('legend', () => {}, null);
		pop.whenClosed(() => n++);
		pop.open('more', () => {}, null);
		expect(n).toBe(2);
		pop.close();
		expect(n).toBe(2);
		pop.whenClosed(() => n++);
		expect(n).toBe(3);
	});
});

/** A store whose copies come a moment after the request; every link resolves; it logs the requests. */
function loggedStore() {
	let n = 0;
	const log = { acquire: [] as string[], released: 0, held: 0 };
	const store = {
		resolve: (link: string) => ({ ok: true, file: file(link.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, '')), format: 'png' }),
		check: async () => null,
		acquire: async (f: VaultFile, b: CopyBox, signal?: AbortSignal) => {
			log.acquire.push(`${f.path}@${b.w}x${b.h}`);
			await tick();
			if (signal?.aborted) return null;
			log.held++;
			let done = false;
			return {
				url: `blob:${f.path}#${n++}`,
				w: 1,
				h: 1,
				release() {
					if (done) return;
					done = true;
					log.released++;
				},
			};
		},
		transient: async () => null,
		peek: () => null,
		pixels: async () => null,
		exportCopy: async () => 'data:image/png;base64,',
		alone: <T>(fn: () => Promise<T>) => fn(),
		invalidate() {},
		changed() {},
		onChange: () => () => {},
		clear() {},
		stats: { bytes: 0, entries: 0, inUse: 0, openBitmaps: 0, maxOpenBitmaps: 0 },
	};
	return { store: store as unknown as PictureStore, log };
}

describe('the note tree under a full-screen view (fix round)', () => {
	it('starts no picture request while the full-screen view of its block is open, and loads the pictures when it closes', async () => {
		const src = fixtureSource('07b');
		const host = fakeHost() as ReturnType<typeof fakeHost> & { pictures?: PictureStore; settings?: typeof DEFAULT_SETTINGS };
		const { store, log } = loggedStore();
		host.pictures = store;
		host.settings = { ...DEFAULT_SETTINGS };
		const { el, vp } = await embed(src, { host: host as never, handle: fakeHandle('n.md', src) });
		await drain();
		expect(log.acquire.length).toBeGreaterThan(0);
		const { modal } = await openFullScreen(src, { host: host as never });
		await drain();
		const before = log.acquire.length;
		// The note's preview grows under the full-screen view: its new cards wait.
		vp.clientWidth = 1440;
		vp.clientHeight = 1600;
		resizeAll();
		await drain();
		expect(log.acquire.length - before).toBe(0);
		modal.close();
		await drain();
		expect(log.acquire.length - before).toBeGreaterThan(0);
		expect(el.querySelectorAll('.dynasty-portrait image').length).toBeGreaterThan(0);
	});
});

describe('the legend gives back its arms copies when it closes (fix round)', () => {
	async function legendOpen() {
		const src = fixtureSource('07b');
		const host = fakeHost() as ReturnType<typeof fakeHost> & { pictures?: PictureStore; settings?: typeof DEFAULT_SETTINGS };
		const { store, log } = loggedStore();
		host.pictures = store;
		host.settings = { ...DEFAULT_SETTINGS };
		const { el, view } = await embed(src, { host: host as never, handle: fakeHandle('n.md', src) });
		await drain();
		const releasedBefore = log.released;
		const heldBefore = log.held;
		dispatch(el.querySelector('.dynasty-legend-button')!, 'click', { button: 0 });
		await drain();
		const legendHeld = log.held - heldBefore;
		expect(legendHeld).toBeGreaterThan(0);
		expect(el.querySelector('.dynasty-popover-legend')).not.toBeNull();
		return { el, view, log, releasedBefore, legendHeld };
	}

	it('Esc (closePopover) closes the legend and releases every arms copy it held', async () => {
		const { el, view, log, releasedBefore, legendHeld } = await legendOpen();
		expect(view.closePopover()).toBe(true);
		expect(el.querySelector('.dynasty-popover-legend')).toBeNull();
		expect(log.released - releasedBefore).toBe(legendHeld);
	});

	it('another popover (More) replaces the legend and the legend releases its arms copies', async () => {
		const { el, log, releasedBefore, legendHeld } = await legendOpen();
		dispatch(el.querySelector('.dynasty-more')!, 'click', { button: 0 });
		await drain();
		expect(el.querySelector('.dynasty-popover-legend')).toBeNull();
		expect(el.querySelector('.dynasty-popover-more')).not.toBeNull();
		expect(log.released - releasedBefore).toBe(legendHeld);
	});
});
