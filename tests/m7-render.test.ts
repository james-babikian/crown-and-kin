import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import type { FinderResult, Relation, RelationStep } from '../src/core/relations';
import { cardText, geometryFor, relationY } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { buildScene, type SceneOptions } from '../src/render/dom/scene';
import { lineLook, type LineMarks } from '../src/render/line-highlight';
import { DEFAULT_DARK, DEFAULT_LIGHT, FADED_OPACITY, ME_LOOK, ON_LINE_EXTRA, STROKES } from '../src/render/styles';
import { renderSvg } from '../src/render/svg-string';
import { cardLabel, finderSentence, relationSummary, stepSentences } from '../src/render/tree-info';
import { FEl, installDom } from './acceptance/fake-dom';
import { build, fixture } from './helpers';

// WP7.2 (spec §13.1, §13.2; D40, D41, D47): the relation text on cards, the marked card, the relation
// finder's line in the scene and in the headless SVG, and the finder's sentences. The relation maps and
// lines here are hand-made from §13.1 (WP7.1 builds the real ones).

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const GEO = geometryFor(16);
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55);
const fonts = { text: 'serif', ui: 'sans', bold: '700' };
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const cls = (el: FEl) => [...el.classes];

const lay = (g: FamilyGraph, settings: LayoutSettings = DEFAULT_LAYOUT_SETTINGS): LaidOut => {
	clearLayoutCache();
	return layoutTree(g, GEO, settings, 'test');
};
function scene(g: FamilyGraph, laid: LaidOut, extra: Partial<SceneOptions> = {}) {
	const root = new FEl('g');
	const s = buildScene(root as unknown as SVGGElement, g, laid, { fonts, measure, link: () => null, ...extra });
	return { root, s };
}
const cardEl = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;

/** A relation as `computeRelations` gives it (only `text` and `lower` matter here). */
const rel = (text: string): { text: string; lower: string } => ({ text, lower: text.toLowerCase() });

/** Sample tree 3 with Conrad marked, names by §13.1 (hand-made). */
const CONRAD = new Map([
	['conrad', rel('You')],
	['aurel', rel('Grandfather')],
	['viviane', rel('Grandmother')],
	['bastien', rel('Father')],
	['rosamund', rel('Mother')],
	['giselle', rel('Aunt')],
	['stefan', rel('Uncle by marriage')],
	['blanche', rel('Sister')],
	['lisette', rel('Wife')],
	['ulric', rel('Brother-in-law')],
	['tristan', rel('Son')],
]);

/** The finder's line from Conrad to his first cousin Ulric (§13.2 "The line shown"; contract line rules). */
const COUSIN: LineMarks = {
	people: new Set(['conrad', 'bastien', 'aurel', 'viviane', 'giselle', 'ulric']),
	unions: new Set(['u0']),
	links: new Set(['bastien\0conrad', 'aurel\0bastien', 'viviane\0giselle', 'giselle\0ulric']),
	fade: true,
};

