import { describe, expect, it } from 'vitest';

import type { TFile as VaultFile } from 'obsidian';
import type { CopyBox, PictureCopy, PictureIO } from '../../src/obsidian/picture-store';
import { createPictureStore } from '../../src/obsidian/picture-store';
import { TFile } from '../acceptance/fake-obsidian';
import { pngHead } from '../acceptance/m9-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Speed study 0.5.1 (phone list: shield first, portrait 0.4 s later, both late). Not a fix: it shows, with a fake browser seam whose
 * every job costs JOB_MS, WHEN each picture of the phone list arrives. `renderList` asks the hero arms first and the portrait second
 * (tree-view-list.ts listPictures); on a touch-first device the store runs ONE job at a time (picture-store.ts pump), so the portrait
 * starts only when the arms job has ended. And a full re-render of the list (the calendar names arrive: datesChanged -> render ->
 * teardown -> releaseList aborts the signal) does not restart a job that runs: the new request joins it.
 */
useFakeDom({ window: true });

const JOB_MS = 80;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function file(path: string, size = 1000): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new TFile(path, name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size } }) as unknown as VaultFile;
}

/** Every file costs JOB_MS in `read` (the vault read on a phone) and the job log records when a job starts. */
function fakeIO(coarse: boolean) {
	const log: { path: string; at: number }[] = [];
	const reads = new Map<string, number>();
	const t0 = performance.now();
	const bytes = pngHead(400, 600);
	const io: PictureIO = {
		async read(f) {
			log.push({ path: f.path, at: performance.now() - t0 });
			reads.set(f.path, (reads.get(f.path) ?? 0) + 1);
			await sleep(JOB_MS);
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		},
		async decode() {
			return { width: 400, height: 600, source: {} as CanvasImageSource, close() {} };
		},
		async encode() {
			return new Blob([new Uint8Array(7000)], { type: 'image/png' });
		},
		async rgba(_s, w, h) {
			return new Uint8ClampedArray(w * h * 4);
		},
		coarse: () => coarse,
		dpr: () => 3,
	};
	return { io, log, reads, since: () => performance.now() - t0 };
}

const ARMS: CopyBox = { w: 96, h: 120, fit: 'meet' };
const PORTRAIT: CopyBox = { w: 128, h: 128, fit: 'portrait' };
const face = file('Arms and Portraits/portrait-eleanor.png');
const appOf = () => ({
	metadataCache: { getFirstLinkpathDest: () => null },
	vault: { getAbstractFileByPath: () => null },
	fileManager: {},
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
});
// The arms file is an SVG in the real vault; the fake seam gives PNG bytes for both, so only the queue order and the timing are tested.
const armsPng = file('Arms and Portraits/coa-avenoy.png');

describe('speed study 0.5.1: the arrival times of the arms and the portrait in the phone list', () => {
	it('touch-first device: the portrait is asked at once but arrives one job after the arms (2 x JOB_MS)', async () => {
		const { io, since } = fakeIO(true);
		const store = createPictureStore(appOf() as never, io);
		// The order of tree-view-list.ts listPictures: hero arms first, then the portrait, in the same turn.
		const t = { arms: 0, portrait: 0 };
		const a = store.acquire(armsPng, ARMS).then((c) => ((t.arms = since()), c));
		const p = store.acquire(face, PORTRAIT).then((c) => ((t.portrait = since()), c));
		const [ca, cp] = await Promise.all([a, p]);
		expect('url' in (ca as object) && 'url' in (cp as object)).toBe(true);
		expect(t.arms).toBeGreaterThanOrEqual(JOB_MS * 0.9);
		// The portrait waited for the arms job: it arrives about two jobs after the request.
		expect(t.portrait).toBeGreaterThanOrEqual(JOB_MS * 2 * 0.9);
		expect(t.portrait - t.arms).toBeGreaterThanOrEqual(JOB_MS * 0.8);
	});

	it('same requests on a device with 2 jobs at a time: both arrive after one job', async () => {
		const { io, since } = fakeIO(false);
		const store = createPictureStore(appOf() as never, io);
		const t = { arms: 0, portrait: 0 };
		await Promise.all([store.acquire(armsPng, ARMS).then(() => (t.arms = since())), store.acquire(face, PORTRAIT).then(() => (t.portrait = since()))]);
		expect(t.portrait).toBeLessThan(JOB_MS * 1.6);
	});

	it('a full re-render in the middle (abort the signal, ask again) joins the running job: no second read, no later arrival', async () => {
		const { io, reads, since } = fakeIO(true);
		const store = createPictureStore(appOf() as never, io);
		const first = new AbortController();
		const a = store.acquire(armsPng, ARMS, first.signal);
		const p1 = store.acquire(face, PORTRAIT, first.signal);
		await sleep(JOB_MS * 1.3); // the arms job has ended, the portrait job is running (render of the calendar names comes now)
		first.abort();
		const second = new AbortController();
		const copies: PictureCopy[] = [];
		const t = { portrait: 0 };
		const a2 = store.acquire(armsPng, ARMS, second.signal);
		const p2 = store.acquire(face, PORTRAIT, second.signal).then((c) => ((t.portrait = since()), c));
		for (const c of await Promise.all([a, p1, a2, p2])) if (c && 'url' in c) copies.push(c);
		// The first waiter of the portrait was aborted (null), the second got the copy of the SAME job.
		expect(await p1).toBeNull();
		expect(reads.get(face.path)).toBe(1);
		expect(reads.get(armsPng.path)).toBe(1);
		expect(t.portrait).toBeLessThan(JOB_MS * 2 + JOB_MS * 0.9);
	});
});
