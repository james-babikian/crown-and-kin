import { describe, expect, it, vi } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseBody, parseDynasty, readTree } from '../../src/core/parse';

const ok = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree;
};

describe('parseDynasty', () => {
	it('keeps free-text values exactly as written', () => {
		const t = ok('people:\n  - id: a\n    name: A\n    born: 1102-03-04\n    died: 0042\n');
		expect(t.people[0].born).toBe('1102-03-04');
		expect(t.people[0].died).toBe('0042');
	});

	it('treats numeric ids as strings', () => {
		const t = ok('people:\n  - id: 1102\n    name: A\n  - id: b\n    name: B\n    parents: [1102]\n');
		expect(t.people[0].id).toBe('1102');
		expect(t.people[1].parents).toEqual([{ id: '1102', type: 'birth' }]);
	});

	it('flattens an unquoted [[link]]', () => {
		const t = ok('people:\n  - id: a\n    name: A\n    link: [[Wren of the Marches]]\n');
		expect(t.people[0].link).toBe('[[Wren of the Marches]]');
	});

	it('reads an unquoted [[link]] with commas as written, without a comment after it', () => {
		const t = ok('people:\n  - id: a\n    link: [[Smith, John,Jr]]  # the scribe forgot quotes\n  - {id: b, link: [[Wren, of the Marches]]}\n');
		expect(t.people.map((p) => p.link)).toEqual(['[[Smith, John,Jr]]', '[[Wren, of the Marches]]']);
	});

	it('warns about an unquoted #colour', () => {
		const t = ok('houses:\n  - id: v\n    name: V\n    color: #8b1e3f\n');
		expect(t.houses[0].color).toBeUndefined();
		expect(t.issues).toMatchObject([{ code: 'house-color-null', level: 'warning', params: { id: 'v', value: '#8b1e3f' } }]);
	});

	it('reads object-form parents and a single string where a list was expected', () => {
		const t = ok('people:\n  - id: c\n    name: C\n    parents: [a, {id: b, type: rumoured}]\n  - id: d\n    name: D\n    parents: a\n');
		expect(t.people[0].parents).toEqual([
			{ id: 'a', type: 'birth' },
			{ id: 'b', type: 'rumoured' },
		]);
		expect(t.people[1].parents).toEqual([{ id: 'a', type: 'birth' }]);
	});

	it('reads booleans and options', () => {
		const t = ok('options:\n  start: a\n  generations: 2\npeople:\n  - id: a\n    name: A\n    illegitimate: true\n');
		expect(t.people[0].illegitimate).toBe(true);
		expect(t.options).toMatchObject({ start: 'a', generations: 2 });
	});

	it('returns an empty tree for an empty block', () => {
		expect(ok('').people).toEqual([]);
	});

	it('reports invalid YAML with a line number', () => {
		const r = parseDynasty('people:\n  - id: a\n    parents: [b\n  - id: c\n');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.line).toBeGreaterThan(0);
	});

	it('rejects a block that is not a map', () => {
		expect(parseDynasty('- a\n- b\n')).toEqual({ ok: false, error: { code: 'not-a-map' } });
	});
});

