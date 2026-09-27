import { describe, expect, it } from 'vitest';
import type { LocateBlock, PlanWrite } from '../../src/core/block';
import * as locate from '../../src/core/block-locate';
import * as write from '../../src/core/block-write';
import type { ApplyOp, EditRefusal, EditResult } from '../../src/core/edit';
import * as impl from '../../src/core/link-rewrite';
import type { LinkTargets, NormaliseTarget } from '../../src/core/link-rewrite-contract';
import { parseDynasty } from '../../src/core/parse';
import type { Tree } from '../../src/core/types';
import * as edit from '../../src/core/yaml-edit';
import { replaceOnce } from './golden';
import { allFixtures, fixtureSource } from './load';

// Link maintenance (spec §6.9, D6, D35) through the M6 contract after the design gate
// (src/core/link-rewrite-contract.ts, `RewriteLinksOp` in src/core/edit.ts, the decision notes "M6
// design gate"):
// - `linkTargets(body)`: the target of every person `link`, in document order, without `[[`, `]]`,
//   `#heading` and `|alias`; every written form (double or single quotes, the unquoted nested flow
//   sequence of §4.1 / §8); [] when the body does not parse; never throws.
// - `normaliseTarget(t)`: backslashes become `/`, a trailing `.md` is removed, lower case.
// - `applyOp(body, { kind: 'rewrite-links', map })`: each person link whose normalised target is a
//   key of `map` gets `map[key]` as its target, keeping `#heading`, `|alias` and a trailing `.md`.
//   The value keeps its style (quotes, unquoted nested form) if that style can hold the new text,
//   else the M2 quoting rule (plain if it reads back the same, else double quotes). Nothing else
//   changes. Allowed on a blocked tree. `changed` = number of links changed; 0 = body unchanged.
//
// Every expected text is written here by hand, by replacing exact text of the input.

const linkTargets: LinkTargets = impl.linkTargets;
const normaliseTarget: NormaliseTarget = impl.normaliseTarget;
const applyOp: ApplyOp = edit.applyOp;
const locateBlock: LocateBlock = locate.locateBlock;
const planWrite: PlanWrite = write.planWrite;

const rewrite = (body: string, map: Record<string, string>) => applyOp(body, { kind: 'rewrite-links', map });

type Ok = Extract<EditResult, { ok: true }>;

function ok(r: EditResult): Ok {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r;
}

/** The new body and the number of links changed; the op creates no ids. */
function result(r: EditResult): { body: string; changed: number | undefined } {
	const o = ok(r);
	expect(o.created).toEqual([]);
	return { body: o.body, changed: o.changed };
}

function expectRefused(r: EditResult, code: EditRefusal): void {
	expect(r.ok, `expected refusal ${code}`).toBe(false);
	expect(r).toMatchObject({ ok: false, code });
}

function tree(text: string): Tree {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return r.tree;
}

/** One person with the given `link:` value text, between two other people. */
const withLink = (value: string) => `people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n    link: ${value}\n    sex: f\n  - id: c\n    name: C`;

/** Rewrites and checks the whole body: only the link value text changed, one link counted. */
function expectOne(value: string, map: Record<string, string>, want: string): void {
	const before = withLink(value);
	expect(result(rewrite(before, map)), `${value} with ${JSON.stringify(map)}`).toEqual({
		body: replaceOnce(before, `    link: ${value}\n`, `    link: ${want}\n`),
		changed: 1,
	});
}

/** The body is unchanged and no link is counted. */
function expectNone(body: string, map: Record<string, string>): void {
	expect(result(rewrite(body, map)), JSON.stringify(map)).toEqual({ body, changed: 0 });
}

const HALL = { 'old hall': 'New Hall' };

// ---------- normaliseTarget ----------

