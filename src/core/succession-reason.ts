/*
 * Why the first heir of a line is not a child of the ruler (spec §13.21, D334 Q11). The line itself says nothing about this, so the Titles window asks
 * here. It reads the result of the line, the draft and the family graph, and changes no rule. A reason shows only when the claim and pass rules of the
 * line (rules 10, 11, 15 to 18) prove it; otherwise the answer is null and the window shows no reason. The window turns the answer into a quiet note.
 */

import { drawnParentMap, type DrawnParent, type FamilyGraph } from './derive';
import { relationLookup, type RelationOptions } from './relations';
import type { SuccessionResult, SuccessionSpec } from './succession';
import { makeLife } from './succession-dates';
import { isDead, type InheritRule, type SuccessionRule } from './succession-keys';
import type { Person } from './types';

/** Why a living child of the ruler is not in front: the box "Illegitimate" (with "They cannot inherit" or "after"), or an adoption with the switch off. */
export type FirstHeirBar = 'illegitimate' | 'illegitimate-after' | 'adopted';

/** The reason, with person ids; `relation` is the lower-case word of the first heir for the ruler ("sister"). */
export type FirstHeirReason =
	| { kind: 'no-child'; ruler: string; heir: string; relation: string }
	| { kind: 'dead-child'; via: string; ruler: string }
	| { kind: 'barred'; child: string; heir: string; bar: FirstHeirBar }
	| { kind: 'inherit'; heir: string; inherit: InheritRule }
	| { kind: 'rule'; heir: string; rule: SuccessionRule };

/** The choices of the draft that the reason reads. */
export type FirstHeirSpec = Pick<SuccessionSpec, 'rule' | 'inherit' | 'inheritThrough' | 'illegitimate' | 'adopted' | 'body' | 'exclude'>;

type Sex = 'm' | 'f';

/** One pass of the engine: the reading of the box "Illegitimate" and of adoptive links, the sex that is eligible and the sex that passes a claim on (none: everyone). */
interface Pass {
	ill: boolean;
	adopt: boolean;
	only?: Sex;
	needs?: Sex;
}

/** The sex that a one-sex or house form puts first; undefined for the other forms. */
function favoured(inherit: InheritRule): Sex | undefined {
	if (inherit === 'men-only' || inherit === 'men-first-in-house') return 'm';
	if (inherit === 'women-only' || inherit === 'women-first-in-house') return 'f';
	return undefined;
}

/** The passes of the engine in line order (rules 17 and 18): the illegitimacy passes outside, the sex passes inside. */
function passesOf(spec: FirstHeirSpec): Pass[] {
	const t = spec.inheritThrough;
	const needsOf = (only: Sex | undefined): Sex | undefined => (t === undefined ? only : t === 'anyone' ? undefined : t === 'men' ? 'm' : 'f');
	const house = spec.inherit === 'men-first-in-house' || spec.inherit === 'women-first-in-house';
	const sexes: (Sex | undefined)[] = house ? [favoured(spec.inherit), undefined] : [spec.inherit === 'men-only' ? 'm' : spec.inherit === 'women-only' ? 'f' : undefined];
	const ills = spec.illegitimate === 'after' ? [false, true] : [spec.illegitimate === 'equal'];
	return ills.flatMap((ill) => sexes.map((only): Pass => ({ ill, adopt: spec.adopted, only, needs: needsOf(only) })));
}

/** The facts that the parts of the reason share. R is `ruler`, the first heir is `heir`. */
interface Ctx {
	g: FamilyGraph;
	spec: FirstHeirSpec;
	rule: SuccessionRule;
	ruler: Person;
	heir: Person;
	passes: Pass[];
	ups: (id: string) => readonly DrawnParent[];
	kidsOf: ReadonlyMap<string, readonly Kid[]>;
	/** Never in the line, but they pass a claim on: the excluded people, the co-rulers and the holder of a keyed entry. */
	blocked: ReadonlySet<string>;
	alive: (p: Person) => boolean;
	dead: (p: Person) => boolean;
	/** R's descendants over links that can carry a claim. */
	below: ReadonlySet<string>;
	/** R and R's ancestors over the same links. */
	above: ReadonlySet<string>;
}

/** A child over one drawn link, with the type of the link. */
interface Kid {
	child: Person;
	type: string;
}

