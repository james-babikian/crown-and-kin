/*
 * 0.2.8 package P1: the relation rules R1 to R4, the tie-break order, the unlisted-parent forms, the one card text and
 * the dead sign. Every row of the gate vet's case table (an internal study section 2) is a test with its
 * expected card text; `|` separates the card word from the "Also" names. A row that lists the finder step checks it too.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../src/core/relations';
import { CARD_SPOKEN_DEAD, CARD_SPOKEN_DEAD_DOUBT, MAYBE_TEXT, cardLabel, cardRelationText, dateLine, finderSentence, relationInfo, relationSummary, spokenRelation, stepSentences } from '../src/render/tree-info';
import { familyOf } from '../src/core/family-query';
import type { Person } from '../src/core/types';
import { build, fixture } from './helpers';
import { genModel, shuffled, toText } from './r028-gen';

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };

/** Lines are "id sex parent[:type] ..." (sex "-" for none); unions are "a,b". */
function tree(people: string[], unions: string[] = []): FamilyGraph {
	const out = ['people:'];
	for (const line of people) {
		const [id, sex, ...parents] = line.split(' ');
		const refs = parents.map((p) => {
			const [pid, type] = p.split(':');
			return type ? `{id: ${pid}, type: ${type}}` : pid;
		});
		out.push(`  - {id: ${id}, name: ${id}${sex === '-' ? '' : `, sex: ${sex}`}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`);
	}
	if (unions.length) out.push('unions:', ...unions.map((u) => `  - partners: [${u}]`));
	const r = parseDynasty(out.join('\n') + '\n');
	if (!r.ok) throw new Error('parse ' + r.error.code);
	return deriveFamilies(r.tree);
}

/** The card word (with its maybe), then the other names, joined with " | ". */
function all(g: FamilyGraph, me: string, other: string, o: RelationOptions = ON): string {
	const l = computeRelations(g, me, o).get(other) ?? [];
	return l.map((r, i) => (i === 0 ? cardRelationText(r) : r.text)).join(' | ') || '(none)';
}

/** The finder steps of the first relation of `b` to `a`, as sentences. */
function steps(g: FamilyGraph, a: string, b: string, index = 0, o: RelationOptions = ON): string[] {
	const r = findRelation(g, a, b, o);
	if (r.kind !== 'named') throw new Error('not named');
	return stepSentences(g, r.relations[index].steps).shown;
}

const rum = (k: number, pre: string) => Array.from({ length: k }, (_, i) => `${pre}${i}`);

describe('R1: a rumoured short line does not hide the sure longer line to the same ancestor', () => {
	it('R1-1: H lists M and the rumoured F; G is the rumoured grandfather and the sure great-grandfather', () => {
		const g = tree(['G m', 'F m G', 'N m G', 'M f N', 'H m M F:rumoured']);
		expect(all(g, 'H', 'G')).toBe('Rumoured grandfather | Great-grandfather');
		expect(all(g, 'G', 'H')).toBe('Rumoured grandson | Great-grandson');
	});

	it('R1-2 (F-KIN-02): H is the sure great-grandson of F and lists F as a rumoured father', () => {
		const g = tree(['F m', 'S m F', 'G m S', 'H m G F:rumoured']);
		expect(all(g, 'H', 'F')).toBe('Rumoured father | Great-grandfather');
		expect(all(g, 'F', 'H')).toBe('Rumoured son | Great-grandson');
	});

	it('R1-3: M lists the sure F and the rumoured U; U is a sure half-uncle (control: the rumoured name leads, the sure name stays)', () => {
		const g = tree(['G m', 'F m G', 'U m G', 'M m F U:rumoured']);
		expect(all(g, 'M', 'U')).toBe('Rumoured father | Half-uncle');
		const rels = computeRelations(g, 'M', ON).get('U')!;
		expect(rels[1].maybe?.effect).toBe('full');
	});

	it('R1: a rumoured ancestor with no sure line gets no second name', () => {
		const g = tree(['F m', 'H m F:rumoured']);
		expect(all(g, 'H', 'F')).toBe('Rumoured father');
	});

	it('R1: the sure line is a name of its own for a cousin too (C1 lists a rumoured parent B1 of C2; the sure line is second cousins)', () => {
		const g = tree(['X m', 'A m X', 'B m X', 'A1 m A', 'B1 m B', 'C1 m A1 B1:rumoured', 'C2 m B1']);
		expect(all(g, 'C1', 'C2')).toBe('Rumoured half-brother | Half second cousin');
		expect(all(g, 'C2', 'C1')).toBe('Rumoured half-brother | Half second cousin');
	});

	it('R1 x R2: the wife of C2 is a rumoured sister-in-law of C1 and, by the sure line, a second cousin by marriage', () => {
		const g = tree(['X m', 'A m X', 'B m X', 'A1 m A', 'B1 m B', 'C1 m A1 B1:rumoured', 'C2 m B1', 'W f'], ['C2,W']);
		expect(all(g, 'C1', 'W')).toBe('Rumoured sister-in-law | Second cousin by marriage');
	});
});

