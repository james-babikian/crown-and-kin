import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { foldControls, foldHidden, foldKey } from '../src/core/folds';
import { parseDynasty } from '../src/core/parse';
import { automaticCrop, formatPortraitCrop, isAutomaticCrop, readPortraitCrop } from '../src/core/portrait-crop';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../src/layout/index';

/* M10 review, area A: core and layout. */

function graph(text: string) {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

describe('review A: portrait crop', () => {
	it('2. a crop that the tool wrote (4 decimals) still counts as the automatic part', () => {
		// Automatic left is 185/4000 = 0.04625 exactly; written at 4 decimals it is 0.0463 or 0.0462, 0.00005 away.
		const w = 4000;
		const h = 3629;
		const written = readPortraitCrop(formatPortraitCrop(automaticCrop(w, h)));
		expect(written.kind).toBe('ok');
		if (written.kind === 'ok') expect(isAutomaticCrop(written.crop, w, h)).toBe(true);
	});
});

describe('review A: folds', () => {
	it('1. folding a family never hides its own parent (father with a daughter as partner)', () => {
		// a is a root. b is a's sole-parent child. c is the child of a and b. a's only partner is b.
		const g = graph(['people:', '  - {id: a, name: A}', '  - {id: b, name: B, parents: [a]}', '  - {id: c, name: C, parents: [a, b]}', ''].join('\n'));
		const folds = new Set([foldKey(['a'])]);
		const hidden = foldHidden(g, folds);
		expect(hidden.has('a')).toBe(false);
		expect(foldControls(g, folds, hidden).some((c) => c.key === foldKey(['a']))).toBe(true);
		clearLayoutCache();
		const { layout } = layoutTree(g, geometryFor(16, 'normal'), { ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [...hidden], foldedFamilies: [...folds], foldControls: true }, 'f');
		expect(layout.persons.size).toBeGreaterThan(0);
		expect(layout.rows.every((r) => r.length > 0)).toBe(true);
	});
});