describe('normaliseTarget (contract NormaliseTarget)', () => {
	const cases: [string, string][] = [
		['Old Hall', 'old hall'],
		['OLD HALL', 'old hall'],
		['Houses/Old Hall', 'houses/old hall'],
		['Houses\\Old Hall', 'houses/old hall'],
		['Houses\\Sub\\Old Hall.md', 'houses/sub/old hall'],
		['Old Hall.md', 'old hall'],
		['ÉLISE DE VALMONT', 'élise de valmont'],
		// Only a trailing ".md" goes.
		['Old.mdx', 'old.mdx'],
		['Old.md/Child', 'old.md/child'],
		['Old Hall.png', 'old hall.png'],
	];
	for (const [from, to] of cases) it(`${JSON.stringify(from)} → ${JSON.stringify(to)}`, () => expect(normaliseTarget(from)).toBe(to));
});

// ---------- linkTargets ----------

describe('linkTargets: every person link, in document order, every written form (contract LinkTargets)', () => {
	it('quoted, single-quoted, unquoted, flow-map person; heading, alias and block reference removed; .md and path kept', () => {
		const b = [
			'people:',
			'  - id: a',
			'    name: A',
			'    link: "[[Old Hall]]"',
			'  - id: b',
			'    name: B',
			"    link: '[[Houses/Old Hall#Early years|the hall]]'",
			'  - id: c',
			'    name: C',
			'    link: [[Old Hall.md|the hall]]',
			'  - id: d',
			'    name: D',
			'  - {id: e, name: E, link: "[[Gareth#^b1]]"}',
			'  - id: f',
			'    name: F',
			"    link: '[[Houses\\Old Hall]]'",
			'  - id: g',
			'    name: G',
			'    link: "[[Old Hall]]"   # the same note again',
		].join('\n');
		expect(linkTargets(b)).toEqual(['Old Hall', 'Houses/Old Hall', 'Old Hall.md', 'Gareth', 'Houses\\Old Hall', 'Old Hall']);
	});

	it('only person links: not houses, unions, notes, unknown keys or comments', () => {
		expect(linkTargets(ELSEWHERE)).toEqual(['Old Hall']);
	});

	it('sample trees: 4 (quoted) and 10 (unquoted) link to Wren of the Marches; the others have no links', () => {
		for (const f of allFixtures()) {
			expect(linkTargets(f.source), f.file).toEqual(f.id === '04' || f.id === '10' ? ['Wren of the Marches'] : []);
		}
	});

	it('a tree with blocking issues still lists its links (the rename runs on blocked trees)', () => {
		const b = 'people:\n  - id: a\n    name: A\n    link: "[[Old Hall]]"\n  - id: a\n    name: A again\n    link: "[[Gareth]]"';
		expect(linkTargets(b)).toEqual(['Old Hall', 'Gareth']);
	});

	it('[] when the body does not parse, is not a map, or has no people', () => {
		for (const b of ['people:\n  - id: a\n    name: A: B\n    link: "[[Old Hall]]"', '- "[[Old Hall]]"', '"[[Old Hall]]"', '', '# only a comment', 'people: []']) {
			expect(linkTargets(b), b).toEqual([]);
		}
	});
});

// ---------- the rewrite-links op ----------

