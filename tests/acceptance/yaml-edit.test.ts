import { describe, expect, it } from 'vitest';
import type { LocateBlock, PlanWrite } from '../../src/core/block';
import * as locate from '../../src/core/block-locate';
import * as write from '../../src/core/block-write';
import type { ApplyOp, EditResult, Op } from '../../src/core/edit';
import * as edit from '../../src/core/yaml-edit';
import { golden, replaceOnce } from './golden';
import { fixtureNote, fixtureSource, topLevelBlocks } from './load';

// Spec §6.2 (minimal-diff serialisation), §4.1 (field order, unknown keys), §6.8 (ids), §8
// (editing is off with blocking issues), §10 item 9 and the round-trip acceptance items, and the
// formatting rule in the decision notes "How a changed value is written".
//
// Every expected text is hand-written in tests/golden/ or built here by replacing one exact line.
// Where the rule does not fix the bytes, the choice is written as a "Decision:" comment.

const applyOp: ApplyOp = edit.applyOp;
const locateBlock: LocateBlock = locate.locateBlock;
const planWrite: PlanWrite = write.planWrite;

const NOTE = fixtureNote('09');
const BLOCKS = topLevelBlocks(NOTE).map((b) => b.replace(/\n$/, ''));
/** Fixture 9, the main tree. Bodies have no final newline, like `LocatedBlock.body`. */
const MAIN = BLOCKS[0];
/** Fixture 9, the second plain block: no options, no houses. */
const SECOND = BLOCKS[1];

function ok(r: EditResult): { body: string; created: string[] } {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return { body: r.body, created: r.created };
}

/** Golden files end with one newline; a body has none. */
function expectGolden(r: EditResult, file: string, created: string[] = []): void {
	const { body, created: c } = ok(r);
	expect(body + '\n').toBe(golden(file));
	expect(c).toEqual(created);
}

const person = (id: string, fields: Extract<Op, { kind: 'set-person-fields' }>['fields']): Op => ({ kind: 'set-person-fields', id, fields });

describe('fixture 9: a changed value (§6.2, the decision notes)', () => {
	it('name, plain → plain: only that line changes', () => {
		expectGolden(applyOp(MAIN, person('edric', { name: 'Edric the Younger' })), '09-name-plain.yaml');
	});

	it('name, plain cannot hold ": " → double quotes', () => {
		expectGolden(applyOp(MAIN, person('edric', { name: 'Edric: the Heir' })), '09-name-plain-to-quoted.yaml');
	});

	it('name written in double quotes stays in double quotes (and the quoted id "0017" is found)', () => {
		expectGolden(applyOp(MAIN, person('0017', { name: 'Maud Harrow' })), '09-name-double.yaml');
	});

	it('name written in single quotes stays in single quotes', () => {
		expect(ok(applyOp(MAIN, person('rosamund', { name: 'Rosamund Quill' }))).body).toBe(
			replaceOnce(MAIN, "name: 'Rosamund Harrow'", "name: 'Rosamund Quill'"),
		);
	});

	it("single quotes can hold an apostrophe, written as ''", () => {
		expect(ok(applyOp(MAIN, person('rosamund', { name: "Rosamund's Heir" }))).body).toBe(
			replaceOnce(MAIN, "name: 'Rosamund Harrow'", "name: 'Rosamund''s Heir'"),
		);
	});

	it('born 1102 → 1103 stays plain (born is text, §3)', () => {
		expectGolden(applyOp(MAIN, person('aldous', { born: '1103' })), '09-born-plain.yaml');
	});

	it('a quoted date stays quoted, and its end-of-line comment stays', () => {
		expectGolden(applyOp(MAIN, person('0017', { born: '1104-03-10' })), '09-born-quoted-date.yaml');
	});

	it('the same value again changes nothing', () => {
		expect(ok(applyOp(MAIN, person('edric', { name: 'Edric Harrow' }))).body).toBe(MAIN);
	});

	it('a flow-map person: only the value inside the braces changes', () => {
		expectGolden(applyOp(MAIN, person('joan', { name: 'Joan Harrow' })), '09-flow-map-name.yaml');
	});

	it('a value followed by an end-of-line comment', () => {
		// Decision: only the value's characters are replaced. The spaces between the value and the
		// comment stay as they were, so the comment moves when the value length changes.
		expect(ok(applyOp(MAIN, { kind: 'set-option', key: 'start', value: 'rosamund' })).body).toBe(
			replaceOnce(MAIN, '  start: edric                # open', '  start: rosamund                # open'),
		);
	});

	it('several fields in one op', () => {
		const r = applyOp(MAIN, person('edric', { title: 'Heir of Greyfen', born: '1130' }));
		expect(ok(r).body + '\n').toBe(replaceOnce(golden('09-add-title.yaml'), '    born: 1131\n', '    born: 1130\n'));
	});
});

