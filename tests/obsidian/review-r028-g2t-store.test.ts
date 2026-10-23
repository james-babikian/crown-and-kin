import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { createPictureStore, type CopyBox, type PictureCopy, type PictureIO } from '../../src/obsidian/picture-store';
import { resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { pngHead } from '../acceptance/m9-support';
import { useFakeDom } from '../support/fake-dom-setup';

/* G2 review probes for the outline cache of the picture store (D219). */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string, mtime = 1): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const f = new File(path, 'png');
	return Object.assign(f, { name, basename: name.slice(0, -4), stat: { mtime, ctime: 1, size: 1000 } }) as VaultFile;
}

function fakeIO(failFirstRgba = false) {
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
			return new Blob([new Uint8Array(500)], { type: 'image/png' });
		},
		async rgba(_s, w, h) {
			state.rgba++;
			if (failFirstRgba && state.rgba === 1) throw new Error('a canvas that is busy for a moment');
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

describe('outline cache probes', () => {
	it('a copy that the store still holds always has its outline (601 arms files, the first one again)', async () => {
		const files = Array.from({ length: 601 }, (_, i) => file(`h/${i}.png`));
		const { io } = fakeIO();
		const store = createPictureStore(app(files) as never, io);
		for (const f of files) ((await store.acquire(f, ARMS)) as PictureCopy).release();
		// The copy of the first file is a hit in the store ...
		const hit = store.peek(files[0]!, ARMS);
		expect(hit, 'the copy of the first file is still kept').not.toBeNull();
		// ... but a card that shows it draws no gap.
		expect(store.outlineOf!(files[0]!), 'its outline is still known').not.toBeNull();
	});

	it('a failed read of the outline is tried again the next time the file is copied', async () => {
		const f = file('v.png');
		const { io } = fakeIO(true);
		const store = createPictureStore(app([f]) as never, io);
		await store.acquire(f, ARMS);
		await store.acquire(f, { ...ARMS, w: 40, h: 48 });
		expect(store.outlineOf!(f)).not.toBeNull();
	});
});
