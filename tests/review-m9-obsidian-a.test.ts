import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { applyOp } from '../src/core/yaml-edit';
import type { Op } from '../src/core/edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { STORE_BYTES, createPictureStore, type CopyBox, type PictureCopy, type PictureIO, type PictureStore } from '../src/obsidian/picture-store';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';
import { FEl, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fixtureSource } from './acceptance/load';
import { pngHead } from './acceptance/m9-support';
import { embed, fakeHandle, fakeHost, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * Code review of M9, part 3 (the Obsidian side, WP 9.3a and 9.3b). Each test proves one finding;
 * each fails on m9/int 9688dce.
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
async function drain(): Promise<void> {
	for (let k = 0; k < 20; k++) {
		flushFrames();
		runTimers(16);
		await tick();
	}
}

// ---------- 1. The edit sheet rebuilds its portrait buttons when the copy arrives (known item 2) ----------

describe('review M9 obsidian: the sheet portrait', () => {
	const BODY = ['people:', '  - id: aldric', '    name: Aldric Valmont', '    portrait: "[[aldric.jpg]]"', ''].join('\n');

	it('the Select portrait button that has the keyboard focus stays in the sheet (and keeps the focus) when the portrait copy arrives', async () => {
		const files = [file('Pictures/aldric.jpg')];
		const app = {
			metadataCache: { getFirstLinkpathDest: (p: string) => files.find((f) => f.path.endsWith(p)) ?? null },
			vault: { getAbstractFileByPath: () => null, getFiles: () => files },
			fileManager: { generateMarkdownLink: (f: VaultFile) => `[[${f.name}]]` },
		};
		let arrive!: (c: PictureCopy) => void;
		const store = {
			...createPictureStore(app as never, {} as PictureIO),
			transient: () => new Promise<PictureCopy>((r) => (arrive = r)),
		} as PictureStore;
		const h = fakeHandle('Tree.md', BODY) as FakeHandle;
		h.write.mockImplementation((async (op: Op) => {
			const r = applyOp(h.body, op);
			return r.ok ? { ok: true, body: r.body, created: r.created, effects: [] } : { ok: false, code: 'refused', refusal: r };
		}) as never);
		const sheet = EditSheet.create(app as never, { handle: h as never, personId: 'aldric', sourcePath: 'Tree.md', pictures: store })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		const select = content.querySelector('.dynasty-select-portrait')!;
		select.focus();
		expect(fakeDoc.activeElement).toBe(select);
		// The copy arrives while the user is on the button (a keyboard user, or a press under way).
		arrive({ url: 'blob:aldric', w: 96, h: 96, release() {} });
		await settle();
		expect(content.querySelector('.dynasty-sheet-portrait-img')?.getAttribute('src')).toBe('blob:aldric');
		// The button the user is on must be the same element, still in the sheet, with the focus.
		expect(content.contains(select)).toBe(true);
		expect(content.contains(fakeDoc.activeElement)).toBe(true);
	});
});

// ---------- 2. A larger viewport with no view change never loads the pictures of the new area ----------

/** A store whose copies come a moment after the request; every link resolves to a file. */
function simpleStore() {
	let n = 0;
	const log = { acquire: [] as string[] };
	const key = (f: VaultFile, b: CopyBox) => `${f.path}@${b.w}x${b.h}:${b.fit}`;
	const store = {
		resolve: (link: string) => ({ ok: true, file: file(link.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, '')), format: 'png' }),
		check: async () => null,
		acquire: async (f: VaultFile, b: CopyBox, signal?: AbortSignal) => {
			log.acquire.push(key(f, b));
			await tick();
			if (signal?.aborted) return null;
			return { url: `blob:${key(f, b)}#${n++}`, w: 1, h: 1, release() {} };
		},
		transient: async () => null,
		peek: () => null,
		pixels: async () => null,
		exportCopy: async () => 'data:image/png;base64,',
		invalidate() {},
		changed() {},
		onChange: () => () => {},
		clear() {},
		stats: { bytes: 0, entries: 0, inUse: 0, openBitmaps: 0, maxOpenBitmaps: 0 },
	};
	return { store: store as unknown as PictureStore, log };
}

