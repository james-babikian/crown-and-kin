import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { familyOf } from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';

// Review WP3.2 fix round 1 (code-reviewer): proofs.

const edit = (src: string, op: Op) => {
	const r = applyOp(src, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};

describe('flow parent list: a full-line comment inside a removed run', () => {
	// The comment is above the second removed entry. A removal keeps the comments above an item
	// (the decision notes), and the block list does keep it (control test).
	const flow = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents: [\n      a, # dad\n      # also adopted him later\n      {id: a, type: adoptive},\n      b\n    ]\n';
	const block = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents:\n      - a # dad\n      # also adopted him later\n      - {id: a, type: adoptive}\n      - b\n';

	it('control: block list keeps the comment', () => {
		expect(edit(block, { kind: 'delete-person', id: 'a' })).toContain('# also adopted him later');
	});

	it('flow list keeps the comment', () => {
		expect(edit(flow, { kind: 'delete-person', id: 'a' })).toContain('# also adopted him later');
	});
});

describe('stale-key cleanup inside one batch', () => {
	// `union: u1` names the first of two unions for a and b. Remove b and add b back in one batch:
	// the end state has the same parents, so the child must stay under u1.
	const src = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents: [a, b]\n    union: u1\nunions:\n  - id: u1\n    partners: [a, b]\n  - id: u2\n    partners: [a, b]\n';

	it('the union key survives when the batch ends with the same placement parents', () => {
		const out = edit(src, { kind: 'batch', ops: [{ kind: 'remove-parent', child: 'c', parent: 'b', type: 'birth' }, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' }] });
		expect(out).toContain('union: u1');
	});
});

describe('per-owner move guard on flow lists', () => {
	// Supervisor (fix round 2): accepted as a safe refusal. The comment cannot follow `a` to a line
	// that `]` closes, so the move is refused and the text is not changed.
	it('refuses to move a commented item when the last item closes the list on its own line', () => {
		const src = 'people: [\n  {id: p},\n  {id: a, parents: [p]}, # A\n  {id: b, parents: [p]}]\n';
		const r = applyOp(src, { kind: 'move-sibling', id: 'a', direction: 'later' });
		expect(r.ok ? 'ok' : r.code).toBe('bad-value');
	});
});

describe('batch stale-key cleanup matches people by generated id', () => {
	// Two people without ids get `~3` and `~4` from their list position. Twin One's `placement:
	// adoptive` is already invalid (no adoptive parent); the rule keeps keys that were not valid
	// before the op. Twin Two's is valid. A batch that inserts a person above them (the Add parent
	// → new person flow) shifts the generated ids, so Twin One is compared with Twin Two.
	const src = 'people:\n  - id: a\n  - id: b\n  - name: Twin One\n    parents: [a]\n    placement: adoptive\n  - name: Twin Two\n    parents: [{id: a, type: adoptive}]\n    placement: adoptive\n';

	it('a batch that does not touch Twin One keeps Twin One\'s placement key', () => {
		const r = applyOp(src, {
			kind: 'batch',
			ops: [
				{ kind: 'add-person', id: 'n', fields: { name: 'N' }, at: { kind: 'before', id: 'a' } },
				{ kind: 'add-parent', child: 'a', parent: 'n', type: 'birth' },
			],
		});
		if (!r.ok) throw new Error(r.code);
		expect(r.body).toContain('  - name: Twin One\n    parents: [a]\n    placement: adoptive\n');
	});
});

describe('UnionRef.text normalisation', () => {
	const ref = (body: string, who: string, n: number) => {
		const p = parseDynasty(body);
		if (!p.ok) throw new Error('parse');
		return familyOf(deriveFamilies(p.tree), who)!.partners.filter((x) => x.union)[n].union!;
	};

	it('two unions whose quoted start differs only in inner spaces are told apart', () => {
		// start "Spring  1102" (two spaces) and "Spring 1102" are different values.
		const body = 'people:\n  - id: a\n  - id: b\nunions:\n  - partners: [a, b]\n    start: "Spring  1102"\n  - partners: [a, b]\n    start: "Spring 1102"\n';
		const first = ref(body, 'a', 0);
		// The first union is removed elsewhere; the old ref now has index 0 = the second union.
		const after = edit(body, { kind: 'remove-union', union: first });
		expect(applyOp(after, { kind: 'remove-union', union: first }).ok).toBe(false);
	});
});