describe('D47: lineLook marks the finder\'s line (design-gate rules)', () => {
	const { g } = build(fixture('03'));
	const laid = lay(g);
	const look = lineLook(g, laid.layout, laid.edges, COUSIN);
	const on = look.paths.filter((p) => p.state === 'on');
	const faded = look.paths.filter((p) => p.state === 'faded');

	it('without a line every part is drawn as before, in the same order', () => {
		const plain = lineLook(g, laid.layout, laid.edges);
		expect(plain.paths).toEqual(laid.edges.paths.map((p) => ({ d: p.d, kind: p.kind, state: undefined })));
		expect(plain.markers.every((m) => m === undefined)).toBe(true);
		expect(plain.card('conrad')).toBeUndefined();
	});

	it('the pieces cover every line exactly once, the ones on the line last', () => {
		expect(look.paths.length).toBe(on.length + faded.length);
		expect(look.paths.slice(-on.length).every((p) => p.state === 'on')).toBe(true);
		const len = (d: string) => [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)([HV])(-?[\d.]+)/g)].reduce((s, m) => s + Math.abs(Number(m[4]) - Number(m[m[3] === 'H' ? 1 : 2])), 0);
		const total = (ds: string[]) => ds.reduce((s, d) => s + len(d), 0);
		expect(total(look.paths.map((p) => p.d))).toBeCloseTo(total(laid.edges.paths.map((p) => p.d)), 6);
	});

	it('a bar of a union on the line is on; a bar that only carries a parent link is on from that partner to the sign', () => {
		const bar = (u: string) => laid.edges.paths.find((p) => p.union === u && p.parents === undefined)!;
		expect(on.map((p) => p.d)).toContain(bar('u0').d);
		// Bastien is the left partner of u1: from his card's edge to the u1 sign only.
		const u1 = laid.edges.markers.find((m) => m.union === 'u1')!;
		const b1 = /M([\d.]+) ([\d.]+)H([\d.]+)/.exec(bar('u1').d)!;
		expect(on.map((p) => p.d)).toContain(`M${b1[1]} ${b1[2]}H${u1.x}`);
		expect(faded.map((p) => p.d)).toContain(`M${u1.x} ${b1[2]}H${b1[3]}`);
		// Giselle is the right partner of u2 (Stefan married in on her left).
		const u2 = laid.edges.markers.find((m) => m.union === 'u2')!;
		const b2 = /M([\d.]+) ([\d.]+)H([\d.]+)/.exec(bar('u2').d)!;
		expect(on.map((p) => p.d)).toContain(`M${u2.x} ${b2[2]}H${b2[3]}`);
		expect(faded.map((p) => p.d)).toContain(`M${b2[1]} ${b2[2]}H${u2.x}`);
	});

	it('a trunk is on to the drops of the children on the line only; drops follow their links', () => {
		const trunk = laid.edges.paths.find((p) => p.union === 'u1' && p.parents?.length === 2 && p.child === undefined)!;
		const [, fx, fy, by, lo, , hi] = /M([\d.]+) ([\d.]+)V([\d.]+)M([\d.]+) ([\d.]+)H([\d.]+)/.exec(trunk.d)!;
		const conradDrop = laid.edges.paths.find((p) => p.child === 'conrad')!;
		const cx = /M([\d.]+)/.exec(conradDrop.d)![1];
		expect(on.map((p) => p.d)).toContain(`M${fx} ${fy}V${by}`);
		expect(on.map((p) => p.d)).toContain(`M${cx} ${by}H${fx}`);
		expect(faded.map((p) => p.d)).toContain(`M${fx} ${by}H${hi}`);
		expect(Number(lo)).toBe(Number(cx));
		const stateOf = (child: string) => look.paths.find((p) => p.d === laid.edges.paths.find((q) => q.child === child)!.d)!.state;
		expect(['conrad', 'bastien', 'giselle', 'ulric'].map(stateOf)).toEqual(['on', 'on', 'on', 'on']);
		expect(['blanche', 'lisette', 'tristan'].map(stateOf)).toEqual(['faded', 'faded', 'faded']);
		// The u3 trunk and legs (Conrad and Lisette's marriage) are not on the line.
		for (const p of laid.edges.paths.filter((q) => q.union === 'u3')) expect(look.paths.find((x) => x.d === p.d)!.state).toBe('faded');
	});

	it('union signs: on if the union is on the line or its bar part or leg is; cards beside the line fade', () => {
		const state = (u: string) => look.markers[laid.edges.markers.findIndex((m) => m.union === u)];
		expect(['u0', 'u1', 'u2', 'u3'].map(state)).toEqual(['on', 'on', 'on', 'faded']);
		for (const id of COUSIN.people) expect(look.card(id)).toBeUndefined();
		for (const id of ['rosamund', 'stefan', 'blanche', 'lisette', 'tristan']) expect(look.card(id)).toBe('faded');
	});

	it('the line-only tree (no fade) leaves the rest as usual', () => {
		const l = lineLook(g, laid.layout, laid.edges, { ...COUSIN, fade: false });
		expect(l.paths.filter((p) => p.state === 'faded')).toHaveLength(0);
		expect(l.paths.filter((p) => p.state === 'on')).toEqual(on);
		expect(l.card('tristan')).toBeUndefined();
	});

	it('sideways: the same parts are on, turned', () => {
		const side = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' });
		const s = lineLook(g, side.layout, side.edges, COUSIN);
		const onLen = (ps: { d: string; state: unknown }[]) => ps.filter((p) => p.state === 'on').length;
		expect(onLen(s.paths)).toBe(on.length);
		expect(s.markers).toEqual(look.markers);
		// Every on piece of a turned trunk is a vertical or a horizontal run of the original trunk's bar or stem.
		for (const p of s.paths.filter((x) => x.state === 'on')) expect(p.d).toMatch(/^(M-?[\d.]+ -?[\d.]+[HV]-?[\d.]+)+$/);
	});
});

