// The readers of partnerships follow the co-parent rule (spec §0 D356 3 A and 5 A): the person window (`familyOf`: partner rows and the other-parent
// choices of "Add child"), the spouse choice of a holder through the spouse (spec §13.21 rule 13a, `succession-first.ts`) and its warning
// (`validate.ts`). An implicit couple is exactly two birth or exactly two adoptive parents of a child, wherever the card stands; with three of one
// kind there is none, in every order of the note. A pair with no union in the graph (the birth parents of a ward-placed child) has a row that
// writes a new union, as the implicit row does. The drawing is not read here and keeps its implicit unions.
import { describe, expect, it } from 'vitest';
import { familyOf } from '../../src/core/family-query';
import { firstHolderOf, spouseWorldOf } from '../../src/core/succession-first';
import { resolveSpouse } from '../../src/core/succession-keys';
import { build } from '../support/helpers';

const P = (id: string, sex: string, parents = '', extra = ''): string => `  - {id: ${id}, name: ${id}, sex: ${sex}${parents ? `, parents: [${parents}]` : ''}${extra}}`;
const t = (id: string, type: string): string => `{id: ${id}, type: ${type}}`;
const small = (people: string[], unions: string[] = []): string => `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;

/** The items of a flow list, split at the commas outside braces. */
function items(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		if (list[i] === '{') depth++;
		else if (list[i] === '}') depth--;
		else if (list[i] === ',' && depth === 0) {
			out.push(list.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(list.slice(start).trim());
	return out;
}

/** The note in another order: the person lines reversed (`people`), and every list of parents reversed (`parents`). */
function reorder(source: string, people: boolean, parents: boolean): string {
	const lines = source.split('\n');
	const at = lines.flatMap((l, i) => (/^ {2}- \{id: [^,]+, name: /.test(l) ? [i] : []));
	const person = at.map((i) => (parents ? lines[i].replace(/parents: \[(.*?)\]/, (_, list: string) => `parents: [${items(list).reverse().join(', ')}]`) : lines[i]));
	if (people) person.reverse();
	at.forEach((i, k) => (lines[i] = person[k]));
	return lines.join('\n');
}

const ORDERS: [string, boolean, boolean][] = [
	['as written', false, false],
	['people reversed', true, false],
	['parents reversed', false, true],
	['both reversed', true, true],
];

/** The note with one title whose holder is `holder`, read through the spouse. */
const titled = (source: string, holder: string) => `${source}titles:
  - id: t
    name: T
    succession: primogeniture
    holders:
      - {person: ${holder}, through-spouse: true}
