import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import { issueText, type CodedIssue } from '../../src/core/messages';
import { findRelation, lineSubgraph } from '../../src/core/relations';
import type { Holder, Title } from '../../src/core/types';
import { fixtureSource } from './load';
import { nextIdFor } from '../helpers';
import { asWritten, BODY_13, graphOf, sample13, titleOf, titlesModule, treeOf, type ExpectedWarning, type TitledGraph, type TitledPerson } from './titles-support';

/*
 * Spec §13.4 (tree text, tolerance, warnings), §13.3 (`card-title`), §13.0 item 1 and the M8
 * contract rules 1–3 (now in the header of src/core/titles.ts): reading and checking the `titles` section.
 * Sample tree 13 lists its expected warnings in comments (`# warning:`). These tests wait for
 * WP 8.1 (the reader, the checks and the issue texts).
 */

/** Issues as the comments write them, sorted, for an order-free comparison. */
const key = (w: ExpectedWarning) => JSON.stringify([w.code, Object.entries(w.params).sort(), w.ids ?? null]);
/** Only the ids of the warnings that the comments give ids for; others are not checked. */
function comparable(issues: readonly CodedIssue[], expected: readonly ExpectedWarning[]): string[] {
	const withIds = new Set(expected.filter((w) => w.ids).map((w) => w.code));
	return issues
		.map(asWritten)
		.map((w) => (withIds.has(w.code) ? w : { code: w.code, params: w.params }))
		.map(key)
		.sort();
}

const holderFields = (h: Holder) => {
	const out: Record<string, string | number> = { index: h.index };
	for (const k of ['person', 'name', 'as', 'number', 'from', 'to'] as const) if (h[k] !== undefined) out[k] = h[k]!;
	return out;
};
const person = (g: TitledGraph, id: string) => g.byId.get(id) as TitledPerson | undefined;

