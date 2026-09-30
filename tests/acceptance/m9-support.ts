/*
 * Shared helpers for the M9 picture tests (spec §13.0 item 3, §13.6–§13.8, D67–D78): the new
 * modules, loaded so the test files still compile before WP 9.1 and WP 9.2 add them; typed views of
 * the M9 additions to existing types (the M9 contracts, now folded into their modules); a reader for the expected results that sample tree 14 keeps
 * in its comments; small byte builders for picture headers; and the 64 × 64 px copy of arms made
 * with resvg (contract amendment A5).
 */
import { Resvg } from '@resvg/resvg-js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import type { EditResult, Op } from '../../src/core/edit';
import type { CodedIssue } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import type { armsColours } from '../../src/core/arms-colours';
import type {
	fitMeet,
	judgeHeader,
	pictureFormat,
	pictureIssue,
	PictureOwner,
	PictureProblem,
	pictureTarget,
	portraitCrop,
	readPictureHeader,
} from '../../src/core/pictures';
import type { House, Person, Tree } from '../../src/core/types';
import { applyOp } from '../../src/core/yaml-edit';
import type { LayoutSettings, PersonBox } from '../../src/layout/model';
import type { smallTextWidth } from '../../src/layout/geometry';
import type { armsCards, pictureSets } from '../../src/layout/layout';
import type { savedFileName, savedLegend, savedScale } from '../../src/render/saved-picture';
import type { livePictureSlots } from '../../src/render/view-math';
import { fixtureNote, topLevelBlocks } from './load';

type ArmsColours = typeof armsColours;
type FitMeet = typeof fitMeet;
type JudgeHeader = typeof judgeHeader;
type PictureFormatOf = typeof pictureFormat;
type PictureIssue = typeof pictureIssue;
type PictureTargetOf = typeof pictureTarget;
type PortraitCrop = typeof portraitCrop;
type ReadPictureHeader = typeof readPictureHeader;
type ArmsCards = typeof armsCards;
export type PictureSets = typeof pictureSets;
type SavedFileName = typeof savedFileName;
type SavedLegend = typeof savedLegend;
type SavedScale = typeof savedScale;
type SmallTextWidth = typeof smallTextWidth;
type LivePictureSlots = typeof livePictureSlots;

// ---------- Loading modules that do not exist yet ----------

async function load<T>(path: string, file: string, wp: string, names: readonly string[]): Promise<T> {
	let mod: Record<string, unknown>;
	try {
		mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
	} catch (e) {
		throw new Error(`${file} does not exist yet (${wp}): ${String(e)}`);
	}
	for (const name of names) {
		if (mod[name] === undefined) throw new Error(`${file} does not export ${name} yet (${wp})`);
	}
	return mod as T;
}

/** The frozen export names of `src/core/pictures.ts` (core contract header). */
export interface PicturesModule {
	pictureTarget: PictureTargetOf;
	pictureFormat: PictureFormatOf;
	readPictureHeader: ReadPictureHeader;
	judgeHeader: JudgeHeader;
	MAX_PICTURE_PIXELS: number;
	portraitCrop: PortraitCrop;
	fitMeet: FitMeet;
	pictureIssue: PictureIssue;
}

// Variable paths, so the files compile before the work packages add the modules; the tests then fail clearly.
const PICTURES_PATH = '../../src/core/pictures';
const COLOURS_PATH = '../../src/core/arms-colours';
const SAVED_PATH = '../../src/render/saved-picture';
const LAYOUT_PATH = '../../src/layout/index';
const GEOMETRY_PATH = '../../src/layout/geometry';
const VIEW_MATH_PATH = '../../src/render/view-math';

/** `src/core/pictures.ts`, or an error that names the missing work package. */
export const picturesModule = () =>
	load<PicturesModule>(PICTURES_PATH, 'src/core/pictures.ts', 'WP 9.1', ['pictureTarget', 'pictureFormat', 'readPictureHeader', 'judgeHeader', 'MAX_PICTURE_PIXELS', 'portraitCrop', 'fitMeet', 'pictureIssue']);