describe('fixture 9: a new key (§4.1 order, the decision notes)', () => {
	// Decision: a new key goes directly before the first key already in the map that comes later in
	// the §4.1 order, above any full-line comment attached to that key. If no later key is there, it
	// goes after the map's last entry (and after that entry's end-of-line comment), above any
	// full-line comment that introduces the next list item. It uses the indentation of the map's
	// other keys. Unknown keys have no place in the §4.1 order, so they never decide the position.

	it('title for a person with none: after name, before house', () => {
		expectGolden(applyOp(MAIN, person('edric', { title: 'Heir of Greyfen' })), '09-add-title.yaml');
	});

	it('notes for a person whose last key is unknown: after the unknown key', () => {
		expectGolden(applyOp(MAIN, person('aldous', { notes: 'Founded the Greyfen archive.' })), '09-add-notes-at-end.yaml');
	});

	it('illegitimate: true after parents, above the next item\'s "# Wards" comment', () => {
		expectGolden(applyOp(MAIN, person('piers', { illegitimate: true })), '09-illegitimate.yaml');
	});

	it('illegitimate: false removes the key again, back to the original bytes', () => {
		const set = ok(applyOp(MAIN, person('piers', { illegitimate: true }))).body;
		expect(ok(applyOp(set, person('piers', { illegitimate: false }))).body).toBe(MAIN);
	});

	it('illegitimate: false on a person without the key changes nothing', () => {
		expect(ok(applyOp(MAIN, person('piers', { illegitimate: false }))).body).toBe(MAIN);
	});

	it('a flow-map person: the new key goes inside the braces in §4.1 order', () => {
		// Decision: the new pair is written "key: value" and joined with ", ", like the pairs there.
		expectGolden(applyOp(MAIN, person('joan', { title: 'Lady of Fenwick' })), '09-flow-map-add-title.yaml');
	});
});

describe('fixture 9: removing a key (the decision notes "only that key\'s lines")', () => {
	it('title removed: its line goes, with the end-of-line comment on that line', () => {
		// Decision: an end-of-line comment belongs to its line and is removed with it.
		expectGolden(applyOp(MAIN, person('aldous', { title: null })), '09-remove-title.yaml');
	});

	it('removing a key the person does not have changes nothing', () => {
		expect(ok(applyOp(MAIN, person('edric', { title: null }))).body).toBe(MAIN);
	});
});

describe('fixture 9: add-house (§6.3 New house…, §6.8 ids)', () => {
	// Decision: a new house goes after the last entry of `houses`, as a block map with keys in the
	// §4.1 order (id, name, color), in the indentation of the existing items. A colour is written in
	// double quotes, because plain YAML reads "#…" as a comment.

	it('id from the name; appended at the end of houses', () => {
		expectGolden(applyOp(MAIN, { kind: 'add-house', name: 'House Marsh', color: '#556b2f' }), '09-add-house.yaml', ['house-marsh']);
	});

	it('an id that is taken gets -2', () => {
		expectGolden(applyOp(MAIN, { kind: 'add-house', name: 'Harrow' }), '09-add-house-collision.yaml', ['harrow-2']);
	});

	it('houses and people have separate id namespaces (§6.8)', () => {
		expect(ok(applyOp(MAIN, { kind: 'add-house', name: 'Edric' }))).toEqual({
			body: replaceOnce(MAIN, "    color: '#2a6f86'\n", "    color: '#2a6f86'\n  - id: edric\n    name: Edric\n"),
			created: ['edric'],
		});
	});

	it('diacritics are stripped from the id, not from the name (§6.8)', () => {
		expect(ok(applyOp(MAIN, { kind: 'add-house', name: 'Maison Lefèvre' }))).toEqual({
			body: replaceOnce(MAIN, "    color: '#2a6f86'\n", "    color: '#2a6f86'\n  - id: maison-lefevre\n    name: Maison Lefèvre\n"),
			created: ['maison-lefevre'],
		});
	});

	it('a block without houses gets a houses section before people', () => {
		// Decision: a new top-level section goes in the §4 order (options, houses, people, unions), with
		// one blank line between it and the next section. List items use the indentation of `people`.
		expectGolden(applyOp(SECOND, { kind: 'add-house', name: 'House Fenn' }), '09-second-add-house-new-section.yaml', ['house-fenn']);
	});

	it('an empty house name is refused', () => {
		expect(applyOp(MAIN, { kind: 'add-house', name: '' })).toMatchObject({ ok: false, code: 'bad-value' });
	});
});