describe('R1 x R2: the by-marriage gate lets a rumoured blood name pass', () => {
	it('R1xR2: P is the wife of R; R is the sure great-grandfather and the rumoured grandfather of H', () => {
		const g = tree(['R m', 'X m R', 'Y m X R:rumoured', 'H m Y', 'P f'], ['R,P']);
		expect(all(g, 'H', 'P')).toBe('Rumoured step-grandmother | Great-grandfather’s wife');
	});

	it('R2-10b: P is the wife of N and a rumoured child of N; N is the sure father of M', () => {
		const g = tree(['N m', 'P f N:rumoured', 'M m N'], ['N,P']);
		expect(all(g, 'M', 'P')).toBe('Stepmother | Rumoured half-sister');
	});

	it('R2-12: P is the wife of the sure father N and a rumoured child of G, the father of N', () => {
		const g = tree(['G m', 'N m G', 'P f G:rumoured', 'M m N'], ['N,P']);
		expect(all(g, 'M', 'P')).toBe('Stepmother | Rumoured half-aunt');
	});

	it('R2-13: P is the mother of the wife of M and a rumoured child of F2, so a rumoured first cousin of M', () => {
		const g = tree(['G m', 'F1 m G', 'F2 m G', 'M m F1', 'P f F2:rumoured', 'W f P'], ['M,W']);
		expect(all(g, 'M', 'P')).toBe('Mother-in-law | Rumoured half first cousin');
	});

	it('R2-11: P is a sister of the wife of M and a rumoured child of F2, so a rumoured first cousin of M', () => {
		const g = tree(['G m', 'F1 m G', 'F2 m G', 'Q m', 'W f Q', 'P f Q F2:rumoured', 'M m F1'], ['M,W']);
		expect(all(g, 'M', 'P')).toBe('Sister-in-law | Rumoured half first cousin');
	});

	it('R2: a sure blood name still hides the rule 1 name and puts no by-marriage name beside it (P is a sure half-sister of M)', () => {
		const g = tree(['N m', 'P f N', 'M m N'], ['N,P']);
		expect(all(g, 'M', 'P')).toBe('Half-sister, maybe full');
	});

	it('R1: a rumoured blood relative P who lies on the line from M to R gets no name by marriage and no repeated person in a line', () => {
		// P is a rumoured father of M and the husband of G, the mother of P: the line M, P, G would list P twice.
		const g = tree(['G f', 'P m G', 'M m P:rumoured'], ['G,P']);
		expect(all(g, 'M', 'P')).toBe('Rumoured father');
		for (const [me, list] of [['M', computeRelations(g, 'M', ON)], ['P', computeRelations(g, 'P', ON)], ['G', computeRelations(g, 'G', ON)]] as const) {
			for (const [id, rels] of list) for (const r of rels) expect(new Set(r.line.people).size, `${me} to ${id} ${r.text}`).toBe(r.line.people.length);
		}
	});
});

