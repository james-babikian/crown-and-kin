// Contract 0.2.7 M.2, M.3, M.11 (WP2c): properties of the open branches on random trees.
// 1. Rows never change `heirs`, `more`, `old`, `noYear`, `noBirthYear` (the reference is the frozen engine of the build before the feature).
// 2. Adding a living child to the person of a row puts the child at the place of the row.
// 3. The rows follow the shape rules of M.1 and M.3.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { successionLine, type SuccessionSpec } from '../../src/core/succession';
import * as baseline from '../support/r027-branches-baseline';

const RULES = ['eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative', 'born-in-reign'] as const;
const INHERIT = ['men-only', 'men-first-in-house', 'men-first', 'no-preference', 'women-first', 'women-first-in-house', 'women-only'] as const;
const IN_HOUSE: readonly string[] = ['men-first-in-house', 'women-first-in-house'];

/** A small seeded generator, so a failure repeats. */
function random(seed: number): () => number {
	let s = seed;
	return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

interface Sample {
	source: (extra: string[]) => string;
	spec: SuccessionSpec;
	limit: number;
}

function sample(rnd: () => number): Sample {
	const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
	const n = 6 + Math.floor(rnd() * 16);
	const lines: string[] = [];
	for (let i = 0; i < n; i++) {
		const parents: string[] = [];
		if (i > 0) {
			const k = rnd() < 0.15 ? 2 : rnd() < 0.85 ? 1 : 0;
			for (let j = 0; j < k; j++) {
				const par = Math.floor(rnd() * i);
				const type = rnd() < 0.1 ? 'adoptive' : rnd() < 0.05 ? 'rumoured' : 'birth';
				const e = type === 'birth' ? `p${par}` : `{id: p${par}, type: ${type}}`;
				if (!parents.includes(e)) parents.push(e);
			}
		}
		const sex = rnd() < 0.45 ? 'm' : rnd() < 0.9 ? 'f' : '';
		const r = rnd();
		// A few odd dates: no year, a doubt, an alive word, so the J.2 and J.7 readers are used.
		const died = r < 0.45 ? `, died: ${1000 + i * 10 + Math.floor(rnd() * 40)}` : r < 0.5 ? `, died: unknown` : r < 0.52 ? `, died: alive` : r < 0.54 ? `, died: long ago` : '';
		const born = rnd() < 0.05 ? '' : `, born: ${1000 + i * 10}`;
		const ill = rnd() < 0.1 ? ', illegitimate: true' : '';
		const childless = rnd() < 0.05 ? ', childless: true' : '';
		lines.push(`  - {id: p${i}, name: P${i}${sex ? ', sex: ' + sex : ''}${born}${died}${ill}${childless}${parents.length ? ', parents: [' + parents.join(', ') + ']' : ''}}`);
	}
	const holders: string[] = [];
	const ids = new Set<number>();
	for (let j = 0, nh = 1 + Math.floor(rnd() * 3); j < nh; j++) ids.add(Math.floor(rnd() * n));
	let y = 1100;
	[...ids].forEach((id, j) => {
		holders.push(`{person: p${id}, from: ${y}${j < ids.size - 1 ? ', to: ' + (y + 20) : ''}}`);
		y += 20;
	});
	const spec: SuccessionSpec = { rule: pick(RULES), inherit: pick(INHERIT), illegitimate: pick(['no', 'after', 'equal'] as const), adopted: rnd() < 0.5 };
	if (rnd() < 0.2) spec.inheritThrough = pick(['men', 'women', 'anyone'] as const);
	if (rnd() < 0.15) spec.body = true;
	if (rnd() < 0.15) spec.heirs = [`p${Math.floor(rnd() * n)}`, `p${Math.floor(rnd() * n)}`];
	if (rnd() < 0.15) spec.exclude = [`p${Math.floor(rnd() * n)}`];
	if (rnd() < 0.2) spec.year = String(1100 + Math.floor(rnd() * 150));
	return {
		source: (extra) => `people:\n${[...lines, ...extra].join('\n')}\n\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n${holders.map((h) => '      - ' + h).join('\n')}\n`,
		spec,
		limit: pick([1, 3, 5, 99]),
	};
}

function graph(source: string): FamilyGraph | undefined {
	const r = parseDynasty(source);
	return r.ok ? deriveFamilies(r.tree) : undefined;
}

const TREES = 800;

// The random samples take some seconds; the default limit of 5 s is too short on a loaded machine.
describe('open branches: random trees', { timeout: 60_000 }, () => {
	it('rows never change heirs, more, old, noYear, noBirthYear, or the named heirs', () => {
		const rnd = random(777);
		let withRows = 0;
		let lines = 0;
		for (let t = 0; t < TREES; t++) {
			const s = sample(rnd);
			const g = graph(s.source([]));
			if (!g) continue;
			const now = successionLine(g, g.titles[0], s.spec, s.limit, 60, rnd() < 0.3 ? 30 : 0);
			const before = baseline.successionLine(g, g.titles[0], s.spec, s.limit, 60);
			const pick = (r: typeof now | typeof before) => ({ kind: r.kind, year: r.year, ruler: r.ruler, heirs: r.heirs, more: r.more, old: r.old, noYear: r.noYear, noBirthYear: r.noBirthYear, named: r.namedHeirs, co: r.coRulers, first: r.firstHolder, outside: r.outsideBody });
			expect(pick(now), `tree ${t}`).toEqual(pick(before));
			// A person without sex who would be a branch is counted too, so the count can only grow.
			expect(now.leftOutNoSex).toBeGreaterThanOrEqual(before.leftOutNoSex);
			if (now.kind === 'line') lines++;
			if (now.openBranches.length) withRows++;
		}
		// The sample must reach the feature, or the property proves nothing.
		expect(lines).toBeGreaterThan(TREES / 2);
		expect(withRows).toBeGreaterThan(TREES / 10);
	});

	it('the rows follow M.1 and M.3: dead, no child, not R, in line order, at most limit, not an heir', () => {
		const rnd = random(4242);
		for (let t = 0; t < TREES; t++) {
			const s = sample(rnd);
			const g = graph(s.source([]));
			if (!g) continue;
			const r = successionLine(g, g.titles[0], s.spec, s.limit, 0);
			if (r.kind !== 'line') {
				expect(r.openBranches).toEqual([]);
				expect(r.moreBranches).toBe(false);
				continue;
			}
			const hasChild = new Set<string>();
			for (const q of g.people) for (const p of q.parents) hasChild.add(p.id);
			let last = 0;
			const seen = new Set<string>();
			for (const row of r.openBranches) {
				const x = g.byId.get(row.id)!;
				expect(x.died, `tree ${t} row ${row.id}`).toBeDefined();
				expect(hasChild.has(row.id)).toBe(false);
				expect(x.childless).toBeUndefined();
				expect(row.id).not.toBe(r.ruler);
				expect(r.heirs).not.toContain(row.id);
				expect(row.before).toBeLessThanOrEqual(r.heirs.length);
				expect(row.before).toBeGreaterThanOrEqual(last);
				expect(seen.has(row.id)).toBe(false);
				last = row.before;
				seen.add(row.id);
			}
			expect(r.openBranches.length).toBeLessThanOrEqual(s.limit);
		}
	});

	it('the setting youngDeathAge only removes rows, and keeps the order of the others', () => {
		const rnd = random(99);
		for (let t = 0; t < TREES / 3; t++) {
			const s = sample(rnd);
			const g = graph(s.source([]));
			if (!g) continue;
			const full = successionLine(g, g.titles[0], s.spec, 99, 0).openBranches.map((x) => x.id);
			const young = successionLine(g, g.titles[0], s.spec, 99, 0, 30).openBranches.map((x) => x.id);
			expect(young).toEqual(full.filter((id) => young.includes(id)));
		}
	});

	it('adding a living child to the person of a row puts the child at the place of the row', () => {
		const rnd = random(31337);
		let tried = 0;
		for (let t = 0; t < TREES * 2; t++) {
			const s = sample(rnd);
			// One pass, one reading of the flag, no named heirs, no body switch, no through-key: the child is walked in the same pass as its parent (M.2).
			const single =
				['eldest-child', 'youngest-child', 'born-in-reign'].includes(s.spec.rule!) &&
				!IN_HOUSE.includes(s.spec.inherit) &&
				s.spec.illegitimate !== 'after' &&
				!s.spec.body &&
				s.spec.inheritThrough === undefined &&
				!s.spec.heirs &&
				!s.spec.year;
			if (!single) continue;
			const g = graph(s.source([]));
			if (!g) continue;
			const all = successionLine(g, g.titles[0], s.spec, 99, 0);
			if (all.kind !== 'line') continue;
			for (const row of all.openBranches.slice(0, 2)) {
				const sex = s.spec.inherit === 'women-only' ? 'f' : 'm';
				const g2 = graph(s.source([`  - {id: zz, name: ZZ, sex: ${sex}, born: 1999, parents: [${row.id}]}`]));
				if (!g2) continue;
				const next = successionLine(g2, g2.titles[0], s.spec, 99, 0);
				const expected = all.heirs.slice();
				expected.splice(row.before, 0, 'zz');
				tried++;
				expect(next.heirs, `tree ${t} row ${row.id}@${row.before}`).toEqual(expected);
				expect(next.openBranches.some((x) => x.id === row.id)).toBe(false);
			}
		}
		expect(tried).toBeGreaterThan(50);
	});
});