describe('review M9 obsidian: live pictures after a resize', () => {
	it('when the note preview grows (same centre and zoom), the portraits of the cards that now show get their pictures', async () => {
		const src = fixtureSource('07b');
		const host = fakeHost() as ReturnType<typeof fakeHost> & { pictures?: PictureStore; settings?: typeof DEFAULT_SETTINGS };
		const { store, log } = simpleStore();
		host.pictures = store;
		host.settings = { ...DEFAULT_SETTINGS };
		const { el, vp } = await embed(src, { host: host as never, handle: fakeHandle('n.md', src) });
		await drain();
		const before = log.acquire.length;
		expect(before).toBeGreaterThan(0);
		// The owner drags the preview's resize handle, or widens the pane: 4 × the width and height.
		vp.clientWidth = 1440;
		vp.clientHeight = 1600;
		resizeAll();
		await drain();
		const t = el.querySelector('.dynasty-scene')!.getAttribute('transform')!;
		const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t)!;
		const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
		// Cards whole in the new viewport whose portrait has no picture.
		const empty: string[] = [];
		for (const card of el.querySelectorAll('.dynasty-card')) {
			const portrait = card.querySelector('.dynasty-portrait');
			if (!portrait) continue;
			const bg = card.querySelector('.dynasty-card-bg')!;
			const x = tx + Number(bg.getAttribute('x')) * s;
			const y = ty + Number(bg.getAttribute('y')) * s;
			const r = x + Number(bg.getAttribute('width')) * s;
			const b = y + Number(bg.getAttribute('height')) * s;
			if (x >= 0 && y >= 0 && r <= vp.clientWidth && b <= vp.clientHeight && !portrait.querySelector('image')) empty.push(card.getAttribute('data-person')!);
		}
		expect({ newRequests: log.acquire.length - before, visibleWithoutPicture: empty }).toEqual({ newRequests: expect.any(Number), visibleWithoutPicture: [] });
	});
});

// ---------- 4. The Houses window takes "the file changed" (null) for "cannot show" and never asks again ----------

describe('review M9 obsidian: the Houses window after a file change', () => {
	it('when the arms file changes during its copy (acquire gives null), the box shows the arms after the change, not the dashed "no arms" box', async () => {
		const { HousesWindow } = await import('../src/obsidian/houses-window');
		const files = [file('Pictures/valmont-arms.png')];
		const app = {
			metadataCache: { getFirstLinkpathDest: (p: string) => files.find((f) => f.path.endsWith(p)) ?? null },
			vault: { getAbstractFileByPath: () => null, getFiles: () => files },
			fileManager: { generateMarkdownLink: (f: VaultFile) => `[[${f.name}]]` },
		};
		let calls = 0;
		const base = createPictureStore(app as never, {} as PictureIO);
		const listeners = new Set<(p: readonly string[]) => void>();
		const store = {
			...base,
			// The first copy is dropped because the file changed (B11: null); a new request gets the copy.
			acquire: async () => (calls++ === 0 ? null : { url: 'blob:valmont', w: 40, h: 40, release() {} }),
			onChange: (fn: (p: readonly string[]) => void) => (listeners.add(fn), () => listeners.delete(fn)),
			changed: (p: readonly string[]) => listeners.forEach((fn) => fn(p)),
		} as PictureStore;
		const body = ['houses:', '  - id: valmont', '    name: House Valmont', '    arms: "[[valmont-arms.png]]"', 'people:', '  - id: a', '    name: A', '    house: valmont', ''].join('\n');
		const win = HousesWindow.create(app as never, { handle: fakeHandle('Tree.md', body) as never, sourcePath: 'Tree.md', pictures: store })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await settle();
		// main.ts tells the store after its 250 ms wait.
		store.changed(['Pictures/valmont-arms.png']);
		await settle();
		const box = content.querySelector('button.dynasty-lw-row[data-house="valmont"] .dynasty-lw-armsbox')!;
		expect({ dashed: box.hasClass('is-empty'), src: box.querySelector('img')?.getAttribute('src') ?? null }).toEqual({ dashed: false, src: 'blob:valmont' });
	});
});

// ---------- 3. A new copy can be evicted (its URL revoked) before its caller holds it ----------

describe('review M9 obsidian: the store limit', () => {
	it('a copy that a caller asked for is never revoked before the caller gets it, also when the copies in use fill the store', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const a = file('a.png');
		const b = file('b.png');
		const bytes = new Map([
			['a.png', pngHead(400, 600)],
			['b.png', pngHead(400, 600)],
		]);
		const io: PictureIO = {
			read: async (f) => {
				const x = bytes.get(f.path)!;
				return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer;
			},
			decode: async () => ({ width: 400, height: 600, source: {} as CanvasImageSource, close() {} }),
			// Each copy is a bit more than half the store limit, as many large copies in use would be.
			encode: async () => new Blob([new Uint8Array(Math.ceil(STORE_BYTES / 2) + 1000)], { type: 'image/png' }),
			rgba: async (_s, w, h) => new Uint8ClampedArray(w * h * 4),
			coarse: () => false,
			dpr: () => 1,
		};
		const store = createPictureStore({ metadataCache: { getFirstLinkpathDest: () => null } } as never, io);
		const box: CopyBox = { w: 24, h: 24, fit: 'portrait' };
		const held = (await store.acquire(a, box)) as PictureCopy;
		expect(held.url).toMatch(/^blob:/);
		const next = (await store.acquire(b, box)) as PictureCopy;
		expect(next.url).toMatch(/^blob:/);
		// The caller now shows `next.url`: it must still be a live blob URL.
		expect(revoke).not.toHaveBeenCalledWith(next.url);
	});
});