describe('R2: a by-marriage name whose blood leg is rumoured gets "Rumoured "', () => {
	it('R2-1 (F-KIN-03): P is the wife of the rumoured father R of M', () => {
		const g = tree(['R m', 'P f', 'M m R:rumoured'], ['R,P']);
		expect(all(g, 'M', 'P')).toBe('Rumoured stepmother');
		expect(all(g, 'P', 'M')).toBe('Rumoured stepson');
	});

	it('R2-1b: the sure father and mother come first; the wife of the rumoured father is still a rumoured stepmother', () => {
		const g = tree(['N m', 'Q f', 'R m', 'P f', 'M m N Q R:rumoured'], ['N,Q', 'R,P']);
		expect(all(g, 'M', 'P')).toBe('Rumoured stepmother');
	});

	it('R2-3: P is a rumoured sister of the wife of M', () => {
		const g = tree(['Q m', 'M m', 'W f Q', 'P f Q:rumoured'], ['M,W']);
		expect(all(g, 'M', 'P')).toBe('Rumoured sister-in-law');
		expect(all(g, 'P', 'M')).toBe('Rumoured brother-in-law');
	});

	it('R2-4: H is the husband of a rumoured daughter of M', () => {
		const g = tree(['M m', 'D f M:rumoured', 'H m'], ['D,H']);
		expect(all(g, 'M', 'H')).toBe('Rumoured son-in-law');
		expect(all(g, 'H', 'M')).toBe('Rumoured father-in-law');
	});

	it('R2-5: P is a rumoured child of S, the wife of M', () => {
		const g = tree(['S f', 'M m', 'P - S:rumoured'], ['M,S']);
		expect(all(g, 'M', 'P')).toBe('Rumoured stepchild');
		expect(all(g, 'P', 'M')).toBe('Rumoured stepfather');
	});

	it('R2: an aunt by marriage through a rumoured uncle keeps the word in front', () => {
		const sure = tree(['G m', 'F m G', 'U m G', 'M m F', 'P f'], ['U,P']);
		const rumoured = tree(['G m', 'F m G', 'U m G:rumoured', 'M m F', 'P f'], ['U,P']);
		expect(all(sure, 'M', 'P')).toBe('Aunt by marriage');
		expect(all(rumoured, 'M', 'P')).toBe('Rumoured aunt by marriage');
	});

	it('R2: the finder says the name and the steps say "rumoured"', () => {
		const g = tree(['R m', 'P f', 'M m R:rumoured'], ['R,P']);
		const r = findRelation(g, 'M', 'P', ON);
		if (r.kind !== 'named') throw new Error('not named');
		expect(finderSentence(g, r, 0)).toBe('P is M’s rumoured stepmother.');
		expect(stepSentences(g, r.relations[0].steps).shown).toEqual(['R is M’s rumoured father.', 'P is R’s wife.']);
	});

	it('R2-8: a wife of a rumoured great-grandson has the word once', () => {
		const g = tree(['M m', 'A m M', 'B m A', 'R m B:rumoured', 'P f'], ['R,P']);
		expect(all(g, 'M', 'P')).toBe('Rumoured great-grandson’s wife');
	});

	it('R2-9: an adoptive leg gets no word', () => {
		const g = tree(['R m', 'P f', 'M m R:adoptive'], ['R,P']);
		expect(all(g, 'M', 'P')).toBe('Stepmother');
	});

	it('R2: a step-sibling through a rumoured link stays unnamed', () => {
		const g = tree(['N m', 'Q f', 'M m N:rumoured', 'P f Q'], ['N,Q']);
		const names = (computeRelations(g, 'M', ON).get('P') ?? []).map((r) => r.text);
		expect(names.join(' | ')).not.toMatch(/step-?sister|stepsister|step-sibling/i);
	});
});

