import { deriveFamilies, partnerOf, type FamilyGraph } from './derive';
import { parentKind, writtenParents } from './family-query';
import { DEFAULT_FOCUS_GENERATIONS, type FocusGenerationsFor, type FocusSubgraph } from './focus';
import type { Tree } from './types';

/*
 * Focus mode (spec §5.6, D3, D18). Who is in the family follows parent links as written, as the
 * family queries read them. What is drawn follows the derived graph of the whole tree: partners,
 * placement parents and drawn links, so a focus view never draws a person under other parents
 * than the whole tree does, and never draws a link the whole tree dropped to break a cycle.
 */

interface Relatives {
	parents: Map<string, string[]>;
	children: Map<string, string[]>;
	/** Listed and implicit: every partner the whole tree draws. */
	partners: Map<string, string[]>;
	/** Listed unions only (drawable ones). */
	listed: Map<string, string[]>;
}

const none: readonly string[] = [];
const of = (m: Map<string, string[]>, id: string): readonly string[] => m.get(id) ?? none;

function relatives(g: FamilyGraph): Relatives {
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	const partners = new Map<string, string[]>();
	const listed = new Map<string, string[]>();
	for (const p of g.people) {
		const ids = [...new Set(writtenParents(g, p.id).map((r) => r.id))];
		parents.set(p.id, ids);
		for (const id of ids) {
			const list = children.get(id);
			if (list) list.push(p.id);
			else children.set(id, [p.id]);
		}
		const unions = (g.unionsOf.get(p.id) ?? []).map((k) => g.unionByKey.get(k)!);
		if (!unions.length) continue;
		partners.set(p.id, [...new Set(unions.map((u) => partnerOf(u, p.id)))]);
		listed.set(p.id, [...new Set(unions.filter((u) => !u.implicit).map((u) => partnerOf(u, p.id)))]);
	}
	return { parents, children, partners, listed };
}

const linkKey = (parent: string, type: string) => `${parent}\0${type}`;

interface Drawn {
	/** Child → `linkKey`s of the parent links the whole tree draws. */
	links: Map<string, Set<string>>;
	/** Child → the parents of those links. */
	parents: Map<string, Set<string>>;
}

/** The parent links the whole tree draws, after cycle breaking: placement links and side links. */
function drawnLinks(g: FamilyGraph): Drawn {
	const links = new Map<string, Set<string>>();
	const parents = new Map<string, Set<string>>();
	const add = (child: string, parent: string, type: string) => {
		(links.get(child) ?? links.set(child, new Set()).get(child)!).add(linkKey(parent, type));
		(parents.get(child) ?? parents.set(child, new Set()).get(child)!).add(parent);
	};
	for (const [child, placed] of g.placementParents) {
		const type = g.placementType.get(child);
		if (type) for (const q of placed) add(child, q, type);
	}
	for (const e of g.secondary) for (const q of e.parents) add(e.child, q, e.type);
	return { links, parents };
}

/** Everyone within `n` steps of `from` in one direction, nearest distance first. Iterative. */
function within(next: Map<string, string[]>, from: string, n: number, into: Set<string>) {
	const seen = new Set<string>([from]);
	let frontier = [from];
	for (let step = 0; step < n && frontier.length; step++) {
		const found: string[] = [];
		for (const id of frontier) {
			for (const q of of(next, id)) {
				if (seen.has(q)) continue;
				seen.add(q);
				found.push(q);
			}
		}
		frontier = found;
	}
	for (const id of seen) into.add(id);
}

const isGenerations = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** A non-integer or negative `n` counts as the default (contract). */
export const focusGenerations = (n: number) => (isGenerations(n) ? n : DEFAULT_FOCUS_GENERATIONS);

export const focusGenerationsFor: FocusGenerationsFor = (options, setting) => {
	// `options` is typed, but a view may pass what it read before the tree parsed.
	const own: unknown = options?.generations;
	if (isGenerations(own)) return own;
	return isGenerations(setting) ? setting : DEFAULT_FOCUS_GENERATIONS;
};

export const focusSubgraph: FocusSubgraph = (tree, focus, n) => {
	const g = deriveFamilies(tree);
	if (!g.byId.has(focus)) return null;
	const steps = focusGenerations(n);
	const rel = relatives(g);

	const core = new Set<string>([focus]);
	within(rel.parents, focus, steps, core);
	within(rel.children, focus, steps, core);
	for (const parent of of(rel.parents, focus)) for (const sibling of of(rel.children, parent)) core.add(sibling);

	const family = new Set(core);
	for (const id of core) for (const partner of of(rel.listed, id)) family.add(partner);
	// One pass against the family as it stands before the pass, so the order of people cannot
	// change the result. A shown child brings its whole placement couple; implicit co-parents
	// come in only this way.
	const shownChildren = [...core].filter((id) => of(rel.parents, id).some((q) => family.has(q)));
	for (const id of shownChildren) for (const q of g.placementParents.get(id) ?? none) family.add(q);

	// One rule for everybody: placed exactly as in the whole tree, or placed under nobody.
	const drawn = drawnLinks(g);
	const kept = new Map<string, Set<string>>();
	const people: Tree['people'] = [];
	for (const p of g.people) {
		if (!family.has(p.id)) continue;
		const own = drawn.links.get(p.id);
		const placed = (g.placementParents.get(p.id) ?? none).every((q) => family.has(q));
		const parents = placed && own ? p.parents.filter((r) => family.has(r.id) && own.has(linkKey(r.id, parentKind(r.type)))) : [];
		kept.set(p.id, new Set(parents.map((r) => r.id)));
		people.push({ ...p, parents });
	}

	// A parent or child counts when the whole tree draws the link and the subgraph does not: the
	// relative is outside, or the rule above dropped the link. A link the whole tree does not draw
	// (cycle breaking) is nothing a wider view could show, so it never counts.
	const isDrawn = (child: string, parent: string) => drawn.parents.get(child)?.has(parent) ?? false;
	const lost = (child: string, parent: string) => isDrawn(child, parent) && !(family.has(child) && family.has(parent) && kept.get(child)!.has(parent));
	const hidden = new Map<string, number>();
	for (const p of people) {
		const missing = new Set<string>();
		for (const q of of(rel.parents, p.id)) if (lost(p.id, q)) missing.add(q);
		for (const c of of(rel.children, p.id)) if (lost(c, p.id)) missing.add(c);
		for (const q of of(rel.partners, p.id)) if (!family.has(q)) missing.add(q);
		if (missing.size) hidden.set(p.id, missing.size);
	}

	const sub: Tree = {
		options: { ...tree.options, start: focus },
		houses: tree.houses,
		people,
		unions: tree.unions.filter((u) => u.partners.every((id) => family.has(id))),
		issues: [],
	};
	return { tree: sub, hidden };
};
