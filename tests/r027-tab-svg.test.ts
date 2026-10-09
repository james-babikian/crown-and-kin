// 0.2.7 WP4 geometry (CONTRACT F.4, F.5): the saved picture of the Show view. The ordinal tabs and the heirs' still outline are drawn in the fixed
// colours of the palette (a saved file has no page CSS), the same rectangles as the live scene; the bar sentence is a second text line under the heading.
import { beforeAll, describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { ORDINAL_EM, cardForm, geometryFor, ordinalTabRect } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../src/layout/model';
import { buildScene } from '../src/render/dom/scene';
import { SAVED_PNG_MAX_SIDE, savedExtent, savedFrame } from '../src/render/saved-picture';
import { DEFAULT_DARK, DEFAULT_LIGHT, HEIR_LOOK, ME_LOOK, ROUNDEL_LOOK } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { FEl, installDom } from './acceptance/fake-dom';
import { build } from './helpers';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f"}',
	'  - {id: w, name: W, color: "#1e5a8b"}',
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100, died: 1160, portrait: "[[a.png]]"}',
	'  - {id: b, name: Bertram, house: v, parents: [a]}',
	'  - {id: c, name: Cedric, house: w, parents: [a], portrait: "[[c.png]]"}',
	'  - {id: d, name: Dora, parents: [a]}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;
const ROUNDEL = cardForm(geometryFor(12), 'down');
const TEXT = cardForm(geometryFor(12), 'sideways');
const ORD = new Map([['b', '2nd'], ['c', '20th'], ['d', '3rd']]);
const LEGEND = { kinds: [], sign: false, houses: [] } as const;

function lay(geo: Geometry, over: Partial<LayoutSettings> = {}): LaidOut {
	clearLayoutCache();
	const sideways = geo.form === 'text';
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
}
interface Opts {
	dark?: boolean;
	heirs?: string[];
	ordinals?: ReadonlyMap<string, string>;
	sentence?: string;
	saved?: boolean;
	me?: boolean;
}
function svgOf(laid: LaidOut, o: Opts = {}): string {
	const dark = o.dark === true;
	return renderSvg(g, laid.layout, laid.edges, {
		palette: dark ? DEFAULT_DARK : DEFAULT_LIGHT,
		dark,
		measure,
		fonts: FONTS,
		...(o.me === false ? {} : { me: 'c' }),
		...(o.heirs ? { heirs: o.heirs } : {}),
		...(o.ordinals ? { ordinals: o.ordinals } : {}),
		...(o.sentence ? { barSentence: o.sentence } : {}),
		...(o.saved === false ? {} : { saved: { heading: 'Test', legend: LEGEND, pictures: new Map(), scale: 1 } }),
	});
}

