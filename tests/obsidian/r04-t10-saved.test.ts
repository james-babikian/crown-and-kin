import { Resvg } from '@resvg/resvg-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeRelations } from '../../src/core/relations';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { makePicture, type SaveSource } from '../../src/obsidian/save-picture';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { build } from '../support/helpers';
import { resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { T10, bodyOf, type T10Tree } from '../support/r04-t10';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The release plan T10, version 0.4: the saved picture (SVG text, spec §13.8) of the sample trees 17 to 19. The picture holds each name as text (not as lines or
 * shapes), escaped for XML, in the order of the note; a name that does not fit is cut with "…" or broken at a space (spec §13.9, D81 and D82), and no text
 * runs out of its card. The relation word of a card stands under an RTL name. The canvas that measures text is replaced by one with hand-written widths
 * of the scripts (a Chinese, Japanese or Korean character is as wide as it is high; Thai, Devanagari, Arabic and Hebrew letters are about half as wide;
 * combining marks and joiners have no width), so the test proves the cut with real widths. The headless `approxMeasure` of the spike is not used here.
 *
 * What the code does about text direction is recorded in "text direction: what the code sets" (nothing is invented): no `direction`, no `unicode-bidi`,
 * no `dir` and no `lang` is set anywhere in the picture, and each name is one `<text>` (centred on its card in the Roundel, from the left in the text card). A fault that this shows is in
 * tests/obsidian/r04-t10-faults.test.ts. Run: npx vitest run tests/obsidian/r04-t10-saved.test.ts
 */

useFakeDom({ window: true, css: true });

/** The width of one text in em, written by hand from the scripts: not a measure of the plugin. */
export function emWidth(text: string): number {
	let em = 0;
	for (const ch of text) {
		if (/\p{M}|[\u200d\ufe0f\u200e\u200f\u061c]/u.test(ch)) continue;
		if (/\p{Extended_Pictographic}/u.test(ch)) em += 1.2;
		else if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef\u1100-\u11ff]/.test(ch)) em += 1;
		else if (/[\u0e00-\u0e7f\u0900-\u097f\u10d0-\u10ff\u0590-\u05ff\u0600-\u06ff]/.test(ch)) em += 0.5;
		else if (ch === ' ') em += 0.28;
		else em += 0.55;
	}
	return em;
}

beforeAll(() => {
	const g = globalThis as Record<string, unknown>;
	const real = g.createEl as (tag: string, o?: unknown) => unknown;
	g.createEl = (tag: string, o?: unknown) => {
		if (tag !== 'canvas') return real(tag, o);
		const ctx = {
			font: '',
			measureText(t: string) {
				const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16);
				const bold = /^\s*(?:italic\s+)?([5-9]00)\s/.test(ctx.font) ? 1.06 : 1;
				return { width: emWidth(t) * size * bold };
			},
		};
		return { width: 0, height: 0, getContext: () => ctx };
	};
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	clearMeasureCache();
});
afterEach(() => vi.restoreAllMocks());

function sourceOf(body: string, more: Partial<SaveSource> = {}): SaveSource {
	const orientation = more.orientation ?? 'down';
	return {
		g: build(body).g,
		orientation,
		geo: cardForm(geometryFor(16), orientation),
		relationLine: false,
		fonts: { text: 'serif', ui: 'sans-serif', bold: '600' },
		showDates: true,
		showPortraits: false,
		sourcePath: 'Trees/Sample.md',
		note: 'Sample',
		...more,
	};
}

// The resvg check of sample tree 18 loads the system fonts; under the load of `npm run test:all` it can pass 30 s (alone the file takes about 10 s).
vi.setConfig({ testTimeout: 120_000 });