describe('R2 x R3: the sure by-marriage name leads; two rumoured names tie-break by group', () => {
	it('R2xR3-a: P is a sure mother-in-law and a rumoured stepmother of M', () => {
		const g = tree(['P f', 'Z m', 'R m', 'W f P Z', 'M m R:rumoured'], ['M,W', 'R,P']);
		expect(all(g, 'M', 'P')).toBe('Mother-in-law | Rumoured stepmother');
	});

	it('R2xR3-b: P is a rumoured mother-in-law and a rumoured stepmother of M (step before in-law)', () => {
		const g = tree(['P f', 'Z m', 'R m', 'W f P:rumoured Z', 'M m R:rumoured'], ['M,W', 'R,P']);
		expect(all(g, 'M', 'P')).toBe('Rumoured stepmother | Rumoured mother-in-law');
	});
});

describe('R3: one fixed order for names of equal rank', () => {
	it('R3-1: a stepmother and a mother-in-law of one person, in both orders of the people', () => {
		const a = tree(['P f', 'N m', 'Z m', 'W f P Z', 'M m N'], ['N,P', 'M,W']);
		const b = tree(['M m N', 'W f P Z', 'Z m', 'N m', 'P f'], ['M,W', 'N,P']);
		expect(all(a, 'M', 'P')).toBe('Stepmother | Mother-in-law');
		expect(all(b, 'M', 'P')).toBe('Stepmother | Mother-in-law');
		expect(all(a, 'P', 'M')).toBe(all(b, 'P', 'M'));
		expect(all(a, 'P', 'M')).toBe('Stepson | Son-in-law');
	});

	it('R3-2 (T-X1-01): a half-aunt and a half-niece, in both orders of the people: the older generation first', () => {
		const a = tree(['GP m', 'W1 f', 'W2 f', 'A m GP W1', 'C f', 'M m A C', 'S f A', 'X m', 'P f GP S'], []);
		const b = tree(['P f GP S', 'X m', 'S f A', 'M m A C', 'C f', 'A m GP W1', 'W2 f', 'W1 f', 'GP m'], []);
		expect(all(a, 'M', 'P')).toBe('Half-aunt | Half-niece');
		expect(all(b, 'M', 'P')).toBe('Half-aunt | Half-niece');
		expect(all(a, 'P', 'M')).toBe(all(b, 'P', 'M'));
	});

});

