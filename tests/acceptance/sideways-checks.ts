import type { FamilyGraph } from '../../src/core/derive';
import type { Tree } from '../../src/core/types';
import { tagTop } from '../../src/layout/geometry';
import type { EdgeDrawing, EdgePath, FarCoupleRule, FarTag, Geometry, PersonBox, Rect, TreeLayout } from '../../src/layout/model';
import { renderSvg } from '../../src/render/svg-string';
import { isStructuralFar } from '../support/far-structure';
import { isForkShare } from '../support/fork-share';
import { specModel } from './spec-model';

/*
 * Checks for the sideways layout of D24 (M5 contract in src/layout/model.ts, the decision notes
 * "WP5.5"). Each check returns a list of problems, so a failing test names what is wrong. They
 * are written from the contract, not from an implementation.
 */

/** Smallest tap target in CSS px (spec §7.5). */
export const MIN_HIT = 44;
const E = 0.5;

const right = (b: Rect) => b.x + b.w;
const bottom = (b: Rect) => b.y + b.h;

/** True if the two rectangles share some area (touching edges do not count). */
export function overlap(a: Rect, b: Rect): boolean {
	return a.x < right(b) - E && b.x < right(a) - E && a.y < bottom(b) - E && b.y < bottom(a) - E;
}

const strictlyInside = (p: { x: number; y: number }, r: Rect) => p.x > r.x + E && p.x < right(r) - E && p.y > r.y + E && p.y < bottom(r) - E;

/** Every card once; `rows[i]` is generation i, one column, listed top to bottom; columns left to right. */
export function columnProblems(g: FamilyGraph, layout: TreeLayout): string[] {
	const bad: string[] = [];
	if (layout.orientation !== 'sideways') bad.push(`orientation is ${String(layout.orientation)}`);
	if (layout.persons.size !== g.people.length) bad.push(`${layout.persons.size} cards for ${g.people.length} people`);
	const inRows = layout.rows.flat();
	if (inRows.length !== new Set(inRows).size) bad.push('a person is in two rows');
	if ([...inRows].sort().join() !== g.people.map((p) => p.id).sort().join()) bad.push('rows do not list every person exactly once');
	const box = (id: string) => layout.persons.get(id)!;
	layout.rows.forEach((col, i) => {
		const boxes = col.map(box).filter(Boolean);
		for (const b of boxes) if (b.gen !== i) bad.push(`${b.id} is in column ${i} but has gen ${b.gen}`);
		// One column: the same left edge and width for every card of the generation.
		for (const b of boxes) if (Math.abs(b.x - boxes[0].x) > E || Math.abs(b.w - boxes[0].w) > E) bad.push(`${b.id} is not in the column of ${boxes[0].id} (x ${b.x} vs ${boxes[0].x})`);
		// Top to bottom, without overlap.
		for (let k = 1; k < boxes.length; k++) {
			if (boxes[k].y < bottom(boxes[k - 1]) - E) bad.push(`${boxes[k].id} is not below ${boxes[k - 1].id} in column ${i}`);
		}
	});
	for (let i = 0; i + 1 < layout.rows.length; i++) {
		const left = layout.rows[i].map(box);
		const next = layout.rows[i + 1].map(box);
		if (!left.length || !next.length) continue;
		const edge = Math.max(...left.map(right));
		const start = Math.min(...next.map((b) => b.x));
		if (!(start > edge + E)) bad.push(`column ${i + 1} starts at ${start}, not right of column ${i} (right edge ${edge})`);
	}
	return bad;
}

/** No two cards share any area. */
export function overlapProblems(layout: TreeLayout): string[] {
	const bad: string[] = [];
	const boxes = [...layout.persons.values()];
	for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) bad.push(`${boxes[i].id} overlaps ${boxes[j].id}`);
	return bad;
}

/** D2 and spec §4.3: siblings from top to bottom in `people` order (groups from spec-model.ts, not derive). */
export function siblingOrderProblems(tree: Tree, layout: TreeLayout): string[] {
	const bad: string[] = [];
	for (const [family, kids] of specModel(tree).families) {
		for (let i = 1; i < kids.length; i++) {
			const a = layout.persons.get(kids[i - 1]);
			const b = layout.persons.get(kids[i]);
			if (a && b && !(b.y > a.y)) bad.push(`${family}: ${kids[i - 1]} (y ${a.y}) is not above ${kids[i]} (y ${b.y})`);
		}
	}
	return bad;
}

