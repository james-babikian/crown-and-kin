/*
 * Hostile tree texts for `tests/fuzz-hostile.test.ts` (0.3, WP-H, the release plan W4): alias bombs, very long values, blocks
 * with very many keys and deeply nested flow collections. Each case is a note with one `dynasty` block. `runCase`
 * pushes the note through the plugin's read and write path (locate, parse, derive, layout, relations, one edit) and
 * reports what happened. The test runs it in a child process (`hostile-child.ts`), so a hang can be stopped and named.
 */
import { findBlocks } from '../../src/core/block-locate';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { planWrite } from '../../src/core/block-write';
import { computeRelations } from '../../src/core/relations';
import { applyOp } from '../../src/core/yaml-edit';
import { geometryFor } from '../../src/layout/geometry';
import { layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';

const SETTINGS: LayoutSettings = { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 } };

export interface HostileCase {
	name: string;
	/** The block body. */
	body: string;
	/** `error`: parse must give a hard error. `ok`: parse must succeed. `any`: either. */
	expect: 'error' | 'ok' | 'any';
	/** A known finding: the case does not end within the limit today. The test expects it to fail (`it.fails`), so a fix shows up. */
	finding?: string;
}

/** A small valid tree around hostile parts: two people and a house, so layout, relations and an edit have something to do. */
const BASE = 'people:\n  - id: aldric\n    name: Aldric\n  - id: isolde\n    name: Isolde\n    parents: [aldric]\n';

export const wrapNote = (body: string): string => `# Hostile\n\nBefore the tree.\n\n\`\`\`dynasty\n${body}${body.endsWith('\n') ? '' : '\n'}\`\`\`\n\nAfter the tree.\n`;

// --- alias bombs --------------------------------------------------------------------------

/** The classic "billion laughs": `levels` anchors, each a list of `width` aliases of the one before. */
function laughs(levels: number, width: number): string {
	const names = 'abcdefghijklmnopqrstuvwxyz';
	let out = `a: &a [${Array(width).fill('"lol"').join(', ')}]\n`;
	for (let i = 1; i < levels; i++) out += `${names[i]}: &${names[i]} [${Array(width).fill('*' + names[i - 1]).join(', ')}]\n`;
	return out;
}

/** Comment text that makes the block longer, so the alias allowance (the length of the text) is larger. */
const pad = (chars: number) => `# ${'x'.repeat(Math.max(0, chars - 3))}\n`;

/**
 * A bomb that stays inside the allowance: `leaves` small anchors, each used by every one of `parents` anchors
 * and each parent used once in `people`. Every alias use is counted against its own anchor and passes, but
 * the whole expanded tree is much larger than the text.
 */
function dense(leaves: number, leafSize: number, parents: number): string {
	let out = '';
	for (let i = 0; i < leaves; i++) out += `l${i}: &l${i} [${Array(leafSize).fill('x').join(', ')}]\n`;
	const refs = Array.from({ length: leaves }, (_, i) => `*l${i}`).join(', ');
	for (let j = 0; j < parents; j++) out += `p${j}: &p${j} [${refs}]\n`;
	out += 'people:\n  - id: aldric\n    name: Aldric\n    notes: [' + Array.from({ length: parents }, (_, j) => `*p${j}`).join(', ') + ']\n';
	return out;
}

/**
 * A bomb the library's count does not stop. It measures the product of the uses along a chain of aliases, not the size of the
 * expanded tree: a list of `leaf` values used by `p` lists, each used `q` times, counts as p * q, but expands to leaf * p * q nodes.
 * `where` is the place that holds the `q` uses.
 */
function wide(leaf: number, p: number, q: number, where: 'top' | 'person' | 'parents' | 'house' | 'people'): string {
	const a = `a: &a [${Array(leaf).fill('x').join(', ')}]\nb: &b [${Array(p).fill('*a').join(', ')}]\n`;
	const uses = `[${Array(q).fill('*b').join(', ')}]`;
	if (where === 'top') return a + `x: ${uses}\n` + BASE;
	if (where === 'person') return a + `people:\n  - id: aldric\n    name: Aldric\n    notes: ${uses}\n  - id: isolde\n    name: Isolde\n    parents: [aldric]\n`;
	if (where === 'parents') return a + `people:\n  - id: aldric\n    name: Aldric\n    parents: ${uses}\n`;
	if (where === 'house') return a + `houses:\n  - id: h\n    name: H\n    extra: ${uses}\npeople:\n  - {id: aldric, name: Aldric, house: h}\n`;
	return a + `people: ${uses}\n`;
}