describe('rewrite-links: the target changes; heading, alias and .md stay (§6.9)', () => {
	const cases: [string, Record<string, string>, string][] = [
		// [written value, map, expected value]
		['"[[Old Hall]]"', HALL, '"[[New Hall]]"'],
		['"[[Old Hall|the hall]]"', HALL, '"[[New Hall|the hall]]"'],
		['"[[Old Hall#Early years]]"', HALL, '"[[New Hall#Early years]]"'],
		['"[[Old Hall#Early years|the hall]]"', HALL, '"[[New Hall#Early years|the hall]]"'],
		['"[[Old Hall#^b1c2]]"', HALL, '"[[New Hall#^b1c2]]"'],
		// The alias may repeat the old name: only the target changes.
		['"[[Old Hall|Old Hall]]"', HALL, '"[[New Hall|Old Hall]]"'],
		// A trailing .md stays (contract).
		['"[[Old Hall.md]]"', HALL, '"[[New Hall.md]]"'],
		['"[[Old Hall.md#Early years|the hall]]"', HALL, '"[[New Hall.md#Early years|the hall]]"'],
		// Case-insensitive; the new text is written as given.
		['"[[OLD HALL]]"', HALL, '"[[New Hall]]"'],
		['"[[old hall|x]]"', HALL, '"[[New Hall|x]]"'],
		// Paths: the key is the normalised path; the new text may move the note.
		['"[[Houses/Old Hall]]"', { 'houses/old hall': 'Houses/New Hall' }, '"[[Houses/New Hall]]"'],
		['"[[Houses/Old Hall|the hall]]"', { 'houses/old hall': 'Archive/Houses/Old Hall' }, '"[[Archive/Houses/Old Hall|the hall]]"'],
		['"[[houses/OLD HALL.md#Early years]]"', { 'houses/old hall': 'Houses/New Hall' }, '"[[Houses/New Hall.md#Early years]]"'],
		["'[[Houses\\Old Hall]]'", { 'houses/old hall': 'Houses/New Hall' }, "'[[Houses/New Hall]]'"],
		['"[[ÉLISE DE VALMONT]]"', { 'élise de valmont': 'Élise of Greyfen' }, '"[[Élise of Greyfen]]"'],
		// Characters with a meaning in patterns or replacement strings are plain text.
		['"[[Old.v2]]"', { 'old.v2': 'New' }, '"[[New]]"'],
		['"[[Old (1102)]]"', { 'old (1102)': 'Old (1103)' }, '"[[Old (1103)]]"'],
		['"[[Old $1 + Hall]]"', { 'old $1 + hall': 'New $& Hall' }, '"[[New $& Hall]]"'],
	];
	for (const [value, map, want] of cases) it(`${value} with ${JSON.stringify(map)} → ${want}`, () => expectOne(value, map, want));

	it('only an equal normalised target matches: a basename key does not match a path, nor the reverse', () => {
		expectNone(withLink('"[[Houses/Old Hall]]"'), HALL);
		expectNone(withLink('"[[Old Hall]]"'), { 'houses/old hall': 'Houses/New Hall' });
		expectNone(withLink('"[[Archive/Old Hall]]"'), { 'houses/old hall': 'Houses/New Hall' });
	});

	it('other notes are untouched: longer, shorter or similar names, a name only in the alias or heading', () => {
		for (const value of ['"[[Old Hall Annex]]"', '"[[The Old Hall]]"', '"[[Old]]"', '"[[Other|Old Hall]]"', '"[[Other#Old Hall]]"', '"[[Old Hall2]]"', '"[[Old Hall.png]]"', '"[[Oldxv2]]"']) {
			expectNone(withLink(value), { ...HALL, 'old.v2': 'New' });
		}
	});

	it('several renamed notes in one op', () => {
		const b = 'people:\n  - id: a\n    name: A\n    link: "[[Old Hall]]"\n  - id: b\n    name: B\n    link: "[[Gareth|Ser Gareth]]"\n  - id: c\n    name: C\n    link: "[[Wren]]"';
		expect(result(rewrite(b, { 'old hall': 'New Hall', gareth: 'Ser Gareth Orsini' }))).toEqual({
			body: replaceOnce(replaceOnce(b, '"[[Old Hall]]"', '"[[New Hall]]"'), '"[[Gareth|Ser Gareth]]"', '"[[Ser Gareth Orsini|Ser Gareth]]"'),
			changed: 2,
		});
	});
});

