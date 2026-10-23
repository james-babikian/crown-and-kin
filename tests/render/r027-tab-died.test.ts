// 0.2.7 WP4 geometry (CONTRACT K.7): a `died` text that means alive gives no dead look in the scene and the saved picture,
// and no "d. false" or "1100–false" in the date text line. Any other text still counts as dead.
import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { Person } from '../../src/core/types';
import { buildScene } from '../../src/render/dom/scene';
import { DEAD_STRIP_OPACITY } from '../../src/render/styles';
import { renderSvg } from '../../src/render/svg-string';
import { PLAIN_READER } from '../../src/core/dates';
import { dateLine } from '../../src/render/tree-info';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const WORDS = ['false', 'no', 'alive', 'living', 'never', ' No ', 'ALIVE'];
const person = (o: { born?: string; died?: string }): Person => ({ id: 'x', name: 'X', parents: [], illegitimate: false, index: 0, ...o });
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('dateLine and the alive words (K.7)', () => {
	it('an alive word is no death date', () => {
		for (const w of WORDS) {
			expect(dateLine(person({ died: w }), PLAIN_READER), w).toBeUndefined();
			expect(dateLine(person({ born: '1100', died: w }), PLAIN_READER), w).toBe('b. 1100');
		}
	});

	it('another text is still a death date; a normal date line is unchanged', () => {
		expect(dateLine(person({ born: '1100', died: '1160' }), PLAIN_READER)).toBe('1100–1160');
		expect(dateLine(person({ died: '1160' }), PLAIN_READER)).toBe('d. 1160');
		// 0.2.8 I19: a death text with no year shows the sign ("unknown" is a doubt).
		expect(dateLine(person({ died: 'unknown' }), PLAIN_READER)).toBe('†?');
		expect(dateLine(person({ born: '1100' }), PLAIN_READER)).toBe('b. 1100');
		expect(dateLine(person({}), PLAIN_READER)).toBeUndefined();
	});
});

describe('the dead look (K.7)', () => {
	const SRC = ['people:', '  - {id: a, name: Aldric, born: 1100, died: "no"}', '  - {id: b, name: Bertram, born: 1100, died: 1160}', '  - {id: c, name: Cedric, died: false}', ''].join('\n');
	const g: FamilyGraph = build(SRC).g;
	clearLayoutCache();
	const laid = layoutTree(g, cardForm(geometryFor(12), 'down'), { ...DEFAULT_LAYOUT_SETTINGS }, 'test');

	it('the scene gives dynasty-deceased to the person with a death text only', () => {
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: { text: 'serif', ui: 'sans', bold: '700' }, measure: () => 10, link: () => null });
		const cards = all(root).filter((e) => e.hasClass('dynasty-card'));
		const dead = cards.filter((e) => e.hasClass('dynasty-deceased')).map((e) => e.getAttribute('data-person'));
		expect(dead).toEqual(['b']);
		const dates = all(root).filter((e) => e.hasClass('dynasty-card-dates')).map((e) => e.getText());
		expect(dates.some((d) => /false|no$/.test(d))).toBe(false);
	});

	it('the saved-picture drawing mutes only the strip of the person with a death text', () => {
		const svg = renderSvg(g, laid.layout, laid.edges, {});
		expect(svg.split(`fill-opacity="${DEAD_STRIP_OPACITY}"`).length - 1).toBe(1);
		expect(svg).not.toMatch(/1100–no|d\. false|d\. no/);
		expect(svg).toContain('b. 1100');
	});
});
