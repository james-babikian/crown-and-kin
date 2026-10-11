/*
 * 0.2.8 work package P2, the fix round (D205): the slot-fill that uses only the children who pass the sex test of the pass,
 * the reworded through-spouse warnings, the S3 note for holders only, the note for equal birth years, the year reader,
 * the common partnership words and the suggestions for parent types.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { issueText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { specOf, successionLine, type SuccessionResult } from '../src/core/succession';
import { yearOf } from '../src/core/succession-keys';
import { SUCCESSION_UI } from '../src/render/succession-text';

function graphOf(src: string): FamilyGraph {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	return deriveFamilies(r.tree);
}

/** The line of the first title. */
function lineOf(src: string): SuccessionResult {
	const g = graphOf(src);
	const t = g.titles[0];
	return successionLine(g, t, specOf(t), 99, 0);
}

const issueTexts = (src: string, prefix = '') =>
	graphOf(src)
		.issues.filter((i) => i.code.startsWith(prefix))
		.map(issueText);

// ---------- Item 1: the slot-fill uses only the children of the sex test ----------

describe('D193 slot-fill: only the children who pass the sex test of the pass take part', () => {
	const head = (inherit: string, kids: string[]) =>
		`people:\n  - {id: r, name: R, sex: m, born: 800}\n${kids.map((k) => '  - ' + k).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: eldest-child\n    inherit: ${inherit}\n    holders:\n      - {person: r, from: 1000}\n`;
	const kid = (id: string, sex: 'm' | 'f', born?: string) => `{id: ${id}, name: ${id}, sex: ${sex}${born ? ', born: ' + born : ''}, parents: [r]}`;

	it('women-only: a brother with a year does not move his sisters (A f 890, B f no year, C m 800)', () => {
		const res = lineOf(head('women-only', [kid('A', 'f', '890'), kid('B', 'f'), kid('C', 'm', '800')]));
		expect(res.heirs).toEqual(['A', 'B']);
		expect(res.notes.filter((n) => n.kind === 'order-contradiction')).toEqual([]);
		expect(JSON.stringify(res.notes)).not.toContain('"C"');
		// Sisters of the same parents can move in the edit sheet: no note.
		expect(res.notes).toEqual([]);
	});

	it('women-only: half-sisters stand in the order of the note, and the brother after them does not hide that', () => {
		const half = (id: string, born: string | undefined, mother: string) => `{id: ${id}, name: ${id}, sex: f${born ? ', born: ' + born : ''}, parents: [r, ${mother}]}`;
		const src = head('women-only', ['{id: w1, name: W1, sex: f}', '{id: w2, name: W2, sex: f}', half('A', '890', 'w1'), half('B', undefined, 'w2'), kid('C', 'm', '800')]);
		const res = lineOf(src);
		expect(res.heirs).toEqual(['A', 'B']);
		expect(res.notes).toEqual([{ kind: 'order-from-note', params: { a: 'A', b: 'B' } }]);
	});

	it('men-only: the mirror case (A m 890, B m no year, C f 800)', () => {
		const res = lineOf(head('men-only', [kid('A', 'm', '890'), kid('B', 'm'), kid('C', 'f', '800')]));
		expect(res.heirs).toEqual(['A', 'B']);
		expect(JSON.stringify(res.notes)).not.toContain('"C"');
	});

	it('the first pass of a house form: the women of pass 1 are ranked without the men', () => {
		const res = lineOf(head('women-first-in-house', [kid('A', 'f', '890'), kid('B', 'f'), kid('C', 'm', '800')]));
		expect(res.heirs).toEqual(['A', 'B', 'C']);
		expect(res.notes.filter((n) => n.kind === 'order-contradiction')).toEqual([]);
	});

	it('the people who pass the test are still put in the order of their years', () => {
		const res = lineOf(head('women-only', [kid('A', 'f', '890'), kid('B', 'f', '880'), kid('C', 'm', '800')]));
		expect(res.heirs).toEqual(['B', 'A']);
		// Dated sisters with a man between them: the man keeps his place, the sisters swap.
		const mixed = lineOf(head('women-only', [kid('A', 'f', '890'), kid('C', 'm', '800'), kid('B', 'f', '880')]));
		expect(mixed.heirs).toEqual(['B', 'A']);
	});

	it('both sexes can inherit: a man with a year still takes part', () => {
		const res = lineOf(head('no-preference', [kid('A', 'f', '890'), kid('B', 'f'), kid('C', 'm', '800')]));
		expect(res.heirs).toEqual(['C', 'B', 'A']);
	});
});

