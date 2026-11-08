// D334 Q11: proofs that the reason line says something the line itself contradicts or does not support.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { successionLine, type SuccessionSpec } from '../../src/core/succession';
import { firstHeirReason } from '../../src/core/succession-reason';

const TITLE = '\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: k, from: 1100}\n';

function reasonOf(people: string[], spec: Partial<SuccessionSpec> = {}) {
	const parsed = parseDynasty(`people:\n${people.map((p) => `  - ${p}`).join('\n')}\n${TITLE}`);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	const full: SuccessionSpec = { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false, ...spec };
	const res = successionLine(g, g.titles[0], full, 99, 0);
	return { res, why: firstHeirReason(g, res, full) };
}

describe('the reason line must not mislead', () => {
	it('shows no "comes first" reason when an open line "?" stands before the first heir', () => {
		// K has one child V who died at 25 and has no child in the tree: the line shows the grey "?" row of V first, then B.
		const { res, why } = reasonOf([
			'{id: p, name: P, sex: m, born: 1040, died: 1090}',
			'{id: k, name: K, sex: m, born: 1070, parents: [p]}',
			'{id: v, name: V, sex: m, born: 1090, died: 1115, parents: [k]}',
			'{id: b, name: B, sex: m, born: 1075, parents: [p]}',
		]);
		expect(res.heirs[0]).toBe('b');
		expect(res.openBranches[0]).toEqual({ id: 'v', before: 0 });
		// The note "B comes first because of the rule ..." would stand over a list whose first row is V's "?" row.
		expect(why).toBeNull();
	});

	it('does not name the succession rule when the child was left out by the exclude list', () => {
		// C is a living child of K, excluded by the user. The cause is the exclusion, not "Eldest child first".
		const { res, why } = reasonOf(
			[
				'{id: p, name: P, sex: m, born: 1040, died: 1090}',
				'{id: k, name: K, sex: m, born: 1070, parents: [p]}',
				'{id: c, name: C, sex: m, born: 1095, parents: [k]}',
				'{id: b, name: B, sex: m, born: 1075, parents: [p]}',
			],
			{ exclude: ['c'] },
		);
		expect(res.heirs[0]).toBe('b');
		expect(why).not.toEqual({ kind: 'rule', heir: 'b', rule: 'eldest-child' });
	});
});
