import { describe, expect, it } from 'vitest';
import type { EditResult, Op, SetPersonFields } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { applyOp, newHouseId } from '../src/core/yaml-edit';

const person = (id: string, fields: SetPersonFields['fields']): Op => ({ kind: 'set-person-fields', id, fields });

function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}

const edit = (src: string, op: Op) => body(applyOp(src, op));
const nameOf = (src: string, id: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree.people.find((p) => p.id === id);
};

const ONE = 'people:\n  - id: a\n    name: A\n';

describe('how a changed value is written', () => {
	const set = (value: string, field: 'name' | 'born' | 'house' | 'notes' = 'name') => edit(ONE, person('a', { [field]: value }));

	it('plain when plain YAML reads the same text', () => {
		expect(set('Aldric Valmont')).toBe('people:\n  - id: a\n    name: Aldric Valmont\n');
		expect(set('yes')).toContain('name: yes\n');
		expect(set("Rosamund's")).toContain("name: Rosamund's\n");
	});

	it('double quotes when the core schema would read a number, boolean or null', () => {
		for (const v of ['true', 'False', 'null', '~', '1e3', '0x1F', '.5', '42']) expect(set(v)).toContain(`name: "${v}"\n`);
	});

	it('born, died and house are text: digits and dates stay plain', () => {
		expect(set('1103', 'born')).toContain('born: 1103\n');
		expect(set('1102-03-04', 'born')).toContain('born: 1102-03-04\n');
		expect(set('42', 'house')).toContain('house: 42\n');
		expect(set('true', 'born')).toContain('born: true\n');
	});

	it('text that the core schema would print differently is quoted, even in text fields', () => {
		// The core schema reads 0042 as 42 and 1.10 as 1.1; spec §3 readers would lose the text.
		for (const v of ['0042', '1.10', 'null', '~', '1e3', 'True', '.inf']) expect(set(v, 'born')).toContain(`born: "${v}"\n`);
		// An untouched value stays as written (fixture 10 keeps `id: 0042`).
		const src = 'people:\n  - id: 0042\n    name: A\n';
		expect(edit(src, person('0042', { title: 'T' }))).toBe('people:\n  - id: 0042\n    name: A\n    title: T\n');
	});

	it('other text plain YAML would misread is quoted', () => {
		for (const v of ['?', '#1', 'trailing ', '- x', '? x', '|', '>', '&a', '*a', '!t', '%p', '@x', '`t', '"q', "'q", '{a}', '[a]', ',x'])
			expect(set(v), v).toContain(`name: ${JSON.stringify(v)}\n`);
		expect(set('a,b [c]')).toContain('name: a,b [c]\n');
	});

	it('double quotes for text plain YAML cannot hold', () => {
		expect(set('a: b')).toContain('name: "a: b"\n');
		expect(set('#8b1e3f')).toContain('name: "#8b1e3f"\n');
		expect(set('x # y')).toContain('name: "x # y"\n');
		expect(set(' lead')).toContain('name: " lead"\n');
		expect(set('[[Link]]')).toContain('name: "[[Link]]"\n');
		expect(set('say "hi": now')).toContain('name: "say \\"hi\\": now"\n');
		expect(set('tab\there')).toContain('name: tab\there\n');
		expect(set('\ttab')).toContain('name: "\\ttab"\n');
		expect(set('bell\x07')).toContain('name: "bell\\x07"\n');
	});

	it('a new multi-line value is written in double quotes', () => {
		expect(set('one\ntwo', 'notes')).toContain('notes: "one\\ntwo"\n');
	});

	it('a block literal stays a block literal, with its indentation', () => {
		const src = 'people:\n  - id: a\n    name: A\n    notes: |\n        old\n        text\n';
		expect(edit(src, person('a', { notes: 'new\n  indented\nend' }))).toBe('people:\n  - id: a\n    name: A\n    notes: |-\n        new\n          indented\n        end\n');
		expect(edit(src, person('a', { notes: 'one line\n' }))).toBe('people:\n  - id: a\n    name: A\n    notes: |\n        one line\n');
	});

	it('a block literal that cannot hold the text falls back to double quotes', () => {
		const src = 'people:\n  - id: a\n    name: A\n    notes: |\n      old\n';
		expect(edit(src, person('a', { notes: '  starts with spaces\nx' }))).toBe('people:\n  - id: a\n    name: A\n    notes: "  starts with spaces\\nx"\n');
	});

	it('a folded scalar keeps its style for one line of text', () => {
		const src = 'people:\n  - id: a\n    name: >-\n      Long\n      name\n    sex: f\n';
		expect(edit(src, person('a', { name: 'Short name' }))).toBe('people:\n  - id: a\n    name: >-\n      Short name\n    sex: f\n');
	});

	it('single quotes stay single when they can', () => {
		const src = "people:\n  - id: a\n    name: 'A'\n";
		expect(edit(src, person('a', { name: 'true' }))).toBe("people:\n  - id: a\n    name: 'true'\n");
		expect(edit(src, person('a', { name: 'two\nlines' }))).toBe('people:\n  - id: a\n    name: "two\\nlines"\n');
	});

	it('a very long value stays on one line', () => {
		const long = 'word '.repeat(400).trim();
		expect(edit(ONE, person('a', { notes: long }))).toBe(`people:\n  - id: a\n    name: A\n    notes: ${long}\n`);
	});

	it('Unicode text is written as it is', () => {
		expect(edit(ONE, person('a', { name: 'Þórr Ünïcødé 🐉', title: '王' }))).toBe('people:\n  - id: a\n    name: Þórr Ünïcødé 🐉\n    title: 王\n');
	});

	it('an empty value (key with nothing after it) gets the new value after one space', () => {
		expect(edit('people:\n  - id: a\n    name: A\n    title:\n', person('a', { title: 'T' }))).toBe('people:\n  - id: a\n    name: A\n    title: T\n');
		expect(edit('people:\n  - id: a\n    name: A\n    title: # c\n', person('a', { title: 'T' }))).toBe('people:\n  - id: a\n    name: A\n    title: T # c\n');
	});

	it('an unquoted [[link]] that reads the same is left alone', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: [[A]]\n';
		expect(edit(src, person('a', { link: '[[A]]' }))).toBe(src);
		expect(edit(src, person('a', { link: '[[B]]' }))).toBe('people:\n  - id: a\n    name: A\n    link: "[[B]]"\n');
	});
});

