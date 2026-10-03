import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import type { EditResult, Op } from '../src/core/edit';
import { nextPersonId } from '../src/core/id-gen';
import { issueText } from '../src/core/messages';
import { parseDynasty, parseBody, referencedIds } from '../src/core/parse';
import { applyOp, newPersonId } from '../src/core/yaml-edit';
import { randomTree } from './random-trees';

// Version 1.1.2, D104 and D105 (spec §13.17 rules 1 and 2): numbered ids for new people, the
// example in the "has no id" warning, and the name in the duplicate id warning.

const ok = (r: EditResult): EditResult & { ok: true } => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r;
};
const add = (body: string, name: string): { body: string; id: string } => {
	const id = newPersonId(body, name);
	return { id, body: ok(applyOp(body, { kind: 'add-person', id, fields: { name } })).body };
};
const tree = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};
const texts = (src: string, code: string) =>
	tree(src)
		.issues.filter((i) => i.code === code)
		.map(issueText);

describe('newPersonId and add-person (D104)', () => {
	const BODY = 'people:\n  - {id: aldric, name: Aldric}\n';

	it('the first new person is p1, then p2: the name never influences the id', () => {
		const first = add(BODY, 'Aldric');
		expect(first.id).toBe('p1');
		const second = add(first.body, 'Aldric');
		expect(second.id).toBe('p2');
		expect(tree(second.body).people.map((p) => p.id)).toEqual(['aldric', 'p1', 'p2']);
		expect(newPersonId(BODY, 'Zed')).toBe(newPersonId(BODY, 'Aldric'));
		expect(newPersonId(BODY, '')).toBe(newPersonId(BODY, '李'));
		expect(newPersonId(BODY, undefined as unknown as string)).toBe('p1');
	});

	it('goes on after the highest number, also when the people are not in order', () => {
		const body = 'people:\n  - {id: p7, name: A}\n  - {id: p3, name: B}\n  - {id: p-5, name: C}\n  - {id: p3-p7, name: D}\n  - {id: P9, name: E}\n';
		expect(newPersonId(body, 'X')).toBe('p8');
	});

	it('a leading zero counts', () => {
		expect(newPersonId('people:\n  - {id: p007, name: A}\n', 'X')).toBe('p8');
	});

	it('a numeric id of the YAML is text: 7 is not p7', () => {
		expect(newPersonId('people:\n  - {id: 7, name: A}\n', 'X')).toBe('p1');
	});

	it('a dangling reference counts as taken, in every place that names a person', () => {
		const people = '  - {id: p2, name: A}\n';
		expect(newPersonId(`options: {start: p9}\npeople:\n${people}`, 'X')).toBe('p10');
		expect(newPersonId(`options: {focus: p9}\npeople:\n${people}`, 'X')).toBe('p10');
		expect(newPersonId(`options: {me: p9}\npeople:\n${people}`, 'X')).toBe('p10');
		expect(newPersonId(`people:\n  - {id: p2, name: A, parents: [p9]}\n`, 'X')).toBe('p10');
		expect(newPersonId(`people:\n  - {id: p2, name: A, parents: [{id: p9, type: ward}]}\n`, 'X')).toBe('p10');
		expect(newPersonId(`unions:\n  - {partners: [p2, p9]}\npeople:\n${people}`, 'X')).toBe('p10');
		expect(newPersonId(`titles:\n  - {id: t, name: T, holders: [{person: p9}]}\npeople:\n${people}`, 'X')).toBe('p10');
		expect(newPersonId(`titles:\n  - {id: t, name: T, holders: [p9]}\npeople:\n${people}`, 'X')).toBe('p10');
	});

	it('the number of a deleted last person can be used again if no reference names it', () => {
		const body = 'people:\n  - {id: p1, name: A}\n  - {id: p2, name: B, parents: [p1]}\n  - {id: p3, name: C, parents: [p2]}\n';
		const after = ok(applyOp(body, { kind: 'delete-person', id: 'p3' })).body;
		expect(newPersonId(after, 'X')).toBe('p3');
		// Deleting a person removes the references to them, so a dangling one cannot come from the delete.
		expect(after).not.toContain('p3');
	});

	it('the ids of a batch: two people added in one write get two different ids', () => {
		const body = BODY;
		// The caller adds each id it chooses to `taken` at once (the sheet does the same with `nextPersonId`).
		const parsed = parseBody(body);
		const taken = parsed.ok ? referencedIds(parsed.data as never) : new Set<string>();
		const a = nextPersonId(taken);
		taken.add(a);
		const b = nextPersonId(taken);
		expect([a, b]).toEqual(['p1', 'p2']);
		const ops: Op[] = [
			{ kind: 'add-person', id: a, fields: { name: 'Aldric' } },
			{ kind: 'add-person', id: b, fields: { name: 'Aldric' } },
			{ kind: 'add-union', partners: [a, b] },
		];
		const out = ok(applyOp(body, { kind: 'batch', ops }));
		expect(out.created).toEqual(['p1', 'p2']);
		expect(tree(out.body).unions[0].partners).toEqual(['p1', 'p2']);
	});

	it('a union id is still made from the partners (p1-p2)', () => {
		// A second partnership of a couple: the first one has children and gets the id (§4.3).
		const body = 'people:\n  - {id: p1, name: A}\n  - {id: p2, name: B}\n  - {id: p3, name: C, parents: [p1, p2]}\nunions:\n  - {partners: [p1, p2]}\n';
		const out = ok(applyOp(body, { kind: 'add-union', partners: ['p1', 'p2'], type: 'betrothal' }));
		expect(tree(out.body).unions.map((u) => u.id)).toEqual(['p1-p2', undefined]);
	});

	it('property: in random trees the next id is above every p<number> and unused, and the write adds one person', () => {
		for (let seed = 1; seed <= 40; seed++) {
			const body = randomTree(seed);
			const t = tree(body);
			const id = newPersonId(body, 'Someone');
			expect(id, `seed ${seed}`).toBe(`p${t.people.length}`);
			const out = ok(applyOp(body, { kind: 'add-person', id, fields: { name: 'Someone' } }));
			expect(tree(out.body).people.map((p) => p.id), `seed ${seed}`).toEqual([...t.people.map((p) => p.id), id]);
			expect(newPersonId(out.body, 'Someone')).toBe(`p${t.people.length + 1}`);
		}
	});
});

