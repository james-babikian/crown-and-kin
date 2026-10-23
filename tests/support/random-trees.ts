import type { FamilyGraph } from '../../src/core/derive';
import { tagTop } from '../../src/layout/geometry';
import type { EdgeDrawing, EdgePath, Rect, TreeLayout } from '../../src/layout/model';
import { isForkShare } from './fork-share';
import { rng } from './rng';

// Seeded random family trees (half-siblings, remarriages, parent–child and cousin marriages,
// adoptions) checked for the line rules of spec §5.3 and review 1.3: no straight line passes
// behind a card, and no two families share a stretch of line.

export function randomTree(seed: number): string {
	const rand = rng(seed);
	const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const n = 4 + Math.floor(rand() * 22);
	const people: string[] = [];
	const unions: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = `p${i}`;
		const sex = rand() < 0.5 ? 'm' : 'f';
		const parents: string[] = [];
		if (i > 1 && rand() < 0.7) {
			const earlier = Array.from({ length: i }, (_, k) => `p${k}`);
			const a = pick(earlier);
			parents.push(a);
			if (rand() < 0.7) {
				const b = pick(earlier.filter((x) => x !== a));
				if (b) parents.push(b);
			}
		}
		const typed = parents.map((p) => {
			const r = rand();
			return r < 0.8 ? p : r < 0.88 ? `{id: ${p}, type: adoptive}` : r < 0.94 ? `{id: ${p}, type: ward}` : `{id: ${p}, type: rumoured}`;
		});
		people.push(`  - {id: ${id}, name: P${i}, sex: ${sex}${typed.length ? `, parents: [${typed.join(', ')}]` : ''}${rand() < 0.1 ? ', illegitimate: true' : ''}}`);
		if (i > 0 && rand() < 0.25) unions.push(`  - {partners: [${id}, p${Math.floor(rand() * i)}]}`);
	}
	return `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}

/** A made-up tree: `n` people in a drifting window of parents, and a rumoured link on every person. */
export function rumourTree(n: number): string {
	let a = 12345;
	const rand = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const people: string[] = [];
	for (let i = 0; i < n; i++) {
		const parents: string[] = [];
		if (i >= 8) {
			const lo = Math.max(0, i - 24);
			const one = lo + Math.floor(rand() * (i - 8 - lo + 1));
			parents.push(`p${one}`);
			const two = lo + Math.floor(rand() * (i - 8 - lo + 1));
			if (two !== one) parents.push(`p${two}`);
			const far = Math.floor(rand() * (i - 8));
			if (!parents.includes(`p${far}`)) parents.push(`{id: p${far}, type: rumoured}`);
		}
		people.push(`  - {id: p${i}, name: P${i}, sex: ${i % 2 ? 'f' : 'm'}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`);
	}
	return `people:\n${people.join('\n')}\n`;
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

function straight(d: string): Seg[] {
	const out: Seg[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHV])([^MHVC]*)/g)) {
		const n = args.trim().split(/[\s,]+/).map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			if (n[0] !== x) out.push({ x1: x, y1: y, x2: n[0], y2: y });
			x = n[0];
		} else {
			if (n[0] !== y) out.push({ x1: x, y1: y, x2: x, y2: n[0] });
			y = n[0];
		}
	}
	return out;
}

const COUPLE = new Set(['marriage', 'betrothal', 'concubinage', 'affair', 'implicit']);

/** Which family a line belongs to: a couple (its partners) or a set of placement parents. */
function family(g: FamilyGraph, p: EdgePath): string {
	const key = (ids: string[]) => [...ids].sort().join('|');
	if (COUPLE.has(p.kind)) return `couple:${key(p.people)}`;
	const [first, ...rest] = p.people;
	const own = g.placementParents.get(first) ?? [];
	// A drop lists the child first, then its placement parents; a trunk lists the parents first.
	if (rest.length && key(rest) === key(own)) return `family:${key(own)}`;
	return `family:${key(g.placementParents.get(p.people[p.people.length - 1]) ?? [])}`;
}

function inside(s: Seg, b: Rect): boolean {
	const e = 0.5;
	return Math.max(s.x1, s.x2) > b.x + e && Math.min(s.x1, s.x2) < b.x + b.w - e && Math.max(s.y1, s.y2) > b.y + e && Math.min(s.y1, s.y2) < b.y + b.h - e;
}

export function lineProblems(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	const lines = edges.paths.filter((p) => !p.d.includes('C')).map((p) => ({ p, fam: family(g, p), segs: straight(p.d) }));
	for (const { p, segs } of lines) {
		for (const s of segs) for (const b of layout.persons.values()) if (inside(s, b)) bad.push(`${p.kind} [${p.people}] behind ${b.id}`);
	}
	// No straight line runs through a far-couple tag, except that person's own far couple lines.
	// Side-link curves are not routed and can cross tags; review 3.4 measured them separately.
	for (const tag of layout.farTags.values()) {
		const pill = { x: tag.hit.x, y: tagTop(layout.geometry, tag.y), w: tag.hit.w, h: layout.geometry.tagH };
		for (const { p, segs } of lines) {
			if (COUPLE.has(p.kind) && p.people.includes(tag.person) && tag.spouses.some((s) => p.people.includes(s))) continue;
			if (segs.some((s) => inside(s, pill))) bad.push(`${p.kind} [${p.people}] through ${tag.person}'s tag`);
		}
	}
	// A union dot must not lie on a line of another couple or family.
	const r = layout.geometry.unionSize / 2;
	for (const fu of g.unions) {
		const u = layout.unions.get(fu.key)!;
		// A far couple without children or side links has no dot.
		if (u.far && !fu.children.length && !g.secondary.some((s) => s.unionKey === fu.key)) continue;
		for (const { p, segs } of lines) {
			if (fu.partners.every((x) => p.people.includes(x))) continue;
			const last = segs[segs.length - 1];
			const farLeg = COUPLE.has(p.kind) && p.people.length === 1 && fu.partners.includes(p.people[0]) && last && Math.abs(last.x2 - u.x) < 0.5 && Math.abs(last.y2 - u.y) < 0.5;
			if (farLeg) continue;
			const onIt = segs.some((s) => Math.min(s.x1, s.x2) - r <= u.x && u.x <= Math.max(s.x1, s.x2) + r && Math.min(s.y1, s.y2) - r <= u.y && u.y <= Math.max(s.y1, s.y2) + r);
			if (onIt) bad.push(`dot of ${fu.partners} lies on ${p.kind} [${p.people}]`);
		}
	}
	for (let i = 0; i < lines.length; i++) {
		for (let j = i + 1; j < lines.length; j++) {
			if (lines[i].fam === lines[j].fam) continue;
			for (const [ai, a] of lines[i].segs.entries()) {
				for (const [bi, b] of lines[j].segs.entries()) {
					const h = a.y1 === a.y2 && b.y1 === b.y2 && Math.abs(a.y1 - b.y1) < 0.5;
					const v = a.x1 === a.x2 && b.x1 === b.x2 && Math.abs(a.x1 - b.x1) < 0.5;
					if (!h && !v) continue;
					const [a1, a2, b1, b2] = h ? [a.x1, a.x2, b.x1, b.x2] : [a.y1, a.y2, b.y1, b.y2];
					const shared = Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
					// The fork (D228) shares the stem of two legs of one person, and only that (tests/support/fork-share.ts).
					if (shared > 0.5 && !isForkShare(lines[i].p, lines[j].p, lines[i].segs, lines[j].segs, ai, bi)) bad.push(`${lines[i].p.kind} [${lines[i].p.people}] and ${lines[j].p.kind} [${lines[j].p.people}] share ${Math.round(shared)} px`);
				}
			}
		}
	}
	return bad;
}