describe('R4 (I09): outcome sets for "maybe full" and "maybe half"', () => {
	const sueTom = tree(['Anna f', 'Carl m', 'Dirk m', 'Tom m Anna Carl:rumoured', 'Sue f Carl Anna Dirk:rumoured']);

	it('R4-1: Sue (Carl, Anna, rumoured Dirk) and Tom (Anna, rumoured Carl): Carl would make them full', () => {
		// The rumoured line through Carl would add "Rumoured half-brother"; the sure line's "maybe full" has made "Rumoured brother" already (fix round, D205 item 2).
		expect(all(sueTom, 'Sue', 'Tom')).toBe('Half-brother, maybe full | Rumoured brother');
		expect(all(sueTom, 'Tom', 'Sue')).toBe('Half-sister, maybe full | Rumoured sister');
		expect(all(sueTom, 'Sue', 'Tom', OFF)).toBe('Half-brother, maybe full | Rumoured brother');
		const m = computeRelations(sueTom, 'Sue', ON).get('Tom')![0].maybe!;
		expect(m.cause).toBe('rumoured');
		// The Dirk link need not be true for the pair to be full.
		expect(m.some).toBe(true);
	});

	it('R4-1: the finder step of the extra name prints the outcome word, "rumoured brother"', () => {
		expect(steps(sueTom, 'Sue', 'Tom', 1)).toEqual(['Tom is Sue’s rumoured brother.']);
		expect(steps(sueTom, 'Sue', 'Tom', 1, OFF)).toEqual(['Tom is Sue’s rumoured brother.']);
	});

	it('R4-2: Eleanor (David, Mary, rumoured Yannick) and Fiona (David, Mary) stay "Sister, maybe half" (D174 item 4)', () => {
		const g = tree(['Mary f', 'David m', 'Yannick m', 'Eleanor f David Mary Yannick:rumoured', 'Fiona f David Mary']);
		expect(all(g, 'Fiona', 'Eleanor')).toBe('Sister, maybe half | Rumoured half-sister');
		expect(all(g, 'Eleanor', 'Fiona')).toBe('Sister, maybe half | Rumoured half-sister');
		expect(steps(g, 'Fiona', 'Eleanor', 1)).toEqual(['Eleanor is Fiona’s rumoured half-sister.']);
	});

	it('R4-3: Tom (Anna, rumoured Carl) and Sue (Carl, Anna) with no third parent', () => {
		const g = tree(['Anna f', 'Carl m', 'Tom m Anna Carl:rumoured', 'Sue f Carl Anna']);
		expect(all(g, 'Sue', 'Tom')).toBe('Half-brother, maybe full | Rumoured brother');
		expect(steps(g, 'Sue', 'Tom', 1)).toEqual(['Tom is Sue’s rumoured brother.']);
	});

	it('R4-5: Tom (Anna, rumoured Dirk) and Sue (Carl, Anna, rumoured Dirk): no set is equal', () => {
		const g = tree(['Anna f', 'Carl m', 'Dirk m', 'Tom m Anna Dirk:rumoured', 'Sue f Carl Anna Dirk:rumoured']);
		expect(all(g, 'Sue', 'Tom')).toBe('Half-brother | Rumoured half-brother');
	});

	it('P1xR4-8: Tom (Anna and 8 rumoured parents, one is Carl) and Sue (Carl, Anna and 8 rumoured): "maybe full"', () => {
		const xs = rum(7, 'x');
		const people = [...xs.map((x) => `${x} m`), 'Anna f', 'Carl m', `Tom m Anna Carl:rumoured ${xs.map((x) => x + ':rumoured').join(' ')}`, `Sue f Carl Anna ${[...xs, 'x7'].map((x) => x + ':rumoured').join(' ')}`, 'x7 m'];
		const g = tree(people);
		expect(all(g, 'Tom', 'Sue')).toMatch(/^Half-sister, maybe full/);
	});

	it('P1xR4-9: with 9 rumoured parents the relation code keeps one set and names no maybe (P2 warns, contract B.3)', () => {
		const xs = rum(8, 'x');
		const people = [...xs.map((x) => `${x} m`), 'Anna f', 'Carl m', `Tom m Anna Carl:rumoured ${xs.map((x) => x + ':rumoured').join(' ')}`, `Sue f Carl Anna ${xs.map((x) => x + ':rumoured').join(' ')}`];
		const g = tree(people);
		expect(all(g, 'Tom', 'Sue')).toMatch(/^Half-sister/);
	});

	it.each([8, 9])('P1-A%i: Ada (Mark and k rumoured), Bea (Mark, rumoured x0)', (k) => {
		const people = [...rum(k, 'x').map((x) => `${x} m`), 'Mark m', 'Bea f Mark x0:rumoured', 'Ada f Mark ' + rum(k, 'x').map((x) => x + ':rumoured').join(' ')];
		const g = tree(people);
		const text = all(g, 'Bea', 'Ada');
		// At 8 the answer is right; at 9 the maybe may be missing (the limit of B.3; P2 shows the warning).
		if (k === 8) expect(text).toBe('Half-sister, maybe full | Rumoured sister');
		else expect(text).toMatch(/^Half-sister/);
	});
});