// ---------- Items 2, 3, 9: the through-spouse warnings ----------

describe('the through-spouse warnings, reworded (items 2, 3 and 9)', () => {
	const base = { person: 'Hugo', title: 'Duke of Valmont' };
	const text = (code: Parameters<typeof issueText>[0]['code'], params: Parameters<typeof issueText>[0]['params']) => issueText({ code, level: 'warning', params });

	it('item 2: the claim warnings say "an ancestor or a descendant of a holder"', () => {
		expect(text('through-spouse-no-claim', { ...base, count: 2, partners: ['Anna', 'Berta'], example: 'anna' })).toBe(
			'Hugo has 2 partners: Anna and Berta. Neither is an ancestor or a descendant of a holder of the title Duke of Valmont. As a result, the plugin cannot choose a partner and ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: anna”.',
		);
		expect(text('through-spouse-no-claim', { ...base, count: 3, partners: ['Anna', 'Berta', 'Cora'], example: 'anna' })).toBe(
			'Hugo has 3 partners: Anna, Berta and Cora. None of them is an ancestor or a descendant of a holder of the title Duke of Valmont. As a result, the plugin cannot choose a partner and ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: anna”.',
		);
		expect(text('through-spouse-several-claims', { ...base, count: 2, partners: ['Anna', 'Berta'], example: 'anna' })).toBe(
			'Hugo has 2 partners who are ancestors or descendants of a holder of the title Duke of Valmont: Anna and Berta. The plugin cannot choose a partner, so it ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: anna”.',
		);
	});

	it('item 3: the text for a holder with no marriage', () => {
		expect(text('through-spouse-no-marriage', base)).toBe(
			'Hugo holds the title Duke of Valmont with “through-spouse”, but the tree shows no marriage for Hugo. The plugin ignores “through-spouse”. Add a marriage, write the ID of a partner, or remove “through-spouse”.',
		);
	});

	const src = (type: string | undefined, key = 'true') =>
		`people:\n  - {id: h, name: Hugo, sex: m, born: 1100}\n  - {id: a, name: Anna, sex: f, born: 1105}\n${type ? `unions:\n  - {partners: [h, a], type: ${type}}\n` : ''}titles:\n  - id: duke\n    name: Duke of Valmont\n    succession: eldest-child\n    holders:\n      - {person: h, from: 1150, through-spouse: ${key}}\n`;

	it('item 3: only a betrothal, a concubine or an affair gives "no marriage"; no partner at all keeps the old warning', () => {
		for (const type of ['betrothal', 'concubinage', 'affair']) {
			const issues = graphOf(src(type)).issues.filter((i) => i.code.startsWith('through-spouse'));
			expect(issues.map((i) => i.code), type).toEqual(['through-spouse-no-marriage']);
		}
		expect(graphOf(src(undefined)).issues.map((i) => i.code)).toEqual(['through-spouse-no-partner']);
		// A marriage gives no warning. A named partner of any type gives no warning either.
		expect(issueTexts(src('marriage'), 'through-spouse')).toEqual([]);
		expect(issueTexts(src('affair', 'a'), 'through-spouse')).toEqual([]);
	});

	it('item 3: the key is ignored in that case (the line is the line of the holder)', () => {
		const g = graphOf(src('affair'));
		const t = g.titles[0];
		expect(successionLine(g, t, specOf(t), 99, 0).notes.some((n) => n.kind === 'through-spouse')).toBe(false);
	});

	it('item 9: "through-spouse" that names the holder', () => {
		expect(text('through-spouse-self', base)).toBe('Hugo holds the title Duke of Valmont with “through-spouse”, but the ID after it is the ID of Hugo. The plugin ignores “through-spouse”. Write the ID of a partner, or remove “through-spouse”.');
		const issues = graphOf(src('marriage', 'h')).issues.filter((i) => i.code.startsWith('through-spouse'));
		expect(issues.map((i) => i.code)).toEqual(['through-spouse-self']);
		expect(issueText(issues[0])).toBe('Hugo holds the title Duke of Valmont with “through-spouse”, but the ID after it is the ID of Hugo. The plugin ignores “through-spouse”. Write the ID of a partner, or remove “through-spouse”.');
	});

	it('the new texts stay readable without parameters', () => {
		for (const code of ['through-spouse-no-marriage', 'through-spouse-self'] as const) expect(text(code, {}), code).not.toMatch(/undefined|NaN|\[object/);
	});
});

// ---------- Item 4: the S3 note is for holders only ----------

describe('S3: the note shows only for a parent who holds the title without a readable start year', () => {
	const people = `people:
  - {id: R, name: R, sex: m, born: 1100}
  - {id: A, name: A, sex: m, born: 1125, parents: [R]}
  - {id: B, name: B, sex: m, born: 1130, parents: [R]}
  - {id: A1, name: A1, sex: m, born: 1155, parents: [A]}
  - {id: A2, name: A2, sex: m, born: 1150, parents: [A]}
`;
	const title = (holders: string) => `titles:\n  - id: t\n    name: T\n    succession: born-in-reign\n    holders:\n${holders}`;

	it('a parent who never held the title gives no note (A has two children but is no holder)', () => {
		const res = lineOf(people + title('      - {person: R, from: 1135}\n'));
		expect(res.heirs.length).toBeGreaterThan(2);
		expect(res.notes.filter((n) => n.kind === 'born-in-reign-no-from')).toEqual([]);
	});

	it('a parent with a holder entry and no readable start year gives the note', () => {
		const res = lineOf(people + title('      - {person: R, from: 1135}\n      - {person: A}\n'));
		expect(res.notes.filter((n) => n.kind === 'born-in-reign-no-from')).toEqual([{ kind: 'born-in-reign-no-from', params: { parent: 'A' } }]);
		// Text in the field that is no year counts as none.
		const bad = lineOf(people + title('      - {person: R, from: 1135}\n      - {person: A, from: long ago}\n'));
		expect(bad.notes.filter((n) => n.kind === 'born-in-reign-no-from').map((n) => n.params.parent)).toEqual(['A']);
	});

	it('a parent with another entry that has a start year gives no note', () => {
		const res = lineOf(people + title('      - {person: R, from: 1135}\n      - {person: A}\n      - {person: A, from: 1160}\n'));
		expect(res.notes.filter((n) => n.kind === 'born-in-reign-no-from')).toEqual([]);
	});
});

// ---------- Item 5: the note for equal birth years ----------

describe('D202: the note for two equal birth years says so', () => {
	const src = (a: string, b: string) =>
		`people:\n  - {id: r, name: R, sex: m, born: 1120}\n  - {id: w1, name: W1, sex: f}\n  - {id: w2, name: W2, sex: f}\n  - {id: A, name: A, sex: m, ${a}parents: [r, w1]}\n  - {id: B, name: B, sex: m, ${b}parents: [r, w2]}\ntitles:\n  - id: t\n    name: T\n    succession: eldest-child\n    holders:\n      - {person: r, from: 1140}\n`;

	it('equal years: the note carries the reason and the text names the year', () => {
		const res = lineOf(src('born: 1150, ', 'born: 1150, '));
		expect(res.notes).toEqual([{ kind: 'order-from-note', params: { a: 'A', b: 'B', reason: 'same-year' } }]);
		expect(SUCCESSION_UI.orderFromNoteSameYear('Anna', 'Berta')).toBe('The order of Anna and Berta comes from the order in the note, because both have the same birth year.');
	});

	it('a missing year keeps the old note with the advice', () => {
		expect(lineOf(src('born: 1150, ', '')).notes).toEqual([{ kind: 'order-from-note', params: { a: 'A', b: 'B' } }]);
		expect(SUCCESSION_UI.orderFromNote('Anna', 'Berta')).toBe('The order of Anna and Berta comes from the order in the note. Add a birth year to change it.');
	});
});

// ---------- Item 6: the year reader ----------

describe('yearOf: more fragments of a grouped number are no year', () => {
	it('"1.250" and the other dotted fragments', () => {
		for (const t of ['1.250', '12.250', '123.250', ' 1.250 ']) expect(yearOf(t), t).toBeUndefined();
		// Other dotted dates keep their year.
		expect(yearOf('3.1203')).toBe(1203);
		expect(yearOf('12.05.1203')).toBe(1203);
		expect(yearOf('1.25')).toBeUndefined();
	});

	it('one stray space around the comma', () => {
		for (const t of ['1, 250', '1 ,250', '1 , 250', '12, 345', 'c. 1, 250', '1, 250 BC']) expect(yearOf(t), t).toBeUndefined();
	});

	it('a date with a day before the comma keeps its year', () => {
		expect(yearOf('Jan 5, 624')).toBe(624);
		expect(yearOf('March 5, 250 BC')).toBe(-250);
		expect(yearOf('5 Jan, 624')).toBe(624);
	});

	it('a group of four digits or more after the comma', () => {
		for (const t of ['1,2500', '12,12500', '1,250,2500']) expect(yearOf(t), t).toBeUndefined();
	});

	it('the old readings stay', () => {
		expect(yearOf('1,250')).toBe(1250);
		expect(yearOf('12,000 BC')).toBe(-12000);
		expect(yearOf('March 3, 1250')).toBe(1250);
		expect(yearOf('12 May 1203')).toBe(1203);
		expect(yearOf('1203')).toBe(1203);
		expect(yearOf('c. 1250')).toBe(1250);
	});
});

// ---------- Item 7: the common partnership words and the parent type suggestions ----------

describe('D205 item 1: common partnership words are the known types', () => {
	const src = (type: string) => `people:\n  - {id: a, name: A, sex: m}\n  - {id: b, name: B, sex: f}\n\nunions:\n  - {partners: [a, b], type: ${type}}\n`;
	const typeOf = (type: string) => graphOf(src(type)).unionByKey.values().next().value!.type;

	it('each word reads as its type, case ignored, with no warning', () => {
		const table: [string, string][] = [
			['engaged', 'betrothal'],
			['Engaged', 'betrothal'],
			['mistress', 'affair'],
			['LOVER', 'affair'],
			['liaison', 'affair'],
			['concubine', 'concubinage'],
			['Concubine', 'concubinage'],
		];
		for (const [word, type] of table) {
			expect(typeOf(word), word).toBe(type);
			expect(graphOf(src(word)).issues, word).toEqual([]);
		}
	});

	it('the known types and the other words keep their meaning', () => {
		expect(typeOf('marriage')).toBe('marriage');
		// The known types are read in any case (supervisor ruling after the P2 re-vet: "Concubinage" showed as a marriage).
		expect(typeOf('Marriage')).toBe('marriage');
		expect(typeOf('Concubinage')).toBe('concubinage');
		expect(graphOf(src('Concubinage')).issues).toEqual([]);
		expect(typeOf('affair')).toBe('affair');
		expect(typeOf('wedding')).toBe('wedding');
		expect(graphOf(src('wedding')).issues).toEqual([]);
		// A near-typo still warns.
		expect(graphOf(src('concubinge')).issues.map((i) => i.code)).toEqual(['unknown-union-type']);
	});

	it('the tree keeps the word; the type counts as known for the automatic partner choice (a "concubine" is not chosen)', () => {
		const people = `people:\n  - {id: h, name: Hugo, sex: m}\n  - {id: a, name: Anna, sex: f}\n\nunions:\n  - {partners: [h, a], type: concubine}\n\ntitles:\n  - id: duke\n    name: Duke\n    succession: eldest-child\n    holders:\n      - {person: h, from: 1150, through-spouse: true}\n`;
		expect(graphOf(people).issues.map((i) => i.code)).toEqual(['through-spouse-no-marriage']);
	});
});

describe('D205 item 1: the parent type suggestions', () => {
	const src = (type: string) => `people:\n  - {id: f, name: F, sex: m}\n  - {id: k, name: K, parents: [{id: f, type: ${type}}]}\n`;
	const suggestion = (type: string) => /If you mean “([^”]+)”/.exec(issueTexts(src(type), 'unknown-parent-type').join(' '))?.[1];

	it('common words suggest a type', () => {
		const table: [string, string][] = [
			['adopted', 'adoptive'],
			['foster', 'ward'],
			['guardian', 'ward'],
			['natural', 'birth'],
			['biological', 'birth'],
			['alleged', 'rumoured'],
			['putative', 'rumoured'],
			['Adopted', 'adoptive'],
		];
		for (const [word, type] of table) expect(suggestion(word), word).toBe(type);
	});

	it('the warning still shows and the link is a birth link; an unrelated word has no suggestion', () => {
		expect(graphOf(src('adopted')).issues.map((i) => i.code)).toEqual(['unknown-parent-type']);
		expect(suggestion('stepfather')).toBeUndefined();
		expect(suggestion('legal')).toBeUndefined();
	});
});

// ---------- Item 8 ----------

describe('the note for the other holders', () => {
	it('item 8: the text', () => {
		expect(SUCCESSION_UI.coRulersNotInLine).toBe('The other holders are not in the line of succession, unless they are named heirs.');
	});
});