// Only birth and adoptive links can carry a claim (rule 10); a rumoured or ward link never does.
const claimable = (type: string): boolean => type === 'birth' || type === 'adoptive';
const eligible = (p: Person, at: Pass): boolean => at.only === undefined || p.sex === at.only;
const passesOn = (p: Person, at: Pass): boolean => at.needs === undefined || p.sex === at.needs;
const carries = (type: string, child: Person, at: Pass): boolean => (type === 'birth' && (!child.illegitimate || at.ill)) || (type === 'adoptive' && at.adopt);

/** The people reached from `start` by `next`, without `start`. */
function reach(start: string, next: (id: string) => Iterable<string>): Set<string> {
	const out = new Set<string>();
	for (const stack = [start]; stack.length; ) {
		for (const id of next(stack.pop()!)) {
			if (out.has(id) || id === start) continue;
			out.add(id);
			stack.push(id);
		}
	}
	return out;
}

/** The children of each person over the drawn links. */
function childrenMap(g: FamilyGraph, drawn: ReadonlyMap<string, DrawnParent[]>): Map<string, Kid[]> {
	const kidsOf = new Map<string, Kid[]>();
	for (const [id, list] of drawn) {
		const child = g.byId.get(id);
		if (!child) continue;
		for (const d of list) {
			const k = kidsOf.get(d.id);
			if (k) k.push({ child, type: d.type });
			else kidsOf.set(d.id, [{ child, type: d.type }]);
		}
	}
	return kidsOf;
}

/**
 * The reason that the first heir of `res` is not a child of the ruler R (the spouse of a holder who holds through the spouse), or null when no reason is needed
 * or none is sure (no line, no heir, a named heir, a child of R, an open "?" branch before the first heir, a child of R left out by the exclude list or ruling
 * too, a ruler who passes no claim on). `spec` holds the draft.
 * - R has no child in the tree, and the first heir has a sure blood word for R: 'no-child' (not with "Oldest generation first", where a child would not come first).
 * - The first heir is a child of a dead child of R who had a place in the line: 'dead-child'.
 * - The only living child of R who would come first, but for the box "Illegitimate" or an adoption, is left out by that: 'barred'.
 * - The sex rule left out a person of R's line who would come first: 'inherit'.
 * - Else, when the order rule alone puts the first heir in front: the neutral 'rule'.
 */
export function firstHeirReason(g: FamilyGraph, res: SuccessionResult, spec: FirstHeirSpec | undefined, options?: RelationOptions): FirstHeirReason | null {
	const rule = spec?.rule;
	if (res.kind !== 'line' || !spec || !rule || res.heirs.length === 0) return null;
	// The list starts with the grey "?" row of a branch: the heir is not the first row, so "comes first" would be untrue.
	if (res.openBranches.some((b) => b.before === 0)) return null;
	const heir = g.byId.get(res.heirs[0]);
	if (!heir || res.namedHeirs.some((n) => n.id === heir.id && n.state === 'first')) return null;
	const through = res.notes.find((n) => n.kind === 'through-spouse')?.params.spouse;
	const ruler = g.byId.get(typeof through === 'string' ? through : (res.ruler ?? ''));
	if (!ruler) return null;
	const drawn = drawnParentMap(g);
	const ups = (id: string): readonly DrawnParent[] => drawn.get(id) ?? [];
	if (ups(heir.id).some((d) => d.id === ruler.id && claimable(d.type))) return null;
	const passes = passesOf(spec);
	// With "The right to inherit comes from" written, a ruler of the other sex passes nothing on: the children never inherit, and other notes say why.
	if (spec.inheritThrough !== undefined && passes[0].needs !== undefined && ruler.sex !== passes[0].needs) return null;
	const kidsOf = childrenMap(g, drawn);
	const kids = [...new Set((kidsOf.get(ruler.id) ?? []).map((k) => k.child))];
	const blocked = new Set<string>([...(spec.exclude ?? []), ...res.coRulers, ...(res.ruler !== undefined && res.ruler !== ruler.id ? [res.ruler] : [])]);
	// The user left a child out, or a child rules too: the cause is that, not a rule.
	if (kids.some((k) => blocked.has(k.id))) return null;
	if (kids.length === 0) return noChildReason(g, rule, ruler.id, heir.id, options);
	const life = makeLife(g.people, res.year, (text) => g.dates.read(text)?.year, false);
	const Y = res.year;
	const dead = (p: Person): boolean => !life.alive(p) && !(Y !== null && (life.born(p) ?? -Infinity) > Y) && isDead(p);
	const below = reach(ruler.id, (id) => (kidsOf.get(id) ?? []).filter((k) => claimable(k.type)).map((k) => k.child.id));
	const above = reach(ruler.id, (id) => ups(id).filter((d) => claimable(d.type)).map((d) => d.id)).add(ruler.id);
	const ctx: Ctx = { g, spec, rule, ruler, heir, passes, ups, kidsOf, blocked, alive: life.alive, dead, below, above };
	return below.has(heir.id) ? inLineReason(ctx) : outsideReason(ctx, kids);
}

