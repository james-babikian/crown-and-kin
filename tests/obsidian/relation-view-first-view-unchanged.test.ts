import { describe, expect, it } from 'vitest';

import { relationView, sceneTransform, setupRelationViewTests } from '../acceptance/relation-view-support';

/*
 * D334 Q1 B: on the computer and the iPad the first view of the relation view is the one of 0.5.2. The golden scene transforms were
 * taken from the code before D334 (sample tree 12, the owner's settings).
 */

setupRelationViewTests();

/** Scene transforms of the first view on the computer and the iPad, from the code of 0.5.2 (before D334). */
const GOLDEN: Record<'computer' | 'ipad', Record<string, string>> = {
	computer: {
		'alan>nils': 'translate(338 270) scale(1)',
		'alan>thea': 'translate(334 270) scale(1)',
		'alan>rolf': 'translate(334 431) scale(1)',
		'gwen>orla': 'translate(342 345.5) scale(1)',
		'dana>fenna': 'translate(334 431) scale(1)',
		'sigmund>tamsin': 'translate(342 270) scale(1)',
		'nils>alan': 'translate(338 270) scale(1)',
		'rolf>orla': 'translate(334 350.5) scale(1)',
	},
	ipad: {
		'alan>nils': 'translate(108 460.5) scale(1)',
		'alan>thea': 'translate(104 460.5) scale(1)',
		'alan>rolf': 'translate(104 621.5) scale(1)',
		'gwen>orla': 'translate(112 536) scale(1)',
		'dana>fenna': 'translate(104 621.5) scale(1)',
		'sigmund>tamsin': 'translate(112 460.5) scale(1)',
		'nils>alan': 'translate(108 460.5) scale(1)',
		'rolf>orla': 'translate(104 541) scale(1)',
	},
};
const PAIRS: [string, string][] = [['alan', 'nils'], ['alan', 'thea'], ['alan', 'rolf'], ['gwen', 'orla'], ['dana', 'fenna'], ['sigmund', 'tamsin'], ['nils', 'alan'], ['rolf', 'orla']];

describe.each(['computer', 'ipad'] as const)('the first view on the %s is unchanged', (kind) => {
	it.each(PAIRS)('%s > %s', async (a, b) => {
		const r = await relationView(kind, a, b);
		expect(sceneTransform(r.root)).toBe(GOLDEN[kind][`${a}>${b}`]);
	});
});
