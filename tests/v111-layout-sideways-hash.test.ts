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
 * tags show a ring or an open triangle, which now keep the same gap before the name as the dot. 0.2.4: recorded again for the card geometry (the card is 61 px
 * high, the name text 0.85 em, the arms box and portrait at the lower right; the sideways layout has the same columns and card widths). Run: npx vitest run tests/v111-layout-sideways-hash.test.ts
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
	'07 normal': 'a9f8c65621db91477b07594b8fbf56b475af864ae9eb7c8472b7b5a9159b4003',
	'07 narrow': '9ef7b288ff4ba9d0609af35b850e96ab2f8374a28102db5b32112f46f3e32509',
	'07b normal': 'a9f8c65621db91477b07594b8fbf56b475af864ae9eb7c8472b7b5a9159b4003',
	'07b narrow': '9ef7b288ff4ba9d0609af35b850e96ab2f8374a28102db5b32112f46f3e32509',
	'12 normal': 'fd1deb6d0fa544605a2728294a283d3fc50c2306e436a492f8988709c7d6f46b',
	'12 narrow': '0b8249592d0b03b45fee1f83a995fdd821e81b26a2d7548bc475193181591e43',
	'15 normal': '36b4a682672b36b4051c2a61517ceed8243f2ed0958f37e7a98f158a0de93f90',
	'15 narrow': '8b9cc93e73dca86e5baf3058359e69c71d7fea923e9cc0737268a0a75bccedcf',
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
