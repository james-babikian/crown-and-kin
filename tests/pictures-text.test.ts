import { describe, expect, it } from 'vitest';
import type { EditResult, Op } from '../src/core/edit';
import { linkTargets, parseLink } from '../src/core/link-rewrite';
import { parseDynasty } from '../src/core/parse';
import type { Tree } from '../src/core/types';
import { applyOp } from '../src/core/yaml-edit';

// Unit tests for `arms` and `portrait` in the tree text (spec §13.0 items 1 and 3, §13.6, §13.7;
// M9 core contract rules 1–3 and 11, amendments A2 and A3): the unquoted embed, the writes and the
// link rewrite, beyond the acceptance tests.

function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
const apply = (src: string, op: unknown) => applyOp(src, op as Op);
function tree(src: string): Tree {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree;
}

describe('A3: an unquoted ![[…]] in a link key', () => {
	it('reads in a flow map, with a comma, and with a comment after it', () => {
		const t = tree(['houses:', '  - {id: h, name: H, arms: ![[a, b.png]]}', 'people:', '  - id: p', '    name: P', '    link: ![[Note]]   # the note', '    portrait: ![[p.png]]'].join('\n'));
		expect(t.houses[0].arms).toBe('![[a, b.png]]');
		expect(t.people[0].link).toBe('![[Note]]');
		expect(t.people[0].portrait).toBe('![[p.png]]');
	});

	it('an empty embed reads as absent, with no error', () => {
		const t = tree('people:\n  - id: p\n    name: P\n    portrait: ![[]]\n');
		expect('portrait' in t.people[0]).toBe(false);
		expect(t.issues).toEqual([]);
	});

	it('stays a YAML error in another key, with another tag, or with text glued after the tag', () => {
		for (const line of ['    motto: ![[x.png]]', '    portrait: !![[x.png]]', '    portrait: !x[[x.png]]']) {
			expect(parseDynasty(`people:\n  - id: p\n    name: P\n${line}\n`).ok, line).toBe(false);
		}
	});

	it('another field of that person can be edited; the embed stays as written', () => {
		const src = 'people:\n  - id: p\n    name: P\n    born: 1100\n    portrait: ![[p.png]]\n';
		expect(body(apply(src, { kind: 'set-person-fields', id: 'p', fields: { born: '1101' } }))).toBe(src.replace('1100', '1101'));
	});

	it('the same embed text writes nothing; a new portrait replaces it in double quotes', () => {
		const src = 'people:\n  - id: p\n    name: P\n    portrait: ![[p.png]]   # pasted\n';
		expect(body(apply(src, { kind: 'set-person-fields', id: 'p', fields: { portrait: '![[p.png]]' } }))).toBe(src);
		expect(body(apply(src, { kind: 'set-person-fields', id: 'p', fields: { portrait: '[[q.png]]' } }))).toBe(src.replace('![[p.png]]', '"[[q.png]]"'));
		expect(body(apply(src, { kind: 'set-person-fields', id: 'p', fields: { portrait: null } }))).toBe('people:\n  - id: p\n    name: P\n');
	});

	it('the arms of a house written as an embed can be removed', () => {
		const src = 'houses:\n  - id: h\n    name: H\n    arms: ![[h.png]]\n';
		expect(body(apply(src, { kind: 'edit-house', id: 'h', arms: null }))).toBe('houses:\n  - id: h\n    name: H\n');
	});
});

