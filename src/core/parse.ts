/*
 * Turns the YAML body of a `kin` block into a `Tree`: houses, titles, people and unions, plus
 * any shape issues found while reading (spec §4, §8, §13.4). `parseDynasty` is the entry point;
 * `tree-view.ts` and `houses-window.ts` call it. `parseBody` is shared with the edit code in
 * `yaml-patch.ts`, so both work from the same parsed document. Depends on `tolerate.ts` for
 * lenient reads of raw YAML values, among them the curly quote marks around structural values (D103). It also
 * reads the person key `arms` and the holder key `through-spouse`.
 */

import { isAlias, isMap as isYamlMap, isNode, isPair, isScalar, isSeq, Lexer, parseDocument, type Document } from 'yaml';
import { personIdSource } from './id-gen';
import { codedIssue, LIMIT_DETAIL, type CodedIssue, type HardError } from './messages';
import { cropValue } from './portrait-crop';
import { normaliseSobriquet } from './sobriquet';
import { readIllegitimate, readThrough } from './succession-keys';
import { blankPlainNulls, bool, int, isEmpty, isMap, linkValue, list, str, tolerateEmbeds, unwrapCurly, unwrapCurlyKeys, type Raw, type RawMap } from './tolerate';
import type { BadKey, Holder, House, ParentRef, ParseResult, Person, Title, Tree, TreeOptions, Union } from './types';

type Section = 'people' | 'houses' | 'unions' | 'titles';

/** D205: common words that the plugin reads as a known partnership type, with no warning. */
const UNION_WORDS: Readonly<Record<string, string>> = Object.assign(Object.create(null) as Record<string, string>, {
	// The four known types in any case ("Concubinage" must not draw as a marriage).
	marriage: 'marriage',
	betrothal: 'betrothal',
	concubinage: 'concubinage',
	affair: 'affair',
	engaged: 'betrothal',
	mistress: 'affair',
	lover: 'affair',
	liaison: 'affair',
	concubine: 'concubinage',
});

/**
 * The type of a partnership as every reader sees it (D205): one of the common words, in any case, is the known type; no type
 * is a marriage; any other text stays as written (validation warns about a near-typo, and the drawing shows a marriage).
 * The note keeps the words the user wrote.
 */
export function readUnionType(v: Raw): string {
	const text = str(v);
	if (text === undefined) return 'marriage';
	return UNION_WORDS[text.trim().toLowerCase()] ?? text;
}

/** The type of a parent link: one of the four known types in any case is that type; no type is birth; any other text stays (validation warns). */
function readParentType(v: Raw): string {
	const text = str(v);
	if (text === undefined) return 'birth';
	const word = text.trim().toLowerCase();
	return word === 'birth' || word === 'adoptive' || word === 'ward' || word === 'rumoured' ? word : text;
}

/** Holder keys read as text (spec §13.4); `person` and `name` are read first. */
const HOLDER_TEXT = ['as', 'number', 'from', 'to'] as const;

/**
 * The value of a holder's `through-spouse`. `true` or `yes` (any case) is `true`; `false` or `no` is off
 * (absent); any other text is the id of the spouse, with a curly pair of quote marks taken off. A list or a map is absent.
 */
export function readThroughSpouse(v: Raw): true | string | undefined {
	const text = str(v);
	if (text === undefined) return undefined;
	const word = text.toLowerCase();
	if (word === 'true' || word === 'yes') return true;
	if (word === 'false' || word === 'no') return undefined;
	return str(unwrapCurly(text));
}

/** Reads one block. Collects shape issues; reference and value checks happen in `validate.ts`. */
class Reader {
	readonly issues: CodedIssue[] = [];

	constructor(
		private readonly doc: Document,
		private readonly source: string,
	) {}

	warn(code: CodedIssue['code'], params: CodedIssue['params'], ids?: string[]) {
		this.issues.push(codedIssue(code, 'warning', params, ids));
	}