/**
 * `bar`: partners in the same column, one directly above the other, and the union point in the
 * gap between the two cards (contract: `UnionPoint.bar`). A bar couple is never far.
 */
export function barProblems(g: FamilyGraph, layout: TreeLayout): string[] {
	const bad: string[] = [];
	for (const fu of g.unions) {
		const u = layout.unions.get(fu.key);
		if (!u) {
			bad.push(`no union point for ${fu.partners}`);
			continue;
		}
		if (!u.bar) continue;
		if (u.far) bad.push(`${fu.partners} has a bar and is far`);
		const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
		if (a.gen !== b.gen || Math.abs(a.x - b.x) > E) {
			bad.push(`${fu.partners}: bar partners are not in one column`);
			continue;
		}
		const [up, down] = a.y < b.y ? [a, b] : [b, a];
		if (!(u.y > bottom(up) - E && u.y < down.y + E)) bad.push(`${fu.partners}: union point y ${u.y} is not between ${bottom(up)} and ${down.y}`);
		if (!(u.x > up.x && u.x < right(up))) bad.push(`${fu.partners}: union point x ${u.x} is not over the column ${up.x}–${right(up)}`);
		const col = layout.rows[up.gen];
		if (Math.abs(col.indexOf(up.id) - col.indexOf(down.id)) !== 1) bad.push(`${fu.partners}: another card sits between the partners`);
	}
	return bad;
}

/** `rowGaps` in sideways are x values: right edge of column i, left edge of column i+1, and no card enters that band. */
export function rowGapProblems(layout: TreeLayout): string[] {
	const bad: string[] = [];
	const cols = layout.rows.filter((c) => c.length);
	if (layout.rowGaps.length !== Math.max(0, layout.rows.length - 1)) bad.push(`${layout.rowGaps.length} row gaps for ${layout.rows.length} columns`);
	layout.rowGaps.forEach((gap, i) => {
		const left = (layout.rows[i] ?? []).map((id) => layout.persons.get(id)!);
		const next = (layout.rows[i + 1] ?? []).map((id) => layout.persons.get(id)!);
		if (left.length && Math.abs(gap.top - Math.max(...left.map(right))) > E) bad.push(`gap ${i}: top ${gap.top} is not the right edge of column ${i}`);
		if (next.length && Math.abs(gap.bottom - Math.min(...next.map((b) => b.x))) > E) bad.push(`gap ${i}: bottom ${gap.bottom} is not the left edge of column ${i + 1}`);
		if (!(gap.bottom > gap.top)) bad.push(`gap ${i}: empty band ${gap.top}–${gap.bottom}`);
		for (const b of layout.persons.values()) if (b.x < gap.bottom - E && right(b) > gap.top + E) bad.push(`${b.id} enters gap ${i} (${gap.top}–${gap.bottom})`);
	});
	if (!cols.length && layout.rowGaps.length) bad.push('row gaps without columns');
	return bad;
}

/**
 * D10/D11 in sideways: the far distance keeps its length in px, `maxCardWidths` times the card
 * width of the `down` geometry (`geo.cardW`), now measured from card centre to card centre along
 * the column. More than `maxGenerations` apart is always far. Every far couple has a tag on each
 * partner that names the other. D303: a couple far by structure (`isStructuralFar`) is far at any distance.
 */
