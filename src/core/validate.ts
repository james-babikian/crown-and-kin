/*
 * Checks the references and values of a parsed `Tree` and returns only the parts that are safe to
 * draw, together with every problem found (spec §8, §4.1). `derive.ts` calls `validateTree` before
 * building the family graph; anything that needs the derived families (for example a `union` that
 * does not name a union of the person's own parents) is checked there instead. From 0.2.8 it also checks the parent limits
 * (`PARENT_LIMIT`, with the setting that stops the warning for 2 parents of a type), the near-typos of type words, and the
 * `through-spouse` key of a holder.
 */

import { nameMismatches, PLAIN_READER, type DateReader, type ReadDate, type TreeDates } from './dates';
import { codedIssue, type CodedIssue, type IssueCode, type IssueParams } from './messages';
import { readPortraitCrop } from './portrait-crop';
import { DOUBTFUL_DIED, isDead, readInherit, readRule, resolveSpouse, type SpouseWorld } from './succession-keys';
import { isParentType, isPlacementType, isUnionType, PARENT_LIMIT, parentKind, PARENT_TYPES, PLACEMENT_TYPES, UNION_TYPES, type Holder, type House, type ParentRef, type ParentType, type Person, type Title, type Tree, type Union } from './types';

/** What the caller can switch in validation. Absent fields mean the default. */
export interface ValidateOptions {
	/** The setting "Warn about more than 2 parents of a type" (0.2.8 A.5). Off stops `too-many-parents` for birth, adoptive and ward parents; the limit for rumoured parents stays. Default: on. */
	warnManyParents?: boolean;
	/** Spec §14: the date reader of the tree (calendars). Absent: plain years. Validation reads the dates of a title with a rule or a named heir through it and turns its problems into issues; `deriveFamilies` puts it in `FamilyGraph.dates`. */
	dates?: DateReader;
}

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

/** The Levenshtein distance of two short words. */
function editDistance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
		prev = row;
	}
	return prev[b.length];
}

/** I13: the known word within edit distance 2 of `value` (case ignored, the nearest first), or undefined. */
function nearWord(value: string, words: readonly string[]): string | undefined {
	const v = value.trim().toLowerCase();
	// A long text is a sentence, not a typo; the length test also keeps the cost small.
	if (v === '' || v.length > 40) return undefined;
	let best: string | undefined;
	let bestDistance = 3;
	for (const w of words) {
		const d = editDistance(v, w);
		if (d < bestDistance) [best, bestDistance] = [w, d];
	}
	return best;
}

/** D205: common words for a parent type. They are no type (the link is read as birth and the warning shows), but the warning suggests the type. */
const PARENT_TYPE_WORDS: Readonly<Record<string, ParentType>> = Object.assign(Object.create(null) as Record<string, ParentType>, {
	adopted: 'adoptive',
	foster: 'ward',
	guardian: 'ward',
	natural: 'birth',
	biological: 'birth',
	alleged: 'rumoured',
	putative: 'rumoured',
});

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

/** The options that name a person who is not in the tree: `start`, `focus` and `me`. */
function optionWarnings(options: Tree['options'], byId: Map<string, Person>, out: Collector) {
	const refs = [['missing-start', options.start], ['missing-focus', options.focus], ['missing-me', options.me]] as const;
	for (const [code, ref] of refs) {
		if (ref !== undefined && !byId.has(ref)) out.warn(code, { ref });
	}
}

/**
 * Checks references and values, and returns only what is safe to draw. Everything that needs
 * the derived families (primary unions) is checked in `derive.ts`.
 */
export function validateTree(tree: Tree, options: ValidateOptions = {}): Validated {
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

	optionWarnings(tree.options, byId, out);

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
			} else {
				const suggestion = PARENT_TYPE_WORDS[r.type.trim().toLowerCase()] ?? nearWord(r.type, PARENT_TYPES);
				out.warn('unknown-parent-type', { ...who, value: r.type, parent: name(r.id), ...(suggestion ? { suggestion } : {}) }, [p.id, r.id]);
			}
		});
		refs.set(p.id, valid);

		const byType = new Map<string, number>();
		for (const r of valid) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
		// B.3, A.5: the limit of each type; the setting stops the warning for birth, adoptive and ward parents only.
		for (const [type, count] of byType) {
			const limit = PARENT_LIMIT[type as ParentType];
			if (count > limit && (type === 'rumoured' || options.warnManyParents !== false)) out.warn('too-many-parents', { ...who, type, count, limit }, [p.id]);
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
		// I13: any word is a partnership type and is drawn as a marriage; only a near-typo of a known type warns.
		if (!isUnionType(u.type)) {
			const suggestion = nearWord(u.type, UNION_TYPES);
			if (suggestion) out.warn('unknown-union-type', { ...label, value: u.type, suggestion }, known);
		}
		unions.push(u);
	}

	breakCycles(people, refs, byId, out);
	const titles = validateTitles(tree.titles ?? [], people, byId, refs, unions, out, options.dates);
	calendarProblems(options.dates, out, people);

	return { people, byId, houses, unions, refs, unionIds, titles, issues: out.issues };
}

