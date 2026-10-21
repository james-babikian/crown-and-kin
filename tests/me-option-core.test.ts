import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { describeDelete } from '../src/core/family-query';
import { issueText } from '../src/core/messages';
import { parseBody, parseDynasty, referencedIds } from '../src/core/parse';
import type { RawMap } from '../src/core/tolerate';
import { applyOp } from '../src/core/yaml-edit';
import { OPTION_ORDER, TEXT_FIELDS } from '../src/core/yaml-patch';

// The "This is me" option in the core (spec §13.1 "Tree text", D42): reading, warnings, the
// option order, delete and the id reservation. tests/acceptance/me-option.test.ts covers the edits.

const PEOPLE = 'people:\n  - id: gwen\n    name: Gwen\n  - id: "42"\n    name: Number\n';

function read(options: string) {
	const r = parseDynasty(`options:\n${options}\n${PEOPLE}`);
	if (!r.ok) throw new Error(r.error.code);
	return { tree: r.tree, g: deriveFamilies(r.tree) };
}

describe('options.me is read into TreeOptions.me', () => {
	it('an id, and a numeric id as text', () => {
		expect(read('  me: gwen').tree.options.me).toBe('gwen');
		expect(read('  me: 42').tree.options.me).toBe('42');
		expect(read('  me: 42').g.issues).toEqual([]);
	});

	it('nothing written gives no mark and no warning', () => {
		for (const v of ['  me:', '  me: ~', '  me: ""', '  start: gwen']) {
			const { tree, g } = read(v);
			expect(tree.options.me).toBeUndefined();
			expect(g.issues).toEqual([]);
		}
	});

	it('a list or a map gives me-not-id and no mark', () => {
		for (const v of ['  me: [gwen, "42"]', '  me: [gwen]', '  me: {id: gwen}']) {
			const { tree, g } = read(v);
			expect(tree.options.me).toBeUndefined();
			expect(g.issues).toEqual([{ code: 'me-not-id', level: 'warning', params: {} }]);
		}
		expect(issueText({ code: 'me-not-id', level: 'warning', params: {} })).toBe('“me” in the options does not name one person. Write one person ID after “me:”.');
	});

	it('an id that names nobody gives missing-me', () => {
		const { g } = read('  me: ghost');
		expect(g.issues).toEqual([{ code: 'missing-me', level: 'warning', params: { ref: 'ghost' } }]);
		expect(issueText(g.issues[0])).toBe('No person has the ID “ghost”, so the tree cannot show how people relate to you. Correct the ID, or remove “me: ghost”.');
	});
});

describe('the me option in edits', () => {
	it('sits between focus and generations, and is written as text', () => {
		expect(OPTION_ORDER).toEqual(['start', 'focus', 'me', 'generations', 'height', 'calendar']);
		expect(TEXT_FIELDS.has('me')).toBe(true);
		const r = applyOp('options:\n  focus: gwen\n  height: 400\n' + PEOPLE, { kind: 'set-option', key: 'me', value: 'gwen' });
		expect(r).toMatchObject({ ok: true });
		if (r.ok) expect(r.body.startsWith('options:\n  focus: gwen\n  me: gwen\n  height: 400\n')).toBe(true);
	});

	it('the ids of options.me are reserved for new people', () => {
		const parsed = parseBody('options:\n  me: ghost\npeople: []\n');
		if (!parsed.ok) throw new Error('parse');
		expect(referencedIds(parsed.data as RawMap).has('ghost')).toBe(true);
	});

	it('deleting the marked person removes the mark', () => {
		const r = applyOp('options:\n  me: gwen\n' + PEOPLE, { kind: 'delete-person', id: 'gwen' });
		expect(r).toMatchObject({ ok: true });
		if (r.ok) expect(r.body).toBe('people:\n  - id: "42"\n    name: Number\n');
	});

	it('describeDelete sets clearsMe only when the options have a mark', () => {
		const { g } = read('  me: gwen');
		expect(describeDelete(g, 'gwen', { me: 'gwen' }).clearsMe).toBe(true);
		expect(describeDelete(g, '42', { me: 'gwen' }).clearsMe).toBe(false);
		expect('clearsMe' in describeDelete(g, 'gwen', {})).toBe(false);
	});
});