// ---------- A small XML reader for the saved SVG ----------
interface Node {
	tag: string;
	attrs: Record<string, string>;
	children: Node[];
	text: string;
	parent?: Node;
}
function parseSvg(svg: string): Node {
	const root: Node = { tag: '#root', attrs: {}, children: [], text: '' };
	let at = root;
	const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
	for (const m of svg.matchAll(re)) {
		if (m[5] !== undefined) {
			at.text += m[5];
			continue;
		}
		if (m[1]) {
			at = at.parent ?? root;
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const a of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
		const node: Node = { tag: m[2], attrs, children: [], text: '', parent: at };
		at.children.push(node);
		if (!m[4]) at = node;
	}
	return root;
}
const nodes = (n: Node): Node[] => [n, ...n.children.flatMap(nodes)];
const textIn = (n: Node): string => n.text + n.children.map(textIn).join('');
const cardNode = (svg: string, id: string) => nodes(parseSvg(svg)).find((n) => n.attrs['data-item'] === `card:${id}`)!;
const item = (n: Node, name: string) => n.children.find((c) => c.attrs['data-item'] === name);
const items = (svg: string, prefix: string) => nodes(parseSvg(svg)).filter((n) => (n.attrs['data-item'] ?? '').startsWith(prefix));

describe('F.4, F.5: the ordinal tab in the saved picture', () => {
	for (const [name, geo] of [['Roundel', ROUNDEL], ['text card', TEXT]] as const) {
		it(`${name}: the rectangle of the live scene, a card-colour base, the house tint, a 1 px text-colour border, 0.2 em corners`, () => {
			const laid = lay(geo, { ordinalCards: ['b', 'c', 'd'] });
			const svg = svgOf(laid, { ordinals: ORD });
			const L = laid.layout;
			expect(items(svg, 'ordinal:').map((n) => n.attrs['data-item']).sort()).toEqual(['ordinal:b', 'ordinal:c', 'ordinal:d']);
			for (const id of ['b', 'c', 'd']) {
				const box = L.persons.get(id)!;
				const text = ORD.get(id)!;
				const r = ordinalTabRect(L.geometry, geo.form === 'roundel' && !!box.portrait, geo.form === 'roundel' && !!box.arms, text.length);
				const card = cardNode(svg, id);
				const rect = item(card, `ordinal:${id}`)!;
				expect([Number(rect.attrs.x), Number(rect.attrs.y), Number(rect.attrs.width), Number(rect.attrs.height)]).toEqual([box.x + r.x, box.y + r.y, r.w, r.h]);
				expect(Number(rect.attrs.rx)).toBeCloseTo(ORDINAL_EM.corner * 12, 9);
				expect(rect.attrs.stroke).toBe(DEFAULT_LIGHT.text);
				expect(Number(rect.attrs['stroke-width'])).toBe(1);
				expect(Number(rect.attrs['fill-opacity'])).toBe(ROUNDEL_LOOK.plate.light);
				const base = card.children[card.children.indexOf(rect) - 1];
				expect([base.tag, base.attrs.x, base.attrs.width, base.attrs.fill]).toEqual(['rect', rect.attrs.x, rect.attrs.width, DEFAULT_LIGHT.cardFill]);
				const word = card.children[card.children.indexOf(rect) + 1];
				expect(word.tag).toBe('text');
				expect(textIn(word)).toBe(text);
				expect(word.attrs['font-weight']).toBe(FONTS.bold);
				expect(word.attrs['font-style']).toBeUndefined();
				expect(word.attrs.fill).toBe(DEFAULT_LIGHT.text);
				expect(word.attrs['text-anchor']).toBe('middle');
				expect(Number(word.attrs['font-size'])).toBeCloseTo(ORDINAL_EM.text * 12, 9);
			}
		});
	}

	it('uses the dark palette and the dark plate opacity in a dark picture', () => {
		const svg = svgOf(lay(ROUNDEL, { ordinalCards: ['b'] }), { ordinals: ORD, dark: true });
		const rect = item(cardNode(svg, 'b'), 'ordinal:b')!;
		expect(rect.attrs.stroke).toBe(DEFAULT_DARK.text);
		expect(Number(rect.attrs['fill-opacity'])).toBe(ROUNDEL_LOOK.plate.dark);
	});

	it('has only fixed colours: no var() and no named theme word in any paint attribute', () => {
		for (const dark of [false, true]) {
			const svg = svgOf(lay(ROUNDEL, { ordinalCards: ['b', 'c'] }), { ordinals: ORD, heirs: ['b', 'c', 'd'], dark, sentence: 'Line of succession: Duke of Valmont, 1210' });
			expect(svg).not.toContain('var(');
			for (const m of svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) expect(m[1], m[0]).toMatch(/^(none|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))$/);
		}
	});

	it('no tab when the layout has no room for it, or no text is given; none without the options', () => {
		expect(items(svgOf(lay(ROUNDEL), { ordinals: ORD }), 'ordinal:')).toHaveLength(0);
		expect(items(svgOf(lay(ROUNDEL, { ordinalCards: ['b'] })), 'ordinal:')).toHaveLength(0);
		expect(items(svgOf(lay(ROUNDEL, { ordinalCards: ['b'] }), { ordinals: new Map() }), 'ordinal:')).toHaveLength(0);
	});

	it('replaces the "You" tab of the same card', () => {
		const svg = svgOf(lay(ROUNDEL, { youTab: 'c', ordinalCards: ['c'] }), { ordinals: ORD });
		expect(items(svg, 'tab:')).toHaveLength(0);
		expect(items(svg, 'ordinal:c')).toHaveLength(1);
		const apart = svgOf(lay(ROUNDEL, { youTab: 'c', ordinalCards: ['b'] }), { ordinals: ORD });
		expect(items(apart, 'tab:').map((n) => n.attrs['data-item'])).toEqual(['tab:c']);
	});

	it('draws what the live scene draws: the same cards have a tab and an outline', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['b', 'c', 'd'] });
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, me: 'c', ordinals: ORD, heirs: ['b', 'c'] });
		const want: string[] = [];
		for (const e of all(root)) {
			if (!e.hasClass('dynasty-card')) continue;
			const id = e.getAttribute('data-person')!;
			if (e.hasClass('dynasty-heir')) want.push(`heir:${id}`);
			if (all(e).some((x) => x.hasClass('dynasty-ordinal-tab-group'))) want.push(`ordinal:${id}`);
		}
		const got = [...items(svgOf(laid, { ordinals: ORD, heirs: ['b', 'c'] }), 'heir:'), ...items(svgOf(laid, { ordinals: ORD, heirs: ['b', 'c'] }), 'ordinal:')].map((n) => n.attrs['data-item']);
		expect(got.sort()).toEqual(want.sort());
	});

	it('a normal picture is the same with empty options (byte for byte)', () => {
		const laid = lay(ROUNDEL, { youTab: 'c' });
		expect(svgOf(laid, { heirs: [], ordinals: new Map() })).toBe(svgOf(laid));
		expect(svgOf(laid, { saved: false, heirs: [], ordinals: new Map() })).toBe(svgOf(laid, { saved: false }));
	});
});

