import { Resvg } from '@resvg/resvg-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import { fixedColour, savedLegend } from '../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { installDom } from './acceptance/fake-dom';

// M9 fix round, render part (the decision notes M9 review R1, R2): the saved SVG drops the characters XML
// forbids, and draws a house colour only when it is a fixed colour.

beforeAll(() => {
	installDom();
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const GEO = geometryFor(16);
// Built with fromCharCode so no editor or tool turns them into raw characters in this file.
const CONTROL = [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0xfffe, 0xffff].map((n) => String.fromCharCode(n));
const NOT_XML = new RegExp(`[${CONTROL.join('')}]|[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]`);

function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

function draw(g: FamilyGraph, save: boolean, heading = 'Tree'): string {
	clearLayoutCache();
	const laid = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) }, 'test');
	return renderSvg(g, laid.layout, laid.edges, {
		palette: DEFAULT_LIGHT,
		dark: false,
		...(save ? { measure: approxMeasure, fonts: FONTS, saved: { heading, legend: savedLegend(g, laid), pictures: new Map(), scale: 1 } } : {}),
	});
}

const houseSource = (color: string) => `houses:
  - {id: v, name: House Valmont, color: "${color}"}
people:
  - {id: a, name: Aldric Valmont, house: v}
`;

/** The fill of the card strip (the second rect of the card group) and of the legend strip. */
function strips(svg: string): { card?: string; legend?: string } {
	// 0.2.8: the card's house colour is the fill of its ribbon, the path after the two rects (or after the one rect of a card with no heir ring).
	const card = /<g [^>]*data-item="card:a"[^>]*>\s*<rect [^>]*\/>\s*<path [^>]*fill="([^"]*)"/.exec(svg)?.[1];
	const legend = /<g [^>]*data-item="legend-house:v">\s*<rect [^>]*fill="([^"]*)"/.exec(svg)?.[1];
	return { card, legend };
}

describe('R1: the saved SVG has no character that XML forbids', () => {
	it('drops every forbidden character from names, house names, titles and the heading, and keeps tab-free text whole', () => {
		const g = graphOf(houseSource('#8b1e3f'));
		const odd = CONTROL.join('');
		const person = g.byId.get('a')!;
		(person as { name: string }).name = `Ald${odd}ric`;
		(person as { title?: string }).title = `Duke${odd} of Valmont`;
		(g.houses.get('v') as { name: string }).name = `House${odd} Valmont`;
		const svg = draw(g, true, `Val${odd}mont`);
		expect(NOT_XML.test(svg)).toBe(false);
		expect(svg).toContain('>Aldric<');
		expect(svg).toContain('>Duke of Valmont<');
		expect(svg).toContain('>House Valmont<');
		expect(svg).toContain('>Valmont<');
		expect(() => new Resvg(svg).render()).not.toThrow();
	});

	it('keeps tab, line feed and carriage return, which XML allows, and still escapes markup', () => {
		const g = graphOf(houseSource('#8b1e3f'));
		(g.byId.get('a') as { name: string }).name = 'A & <B> "C"';
		const svg = draw(g, true, 'Tab\there');
		expect(svg).toContain('A &amp; &lt;B&gt; &quot;C&quot;');
		expect(svg).toContain('>Tab\there<');
	});
});

describe('R2: fixedColour', () => {
	const fixed = [
		'#abc', '#ABCD', '#8b1e3f', '#8b1e3f80',
		'rgb(10, 20, 30)', 'rgba(10, 20, 30, 0.5)', 'RGB(10%, 20%, 30%)', 'rgb(10 20 30)', 'rgb(10 20 30 / 50%)', 'rgba(1,2,3,.5)',
		'hsl(120, 50%, 50%)', 'hsla(120deg, 50%, 50%, 0.3)', 'hsl(120 50% 50% / 0.5)',
		'red', 'Red', 'rebeccapurple', 'darkslategrey', ' teal ',
	];
	for (const c of fixed) it(`"${c}" is fixed`, () => expect(fixedColour(c)).toBe(c.trim()));
	const notFixed = [
		undefined, '', 'banana', 'var(--color-red)', 'currentcolor', 'transparent', 'inherit', 'Canvas',
		'#ab', '#abcde', '#ggg', 'rgb(10, 20)', 'rgb(var(--r), 0, 0)', 'rgb(10, 20 30)', 'rgb(none 20 30)',
		'hsl(calc(10), 50%, 50%)', 'color-mix(in srgb, red, blue)', 'oklch(0.5 0.1 20)', 'red; stroke: blue',
	];
	for (const c of notFixed) it(`${JSON.stringify(c)} is not fixed`, () => expect(fixedColour(c)).toBeUndefined());
});

describe('R2: the saved picture draws only fixed house colours', () => {
	it('a hex colour of 3 or 6 digits keeps the strip colour rule; other fixed colours go in as written', () => {
		expect(strips(draw(graphOf(houseSource('#8b1e3f')), true))).toEqual({ card: '#8b1e3f', legend: '#8b1e3f' });
		for (const c of ['rgb(10, 20, 30)', 'hsl(120, 50%, 50%)', 'navy', '#8b1e3f80']) {
			expect(strips(draw(graphOf(houseSource(c)), true))).toEqual({ card: c, legend: c });
		}
	});

	it('a colour that is not fixed draws the no-house colour on the card and the legend', () => {
		for (const c of ['banana', 'var(--color-red)', 'currentColor']) {
			expect(strips(draw(graphOf(houseSource(c)), true))).toEqual({ card: DEFAULT_LIGHT.noHouse, legend: DEFAULT_LIGHT.noHouse });
		}
	});

	it('the drawing without "saved" (the spike) keeps the colour as written', () => {
		const svg = draw(graphOf(houseSource('banana')), false);
		expect(svg).toContain('fill="banana"');
	});
});