export function farRuleProblems(g: FamilyGraph, layout: TreeLayout, geo: Geometry, rule: FarCoupleRule): string[] {
	const bad: string[] = [];
	const limit = rule.maxCardWidths * geo.cardW;
	const cy = (b: PersonBox) => b.y + b.h / 2;
	for (const fu of g.unions) {
		const u = layout.unions.get(fu.key)!;
		const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
		const gens = Math.abs(a.gen - b.gen);
		const apart = Math.abs(cy(a) - cy(b));
		if (gens > rule.maxGenerations && !u.far) bad.push(`${fu.partners}: ${gens} generations apart but not far`);
		if (u.far && gens <= rule.maxGenerations && !(apart > limit) && !isStructuralFar(g, layout, fu.key, rule)) bad.push(`${fu.partners}: far at ${apart} px apart (limit ${limit} px)`);
		if (u.far) {
			for (const [me, other] of [
				[a.id, b.id],
				[b.id, a.id],
			]) {
				if (!layout.farTags.get(me)?.spouses.includes(other)) bad.push(`${me} has no tag naming ${other}`);
			}
		}
	}
	for (const t of layout.farTags.values()) {
		for (const s of t.spouses) {
			const far = g.unions.some((fu) => fu.partners.includes(t.person) && fu.partners.includes(s) && layout.unions.get(fu.key)!.far);
			if (!far) bad.push(`${t.person}'s tag names ${s}, but they are not a far couple`);
		}
	}
	return bad;
}

/**
 * Far tags (contract `FarTag`, the decision notes "WP5.5a fix"): anchored on the card's bottom edge; in
 * the left half of it when a partner is stacked directly below (so the tag does not sit on the
 * union point); hit areas of at least 44×44 px (§7.5) in the gap below the card, covering the
 * part of the visible tag below the card edge, and covering no card (not even their own) and no
 * other hit area. The card wins a press where the two meet (WP4.3), so a hit on a card is lost.
 */
export function tagProblems(g: FamilyGraph, layout: TreeLayout): string[] {
	const bad: string[] = [];
	const geo = layout.geometry;
	const tags = [...layout.farTags.values()];
	for (const t of tags) {
		const card = layout.persons.get(t.person);
		if (!card) {
			bad.push(`tag of unknown person ${t.person}`);
			continue;
		}
		if (Math.abs(t.y - bottom(card)) > E) bad.push(`${t.person}: tag y ${t.y} is not the card's bottom edge ${bottom(card)}`);
		if (!(t.x > card.x && t.x < right(card))) bad.push(`${t.person}: tag x ${t.x} is not on the card's edge ${card.x}–${right(card)}`);
		if (t.hit.w < MIN_HIT || t.hit.h < MIN_HIT) bad.push(`${t.person}: tag hit area ${t.hit.w}×${t.hit.h} is below 44×44`);
		if (t.hit.y < bottom(card) - E) bad.push(`${t.person}: tag hit area starts at ${t.hit.y}, inside its own card (bottom ${bottom(card)})`);
		if (bottom(t.hit) < tagTop(geo, t.y) + geo.tagH - E) bad.push(`${t.person}: the visible tag reaches below its hit area`);
		if (!(t.x > t.hit.x && t.x < right(t.hit))) bad.push(`${t.person}: tag x ${t.x} is outside its hit area`);
		for (const b of layout.persons.values()) if (overlap(t.hit, b)) bad.push(`${t.person}: tag hit area covers ${b.id === t.person ? 'its own card' : b.id}`);
		for (const fu of g.unions) {
			const u = layout.unions.get(fu.key)!;
			if (!u.bar || !fu.partners.includes(t.person)) continue;
			const other = layout.persons.get(fu.partners.find((p) => p !== t.person) ?? t.person)!;
			if (other.y <= card.y) continue;
			if (!(t.x < card.x + card.w / 2)) bad.push(`${t.person}: partner ${other.id} is stacked below, but the tag (x ${t.x}) is not in the left half`);
			if (strictlyInside(u, t.hit)) bad.push(`${t.person}: tag hit area covers the union point with ${other.id}`);
		}
	}
	for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (overlap(tags[i].hit, tags[j].hit)) bad.push(`tags of ${tags[i].person} and ${tags[j].person} overlap`);
	return bad;
}