describe('writing portraits and arms', () => {
	const one = 'people:\n  - id: a\n    name: A\n';

	it('a portrait that is not text is refused `bad-value`, like any other field, and nothing throws', () => {
		for (const portrait of [42, {}, [], true]) {
			expect(apply(one, { kind: 'set-person-fields', id: 'a', fields: { portrait } }), JSON.stringify(portrait)).toMatchObject({ ok: false, code: 'bad-value' });
			expect(apply(one, { kind: 'add-person', id: 'b', fields: { name: 'B', portrait } }), JSON.stringify(portrait)).toMatchObject({ ok: false, code: 'bad-value' });
		}
		expect(apply(one, { kind: 'set-person-fields', id: 'a', fields: { name: 42 } })).toMatchObject({ ok: false, code: 'bad-value' });
	});

	it('add-person writes a portrait in double quotes even when plain text would read the same', () => {
		expect(body(apply(one, { kind: 'add-person', id: 'b', fields: { name: 'B', portrait: 'b.png' } }))).toBe(`${one}  - id: b\n    name: B\n    portrait: "b.png"\n`);
		const flow = 'people: [{id: a, name: A}]\n';
		expect(body(apply(flow, { kind: 'add-person', id: 'b', fields: { name: 'B', portrait: 'b.png' } }))).toBe('people: [{id: a, name: A}, {id: b, name: B, portrait: "b.png"}]\n');
	});

	it('add-house: null arms is no arms; a flow list gets a flow item with quoted arms', () => {
		expect(body(apply('houses: []\n', { kind: 'add-house', name: 'H', arms: null }))).toBe('houses: [{id: h, name: H}]\n');
		expect(body(apply('houses: [{id: k, name: K}]\n', { kind: 'add-house', name: 'H', arms: 'h.svg' }))).toBe('houses: [{id: k, name: K}, {id: h, name: H, arms: "h.svg"}]\n');
	});

	it('edit-house: an unquoted [[…]] equal to the new text writes nothing; blank text removes; a flow map keeps its form', () => {
		const src = 'houses:\n  - id: h\n    name: H\n    arms: [[h.png]]\n';
		expect(body(apply(src, { kind: 'edit-house', id: 'h', arms: '[[h.png]]' }))).toBe(src);
		expect(body(apply(src, { kind: 'edit-house', id: 'h', arms: '  ' }))).toBe('houses:\n  - id: h\n    name: H\n');
		const flow = 'houses:\n  - {id: h, name: H, arms: "[[h.png]]", motto: x}\n';
		expect(body(apply(flow, { kind: 'edit-house', id: 'h', arms: '[[k.png]]' }))).toBe(flow.replace('h.png', 'k.png'));
		expect(body(apply(flow, { kind: 'edit-house', id: 'h', arms: null }))).toBe('houses:\n  - {id: h, name: H, motto: x}\n');
	});

	it('edit-house: arms and a new name in one op', () => {
		const src = 'houses:\n  - id: h\n    name: H\n';
		expect(body(apply(src, { kind: 'edit-house', id: 'h', name: 'House H', arms: '[[h.png]]' }))).toBe('houses:\n  - id: h\n    name: House H\n    arms: "[[h.png]]"\n');
	});
});

describe('parseLink (A2)', () => {
	it('a Markdown destination with a `)` that closes nothing is not a Markdown link', () => {
		expect(parseLink('[a](b)c)')).toMatchObject({ kind: 'bare', target: '[a](b)c)' });
		expect(parseLink('[a](b(c)d)')).toMatchObject({ kind: 'md', target: 'b(c)d' });
		// An unclosed `(` was read before A2 and still is.
		expect(parseLink('[a](b(c)')).toMatchObject({ kind: 'md', target: 'b(c' });
	});
});

describe('linkTargets and rewrite-links with pictures (rule 11)', () => {
	const src = [
		'houses:',
		'  - name: No id',
		'    arms: "[[old.png]]"',
		'  - &h',
		'    id: h',
		'    name: H',
		'    arms: "[[old.png|H]]"',
		'  - *h',
		'people:',
		'  - id: a',
		'    name: A',
		'    portrait: "https://example.com/old.png"',
		'',
	].join('\n');

	it('lists every house item, a house with no id and an alias too, and web addresses', () => {
		expect(linkTargets(src)).toEqual(['old.png', 'old.png', 'old.png', 'https://example.com/old.png']);
	});

	it('rewrites each written value once and counts it once', () => {
		const r = apply(src, { kind: 'rewrite-links', map: { 'old.png': 'new.png' } });
		expect(body(r)).toBe(src.replace('"[[old.png]]"', '"[[new.png]]"').replace('"[[old.png|H]]"', '"[[new.png|H]]"'));
		expect(r).toMatchObject({ changed: 2 });
	});

	it('refuses the whole rewrite when a new picture name cannot be written as a link', () => {
		expect(apply(src, { kind: 'rewrite-links', map: { 'old.png': 'x]].png' } })).toMatchObject({ ok: false, code: 'bad-value' });
	});
});
