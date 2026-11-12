import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { svgNameLines } from '../../src/render/name-lines';
import { savedLegend } from '../../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { WRITE_TEXT } from '../../src/render/ui-text';
import { useFakeDom } from '../support/fake-dom-setup';

// D346 items 1 and 3: the refusal text names the next step, and the saved picture's legend writes a mixed house name as the cards do.

useFakeDom({ css: true });

describe('D346 item 1: the refusal after the tree changed', () => {
	it('also says what to do', () => {
		expect(WRITE_TEXT.undoChanged).toBe('The plugin cannot undo the last tree edit. The tree changed after the edit. Make the change again by hand.');
	});
});

describe('D346 item 2: the words after a rename', () => {
	it('name both names, the name before the undo first', () => {
		expect(WRITE_TEXT.undoDoneRename('Aldric III', 'Aldric the Elder')).toBe('The plugin undid the change to Aldric III. The name is Aldric the Elder again.');
	});
});

const MIXED = 'بيت Mansour';

describe('D346 item 3: the legend writes a house name as the cards do', () => {
	const g = (() => {
		const r = parseDynasty(`houses:\n  - {id: m, name: "${MIXED}", color: "#8b1e3f"}\n  - {id: l, name: House Latin}\npeople:\n  - {id: a, name: Aldric, house: m}\n  - {id: b, name: Bran, house: l}\n`);
		if (!r.ok) throw new Error('parse');
		return deriveFamilies(r.tree);
	})();
	const FONTS = { text: 'serif', ui: 'sans', bold: '700' };

	it('puts the embedding round a house name that starts right to left, in the saved picture', () => {
		clearLayoutCache();
		const laid = layoutTree(g, cardForm(geometryFor(16), 'down'), DEFAULT_LAYOUT_SETTINGS, 'test');
		const legend = savedLegend(g, laid);
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure: approxMeasure, fonts: FONTS, saved: { heading: 'Tree', legend, pictures: new Map(), scale: 1 } });
		const group = (id: string) => svg.slice(svg.indexOf(`data-item="legend-house:${id}"`)).split('</g>')[0];
		const cardWay = svgNameLines([[{ text: MIXED, sob: false }]])[0].map((r) => r.text).join('');
		expect(cardWay).not.toBe(MIXED);
		expect(group('m')).toContain(`>${cardWay}</text>`);
		expect(group('m')).toMatch(/[‪‫]/);
		expect(group('m')).not.toMatch(/[⁦-⁩]/);
		// A left-to-right house name is written as it is.
		expect(group('l')).toContain('>House Latin</text>');
	});
});
