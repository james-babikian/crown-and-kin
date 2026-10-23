import { describe, expect, it } from 'vitest';
import type { CardLabel } from '../../src/core/titles';
import { foldForMatch } from '../../src/core/fold';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { isolateLines, type NameRun } from '../../src/render/name-lines';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

// The release plan T10, version 0.4, fault RTL-1 (the live card: the saved picture is tested in r04-t10-faults.test.ts) and the search fold of D100 for other scripts.

useFakeDom({ css: true });

const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

function nameTexts(name: string, sobriquet: string | undefined): string[] {
	const g = build(`people:\n  - {id: a, name: ${JSON.stringify(name)}}\n`).g;
	clearLayoutCache();
	const laid = layoutTree(g, geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) } as LayoutSettings, 'test');
	const labels = new Map([['a', { holdings: [], selected: false, name, ...(sobriquet ? { sobriquet } : {}) } as CardLabel]]);
	const root = new FEl('g');
	buildScene(root as unknown as SVGGElement, g, laid, { fonts: { text: 'serif', ui: 'sans', bold: '700' }, measure, link: () => null, labels });
	return all(root).filter((e) => e.hasClass('dynasty-card-name')).map((e) => e.getText());
}

describe('FAULT RTL-1 on the live card: an Arabic or Hebrew name line is one bidi isolate', () => {
	it('an Arabic name with a sobriquet starts with FSI and has PDI; the sobriquet keeps its tspan', () => {
		// The fake DOM keeps the text nodes before the child elements, so it cannot show the place of the PDI after the tspan; the real DOM appends it last.
		const [line] = nameTexts('يوسف الحداد', 'الحكيم');
		expect(line.startsWith(`${FSI}يوسف الحداد`)).toBe(true);
		expect(line.endsWith(`${PDI}“الحكيم”`) || line.endsWith(`”${PDI}`)).toBe(true);
		expect(line.replace(FSI, '').replace(PDI, '')).toBe('يوسف الحداد “الحكيم”');
	});

	it('a Hebrew name with no sobriquet is an isolate as well', () => {
		expect(nameTexts('דוד לוי', undefined)).toEqual([`${FSI}דוד לוי${PDI}`]);
	});

	it('a left-to-right name, with or without a sobriquet, has no control character', () => {
		expect(nameTexts('Aldric II', 'the Wise')).toEqual(['Aldric II “the Wise”']);
		expect(nameTexts('Νίκος Λέων', 'ο Σοφός')).toEqual(['Νίκος Λέων “ο Σοφός”']);
	});

	// A name on one text line: one first-strong isolate round the whole line, as in 0.4 before the fix of G5 fault 5.
	const isolateRuns = (runs: readonly NameRun[]) => isolateLines([runs])[0];

	it('isolateLines marks a one-line name in the right-to-left scripts and leaves the others the same list', () => {
		for (const s of ['דוד', 'يوسف', 'ܐܒܓ', 'ހަ', 'ﻣﺤﻤﺪ', 'a b אבי']) {
			const out = isolateRuns([{ text: s, sob: false }, { text: '“x”', sob: true }]);
			expect(out.map((r) => r.text).join(''), s).toBe(FSI + s + '“x”' + PDI);
			expect(out.map((r) => r.sob)).toEqual([false, true]);
		}
		for (const s of ['', 'Avi', 'Νικόλαος', '沈明華', 'Дмитрий', '“quoted”', '123']) {
			const runs = [{ text: s, sob: false }];
			expect(isolateRuns(runs), s).toBe(runs);
		}
		const empty: never[] = [];
		expect(isolateRuns(empty)).toBe(empty);
		const lines = [[{ text: 'Aldric', sob: false }], [{ text: 'II', sob: false }]];
		expect(isolateLines(lines)).toBe(lines);
	});
});

describe('D100: the search folds every combining mark and the final sigma, on both sides', () => {
	it('Hebrew points, Arabic vowel signs and the Greek tonos go', () => {
		expect(foldForMatch('שָׁרָה לֵוִי')).toContain(foldForMatch('לוי'));
		expect(foldForMatch('مُحَمَّد')).toContain(foldForMatch('محمد'));
		expect(foldForMatch('Καλλιγέρης')).toContain('καλλιγερησ');
	});

	it('the final sigma and the sigma are one letter, also from a capital', () => {
		expect(foldForMatch('ς')).toBe('σ');
		expect(foldForMatch('ΚΑΛΛΙΓΕΡΗΣ')).toBe(foldForMatch('καλλιγερης'));
		expect(foldForMatch('καλλιγεροσ')).toBe(foldForMatch('Καλλιγέρος'));
	});

	it('a spacing mark of an Indic script stays, and the fold is stable', () => {
		const s = 'का';
		expect(foldForMatch(s)).toBe(s);
		for (const t of ['שָׁרָה', 'مُحَمَّد', 'Καλλιγέρης', 'ΟΔΥΣΣΕΥΣ']) expect(foldForMatch(foldForMatch(t))).toBe(foldForMatch(t));
	});
});
