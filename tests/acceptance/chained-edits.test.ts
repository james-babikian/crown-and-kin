import { describe, expect, it } from 'vitest';
import type { ApplyOp, EditResult, Op, UnionRef } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import { deriveFamilies } from '../../src/core/derive';
import * as edit from '../../src/core/yaml-edit';
import { golden } from './golden';
import { nextIdFor } from '../helpers';
import { fixtureSource } from './load';
import { layOut } from './pipeline';

// Spec §10 "Chained edits": open a person, add a spouse, then add three children with "Save & add
// another child" (§6.3), with no stale-write aborts. Here on the core ops: every step starts from
// the body the previous step wrote, as the BlockHandle does (§6.1). Also §6.2 (a new spouse goes
// after the person, a new child after the last sibling), §6.8 (ids), D2 and §4.3 (sibling order
// in the layout follows the document).

const applyOp: ApplyOp = edit.applyOp;

function ok(r: EditResult): Extract<EditResult, { ok: true }> {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r;
}

function expectNoIssues(body: string): void {
	const r = parseDynasty(body);
	expect(r.ok).toBe(true);
	if (r.ok) expect(deriveFamilies(r.tree).issues.map((i) => i.code)).toEqual([]);
}

describe('chained edits on fixture 1 (§10)', () => {
	it('a spouse and three children, each write on the result of the one before', () => {
		let body = fixtureSource('01').replace(/\n$/, '');
		const bodies: string[] = [];

		// 1. Open Edric, change his title in the draft, then Add spouse → New: one write (§6.3).
		const spouse = nextIdFor(body);
		expect(spouse).toBe('p1');
		let r = applyOp(body, {
			kind: 'batch',
			ops: [
				{ kind: 'set-person-fields', id: 'edric', fields: { title: 'Heir of Valmont' } },
				{ kind: 'add-person', id: spouse, fields: { name: 'Beatrice Lorne', sex: 'f', born: '1160' }, at: { kind: 'after', id: 'edric' } },
				// The union type defaults to marriage in the sheet (§6.4).
				{ kind: 'add-union', partners: ['edric', spouse], type: 'marriage', start: '1180' },
			],
		});
		expect(ok(r).created).toEqual([spouse]);
		body = ok(r).body;
		bodies.push(body);

		// Edric and Beatrice's union is the third in the list.
		const union: UnionRef = { index: 2, partners: ['edric', spouse] };

		// 2–4. Add child with Beatrice as the other parent, then Save & add another child, twice.
		const children: [string, 'm' | 'f', string][] = [
			['Roderick', 'm', '1181'],
			['Isolde', 'f', '1183'],
			['Aldric', 'm', '1185'],
		];
		const ids: string[] = [];
		for (const [name, sex, born] of children) {
			// Each new person gets the next number, whatever the name (D104).
			const id = nextIdFor(body);
			expect(id).toBe(`p${ids.length + 2}`);
			const op: Op = {
				kind: 'batch',
				ops: [
					{
						kind: 'add-person',
						id,
						fields: { name, house: 'valmont', sex, born },
						parents: [
							{ id: 'edric', type: 'birth' },
							{ id: spouse, type: 'birth' },
						],
						at: { kind: 'after-siblings', parents: ['edric', spouse], union },
					},
				],
			};
			r = applyOp(body, op);
			expect(ok(r).created).toEqual([id]);
			expect(ok(r).effects ?? []).toEqual([]);
			body = ok(r).body;
			bodies.push(body);
			ids.push(id);
		}

		expect(body + '\n').toBe(golden('01-chained-edits.yaml'));
		for (const b of bodies) expectNoIssues(b);

		// D2: the children appear left to right in the order they were added.
		const { layout, g } = layOut(body);
		expect(g.unionByKey.get(g.primaryUnion.get(ids[0])!)!.children).toEqual(ids);
		const x = (id: string) => layout.persons.get(id)!.x;
		expect(x(ids[0])).toBeLessThan(x(ids[1]));
		expect(x(ids[1])).toBeLessThan(x(ids[2]));
		// Edric's own sibling order is unchanged.
		expect(x('edric')).toBeLessThan(x('alys'));
	});

	it('Move earlier on the last child changes the order in the layout (§6.5, §10)', () => {
		const body = golden('01-chained-edits.yaml').replace(/\n$/, '');
		// p2 Roderick, p3 Isolde, p4 Aldric.
		const moved = ok(applyOp(body, { kind: 'move-sibling', id: 'p4', direction: 'earlier' })).body;
		expectNoIssues(moved);
		const { layout } = layOut(moved);
		const x = (id: string) => layout.persons.get(id)!.x;
		expect(x('p2')).toBeLessThan(x('p4'));
		expect(x('p4')).toBeLessThan(x('p3'));
	});
});
