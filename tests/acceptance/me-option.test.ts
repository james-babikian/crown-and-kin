import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { ApplyOp, EditResult, Op } from '../../src/core/edit';
import * as fq from '../../src/core/family-query';
import { issueText, type CodedIssue } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import * as edit from '../../src/core/yaml-edit';
import { replaceOnce } from './golden';
import { fixtureNote, topLevelBlocks } from './load';
import { relationsModule } from './relations-support';

/*
 * The "This is me" mark (spec §13.1 "Tree text", D42): `options.me: <id>` as one line, in the key
 * order of §13.0 item 1 (`start, focus, me, generations, height`), with the same formatting rules as
 * the pin (tests/acceptance/pin.test.ts, §6.2). Written through the existing `SetOption` op with the
 * new key `me` (M7 contract). Delete person clears it like `start` and `focus` (§6.7). Two new
 * warnings: `missing-me` and `me-not-id`, with the §13.1 texts.
 *
 * Every expected text is written here by hand. These tests fail until WP7.1.
 */

const applyOp: ApplyOp = edit.applyOp;

const NOTE = fixtureNote('09');
/** Fixture 9, the main tree: options with start, an unknown key and end-of-line comments. */
const MAIN = topLevelBlocks(NOTE)[0].replace(/\n$/, '');
/** Fixture 9, the second plain block: no options. */
const SECOND = topLevelBlocks(NOTE)[1].replace(/\n$/, '');

const mark = (id: string): Op => ({ kind: 'set-option', key: 'me', value: id });
const unmark: Op = { kind: 'set-option', key: 'me', value: null };

function ok(r: EditResult): string {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}

function tree(body: string) {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return r.tree;
}

/** The problems of a block (parse and validation), as the user reads them. */
function problems(body: string): { code: string; text: string }[] {
	return deriveFamilies(tree(body)).issues.map((i: CodedIssue) => ({ code: i.code, text: issueText(i) }));
}

const PEOPLE = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n    parents: [a]';

describe('This is me writes only `me:` under options (§13.1, D42)', () => {
	it('fixture 9: the line goes after the last option; the unknown key and every comment stay', () => {
		const line = '  archive-shelf: B-12         # unknown key in options\n';
		expect(ok(applyOp(MAIN, mark('rosamund')))).toBe(replaceOnce(MAIN, line, `${line}  me: rosamund\n`));
	});

	it('fixture 9: the tree reads back the same, with the mark', () => {
		const before = tree(MAIN);
		const after = tree(ok(applyOp(MAIN, mark('rosamund'))));
		expect(after).toEqual({ ...before, options: { ...before.options, me: 'rosamund' } });
	});

	it('a block without options gets an options section at the top', () => {
		expect(ok(applyOp(SECOND, mark('ysolde')))).toBe(`options:\n  me: ysolde\n\n${SECOND}`);
	});

	it('the key order start, focus, me, generations, height (§13.0 item 1)', () => {
		const body = `options:\n  start: a\n  focus: a\n  generations: 2\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, mark('b')))).toBe(`options:\n  start: a\n  focus: a\n  me: b\n  generations: 2\n  height: 400\n\n${PEOPLE}`);
	});

	it('after start when there is no focus; before height when there is no generations', () => {
		const body = `options:\n  start: a\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, mark('b')))).toBe(`options:\n  start: a\n  me: b\n  height: 400\n\n${PEOPLE}`);
	});

	it('before generations when it is the first option', () => {
		const body = `options:\n  generations: 2\n\n${PEOPLE}`;
		expect(ok(applyOp(body, mark('b')))).toBe(`options:\n  me: b\n  generations: 2\n\n${PEOPLE}`);
	});

	it('a later pin goes before me, and a later height after it', () => {
		const marked = ok(applyOp(`options:\n  start: a\n\n${PEOPLE}`, mark('b')));
		const pinned = ok(applyOp(marked, { kind: 'set-option', key: 'focus', value: 'a' }));
		expect(pinned).toBe(`options:\n  start: a\n  focus: a\n  me: b\n\n${PEOPLE}`);
		expect(ok(applyOp(pinned, { kind: 'set-option', key: 'height', value: 300 }))).toBe(`options:\n  start: a\n  focus: a\n  me: b\n  height: 300\n\n${PEOPLE}`);
	});

	it('flow-style options stay flow style; the pair goes inside the braces in the key order', () => {
		const body = `options: {start: a, height: 400}\n${PEOPLE}`;
		expect(ok(applyOp(body, mark('b')))).toBe(`options: {start: a, me: b, height: 400}\n${PEOPLE}`);
	});

	it('an id that YAML would read as a number is quoted, so it stays text', () => {
		const line = '  archive-shelf: B-12         # unknown key in options\n';
		expect(ok(applyOp(MAIN, mark('0017')))).toBe(replaceOnce(MAIN, line, `${line}  me: "0017"\n`));
		expect(tree(ok(applyOp(MAIN, mark('0017')))).options.me).toBe('0017');
	});

	it('a tree with blocking issues cannot be marked (§8: editing is off)', () => {
		const body = 'people:\n  - id: a\n    name: A\n  - id: a\n    name: A again';
		expect(applyOp(body, mark('a'))).toMatchObject({ ok: false, code: 'blocked' });
	});
});

