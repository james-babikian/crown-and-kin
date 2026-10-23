import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
	class Notice {
		constructor(public text: unknown) {}
	}
	class Modal {}
	class SuggestModal {}
	return { Notice, Modal, SuggestModal };
});

// Scripted answers for each step of a flow.
const answers: unknown[] = [];
vi.mock('../../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { deriveFamilies } from '../../src/core/derive';
import type { Op } from '../../src/core/edit';
import { familyOf } from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { addChild, type FlowHost } from '../../src/obsidian/family-flows';

function graph(body: string) {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** A sheet for `id` whose commit applies the ops to the body, as the handle would. */
function host(body: string, id: string) {
	const g = graph(body);
	const out = { body, ops: [] as Op[], effects: [] as string[] };
	const h: FlowHost = {
		app: {} as never,
		g,
		person: g.byId.get(id)!,
		fam: familyOf(g, id)!,
		name: (x) => g.byId.get(x)?.name ?? x,
		ready: () => true,
		commit: async (ops) => {
			out.ops = ops;
			const r = applyOp(body, ops.length === 1 ? ops[0] : { kind: 'batch', ops });
			if (!r.ok) throw new Error(r.code);
			out.body = r.body;
			out.effects = r.effects ?? [];
			return { ok: true, body: r.body, created: r.created, effects: (r.effects ?? []) as 'auto-union'[] };
		},
		openNew: () => {},
	};
	return { h, out };
}

beforeEach(() => {
	answers.length = 0;
});

describe('WP3.3 review: Add child with an existing child', () => {
	// A pair with two partnerships; C has no parents yet.
	const TWO = [
		'people:',
		'  - id: a',
		'    name: A',
		'  - id: b',
		'    name: B',
		'  - id: c',
		'    name: C',
		'unions:',
		'  - partners: [a, b]',
		'  - partners: [a, b]',
		'    type: betrothal',
		'',
	].join('\n');

	it('puts the child under the partnership the user chose (spec §4.3, §6.4)', async () => {
		const { h, out } = host(TWO, 'a');
		// Other parent: the first partnership (the marriage); then Person in the tree; then C.
		answers.push('p0', 'existing', { kind: 'person', id: 'c' });
		await addChild(h);
		expect(out.ops.length).toBeGreaterThan(0);
		const g = graph(out.body);
		expect(g.placementParents.get('c')?.slice().sort()).toEqual(['a', 'b']);
		// The chosen partnership is union 0; the child must not land under union 1 (the betrothal).
		expect(g.primaryUnion.get('c')).toBe('u0');
	});

	// A has no partner; C has a birth mother X. "No other parent" is not even asked (no partners).
	const ONE = ['people:', '  - id: a', '    name: A', '  - id: x', '    name: X', '  - id: c', '    name: C', '    parents: [x]', ''].join('\n');

	it('adds no automatic marriage (the decision notes: only the Add parent action adds one)', async () => {
		const { h, out } = host(ONE, 'a');
		// Person in the tree; C; type: birth.
		answers.push('existing', { kind: 'person', id: 'c' }, 'birth');
		await addChild(h);
		expect(out.ops.length).toBe(1);
		expect(out.effects).toEqual([]);
		expect(graph(out.body).unions.filter((u) => !u.implicit)).toHaveLength(0);
	});
});

describe('WP3.3 review: a new-child sheet keeps its union reference across a stale reload', () => {
	// The pair has three partnerships. The user picks the second (index 1) in Add child, then a
	// sync removes the first one while the new-child sheet is open. The sheet reloads after the
	// stale write, but `rel.union` still says index 1, which is now the third partnership.
	const THREE = [
		'people:',
		'  - id: a',
		'    name: A',
		'  - id: b',
		'    name: B',
		'unions:',
		'  - id: first',
		'    partners: [a, b]',
		'  - id: second',
		'    partners: [a, b]',
		'    type: betrothal',
		'  - id: third',
		'    partners: [a, b]',
		'    type: affair',
		'',
	].join('\n');

	it('refuses (unknown-union) rather than write the child under another partnership', () => {
		const chosen = familyOf(graph(THREE), 'a')!.partners[1].union!;
		const after = THREE.replace('  - id: first\n    partners: [a, b]\n', '');
		const r = applyOp(after, {
			kind: 'add-person',
			id: 'k',
			fields: { name: 'K' },
			parents: [
				{ id: 'a', type: 'birth' },
				{ id: 'b', type: 'birth' },
			],
			at: { kind: 'after-siblings', parents: ['a', 'b'], union: chosen },
		});
		const where = r.ok ? graph(r.body).unionByKey.get(graph(r.body).primaryUnion.get('k')!)?.id : r.code;
		expect(['second', 'unknown-union']).toContain(where);
	});
});
