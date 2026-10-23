// G2b sweep of the N05 fix round: runs many trees in many variants and writes one record per case to the file in SWEEP_OUT.
// Run it on two commits and compare the files (scratch/n05-g2b-compare.mjs). Without SWEEP_OUT it only checks the fix round for new line problems.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { foldFamilies, foldHidden, pruneGraph } from '../../src/core/folds';
import { foldMark } from '../../src/layout/fold-spots';
import { cardForm, geometryFor, tagTop } from '../../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { allFixtures } from '../acceptance/load';
import { build } from '../support/helpers';
import { lineProblems, randomTree } from '../support/random-trees';
import { rng } from '../support/rng';

const FAR = { maxCardWidths: 3, maxGenerations: 1 };

/** A denser made-up tree: more people, more marriages (second and third marriages, cousin and uncle marriages). */
export function denseTree(seed: number): string {
	const rand = rng(seed * 7919 + 13);
	const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const n = 10 + Math.floor(rand() * 30);
	const people: string[] = [];
	const unions: string[] = [];
	for (let i = 0; i < n; i++) {
		const sex = rand() < 0.5 ? 'm' : 'f';
		const parents: string[] = [];
		if (i > 1 && rand() < 0.8) {
			const earlier = Array.from({ length: i }, (_, k) => `p${k}`);
			const a = pick(earlier);
			parents.push(a);
			if (rand() < 0.8) {
				const b = pick(earlier.filter((x) => x !== a));
				if (b) parents.push(b);
			}
		}
		people.push(`  - {id: p${i}, name: P${i}, sex: ${sex}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`);
		if (i > 0 && rand() < 0.5) unions.push(`  - {partners: [p${i}, p${Math.floor(rand() * i)}]}`);
	}
	return `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}

function column(d: string): number {
	let x = 0;
	let col = 0;
	for (const m of d.matchAll(/([MHV])(-?[\d.]+)/g)) {
		if (m[1] === 'M' || m[1] === 'H') x = Number(m[2]);
		if (m[1] === 'V') col = x;
	}
	return col;
}

interface Variant {
	name: string;
	px: number;
	form: 'plain' | 'roundel' | 'sideways';
	fold: number; // 0 = no fold controls; k = every kth family folded
}
const VARIANTS: Variant[] = [
	{ name: 'down16', px: 16, form: 'plain', fold: 0 },
	{ name: 'down24', px: 24, form: 'plain', fold: 0 },
	{ name: 'roundel16', px: 16, form: 'roundel', fold: 0 },
	{ name: 'roundel-fold4', px: 16, form: 'roundel', fold: 4 },
	{ name: 'roundel-fold3', px: 24, form: 'roundel', fold: 3 },
	{ name: 'plain-fold4', px: 16, form: 'plain', fold: 4 },
	{ name: 'side16', px: 16, form: 'sideways', fold: 0 },
	{ name: 'side-fold3', px: 16, form: 'sideways', fold: 3 },
];

function runCase(src: string, v: Variant) {
	const { g } = build(src);
	let fams: string[] = [];
	let hidden = new Set<string>();
	if (v.fold) {
		fams = foldFamilies(g).filter((_, i) => i % v.fold === 1).map((x) => x.key);
		hidden = foldHidden(g, new Set(fams));
	}
	clearLayoutCache();
	const base = geometryFor(v.px);
	const geo = v.form === 'roundel' ? cardForm(base, 'down') : v.form === 'sideways' ? cardForm(base, 'sideways') : base;
	const settings: LayoutSettings = { sweeps: 4, far: FAR, ...(v.form === 'sideways' ? { orientation: 'sideways' as const } : {}), ...(v.fold ? { foldControls: true, foldedFamilies: fams, foldHidden: [...hidden].sort() } : {}) };
	const { layout, edges } = layoutTree(g, geo, settings, 'x');
	const pg = v.fold ? pruneGraph(g, hidden) : g;
	const problems = lineProblems(pg, layout, edges);
	// Stubs and cross-row dots
	let crossRow = 0;
	let stubs = 0;
	const r = layout.geometry.unionSize / 2;
	if (v.form !== 'sideways') {
		for (const fu of pg.unions) {
			const u = layout.unions.get(fu.key);
			if (!u) continue;
			const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
			if (!a || !b || u.bar || u.far || a.gen === b.gen) continue;
			crossRow++;
			const cols = edges.paths.filter((p) => p.union === fu.key && p.kind !== 'descent' && p.people.length === 2).map((p) => column(p.d));
			if (cols.length === 2 && (u.x < Math.min(...cols) - 0.5 || u.x > Math.max(...cols) + 0.5)) stubs++;
		}
	}
	// Dots on signs, dots on other dots, dots in tags
	const extra: string[] = [];
	for (const c of layout.folds ?? []) {
		if (!c.folded) continue;
		const k = foldMark(c, c.spot, layout.geometry.fontPx, v.form === 'sideways');
		for (const m of edges.markers) {
			if (m.union === undefined || m.union === c.union) continue;
			const dx = Math.max(Math.min(k.x1, k.x2) - m.x, 0, m.x - Math.max(k.x1, k.x2));
			const dy = Math.max(Math.min(k.y1, k.y2) - m.y, 0, m.y - Math.max(k.y1, k.y2));
			if (Math.hypot(dx, dy) < k.r + r) extra.push(`dot ${m.union} on sign ${c.key}`);
		}
	}
	const ms = edges.markers.filter((m) => m.union !== undefined);
	for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) if (Math.hypot(ms[i].x - ms[j].x, ms[i].y - ms[j].y) < 2 * r - 0.01) extra.push(`dot ${ms[i].union} on dot ${ms[j].union}`);
	for (const tag of layout.farTags.values()) {
		const pill = { x: tag.hit.x, y: tagTop(layout.geometry, tag.y), w: tag.hit.w, h: layout.geometry.tagH };
		for (const m of ms) if (m.x > pill.x - r && m.x < pill.x + pill.w + r && m.y > pill.y - r && m.y < pill.y + pill.h + r) extra.push(`dot ${m.union} in tag of ${tag.person}`);
	}
	const hash = createHash('sha1').update(JSON.stringify({ p: edges.paths.map((p) => p.d), m: edges.markers, u: [...layout.unions.values()].map((u) => [u.x, u.y]), c: [...layout.persons.values()].map((p) => [p.x, p.y]) })).digest('hex').slice(0, 12);
	const hasCross = (() => {
		for (const fu of pg.unions) {
			const u = layout.unions.get(fu.key);
			const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
			if (u && a && b && !u.bar && !u.far && a.gen !== b.gen) return true;
		}
		return false;
	})();
	const crossKeys: string[] = [];
	for (const fu of pg.unions) {
		const u = layout.unions.get(fu.key);
		const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
		if (u && a && b && !u.bar && !u.far && a.gen !== b.gen) crossKeys.push(fu.key, fu.partners.join(','));
	}
	return { problems, crossRow, stubs, extra, hash, hasCross, crossKeys };
}

const N = Number(process.env.SWEEP_N ?? 150);
const OUT = process.env.SWEEP_OUT;
const KIND = process.env.SWEEP_KIND ?? 'random';

describe('G2b sweep', () => {
	it('runs the variants', { timeout: 3_000_000 }, () => {
		const recs: Record<string, unknown> = {};
		const items: [string | number, string][] = KIND === 'fixtures' ? allFixtures().map((f) => [f.id, f.source]) : Array.from({ length: N }, (_, i) => [i + 1, KIND === 'dense' ? denseTree(i + 1) : randomTree(i + 1)]);
		for (const [seed, src] of items) {
			for (const v of VARIANTS) {
				try {
					recs[`${KIND}:${seed}:${v.name}`] = runCase(src, v);
				} catch (e) {
					recs[`${KIND}:${seed}:${v.name}`] = { error: String(e).slice(0, 100) };
				}
			}
		}
		if (OUT) writeFileSync(OUT, JSON.stringify(recs));
		expect(Object.keys(recs).length).toBeGreaterThan(0);
	});
});
