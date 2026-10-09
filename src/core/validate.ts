/*
 * Checks the references and values of a parsed `Tree` and returns only the parts that are safe to
 * draw, together with every problem found (spec §8, §4.1). `derive.ts` calls `validateTree` before
 * building the family graph; anything that needs the derived families (for example a `union` that
 * does not name a union of the person's own parents) is checked there instead.
 */

import { codedIssue, type CodedIssue, type IssueCode, type IssueParams } from './messages';
import { readPortraitCrop } from './portrait-crop';
import { DOUBTFUL_DIED, isDead, readInherit, readRule, yearOf } from './succession-keys';
import { isParentType, isPlacementType, isUnionType, parentKind, type Holder, type House, type ParentRef, type ParentType, type Person, type Title, type Tree, type Union } from './types';

/** The parts of a tree that are safe to draw, and every problem found on the way (spec §8, §4.1). */
export interface Validated {
	/** Unique people in document order. The first entry with an id wins. */
	people: Person[];
	byId: Map<string, Person>;
	/** The first house with an id wins. */
	houses: Map<string, House>;
	/** Listed unions with exactly 2 different partners who both exist, in list order. */
	unions: Union[];
	/**
	 * Parent links per person that point at someone else who exists, with unknown types read as
	 * birth, duplicates removed, and the links that close a cycle dropped.
	 */
	refs: Map<string, ParentRef[]>;
	/** Every union id written, drawable or not; tells a missing `union` from a misplaced one. */
	unionIds: Set<string>;
	/**
	 * Spec §13.4: the first title with each id, in list order, with the holders that can show: a
	 * holder whose `person` names nobody stays only if it has a `name`. `[]` with no titles.
	 */
	titles: Title[];
	issues: CodedIssue[];
}

/** Adds `value` to the list under `key`, creating the list if needed. */
export function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const arr = map.get(key);
	if (arr) arr.push(value);
	else map.set(key, [value]);
}

/**
 * A person's parent links that name someone else who exists, unknown types read as birth, once per
 * id and type, in written order. `report` hears each entry that is left out or read as birth.
 */