/** Spec §13.3, §13.4 rules for titles, holders and `card-title` (the first title with an id wins). */
function validateTitles(written: readonly Title[], people: Person[], byId: Map<string, Person>, refs: Map<string, ParentRef[]>, unions: readonly Union[], out: Collector, reader: DateReader = PLAIN_READER): Title[] {
	let world: SpouseWorld | undefined;
	const needing: { t: Title; holders: Holder[] }[] = [];
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
		successionWarnings(t, byId, out, reader);
		if (reader.hasLists) {
			nameMismatchWarnings(reader, t.year, 'year', t.name, out);
			for (const h of holders) {
				nameMismatchWarnings(reader, h.from, 'reign', t.name, out);
				nameMismatchWarnings(reader, h.to, 'reign', t.name, out);
			}
		}
		if (reader.ready && needsYear(t)) {
			titleDateWarnings(t, holders, reader, out);
			needing.push({ t, holders });
		}
		if ((t.succession !== undefined || t.heirs !== undefined) && holders.some((h) => h.throughSpouse !== undefined && h.person !== undefined && byId.has(h.person))) {
			throughSpouseWarnings(t, holders, byId, (world ??= spouseWorld(people, byId, refs, unions)), out);
		}
		const title = { ...t, holders };
		byTitleId.set(t.id, title);
		titles.push(title);
	}
	if (needing.length) personDateWarnings(needing, people, byId, refs, reader, out);
	for (const p of people) {
		if (p.cardTitle === undefined) continue;
		if (!byTitleId.get(p.cardTitle)?.holders.some((h) => h.person === p.id)) out.warn('card-title-not-held', { person: p.name, ref: p.cardTitle }, [p.id]);
	}
	return titles;
}

/** Contract 0.2.7 A.5, K.3, K.4: the warnings about the succession keys of one title (the first title with its id). */
function successionWarnings(t: Title, byId: Map<string, Person>, out: Collector, reader: DateReader) {
	const bad = t.badKeys ?? {};
	const at = (code: IssueCode, value: string, key: 'value' | 'ref' = 'value') => out.warn(code, { title: t.name, [key]: value });
	const rule = bad.succession ?? (t.succession !== undefined && readRule(t.succession) === undefined ? t.succession : undefined);
	if (rule !== undefined) at('unknown-succession', rule);
	const inherit = bad.inherit ?? (t.inherit !== undefined && readInherit(t.inherit) === undefined ? t.inherit : undefined);
	if (inherit !== undefined) at('unknown-inherit', inherit);
	if (bad['inherit-through'] !== undefined) at('unknown-inherit-through', bad['inherit-through']);
	if (bad['inherit-illegitimate'] !== undefined) at('unknown-inherit-illegitimate', bad['inherit-illegitimate']);
	// Before the calendars are ready a calendar date reads as plain text and has no year, which is not the user's fault (spec §14 rule 7).
	const year = bad.year ?? (reader.ready && t.year !== undefined && reader.read(t.year)?.year === undefined ? t.year : undefined);
	// A date that fits two calendars has its own warning, so it gets no second one (ruling 4.2 fix 2).
	if (year !== undefined && needsYear(t) && !reader.read(year)?.warnings.includes('fits-two-calendars')) at('year-unreadable', year);
	const missing = (ids: readonly string[] | undefined, text: string | undefined, code: IssueCode) => {
		for (const id of new Set((ids ?? []).filter((x) => !byId.has(x)))) at(code, id, 'ref');
		if (text !== undefined) at(code, text, 'ref');
	};
	missing(t.heirs, bad.heir, 'missing-heir');
	missing(t.exclude, bad.exclude, 'missing-excluded');
}

/** Spec §13.21 rule 9, §14 rule 5: a title with a rule of succession or a named heir needs the year, so only its dates give warnings and notes. */
const needsYear = (t: Title): boolean => t.succession !== undefined || t.heirs !== undefined;

/** The children of each person, from the cleaned parent links (a ward link is no descent). */
function childMap(people: readonly Person[], refs: Map<string, ParentRef[]>): Map<string, string[]> {
	const kids = new Map<string, string[]>();
	for (const p of people) for (const r of refs.get(p.id) ?? []) if (r.type !== 'ward') push(kids, r.id, p.id);
	return kids;
}