describe('adding and removing keys', () => {
	it('new keys follow the §4.1 order', () => {
		const out = edit(ONE, person('a', { notes: 'n', born: '1', title: 't', sex: 'm', illegitimate: true, placement: 'adoptive', link: '[[A]]', house: 'h', died: '2' }));
		expect(out).toBe(
			'people:\n  - id: a\n    name: A\n    title: t\n    house: h\n    sex: m\n    born: 1\n    died: 2\n    placement: adoptive\n    illegitimate: true\n    link: "[[A]]"\n    notes: n\n',
		);
	});

	it('an empty string removes an optional key, like null (supervisor decision)', () => {
		const src = 'people:\n  - id: a\n    name: A\n    title: T\n    sex: f\n';
		expect(edit(src, person('a', { title: '' }))).toBe('people:\n  - id: a\n    name: A\n    sex: f\n');
		expect(edit(src, person('a', { sex: '   ' }))).toBe('people:\n  - id: a\n    name: A\n    title: T\n');
	});

	it('a full-line comment above a removed key stays (supervisor decision)', () => {
		const src = 'people:\n  - id: a\n    name: A\n    # the title is disputed\n    title: T # end\n    sex: f\n';
		expect(edit(src, person('a', { title: null }))).toBe('people:\n  - id: a\n    name: A\n    # the title is disputed\n    sex: f\n');
	});

	it('a new first key goes above the full-line comments of the old first key (WP5.1 fix)', () => {
		const opt = (src: string) => edit(src, { kind: 'set-option', key: 'focus', value: 'a' });
		expect(opt('options:\n  # size\n  height: 1\n')).toBe('options:\n  focus: a\n  # size\n  height: 1\n');
		expect(opt('options:\n  # one\n  # two\n  height: 1\n')).toBe('options:\n  focus: a\n  # one\n  # two\n  height: 1\n');
		expect(opt('options: # all\n  # size\n  height: 1\n')).toBe('options: # all\n  focus: a\n  # size\n  height: 1\n');
		// A blank line ends the attached comments: the comment above it stays at the top.
		expect(opt('options:\n  # general\n\n  # size\n  height: 1\n')).toBe('options:\n  # general\n\n  focus: a\n  # size\n  height: 1\n');
		expect(edit('people:\n  -\n    # t\n    title: T\n    id: a\n', person('a', { name: 'A' }))).toBe('people:\n  -\n    name: A\n    # t\n    title: T\n    id: a\n');
	});

	it('removes a key on the list dash line; the next key moves up', () => {
		expect(edit('people:\n  - title: T\n    id: a\n    name: A\n', person('a', { title: null }))).toBe('people:\n  - id: a\n    name: A\n');
	});

	it('a key earlier in the order than the dash-line key takes the dash line', () => {
		expect(edit('people:\n  - title: T\n    id: a\n', person('a', { name: 'A' }))).toBe('people:\n  - name: A\n    title: T\n    id: a\n');
	});

	it('removes a block value with all its lines', () => {
		const src = 'people:\n  - id: a\n    name: A\n    notes: |\n      one\n      two\n    sex: f\n';
		expect(edit(src, person('a', { notes: null }))).toBe('people:\n  - id: a\n    name: A\n    sex: f\n');
	});

	it('removes the last key of a body without a final line break', () => {
		expect(edit('people:\n  - id: a\n    name: A\n    sex: f', person('a', { sex: null }))).toBe('people:\n  - id: a\n    name: A');
	});

	it('adds after a block literal that keeps its blank lines', () => {
		const src = 'people:\n  - id: a\n    name: A\n    title: |+\n      x\n\n  - id: b\n    name: B\n';
		expect(edit(src, person('a', { notes: 'N' }))).toBe('people:\n  - id: a\n    name: A\n    title: |+\n      x\n\n    notes: N\n  - id: b\n    name: B\n');
	});
});

