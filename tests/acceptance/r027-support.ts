/*
 * Shared helpers for the 0.2.7 succession tests (the 0.2.7 contract sections A to D and K): the tree text of a
 * run of the case table, the engine call with the title of that text, and the readers of the succession
 * warnings. No expected value comes from code of `src/`: the engine under test is only called.
 */
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionResult } from '../../src/core/succession';
import type { Title } from '../../src/core/types';
import { TREES, type CaseKeys, type CaseRun } from './r027-cases-data';

/** The succession warning codes (contract A.5, K.4); the cases check these and no other codes. */
export const SUCCESSION_CODES = ['unknown-succession', 'unknown-inherit', 'unknown-inherit-through', 'unknown-inherit-illegitimate', 'year-unreadable', 'missing-heir', 'missing-excluded'];

/** An id list as written: one id as a scalar, several as a flow list (contract K.3). */
const idsText = (ids: string[]): string => (ids.length === 1 ? ids[0] : `[${ids.join(', ')}]`);

/** The key lines a run writes on its title, in the order of contract K.4. */
export function keyLines(k: CaseKeys): string[] {
	const out: string[] = [];
	out.push(`    succession: ${k.succession}`);
	out.push(`    inherit: ${k.inherit}`);
	if (k.through !== undefined) out.push(`    inherit-through: ${k.through}`);
	if (k.illegitimate !== undefined) out.push(`    inherit-illegitimate: ${k.illegitimate}`);
	if (k.adopted) out.push('    inherit-adopted: true');
	if (k.year !== undefined) out.push(`    year: ${k.year}`);
	if (k.heir !== undefined) out.push(`    heir: ${idsText(k.heir)}`);
	if (k.exclude !== undefined) out.push(`    exclude: ${idsText(k.exclude)}`);
	return out;
}

/** The block text of one tree of the table with the keys of a run on the title `duke`. */
export function sourceOf(tree: string, keys: CaseKeys | null): string {
	const t = TREES[tree];
	if (!t) throw new Error(`No tree ${tree}`);
	const lines = ['people:', ...t.people.map((p) => `  - ${p}`), '', 'titles:', '  - id: duke', '    name: Duke'];
	if (keys) lines.push(...keyLines(keys));
	lines.push('    holders:', ...t.holders.map((h) => `      - ${h}`), '');
	return lines.join('\n');
}

/** The graph of a block that must not have a hard error. */
export function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return deriveFamilies(r.tree);
}

/** The title with this id that the graph uses. */
export function titleIn(g: FamilyGraph, id = 'duke'): Title {
	const t = g.titles.find((x) => x.id === id);
	if (!t) throw new Error(`No title ${id}`);
	return t;
}

/** The line of one title of a block, as the Titles window computes it from the written keys. */
export function lineOfTitle(source: string, id = 'duke', limit = 50, oldAge = 110): { g: FamilyGraph; title: Title; result: SuccessionResult } {
	const g = graphOf(source);
	const title = titleIn(g, id);
	return { g, title, result: successionLine(g, title, specOf(title), limit, oldAge) };
}

/** The line of a run of the table. */
export function lineOfRun(run: CaseRun) {
	return lineOfTitle(sourceOf(run.tree, run.keys), 'duke', run.want.limit ?? 50);
}

/** The succession warning codes of a graph, in order. */
export const successionCodes = (g: FamilyGraph): string[] => g.issues.map((i) => i.code as string).filter((c) => SUCCESSION_CODES.includes(c));

/** A block text from people items, holder items and the key lines of the title `duke` (flow maps, one per item). */
export function blockOf(people: string[], holders: string[], keys: string[] = ['succession: eldest-child', 'inherit: no-preference']): string {
	return ['people:', ...people.map((p) => `  - ${p}`), '', 'titles:', '  - id: duke', '    name: Duke', ...keys.map((k) => `    ${k}`), '    holders:', ...holders.map((h) => `      - ${h}`), ''].join('\n');
}

/** The result of `successionLine` with the open-branch fields of contract M.4. */
export type BranchResult = SuccessionResult & { openBranches: { id: string; before: number }[]; moreBranches: boolean };

/**
 * `successionLine` with the new 6th argument `youngDeathAge` (contract M.4). The cast stays until the engine
 * has the argument and the two fields; the tests of open branches read the fields through this helper only.
 */
export function branchLine(g: FamilyGraph, title: Title, limit: number, youngDeathAge?: number, oldAge = 110): BranchResult {
	const call = successionLine as unknown as (g: FamilyGraph, t: Title, s: ReturnType<typeof specOf>, limit: number, oldAge: number, young?: number) => BranchResult;
	return youngDeathAge === undefined ? call(g, title, specOf(title), limit, oldAge) : call(g, title, specOf(title), limit, oldAge, youngDeathAge);
}
