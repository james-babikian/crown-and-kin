import { describe, expect, it } from 'vitest';
import type { PlanWrite } from '../../src/core/block-write';
import * as locate from '../../src/core/block-locate';
import * as write from '../../src/core/block-write';
import type { ApplyOp, EditResult, Op } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import * as edit from '../../src/core/yaml-edit';
import { replaceOnce } from './golden';
import { fixtureNote, topLevelBlocks } from './load';

// The pin (spec §0 D18, §5.6 "Pin", §6.3 actions): Pin focus here writes `options.focus: <id>` as
// one line and replaces an earlier pin; Remove pin removes that line. Both use the existing
// `SetOption { key: 'focus' }` op (M5 contract, src/core/focus.ts). Formatting follows §6.2 and
// The decision notes "Formatting details fixed by the WP2.1 tests": a new key goes before the first
// later key in the §4.1 order (start, focus, generations, height), else after the map's last
// entry; unknown keys never decide the position; a missing `options` goes first with one blank
// line after it; removing the last option removes `options` and that blank line. Deleting the
// pinned person clears the pin (§6.7).
//
// Every expected text is written here by hand, by replacing exact lines of the input.

const applyOp: ApplyOp = edit.applyOp;
/** The block with this ordinal, or null. */
const locateBlock = (text: string, ordinal: number) => locate.findBlocks(text)[ordinal] ?? null;
const planWrite: PlanWrite = write.planWrite;

const NOTE = fixtureNote('09');
/** Fixture 9, the main tree: options with start, an unknown key and end-of-line comments. */
const MAIN = topLevelBlocks(NOTE)[0].replace(/\n$/, '');
/** Fixture 9, the second plain block: no options. */
const SECOND = topLevelBlocks(NOTE)[1].replace(/\n$/, '');

const pin = (id: string): Op => ({ kind: 'set-option', key: 'focus', value: id });
const unpin: Op = { kind: 'set-option', key: 'focus', value: null };

function ok(r: EditResult): string {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}

function tree(body: string) {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return r.tree;
}

const PEOPLE = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n    parents: [a]';

describe('Pin focus here writes options.focus as one line (§5.6, D18)', () => {
	it('fixture 9: the line goes after the last option; the unknown key and every comment stay', () => {
		const line = '  archive-shelf: B-12         # unknown key in options\n';
		expect(ok(applyOp(MAIN, pin('rosamund')))).toBe(replaceOnce(MAIN, line, `${line}  focus: rosamund\n`));
	});

	it('fixture 9: the tree reads back the same, with the pin', () => {
		const before = tree(MAIN);
		const after = tree(ok(applyOp(MAIN, pin('rosamund'))));
		expect(after).toEqual({ ...before, options: { ...before.options, focus: 'rosamund' } });
	});

	it('a block without options gets an options section at the top', () => {
		expect(ok(applyOp(SECOND, pin('ysolde')))).toBe(`options:\n  focus: ysolde\n\n${SECOND}`);
	});

	it('the §4.1 order: after start, before generations and height', () => {
		const body = `options:\n  start: a\n  generations: 2\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, pin('b')))).toBe(`options:\n  start: a\n  focus: b\n  generations: 2\n  height: 400\n\n${PEOPLE}`);
	});

	it('before height when start is absent; a full-line comment above height stays above height', () => {
		const body = `options:\n  # size in the note\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, pin('b')))).toBe(`options:\n  focus: b\n  # size in the note\n  height: 400\n\n${PEOPLE}`);
	});

	it('flow-style options stay flow style; the pair goes inside the braces in §4.1 order', () => {
		const body = `options: {start: a, height: 400}\n${PEOPLE}`;
		expect(ok(applyOp(body, pin('b')))).toBe(`options: {start: a, focus: b, height: 400}\n${PEOPLE}`);
	});

	it('an id that YAML would read as a number is quoted, so it stays text', () => {
		const line = '  archive-shelf: B-12         # unknown key in options\n';
		expect(ok(applyOp(MAIN, pin('0017')))).toBe(replaceOnce(MAIN, line, `${line}  focus: "0017"\n`));
		expect(tree(ok(applyOp(MAIN, pin('0017')))).options.focus).toBe('0017');
	});

	it('a tree with blocking issues cannot be pinned (§8: editing is off)', () => {
		const body = 'people:\n  - id: a\n    name: A\n  - id: a\n    name: A again';
		expect(applyOp(body, pin('a'))).toMatchObject({ ok: false, code: 'blocked' });
	});
});