describe('the "has no id" example for a person (D104, the reader)', () => {
	it('is p1 in a tree with no numbered id', () => {
		expect(texts('people:\n  - {name: Aldric}\n', 'missing-id')).toEqual(['Aldric has no id. Add an id, for example: id: p1.']);
		expect(texts('people:\n  - {id: aldric, name: Aldric}\n  - {name: Bea}\n', 'missing-id')).toEqual(['Bea has no id. Add an id, for example: id: p1.']);
	});

	it('is a number that is not used when the tree has p1 to p3', () => {
		const body = 'people:\n  - {id: p1, name: One}\n  - {id: p2, name: Two}\n  - {id: p3, name: Three}\n  - {name: Four}\n';
		expect(texts(body, 'missing-id')).toEqual(['Four has no id. Add an id, for example: id: p4.']);
	});

	it('two people with no id get two different examples', () => {
		const body = 'people:\n  - {id: p1, name: One}\n  - {name: Two}\n  - {name: Three}\n  - {id: p9, name: Nine}\n  - {}\n';
		const t = tree(body);
		const examples = t.issues.filter((i) => i.code === 'missing-id').map((i) => i.params.example);
		expect(examples).toEqual(['p10', 'p11', 'p12']);
		expect(new Set(examples).size).toBe(3);
	});

	it('does not use the name, and a reference counts as taken', () => {
		const body = 'people:\n  - {name: Aldric Valmont, parents: [p4]}\n';
		expect(texts(body, 'missing-id')).toEqual(['Aldric Valmont has no id. Add an id, for example: id: p5.']);
	});

	it('an entry with no name is named by its place', () => {
		expect(texts('people:\n  - {house: x}\n', 'missing-id')).toEqual(['Entry 1 in the “people” list has no id. Add an id, for example: id: p1.']);
	});

	it('the example pasted into the tree gives no duplicate id', () => {
		const body = 'people:\n  - {id: p1, name: One}\n  - {name: Two}\n  - {name: Three}\n';
		let fixed = body;
		for (const i of tree(body).issues.filter((x) => x.code === 'missing-id')) {
			const name = tree(body).people.find((p) => p.id === i.ids?.[0])!.name;
			fixed = fixed.replace(`{name: ${name}}`, `{id: ${i.params.example}, name: ${name}}`);
		}
		expect(deriveFamilies(tree(fixed)).issues).toEqual([]);
	});

	it('houses and titles keep the slug of the name as the example', () => {
		expect(texts('houses:\n  - {name: House Valmont}\n', 'missing-id')).toEqual([
			'House Valmont has no id, so the tree does not use this house. Add an id, for example: id: house-valmont.',
		]);
		expect(texts('titles:\n  - {name: Duke of Valmont}\n', 'missing-id')).toEqual([
			'Duke of Valmont has no id, so the tree does not use this title. Add an id, for example: id: duke-of-valmont.',
		]);
	});

	it('the reading of the tree is the same as before: ids are strings, the person is kept under a temporary id', () => {
		const t = tree('people:\n  - {name: Aldric}\n');
		expect(t.people).toHaveLength(1);
		expect(t.people[0].id).toBe('~1');
	});
});

