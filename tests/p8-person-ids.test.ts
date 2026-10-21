import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { parseBody, readTree } from '../src/core/parse';
import { hasNoWrittenId, idsForPeople } from '../src/view/person-ids';
import { withHolderIds } from '../src/view/titles-draft';

/*
 * P8-23: the edit sheet and the Titles window give an id to a person who has none by the same rule (D104): the new numbers follow the
 * highest `p<number>` that the block writes or names, and go to the people in the order they are named.
 */

// Aldric has the id `p7`; the three people after him have none: `~2`, `~3` and `~4`.
const BODY = [
	'titles:',
	'  - id: duke',
	'    name: Duke',
	'people:',
	'  - id: p7',
	'    name: Aldric Valmont',
	'  - name: Bran Valmont',
	'  - name: Cora Valmont',
	'  - name: Dael Valmont',
	'',
].join('\n');

const load = () => {
	const p = parseBody(BODY);
	if (!p.ok) throw new Error('the sample does not parse');
	return { g: deriveFamilies(readTree(p.doc, p.data, BODY)), data: p.data };
};

describe('hasNoWrittenId', () => {
	it('is true for a person with no written id and false for one with an id, for an unknown name and for no data', () => {
		const { g, data } = load();
		expect(hasNoWrittenId(g, data, '~2')).toBe(true);
		expect(hasNoWrittenId(g, data, 'p7')).toBe(false);
		expect(hasNoWrittenId(g, data, 'nobody')).toBe(false);
		expect(hasNoWrittenId(g, null, '~2')).toBe(false);
	});
});

describe('idsForPeople (D104 order)', () => {
	it('numbers after the highest id the block writes or names, in the order of the names, once for each person', () => {
		const { g, data } = load();
		const ids = idsForPeople(g, data, ['~4', '~2', '~4', '~3']);
		expect([...ids]).toEqual([
			['~4', 'p8'],
			['~2', 'p9'],
			['~3', 'p10'],
		]);
	});

	it('gives nothing to a person with an id, an unknown name, an empty name or a value that is no text', () => {
		const { g, data } = load();
		expect(idsForPeople(g, data, ['p7', 'nobody', null, undefined, 3 as unknown as string]).size).toBe(0);
	});

	it('does not use an id in `taken`', () => {
		const { g, data } = load();
		expect([...idsForPeople(g, data, ['~2'], ['p20'])]).toEqual([['~2', 'p21']]);
	});

	it('the Titles window gets the same numbers, in the order of its ops', () => {
		const { g, data } = load();
		const ops: Op[] = [
			{ kind: 'set-holders', title: 'duke', items: [{ add: { person: '~3' } }, { add: { person: '~2' } }] },
			{ kind: 'edit-title', id: 'duke', heirs: ['~4'] } as Op,
		];
		const out = withHolderIds(ops, g, data);
		expect(out.slice(0, 3)).toEqual([
			{ kind: 'set-person-fields', id: '~3', fields: { id: 'p8' } },
			{ kind: 'set-person-fields', id: '~2', fields: { id: 'p9' } },
			{ kind: 'set-person-fields', id: '~4', fields: { id: 'p10' } },
		]);
	});
});