/** The people a line can read dates of, found without the line: the seeds and everyone who descends from them. */
function descendants(seeds: readonly string[], people: readonly Person[], byId: Map<string, Person>, kids: Map<string, string[]>): Person[] {
	const seen = new Set<string>();
	const stack = seeds.filter((id) => byId.has(id));
	while (stack.length) {
		const id = stack.pop()!;
		if (seen.has(id)) continue;
		seen.add(id);
		stack.push(...(kids.get(id) ?? []));
	}
	return people.filter((p) => seen.has(p.id));
}

/** The seeds and all their ancestors by the cleaned parent links (a ward link is no descent). */
function withAncestors(seeds: readonly string[], byId: Map<string, Person>, refs: Map<string, ParentRef[]>): string[] {
	const seen = new Set<string>();
	const stack = seeds.filter((id) => byId.has(id));
	while (stack.length) {
		const id = stack.pop()!;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const r of refs.get(id) ?? []) if (r.type !== 'ward') stack.push(r.id);
	}
	return [...seen];
}

/** The names of the calendars that a date fits, for `fits-two-calendars`. */
const calendarsOf = (r: ReadDate): string[] => [...(r.calendar !== undefined ? [r.calendar] : []), ...(r.also ?? [])];

/** The warnings of one date text, as issues. `owner` is the person whose date it is, or the name of the title that the date belongs to. */
function warnDate(reader: DateReader, text: string | undefined, where: 'year' | 'reign' | 'born' | 'died', owner: Person | string, out: Collector, seen?: Set<string>) {
	const r = text === undefined ? undefined : reader.read(text);
	for (const w of r?.warnings ?? []) {
		// The wrong name has its own path: it shows for every title, not only for a title that needs the year (spec §14 rule 14).
		if (w === 'calendar-name-mismatch') continue;
		const key = `${w}|${where}|${text}`;
		if (seen?.has(key)) continue;
		seen?.add(key);
		const base: IssueParams = typeof owner === 'string' ? { where, value: text!, title: owner } : { where, value: text!, person: owner.name };
		out.warn(w, w === 'fits-two-calendars' ? { ...base, calendars: calendarsOf(r!) } : base, typeof owner === 'string' ? undefined : [owner.id]);
	}
}

/** Spec §14 rule 14: `calendar-name-mismatch` for one date text, once for each list with a wrong written name. */
function nameMismatchWarnings(reader: DateReader, text: string | undefined, where: 'year' | 'reign' | 'born' | 'died', owner: Person | string, out: Collector) {
	if (text === undefined) return;
	for (const m of nameMismatches(reader.read(text))) {
		const base: IssueParams = typeof owner === 'string' ? { where, value: text, title: owner } : { where, value: text, person: owner.name };
		out.warn('calendar-name-mismatch', { ...base, list: m.list, expected: m.expected, written: m.written }, typeof owner === 'string' ? undefined : [owner.id]);
	}
}

/** Spec §14 rule 5: the warnings of the dates that belong to a title that needs the year: the title `year` and every holder `from` and `to`. One warning for each text and place. */
function titleDateWarnings(t: Title, holders: readonly Holder[], reader: DateReader, out: Collector) {
	const seen = new Set<string>();
	warnDate(reader, t.year, 'year', t.name, out, seen);
	for (const h of holders) {
		warnDate(reader, h.from, 'reign', t.name, out, seen);
		warnDate(reader, h.to, 'reign', t.name, out, seen);
	}
}

/**
 * Spec §14 rule 5: the warnings of the `born` and `died` of every person that a line can read, for all titles that need the year
 * together (ruling 4.2 fix 1): the holders and the named heirs, their ancestors and all descendants of those ancestors. This is done
 * once for the tree, so a date gives one warning, not one for each title.
 */
function personDateWarnings(needing: readonly { t: Title; holders: readonly Holder[] }[], people: readonly Person[], byId: Map<string, Person>, refs: Map<string, ParentRef[]>, reader: DateReader, out: Collector) {
	const seeds = needing.flatMap(({ t, holders }) => [...(t.heirs ?? []), ...holders.flatMap((h) => (h.person !== undefined ? [h.person] : []))]);
	const kids = childMap(people, refs);
	for (const p of descendants(withAncestors(seeds, byId, refs), people, byId, kids)) {
		warnDate(reader, p.born, 'born', p, out);
		warnDate(reader, p.died, 'died', p, out);
	}
}

/**
 * The problems of the calendar set (a missing calendar note) as tree warnings, once the calendars are ready (spec §14 rules 3 and 7).
 * Spec §14 rule 14: a wrong written name shows for every person, and only a reader with lists reads the born and died dates for it.
 */
