// Search round 0.2.8, area A1 core (code review). Each test is a proof of one finding; each fails on release-0.2.8 (770f24b).
import { describe, expect, it } from 'vitest';
import { linkTargets } from '../../src/core/link-rewrite';
import { applyOp } from '../../src/core/yaml-edit';

const people = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C}\n';

describe('F-CORE-01: a multi-line flow list with end-of-line comments refuses to lose its first or last item', () => {
	// The comment "# first" follows the item "a," on its line. Spec §6.2 and yaml-list.ts: in a flow list an end-of-line comment belongs to the item it follows.
	it('remove-parent: removing the first parent of `parents: [a, # dad` newline `b]` is refused as "a change to a comment"', () => {
		const body = `${people}  - id: d\n    name: D\n    parents: [a, # dad\n      b] # both\n`;
		const r = applyOp(body, { kind: 'remove-parent', child: 'd', parent: 'a', type: 'birth' });
		expect(r.ok, JSON.stringify(r)).toBe(true);
	});

	it('remove-parent: removing the last parent is refused too', () => {
		const body = `${people}  - id: d\n    name: D\n    parents: [a, # dad\n      b] # both\n`;
		const r = applyOp(body, { kind: 'remove-parent', child: 'd', parent: 'b', type: 'birth' });
		expect(r.ok, JSON.stringify(r)).toBe(true);
	});

	it('delete-person: a person who is the first holder of `holders: [{person: a}, # first` newline `...]` cannot be deleted', () => {
		const body = `titles:\n  - id: duke\n    name: Duke\n    holders: [{person: a}, # first\n      {person: b}, # second\n      {person: c}] # third\n${people}`;
		const r = applyOp(body, { kind: 'delete-person', id: 'a' });
		expect(r.ok, JSON.stringify(r)).toBe(true);
	});

	it('delete-person: a person who is the first parent of `parents: [a, # dad` newline `b]` cannot be deleted', () => {
		const body = `${people}  - id: d\n    name: D\n    parents: [a, # dad\n      b] # both\n`;
		const r = applyOp(body, { kind: 'delete-person', id: 'a' });
		expect(r.ok, JSON.stringify(r)).toBe(true);
	});

	it('remove-holder: removing the first holder of that list is refused (the middle one works)', () => {
		const body = `titles:\n  - id: duke\n    name: Duke\n    holders: [{person: a}, # first\n      {person: b}, # second\n      {person: c}] # third\n${people}`;
		const middle = applyOp(body, { kind: 'remove-holder', holder: { title: 'duke', index: 1, person: 'b' } });
		expect(middle.ok, 'the middle holder can go').toBe(true);
		const first = applyOp(body, { kind: 'remove-holder', holder: { title: 'duke', index: 0, person: 'a' } });
		expect(first.ok, JSON.stringify(first)).toBe(true);
	});

	it('edit-title: taking a person out of `heir: [a, # first` newline `b]` is refused', () => {
		const body = `titles:\n  - id: duke\n    name: Duke\n    heir: [a, # first\n      b]\n${people}`;
		const r = applyOp(body, { kind: 'edit-title', id: 'duke', heirs: ['b'] });
		expect(r.ok, JSON.stringify(r)).toBe(true);
	});
});

describe('F-CORE-02: rewrite-links skips an unquoted [[name, with comma]] link that linkTargets lists', () => {
	it('lists the target and rewrites it, with a count of 1', () => {
		const body = 'people:\n  - id: a\n    name: A\n    link: [[Smith, John]]\n';
		expect(linkTargets(body)).toEqual(['Smith, John']);
		const r = applyOp(body, { kind: 'rewrite-links', map: { 'smith, john.md': 'Jones, Jan' } });
		expect(r.ok && r.changed, JSON.stringify(r)).toBe(1);
	});

	it('does the same for `[[Old|Alias, X]]`', () => {
		const body = 'people:\n  - id: a\n    name: A\n    link: [[Old|Alias, X]]\n';
		expect(linkTargets(body)).toEqual(['Old']);
		const r = applyOp(body, { kind: 'rewrite-links', map: { 'old.md': 'New' } });
		expect(r.ok && r.changed, JSON.stringify(r)).toBe(1);
	});
});

describe('F-CORE-03: add-person puts the new item between a flow item and its end-of-line comment', () => {
	it('add-person into a multi-line flow list keeps "# bee" on the line of person b', () => {
		const body = 'people: [\n  {id: a, name: A},\n  {id: b,\n   name: B}  # bee\n]\n';
		const r = applyOp(body, { kind: 'add-person', id: 'c', fields: { name: 'C' } });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const line = r.body.split('\n').find((l) => l.includes('# bee'))!;
		expect(line, r.body).not.toContain('id: c');
	});

});

describe('F-CORE-04: a new key lands between a nested block and the comment that belongs to the block', () => {
	it('set-person-fields adds a key after a nested block: its own deeper comment stays inside the block, above the new key', () => {
		const body = 'people:\n  - id: a\n    name: A\n    extra:\n      k: v\n      # about extra\n';
		const r = applyOp(body, { kind: 'set-person-fields', id: 'a', fields: { born: '1' } });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.body.indexOf('# about extra'), r.body).toBeLessThan(r.body.indexOf('born: 1'));
	});
});
