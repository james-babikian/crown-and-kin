import { describe, expect, it } from 'vitest';
import { parseBody } from '../src/core/parse';
import { linkText } from '../src/core/link-text';
import { linkedNotePath } from '../src/core/note-make';
import { readPictureHeader } from '../src/core/pictures';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { dashOf } from '../src/core/yaml-list';
import { parse as parseSource, isRefusal } from '../src/core/yaml-patch';
import { linkTarget } from '../src/render/tree-info';
import { isMap, isSeq, type Node } from 'yaml';

// Version 0.2.3, WP-core: write styles that a tool or an owner can produce (spec §6.2, §8). A write
// that cannot keep the note as it is stays refused; these tests are for the writes that can work.

function ok(body: string, op: Op): string {
	const r = applyOp(body, op);
	if (!r.ok) throw new Error(`${r.code}: ${r.detail ?? ''}`);
	return r.body;
}

/** The lines of `after` that are not in `before`, and the lines of `before` that are not in `after` (an insertion only has the first). */
function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
	const a = before.split('\n');
	const b = after.split('\n');
	let s = 0;
	while (s < a.length && s < b.length && a[s] === b[s]) s++;
	let e = 0;
	while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
	return { removed: a.slice(s, a.length - e), added: b.slice(s, b.length - e) };
}

describe('A1: dash spacing in new list items', () => {
	it('a new house in a houses list written "-   id" keeps the keys in one column', () => {
		const body = 'houses:\n  -   id: a\n      name: A\npeople:\n  -   id: p\n      name: P\n';
		const out = ok(body, { kind: 'add-house', name: 'Dos', color: '#112233' });
		expect(lineDiff(body, out).removed).toEqual([]);
		expect(out).toContain('\n  -   id: dos\n      name: Dos\n      color: "#112233"');
	});
	it('a new title in a titles list written "-  id" (3 columns) works', () => {
		const body = 'titles:\n  -  id: t\n     name: T\npeople:\n  -  id: p\n     name: P\n';
		const out = ok(body, { kind: 'add-title', id: 'duke', name: 'Duke' });
		expect(lineDiff(body, out).removed).toEqual([]);
		expect(out).toContain('\n  -  id: duke\n     name: Duke');
	});
	it('a new unions section follows the dash spacing of the people list', () => {
		const body = 'people:\n    -   id: a\n        name: A\n    -   id: b\n        name: B\n';
		const out = ok(body, { kind: 'add-union', partners: ['a', 'b'], type: 'affair' });
		expect(lineDiff(body, out).removed).toEqual([]);
		expect(out).toContain('unions:\n    -   partners: [a, b]\n        type: affair');
	});
});

describe('A2: a comment after the dash', () => {
	it('dashOf finds the dash before a comment and before comment lines', () => {
		const text = 'people:\n  - # first\n    id: a\n  -\n    # about b\n    id: b\n  - id: c\n';
		const p = parseSource(text);
		if (isRefusal(p)) throw new Error('parse');
		const seq = (p.src.doc.contents as unknown as { items: { value: unknown }[] }).items[0].value;
		if (!isSeq(seq)) throw new Error('seq');
		const dashes = seq.items.map((it) => dashOf(p.src, it as Node));
		expect(dashes.map((d) => text[d])).toEqual(['-', '-', '-']);
		expect(dashes.map((d) => p.src.column(d))).toEqual([2, 2, 2]);
		expect(isMap(seq.items[0])).toBe(true);
	});
	it('move-sibling moves an item with a comment after its dash, with the comment', () => {
		const body = 'people:\n  - id: r\n    name: R\n  - # the heir\n    id: a\n    name: A\n    parents: [r]\n  - id: b\n    name: B\n    parents: [r]\n';
		const out = ok(body, { kind: 'move-sibling', id: 'a', direction: 'later' });
		expect(out.indexOf('# the heir')).toBeGreaterThan(out.indexOf('id: b'));
	});
	it('add-person after the item with a comment after its dash', () => {
		const body = 'people:\n  - # the heir\n    id: a\n    name: A\n  - id: b\n    name: B\n';
		const out = ok(body, { kind: 'add-person', id: 'n', fields: { name: 'N' }, at: { kind: 'after', id: 'a' } });
		expect(out).toContain('# the heir\n    id: a\n    name: A\n  - id: n\n    name: N\n  - id: b');
	});
	it('delete-person removes the item with its comment after the dash', () => {
		const body = 'people:\n  - id: a\n    name: A\n  - # the heir\n    id: b\n    name: B\n  - id: c\n    name: C\n';
		expect(ok(body, { kind: 'delete-person', id: 'b' })).toBe('people:\n  - id: a\n    name: A\n  - id: c\n    name: C\n');
	});
});

