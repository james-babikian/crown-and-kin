import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import type { ParentKind } from '../../src/core/edit';
import type { DescribeDelete, FamilyOf, FamilyView, PartnerLink, PickerAction, PickerExclusions } from '../../src/core/family';
import * as fq from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import type { TreeOptions } from '../../src/core/types';
import { fixtureNote, fixtureSource, topLevelBlocks } from './load';

// Spec §6.3 "Family" (parents with types, spouses, sibling position, Shown under), §6.4 (types at
// their limit are disabled; Add child's other-parent choices), §6.6 (picker exclusions), §6.7
// (the delete confirmation), §4.3 (primary union, sibling groups, implicit unions).
// Contract: src/core/family.ts. Expected values are worked out by hand from the fixtures.

const familyOf: FamilyOf = fq.familyOf;
const pickerExclusions: PickerExclusions = fq.pickerExclusions;
const describeDelete: DescribeDelete = fq.describeDelete;

function graph(body: string): { g: FamilyGraph; options: TreeOptions } {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return { g: deriveFamilies(r.tree), options: r.tree.options };
}

const F2 = graph(fixtureSource('02')).g;
const F3 = graph(fixtureSource('03')).g;
const F8 = graph(fixtureSource('08')).g;
const F11 = graph(fixtureSource('11')).g;
const F9 = graph(topLevelBlocks(fixtureNote('09'))[0]);

function view(g: FamilyGraph, id: string): FamilyView {
	const v = familyOf(g, id);
	if (!v) throw new Error(`no family view for ${id}`);
	return v;
}

/**
 * A union ref may name its partners in either order (contract), so partners are compared as a
 * sorted pair. The type selectors are compared as sets, in the §4.2 order.
 */
function norm(v: FamilyView) {
	const order: ParentKind[] = ['birth', 'adoptive', 'ward', 'rumoured'];
	const byOrder = (a: ParentKind, b: ParentKind) => order.indexOf(a) - order.indexOf(b);
	return {
		...v,
		partners: v.partners.map((p) => ({ ...p, union: p.union && { index: p.union.index, partners: [...p.union.partners].sort() } })),
		placementTypes: [...v.placementTypes].sort(byOrder),
		fullTypes: [...v.fullTypes].sort(byOrder),
	};
}

const listed = (partner: string, index: number, pair: [string, string], type: string, start?: string, end?: string): PartnerLink => ({
	partner,
	union: { index, partners: [...pair].sort() as [string, string] },
	type,
	...(start !== undefined ? { start } : {}),
	...(end !== undefined ? { end } : {}),
});
/** An implicit union has no ref; its `type` is not fixed by the contract, so it is not compared. */
const implicit = (partner: string) => expect.objectContaining({ partner, union: null }) as PartnerLink;
const b = (id: string) => ({ id, type: 'birth' as const });

