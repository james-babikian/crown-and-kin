import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
// The trace can be made to throw, to prove that a throw never fails the copy job.
const trace = vi.hoisted(() => ({ throws: false }));
vi.mock('../src/layout/arms-outline', async (orig) => {
	const real = await orig<typeof import('../src/layout/arms-outline')>();
	return { ...real, traceOutline: (...a: Parameters<typeof real.traceOutline>) => { if (trace.throws) throw new Error('bad pixels'); return real.traceOutline(...a); } };
});

import { TFile as VaultFile } from 'obsidian';
import { createPictureStore, STORE_BYTES, type CopyBox, type PictureCopy, type PictureIO } from '../src/obsidian/picture-store';
import { fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { pngHead } from './acceptance/m9-support';

/* G2 fix round for the outline cache of the picture store (D219). */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	trace.throws = false;
});
afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const f = new File(path, 'png');
	return Object.assign(f, { name, basename: name.slice(0, -4), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

function fakeIO(opts: { rgbaError?: () => unknown; copyBytes?: number } = {}) {
	const state = { rgba: 0 };
	const io: PictureIO = {
		async read() {
			const b = pngHead(400, 600);
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		async decode() {
			return { width: 400, height: 600, source: {} as CanvasImageSource, close() {} };
		},
		async encode() {
			return new Blob([new Uint8Array(opts.copyBytes ?? 500)], { type: 'image/png' });
		},
		async rgba(_s, w, h) {
			state.rgba++;
			if (opts.rgbaError) throw opts.rgbaError();
			const px = new Uint8ClampedArray(w * h * 4);
			for (let i = 0; i < w * h; i++) px[i * 4 + 3] = 255;
			return px;
		},
		coarse: () => false,
		dpr: () => 1,
	};
	return { io, state };
}

const app = (files: VaultFile[]) => ({
	metadataCache: { getFirstLinkpathDest: (p: string) => files.find((f) => f.path === p) ?? null },
	vault: { getAbstractFileByPath: () => null, getFiles: () => files },
	loadLocalStorage: () => null,
	saveLocalStorage: () => undefined,
});

const ARMS: CopyBox = { w: 20, h: 24, fit: 'meet' };

describe('outline cache, fix round', () => {
	it('a tainted canvas is a lasting "no outline": the next copy does not read again', async () => {
		const f = file('t.png');
		const { io, state } = fakeIO({ rgbaError: () => Object.assign(new Error('tainted'), { name: 'SecurityError' }) });
		const store = createPictureStore(app([f]) as never, io);
		((await store.acquire(f, ARMS)) as PictureCopy).release();
		expect(store.outlineOf!(f)).toBeNull();
		((await store.acquire(f, { ...ARMS, w: 40, h: 48 })) as PictureCopy).release();
		expect(state.rgba).toBe(1);
	});

	it('any other failure is not remembered: the next copy reads again', async () => {
		const f = file('b.png');
		const { io, state } = fakeIO({ rgbaError: () => new Error('busy') });
		const store = createPictureStore(app([f]) as never, io);
		((await store.acquire(f, ARMS)) as PictureCopy).release();
		((await store.acquire(f, { ...ARMS, w: 40, h: 48 })) as PictureCopy).release();
		expect(state.rgba).toBe(2);
	});

	it('a throw in the trace gives no gap and the copy still arrives', async () => {
		trace.throws = true;
		const f = file('x.png');
		const { io } = fakeIO();
		const store = createPictureStore(app([f]) as never, io);
		const c = await store.acquire(f, ARMS);
		expect(c && 'url' in c).toBe(true);
		expect(store.outlineOf!(f)).toBeNull();
	});

	it('the outline of a file leaves with its last copy', async () => {
		const files = [file('a.png'), file('b.png')];
		const { io } = fakeIO({ copyBytes: Math.ceil(STORE_BYTES * 0.6) });
		const store = createPictureStore(app(files) as never, io);
		((await store.acquire(files[0]!, ARMS)) as PictureCopy).release();
		expect(store.outlineOf!(files[0]!)).not.toBeNull();
		// The second copy pushes the list over its limit: the first copy is freed, and its outline with it.
		const held = (await store.acquire(files[1]!, ARMS)) as PictureCopy;
		expect(store.peek(files[0]!, ARMS)).toBeNull();
		expect(store.outlineOf!(files[0]!)).toBeNull();
		expect(store.outlineOf!(files[1]!)).not.toBeNull();
		held.release();
	});
});