describe('A3: the end of an item', () => {
	it('keeps a blank line and the next section when an item ends with a comment line', () => {
		const body = 'houses:\n  - id: v\n    name: V\n    kids:\n      - a\n      # c\n\npeople:\n  - id: a\n    name: A\n';
		const out = ok(body, { kind: 'add-house', name: 'Dos' });
		expect(out).toContain('      # c\n  - id: dos\n    name: Dos\n\npeople:');
	});
	it('does not cut a "|+" scalar: its blank lines are text', () => {
		const body = 'people:\n  - id: a\n    name: A\n    notes: |+\n      one\n\n\n  - id: b\n    name: B\n';
		const out = ok(body, { kind: 'set-person-fields', id: 'a', fields: { born: '1100' } });
		expect(out).toContain('born: 1100');
		expect(out).toContain('      one\n\n\n  - id: b');
	});
	it('deleting the item before a "|+" item keeps the text of the scalar', () => {
		const body = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n    notes: |+\n      one\n\n  - id: c\n    name: C\n';
		const out = ok(body, { kind: 'delete-person', id: 'a' });
		expect(out).toBe('people:\n  - id: b\n    name: B\n    notes: |+\n      one\n\n  - id: c\n    name: C\n');
	});
	it('delete-house of the last house with an unquoted colour and a following blank line', () => {
		const body = 'houses:\n  - id: o\n    name: O\n  - id: v\n    name: V\n    color: #8b1e3f\n\npeople:\n  - id: a\n    name: A\n';
		expect(ok(body, { kind: 'delete-house', id: 'v', people: 'keep' })).toBe('houses:\n  - id: o\n    name: O\n\npeople:\n  - id: a\n    name: A\n');
	});
	it('works with CRLF line breaks', () => {
		const body = 'people:\r\n  - id: s\r\n    name: S\r\n  - id: p\r\n    name: P\r\n    parents:\r\n      - s\r\n      # check\r\n\r\n  - id: z\r\n    name: Z\r\n';
		const out = ok(body, { kind: 'delete-person', id: 'p' });
		expect(out).toContain('id: z');
		expect(out).not.toContain('# check');
	});
});

describe('A4: a block scalar header comment', () => {
	it('keeps the comment when the new text has several lines', () => {
		const body = 'people:\n  - id: a\n    name: A\n    notes: | # keep this\n      line one\n      line two\n';
		const out = ok(body, { kind: 'set-person-fields', id: 'a', fields: { notes: 'new one\nnew two' } });
		expect(out).toBe('people:\n  - id: a\n    name: A\n    notes: |- # keep this\n      new one\n      new two\n');
	});
	it('keeps the comment when the value goes to a quoted form', () => {
		const body = 'people:\n  - id: a\n    name: >- # keep this\n      Aldric\n';
		const out = ok(body, { kind: 'set-person-fields', id: 'a', fields: { name: 'Ald\nric' } });
		expect(out).toContain('name: "Ald\\nric" # keep this');
	});
	it('a block scalar without a header comment is written as before', () => {
		const body = 'people:\n  - id: a\n    name: A\n    notes: |-\n      line one\n';
		expect(ok(body, { kind: 'set-person-fields', id: 'a', fields: { notes: 'two' } })).toBe('people:\n  - id: a\n    name: A\n    notes: |-\n      two\n');
	});
});