describe('F-KIN-08: one card text, and the unlisted-parent sentence that is true', () => {
	const fionaHelen = tree(['D m', 'Mary f', 'Fiona f D Mary', 'Helen f Mary'], ['D,Mary']);

	it('F-KIN-08: the first text line of the window carries ", maybe full" (one source: cardRelationText)', () => {
		const rels = computeRelations(fionaHelen, 'Fiona', ON).get('Helen')!;
		const info = relationInfo(rels, false);
		expect(cardRelationText(rels[0])).toBe('Half-sister, maybe full');
		expect(relationSummary(rels, false).main).toBe('Relation to you: Half-sister, maybe full.');
		expect(info.value).toBe('Half-sister, maybe full');
	});

	it('F-KIN-08: Fiona lists both parents and Helen one: form "other-parent"', () => {
		for (const [me, other] of [['Fiona', 'Helen'], ['Helen', 'Fiona']] as const) {
			const rels = computeRelations(fionaHelen, me, ON).get(other)!;
			expect(rels[0].maybe?.cause).toBe('unlisted');
			expect(rels[0].maybe?.unlistedForm).toBe('other-parent');
			expect(relationInfo(rels, false).maybe).toBe(MAYBE_TEXT.sheetUnlistedOther(rels[0].maybe!.lower));
		}
		const rels = computeRelations(fionaHelen, 'Fiona', ON).get('Helen')!;
		expect(relationInfo(rels, false).maybe).toBe('If this person’s other parent is also your parent, this person is your sister.');
		expect(spokenRelation(rels[0])).toBe('half-sister, or sister if this person’s other parent is also your parent');
	});

	it('F-KIN-08: both list the same single parent: form "same-person"', () => {
		const g = tree(['Mary f', 'A f Mary', 'B f Mary']);
		const rels = computeRelations(g, 'A', ON).get('B')!;
		expect(rels[0].maybe?.unlistedForm).toBe('same-person');
		expect(relationInfo(rels, false).maybe).toBe('If the parent that the note does not name is the same person for both, this person is your sister.');
		expect(spokenRelation(rels[0])).toBe('half-sister, or sister if the parent that the note does not name is the same person for both');
	});

	it('F-KIN-08: the form is not set for a rumoured cause', () => {
		const g = tree(['Anna f', 'Carl m', 'Tom m Anna Carl:rumoured', 'Sue f Carl Anna']);
		const m = computeRelations(g, 'Sue', ON).get('Tom')![0].maybe!;
		expect(m.cause).toBe('rumoured');
		expect(m.unlistedForm).toBeUndefined();
	});

	it('F-KIN-08: cousins keep form 1 (known limit, contract B.1)', () => {
		const g = tree(['GM f', 'A f GM', 'B f GM', 'C f A', 'D f B']);
		const rels = computeRelations(g, 'C', ON).get('D')!;
		expect(rels[0].maybe?.unlistedForm).toBe('same-person');
	});

	it('F-KIN-08: the form does not depend on the order of the people', () => {
		const order = (ids: string[]) => {
			const L: Record<string, string> = { D: 'D m', Mary: 'Mary f', Fiona: 'Fiona f D Mary', Helen: 'Helen f Mary' };
			const g = tree(ids.map((i) => L[i]), ['D,Mary']);
			return computeRelations(g, 'Helen', ON).get('Fiona')![0].maybe?.unlistedForm;
		};
		expect(new Set([order(['D', 'Mary', 'Fiona', 'Helen']), order(['Helen', 'Fiona', 'Mary', 'D']), order(['Fiona', 'D', 'Helen', 'Mary'])])).toEqual(new Set(['other-parent']));
	});
});

describe('I19: the dead sign in the date line and the screen-reader label', () => {
	const person = (o: Partial<Person>): Person => ({ id: 'a', name: 'Aldric', ...o }) as Person;

	it.each([
		[{ born: '1131', died: '1190' }, '1131–1190'],
		[{ born: '1131' }, 'b. 1131'],
		[{ died: '1190' }, 'd. 1190'],
		[{ born: '1131', died: 'yes' }, 'b. 1131 †'],
		[{ born: '1131', died: 'true' }, 'b. 1131 †'],
		[{ born: '1131', died: '?' }, 'b. 1131 †?'],
		[{ born: '1131', died: 'unknown' }, 'b. 1131 †?'],
		[{ died: 'yes' }, '†'],
		[{ died: '?' }, '†?'],
		[{ born: '1131', died: 'no' }, 'b. 1131'],
		[{ born: '1131', died: 'c. 1190' }, '1131–c. 1190'],
	])('dateLine %j is %s', (o, text) => {
		expect(dateLine(person(o))).toBe(text);
	});

	it('dateLine: no dates give no text line', () => {
		expect(dateLine(person({}))).toBeUndefined();
		expect(dateLine(person({ died: 'alive' }))).toBeUndefined();
	});

	it('cardLabel speaks the sign with words and never the character', () => {
		expect(CARD_SPOKEN_DEAD).toBe('dead');
		expect(CARD_SPOKEN_DEAD_DOUBT).toBe('dead, but the death text is not clear');
		expect(cardLabel(person({ born: '1131', died: 'yes' }), 'half-sister')).toBe('Aldric, b. 1131, dead, half-sister');
		expect(cardLabel(person({ born: '1131', died: '?' }))).toBe('Aldric, b. 1131, dead, but the death text is not clear');
		expect(cardLabel(person({ died: 'yes' }))).toBe('Aldric, dead');
		expect(cardLabel(person({ died: '?' }))).toBe('Aldric, dead, but the death text is not clear');
		expect(cardLabel(person({ born: '1131', died: '1190' }))).toBe('Aldric, 1131–1190');
		expect(cardLabel(person({ born: '1131', died: 'yes' }))).not.toMatch(/†/);
	});
});