describe('rewrite-links: quoting (§6.2, the decision notes "How a changed value is written")', () => {
	it('single quotes stay single quotes', () => {
		expectOne("'[[Old Hall]]'", HALL, "'[[New Hall]]'");
		expectOne("'[[Old Hall#Early years|the hall]]'", HALL, "'[[New Hall#Early years|the hall]]'");
	});

	it("single quotes hold an apostrophe as ''", () => {
		expectOne("'[[Old Hall]]'", { 'old hall': "Rosamund's Hall" }, "'[[Rosamund''s Hall]]'");
	});

	it('double quotes hold an apostrophe as is', () => {
		expectOne('"[[Old Hall]]"', { 'old hall': "Rosamund's Hall" }, '"[[Rosamund\'s Hall]]"');
	});

	it('the unquoted form (§4.1, §8: YAML reads it as a nested list) stays unquoted when it can hold the text', () => {
		expectOne('[[Old Hall]]', HALL, '[[New Hall]]');
		expectOne('[[Old Hall#Early years|the hall]]', HALL, '[[New Hall#Early years|the hall]]');
		expectOne('[[Houses/Old Hall.md]]', { 'houses/old hall': 'Houses/New Hall' }, '[[Houses/New Hall.md]]');
		expectOne('[[Old Hall]]', { 'old hall': "Rosamund's Hall" }, "[[Rosamund's Hall]]");
	});

	it('the unquoted form cannot hold ", " (it would read as two list items): double quotes', () => {
		const before = withLink('[[Old Hall]]');
		const r = result(rewrite(before, { 'old hall': 'Hall, the Elder' }));
		expect(r).toEqual({ body: replaceOnce(before, '    link: [[Old Hall]]\n', '    link: "[[Hall, the Elder]]"\n'), changed: 1 });
		expect(tree(r.body).people[1].link).toBe('[[Hall, the Elder]]');
	});

	it('fixture 10: the unquoted link of Wren', () => {
		const f10 = fixtureSource('10').replace(/\n$/, '');
		expect(result(rewrite(f10, { 'wren of the marches': 'Wren of Greyfen' }))).toEqual({
			body: replaceOnce(f10, '    link: [[Wren of the Marches]]\n', '    link: [[Wren of Greyfen]]\n'),
			changed: 1,
		});
	});

	it('fixture 4: the double-quoted link of Wren', () => {
		const f4 = fixtureSource('04').replace(/\n$/, '');
		expect(result(rewrite(f4, { 'wren of the marches': 'Wren of Greyfen' }))).toEqual({
			body: replaceOnce(f4, '    link: "[[Wren of the Marches]]"\n', '    link: "[[Wren of Greyfen]]"\n'),
			changed: 1,
		});
	});
});

/** The old name everywhere except in one person link (person b). */
const ELSEWHERE = [
	'# See [[Old Hall]] for the seat.',
	'houses:',
	'  - id: hall',
	'    name: "[[Old Hall]]"',
	'    link: "[[Old Hall]]"',
	'',
	'people:',
	'  - id: a',
	'    name: "[[Old Hall]]"',
	'    notes: "Born at [[Old Hall]]"',
	'    source: "[[Old Hall]]"      # [[Old Hall]]',
	'  - id: b',
	'    name: B',
	'    link: "[[Old Hall]]"',
	'',
	'unions:',
	'  - partners: [a, b]',
	'    link: "[[Old Hall]]"',
	'links: "[[Old Hall]]"',
].join('\n');