describe('A5: a removed pair of a multi-line flow map', () => {
	const body = (inner: string) => `people:\n  - {\n${inner}    }\n`;
	it('the first pair goes with its line', () => {
		const out = ok(body('      born: 1100,\n      id: a,\n      name: A\n'), { kind: 'set-person-fields', id: 'a', fields: { born: null } });
		expect(out).toBe(body('      id: a,\n      name: A\n'));
	});
	it('the last pair after a comment goes with its line', () => {
		const out = ok(body('      id: a,\n      name: A, # keep\n      born: 1100\n'), { kind: 'set-person-fields', id: 'a', fields: { born: null } });
		expect(out).toBe(body('      id: a,\n      name: A, # keep\n'));
	});
	it('a pair that shares its line is removed as before', () => {
		const out = ok('people:\n  - {id: a, name: A, born: 1100}\n', { kind: 'set-person-fields', id: 'a', fields: { born: null } });
		expect(out).toBe('people:\n  - {id: a, name: A}\n');
	});
});

describe('A6: svg header scan', () => {
	const enc = (s: string) => new TextEncoder().encode(s);
	const size = (tag: string) => {
		const h = readPictureHeader(enc(`<svg ${tag}>`));
		return [h.width, h.height];
	};
	it('reads width and height in the quoted forms', () => {
		expect(size('width="10" height=\'20\'')).toEqual([10, 20]);
		expect(size('  width = "10"   height\t=\n"20" ')).toEqual([10, 20]);
		expect(size('x="1" width="10" y="2" height="20"')).toEqual([10, 20]);
	});
	it('the first of a repeated name wins', () => {
		expect(size('width="10" width="30" height="20"')).toEqual([10, 20]);
	});
	it('reads a value that holds the other quote, and names with odd characters', () => {
		expect(size('data-x="it\'s" width="10" height="20"')).toEqual([10, 20]);
		expect(size('xlink:href="a" width="10" height="20"')).toEqual([10, 20]);
	});
	it('gives no size for an unclosed quote, and does not take a later attribute', () => {
		expect(size('width="10 height="20"')).toEqual([null, null]);
		expect(size('width=10 height=20')).toEqual([null, null]);
	});
	it('reads the same as the old expression on random start tags', () => {
		const old = (tag: string) => {
			const attrs = new Map<string, string>();
			for (const m of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) if (!attrs.has(m[1])) attrs.set(m[1], m[2] ?? m[3]);
			return [attrs.get('width') ?? null, attrs.get('height') ?? null];
		};
		let seed = 7;
		const rand = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return seed / 4294967296;
		};
		const parts = ['width', 'height', 'w', '=', ' ', '=', '"', "'", '1', '2', '/', '\n', 'a=', 'width=', 'height='];
		for (let k = 0; k < 400; k++) {
			let tag = '';
			for (let n = Math.floor(rand() * 14); n > 0; n--) tag += parts[Math.floor(rand() * parts.length)];
			// No ">" in the tag, so it runs to the end of the text, quotes or not.
			const [w, h] = old(tag);
			const num = (v: string | null) => (v !== null && /^\s*\d+\s*$/.test(v) ? Number(v) : null);
			const got = readPictureHeader(enc(`<svg ${tag}`));
			// Only the plain-number case is read as a size, so compare that.
			if (num(w) !== null && num(h) !== null && Number(w) > 0 && Number(h) > 0) expect([got.width, got.height], tag).toEqual([Number(w), Number(h)]);
			else expect([got.width, got.height], tag).toEqual([null, null]);
		}
	});
	it('many attributes without a closing quote are read quickly', () => {
		const t = performance.now();
		readPictureHeader(enc(`<svg ${'a=" '.repeat(12000)}`));
		readPictureHeader(enc(`<svg ${"a='b=\"".repeat(10000)}`));
		expect(performance.now() - t).toBeLessThan(400);
	});
});