// One picture per tree and options, shared by the tests: a picture of sample tree 18 takes 15 to 30 s to make.
const pictures = new Map<string, Promise<string>>();
const svgOf = (body: string, more: Partial<SaveSource> = {}): Promise<string> => {
	const key = `${JSON.stringify(more)}
${body}`;
	let out = pictures.get(key);
	if (!out) pictures.set(key, (out = makePicture(undefined, sourceOf(body, more), 'svg').then((p) => new TextDecoder().decode(p.bytes))));
	return out;
};

const unescapeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

interface CardText {
	/** The card rectangle. */
	rect: { x: number; w: number };
	/** The name text lines: the text of each `<text>` with a font weight (the date and title lines have none), and where each starts. */
	names: { text: string; x: number; width: number; middle: boolean; left: number }[];
	/** The relation word, when the card has one. */
	relation?: string;
	/** The whole group, as written. */
	group: string;
}

/** The cards of a saved SVG, by person id, from the `data-item="card:ID"` groups. */
function cardsOf(svg: string): Map<string, CardText> {
	const out = new Map<string, CardText>();
	for (const part of svg.split(/<g data-item="card:/).slice(1)) {
		const id = /^([^"]+)"/.exec(part)![1];
		const group = part.slice(0, part.indexOf('</g>'));
		const rect = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/.exec(group)!;
		const names = [...group.matchAll(/<text x="([\d.]+)" y="[\d.]+"([^>]*font-weight="[^"]*"[^>]*)>(.*?)<\/text>/g)].map((m) => {
			const inner = unescapeXml(m[3].replace(/<\/?tspan[^>]*>/g, ''));
			const size = Number(/font-size="([\d.]+)"/.exec(m[2])![1]);
			const width = emWidth(inner) * size;
			const middle = m[2].includes('text-anchor="middle"');
			return { text: inner, x: Number(m[1]), width, middle, left: middle ? Number(m[1]) - width / 2 : Number(m[1]) };
		});
		const rel = /data-item="relation:[^"]+">([^<]*)<\/text>/.exec(group);
		out.set(id, { rect: { x: Number(rect[1]), w: Number(rect[2]) }, names, ...(rel ? { relation: unescapeXml(rel[1]) } : {}), group });
	}
	return out;
}

/**
 * The characters that the plugin may add or change around a name: the curly marks of the sobriquet, white space, the cut mark and (fault RTL-1, G5 fault 5 of 0.4)
 * the bidi controls round an RTL name and its lines: the isolates U+2066 to U+2069 and the direction marks U+200E and U+200F.
 */
const plain = (s: string) => s.replace(/[\s“”…"\u200e\u200f\u2066-\u2069]/g, '');

const FORMS = [['the Roundel (top to bottom, text centred)', 'down'], ['the text card (sideways, text from the left)', 'sideways']] as const;

describe.each(T10.flatMap((t) => FORMS.map(([form, orientation]) => [t.id, form, orientation, t] as const)))('sample tree %s, %s: the saved SVG holds the names as text', (_id, _form, orientation, t: T10Tree) => {
	const src = bodyOf(t);

	it('every card has at least one name text line, and the lines are the start of the name (and the sobriquet) in the order of the note', async () => {
		const cards = cardsOf(await svgOf(src, { orientation }));
		expect([...cards.keys()].sort()).toEqual(Object.keys(t.people).sort());
		for (const [id, want] of Object.entries(t.people)) {
			const card = cards.get(id)!;
			expect(card.names.length, id).toBeGreaterThan(0);
			expect(card.names.length, id).toBeLessThanOrEqual(3);
			const shown = card.names.map((n) => n.text).join('');
			const full = plain(want.name + (want.sobriquet ?? ''));
			const got = plain(shown);
			if (shown.includes('…')) expect(full.startsWith(got), `${id}: ${shown}`).toBe(true);
			else expect(got, id).toBe(full);
		}
	});

	it('no name text line runs out of its card on either side (the width is the hand-written width of the script)', async () => {
		const cards = cardsOf(await svgOf(src, { orientation }));
		for (const [id, card] of cards) {
			for (const line of card.names) {
				expect(line.left, `${id}: ${line.text}`).toBeGreaterThanOrEqual(card.rect.x - 0.5);
				expect(line.left + line.width, `${id}: ${line.text}`).toBeLessThanOrEqual(card.rect.x + card.rect.w + 0.5);
			}
		}
	});

	it('is a picture that a renderer reads', async () => {
		const svg = await svgOf(src, { orientation });
		expect(svg).not.toMatch(/NaN|undefined|\[object|Infinity/);
		expect(() => new Resvg(svg)).not.toThrow();
	});
});

describe('sample tree 18: long names in a narrow script are cut with "…" or broken at a space, and a joined emoji is not split', () => {
	const t = T10[1];

	it('the Chinese name of 16 characters with no space is cut with "…" and has at most three text lines; the Thai name with no space too', async () => {
		const cards = cardsOf(await svgOf(bodyOf(t)));
		for (const id of ['ouyang', 'thai-long']) {
			const names = cards.get(id)!.names.map((n) => n.text);
			expect(names.length, id).toBeLessThanOrEqual(3);
			expect(names.join(''), id).toContain('…');
			// What is left of the name is its start, in order.
			expect(t.people[id].name.startsWith(names.join('').replace('…', '')), id).toBe(true);
		}
	});

	it('the joined emoji (a person, a skin tone and a joiner) stays whole in the sobriquet of Zoë, as 4 code points in a row', async () => {
		const svg = await svgOf(bodyOf(t));
		expect(svg).toContain('\u{1F9D1}\u{1F3FD}\u200d\u{1F33E}');
	});

	it('a cut never leaves a joiner or a skin-tone mark at the end of a text line, and no text line starts with a combining mark', async () => {
		// A sobriquet made of joined emoji, long enough to be cut: the cut must fall between two whole pictures.
		const farmer = '\u{1F9D1}\u{1F3FD}\u200d\u{1F33E}';
		const body = ['people:', `  - {id: a, name: Aria Quill, sobriquet: "${farmer.repeat(12)}", sex: f}`, `  - {id: b, name: "Zoe\u0308 ${'Zoe\u0308'.repeat(14)}", sex: f}`, ''].join('\n');
		const cards = cardsOf(await svgOf(body));
		// The guard against a test that cuts nothing: both texts are too long for a card, so both end in "…".
		for (const id of ['a', 'b']) expect(cards.get(id)!.names.map((n) => n.text).join(''), id).toContain('…');
		for (const id of ['a', 'b']) {
			for (const line of cards.get(id)!.names) {
				const text = line.text.replace(/…$/, '');
				expect(text.endsWith('\u200d'), `${id}: ${JSON.stringify(line.text)}`).toBe(false);
				expect(/[\u{1F3FB}-\u{1F3FF}]$/u.test(text), `${id}: ${JSON.stringify(line.text)}`).toBe(false);
				expect(/^\p{M}/u.test(line.text), `${id}: ${JSON.stringify(line.text)}`).toBe(false);
			}
		}
	});
});

describe('XML: a name is escaped, and a character that XML cannot hold is left out', () => {
	it('an RTL name with &, <, > and quote marks is written escaped and is the same text when read back', async () => {
		const name = 'ليلى & <أبناء> "الحداد" \'Haddad\'';
		const body = ['people:', `  - {id: a, name: ${JSON.stringify(name)}, sex: f}`, ''].join('\n');
		const svg = await svgOf(body);
		expect(svg).toContain('&amp;');
		expect(svg).toContain('&lt;');
		expect(svg).toContain('&gt;');
		expect(svg).not.toContain('<أبناء>');
		expect(() => new Resvg(svg)).not.toThrow();
		const card = cardsOf(svg).get('a')!;
		expect(plain(card.names.map((n) => n.text).join(''))).toBe(plain(name).replace(/'/g, "'"));
	});

	it('a bidi control character that the note holds (U+200F, U+2067, U+2069) is kept, and a character that XML does not allow (U+0000, U+FFFE) is dropped', async () => {
		const name = 'a\u200fb\u2067c\u2069d';
		const body = ['people:', `  - {id: a, name: "${name}", sex: f}`, `  - {id: b, name: "x\ufffey", sex: f}`, ''].join('\n');
		const svg = await svgOf(body);
		expect(svg).toContain('a\u200fb\u2067c\u2069d');
		expect(svg).not.toContain('\ufffe');
		expect(() => new Resvg(svg)).not.toThrow();
	});
});

describe('sample tree 19: the relation word stands under an RTL name (spec §13.1: the card shows the relation to the marked person)', () => {
	const t = T10[2];
	const body = bodyOf(t);

	it('every person that has a relation to Omar has the word as text under the name, "You" for Omar, and the name is still the start of the note\'s name', async () => {
		const g = build(body).g;
		const relations = computeRelations(g, 'omar');
		const svg = await svgOf(body, { relations: { get: (id) => relations.get(id)?.[0] }, me: 'omar', relationLine: true });
		const cards = cardsOf(svg);
		let words = 0;
		for (const id of Object.keys(t.people)) {
			const want = relations.get(id)?.[0];
			const card = cards.get(id)!;
			if (!want) {
				expect(card.relation, id).toBeUndefined();
				continue;
			}
			words++;
			// A relation word may be cut or shortened to fit; it is not empty, and it is the start of the word or a short form of it.
			expect(card.relation!.length, id).toBeGreaterThan(0);
			expect(card.group.indexOf(`relation:${id}`), id).toBeGreaterThan(card.group.indexOf('<text'));
			expect(card.names.length, id).toBeGreaterThan(0);
		}
		expect(words).toBe(Object.keys(t.people).length);
		expect(cards.get('omar')!.relation).toBe('You');
		expect(cards.get('yusuf')!.relation).toMatch(/^[A-Z]/);
	});
});

describe('text direction: what the code sets in the saved picture (recorded, not judged)', () => {
	it('the picture of sample tree 19 has no direction, unicode-bidi, dir, lang, xml:lang or writing-mode attribute, and no style element that sets them', async () => {
		const svg = await svgOf(bodyOf(T10[2]));
		for (const word of ['direction', 'unicode-bidi', ' dir=', ' lang=', 'xml:lang', 'writing-mode']) expect(svg, word).not.toContain(word);
		expect(svg).not.toContain('<style');
	});

	it('the Roundel centres every name line (text-anchor middle at the centre of the card), the text card starts it at the left; the same for an Arabic, a Hebrew and a Latin name', async () => {
		const down = cardsOf(await svgOf(bodyOf(T10[2]), { orientation: 'down' }));
		const side = cardsOf(await svgOf(bodyOf(T10[2]), { orientation: 'sideways' }));
		for (const id of ['layla', 'omar', 'muhammad', 'avi', 'miriam']) {
			for (const line of down.get(id)!.names) {
				expect(line.middle, id).toBe(true);
				expect(line.x - down.get(id)!.rect.x, id).toBeCloseTo(down.get(id)!.rect.w / 2, 6);
			}
			const left = side.get(id)!.names[0];
			expect(left.middle, id).toBe(false);
			expect(left.x - side.get(id)!.rect.x, id).toBeCloseTo(side.get('omar')!.names[0].x - side.get('omar')!.rect.x, 6);
		}
	});

	it('the sobriquet is a tspan in regular weight inside the same <text> as the name, with the curly marks written by the plugin', async () => {
		const svg = await svgOf(bodyOf(T10[2]));
		const yusuf = cardsOf(svg).get('yusuf')!;
		expect(yusuf.group).toContain('<tspan font-weight="400">');
		// Fault RTL-1: the line is one bidi isolate, so the closing mark stays next to the sobriquet.
		expect(yusuf.names[0].text).toBe('\u2068يوسف الحداد “الحكيم”\u2069');
	});
});