describe('fixture 9: set-option (§4.1 options)', () => {
	it('height added after the options already there (the unknown key stays where it is)', () => {
		expectGolden(applyOp(MAIN, { kind: 'set-option', key: 'height', value: 600 }), '09-option-height-add.yaml');
	});

	it('start removed: only its line goes; options stays for the unknown key', () => {
		expectGolden(applyOp(MAIN, { kind: 'set-option', key: 'start', value: null }), '09-option-start-remove.yaml');
	});

	it('a block without options gets an options section at the top', () => {
		expectGolden(applyOp(SECOND, { kind: 'set-option', key: 'height', value: 500 }), '09-second-option-new-section.yaml');
	});

	it('removing the last key removes options', () => {
		// Decision: the blank line that separated options from the next section goes too, so the body
		// does not start with a blank line.
		const body = 'options:\n  height: 400\n\npeople:\n  - id: joan-marsh\n    name: Joan Marsh\n    sex: f';
		expect(ok(applyOp(body, { kind: 'set-option', key: 'height', value: null })).body).toBe(
			'people:\n  - id: joan-marsh\n    name: Joan Marsh\n    sex: f',
		);
	});
});

describe('fixture 9: batch (§6.3 New house… then Save)', () => {
	it('add-house and set the house on a person, in one write', () => {
		// Rosamund has an unknown key (nickname) between name and sex: house goes before sex.
		const r = applyOp(MAIN, {
			kind: 'batch',
			ops: [
				{ kind: 'add-house', name: 'House Marsh' },
				{ kind: 'set-person-fields', id: 'rosamund', fields: { house: 'house-marsh' } },
			],
		});
		expectGolden(r, '09-batch-house.yaml', ['house-marsh']);
	});

	it('a refused op refuses the whole batch', () => {
		const r = applyOp(MAIN, {
			kind: 'batch',
			ops: [
				{ kind: 'add-house', name: 'House Marsh' },
				{ kind: 'set-person-fields', id: 'nobody', fields: { house: 'house-marsh' } },
			],
		});
		expect(r).toMatchObject({ ok: false, code: 'unknown-person' });
	});
});

describe('the body keeps its final newline state', () => {
	it('a body with a final newline keeps exactly one', () => {
		// Decision: applyOp does not add or remove a final newline.
		expect(ok(applyOp(MAIN + '\n', person('edric', { name: 'Edric the Younger' }))).body).toBe(golden('09-name-plain.yaml'));
	});
});

describe('fixture 10: hand-typed values survive an edit (§10 round trip)', () => {
	const BODY = fixtureSource('10').replace(/\n$/, '');

	it('an edit to died leaves born: 1102-03-04 and everything else byte for byte', () => {
		const r = applyOp(BODY, person('aldric', { died: '1162' }));
		expectGolden(r, '10-died.yaml');
		expect(ok(r).body).toContain('\n    born: 1102-03-04\n');
	});

	it('a numeric id is found as text: 42 is Isolde', () => {
		expect(ok(applyOp(BODY, person('42', { name: 'Isolde Valmont' }))).body).toBe(replaceOnce(BODY, 'name: Isolde Orsini', 'name: Isolde Valmont'));
	});

	it('0042 is Ser Gareth, not Isolde', () => {
		expect(ok(applyOp(BODY, person('0042', { born: '1105' }))).body).toBe(replaceOnce(BODY, '    born: 1104\n', '    born: 1105\n'));
	});

	it('042 is nobody', () => {
		expect(applyOp(BODY, person('042', { born: '1105' }))).toMatchObject({ ok: false, code: 'unknown-person' });
	});
});

describe('refusals (contract EditRefusal, §8)', () => {
	it('invalid YAML', () => {
		expect(applyOp('people:\n  - id: aldric\n    name: Aldric: Duke of Valmont', person('aldric', { born: '1' }))).toMatchObject({
			ok: false,
			code: 'invalid-yaml',
		});
	});

	it('a top level that is not a map is invalid-yaml', () => {
		expect(applyOp('- a\n- b', { kind: 'set-option', key: 'height', value: 300 })).toMatchObject({ ok: false, code: 'invalid-yaml' });
		expect(applyOp('just text', { kind: 'set-option', key: 'height', value: 300 })).toMatchObject({ ok: false, code: 'invalid-yaml' });
	});

	it('fixture 5 has blocking issues, so every op is refused with blocked', () => {
		const body = fixtureSource('05').replace(/\n$/, '');
		expect(applyOp(body, person('osmund', { born: '1051' }))).toMatchObject({ ok: false, code: 'blocked' });
		expect(applyOp(body, { kind: 'set-option', key: 'height', value: 300 })).toMatchObject({ ok: false, code: 'blocked' });
		expect(applyOp(body, { kind: 'add-house', name: 'House Holt' })).toMatchObject({ ok: false, code: 'blocked' });
	});

	it('an unknown person', () => {
		expect(applyOp(MAIN, person('nobody', { name: 'X' }))).toMatchObject({ ok: false, code: 'unknown-person' });
	});

	it('an empty name, or removing the name', () => {
		// Name is required (§4.1), so removing it is refused like an empty name.
		expect(applyOp(MAIN, person('edric', { name: '' }))).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp(MAIN, person('edric', { name: null }))).toMatchObject({ ok: false, code: 'bad-value' });
	});
});

