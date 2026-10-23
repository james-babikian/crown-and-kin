import { describe, expect, it } from 'vitest';
import type { EditResult, Op } from '../../src/core/edit';
import { linkTargets, normaliseTarget } from '../../src/core/link-rewrite';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { fixture } from '../support/helpers';

// Unit tests for link maintenance in the core (spec §6.9, D6): `linkTargets`, `normaliseTarget`
// and the `rewrite-links` op.

function result(src: string, map: Record<string, string>): Extract<EditResult, { ok: true }> {
	const r = applyOp(src, { kind: 'rewrite-links', map });
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r;
}
const rewrite = (src: string, map: Record<string, string>) => result(src, map).body;
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};
const one = (link: string) => `people:\n  - id: a\n    name: A\n    link: ${link}   # the note\n`;
const linkOf = (src: string, id = 'a') => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree.people.find((p) => p.id === id)?.link;
};

describe('normaliseTarget', () => {
	it('backslashes to slashes, no trailing .md, lower case', () => {
		expect(normaliseTarget('Folder\\Sub\\Old Note.md')).toBe('folder/sub/old note');
		expect(normaliseTarget('Old.MD')).toBe('old');
		expect(normaliseTarget('Old.md.md')).toBe('old.md');
		expect(normaliseTarget('Old')).toBe('old');
		expect(normaliseTarget('Old.mdx')).toBe('old.mdx');
	});

	it('never throws', () => {
		expect(normaliseTarget(null as unknown as string)).toBe('');
		expect(normaliseTarget(42 as unknown as string)).toBe('');
	});
});

describe('linkTargets', () => {
	it('reads every written form, in document order, without heading and alias', () => {
		const src = [
			'people:',
			'  - id: a',
			'    name: A',
			'    link: "[[Folder/Old#Youth|the old one]]"',
			'  - {id: b, name: B, link: [[Other|x]]}',
			'  - id: c',
			'    name: C',
			'    link: Bare Note#Heading',
			'  - id: d',
			'    name: D',
			"    link: '[Alias](My%20Note.md#H)'",
			'  - id: e',
			'    name: E',
			'    link: "[x](<Angle Note.md>)"',
			'  - id: f',
			'    name: F',
			'    link: "![[Embed.md]]"',
			'  - id: g',
			'    name: G',
			'  - id: h',
			'    name: H',
			'    link: "[[#Only a heading]]"',
		].join('\n');
		expect(linkTargets(src)).toEqual(['Folder/Old', 'Other', 'Bare Note', 'My Note.md', 'Angle Note.md', 'Embed.md']);
	});

	it('returns [] for a body that does not parse, and never throws', () => {
		expect(linkTargets('people: [')).toEqual([]);
		expect(linkTargets('- a\n- b\n')).toEqual([]);
		expect(linkTargets('')).toEqual([]);
		expect(linkTargets(undefined as unknown as string)).toEqual([]);
	});

	it('works on a tree with blocking issues', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: "[[One]]"\n  - id: a\n    name: B\n    link: "[[Two]]"\n';
		expect(linkTargets(src)).toEqual(['One', 'Two']);
	});
});

