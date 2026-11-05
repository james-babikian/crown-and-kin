// The relation words on 400 random trees keep their answers (spec §13.1, §13.2; rule book "Relation words").
// `genTree` seeds 1 to 400 make trees with remarriages, rumoured, adoptive and ward parent links, a third parent and cousin
// marriages. For each tree and each setting of the sibling switch (D174), one hash holds every answer of `computeRelations`
// for every person as the mark (at most 40 people), and every answer of `findRelation` for up to 8 x 8 pairs (text, kind,
// distance, maybe, steps, line). The golden file was recorded on the relation code before it was split into files, so a move
// of code must leave every hash equal. Seeds 195, 226 and 298 must be in the golden file (the genealogy vet named them).
// Make the golden file again only on purpose: `WRITE_FINGERPRINT=1 npx vitest run --project perf tests/core/relations-random-sweep.test.ts`.
// It takes about 27 s, so it runs in the perf project (`npm run test:perf`).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeRelations, findRelation, type Relation, type RelationOptions } from '../../src/core/relations';
import { genTree, yamlOf } from '../support/gen-tree';
import { build } from '../support/helpers';

const GOLDEN = new URL('./golden-fingerprint/relations-random-sweep.json', import.meta.url);
const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const MUST_HAVE = [195, 226, 298];
const SETTINGS: [string, RelationOptions][] = [
	['on', { oneParentUnknown: true }],
	['off', { oneParentUnknown: false }],
];

/** The same number of people from the start, the middle and the end of the list, at most `n`. */
const sample = <T>(list: readonly T[], n: number): T[] => (list.length <= n ? [...list] : Array.from({ length: n }, (_, i) => list[Math.floor((i * (list.length - 1)) / (n - 1))]));

const plain = (r: Relation) => ({ text: r.text, lower: r.lower, kind: r.kind, distance: r.distance, line: r.line, maybe: r.maybe ?? null });
const hashOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** All the answers on one tree for one setting, as one hash. */
function treeHash(source: string, options: RelationOptions): string {
	const { g } = build(source);
	const ids = g.people.map((p) => p.id);
	const names = sample(ids, 40).map((me) => [me, [...computeRelations(g, me, options).entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, rels]) => [id, rels.map(plain)])]);
	const pairs: unknown[] = [];
	for (const a of sample(ids, 8)) {
		for (const b of sample(ids, 8)) {
			const f = findRelation(g, a, b, options);
			pairs.push(f.kind === 'named' ? [a, b, 'named', f.relations.map((x) => [plain(x.relation), x.steps])] : f.kind === 'chain' ? [a, b, 'chain', f.steps, f.line] : [a, b, 'none']);
		}
	}
	return hashOf([names, pairs]);
}

/** The tree of one seed as note text. */
const sourceOf = (seed: number): string => {
	const gen = genTree(seed);
	return yamlOf(gen, Array.from({ length: gen.n }, (_, i) => i));
};

function allHashes(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const seed of SEEDS) {
		const source = sourceOf(seed);
		for (const [name, options] of SETTINGS) out[`seed ${seed} setting ${name}`] = treeHash(source, options);
	}
	return out;
}

describe('the relation words on 400 random trees keep their answers (sweep)', () => {
	it('writes the golden file on request', () => {
		if (process.env.WRITE_FINGERPRINT === '1') writeFileSync(GOLDEN, `${JSON.stringify(allHashes(), null, '\t')}\n`);
		expect(existsSync(GOLDEN)).toBe(true);
	});

	it('the golden file holds every seed in both settings, with the three order-dependence seeds', () => {
		const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
		expect(Object.keys(golden)).toHaveLength(SEEDS.length * SETTINGS.length);
		for (const seed of MUST_HAVE) for (const [name] of SETTINGS) expect(golden[`seed ${seed} setting ${name}`]).toMatch(/^[0-9a-f]{16}$/);
	});

	it('every tree builds (a seed that does not build would leave a hole in the sweep)', () => {
		for (const seed of SEEDS) expect(() => build(sourceOf(seed)), `seed ${seed}`).not.toThrow();
	});

	it('every hash equals the golden one', { timeout: 600_000 }, () => {
		const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
		const now = allHashes();
		expect(Object.keys(now)).toEqual(Object.keys(golden));
		expect(Object.keys(now).filter((k) => now[k] !== golden[k])).toEqual([]);
	});

	it('the sweep reacts to the sibling switch (the tool is not blind)', () => {
		const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
		const differing = SEEDS.filter((s) => golden[`seed ${s} setting on`] !== golden[`seed ${s} setting off`]);
		expect(differing.length).toBeGreaterThan(20);
	});
});
