/*
 * Shared helpers for the M7 relation tests (spec §13.1, §13.2): the modules under test, loaded so
 * the test files still load before WP7.1 and WP7.2 exist, and a reader for the expected names and
 * finder pairs that sample tree 12 keeps in its comments.
 */
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import type { ComputeRelations, FindRelation, LineSubgraph, Relation, RelationsKey } from '../../src/core/relations';
import * as treeInfo from '../../src/render/tree-info';
import type { RelationTexts } from '../../src/render/tree-info';
import { fixtureSource } from './load';

/** The frozen export names of `src/core/relations.ts` (relations.ts header). */
export interface RelationsModule {
	computeRelations: ComputeRelations;
	findRelation: FindRelation;
	lineSubgraph: LineSubgraph;
	relationsKey: RelationsKey;
}

// A variable path, so the files compile before WP7.1 adds the module; the tests then fail clearly.
const RELATIONS_PATH = '../../src/core/relations';

/** `src/core/relations.ts`, or an error that names the missing work package. */
export async function relationsModule(): Promise<RelationsModule> {
	let mod: Partial<RelationsModule>;
	try {
		mod = (await import(/* @vite-ignore */ RELATIONS_PATH)) as Partial<RelationsModule>;
	} catch (e) {
		throw new Error(`src/core/relations.ts does not exist yet (WP7.1): ${String(e)}`);
	}
	for (const name of ['computeRelations', 'findRelation', 'lineSubgraph', 'relationsKey'] as const) {
		if (typeof mod[name] !== 'function') throw new Error(`src/core/relations.ts does not export ${name} yet (WP7.1)`);
	}
	return mod as RelationsModule;
}

/** One of the WP7.2 sentence builders of `src/render/tree-info.ts`, or an error that names the missing work package. */
export function relationText<K extends keyof RelationTexts>(name: K): RelationTexts[K] {
	const f = (treeInfo as unknown as Partial<RelationTexts>)[name];
	if (typeof f !== 'function') throw new Error(`src/render/tree-info.ts does not export ${name} yet (WP7.2)`);
	return f as RelationTexts[K];
}

/** Parse and derive a block that must not have a hard error. */
export function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return deriveFamilies(r.tree);
}

/** Distinct `lower` names in order: the list a sheet shows (§13.1 "Other names are only listed once"). */
export const lowers = (rels: readonly Relation[] | undefined): string[] => [...new Set((rels ?? []).map((r) => r.lower))];

/** The tree of spec §4, exactly as written there (the §13.1 examples use it). */
export const SPEC_4 = `options:
  start: roderick

houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"
  - id: orsini
    name: House Orsini
    color: "#1e4f8b"

people:
  - id: aldric
    name: Aldric Valmont
    title: Duke of Valmont
    house: valmont
    sex: m
    born: 1102
    died: 1161
  - id: isolde
    name: Isolde Orsini
    house: orsini
    sex: f
    born: 1110
  - id: gareth
    name: Ser Gareth Orsini
    house: orsini
    sex: m
  - id: roderick
    name: Roderick Valmont
    house: valmont
    sex: m
    born: 1131
    parents: [aldric, isolde, {id: gareth, type: rumoured}]
  - id: wren
    name: Wren
    sex: f
    born: 1135
    parents: [aldric]
    illegitimate: true
    link: "[[Wren of the Marches]]"
  - id: tomas
    name: Tomas Valmont
    # sex m: the §13.1 example names him "Adoptive brother"; with no sex the words are neutral (D12).
    sex: m
    parents: [{id: aldric, type: adoptive}, {id: isolde, type: adoptive}]
    placement: adoptive

unions:
  - partners: [aldric, isolde]
    type: marriage
    start: 1129
`;

// ---- Sample tree 12 ----

/** The expected names of one person for one marked person, from a `# <marked>: …` comment. */
export interface ExpectedNames {
	/** The card text, or null for "none". */
	card: string | null;
	/** The sheet's other names, best first (lower case). */
	also: string[];
	/** Names that depend on an open question: allowed in the list, not required. */
	maybe: string[];
}

/** One `# pair:` comment. */
export interface FinderPair {
	first: string;
	second: string;
	sentence: string;
	/** A number of relations for a named result, else 'chain' or 'none'. */
	count: number | 'chain' | 'none';
	/** The people on the line (of the first relation, or of the chain), in order; empty for none. */
	line: string[];
}

export interface Sample12 {
	source: string;
	marked: string[];
	/** Person ids in document order, as the comments list them. */
	people: string[];
	/** marked person → person → expected names. */
	names: Map<string, Map<string, ExpectedNames>>;
	pairs: FinderPair[];
	/** Comment lines that name a marked person but do not follow the format. */
	errors: string[];
}

function parseNames(text: string): ExpectedNames {
	const [card, ...rest] = text.split('; ');
	const out: ExpectedNames = { card: card === 'none' ? null : card, also: [], maybe: [] };
	for (const part of rest) {
		const m = /^(also|maybe): (.+)$/.exec(part);
		if (!m) throw new Error(`Cannot read "${part}" in "${text}"`);
		out[m[1] as 'also' | 'maybe'].push(...m[2].split(', '));
	}
	return out;
}

/** Reads the expected names and finder pairs from the comments of sample tree 12. */
export function sample12(): Sample12 {
	const source = fixtureSource('12');
	const lines = source.split('\n');
	const markedLine = lines.map((l) => /^# Marked people for the expected names: (.+)\.$/.exec(l)).find((m) => m);
	if (!markedLine) throw new Error('Sample tree 12 does not name its marked people');
	const marked = markedLine[1].split(', ');
	const names = new Map(marked.map((m) => [m, new Map<string, ExpectedNames>()]));
	const people: string[] = [];
	const pairs: FinderPair[] = [];
	const errors: string[] = [];
	let person: string | null = null;
	let section = '';
	for (const line of lines) {
		const top = /^([a-z]+):/.exec(line);
		if (top) section = top[1];
		const id = /^ {2}- id: (\S+)\s*$/.exec(line);
		if (id && section === 'people') {
			person = id[1];
			people.push(person);
			continue;
		}
		const pair = /^# pair: (\S+) > (\S+) \| (.+) \| (\d+|chain|none) \| (.+)$/.exec(line);
		if (pair) {
			const count = pair[4] === 'chain' || pair[4] === 'none' ? pair[4] : Number(pair[4]);
			pairs.push({ first: pair[1], second: pair[2], sentence: pair[3], count, line: pair[5] === '-' ? [] : pair[5].split(', ') });
			continue;
		}
		const name = /^ {4}# (\S+): (.+)$/.exec(line);
		if (!name) continue;
		const forMarked = names.get(name[1]);
		if (!person || !forMarked) errors.push(line);
		else if (forMarked.has(person)) errors.push(`${person}: two lines for ${name[1]}`);
		else forMarked.set(person, parseNames(name[2]));
	}
	return { source, marked, people, names, pairs, errors };
}
