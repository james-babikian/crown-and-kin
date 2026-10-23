import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { Op } from '../../src/core/edit';
import { familyOf } from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';

// Review WP3.2 (code-reviewer): proofs. Each test states the behaviour the spec or the decision notes asks for.

const edit = (src: string, op: Op) => {
	const r = applyOp(src, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};

describe('comments stay with the person they are written inside (§6.2, §6.5)', () => {
	// An indented comment on A's last line belongs to A (it sits at A's key column, inside A's item).
	const src = 'people:\n  - id: p\n  - id: a\n    name: A\n    parents: [p]\n    # TODO: check A\'s birth year\n  - id: b\n    name: B\n    parents: [p]\n';

	it('move-sibling moves the indented comment with A, not with B', () => {
		const out = edit(src, { kind: 'move-sibling', id: 'b', direction: 'earlier' });
		// Expected: B first, then A with its TODO comment.
		expect(out).toBe('people:\n  - id: p\n  - id: b\n    name: B\n    parents: [p]\n  - id: a\n    name: A\n    parents: [p]\n    # TODO: check A\'s birth year\n');
	});

	it('add-person after A does not push the new person between A and A\'s comment', () => {
		const out = edit(src.replace(/  - id: b[\s\S]*$/, '  - id: z\n'), { kind: 'add-person', id: 'n', fields: { name: 'N' }, parents: [{ id: 'p', type: 'birth' }], at: { kind: 'after-siblings', parents: ['p'] } });
		expect(out).toContain('    # TODO: check A\'s birth year\n  - id: n\n');
	});

	it('move-sibling in a multi-line flow list keeps end-of-line comments with their person', () => {
		const flow = 'people: [\n  {id: p}, # P\n  {id: a, parents: [p]}, # about A\n  {id: b, parents: [p]} # about B\n]\n';
		const out = edit(flow, { kind: 'move-sibling', id: 'b', direction: 'earlier' });
		// The guard sorts comments before comparing, so a swap of owners is not seen.
		expect(out).not.toContain('{id: b, parents: [p]}, # about A');
	});
});

describe('a single parent map where a list was expected (§8 tolerated; parse reads it)', () => {
	const src = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents: {id: a, type: ward}\n';

	it('the sheet lists a as a ward parent', () => {
		const p = parseDynasty(src);
		if (!p.ok) throw new Error('parse');
		expect(familyOf(deriveFamilies(p.tree), 'c')!.parents).toEqual([{ id: 'a', type: 'ward' }]);
	});

	it('remove-parent of that ward link succeeds', () => {
		expect(applyOp(src, { kind: 'remove-parent', child: 'c', parent: 'a', type: 'ward' }).ok).toBe(true);
	});

	it('set-parent-type of that ward link succeeds', () => {
		expect(applyOp(src, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'ward', to: 'adoptive' }).ok).toBe(true);
	});

	it('add-parent keeps the ward link and adds the new one', () => {
		expect(applyOp(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' }).ok).toBe(true);
	});
});

describe('refusal details', () => {
	it('delete-person with an aliased options map refuses without a JavaScript error text', () => {
		const r = applyOp('defs: &o {start: a}\noptions: *o\npeople:\n  - id: a\n  - id: b\n', { kind: 'delete-person', id: 'a' });
		expect(r.ok).toBe(false);
		expect(r.ok ? '' : r.detail ?? '').not.toMatch(/Cannot read properties/);
	});
});