describe('familyOf (§6.3 Family, §6.4)', () => {
	it('fixture 2, Edmund: three spouses in union order; a union with no type reads as marriage (§4.1)', () => {
		expect(norm(view(F2, 'edmund'))).toEqual({
			parents: [b('godric'), b('elinor')],
			partners: [
				listed('agnes', 1, ['edmund', 'agnes'], 'marriage', '1126', '1131'),
				listed('beatrix', 2, ['edmund', 'beatrix'], 'marriage', '1133', '1142'),
				listed('clarice', 3, ['edmund', 'clarice'], 'marriage', '1144'),
			],
			siblings: { group: ['edmund', 'cecily'], index: 0, canMoveEarlier: false, canMoveLater: true },
			placementTypes: ['birth'],
			fullTypes: ['birth'],
			otherParentChoices: ['agnes', 'beatrix', 'clarice'],
		});
	});

	it('fixture 2: sibling groups are per union', () => {
		expect(view(F2, 'maud').siblings).toEqual({ group: ['hugo', 'maud'], index: 1, canMoveEarlier: true, canMoveLater: false });
		expect(view(F2, 'piers').siblings).toBeNull();
		expect(view(F2, 'sybil').siblings).toEqual({ group: ['sybil', 'osric'], index: 0, canMoveEarlier: false, canMoveLater: true });
	});

	it('fixture 2, Godric: no parents, one spouse', () => {
		expect(norm(view(F2, 'godric'))).toEqual({
			parents: [],
			partners: [listed('elinor', 0, ['godric', 'elinor'], 'marriage')],
			siblings: null,
			placementTypes: [],
			fullTypes: [],
			otherParentChoices: ['elinor'],
		});
	});

	it('fixture 3: cousins married; each has one sibling group', () => {
		expect(norm(view(F3, 'conrad'))).toEqual({
			parents: [b('bastien'), b('rosamund')],
			partners: [listed('lisette', 3, ['conrad', 'lisette'], 'marriage', '1113')],
			siblings: { group: ['conrad', 'blanche'], index: 0, canMoveEarlier: false, canMoveLater: true },
			placementTypes: ['birth'],
			fullTypes: ['birth'],
			otherParentChoices: ['lisette'],
		});
		expect(view(F3, 'ulric').siblings).toEqual({ group: ['lisette', 'ulric'], index: 1, canMoveEarlier: true, canMoveLater: false });
		expect(view(F3, 'tristan').siblings).toBeNull();
	});

	it('fixture 8, Tomas: birth and adoptive parents, both full; placed under the adoptive pair', () => {
		expect(norm(view(F8, 'tomas'))).toEqual({
			parents: [b('marek'), b('anna'), { id: 'aldric', type: 'adoptive' }, { id: 'isolde', type: 'adoptive' }],
			partners: [listed('sabine', 3, ['tomas', 'sabine'], 'marriage')],
			// Jasper is under Marek and Anna; Tomas is alone under Aldric and Isolde.
			siblings: null,
			placementTypes: ['birth', 'adoptive'],
			fullTypes: ['birth', 'adoptive'],
			otherParentChoices: ['sabine'],
		});
	});

	it('fixture 8, Piers and Roderick: a ward is placement-eligible, a rumoured father is not', () => {
		expect(norm(view(F8, 'piers'))).toEqual({
			parents: [b('gareth'), b('odette'), { id: 'aldric', type: 'ward' }],
			partners: [],
			siblings: { group: ['piers', 'roderick'], index: 0, canMoveEarlier: false, canMoveLater: true },
			placementTypes: ['birth', 'ward'],
			fullTypes: ['birth'],
			otherParentChoices: [],
		});
		expect(norm(view(F8, 'roderick'))).toEqual({
			parents: [b('gareth'), b('odette'), { id: 'marek', type: 'rumoured' }],
			partners: [],
			siblings: { group: ['piers', 'roderick'], index: 1, canMoveEarlier: true, canMoveLater: false },
			placementTypes: ['birth'],
			fullTypes: ['birth'],
			otherParentChoices: [],
		});
	});

	it('fixture 8, Aldric: a ward and an adopted son do not make co-parents', () => {
		const v = norm(view(F8, 'aldric'));
		expect(v.partners).toEqual([listed('isolde', 0, ['aldric', 'isolde'], 'marriage', '1129')]);
		expect(v.otherParentChoices).toEqual(['isolde']);
	});

	it('fixture 11, Corwin: two marriages, the second to his daughter', () => {
		expect(norm(view(F11, 'corwin'))).toEqual({
			parents: [b('aurel'), b('viviane')],
			partners: [listed('maud', 2, ['corwin', 'maud'], 'marriage', '1048', '1051'), listed('alys', 3, ['corwin', 'alys'], 'marriage', '1066')],
			siblings: { group: ['varian', 'yseult', 'corwin'], index: 2, canMoveEarlier: true, canMoveLater: false },
			placementTypes: ['birth'],
			fullTypes: ['birth'],
			otherParentChoices: ['maud', 'alys'],
		});
		expect(view(F11, 'yseult').siblings).toEqual({ group: ['varian', 'yseult', 'corwin'], index: 1, canMoveEarlier: true, canMoveLater: true });
		expect(norm(view(F11, 'alys')).partners).toEqual([listed('corwin', 3, ['corwin', 'alys'], 'marriage', '1066')]);
		expect(view(F11, 'alys').siblings).toBeNull();
		expect(view(F11, 'osric').siblings).toBeNull();
	});

	it('fixture 9: a ward hangs from her single parent like a birth child; the quoted id is text', () => {
		const tamsin = norm(view(F9.g, 'tamsin'));
		expect(tamsin.parents).toEqual([{ id: 'aldous', type: 'ward' }]);
		expect(tamsin.siblings).toEqual({ group: ['piers', 'tamsin'], index: 1, canMoveEarlier: true, canMoveLater: false });
		expect(tamsin.placementTypes).toEqual(['ward']);
		expect(tamsin.fullTypes).toEqual([]);
		expect(norm(view(F9.g, '0017')).partners).toEqual([listed('aldous', 0, ['aldous', '0017'], 'marriage', '1129')]);
		expect(norm(view(F9.g, 'joan')).partners).toEqual([listed('edric', 1, ['edric', 'joan'], 'betrothal')]);
	});

	it('listed unions first, in list order, then implicit co-parents', () => {
		const body = [
			'people:',
			'  - id: a',
			'    name: A',
			'  - id: b',
			'    name: B',
			'  - id: c',
			'    name: C',
			'  - id: d',
			'    name: D',
			'    parents: [a, c]',
			'  - id: e',
			'    name: E',
			'    parents: [a, b]',
			'unions:',
			'  - partners: [b, a]',
			'    type: affair',
		].join('\n');
		const v = norm(view(graph(body).g, 'a'));
		expect(v.partners).toEqual([listed('b', 0, ['b', 'a'], 'affair'), implicit('c')]);
		expect(v.otherParentChoices).toEqual(['b', 'c']);
		expect(norm(view(graph(body).g, 'c')).partners).toEqual([implicit('a')]);
	});

	it('an unknown id', () => {
		expect(familyOf(F2, 'nobody')).toBeNull();
	});
});