describe('known limits (D200 R5 / contract B.1) stay as documented', () => {
	it('F-KIN-05: three birth parents: the partner words use the two parents used for placement', () => {
		const g = tree(['a m', 'b f', 'c m', 'k - a b c']);
		expect(all(g, 'a', 'b')).toBe('Co-parent');
		expect(all(g, 'a', 'c')).not.toBe('Co-parent');
	});

	it('sure-on-sure collapse: a mother who is also the great-grandmother shows only as "Mother"', () => {
		const g = tree(['p0 f', 'p1 m p0', 'p2 m p1', 'p3 m p2 p0']);
		expect(all(g, 'p3', 'p0')).toBe('Mother');
	});
});

describe('a tree with no rumoured link has no sure view and gives the names of 0.2.7', () => {
	it('names of a tree with no rumour', () => {
		const g = tree(['G m', 'F m G', 'U m G', 'M m F', 'N m U', 'P f N', 'W f', 'X f W'], ['M,W']);
		expect(all(g, 'M', 'P')).toBe('Half first cousin once removed, maybe full');
		expect(all(g, 'M', 'U')).toBe('Half-uncle, maybe full');
		expect(all(g, 'M', 'X')).toBe('Stepdaughter');
	});
});

describe('B.3: the edit sheet blocks a third parent of a type at PARENT_LIMIT', () => {
	it('fullTypes: 2 birth, 2 adoptive and 2 ward parents are full; up to 7 rumoured parents are not', () => {
		const rumoured = (n: number) => rum(n, 'x').map((x) => `{id: ${x}, type: rumoured}`);
		const src = (parents: string[]) => ['people:', ...rum(9, 'x').map((x) => `  - {id: ${x}, name: ${x}}`), `  - {id: k, name: K, parents: [${parents.join(', ')}]}`, ''].join('\n');
		const full = (parents: string[]) => {
			const r = parseDynasty(src(parents));
			if (!r.ok) throw new Error('parse');
			return familyOf(deriveFamilies(r.tree), 'k')!.fullTypes;
		};
		expect(full(['x0', 'x1'])).toEqual(['birth']);
		expect(full(['{id: x0, type: adoptive}', '{id: x1, type: adoptive}'])).toEqual(['adoptive']);
		expect(full(['{id: x0, type: ward}', '{id: x1, type: ward}'])).toEqual(['ward']);
		expect(full(rumoured(2))).toEqual([]);
		expect(full(rumoured(7))).toEqual([]);
		expect(full(rumoured(8))).toEqual(['rumoured']);
	});
});