/** `width` and `height` hold every card, every drawn dot and bar point, and every tag. */
export function boundsProblems(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	const geo = layout.geometry;
	const r = geo.unionSize / 2;
	const within = (what: string, x0: number, y0: number, x1: number, y1: number) => {
		if (x0 < -E || y0 < -E || x1 > layout.width + E || y1 > layout.height + E) bad.push(`${what} (${x0},${y0})–(${x1},${y1}) is outside ${layout.width}×${layout.height}`);
	};
	for (const b of layout.persons.values()) within(`card ${b.id}`, b.x, b.y, right(b), bottom(b));
	for (const m of edges.markers) within(`${m.kind} marker`, m.x - r, m.y - r, m.x + r, m.y + r);
	for (const fu of g.unions) {
		const u = layout.unions.get(fu.key)!;
		if (u.bar || fu.children.length) within(`union point of ${fu.partners}`, u.x - r, u.y - r, u.x + r, u.y + r);
	}
	// The whole hit area too (the decision notes "WP5.5a fix"), not only the visible tag.
	for (const t of layout.farTags.values()) {
		const top = tagTop(geo, t.y);
		within(`tag of ${t.person}`, t.hit.x, Math.min(t.hit.y, top), right(t.hit), Math.max(bottom(t.hit), top + geo.tagH));
	}
	return bad;
}

/** Drawn union dots (markers other than the rumour "?"), as squares of the dot's size. */
function dots(layout: TreeLayout, edges: EdgeDrawing): Rect[] {
	const r = layout.geometry.unionSize / 2;
	return edges.markers.filter((m) => m.kind !== 'rumour').map((m) => ({ x: m.x - r, y: m.y - r, w: 2 * r, h: 2 * r }));
}

/** Names at 14 px in the D24 first view, so a layout px is 14 / fontPx screen px. */
export const FIRST_VIEW_NAME_PX = 14;

/**
 * A tag's tap area at the D24 first view: the hit grown around its centre until it is 44 screen
 * px (`44 × fontPx / 14` layout px) in each direction, as the view places it at a settled zoom.
 */
export function firstViewHit(t: FarTag, fontPx: number): Rect {
	const min = (MIN_HIT * fontPx) / FIRST_VIEW_NAME_PX;
	const w = Math.max(t.hit.w, min);
	const h = Math.max(t.hit.h, min);
	return { x: t.hit.x - (w - t.hit.w) / 2, y: t.hit.y - (h - t.hit.h) / 2, w, h };
}

/**
 * The decision notes "WP5.5a fix" (1): at the D24 first view, each far tag's whole 44 px tap area lies
 * in the gap below its card: it covers no card (not even its own), no union dot, and no other
 * tag's tap area.
 */
export function firstViewTagProblems(layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	const f = layout.geometry.fontPx;
	const tags = [...layout.farTags.values()].map((t) => ({ t, r: firstViewHit(t, f) }));
	const dotRects = dots(layout, edges);
	for (const { t, r } of tags) {
		const card = layout.persons.get(t.person)!;
		if (r.y < bottom(card) - E) bad.push(`${t.person}: the first-view tap area starts at ${r.y}, inside its own card (bottom ${bottom(card)})`);
		for (const b of layout.persons.values()) if (overlap(r, b)) bad.push(`${t.person}: the first-view tap area covers ${b.id === t.person ? 'its own card' : b.id}`);
		for (const d of dotRects) if (overlap(r, d)) bad.push(`${t.person}: the first-view tap area covers the union dot at ${d.x + d.w / 2},${d.y + d.h / 2}`);
	}
	for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (overlap(tags[i].r, tags[j].r)) bad.push(`first-view tap areas of ${tags[i].t.person} and ${tags[j].t.person} overlap`);
	return bad;
}

/**
 * The visible tags as the headless renderer draws them (`renderSvg`), with every name made long
 * so each tag is at its widest. Keyed by person; a tag with no drawn pill is left out.
 */
export function visibleTags(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): Map<string, Rect> {
	const long: FamilyGraph = { ...g, byId: new Map([...g.byId].map(([id, p]) => [id, { ...p, name: `${p.name} of the Long Western Marches and the Isles` }])) };
	const svg = renderSvg(long, layout, edges, { margin: 0 });
	const geo = layout.geometry;
	const attr = (el: string, name: string) => Number(new RegExp(`\\s${name}="([^"]*)"`).exec(el)?.[1]);
	const pills = [...svg.matchAll(/<rect\s[^>]*>/g)].map((m) => ({ x: attr(m[0], 'x'), y: attr(m[0], 'y'), w: attr(m[0], 'width'), h: attr(m[0], 'height') })).filter((r) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.h < geo.cardH);
	const out = new Map<string, Rect>();
	for (const t of layout.farTags.values()) {
		const card = layout.persons.get(t.person)!;
		// The pill on this card's bottom edge that holds the tag's anchor.
		const pill = pills.find((r) => r.x <= t.x + E && right(r) >= t.x - E && r.y < bottom(card) + geo.tagH && bottom(r) > bottom(card) - geo.tagH);
		if (pill) out.set(t.person, pill);
	}
	return out;
}