/** `armsColours` of `src/core/arms-colours.ts`. */
export const armsColoursOf = async (): Promise<ArmsColours> => (await load<{ armsColours: ArmsColours }>(COLOURS_PATH, 'src/core/arms-colours.ts', 'WP 9.1', ['armsColours'])).armsColours;

/** The saved-picture helpers of `src/render/saved-picture.ts` (obsidian contract P3–P6). */
export interface SavedModule {
	savedScale: SavedScale;
	savedFileName: SavedFileName;
	savedLegend: SavedLegend;
}
export const savedModule = () => load<SavedModule>(SAVED_PATH, 'src/render/saved-picture.ts', 'WP 9.2', ['savedScale', 'savedFileName', 'savedLegend']);

/** `pictureSets` and `armsCards`, exported from `src/layout/index.ts` (L1, L2). */
export const layoutPictures = () => load<{ pictureSets: PictureSets; armsCards: ArmsCards }>(LAYOUT_PATH, 'src/layout/index.ts', 'WP 9.2', ['pictureSets', 'armsCards']);

/** `smallTextWidth` of `src/layout/geometry.ts` (G3). */
export const smallTextWidthOf = async (): Promise<SmallTextWidth> =>
	(await load<{ smallTextWidth: SmallTextWidth }>(GEOMETRY_PATH, 'src/layout/geometry.ts', 'WP 9.2', ['smallTextWidth'])).smallTextWidth;

/** `livePictureSlots` of `src/render/view-math.ts` (S3). */
export const livePictureSlotsOf = async (): Promise<LivePictureSlots> =>
	(await load<{ livePictureSlots: LivePictureSlots }>(VIEW_MATH_PATH, 'src/render/view-math.ts', 'WP 9.2', ['livePictureSlots'])).livePictureSlots;

// ---------- The M9 additions to existing types ----------

/** A `House` with the M9 field `arms` (contract `HouseAdditions`). */
export type PictureHouse = House & { arms?: string };
/** A `Person` with the M9 field `portrait` (contract `PersonAdditions`). */
export type PicturePerson = Person & { portrait?: string };
/** `LayoutSettings` with the M9 picture sets (L1, L3). */
export type PictureSettings = LayoutSettings & { arms?: readonly string[]; portraits?: readonly string[] };
/** `PersonBox` with the M9 flags (L2). */
export type PictureBox = PersonBox & { arms?: true; portrait?: true };

/** Every op `applyOp` accepts after WP 9.1: `portrait` in the person fields, `arms` in the house ops. */
export type PictureOp =
	| Op
	| { kind: 'set-person-fields'; id: string; fields: Record<string, string | boolean | null> }
	| { kind: 'add-person'; id: string; fields: Record<string, string | boolean | null>; parents?: { id: string; type: 'birth' | 'adoptive' | 'ward' | 'rumoured' }[] }
	| { kind: 'add-house'; name: string; color?: string; arms?: unknown }
	| { kind: 'edit-house'; id: string; name?: string; color?: string | null; arms?: unknown }
	| { kind: 'batch'; ops: PictureOp[] };

/** `applyOp` with the M9 fields (their types join `Op` in WP 9.1). */
export const applyPictureOp = (body: string, op: PictureOp): EditResult => applyOp(body, op as Op);

/** The new body of a successful edit, or an error that names the refusal. */
export function bodyOf(r: EditResult): string {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}

/** Parse a block that must not have a hard error. */
export function treeOf(source: string): Tree {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree;
}

/** Parse and derive a block that must not have a hard error. */
export const graphOf = (source: string): FamilyGraph => deriveFamilies(treeOf(source));

export const houseOf = (t: Tree, id: string) => t.houses.find((h) => h.id === id) as PictureHouse | undefined;
export const personOf = (t: Tree, id: string) => t.people.find((p) => p.id === id) as PicturePerson | undefined;

// ---------- Sample tree 14 ----------

const PICTURES_DIR = fileURLToPath(new URL('../../fixtures/pictures/', import.meta.url));