describe('fix round (D205 item 2): rumoured parents, the unlisted-parent maybe, the extra name and the step-parent', () => {
	it('F1: a rumoured parent does not remove the unlisted-parent "maybe full" (setting on and off)', () => {
		const g = tree(['Anna f', 'Carl m', 'Dirk m', 'Tom m Anna', 'Sue f Carl Anna Dirk:rumoured']);
		expect(all(g, 'Sue', 'Tom')).toBe('Half-brother, maybe full');
		expect(all(g, 'Tom', 'Sue')).toBe('Half-sister, maybe full');
		// With the setting off the unlisted parent gives no maybe, as before; the rumoured-line names stay.
		expect(all(g, 'Sue', 'Tom', OFF)).toBe('Half-brother');
	});

	it('F1: sample tree 4, Roderick (Aldric, Isolde, rumoured Gareth) and Wren (Aldric)', () => {
		const { g } = build(fixture('04'));
		expect(all(g, 'wren', 'roderick')).toBe('Half-brother, maybe full');
		expect(all(g, 'roderick', 'wren')).toBe('Half-sister, maybe full');
		expect(all(g, 'wren', 'helena')).toBe('Half-sister, maybe full');
	});

	it('F2 (R4-1): the extra rumoured name is not repeated as a half name (setting on and off)', () => {
		const sueTom = tree(['Anna f', 'Carl m', 'Dirk m', 'Tom m Anna Carl:rumoured', 'Sue f Carl Anna Dirk:rumoured']);
		expect(all(sueTom, 'Sue', 'Tom')).toBe('Half-brother, maybe full | Rumoured brother');
		expect(all(sueTom, 'Tom', 'Sue')).toBe('Half-sister, maybe full | Rumoured sister');
		expect(all(sueTom, 'Sue', 'Tom', OFF)).toBe('Half-brother, maybe full | Rumoured brother');
	});

	it('F2: the same with a second rumoured parent on the other child', () => {
		const g = tree(['Anna f', 'Carl m', 'Dirk m', 'Erik m', 'Tom m Anna Carl:rumoured Erik:rumoured', 'Sue f Carl Anna Dirk:rumoured']);
		expect(all(g, 'Sue', 'Tom')).toMatch(/^Half-brother, maybe full \| Rumoured brother( \| |$)/);
		expect(all(g, 'Sue', 'Tom')).not.toMatch(/Rumoured half-brother/);
	});

	it('F3: a rumoured mother P who is the partner of the sure father R is also a stepmother', () => {
		const g = tree(['R m', 'P f', 'M m R P:rumoured'], ['R,P']);
		expect(all(g, 'M', 'P')).toBe('Rumoured mother | Stepmother');
		expect(all(g, 'P', 'M')).toBe('Rumoured son | Stepson');
	});

	it('F3: a sure child of the partner is still no stepchild', () => {
		const g = tree(['R m', 'P f', 'M m R P'], ['R,P']);
		expect(all(g, 'P', 'M')).toBe('Son');
	});
});

describe('fix round: the card word and the "Also" names do not depend on the order of the people (rumours)', () => {
	it('5 trees with rumoured links, 50 shuffles each, setting on and off', () => {
		const problems: string[] = [];
		const snap = (text: string, ids: string[], one: boolean): Map<string, string> => {
			const r = parseDynasty(text);
			if (!r.ok) throw new Error('parse');
			const g = deriveFamilies(r.tree);
			const out = new Map<string, string>();
			for (const a of ids) {
				const rels = computeRelations(g, a, { oneParentUnknown: one });
				for (const b of ids) {
					if (a === b) continue;
					const l = rels.get(b) ?? [];
					out.set(`${a}>${b}`, `${l.length ? cardRelationText(l[0]) : '(none)'} | ${l.slice(1).map((x) => x.text).sort().join(' / ')}`);
				}
			}
			return out;
		};
		for (let seed = 1; seed <= 5; seed++) {
			const m = genModel(seed * 31, { n: 14, rumoured: 0.25, unionP: 0.4, window: 9 });
			const ids = m.people.map((p) => p.id);
			for (const one of [true, false]) {
				const base = snap(toText(m), ids, one);
				for (let s = 0; s < 50; s++) {
					const other = snap(toText(m, shuffled(m.people.map((_, i) => i), seed * 1000 + s)), ids, one);
					for (const [k, v] of base) if (other.get(k) !== v) problems.push(`seed ${seed} shuffle ${s} ${one} ${k}: "${v}" against "${other.get(k)}"`);
				}
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	}, 60000);
});
