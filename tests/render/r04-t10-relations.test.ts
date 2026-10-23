import { describe, expect, it } from 'vitest';
import { computeRelations, findRelation, type Relation } from '../../src/core/relations';
import { cardRelationText, finderSentence, relationInfo, relationSummary, spokenRelation, stepSentences } from '../../src/render/tree-info';
import { build } from '../support/helpers';
import { T10, bodyOf } from '../support/r04-t10';

/*
 * The release plan T10, version 0.4: relation names for the sample trees 17 to 19. Spec §13.1 (a name for the relation of every person to the marked person, a
 * second name in "Also", "maybe" for a parent who is not listed, D174) and §13.2 (the relation finder: a named relation, or a chain, or none). A `genealogy-reviewer`
 * vets the WORDS. These tests judge no word: they hold that every person that a relation reaches gets a text, that no call throws, that every text is
 * a string that is not empty, and that a name in any script is in the finder's sentences. Run: npx vitest run tests/render/r04-t10-relations.test.ts
 */

const texts = (r: Relation): string[] => [r.text, r.lower, cardRelationText(r), spokenRelation(r)];

describe.each(T10.map((t) => [t.id, t] as const))('sample tree %s: the relation of every person to every other person', (_id, t) => {
	const g = build(bodyOf(t)).g;
	const ids = Object.keys(t.people);

	it('names the marked person "You" once and gives every relation a text, a lower case text, a card text and a spoken text that are not empty, for every marked person and both settings of D174', () => {
		for (const me of ids) {
			for (const oneParentUnknown of [true, false]) {
				const all = computeRelations(g, me, { oneParentUnknown });
				expect(all.get(me)!.map((r) => [r.text, r.kind]), `${me}`).toEqual([['You', 'self']]);
				for (const [id, rels] of all) {
					expect(rels.length, `${me} -> ${id}`).toBeGreaterThan(0);
					for (const r of rels) for (const text of texts(r)) expect(text.trim().length, `${me} -> ${id}: ${r.kind}`).toBeGreaterThan(0);
					const info = relationInfo(rels, id === me);
					expect(info.value.trim().length, `${me} -> ${id}`).toBeGreaterThan(0);
					expect(relationSummary(rels, id === me).main.trim().length).toBeGreaterThan(0);
				}
				// Nobody is outside the tree: every key is a person of the note.
				for (const id of all.keys()) expect(ids, `${me}: ${id}`).toContain(id);
			}
		}
	});

	it('the finder answers for every ordered pair, and its sentences name both people as written', () => {
		for (const first of ids) {
			for (const second of ids) {
				if (first === second) continue;
				const r = findRelation(g, first, second);
				const sentence = finderSentence(g, r, 0);
				expect(sentence.trim().length, `${first} ${second}`).toBeGreaterThan(0);
				// A named relation says "<second> is <first>'s ..."; the chain and none sentences say "<first> and <second> ...". Both hold both names.
				expect(sentence, `${first} ${second}`).toContain(t.people[first].name);
				expect(sentence, `${first} ${second}`).toContain(t.people[second].name);
				if (r.kind === 'named') for (const rel of r.relations) expect(stepSentences(g, rel.steps).shown.every((s) => s.trim().length > 0)).toBe(true);
			}
		}
	});
});

describe('sample tree 17: the children and the in-laws of the same-sex couples get a relation text (the words are for the genealogy-reviewer)', () => {
	const g = build(bodyOf(T10[0])).g;
	const all = Object.keys(T10[0].people);
	// For each marked person, the people that the tree text reaches by a child, a parent, a partner or a partner of a relative, written by hand. The few that
	// are left out (no word is named for them) are listed in the report of the test author as a question for the genealogy-reviewer.
	const MUST: Record<string, string[]> = {
		wren: all.filter((id) => id !== 'wren'),
		pia: all.filter((id) => id !== 'pia' && id !== 'merrin'),
		tobias: all.filter((id) => id !== 'tobias' && id !== 'fenn-rooke'),
		edda: all.filter((id) => id !== 'edda' && id !== 'fenn-rooke'),
		nell: all.filter((id) => id !== 'nell' && id !== 'merrin' && id !== 'fenn-rooke'),
	};

	for (const [me, must] of Object.entries(MUST)) {
		it(`marked person ${me}: ${must.length} of the other 15 people get at least one relation text`, () => {
			const rels = computeRelations(g, me);
			for (const id of must) expect(rels.get(id)?.length, `${me} -> ${id}`).toBeGreaterThan(0);
		});
	}

	it('a partner of the same sex is a partner (kind "partner") and is not in the list of in-laws', () => {
		const wren = computeRelations(g, 'wren');
		expect(wren.get('calla')!.map((r) => r.kind)).toEqual(['partner']);
		const tobias = computeRelations(g, 'tobias');
		expect(tobias.get('dario')!.map((r) => r.kind)).toEqual(['partner']);
		const edda = computeRelations(g, 'edda');
		expect(edda.get('lisbet')!.map((r) => r.kind)).toEqual(['partner']);
		expect(edda.get('anselm')!.map((r) => r.kind)).toEqual(['partner']);
	});

	it('the other woman of a couple is related to the child of the first woman by marriage', () => {
		expect(computeRelations(g, 'wren').get('lisbet')!.map((r) => r.kind)).toEqual(['by-marriage']);
	});

	it('D174: a child with one listed parent and a sibling with two gets a "maybe" with the setting on and none with the setting off', () => {
		const on = computeRelations(g, 'wren', { oneParentUnknown: true }).get('hale')!;
		const off = computeRelations(g, 'wren', { oneParentUnknown: false }).get('hale')!;
		expect(on[0].maybe?.cause).toBe('unlisted');
		expect(on[0].maybe?.effect).toBe('full');
		expect(off[0].maybe).toBeUndefined();
		// The same pair seen from Hale.
		expect(computeRelations(g, 'hale', { oneParentUnknown: true }).get('wren')![0].maybe?.cause).toBe('unlisted');
	});

	it('a marked person who is not in the tree gives no relation and no error', () => {
		expect(() => computeRelations(g, 'not-a-person')).not.toThrow();
		expect(computeRelations(g, 'not-a-person').size).toBe(0);
	});
});
