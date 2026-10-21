/*
 * Shared helpers for the M10 acceptance tests (spec §13.9–§13.13, D81–D91). The new modules are loaded by a
 * variable path, so the test files still compile before WP 10.1 to 10.3 add them: a missing module
 * fails the test that needs it, with a message that names the work package. The real modules give
 * the signatures. This file also reads the expected results that sample tree 15 keeps in its
 * comments, and holds a few small tree builders. No expected value is computed by code of `src/`.
 */
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import type { foldKey, foldFamilies, foldHidden, foldCount, foldControls, foldsHiding, unfoldFor, pruneFolds, personFolds, hiddenPartners, pruneGraph } from '../../src/core/folds';
import type { housePage, houseTableNote, houseNoteName } from '../../src/core/house-page';
import type { personNoteName, linkedNotePath } from '../../src/core/note-make';
import type { readPortraitCrop, formatPortraitCrop, clampCrop, automaticCrop, isAutomaticCrop, portraitCropOf, cropSquare, moveCrop, zoomCrop } from '../../src/core/portrait-crop';
import type { tableCell } from '../../src/core/titles';
import { parseDynasty } from '../../src/core/parse';
import type { Tree } from '../../src/core/types';
import { fixtureNote, topLevelBlocks } from './load';

// ---------- Loading modules that do not exist yet ----------

async function load<T>(path: string, file: string, wp: string, names: readonly string[]): Promise<T> {
	let mod: Record<string, unknown>;
	try {
		mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
	} catch (e) {
		throw new Error(`${file} does not exist yet (${wp}): ${String(e)}`);
	}
	for (const name of names) {
		if (mod[name] === undefined) throw new Error(`${file} does not export ${name} yet (${wp})`);
	}
	return mod as T;
}

/** `src/core/folds.ts` (WP 10.1). */
export interface FoldsModule {
	foldKey: typeof foldKey;
	foldFamilies: typeof foldFamilies;
	foldHidden: typeof foldHidden;
	foldCount: typeof foldCount;
	foldControls: typeof foldControls;
	foldsHiding: typeof foldsHiding;
	unfoldFor: typeof unfoldFor;
	pruneFolds: typeof pruneFolds;
	personFolds: typeof personFolds;
	hiddenPartners: typeof hiddenPartners;
	pruneGraph: typeof pruneGraph;
}
export const foldsModule = () =>
	load<FoldsModule>('../../src/core/folds', 'src/core/folds.ts', 'WP 10.1', ['foldKey', 'foldFamilies', 'foldHidden', 'foldCount', 'foldControls', 'foldsHiding', 'unfoldFor', 'pruneFolds', 'personFolds', 'hiddenPartners', 'pruneGraph']);

/** `src/core/house-page.ts` (rules 13–18, WP 10.1). */
export interface HousePageModule {
	housePage: typeof housePage;
	houseTableNote: typeof houseTableNote;
	houseNoteName: typeof houseNoteName;
}
export const housePageModule = () => load<HousePageModule>('../../src/core/house-page', 'src/core/house-page.ts', 'WP 10.1', ['housePage', 'houseTableNote', 'houseNoteName']);

/** `tableCell` of `src/core/titles.ts` (rule 17, WP 10.1). */
export const tableCellOf = async (): Promise<typeof tableCell> => (await load<{ tableCell: typeof tableCell }>('../../src/core/titles', 'src/core/titles.ts', 'WP 10.1', ['tableCell'])).tableCell;

/** `src/core/portrait-crop.ts` (rules 19–24, WP 10.1). */
export interface CropModule {
	readPortraitCrop: typeof readPortraitCrop;
	formatPortraitCrop: typeof formatPortraitCrop;
	clampCrop: typeof clampCrop;
	automaticCrop: typeof automaticCrop;
	isAutomaticCrop: typeof isAutomaticCrop;
	portraitCropOf: typeof portraitCropOf;
	cropSquare: typeof cropSquare;
	moveCrop: typeof moveCrop;
	zoomCrop: typeof zoomCrop;
}
export const cropModule = () =>
	load<CropModule>('../../src/core/portrait-crop', 'src/core/portrait-crop.ts', 'WP 10.1', ['readPortraitCrop', 'formatPortraitCrop', 'clampCrop', 'automaticCrop', 'isAutomaticCrop', 'portraitCropOf', 'cropSquare', 'moveCrop', 'zoomCrop']);