describe('D47: far couples, legs and rumour marks on the line', () => {
	// Cedric and Fay each have a sibling beside them, so they are not side by side: a rule of 0 card
	// widths makes them a far couple with tags.
	const src = `people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: c, name: Cedric, parents: [a, b]}
  - {id: c2, name: C2, parents: [a, b]}
  - {id: d, name: D}
  - {id: e, name: E}
  - {id: f0, name: F0, parents: [d, e]}
  - {id: f, name: Fay, parents: [d, e]}
  - {id: k, name: Kit, parents: [c, f]}
  - {id: r, name: Rumour, parents: [d, {id: g, type: rumoured}]}
  - {id: g, name: Gareth}
unions:
  - {partners: [a, b]}
  - {partners: [d, e]}
  - {partners: [c, f]}
`;
	const { g } = build(src);
	const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, far: { maxCardWidths: 0, maxGenerations: 1 } });
	const cf = g.unions.find((u) => u.partners.includes('c') && u.partners.includes('f'))!.key;

	it('the far couple has tags (test set-up)', () => {
		expect(laid.layout.unions.get(cf)!.far).toBe(true);
		expect([...laid.layout.farTags.keys()].sort()).toEqual(['c', 'f']);
	});

	it('a far marriage on the line: both tags, the anchor\'s leg and the sign are on', () => {
		const look = lineLook(g, laid.layout, laid.edges, { people: new Set(['c', 'f']), unions: new Set([cf]), links: new Set(), fade: true });
		expect(look.tag(laid.layout.farTags.get('c')!)).toBe('on');
		expect(look.tag(laid.layout.farTags.get('f')!)).toBe('on');
		const leg = laid.edges.paths.find((p) => p.union === cf && p.parents?.length === 1)!;
		expect(look.paths.find((p) => p.d === leg.d)!.state).toBe('on');
		expect(look.markers[laid.edges.markers.findIndex((m) => m.union === cf)]).toBe('on');
	});

	it('a parent link through a far couple\'s sign: the leg from that parent and the sign are on, the tags are not', () => {
		const leg = laid.edges.paths.find((p) => p.union === cf && p.parents?.length === 1)!;
		const x = leg.parents![0];
		const look = lineLook(g, laid.layout, laid.edges, { people: new Set([x, 'k']), unions: new Set(), links: new Set([`${x}\0k`]), fade: true });
		expect(look.paths.find((p) => p.d === leg.d)!.state).toBe('on');
		expect(look.markers[laid.edges.markers.findIndex((m) => m.union === cf)]).toBe('on');
		expect(look.tag(laid.layout.farTags.get(x)!)).toBe('faded');
		expect(look.paths.find((p) => p.d === laid.edges.paths.find((q) => q.child === 'k')!.d)!.state).toBe('on');
	});

	it('a parent link from the other partner of a far couple: its tag, the anchor\'s tag, the anchor\'s leg and the sign are on (M7 fix round)', () => {
		const leg = laid.edges.paths.find((p) => p.union === cf && p.parents?.length === 1)!;
		const anchor = leg.parents![0];
		const x = anchor === 'c' ? 'f' : 'c';
		const look = lineLook(g, laid.layout, laid.edges, { people: new Set([x, 'k']), unions: new Set(), links: new Set([`${x}\0k`]), fade: true });
		expect(look.paths.find((p) => p.d === leg.d)!.state).toBe('on');
		expect(look.markers[laid.edges.markers.findIndex((m) => m.union === cf)]).toBe('on');
		expect(look.tag(laid.layout.farTags.get(x)!)).toBe('on');
		expect(look.tag(laid.layout.farTags.get(anchor)!)).toBe('on');
		// The anchor is not on the line: its card fades, only its tag and leg carry the line.
		expect(look.card(anchor)).toBe('faded');
	});

	it('the "?" of a rumoured parent follows its line', () => {
		const i = laid.edges.markers.findIndex((m) => m.kind === 'rumour');
		const on = lineLook(g, laid.layout, laid.edges, { people: new Set(['g', 'r']), unions: new Set(), links: new Set(['g\0r']), fade: true });
		const off = lineLook(g, laid.layout, laid.edges, { people: new Set(['d', 'r']), unions: new Set(), links: new Set(['d\0r']), fade: true });
		expect(on.markers[i]).toBe('on');
		expect(off.markers[i]).toBe('faded');
	});
});