/** R has no child in the tree: the sure blood word of the first heir, else the rule. */
function noChildReason(g: FamilyGraph, rule: SuccessionRule, ruler: string, heir: string, options: RelationOptions | undefined): FirstHeirReason {
	const neutral: FirstHeirReason = { kind: 'rule', heir, rule };
	// With "Oldest generation first" a brother comes before a child anyway, so "no child" is not the cause.
	if (rule === 'siblings-first') return neutral;
	const names = relationLookup(g, ruler, options).get(heir) ?? [];
	// A name that runs through a rumoured link, or that the tree only rumours ("rumoured half-brother"), is not a fact; the next sure name is.
	const word = names.find((n) => n.kind === 'blood' && !n.maybe && !n.lower.startsWith('rumoured') && !n.line.links.some((l) => l.type === 'rumoured'));
	return word ? { kind: 'no-child', ruler, heir, relation: word.lower } : neutral;
}

/** True when `id` has an ancestor in common with R: the walk can then reach `id` from R's family by another way. */
function related(c: Ctx, id: string): boolean {
	if (c.above.has(id)) return true;
	for (const x of reach(id, (y) => c.ups(y).filter((d) => claimable(d.type)).map((d) => d.id))) if (c.above.has(x)) return true;
	return false;
}

/** The one way down from R to the first heir (R's child first, the parent of the first heir last), or null for several ways or one the line can also reach from elsewhere. */
function wayDown(c: Ctx): Person[] | null {
	// With several passes or "Oldest generation first", another way into the family can change the pass or the generation, so it must not exist.
	const strict = c.passes.length > 1 || c.rule === 'siblings-first';
	const chain: Person[] = [];
	for (let cur = c.heir; ; ) {
		const mine: string[] = [...new Set(c.ups(cur.id).filter((d) => claimable(d.type) && (d.id === c.ruler.id || c.below.has(d.id))).map((d) => d.id))];
		if (mine.length !== 1) return null;
		if (strict && c.ups(cur.id).some((d) => claimable(d.type) && d.id !== mine[0] && related(c, d.id))) return null;
		if (mine[0] === c.ruler.id) return chain;
		cur = c.g.byId.get(mine[0])!;
		chain.unshift(cur);
	}
}

const byInherit = (c: Ctx): FirstHeirReason => ({ kind: 'inherit', heir: c.heir.id, inherit: c.spec.inherit });

/** The first heir is in R's line, below a child of R. */
function inLineReason(c: Ctx): FirstHeirReason | null {
	const chain = wayDown(c);
	if (!chain || chain.some((p) => c.blocked.has(p.id))) return null;
	// The first pass in which the line reaches the first heir through this way.
	const path = [c.ruler, ...chain, c.heir];
	const linked = (x: Person, parent: string, at: Pass) => c.ups(x.id).some((d) => d.id === parent && carries(d.type, x, at));
	const at = c.passes.find((p) => eligible(c.heir, p) && path.every((x, i) => i === 0 || linked(x, path[i - 1].id, p)) && chain.every((x) => passesOn(x, p)));
	if (!at) return null;
	const via = chain[0];
	if (chain.length === 1 && c.dead(via) && eligible(via, at)) return { kind: 'dead-child', via: via.id, ruler: c.ruler.id };
	const skipped = chain.filter((x) => !eligible(x, at));
	if (skipped.length) {
		// Only a person of the sex that the rule puts behind counts; a person with no sex has its own note. With "Only descendants of the first holder" one pass
		// of several can have no line, so the pass that skipped the person is not sure.
		const behind = favoured(c.spec.inherit) === 'm' ? 'f' : 'm';
		// The sex rule is the cause only when it put a living person behind; a dead person on the way is passed over anyway.
		return skipped.every((x) => x.sex === behind) && skipped.some((x) => c.alive(x)) && !(c.spec.body && c.passes.length > 1) ? byInherit(c) : null;
	}
	// A living person on the way who is not in the line: some other cause, so no reason.
	if (chain.some((x) => c.alive(x))) return null;
	return { kind: 'rule', heir: c.heir.id, rule: c.rule };
}