describe('A7: parentheses in link targets', () => {
	const cases: [string, string][] = [
		['[Note (2)](Note%20(2).md)', 'Note (2).md'],
		['[x](<Note (2).md>)', 'Note (2).md'],
		['![x](<folder/Note (2).md>)', 'folder/Note (2).md'],
		['[x]( Note.md )', 'Note.md'],
		['[x](Note.md#Part)', 'Note.md#Part'],
		['[[Note (2)|alias]]', 'Note (2)'],
		['Note (2)', 'Note (2)'],
	];
	for (const [link, expected] of cases) {
		it(`linkText of ${link}`, () => {
			expect(linkText(link)).toBe(expected);
			expect(linkTarget(link)).toBe(expected);
		});
	}
	it('an unbalanced destination is read as the whole text, as parseLink does', () => {
		expect(linkText('[a](b)) c')).toBe('[a](b)) c');
		expect(linkText('[a](b) and [c](d)')).toBe('[a](b) and [c](d)');
	});
	it('a text with a bad percent code stays as written', () => {
		expect(linkText('[a](100%.md)')).toBe('100%.md');
	});
	it('linkedNotePath gives the folder and name of a note with parentheses', () => {
		expect(linkedNotePath('[x](Houses/Note%20(2).md)')).toEqual({ folder: 'Houses', name: 'Note (2)', path: 'Houses/Note (2).md' });
		expect(linkedNotePath('[x](<Houses/Note (2)>)')).toEqual({ folder: 'Houses', name: 'Note (2)', path: 'Houses/Note (2).md' });
	});
	it('a long text of "[" and "(" is read in linear time', () => {
		const t = performance.now();
		linkText(`[${'['.repeat(30000)}](${'('.repeat(30000)}`);
		linkText(`[a](${'('.repeat(30000)}`);
		expect(performance.now() - t).toBeLessThan(400);
	});
});

describe('texts: the word ID is written in capital letters (spec D113)', () => {
	it('the key in an example stays lower case', async () => {
		const { issueText, codedIssue } = await import('../src/core/messages');
		const text = issueText(codedIssue('missing-id', 'warning', { section: 'people', index: 2, example: 'p9' }));
		expect(text).toBe('Entry 2 in the “people” list has no ID. Add an ID, for example: id: p9.');
	});
});