	/**
	 * Entries of a list section. The §8 "single string where a list was expected" tolerance is
	 * for lists of ids (`parents`, `partners`); a section of another shape is reported and not used.
	 */
	section(v: Raw, name: Section): Raw[] {
		if (isEmpty(v)) return [];
		if (Array.isArray(v)) return v;
		this.warn('section-wrong-shape', { section: name });
		return [];
	}

	options(v: Raw): TreeOptions {
		if (isEmpty(v)) return {};
		if (!isMap(v)) {
			this.warn('section-wrong-shape', { section: 'options' });
			return {};
		}
		// Spec §13.1: a list or a map is not one person id. A numeric id is text (§6.8).
		const me = str(v.me);
		if (me === undefined && !isEmpty(v.me)) this.warn('me-not-id', {});
		// Only when written, so a tree without a calendar note reads exactly as before (spec §14 rule 7).
		const calendar = linkValue(v.calendar, () => this.sourceText(['options', 'calendar']));
		return { start: str(v.start), focus: str(v.focus), me, generations: int(v.generations), height: int(v.height), ...(calendar !== undefined ? { calendar } : {}) };
	}

	houses(v: Raw): House[] {
		const houses: House[] = [];
		this.section(v, 'houses').forEach((h, i) => {
			if (!isMap(h)) {
				this.warn('entry-not-map', { section: 'houses', index: i + 1 });
				return;
			}
			const id = str(h.id);
			const name = str(h.name);
			if (!id) {
				this.warn('missing-id', name ? { section: 'houses', index: i + 1, name } : { section: 'houses', index: i + 1 });
				return;
			}
			if (Object.prototype.hasOwnProperty.call(h, 'color') && isEmpty(h.color)) {
				const params: CodedIssue['params'] = { house: name ?? id, id };
				const written = this.commentedColour(['houses', i, 'color']);
				if (written) params.value = written;
				this.warn('house-color-null', params, [id]);
			}
			const arms = linkValue(h.arms, () => this.sourceText(['houses', i, 'arms']));
			// Only when written, so a tree without arms reads exactly as before (spec §13.6).
			houses.push({ id, name: name ?? id, color: str(h.color), ...(arms !== undefined ? { arms } : {}) });
		});
		return houses;
	}

	/**
	 * Spec §13.4, read like `houses`: titles with no id are reported and skipped; duplicate ids are
	 * left for validation. `holders` tolerates one string and plain-string items (§8).
	 */
	titles(v: Raw): Title[] {
		const titles: Title[] = [];
		this.section(v, 'titles').forEach((t, index) => {
			if (!isMap(t)) {
				this.warn('entry-not-map', { section: 'titles', index: index + 1 });
				return;
			}
			const id = str(t.id);
			const name = str(t.name);
			if (!id) {
				this.warn('missing-id', name ? { section: 'titles', index: index + 1, name } : { section: 'titles', index: index + 1 });
				return;
			}
			const holders = t.holders;
			const items = Array.isArray(holders) ? holders.length : isEmpty(holders) || isMap(holders) ? 0 : 1;
			const maleName = str(t['male-name']);
			const femaleName = str(t['female-name']);
			titles.push({
				id,
				name: name ?? id,
				// Only when written, so a tree without male or female names reads exactly as before.
				...(maleName !== undefined ? { maleName } : {}),
				...(femaleName !== undefined ? { femaleName } : {}),
				plural: str(t.plural) ?? name ?? id,
				holders: this.holders(holders, index, name ?? id),
				index,
				items,
				...successionKeys(t),
			});
		});
		return titles;
	}

