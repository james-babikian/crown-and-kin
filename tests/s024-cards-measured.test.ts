import { describe, expect, it } from 'vitest';
import { cardLabels, type CardLabel } from '../src/core/titles';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { measuredLayout } from '../src/obsidian/measured-layout';
import { parseBreakList } from '../src/render/break-words';
import { build } from './helpers';

// 0.2.4 (contract 8.3, 6.1): `measuredLayout` takes `breaks`, `marked` and `relations`, and returns `lifted` on every path,
// also when no card is tall (a lift needs no taller card).

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
/** Every character is 0.5 em wide: 6.8 px at the 13.6 px name size. */
const measure = (s: string, font: string) => [...s].length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const GEO = geometryFor(16, 'normal');
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
/** 18 characters of relation text: 18 × 0.5 × 13.6 = 122 px at this measure: beside the arms box (133 px) it fits; make it 22 characters for a lift. */
const WIDE = 'A relation of wide words';

function lay(src: string, o: Partial<Parameters<typeof measuredLayout>[3]> = {}) {
	clearLayoutCache();
	const g = build(src).g;
	return measuredLayout(g, GEO, BASE, { fonts: FONTS, measure, labels: cardLabels(g), showDates: true, showPortraits: true, ...o });
}

describe('measuredLayout: lifted on every path', () => {
	it('with no relation words nothing lifts and the set is empty (not missing)', () => {
		const r = lay(SRC);
		expect(r.lifted).toBeInstanceOf(Set);
		expect(r.lifted.size).toBe(0);
	});

	it('a lift with no tall card: the set holds the person, the settings hold no tall cards', () => {
		// 24 characters = 163 px: wider than the room beside the box (133 px) and than the text width (158 px) -> cut, no lift; 22 characters = 149 px lifts.
		const r = lay(SRC, { relations: new Map([['bo', { text: WIDE.slice(0, 22) }]]) });
		expect(r.settings.tallCards).toBeUndefined();
		expect([...r.lifted]).toEqual(['bo']);
		expect(lay(SRC, { relations: new Map([['bo', { text: WIDE }]]) }).lifted.size).toBe(0);
	});

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
