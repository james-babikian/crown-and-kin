import { describe, expect, it } from 'vitest';
import { unionShape } from '../../src/render/styles';
import { graphOf, relationsModule } from './relations-support';

/*
 * Version 0.2.8, D205 item 1 and D188 item 12 (spec §0): the known partnership types and parent types are read in any case,
 * and the common words "mistress", "lover", "liaison", "engaged" and "concubine" are read as the known types.
 * No warning for any of these. Expected values are worked out by hand from D205:
 *   - `type: Concubinage` is concubinage (case ignored): the diamond sign, the name "Partner in concubinage".
 *   - `type: mistress` is affair: the open-triangle sign, the name "Lover".
 *   - a parent with `type: Rumoured` is a rumoured parent: the name "Rumoured father", and no `unknown-parent-type` warning.
 * Run: npx vitest run tests/acceptance/r028-d205-words.test.ts
 */

const two = (type: string) => `people:\n  - {id: a, name: A, sex: m}\n  - {id: b, name: B, sex: f}\nunions:\n  - {partners: [a, b], type: ${type}}\n`;

describe('D205: a partnership word in any case, and the common words, draw and name as the known type with no warning', () => {
	const cases: [string, 'diamond' | 'open-triangle' | 'ring', string][] = [
		['Concubinage', 'diamond', 'Partner in concubinage'],
		['CONCUBINAGE', 'diamond', 'Partner in concubinage'],
		['concubine', 'diamond', 'Partner in concubinage'],
		['mistress', 'open-triangle', 'Lover'],
		['Mistress', 'open-triangle', 'Lover'],
		['lover', 'open-triangle', 'Lover'],
		['liaison', 'open-triangle', 'Lover'],
		['engaged', 'ring', 'Betrothed'],
	];
	for (const [word, shape, name] of cases) {
		it(`type: ${word} is drawn as a ${shape}, named "${name}", with no warning`, async () => {
			const g = graphOf(two(word));
			expect(g.issues).toEqual([]);
			expect(unionShape('union', g.unions[0].type)).toBe(shape);
			const { computeRelations } = await relationsModule();
			expect(computeRelations(g, 'a').get('b')?.[0].text).toBe(name);
		});
	}
});

describe('D205: a parent with `type: Rumoured` is a rumoured parent, with no warning', () => {
	const parents = (type: string) => `people:\n  - {id: f, name: F, sex: m}\n  - {id: k, name: K, parents: [{id: f, type: ${type}}]}\n`;

	for (const type of ['Rumoured', 'RUMOURED', 'rumoured']) {
		it(`type: ${type}`, async () => {
			const g = graphOf(parents(type));
			expect(g.issues).toEqual([]);
			const { computeRelations } = await relationsModule();
			expect(computeRelations(g, 'k').get('f')?.[0].text).toBe('Rumoured father');
		});
	}
});
