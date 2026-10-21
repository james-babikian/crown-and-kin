import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import type { PictureProblem } from '../src/core/pictures';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { createLivePictures, zoomStep } from '../src/obsidian/live-pictures';
import type { CopyBox, PictureCopy, PictureStore } from '../src/obsidian/picture-store';
import { makePicture, savePicture, type SaveSource } from '../src/obsidian/save-picture';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import type { PictureSlot } from '../src/render/dom/pictures';
import { SAVE_UI } from '../src/render/ui-text';
import { FEl, fakeWin, flushFrames, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { notices, resetObsidian } from './acceptance/fake-obsidian';
import { fixtureSource } from './acceptance/load';
import { embed, fakeHandle, fakeHost, fillAllCards } from './acceptance/tree-view-fakes';

/*
 * WP 9.3b (M9 contract O2, O5, O10, O11, P1–P6, B1, B10, B15): the live pictures of a scene beyond
 * the ≤ 150 acceptance check (the copies the store has in the first frame, the zoom step, the new copy
 * before the old one goes, problems), the tree view's pictures (not before the first view is ready,
 * the picture warnings on the badge, the file check, "Show portraits on cards"), and Save as picture
 * (one export at a time, the picture map, one write, the Notices, no write on a failure).
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

function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1)), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function drain(): Promise<void> {
	for (let k = 0; k < 20; k++) {
		flushFrames();
		runTimers(16);
		await tick();
	}
}

/** A fake store: copies named by key and number, a record of every call. */
function fakeStore(o: { problems?: Map<string, PictureProblem>; kept?: Set<string>; resolve?: (link: string) => ReturnType<PictureStore['resolve']> } = {}) {
	let n = 0;
	const log = { acquire: [] as string[], peek: [] as string[], released: [] as string[], checks: [] as string[], exports: [] as string[], running: 0, maxRunning: 0 };
	const listeners = new Set<(p: readonly string[]) => void>();
	const key = (f: VaultFile, b: CopyBox) => `${f.path}@${b.w}x${b.h}:${b.fit}`;
	const copy = (k: string): PictureCopy => {
		const url = `blob:${k}#${n++}`;
		let done = false;
		return {
			url,
			w: 1,
			h: 1,
			release() {
				if (done) return;
				done = true;
				log.released.push(url);
			},
		};
	};
	const store = {
		resolve: (link: string) => (o.resolve ? o.resolve(link) : { ok: true, file: file(link.replace(/^!?\[\[|\]\]$/g, '')), format: 'png' }),
		check: async (f: VaultFile) => {
			log.checks.push(f.path);
			return o.problems?.get(f.path) ?? null;
		},
		acquire: async (f: VaultFile, b: CopyBox, signal?: AbortSignal) => {
			log.acquire.push(key(f, b));
			await tick();
			if (signal?.aborted) return null;
			return o.problems?.get(f.path) ?? copy(key(f, b));
		},
		transient: async () => null,
		peek: (f: VaultFile, b: CopyBox) => {
			log.peek.push(key(f, b));
			return o.kept?.has(f.path) ? { url: `blob:kept:${f.path}`, w: 1, h: 1, release() {} } : null;
		},
		pixels: async () => null,
		exportCopy: async (f: VaultFile, b: { w: number; h: number; fit: string }) => {
			log.running++;
			log.maxRunning = Math.max(log.maxRunning, log.running);
			log.exports.push(`${f.path}@${b.w}x${b.h}:${b.fit}`);
			await tick();
			log.running--;
			return o.problems?.get(f.path) ?? `data:image/png;base64,${btoa(f.path)}`;
		},
		invalidate() {},
		changed(paths: readonly string[]) {
			for (const fn of [...listeners]) fn(paths);
		},
		onChange(fn: (p: readonly string[]) => void) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		clear() {},
		stats: { bytes: 0, entries: 0, inUse: 0, openBitmaps: 0, maxOpenBitmaps: 0 },
	};
	return { store: store as unknown as PictureStore, log };
}

function slots(n: number, kind: PictureSlot['kind'] = 'portrait'): PictureSlot[] {
	const group = new FEl('g');
	return Array.from({ length: n }, (_, i) => {
		const el = group.createSvg('g') as unknown as SVGGElement;
		const frame = kind === 'portrait' ? ((el as unknown as FEl).createSvg('circle', { cls: 'dynasty-portrait-frame' }) as unknown as SVGCircleElement) : undefined;
		return { kind, lod: 'full', person: `p${i}`, rect: { x: i * 30, y: 0, w: 24, h: 24 }, el, ...(frame ? { frame } : {}) };
	});
}

const images = (s: PictureSlot) => (s.el as unknown as FEl).all().filter((e) => e.tag === 'image');
const hrefOf = (s: PictureSlot) => images(s)[0]?.getAttribute('href') ?? null;
const VIEW = { x: 0, y: 0, w: 300, h: 100 };

describe('live pictures (O5, B10, B15)', () => {
	it('zoom steps 1, 2 and 4 (B10)', () => {
		expect([0.3, 1, 1.2, 2, 2.01, 3, 9].map(zoomStep)).toEqual([1, 1, 2, 2, 4, 4, 4]);
	});

	it('prime shows only the copies the store has now, with no request; update then holds them', async () => {
		const s = slots(3);
		const { store, log } = fakeStore({ kept: new Set(['p1.png']) });
		const live = createLivePictures(s, store, (x) => file(`${x.person}.png`));
		live.prime(VIEW, 'full');
		expect(log.acquire).toEqual([]);
		expect(s.map(hrefOf)).toEqual([null, 'blob:kept:p1.png', null]);
		live.update(VIEW, 'full');
		expect(live.pending).toBe(3);
		await drain();
		expect(s.every((x) => hrefOf(x)?.startsWith('blob:'))).toBe(true);
		expect(live.images).toBe(3);
		live.destroy();
		expect(s.map(hrefOf)).toEqual([null, null, null]);
		expect(log.released).toHaveLength(3);
	});

	it('a new zoom step fetches the new copy before it releases the old one (B10)', async () => {
		const s = slots(1);
		const { store, log } = fakeStore();
		const live = createLivePictures(s, store, (x) => file(`${x.person}.png`));
		live.update(VIEW, 'full', 1);
		await drain();
		const first = hrefOf(s[0]);
		live.update(VIEW, 'full', 4);
		expect(hrefOf(s[0])).toBe(first);
		expect(log.released).toEqual([]);
		await drain();
		expect(hrefOf(s[0])).not.toBe(first);
		expect(log.acquire[1]).toBe('p0.png@96x96:portrait');
		expect(log.released).toEqual([first]);
	});

	it('refresh asks for a new copy of a changed file and keeps the old one until it comes (B15)', async () => {
		const s = slots(2);
		const { store, log } = fakeStore();
		const live = createLivePictures(s, store, (x) => file(`${x.person}.png`));
		live.update(VIEW, 'full');
		await drain();
		const before = s.map(hrefOf);
		live.refresh(['p1.png']);
		expect(s.map(hrefOf)).toEqual(before);
		await drain();
		expect(hrefOf(s[0])).toBe(before[0]);
		expect(hrefOf(s[1])).not.toBe(before[1]);
		expect(log.released).toEqual([before[1]]);
	});

	it('a missing file gives the dashed frame at once; a failed decode and problem() give the solid empty frame (B1)', async () => {
		const s = slots(3);
		const bad: PictureProblem = { ok: false, code: 'picture-not-image', file: 'p1.png' };
		const { store } = fakeStore({ problems: new Map([['p1.png', bad]]) });
		const live = createLivePictures(s, store, (x) => (x.person === 'p0' ? { ok: false, code: 'missing-picture', file: 'p0.png' } : file(`${x.person}.png`)));
		const frame = (x: PictureSlot) => x.frame as unknown as FEl;
		expect(frame(s[0]).hasClass('is-missing')).toBe(true);
		live.update(VIEW, 'full');
		await drain();
		expect(s.map(hrefOf)).toEqual([null, null, expect.stringMatching(/^blob:/)]);
		expect(frame(s[1]).hasClass('is-missing')).toBe(false);
		live.problem('p2', 'portrait');
		expect(hrefOf(s[2])).toBeNull();
		expect(frame(s[2]).hasClass('is-missing')).toBe(false);
	});

	it('reports the pictures that wait (B15)', async () => {
		const seen: number[] = [];
		const { store } = fakeStore();
		const live = createLivePictures(slots(2), store, (x) => file(`${x.person}.png`), { onPending: (n) => seen.push(n) });
		live.update(VIEW, 'full');
		await drain();
		expect(seen[0]).toBe(2);
		expect(seen[seen.length - 1]).toBe(0);
	});
});

const F14 = fixtureSource('14');

describe('the tree view with pictures (O2, O5, O10)', () => {
	/** An embed of `source` with the fake store, and the store's log. */
	async function pictureEmbed(source: string, problems?: Map<string, PictureProblem>) {
		const host = fakeHost() as ReturnType<typeof fakeHost> & { pictures?: PictureStore; settings?: typeof DEFAULT_SETTINGS };
		// Links like the vault would resolve them: a web address, a file that is not there, else the file.
		const { store, log } = fakeStore({
			problems,
			resolve: (link) => {
				if (/^https?:/.test(link)) return { ok: false, code: 'picture-web' };
				const name = link.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, '').replace(/^\[[^\]]*\]\((.*)\)$/, '$1');
				if (/harrow-arms|oswin/.test(name)) return { ok: false, code: 'missing-picture', file: name };
				return { ok: true, file: file(name), format: 'png' };
			},
		});
		host.pictures = store;
		host.settings = { ...DEFAULT_SETTINGS };
		const e = await embed(source, { host: host as never, handle: fakeHandle('n.md', source) });
		return { ...e, host, log, store };
	}

	it('pictures load only after the first view is ready; then the file check runs and the root says so', async () => {
		const { el, log } = await pictureEmbed(F14);
		const root = el.querySelector('.dynasty-root')!;
		expect(log.acquire).toEqual([]);
		expect(root.getAttribute('data-dynasty-pictures')).toBeNull();
		await drain();
		expect(log.acquire.length).toBeGreaterThan(0);
		expect(log.acquire.length).toBeLessThanOrEqual(150);
		expect(root.getAttribute('data-dynasty-pictures')).toBe('checked');
		expect(root.getAttribute('data-dynasty-pictures-pending')).toBe('0');
		expect(root.querySelectorAll('image.dynasty-picture').length).toBeGreaterThan(0);
	});

	it('the badge counts the link problems at once and the file problems after the check (O2)', async () => {
		const bad = new Map<string, PictureProblem>([['huge-banner.png', { ok: false, code: 'picture-too-large', file: 'huge-banner.png', pixels: 54 }]]);
		const { el } = await pictureEmbed(F14, bad);
		const count = () => Number(el.querySelector('.dynasty-warning-count')?.getText() ?? 0);
		// Web: Drakemoor, Darian; missing: Harrow, Oswin.
		expect(count()).toBe(4);
		await drain();
		// The large picture is used by House Greymane and Adela.
		expect(count()).toBe(6);
		fillAllCards(el);
		const adela = el.querySelector('.dynasty-card[data-person="adela"] .dynasty-portrait')!;
		expect(adela.querySelector('image')).toBeNull();
		expect(el.querySelector('.dynasty-card[data-person="oswin"] .dynasty-portrait-frame')!.hasClass('is-missing')).toBe(true);
	});

	it('a changed picture file brings a new copy, with no new layout (O9)', async () => {
		const { el, host, store, log } = await pictureEmbed(F14);
		await drain();
		const renders = host.renders;
		const n = log.acquire.length;
		store.changed(['valmont-arms.png']);
		await drain();
		expect(host.renders).toBe(renders);
		expect(log.acquire.slice(n).every((k) => k.startsWith('valmont-arms.png'))).toBe(true);
		expect(log.acquire.length).toBeGreaterThan(n);
		expect(el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-pictures')).toBe('checked');
	});

	it('"Show portraits on cards" off lays the tree out again with no portrait places (O10)', async () => {
		const { el, view, host } = await pictureEmbed(F14);
		await drain();
		expect(el.querySelectorAll('.dynasty-portrait').length).toBeGreaterThan(0);
		const prev = host.settings!;
		host.settings = { ...prev, showPortraits: false };
		view.onSettingsChange(prev);
		await drain();
		expect(el.querySelectorAll('.dynasty-portrait').length).toBe(0);
		// The portrait warnings stay (O2).
		expect(Number(el.querySelector('.dynasty-warning-count')?.getText() ?? 0)).toBe(4);
	});
});

