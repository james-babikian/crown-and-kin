import { describe, expect, it } from 'vitest';
import type { EditResult, Op } from '../src/core/edit';
import { linkTargets } from '../src/core/link-rewrite';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';

// Version 0.2.1, D103 (spec §13.16 rule 11): reading a curly-wrapped value never rewrites it.
// A write that changes another value leaves the curly value byte for byte as typed, and a value
// that the plugin writes itself is written with straight marks, as before.

const ok = (r: EditResult): string => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const edit = (src: string, op: Op) => ok(applyOp(src, op));
const tree = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};

const BODY = [
	'options:',
	'  start: “aldric”',
	'houses:',
	'  - id: “valmont”',
	'    name: House Valmont',
	'    color: “#aabbcc”      # kept',
	'    arms: “[[valmont-arms.png]]”',
	'  - id: orsini',
	'    name: House Orsini',
	'    color: “#222”',
	'people:',
	'  - id: “aldric”',
	'    name: Aldric',
	'    house: “valmont”',
	'    link: “[[Aldric]]”',
	'    portrait: “![[aldric.png]]”',
	'  - id: bea',
	'    name: Bea',
	'  - id: cara',
	'    name: Cara',
	'    house: valmont',
	'    parents: [“aldric”, ‘bea’]',
	'    union: “u1”',
	'unions:',
	'  - {id: “u1”, partners: [“aldric”, “bea”]}',
	'',
].join('\n');