describe('F.2, F.5: the heirs\' still outline in the saved picture', () => {
	it('a ring in the text colour under the card, and an accent border (the highlight at rest)', () => {
		const laid = lay(ROUNDEL);
		const svg = svgOf(laid, { heirs: ['b'] });
		const card = cardNode(svg, 'b');
		const ring = item(card, 'heir:b')!;
		const box = laid.layout.persons.get('b')!;
		expect([Number(ring.attrs.x), Number(ring.attrs.y), Number(ring.attrs.width), Number(ring.attrs.height)]).toEqual([box.x, box.y, box.w, box.h]);
		expect(ring.attrs.stroke).toBe(DEFAULT_LIGHT.text);
		expect(Number(ring.attrs['stroke-width'])).toBe(HEIR_LOOK.ring);
		expect(ring.attrs.fill).toBe('none');
		const bg = card.children[card.children.indexOf(ring) + 1];
		expect(bg.attrs.fill).toBe(DEFAULT_LIGHT.cardFill);
		expect(bg.attrs.stroke).toBe(DEFAULT_LIGHT.accent);
		expect(Number(bg.attrs['stroke-width'])).toBe(HEIR_LOOK.border);
	});

	it('only the given heirs get it; the card of a person who is not an heir keeps its border', () => {
		const svg = svgOf(lay(ROUNDEL), { heirs: ['b'] });
		expect(items(svg, 'heir:').map((n) => n.attrs['data-item'])).toEqual(['heir:b']);
		const d = cardNode(svg, 'd');
		expect(d.children.find((n) => n.tag === 'rect')!.attrs.stroke).toBe(DEFAULT_LIGHT.cardBorder);
	});

	it('the marked heir keeps its border in the text colour (D153); its ring takes the accent', () => {
		const svg = svgOf(lay(ROUNDEL), { heirs: ['c'] });
		const card = cardNode(svg, 'c');
		const ring = item(card, 'heir:c')!;
		expect(ring.attrs.stroke).toBe(DEFAULT_LIGHT.accent);
		const bg = card.children[card.children.indexOf(ring) + 1];
		expect(bg.attrs.stroke).toBe(DEFAULT_LIGHT.text);
		expect(Number(bg.attrs['stroke-width'])).toBe(ME_LOOK.border);
	});

	it('shows in the dark palette too', () => {
		const ring = item(cardNode(svgOf(lay(ROUNDEL), { heirs: ['b'], dark: true }), 'b'), 'heir:b')!;
		expect(ring.attrs.stroke).toBe(DEFAULT_DARK.text);
	});
});