describe('rewrite-links: only person links change; the rest of the body stays (§6.2, §6.9)', () => {
	it('the old name in notes, names, unknown keys, houses, unions and comments stays', () => {
		expect(result(rewrite(ELSEWHERE, HALL))).toEqual({ body: replaceOnce(ELSEWHERE, '    name: B\n    link: "[[Old Hall]]"\n', '    name: B\n    link: "[[New Hall]]"\n'), changed: 1 });
	});

	const BODY = [
		'# The Hall line.',
		'people:',
		'  - id: a',
		'    name: Aldric',
		'    link: "[[Old Hall]]"      # his seat',
		'    sex: m',
		"  - {id: b, name: Isolde, link: '[[Old Hall|the hall]]', sex: f}   # a flow-map person",
		'  - id: c',
		'    name: Wren',
		'    # her own note',
		'    link: [[Old Hall#Wren]]',
		'  - id: d',
		'    name: Gareth',
		'    link: "[[Gareth]]"',
		'  - id: e',
		'    name: Tomas',
		'    link: "[[old hall.md]]"',
		'    parents: [a, b]',
		'',
		'unions:',
		'  - partners: [a, b]   # married at [[Old Hall]]',
	].join('\n');

	it('every matching link, and nothing else: comments, flow style and key order stay; changed is 4', () => {
		const want = [
			['    link: "[[Old Hall]]"      # his seat', '    link: "[[New Hall]]"      # his seat'],
			["link: '[[Old Hall|the hall]]', sex: f}", "link: '[[New Hall|the hall]]', sex: f}"],
			['    link: [[Old Hall#Wren]]', '    link: [[New Hall#Wren]]'],
			['    link: "[[old hall.md]]"', '    link: "[[New Hall.md]]"'],
		].reduce((t, [from, to]) => replaceOnce(t, from, to), BODY);
		expect(result(rewrite(BODY, HALL))).toEqual({ body: want, changed: 4 });
	});

	it('the tree reads back the same apart from the links', () => {
		const before = tree(BODY);
		const after = tree(result(rewrite(BODY, HALL)).body);
		expect(after.people.map((p) => p.link)).toEqual(['[[New Hall]]', '[[New Hall|the hall]]', '[[New Hall#Wren]]', '[[Gareth]]', '[[New Hall.md]]']);
		expect(after.people.map((p) => ({ ...p, link: undefined }))).toEqual(before.people.map((p) => ({ ...p, link: undefined })));
		expect(after.unions).toEqual(before.unions);
		expect(after.houses).toEqual(before.houses);
		expect(after.options).toEqual(before.options);
	});

	it('a final newline stays as it was', () => {
		const b = withLink('"[[Old Hall]]"');
		expect(result(rewrite(`${b}\n`, HALL)).body).toBe(`${replaceOnce(b, '[[Old Hall]]', '[[New Hall]]')}\n`);
	});

	it('a rename and its reverse give back the original bytes', () => {
		const b = replaceOnce(BODY, '"[[old hall.md]]"', '"[[Old Hall.md]]"');
		const there = result(rewrite(b, HALL));
		expect(there.changed).toBe(4);
		expect(result(rewrite(there.body, { 'new hall': 'Old Hall' }))).toEqual({ body: b, changed: 4 });
	});
});

describe('rewrite-links: nothing to change (contract: changed 0, the body unchanged)', () => {
	it('no link points to a renamed note; an empty map; a tree with no people', () => {
		expectNone(withLink('"[[Gareth]]"'), HALL);
		expectNone(withLink('"[[Old Hall]]"'), {});
		expectNone('people:\n  - id: a\n    name: A', HALL);
		expectNone('# only a comment', HALL);
	});

	it('the new text is the text already written', () => {
		expectNone(withLink('"[[Old Hall|the hall]]"'), { 'old hall': 'Old Hall' });
	});

	it('no sample tree changes for a note it does not link to', () => {
		for (const f of allFixtures()) expectNone(f.source, { 'no such note': 'Another Note' });
	});
});

describe('rewrite-links: blocked trees and refusals (contract, §8)', () => {
	it('allowed on a tree with blocking issues (it touches only link values)', () => {
		const b = 'people:\n  - id: a\n    name: A\n    link: "[[Old Hall]]"\n  - id: a\n    name: A again\n    link: "[[Old Hall|x]]"';
		expect(result(rewrite(b, HALL))).toEqual({ body: replaceOnce(replaceOnce(b, '"[[Old Hall]]"', '"[[New Hall]]"'), '"[[Old Hall|x]]"', '"[[New Hall|x]]"'), changed: 2 });
		const f5 = fixtureSource('05').replace(/\n$/, '');
		expectNone(f5, HALL);
	});

	it('invalid YAML and a top level that is not a map are refused', () => {
		expectRefused(rewrite('people:\n  - id: a\n    name: A: B\n    link: "[[Old Hall]]"', HALL), 'invalid-yaml');
		expectRefused(rewrite('- "[[Old Hall]]"', HALL), 'invalid-yaml');
	});

	it('odd shapes do not throw: link is a map, a number, a list; people is a map or a string', () => {
		for (const b of [
			withLink('{target: "[[Old Hall]]"}'),
			withLink('42'),
			withLink('[["[[Old Hall]]", x]]'),
			withLink('["[[Old Hall]]", "[[Old Hall]]"]'),
			withLink('~'),
			withLink('"[[]]"'),
			withLink('"[[#Heading]]"'),
			withLink('"[[|alias]]"'),
			withLink('"[[Old Hall"'),
			'people:\n  a:\n    link: "[[Old Hall]]"',
			'people: "[[Old Hall]]"',
			'people:\n  - "[[Old Hall]]"\n  - 42',
		]) {
			expect(() => rewrite(b, HALL), b).not.toThrow();
			expect(() => linkTargets(b), b).not.toThrow();
		}
	});
});

