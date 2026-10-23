import { describe, expect, it } from 'vitest';
import type { EditResult, Op } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { fixture } from '../support/helpers';

// Unit tests for the M6 house ops (spec §6.10, D32): edit-house and delete-house.

function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
const edit = (src: string, op: Op) => body(applyOp(src, op));
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};
function tree(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
}

const HOUSES = [
	'houses:',
	'  - id: harrow',
	'    name: House Harrow',
	'    color: "#5b2a86"          # quoted, or YAML reads a comment',
	"    motto: 'Root and branch'  # unknown key in a house",
	'  # Quill came later',
	'  - id: quill',
	"    name: 'House Quill'",
	"    color: '#2a6f86'",
	'',
	'people:',
	'  - id: a',
	'    name: A',
	'    house: harrow   # heir',
	'  - {id: b, name: B, house: harrow, sex: f}',
	'  - id: c',
	'    name: C',
	'    house: quill',
	'',
].join('\n');

describe('edit-house', () => {
	it('renames a house and changes only its name', () => {
		const out = edit(HOUSES, { kind: 'edit-house', id: 'harrow', name: 'House Harrow of Greyfen' });
		expect(out).toBe(HOUSES.replace('name: House Harrow\n', 'name: House Harrow of Greyfen\n'));
	});

	it('a renamed value keeps its quotes', () => {
		const out = edit(HOUSES, { kind: 'edit-house', id: 'quill', name: 'House Quill-Marsh' });
		expect(out).toBe(HOUSES.replace("name: 'House Quill'", "name: 'House Quill-Marsh'"));
	});

	it('a name that plain YAML misreads is quoted', () => {
		const out = edit(HOUSES, { kind: 'edit-house', id: 'harrow', name: 'true' });
		expect(out).toContain('    name: "true"\n');
		expect(tree(out).houses[0].name).toBe('true');
	});

	it('a new colour is always in double quotes, and the comment after it stays', () => {
		const a = edit(HOUSES, { kind: 'edit-house', id: 'harrow', color: '#123456' });
		expect(a).toBe(HOUSES.replace('"#5b2a86"', '"#123456"'));
		const b = edit(HOUSES, { kind: 'edit-house', id: 'quill', color: '#abcdef' });
		expect(b).toBe(HOUSES.replace("color: '#2a6f86'", 'color: "#abcdef"'));
	});

	it('the same colour changes nothing, also in other quotes', () => {
		expect(edit(HOUSES, { kind: 'edit-house', id: 'quill', color: '#2a6f86' })).toBe(HOUSES);
		expect(edit(HOUSES, { kind: 'edit-house', id: 'harrow', name: 'House Harrow', color: '#5b2a86' })).toBe(HOUSES);
		expect(edit(HOUSES, { kind: 'edit-house', id: 'harrow' })).toBe(HOUSES);
	});

	it('name and colour in one op', () => {
		const out = edit(HOUSES, { kind: 'edit-house', id: 'quill', name: 'Quill', color: '#000000' });
		expect(out).toBe(HOUSES.replace("name: 'House Quill'\n    color: '#2a6f86'", "name: 'Quill'\n    color: \"#000000\""));
	});

	it('color null removes the key with its end-of-line comment', () => {
		const out = edit(HOUSES, { kind: 'edit-house', id: 'harrow', color: null });
		expect(out).toBe(HOUSES.replace('    color: "#5b2a86"          # quoted, or YAML reads a comment\n', ''));
		expect(edit(out, { kind: 'edit-house', id: 'harrow', color: null })).toBe(out);
		// An empty colour removes the key too (M2 rule for empty optional fields).
		expect(edit(HOUSES, { kind: 'edit-house', id: 'harrow', color: '' })).toBe(out);
		expect(edit(HOUSES, { kind: 'edit-house', id: 'harrow', color: '  ' })).toBe(out);
	});

	it('upper-case hex is accepted and written as given', () => {
		expect(edit(HOUSES, { kind: 'edit-house', id: 'harrow', color: '#5B2A86' })).toBe(HOUSES.replace('"#5b2a86"', '"#5B2A86"'));
	});

	it('a missing colour goes after the known keys; unknown keys do not decide the place', () => {
		const src = 'houses:\n  - id: h\n    name: H\n    motto: M\n';
		expect(edit(src, { kind: 'edit-house', id: 'h', color: '#a1b2c3' })).toBe('houses:\n  - id: h\n    name: H\n    motto: M\n    color: "#a1b2c3"\n');
		const noName = 'houses:\n  - id: h\n    color: "#111111"\n';
		expect(edit(noName, { kind: 'edit-house', id: 'h', name: 'H' })).toBe('houses:\n  - id: h\n    name: H\n    color: "#111111"\n');
	});

	it('replaces a colour that YAML read as a comment', () => {
		const src = 'houses:\n  - id: h\n    name: H\n    color: #8b1e3f\n';
		expect(tree(src).houses[0].color).toBeUndefined();
		expect(edit(src, { kind: 'edit-house', id: 'h', color: '#8b1e3f' })).toBe('houses:\n  - id: h\n    name: H\n    color: "#8b1e3f"\n');
		expect(edit(src, { kind: 'edit-house', id: 'h', color: '#000000' })).toBe('houses:\n  - id: h\n    name: H\n    color: "#000000"\n');
	});

	it('the rest of such a comment stays a comment', () => {
		const a = 'houses:\n  - id: h\n    name: H\n    color: #8b1e3f  # red\n';
		expect(edit(a, { kind: 'edit-house', id: 'h', color: '#000000' })).toBe('houses:\n  - id: h\n    name: H\n    color: "#000000"  # red\n');
		const b = 'houses:\n  - id: h\n    name: H\n    color: #8b1e3f red\n';
		const out = edit(b, { kind: 'edit-house', id: 'h', color: '#000000' });
		expect(out).toBe('houses:\n  - id: h\n    name: H\n    color: "#000000" # red\n');
		expect(tree(out).houses[0].color).toBe('#000000');
	});

	it('an empty colour value gets the colour; a comment that is not a colour stays', () => {
		const a = 'houses:\n  - id: h\n    name: H\n    color:\n';
		expect(edit(a, { kind: 'edit-house', id: 'h', color: '#000000' })).toBe('houses:\n  - id: h\n    name: H\n    color: "#000000"\n');
		const b = 'houses:\n  - id: h\n    name: H\n    color: # none yet\n';
		expect(edit(b, { kind: 'edit-house', id: 'h', color: '#000000' })).toBe('houses:\n  - id: h\n    name: H\n    color: "#000000" # none yet\n');
	});

	it('acts on the first house with the id', () => {
		const src = 'houses:\n  - id: h\n    name: One\n  - id: h\n    name: Two\n';
		expect(edit(src, { kind: 'edit-house', id: 'h', name: 'First' })).toBe('houses:\n  - id: h\n    name: First\n  - id: h\n    name: Two\n');
	});

	it('works on a flow-map house', () => {
		const src = 'houses: [{id: h, name: H}]\n';
		expect(edit(src, { kind: 'edit-house', id: 'h', name: 'Hx', color: '#010203' })).toBe('houses: [{id: h, name: Hx, color: "#010203"}]\n');
		const src2 = 'houses:\n  - {id: h, name: H, color: "#111111"}\n';
		expect(edit(src2, { kind: 'edit-house', id: 'h', color: null })).toBe('houses:\n  - {id: h, name: H}\n');
	});

	it('keeps CRLF line breaks', () => {
		const src = 'houses:\r\n  - id: h\r\n    name: H\r\n';
		expect(edit(src, { kind: 'edit-house', id: 'h', color: '#000000' })).toBe('houses:\r\n  - id: h\r\n    name: H\r\n    color: "#000000"\r\n');
	});

	it('refusals', () => {
		expect(code(HOUSES, { kind: 'edit-house', id: 'nobody', name: 'X' })).toBe('unknown-house');
		expect(code('people: []\n', { kind: 'edit-house', id: 'h', name: 'X' })).toBe('unknown-house');
		expect(code(HOUSES, { kind: 'edit-house', id: 'harrow', name: '' })).toBe('bad-value');
		expect(code(HOUSES, { kind: 'edit-house', id: 'harrow', name: '   ' })).toBe('bad-value');
		for (const color of ['red', '#abc', '#aabbccdd', '5b2a86', '#gggggg', ' #aabbcc']) expect(code(HOUSES, { kind: 'edit-house', id: 'harrow', color })).toBe('bad-value');
		expect(code(HOUSES, { kind: 'edit-house', id: 'harrow', name: 3 as unknown as string })).toBe('bad-value');
		const blocked = HOUSES + '  - id: a\n    name: A again\n';
		expect(code(blocked, { kind: 'edit-house', id: 'harrow', name: 'X' })).toBe('blocked');
	});

	it('an alias house is refused, not changed twice', () => {
		const src = 'houses:\n  - &h {id: h, name: H}\n  - *h\n';
		expect(code(src, { kind: 'edit-house', id: 'h', name: 'X' })).toBe('bad-value');
	});
});