function calendarProblems(reader: DateReader | undefined, out: Collector, people: readonly Person[]) {
	if (!reader?.ready) return;
	for (const p of reader.problems) {
		out.warn(p.key, { note: p.note ?? '' });
	}
	if (!reader.hasLists) return;
	for (const p of people) {
		nameMismatchWarnings(reader, p.born, 'born', p, out);
		nameMismatchWarnings(reader, p.died, 'died', p, out);
	}
}

/**
 * `calendar-no-anchor` for the tree (spec §14 rule 5): a calendar that starts at year 1 beside plain years or another calendar, once for each
 * calendar, and only when some title needs the year. `deriveFamilies` calls it after it built the dates view.
 */
export function anchorIssues(titles: readonly Title[], dates: TreeDates): CodedIssue[] {
	// A reader with no calendar has no calendar that starts at year 1, so there is nothing to read ('plain' is the exact key of such a reader).
	if (!dates.ready || dates.reader.key === 'plain' || !titles.some(needsYear)) return [];
	return dates.unanchored().map((calendar) => codedIssue('calendar-no-anchor', 'warning', { calendar }));
}

/**
 * The partners and claim parents of the tree as `derive.ts` makes them: a listed union is a partnership of its type, and two
 * placement parents of one child (the first two of the placement type) are partners in an implicit union. The same facts
 * reach `succession.ts` through the family graph, so the warning and the line agree.
 */
function spouseWorld(people: Person[], byId: Map<string, Person>, refs: Map<string, ParentRef[]>, unions: readonly Union[]): SpouseWorld {
	const partners = new Map<string, { id: string; type: string }[]>();
	const add = (a: string, b: string, type: string) => {
		push(partners, a, { id: b, type });
		push(partners, b, { id: a, type });
	};
	const pair = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a]);
	const listed = new Set<string>();
	for (const u of unions) {
		add(u.partners[0], u.partners[1], u.type);
		listed.add(pair(u.partners[0], u.partners[1]));
	}
	const implicit = new Set<string>();
	const claimParents = new Map<string, string[]>();
	for (const p of people) {
		const byType = new Map<string, string[]>();
		for (const r of refs.get(p.id)!) push(byType, r.type, r.id);
		let type: string | undefined = PLACEMENT_TYPES.find((t) => byType.has(t));
		if (p.placement !== undefined && isPlacementType(p.placement) && byType.has(p.placement)) type = p.placement;
		const placed = type ? byType.get(type)!.slice(0, 2) : [];
		if (placed.length === 2) {
			const key = pair(placed[0], placed[1]);
			if (!listed.has(key) && !implicit.has(key)) {
				implicit.add(key);
				add(placed[0], placed[1], 'implicit');
			}
		}
		const up = [...new Set([...(byType.get('birth') ?? []), ...(byType.get('adoptive') ?? [])])];
		if (up.length) claimParents.set(p.id, up);
	}
	return { partners: (id) => partners.get(id) ?? [], claimParents: (id) => claimParents.get(id) ?? [], exists: (id) => byId.has(id) };
}

/** 0.2.8 contract A.2, D195: the warnings about the `through-spouse` keys of one title. Each warns once for a person and a value; the key is then ignored. */
function throughSpouseWarnings(t: Title, holders: readonly Holder[], byId: Map<string, Person>, world: SpouseWorld, out: Collector) {
	const inTree = holders.flatMap((h) => (h.person !== undefined && byId.has(h.person) ? [h.person] : []));
	const seen = new Set<string>();
	for (const h of holders) {
		if (h.throughSpouse === undefined || h.person === undefined || !byId.has(h.person)) continue;
		const id = h.person;
		const key = `${id}\0${h.throughSpouse === true ? '' : h.throughSpouse}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const result = resolveSpouse(world, id, h.throughSpouse, inTree);
		if (result.ok) continue;
		const base = { person: byId.get(id)!.name, title: t.name };
		const names = (ids: readonly string[]) => ids.map((x) => byId.get(x)!.name);
		switch (result.why) {
			case 'no-partner':
			case 'no-marriage':
			case 'self':
				out.warn(`through-spouse-${result.why}`, base, [id]);
				break;
			case 'no-claim':
			case 'several-claims':
				out.warn(`through-spouse-${result.why}`, { ...base, count: result.candidates.length, partners: names(result.candidates), example: result.candidates[0] }, [id, ...result.candidates]);
				break;
			case 'not-partner':
				out.warn('through-spouse-not-partner', { ...base, ref: result.ref, other: byId.get(result.ref)!.name }, [id, result.ref]);
				break;
			case 'unknown-person':
				out.warn('through-spouse-unknown-person', { ...base, ref: result.ref }, [id]);
				break;
		}
	}
}