	private holders(v: Raw, titleIndex: number, title: string): Holder[] {
		if (isEmpty(v)) return [];
		const path = ['titles', titleIndex, 'holders'];
		if (isMap(v)) {
			this.warn('section-wrong-shape', { section: 'holders', title });
			return [];
		}
		// `holders: aldric` is one holder.
		if (!Array.isArray(v)) return str(v) === undefined ? [] : [this.holder({ person: str(v) }, 0, this.itemText(path))];
		const out: Holder[] = [];
		v.forEach((h, i) => {
			const text = () => this.itemText([...path, i]);
			if (isMap(h)) {
				const fields: Partial<Holder> = { person: str(h.person), name: str(h.name) };
				for (const key of HOLDER_TEXT) fields[key] = str(h[key]);
				const throughSpouse = readThroughSpouse(h['through-spouse']);
				if (throughSpouse !== undefined) fields.throughSpouse = throughSpouse;
				out.push(this.holder(fields, i, text()));
			} else if (str(h) !== undefined) out.push(this.holder({ person: str(h) }, i, text()));
			// An empty item (`-` alone) is not a holder either.
			else this.warn('entry-not-map', { section: 'holders', index: i + 1, title });
		});
		return out;
	}

	/** A holder with only the keys that have a value. */
	private holder(fields: Partial<Holder>, index: number, text: string | undefined): Holder {
		const out: Holder = { index };
		for (const key of ['person', 'name', ...HOLDER_TEXT] as const) if (fields[key] !== undefined) out[key] = fields[key];
		// After `to`, as written; only when written.
		if (fields.throughSpouse !== undefined) out.throughSpouse = fields.throughSpouse;
		if (text !== undefined) out.text = text;
		return out;
	}

	/** A list item's text as `UnionRef.text` compares it: comments dropped, whitespace runs as one space. */
	private itemText(path: (string | number)[]): string | undefined {
		try {
			const node = this.doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
			if (!node?.range) return undefined;
			return textWithoutComments(this.source.slice(node.range[0], node.range[1]));
		} catch {
			return undefined;
		}
	}

	/** A value's text as written, comments after it left out. */
	private sourceText(path: (string | number)[]): string | undefined {
		try {
			const node = this.doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
			return node?.range ? this.source.slice(node.range[0], node.range[1]) : undefined;
		} catch {
			return undefined;
		}
	}