describe('round trip through the note: locate → planWrite → applyOp (§10 fixture 9)', () => {
	function writeNote(text: string, ordinal: number, op: Op): string {
		const block = locateBlock(text, ordinal);
		if (!block) throw new Error(`no block ${ordinal}`);
		const r = planWrite(text, ordinal, block.body, (body) => {
			const e = applyOp(body, op);
			return e.ok ? { ok: true, body: e.body } : { ok: false, reason: e.code };
		});
		if (!r.ok) throw new Error(`write refused: ${r.code}`);
		return r.newText;
	}

	it('a callout block keeps "> " on every line', () => {
		expect(writeNote(NOTE, 1, person('hugh', { name: 'Hugh of Greyfen' }))).toBe(golden('09-note-callout-name.md'));
	});

	it('a callout inside a callout keeps "> > "; the double quotes stay', () => {
		expect(writeNote(NOTE, 2, person('wat', { name: 'Wat the Elder' }))).toBe(golden('09-note-nested-callout-name.md'));
	});

	it('a list-item block keeps its indentation; removing the last option removes options', () => {
		expect(writeNote(NOTE, 3, { kind: 'set-option', key: 'height', value: null })).toBe(golden('09-note-list-item-remove-height.md'));
	});

	it('editing the second plain block never touches the first', () => {
		expect(writeNote(NOTE, 4, person('ysolde', { name: 'Ysolde Harrow' }))).toBe(golden('09-note-second-block-name.md'));
	});

	it('a ~~~ block', () => {
		expect(writeNote(NOTE, 5, person('cedric', { name: 'Cedric Harrow' }))).toBe(replaceOnce(NOTE, 'name: Cedric Vane', 'name: Cedric Harrow'));
	});

	it('a callout line with an end-of-line comment', () => {
		expect(writeNote(NOTE, 1, person('osric', { name: 'Osric of Greyfen' }))).toBe(
			replaceOnce(NOTE, '>     name: Osric Quill         # an', '>     name: Osric of Greyfen         # an'),
		);
	});

	it('a CRLF note stays CRLF', () => {
		const crlf = NOTE.replace(/\n/g, '\r\n');
		expect(writeNote(crlf, 1, person('hugh', { name: 'Hugh of Greyfen' }))).toBe(golden('09-note-callout-name.md').replace(/\n/g, '\r\n'));
	});

	it('fixture 10: born: 1102-03-04 survives an edit of the same person', () => {
		const note = fixtureNote('10');
		expect(writeNote(note, 0, person('aldric', { died: '1162' }))).toBe(replaceOnce(note, '    died: 1161\n', '    died: 1162\n'));
	});
});