describe('parseDynasty: shape issues and hard errors', () => {
	const codes = (src: string) => ok(src).issues.map((i) => i.code);

	it('reports an entry that is not a map, and skips it', () => {
		const t = ok('people:\n  - just text\n  - id: a\n    name: A\nhouses:\n  - [x]\nunions:\n  - 7\n');
		expect(t.people.map((p) => p.id)).toEqual(['a']);
		expect(t.issues).toMatchObject([
			{ code: 'entry-not-map', params: { section: 'houses', index: 1 } },
			{ code: 'entry-not-map', params: { section: 'people', index: 1 } },
			{ code: 'entry-not-map', params: { section: 'unions', index: 1 } },
		]);
	});

	it('keeps a person with no id under an id nobody wrote, and reports it', () => {
		const t = ok('people:\n  - name: Aldric\n  - id: "~1"\n    name: Tilde\n');
		expect(t.people.map((p) => p.id)).toEqual(['~~1', '~1']);
		expect(t.issues).toEqual([{ code: 'missing-id', level: 'warning', params: { section: 'people', index: 1, name: 'Aldric', example: 'p1' }, ids: ['~~1'] }]);
	});

	it('gives a person with no id an id that no reference uses (review F2)', () => {
		const t = ok('options: {start: "~1", focus: "~~1"}\npeople:\n  - name: X\n  - id: b\n    parents: ["~~~1", {id: "~~~~1"}]\nunions:\n  - partners: ["~~~~~1", b]\n');
		expect(t.people[0].id).toBe('~~~~~~1');
		const g = deriveFamilies(ok('people:\n  - name: X\n  - id: b\n    parents: ["~1"]\n'));
		expect(g.issues.map((i) => i.code)).toContain('missing-parent');
		expect(g.placementParents.get('b')).toEqual([]);
	});

	it('drops a house with no id, and reports it', () => {
		const t = ok('houses:\n  - name: House Valmont\n');
		expect(t.houses).toEqual([]);
		expect(t.issues).toMatchObject([{ code: 'missing-id', params: { section: 'houses', index: 1, name: 'House Valmont' } }]);
	});

	it('reports parent entries with no id or the wrong form, naming the person', () => {
		const t = ok('people:\n  - id: c\n    name: Cara\n    parents: [{type: adoptive}, [x], a]\n');
		expect(t.people[0].parents).toEqual([{ id: 'a', type: 'birth' }]);
		expect(t.issues).toMatchObject([
			{ code: 'missing-id', params: { section: 'parents', index: 1, person: 'Cara' }, ids: ['c'] },
			{ code: 'entry-not-map', params: { section: 'parents', index: 2, person: 'Cara' }, ids: ['c'] },
		]);
	});

	it('reports a section of the wrong shape and ignores it', () => {
		expect(codes('people: Aldric and Isolde\n')).toEqual(['section-wrong-shape']);
		expect(codes('options: [start, focus]\n')).toEqual(['section-wrong-shape']);
		expect(ok('options: [start]\n').options).toEqual({});
		expect(codes('houses: {id: h, name: H}\n')).toEqual(['section-wrong-shape']);
		expect(ok('houses: {id: h, name: H}\n').houses).toEqual([]);
	});

	it('accepts empty sections without an issue', () => {
		expect(ok('houses: []\npeople:\nunions: ""\noptions:\n')).toEqual({ options: {}, houses: [], people: [], unions: [], issues: [] });
	});

	it('tolerates a single parent written as a map instead of a list', () => {
		expect(ok('people:\n  - id: c\n    name: C\n    parents: {id: a, type: ward}\n').people[0].parents).toEqual([{ id: 'a', type: 'ward' }]);
	});

	it('house-color-null without a recoverable colour has no value', () => {
		const t = ok('houses:\n  - id: v\n    name: V\n    color:\n');
		expect(t.issues).toEqual([{ code: 'house-color-null', level: 'warning', params: { house: 'V', id: 'v' }, ids: ['v'] }]);
	});

	it('recovers a short colour followed by a real comment', () => {
		expect(ok('houses:\n  - id: v\n    color: #abc  # the scribe forgot quotes\n').issues).toMatchObject([{ code: 'house-color-null', params: { value: '#abc' } }]);
	});

	it('gives the parser message without the position, and the line', () => {
		const r = parseDynasty('people:\n  - id: aldric\n    name: Aldric: Duke\n');
		expect(r).toEqual({ ok: false, error: { code: 'yaml-invalid', line: 3, detail: 'Nested mappings are not allowed in compact mappings' } });
	});

	it('turns alias problems into yaml-invalid instead of throwing', () => {
		expect(parseDynasty('houses: *nowhere\n')).toMatchObject({ ok: false, error: { code: 'yaml-invalid' } });
		const bomb = 'a: &a [x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c, *c, *c, *c, *c]\n';
		expect(parseDynasty(bomb)).toMatchObject({ ok: false, error: { code: 'yaml-invalid' } });
	});

	it('allows as many alias uses as the text is long, and no more', () => {
		const people = (n: number) => ['houses: [{id: &h v}]', 'people:', ...Array.from({ length: n }, (_, i) => `  - {id: p${i}, house: *h}`)].join('\n');
		expect(ok(people(500)).people.filter((p) => p.house === 'v')).toHaveLength(500);
		// A use of `*b` counts 60, one for each alias in it: 60 uses (3600) pass the text length (about 700).
		const wide = `a: &a [${Array(60).fill('x').join(', ')}]\nb: &b [${Array(60).fill('*a').join(', ')}]\nc: [${Array(60).fill('*b').join(', ')}]\n`;
		expect(parseDynasty(wide)).toMatchObject({ ok: false, error: { code: 'yaml-invalid' } });
	});

	it('never writes to the console, even when the yaml package has warnings', () => {
		const spies = [vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(process, 'emitWarning')];
		try {
			parseDynasty('people: !custom x\n');
			parseDynasty('? [1, 2]\n: x\npeople: []\n');
			parseDynasty('born: !!timestamp 2001-12-14\n');
			for (const s of spies) expect(s).not.toHaveBeenCalled();
		} finally {
			for (const s of spies) s.mockRestore();
		}
	});

	it('keeps an explicitly tagged number or date usable as text', () => {
		const t = ok('people:\n  - id: !!int 7\n    name: Seven\n    born: !!timestamp 2001-12-14\n');
		expect(t.people[0]).toMatchObject({ id: '7', born: '2001-12-14' });
	});
});