describe('D47: two legs from one side (M7 fix round)', () => {
	// Random tree 47: P7's leg stops on P2's leg (edges.ts), short of the sign of their implicit union. (Tree 2 had this until N05: its dot now lies
	// between the legs. Partners in one row without a bar still meet the dot from one side.)
	it('the nearer leg is split: its last run to the sign is on, the rest keeps its state', async () => {
		const { randomTree } = await import('./random-trees');
		const { g } = build(randomTree(47));
		const laid = lay(g);
		const key = g.primaryUnion.get('p8')!;
		const legs = laid.edges.paths.filter((p) => p.union === key && p.parents?.length === 1);
		const far = legs.find((p) => p.parents![0] === 'p7')!;
		const near = legs.find((p) => p.parents![0] !== 'p7')!;
		const look = lineLook(g, laid.layout, laid.edges, { people: new Set(['p7', 'p8']), unions: new Set(), links: new Set(['p7\0p8']), fade: true });
		const dot = laid.edges.markers.find((m) => m.union === key)!;
		const [, head, x] = /^(.*)H(-?[\d.]+)$/.exec(near.d)!;
		expect(Number(x)).toBeCloseTo(dot.x, 1);
		const from = Number(/H(-?[\d.]+)$/.exec(far.d)![1]);
		expect(look.paths.find((p) => p.d === far.d)!.state).toBe('on');
		expect(look.paths.find((p) => p.d === head)!.state).toBe('faded');
		const y = Number(/V(-?[\d.]+)$/.exec(head)![1]);
		expect(look.paths.find((p) => p.d === `M${from} ${y}H${Number(x)}`)!.state).toBe('on');
		expect(look.paths.some((p) => p.d === near.d)).toBe(false);
		expect(look.markers[laid.edges.markers.indexOf(dot)]).toBe('on');
		// With the nearer partner on the line, the leg is whole again.
		const both = lineLook(g, laid.layout, laid.edges, { people: new Set(['p2', 'p7', 'p8']), unions: new Set([key]), links: new Set(), fade: true });
		expect(both.paths.find((p) => p.d === near.d)!.state).toBe('on');
	});
});