describe('pickerExclusions (§6.6)', () => {
	const ex = (g: FamilyGraph, id: string, action: PickerAction, type?: ParentKind) => [...pickerExclusions(g, id, action, type)].sort();
	const sorted = (...ids: string[]) => ids.sort();

	it('add-parent: the person and every descendant through any type (fixture 8)', () => {
		// Aldric adopted Tomas (whose son is Lucan) and is Piers's guardian.
		expect(ex(F8, 'aldric', 'add-parent', 'birth')).toEqual(sorted('aldric', 'tomas', 'lucan', 'piers'));
		// Marek: Jasper and Tomas by birth, Roderick by rumour, Lucan through Tomas.
		expect(ex(F8, 'marek', 'add-parent', 'birth')).toEqual(sorted('marek', 'jasper', 'tomas', 'roderick', 'lucan'));
		expect(ex(F8, 'lucan', 'add-parent', 'adoptive')).toEqual(sorted('lucan'));
	});

	it('add-parent: people already a parent of the chosen type only', () => {
		expect(ex(F8, 'tomas', 'add-parent', 'birth')).toEqual(sorted('tomas', 'lucan', 'marek', 'anna'));
		expect(ex(F8, 'tomas', 'add-parent', 'adoptive')).toEqual(sorted('tomas', 'lucan', 'aldric', 'isolde'));
		expect(ex(F8, 'tomas', 'add-parent', 'ward')).toEqual(sorted('tomas', 'lucan'));
		expect(ex(F8, 'roderick', 'add-parent', 'rumoured')).toEqual(sorted('roderick', 'marek'));
		expect(ex(F8, 'roderick', 'add-parent', 'birth')).toEqual(sorted('roderick', 'gareth', 'odette'));
		expect(ex(F9.g, 'tamsin', 'add-parent', 'ward')).toEqual(sorted('tamsin', 'aldous'));
		expect(ex(F9.g, 'tamsin', 'add-parent', 'birth')).toEqual(sorted('tamsin'));
	});

	it('add-parent: descendants reached by two paths (fixture 3) and through a ward (fixture 9)', () => {
		expect(ex(F3, 'aurel', 'add-parent', 'birth')).toEqual(sorted('aurel', 'bastien', 'giselle', 'conrad', 'blanche', 'lisette', 'ulric', 'tristan'));
		expect(ex(F9.g, 'aldous', 'add-parent', 'birth')).toEqual(sorted('aldous', 'edric', 'rosamund', 'piers', 'tamsin'));
		expect(ex(F9.g, '0017', 'add-parent', 'adoptive')).toEqual(sorted('0017', 'edric', 'rosamund'));
	});

	it('add-parent: close kin (fixture 11)', () => {
		expect(ex(F11, 'corwin', 'add-parent', 'birth')).toEqual(sorted('corwin', 'alys', 'osric', 'aurel', 'viviane'));
		expect(ex(F11, 'maud', 'add-parent', 'birth')).toEqual(sorted('maud', 'alys', 'osric'));
	});

	it('add-child: the person and every ancestor through any type', () => {
		// Lucan's mother Sabine, his father Tomas, and Tomas's birth and adoptive parents.
		expect(ex(F8, 'lucan', 'add-child')).toEqual(sorted('lucan', 'tomas', 'sabine', 'marek', 'anna', 'aldric', 'isolde'));
		expect(ex(F8, 'roderick', 'add-child')).toEqual(sorted('roderick', 'gareth', 'odette', 'marek'));
		expect(ex(F8, 'piers', 'add-child')).toEqual(sorted('piers', 'gareth', 'odette', 'aldric'));
		expect(ex(F3, 'tristan', 'add-child')).toEqual(sorted('tristan', 'conrad', 'lisette', 'bastien', 'rosamund', 'stefan', 'giselle', 'aurel', 'viviane'));
		expect(ex(F11, 'osric', 'add-child')).toEqual(sorted('osric', 'corwin', 'alys', 'maud', 'aurel', 'viviane'));
		expect(ex(F9.g, 'tamsin', 'add-child')).toEqual(sorted('tamsin', 'aldous'));
	});

	it('add-spouse: only the person; focus and find: nobody', () => {
		expect(ex(F8, 'tomas', 'add-spouse')).toEqual(['tomas']);
		expect(ex(F11, 'corwin', 'add-spouse')).toEqual(['corwin']);
		expect(ex(F8, 'tomas', 'focus')).toEqual([]);
		expect(ex(F8, 'tomas', 'find')).toEqual([]);
	});
});