describe('sample tree 13: the listed warnings and no others (spec §13.4 acceptance)', () => {
	for (const block of [0, 1]) {
		it(`block ${block + 1}`, () => {
			const s = sample13(block);
			expect(s.errors).toEqual([]);
			const g = graphOf(s.body);
			expect(comparable(g.issues, s.warnings)).toEqual(s.warnings.map(key).sort());
			for (const i of g.issues) expect(`${i.code}:${i.level}`).toBe(`${i.code}:warning`);
		});
	}

	it('the comments list every title warning of §13.4 and §13.3', () => {
		const codes = new Set([...sample13(0).warnings, ...sample13(1).warnings].map((w) => `${w.code}${w.params.section ? ` ${w.params.section}` : ''}`));
		expect([...codes].sort()).toEqual(
			[
				'section-wrong-shape titles',
				'entry-not-map titles',
				'missing-id titles',
				'duplicate-title-id',
				'section-wrong-shape holders',
				'entry-not-map holders',
				'missing-holder',
				'holder-empty',
				'card-title-not-held',
			].sort(),
		);
	});

	it('each title warning has a sentence of its own, naming what is wrong (spec §13.4, §13.3 texts; messages.ts)', () => {
		const g = graphOf(BODY_13);
		const text = (code: string, part?: Record<string, string>) => {
			const i = g.issues.find((x) => x.code === code && Object.entries(part ?? {}).every(([k, v]) => String(x.params[k]) === v));
			expect(i, code).toBeDefined();
			const t = issueText(i!);
			expect(t).not.toBe('The tree has a problem.');
			expect(t).not.toMatch(/undefined|NaN|\[object/);
			return t;
		};
		expect(text('section-wrong-shape', { section: 'holders' })).toContain('Warden of the Marches');
		expect(text('entry-not-map', { section: 'titles' })).toMatch(/Entry 5\b.*“titles”/);
		expect(text('missing-id', { section: 'titles' })).toMatch(/^Margrave of the Salt Coast has no ID/);
		expect(text('duplicate-title-id')).toContain('“count-of-orsini”');
		expect(text('entry-not-map', { section: 'holders' })).toMatch(/Entry 4\b.*King of the Vale/);
		expect(text('missing-holder', { ref: 'beatrice' })).toMatch(/Count of Orsini.*“beatrice”/);
		expect(text('holder-empty')).toMatch(/Entry 9\b.*Count of Orsini/);
		expect(text('card-title-not-held')).toMatch(/Isolde Orsini.*duke-of-valmont/);
		const second = graphOf(sample13(1).body);
		const shape = second.issues.find((i) => i.code === 'section-wrong-shape');
		expect(shape && issueText(shape)).toContain('“titles”');
	});

	it('a title with no id and no name is named by its place in the list', () => {
		const g = graphOf('titles:\n  - plural: Dukes\npeople:\n  - id: a\n    name: A\n');
		const i = g.issues.find((x) => x.code === 'missing-id');
		expect(i && asWritten(i)).toEqual({ code: 'missing-id', params: { section: 'titles', index: '1' } });
		expect(issueText(i!)).toMatch(/Entry 1\b.*“titles”.*no ID/);
	});
});

describe('sample tree 13: the titles the tree uses (spec §13.4, contract rules 1 and 2)', () => {
	const g = () => graphOf(BODY_13);

	it('the first title with an id wins; entries that are not titles and titles with no id are left out', () => {
		expect(g().titles.map((t) => [t.id, t.name, t.plural, t.index])).toEqual([
			['duke-of-valmont', 'Duke of Valmont', 'Dukes of Valmont', 0],
			['count-of-orsini', 'Count of Orsini', 'Counts of Orsini', 1],
			['king-of-the-vale', 'King of the Vale', 'Kings of the Vale', 2],
			// No `plural`: the name (§13.4).
			['warden-of-the-marches', 'Warden of the Marches', 'Warden of the Marches', 3],
		]);
	});

	it('each holder list keeps the written order (the order of succession, D2 principle)', () => {
		expect(titleOf(g(), 'duke-of-valmont').holders.map(holderFields)).toEqual([
			{ index: 0, name: 'Aldric', number: 'I', from: '1062', to: '1110' },
			{ index: 1, person: 'aldric', number: 'II', from: '1110', to: '1150' },
			{ index: 2, person: 'roderick', from: '1150', to: '1158' },
			{ index: 3, person: 'gareth', as: 'Gareth', number: 'I', from: '1158', to: '1163' },
			{ index: 4, person: 'roderick', number: 'I', from: '1163' },
			{ index: 5, person: 'young-aldric', number: 'III', from: '1175', to: '1210' },
			{ index: 6, person: 'edmund', from: '1210', to: '1228' },
		]);
	});

	it('a holder whose person names nobody but who has a name stays as a name only; one with no name, and one with neither, are left out', () => {
		expect(titleOf(g(), 'count-of-orsini').holders.map(holderFields)).toEqual([
			{ index: 0, name: 'Orso the Old', to: '1090' },
			{ index: 1, person: 'bertrand', from: '1090', to: '1128' },
			{ index: 2, person: 'matteo', from: '1128', to: '1140' },
			{ index: 3, person: 'piero', to: '1140' },
			// Contract rule 2: the holder keeps its written `person`; code treats it as not in the tree.
			{ index: 4, person: 'cosimo', name: 'Cosimo Orsini', from: '1140', to: '1145' },
			{ index: 5, person: 'piero', from: '1145', to: '1160' },
			// A holder written as a plain string is {person: <it>} (§13.4 "Tolerated silently").
			{ index: 6, person: 'luca' },
		]);
		expect(g().byId.has('cosimo')).toBe(false);
	});

	it('an item that is not a map or a string is left out, and the index counts it', () => {
		expect(titleOf(g(), 'king-of-the-vale').holders.map((h) => [h.index, h.person])).toEqual([
			[0, 'young-aldric'],
			[1, 'edmund'],
			[2, 'king-roderick'],
		]);
	});

	it('holders written as a map: the title stays, with no holders', () => {
		expect(titleOf(g(), 'warden-of-the-marches').holders).toEqual([]);
	});

	it('the holders of a duplicate title are not read', () => {
		const all = g().titles.flatMap((t) => t.holders.filter((h) => h.person === 'gareth').map(() => t.id));
		expect(all).toEqual(['duke-of-valmont']);
	});

	it('a holder item keeps its source text without comments (like Union.text), for HolderRef', () => {
		const duke = titleOf(g(), 'duke-of-valmont');
		expect(duke.holders[1].text).toBe('{person: aldric, number: II, from: 1110, to: 1150, epithet: the Wise}');
		expect(duke.holders[3].text).toContain('as: Gareth');
		expect(duke.holders[3].text).not.toContain('#');
		expect(titleOf(g(), 'count-of-orsini').holders[4].text).toBe('{person: cosimo, name: Cosimo Orsini, from: 1140, to: 1145}');
	});

	it('card-title is read as written (spec §13.3)', () => {
		expect(person(g(), 'isolde')?.cardTitle).toBe('duke-of-valmont');
		expect(person(g(), 'young-aldric')?.cardTitle).toBe('king-of-the-vale');
		expect(person(g(), 'king-roderick')?.cardTitle).toBe('king-of-the-vale');
		expect(person(g(), 'aldric')?.cardTitle).toBeUndefined();
	});

	it('the Tree carries the same titles; a subgraph keeps them unchanged (contract rule 3)', async () => {
		const tree = treeOf(BODY_13);
		expect(tree.titles?.map((t) => t.id)).toEqual(expect.arrayContaining(['duke-of-valmont', 'count-of-orsini', 'king-of-the-vale']));
		const focus = focusSubgraph(tree, 'edmund', 1);
		expect(focus).not.toBeNull();
		expect((focus!.tree as typeof tree).titles).toEqual(tree.titles);
		// The card of a person drawn in focus mode shows the same texts as in the whole tree.
		const { cardLabels } = await titlesModule();
		const whole = cardLabels(graphOf(BODY_13)).get('edmund');
		const part = cardLabels(deriveFamilies(focus!.tree)).get('edmund');
		expect(part && [part.name, part.title, part.reign]).toEqual(whole && [whole.name, whole.title, whole.reign]);
	});

	it('the relation finder small tree keeps the titles (contract header)', () => {
		const whole = graphOf(BODY_13);
		const r = findRelation(whole, 'king-roderick', 'aldric');
		const line = r.kind === 'named' ? r.relations[0].relation.line : r.kind === 'chain' ? r.line : null;
		expect(line).not.toBeNull();
		expect(whole.titles).toHaveLength(4);
		expect((lineSubgraph(whole, line!) as TitledGraph).titles).toEqual(whole.titles);
	});

	it('a holder person counts as a written reference, so a new person never takes that id (contract: referencedIds)', () => {
		// Version 0.2.2 (D104): ids are numbers, and the name does not matter.
		expect(nextIdFor(BODY_13)).toBe('p1');
		expect(nextIdFor(BODY_13)).toBe('p1');
		// A holder who is not a person yet still counts: the number 9 is taken.
		const dangling = 'titles:\n  - id: t\n    name: T\n    holders: [{person: p9}]\npeople:\n  - {id: p2, name: Two}\n';
		expect(nextIdFor(dangling)).toBe('p10');
	});
});

describe('reading: tolerated forms and silent keys (spec §13.4 "Tolerated silently", §13.5, D59)', () => {
	const people = 'people:\n  - id: aldric\n    name: Aldric Valmont\n  - id: roderick\n    name: Roderick Valmont\n';
	const titles = (g: TitledGraph) => g.titles.map((t: Title) => ({ id: t.id, name: t.name, plural: t.plural, holders: t.holders.map(holderFields) }));

	it('a block with no titles section: no titles, no warnings', () => {
		const tree = treeOf(fixtureSource('01'));
		expect(tree.titles).toBeUndefined();
		const g = deriveFamilies(tree) as TitledGraph;
		expect(g.titles).toEqual([]);
		expect(g.issues).toEqual([]);
	});

	it('an empty titles section, an empty list, a title with no holders key or an empty holders list: no warnings', () => {
		for (const t of ['titles:\n', 'titles: []\n', 'titles:\n  - id: duke\n', 'titles:\n  - id: duke\n    holders: []\n', 'titles:\n  - id: duke\n    holders:\n']) {
			const g = graphOf(t + people);
			expect(g.issues, t).toEqual([]);
			expect(g.titles.flatMap((x) => x.holders), t).toEqual([]);
		}
	});

	it('a title with no name uses its id (like houses)', () => {
		expect(titles(graphOf('titles:\n  - id: duke\n' + people))).toEqual([{ id: 'duke', name: 'duke', plural: 'duke', holders: [] }]);
	});

	it('holders: aldric (one string) is one holder', () => {
		const g = graphOf('titles:\n  - id: duke\n    name: Duke\n    holders: aldric\n' + people);
		expect(g.issues).toEqual([]);
		expect(titles(g)[0].holders).toEqual([{ index: 0, person: 'aldric' }]);
	});

	it('a holder written as a plain string is {person: <it>}', () => {
		const g = graphOf('titles:\n  - id: duke\n    name: Duke\n    holders:\n      - aldric\n      - {person: roderick, number: II}\n' + people);
		expect(g.issues).toEqual([]);
		expect(titles(g)[0].holders).toEqual([
			{ index: 0, person: 'aldric' },
			{ index: 1, person: 'roderick', number: 'II' },
		]);
	});

	it('numeric ids and values are read as text (§8)', () => {
		const g = graphOf('titles:\n  - id: 1066\n    name: Duke\n    holders: [{person: 42, number: 2, from: 1066, to: 1087}]\npeople:\n  - id: 42\n    name: William\n    card-title: 1066\n');
		expect(g.issues).toEqual([]);
		expect(titles(g)).toEqual([{ id: '1066', name: 'Duke', plural: 'Duke', holders: [{ index: 0, person: '42', number: '2', from: '1066', to: '1087' }] }]);
		expect(person(g, '42')?.cardTitle).toBe('1066');
	});

	it('with both person and name, person counts and name is kept', () => {
		const g = graphOf('titles:\n  - id: duke\n    holders:\n      - {person: aldric, name: The Old Duke}\n' + people);
		expect(g.issues).toEqual([]);
		expect(titles(g)[0].holders).toEqual([{ index: 0, person: 'aldric', name: 'The Old Duke' }]);
	});

	it('numbering and count-with are kept and not read: no warning, whatever their value (D59)', () => {
		for (const v of ['numbering: auto\n    count-with: [king]', 'numbering: written', 'numbering: [x]\n    count-with: nope', 'count-with: {a: b}']) {
			const g = graphOf(`titles:\n  - id: duke\n    ${v}\n    holders: [aldric]\n  - id: king\n` + people);
			expect(g.issues, v).toEqual([]);
		}
	});

	it('unknown keys in a title and in a holder give no warning (§13.0 item 1)', () => {
		const g = graphOf('titles:\n  - id: duke\n    seat: Valmont Keep\n    holders:\n      - {person: aldric, epithet: the Wise}\n' + people);
		expect(g.issues).toEqual([]);
	});

	it('the titles section as a map or a string: section-wrong-shape, and no titles', () => {
		for (const t of ['titles: {id: duke}\n', 'titles: Duke of Valmont\n']) {
			const g = graphOf(t + people);
			expect(g.issues.map(asWritten), t).toEqual([{ code: 'section-wrong-shape', params: { section: 'titles' } }]);
			expect(g.titles).toEqual([]);
		}
	});

	it('a card-title in a tree with no titles gives only the warning (spec §13.3 rules)', () => {
		const g = graphOf('people:\n  - id: aldric\n    name: Aldric Valmont\n    title: Duke of Valmont\n    card-title: duke\n');
		expect(g.issues.map(asWritten)).toEqual([{ code: 'card-title-not-held', params: { person: 'Aldric Valmont', ref: 'duke' }, ids: ['aldric'] }]);
	});

	it('a card-title matches only the title that the tree uses (the first with a duplicate id)', () => {
		const g = graphOf(
			'titles:\n  - id: duke\n    name: Duke\n    holders: [roderick]\n  - id: duke\n    name: Other Duke\n    holders: [aldric]\n' +
				'people:\n  - id: aldric\n    name: Aldric Valmont\n    card-title: duke\n  - id: roderick\n    name: Roderick Valmont\n    card-title: duke\n',
		);
		expect(g.issues.map(asWritten)).toEqual(
			expect.arrayContaining([
				{ code: 'duplicate-title-id', params: { id: 'duke', title: 'Duke' } },
				{ code: 'card-title-not-held', params: { person: 'Aldric Valmont', ref: 'duke' }, ids: ['aldric'] },
			]),
		);
		expect(g.issues).toHaveLength(2);
	});

	it('a card-title compares as text: "01066" does not name the title 1066', () => {
		const g = graphOf('titles:\n  - id: 1066\n    holders: [a]\npeople:\n  - id: a\n    name: A\n    card-title: "01066"\n');
		expect(g.issues.map((i) => i.code)).toEqual(['card-title-not-held']);
	});

	it('a null holder item is not a holder: entry-not-map, section holders (supervisor ruling)', () => {
		const g = graphOf('titles:\n  - id: duke\n    name: Duke\n    holders:\n      -\n      - aldric\n' + people);
		expect(g.issues.map(asWritten)).toEqual([{ code: 'entry-not-map', params: { section: 'holders', title: 'Duke', index: '1' } }]);
		expect(titles(g)[0].holders).toEqual([{ index: 1, person: 'aldric' }]);
	});

	it('missing-holder without and with a name; holder-empty (params of the contract)', () => {
		const g = graphOf('titles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: ghost}\n      - {person: ghost2, name: Ghost}\n      - {from: 1100}\n' + people);
		const want: ExpectedWarning[] = [
			{ code: 'missing-holder', params: { title: 'Duke', ref: 'ghost' } },
			{ code: 'missing-holder', params: { title: 'Duke', ref: 'ghost2', name: 'Ghost' } },
			{ code: 'holder-empty', params: { title: 'Duke', index: '3' } },
		];
		expect(g.issues.map(asWritten).map(key).sort()).toEqual(want.map(key).sort());
		expect(titles(g)[0].holders).toEqual([{ index: 1, person: 'ghost2', name: 'Ghost' }]);
	});

	it('a subgraph may report missing-holder for people it left out (contract rule 3)', () => {
		const tree = treeOf(BODY_13);
		const focus = focusSubgraph(tree, 'beatrix', 0);
		expect(focus).not.toBeNull();
		// Nothing more is required here than that it derives: the view shows the whole tree's issues.
		expect(() => deriveFamilies(focus!.tree)).not.toThrow();
	});
});
