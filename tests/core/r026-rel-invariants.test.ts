import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import { rng } from '../support/rng';

// D176: invariants of the rule on random trees with rumoured parents and double cousins. All names are made up.

interface Person {
	id: string;
	sex: string;
	parents: [string, 'birth' | 'rumoured'][];
}

/** Four to five founders, six to eight children of up to four parents each, and grandchildren of one or two of them. */
function randomTree(rand: () => number): Person[] {
	const founders: Person[] = Array.from({ length: 4 + Math.floor(rand() * 2) }, (_, i) => ({ id: `f${i}`, sex: i % 2 ? 'f' : 'm', parents: [] }));
	const kids: Person[] = [];
	const n = 6 + Math.floor(rand() * 3);
	for (let i = 0; i < n; i++) {
		const chosen = founders.filter(() => rand() < 0.5);
		kids.push({ id: `k${i}`, sex: ['m', 'f', '-'][Math.floor(rand() * 3)], parents: chosen.map((p) => [p.id, rand() < 0.45 ? 'rumoured' : 'birth']) });
	}
	const grand: Person[] = [];
	for (let i = 0; i < 5; i++) {
		const a = kids[Math.floor(rand() * kids.length)];
		const b = kids[Math.floor(rand() * kids.length)];
		const picks = a === b || rand() < 0.4 ? [a] : [a, b];
		grand.push({ id: `g${i}`, sex: rand() < 0.5 ? 'm' : 'f', parents: picks.map((p) => [p.id, rand() < 0.2 ? 'rumoured' : 'birth']) });
	}
	return [...founders, ...kids, ...grand];
}

function build(people: Person[]): FamilyGraph {
	const out = ['people:'];
	for (const p of people) {
		out.push(`  - id: ${p.id}`, `    name: ${p.id}`);
		if (p.sex !== '-') out.push(`    sex: ${p.sex}`);
		if (p.parents.length) out.push(`    parents: [${p.parents.map(([id, t]) => (t === 'birth' ? id : `{id: ${id}, type: rumoured}`)).join(', ')}]`);
	}
	const r = parseDynasty(out.join('\n') + '\n');
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

function shuffled<T>(list: T[], rand: () => number): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** The blood names of one person with the maybe of each, as sorted text. */
function bloodOf(g: FamilyGraph, from: string, to: string, options: RelationOptions): string[] {
	return (computeRelations(g, from, options).get(to) ?? [])
		.filter((r) => r.kind === 'blood')
		.map((r) => `${r.lower}|${r.maybe ? `${r.maybe.effect}/${r.maybe.cause}/${r.maybe.some ? 'some' : ''}|${r.maybe.lower}` : ''}`)
		.sort();
}

describe('D176 invariants on random trees (3 seeds, both settings)', () => {
	for (const seed of [176001, 176002, 176003]) {
		for (const on of [true, false]) {
			it(`seed ${seed}, setting ${on ? 'on' : 'off'}: finder agrees with the cards, "rumoured" names have a "rumoured" step, order of people and parents changes nothing`, () => {
				const options: RelationOptions = { oneParentUnknown: on };
				const rand = rng(seed);
				let checked = 0;
				let rumouredNames = 0;
				let some = 0;
				const bad: string[] = [];
				for (let round = 0; round < 25; round++) {
					const people = randomTree(rand);
					const g = build(people);
					const other = build(shuffled(people, rand).map((p) => ({ ...p, parents: shuffled(p.parents, rand) })));
					const ids = people.map((p) => p.id);
					for (const a of ids) {
						const all = computeRelations(g, a, options);
						for (const b of ids) {
							if (a === b) continue;
							const list = all.get(b) ?? [];
							const found = findRelation(g, a, b, options);
							const here = `round ${round} ${a}>${b}`;
							// Order independence of the blood names and their maybes.
							const want = bloodOf(g, a, b, options);
							const got = bloodOf(other, a, b, options);
							if (JSON.stringify(want) !== JSON.stringify(got)) bad.push(`${here}: order ${JSON.stringify(want)} against ${JSON.stringify(got)}`);
							if (found.kind !== 'named') {
								if (list.length) bad.push(`${here}: cards name it, the finder does not`);
								continue;
							}
							// Card, sheet and finder agree on the names.
							const cards = list.map((r) => r.lower).sort();
							const names = found.relations.map((x) => x.relation.lower).sort();
							if (JSON.stringify(cards) !== JSON.stringify(names)) bad.push(`${here}: cards ${JSON.stringify(cards)} finder ${JSON.stringify(names)}`);
							for (const { relation, steps } of found.relations) {
								if (relation.maybe?.some && !(relation.maybe.effect === 'full' && relation.maybe.cause === 'rumoured')) bad.push(`${here}: "some" on ${relation.lower}`);
								if (relation.maybe?.some) some++;
								if (relation.kind !== 'blood' || !relation.lower.includes('rumoured')) continue;
								rumouredNames++;
								if (!steps.some((s) => s.word.includes('rumoured'))) bad.push(`${here}: ${relation.lower} has steps ${steps.map((s) => s.word).join(', ')}`);
							}
							checked++;
						}
					}
				}
				expect(bad.slice(0, 5)).toEqual([]);
				expect(checked).toBeGreaterThan(3000);
				expect(rumouredNames).toBeGreaterThan(100);
				expect(some).toBeGreaterThan(0);
			}, 120_000);
		}
	}
});
