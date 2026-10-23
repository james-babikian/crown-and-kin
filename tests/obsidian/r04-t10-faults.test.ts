import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardForm, geometryFor } from '../../src/layout/geometry';
import { makePicture, type SaveSource } from '../../src/obsidian/save-picture';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { build } from '../support/helpers';
import { resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { T10, bodyOf } from '../support/r04-t10';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The release plan T10, version 0.4: FAULTS that the sample trees 17 to 19 show. These tests FAIL until a builder work package fixes the fault. They are in a file of
 * their own so that they can be run alone: npx vitest run tests/obsidian/r04-t10-faults.test.ts
 *
 * FAULT RTL-1 (found on sample tree 19, in the spike pictures out/19.png and out/s025-cards/19-*.png): every name is one SVG <text> element with no `direction`,
 * no `unicode-bidi` and no bidi control character, so the browser (and resvg) sets the text in a left-to-right paragraph (the default of SVG text). A name that
 * is only Arabic or only Hebrew shows well. A name with a sobriquet in curly marks does not: the closing mark of the sobriquet is a neutral character at the
 * end of the text, so it is placed at the far end of the line, to the right of the name, and not next to the sobriquet. The picture shows "الحكيم“ يوسف الحداد”"
 * (the closing mark is on the wrong side) for the Arabic card, and the same for the Hebrew card. The spec does not set a direction for text (a question for the
 * owner, in the report). The test asks only for what every possible fix has in common: the text of an RTL name with a sobriquet carries a bidi control: a
 * `direction`, a `unicode-bidi` value of plaintext, isolate or embed, or a direction mark or isolate in the text itself (U+200E, U+200F, U+061C, U+2066 to U+2069,
 * U+202A to U+202C). The fix is the choice of the builder; it must also keep the name at the same place on the card.
 */

useFakeDom({ window: true, css: true });

beforeAll(() => {
	const g = globalThis as Record<string, unknown>;
	const real = g.createEl as (tag: string, o?: unknown) => unknown;
	g.createEl = (tag: string, o?: unknown) => {
		if (tag !== 'canvas') return real(tag, o);
		const ctx = { font: '', measureText: (t: string) => ({ width: [...t].length * 8 }) };
		return { width: 0, height: 0, getContext: () => ctx };
	};
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	clearMeasureCache();
});
afterEach(() => vi.restoreAllMocks());

const sourceOf = (body: string, orientation: 'down' | 'sideways'): SaveSource => ({
	g: build(body).g,
	orientation,
	geo: cardForm(geometryFor(16), orientation),
	relationLine: false,
	fonts: { text: 'serif', ui: 'sans-serif', bold: '600' },
	showDates: true,
	showPortraits: false,
	sourcePath: 'Trees/Sample.md',
	note: 'Sample',
});

const RTL = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f]/u;
const BIDI_CONTROL = /[\u200e\u200f\u061c\u2066-\u2069\u202a-\u202c]/u;

describe('FAULT RTL-1: a name in Arabic or Hebrew with a sobriquet carries a text direction', () => {
	it.each(['yusuf', 'david'] as const)('%s (yusuf is Arabic, david is Hebrew), in the Roundel and in the text card: the name <text> sets direction, unicode-bidi or holds a bidi control', async (id) => {
		for (const orientation of ['down', 'sideways'] as const) {
			const svg = new TextDecoder().decode((await makePicture(undefined, sourceOf(bodyOf(T10[2]), orientation), 'svg')).bytes);
			const card = svg.split('<g data-item="card:' + id + '"')[1].split('</g>')[0];
			const nameText = [...card.matchAll(/<text [^>]*font-weight="[^"]*"[^>]*>.*?<\/text>/g)].map((m) => m[0]).find((t) => RTL.test(t))!;
			expect(nameText, `${id} ${orientation}`).toBeTruthy();
			const ok = /direction=|unicode-bidi=/.test(nameText) || BIDI_CONTROL.test(nameText);
			expect(ok, `${id} ${orientation}: ${nameText}`).toBe(true);
		}
	});
});
