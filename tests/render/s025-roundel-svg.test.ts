// 0.2.5 WP-B4 (CONTRACT B.3.11, B.5 test 6): the saved picture follows the card form. `renderSvg` draws what the live scene draws for the
// Roundel, the sideways text card and the "You" tab: the same elements, the same text places, the foot hairline (0.2.8; the plate before),
// the tab, no picture in a sideways tree, and the Full level only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { cardLabels } from '../../src/core/titles';
import { ROUNDEL_EM, cardForm, cardText, centredWithoutWord, footSpan, geometryFor, roundelAxis, roundelPics, youTabRect } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../../src/layout/model';
import { buildScene, type Scene } from '../../src/render/dom/scene';
import { FRAME_STROKE_PX, TAB_TEXT_BASE_EM, TAB_TEXT_EM } from '../../src/render/scene-model';
import { DEFAULT_DARK, DEFAULT_LIGHT, HEIR_LOOK, ME_RING_INNER, mixHex } from '../../src/render/styles';
import { renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

// a: title and dates, arms and portrait; b: signed, no text lines but the name; c: marked, dates only, portrait; d: nothing; e: title only.
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'  - {id: w, name: W, color: "#1e5a8b"}',
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100, died: 1160, title: Duke, portrait: "[[a.png]]"}',
	'  - {id: b, name: Bertram, house: v, illegitimate: true}',
	'  - {id: c, name: Cedric, house: w, born: 1130, parents: [a], portrait: "[[c.png]]"}',
	'  - {id: d, name: Dora, parents: [a]}',
	'  - {id: e, name: Edric, house: w, title: Knight, parents: [a]}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;
const labels = cardLabels(g);
const RELATIONS = new Map([['b', { text: 'Half-brother', lower: 'half-brother' }], ['c', { text: 'You', lower: 'you' }], ['d', { text: 'Half-sister', lower: 'half-sister' }]]);
const PICTURES = new Map<string, string | 'missing' | null>([['arms:v', PNG_URI], ['portrait:a', PNG_URI], ['portrait:c', 'missing']]);

const ROUNDEL = cardForm(geometryFor(12), 'down');
const TEXT = cardForm(geometryFor(12), 'sideways');

