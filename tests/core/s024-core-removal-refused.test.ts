import { describe, expect, it } from 'vitest';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';

// Search round s024. Removing a key refuses the write (no data is lost, but the owner cannot make the
// change) when the key follows a block scalar. Two causes, both in `removePair` (yaml-patch.ts).

describe('s024 C2: a comment indented under the removed key joins the block scalar before it', () => {
	// Same root cause as the known delete-person refusal, with a wider trigger: any key removal.
	const body = 'people:\n  - id: p0\n    notes: |\n      text\n    born: 1\n      # deeper comment\n';

	it('clearing a field refuses', () => {
		const r = applyOp(body, { kind: 'set-person-fields', id: 'p0', fields: { born: null } });
		// Fails: { ok: false, code: 'bad-value', detail: 'The change cannot be written without a change to a comment...' }
		expect(r.ok).toBe(true);
	});

	it('Delete house with "clear people" refuses the whole op', () => {
		const b = 'people:\n  - id: p0\n    notes: |\n      text\n    house: h1\n      # deeper comment\nhouses:\n  - {id: h1, name: H}\n';
		const r = applyOp(b, { kind: 'delete-house', id: 'h1', people: 'clear' });
		expect(r.ok).toBe(true);
	});

	it('removing a parent refuses', () => {
		const b = 'people:\n  - id: p1\n  - id: p2\n    notes: |-\n      only\n    parents: [p1]\n      # deeper comment\n';
		const r = applyOp(b, { kind: 'remove-parent', child: 'p2', parent: 'p1', type: 'birth' });
		expect(r.ok).toBe(true);
	});
});

describe('s024 C3: a key after a `|+` block scalar and a blank line cannot be removed', () => {
	// The blank line that follows the removed key joins the blank lines of the `|+` value, which changes `notes`.
	const body = 'people:\n  - id: a\n    name: A\n    notes: |+\n      keep\n\n    house: h1\n\n    born: 1\nhouses:\n  - {id: h1, name: H}\n';

	it('the sample reads as intended', () => {
		const p = parseDynasty(body);
		expect(p.ok && p.tree.people[0].notes).toBe('keep');
	});

	it('clearing house refuses', () => {
		const r = applyOp(body, { kind: 'set-person-fields', id: 'a', fields: { house: null } });
		// Fails: { ok: false, code: 'bad-value', detail: 'The change cannot be written without a change to other values...' }
		expect(r.ok).toBe(true);
	});

	it('Delete house with "clear people" refuses', () => {
		const r = applyOp(body, { kind: 'delete-house', id: 'h1', people: 'clear' });
		expect(r.ok).toBe(true);
	});
});