describe('D40, D41: the scene draws the relation text and the marked card', () => {
	const { g } = build(fixture('03'));
	const on = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true });

	it('each card has its relation on the relation line; "You" on the marked card, which has the class', () => {
		const { root } = scene(g, on, { relations: CONRAD, me: 'conrad' });
		const t = cardText(on.layout.geometry);
		for (const [id, r] of CONRAD) {
			const card = cardEl(root, id);
			const text = all(card).filter((e) => e.hasClass('dynasty-card-relation'));
			expect(text, id).toHaveLength(1);
			expect(text[0].text).toBe(r.text);
			expect(Number(text[0].getAttribute('y'))).toBeCloseTo(on.layout.persons.get(id)!.y + relationY(t)!, 6);
			// Inside the Full level of detail only (spec §5.4: Compact and Overview do not show it).
			expect(all(card).find((e) => e.hasClass('dynasty-card-full'))!.children).toContain(text[0]);
			expect(card.hasClass('dynasty-card-me')).toBe(id === 'conrad');
			// D153: the mark is the border alone; no second ring element.
			expect(all(card).some((e) => e.hasClass('dynasty-card-me-ring'))).toBe(false);
		}
		// Aurel has a title and dates: the third small line. Rosamund has only dates: the second.
		expect(relationY(t)).toBe(t.relationBaseline);
		for (const e of all(root)) expect(e.attrs.has('fill') || e.attrs.has('stroke') || e.attrs.has('style')).toBe(false);
	});

	it('a relation too long for the card ends with "…"', () => {
		const long = new Map([['conrad', rel("Great-grandfather's first cousin twice removed by marriage")]]);
		const { root } = scene(g, on, { relations: long });
		const text = all(cardEl(root, 'conrad')).find((e) => e.hasClass('dynasty-card-relation'))!;
		expect(text.text.endsWith('…')).toBe(true);
		expect(measure(text.text, 'italic 400 13.6px serif')).toBeLessThanOrEqual(cardText(on.layout.geometry).textW);
	});

	it('the screen-reader label adds the relation in lower case, and "you" on the marked card', () => {
		const { root } = scene(g, on, { relations: CONRAD, me: 'conrad' });
		expect(cardEl(root, 'blanche').getAttribute('aria-label')).toBe(`${cardLabel(g.byId.get('blanche')!)}, sister`);
		expect(cardEl(root, 'conrad').getAttribute('aria-label')).toBe(`${cardLabel(g.byId.get('conrad')!)}, you`);
		expect(cardLabel(g.byId.get('blanche')!, 'sister')).toBe('Blanche Castellane, b. 1095, sister');
		// The marked card says "you" also with no relation texts at all.
		const bare = scene(g, on, { me: 'conrad' }).root;
		expect(cardEl(bare, 'conrad').getAttribute('aria-label')).toBe('Conrad Castellane, b. 1092, you');
		expect(all(bare).some((e) => e.hasClass('dynasty-card-relation'))).toBe(false);
	});

	it('with the D14 sign the label keeps both', () => {
		const src = `people:\n  - {id: w, name: Wren, born: '1135', illegitimate: true}\n`;
		const b = build(src).g;
		const { root } = scene(b, lay(b, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true }), { relations: new Map([['w', rel('Half-sister')]]) });
		expect(cardEl(root, 'w').getAttribute('aria-label')).toBe('Wren, b. 1135, half-sister, illegitimate');
	});

	it('without the M7 options the scene has no M7 classes and the labels are as before', () => {
		const plain = lay(g);
		const { root } = scene(g, plain);
		const names = all(root).flatMap(cls);
		for (const c of ['dynasty-card-relation', 'dynasty-card-me', 'dynasty-card-me-ring', 'dynasty-on-line', 'dynasty-faded']) expect(names).not.toContain(c);
		expect(cardEl(root, 'conrad').getAttribute('aria-label')).toBe(cardLabel(g.byId.get('conrad')!));
		// A card with no relation line draws no relation text, even when given one.
		const { root: r2 } = scene(g, plain, { relations: CONRAD });
		expect(all(r2).some((e) => e.hasClass('dynasty-card-relation'))).toBe(false);
	});
});

describe('D47: the scene marks the finder\'s line', () => {
	const { g } = build(fixture('03'));
	const laid = lay(g);

	it('lines, signs and cards take the classes lineLook gives them; cards keep their border', () => {
		const { root } = scene(g, laid, { line: COUSIN });
		const look = lineLook(g, laid.layout, laid.edges, COUSIN);
		const paths = all(root).filter((e) => e.hasClass('dynasty-line'));
		expect(paths.map((e) => e.getAttribute('d'))).toEqual(look.paths.map((p) => p.d));
		expect(paths.filter((e) => e.hasClass('dynasty-on-line')).length).toBe(look.paths.filter((p) => p.state === 'on').length);
		expect(paths.filter((e) => e.hasClass('dynasty-faded')).length).toBe(look.paths.filter((p) => p.state === 'faded').length);
		const signs = all(root).filter((e) => e.hasClass('dynasty-union-dot'));
		expect(signs.map((e) => e.hasClass('dynasty-on-line'))).toEqual([true, true, true, false]);
		expect(cardEl(root, 'tristan').hasClass('dynasty-faded')).toBe(true);
		expect(cardEl(root, 'conrad').hasClass('dynasty-faded')).toBe(false);
		expect(all(root).some((e) => e.hasClass('dynasty-card') && e.hasClass('dynasty-on-line'))).toBe(false);
	});

	it('far-couple tags on the line and beside it', () => {
		const src = `people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: c, name: Cedric, parents: [a, b]}
  - {id: c2, name: C2, parents: [a, b]}
  - {id: d, name: D}
  - {id: e, name: E}
  - {id: f0, name: F0, parents: [d, e]}
  - {id: f, name: Fay, parents: [d, e]}
unions:
  - {partners: [a, b]}
  - {partners: [d, e]}
  - {partners: [c, f]}
`;
		const b = build(src).g;
		const far = lay(b, { ...DEFAULT_LAYOUT_SETTINGS, far: { maxCardWidths: 0, maxGenerations: 1 } });
		const { root } = scene(b, far, { line: { people: new Set(['c', 'f']), unions: new Set(['u2']), links: new Set(), fade: true } });
		const tags = all(root).filter((e) => e.hasClass('dynasty-tag'));
		expect(tags).toHaveLength(2);
		for (const t of tags) expect(t.hasClass('dynasty-on-line')).toBe(true);
		const { root: other } = scene(b, far, { line: { people: new Set(['a', 'c']), unions: new Set(), links: new Set(['a\0c']), fade: true } });
		for (const t of all(other).filter((e) => e.hasClass('dynasty-tag'))) expect(t.hasClass('dynasty-faded')).toBe(true);
	});
});