	/** `color: #8b1e3f` without quotes: YAML reads the colour as a comment. Recover it for the message. */
	private commentedColour(path: (string | number)[]): string | undefined {
		try {
			const node = this.doc.getIn(path, true);
			if (!isScalar(node) || !node.range) return undefined;
			const rest = this.source.slice(node.range[0]).split(/\r?\n/, 1)[0];
			return /^\s*(#[0-9a-fA-F]{3,8})\b/.exec(rest)?.[1];
		} catch {
			return undefined;
		}
	}

	/** `taken`: every id written anywhere as a person or a reference to one. Examples for people with no id are added to it. */
	people(v: Raw, taken: Set<string>): Person[] {
		const entries = this.section(v, 'people');
		const people: Person[] = [];
		// Made on the first need: it scans `taken` once, and a tree with ids everywhere never needs it.
		let source: (() => string) | undefined;
		const nextExample = () => (source ??= personIdSource(taken))();
		entries.forEach((p, index) => {
			if (!isMap(p)) {
				this.warn('entry-not-map', { section: 'people', index: index + 1 });
				return;
			}
			const name = str(p.name);
			const cardTitle = str(p['card-title']);
			const sobriquet = normaliseSobriquet(str(p.sobriquet));
			const portrait = linkValue(p.portrait, () => this.sourceText(['people', index, 'portrait']));
			const portraitCrop = cropValue(p['portrait-crop']);
			// A curly pair of quote marks is taken off here too, until `unwrapCurlyKeys` lists the person key `arms`.
			const arms = linkValue(typeof p.arms === 'string' ? unwrapCurly(p.arms) : p.arms, () => this.sourceText(['people', index, 'arms']));
			let id = str(p.id);
			if (!id) {
				// Still drawn, under an id that nothing in the block uses, so nothing links to it by accident.
				id = `~${index + 1}`;
				while (taken.has(id)) id = `~${id}`;
				// The example is an id nobody has, and the next missing id gets another one (D104).
				const example = nextExample();
				this.warn('missing-id', name ? { section: 'people', index: index + 1, name, example } : { section: 'people', index: index + 1, example }, [id]);
			}
			people.push({
				id,
				name: name ?? id,
				title: str(p.title),
				// Only when written, so a tree without titles reads exactly as before.
				...(cardTitle !== undefined ? { cardTitle } : {}),
				// Only when written and not empty (D122).
				...(sobriquet !== undefined ? { sobriquet } : {}),
				house: str(p.house),
				sex: str(p.sex),
				born: str(p.born),
				died: str(p.died),
				parents: this.parents(p.parents, id, name ?? id),
				placement: str(p.placement),
				illegitimate: bool(p.illegitimate),
				// Only when true, so a tree without the key reads exactly as before.
				...(bool(p.childless) ? { childless: true as const } : {}),
				union: str(p.union),
				link: linkValue(p.link, () => this.sourceText(['people', index, 'link'])),
				// Only when written, like `card-title` (spec §13.7).
				...(portrait !== undefined ? { portrait } : {}),
				...(portraitCrop !== undefined ? { portraitCrop } : {}),
				// Personal arms, read like a portrait link.
				...(arms !== undefined ? { arms } : {}),
				notes: str(p.notes),
				index,
			});
		});
		return people;
	}

	private parents(v: Raw, owner: string, ownerName: string): ParentRef[] {
		const refs: ParentRef[] = [];
		list(v).forEach((raw, i) => {
			if (isMap(raw)) {
				const id = str(raw.id);
				if (!id) {
					this.warn('missing-id', { section: 'parents', index: i + 1, person: ownerName }, [owner]);
					return;
				}
				refs.push({ id, type: readParentType(raw.type) });
				return;
			}
			const id = str(raw);
			if (id) refs.push({ id, type: 'birth' });
			else if (!isEmpty(raw)) this.warn('entry-not-map', { section: 'parents', index: i + 1, person: ownerName }, [owner]);
		});
		return refs;
	}

	unions(v: Raw): Union[] {
		const unions: Union[] = [];
		this.section(v, 'unions').forEach((u, index) => {
			if (!isMap(u)) {
				this.warn('entry-not-map', { section: 'unions', index: index + 1 });
				return;
			}
			const endedBy = str(u['ended-by']);
			unions.push({
				id: str(u.id),
				partners: list(u.partners).map(str).filter((s): s is string => s !== undefined),
				type: readUnionType(u.type),
				start: str(u.start),
				end: str(u.end),
				...(endedBy !== undefined ? { endedBy } : {}),
				index,
				text: this.itemText(['unions', index]),
			});
		});
		return unions;
	}
}

/** The text of a list or map value as `badKeys` keeps it: `[a, b]`, `[a, …]` for an item that is not text, `{…}` for a map. */
function flowText(v: Raw): string {
	if (Array.isArray(v)) return `[${v.map((x) => str(x) ?? '…').join(', ')}]`;
	return '{…}';
}

/** The ids of `heir` or `exclude`: one id, or a list; an item that is not text is skipped and noted in `bad`. */
function idList(v: Raw, key: 'heir' | 'exclude', bad: Partial<Record<BadKey, string>>): string[] | undefined {
	if (isEmpty(v)) return undefined;
	const items = Array.isArray(v) ? v : [v];
	const ids: string[] = [];
	let skipped = false;
	for (const x of items) {
		const id = str(x);
		if (id === undefined) skipped = skipped || !isEmpty(x);
		else ids.push(id);
	}
	if (skipped) bad[key] = flowText(v);
	return ids.length ? ids : undefined;
}

/**
 * The succession keys of one title. Every field is present only when written, so a tree
 * without these keys reads exactly as before. A list or map value goes to `badKeys`, never into a field.
 */
function successionKeys(t: RawMap): Partial<Title> {
	const out: Partial<Title> = {};
	const bad: Partial<Record<BadKey, string>> = {};
	// A text key: the trimmed text, or undefined (and a note in `bad`) when the value is a list or a map.
	const text = (key: BadKey, v: Raw): string | undefined => {
		if (isEmpty(v)) return undefined;
		const s = str(v);
		if (s === undefined) bad[key] = flowText(v);
		return s;
	};
	const succession = text('succession', t.succession);
	if (succession !== undefined) out.succession = succession;
	const inherit = text('inherit', t.inherit);
	if (inherit !== undefined) out.inherit = inherit;
	const through = text('inherit-through', t['inherit-through']);
	if (through !== undefined) {
		const read = readThrough(through);
		if (read) out.inheritThrough = read;
		else bad['inherit-through'] = through;
	}
	const ill = text('inherit-illegitimate', t['inherit-illegitimate']);
	if (ill !== undefined) {
		const read = readIllegitimate(ill);
		if (read === 'after' || read === 'equal') out.inheritIllegitimate = read;
		else if (read === undefined) bad['inherit-illegitimate'] = ill;
	}
	if (bool(t['inherit-adopted'])) out.inheritAdopted = true;
	if (bool(t['heirs-of-body'])) out.heirsOfBody = true;
	const year = text('year', t.year);
	if (year !== undefined) out.year = year;
	const heirs = idList(t.heir, 'heir', bad);
	if (heirs) out.heirs = heirs;
	const exclude = idList(t.exclude, 'exclude', bad);
	if (exclude) out.exclude = exclude;
	if (Object.keys(bad).length) out.badKeys = bad;
	return out;
}

/**
 * YAML text without its comments, whitespace runs as one space. Comment-like text in scalars
 * stays, and quoted scalars keep their inner spaces (they are part of the value).
 */
export function textWithoutComments(text: string): string {
	let out = '';
	let plain = '';
	for (const token of new Lexer().lex(text)) {
		// The lexer adds a few one-character markers that are not in the text.
		if (token === '\x02' || token === '\x18' || token === '\x1f' || token.startsWith('#')) continue;
		if (token.startsWith('"') || token.startsWith("'")) {
			out += plain.replace(/\s+/g, ' ') + token;
			plain = '';
		} else plain += token;
	}
	return (out + plain.replace(/\s+/g, ' ')).trim();
}

/** Person ids and every reference to a person, as written; generated ids must avoid all of them. */
export function referencedIds(data: RawMap): Set<string> {
	const ids = new Set<string>();
	const add = (v: Raw) => {
		const s = str(isMap(v) ? v.id : v);
		if (s !== undefined) ids.add(s);
	};
	if (isMap(data.options)) {
		add(data.options.start);
		add(data.options.focus);
		add(data.options.me);
	}
	for (const p of Array.isArray(data.people) ? data.people : []) {
		if (!isMap(p)) continue;
		add(p.id);
		list(p.parents).forEach(add);
	}
	for (const u of Array.isArray(data.unions) ? data.unions : []) if (isMap(u)) list(u.partners).forEach(add);
	// Spec §13.4: a holder's `person` refers to a person, even one who does not exist yet.
	for (const t of Array.isArray(data.titles) ? data.titles : []) {
		// A named heir and an excluded person are references too, so a new person id never takes one.
		if (isMap(t)) for (const key of ['heir', 'exclude']) for (const x of list(t[key])) if (!isMap(x)) add(x);
		if (!isMap(t) || isMap(t.holders)) continue;
		for (const h of list(t.holders)) {
			const s = str(isMap(h) ? h.person : h);
			if (s !== undefined) ids.add(s);
		}
	}
	return ids;
}

/** The parser's first sentence, without the position (the error box shows the line itself). */
function cleanDetail(message: string): string {
	return message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '').trim();
}