describe('parseBody: the one parse for reading and editing', () => {
	it('reports a top level that is not a map, and accepts an empty or comment-only body', () => {
		expect(parseBody('- a\n')).toMatchObject({ ok: false, error: { code: 'not-a-map' } });
		expect(parseBody('text')).toMatchObject({ ok: false, error: { code: 'not-a-map' } });
		expect(parseBody('')).toMatchObject({ ok: true });
		expect(parseBody('# nothing yet\n')).toMatchObject({ ok: true });
	});

	it('readTree on its document gives the same model as parseDynasty', () => {
		const src = 'options:\n  start: 0042\npeople:\n  - id: 0042\n    name: A\n    born: 1102-03-04\n  - id: 42\n    name: B\n    parents: [0042]\n';
		const p = parseBody(src);
		if (!p.ok) throw new Error(p.error.code);
		expect(readTree(p.doc, p.data, src)).toEqual(ok(src));
	});

	it('keeps free text that the core schema would retype (failsafe schema, the decision notes)', () => {
		const t = ok('people:\n  - id: a\n    name: 1e3\n    title: "null"\n    born: 1.10\n    died: True\n');
		expect(t.people[0]).toMatchObject({ name: '1e3', title: 'null', born: '1.10', died: 'True' });
	});

	it('a plain ~, null, Null, NULL or empty value is nothing written; quoted it is text', () => {
		const t = ok('people:\n  - id: a\n    name: ~\n    title: null\n    house: Null\n    sex: NULL\n    born:\n    died: "~"\n    notes: \'null\'\n');
		expect(t.people[0]).toMatchObject({ name: 'a', title: undefined, house: undefined, sex: undefined, born: undefined, died: '~', notes: 'null' });
		expect(t.issues).toEqual([]);
	});

	it('color: null and color: ~ warn like an unquoted #colour', () => {
		for (const v of ['null', '~', 'NULL']) {
			const t = ok(`houses:\n  - id: v\n    name: V\n    color: ${v}\n`);
			expect(t.houses[0].color).toBeUndefined();
			expect(t.issues).toMatchObject([{ code: 'house-color-null' }]);
		}
		expect(ok('houses:\n  - id: v\n    name: V\n    color: "null"\n').houses[0].color).toBe('null');
	});

	it('a key named null stays a key', () => {
		expect(ok('people:\n  - id: a\n    name: A\n    null: x\n').people[0].name).toBe('A');
	});
});