describe('flow maps stay flow maps', () => {
	const src = 'people:\n  - {id: a, name: A, born: 1100}\n';
	it('set, add and remove inside the braces', () => {
		expect(edit(src, person('a', { name: 'a, b' }))).toBe('people:\n  - {id: a, name: "a, b", born: 1100}\n');
		expect(edit(src, person('a', { title: 'T', notes: 'N' }))).toBe('people:\n  - {id: a, name: A, title: T, born: 1100, notes: N}\n');
		expect(edit(src, person('a', { born: null }))).toBe('people:\n  - {id: a, name: A}\n');
		expect(edit('people:\n  - {born: 1, id: a}\n', person('a', { born: null }))).toBe('people:\n  - {id: a}\n');
	});

	it('plain text that is only safe outside flow context is quoted', () => {
		expect(edit(src, person('a', { title: 'x]y' }))).toBe('people:\n  - {id: a, name: A, title: "x]y", born: 1100}\n');
	});
});

describe('anchors, aliases and odd shapes', () => {
	it('refuses to change a value that an alias elsewhere shares', () => {
		const src = 'people:\n  - id: a\n    name: &n Foo\n  - id: b\n    name: *n\n';
		expect(applyOp(src, person('a', { name: 'Bar' }))).toMatchObject({ ok: false, code: 'bad-value' });
	});

	it('an alias value can be replaced; the anchor stays', () => {
		const src = 'people:\n  - id: a\n    name: &n Foo\n  - id: b\n    name: *n\n';
		expect(edit(src, person('b', { name: 'Bar' }))).toBe('people:\n  - id: a\n    name: &n Foo\n  - id: b\n    name: Bar\n');
	});

	it('an anchored value that no alias uses can change', () => {
		expect(edit('people:\n  - id: a\n    name: &n Foo\n', person('a', { name: 'Bar' }))).toBe('people:\n  - id: a\n    name: &n Bar\n');
	});

	it('a person written as an alias is refused', () => {
		const src = 'x: &p {id: a, name: A}\npeople:\n  - *p\n';
		expect(applyOp(src, person('a', { name: 'B' }))).toMatchObject({ ok: false, code: 'bad-value' });
	});

	it('duplicate keys are invalid YAML', () => {
		expect(applyOp('people:\n  - id: a\n    name: A\n    name: B\n', person('a', { title: 'T' }))).toMatchObject({ ok: false, code: 'invalid-yaml' });
	});

	it('a person with no id is found by the id the model gives it', () => {
		const src = 'people:\n  - name: Nobody\n';
		const id = nameOf(src, '~1')!.id;
		expect(edit(src, person(id, { title: 'T' }))).toBe('people:\n  - name: Nobody\n    title: T\n');
	});

	it('a house that names no house is allowed', () => {
		expect(edit(ONE, person('a', { house: 'nowhere' }))).toContain('house: nowhere');
	});

	it('bad values are refused', () => {
		expect(applyOp(ONE, person('a', { title: true }))).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp(ONE, person('a', { illegitimate: 'yes' }))).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp(ONE, person('a', { name: '  ' }))).toMatchObject({ ok: false, code: 'bad-value' });
	});

	it('never throws on nonsense input (§8)', () => {
		expect(applyOp(ONE, null as unknown as Op).ok).toBe(false);
		expect(applyOp(ONE, { kind: 'nope' } as unknown as Op).ok).toBe(false);
		expect(applyOp(undefined as unknown as string, person('a', { name: 'B' })).ok).toBe(false);
		expect(applyOp(ONE, { kind: 'set-person-fields', id: 'a' } as unknown as Op)).toEqual({ ok: true, body: ONE, created: [] });
	});
});