`;

const THREE_ADOPTIVE = small([P('a', 'm'), P('b', 'f'), P('c', 'm'), P('w', 'm', `${t('a', 'adoptive')}, ${t('b', 'adoptive')}, ${t('c', 'adoptive')}`)]);
const THREE_BIRTH = small([P('a', 'm'), P('b', 'f'), P('c', 'm'), P('w', 'm', 'a, b, c')]);
const TWO_ADOPTIVE_ONE_BIRTH = small([P('a', 'm'), P('b', 'f'), P('c', 'm'), P('w', 'm', `${t('a', 'adoptive')}, ${t('b', 'adoptive')}, c`)]);
const WARD_CASE = small([P('f', 'm'), P('m', 'f'), P('g', 'm'), P('h', 'f'), P('w', 'm', `f, m, ${t('g', 'ward')}, ${t('h', 'ward')}`, ', placement: ward')]);
const WARD_CASE_NO_PLACEMENT = small([P('f', 'm'), P('m', 'f'), P('g', 'm'), P('h', 'f'), P('w', 'm', `f, m, ${t('g', 'ward')}, ${t('h', 'ward')}`)]);

/** The partner rows and the "Add child" other-parent choices of `id` in the note as ordered. */
const rows = (source: string, people: boolean, parents: boolean, id: string) => {
	const { g } = build(reorder(source, people, parents));
	const fam = familyOf(g, id)!;
	return { partners: fam.partners, choices: fam.otherParentChoices };
};

const NO_ROWS = { partners: [], choices: [] };
const ROW = (partner: string) => ({ partners: [{ partner, union: null, type: null }], choices: [partner] });

describe('three or more parents of one kind: no partner row, no other-parent choice, no spouse (D356 3 A)', () => {
	for (const [title, source] of [['adoptive', THREE_ADOPTIVE], ['birth', THREE_BIRTH]] as const) {
		for (const id of ['a', 'b', 'c']) {
			it(`${title}: ${id} has no partner row and no other-parent choice, in four orders`, () => {
				for (const [, people, parents] of ORDERS) expect(rows(source, people, parents, id)).toEqual(NO_ROWS);
			});
		}
		it(`${title}: a holder through the spouse has no spouse, and the warning and the line agree`, () => {
			for (const [, people, parents] of ORDERS) {
				const { g } = build(reorder(titled(source, 'a'), people, parents));
				expect(resolveSpouse(spouseWorldOf(g), 'a', true, ['a'])).toEqual({ ok: false, why: 'no-partner' });
				expect(g.issues.filter((i) => i.code.startsWith('through-spouse')).map((i) => i.code)).toEqual(['through-spouse-no-partner']);
				expect(firstHolderOf(g, g.titles[0].holders)?.id).toBe('a');
			}
		});
	}

	it('two adoptive parents and one birth parent: the adoptive two list each other, the birth parent lists none', () => {
		for (const [, people, parents] of ORDERS) {
			expect(rows(TWO_ADOPTIVE_ONE_BIRTH, people, parents, 'a')).toEqual(ROW('b'));
			expect(rows(TWO_ADOPTIVE_ONE_BIRTH, people, parents, 'b')).toEqual(ROW('a'));
			expect(rows(TWO_ADOPTIVE_ONE_BIRTH, people, parents, 'c')).toEqual(NO_ROWS);
		}
	});
});

describe('the birth parents of a ward-placed child are partners of each other, the guardians are not (D356 5 A)', () => {
	for (const [title, source] of [['placement ward', WARD_CASE], ['no placement', WARD_CASE_NO_PLACEMENT]] as const) {
		it(`${title}: f and m have a row with no union and the other as the "Add child" choice; g and h have none, in four orders`, () => {
			for (const [, people, parents] of ORDERS) {
				expect(rows(source, people, parents, 'f')).toEqual(ROW('m'));
				expect(rows(source, people, parents, 'm')).toEqual(ROW('f'));
				expect(rows(source, people, parents, 'g')).toEqual(NO_ROWS);
				expect(rows(source, people, parents, 'h')).toEqual(NO_ROWS);
			}
		});
		it(`${title}: a holder f through the spouse gets m, a holder g gets none, and the warning and the line agree`, () => {
			for (const [, people, parents] of ORDERS) {
				const f = build(reorder(titled(source, 'f'), people, parents)).g;
				expect(resolveSpouse(spouseWorldOf(f), 'f', true, ['f'])).toEqual({ ok: true, id: 'm' });
				expect(f.issues.filter((i) => i.code.startsWith('through-spouse'))).toEqual([]);
				expect(firstHolderOf(f, f.titles[0].holders)?.id).toBe('m');
				const g = build(reorder(titled(source, 'g'), people, parents)).g;
				expect(resolveSpouse(spouseWorldOf(g), 'g', true, ['g'])).toEqual({ ok: false, why: 'no-partner' });
				expect(g.issues.filter((i) => i.code.startsWith('through-spouse')).map((i) => i.code)).toEqual(['through-spouse-no-partner']);
			}
		});
	}

	it('a written union of f and m keeps its own row, once', () => {
		const source = small([P('f', 'm'), P('m', 'f'), P('w', 'm', 'f, m', ', placement: ward')], ['  - {partners: [f, m]}']);
		for (const [, people, parents] of ORDERS) {
			const r = rows(source, people, parents, 'f');
			expect(r.partners).toHaveLength(1);
			expect(r.partners[0].union).not.toBeNull();
			expect(r.choices).toEqual(['m']);
		}
	});
});