/**
 * The decision notes "WP5.5a fix" (2), for very small fonts: the visible tag (at its widest) stays in its
 * tag zone and on the card: the bottom edge less 0.5 em each side, or, with a partner stacked
 * directly below, the left half, clear of the union dot. The hit area stays inside the layout
 * and covers no union dot and no other tag's hit area.
 */
export function smallTagProblems(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	const geo = layout.geometry;
	const r = geo.unionSize / 2;
	const pills = visibleTags(g, layout, edges);
	const tags = [...layout.farTags.values()];
	const dotRects = dots(layout, edges);
	for (const t of tags) {
		const card = layout.persons.get(t.person)!;
		const pill = pills.get(t.person);
		if (!pill) {
			bad.push(`${t.person}: no visible tag drawn`);
			continue;
		}
		let lo = card.x + 0.5 * geo.fontPx;
		let hi = right(card) - 0.5 * geo.fontPx;
		for (const fu of g.unions) {
			const u = layout.unions.get(fu.key)!;
			if (!u.bar || !fu.partners.includes(t.person)) continue;
			const other = layout.persons.get(fu.partners.find((p) => p !== t.person) ?? t.person)!;
			if (other.y > card.y) hi = Math.min(hi, card.x + card.w / 2, u.x - r);
		}
		if (pill.x < lo - E || right(pill) > hi + E) bad.push(`${t.person}: the visible tag ${pill.x}–${right(pill)} leaves its zone ${lo}–${hi}`);
		lo = card.x;
		if (pill.x < lo - E || right(pill) > right(card) + E) bad.push(`${t.person}: the visible tag leaves the card`);
		if (t.hit.x < -E || t.hit.y < -E || right(t.hit) > layout.width + E || bottom(t.hit) > layout.height + E) bad.push(`${t.person}: tag hit area is outside the layout ${layout.width}×${layout.height}`);
		for (const d of dotRects) if (overlap(t.hit, d)) bad.push(`${t.person}: tag hit area covers the union dot at ${d.x + d.w / 2},${d.y + d.h / 2}`);
	}
	for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (overlap(tags[i].hit, tags[j].hit)) bad.push(`tags of ${tags[i].person} and ${tags[j].person} overlap`);
	return bad;
}

/**
 * `layout.geometry` is what renderers draw cards with (`cardText(layout.geometry)`, tag size,
 * dot size), so it must describe the cards the layout placed, at the note font it was given.
 */
export function geometryProblems(layout: TreeLayout, geo: Geometry): string[] {
	const bad: string[] = [];
	const lg = layout.geometry;
	if (lg.fontPx !== geo.fontPx) bad.push(`geometry font ${lg.fontPx} px, given ${geo.fontPx} px`);
	if (lg.unionSize !== geo.unionSize) bad.push(`union size ${lg.unionSize}, given ${geo.unionSize}`);
	if (lg.tagH !== geo.tagH) bad.push(`tag height ${lg.tagH}, given ${geo.tagH}`);
	for (const b of layout.persons.values()) {
		if (Math.abs(b.w - lg.cardW) > E || Math.abs(b.h - lg.cardH) > E) {
			bad.push(`${b.id} is ${b.w}×${b.h}, layout.geometry says ${lg.cardW}×${lg.cardH}`);
			break;
		}
	}
	return bad;
}