export function cleanParents(
	owner: string,
	parents: readonly ParentRef[],
	exists: (id: string) => boolean,
	report?: (why: 'self' | 'missing' | 'unknown-type', ref: ParentRef) => void,
): { id: string; type: ParentType }[] {
	const out: { id: string; type: ParentType }[] = [];
	const seen = new Set<string>();
	for (const r of parents) {
		if (r.id === owner) {
			report?.('self', r);
			continue;
		}
		if (!exists(r.id)) {
			report?.('missing', r);
			continue;
		}
		if (!isParentType(r.type)) report?.('unknown-type', r);
		const type = parentKind(r.type);
		const key = `${r.id}\0${type}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ id: r.id, type });
	}
	return out;
}

/** J.4: the lower case texts of `sex` that mean a man or a woman but are not `m` or `f` (`M` and `F` are caught as not equal to `m` and `f`). */
const SEX_SPELLINGS: ReadonlySet<string> = new Set(['m', 'f', 'male', 'man', 'female', 'woman', 'm.', 'f.']);

class Collector {
	readonly issues: CodedIssue[] = [];

	blocking(code: IssueCode, params: IssueParams, ids?: string[]) {
		this.issues.push(codedIssue(code, 'blocking', params, ids));
	}

	warn(code: IssueCode, params: IssueParams, ids?: string[]) {
		this.issues.push(codedIssue(code, 'warning', params, ids));
	}
}

/**
 * Removes parent links that would make someone their own ancestor. Walks people in document
 * order so the result is deterministic; the link that closes each cycle is the one dropped.
 * Iterative, so a very long line of descent cannot overflow the stack.
 */
function breakCycles(people: Person[], refs: Map<string, ParentRef[]>, byId: Map<string, Person>, out: Collector) {
	const childrenOf = new Map<string, string[]>();
	for (const p of people) for (const r of refs.get(p.id)!) push(childrenOf, r.id, p.id);

	const state = new Map<string, 1 | 2>(); // 1 = on the path, 2 = done
	const dropped = new Set<string>(); // "parent\0child"
	const name = (id: string) => byId.get(id)!.name;

	for (const root of people) {
		if (state.has(root.id)) continue;
		const path: string[] = [root.id];
		const next: number[] = [0];
		state.set(root.id, 1);
		while (path.length) {
			const id = path[path.length - 1];
			const kids = childrenOf.get(id) ?? [];
			const i = next[next.length - 1]++;
			if (i >= kids.length) {
				state.set(id, 2);
				path.pop();
				next.pop();
				continue;
			}
			const child = kids[i];
			if (dropped.has(`${id}\0${child}`)) continue;
			const s = state.get(child);
			if (s === 1) {
				const loop = path.slice(path.indexOf(child));
				dropped.add(`${id}\0${child}`);
				out.warn('cycle', { people: loop.map(name), dropped: name(child), parent: name(id) }, loop);
			} else if (s === undefined) {
				state.set(child, 1);
				path.push(child);
				next.push(0);
			}
		}
	}

	if (dropped.size) {
		for (const p of people) refs.set(p.id, refs.get(p.id)!.filter((r) => !dropped.has(`${r.id}\0${p.id}`)));
	}
}

/**
 * Checks references and values, and returns only what is safe to draw. Everything that needs
 * the derived families (primary unions) is checked in `derive.ts`.
 */
export function validateTree(tree: Tree): Validated {
	const out = new Collector();

	// Duplicate ids. People and houses: the first wins. Unions: both are drawn; only editing is unsafe.
	const byId = new Map<string, Person>();
	const people: Person[] = [];
	const dupPeople = new Set<string>();
	for (const p of tree.people) {
		if (byId.has(p.id)) {
			if (!dupPeople.has(p.id)) out.blocking('duplicate-person-id', { id: p.id, name: byId.get(p.id)!.name }, [p.id]);
			dupPeople.add(p.id);
			continue;
		}
		byId.set(p.id, p);
		people.push(p);
	}
	const name = (id: string) => byId.get(id)?.name ?? id;

	const houses = new Map<string, House>();
	const dupHouses = new Set<string>();
	for (const h of tree.houses) {
		if (!houses.has(h.id)) {
			houses.set(h.id, h);
			continue;
		}
		if (!dupHouses.has(h.id)) out.warn('duplicate-house-id', { id: h.id, house: houses.get(h.id)!.name }, [h.id]);
		dupHouses.add(h.id);
	}

	const unionIds = new Set<string>();
	const unionsById = new Map<string, Union[]>();
	for (const u of tree.unions) {
		if (u.id === undefined) continue;
		unionIds.add(u.id);
		push(unionsById, u.id, u);
	}
	for (const [id, list] of unionsById) {
		if (list.length < 2) continue;
		const partners = [...new Set(list.flatMap((u) => u.partners).filter((x) => byId.has(x)))];
		out.blocking('duplicate-union-id', { id }, partners);
	}

	const optionRefs = [['missing-start', tree.options.start], ['missing-focus', tree.options.focus], ['missing-me', tree.options.me]] as const;
	for (const [code, ref] of optionRefs) {
		if (ref !== undefined && !byId.has(ref)) out.warn(code, { ref });
	}

	// People: values, then parent links.
	const refs = new Map<string, ParentRef[]>();
	for (const p of people) {
		const who = { person: p.name };
		if (p.house !== undefined && !houses.has(p.house)) out.warn('missing-house', { ...who, ref: p.house }, [p.id]);
		if (p.union !== undefined && !unionIds.has(p.union)) out.warn('missing-union', { ...who, ref: p.union }, [p.id]);

		const missing = new Set<string>();
		let self = false;
		const valid = cleanParents(p.id, p.parents, (id) => byId.has(id), (why, r) => {
			if (why === 'self') {
				if (!self) out.warn('self-parent', who, [p.id]);
				self = true;
			} else if (why === 'missing') {
				if (!missing.has(r.id)) out.warn('missing-parent', { ...who, ref: r.id }, [p.id]);
				missing.add(r.id);
			} else out.warn('unknown-parent-type', { ...who, value: r.type, parent: name(r.id) }, [p.id, r.id]);
		});
		refs.set(p.id, valid);

		const byType = new Map<string, number>();
		for (const r of valid) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
		for (const [type, count] of byType) {
			if (count > 2) out.warn('too-many-parents', { ...who, type, count }, [p.id]);
		}
		if (p.placement !== undefined) {
			if (!isPlacementType(p.placement)) out.warn('unknown-placement', { ...who, value: p.placement }, [p.id]);
			else if (!byType.has(p.placement)) out.warn('placement-without-parents', { ...who, placement: p.placement }, [p.id]);
		}
		// A crop with no portrait does nothing and gives no warning (spec §13.13).
		if (p.portrait !== undefined && readPortraitCrop(p.portraitCrop).kind === 'bad') out.warn('bad-portrait-crop', who, [p.id]);
		// J.4, J.7: a spelling of a value the plugin reads, and a doubt where a date should be. The values keep their meaning.
		if (p.sex !== undefined && p.sex !== 'm' && p.sex !== 'f' && SEX_SPELLINGS.has(p.sex.toLowerCase())) out.warn('sex-spelling', { ...who, value: p.sex }, [p.id]);
		if (p.died !== undefined && DOUBTFUL_DIED.includes(p.died.trim().toLowerCase())) out.warn('died-doubtful', { ...who, value: p.died }, [p.id]);
	}

	// M.6: `childless: true` on a dead person who has a birth child. The first child in written order is named.
	const birthChild = new Map<string, Person>();
	for (const p of people) {
		for (const r of refs.get(p.id)!) if (r.type === 'birth' && !birthChild.has(r.id)) birthChild.set(r.id, p);
	}
	for (const p of people) {
		const child = p.childless ? birthChild.get(p.id) : undefined;
		if (child && isDead(p)) out.warn('childless-has-child', { person: p.name, child: child.name }, [p.id]);
	}

	// Unions: one issue per union for its shape, then one per missing partner.
	const unions: Union[] = [];
	for (const u of tree.unions) {
		const label = { union: u.id ?? `#${u.index + 1}`, partners: u.partners.map(name) };
		const known = [...new Set(u.partners.filter((x) => byId.has(x)))];
		if (u.partners.length !== 2) {
			out.warn('union-partner-count', { ...label, count: u.partners.length }, known);
			continue;
		}
		const [a, b] = u.partners;
		if (a === b) {
			out.warn('union-same-partner', { ...label, person: name(a) }, known);
			continue;
		}
		const absent = u.partners.filter((x) => !byId.has(x));
		for (const ref of absent) out.warn('missing-partner', { ...label, ref, absent }, known);
		if (absent.length) continue;
		if (!isUnionType(u.type)) out.warn('unknown-union-type', { ...label, value: u.type }, known);
		unions.push(u);
	}

	breakCycles(people, refs, byId, out);
	const titles = validateTitles(tree.titles ?? [], people, byId, out);

	return { people, byId, houses, unions, refs, unionIds, titles, issues: out.issues };
}