describe('CRLF bodies', () => {
	it('new lines use CRLF', () => {
		const src = ONE.replace(/\n/g, '\r\n');
		expect(edit(src, person('a', { title: 'T', notes: 'a\nb' }))).toBe('people:\r\n  - id: a\r\n    name: A\r\n    title: T\r\n    notes: "a\\nb"\r\n');
		expect(edit(src, { kind: 'add-house', name: 'H' })).toBe('houses:\r\n  - id: h\r\n    name: H\r\n\r\npeople:\r\n  - id: a\r\n    name: A\r\n');
	});
});

describe('set-option', () => {
	it('numbers are written plain; ids are text', () => {
		expect(edit(ONE, { kind: 'set-option', key: 'height', value: 600 })).toBe('options:\n  height: 600\n\npeople:\n  - id: a\n    name: A\n');
		expect(edit(ONE, { kind: 'set-option', key: 'start', value: '1102' })).toBe('options:\n  start: 1102\n\npeople:\n  - id: a\n    name: A\n');
		expect(edit(ONE, { kind: 'set-option', key: 'start', value: '0042' })).toBe('options:\n  start: "0042"\n\npeople:\n  - id: a\n    name: A\n');
	});

	it('keeps the §4.1 option order and flow options', () => {
		expect(edit('options:\n  height: 1\n', { kind: 'set-option', key: 'focus', value: 'a' })).toBe('options:\n  focus: a\n  height: 1\n');
		expect(edit('options: {start: a}\n', { kind: 'set-option', key: 'generations', value: 2 })).toBe('options: {start: a, generations: 2}\n');
		expect(edit('options: {start: a}\npeople: []\n', { kind: 'set-option', key: 'start', value: null })).toBe('people: []\n');
	});

	it('removing options keeps the blank line that separates the sections around it', () => {
		const src = 'houses:\n  - id: h\n    name: H\noptions:\n  start: a\n\npeople:\n  - id: a\n    name: A\n';
		expect(edit(src, { kind: 'set-option', key: 'start', value: null })).toBe('houses:\n  - id: h\n    name: H\n\npeople:\n  - id: a\n    name: A\n');
		const spaced = 'houses:\n  - id: h\n    name: H\n\noptions:\n  start: a\n\npeople:\n  - id: a\n    name: A\n';
		expect(edit(spaced, { kind: 'set-option', key: 'start', value: null })).toBe('houses:\n  - id: h\n    name: H\n\npeople:\n  - id: a\n    name: A\n');
	});

	it('fills an empty options key', () => {
		expect(edit('options:\npeople: []\n', { kind: 'set-option', key: 'start', value: 'a' })).toBe('options:\n  start: a\npeople: []\n');
	});

	it('refuses bad numbers and options that are not a map', () => {
		expect(applyOp(ONE, { kind: 'set-option', key: 'height', value: 'tall' })).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp(ONE, { kind: 'set-option', key: 'height', value: -3 })).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp('options: [a]\n', { kind: 'set-option', key: 'start', value: 'a' })).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp(ONE, { kind: 'set-option', key: 'colour', value: 'a' } as unknown as Op)).toMatchObject({ ok: false, code: 'bad-value' });
	});

	it('removing an option that is not there changes nothing', () => {
		expect(edit(ONE, { kind: 'set-option', key: 'focus', value: null })).toBe(ONE);
	});

	it('an empty body gets an options section', () => {
		expect(edit('', { kind: 'set-option', key: 'start', value: 'a' })).toBe('options:\n  start: a');
		// A final line break stays last (M6 supervisor decision, from the D34 acceptance tests).
		expect(edit('# only a comment\n', { kind: 'set-option', key: 'start', value: 'a' })).toBe('# only a comment\noptions:\n  start: a\n');
		expect(edit('# only a comment', { kind: 'set-option', key: 'start', value: 'a' })).toBe('# only a comment\noptions:\n  start: a');
	});
});

