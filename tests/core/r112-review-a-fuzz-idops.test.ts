import { describe, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { Op } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { allFixtures } from '../acceptance/load';
import { nextIdFor } from '../support/helpers';
import { fail, mutate } from '../support/mutate';
import { Rng, hash32 } from '../support/rng';

/*
 * Spec §8: nothing may throw. Every sample tree is mutated a few hundred times (the structure and
 * the text) and then the id operations (`set-house-id`, `set-title-id`) and `newPersonId` run on the
 * result. A refusal is a fine outcome; a throw, a body that does not parse, or a change to anything
 * but ids is not. The mutation machinery is `tests/support/mutate.ts`, shared with `fuzz.test.ts`.
 *
 * Deterministic: each case has its own seed, printed on failure. To re-run one case on every
 * fixture: FUZZ_SEED=0x1234abcd npx vitest run tests/core/r112-review-a-fuzz-idops.test.ts
 */

const BASE_SEED = 0x5eed2026;

function casesFor(sourceLength: number): number {
	if (sourceLength < 6000) return 200;
	if (sourceLength < 30000) return 50;
	return 10;
}

const onlySeed = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : undefined;


// ---- Review area A: the id ops on mutated trees ----

const CATCH_ALL = 'The plugin cannot make this change. Edit the note text.';
function runIdOps(text: string, rng: Rng) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const t0 = r.tree;
	const houseIds = t0.houses.map((h) => h.id);
	const titleIds = (t0.titles ?? []).map((t) => t.id);
	const refs = [...t0.people.map((p) => p.house), ...t0.people.map((p) => p.cardTitle)].filter((x): x is string => typeof x === 'string');
	for (let k = 0; k < 6; k++) {
		const isHouse = rng.chance(0.5);
		const pool = isHouse ? houseIds : titleIds;
		const id = rng.chance(0.85) && pool.length ? rng.pick(pool) : rng.pick(['ghost', '', 'x']);
		const newId = rng.pick(['fresh', 'a-1', '123', 'true', '-', 'Caps', ' ', id, ...(refs.length ? [rng.pick(refs)] : []), ...(pool.length ? [rng.pick(pool)] : []), 'x'.repeat(50)]);
		const op = (isHouse ? { kind: 'set-house-id', id, newId } : { kind: 'set-title-id', id, newId }) as Op;
		const res = applyOp(text, op);
		if (!res.ok) {
			if (res.detail === CATCH_ALL) fail(`${op.kind} ${id} -> ${newId} threw inside applyOp`);
			continue;
		}
		const again = parseDynasty(res.body);
		if (!again.ok) fail(`${op.kind} wrote a body that does not parse: ${again.error.code}`);
		if (id === newId) {
			if (res.body !== text) fail('no-op changed text');
			continue;
		}
		const t1 = again.tree;
		const map = (v: string | undefined) => (v === id ? newId : v);
		if (isHouse) {
			const got = t1.people.map((p) => p.house);
			const want = t0.people.map((p) => map(p.house));
			if (JSON.stringify(got) !== JSON.stringify(want)) fail(`houses of people: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
			if (JSON.stringify(t1.houses.map((h) => h.id)) !== JSON.stringify(t0.houses.map((h) => map(h.id)))) fail('house ids differ');
		} else {
			const got = t1.people.map((p) => p.cardTitle);
			const want = t0.people.map((p) => map(p.cardTitle));
			if (JSON.stringify(got) !== JSON.stringify(want)) fail(`card-titles: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
			if (JSON.stringify((t1.titles ?? []).map((h) => h.id)) !== JSON.stringify((t0.titles ?? []).map((h) => map(h.id)))) fail('title ids differ');
		}
		// Nothing else changed: same people, names, parents, unions.
		const strip = (t: typeof t0) => JSON.stringify({ p: t.people.map((p) => [p.id, p.name, p.parents, p.sex, p.born]), u: t.unions.map((u) => u.partners) });
		if (strip(t0) !== strip(t1)) fail('other data changed');
	}
}

describe('review A: id ops on mutated trees never throw and change only ids', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}`, () => {
			let parsed: unknown;
			try {
				parsed = parseYaml(f.source);
			} catch {
				parsed = {};
			}
			const n = onlySeed === undefined ? Math.max(5, Math.floor(casesFor(f.source.length) / 2)) : 1;
			for (let i = 0; i < n; i++) {
				const seed = onlySeed ?? hash32(`${BASE_SEED}:idops:${f.id}:${i}`);
				const rng = new Rng(seed);
				const { text, names } = mutate(f.source, parsed, rng);
				try {
					runIdOps(text, rng);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
					throw new Error(`Id op fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)}\nmutations: ${names.join(', ')}\n${err}\n--- text ---\n${text.slice(0, 2500)}`);
				}
			}
		}, 120000);
	}
});

function runNewId(text: string) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const t = r.tree;
	const named = new Set<string>();
	for (const p of t.people) {
		named.add(p.id);
		for (const q of p.parents) named.add(q.id);
	}
	for (const u of t.unions) for (const x of u.partners) named.add(x);
	for (const k of ['start', 'focus', 'me'] as const) {
		const v = (t.options as unknown as Record<string, unknown>)[k];
		if (typeof v === 'string') named.add(v);
	}
	for (const ti of t.titles ?? []) for (const h of ti.holders) if (h.person) named.add(h.person);
	const id = nextIdFor(text);
	if (!/^p\d+$/.test(id)) fail(`id ${id} is not numbered`);
	if (named.has(id)) fail(`new id ${id} is already named in the tree`);
	let max = 0;
	for (const n of named) {
		const m = /^p(\d+)$/.exec(n);
		if (m && m[1].length <= 15) max = Math.max(max, Number(m[1]));
	}
	if (Number(id.slice(1)) <= max) fail(`new id ${id} is not above ${max}`);
}

describe('review A: newPersonId on mutated trees', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}`, () => {
			let parsed: unknown;
			try {
				parsed = parseYaml(f.source);
			} catch {
				parsed = {};
			}
			const n = Math.max(5, Math.floor(casesFor(f.source.length) / 2));
			for (let i = 0; i < n; i++) {
				const seed = hash32(`${BASE_SEED}:newid:${f.id}:${i}`);
				const rng = new Rng(seed);
				const { text, names } = mutate(f.source, parsed, rng);
				try {
					runNewId(text);
				} catch (e) {
					throw new Error(`newPersonId fuzz failure on fixture ${f.id}, case ${i}: ${(e as Error).message}\nmutations: ${names.join(', ')}\n--- text ---\n${text.slice(0, 2500)}`);
				}
			}
		}, 120000);
	}
});
