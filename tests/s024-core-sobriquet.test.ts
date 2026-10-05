// The person key `sobriquet` in the core (D122, contract 1.1 to 1.3): reading, writing, labels and the house page.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { houseTableNote, housePage } from '../src/core/house-page';
import { parseDynasty } from '../src/core/parse';
import { cardLabels, needsLabels } from '../src/core/titles';
import type { Person } from '../src/core/types';
import { applyOp } from '../src/core/yaml-edit';

const people = (body: string): Person[] => {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('does not parse');
	return r.tree.people;
};
const write = (body: string, op: Parameters<typeof applyOp>[1]): string => {
	const r = applyOp(body, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const set = (body: string, id: string, fields: Record<string, string | null>) => write(body, { kind: 'set-person-fields', id, fields } as never);

describe('sobriquet: reading', () => {
	const read = (value: string) => people(`people:\n  - id: a\n    name: A\n    sobriquet: ${value}\n`)[0].sobriquet;

	it('is absent when the key is missing or empty', () => {
		expect('sobriquet' in people('people:\n  - id: a\n    name: A\n')[0]).toBe(false);
		expect('sobriquet' in people('people:\n  - id: a\n    name: A\n    sobriquet:\n')[0]).toBe(false);
		expect(read('""')).toBeUndefined();
		expect(read('[x]')).toBeUndefined();
	});
	it('reads plain text and takes a pair of double marks off', () => {
		expect(read('the Wise')).toBe('the Wise');
		expect(read('"“the Wise”"')).toBe('the Wise');
		expect(read('"\\"the Wise\\""')).toBe('the Wise');
		expect(read('“the Wise”')).toBe('the Wise');
	});
	it('keeps single marks and nested marks as typed', () => {
		expect(read('‘Fox’')).toBe('‘Fox’');
		expect(read('“the ‘Wise’ one”')).toBe('“the ‘Wise’ one”');
	});
	it('reads a number as text, like the name', () => {
		expect(read('1066')).toBe('1066');
	});
});

describe('sobriquet: writing', () => {
	const base = 'people:\n  - id: a\n    name: A\n    born: 1\n  - id: b\n    name: B\n';

	it('adds the key right after the name', () => {
		expect(set(base, 'a', { sobriquet: 'the Wise' })).toBe('people:\n  - id: a\n    name: A\n    sobriquet: the Wise\n    born: 1\n  - id: b\n    name: B\n');
	});
	it('adds the key after the name even when title and house are written', () => {
		const b = 'people:\n  - id: a\n    name: A\n    title: T\n    house: h\n';
		expect(set(b, 'a', { sobriquet: 'X' })).toBe('people:\n  - id: a\n    name: A\n    sobriquet: X\n    title: T\n    house: h\n');
	});
	it('changes and removes the key', () => {
		const one = set(base, 'a', { sobriquet: 'the Wise' });
		const two = set(one, 'a', { sobriquet: 'the Bold' });
		expect(two).toBe('people:\n  - id: a\n    name: A\n    sobriquet: the Bold\n    born: 1\n  - id: b\n    name: B\n');
		expect(set(two, 'a', { sobriquet: null })).toBe(base);
		expect(set(two, 'a', { sobriquet: '  ' })).toBe(base);
	});
	it('keeps a comment on the line of the key', () => {
		const b = 'people:\n  - id: a\n    name: A\n    sobriquet: old # keep this\n';
		expect(set(b, 'a', { sobriquet: 'new' })).toBe('people:\n  - id: a\n    name: A\n    sobriquet: new # keep this\n');
	});
	it('keeps the quotes of the old value', () => {
		const b = 'people:\n  - id: a\n    name: A\n    sobriquet: "old"\n';
		expect(set(b, 'a', { sobriquet: 'new' })).toBe('people:\n  - id: a\n    name: A\n    sobriquet: "new"\n');
	});
	it('writes text that plain YAML would misread in double quotes, and it reads back', () => {
		for (const t of ['a: b', '#x', '[x]', '- x', 'null', '"', '‘Fox’', '“the ‘Wise’ one”']) {
			const out = set(base, 'a', { sobriquet: t });
			expect(people(out)[0].sobriquet).toBe(t);
		}
	});
	it('writes a typed pair of marks as typed and reads the text inside', () => {
		const out = set(base, 'a', { sobriquet: '“the Wise”' });
		expect(out).toContain('sobriquet: “the Wise”');
		expect(people(out)[0].sobriquet).toBe('the Wise');
	});
	it('does nothing when the model reads the same text', () => {
		const b = 'people:\n  - id: a\n    name: A\n    sobriquet: "“the Wise”"\n';
		expect(set(b, 'a', { sobriquet: 'the Wise' })).toBe(b);
		expect(set(b, 'a', { sobriquet: '“the Wise”' })).toBe(b);
	});
	it('an edit of another field leaves the key (and its quotes) alone', () => {
		const b = 'people:\n  - id: a\n    name: A\n    sobriquet: "“the Wise”"\n    born: 1\n';
		expect(set(b, 'a', { born: '2', name: 'AA', title: 'T' })).toBe('people:\n  - id: a\n    name: AA\n    sobriquet: "“the Wise”"\n    title: T\n    born: 2\n');
	});
	it('refuses a name that is not text, never throws', () => {
		const r = applyOp(base, { kind: 'set-person-fields', id: 'a', fields: { sobriquet: 5 } } as never);
		expect(r.ok).toBe(false);
	});
	it('add-person writes the key after the name, flow or block', () => {
		const out = write(base, { kind: 'add-person', id: 'c', fields: { name: 'C', sobriquet: 'the Fat', born: '5' } } as never);
		expect(out).toContain('  - id: c\n    name: C\n    sobriquet: the Fat\n    born: 5\n');
		expect(people(out)[2].sobriquet).toBe('the Fat');
		const flow = write('people: [{id: a, name: A}]\n', { kind: 'add-person', id: 'c', fields: { name: 'C', sobriquet: 'the Fat' } } as never);
		expect(people(flow)[1].sobriquet).toBe('the Fat');
	});
});

describe('sobriquet: labels, needsLabels and the house page', () => {
	const body =
		'houses:\n  - {id: h, name: House H}\npeople:\n  - id: a\n    name: Aldric\n    sobriquet: the Wise\n    house: h\n    born: 1100\n  - id: b\n    name: Bert\n    house: h\n    born: 1101\n';
	const g = () => {
		const r = parseDynasty(body);
		if (!r.ok) throw new Error('does not parse');
		return deriveFamilies(r.tree);
	};

	it('cardLabels carries the bare text, and only when there is one', () => {
		const labels = cardLabels(g());
		expect(labels.get('a')!.sobriquet).toBe('the Wise');
		expect('sobriquet' in labels.get('b')!).toBe(false);
		expect(labels.get('a')!.name).toBe('Aldric');
	});
	it('needsLabels is true for a tree with a sobriquet and no title, false for neither', () => {
		expect(needsLabels(g())).toBe(true);
		const none = parseDynasty('people:\n  - id: a\n    name: A\n');
		expect(none.ok && needsLabels(deriveFamilies(none.tree))).toBe(false);
	});
	it('the house page and its table note put the sobriquet in curly marks after the name', () => {
		const page = housePage(g(), 'h')!;
		expect(page.rows.map((r) => r.name)).toEqual(['Aldric “the Wise”', 'Bert']);
		expect(houseTableNote(page)).toContain('| 1 | Aldric “the Wise” |');
	});
	it('the house page puts it after the regnal name of a ruler', () => {
		const t =
			'houses:\n  - {id: h, name: House H}\ntitles:\n  - id: king\n    name: King\n    holders:\n      - {person: a, number: 2}\npeople:\n  - id: a\n    name: Aldric\n    sobriquet: the Wise\n    house: h\n';
		const r = parseDynasty(t);
		if (!r.ok) throw new Error('does not parse');
		expect(housePage(deriveFamilies(r.tree), 'h')!.rows[0].name).toBe('Aldric 2 “the Wise”');
	});
});