/** The two blocks of sample tree 14: 0 with the "This is me" mark, 1 without (D77). */
export const block14 = (i: 0 | 1): string => topLevelBlocks(fixtureNote('14'))[i];

/** What sample tree 14's comments say about one picture file (`# picture:`). */
export interface PictureFact {
	file: string;
	format: string;
	width?: number;
	height?: number;
	orientation?: number;
}

/** A picture warning as the comments write it (`# warning:`). */
export interface ExpectedWarning {
	code: string;
	params: Record<string, string | number>;
	ids?: string[];
}

function fields(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of text.split(';')) {
		const at = part.indexOf('=');
		if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
	}
	return out;
}

/** The `# picture:`, `# colours:` and `# warning:` comments of sample tree 14's first block. */
export function comments14(): { pictures: PictureFact[]; colours: Map<string, string[]>; warnings: ExpectedWarning[] } {
	const pictures: PictureFact[] = [];
	const colours = new Map<string, string[]>();
	const warnings: ExpectedWarning[] = [];
	for (const line of block14(0).split('\n')) {
		const m = /^# (picture|colours|warning): (.+?) \| (.*)$/.exec(line);
		if (!m) continue;
		if (m[1] === 'colours') colours.set(m[2], m[3].split(',').map((s) => s.trim()));
		else if (m[1] === 'picture') {
			const f = fields(m[3]);
			const num = (k: string) => (f[k] === undefined ? undefined : Number(f[k]));
			pictures.push({ file: m[2], format: f.format, ...(f.width ? { width: num('width'), height: num('height') } : {}), ...(f.orientation ? { orientation: num('orientation') } : {}) });
		} else {
			const f = fields(`${m[3]}`);
			const params: Record<string, string | number> = {};
			let ids: string[] | undefined;
			for (const [k, v] of Object.entries(f)) {
				if (k === 'ids') ids = v.split(',').map((s) => s.trim());
				else params[k] = /^\d+$/.test(v) ? Number(v) : v;
			}
			warnings.push({ code: m[2], params, ...(ids ? { ids } : {}) });
		}
	}
	return { pictures, colours, warnings };
}

/** Every file under `fixtures/pictures/`, as a path relative to `fixtures/` ("pictures/07b/x.png"). */
export function pictureFiles(): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else out.push(relative(join(PICTURES_DIR, '..'), full).replace(/\\/g, '/'));
		}
	};
	walk(PICTURES_DIR);
	return out;
}

/** The bytes of a file under `fixtures/` ("pictures/x.png"). */
export const fixtureBytes = (rel: string): Uint8Array => new Uint8Array(readFileSync(join(PICTURES_DIR, '..', rel)));

/**
 * The file that a link path names, found the way Obsidian's `getFirstLinkpathDest` finds a file
 * for a note in `fixtures/`: the path as written, or the end of a longer path, without case.
 */
export function findPicture(path: string): string | undefined {
	const want = path.toLowerCase();
	return pictureFiles().find((f) => {
		const l = f.toLowerCase();
		return l === want || l.endsWith(`/${want}`);
	});
}

/**
 * The picture problems of a tree, found as part 2 of the contract (O1) says, with the pure
 * functions of `src/core/pictures.ts` and the files of `fixtures/pictures/`: web address, missing
 * file, extension, then the header. Houses in list order, then people in list order (rule 12).
 */