/**
 * The engine's "Maximum call stack size exceeded" (Firefox and Safari say "too much recursion"). The package may throw it, or
 * catch it and report its text as a parse error. Only the message is tested: it is the same in every realm, and another
 * `RangeError` (for example an invalid array length) is not a nesting that is too deep.
 */
function isStackOverflow(e: unknown): boolean {
	const err = e as { message?: unknown } | null;
	return typeof err?.message === 'string' && /call stack size|too much recursion/i.test(err.message);
}

function yamlError(e: unknown): HardError {
	const err = e as { message?: unknown; linePos?: { line: number }[] };
	// A nesting so deep that the parser runs out of stack space: say it in plain words, not in the engine's words.
	const detail = isStackOverflow(e) ? LIMIT_DETAIL.tooDeep : typeof err?.message === 'string' ? cleanDetail(err.message) : String(e);
	const line = err?.linePos?.[0]?.line;
	return typeof line === 'number' ? { code: 'yaml-invalid', line, detail } : { code: 'yaml-invalid', detail };
}

/**
 * How large the aliases of a block may make the tree, in nodes: a number for each character of the text, plus a base, and never
 * more than a fixed ceiling. A real tree repeats a short house or a short list, which is about one node for each five
 * characters of text; 50 for each character leaves room (one test tree shares a map of 1 000 keys, 36 for each character).
 * The edit code copies the whole expanded data, at about 0.2 microseconds for each node, so the ceiling of 5 million nodes
 * bounds that copy. It does not bound the whole edit: see `ALIAS_MARKS_CAP` for the other cost.
 */
