/*
 * Shared helpers for the M8 title tests (spec §13.3–§13.5, D54–D63): the modules under test,
 * loaded so the test files still compile before WP 8.1 adds them, typed views of the M8 additions
 * to existing types (the M8 contract, now in `src/core/types.ts`), and a reader for the
 * expected card texts and warnings that sample tree 13 keeps in its comments.
 */
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import type { ApplyOp, EditResult, HolderRef, NewTitleId, Op, TitleOp } from '../../src/core/edit';
import type { CodedIssue } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import type {
	CardLabel,
	CardLabels,
	CardTitleOp,
	DescribeDeleteTitle,
	EntryReign,
	HolderTable,
	NoteName,
	PickerSuffix,
	ReignText,
	RulerName,
	SearchNames,
} from '../../src/core/titles';
import type { Person, Title, Tree } from '../../src/core/types';
import * as edit from '../../src/core/yaml-edit';
import { fixtureNote, topLevelBlocks } from './load';

/** The frozen export names of `src/core/titles.ts`. */
export interface TitlesModule {
	cardLabels: CardLabels;
	reignText: ReignText;
	entryReign: EntryReign;
	rulerName: RulerName;
	searchNames: SearchNames;
	pickerSuffix: PickerSuffix;
	cardTitleOp: CardTitleOp;
	describeDeleteTitle: DescribeDeleteTitle;
	noteName: NoteName;
	holderTable: HolderTable;
}

/** The frozen export names of `src/core/title-ops.ts` that tests call directly. */
export interface TitleOpsModule {
	newTitleId: NewTitleId;
}

// Variable paths, so the files compile before WP 8.1 adds the modules; the tests then fail clearly.
const TITLES_PATH = '../../src/core/titles';
const TITLE_OPS_PATH = '../../src/core/title-ops';

async function load<T>(path: string, file: string, names: readonly string[]): Promise<T> {
	let mod: Record<string, unknown>;
	try {
		mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
	} catch (e) {
		throw new Error(`${file} does not exist yet (WP 8.1): ${String(e)}`);
	}
	for (const name of names) {
		if (typeof mod[name] !== 'function') throw new Error(`${file} does not export ${name} yet (WP 8.1)`);
	}
	return mod as T;
}

/** `src/core/titles.ts`, or an error that names the missing work package. */
export const titlesModule = () =>
	load<TitlesModule>(TITLES_PATH, 'src/core/titles.ts', [
		'cardLabels',
		'reignText',
		'entryReign',
		'rulerName',
		'searchNames',
		'pickerSuffix',
		'cardTitleOp',
		'describeDeleteTitle',
		'noteName',
		'holderTable',
	]);

/** `src/core/title-ops.ts`, or an error that names the missing work package. */
export const titleOpsModule = () => load<TitleOpsModule>(TITLE_OPS_PATH, 'src/core/title-ops.ts', ['newTitleId']);

// ---- The M8 additions to existing types (`Tree.titles`, `FamilyGraph.titles`, `Person.cardTitle`) ----

/** A `FamilyGraph` with the M8 field `titles` (always present after WP 8.1). */
export type TitledGraph = FamilyGraph & { titles: readonly Title[] };
/** A `Tree` with the M8 field `titles` (absent when the block has no `titles` section). */
export type TitledTree = Tree & { titles?: readonly Title[] };
/** A `Person` with the M8 field `cardTitle`. */
export type TitledPerson = Person & { cardTitle?: string };

/** Every op `applyOp` accepts after WP 8.1: the 1.0 ops, the title ops, and `card-title` in `set-person-fields`. */
export type AnyOp = Op | TitleOp | { kind: 'set-person-fields'; id: string; fields: Record<string, string | boolean | null> } | { kind: 'batch'; ops: AnyOp[] };

const applyOpNow: ApplyOp = edit.applyOp;
/** `applyOp` with the M8 ops (their types join `Op` in WP 8.1). */
export const applyTitleOp = (body: string, op: AnyOp): EditResult => applyOpNow(body, op as Op);

/** The new body of a successful edit, or an error that names the refusal. */
export function bodyOf(r: EditResult): string {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}

/** The refusal code of an edit, or 'ok'. */
export const refusal = (r: EditResult): string => (r.ok ? 'ok' : r.code);

/** Parse a block that must not have a hard error. */
export function treeOf(source: string): TitledTree {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree as TitledTree;
}

/** Parse and derive a block that must not have a hard error. */
export const graphOf = (source: string): TitledGraph => deriveFamilies(treeOf(source)) as TitledGraph;

/** The title with this id that the tree uses. */
export function titleOf(g: TitledGraph, id: string): Title {
	const t = (g.titles ?? []).find((x) => x.id === id);
	if (!t) throw new Error(`No title ${id} in the graph`);
	return t;
}