describe('delete-house', () => {
	it("'keep' removes only the house item; comments above it stay", () => {
		const out = edit(HOUSES, { kind: 'delete-house', id: 'quill', people: 'keep' });
		expect(out).toBe(HOUSES.replace("  - id: quill\n    name: 'House Quill'\n    color: '#2a6f86'\n", ''));
		expect(tree(out).people.find((p) => p.id === 'c')?.house).toBe('quill');
	});

	it("'clear' also removes house from its people, block and flow maps", () => {
		const out = edit(HOUSES, { kind: 'delete-house', id: 'harrow', people: 'clear' });
		expect(out).toBe(
			[
				'houses:',
				'  # Quill came later',
				'  - id: quill',
				"    name: 'House Quill'",
				"    color: '#2a6f86'",
				'',
				'people:',
				'  - id: a',
				'    name: A',
				'  - {id: b, name: B, sex: f}',
				'  - id: c',
				'    name: C',
				'    house: quill',
				'',
			].join('\n'),
		);
	});

	it('the last house removes the houses section and its blank line', () => {
		const src = 'houses:\n  - id: h\n    name: H\n\npeople:\n  - id: a\n    name: A\n    house: h\n';
		expect(edit(src, { kind: 'delete-house', id: 'h', people: 'clear' })).toBe('people:\n  - id: a\n    name: A\n');
		expect(edit(src, { kind: 'delete-house', id: 'h', people: 'keep' })).toBe('people:\n  - id: a\n    name: A\n    house: h\n');
	});

	it('removals that meet at the end of the body do not leave a line break', () => {
		// The person's house line and the last section merge into one removal up to the end.
		const src = 'people:\n  - id: a\n    name: A\n    house: h\n\nhouses:\n  - id: h\n    name: H';
		expect(edit(src, { kind: 'delete-house', id: 'h', people: 'clear' })).toBe('people:\n  - id: a\n    name: A');
		const crlf = src.replace(/\n/g, '\r\n');
		expect(edit(crlf, { kind: 'delete-house', id: 'h', people: 'clear' })).toBe('people:\r\n  - id: a\r\n    name: A');
	});

	it('a house with the same id left: people keep their house', () => {
		const src = 'houses:\n  - id: h\n    name: One\n  - id: h\n    name: Two\npeople:\n  - id: a\n    name: A\n    house: h\n';
		expect(edit(src, { kind: 'delete-house', id: 'h', people: 'clear' })).toBe('houses:\n  - id: h\n    name: Two\npeople:\n  - id: a\n    name: A\n    house: h\n');
	});

	it('a flow list of houses', () => {
		const src = 'houses: [{id: a, name: A}, {id: b, name: B}]\npeople: [{id: x, name: X, house: b}]\n';
		expect(edit(src, { kind: 'delete-house', id: 'b', people: 'clear' })).toBe('houses: [{id: a, name: A}]\npeople: [{id: x, name: X}]\n');
	});

	it('a person written as an alias is cleared through the item it points to', () => {
		const src = 'houses:\n  - id: h\n    name: H\npeople:\n  - &a\n    id: a\n    name: A\n    house: h\n  - *a\n';
		const r = applyOp(src, { kind: 'delete-house', id: 'h', people: 'clear' });
		// Duplicate person ids block editing; the op refuses before it looks at the house.
		expect(r.ok ? 'ok' : r.code).toBe('blocked');
		// An alias to a map outside `people`: clearing it would change that map too, so it is refused.
		const outside = 'tpl: &t {name: T, house: h}\nhouses:\n  - id: h\n    name: H\npeople:\n  - *t\n';
		expect(code(outside, { kind: 'delete-house', id: 'h', people: 'clear' })).toBe('bad-value');
		expect(edit(outside, { kind: 'delete-house', id: 'h', people: 'keep' })).toBe('tpl: &t {name: T, house: h}\npeople:\n  - *t\n');
	});

	it('refusals', () => {
		expect(code(HOUSES, { kind: 'delete-house', id: 'nobody', people: 'keep' })).toBe('unknown-house');
		expect(code(HOUSES, { kind: 'delete-house', id: 'harrow', people: 'maybe' as 'keep' })).toBe('bad-value');
		expect(code('not: [valid', { kind: 'delete-house', id: 'h', people: 'keep' })).toBe('invalid-yaml');
	});

	it('a batch: delete one house and rename another in one write', () => {
		const out = edit(HOUSES, {
			kind: 'batch',
			ops: [
				{ kind: 'delete-house', id: 'harrow', people: 'keep' },
				{ kind: 'edit-house', id: 'quill', name: 'Quill' },
			],
		});
		expect(tree(out).houses.map((h) => [h.id, h.name])).toEqual([['quill', 'Quill']]);
		expect(out).toContain('  # Quill came later\n');
		expect(out).toContain('    house: harrow   # heir\n');
	});
});