export const ALIAS_NODES_PER_CHAR = 50;
/** The base that is added to the nodes for each character. */
export const ALIAS_NODES_BASE = 10_000;
/** The most nodes, whatever the length of the text. */
export const ALIAS_NODES_CEILING = 5_000_000;
/**
 * How many alias uses (`*name`) and anchors (`&name`) together a block may hold, when it has at least one alias. The `yaml`
 * package finds the anchor of each alias with a pass over the list of all aliases and anchors before it, which is quadratic and
 * does not depend on the size of what the alias stands for. Measured on the development computer, a block with `house: *h` for
 * each person (the anchor at the top) reads in 0.5 to 0.6 s for 7 000 uses and an edit takes 1.1 to 1.5 s; at 11 900 uses it
 * reads in 1.3 to 1.6 s and an edit takes about 3.2 s; at 20 000 uses an edit takes 5 s. 50 000 uses of a short anchor read in
 * 10 s. So an edit is never "under a second" for a tree of this kind. A tree of 10 000 people that share one house is the most
 * that a real tree needs, so the cap is 12 000: it allows that tree and keeps the worst case near 3 s.
 */
export const ALIAS_MARKS_CAP = 12_000;
/**
 * The cap on the work of the aliases that sit inside an anchored list or map. When the anchored collection
 * is used, the `yaml` package resolves each alias inside it with a visit of the whole document (`getAliasCount`, no cache),
 * so the work is (aliases inside anchored collections) x (nodes of the document), which `ALIAS_MARKS_CAP` does not see:
 * 800 such aliases in a note of 4 000 people read in 5 s. Measured at about 7 million steps a second on the development
 * computer, so 10 million keeps the read near 1.5 s. A real tree has few aliases inside an anchored collection.
 */
export const NESTED_ALIAS_WORK_CAP = 10_000_000;

/** What `scanDocument` finds in one pass over the parsed document. */
interface DocumentScan {
	/** The number of nodes of the document with every alias counted as the node it stands for. May be `Infinity`. */
	expanded: number;
	/** The text offset of the first key that repeats an earlier key of the same map, or undefined. */
	duplicateAt: number | undefined;
	/** The repeated key, for the message. */
	duplicateKey: string | undefined;
	/** The number of alias uses and of anchors in the document (`ALIAS_MARKS_CAP`). */
	aliasUses: number;
	anchorCount: number;
	/** The aliases inside anchored collections, each counted once per anchored collection around it (`NESTED_ALIAS_WORK_CAP`). */
	nestedAliases: number;
	/** The nodes of the document as written (an alias counts as one node). */
	written: number;
}

