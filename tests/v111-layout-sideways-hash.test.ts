import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { DEFAULT_DARK } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { sampleSources } from './acceptance/m11-support';

/*
 * Review of 0.2.1 area C (finding C4): golden hashes of the headless pictures of the sideways layouts (light and dark) of sample trees 07, 07b, 12 and 15. The 0.2.1 work on the sideways partner gap and
 * the far-couple tag sign changes these layouts on purpose, and `m11-spike-hashes` only holds the `down` layouts.
 * The values are recorded from the code of the 0.2.1 fix round: a later change of the sideways layout or of its
 * drawing must change them on purpose. 0.2.2 (D108): the values of 07 and 07b were recorded again, because their far-couple
 * tags show a ring or an open triangle, which now keep the same gap before the name as the dot. 0.2.4: recorded again for the card geometry (the card is 61 px
 * high, the name text 0.85 em, the arms box and portrait at the lower right; the sideways layout has the same columns and card widths). 0.2.5 (D140, WP-A1): the keys '12 normal' and '12 narrow' were recorded again (partners on one row). 0.2.6 (D179): all four were recorded again for the text card; the same values come from the code of 0.2.5 with `cardForm(geometryFor(16, 'normal'), 'sideways')`. 0.2.8 look round (D212–D214): all four were recorded again. Run: npx vitest run tests/v111-layout-sideways-hash.test.ts
 */

// 0.2.6 (D179): the sideways tree has the text card (the classic card is gone).
const GEO = cardForm(geometryFor(16), 'sideways');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const IDS = ['07', '07b', '12', '15'];

function sidewaysHash(source: string): string {
	const parsed = parseDynasty(source);
	if (!parsed.ok) return 'error';
	const g = deriveFamilies(parsed.tree);
	clearLayoutCache();
	const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' };
	const laid = layoutTree(g, GEO, settings, 'font');
	const opts = { measure: approxMeasure, fonts: FONTS };
	const light = renderSvg(g, laid.layout, laid.edges, opts);
	const dark = renderSvg(g, laid.layout, laid.edges, { ...opts, palette: DEFAULT_DARK });
	return createHash('sha256').update(light).update('\0').update(dark).digest('hex');
}

const RECORDED: Record<string, string> = {
	'07': '9d570616c37278220889078ee790ef40322860a821d4a09c0e38c579f8fa2a16',
	'07b': '9d570616c37278220889078ee790ef40322860a821d4a09c0e38c579f8fa2a16',
	'12': 'a7821a8ddeeb9aac604f3b0a76df6d04eab1d5d3ebb2d81ed5e5a5a5c1e8ff51',
	'15': '286f5fe7774bd077e0c99a06c9446c0e79d16494f6810ac8bff49fe19a931c19',
};

const SAMPLES = sampleSources().filter((s) => IDS.includes(s.id));

describe('the headless pictures of the sideways layouts of sample trees 07, 07b, 12 and 15 do not change', () => {
	it('the four sample trees are present', () => {
		expect(SAMPLES.map((s) => s.id).sort()).toEqual(IDS);
	});

	it.each(SAMPLES.map((s) => [s.id, s.source] as const))('sample tree %s, sideways', (key, source) => {
		expect(sidewaysHash(source)).toBe(RECORDED[key]);
	});

	it('the four trees differ from each other', () => {
		const hashes = SAMPLES.map((s) => sidewaysHash(s.source));
		// 07 and 07b are the same text, so their hashes pair up; everything else is different.
		expect(new Set(hashes).size).toBe(hashes.length - 1);
	});
});
