import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build } from './helpers';
import * as UI_TEXT from '../src/render/ui-text';
import * as TREE_INFO from '../src/render/tree-info';
import { CURLY_APOSTROPHE, CURLY_CLOSE, CURLY_OPEN } from '../src/core/quote';

// D99 (spec §13.0, 0.2.1): the plugin's own texts use curly quote marks and the curly apostrophe. This test
// calls every exported text table and text function of the render text files and fails on any straight
// " or '. The YAML example that the owner types stays straight; it lives in `src/core/messages.ts`, not here.
// `INSERT_UI.noteHint` is the one text here that stays straight: the plugin writes it into the owner's note (ruling A4).

type Fn = (...args: unknown[]) => unknown;

/** Every string inside `v` (strings, arrays, plain objects). */
function strings(v: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
	if (typeof v === 'string') out.push(v);
	else if (Array.isArray(v)) v.forEach((x) => strings(x, out, seen));
	else if (v && typeof v === 'object' && !seen.has(v)) {
		seen.add(v);
		Object.values(v).forEach((x) => strings(x, out, seen));
	}
	return out;
}

// Names with a curly apostrophe or curly quote mark inside would hide a straight mark from the plugin, so
// the sample names are plain letters.
const ARG_SETS: unknown[][] = [
	['Aldric'],
	['Aldric', 'Beata'],
	['Aldric', 'Beata', 'Cora'],
	['Aldric', 'Beata', 2],
	['Aldric', 2],
	[2],
	[1],
	[0],
	[2, 3],
	[['Aldric', 'Beata']],
	[['Aldric', 'Beata'], 2],
	[['Aldric', 'Beata', 'Cora']],
	[{ code: 'picture-too-large', pixels: 50 }],
	[{ code: 'picture-too-large' }],
	[{ code: 'picture-not-image', format: 'TIFF' }],
	[{ code: 'other' }],
	['picture'],
	['both'],
	['note'],
];

/** Calls `fn` with every argument set that it accepts and returns the texts it gives. */
function calls(fn: Fn): string[] {
	const out: string[] = [];
	for (const args of ARG_SETS) {
		try {
			strings(fn(...args), out);
		} catch {
			// This argument set does not fit the function; another one will.
		}
	}
	return out;
}

/** All texts of an export: the value itself, or the results of the functions in it. */
function texts(v: unknown): string[] {
	if (typeof v === 'function') return calls(v as Fn);
	if (v && typeof v === 'object') {
		const out: string[] = [];
		for (const x of Object.values(v)) out.push(...texts(x));
		return out;
	}
	return strings(v);
}

const SKIP = new Set<string>(['deleteText']);

const STRAIGHT = /["']/;
const NOTE_TEXT = new Set<string>([UI_TEXT.INSERT_UI.noteHint]);

describe('plugin texts use curly quote marks (D99)', () => {
	it('quote() puts curly marks around a name, and the apostrophe is curly', () => {
		expect(CURLY_OPEN + 'x' + CURLY_CLOSE).toBe('“x”');
		expect(CURLY_APOSTROPHE).toBe('’');
	});

	it('the text tables and text functions of ui-text.ts give no straight " or \'', () => {
		const bad: string[] = [];
		let count = 0;
		for (const [name, value] of Object.entries(UI_TEXT)) {
			if (SKIP.has(name)) continue;
			for (const t of texts(value)) {
				count++;
				if (STRAIGHT.test(t) && !NOTE_TEXT.has(t)) bad.push(`${name}: ${t}`);
			}
		}
		expect(count).toBeGreaterThan(500);
		expect(bad).toEqual([]);
	});

	it('the delete text, the link report and the finder texts give no straight " or \'', () => {
		const { g } = build(`people:
  - {id: a, name: Aldric}
  - {id: b, name: Beata}
  - {id: c, name: Cora}
`);
		const line = { people: ['a', 'b', 'c'], links: [], unions: [] };
		const rel = { text: 'Half-sister', lower: 'half-sister', kind: 'blood' as const, distance: 2, line };
		const got: string[] = [
			...UI_TEXT.deleteText('Aldric', { unions: 2, childLinks: 3, clearsStart: true, clearsFocus: true, clearsMe: true, holders: { titles: 2, entries: 2 } }),
			...UI_TEXT.deleteText('Aldric', { unions: 1, childLinks: 1, clearsStart: false, clearsFocus: false }),
			TREE_INFO.finderSentence(g, { kind: 'named', first: 'a', second: 'b', relations: [{ relation: rel, steps: [] }] }, 0),
			TREE_INFO.finderSentence(g, { kind: 'chain', first: 'a', second: 'c', steps: [], line }, 0),
			TREE_INFO.finderSentence(g, { kind: 'none', first: 'a', second: 'c' }, 0),
			...TREE_INFO.stepSentences(g, [{ person: 'b', of: 'a', word: 'wife' }]).shown,
			TREE_INFO.farTagLabel(g, ['b']),
			TREE_INFO.farTagLabel(g, ['b', 'c']),
			TREE_INFO.timingText(null),
			TREE_INFO.timingText({ path: 'Tree.md', people: 3, parseMs: 1, layoutMs: 2, drawMs: 3, totalMs: 6, interactiveMs: 9 }),
		];
		const base = { renames: [{ from: 'Old', to: 'New' }], ms: 1200, notes: 4, read: 4, unread: 1, trees: 2, links: 3, changedTrees: 2 };
		for (const state of ['running', 'done', 'failed', 'stopped'] as const) {
			for (const enabled of [true, false]) {
				got.push(UI_TEXT.RENAME_UI.report({ ...base, state, skipped: [{ note: 'U', link: 'Old', other: 'y/Old' }], failed: ['N1', 'N2'] }, enabled));
			}
		}
		got.push(UI_TEXT.RENAME_UI.report(null, false), UI_TEXT.RENAME_UI.report(null, true));
		expect(got.filter((t) => STRAIGHT.test(t))).toEqual([]);
		expect(got.some((t) => t.includes('“Old”'))).toBe(true);
		expect(got.some((t) => t.includes('Aldric’s'))).toBe(true);
	});

	it('the text files hold no straight double quote mark in code', () => {
		// A straight " in these files would be a plugin text written by hand; texts go through quote().
		for (const file of ['src/render/ui-text.ts', 'src/render/view-text.ts', 'src/render/succession-text.ts', 'src/render/tree-info.ts', 'src/render/legend-text.ts']) {
			const code = readFileSync(file, 'utf8')
				.split('\n')
				.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
				.map((l) => l.replace(/\/\/.*$/, ''))
				.filter((l) => l.includes('"') && !l.includes('noteHint:'));
			expect(code, file).toEqual([]);
		}
	});
});
