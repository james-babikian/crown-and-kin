// The protocol of `relationLookup` (spec §13.1 "Performance"; rule book "Relation words", "One lookup"): whatever the order of the
// questions, the batches, the repeats and the later reading of a line, each answer equals `computeRelations` for the same mark,
// and each person is worked out once. The lookup drops its search memos after every request (the rule book calls this its release),
// so every call after the first one runs after a release. A move of the relation code into several files must keep all of this.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { computeRelations, relationCallStats, relationLookup, type Relation, type RelationOptions } from '../../src/core/relations';
import { genTree, yamlOf } from '../support/gen-tree';
import { build, fixture } from '../support/helpers';

const OPTIONS: RelationOptions[] = [{ oneParentUnknown: true }, { oneParentUnknown: false }];

/** The same number of people from the start, the middle and the end of the list, at most `n`. */
const sample = <T>(list: readonly T[], n: number): T[] => (list.length <= n ? [...list] : Array.from({ length: n }, (_, i) => list[Math.floor((i * (list.length - 1)) / (n - 1))]));

/** Every field of the names except the line (reading the line makes it). */
const shallow = (r: readonly Relation[] | undefined): string => JSON.stringify(r?.map(({ text, lower, kind, distance, maybe }) => [text, lower, kind, distance, maybe ?? null]) ?? null);
/** Every field of the names, the line too. */
const full = (r: readonly Relation[] | undefined): string => JSON.stringify(r ?? null);

interface Tree {
	label: string;
	g: FamilyGraph;
}

const TREES: Tree[] = [];
for (const file of readdirSync('fixtures').filter((f) => /^\d\d[a-z]?-.*\.md$/.test(f))) {
	const prefix = file.slice(0, file.indexOf('-'));
	try {
		const { g } = build(fixture(prefix));
		if (g.people.length <= 100) TREES.push({ label: `sample ${prefix}`, g });
	} catch {
		// a sample tree that does not parse (05) has no relations
	}
}
for (const seed of [1, 7, 42, 195, 226, 298, 333, ...Array.from({ length: 20 }, (_, i) => 500 + i)]) {
	const gen = genTree(seed);
	TREES.push({ label: `random seed ${seed}`, g: build(yamlOf(gen, Array.from({ length: gen.n }, (_, i) => i))).g });
}

describe('relationLookup keeps its protocol', () => {
	it('the trees are there (a run with none proves nothing)', () => {
		expect(TREES.length).toBeGreaterThan(12);
	});

	for (const tree of TREES) {
		for (const options of OPTIONS) {
			it(`${tree.label}, setting ${options.oneParentUnknown ? 'on' : 'off'}: reverse gets, batch, repeats and late lines all equal computeRelations`, () => {
				const ids = tree.g.people.map((p) => p.id);
				for (const me of sample(ids, 4)) {
					const ref = computeRelations(tree.g, me, options);
					const want = (id: string) => full(ref.get(id));
					const wantShallow = (id: string) => shallow(ref.get(id));

					// 1. Every id in reverse order, one id per request; the lines are read last, after all the later requests.
					const first = relationLookup(tree.g, me, options);
					const answers = [...ids].reverse().map((id) => [id, first.get(id)] as const);
					for (const [id, r] of answers) expect(shallow(r), `${me} -> ${id}`).toBe(wantShallow(id));
					for (const [id, r] of answers) expect(full(r), `${me} -> ${id} (line)`).toBe(want(id));

					// 2. One batch of all the ids, then single requests and a reversed batch after it; the lines of the first batch are read last.
					const second = relationLookup(tree.g, me, options);
					const before = relationCallStats.calls;
					const batch = second.getMany(ids);
					for (const id of ids) expect(shallow(batch.get(id)), `${me} -> ${id} (batch)`).toBe(wantShallow(id));
					expect([...batch.keys()].sort(), `${me}: who is in the batch`).toEqual(ids.filter((id) => ref.has(id)).sort());
					for (const id of ids) expect(full(second.get(id)), `${me} -> ${id} (after batch)`).toBe(want(id));
					const again = second.getMany([...ids].reverse());
					for (const id of ids) expect(full(again.get(id)), `${me} -> ${id} (second batch)`).toBe(want(id));
					for (const id of ids) expect(full(batch.get(id)), `${me} -> ${id} (line of the first batch)`).toBe(want(id));
					// Each person other than the mark is worked out once, however often it is asked.
					expect(relationCallStats.calls - before, `${me}: one run for each person`).toBe(ids.length - 1);

					// 3. A repeated id in one batch, and an unknown id.
					const third = relationLookup(tree.g, me, options);
					const some = sample(ids, 5);
					const repeated = third.getMany([...some, 'no-such-person', ...some.slice().reverse(), some[0], some[0]]);
					for (const id of some) expect(full(repeated.get(id)), `${me} -> ${id} (repeated)`).toBe(want(id));
					expect(repeated.has('no-such-person')).toBe(false);
					expect(third.get('no-such-person')).toBeUndefined();
				}
			});
		}
	}

	it('a mark that is not a person gives undefined for every id, in a single request and in a batch', () => {
		const tree = TREES[0];
		const ids = tree.g.people.map((p) => p.id);
		const lookup = relationLookup(tree.g, 'no-such-person', OPTIONS[0]);
		expect(lookup.get(ids[0])).toBeUndefined();
		expect(lookup.getMany(ids).size).toBe(0);
		expect(computeRelations(tree.g, 'no-such-person', OPTIONS[0]).size).toBe(0);
	});

	it('a graph whose list of people repeats an id: the last person that has a name wins, as in computeRelations', () => {
		const { g: base } = build('people:\n  - {id: a, name: A, sex: m}\n  - {id: b, name: B, parents: [a]}\n  - {id: c, name: C, parents: [a]}\n  - {id: d, name: D}\n');
		const c = base.byId.get('c')!;
		const d = base.byId.get('d')!;
		// Hand-made: the list holds `c` again after `d`, and `d` again at the end (no relation), so the last index with a name is not the last index.
		const dup: FamilyGraph = { ...base, people: [...base.people, c, d] };
		for (const options of OPTIONS) {
			for (const me of ['a', 'b', 'c', 'd']) {
				const ref = computeRelations(dup, me, options);
				const lookup = relationLookup(dup, me, options);
				const ids = ['d', 'c', 'c', 'a', 'b', 'd', 'c'];
				for (const id of ids) expect(full(lookup.get(id)), `${me} -> ${id}`).toBe(full(ref.get(id)));
				const batch = relationLookup(dup, me, options).getMany(ids);
				for (const id of ids) expect(full(batch.get(id)), `${me} -> ${id} (batch)`).toBe(full(ref.get(id)));
			}
		}
	});
});