function lay(geo: Geometry, over: Partial<LayoutSettings> = {}): LaidOut {
	clearLayoutCache();
	const sideways = geo.form === 'text';
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
}
function sceneOf(laid: LaidOut, relations = true): { root: FEl; scene: Scene } {
	const root = new FEl('g');
	const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', ...(relations ? { relations: RELATIONS } : {}) });
	return { root, scene };
}
function svgOf(laid: LaidOut, o: { dark?: boolean; relations?: boolean; me?: boolean; saved?: boolean } = {}): string {
	const dark = o.dark === true;
	return renderSvg(g, laid.layout, laid.edges, {
		palette: dark ? DEFAULT_DARK : DEFAULT_LIGHT,
		dark,
		measure,
		fonts: FONTS,
		labels,
		...(o.me === false ? {} : { me: 'c' }),
		...(o.relations === false ? {} : { relations: RELATIONS }),
		...(o.saved === false ? {} : { saved: { heading: 'Test', legend: { kinds: [], sign: false, houses: [] }, pictures: PICTURES, scale: 1 } }),
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
// A card's own elements: its group has no nested group, so `children` is the whole list.
const textsOf = (n: Node) => n.children.filter((c) => c.tag === 'text');
const item = (n: Node, name: string) => n.children.find((c) => c.attrs['data-item'] === name);

/** The text elements of a scene card in drawing order, without the Compact name (the saved picture draws the Full level only). */
const sceneTexts = (card: FEl) => all(card).filter((e) => e.tag === 'text' && !e.hasClass('dynasty-card-compact'));

describe('B.3.11: the saved picture has the elements of the live scene, for each form', () => {
	const cases: [string, Geometry, Partial<LayoutSettings>][] = [
		['Roundel, plate on', ROUNDEL, { relationLine: true }],
		['Roundel, plate off, tab on the marked card', ROUNDEL, { youTab: 'c' }],
		['text card (sideways), plate on', TEXT, { relationLine: true }],
		['text card (sideways), plate off, tab', TEXT, { youTab: 'c' }],
	];
	for (const [name, geo, over] of cases) {
		it(`${name}: same cards, plates, tabs, relation words and pictures`, () => {
			const laid = lay(geo, over);
			const { root, scene } = sceneOf(laid, over.relationLine === true);
			const svg = svgOf(laid, { relations: over.relationLine === true });
			const want: string[] = [];
			for (const e of all(root)) {
				if (!e.hasClass('dynasty-card')) continue;
				const id = e.getAttribute('data-person')!;
				want.push(`card:${id}`);
				if (all(e).some((x) => x.hasClass('dynasty-card-foot-line'))) want.push(`foot:${id}`);
				if (all(e).some((x) => x.hasClass('dynasty-r1-tab-group'))) want.push(`tab:${id}`);
				if (all(e).some((x) => x.hasClass('dynasty-card-relation'))) want.push(`relation:${id}`);
			}
			for (const s of scene.pictures.filter((x) => x.lod === 'full')) {
				if (s.kind === 'arms' && PICTURES.get(`arms:${(s.owner && 'house' in s.owner ? s.owner.house : undefined)}`)?.startsWith('data:')) want.push(`arms:${s.person}`);
				if (s.kind === 'portrait') {
					// D219: a portrait that shows has no frame; an empty one keeps its thin frame.
					if (PICTURES.get(`portrait:${s.person}`)?.startsWith('data:')) want.push(`portrait:${s.person}`);
					else want.push(`frame:${s.person}`);
				}
			}
			const got = nodes(parseSvg(svg)).flatMap((n) => (n.attrs['data-item'] && /^(card|foot|tab|relation|arms|frame|portrait):/.test(n.attrs["data-item"]) ? [n.attrs['data-item']] : []));
			expect(got.sort()).toEqual(want.sort());
		});

		it(`${name}: every text of a card has the x, y, anchor and words of the scene`, () => {
			const laid = lay(geo, over);
			const { root } = sceneOf(laid, over.relationLine === true);
			const svg = svgOf(laid, { relations: over.relationLine === true });
			const roundel = geo.form === 'roundel';
			for (const id of ['a', 'b', 'c', 'd', 'e']) {
				const card = all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
				const want = sceneTexts(card).map((e) => [Number(e.getAttribute('x')), Number(e.getAttribute('y')), e.getText()] as const);
				const got = textsOf(cardNode(svg, id)).map((n) => [Number(n.attrs.x), Number(n.attrs.y), textIn(n)] as const);
				expect(got.length, id).toBe(want.length);
				got.forEach((t, i) => {
					expect(t[0], `${id} text ${i} x`).toBeCloseTo(want[i][0], 9);
					expect(t[1], `${id} text ${i} y`).toBeCloseTo(want[i][1], 9);
					expect(t[2], `${id} text ${i} words`).toBe(want[i][2]);
				});
				// The Roundel centres every text of the card on its axis (the tab word is centred in both forms).
				for (const n of textsOf(cardNode(svg, id))) {
					const middle = n.attrs['text-anchor'] === 'middle';
					expect(middle, `${id} ${textIn(n)}`).toBe(roundel || textIn(n) === 'You' && n.attrs['font-size'] === String(TAB_TEXT_EM * 12));
				}
			}
		});
	}

	it('the text lines of a person with fewer small lines are centred as the scene centres them (ShownLines)', () => {
		// b has no title and no dates; e only a title; c only dates; a both: four different text blocks.
		const laid = lay(ROUNDEL, { relationLine: true });
		const geo = laid.layout.geometry;
		const svg = svgOf(laid);
		const shown: Record<string, { title: boolean; dates: boolean }> = { a: { title: true, dates: true }, b: { title: false, dates: false }, c: { title: false, dates: true }, e: { title: true, dates: false } };
		for (const [id, s] of Object.entries(shown)) {
			const box = laid.layout.persons.get(id)!;
			// a and e have no relation word: their text is centred in the whole card (D177 item 10).
			const plain = cardText(geo, 1, false, s);
			const ct = RELATIONS.has(id) ? plain : centredWithoutWord(geo, plain);
			expect(Number(textsOf(cardNode(svg, id))[0].attrs.y), id).toBeCloseTo(box.y + ct.nameBaseline, 9);
		}
	});

	it('with "Show dates on cards" off the dates line is not drawn but its room stays, as the class hides it on screen', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const geo = laid.layout.geometry;
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure, fonts: FONTS, labels, me: 'c', relations: RELATIONS, showDates: false, saved: { heading: 'T', legend: { kinds: [], sign: false, houses: [] }, pictures: PICTURES, scale: 1 } });
		const box = laid.layout.persons.get('c')!;
		const ct = cardText(geo, 1, false, { title: false, dates: true });
		const texts = textsOf(cardNode(svg, 'c')).map((n) => textIn(n));
		expect(texts).not.toContain('1130');
		expect(Number(textsOf(cardNode(svg, 'c'))[0].attrs.y)).toBeCloseTo(box.y + ct.nameBaseline, 9);
	});
});