/**
 * One pass over the document with no recursion (a deep tree must not overflow the stack here either). It counts the
 * nodes as if every alias were written out, using the size counted once for the anchor (an alias is never followed),
 * and finds the first repeated key of a map. The `yaml` package finds repeated keys itself with a scan of the earlier
 * keys for each key, which is quadratic: 40 000 keys of one map took 5 s to read. A set does it in linear time,
 * so `parseBody` turns the package's check off and uses this one.
 */
function scanDocument(doc: Document): DocumentScan {
	const anchors = new Map<string, unknown>();
	const sizes = new Map<unknown, number>();
	let duplicateAt: number | undefined;
	let duplicateKey: string | undefined;
	let aliasUses = 0;
	let anchorCount = 0;
	let nestedAliases = 0;
	let written = 0;
	// How many anchored collections hold the node being entered.
	let anchoredDepth = 0;
	interface Frame {
		node: unknown;
		kids: unknown[];
		at: number;
		sum: number;
		anchored: boolean;
	}
	const stack: Frame[] = [];
	let total = 1;
	const push = (f: Frame): void => {
		if (f.anchored) anchoredDepth++;
		stack.push(f);
	};

	/** The size of a leaf, or undefined after a collection was pushed. */
	const enter = (node: unknown): number | undefined => {
		written++;
		if (!isNode(node)) return 1;
		// A later anchor of the same name replaces an earlier one, as in the package.
		if (node.anchor) {
			anchors.set(node.anchor, node);
			anchorCount++;
		}
		if (isAlias(node)) {
			aliasUses++;
			nestedAliases += anchoredDepth;
			return sizes.get(anchors.get(node.source)) ?? 1;
		}
		if (isYamlMap(node)) {
			const kids: unknown[] = [];
			const seen = new Set<unknown>();
			for (const pair of node.items) {
				const key = pair.key;
				if (isScalar(key)) {
					if (seen.has(key.value)) {
						const at = key.range?.[0];
						if (at !== undefined && (duplicateAt === undefined || at < duplicateAt)) {
							duplicateAt = at;
							duplicateKey = typeof key.value === 'string' ? key.value : undefined;
						}
					} else seen.add(key.value);
				}
				kids.push(key, pair.value);
			}
			push({ node, kids, at: 0, sum: 1, anchored: !!node.anchor });
			return undefined;
		}
		if (isSeq(node)) {
			// A flow list can hold `a: b` pairs; the pair is not a node of its own.
			push({ node, kids: node.items.flatMap((item) => (isPair(item) ? [item.key, item.value] : [item])), at: 0, sum: 1, anchored: !!node.anchor });
			return undefined;
		}
		return 1;
	};

	const first = enter(doc.contents);
	if (first !== undefined) return { expanded: first, duplicateAt, duplicateKey, aliasUses, anchorCount, nestedAliases, written };
	while (stack.length) {
		const f = stack[stack.length - 1];
		if (f.at < f.kids.length) {
			const size = enter(f.kids[f.at++]);
			if (size !== undefined) f.sum += size;
		} else {
			stack.pop();
			if (f.anchored) anchoredDepth--;
			sizes.set(f.node, f.sum);
			if (stack.length) stack[stack.length - 1].sum += f.sum;
			else total = f.sum;
		}
	}
	return { expanded: total, duplicateAt, duplicateKey, aliasUses, anchorCount, nestedAliases, written };
}

/** The 1-based text line of an offset in `source`. */
function lineOf(source: string, offset: number): number {
	let line = 1;
	for (let i = source.indexOf('\n'); i >= 0 && i < offset; i = source.indexOf('\n', i + 1)) line++;
	return line;
}

/** The result of `parseBody`: the parsed document and raw data on success, or a `HardError`. */
type ParsedBody = { ok: true; doc: Document; data: Raw } | { ok: false; error: HardError };