// ---------- Lines (the random-tree properties of tests/support/random-trees.ts, for any path syntax) ----------

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** Straight segments of a path with M, L, H, V, Z (absolute or relative); `null` if it has a curve. */
export function straightSegments(d: string): Seg[] | null {
	const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
	const out: Seg[] = [];
	let i = 0;
	let cmd = '';
	let x = 0;
	let y = 0;
	let sx = 0;
	let sy = 0;
	const num = () => Number(tokens[i++]);
	const to = (nx: number, ny: number) => {
		if (nx !== x || ny !== y) out.push({ x1: x, y1: y, x2: nx, y2: ny });
		x = nx;
		y = ny;
	};
	while (i < tokens.length) {
		if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
		const rel = cmd !== cmd.toUpperCase();
		const bx = rel ? x : 0;
		const by = rel ? y : 0;
		switch (cmd.toUpperCase()) {
			case 'M':
				x = bx + num();
				y = by + num();
				sx = x;
				sy = y;
				cmd = rel ? 'l' : 'L';
				break;
			case 'L': {
				const nx = bx + num();
				to(nx, by + num());
				break;
			}
			case 'H':
				to(bx + num(), y);
				break;
			case 'V':
				to(x, by + num());
				break;
			case 'Z':
				to(sx, sy);
				break;
			default:
				return null;
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

function crosses(s: Seg, b: Rect): boolean {
	return Math.max(s.x1, s.x2) > b.x + E && Math.min(s.x1, s.x2) < right(b) - E && Math.max(s.y1, s.y2) > b.y + E && Math.min(s.y1, s.y2) < bottom(b) - E;
}

/**
 * The line rules of spec §5.3 and review 1.3 that the `down` layout keeps on random trees: no
 * straight line behind a card or through a visible tag (other than the person's own far couple lines),
 * no union dot on another family's line, and no two families on one stretch of line.
 */
export function lineProblems(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing, pills?: ReadonlyMap<string, Rect>): string[] {
	const bad: string[] = [];
	const lines = edges.paths
		.map((p) => ({ p, segs: straightSegments(p.d) }))
		.filter((l): l is { p: EdgePath; segs: Seg[] } => l.segs !== null)
		.map((l) => ({ ...l, fam: family(g, l.p) }));
	for (const { p, segs } of lines) {
		for (const s of segs) for (const b of layout.persons.values()) if (crosses(s, b)) bad.push(`${p.kind} [${p.people}] behind ${b.id}`);
	}
	const geo = layout.geometry;
	for (const tag of layout.farTags.values()) {
		// Without the drawn tags, the widest the renderer may draw one: the hit area's width.
		const pill = pills?.get(tag.person) ?? { x: tag.hit.x, y: tagTop(geo, tag.y), w: tag.hit.w, h: geo.tagH };
		for (const { p, segs } of lines) {
			if (COUPLE.has(p.kind) && p.people.includes(tag.person) && tag.spouses.some((s) => p.people.includes(s))) continue;
			if (segs.some((s) => crosses(s, pill))) bad.push(`${p.kind} [${p.people}] through ${tag.person}'s tag`);
		}
	}
	const r = geo.unionSize / 2;
	for (const fu of g.unions) {
		const u = layout.unions.get(fu.key)!;
		// A far couple without children or side links has no dot.
		if (u.far && !fu.children.length && !g.secondary.some((s) => s.unionKey === fu.key)) continue;
		for (const { p, segs } of lines) {
			if (fu.partners.every((x) => p.people.includes(x))) continue;
			const last = segs[segs.length - 1];
			const farLeg = COUPLE.has(p.kind) && p.people.length === 1 && fu.partners.includes(p.people[0]) && last && Math.abs(last.x2 - u.x) < E && Math.abs(last.y2 - u.y) < E;
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
					const h = a.y1 === a.y2 && b.y1 === b.y2 && Math.abs(a.y1 - b.y1) < E;
					const v = a.x1 === a.x2 && b.x1 === b.x2 && Math.abs(a.x1 - b.x1) < E;
					if (!h && !v) continue;
					const [a1, a2, b1, b2] = h ? [a.x1, a.x2, b.x1, b.x2] : [a.y1, a.y2, b.y1, b.y2];
					const shared = Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
					// The fork (D228) shares the stem of two legs of one person, and only that (tests/support/fork-share.ts).
					if (shared > E && !isForkShare(lines[i].p, lines[j].p, lines[i].segs, lines[j].segs, ai, bi)) bad.push(`${lines[i].p.kind} [${lines[i].p.people}] and ${lines[j].p.kind} [${lines[j].p.people}] share ${Math.round(shared)} px`);
				}
			}
		}
	}
	return bad;
}