describe('add-house', () => {
	it('ids follow §6.8 in the house namespace', () => {
		expect(applyOp(ONE, { kind: 'add-house', name: 'Þórr’s Hall' })).toMatchObject({ ok: true, created: ['thorr-s-hall'] });
		expect(applyOp(ONE, { kind: 'add-house', name: '1066' })).toMatchObject({ ok: true, created: ['p-1066'] });
		expect(applyOp(ONE, { kind: 'add-house', name: '!!!' })).toMatchObject({ ok: true, created: ['person'] });
		expect(newHouseId({ houses: [{ id: 'a' }, { id: 'a-2' }] }, 'A')).toBe('a-3');
	});

	it('a new id that looks like a number is written plain; the colour is quoted', () => {
		expect(edit('houses:\n  - id: x\n    name: X\n', { kind: 'add-house', name: '1066', color: '#123456' })).toBe(
			'houses:\n  - id: x\n    name: X\n  - id: p-1066\n    name: "1066"\n    color: "#123456"\n',
		);
	});

	it('follows the style of the list: flow items and flow lists', () => {
		expect(edit('houses:\n  - {id: x, name: X}\n', { kind: 'add-house', name: 'Y' })).toBe('houses:\n  - {id: x, name: X}\n  - {id: y, name: Y}\n');
		expect(edit('houses: [{id: x, name: X}]\n', { kind: 'add-house', name: 'Y' })).toBe('houses: [{id: x, name: X}, {id: y, name: Y}]\n');
		expect(edit('houses: []\n', { kind: 'add-house', name: 'Y' })).toBe('houses: [{id: y, name: Y}]\n');
	});

	it('fills an empty houses key and refuses a houses key that is not a list', () => {
		expect(edit('houses:\npeople: []\n', { kind: 'add-house', name: 'Y' })).toBe('houses:\n  - id: y\n    name: Y\npeople: []\n');
		expect(applyOp('houses: x\n', { kind: 'add-house', name: 'Y' })).toMatchObject({ ok: false, code: 'bad-value' });
	});

	it('a top-level flow map gets the section inside the braces', () => {
		expect(edit('{people: []}', { kind: 'add-house', name: 'Y' })).toBe('{houses: [{id: y, name: Y}], people: []}');
	});
});

describe('batch', () => {
	it('collects created ids and applies later ops to the new body', () => {
		const r = applyOp(ONE, {
			kind: 'batch',
			ops: [
				{ kind: 'add-house', name: 'Valmont' },
				{ kind: 'add-house', name: 'Valmont' },
				{ kind: 'set-person-fields', id: 'a', fields: { house: 'valmont-2' } },
			],
		});
		expect(r).toMatchObject({ ok: true, created: ['valmont', 'valmont-2'] });
		expect(nameOf(body(r), 'a')?.house).toBe('valmont-2');
	});

	it('an empty batch changes nothing', () => {
		expect(applyOp(ONE, { kind: 'batch', ops: [] })).toEqual({ ok: true, body: ONE, created: [] });
	});
});

