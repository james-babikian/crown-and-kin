import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import { makePicture, type SaveSource } from '../../src/obsidian/save-picture';
import type { PictureStore } from '../../src/obsidian/picture-store';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg } from '../../src/render/svg-string';
import { resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { block15 } from './m10-support';
import { fixtureNote, topLevelBlocks } from './load';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The M10 G5 spec review named these as not covered (the decision notes, "M10 G5 spec review"): the saved
 * picture (spec §13.8) with names of three text lines (§13.9) and with a selected part of a portrait
 * (§13.13), for the SVG and the PNG path, and the headless SVG of sample tree 14, block 3 (§13.13
 * acceptance). The PNG path runs on fakes for the canvas: the test proves that the same SVG text goes to
 * the canvas and that its bytes are the file. A real canvas is a harness matter.
 */

useFakeDom({ window: true, css: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
const file = (path: string): VaultFile => {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1)), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
};

/** A store that records each export (file, size, fit and part) and gives a data URI. */
function fakeStore() {
	const exports: { path: string; w: number; h: number; fit: string; crop?: { left: number; top: number; side: number } }[] = [];
	const store = {
		resolve: (link: string) => ({ ok: true, file: file(link.replace(/^!?\[\[|\]\]$/g, '')), format: 'jpeg' }),
		exportCopy: async (f: VaultFile, b: { w: number; h: number; fit: string; crop?: { left: number; top: number; side: number } }) => {
			exports.push({ path: f.path, w: b.w, h: b.h, fit: b.fit, ...(b.crop ? { crop: b.crop } : {}) });
			return `data:image/png;base64,${btoa(`${f.path}:${b.crop ? `${b.crop.left},${b.crop.top},${b.crop.side}` : 'auto'}`)}`;
		},
		alone: async <T>(fn: () => Promise<T>) => fn(),
	};
	return { store: store as unknown as PictureStore, exports };
}

const sourceOf = (body: string, more: Partial<SaveSource> = {}): SaveSource => {
	const parsed = parseDynasty(body);
	if (!parsed.ok) throw new Error('does not parse');
	return {
		g: deriveFamilies(parsed.tree),
		orientation: 'down',
		geo: cardForm(geometryFor(16), 'down'),
		relationLine: false,
		fonts: { text: 'serif', ui: 'sans-serif', bold: '600' },
		showDates: true,
		showPortraits: false,
		sourcePath: 'Trees/Long.md',
		note: 'Long',
		...more,
	};
};

/** The card groups of a saved SVG: person id -> its text between its `data-item="card:ID"` and the next item of the card kind. */
function cards(svg: string): Map<string, { height: number; names: string[] }> {
	const out = new Map<string, { height: number; names: string[] }>();
	const parts = svg.split(/<g data-item="card:/).slice(1);
	for (const part of parts) {
		const id = /^([^"]+)"/.exec(part)![1];
		const body = part.slice(0, part.indexOf('</g>'));
		const rect = /<rect [^>]*height="([\d.]+)"/.exec(body);
		const names = [...body.matchAll(/<text [^>]*font-weight="[^"]*"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
		out.set(id, { height: Number(rect![1]), names });
	}
	return out;
}

// ---------- Three-line names (spec §13.9, sample tree 15, block 2) ----------

describe('the saved picture with names of three text lines (spec §13.8, §13.9)', () => {
	const LONG = block15(1);
	const fullName = (id: string) => /- id: ([^\n]+)\n\s+name: ([^\n]+)/g[Symbol.matchAll](LONG) && [...LONG.matchAll(/- id: ([^\n]+)\n\s+name: ([^\n]+)/g)].find((m) => m[1] === id)![2];

	const check = (svg: string) => {
		const c = cards(svg);
		expect(c.size).toBe(7);
		// No card has more than three name text lines; a name that fits in one has one.
		for (const [id, card] of c) expect(card.names.length, id).toBeLessThanOrEqual(3);
		expect(c.get('short')!.names).toEqual(['Aldric Valmont']);
		// The name that needs more than three: exactly three, and the third ends with "…" (D81, D82).
		const over = c.get('over-three')!.names;
		expect(over).toHaveLength(3);
		expect(over[2].endsWith('…')).toBe(true);
		expect(over[0].startsWith('Maximilian')).toBe(true);
		// Each text line but the last ends at a space of the name: the lines are the start of the full name.
		const start = over.slice(0, 2).join(' ');
		expect(fullName('over-three').startsWith(start)).toBe(true);
		// The card of a name of three text lines is taller than the card of a name of two, which is taller than one of one (D81).
		const h = (id: string) => c.get(id)!.height;
		expect(c.get('three-normal')!.names.length).toBeGreaterThanOrEqual(2);
		expect(h('over-three')).toBeGreaterThan(h('short'));
		expect(h('over-three')).toBeGreaterThanOrEqual(h('two-lines'));
		return c;
	};

	it('SVG: the cards have up to three name text lines, and "…" ends a name that needs more', async () => {
		const made = await makePicture(undefined, sourceOf(LONG), 'svg');
		check(new TextDecoder().decode(made.bytes));
	});

	describe('PNG, on fakes for the canvas', () => {
		let blobs: Blob[];
		let drawn: { w: number; h: number }[];
		beforeEach(() => {
			blobs = [];
			drawn = [];
			const g = globalThis as Record<string, unknown>;
			const realCreateEl = g.createEl as (tag: string, o?: unknown) => unknown;
			g.createEl = (tag: string, o?: unknown) => {
				if (tag !== 'canvas') return realCreateEl(tag, o);
				const canvas = {
					width: 0,
					height: 0,
					getContext: () => ({
						drawImage: () => drawn.push({ w: canvas.width, h: canvas.height }),
						measureText: (t: string) => ({ width: t.length * 9 }),
						font: '',
					}),
					toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })),
				};
				return canvas;
			};
			g.Image = class {
				onload: () => void = () => {};
				onerror: () => void = () => {};
				set src(_v: string) {
					queueMicrotask(() => this.onload());
				}
			};
			(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
				blobs.push(b);
				return `blob:fake#${blobs.length}`;
			};
			(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
		});

		it('draws the same SVG text that the SVG file has, and the bytes of the file are the canvas PNG', async () => {
			const svgFile = await makePicture(undefined, sourceOf(LONG), 'svg');
			const png = await makePicture(undefined, sourceOf(LONG), 'png');
			expect(png.type).toBe('image/png');
			expect(png.name).toBe('Long tree.png');
			expect([...new Uint8Array(png.bytes)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
			expect(blobs).toHaveLength(1);
			const drawnSvg = await blobs[0].text();
			// The PNG path draws the SVG of the picture: three-line names are in it.
			check(drawnSvg);
			// The same names as in the SVG file (the scale differs, so the sizes do; the text lines do not).
			const a = cards(new TextDecoder().decode(svgFile.bytes));
			const b = cards(drawnSvg);
			for (const [id, card] of a) expect(b.get(id)!.names, id).toEqual(card.names);
			expect(drawn).toHaveLength(1);
			expect(drawn[0].w).toBeGreaterThan(0);
		});
	});
});

// ---------- A selected part of a portrait (spec §13.13, sample tree 14, block 3) ----------

describe('the saved picture with a selected part of a portrait (spec §13.8, §13.13)', () => {
	const B3 = topLevelBlocks(fixtureNote('14'))[2];

	it('SVG: the export of the tall portrait gets the part that is written (Roderick: 0.1 0.4 0.5); a bad part and a portrait with no part get none', async () => {
		const { store, exports } = fakeStore();
		const made = await makePicture(store, sourceOf(B3, { showPortraits: true, sourcePath: 'Trees/Valmont.md' }), 'svg');
		// Roderick, Odette and Piers use the tall photo, each with a part; Bertrand and Hilda have bad parts and other files.
		const tall = exports.filter((e) => e.path === 'roderick-tall.jpg');
		const cropped = exports.filter((e) => e.crop);
		expect(cropped).toHaveLength(3);
		expect(tall.every((e) => e.crop)).toBe(true);
		expect(cropped.filter((e) => e.crop!.left === 0.1 && e.crop!.top === 0.4 && e.crop!.side === 0.5)).toHaveLength(1);
		const svg = new TextDecoder().decode(made.bytes);
		// The picture of Roderick is the one that was made with his part.
		const uri = `data:image/png;base64,${btoa('roderick-tall.jpg:0.1,0.4,0.5')}`;
		expect(svg.match(new RegExp(uri.replace(/[+/=]/g, (c) => `\\${c}`), 'g'))).toHaveLength(1);
		expect(new RegExp(`<image href="${uri.replace(/[+/=]/g, (c) => `\\${c}`)}"[^>]*data-item="portrait:roderick"`).test(svg)).toBe(true);
	});

	it('the picture of a portrait with a part is a different copy from the automatic one (the part is in what the store is asked)', async () => {
		const { store, exports } = fakeStore();
		await makePicture(store, sourceOf(B3, { showPortraits: true }), 'svg');
		const size = exports.find((e) => e.crop)!;
		const plain = exports.find((e) => !e.crop)!;
		expect(size.w).toBe(plain.w);
		expect(size.h).toBe(plain.h);
	});
});

// ---------- The headless SVG of sample tree 14, block 3 ----------

describe('spec §13.13 acceptance: the headless SVG shows the selected part (a data-URI path that needs no JPEG decoder of ours)', () => {
	const B3 = topLevelBlocks(fixtureNote('14'))[2];

	/** Resvg decodes the JPEG; the square (40, 240, 200) of Roderick's part is written by hand from the fixture comment. */
	const SQUARE = { sx: 40, sy: 240, size: 200 };
	const AUTOMATIC = { sx: 0, sy: 0, size: 400 };
	const jpeg = readFileSync('fixtures/pictures/roderick-tall.jpg');
	const uriOf = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

	const cut = (sq: { sx: number; sy: number; size: number }) => {
		const inner = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="${sq.sx} ${sq.sy} ${sq.size} ${sq.size}"><image href="${uriOf}" x="0" y="0" width="400" height="600"/></svg>`;
		const r = new Resvg(inner, { fitTo: { mode: 'width', value: 96 } }).render();
		return { png: Buffer.from(r.asPng()), pixels: r.pixels, width: r.width, height: r.height };
	};
	const mean = (px: Uint8Array | Buffer) => {
		const m = [0, 0, 0];
		const n = px.length / 4;
		for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) m[c] += px[i + c] / n;
		return m;
	};
	const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

	/** The whole picture, at 400 × 600, so the mean of any region can be read. */
	const whole = (() => {
		const r = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><image href="${uriOf}" x="0" y="0" width="400" height="600"/></svg>`).render();
		return { px: r.pixels, w: r.width, h: r.height };
	})();
	const regionMean = (sq: { sx: number; sy: number; size: number }) => {
		const out = [0, 0, 0];
		let n = 0;
		for (let y = sq.sy; y < sq.sy + sq.size; y++)
			for (let x = sq.sx; x < sq.sx + sq.size; x++) {
				const i = (y * whole.w + x) * 4;
				for (let c = 0; c < 3; c++) out[c] += whole.px[i + c];
				n++;
			}
		return out.map((v) => v / n);
	};

	it('the fixture comment gives the square (40, 240, 200) for Roderick; the cut shows that part of the picture, not the automatic one', () => {
		expect(whole.w).toBe(400);
		expect(whole.h).toBe(600);
		const crop = cut(SQUARE);
		const auto = cut(AUTOMATIC);
		expect(crop.width).toBe(96);
		expect(crop.height).toBe(96);
		// The pictures are different, and the cut is closer in colour to the part than to the automatic square.
		expect(crop.png.equals(auto.png)).toBe(false);
		const part = regionMean(SQUARE);
		const top = regionMean(AUTOMATIC);
		expect(dist(part, top)).toBeGreaterThan(4);
		expect(dist(mean(crop.pixels), part)).toBeLessThan(dist(mean(crop.pixels), top));
		expect(dist(mean(auto.pixels), top)).toBeLessThan(dist(mean(auto.pixels), part));
	});

	it('renderSvg puts the cut picture into the card of Roderick and the automatic one into the card of Bertrand', () => {
		const parsed = parseDynasty(B3);
		if (!parsed.ok) throw new Error('does not parse');
		const g = deriveFamilies(parsed.tree);
		const crop = cut(SQUARE);
		const auto = cut(AUTOMATIC);
		const uri = (c: { png: Buffer }) => `data:image/png;base64,${c.png.toString('base64')}`;
		const pictures = new Map<string, string | 'missing' | null>();
		for (const p of g.people) if (p.portrait) pictures.set(`portrait:${p.id}`, p.id === 'roderick' ? uri(crop) : uri(auto));
		const sets = pictureSets(g, true);
		clearLayoutCache();
		const laid = layoutTree(g, cardForm(geometryFor(16), 'down'), { ...DEFAULT_LAYOUT_SETTINGS, ...(sets.portraits.length ? { portraits: sets.portraits } : {}) }, 'spike');
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, pictures });
		const at = (u: string) => {
			const out: { x: number; y: number }[] = [];
			const needle = `<image href="${u}" x="`;
			for (let i = svg.indexOf(needle); i >= 0; i = svg.indexOf(needle, i + 1)) {
				const m = /^x="([\d.]+)" y="([\d.]+)"/.exec(svg.slice(i + needle.length - 3));
				out.push({ x: Number(m![1]), y: Number(m![2]) });
			}
			return out;
		};
		// The cut picture is drawn once, on the card of Roderick; the automatic picture on the other cards that have a portrait.
		const mine = at(uri(crop));
		expect(mine).toHaveLength(1);
		const box = laid.layout.persons.get('roderick')!;
		expect(mine[0].x).toBeGreaterThanOrEqual(box.x);
		expect(mine[0].x).toBeLessThan(box.x + box.w);
		// The Roundel's medallion stands on the top edge of the card, so it starts above the card (in the crown).
		expect(mine[0].y).toBeGreaterThanOrEqual(box.y - laid.layout.geometry.reach!);
		expect(mine[0].y).toBeLessThan(box.y + box.h);
		const others = g.people.filter((p) => p.portrait && p.id !== 'roderick').length;
		expect(at(uri(auto))).toHaveLength(others);
		expect(others).toBeGreaterThan(0);
	});
});
