/*
 * 0.2.8 work package P2: the person key `arms` (A.1), the holder key `through-spouse` (A.2), the limit of parents and the
 * setting that stops its warning (B.3, A.5), the partnership and parent type words (I12, I13), the time loop texts (I14),
 * and the exact texts of the new warnings (an internal note section 1).
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { issueText, type CodedIssue } from '../src/core/messages';
import { parseDynasty, readThroughSpouse } from '../src/core/parse';
import { pictureIssue } from '../src/core/pictures';
import { PARENT_LIMIT } from '../src/core/types';
import { validateTree } from '../src/core/validate';

function treeOf(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	return r.tree;
}
const warningsOf = (src: string, options?: { warnManyParents?: boolean }): CodedIssue[] => [...treeOf(src).issues, ...validateTree(treeOf(src), options).issues];

describe('A.1: the person key arms is read like a portrait link', () => {
	it('reads a quoted link, an unquoted [[link]] and a plain file name; an empty value is absent', () => {
		const t = treeOf(`people:
  - {id: a, name: A, arms: "[[shield.png]]"}
  - {id: b, name: B, arms: [[wolf.png]]}
  - {id: c, name: C, arms: lion.svg}
  - {id: d, name: D, arms: ""}
  - {id: e, name: E}
  - {id: f, name: F, arms: "“[[curly.png]]”"}
`);
		expect(t.people.map((p) => p.arms)).toEqual(['[[shield.png]]', '[[wolf.png]]', 'lion.svg', undefined, undefined, '[[curly.png]]']);
		expect('arms' in t.people[3]).toBe(false);
		expect('arms' in t.people[4]).toBe(false);
	});

	it('is separate from the portrait and from the house arms', () => {
		const t = treeOf('houses:\n  - {id: h, name: H, arms: "[[house.png]]"}\npeople:\n  - {id: a, name: A, house: h, portrait: "[[face.png]]", arms: "[[mine.png]]"}\n');
		expect(t.people[0]).toMatchObject({ portrait: '[[face.png]]', arms: '[[mine.png]]' });
		expect(t.houses[0].arms).toBe('[[house.png]]');
	});

	it('the picture warning of personal arms names the personal arms', () => {
		const issue = pictureIssue({ kind: 'portrait', person: { id: 'a', name: 'Aldric' }, arms: true }, { ok: false, code: 'missing-picture', file: 'mine.png' });
		expect(issue).toMatchObject({ code: 'missing-picture', level: 'warning', params: { owner: 'person-arms', person: 'Aldric', file: 'mine.png' }, ids: ['a'] });
		expect(issueText(issue)).toBe('The personal arms of Aldric use the picture “mine.png”, but the vault has no file with this name. Correct the link, or select other arms.');
		expect(issueText(pictureIssue({ kind: 'portrait', person: { id: 'a', name: 'Aldric' }, arms: true }, { ok: false, code: 'picture-web' }))).toBe('The personal arms of Aldric are a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.');
		expect(issueText(pictureIssue({ kind: 'portrait', person: { id: 'a', name: 'Aldric' }, arms: true }, { ok: false, code: 'picture-too-large', file: 'x.png', pixels: 41 }))).toBe(
			'The personal arms of Aldric use the picture “x.png”, which is too large (41 million pixels). Use a picture with 40 million pixels or less.',
		);
		// The portrait and the house arms keep their texts.
		expect(pictureIssue({ kind: 'portrait', person: { id: 'a', name: 'Aldric' } }, { ok: false, code: 'picture-web' }).params.owner).toBe('portrait');
		expect(pictureIssue({ kind: 'arms', house: { id: 'h', name: 'H' } }, { ok: false, code: 'picture-web' }).params.owner).toBe('arms');
	});
});

describe('A.2: the holder key through-spouse is read as true, off, or a person id', () => {
	it('readThroughSpouse', () => {
		for (const v of ['true', 'TRUE', ' Yes ', 'yes', true]) expect(readThroughSpouse(v), String(v)).toBe(true);
		for (const v of ['false', 'No', ' no ', false, '', null, undefined, [], {}, ['a'], { a: 1 }]) expect(readThroughSpouse(v), JSON.stringify(v)).toBeUndefined();
		expect(readThroughSpouse('anna')).toBe('anna');
		expect(readThroughSpouse('“anna”')).toBe('anna');
		expect(readThroughSpouse('‘anna’')).toBe('anna');
		expect(readThroughSpouse(12)).toBe('12');
		expect(readThroughSpouse(' c2 ')).toBe('c2');
	});

	it('is read from a holder map, after to, and not from a plain string holder', () => {
		const t = treeOf(`people:
  - {id: a, name: A}
titles:
  - id: t
    name: T
    holders:
      - {person: a, from: 1100, to: 1120, through-spouse: true}
      - {person: a, through-spouse: yes}
      - {person: a, through-spouse: "no"}
      - {person: a, through-spouse: c2}
      - {person: a, through-spouse: 12}
      - {person: a, through-spouse: “curly”}
      - {person: a, through-spouse: [x, y]}
      - a
      - {name: Ghost, through-spouse: true}
`);
		expect(t.titles![0].holders.map((h) => h.throughSpouse)).toEqual([true, true, undefined, 'c2', '12', 'curly', undefined, undefined, true]);
		expect(Object.keys(t.titles![0].holders[0])).toEqual(expect.arrayContaining(['person', 'from', 'to', 'throughSpouse']));
		expect('throughSpouse' in t.titles![0].holders[2]).toBe(false);
	});
});

describe('A.3: the title key plural is read; the holder list and the table note use it, else the name', () => {
	it('plural is the name when it is not written', () => {
		const t = treeOf('titles:\n  - {id: a, name: Duchy of Normandy}\n  - {id: b, name: Duchy, plural: Dukes}\n');
		expect(t.titles!.map((x) => x.plural)).toEqual(['Duchy of Normandy', 'Dukes']);
	});
});

describe('A.5, B.3: the limit of parents of one type', () => {
	const parents = (type: string, n: number) => {
		const ids = Array.from({ length: n }, (_, i) => `p${i}`);
		const refs = ids.map((id) => (type === 'birth' ? id : `{id: ${id}, type: ${type}}`)).join(', ');
		return `people:\n${ids.map((id) => `  - {id: ${id}, name: ${id}}`).join('\n')}\n  - {id: c, name: C, parents: [${refs}]}\n`;
	};
	const many = (src: string, options?: { warnManyParents?: boolean }) => warningsOf(src, options).filter((i) => i.code === 'too-many-parents');

	it('PARENT_LIMIT is 2 for birth, adoptive and ward and 8 for rumoured', () => {
		expect(PARENT_LIMIT).toEqual({ birth: 2, adoptive: 2, ward: 2, rumoured: 8 });
	});

	it('3 birth, adoptive or ward parents warn, and the setting off stops the warning', () => {
		for (const type of ['birth', 'adoptive', 'ward']) {
			const w = many(parents(type, 3));
			expect(w, type).toHaveLength(1);
			expect(w[0].params).toMatchObject({ person: 'C', type, count: 3, limit: 2 });
			expect(many(parents(type, 2)), type).toEqual([]);
			expect(many(parents(type, 3), { warnManyParents: false }), type).toEqual([]);
			expect(many(parents(type, 3), {}), type).toHaveLength(1);
			expect(many(parents(type, 3), { warnManyParents: true }), type).toHaveLength(1);
		}
	});

	it('8 rumoured parents give no warning; 9 warn, also with the setting off', () => {
		expect(many(parents('rumoured', 3))).toEqual([]);
		expect(many(parents('rumoured', 8))).toEqual([]);
		for (const options of [undefined, { warnManyParents: false }]) {
			const w = many(parents('rumoured', 9), options);
			expect(w).toHaveLength(1);
			expect(w[0].params).toMatchObject({ type: 'rumoured', count: 9, limit: 8 });
		}
	});

	it('the texts say 2 of each type, or 8 and the maybe', () => {
		expect(issueText(many(parents('birth', 3))[0])).toBe('C has 3 birth parents, but a person can have only 2 of each type. Remove the extra parents, or change their type.');
		expect(issueText(many(parents('rumoured', 9))[0])).toBe(
			'C has 9 rumoured parents, but a person can have only 8 of this type. If a person has more than 8, a relation name can lack a “maybe”. Remove the extra parents, or change their type.',
		);
	});

	it('the graph still warns about 3 birth parents with the default (the setting is passed to validateTree by the caller)', () => {
		expect(deriveFamilies(treeOf(parents('birth', 3))).issues.filter((i) => i.code === 'too-many-parents')).toHaveLength(1);
	});
});

describe('I13: a partnership word and a parent type word', () => {
	const unionSource = (type: string) => `people:\n  - {id: a, name: A}\n  - {id: b, name: B}\nunions:\n  - {id: u, partners: [a, b], type: ${type}}\n`;
	const unionWarning = (type: string) => warningsOf(unionSource(type)).filter((i) => i.code === 'unknown-union-type');

	it('any other word is drawn as a marriage and gives no warning', () => {
		for (const type of ['handfasting', 'implicit', 'wedlock', 'cohabitation', 'x']) expect(unionWarning(type), type).toEqual([]);
		for (const type of ['marriage', 'betrothal', 'concubinage', 'affair', 'Marriage', 'BETROTHAL']) expect(unionWarning(type), type).toEqual([]);
	});

	it('a near-typo (edit distance 2 or less, case ignored) warns with a suggestion', () => {
		const cases: [string, string][] = [['marriege', 'marriage'], ['Marriege', 'marriage'], ['betrothel', 'betrothal'], ['concubinag', 'concubinage'], ['affairs', 'affair'], ['afair', 'affair'], ['mariag', 'marriage']];
		for (const [value, suggestion] of cases) {
			const w = unionWarning(value);
			expect(w, value).toHaveLength(1);
			expect(w[0].params, value).toMatchObject({ value, suggestion });
		}
		// A distance of 3 is no near-typo.
		expect(unionWarning('marrriagee')).toHaveLength(1);
		expect(unionWarning('marrrriagee')).toEqual([]);
	});

	it('a very long word or text is no near-typo and does not slow the check', () => {
		expect(unionWarning('x'.repeat(5000))).toEqual([]);
		expect(parentWarning('x'.repeat(5000))).toHaveLength(1);
		expect(parentWarning('x'.repeat(5000))[0].params).not.toHaveProperty('suggestion');
	});

	it('the union text: the type, the marriage, and the suggestion', () => {
		const w = unionWarning('marriege')[0];
		expect(issueText(w)).toBe('The partnership of A and B has the type “marriege”. The plugin shows it as a marriage. If you mean “marriage”, write “type: marriage”.');
		expect(issueText({ ...w, params: { ...w.params, suggestion: '' } })).toBe('The partnership of A and B has the type “marriege”. The plugin shows it as a marriage.');
	});

	const parentSource = (type: string) => `people:\n  - {id: a, name: Aldric}\n  - {id: c, name: Cora, parents: [{id: a, type: ${type}}]}\n`;
	const parentWarning = (type: string) => warningsOf(parentSource(type)).filter((i) => i.code === 'unknown-parent-type');

	it('every unknown parent type warns and says the parent counts as a birth parent', () => {
		const w = parentWarning('godfather');
		expect(w).toHaveLength(1);
		expect(w[0].params).toEqual({ person: 'Cora', value: 'godfather', parent: 'Aldric' });
		expect(issueText(w[0])).toBe(
			'Cora has the parent Aldric with the type “godfather”, which the plugin does not know. The plugin counts Aldric as a birth parent of Cora. Use birth, adoptive, ward or rumoured.',
		);
		// The person is a birth child in the graph (spec §8).
		expect(deriveFamilies(treeOf(parentSource('godfather'))).placementType.get('c')).toBe('birth');
	});

	it('a near-typo of a parent type adds the suggestion', () => {
		const cases: [string, string][] = [['birht', 'birth'], ['Rumored', 'rumoured'], ['adoptiv', 'adoptive'], ['wards', 'ward'], ['rumored', 'rumoured']];
		for (const [value, suggestion] of cases) {
			const w = parentWarning(value);
			expect(w, value).toHaveLength(1);
			expect(w[0].params, value).toMatchObject({ value, suggestion });
		}
		expect(issueText(parentWarning('birht')[0])).toBe(
			'Cora has the parent Aldric with the type “birht”, which the plugin does not know. The plugin counts Aldric as a birth parent of Cora. Use birth, adoptive, ward or rumoured. If you mean “birth”, write “type: birth”.',
		);
	});
});

describe('I12 and I14: texts of a partnership with 3 people and of a time loop', () => {
	it('union-partner-count gets an example for 3 or more people', () => {
		const text = (count: number, partners: string[]) => issueText({ code: 'union-partner-count', level: 'warning', params: { union: '#2', partners, count } });
		expect(text(3, ['A', 'B', 'C'])).toBe(
			'The tree does not show a partnership with 3 people: A, B and C. Give each partnership exactly 2 people. Write one partnership for each pair, for example “- partners: [aldric, isolde]”.',
		);
		expect(text(1, ['A'])).toBe('The tree does not show a partnership with 1 person: A. Give each partnership exactly 2 people.');
	});

	it('a time loop and a self-parent give a correction, not a blame', () => {
		const w = warningsOf('people:\n  - {id: a, name: Arn, parents: [c]}\n  - {id: b, name: Bram, parents: [a]}\n  - {id: c, name: Col, parents: [b]}\n  - {id: s, name: Sela, parents: [s]}\n');
		expect(issueText(w.find((i) => i.code === 'cycle')!)).toMatch(/^Arn, Bram and Col are ancestors of each other, so the tree has a time loop\. The tree does not show the line from .+ to .+\. If this is a mistake, correct the parents\.$/);
		expect(issueText(w.find((i) => i.code === 'self-parent')!)).toBe('The parents of Sela include Sela. If this is a mistake, remove Sela from these parents.');
	});
});

describe('A.2: the texts of the through-spouse warnings (an internal note 1.1)', () => {
	const text = (code: CodedIssue['code'], params: CodedIssue['params']) => issueText({ code, level: 'warning', params });
	const base = { person: 'Hugo', title: 'Duke of Valmont' };

	it('no partner', () => {
		expect(text('through-spouse-no-partner', base)).toBe(
			'Hugo holds the title Duke of Valmont with “through-spouse”, but Hugo has no partner in the tree. The plugin ignores “through-spouse”. Add a partnership for Hugo, or remove “through-spouse”.',
		);
	});

	it('no partner has a claim: two partners, and three or more', () => {
		expect(text('through-spouse-no-claim', { ...base, count: 2, partners: ['Anna', 'Berta'], example: 'anna' })).toBe(
			'Hugo has 2 partners: Anna and Berta. Neither is an ancestor or a descendant of a holder of the title Duke of Valmont. As a result, the plugin cannot choose a partner and ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: anna”.',
		);
		expect(text('through-spouse-no-claim', { ...base, count: 3, partners: ['Anna', 'Berta', 'Cora'], example: 'anna' })).toBe(
			'Hugo has 3 partners: Anna, Berta and Cora. None of them is an ancestor or a descendant of a holder of the title Duke of Valmont. As a result, the plugin cannot choose a partner and ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: anna”.',
		);
	});

	it('several partners have a claim', () => {
		expect(text('through-spouse-several-claims', { ...base, count: 2, partners: ['Anna', 'Berta'], example: 'anna' })).toBe(
			'Hugo has 2 partners who are ancestors or descendants of a holder of the title Duke of Valmont: Anna and Berta. The plugin cannot choose a partner, so it ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: anna”.',
		);
	});

	it('the id is not a partner, or names nobody', () => {
		expect(text('through-spouse-not-partner', { ...base, ref: 'carl', other: 'Carl' })).toBe(
			'Hugo holds the title Duke of Valmont with “through-spouse: carl”, but Carl is not a partner of Hugo. The plugin ignores “through-spouse”. Write the ID of a partner, or remove “through-spouse: carl”.',
		);
		expect(text('through-spouse-unknown-person', { ...base, ref: 'carl' })).toBe(
			'Hugo holds the title Duke of Valmont with “through-spouse: carl”, but no person has the ID “carl”. The plugin ignores “through-spouse”. Write the ID of a partner, or remove “through-spouse: carl”.',
		);
	});

	it('the texts stay readable without parameters', () => {
		for (const code of ['through-spouse-no-partner', 'through-spouse-no-claim', 'through-spouse-several-claims', 'through-spouse-not-partner', 'through-spouse-unknown-person'] as const) {
			expect(text(code, {}), code).not.toMatch(/undefined|NaN|\[object/);
		}
	});
});