describe('review 2.2 fixes', () => {
	it('F1: a value with a fence line is never written as block-scalar lines that Markdown reads as a fence', () => {
		const src = 'people:\n- id: a\n  name: A\n  notes: |\n   old\n';
		expect(edit(src, person('a', { notes: 'see:\n```\nend' }))).toBe('people:\n- id: a\n  name: A\n  notes: "see:\\n```\\nend"\n');
		// With 4 or more spaces the line is indented code inside the fence, so the literal can stay.
		const deep = 'people:\n  - id: a\n    name: A\n    notes: |\n      old\n';
		expect(edit(deep, person('a', { notes: 'see:\n~~~\nend' }))).toBe('people:\n  - id: a\n    name: A\n    notes: |-\n      see:\n      ~~~\n      end\n');
	});

	it('F2: removing the dash-line key keeps the comment above the next key', () => {
		const src = 'people:\n  - title: T\n    # about the name\n    name: A\n    id: a\n';
		expect(edit(src, person('a', { title: null }))).toBe('people:\n  - # about the name\n    name: A\n    id: a\n');
	});

	it('F2: removing a key from a multi-line flow map keeps comments on other keys', () => {
		expect(edit('people:\n  - {id: a, # first\n     title: T, name: A}\n', person('a', { title: null }))).toBe('people:\n  - {id: a, # first\n     name: A}\n');
		const last = edit('people:\n  - {id: a, name: A, # c\n     title: T}\n', person('a', { title: null }));
		expect(last).toContain('# c');
		expect(nameOf(last, 'a')?.title).toBeUndefined();
	});

	it('F2: a comment after the removed pair and its comma stays', () => {
		expect(edit('people:\n  - {id: a, title: T, # kept\n     name: A}\n', person('a', { title: null }))).toBe('people:\n  - {id: a, # kept\n     name: A}\n');
	});

	it('F2: the comment guard refuses a change that would drop a comment', () => {
		const src = 'people:\n  - id: a\n    name:\n      - A # a comment inside the old value\n';
		expect(applyOp(src, person('a', { name: 'B' }))).toMatchObject({ ok: false, code: 'bad-value' });
	});

	it('F2: the removed key takes the comments on its own lines', () => {
		const src = 'people:\n  - id: a\n    name: A\n    # above\n    notes: |  # header\n      x\n    sex: f # end\n';
		expect(edit(src, person('a', { notes: null, sex: null }))).toBe('people:\n  - id: a\n    name: A\n    # above\n');
	});

	it('F3: a block-scalar line starting with # is text, not a comment above the next key', () => {
		const src = 'people:\n  - id: a\n    name: A\n    bio: |\n      Born in the north.\n      #valmont\n    born: 1100\n';
		expect(edit(src, person('a', { title: 'T' }))).toBe('people:\n  - id: a\n    name: A\n    bio: |\n      Born in the north.\n      #valmont\n    title: T\n    born: 1100\n');
	});

	it('several fields are written from one parse, and one at a time when two changes touch', () => {
		const src = 'people:\n  - id: a\n    name: A\n    title: T\n';
		expect(edit(src, person('a', { title: null, notes: 'N' }))).toBe('people:\n  - id: a\n    name: A\n    notes: N\n');
		expect(edit(src, person('a', { title: null, sex: 'f', house: 'h', born: '1' }))).toBe('people:\n  - id: a\n    name: A\n    house: h\n    sex: f\n    born: 1\n');
	});

	it('a plain null value can be replaced; removing it leaves it, since it already means nothing', () => {
		const src = 'people:\n  - id: a\n    name: A\n    title: ~\n';
		expect(edit(src, person('a', { title: 'T' }))).toBe('people:\n  - id: a\n    name: A\n    title: T\n');
		expect(edit(src, person('a', { title: null }))).toBe(src);
		expect(edit(src, person('a', { title: 'null' }))).toBe('people:\n  - id: a\n    name: A\n    title: "null"\n');
	});
});