describe('quoting: plain only when plain YAML reads back the same string (the decision notes)', () => {
	// [person, field, new value, the exact old line, the exact new line]
	const cases: [string, 'name' | 'born' | 'link', string, string, string][] = [
		['edric', 'name', 'true', '    name: Edric Harrow\n', '    name: "true"\n'],
		['edric', 'name', 'null', '    name: Edric Harrow\n', '    name: "null"\n'],
		['edric', 'name', '#1', '    name: Edric Harrow\n', '    name: "#1"\n'],
		['edric', 'name', ' Edric', '    name: Edric Harrow\n', '    name: " Edric"\n'],
		['edric', 'name', 'Edric ', '    name: Edric Harrow\n', '    name: "Edric "\n'],
		['aldous', 'born', '?', '    born: 1102\n', '    born: "?"\n'],
		// Quoted styles that can hold ": " keep their style.
		['rosamund', 'name', 'Rosamund: Lady', "    name: 'Rosamund Harrow'\n", "    name: 'Rosamund: Lady'\n"],
		['0017', 'name', 'Maud: Lady', '    name: "Maud Quill"\n', '    name: "Maud: Lady"\n'],
	];
	for (const [id, field, value, from, to] of cases) {
		it(`${id}.${field} = ${JSON.stringify(value)} → ${to.trim()}`, () => {
			expect(ok(applyOp(MAIN, person(id, { [field]: value }))).body).toBe(replaceOnce(MAIN, from, to));
		});
	}

	it('a new link "[[Wren]]" is double-quoted (plain would be a list), after parents', () => {
		expect(ok(applyOp(MAIN, person('edric', { link: '[[Wren]]' }))).body).toBe(
			replaceOnce(MAIN, '    parents: [aldous, "0017"]\n  - id: rosamund', '    parents: [aldous, "0017"]\n    link: "[[Wren]]"\n  - id: rosamund'),
		);
	});

	it("fixture 10: replacing the unquoted link (a list node) writes a quoted string", () => {
		const body = fixtureSource('10').replace(/\n$/, '');
		expect(ok(applyOp(body, person('wren', { link: '[[Wren of Greyfen]]' }))).body).toBe(
			replaceOnce(body, '    link: [[Wren of the Marches]]', '    link: "[[Wren of Greyfen]]"'),
		);
	});

	it('a multi-line note keeps its line breaks', () => {
		// Decision: a new multi-line value is written in double quotes with \n, as the rule says
		// ("else in double quotes"). It stays on one line, so only that key's line is added.
		expect(ok(applyOp(MAIN, person('aldous', { notes: 'Founded the archive.\nDied at Greyfen.' }))).body).toBe(
			replaceOnce(
				MAIN,
				'    epithet: the Patient      # unknown key in a person\n',
				'    epithet: the Patient      # unknown key in a person\n    notes: "Founded the archive.\\nDied at Greyfen."\n',
			),
		);
	});
});

describe('supervisor decisions (the decision notes "Formatting details fixed by the WP2.1 tests")', () => {
	it("title: '' removes the key, like null", () => {
		expectGolden(applyOp(MAIN, person('aldous', { title: '' })), '09-remove-title.yaml');
	});

	it('a full-line comment directly above a removed key stays', () => {
		const body = 'people:\n  - id: a\n    name: A\n    # the title is disputed\n    title: Lord\n    sex: m';
		expect(ok(applyOp(body, person('a', { title: null }))).body).toBe('people:\n  - id: a\n    name: A\n    # the title is disputed\n    sex: m');
	});

	it('removing a key from the flow-map person leaves tidy flow syntax', () => {
		const line = '  - {id: joan, name: Joan Marsh, sex: f, born: 1135}   # a flow-map person';
		expect(ok(applyOp(MAIN, person('joan', { sex: null }))).body).toBe(
			replaceOnce(MAIN, line, '  - {id: joan, name: Joan Marsh, born: 1135}   # a flow-map person'),
		);
		expect(ok(applyOp(MAIN, person('joan', { born: null }))).body).toBe(
			replaceOnce(MAIN, line, '  - {id: joan, name: Joan Marsh, sex: f}   # a flow-map person'),
		);
	});

	it('removing the last option keeps a full-line comment above options', () => {
		// Decision: the comment is not part of the options lines, so it stays (now above people).
		const body = '# Display settings\noptions:\n  height: 400\n\npeople:\n  - id: a\n    name: A';
		expect(ok(applyOp(body, { kind: 'set-option', key: 'height', value: null })).body).toBe('# Display settings\npeople:\n  - id: a\n    name: A');
	});
});

describe('an empty tree accepts edits (not invalid-yaml)', () => {
	// Decision: in a body with no sections, a new section uses two-space indentation and "  - "
	// items, as in the spec §4 example. After a comment-only body it goes below the comment.

	it('an empty body accepts add-house', () => {
		expect(ok(applyOp('', { kind: 'add-house', name: 'House Fenn' }))).toEqual({
			body: 'houses:\n  - id: house-fenn\n    name: House Fenn',
			created: ['house-fenn'],
		});
	});

	it('a comment-only body accepts add-house', () => {
		expect(ok(applyOp('# nothing yet', { kind: 'add-house', name: 'House Fenn' }))).toEqual({
			body: '# nothing yet\nhouses:\n  - id: house-fenn\n    name: House Fenn',
			created: ['house-fenn'],
		});
	});

	it('an empty body accepts set-option', () => {
		expect(ok(applyOp('', { kind: 'set-option', key: 'height', value: 400 })).body).toBe('options:\n  height: 400');
	});

	it('an empty body has no people', () => {
		expect(applyOp('', person('a', { name: 'A' }))).toMatchObject({ ok: false, code: 'unknown-person' });
	});
});