describe('B.3.4: the foot hairline and the "You" tab in the saved picture', () => {
	it('the foot hairline is the scene\'s line, in the card\'s own edge colour', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const { root } = sceneOf(laid);
		const svg = svgOf(laid);
		const geo = laid.layout.geometry;
		const t = cardText(geo, 1);
		for (const id of ['b', 'd']) {
			const sceneCard = all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
			const line = item(cardNode(svg, id), `foot:${id}`)!;
			expect(line.tag).toBe('line');
			const live = all(sceneCard).find((e) => e.hasClass('dynasty-card-foot-line'))!;
			for (const k of ['x1', 'y1', 'x2', 'y2']) expect(Number(line.attrs[k]), `${id} ${k}`).toBeCloseTo(Number(live.getAttribute(k)), 9);
			const box = laid.layout.persons.get(id)!;
			const span = footSpan(geo, box.w, 1);
			expect([Number(line.attrs.x1), Number(line.attrs.y1), Number(line.attrs.x2)]).toEqual([box.x + span.x0, box.y + box.h - t.r1!.plate!.h + 0.5, box.x + span.x1]);
			expect(line.attrs.stroke).toBe(DEFAULT_LIGHT.cardBorder);
			expect(line.attrs['stroke-width']).toBe('1');
		}
	});

	it('the hairline of the marked card stays inside the border (D153)', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const svg = svgOf(laid);
		const box = laid.layout.persons.get('c')!;
		const line = item(cardNode(svg, 'c'), 'foot:c')!;
		expect([Number(line.attrs.x1), Number(line.attrs.x2)]).toEqual([box.x + ME_RING_INNER, box.x + box.w - ME_RING_INNER]);
	});

	it('dark palette: the ribbon colour is lifted by 40 % toward the text colour, as on the screen', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const svg = svgOf(laid, { dark: true });
		expect(svg).toContain(`Z" fill="${mixHex('#8b1e3f', 0.6, DEFAULT_DARK.text)}"`);
	});

	it('plate off: no foot hairline, no relation word, even when the caller still gives relations; the card is shorter', () => {
		const on = lay(ROUNDEL, { relationLine: true });
		const off = lay(ROUNDEL, { youTab: 'c' });
		const svg = svgOf(off, { relations: true });
		expect(nodes(parseSvg(svg)).some((n) => /^(foot|relation):/.test(n.attrs['data-item'] ?? ''))).toBe(false);
		expect(textsOf(cardNode(svg, 'd')).map(textIn)).toEqual(['Dora']);
		expect(off.layout.persons.get('d')!.h).toBeLessThan(on.layout.persons.get('d')!.h);
	});

	it('the tab: the scene\'s rectangle in the card colour inside a text-colour border (0.2.8), over a wide card-colour base, the text-colour bold "You"; and only on the card of `youTab`', () => {
		const laid = lay(ROUNDEL, { youTab: 'c' });
		const svg = svgOf(laid);
		const geo = laid.layout.geometry;
		const box = laid.layout.persons.get('c')!;
		const card = cardNode(svg, 'c');
		const rect = item(card, 'tab:c')!;
		const r = youTabRect(geo, true);
		expect([Number(rect.attrs.x), Number(rect.attrs.y), Number(rect.attrs.width), Number(rect.attrs.height)]).toEqual([box.x + r.x, box.y + r.y, r.w, r.h]);
		expect(Number(rect.attrs.rx)).toBe(r.h / 2);
		expect(rect.attrs.fill).toBe(DEFAULT_LIGHT.cardFill);
		expect(rect.attrs.stroke).toBe(DEFAULT_LIGHT.text);
		expect(Number(rect.attrs['stroke-width'])).toBe(HEIR_LOOK.tabBorder);
		const base = card.children[card.children.indexOf(rect) - 1];
		expect([base.tag, base.attrs.x, base.attrs.y, base.attrs.width, base.attrs.height, base.attrs.fill, base.attrs.stroke]).toEqual(['rect', rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height, DEFAULT_LIGHT.cardFill, DEFAULT_LIGHT.cardFill]);
		expect(Number(base.attrs['stroke-width'])).toBe(HEIR_LOOK.tabBase);
		const word = textsOf(cardNode(svg, 'c')).find((n) => textIn(n) === 'You')!;
		expect(word.attrs.fill).toBe(DEFAULT_LIGHT.text);
		expect(word.attrs['font-style']).toBeUndefined();
		expect(word.attrs['font-weight']).toBe(FONTS.bold);
		expect(Number(word.attrs['font-size'])).toBeCloseTo(TAB_TEXT_EM * 12, 9);
		expect(Number(word.attrs.y)).toBeCloseTo(box.y + r.y + r.h / 2 + TAB_TEXT_BASE_EM * 12, 9);
		expect(nodes(parseSvg(svg)).filter((n) => /^tab:/.test(n.attrs['data-item'] ?? ''))).toHaveLength(1);
	});

	it('the tab follows `youTab` of the layout, not the mark: a mark with no tab in the layout draws none', () => {
		const svg = svgOf(lay(ROUNDEL), { relations: false });
		expect(nodes(parseSvg(svg)).some((n) => /^tab:/.test(n.attrs['data-item'] ?? ''))).toBe(false);
		const other = svgOf(lay(ROUNDEL, { youTab: 'b' }), { relations: false });
		expect(nodes(parseSvg(other)).filter((n) => /^tab:/.test(n.attrs['data-item'] ?? '')).map((n) => n.attrs['data-item'])).toEqual(['tab:b']);
	});

	it('the text card carries the tab above the text\'s left edge', () => {
		for (const geo of [TEXT]) {
			const laid = lay(geo, { youTab: 'c' });
			const svg = svgOf(laid);
			const box = laid.layout.persons.get('c')!;
			const r = youTabRect(laid.layout.geometry, false);
			expect(r.x).toBe(0.875 * 12);
			expect(Number(item(cardNode(svg, 'c'), 'tab:c')!.attrs.x)).toBe(box.x + r.x);
		}
	});
});

