/*
 * The selected part of a portrait (spec §13.13, D79): reading and writing the `portrait-crop` text,
 * keeping a part inside the picture, moving and zooming it, and the square in picture pixels that
 * the picture store cuts. `parse.ts` and `validate.ts` read the text here; the card, the edit sheet
 * and the crop tool use the rest. All fractions are numbers of the
 * picture after EXIF rotation; nothing here throws.
 *
 * Rules (D79, D91):
 * - Value: `portrait-crop` is three numbers `left top side` separated by white space. `left` is a fraction
 *   of the width, `top` of the height, `side` of the shorter side, so the square is `side * min(w, h)` px.
 *   `Person.portraitCrop` holds the scalar's text; a list or map is held as its JSON text.
 * - Reading: exactly 3 parts, each a plain decimal number (no exponent, no hex), and `side > 0`: `ok`.
 *   Anything else: `bad`. No text: `absent`. A comma is not a separator.
 * - Clamp: `side` is kept between `CROP_MIN_SIDE` and 1; `left` and `top` are moved so the square fits in
 *   the picture. It never fails and gives the same result when applied twice. With a `w` or `h` that is
 *   not finite or 0 or less it gives the automatic part.
 * - Writing: each number is rounded to 4 decimals with no trailing zeros, joined by single spaces. Two
 *   values are the same (no write) when their rounded numbers are equal.
 * - Automatic part: the fractions of the upper-centre square of `portraitCrop(w, h)`. A crop equal to it
 *   when both are rounded to 4 decimals is saved as no key at all.
 * - `cropSquare` gives the square in whole picture px, inside the picture, that the picture store cuts.
 *   A person with no `portrait`, no crop, or a bad crop uses the automatic square. A crop without a
 *   portrait is ignored with no warning.
 * - `validate.ts` warns `bad-portrait-crop` for a written `portrait` with a crop that reads `bad`.
 * - D91: in `set-person-fields`, a changed or removed `portrait` also removes the `portrait-crop` unless
 *   the same op sets one (`yaml-edit.ts`). `rewrite-links` never touches `portrait-crop`.
 */

import { portraitCrop } from './pictures';
import { str } from './tolerate';
import type { Person } from './types';

/** A selected part: `left` of the width, `top` of the height, `side` of the shorter side. */
export interface CropFraction {
	left: number;
	top: number;
	side: number;
}

/** What a written `portrait-crop` says. */
export type CropRead = { kind: 'absent' } | { kind: 'bad' } | { kind: 'ok'; crop: CropFraction };

/** The smallest part: one tenth of the shorter side (spec §13.13 "Zoom limits"). */
export const CROP_MIN_SIDE = 0.1;

const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;

/** True when the picture size can be used. */
const usable = (w: number, h: number) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
export const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

/**
 * The text of a raw `portrait-crop` value: a scalar as text, a list or map as JSON text (numbers
 * written as numbers), nothing for an empty value. Never throws.
 */
export function cropValue(raw: unknown): string | undefined {
	if (Array.isArray(raw) || (typeof raw === 'object' && raw !== null && !(raw instanceof Date))) {
		if (Array.isArray(raw) ? raw.length === 0 : Object.keys(raw).length === 0) return undefined;
		try {
			// The failsafe reader gives every number as text; a list is easier to check as numbers.
			return JSON.stringify(raw, (_k, v: unknown) => (typeof v === 'string' && NUMBER.test(v) ? Number(v) : v));
		} catch {
			return undefined;
		}
	}
	return str(raw);
}

/** Reads the text of `Person.portraitCrop` (rule 20). */
export function readPortraitCrop(text: string | undefined): CropRead {
	if (typeof text !== 'string' || text.trim() === '') return { kind: 'absent' };
	const parts = text.trim().split(/\s+/);
	if (parts.length !== 3 || !parts.every((p) => NUMBER.test(p))) return { kind: 'bad' };
	const [left, top, side] = parts.map(Number);
	if (![left, top, side].every(Number.isFinite) || !(side > 0)) return { kind: 'bad' };
	return { kind: 'ok', crop: { left, top, side } };
}

const round4 = (n: number) => {
	const r = Math.round(finite(n, 0) * 10000) / 10000;
	return r === 0 ? 0 : r;
};

/** The text to write: 4 decimals at most, no trailing zeros, single spaces. */
export function formatPortraitCrop(crop: CropFraction): string {
	return [crop?.left, crop?.top, crop?.side].map((n) => String(round4(n as number))).join(' ');
}