describe('F.5: the bar sentence is a second heading line', () => {
	const fonts = FONTS;
	const tree = { width: 600, height: 300 };
	const f = 16;
	const SENT = 'Line of succession: Duke of Valmont, 1210';

	it('with no sentence the frame is as before: no second line and the tree where it was', () => {
		const frame = savedFrame(tree, LEGEND, 'Heading', f, approxMeasure, fonts);
		expect(frame.sentence).toBeUndefined();
		expect(frame.tree.y).toBeCloseTo(2 * f + 1.25 * 1.625 * f + 1.25 * f, 9);
	});

	it('with a sentence it lies under the heading, 1 em, regular, and the tree starts below it', () => {
		const plain = savedFrame(tree, LEGEND, 'Heading', f, approxMeasure, fonts);
		const frame = savedFrame(tree, LEGEND, 'Heading', f, approxMeasure, fonts, undefined, undefined, SENT);
		const s = frame.sentence!;
		expect(s.text).toBe(SENT);
		expect(s.size).toBe(f);
		expect(s.weight).toBe('400');
		expect(s.x).toBe(frame.heading.x);
		expect(s.y).toBeGreaterThan(frame.heading.y + 0.35 * frame.heading.size);
		// The sentence's top (its baseline less 0.7 em) is clear of the heading's baseline.
		expect(s.y - 0.7 * s.size).toBeGreaterThan(frame.heading.y);
		expect(frame.tree.y).toBeGreaterThan(s.y);
		expect(frame.tree.y - plain.tree.y).toBeCloseTo(0.25 * f + 1.25 * f, 9);
		expect(frame.h - plain.h).toBeCloseTo(0.25 * f + 1.25 * f, 0);
		expect(frame.w).toBe(plain.w);
	});

	it('a sentence wider than the tree and the heading makes the picture wider', () => {
		const narrow = { width: 40, height: 30 };
		const plain = savedFrame(narrow, LEGEND, 'H', f, approxMeasure, fonts);
		const wide = savedFrame(narrow, LEGEND, 'H', f, approxMeasure, fonts, undefined, undefined, SENT);
		expect(wide.w).toBeGreaterThan(plain.w);
	});

	it('it is cut with the same function as the heading where the picture would pass 8192 px', () => {
		const long = 'Line of succession: ' + 'Duke of Valmont and Baron of the Marches, '.repeat(40);
		const cut = (text: string, max: number) => (text.length > 30 ? text.slice(0, 30) + '…' : text) + `|${Math.round(max)}`;
		const frame = savedFrame(tree, LEGEND, 'Heading', f, approxMeasure, fonts, 1, cut, long);
		expect(frame.sentence!.text).toMatch(/…\|\d+$/);
		expect(frame.sentence!.text).toContain(`|${SAVED_PNG_MAX_SIDE - 2 * 2 * f}`);
	});

	it('`savedExtent` with the sentence is the size `renderSvg` draws', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['b'] });
		const ext = savedExtent(laid, LEGEND, 'Test', 12, approxMeasure, fonts, SENT);
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure: approxMeasure, fonts, barSentence: SENT, heirs: ['b'], ordinals: ORD, saved: { heading: 'Test', legend: LEGEND, pictures: new Map(), scale: 1 } });
		const m = /<svg [^>]*viewBox="0 0 (\d+) (\d+)"/.exec(svg)!;
		expect([Number(m[1]), Number(m[2])]).toEqual([ext.w, ext.h]);
		const plain = savedExtent(laid, LEGEND, 'Test', 12, approxMeasure, fonts);
		expect(ext.h).toBeGreaterThan(plain.h);
	});

	it('the SVG has the sentence as a second text, after the heading, in the text colour and the interface font; none without it', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['b'] });
		const svg = svgOf(laid, { sentence: SENT, ordinals: ORD, heirs: ['b'] });
		const head = items(svg, 'heading');
		expect(head.map((n) => n.attrs['data-item'])).toEqual(['heading', 'heading-sentence']);
		expect(textIn(head[1])).toBe(SENT);
		expect(head[1].attrs.fill).toBe(DEFAULT_LIGHT.text);
		expect(head[1].attrs['font-weight']).toBe('400');
		expect(Number(head[1].attrs['font-size'])).toBe(12);
		expect(Number(head[1].attrs.y)).toBeGreaterThan(Number(head[0].attrs.y));
		expect(items(svgOf(laid), 'heading')).toHaveLength(1);
	});

	it('the sentence is ignored in a picture that is not saved (it has no heading)', () => {
		const laid = lay(ROUNDEL);
		expect(svgOf(laid, { saved: false, sentence: SENT })).toBe(svgOf(laid, { saved: false }));
	});
});