/**
 * The one YAML parse used for reading and for editing (`yaml-edit.ts`). The failsafe schema
 * keeps every scalar exactly as written (fictional dates, leading zeros, numeric-looking ids,
 * and free text such as `1e3` or `null`). An unquoted `![[…]]` in a link key
 * is not an error (`tolerateEmbeds`), so reading and editing agree on it.
 *
 * Never throws and never writes to the console: `logLevel: 'error'` keeps the yaml package's
 * warnings (unknown tags, stringified keys) out of Obsidian's console.
 */
export function parseBody(source: string): ParsedBody {
	try {
		// `uniqueKeys: false`: the package checks keys in quadratic time, so `scanDocument` does it.
		const doc = parseDocument(source, { schema: 'failsafe', logLevel: 'error', uniqueKeys: false });
		tolerateEmbeds(doc, source);
		const scan = scanDocument(doc);
		// The first problem in the text wins, as with the package's own list of errors.
		const firstError = doc.errors[0];
		if (scan.duplicateAt !== undefined && scan.duplicateAt < (firstError?.pos[0] ?? Infinity)) {
			return { ok: false, error: { code: 'yaml-invalid', line: lineOf(source, scan.duplicateAt), detail: LIMIT_DETAIL.duplicateKey(scan.duplicateKey) } };
		}
		if (firstError) return { ok: false, error: yamlError(firstError) };
		// The package resolves each alias in time that grows with the square of their number (ALIAS_MARKS_CAP).
		if (scan.aliasUses > 0 && scan.aliasUses + scan.anchorCount > ALIAS_MARKS_CAP) {
			return { ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooLarge } };
		}
		// Each alias inside an anchored list or map costs a visit of the whole document (NESTED_ALIAS_WORK_CAP).
		if (scan.nestedAliases * scan.written > NESTED_ALIAS_WORK_CAP) {
			return { ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooLarge } };
		}
		// Aliases that write out far more than the text could hold. The count in `toJS` below does not see a wide bomb.
		if (scan.expanded > Math.min(ALIAS_NODES_PER_CHAR * source.length + ALIAS_NODES_BASE, ALIAS_NODES_CEILING)) {
			return { ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooLarge } };
		}
		blankPlainNulls(doc);
		// The yaml package refuses more than 100 alias uses by default; a large tree can use one
		// `house: *h` for every person. The limit still grows only with the text, so it stays safe.
		const data: Raw = doc.toJS({ maxAliasCount: Math.max(100, source.length) });
		if (!isEmpty(data) && !isMap(data)) return { ok: false, error: { code: 'not-a-map' } };
		// On the data only, not on the document: the note text and the document nodes stay as typed (D103).
		unwrapCurlyKeys(data);
		return { ok: true, doc, data };
	} catch (e) {
		// Unresolved or excessive aliases surface only while converting.
		return { ok: false, error: yamlError(e) };
	}
}

/** Parses a kin block body into a read-only model. Never throws. */
export function parseDynasty(source: string): ParseResult {
	const parsed = parseBody(source);
	if (!parsed.ok) return parsed;
	return { ok: true, tree: readTree(parsed.doc, parsed.data, source) };
}

/** The model of a body that `parseBody` accepted. */
export function readTree(doc: Document, data: Raw, source: string): Tree {
	if (!isMap(data)) return { options: {}, houses: [], people: [], unions: [], issues: [] };

	const r = new Reader(doc, source);
	const taken = referencedIds(data);
	const options = r.options(data.options);
	const houses = r.houses(data.houses);
	// Absent with no `titles` key, so a tree without titles reads exactly as before.
	const titles = Object.prototype.hasOwnProperty.call(data, 'titles') ? r.titles(data.titles) : undefined;
	const tree: Tree = { options, houses, people: r.people(data.people, taken), unions: r.unions(data.unions), issues: r.issues };
	if (titles !== undefined) tree.titles = titles;
	return tree;
}
