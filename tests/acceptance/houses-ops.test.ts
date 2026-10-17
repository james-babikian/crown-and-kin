import { describe, expect, it } from 'vitest';
import type { PlanWrite } from '../../src/core/block-write';
import * as locate from '../../src/core/block-locate';
import * as write from '../../src/core/block-write';
import { deriveFamilies } from '../../src/core/derive';
import type { ApplyOp, EditRefusal, EditResult, Op } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import type { Tree } from '../../src/core/types';
import * as edit from '../../src/core/yaml-edit';
import { golden, replaceOnce } from './golden';
import { allFixtures, fixtureNote, fixtureSource, topLevelBlocks } from './load';

// The Houses window (spec §6.10, D32): rename and recolour a house, delete a house. Contract
// (M6 after the design gate, src/core/edit.ts, the decision notes "M6 design gate"): `EditHouse`
// changes only the given fields of the first house with the id; `color: null` removes the colour;
// a colour must be `#rrggbb` (else `bad-value`) and is always written in double quotes; an empty
// name is `bad-value`; a colour that YAML read as an end-of-line comment (unquoted `#…`) is
// replaced; the id never changes (§4.1). `DeleteHouse` with `people: 'clear'` also removes
// `house:` from every person of that house (also people with no written id); with `'keep'` those
// people keep a dangling `house:` and the tree gives one missing-house warning per person (§8).
// Unknown house → `unknown-house`.
//
// Formatting follows §6.2 and the decision notes "How a changed value is written", "Formatting details
// fixed by the WP2.1 tests" and "Relationship-op details" (which lines an item owns). Every
// expected text is hand-written in tests/golden/09-house-*.yaml or built here by replacing exact
// lines of the input.
//
// Reading of the rules for an empty `houses` list (test-author, WP6.1): deleting the last house
// removes the whole `houses` section, like the last option (M2) and the last union (M3): with the
// one blank line that separated it from the next section, or, when it is the last section, with
// the blank lines before it. A section is never left as `houses:` with no items, nor as `houses: []`.

const applyOp: ApplyOp = edit.applyOp;
/** The block with this ordinal, or null. */
const locateBlock = (text: string, ordinal: number) => locate.findBlocks(text)[ordinal] ?? null;
const planWrite: PlanWrite = write.planWrite;

const NOTE9 = fixtureNote('09');
/** Fixture 9, the main tree. Bodies have no final newline, like `LocatedBlock.body`. */
const MAIN = topLevelBlocks(NOTE9)[0].replace(/\n$/, '');
const F10 = fixtureSource('10').replace(/\n$/, '');

/** The House Harrow item of fixture 9, as written. */
const HARROW_ITEM =
	'  - id: harrow\n' +
	'    name: House Harrow\n' +
	'    color: "#5b2a86"          # quoted, or YAML reads a comment\n' +
	"    motto: 'Root and branch'  # unknown key in a house\n";

type Ok = Extract<EditResult, { ok: true }>;

function ok(r: EditResult): Ok {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r;
}

/** The new body; house ops create no ids. */
function body(r: EditResult): string {
	const o = ok(r);
	expect(o.created).toEqual([]);
	return o.body;
}

