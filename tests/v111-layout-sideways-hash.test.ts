import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { DEFAULT_DARK } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { sampleSources } from './acceptance/m11-support';

/*
 * Review of 0.2.1 area C (finding C4): golden hashes of the headless pictures of the sideways layouts (Normal and
 * Narrow cards, light and dark) of sample trees 07, 07b, 12 and 15. The 0.2.1 work on the sideways partner gap and
 * the far-couple tag sign changes these layouts on purpose, and `m11-spike-hashes` only holds the `down` layouts.
 * The values are recorded from the code of the 0.2.1 fix round: a later change of the sideways layout or of its
 * drawing must change them on purpose. 0.2.2 (D108): the values of 07 and 07b were recorded again, because their far-couple
 * tags show a ring or an open triangle, which now keep the same gap before the name as the dot. Run: npx vitest run tests/v111-layout-sideways-hash.test.ts
 */

const GEO = geometryFor(16, 'normal');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const IDS = ['07', '07b', '12', '15'];
const CARDS = ['normal', 'narrow'] as const;

function sidewaysHash(source: string, cards: (typeof CARDS)[number]): string {
	const parsed = parseDynasty(source);
	if (!parsed.ok) return 'error';
	const g = deriveFamilies(parsed.tree);
	clearLayoutCache();
	const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: cards };
	const laid = layoutTree(g, GEO, settings, 'font');
	const opts = { measure: approxMeasure, fonts: FONTS };
	const light = renderSvg(g, laid.layout, laid.edges, opts);
	const dark = renderSvg(g, laid.layout, laid.edges, { ...opts, palette: DEFAULT_DARK });
	return createHash('sha256').update(light).update('\0').update(dark).digest('hex');
}

const RECORDED: Record<string, string> = {
	'07 normal': 'aa041ace44d5652323524a1477dff06572a2a4fe60d09567197d2358d1768708',
	'07 narrow': '16b2e33dd5eae67ff331bb166a40d2fefb32a69c6fd32658cd68c0da54cf0ce8',
	'07b normal': 'aa041ace44d5652323524a1477dff06572a2a4fe60d09567197d2358d1768708',
	'07b narrow': '16b2e33dd5eae67ff331bb166a40d2fefb32a69c6fd32658cd68c0da54cf0ce8',
	'12 normal': '80bc72756579c388b1401a5140d6a52ee36013bfd05eb25f5024998802980cc2',
	'12 narrow': '734999d19077a2cb71d7dc4fe8e00d88624ccbb94cc9a23c12ec2bd76d894674',
	'15 normal': 'e8cde35d4595296d0468e0a7282bbbd9548bba352d51d65ce30486568d107f81',
	'15 narrow': 'eed0be719018580c9b8fb3b5c1d5fe59dd49b15d58b32a49261a22ea2773039b',
};

const SAMPLES = sampleSources().filter((s) => IDS.includes(s.id));

describe('the headless pictures of the sideways layouts of sample trees 07, 07b, 12 and 15 do not change', () => {
	it('the four sample trees are present', () => {
		expect(SAMPLES.map((s) => s.id).sort()).toEqual(IDS);
	});

	it.each(SAMPLES.flatMap((s) => CARDS.map((c) => [`${s.id} ${c}`, s.source, c] as const)))('sample tree %s, sideways', (key, source, cards) => {
		expect(sidewaysHash(source, cards)).toBe(RECORDED[key]);
	});

	it('the Normal and Narrow pictures differ, and the four trees differ from each other', () => {
		const hashes = SAMPLES.flatMap((s) => CARDS.map((c) => sidewaysHash(s.source, c)));
		// 07 and 07b are the same text, so their hashes pair up; everything else is different.
		expect(new Set(hashes).size).toBe(hashes.length / 2 + 2);
	});
});