// --- long values --------------------------------------------------------------------------

const LONG = 100_000;
const word = (n: number) => 'a'.repeat(n);
const words = (n: number) => 'word '.repeat(Math.ceil(n / 5)).slice(0, n).trim();

/** A 100 000-character text in each way YAML can write one line. */
function scalarForms(text: string): [string, string][] {
	return [
		['plain', text],
		['double-quoted', `"${text}"`],
		['single-quoted', `'${text}'`],
	];
}

// --- nesting -------------------------------------------------------------------------------

const nest = (depth: number, open = '[', close = ']') => open.repeat(depth) + 'x' + close.repeat(depth);
const nestMap = (depth: number) => '{a: '.repeat(depth) + 'x' + '}'.repeat(depth);

/** A block sequence that nests by indentation: `- - - x` is one line; this one uses a new line for each level. */
function blockLadder(depth: number): string {
	let out = '';
	for (let i = 0; i < depth; i++) out += `${' '.repeat(i * 2)}-\n`;
	return out + `${' '.repeat(depth * 2)}x\n`;
}

export function buildCases(): HostileCase[] {
	const cases: HostileCase[] = [];
	const add = (name: string, body: string, expect: HostileCase['expect'], finding?: string) => cases.push(finding ? { name, body, expect, finding } : { name, body, expect });

	// Alias bombs. The plugin raises the library's limit of 100 to the length of the text (parse.ts, `parseBody`), so the bomb
	// must still stop on its own: the first group must be a hard error, the group after it must finish.
	add('alias bomb, classic, 9 levels of 9', laughs(9, 9) + BASE, 'error');
	add('alias bomb, classic, 26 levels of 10', laughs(26, 10) + BASE, 'error');
	add('alias bomb in people', laughs(9, 9) + 'people: [*i]\n', 'error');
	add('alias bomb as the parents of a person', laughs(9, 9) + 'people:\n  - id: aldric\n    name: Aldric\n    parents: *i\n', 'error');
	add('alias bomb as a house colour', laughs(9, 9) + 'houses:\n  - id: h\n    name: H\n    color: *i\npeople:\n  - {id: aldric, name: Aldric, house: h}\n', 'error');
	add('a list of 60 values used 2 000 times (flat, not a bomb)', 'a: &a [' + Array(60).fill('x').join(', ') + ']\npeople: [' + Array(2000).fill('*a').join(', ') + ']\n', 'ok');
	add('alias bomb under a merge key', laughs(9, 9) + 'people:\n  - id: aldric\n    name: Aldric\n    <<: *i\n', 'error');
	add('aliases of one small value in 400 people (more than 100, as a large tree uses)', 'houses:\n  - &h {id: h, name: H}\npeople:\n' + Array.from({ length: 400 }, (_, i) => `  - {id: p${i}, name: P${i}, house: *h}`).join('\n') + '\n', 'any');
	add('alias to a missing anchor', BASE + 'x: *nothing\n', 'error');
	add('alias that refers to itself', BASE + 'x: &x [*x]\n', 'any');
	add('dense bomb inside the allowance, 60 KB text', pad(50_000) + dense(8, 30, 40), 'any');
	add('dense bomb inside the allowance, 120 KB text', pad(110_000) + dense(12, 60, 60), 'any');

	// Wide bombs: inside the library's count, but with a large expanded tree (4 * 10^7 nodes for the first group). The edit path copies
	// the data with JSON, which expands every shared value (`clone` in yaml-patch.ts), so the cost of an edit grows with the expanded size.
	for (const where of ['top', 'person', 'parents', 'house', 'people'] as const) {
		add(`wide alias bomb (1 000 x 200 x 200 = 4 * 10^7 nodes) in ${where}`, pad(60_000) + wide(1000, 200, 200, where), 'any');
	}
	const rep = (n: number, ref: string) => `[${Array(n).fill(ref).join(', ')}]`;
	add('wide alias bomb, 5 000 x 400 x 400 = 8 * 10^8 nodes, 180 KB text (F1, fixed in WP-H2: a hard error at the read)', pad(170_000) + wide(5000, 400, 400, 'top'), 'error');
	add('wide alias bomb, three levels (100 x 100 x 100 x 100 = 10^8 nodes)', pad(60_000) + `a: &a ${rep(100, 'x')}\nb: &b ${rep(100, '*a')}\nc: &c ${rep(100, '*b')}\nx: ${rep(100, '*c')}\n` + BASE, 'any');

	// 100 000-character values. Every field a person, a house or the options can hold, in the three one-line forms.
	for (const [form, make] of [['no spaces', word], ['with spaces', words]] as const) {
		const text = make(LONG);
		for (const [how, value] of scalarForms(text)) {
			for (const field of ['name', 'sobriquet', 'title', 'born', 'died', 'notes', 'link', 'portrait', 'house', 'sex', 'card-title', 'portrait-crop']) {
				if (field === 'name' || how === 'plain') {
					add(`100k characters (${form}, ${how}) in the person field ${field}`, `people:\n  - id: aldric\n${field === 'name' ? '' : '    name: Aldric\n'}    ${field}: ${value}\n  - id: isolde\n    name: Isolde\n    parents: [aldric]\n`, 'any');
				}
			}
		}
		add(`100k characters (${form}) as the person id, in parents`, `people:\n  - id: ${text}\n    name: Aldric\n  - id: isolde\n    name: Isolde\n    parents: [${text}]\n`, 'any');
		add(`100k characters (${form}) in the house name, colour and arms`, `houses:\n  - id: h\n    name: ${text}\n    color: "${text}"\n    arms: "${text}"\npeople:\n  - {id: aldric, name: Aldric, house: h}\n`, 'any');
		add(`100k characters (${form}) in options me, focus and start`, `options:\n  me: ${text}\n  focus: ${text}\n  start: ${text}\n${BASE}`, 'any');
		add(`100k characters (${form}) in a title name and a holder`, `titles:\n  - id: t\n    name: ${text}\n    holders:\n      - person: aldric\n        from: ${text}\n${BASE}`, 'any');
		add(`100k characters (${form}) in a partnership type`, `${BASE}unions:\n  - partners: [aldric, isolde]\n    type: ${text}\n`, 'any');
	}
	for (const [label, text] of [['literal block', `|\n${('line of text\n').repeat(8000)}`], ['folded block', `>\n${('line of text\n').repeat(8000)}`]] as const) {
		const indented = text.replace(/\n(?=.)/g, '\n      ');
		add(`100k characters in a ${label} for the name`, `people:\n  - id: aldric\n    name: ${indented}\n`, 'any');
	}

	// A block with 10 000 keys, in each place a map can stand.
	const keys = (n: number, indent: string, prefix = 'k') => Array.from({ length: n }, (_, i) => `${indent}${prefix}${i}: v${i}`).join('\n') + '\n';
	add('10 000 unknown keys at the top level', keys(10_000, '') + BASE, 'ok');
	add('10 000 unknown keys in one person', `people:\n  - id: aldric\n    name: Aldric\n${keys(10_000, '    ')}  - id: isolde\n    name: Isolde\n    parents: [aldric]\n`, 'ok');
	add('10 000 keys in options', `options:\n${keys(10_000, '  ')}${BASE}`, 'ok');
	add('10 000 keys in a house', `houses:\n  - id: h\n    name: H\n${keys(10_000, '    ')}${BASE}`, 'ok');
	add('10 000 keys in one flow map on one line', `x: {${Array.from({ length: 10_000 }, (_, i) => `k${i}: v`).join(', ')}}\n${BASE}`, 'ok');
	add('40 000 keys in one person (F2, fixed in WP-H2: the package checked keys in quadratic time, read 5 s, edit 10 s)', `people:\n  - id: aldric\n    name: Aldric\n${keys(40_000, '    ')}`, 'ok');
	add('10 000 repeated keys (a duplicate key is an error)', Array(10_000).fill('people: []').join('\n') + '\n', 'error');
	add('10 000 repeated keys inside a person', `people:\n  - id: aldric\n${Array(10_000).fill('    name: Aldric').join('\n')}\n`, 'error');
	add('people as a map of 10 000 keys', `people:\n${keys(10_000, '  ')}`, 'any');
	add('10 000 people with no parents, written in flow form', 'people:\n' + Array.from({ length: 10_000 }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n') + '\n', 'any');

	// Deeply nested flow collections. The library may stop with an error; the plugin must not throw.
	for (const depth of [100, 1000, 10_000, 100_000]) {
		add(`flow sequences ${depth} deep as the top level`, nest(depth) + '\n', 'any');
		add(`flow sequences ${depth} deep in a person field`, `people:\n  - id: aldric\n    name: Aldric\n    notes: ${nest(depth)}\n  - id: isolde\n    name: Isolde\n    parents: [aldric]\n`, 'any');
		add(`flow sequences ${depth} deep as the parents of a person`, `people:\n  - id: aldric\n    name: Aldric\n    parents: ${nest(depth)}\n`, 'any');
		add(`flow sequences ${depth} deep in options`, `options:\n  me: ${nest(depth)}\n${BASE}`, 'any');
		add(`flow maps ${depth} deep in a person field`, `people:\n  - id: aldric\n    name: Aldric\n    notes: ${nestMap(depth)}\n`, 'any');
		add(`flow sequences ${depth} deep and not closed`, `people:\n  - id: aldric\n    name: ${'['.repeat(depth)}\n`, 'any');
	}
	add('block sequences 1 000 deep by indentation', blockLadder(1000) , 'any');
	add('block sequences 5 000 deep by indentation, in a person field', `people:\n  - id: aldric\n    name: Aldric\n    notes:\n${blockLadder(5000).replace(/^/gm, '      ')}`, 'any');
	add('nested "- - - -" on one line, 20 000 deep', `people:\n  - id: aldric\n    name: Aldric\n    notes: ${'- '.repeat(20_000)}x\n`, 'any');

	return cases;
}

export interface CaseResult {
	name: string;
	/** The text of an exception that left the pipeline, or null. */
	threw: string | null;
	/** `ok`, or `error:<code>` for a hard error. */
	read: string;
	/** The first words of a hard error's detail (the box text). */
	detail: string;
	ms: number;
	/** True when the note string, the located body and the new note text of a write agree (see `runCase`). */
	noteSame: boolean;
	/** What the one edit attempt did: `ok`, or the refusal code, or `skipped`. */
	edit: string;
	people: number;
}

/** Runs the plugin's path over one case. Never throws; an exception is reported in `threw`. */
export function runCase(c: HostileCase): CaseResult {
	const note = wrapNote(c.body);
	const t0 = performance.now();
	const out: CaseResult = { name: c.name, threw: null, read: '?', detail: '', ms: 0, noteSame: true, edit: 'skipped', people: 0 };
	try {
		const blocks = findBlocks(note);
		if (blocks.length !== 1) throw new Error(`findBlocks found ${blocks.length} blocks`);
		const body = blocks[0].body;
		const r = parseDynasty(body);
		if (!r.ok) {
			out.read = `error:${r.error.code}`;
			out.detail = String((r.error as { detail?: string }).detail ?? '').slice(0, 120);
		} else {
			out.read = 'ok';
			const g = deriveFamilies(r.tree);
			out.people = g.people.length;
			if (g.people.length <= 2000) {
				const { layout } = layoutTree(g, geometryFor(16), SETTINGS, 'sans-serif');
				if (layout.persons.size !== g.people.length) throw new Error(`${g.people.length} people but ${layout.persons.size} cards`);
			}
			const me = g.people[0]?.id;
			if (me !== undefined) computeRelations(g, me);
		}
		// One edit through the write plan. The plan is pure: the note changes only if the caller writes `newText`.
		const first = r.ok ? r.tree.people[0]?.id : undefined;
		const plan = planWrite(note, 0, body, (b) => {
			if (first === undefined) return { ok: false, reason: 'no person to edit' };
			const res = applyOp(b, { kind: 'set-person-fields', id: first, fields: { name: 'Edited' } });
			return res.ok ? { ok: true, body: res.body } : { ok: false, reason: res.code };
		});
		out.edit = plan.ok ? 'ok' : plan.code === 'rejected' ? `rejected:${plan.reason.slice(0, 40)}` : plan.code;
		if (plan.ok) {
			// A write keeps every byte outside the body.
			const b = blocks[0];
			out.noteSame = plan.newText.startsWith(note.slice(0, b.bodyStart)) && plan.newText.endsWith(note.slice(b.bodyEnd));
		}
	} catch (e) {
		out.threw = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e);
	}
	out.ms = Math.round(performance.now() - t0);
	return out;
}