describe('rewrite-links', () => {
	const map = { old: 'New' };

	it('a quoted wikilink keeps its quotes, heading, alias and comment', () => {
		expect(rewrite(one('"[[Old]]"'), map)).toBe(one('"[[New]]"'));
		expect(rewrite(one('"[[Old#Youth|the old one]]"'), map)).toBe(one('"[[New#Youth|the old one]]"'));
		expect(rewrite(one("'[[Old|x]]'"), map)).toBe(one("'[[New|x]]'"));
		expect(rewrite(one('"![[Old]]"'), map)).toBe(one('"![[New]]"'));
	});

	it('keys match after normalising: case, .md and backslashes', () => {
		expect(rewrite(one('"[[old]]"'), { 'OLD.md': 'New' })).toBe(one('"[[New]]"'));
		expect(rewrite(one('"[[Folder/Old]]"'), { 'folder\\old': 'Archive/New' })).toBe(one('"[[Archive/New]]"'));
	});

	it('a trailing .md stays if the old text had it', () => {
		expect(rewrite(one('"[[Old.md|x]]"'), map)).toBe(one('"[[New.md|x]]"'));
		expect(rewrite(one('"[[Old.md]]"'), { old: 'New.md' })).toBe(one('"[[New.md]]"'));
		expect(rewrite(one('"[[Old]]"'), { old: 'New.md' })).toBe(one('"[[New.md]]"'));
	});

	it('a plain string stays plain if it can', () => {
		expect(rewrite(one('Old'), map)).toBe(one('New'));
		expect(rewrite(one('Old#Heading'), map)).toBe(one('New#Heading'));
		// Plain YAML would read these differently, so the M2 quoting rule applies.
		expect(rewrite(one('Old'), { old: 'true' })).toBe(one('"true"'));
		expect(rewrite(one('Old'), { old: 'Note: two' })).toBe(one('"Note: two"'));
	});

	it('the unquoted [[Old]] keeps its form when it can hold the new text', () => {
		const src = one('[[Old|x]]');
		const out = rewrite(src, map);
		expect(out).toBe(one('[[New|x]]'));
		expect(linkOf(out)).toBe('[[New|x]]');
		expect(rewrite(one('[["Old"]]'), map)).toBe(one('[["New"]]'));
	});

	it('the unquoted form that cannot hold the new text is written in double quotes', () => {
		const out = rewrite(one('[[Old]]'), { old: 'Smith, John' });
		expect(out).toBe(one('"[[Smith, John]]"'));
		expect(linkOf(out)).toBe('[[Smith, John]]');
		expect(rewrite(one('[[Old]]'), { old: 'Note [draft' })).toBe(one('"[[Note [draft]]"'));
	});

	it('Markdown links: the path is percent-encoded, or kept raw inside <>', () => {
		expect(rewrite(one('"[Alias](Old.md#H)"'), { old: 'New Note' })).toBe(one('"[Alias](New%20Note.md#H)"'));
		expect(rewrite(one('"[Alias](<Old.md>)"'), { old: 'New Note' })).toBe(one('"[Alias](<New Note.md>)"'));
		expect(rewrite(one('"[Alias](My%20Old.md)"'), { 'my old': 'A (b) 100%' })).toBe(one('"[Alias](A%20%28b%29%20100%25.md)"'));
	});

	it('only matching links change; changed counts them', () => {
		const src = [
			'# tree',
			'people:',
			'  - id: a',
			'    name: A',
			'    link: "[[Old]]"',
			'  - {id: b, name: B, link: "[[Other]]"}  # b',
			'  - {id: c, name: C, link: [[old|c]]}',
			'  - id: d',
			'    name: D',
			'    notes: "[[Old]]"',
			'',
		].join('\n');
		const r = result(src, { old: 'New' });
		expect(r.changed).toBe(2);
		expect(r.body).toBe(src.replace('link: "[[Old]]"', 'link: "[[New]]"').replace('[[old|c]]', '[[New|c]]'));
	});

	it('no match: changed 0 and the body is unchanged', () => {
		const src = one('"[[Old]]"');
		const r = result(src, { other: 'New' });
		expect(r.changed).toBe(0);
		expect(r.body).toBe(src);
		expect(result(src, {}).changed).toBe(0);
		expect(result('', map)).toMatchObject({ body: '', changed: 0 });
		// The same text after the rename (only the case of the key differs): nothing to write.
		expect(result(src, { old: 'Old' }).changed).toBe(0);
	});

	it('runs on a tree with blocking issues and touches only link values', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: "[[Old]]"\n  - id: a\n    name: B\n';
		expect(code(src, { kind: 'set-person-fields', id: 'a', fields: { title: 'T' } })).toBe('blocked');
		expect(rewrite(src, map)).toBe(src.replace('[[Old]]', '[[New]]'));
	});

	it('a person written as an alias is changed once, through its item', () => {
		const src = 'people:\n  - &a {id: a, name: A, link: "[[Old]]"}\n  - *a\n';
		const r = result(src, map);
		expect(r.changed).toBe(1);
		expect(r.body).toBe('people:\n  - &a {id: a, name: A, link: "[[New]]"}\n  - *a\n');
	});

	it('block scalars and CRLF', () => {
		const block = 'people:\n  - id: a\n    name: A\n    link: |-\n      [[Old]]\n';
		expect(rewrite(block, map)).toBe('people:\n  - id: a\n    name: A\n    link: |-\n      [[New]]\n');
		const crlf = 'people:\r\n  - id: a\r\n    name: A\r\n    link: "[[Old]]"\r\n';
		expect(rewrite(crlf, map)).toBe(crlf.replace('Old', 'New'));
	});

	it('refusals', () => {
		expect(code('people: [', { kind: 'rewrite-links', map })).toBe('invalid-yaml');
		expect(code(one('"[[Old]]"'), { kind: 'rewrite-links', map: null as unknown as Record<string, string> })).toBe('bad-value');
		expect(code(one('"[[Old]]"'), { kind: 'rewrite-links', map: { old: '' } })).toBe('bad-value');
		expect(code(one('"[[Old]]"'), { kind: 'rewrite-links', map: { old: 3 as unknown as string } })).toBe('bad-value');
		// A new target with | or # would change what the link means.
		expect(code(one('"[[Old]]"'), { kind: 'rewrite-links', map: { old: 'A|B' } })).toBe('bad-value');
		expect(code(one('"[[Old]]"'), { kind: 'rewrite-links', map: { old: 'A#B' } })).toBe('bad-value');
		expect(code(one('"[[Old]]"'), { kind: 'rewrite-links', map: { old: 'A]]B' } })).toBe('bad-value');
	});

	it('changed adds up in a batch', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: "[[Old]]"\n  - id: b\n    name: B\n    link: "[[Two]]"\n';
		const r = applyOp(src, {
			kind: 'batch',
			ops: [
				{ kind: 'rewrite-links', map: { old: 'New' } },
				{ kind: 'rewrite-links', map: { two: 'Deux' } },
			],
		});
		expect(r.ok && r.changed).toBe(2);
	});
});