describe('Save as picture (O11, P1–P6)', () => {
	function source(): SaveSource {
		const parsed = parseDynasty(F14);
		if (!parsed.ok) throw new Error('fixture 14 does not parse');
		const g = deriveFamilies(parsed.tree);
		return {
			g,
			me: 'roderick',
			orientation: 'down',
			geo: cardForm(geometryFor(16), 'down'),
			relationLine: true,
			fonts: { text: 'serif', ui: 'sans-serif', bold: '600' },
			showDates: true,
			showPortraits: true,
			sourcePath: 'Trees/Valmont.md',
			note: 'Valmont',
		};
	}
	const store14 = () =>
		fakeStore({
			resolve: (link) => {
				if (/^https?:/.test(link)) return { ok: false, code: 'picture-web' };
				const name = link.replace(/^!?\[\[|\]\]$/g, '').replace(/\|.*$/, '').replace(/^\[[^\]]*\]\((.*)\)$/, '$1');
				if (/harrow-arms|oswin/.test(name)) return { ok: false, code: 'missing-picture', file: name };
				if (/heic|pdf|huge/.test(name)) return { ok: false, code: 'picture-not-image', file: name };
				return { ok: true, file: file(name), format: 'png' };
			},
		});

	it('SVG: one export at a time, data URIs for the pictures that show, the dashed frame of a missing file, the file name (P3, P4, P6)', async () => {
		const { store, log } = store14();
		const made = await makePicture(store, source(), 'svg');
		expect(made.name).toBe('Valmont tree.svg');
		expect(made.type).toBe('image/svg+xml');
		expect(log.maxRunning).toBe(1);
		// One arms copy per house (Valmont, Orsini, Castellane) and one per portrait that resolves.
		expect(log.exports.filter((x) => x.endsWith(':meet'))).toHaveLength(3);
		const svg = new TextDecoder().decode(made.bytes);
		expect(svg).toContain('data-item="heading"');
		expect(svg).not.toContain('blob:');
		expect(svg.match(/data-item="arms:/g)).toHaveLength(12);
		expect(/<circle[^>]*stroke-dasharray[^>]*data-item="frame:oswin"/.test(svg)).toBe(true);
		// P5: pictures at 4 × their CSS size in an SVG (the Roundel's medallion is 2.3 em = 36.8 px since D219) (14 px names at 16 px text: scale 0.875).
		const portrait = log.exports.find((x) => x.startsWith('aldric.jpg'))!;
		expect(portrait).toBe(`aldric.jpg@${Math.ceil(36.8 * 4 * 0.875)}x${Math.ceil(36.8 * 4 * 0.875)}:portrait`);
	});

	it('focus mode names the family in the file name (P6)', async () => {
		const { store } = store14();
		const made = await makePicture(store, { ...source(), focusName: 'Roderick Valmont' }, 'svg');
		expect(made.name).toBe('Valmont tree, family of Roderick Valmont.svg');
	});

	it('writes the file once at the free attachment path and says where; the tree text is not written', async () => {
		const { store } = store14();
		const created: string[] = [];
		const app = {
			fileManager: { getAvailablePathForAttachment: async (name: string, from: string) => `Attachments/${name}#${from}` },
			vault: {
				createBinary: vi.fn(async (path: string) => {
					created.push(path);
					return { name: 'Valmont tree.svg', path: 'Attachments/Valmont tree.svg' };
				}),
				modify: vi.fn(),
				process: vi.fn(),
			},
		};
		const f = await savePicture(app as never, store, source(), 'svg');
		expect(f).not.toBeNull();
		expect(created).toEqual(['Attachments/Valmont tree.svg#Trees/Valmont.md']);
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(notices).toContain(SAVE_UI.saved('Valmont tree.svg', 'Attachments'));
	});

	it('a failure shows the failure Notice and writes nothing', async () => {
		const { store } = store14();
		const app = {
			fileManager: {
				getAvailablePathForAttachment: async () => {
					throw new Error('no folder');
				},
			},
			vault: { createBinary: vi.fn() },
		};
		expect(await savePicture(app as never, store, source(), 'svg')).toBeNull();
		expect(app.vault.createBinary).not.toHaveBeenCalled();
		expect(notices).toContain(SAVE_UI.failed);
	});

	it('the progress Notice shows only when the save takes more than 1 s', async () => {
		const { store } = store14();
		let done!: () => void;
		const app = {
			fileManager: { getAvailablePathForAttachment: () => new Promise<string>((r) => (done = () => r('Valmont tree.svg'))) },
			vault: { createBinary: vi.fn(async () => ({ name: 'Valmont tree.svg', path: 'Valmont tree.svg' })) },
		};
		const p = savePicture(app as never, store, source(), 'svg');
		for (let k = 0; k < 50 && !done; k++) await settle();
		expect(notices).not.toContain(SAVE_UI.progress);
		runTimers(1000);
		expect(notices).toContain(SAVE_UI.progress);
		done();
		await p;
		expect(notices).toContain(SAVE_UI.saved('Valmont tree.svg', ''));
	});
});