describe('rewrite-links in a note: a callout block keeps its prefix (§6.1)', () => {
	it('sample tree 4 inside a callout', () => {
		const block = fixtureSource('04');
		const note = `Intro.\n\n> [!note] Wren\n> \`\`\`dynasty\n${block.split('\n').slice(0, -1).map((l) => (l ? `> ${l}` : '>')).join('\n')}\n> \`\`\`\n`;
		const b = locateBlock(note, 0);
		if (!b) throw new Error('no block');
		const r = planWrite(note, 0, b.body, (body) => {
			const e = rewrite(body, { 'wren of the marches': 'Wren of Greyfen' });
			return e.ok ? { ok: true, body: e.body } : { ok: false, reason: e.code };
		});
		if (!r.ok) throw new Error(`write refused: ${r.code}`);
		expect(r.newText).toBe(replaceOnce(note, '>     link: "[[Wren of the Marches]]"\n', '>     link: "[[Wren of Greyfen]]"\n'));
	});
});

// ---------- Properties over generated trees, and fuzzing (§8: never throws) ----------

class Rng {
	private s: number;
	constructor(seed: number) {
		this.s = seed >>> 0;
	}
	/** mulberry32 */
	next(): number {
		let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	int(n: number): number {
		return Math.floor(this.next() * n);
	}
	pick<T>(xs: readonly T[]): T {
		return xs[this.int(xs.length)];
	}
}

/** Targets of the renamed note "Old Hall": [written target, round-trips byte for byte, has .md]. */
const SAME: [string, boolean, boolean][] = [
	['Old Hall', true, false],
	['Old Hall.md', true, true],
	['old hall', false, false],
	['OLD HALL.md', false, true],
];
/** Targets of other notes. */
const OTHERS = ['Old Hall Annex', 'The Old Hall', 'Houses/Old Hall', 'Gareth', 'Old'];
const SUFFIXES = ['', '|the hall', '#Early years', '#Early years|the hall', '#^b1'];
const NEW_NAMES = ['New Hall', "Rosamund's Hall", 'Old Hall (2)', 'Élise', 'Hall of the Old Kings'];

interface Generated {
	body: string;
	/** Per person: the written target (for linkTargets), or undefined. */
	targets: (string | undefined)[];
	/** Per person: the link as the tree reads it, and the link after renaming Old Hall to `n`. */
	links: (string | undefined)[];
	after: ((n: string) => string | undefined)[];
	/** Every matching link was written exactly, so the reverse rename gives back the bytes. */
	exact: boolean;
	count: number;
}

function generate(rng: Rng): Generated {
	const g: Generated = { body: '', targets: [], links: [], after: [], exact: true, count: 0 };
	const lines = ['# generated', 'people:'];
	const n = 1 + rng.int(7);
	for (let i = 0; i < n; i++) {
		const kind = rng.int(3);
		if (kind === 2) {
			lines.push(`  - id: p${i}`, `    name: Person ${i}`);
			g.targets.push(undefined);
			g.links.push(undefined);
			g.after.push(() => undefined);
			continue;
		}
		const suffix = rng.pick(SUFFIXES);
		let target: string;
		if (kind === 0) {
			const [t, exact, md] = rng.pick(SAME);
			target = t;
			if (!exact) g.exact = false;
			g.count++;
			g.after.push((name) => `[[${name}${md ? '.md' : ''}${suffix}]]`);
		} else {
			target = rng.pick(OTHERS);
			g.after.push(() => `[[${target}${suffix}]]`);
		}
		const link = `[[${target}${suffix}]]`;
		const style = rng.int(4);
		const value = style === 0 ? `"${link}"` : style === 1 ? `'${link}'` : link;
		if (style === 3 || rng.int(3) === 0) lines.push(`  - {id: p${i}, name: Person ${i}, link: ${style === 3 ? `"${link}"` : value}}`);
		else lines.push(`  - id: p${i}`, `    name: Person ${i}`, `    link: ${value}${rng.int(2) ? `   # note ${i}` : ''}`);
		g.targets.push(target);
		g.links.push(link);
	}
	g.body = lines.join('\n');
	return g;
}

describe('generated trees: linkTargets lists every link; rewrite-links changes exactly the matching ones', () => {
	it('2000 trees', { timeout: 60_000 }, () => {
		const rng = new Rng(0x6d15a2e1);
		for (let k = 0; k < 2000; k++) {
			const gen = generate(rng);
			const name = rng.pick(NEW_NAMES);
			const at = `case ${k}: Old Hall → ${name}\n${gen.body}`;
			expect(linkTargets(gen.body), at).toEqual(gen.targets.filter((t) => t !== undefined));
			const r = result(rewrite(gen.body, { [normaliseTarget('Old Hall')]: name }));
			expect(r.changed, at).toBe(gen.count);
			if (gen.count === 0) {
				expect(r.body, at).toBe(gen.body);
				continue;
			}
			const people = tree(r.body).people;
			gen.after.forEach((f, i) => expect(people[i].link, at).toBe(f(name)));
			// Only link values change: the same text lines, and each changed one has a link.
			const a = gen.body.split('\n');
			const b = r.body.split('\n');
			expect(b.length, at).toBe(a.length);
			a.forEach((line, i) => {
				if (line !== b[i]) expect(line, at).toMatch(/link: /);
			});
			if (gen.exact) expect(result(rewrite(r.body, { [normaliseTarget(name)]: 'Old Hall' })), at).toEqual({ body: gen.body, changed: gen.count });
		}
	});
});

describe('fuzz: linkTargets, normaliseTarget and rewrite-links never throw (§8)', () => {
	const SEEDS = [...allFixtures().map((f) => f.source), withLink('"[[Old Hall#Early years|the hall]]"'), withLink('[[Old Hall]]'), withLink("'[[Old Hall.md]]'"), ELSEWHERE];
	const JUNK = ['[[', ']]', '|', '#', '"', "'", ':', ': ', '\n', '  ', '- ', '{', '}', '[', ']', ',', '\\', '\t', '&a', '*a', '!!str ', '%', '@', '`', 'link: ', '[[Old Hall]]', 'Old Hall', '\u0000', '\ud800', 'é', '.md'];
	const TARGETS = ['old hall', 'Old Hall', '', ' ', 'houses/old hall', 'wren of the marches', 'a|b', 'a#b', ']]', '[[', '"', "'", '\n', 'x'.repeat(300), '.md', '$&', '\\', '__proto__', 'constructor'];

	it('3000 mutated bodies and odd maps', { timeout: 60_000 }, () => {
		const rng = new Rng(0x0dd5eed5);
		for (let k = 0; k < 3000; k++) {
			let b = rng.pick(SEEDS);
			const edits = 1 + rng.int(4);
			for (let e = 0; e < edits; e++) {
				const at = rng.int(b.length + 1);
				const op = rng.int(3);
				if (op === 0) b = b.slice(0, at) + rng.pick(JUNK) + b.slice(at);
				else if (op === 1) b = b.slice(0, at) + b.slice(at + 1 + rng.int(20));
				else b = b.slice(0, at) + b.slice(at, at + 1 + rng.int(40)).repeat(2) + b.slice(at + 1 + rng.int(40));
			}
			const map: Record<string, string> = {};
			for (let m = rng.int(3); m >= 0; m--) map[rng.pick(TARGETS)] = rng.pick(TARGETS);
			const context = () => JSON.stringify({ body: b, map });
			let r: EditResult;
			try {
				linkTargets(b);
				normaliseTarget(rng.pick(TARGETS) + rng.pick(JUNK));
				r = rewrite(b, map);
			} catch (e) {
				throw new Error(`case ${k} threw ${String(e)}: ${context()}`);
			}
			if (r.ok) {
				expect(typeof r.body, `case ${k}`).toBe('string');
				expect(Number.isInteger(r.changed) && r.changed! >= 0, `case ${k}: changed ${String(r.changed)}`).toBe(true);
				if (r.changed === 0) expect(r.body, `case ${k}`).toBe(b);
			}
		}
	});
});