/** Golden files end with one newline; a body has none. */
function expectGolden(r: EditResult, file: string): void {
	expect(body(r) + '\n').toBe(golden(file));
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

const rename = (id: string, name: string): Op => ({ kind: 'edit-house', id, name });
const recolour = (id: string, color: string | null): Op => ({ kind: 'edit-house', id, color });
const del = (id: string, people: 'clear' | 'keep'): Op => ({ kind: 'delete-house', id, people });

/** Replaces each pair in turn, each exactly once. */
const replaceAllOnce = (text: string, ...pairs: [string, string][]) => pairs.reduce((t, [from, to]) => replaceOnce(t, from, to), text);

describe('edit-house: rename (§6.10, §6.2)', () => {
	it('fixture 9, a plain name: only the name line changes', () => {
		expectGolden(applyOp(MAIN, rename('harrow', 'House Harrow of Greyfen')), '09-house-rename-harrow.yaml');
	});

	it('plain cannot hold ": ", so the new name goes in double quotes', () => {
		expect(body(applyOp(MAIN, rename('harrow', 'Harrow: the Elder House')))).toBe(
			replaceOnce(MAIN, '    name: House Harrow\n', '    name: "Harrow: the Elder House"\n'),
		);
	});

	it('a single-quoted name stays in single quotes', () => {
		expect(body(applyOp(MAIN, rename('quill', 'House Quill of Fenwick')))).toBe(
			replaceOnce(MAIN, "    name: 'House Quill'\n", "    name: 'House Quill of Fenwick'\n"),
		);
	});

	it("single quotes hold an apostrophe as ''", () => {
		expect(body(applyOp(MAIN, rename('quill', "Maud's House")))).toBe(replaceOnce(MAIN, "    name: 'House Quill'\n", "    name: 'Maud''s House'\n"));
	});

	it('the id never changes, even when the new name would give another id (§4.1, §6.8)', () => {
		const after = body(applyOp(MAIN, rename('harrow', 'House Quill')));
		expect(after).toBe(replaceOnce(MAIN, '    name: House Harrow\n', '    name: House Quill\n'));
		expect(tree(after).houses.map((h) => h.id)).toEqual(['harrow', 'quill']);
		expect(tree(after).people.map((p) => p.house)).toEqual(tree(MAIN).people.map((p) => p.house));
	});

	it('the same name again changes nothing', () => {
		expect(body(applyOp(MAIN, rename('harrow', 'House Harrow')))).toBe(MAIN);
	});

	it('an empty name is refused (name is required, §4.1)', () => {
		expectRefused(applyOp(MAIN, rename('harrow', '')), 'bad-value');
	});
});

describe('edit-house: colour (§6.10, D32; always "#rrggbb" in double quotes)', () => {
	it('a double-quoted colour stays double-quoted; its end-of-line comment stays', () => {
		expect(body(applyOp(MAIN, recolour('harrow', '#7a1f1f')))).toBe(
			replaceOnce(MAIN, '    color: "#5b2a86"          # quoted', '    color: "#7a1f1f"          # quoted'),
		);
	});

	it('fixture 9, a single-quoted colour: the new colour is written in double quotes', () => {
		expectGolden(applyOp(MAIN, recolour('quill', '#aa3355')), '09-house-recolour-quill.yaml');
	});

	it('the same colour again changes nothing', () => {
		expect(body(applyOp(MAIN, recolour('harrow', '#5b2a86')))).toBe(MAIN);
	});

	it('fixture 9, color: null removes the colour line, with the end-of-line comment on that line', () => {
		expectGolden(applyOp(MAIN, recolour('harrow', null)), '09-house-remove-colour-harrow.yaml');
		expect(body(applyOp(MAIN, recolour('quill', null)))).toBe(replaceOnce(MAIN, "    color: '#2a6f86'\n", ''));
	});

	it('color: null on a house with no colour changes nothing', () => {
		const none = body(applyOp(MAIN, recolour('quill', null)));
		expect(body(applyOp(none, recolour('quill', null)))).toBe(none);
	});

	it('a new colour goes after name (§4.1 order id, name, color), in double quotes', () => {
		const none = body(applyOp(MAIN, recolour('quill', null)));
		expect(body(applyOp(none, recolour('quill', '#2a6f86')))).toBe(replaceOnce(MAIN, "    color: '#2a6f86'\n", '    color: "#2a6f86"\n'));
	});

	it('a new colour goes after the last entry when only an unknown key follows name', () => {
		// The decision notes: a new key goes before the next key in §4.1 order; unknown keys never decide
		// the position; with no later key it goes after the map's last entry and its comment.
		const none = body(applyOp(MAIN, recolour('harrow', null)));
		expect(body(applyOp(none, recolour('harrow', '#5b2a86')))).toBe(
			replaceAllOnce(
				MAIN,
				['    color: "#5b2a86"          # quoted, or YAML reads a comment\n', ''],
				["    motto: 'Root and branch'  # unknown key in a house\n", "    motto: 'Root and branch'  # unknown key in a house\n    color: \"#5b2a86\"\n"],
			),
		);
	});

	it('the colour reads back as written', () => {
		const t = tree(body(applyOp(MAIN, recolour('quill', '#abcdef'))));
		expect(t.houses.find((h) => h.id === 'quill')?.color).toBe('#abcdef');
	});

	it('a colour that is not #rrggbb is refused', () => {
		for (const c of ['#abc', 'red', '8b1e3f', '#8b1e3', '#8b1e3f0', '#12345g', '# 8b1e3f', ' #8b1e3f', 'rgb(1, 2, 3)']) {
			expectRefused(applyOp(MAIN, recolour('quill', c)), 'bad-value');
		}
	});
});

describe('edit-house: a colour that YAML read as a comment (fixture 10, §8 house-color-null)', () => {
	const LINE = '    color: #8b1e3f\n';

	it('setting the colour replaces the comment with the quoted value; the warning goes', () => {
		const after = body(applyOp(F10, recolour('valmont', '#8b1e3f')));
		expect(after).toBe(replaceOnce(F10, LINE, '    color: "#8b1e3f"\n'));
		const t = tree(after);
		expect(t.houses[0].color).toBe('#8b1e3f');
		expect(deriveFamilies(t).issues.map((i) => i.code)).not.toContain('house-color-null');
	});

	it('another colour replaces it too', () => {
		expect(body(applyOp(F10, recolour('valmont', '#1e4f8b')))).toBe(replaceOnce(F10, LINE, '    color: "#1e4f8b"\n'));
	});

	it('a rename leaves the colour line alone', () => {
		expect(body(applyOp(F10, rename('valmont', 'House of Valmont')))).toBe(replaceOnce(F10, '    name: House Valmont\n', '    name: House of Valmont\n'));
	});

	it('color: null removes the key line with its end-of-line comment', () => {
		expect(body(applyOp(F10, recolour('valmont', null)))).toBe(replaceOnce(F10, LINE, ''));
	});
});

describe('edit-house: the first house with the id (the one the tree uses)', () => {
	const DUP = 'houses:\n  - id: fenn\n    name: House Fenn\n  - id: fenn\n    name: Fenn Again\n\npeople:\n  - id: a\n    name: A\n    house: fenn';

	it('rename and recolour change only the first', () => {
		expect(body(applyOp(DUP, rename('fenn', 'Fenn')))).toBe(replaceOnce(DUP, '    name: House Fenn\n', '    name: Fenn\n'));
		expect(body(applyOp(DUP, recolour('fenn', '#556b2f')))).toBe(replaceOnce(DUP, '    name: House Fenn\n', '    name: House Fenn\n    color: "#556b2f"\n'));
	});
});

describe('edit-house: name and colour together', () => {
	it('fixture 9: both lines change, nothing else', () => {
		expectGolden(applyOp(MAIN, { kind: 'edit-house', id: 'quill', name: 'House Quill-Marsh', color: '#123456' }), '09-house-edit-quill-both.yaml');
	});

	it('a new name and no colour', () => {
		expect(body(applyOp(MAIN, { kind: 'edit-house', id: 'harrow', name: 'Harrow', color: null }))).toBe(
			replaceOnce(MAIN, HARROW_ITEM, "  - id: harrow\n    name: Harrow\n    motto: 'Root and branch'  # unknown key in a house\n"),
		);
	});

	it('a bad colour refuses the whole op: the name does not change either', () => {
		expectRefused(applyOp(MAIN, { kind: 'edit-house', id: 'harrow', name: 'Harrow', color: 'red' }), 'bad-value');
	});

	it('the tree reads back the same apart from that house', () => {
		const before = tree(MAIN);
		const after = tree(body(applyOp(MAIN, { kind: 'edit-house', id: 'harrow', name: 'Greyfen', color: '#000000' })));
		expect(after.houses).toEqual([{ id: 'harrow', name: 'Greyfen', color: '#000000' }, before.houses[1]]);
		expect(after.people).toEqual(before.people);
		expect(after.unions).toEqual(before.unions);
		expect(after.options).toEqual(before.options);
	});
});

describe('edit-house: flow style stays flow style (§6.2)', () => {
	const FLOW = 'houses:\n  - {id: fenn, name: House Fenn, color: "#556b2f"}   # a flow-map house\n\npeople:\n  - id: a\n    name: A\n    house: fenn';

	it('rename inside the braces', () => {
		expect(body(applyOp(FLOW, rename('fenn', 'Fenn of the Fens')))).toBe(replaceOnce(FLOW, 'name: House Fenn,', 'name: Fenn of the Fens,'));
	});

	it('recolour inside the braces', () => {
		expect(body(applyOp(FLOW, recolour('fenn', '#8b1e3f')))).toBe(replaceOnce(FLOW, 'color: "#556b2f"}', 'color: "#8b1e3f"}'));
	});

	it('color: null leaves tidy flow syntax; the comment stays', () => {
		expect(body(applyOp(FLOW, recolour('fenn', null)))).toBe(replaceOnce(FLOW, '{id: fenn, name: House Fenn, color: "#556b2f"}', '{id: fenn, name: House Fenn}'));
	});

	it('a new colour goes inside the braces, after name', () => {
		const none = replaceOnce(FLOW, ', color: "#556b2f"}', '}');
		expect(body(applyOp(none, recolour('fenn', '#556b2f')))).toBe(FLOW);
	});

	it('a flow sequence of houses', () => {
		const seq = 'houses: [{id: fenn, name: House Fenn}, {id: marsh, name: House Marsh}]\npeople:\n  - id: a\n    name: A';
		expect(body(applyOp(seq, rename('marsh', 'Marsh')))).toBe(replaceOnce(seq, 'name: House Marsh}', 'name: Marsh}'));
	});
});

describe('delete-house, clear: the house and every house: line of its people (§6.10, D32)', () => {
	it('fixture 9, House Harrow (commented, with an unknown key): the item goes, Aldous and Edric lose house:', () => {
		expectGolden(applyOp(MAIN, del('harrow', 'clear')), '09-house-delete-harrow-clear.yaml');
	});

	it('fixture 9, House Quill: the last item goes; Maud loses house:', () => {
		expectGolden(applyOp(MAIN, del('quill', 'clear')), '09-house-delete-quill-clear.yaml');
	});

	it('fixture 9 with Joan (a flow-map person) in House Quill: she loses house: inside the braces', () => {
		const joan = '  - {id: joan, name: Joan Marsh, sex: f, born: 1135}   # a flow-map person';
		const input = replaceOnce(MAIN, joan, '  - {id: joan, name: Joan Marsh, house: quill, sex: f, born: 1135}   # a flow-map person');
		expectGolden(applyOp(input, del('quill', 'clear')), '09-house-delete-quill-clear.yaml');
	});

	it('fixture 9: both houses deleted → the houses section goes with one blank line', () => {
		const both = applyOp(body(applyOp(MAIN, del('harrow', 'clear'))), del('quill', 'clear'));
		expectGolden(both, '09-house-delete-both-clear.yaml');
		expect(body(both)).toContain('  archive-shelf: B-12         # unknown key in options\n\npeople:\n');
	});

	it('people with no written id lose house: too', () => {
		const b = 'houses:\n  - id: fenn\n    name: House Fenn\n\npeople:\n  - name: Nameless\n    house: fenn\n    sex: f\n  - {name: Also Nameless, house: fenn}\n  - id: a\n    name: A\n    house: fenn';
		expect(body(applyOp(b, del('fenn', 'clear')))).toBe('people:\n  - name: Nameless\n    sex: f\n  - {name: Also Nameless}\n  - id: a\n    name: A');
	});

	it('the tree reads back the same apart from the house and its people\'s house:', () => {
		const before = tree(MAIN);
		const after = tree(body(applyOp(MAIN, del('harrow', 'clear'))));
		expect(after.houses).toEqual([before.houses[1]]);
		expect(after.people).toEqual(before.people.map((p) => (p.house === 'harrow' ? { ...p, house: undefined } : p)));
		expect(after.unions).toEqual(before.unions);
		expect(after.options).toEqual(before.options);
		expect(deriveFamilies(after).issues.filter((i) => i.code === 'missing-house')).toEqual([]);
	});

	it("a person's house: line goes with its end-of-line comment", () => {
		const b = 'houses:\n  - id: fenn\n    name: House Fenn\n  - id: marsh\n    name: House Marsh\n\npeople:\n  - id: a\n    name: A\n    house: fenn   # born a Fenn\n    sex: f';
		expect(body(applyOp(b, del('fenn', 'clear')))).toBe(replaceAllOnce(b, ['  - id: fenn\n    name: House Fenn\n', ''], ['    house: fenn   # born a Fenn\n', '']));
	});

	it('only house: values equal to the id go: not other keys, other namespaces or a longer id (§6.8)', () => {
		const b = [
			'options:',
			'  start: fenn',
			'',
			'houses:',
			'  - id: fenn',
			'    name: House Fenn',
			'  - id: fenner',
			'    name: House Fenner',
			'',
			'people:',
			'  - id: fenn',
			'    name: Fenn the Elder',
			'    house: fenner',
			'    seat: fenn',
			'    notes: fenn',
			'  - id: b',
			'    name: B',
			'    house: fenn',
			'    parents: [fenn]',
			'  - {id: c, name: C, house: fenn, sex: f}',
			'',
			'unions:',
			'  - id: fenn',
			'    partners: [fenn, c]',
			'fenn: kept',
		].join('\n');
		expect(body(applyOp(b, del('fenn', 'clear')))).toBe(
			replaceAllOnce(b, ['  - id: fenn\n    name: House Fenn\n', ''], ['    house: fenn\n', ''], ['{id: c, name: C, house: fenn, sex: f}', '{id: c, name: C, sex: f}']),
		);
	});

	it('a full-line comment above the deleted house stays (the decision notes "Relationship-op details")', () => {
		const b = 'houses:\n  # Founded in 1100.\n  - id: fenn\n    name: House Fenn\n  - id: marsh\n    name: House Marsh\n\npeople:\n  - id: a\n    name: A';
		expect(body(applyOp(b, del('fenn', 'clear')))).toBe(replaceOnce(b, '  - id: fenn\n    name: House Fenn\n', ''));
	});

	it('numeric and quoted ids are text: 7 is not "07" (§6.8)', () => {
		const b = 'houses:\n  - id: 7\n    name: House Seven\n  - id: "07"\n    name: House Oh-Seven\n\npeople:\n  - id: a\n    name: A\n    house: 7\n  - id: b\n    name: B\n    house: "07"';
		expect(body(applyOp(b, del('7', 'clear')))).toBe(replaceAllOnce(b, ['  - id: 7\n    name: House Seven\n', ''], ['    house: 7\n', '']));
		expect(body(applyOp(b, del('07', 'clear')))).toBe(replaceAllOnce(b, ['  - id: "07"\n    name: House Oh-Seven\n', ''], ['\n    house: "07"', '']));
		expect(body(applyOp(b, rename('7', 'Seven')))).toBe(replaceOnce(b, 'name: House Seven\n', 'name: Seven\n'));
	});

	it('fixture 10: the house with the unquoted #colour goes whole, and the section with it', () => {
		expect(body(applyOp(F10, del('valmont', 'clear')))).toBe(
			replaceAllOnce(
				F10,
				['houses:\n  - id: valmont\n    name: House Valmont\n    color: #8b1e3f\n\n', ''],
				['    title: Duke of Valmont\n    house: valmont\n', '    title: Duke of Valmont\n'],
				['    name: Tomas Valmont\n    house: valmont\n', '    name: Tomas Valmont\n'],
			),
		);
	});
});

describe('delete-house, keep: only the house item goes (§6.10, §8)', () => {
	it('fixture 9, House Harrow: its people keep house: harrow', () => {
		expectGolden(applyOp(MAIN, del('harrow', 'keep')), '09-house-delete-harrow-keep.yaml');
	});

	it('the tree then warns about the missing house for each of its people (§8)', () => {
		const after = tree(body(applyOp(MAIN, del('harrow', 'keep'))));
		const missing = deriveFamilies(after).issues.filter((i) => i.code === 'missing-house');
		expect(missing.map((i) => i.level)).toEqual(['warning', 'warning']);
		expect(missing.map((i) => i.ids)).toEqual([['aldous'], ['edric']]);
		expect(missing.map((i) => i.params.ref)).toEqual(['harrow', 'harrow']);
		expect(after.people).toEqual(tree(MAIN).people);
	});

	it('the last house: the section goes; its people keep house:', () => {
		const b = 'houses:\n  - id: fenn\n    name: House Fenn\n\npeople:\n  - id: a\n    name: A\n    house: fenn';
		expect(body(applyOp(b, del('fenn', 'keep')))).toBe('people:\n  - id: a\n    name: A\n    house: fenn');
	});
});

describe('an empty houses list is removed (reading above; the decision notes "Formatting details", "Write machinery after M3")', () => {
	const PEOPLE = 'people:\n  - id: a\n    name: A\n    house: fenn';

	it('houses first: the section and the blank line after it go', () => {
		expect(body(applyOp(`houses:\n  - id: fenn\n    name: House Fenn\n\n${PEOPLE}`, del('fenn', 'clear')))).toBe('people:\n  - id: a\n    name: A');
	});

	it('houses between options and people: one blank line stays between them', () => {
		const b = `options:\n  start: a\n\nhouses:\n  - id: fenn\n    name: House Fenn\n    color: "#556b2f"\n\n${PEOPLE}`;
		expect(body(applyOp(b, del('fenn', 'clear')))).toBe('options:\n  start: a\n\npeople:\n  - id: a\n    name: A');
	});

	it('houses as the last section: the blank lines before it go', () => {
		expect(body(applyOp(`${PEOPLE}\n\nhouses:\n  - id: fenn\n    name: House Fenn`, del('fenn', 'clear')))).toBe('people:\n  - id: a\n    name: A');
	});

	it('a flow sequence: the last item goes with the whole houses line', () => {
		// Decision: the same rule in flow style; `houses: []` is not left behind.
		expect(body(applyOp(`houses: [{id: fenn, name: House Fenn}]\n\n${PEOPLE}`, del('fenn', 'keep')))).toBe(PEOPLE);
	});

	it('a flow sequence with two houses keeps the other one', () => {
		const b = `houses: [{id: fenn, name: House Fenn}, {id: marsh, name: House Marsh}]\n${PEOPLE}`;
		expect(body(applyOp(b, del('fenn', 'keep')))).toBe(`houses: [{id: marsh, name: House Marsh}]\n${PEOPLE}`);
	});
});

describe('refusals (contract EditRefusal, §8)', () => {
	it('unknown-house for a house that is not in the block', () => {
		expectRefused(applyOp(MAIN, rename('marsh', 'House Marsh')), 'unknown-house');
		expectRefused(applyOp(MAIN, recolour('marsh', '#000000')), 'unknown-house');
		expectRefused(applyOp(MAIN, del('marsh', 'clear')), 'unknown-house');
		expectRefused(applyOp(MAIN, del('marsh', 'keep')), 'unknown-house');
	});

	it('houses and people have separate namespaces: a person id is not a house (§6.8)', () => {
		expectRefused(applyOp(MAIN, rename('edric', 'House Edric')), 'unknown-house');
		expectRefused(applyOp(MAIN, del('edric', 'clear')), 'unknown-house');
	});

	it('a block with no houses', () => {
		const second = topLevelBlocks(NOTE9)[1].replace(/\n$/, '');
		expectRefused(applyOp(second, del('harrow', 'clear')), 'unknown-house');
	});

	it('a dangling house: reference is not a house', () => {
		const b = 'people:\n  - id: a\n    name: A\n    house: fenn';
		expectRefused(applyOp(b, del('fenn', 'clear')), 'unknown-house');
	});

	it('fixture 5 has blocking issues: editing is off', () => {
		const f5 = fixtureSource('05').replace(/\n$/, '');
		expectRefused(applyOp(f5, rename('ashford', 'Ashford')), 'blocked');
		expectRefused(applyOp(f5, del('ashford', 'clear')), 'blocked');
	});

	it('invalid YAML', () => {
		expectRefused(applyOp('houses:\n  - id: fenn\n    name: House: Fenn: x', rename('fenn', 'F')), 'invalid-yaml');
		expectRefused(applyOp('- a\n- b', del('fenn', 'clear')), 'invalid-yaml');
	});

	it('a refused house op refuses the whole batch', () => {
		const r = applyOp(MAIN, { kind: 'batch', ops: [rename('harrow', 'Harrow'), del('marsh', 'clear')] });
		expectRefused(r, 'unknown-house');
	});
});

describe('a block in a callout or a list item keeps its prefix (§6.1, §6.2)', () => {
	const NOTE = [
		'# Houses in containers',
		'',
		'> [!note] The Fenn and Marsh houses',
		'> ```kin',
		'> houses:',
		'>   - id: fenn',
		'>     name: House Fenn',
		'>     color: "#556b2f"',
		'>   - id: marsh',
		'>     name: House Marsh',
		'>',
		'> people:',
		'>   - id: bertram',
		'>     name: Bertram Fenn',
		'>     house: fenn',
		'>   - id: joan',
		'>     name: Joan Marsh',
		'>     house: marsh',
		'> ```',
		'',
		'- The Fenn branch:',
		'',
		'  ```kin',
		'  houses:',
		'    - id: fenn',
		'      name: House Fenn',
		'',
		'  people:',
		'    - id: ysolde',
		'      name: Ysolde Fenn',
		'      house: fenn',
		'  ```',
		'- End of the list.',
		'',
	].join('\n');

	function writeNote(text: string, ordinal: number, op: Op): string {
		const block = locateBlock(text, ordinal);
		if (!block) throw new Error(`no block ${ordinal}`);
		const r = planWrite(text, ordinal, block.body, (b) => {
			const e = applyOp(b, op);
			return e.ok ? { ok: true, body: e.body } : { ok: false, reason: e.code };
		});
		if (!r.ok) throw new Error(`write refused: ${r.code}`);
		return r.newText;
	}

	it('callout: rename and recolour keep "> "', () => {
		expect(writeNote(NOTE, 0, { kind: 'edit-house', id: 'fenn', name: 'Fenn of the Fens', color: '#8b1e3f' })).toBe(
			replaceOnce(NOTE, '>     name: House Fenn\n>     color: "#556b2f"\n', '>     name: Fenn of the Fens\n>     color: "#8b1e3f"\n'),
		);
	});

	it('callout: a new colour line gets "> "', () => {
		expect(writeNote(NOTE, 0, recolour('marsh', '#1e4f8b'))).toBe(replaceOnce(NOTE, '>     name: House Marsh\n', '>     name: House Marsh\n>     color: "#1e4f8b"\n'));
	});

	it('callout: delete with clear removes the item and the house: line', () => {
		expect(writeNote(NOTE, 0, del('fenn', 'clear'))).toBe(
			replaceAllOnce(NOTE, ['>   - id: fenn\n>     name: House Fenn\n>     color: "#556b2f"\n', ''], ['>     name: Bertram Fenn\n>     house: fenn\n', '>     name: Bertram Fenn\n']),
		);
	});

	it('callout: deleting both houses removes the section and its ">" blank line', () => {
		const once = writeNote(NOTE, 0, del('fenn', 'keep'));
		expect(writeNote(once, 0, del('marsh', 'keep'))).toBe(
			replaceOnce(NOTE, '> houses:\n>   - id: fenn\n>     name: House Fenn\n>     color: "#556b2f"\n>   - id: marsh\n>     name: House Marsh\n>\n', ''),
		);
	});

	it('list item: a new colour line keeps the indentation', () => {
		expect(writeNote(NOTE, 1, recolour('fenn', '#556b2f'))).toBe(replaceOnce(NOTE, '      name: House Fenn\n', '      name: House Fenn\n      color: "#556b2f"\n'));
	});

	it('list item: deleting the only house removes the section, its blank line and the house: line', () => {
		expect(writeNote(NOTE, 1, del('fenn', 'clear'))).toBe(
			replaceOnce(NOTE, '  ```kin\n  houses:\n    - id: fenn\n      name: House Fenn\n\n  people:\n    - id: ysolde\n      name: Ysolde Fenn\n      house: fenn\n', '  ```kin\n  people:\n    - id: ysolde\n      name: Ysolde Fenn\n'),
		);
	});

	it('editing the list-item block never touches the callout block', () => {
		const after = writeNote(NOTE, 1, rename('fenn', 'Fenn'));
		expect(after).toBe(replaceOnce(NOTE, '      name: House Fenn\n', '      name: Fenn\n'));
	});
});

describe('every sample tree: house ops change only what they must (§6.2, §6.10)', () => {
	// Sample tree 5 has blocking issues (editing is off); sample tree 7 has 6 houses and 400 people.
	const SAMPLES = allFixtures().filter((f) => f.id !== '05');

	for (const f of SAMPLES) {
		it(`sample tree ${f.id}`, { timeout: 60_000 }, () => {
			const src = f.source.replace(/\n$/, '');
			const before = tree(src);
			const baseMissing = deriveFamilies(before).issues.filter((i) => i.code === 'missing-house').length;
			const ids = [...new Set(before.houses.map((h) => h.id))];
			for (const id of ids) {
				const users = before.people.filter((p) => p.house === id).length;

				const cleared = tree(body(applyOp(src, del(id, 'clear'))));
				expect(cleared.houses, `${id} clear`).toEqual(before.houses.filter((h) => h.id !== id));
				expect(cleared.people, `${id} clear`).toEqual(before.people.map((p) => (p.house === id ? { ...p, house: undefined } : p)));
				expect(cleared.unions, `${id} clear`).toEqual(before.unions);
				expect(cleared.options, `${id} clear`).toEqual(before.options);

				const kept = tree(body(applyOp(src, del(id, 'keep'))));
				expect(kept.houses, `${id} keep`).toEqual(before.houses.filter((h) => h.id !== id));
				expect(kept.people, `${id} keep`).toEqual(before.people);
				expect(deriveFamilies(kept).issues.filter((i) => i.code === 'missing-house').length, `${id} keep`).toBe(baseMissing + users);

				const renamed = tree(body(applyOp(src, rename(id, 'Renamed House'))));
				expect(renamed.houses, `${id} rename`).toEqual(before.houses.map((h) => (h.id === id ? { ...h, name: 'Renamed House' } : h)));
				expect(renamed.people, `${id} rename`).toEqual(before.people);
			}
		});
	}
});