/** `src/core/note-make.ts` (rules 28–29, WP 10.1). */
export interface NoteMakeModule {
	personNoteName: typeof personNoteName;
	linkedNotePath: typeof linkedNotePath;
	NON_NOTE_EXTENSIONS: readonly string[];
}
export const noteMakeModule = () => load<NoteMakeModule>('../../src/core/note-make', 'src/core/note-make.ts', 'WP 10.1', ['personNoteName', 'linkedNotePath', 'NON_NOTE_EXTENSIONS']);

/** Any other module of the M10 work packages, loaded by path (the caller names the exports it needs). */
export const loadModule = <T>(path: string, file: string, wp: string, names: readonly string[]) => load<T>(path, file, wp, names);

// ---------- Trees ----------

/** Parse a block that must not have a hard error. */
export function treeOf(source: string): Tree {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree;
}

/** Parse and derive a block that must not have a hard error. */
export const graphOf = (source: string): FamilyGraph => deriveFamilies(treeOf(source));

// ---------- Sample tree 15 ----------

/** Block 0 of sample tree 15: the branches and folds. Block 1: the long names. */
export const block15 = (i: 0 | 1): string => topLevelBlocks(fixtureNote('15'))[i];

/** One named family of sample tree 15 as its comment gives it (`# fold:`). */
export interface FoldFact {
	name: string;
	key: string;
	n: number;
	children: string[];
	union?: string;
	hides: string[];
}

/** A set of folds as its comment gives it (`# folded:`, `# controls:`, `# tags:`). */
export interface SetFact {
	label: string;
	folds: string[];
	hides: string[];
	open: string[];
	/** NAME → N of the folded families with a "+ N" sign. */
	folded: Map<string, number>;
	/** Shown person → hidden partners, in the order the comment gives them. */
	tags: Map<string, string[]>;
}

/** A name text line list as its comment gives it (`# name-lines:`). */
export interface NameFact {
	id: string;
	width: number;
	lines: string[];
}

function fields(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of text.split('; ')) {
		const at = part.indexOf('=');
		if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
	}
	return out;
}

const list = (text: string | undefined): string[] => (text === undefined || text === '' ? [] : text.split(','));

/** The expected results that sample tree 15 keeps in the comments of its two blocks. */
export function comments15(): { folds: Map<string, FoldFact>; sets: Map<string, SetFact>; names: NameFact[]; people: number } {
	const folds = new Map<string, FoldFact>();
	const sets = new Map<string, SetFact>();
	const names: NameFact[] = [];
	const set = (label: string): SetFact => {
		let s = sets.get(label);
		if (!s) {
			s = { label, folds: [], hides: [], open: [], folded: new Map(), tags: new Map() };
			sets.set(label, s);
		}
		return s;
	};
	let people = 0;
	for (const line of block15(0).split('\n')) {
		const count = /^# people: (\d+)$/.exec(line);
		if (count) people = Number(count[1]);
		const m = /^# (fold|folded|controls|tags): (\S+) \| ?(.*)$/.exec(line);
		if (!m) continue;
		const [, kind, name, rest] = m;
		if (name === 'NAME') continue;
		if (kind === 'fold') {
			const f = fields(rest);
			folds.set(name, { name, key: f.key, n: Number(f.n), children: list(f.children), ...(f.union ? { union: f.union } : {}), hides: list(f.hides) });
		} else if (kind === 'folded') {
			const f = fields(rest);
			Object.assign(set(name), { folds: list(f.folds), hides: list(f.hides) });
		} else if (kind === 'controls') {
			const f = fields(rest);
			const s = set(name);
			s.open = list(f.open);
			for (const item of list(f.folded)) {
				const [n, count2] = item.split(':');
				s.folded.set(n, Number(count2));
			}
		} else {
			const s = set(name);
			for (const item of list(rest)) {
				const at = item.indexOf('=');
				s.tags.set(item.slice(0, at), item.slice(at + 1).split('+'));
			}
		}
	}
	for (const line of block15(1).split('\n')) {
		const m = /^# name-lines: (\S+) \| width=(\d+); lines=(.*)$/.exec(line);
		if (m) names.push({ id: m[1], width: Number(m[2]), lines: m[3].split(' / ') });
	}
	return { folds, sets, names, people };
}

/** Sorted copy, for comparing lists as sets. */
export const sorted = <T>(items: Iterable<T>): T[] => [...items].sort();