describe('B.3.3, B.3.10: pictures in the saved picture', () => {
	it('the Roundel: the arms and the medallion are the places of roundelPics, with a gap in the page colour and no ring (D219)', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const geo = laid.layout.geometry;
		const svg = svgOf(laid);
		const box = laid.layout.persons.get('a')!;
		const rp = roundelPics(geo, { arms: true, portrait: true });
		const node = cardNode(svg, 'a');
		const arms = item(node, 'arms:a')!;
		expect([Number(arms.attrs.x), Number(arms.attrs.y), Number(arms.attrs.width), Number(arms.attrs.height)]).toEqual([box.x + rp.arms!.x, box.y + rp.arms!.y, rp.arms!.w, rp.arms!.h]);
		const portrait = item(node, 'portrait:a')!;
		expect([Number(portrait.attrs.x), Number(portrait.attrs.y), Number(portrait.attrs.width), Number(portrait.attrs.height)]).toEqual([box.x + rp.portrait!.x, box.y + rp.portrait!.y, rp.portrait!.w, rp.portrait!.h]);
		// D219: a portrait that shows has no frame and no ring.
		expect(item(node, 'frame:a')).toBeUndefined();
		const halo = node.children.find((n) => n.tag === 'circle' && n.attrs.fill === DEFAULT_LIGHT.background && Number(n.attrs.r) === rp.haloR)!;
		expect(Number(halo.attrs.cx)).toBeCloseTo(box.x + roundelAxis(geo), 9);
		expect(Number(halo.attrs.cy)).toBeCloseTo(box.y + rp.cy, 9);
		// The gap is under the picture, and the picture reaches the outer radius of the old ring.
		expect(node.children.indexOf(halo)).toBeLessThan(node.children.indexOf(portrait));
		expect(Number(portrait.attrs.width) / 2).toBeCloseTo(rp.ringR, 9);
		expect(rp.haloR - rp.ringR).toBeCloseTo(ROUNDEL_EM.halo * 12, 9);
	});

	it('the Full level only: one picture for each portrait that shows and a frame only for one that does not (no second group for the Compact level)', () => {
		const svg = svgOf(lay(ROUNDEL, { relationLine: true }));
		const items = nodes(parseSvg(svg)).flatMap((n) => (n.attrs['data-item'] ? [n.attrs['data-item']] : []));
		expect(items.filter((x) => x === 'frame:a')).toHaveLength(0);
		expect(nodes(parseSvg(svg)).filter((n) => n.tag === 'image')).toHaveLength(items.filter((x) => /^(arms|portrait):/.test(x)).length);
		// A missing file: the dashed frame on the picture's edge with a grey inside, as the scene's frame.
		const missing = item(cardNode(svg, 'c'), 'frame:c')!;
		expect(Number(missing.attrs.r)).toBeCloseTo(roundelPics(lay(ROUNDEL, { relationLine: true }).layout.geometry, { arms: false, portrait: true }).ringR - 0.5, 9);
		expect(missing.attrs['stroke-width']).toBe('1');
		expect(missing.attrs.stroke).toBe(DEFAULT_LIGHT.textMuted);
		expect(missing.attrs['stroke-dasharray']).toBe('3 2');
		expect(missing.attrs.fill).toBe(DEFAULT_LIGHT.cardBorder);
	});

	it('arms with no portrait stand in the medallion place, the size of roundelPics', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const box = laid.layout.persons.get('b')!;
		const rp = roundelPics(laid.layout.geometry, { arms: true, portrait: false });
		const arms = item(cardNode(svgOf(laid), 'b'), 'arms:b')!;
		expect([Number(arms.attrs.x), Number(arms.attrs.y), Number(arms.attrs.width), Number(arms.attrs.height)]).toEqual([box.x + rp.arms!.x, box.y + rp.arms!.y, rp.arms!.w, rp.arms!.h]);
	});

	it('a sideways tree has no <image>, no portrait or arms item and no circle on a card, whatever the picture map holds', () => {
		for (const over of [{ relationLine: true }, { youTab: 'c' }] as Partial<LayoutSettings>[]) {
			const laid = lay(TEXT, over);
			expect(laid.layout.persons.get('a')!.arms).toBeUndefined();
			const svg = svgOf(laid);
			const all_ = nodes(parseSvg(svg));
			expect(all_.some((n) => n.tag === 'image')).toBe(false);
			expect(all_.some((n) => /^(arms|portrait|frame):/.test(n.attrs['data-item'] ?? ''))).toBe(false);
			for (const id of ['a', 'b', 'c', 'd', 'e']) expect(cardNode(svg, id).children.some((n) => n.tag === 'circle' || n.tag === 'clipPath'), id).toBe(false);
		}
	});

	it('the text card keeps its text left, the relation word at the text\'s left edge', () => {
		const laid = lay(TEXT, { relationLine: true });
		const svg = svgOf(laid);
		const box = laid.layout.persons.get('d')!;
		const t = cardText(laid.layout.geometry, 1, false, { title: false, dates: false });
		const word = textsOf(cardNode(svg, 'd')).find((n) => textIn(n) === 'Half-sister')!;
		expect(Number(word.attrs.x)).toBe(box.x + 0.875 * 12);
		expect(word.attrs['text-anchor']).toBeUndefined();
		expect(Number(word.attrs.y)).toBeCloseTo(box.y + t.relationBaseline!, 9);
	});
});