/** True when two texts name the same part after rounding to 4 decimals; unreadable texts must match exactly. */
export function sameCropText(a: string | undefined, b: string | undefined): boolean {
	const ra = readPortraitCrop(a);
	const rb = readPortraitCrop(b);
	if (ra.kind === 'ok' && rb.kind === 'ok') return formatPortraitCrop(ra.crop) === formatPortraitCrop(rb.crop);
	return (ra.kind === 'absent' && rb.kind === 'absent') || a === b;
}

/** Moves a crop into the `w` × `h` picture and within the zoom limits (rule 21). Idempotent. */
export function clampCrop(crop: CropFraction, w: number, h: number): CropFraction {
	if (!usable(w, h)) return { left: 0, top: 0, side: 1 };
	const side = Math.min(Math.max(finite(crop?.side, 1), CROP_MIN_SIDE), 1);
	const px = side * Math.min(w, h);
	// `+ 0` turns a -0 into 0.
	const left = Math.min(Math.max(finite(crop?.left, 0), 0), Math.max(0, 1 - px / w)) + 0;
	const top = Math.min(Math.max(finite(crop?.top, 0), 0), Math.max(0, 1 - px / h)) + 0;
	return { left, top, side };
}

/** The automatic part of a `w` × `h` picture as fractions (rule 23). */
export function automaticCrop(w: number, h: number): CropFraction {
	if (!usable(w, h)) return { left: 0, top: 0, side: 1 };
	const size = Math.min(w, h);
	return { left: Math.floor((w - size) / 2) / w, top: 0, side: 1 };
}

/** True when `crop` is the automatic part, after rounding to the written 4 decimals. */
export function isAutomaticCrop(crop: CropFraction, w: number, h: number): boolean {
	// Compare the way the tool writes a crop, so a crop read back from the note still matches.
	return formatPortraitCrop(crop) === formatPortraitCrop(automaticCrop(w, h));
}

/** The crop of a person for a card or the sheet: null means the automatic part (rule 24). */
export function portraitCropOf(person: Pick<Person, 'portrait' | 'portraitCrop'>): CropFraction | null {
	if (!person || person.portrait === undefined) return null;
	const read = readPortraitCrop(person.portraitCrop);
	return read.kind === 'ok' ? read.crop : null;
}

/** The square in picture px that the store cuts: whole numbers inside the picture, at least 1 px (rule 24). */
export function cropSquare(crop: CropFraction | null, w: number, h: number): { sx: number; sy: number; size: number } {
	if (!usable(w, h)) return { sx: 0, sy: 0, size: 1 };
	if (crop === null) {
		const auto = portraitCrop(w, h);
		return { sx: auto.sx, sy: auto.sy, size: Math.max(1, auto.size) };
	}
	const c = clampCrop(crop, w, h);
	const size = Math.min(Math.max(1, Math.round(c.side * Math.min(w, h))), Math.floor(Math.min(w, h)));
	const sx = Math.min(Math.max(0, Math.round(c.left * w)), Math.floor(w) - size);
	const sy = Math.min(Math.max(0, Math.round(c.top * h)), Math.floor(h) - size);
	return { sx: Math.max(0, sx), sy: Math.max(0, sy), size };
}

/** Moves the part by `dx`, `dy` picture px, then clamps. */
export function moveCrop(crop: CropFraction, dx: number, dy: number, w: number, h: number): CropFraction {
	if (!usable(w, h)) return { left: 0, top: 0, side: 1 };
	return clampCrop({ left: finite(crop?.left, 0) + finite(dx, 0) / w, top: finite(crop?.top, 0) + finite(dy, 0) / h, side: crop?.side }, w, h);
}

/** Zooms by `factor` (above 1 = zoom in) about the frame point `at`, so the picture point under it stays there, then clamps. */
export function zoomCrop(crop: CropFraction, factor: number, at: { x: number; y: number }, w: number, h: number): CropFraction {
	if (!usable(w, h)) return { left: 0, top: 0, side: 1 };
	const from = clampCrop(crop, w, h);
	const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
	const ax = finite(at?.x, 0.5);
	const ay = finite(at?.y, 0.5);
	const short = Math.min(w, h);
	const px = from.side * short;
	const side = Math.min(Math.max(from.side / f, CROP_MIN_SIDE), 1);
	const npx = side * short;
	// The picture point under the frame point, in px, keeps its place in the new frame.
	const x = from.left * w + ax * px;
	const y = from.top * h + ay * px;
	return clampCrop({ left: (x - ax * npx) / w, top: (y - ay * npx) / h, side }, w, h);
}