/** The `HolderRef` of the holder item at written position `index`, as the sheet and the window pass it back. */
export function holderRef(g: TitledGraph, title: string, index: number): HolderRef {
	const h = titleOf(g, title).holders.find((x) => x.index === index);
	if (!h) throw new Error(`No holder ${index} in ${title}`);
	const ref: HolderRef = { title, index };
	if (h.person !== undefined) ref.person = h.person;
	if (h.person === undefined && h.name !== undefined) ref.name = h.name;
	if (h.text !== undefined) ref.text = h.text;
	return ref;
}

// ---- Sample tree 13 ----

/** Sample tree 13's note, as stored. */
export const NOTE_13 = fixtureNote('13');
/** The bodies of the two blocks of sample tree 13, without the final newline (like `LocatedBlock.body`). */
export const BLOCKS_13 = topLevelBlocks(NOTE_13).map((b) => b.replace(/\n$/, ''));
/** The main tree of sample tree 13. */
export const BODY_13 = BLOCKS_13[0];

/** One `# warning:` comment: the code, the params as text, and the people ids (`ids=`). */
export interface ExpectedWarning {
	code: string;
	params: Record<string, string>;
	ids?: string[];
}

/** The expected card texts of one person (`# name line:` … `# picker:`). */
export interface ExpectedCard {
	name: string;
	/** The whole title text line, or null for none. */
	titleLine: string | null;
	holds: string[];
	shown: string | null;
	selected: boolean;
	search: string[];
	picker: string | null;
}

/** What one block of sample tree 13 expects. */
export interface Sample13Block {
	body: string;
	warnings: ExpectedWarning[];
	/** Person ids in document order, with their expected card texts. */
	cards: Map<string, ExpectedCard>;
	/** Comment lines that do not follow the format. */
	errors: string[];
}

const KEYS = ['name line', 'title line', 'holds', 'shown', 'search', 'picker'] as const;

/** Reads the expected warnings and card texts from the comments of one block of sample tree 13. */
export function sample13(block = 0): Sample13Block {
	const body = BLOCKS_13[block];
	const warnings: ExpectedWarning[] = [];
	const raw = new Map<string, Partial<Record<(typeof KEYS)[number], string>>>();
	const errors: string[] = [];
	let person: string | null = null;
	let section = '';
	for (const line of body.split('\n')) {
		const top = /^([a-z-]+):/.exec(line);
		if (top) section = top[1];
		const w = /^# warning: (\S+) \| (.+)$/.exec(line);
		if (w) {
			const params: Record<string, string> = {};
			let ids: string[] | undefined;
			for (const kv of w[2].split('; ')) {
				const at = kv.indexOf('=');
				if (at < 1) errors.push(line);
				else if (kv.slice(0, at) === 'ids') ids = kv.slice(at + 1).split(', ');
				else params[kv.slice(0, at)] = kv.slice(at + 1);
			}
			warnings.push(ids ? { code: w[1], params, ids } : { code: w[1], params });
			continue;
		}
		const id = /^ {2}- id: (\S+)\s*$/.exec(line);
		if (id && section === 'people') {
			person = id[1];
			raw.set(person, {});
			continue;
		}
		const c = /^ {4}# (name line|title line|holds|shown|search|picker): (.+)$/.exec(line);
		if (!c) continue;
		const got = person ? raw.get(person) : undefined;
		const key = c[1] as (typeof KEYS)[number];
		if (!got || got[key] !== undefined) errors.push(line);
		else got[key] = c[2];
	}
	const list = (v: string) => (v === 'none' ? [] : v.split(', '));
	const cards = new Map<string, ExpectedCard>();
	for (const [id, r] of raw) {
		if (KEYS.some((k) => r[k] === undefined)) {
			errors.push(`${id}: missing ${KEYS.filter((k) => r[k] === undefined).join(', ')}`);
			continue;
		}
		const shown = /^(\S+)( \(selected\))?$/.exec(r.shown!);
		cards.set(id, {
			name: r['name line']!,
			titleLine: r['title line'] === 'none' ? null : r['title line']!,
			holds: list(r.holds!),
			shown: r.shown === 'none' || !shown ? null : shown[1],
			selected: !!shown?.[2],
			search: list(r.search!),
			picker: r.picker === 'none' ? null : r.picker!,
		});
	}
	return { body, warnings, cards, errors };
}

/** An issue as the comments write it: code, params as text, and ids. */
export function asWritten(i: CodedIssue): ExpectedWarning {
	const params: Record<string, string> = {};
	for (const [k, v] of Object.entries(i.params ?? {})) params[k] = Array.isArray(v) ? v.join(', ') : String(v);
	return i.ids?.length ? { code: i.code, params, ids: [...i.ids] } : { code: i.code, params };
}

/** The title text line a card shows (§13.3): the title, then the reign, or null for none. */
export const titleLine = (l: CardLabel): string | null => [l.title, l.reign].filter((x): x is string => x !== undefined && x !== '').join(' ') || null;
