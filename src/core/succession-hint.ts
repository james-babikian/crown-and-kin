/*
 * The cadet-title hint of the Titles window (owner decision D291, spec §13.21 rule 14). While the switch "Only descendants
 * of the first holder can inherit" is off, the hint names the first person in the line who is of an older line than the first
 * holder, that is, someone whom the switch would remove. It never changes the line. The rule is two runs of the line (switch off, switch on), then a test of seniority over claim links.
 */

import type { TreeDates } from './dates';
import { drawnParentMap, type FamilyGraph } from './derive';
import { successionLine, type SuccessionResult, type SuccessionSpec } from './succession';
import { firstHolderOf } from './succession-first';
import type { Person, Title } from './types';

/** The person that the hint names, and the first holder that the person does not descend from. */
interface CadetHint {
	person: string;
	first: string;
}

/** What the hint may reuse or read besides the title. */
interface CadetHintOptions {
	/** Another view of the dates (the window's draft); absent: the graph's own. */
	dates?: TreeDates;
	/** The line that the caller already has for this same title and spec (switch off). It is used only if it is complete (`more` is false). */
	line?: SuccessionResult;
}

/** The limit of the two runs: the whole line, so that a person far down the line is found. */
const WHOLE_LINE = 1_000_000;

/**
 * The hint for a title and a spec, or null. Pure. The spec is the draft as it stands; with the switch on there is no hint.
 * The hint shows only when a pass reaches the first holder with the switch on, and the switch removes someone from the line who
 * is senior to the first holder: at their nearest common ancestor over claim links, the child on their side is older than the
 * child on the side of the first holder (birth year, then the order of the note).
 */
export function cadetHint(g: FamilyGraph, title: Title, spec: SuccessionSpec, opts: CadetHintOptions = {}): CadetHint | null {
	if (spec.body || spec.bad || !spec.rule) return null;
	const first = firstHolderOf(g, title.holders);
	if (!first) return null;
	const reuse = opts.line !== undefined && opts.line.kind === 'line' && !opts.line.more ? opts.line : undefined;
	const off = reuse ?? successionLine(g, title, spec, WHOLE_LINE, 0, 0, opts.dates ?? g.dates);
	if (off.kind !== 'line' || off.heirs.length === 0) return null;
	const on = successionLine(g, title, { ...spec, body: true }, WHOLE_LINE, 0, 0, opts.dates ?? g.dates);
	if (on.kind !== 'line' || on.outsideBody) return null;
	const kept = new Set(on.heirs);
	const removed = off.heirs.filter((id) => !kept.has(id));
	if (removed.length === 0) return null;
	const person = firstSenior(g, spec, opts.dates ?? g.dates, first.id, removed);
	return person === null ? null : { person, first: first.id };
}

/** The claim links of the tree for a spec (spec §13.21 rule 10): the claim parents of a person, and the ancestry over them. */
interface ClaimWorld {
	parents(id: string): string[];
	/** Every ancestor of `id` over claim links, with the children of it that lie on the way up from `id` (`id` itself is in the map, with no child). */
	ancestry(id: string): Map<string, Set<string>>;
}

function claimWorld(g: FamilyGraph, spec: SuccessionSpec): ClaimWorld {
	const drawn = drawnParentMap(g);
	const illOn = spec.illegitimate !== 'no';
	const cache = new Map<string, string[]>();
	// Rule 10: a birth link carries a claim unless the child is marked and the setting says no; an adoptive link only with the switch.
	const parents = (id: string): string[] => {
		let out = cache.get(id);
		if (out) return out;
		out = [];
		const child = g.byId.get(id);
		for (const d of drawn.get(id) ?? []) {
			const carries = child !== undefined && ((d.type === 'birth' && (!child.illegitimate || illOn)) || (d.type === 'adoptive' && spec.adopted));
			if (carries && !out.includes(d.id) && g.byId.has(d.id)) out.push(d.id);
		}
		cache.set(id, out);
		return out;
	};
	const ancestry = (id: string): Map<string, Set<string>> => {
		const out = new Map<string, Set<string>>([[id, new Set()]]);
		for (const queue = [id]; queue.length; ) {
			const x = queue.shift()!;
			for (const p of parents(x)) {
				let kids = out.get(p);
				if (!kids) {
					kids = new Set();
					out.set(p, kids);
					queue.push(p);
				}
				kids.add(x);
			}
		}
		return out;
	};
	return { parents, ancestry };
}

/**
 * The place of each claim child of a parent in the rank of rule 12 key 3, with no gender step: the dated children in year order
 * fill the places of the dated children in the written order; a child with no year keeps its place. Made when first asked.
 */
function childPlaces(g: FamilyGraph, dates: TreeDates, claim: ClaimWorld): (parent: string) => Map<string, number> {
	let kidsOf: Map<string, string[]> | undefined;
	const places = new Map<string, Map<string, number>>();
	const year = (p: Person): number | undefined => dates.read(p.born)?.year;
	return (parent) => {
		let out = places.get(parent);
		if (out) return out;
		if (!kidsOf) {
			kidsOf = new Map();
			for (const child of g.people) {
				for (const p of claim.parents(child.id)) {
					const list = kidsOf.get(p);
					if (list) list.push(child.id);
					else kidsOf.set(p, [child.id]);
				}
			}
		}
		const group = (kidsOf.get(parent) ?? []).map((id) => g.byId.get(id)!).sort((a, b) => a.index - b.index);
		const dated: { p: Person; y: number }[] = [];
		const slots: number[] = [];
		group.forEach((p, i) => {
			const y = year(p);
			if (y === undefined) return;
			slots.push(i);
			dated.push({ p, y });
		});
		// `sort` is stable, so equal years keep the written order.
		dated.sort((a, b) => a.y - b.y);
		const ranked = group.slice();
		slots.forEach((slot, k) => void (ranked[slot] = dated[k].p));
		out = new Map(ranked.map((p, i) => [p.id, i]));
		places.set(parent, out);
		return out;
	};
}

/** The first of `removed` (in line order) who is senior to `holder`, or null. */
function firstSenior(g: FamilyGraph, spec: SuccessionSpec, dates: TreeDates, holder: string, removed: readonly string[]): string | null {
	const claim = claimWorld(g, spec);
	const placeIn = childPlaces(g, dates, claim);
	const above = claim.ancestry(holder);
	for (const x of removed) {
		// The first holder's own ancestors and descendants are not "of an older line".
		if (above.has(x)) continue;
		const up = claim.ancestry(x);
		if (up.has(holder)) continue;
		for (const [a, mine] of up) {
			const theirs = above.get(a);
			if (!theirs) continue;
			// Only the nearest common ancestors count: no child of A on both sides lies below it.
			if ([...mine].some((c) => theirs.has(c))) continue;
			const place = placeIn(a);
			for (const cx of mine) for (const ch of theirs) if (place.get(cx)! < place.get(ch)!) return x;
		}
	}
	return null;
}