describe('curly pairs: a write leaves the typed text alone', () => {
	it('changing a name changes that line only', () => {
		const out = edit(BODY, { kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric the Bold' } });
		expect(out).toBe(BODY.replace('    name: Aldric\n', '    name: Aldric the Bold\n'));
	});

	it('a value equal to the one read writes nothing (the marks are not straightened)', () => {
		for (const fields of [{ link: '[[Aldric]]' }, { portrait: '![[aldric.png]]' }, { house: 'valmont' }]) {
			expect(edit(BODY, { kind: 'set-person-fields', id: 'aldric', fields })).toBe(BODY);
		}
		expect(edit(BODY, { kind: 'edit-house', id: 'valmont', color: '#aabbcc', arms: '[[valmont-arms.png]]' })).toBe(BODY);
	});

	it('a changed link is written straight, and the neighbour values stay byte for byte', () => {
		const out = edit(BODY, { kind: 'set-person-fields', id: 'aldric', fields: { link: '[[Aldric II]]' } });
		expect(out).toBe(BODY.replace('    link: “[[Aldric]]”\n', '    link: "[[Aldric II]]"\n'));
		expect(out).not.toContain('“[[Aldric II');
		expect(tree(out).people[0].link).toBe('[[Aldric II]]');
	});

	it('a changed portrait is written in straight double quotes', () => {
		const out = edit(BODY, { kind: 'set-person-fields', id: 'aldric', fields: { portrait: '![[new.png]]' } });
		expect(out).toBe(BODY.replace('    portrait: “![[aldric.png]]”\n', '    portrait: "![[new.png]]"\n'));
	});

	it('a changed house colour is written straight and the next house stays', () => {
		const out = edit(BODY, { kind: 'edit-house', id: 'valmont', color: '#123456' });
		expect(out).toBe(BODY.replace('color: “#aabbcc”      # kept', 'color: "#123456"      # kept'));
		expect(tree(out).houses[1].color).toBe('#222');
	});

	it('renaming a house changes that line only', () => {
		const out = edit(BODY, { kind: 'edit-house', id: 'valmont', name: 'House Valmont-Rey' });
		expect(out).toBe(BODY.replace('name: House Valmont\n', 'name: House Valmont-Rey\n'));
	});

	it('removing the arms removes that line and leaves the colour as typed', () => {
		const out = edit(BODY, { kind: 'edit-house', id: 'valmont', arms: null });
		expect(out).toBe(BODY.replace('    arms: “[[valmont-arms.png]]”\n', ''));
	});

	it('adding a person and a partnership leaves every curly value as typed', () => {
		const added = edit(BODY, { kind: 'add-person', id: 'dan', fields: { name: 'Dan' }, parents: [{ id: 'aldric', type: 'birth' }] });
		for (const line of BODY.split('\n')) expect(added).toContain(line);
		expect(tree(added).people.find((p) => p.id === 'dan')?.parents).toEqual([{ id: 'aldric', type: 'birth' }]);
		const unioned = edit(BODY, { kind: 'add-union', partners: ['aldric', 'cara'] });
		for (const line of BODY.split('\n')) expect(unioned).toContain(line);
	});

	it('setting an option leaves the typed start as it is', () => {
		const out = edit(BODY, { kind: 'set-option', key: 'focus', value: 'cara' });
		expect(out).toBe(BODY.replace('  start: “aldric”\n', '  start: “aldric”\n  focus: cara\n'));
	});

	it('an option equal to the one read writes nothing', () => {
		expect(edit(BODY, { kind: 'set-option', key: 'start', value: 'aldric' })).toBe(BODY);
	});
});

describe('curly pairs: edits that find a person by the id inside the marks', () => {
	it('removes a parent whose entry is in marks and keeps the other entry as typed', () => {
		const out = edit(BODY, { kind: 'remove-parent', child: 'cara', parent: 'aldric', type: 'birth' });
		// The child keeps one parent, so the `union` key that named the pair's partnership goes (as before).
		expect(out).toBe(BODY.replace('    parents: [“aldric”, ‘bea’]\n    union: “u1”\n', '    parents: [‘bea’]\n'));
	});

	it('changes the type of a parent entry and keeps the id as typed', () => {
		const out = edit(BODY, { kind: 'set-parent-type', child: 'cara', parent: 'bea', from: 'birth', to: 'adoptive' });
		expect(out).toContain('{id: ‘bea’, type: adoptive}');
		expect(out).toContain('“aldric”');
		expect(tree(out).people[2].parents).toEqual([
			{ id: 'aldric', type: 'birth' },
			{ id: 'bea', type: 'adoptive' },
		]);
	});

	it('adds a parent next to entries in marks', () => {
		const out = edit(BODY, { kind: 'add-parent', child: 'bea', parent: 'aldric', type: 'birth' });
		expect(tree(out).people[1].parents).toEqual([{ id: 'aldric', type: 'birth' }]);
		for (const line of BODY.split('\n')) expect(out).toContain(line);
	});

	it('deletes a person and removes the references in marks', () => {
		const out = edit(BODY, { kind: 'delete-person', id: 'aldric' });
		const t = tree(out);
		expect(t.people.map((p) => p.id)).toEqual(['bea', 'cara']);
		expect(t.people[1].parents).toEqual([{ id: 'bea', type: 'birth' }]);
		expect(t.options.start).toBeUndefined();
		expect(t.unions).toEqual([]);
		expect(out).toContain('parents: [‘bea’]');
	});

	it('changes a partnership type and keeps the partners as typed', () => {
		const out = edit(BODY, { kind: 'edit-union', union: { index: 0, partners: ['aldric', 'bea'] }, fields: { type: 'betrothal' } });
		expect(out).toContain('partners: [“aldric”, “bea”]');
		expect(tree(out).unions[0]).toMatchObject({ id: 'u1', type: 'betrothal', partners: ['aldric', 'bea'] });
	});

	it('deletes a house and clears the house of its people', () => {
		const out = edit(BODY, { kind: 'delete-house', id: 'valmont', people: 'clear' });
		const t = tree(out);
		expect(t.houses.map((h) => h.id)).toEqual(['orsini']);
		expect(t.people.map((p) => p.house)).toEqual([undefined, undefined, undefined]);
	});
});

describe('curly pairs: holders in marks', () => {
	const TITLES = [
		'titles:',
		'  - id: crown',
		'    name: Crown',
		'    holders:',
		'      - “aldric”',
		'      - {person: “bea”, as: Queen}',
		'people:',
		'  - {id: aldric, name: Aldric}',
		'  - {id: bea, name: Bea}',
		'  - {id: cara, name: Cara}',
		'',
	].join('\n');

	it('adds a holder after the typed ones and changes nothing else', () => {
		const out = edit(TITLES, { kind: 'add-holder', title: 'crown', fields: { person: 'cara' } });
		for (const line of TITLES.split('\n').slice(0, 7)) expect(out).toContain(line);
		expect(tree(out).titles![0].holders.map((h) => h.person)).toEqual(['aldric', 'bea', 'cara']);
	});

	it('changes a field of a holder with a person in marks', () => {
		const out = edit(TITLES, { kind: 'edit-holder', holder: { title: 'crown', index: 1, person: 'bea' }, fields: { as: 'Regent' } });
		expect(out).toBe(TITLES.replace('{person: “bea”, as: Queen}', '{person: “bea”, as: Regent}'));
	});

	it('gives a plain-string holder a field and keeps the person as typed', () => {
		const out = edit(TITLES, { kind: 'edit-holder', holder: { title: 'crown', index: 0, person: 'aldric' }, fields: { as: 'King' } });
		expect(out).toContain('person: “aldric”');
		expect(tree(out).titles![0].holders[0]).toMatchObject({ person: 'aldric', as: 'King' });
	});

	it('removes a holder in marks', () => {
		const out = edit(TITLES, { kind: 'remove-holder', holder: { title: 'crown', index: 0, person: 'aldric' } });
		expect(out).toBe(TITLES.replace('      - “aldric”\n', ''));
	});
});

describe('curly pairs: the rename scan', () => {
	const LINKS = [
		'houses:',
		'  - id: v',
		'    name: V',
		'    arms: “[[old/arms.png]]”',
		'people:',
		'  - id: a',
		'    name: A',
		'    link: “[[Aldric|the Bold]]”',
		'    portrait: ‘![[old/arms.png]]’',
		'  - id: b',
		'    name: B',
		'    link: „[Bea](Notes/Bea.md)“',
		'  - id: c',
		'    name: C',
		'    link: “[[Aldric]]” ',
		'',
	].join('\n');

	it('finds the targets of curly links', () => {
		expect(linkTargets(LINKS)).toEqual(['old/arms.png', 'Aldric', 'old/arms.png', 'Notes/Bea.md', 'Aldric']);
	});

	it('rewrites a curly link and keeps the marks and the alias', () => {
		const r = applyOp(LINKS, { kind: 'rewrite-links', map: { Aldric: 'People/Aldric II' } });
		expect(r.ok && r.changed).toBe(2);
		const out = ok(r);
		expect(out).toContain('link: “[[People/Aldric II|the Bold]]”\n');
		expect(out).toContain('link: “[[People/Aldric II]]”');
		expect(out).toBe(LINKS.replace('“[[Aldric|the Bold]]”', '“[[People/Aldric II|the Bold]]”').replace('“[[Aldric]]” ', '“[[People/Aldric II]]” '));
		expect(tree(out).people[0].link).toBe('[[People/Aldric II|the Bold]]');
	});

	it('rewrites curly picture links of a house and a person, and the Markdown form', () => {
		const r = applyOp(LINKS, { kind: 'rewrite-links', map: { 'old/arms.png': 'new/arms.png', 'Notes/Bea.md': 'Notes/Beatrice.md' } });
		expect(r.ok && r.changed).toBe(3);
		const out = ok(r);
		expect(out).toContain('arms: “[[new/arms.png]]”');
		expect(out).toContain("portrait: ‘![[new/arms.png]]’");
		expect(out).toContain('link: „[Bea](Notes/Beatrice.md)“');
	});

	it('changes nothing when no target is in the map', () => {
		const r = applyOp(LINKS, { kind: 'rewrite-links', map: { Nobody: 'Else' } });
		expect(r.ok && r.changed).toBe(0);
		expect(ok(r)).toBe(LINKS);
	});

	it('does not touch a name in marks that is not a link key', () => {
		const body = 'people:\n  - id: a\n    name: “Aldric”\n    notes: “[[Aldric]]”\n';
		const r = applyOp(body, { kind: 'rewrite-links', map: { Aldric: 'Other' } });
		expect(ok(r)).toBe(body);
	});

	it('does not touch a value that is wrapped only in part', () => {
		const body = 'people:\n  - id: a\n    name: A\n    link: x “[[Aldric]]”\n';
		expect(ok(applyOp(body, { kind: 'rewrite-links', map: { Aldric: 'Other' } }))).toBe(body);
	});
});

describe('curly pairs: a value the plugin writes is read the same', () => {
	it('a link typed with curly marks into the edit sheet is read without them', () => {
		const out = edit('people:\n  - {id: a, name: A}\n', { kind: 'set-person-fields', id: 'a', fields: { link: '“[[Aldric]]”' } });
		expect(tree(out).people[0].link).toBe('[[Aldric]]');
	});

	it('a house colour typed with curly marks is refused as not #rrggbb, as before', () => {
		const r = applyOp('houses:\n  - {id: v, name: V}\n', { kind: 'edit-house', id: 'v', color: '“#aabbcc”' });
		expect(r.ok).toBe(false);
	});
});
