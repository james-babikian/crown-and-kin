import { describe, expect, it } from 'vitest';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { BIDI_FSI, BIDI_PDI, splitOutsideIsolates } from '../../src/render/bidi-controls';
import { svgText } from '../../src/render/name-lines';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { build } from '../support/helpers';

/*
 * Isolate marks (D322) in an SVG text and in a text cut at a separator. WebKit ignores FSI and PDI in an SVG text, so a sentence of a text table that
 * names a person is written with embeddings in the saved picture; a summary line is cut only where no name isolate is open.
 */
const LRE = String.fromCharCode(0x202a);
const RLE = String.fromCharCode(0x202b);
const PDF = String.fromCharCode(0x202c);
const ARABIC = 'كريم Mansour';

describe('svgText', () => {
	it('turns a pair into the embedding of the direction of its first strong letter', () => {
		expect(svgText(`Line of succession: ${BIDI_FSI}${ARABIC}${BIDI_PDI}, now`)).toBe(`Line of succession: ${RLE}${ARABIC}${PDF}, now`);
		expect(svgText(`Line of ${BIDI_FSI}Aldric${BIDI_PDI}.`)).toBe(`Line of ${LRE}Aldric${PDF}.`);
	});
	it('returns a text with no isolate as it is', () => {
		expect(svgText('Line of succession: Aldric, now')).toBe('Line of succession: Aldric, now');
	});
	it('leaves no isolate control in a text with a lone mark', () => {
		expect(svgText(`a ${BIDI_FSI}b`)).not.toContain(BIDI_FSI);
		expect(svgText(`a ${BIDI_PDI} b`)).not.toContain(BIDI_PDI);
	});
});

describe('the bar sentence of a saved picture', () => {
	it('is written with embeddings, with no isolate control in the SVG', () => {
		const { g } = build('people:\n  - {id: a, name: Aldric, born: 1100}\n');
		clearLayoutCache();
		const geo = geometryFor(16);
		const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS } as LayoutSettings, 'test');
		const svg = renderSvg(g, laid.layout, laid.edges, {
			palette: DEFAULT_LIGHT,
			dark: false,
			measure: approxMeasure,
			fonts: { text: 'serif', ui: 'sans', bold: '700' },
			barSentence: `Line of succession: ${BIDI_FSI}${ARABIC}${BIDI_PDI}, now`,
			saved: { heading: 'Test', legend: { kinds: [], sign: false, houses: [] }, pictures: new Map(), scale: 1 },
		});
		expect(svg).toContain(`${RLE}${ARABIC}${PDF}, now`);
		expect(svg).not.toContain(BIDI_FSI);
		expect(svg).not.toContain(BIDI_PDI);
	});
});

describe('splitOutsideIsolates', () => {
	it('cuts a text with no isolate as split does', () => {
		expect(splitOutsideIsolates('a · b · c', ' · ')).toEqual(['a', 'b', 'c']);
		expect(splitOutsideIsolates('', ' · ')).toEqual(['']);
	});
	it('keeps a separator inside an isolate in its item', () => {
		const name = `${BIDI_FSI}Banu Hashim · بنو هاشم${BIDI_PDI}`;
		expect(splitOutsideIsolates(`${name} · 3 people · ${name}`, ' · ')).toEqual([name, '3 people', name]);
	});
	it('treats a lone opener as an open isolate to the end of the text', () => {
		expect(splitOutsideIsolates(`a · ${BIDI_FSI}b · c`, ' · ')).toEqual(['a', `${BIDI_FSI}b · c`]);
	});
});