describe('the saved look equals the numbers in styles.css (the block under /* roundel: card */)', () => {
	const raw = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');
	const block = raw.slice(raw.indexOf('/* roundel: card */'), raw.indexOf('/* C: phone list */')).replace(/\/\*[\s\S]*?\*\//g, '');
	const rule = (selector: string): Record<string, string> => {
		const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(block);
		if (!m) throw new Error(`no rule ${selector}`);
		return Object.fromEntries(
			m[1]
				.split(';')
				.map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as const)
				.filter(([k]) => k),
		);
	};

	it('the foot hairline and the tabs', () => {
		expect(Number(rule('.dynasty-card-foot-line')['stroke-width'])).toBe(1);
		expect(rule('.dynasty-card-foot-line').stroke).toBe('var(--background-modifier-border)');
		expect(Number(rule('.dynasty-r1-tab-base,\n.dynasty-ordinal-tab-base')['stroke-width'])).toBe(HEIR_LOOK.tabBase);
		expect(Number(rule('.dynasty-r1-tab,\n.dynasty-ordinal-tab')['stroke-width'])).toBe(HEIR_LOOK.tabBorder);
		expect(rule('.dynasty-r1-tab-text,\n.dynasty-ordinal-tab-text')['font-size']).toBe(`calc(var(--dynasty-font-size) * ${TAB_TEXT_EM})`);
		expect(rule('.dynasty-r1-tab-text,\n.dynasty-ordinal-tab-text').fill).toBe('var(--text-normal)');
	});

	it('D219: the style has no house-colour ring; the frame of an empty portrait is as wide as the saved picture draws it, and a portrait that shows has no frame', () => {
		expect(block).not.toContain('dynasty-portrait-frame');
		const plain = raw.replace(/\/\*[\s\S]*?\*\//g, '');
		expect(/\.dynasty-portrait-frame \{[^}]*stroke-width: 1;/.test(plain)).toBe(true);
		expect(FRAME_STROKE_PX).toBe(1);
		expect(/\.dynasty-portrait\.has-picture \.dynasty-portrait-frame \{[^}]*stroke: none;/.test(plain)).toBe(true);
	});
});