describe('the headless SVG draws the same (spike pictures)', () => {
	const { g } = build(fixture('03'));

	it('without the M7 options the output is as before', () => {
		const laid = lay(g);
		const plain = renderSvg(g, laid.layout, laid.edges);
		expect(renderSvg(g, laid.layout, laid.edges, { relations: undefined, me: undefined, line: undefined })).toBe(plain);
		expect(plain).not.toContain(DEFAULT_LIGHT.accent);
		expect(plain).not.toContain('opacity="0.25"');
	});

	it('relation texts, the marked card (text colour, D153), and the line in the accent colour', () => {
		const on = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true });
		for (const palette of [DEFAULT_LIGHT, DEFAULT_DARK]) {
			const svg = renderSvg(g, on.layout, on.edges, { palette, relations: CONRAD, me: 'conrad', line: COUSIN });
			// D117: every relation text is italic, "You" too (bold and italic).
			expect(svg.match(/font-style="italic"/g)).toHaveLength(CONRAD.size);
			expect(svg).toContain(`font-style="italic" font-weight="600" fill="${palette.text}">You</text>`);
			expect(svg).toContain(`stroke="${palette.text}" stroke-width="${ME_LOOK.border}"`);
			const onPaths = svg.match(new RegExp(`<path d="[^"]*" fill="none" stroke="${palette.accent}" stroke-width="${STROKES.marriage.width + ON_LINE_EXTRA}"`, 'g')) ?? [];
			expect(onPaths.length).toBeGreaterThan(0);
			expect(svg).toContain(`opacity="${FADED_OPACITY}"`);
		}
	});
});

describe('styles.css: the M7 looks use theme variables and match styles.ts', () => {
	const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const rule = (selector: string): Record<string, string> | null => {
		const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
		const body = re.exec(css)?.[2];
		if (body === undefined) return null;
		return Object.fromEntries(
			body
				.split(';')
				.map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()])
				.filter(([k]) => k),
		);
	};

	it.each(Object.entries(STROKES))('.dynasty-line-%s.dynasty-on-line is thicker by ON_LINE_EXTRA', (kind, s) => {
		expect(Number(rule(`.dynasty-line-${kind}.dynasty-on-line`)?.['stroke-width'])).toBe(s.width + ON_LINE_EXTRA);
	});

	it('the line, signs, tags, faded parts, relation text and marked card', () => {
		expect(rule('.dynasty-line.dynasty-on-line')).toEqual({ stroke: 'var(--interactive-accent)', 'stroke-opacity': '1' });
		expect(rule('.dynasty-union-dot.dynasty-on-line')).toEqual({ fill: 'var(--interactive-accent)' });
		expect(rule('.dynasty-tag.dynasty-on-line .dynasty-tag-pill')!.stroke).toBe('var(--interactive-accent)');
		expect(Number(rule('.dynasty-faded')!.opacity)).toBe(FADED_OPACITY);
		expect(rule('.dynasty-card-relation')).toEqual({ 'font-size': 'calc(var(--dynasty-font-size) * 0.85)', 'font-style': 'italic', fill: 'var(--dynasty-muted, var(--text-muted))' });
		expect(rule('.dynasty-card-me .dynasty-card-relation')).toEqual({ 'font-style': 'italic', 'font-weight': 'var(--bold-weight, 600)', fill: 'var(--text-normal)' });
		expect(rule('.dynasty-no-relations .dynasty-card-relation')).toBeNull();
		expect(rule('.dynasty-card-me .dynasty-card-bg')).toEqual({ stroke: 'var(--text-normal)', 'stroke-width': String(ME_LOOK.border) });
		expect(rule('.dynasty-card-me-ring')).toBeNull();
		// No fixed colours in the M7 rules (spec §5.8).
		const m7 = css.slice(css.indexOf('.dynasty-card-relation {'), css.indexOf('.dynasty-faded {') + 40);
		expect(m7).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
	});
});