describe('describeDelete (§6.7 confirmation)', () => {
	it('fixture 9, Aldous: one union, four children (birth, block list and ward), start stays', () => {
		expect(describeDelete(F9.g, 'aldous', F9.options)).toEqual({ unions: 1, childLinks: 4, clearsStart: false, clearsFocus: false });
	});

	it('fixture 9, Edric: options.start points to him', () => {
		expect(describeDelete(F9.g, 'edric', F9.options)).toEqual({ unions: 1, childLinks: 0, clearsStart: true, clearsFocus: false });
	});

	it('fixture 8: every parent type counts as a child link', () => {
		expect(describeDelete(F8, 'aldric', {})).toEqual({ unions: 1, childLinks: 2, clearsStart: false, clearsFocus: false });
		expect(describeDelete(F8, 'marek', {})).toEqual({ unions: 1, childLinks: 3, clearsStart: false, clearsFocus: false });
		expect(describeDelete(F8, 'sabine', {})).toEqual({ unions: 1, childLinks: 1, clearsStart: false, clearsFocus: false });
	});

	it('fixture 2, Edmund: three unions, five children', () => {
		expect(describeDelete(F2, 'edmund', {})).toEqual({ unions: 3, childLinks: 5, clearsStart: false, clearsFocus: false });
	});

	it('fixture 11, Corwin: two unions; Alys is his daughter and his wife', () => {
		expect(describeDelete(F11, 'corwin', { start: 'corwin', focus: 'corwin' })).toEqual({ unions: 2, childLinks: 2, clearsStart: true, clearsFocus: true });
		expect(describeDelete(F11, 'alys', { focus: 'corwin' })).toEqual({ unions: 1, childLinks: 1, clearsStart: false, clearsFocus: false });
	});

	it('nobody related', () => {
		expect(describeDelete(F9.g, 'joan', { start: 'edric' })).toEqual({ unions: 1, childLinks: 0, clearsStart: false, clearsFocus: false });
	});
});