// ---------------------------------------------------------------------------------------------
// Styles that tools write: every op that has a place to go works, whatever the dash spacing,
// the indentation and the comments are.

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A block-style tree with random dash spacing, indentation and comments. The people after the second have `parents`. */
function styledTree(seed: number): { body: string; ids: string[] } {
	const rand = rng(seed);
	const chance = (x: number) => rand() < x;
	const seqIndent = [0, 2, 4][Math.floor(rand() * 3)];
	const gap = 1 + Math.floor(rand() * 4);
	const dash = ' '.repeat(seqIndent) + '-';
	const keyPad = ' '.repeat(seqIndent + gap + 1);
	const n = 3 + Math.floor(rand() * 5);
	const ids: string[] = [];
	const people: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = `p${i}`;
		ids.push(id);
		const lines: string[] = [];
		const lone = chance(0.2);
		const first = `id: ${id}`;
		if (lone) {
			lines.push(`${dash}${chance(0.5) ? ' # note ' + i : ''}`);
			lines.push(keyPad + first);
		} else lines.push(`${dash}${' '.repeat(gap)}${first}`);
		lines.push(`${keyPad}name: P${i}`);
		if (chance(0.3)) lines.push(`${keyPad}born:${chance(0.5) ? '  # unknown' : ''}`);
		if (chance(0.25)) {
			const style = ['|-', '|', '>'][Math.floor(rand() * 3)];
			lines.push(`${keyPad}notes: ${style}${style === '|-' ? ` # keep ${i}` : ''}`, `${keyPad}  text ${i}`);
			// A line of spaces deeper than the text is part of the scalar (the editor leaves one when Enter is pressed in the text).
			if (chance(0.5)) lines.push(' '.repeat(keyPad.length + 2 + Math.floor(rand() * 4)));
		}
		if (i > 1 && chance(0.7)) {
			if (chance(0.5)) lines.push(`${keyPad}parents:`, `${keyPad}  - p0`, ...(chance(0.5) ? [`${keyPad}  # check ${i}`] : []));
			else lines.push(`${keyPad}parents: [p0]${chance(0.4) ? ' # parent' : ''}`);
		}
		if (chance(0.3)) lines.push(`${keyPad}extra:`, `${keyPad}  k: v`, ...(chance(0.5) ? [`${keyPad}  # tail ${i}`] : []));
		if (chance(0.15)) lines.push('');
		people.push(lines.join('\n'));
	}
	const houses = chance(0.5) ? `houses:\n${dash}${' '.repeat(gap)}id: h\n${keyPad}name: H\n${chance(0.5) ? `${keyPad}color: #8b1e3f\n` : ''}\n` : '';
	return { body: `${houses}people:\n${people.join('\n')}\n`, ids };
}

describe('write styles (random)', () => {
	const ops = (ids: string[]): Op[] => [
		{ kind: 'add-house', name: 'Dos' },
		{ kind: 'add-title', id: 'duke', name: 'Duke' },
		{ kind: 'add-person', id: 'new', fields: { name: 'New' } },
		{ kind: 'add-person', id: 'new', fields: { name: 'New' }, at: { kind: 'before', id: ids[0] } },
		{ kind: 'add-person', id: 'new', fields: { name: 'New' }, at: { kind: 'after', id: ids[1] } },
		{ kind: 'add-union', partners: [ids[0], ids[1]], type: 'affair' },
		{ kind: 'delete-person', id: ids[ids.length - 1] },
		{ kind: 'set-person-fields', id: ids[1], fields: { notes: 'changed', born: '1100' } },
		{ kind: 'set-person-fields', id: ids[0], fields: { born: null, name: 'Changed' } },
		{ kind: 'set-person-fields', id: ids[0], fields: { notes: null } },
		{ kind: 'set-person-fields', id: ids[1], fields: { notes: null, born: null } },
		// Nobody has `ids[1]` as a parent, so this delete does not also remove a `parents` entry.
		{ kind: 'delete-person', id: ids[1] },
	];
	const spaceLines = (t: string) => t.split('\n').filter((l) => l !== '' && l.trim() === '').length;
	it('every op works on every style, and only inserts, or removes what it names', () => {
		const failures: string[] = [];
		for (let seed = 1; seed <= 120; seed++) {
			const { body, ids } = styledTree(seed);
			if (!parseBody(body).ok) throw new Error(`generator made a bad body for seed ${seed}:\n${body}`);
			for (const op of ops(ids)) {
				const r = applyOp(body, op);
				if (!r.ok) failures.push(`seed ${seed} ${JSON.stringify(op)}: ${r.code} ${r.detail ?? ''}`);
				else {
					expect(parseBody(r.body).ok, `seed ${seed}`).toBe(true);
					// An add only inserts lines: every line of the old text stays as it was.
					if (op.kind.startsWith('add-')) expect(lineDiff(body, r.body).removed, `seed ${seed} ${op.kind}`).toEqual([]);
					// A removal does not leave a line of spaces behind (the lines of the removed text go with it).
					else expect(spaceLines(r.body), `seed ${seed} ${JSON.stringify(op)}`).toBeLessThanOrEqual(spaceLines(body));
				}
			}
		}
		expect(failures).toEqual([]);
	});
});