export function pictureProblems(m: PicturesModule, tree: Tree): CodedIssue[] {
	const out: CodedIssue[] = [];
	const check = (owner: PictureOwner, value: string | undefined) => {
		const target = m.pictureTarget(value);
		if (!target) return;
		let problem: PictureProblem | null = null;
		if (target.kind === 'web') problem = { ok: false, code: 'picture-web' };
		else {
			const file = findPicture(target.path);
			if (!file) problem = { ok: false, code: 'missing-picture', file: target.path };
			else {
				const name = file.slice(file.lastIndexOf('/') + 1);
				const verdict = m.pictureFormat(name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
				if (verdict.kind === 'unsupported') problem = { ok: false, code: 'picture-not-image', file: name, format: verdict.name };
				else if (verdict.kind === 'other') problem = { ok: false, code: 'picture-not-image', file: name };
				else {
					const judged = m.judgeHeader(m.readPictureHeader(fixtureBytes(file)), name);
					if (!judged.ok) problem = judged;
				}
			}
		}
		if (problem) out.push(m.pictureIssue(owner, problem));
	};
	for (const h of tree.houses as PictureHouse[]) check({ kind: 'arms', house: { id: h.id, name: h.name } }, h.arms);
	for (const p of tree.people as PicturePerson[]) check({ kind: 'portrait', person: { id: p.id, name: p.name } }, p.portrait);
	return out;
}

// ---------- Colours from the arms (amendment A5) ----------

/**
 * The 64 × 64 px RGBA copy of arms that `armsColours` reads (§13.6; contract rule 10): the picture
 * fitted with its own proportions and centred, transparent around it, drawn with resvg. The pixels
 * are not premultiplied, as a canvas's `getImageData` gives them.
 */
export function armsCopy64(bytes: Uint8Array, mime: string): Uint8Array {
	const b64 = Buffer.from(bytes).toString('base64');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image href="data:${mime};base64,${b64}" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet"/></svg>`;
	const rgba = new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: 64 }, font: { loadSystemFonts: false } }).render().pixels);
	for (let i = 0; i < rgba.length; i += 4) {
		const a = rgba[i + 3];
		if (a === 0 || a === 255) continue;
		for (let k = 0; k < 3; k++) rgba[i + k] = Math.min(255, Math.round((rgba[i + k] * 255) / a));
	}
	return rgba;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** OKLab of a #rrggbb colour (Björn Ottosson's matrices), for the ΔE checks of §13.6. */
export function oklabOf(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** ΔE in OKLab between two #rrggbb colours. */
export const deltaE = (a: string, b: string): number => {
	const [p, q] = [oklabOf(a), oklabOf(b)];
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

// ---------- Picture header bytes, built by hand ----------

export const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
export const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
export const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
export const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
export const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
export const bytes = (...parts: (number | number[])[]) => new Uint8Array(parts.flat());

/** The start of a PNG: signature and IHDR (8-bit RGBA), with a dummy CRC. */
export const pngHead = (w: number, h: number) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), ascii('IHDR'), be32(w), be32(h), [8, 6, 0, 0, 0], be32(0));

/** A JPEG segment: marker and body with its length. */
export const seg = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];

/** An EXIF APP1 segment with one Orientation entry, little-endian ("II") or big-endian ("MM"). */
export function exifSegment(orientation: number, little: boolean): number[] {
	const w16 = little ? le16 : be16;
	const w32 = little ? le32 : be32;
	const tiff = [...ascii(little ? 'II' : 'MM'), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(orientation), 0, 0, ...w32(0)];
	return seg(0xe1, [...ascii('Exif'), 0, 0, ...tiff]);
}

/** A JPEG head: SOI, the given segments, then a start-of-frame of type `sof` with the size. */
export function jpegHead(w: number, h: number, before: number[][] = [], sof = 0xc0): Uint8Array {
	return bytes([0xff, 0xd8], ...before, seg(sof, [8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), [0xff, 0xda]);
}

/** An ISO base media box. */
export const isoBox = (type: string, ...body: number[][]) => {
	const flat = body.flat();
	return [...be32(8 + flat.length), ...ascii(type), ...flat];
};

/** An ISO file with major brand `brand` (and `compat`), and one `ispe` box per size. */
export function isoFile(brand: string, compat: string[], sizes: [number, number][]): Uint8Array {
	const ispe = sizes.map(([w, h]) => isoBox('ispe', be32(0), be32(w), be32(h)));
	return bytes(isoBox('ftyp', ascii(brand), be32(0), ...compat.map(ascii)), isoBox('meta', be32(0), isoBox('iprp', isoBox('ipco', ...ispe))));
}

/** Text as bytes (an SVG file). */
export const text = (s: string) => new TextEncoder().encode(s);
