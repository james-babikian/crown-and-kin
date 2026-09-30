import { Resvg } from '@resvg/resvg-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LaidOut } from '../src/layout/model';
import { savedFileName, savedLegend } from '../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { installDom } from './acceptance/fake-dom';

// Code review of WP 9.2 (M9 part 2): the saved picture (spec §13.8, P3).

beforeAll(() => {
	installDom();
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const GEO = geometryFor(16, 'normal');

function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

function lay(g: FamilyGraph): LaidOut {
	clearLayoutCache();
	return layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) }, 'test');
}

function saved(g: FamilyGraph, heading = 'Tree'): string {
	const laid = lay(g);
	return renderSvg(g, laid.layout, laid.edges, {
		palette: DEFAULT_LIGHT,
		dark: false,
		measure: approxMeasure,
		fonts: FONTS,
		saved: { heading, legend: savedLegend(g, laid), pictures: new Map(), scale: 1.75 },
	});
}

// XML 1.0 forbids C0 control characters other than tab, line feed and carriage return.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

describe('review m9 render: the saved SVG is well-formed XML for every name the tree text allows', () => {
	it('a name or house name with a control character (YAML "\\x01") still gives a picture that opens', () => {
		const g = graphOf(`houses:
  - {id: v, name: "House\\x01Valmont", color: "#8b1e3f"}
people:
  - {id: a, name: "Aldric\\x01Valmont", house: v}
`);
		expect(g.byId.get('a')!.name).toContain('\u0001');
		const svg = saved(g);
		// The PNG path loads this SVG into an <img>; an XML parse error fails the whole save.
		let error: unknown = null;
		try {
			new Resvg(svg).render();
		} catch (e) {
			error = e;
		}
		expect(String(error ?? 'no error')).toBe('no error');
		expect(NOT_XML.test(svg)).toBe(false);
	});

	it('the focus file name has no control character (Windows refuses such a file name)', () => {
		expect(NOT_XML.test(savedFileName('Valmont', 'png', 'Aldric\u0001Valmont'))).toBe(false);
	});
});

describe('review m9 render: the saved picture uses fixed, drawable colours only', () => {
	const source = (color: string) => `houses:
  - {id: v, name: House Valmont, color: "${color}"}
people:
  - {id: a, name: Aldric Valmont, house: v}
`;
	for (const color of ['banana', 'var(--color-red)']) {
		it(`a house colour that is not a fixed colour ("${color}") draws the no-house colour, as the screen does`, () => {
			const svg = saved(graphOf(source(color)));
			// The legend's house strip (new in M9) and the card strip.
			const legendRow = /<g [^>]*data-item="legend-house:v">\s*<rect [^>]*fill="([^"]*)"/.exec(svg);
			expect(legendRow?.[1]).toBe(DEFAULT_LIGHT.noHouse);
			expect(svg).not.toContain(`fill="${color}"`);
		});
	}
});
