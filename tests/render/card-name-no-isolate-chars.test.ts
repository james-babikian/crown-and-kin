import { describe, expect, it } from 'vitest';
import { cardLabels } from '../../src/core/titles';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, layoutTree, pictureSets } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The card names of the live tree (D322). A name that the note writes with U+2068 must not reach the SVG <text> as an isolate: WebKit ignores it there, so
 * `svgNameLines` turns it into an embedding like the marks it writes itself. The full-screen view watches its HTML parts only (an internal test).
 */
useFakeDom({ css: true });

const FSI = '⁨';
const PDI = '⁩';
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('a card name text never holds an isolate opener', () => {
	it.each([
		['a pair of marks in a Latin name', `${FSI}Aldric${PDI} Valmont`],
		['a lone opener in a Latin name', `Aldric ${FSI}Valmont`],
	])('%s', (_k, name) => {
		const { g } = build(`people:\n  - {id: a, name: "${name}", born: 1100}\n`);
		const laid = layoutTree(g, geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) } as LayoutSettings, 'test');
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: { text: 'sans-serif', bold: '600' } as never, measure: (s: string) => s.length * 8, link: () => null, labels: cardLabels(g) });
		const texts = all(root).filter((e) => e.hasClass('dynasty-card-name')).map((e) => e.getText());
		expect(texts.length).toBeGreaterThan(0);
		for (const t of texts) expect(t.includes(FSI), JSON.stringify(t)).toBe(false);
	});
});