describe('pinning another person replaces the pin (§5.6 "it replaces an earlier pin")', () => {
	it('only the value changes; the end-of-line comment stays on the line', () => {
		const body = `options:\n  start: a\n  focus: a   # the player\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, pin('b')))).toBe(replaceOnce(body, '  focus: a   # the player', '  focus: b   # the player'));
	});

	it('a second pin on fixture 9 leaves one focus line', () => {
		const once = ok(applyOp(MAIN, pin('rosamund')));
		const twice = ok(applyOp(once, pin('piers')));
		expect(twice).toBe(replaceOnce(once, '  focus: rosamund\n', '  focus: piers\n'));
		expect(twice.match(/focus:/g)).toHaveLength(1);
	});

	it('pinning the pinned person again changes nothing', () => {
		const once = ok(applyOp(MAIN, pin('rosamund')));
		expect(ok(applyOp(once, pin('rosamund')))).toBe(once);
	});

	it('in flow style', () => {
		const body = `options: {start: a, focus: a}\n${PEOPLE}`;
		expect(ok(applyOp(body, pin('b')))).toBe(`options: {start: a, focus: b}\n${PEOPLE}`);
	});
});

describe('Remove pin removes the line (§5.6)', () => {
	it('fixture 9: pin, then Remove pin, gives back the original bytes', () => {
		expect(ok(applyOp(ok(applyOp(MAIN, pin('rosamund'))), unpin))).toBe(MAIN);
	});

	it('a block without options: pin, then Remove pin, gives back the original bytes', () => {
		expect(ok(applyOp(ok(applyOp(SECOND, pin('ysolde'))), unpin))).toBe(SECOND);
	});

	it('only the focus line goes; the other options stay', () => {
		const body = `options:\n  start: a\n  focus: b\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, unpin))).toBe(`options:\n  start: a\n  height: 400\n\n${PEOPLE}`);
	});

	it('the end-of-line comment on the focus line goes with it', () => {
		const body = `options:\n  start: a\n  focus: b   # the player\n\n${PEOPLE}`;
		expect(ok(applyOp(body, unpin))).toBe(`options:\n  start: a\n\n${PEOPLE}`);
	});

	it('a full-line comment directly above the focus line stays', () => {
		const body = `options:\n  start: a\n  # the player\n  focus: b\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, unpin))).toBe(`options:\n  start: a\n  # the player\n  height: 400\n\n${PEOPLE}`);
	});

	it('the last option: options goes, with the blank line after it', () => {
		const body = `options:\n  focus: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, unpin))).toBe(PEOPLE);
	});

	it('in flow style', () => {
		const body = `options: {start: a, focus: b}\n${PEOPLE}`;
		expect(ok(applyOp(body, unpin))).toBe(`options: {start: a}\n${PEOPLE}`);
	});

	it('with no pin, nothing changes', () => {
		expect(ok(applyOp(MAIN, unpin))).toBe(MAIN);
	});

	it('the rest of the tree reads back the same', () => {
		const body = `# Pinned for the player\noptions:\n  start: a\n  focus: b\n  extra: kept   # unknown key\n\n${PEOPLE}\nunions:\n  - partners: [a, b]\n`;
		const after = ok(applyOp(body, unpin));
		expect(after).toBe(replaceOnce(body, '  focus: b\n', ''));
		expect(tree(after)).toEqual({ ...tree(body), options: { ...tree(body).options, focus: undefined } });
	});
});

describe('a block in a callout or a list item keeps its prefix (§6.1, §6.2)', () => {
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

	it('callout: a new options section gets "> " on its lines and ">" on the blank line', () => {
		expect(writeNote(NOTE, 1, pin('hugh'))).toBe(
			replaceOnce(NOTE, '> ```dynasty\n> people:\n>   - id: osric\n', '> ```dynasty\n> options:\n>   focus: hugh\n>\n> people:\n>   - id: osric\n'),
		);
	});

	it('callout inside a callout: "> > " and "> >"', () => {
		expect(writeNote(NOTE, 2, pin('wat'))).toBe(
			replaceOnce(NOTE, '> > ```dynasty\n> > people:\n', '> > ```dynasty\n> > options:\n> >   focus: wat\n> >\n> > people:\n'),
		);
	});

	it('list item: the line keeps the indentation, before height', () => {
		expect(writeNote(NOTE, 3, pin('joan-marsh'))).toBe(replaceOnce(NOTE, '  options:\n    height: 400\n', '  options:\n    focus: joan-marsh\n    height: 400\n'));
	});

	it('callout and list item: pin, then Remove pin, gives back the original note', () => {
		expect(writeNote(writeNote(NOTE, 1, pin('hugh')), 1, unpin)).toBe(NOTE);
		expect(writeNote(writeNote(NOTE, 3, pin('joan-marsh')), 3, unpin)).toBe(NOTE);
	});
});

describe('deleting the pinned person clears the pin (§6.7)', () => {
	it('the focus line goes; start stays', () => {
		const body = `options:\n  start: a\n  focus: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'b' }))).toBe('options:\n  start: a\n\npeople:\n  - id: a\n    name: A');
	});

	it('the pin was the only option: options goes', () => {
		const body = `options:\n  focus: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'b' }))).toBe('people:\n  - id: a\n    name: A');
	});

	it('deleting another person keeps the pin', () => {
		const body = `options:\n  focus: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'a' }))).toBe('options:\n  focus: b\n\npeople:\n  - id: b\n    name: B');
	});

	it('fixture 9: pin Tamsin, then delete her: the same text as deleting her with no pin', () => {
		const pinned = ok(applyOp(MAIN, pin('tamsin')));
		expect(ok(applyOp(pinned, { kind: 'delete-person', id: 'tamsin' }))).toBe(ok(applyOp(MAIN, { kind: 'delete-person', id: 'tamsin' })));
	});

	it('an id that only starts like the pinned id does not clear it', () => {
		const body = 'options:\n  focus: ab\n\npeople:\n  - id: a\n    name: A\n  - id: ab\n    name: AB';
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'a' }))).toBe('options:\n  focus: ab\n\npeople:\n  - id: ab\n    name: AB');
	});
});
