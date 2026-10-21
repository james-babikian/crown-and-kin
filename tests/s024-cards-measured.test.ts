import { describe, expect, it } from 'vitest';
import type { CardLabel } from '../src/core/titles';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { measuredLayout } from '../src/view/measured-layout';
import { parseBreakList } from '../src/render/break-words';
import { build } from './helpers';

// 0.2.4 (contract 8.3, 6.1): `measuredLayout` takes `breaks` and `marked`. 0.2.6 (D179): rule B and its `lifted` set and the `relations` option are gone.

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
/** Every character is 0.5 em wide: 6.8 px at the 13.6 px name size. */
const measure = (s: string, font: string) => [...s].length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const GEO = geometryFor(16);
const BASE: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true };

const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'options:',
	'  me: ann',
	'people:',
	'  - {id: ann, name: Ann, title: Duke, born: 1100, house: v}',
	'  - {id: bo, name: Bo, title: Duke, born: 1130, house: v, parents: [ann]}',
	'',
].join('\n');
describe('measuredLayout: the break list and the marked person', () => {
	it('the break list reaches the fit: a word with no break place of its own is cut with "…" and stays one line; the list gives it a break and a second line', () => {
		const src = 'people:\n  - {id: a, name: Placeholder}\n';
		const word = 'Bcdfghjklmnpqrstvwxzbcdf';
		const one = (breaks?: string) => {
			clearLayoutCache();
			const g = build(src).g;
			(g.byId.get('a') as { name: string }).name = word;
			return measuredLayout(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS }, { fonts: FONTS, measure, showDates: true, showPortraits: true, ...(breaks ? { breaks: parseBreakList(breaks) } : {}) });
		};
		expect(one().settings.tallCards).toBeUndefined();
		expect(one('Bcdfghjklmnp-qrstvwxzbcdf').settings.tallCards).toEqual(['a']);
	});
});

describe('measuredLayout: a long title with a reign (D61)', () => {
	const labels = new Map([['ann', { holdings: [], selected: false, name: 'Ann', title: 'Duke of a very long place with many words in its name', reign: '1131–1160' } as unknown as CardLabel]]);
	const g = build(SRC).g;
	const run = (geo: typeof GEO, relationLine: boolean) => {
		clearLayoutCache();
		return measuredLayout(g, geo, { ...BASE, relationLine }, { fonts: FONTS, measure, labels, showDates: true, showPortraits: true });
	};

	it('takes two text lines, so the card is tall', () => {
		expect(run(GEO, true).settings.tallTitles).toEqual(['ann']);
	});
});