describe('M6 ops never throw (§8)', () => {
	it('malformed ops give a refusal', () => {
		const src = fixture('09');
		const bad = [
			{ kind: 'rewrite-links' },
			{ kind: 'rewrite-links', map: [] },
			{ kind: 'rewrite-links', map: 'x' },
			{ kind: 'edit-house' },
			{ kind: 'edit-house', id: 'harrow', name: null },
			{ kind: 'edit-house', id: 'harrow', color: 5 },
			{ kind: 'delete-house' },
			{ kind: 'delete-house', id: 'harrow' },
		] as unknown as Op[];
		for (const op of bad) expect(() => applyOp(src, op)).not.toThrow();
		expect(bad.map((op) => code(src, op))).toEqual(['bad-value', 'bad-value', 'bad-value', 'unknown-house', 'bad-value', 'bad-value', 'unknown-house', 'bad-value']);
	});
});

describe('rewrite-links on the sample trees', () => {
	const diff = (a: string, b: string) => {
		const x = a.split('\n');
		const y = b.split('\n');
		return [x.filter((l) => !y.includes(l)), y.filter((l) => !x.includes(l))];
	};

	it('fixture 4: the quoted link', () => {
		const src = fixture('04');
		expect(linkTargets(src)).toEqual(['Wren of the Marches']);
		const r = result(src, { 'wren of the marches': 'Wren of the North' });
		expect(r.changed).toBe(1);
		expect(diff(src, r.body)).toEqual([['    link: "[[Wren of the Marches]]"'], ['    link: "[[Wren of the North]]"']]);
	});

	it('fixture 10: the unquoted link keeps its form', () => {
		const src = fixture('10');
		const r = result(src, { 'wren of the marches': 'People/Wren' });
		expect(diff(src, r.body)).toEqual([['    link: [[Wren of the Marches]]'], ['    link: [[People/Wren]]']]);
		expect(linkOf(r.body, 'wren')).toBe('[[People/Wren]]');
	});

	it('every sample tree: no matching key leaves the body as it is', () => {
		for (const f of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']) {
			const src = fixture(f);
			const r = applyOp(src, { kind: 'rewrite-links', map: { 'no such note': 'X' } });
			expect(r.ok && r.body === src && r.changed === 0).toBe(true);
		}
	});
});