/** Spec §13.3, §13.4 rules for titles, holders and `card-title` (the first title with an id wins). */
function validateTitles(written: readonly Title[], people: Person[], byId: Map<string, Person>, out: Collector): Title[] {
	const titles: Title[] = [];
	const byTitleId = new Map<string, Title>();
	const dup = new Set<string>();
	for (const t of written) {
		const first = byTitleId.get(t.id);
		if (first) {
			if (!dup.has(t.id)) out.warn('duplicate-title-id', { id: t.id, title: first.name });
			dup.add(t.id);
			continue;
		}
		const holders: Holder[] = [];
		for (const h of t.holders) {
			if (h.person !== undefined && !byId.has(h.person)) {
				out.warn('missing-holder', h.name !== undefined ? { title: t.name, ref: h.person, name: h.name } : { title: t.name, ref: h.person });
				if (h.name === undefined) continue;
			} else if (h.person === undefined && h.name === undefined) {
				out.warn('holder-empty', { title: t.name, index: h.index + 1 });
				continue;
			}
			holders.push(h);
		}
		successionWarnings(t, byId, out);
		const title = { ...t, holders };
		byTitleId.set(t.id, title);
		titles.push(title);
	}
	for (const p of people) {
		if (p.cardTitle === undefined) continue;
		if (!byTitleId.get(p.cardTitle)?.holders.some((h) => h.person === p.id)) out.warn('card-title-not-held', { person: p.name, ref: p.cardTitle }, [p.id]);
	}
	return titles;
}

/** Contract 0.2.7 A.5, K.3, K.4: the warnings about the succession keys of one title (the first title with its id). */
function successionWarnings(t: Title, byId: Map<string, Person>, out: Collector) {
	const bad = t.badKeys ?? {};
	const at = (code: IssueCode, value: string, key: 'value' | 'ref' = 'value') => out.warn(code, { title: t.name, [key]: value });
	const rule = bad.succession ?? (t.succession !== undefined && readRule(t.succession) === undefined ? t.succession : undefined);
	if (rule !== undefined) at('unknown-succession', rule);
	const inherit = bad.inherit ?? (t.inherit !== undefined && readInherit(t.inherit) === undefined ? t.inherit : undefined);
	if (inherit !== undefined) at('unknown-inherit', inherit);
	if (bad['inherit-through'] !== undefined) at('unknown-inherit-through', bad['inherit-through']);
	if (bad['inherit-illegitimate'] !== undefined) at('unknown-inherit-illegitimate', bad['inherit-illegitimate']);
	const year = bad.year ?? (t.year !== undefined && yearOf(t.year) === undefined ? t.year : undefined);
	if (year !== undefined && (t.succession !== undefined || t.heirs !== undefined)) at('year-unreadable', year);
	const missing = (ids: readonly string[] | undefined, text: string | undefined, code: IssueCode) => {
		for (const id of new Set((ids ?? []).filter((x) => !byId.has(x)))) at(code, id, 'ref');
		if (text !== undefined) at(code, text, 'ref');
	};
	missing(t.heirs, bad.heir, 'missing-heir');
	missing(t.exclude, bad.exclude, 'missing-excluded');
}