describe('house ops on the sample trees', () => {
	const changedLines = (a: string, b: string) => {
		const x = a.split('\n');
		const y = b.split('\n');
		return { removed: x.filter((l) => !y.includes(l)), added: y.filter((l) => !x.includes(l)) };
	};

	it('fixture 9: a new colour changes only that line', () => {
		const src = fixture('09');
		const out = edit(src, { kind: 'edit-house', id: 'quill', color: '#336699' });
		expect(changedLines(src, out)).toEqual({ removed: ["    color: '#2a6f86'"], added: ['    color: "#336699"'] });
	});

	it("fixture 9: delete with 'clear' removes the item and each person's house line", () => {
		const src = fixture('09');
		const out = edit(src, { kind: 'delete-house', id: 'quill', people: 'clear' });
		expect(changedLines(src, out).added).toEqual([]);
		expect(changedLines(src, out).removed).toEqual(['  - id: quill', "    name: 'House Quill'","    color: '#2a6f86'", '    house: quill']);
		expect(out.split('\n').length).toBe(src.split('\n').length - 4);
		expect(tree(out).people.some((p) => p.house === 'quill')).toBe(false);
	});

	it('fixture 10: an unquoted colour (read as a comment) is replaced', () => {
		const src = fixture('10');
		const out = edit(src, { kind: 'edit-house', id: 'valmont', color: '#8b1e3f' });
		expect(changedLines(src, out)).toEqual({ removed: ['    color: #8b1e3f'], added: ['    color: "#8b1e3f"'] });
		expect(tree(out).houses[0].color).toBe('#8b1e3f');
	});
});

describe('Insert family tree (D34)', () => {
	it('add-person on a body with only a help comment keeps the comment', () => {
		const src = '# Add people with the Add person button.\n# Each person needs an id and a name.\n';
		const out = edit(src, { kind: 'add-person', id: 'a', fields: { name: 'A' } });
		expect(out).toBe(src + 'people:\n  - id: a\n    name: A\n');
		expect(tree(out).people.map((p) => p.id)).toEqual(['a']);
		const crlf = '# help\r\n';
		expect(edit(crlf, { kind: 'add-person', id: 'a', fields: { name: 'A' } })).toBe('# help\r\npeople:\r\n  - id: a\r\n    name: A\r\n');
		expect(edit('# help', { kind: 'add-person', id: 'a', fields: { name: 'A' } })).toBe('# help\npeople:\n  - id: a\n    name: A');
	});
});