describe('the duplicate person id warning (D105)', () => {
	const dup = (name1: string, name2 = 'Other') => `people:\n  - {id: p3, ${name1 ? `name: ${name1}, ` : ''}x: 1}\n  - {id: p3, name: ${name2}}\n`;
	const banner = (src: string) => {
		const g = deriveFamilies(tree(src));
		return g.issues.filter((i) => i.code === 'duplicate-person-id').map(issueText);
	};

	it('shows the name of the first person and the id as NAME (id)', () => {
		expect(banner(dup('Aldric Valmont'))).toEqual(['Aldric Valmont (p3) has the same id as another person. To edit the tree again, give each person a different id.']);
	});

	it('the id has no quote mark inside NAME (id)', () => {
		const [text] = banner(dup('Aldric Valmont'));
		expect(text).not.toMatch(/[“”"'‘’]/);
		expect(text).toContain('(p3)');
	});

	it('a first person with no name, or a name equal to the id, gives the id-only text', () => {
		const idOnly = 'More than one person has the id “p3”. To edit the tree again, give each person a different id.';
		expect(banner(dup(''))).toEqual([idOnly]);
		expect(banner(dup('p3'))).toEqual([idOnly]);
	});

	it('one warning for one id, however many people share it', () => {
		const src = 'people:\n  - {id: p3, name: A}\n  - {id: p3, name: B}\n  - {id: p3, name: C}\n';
		expect(banner(src)).toHaveLength(1);
	});

	it('a warning about an id that no person has shows the id only', () => {
		const src = 'people:\n  - {id: p1, name: A, parents: [p9]}\n';
		const text = tree(src).issues.concat(deriveFamilies(tree(src)).issues).map(issueText).find((t) => t.includes('p9'));
		expect(text).toBe('A has a parent with the id “p9”, but no person has this id. Correct the id, or add the person.');
	});

	it('the editing is blocked, as before', () => {
		const r = applyOp(dup('Aldric Valmont'), { kind: 'add-person', id: 'p9', fields: { name: 'X' } });
		expect(r).toMatchObject({ ok: false, code: 'blocked' });
	});

	it('the sentences are short (STE: 20 words or fewer)', () => {
		for (const text of [...banner(dup('Aldric Valmont')), ...banner(dup(''))]) for (const sentence of text.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
	});
});