describe('RelationTexts: the finder and sheet sentences (spec §13.1, §13.2)', () => {
	const { g } = build(`people:
  - {id: rod, name: Roderick}
  - {id: wren, name: Wren}
  - {id: isolde, name: Isolde}
  - {id: gareth, name: Gareth}
  - {id: mira, name: Mira}
  - {id: noname, name: ''}
`);
	const r = (text: string, lower = text.toLowerCase()): Relation => ({ text, lower, kind: 'blood', distance: 2, line: { people: [], links: [], unions: [] } });

	it('a named relation: "Wren is Roderick\'s half-sister."; "Other relation" picks by index', () => {
		const res: FinderResult = { kind: 'named', first: 'rod', second: 'wren', relations: [{ relation: r('Half-sister'), steps: [] }, { relation: r('Wife'), steps: [] }] };
		expect(finderSentence(g, res, 0)).toBe("Wren is Roderick’s half-sister.");
		expect(finderSentence(g, res, 1)).toBe("Wren is Roderick’s wife.");
		expect(finderSentence(g, res, 7)).toBe("Wren is Roderick’s wife.");
		expect(finderSentence(g, { ...res, first: 'noname' }, 0)).toBe("Wren is noname’s half-sister.");
	});

	it('a chain and no relation', () => {
		const line = { people: ['rod', 'isolde', 'gareth', 'mira'], links: [], unions: [] };
		expect(finderSentence(g, { kind: 'chain', first: 'rod', second: 'mira', steps: [], line }, 0)).toBe('Roderick and Mira have a relation through 2 other people.');
		expect(finderSentence(g, { kind: 'chain', first: 'rod', second: 'mira', steps: [], line: { ...line, people: ['rod', 'isolde', 'mira'] } }, 0)).toBe('Roderick and Mira have a relation through 1 other person.');
		expect(finderSentence(g, { kind: 'none', first: 'rod', second: 'mira' }, 0)).toBe('Roderick and Mira have no relation in this tree.');
	});

	it('step sentences: at most 8, then the count of the others', () => {
		const steps: RelationStep[] = [
			{ person: 'isolde', of: 'rod', word: 'wife' },
			{ person: 'gareth', of: 'isolde', word: 'brother' },
			{ person: 'mira', of: 'gareth', word: 'daughter' },
		];
		expect(stepSentences(g, steps)).toEqual({ shown: ["Isolde is Roderick’s wife.", "Gareth is Isolde’s brother.", "Mira is Gareth’s daughter."], more: 0 });
		const twelve = Array.from({ length: 12 }, () => steps[0]);
		const out = stepSentences(g, twelve);
		expect(out.shown).toHaveLength(8);
		expect(out.more).toBe(4);
	});

	it('the sheet\'s summary', () => {
		expect(relationSummary(undefined, true)).toEqual({ main: 'This is you.' });
		expect(relationSummary(undefined, false)).toEqual({ main: 'No relation to you in this tree.' });
		expect(relationSummary([], false)).toEqual({ main: 'No relation to you in this tree.' });
		expect(relationSummary([r('Second cousin')], false)).toEqual({ main: 'Relation to you: Second cousin.' });
		expect(relationSummary([r('Wife'), r('First cousin')], false)).toEqual({ main: 'Relation to you: Wife.', also: 'Also: first cousin.' });
		expect(relationSummary([r('Wife'), r('Brother-in-law'), r('Third cousin'), r('Fourth cousin')], false).also).toBe('Also: brother-in-law, third cousin, fourth cousin.');
		expect(relationSummary([r('Wife'), r('A'), r('B'), r('C'), r('D'), r('E')], false).also).toBe('Also: a, b, c, and 2 more.');
	});
});
