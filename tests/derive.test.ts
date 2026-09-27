import { describe, expect, it } from 'vitest';
import { build } from './helpers';

const person = (id: string, extra = '') => `  - id: ${id}\n    name: ${id.toUpperCase()}\n${extra}`;

describe('deriveFamilies', () => {
	it('creates an implicit union for co-parents with no union listed', () => {
		const { g } = build(`people:\n${person('a')}${person('b')}${person('c', '    parents: [a, b]\n')}`);
		expect(g.unions).toHaveLength(1);
		expect(g.unions[0]).toMatchObject({ implicit: true, children: ['c'] });
	});

	it('hangs a single-parent child directly from the parent', () => {
		const { g } = build(`people:\n${person('a')}${person('c', '    parents: [a]\n')}`);
		expect(g.soloChildren.get('a')).toEqual(['c']);
	});

	it('flags duplicate ids as blocking and keeps the first', () => {
		const { g } = build(`people:\n${person('a')}  - id: a\n    name: Other\n`);
		expect(g.people).toHaveLength(1);
		expect(g.issues.some((i) => i.level === 'blocking')).toBe(true);
	});

	it('warns about missing references without throwing', () => {
		const { g } = build(`people:\n${person('c', '    parents: [ghost]\n')}unions:\n  - partners: [c, nobody]\n`);
		expect(g.issues.filter((i) => i.level === 'warning')).toHaveLength(2);
		expect(g.unions).toHaveLength(0);
	});

	it('breaks a cycle and names the people involved', () => {
		const { g } = build(`people:\n${person('a', '    parents: [b]\n')}${person('b', '    parents: [a]\n')}`);
		const cycle = g.issues.find((i) => i.code === 'cycle');
		expect(cycle?.ids).toEqual(expect.arrayContaining(['a', 'b']));
		expect([...g.placementParents.values()].flat()).toHaveLength(1);
	});

	it('places an adopted child under the adoptive parents and links the birth parents', () => {
		const { g } = build(
			`people:\n${person('m')}${person('f')}${person('am')}${person('af')}${person('c', '    parents: [m, f, {id: am, type: adoptive}, {id: af, type: adoptive}]\n    placement: adoptive\n')}unions:\n  - partners: [m, f]\n  - partners: [am, af]\n`,
		);
		expect(g.placementParents.get('c')).toEqual(['am', 'af']);
		expect(g.secondary).toEqual([{ child: 'c', type: 'birth', parents: ['m', 'f'], unionKey: 'u0' }]);
	});

	it('never places a child under a rumoured parent', () => {
		const { g } = build(`people:\n${person('a')}${person('r')}${person('c', '    parents: [a, {id: r, type: rumoured}]\n')}`);
		expect(g.placementParents.get('c')).toEqual(['a']);
		expect(g.secondary).toEqual([{ child: 'c', type: 'rumoured', parents: ['r'] }]);
	});

	it('warns about a third birth parent and draws it as a side link', () => {
		const { g } = build(`people:\n${person('a')}${person('b')}${person('x')}${person('c', '    parents: [a, b, x]\n')}`);
		expect(g.placementParents.get('c')).toEqual(['a', 'b']);
		expect(g.secondary).toEqual([{ child: 'c', type: 'birth', parents: ['x'] }]);
		expect(g.issues).toMatchObject([{ code: 'too-many-parents', params: { type: 'birth', count: 3 }, ids: ['c'] }]);
	});

	it('uses the union named by `union` when a couple has more than one', () => {
		const { g } = build(
			`people:\n${person('a')}${person('b')}${person('c', '    parents: [a, b]\n    union: first\n')}${person('d', '    parents: [a, b]\n')}unions:\n  - id: first\n    partners: [a, b]\n  - id: second\n    partners: [a, b]\n`,
		);
		expect(g.primaryUnion.get('c')).toBe('u0');
		expect(g.primaryUnion.get('d')).toBe('u1');
	});
});