/** The number of generations from R down to the nearest living person of R's line who could stand in the pass `at`, or undefined. */
function nearestBelow(c: Ctx, at: Pass): number | undefined {
	const seen = new Set<string>([c.ruler.id]);
	let level = [c.ruler.id];
	for (let depth = 1; level.length; depth++) {
		const next: string[] = [];
		for (const u of level) {
			for (const { child, type } of c.kidsOf.get(u) ?? []) {
				if (seen.has(child.id) || !carries(type, child, at)) continue;
				seen.add(child.id);
				if (c.alive(child) && eligible(child, at) && !c.blocked.has(child.id)) return depth;
				if (passesOn(child, at)) next.push(child.id);
			}
		}
		level = next;
	}
	return undefined;
}

/** The first heir is not in R's line; `kids` are R's children over any link. */
function outsideReason(c: Ctx, kids: readonly Person[]): FirstHeirReason | null {
	const neutral: FirstHeirReason = { kind: 'rule', heir: c.heir.id, rule: c.rule };
	const first = c.passes[0];
	const anyNeeds = c.spec.inheritThrough === undefined ? undefined : first.needs;
	const sexRule = favoured(c.spec.inherit);
	const order = c.rule === 'siblings-first' ? 'lateral' : c.rule === 'nearest-relative' ? 'nearest' : 'walk';
	const free = nearestBelow(c, { ill: first.ill, adopt: c.spec.adopted, needs: anyNeeds });
	if (free !== undefined) {
		// Someone of R's line could inherit. If the first pass has such a person too, the order rule put the first heir in front.
		const inFirst = nearestBelow(c, first) !== undefined;
		if (order !== 'walk' && inFirst) return neutral;
		if (inFirst || sexRule === undefined) return null;
		// Else the sex rule left that person out. "Eldest child first" walks R's line first; with "Nearest relative first" a child or grandchild comes before everyone else.
		return order === 'walk' || (order === 'nearest' && free <= 2) ? byInherit(c) : null;
	}
	const bars = barsOf(c, kids);
	// The order rule is the cause only when nobody of R's line could inherit, whatever the box "Illegitimate" and the adoptions; else the cause is not sure.
	if (bars.length === 0) return nearestBelow(c, { ill: true, adopt: true, needs: anyNeeds }) === undefined ? neutral : null;
	// Several such children, two causes, or a rule where the child would not come first anyway: no sure reason.
	if (bars.length > 1 || order === 'lateral') return null;
	const { child, bar } = bars[0];
	if (bar === 'both' || (sexRule !== undefined && child.sex !== sexRule)) return null;
	// With "Only descendants of the first holder" one pass of several can have no line; then the child need not come first.
	if (c.spec.body && c.passes.length > 1) return null;
	return { kind: 'barred', child: child.id, heir: c.heir.id, bar };
}

/** The living children of R whom only the box "Illegitimate" or an adoption keeps out; a rumoured or ward child never inherits and is not here. */
function barsOf(c: Ctx, kids: readonly Person[]): { child: Person; bar: FirstHeirBar | 'both' }[] {
	const out: { child: Person; bar: FirstHeirBar | 'both' }[] = [];
	for (const child of kids) {
		if (!c.alive(child)) continue;
		const types = c.ups(child.id).filter((d) => d.id === c.ruler.id).map((d) => d.type);
		const ill = types.includes('birth') && child.illegitimate && c.spec.illegitimate !== 'equal';
		const adopted = types.includes('adoptive') && !c.spec.adopted;
		if (ill && adopted) out.push({ child, bar: 'both' });
		else if (ill) out.push({ child, bar: c.spec.illegitimate === 'after' ? 'illegitimate-after' : 'illegitimate' });
		else if (adopted) out.push({ child, bar: 'adopted' });
	}
	return out;
}