describe('moving the mark changes one line (§13.1 "it replaces an earlier me")', () => {
	it('only the value changes; the end-of-line comment stays on the line', () => {
		const body = `options:\n  start: a\n  me: a   # the player\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, mark('b')))).toBe(replaceOnce(body, '  me: a   # the player', '  me: b   # the player'));
	});

	it('a second mark on fixture 9 leaves one me line', () => {
		const once = ok(applyOp(MAIN, mark('rosamund')));
		const twice = ok(applyOp(once, mark('piers')));
		expect(twice).toBe(replaceOnce(once, '  me: rosamund\n', '  me: piers\n'));
		expect(twice.match(/\bme:/g)).toHaveLength(1);
	});

	it('marking the marked person again changes nothing', () => {
		const once = ok(applyOp(MAIN, mark('rosamund')));
		expect(ok(applyOp(once, mark('rosamund')))).toBe(once);
	});

	it('in flow style', () => {
		const body = `options: {start: a, me: a}\n${PEOPLE}`;
		expect(ok(applyOp(body, mark('b')))).toBe(`options: {start: a, me: b}\n${PEOPLE}`);
	});

	it('the pin and the mark are separate: moving the mark keeps the pin', () => {
		const body = `options:\n  focus: a\n  me: a\n\n${PEOPLE}`;
		expect(ok(applyOp(body, mark('b')))).toBe(`options:\n  focus: a\n  me: b\n\n${PEOPLE}`);
	});
});

describe('Remove "This is me" removes only that line (§13.1)', () => {
	it('fixture 9: mark, then remove, gives back the original bytes', () => {
		expect(ok(applyOp(ok(applyOp(MAIN, mark('rosamund'))), unmark))).toBe(MAIN);
	});

	it('a block without options: mark, then remove, gives back the original bytes', () => {
		expect(ok(applyOp(ok(applyOp(SECOND, mark('ysolde'))), unmark))).toBe(SECOND);
	});

	it('only the me line goes; the other options stay', () => {
		const body = `options:\n  start: a\n  focus: b\n  me: b\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, unmark))).toBe(`options:\n  start: a\n  focus: b\n  height: 400\n\n${PEOPLE}`);
	});

	it('the last option: options goes, with the blank line after it', () => {
		const body = `options:\n  me: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, unmark))).toBe(PEOPLE);
	});

	it('in flow style', () => {
		const body = `options: {start: a, me: b}\n${PEOPLE}`;
		expect(ok(applyOp(body, unmark))).toBe(`options: {start: a}\n${PEOPLE}`);
	});

	it('with no mark, nothing changes', () => {
		expect(ok(applyOp(MAIN, unmark))).toBe(MAIN);
	});
});

describe('deleting the marked person removes options.me (§13.1, §6.7)', () => {
	it('the me line goes; start stays', () => {
		const body = `options:\n  start: a\n  me: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'b' }))).toBe('options:\n  start: a\n\npeople:\n  - id: a\n    name: A');
	});

	it('the mark was the only option: options goes', () => {
		const body = `options:\n  me: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'b' }))).toBe('people:\n  - id: a\n    name: A');
	});

	it('a person who is pinned and marked: both lines go', () => {
		const body = `options:\n  start: a\n  focus: b\n  me: b\n  height: 400\n\n${PEOPLE}`;
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'b' }))).toBe('options:\n  start: a\n  height: 400\n\npeople:\n  - id: a\n    name: A');
	});

	it('deleting another person keeps the mark', () => {
		const body = `options:\n  me: b\n\n${PEOPLE}`;
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'a' }))).toBe('options:\n  me: b\n\npeople:\n  - id: b\n    name: B');
	});

	it('fixture 9: mark Tamsin, then delete her: the same text as deleting her with no mark', () => {
		const marked = ok(applyOp(MAIN, mark('tamsin')));
		expect(ok(applyOp(marked, { kind: 'delete-person', id: 'tamsin' }))).toBe(ok(applyOp(MAIN, { kind: 'delete-person', id: 'tamsin' })));
	});

	it('the confirmation knows that the person has the mark (DeleteSummary.clearsMe)', () => {
		const body = `options:\n  me: b\n\n${PEOPLE}`;
		const t = tree(body);
		const g = deriveFamilies(t);
		const options = { ...t.options };
		expect(fq.describeDelete(g, 'b', options).clearsMe).toBe(true);
		expect(fq.describeDelete(g, 'a', options).clearsMe ?? false).toBe(false);
	});
});

describe('hand-typed values and warnings (§13.1 "Tree text")', () => {
	it('a numeric id is text and names that person: no warning', () => {
		const body = `options:\n  me: 0042\n\npeople:\n  - id: 0042\n    name: Forty-two\n`;
		expect(tree(body).options.me).toBe('0042');
		expect(problems(body)).toEqual([]);
	});

	it('me names nobody: missing-me, with the §13.1 text', () => {
		const body = `options:\n  me: ghost\n\n${PEOPLE}\n`;
		expect(problems(body)).toEqual([
			{
				code: 'missing-me',
				text: 'No person has the ID “ghost”, so the tree cannot show how people relate to you. Correct the ID, or remove “me: ghost”.',
			},
		]);
	});

	it('me is a list or a map: me-not-id, with the §13.1 text', () => {
		const text = '“me” in the options does not name one person. Write one person ID after “me:”.';
		for (const value of ['[a, b]', '{id: a}', '\n    - a\n    - b']) {
			const body = `options:\n  me: ${value}\n\n${PEOPLE}\n`;
			expect(problems(body), value).toEqual([{ code: 'me-not-id', text }]);
			expect(tree(body).options.me, value).toBeUndefined();
		}
	});

	it('a mark that names nobody gives no names', async () => {
		const { computeRelations } = await relationsModule();
		const body = `options:\n  me: ghost\n\n${PEOPLE}\n`;
		expect(computeRelations(deriveFamilies(tree(body)), 'ghost').size).toBe(0);
	});
});

describe('older plugin versions keep the mark (§13.0 item 2)', () => {
	it('an edit of another field keeps the me line and its place', () => {
		const body = `options:\n  start: a\n  me: b   # me\n  height: 400\n\n${PEOPLE}`;
		const after = ok(applyOp(body, { kind: 'set-person-fields', id: 'a', fields: { name: 'Anna' } }));
		expect(after).toBe(replaceOnce(body, '    name: A\n', '    name: Anna\n'));
	});

	it('pinning and removing the pin keep the me line', () => {
		const body = `options:\n  me: b\n\n${PEOPLE}`;
		const pinned = ok(applyOp(body, { kind: 'set-option', key: 'focus', value: 'a' }));
		// Version 0.1.1 puts the pin after the unknown key; 0.2 puts it before `me` (key order).
		expect(pinned).toContain('\n  me: b\n');
		expect(pinned).toContain('\n  focus: a\n');
		expect(ok(applyOp(pinned, { kind: 'set-option', key: 'focus', value: null }))).toBe(body);
	});
});
