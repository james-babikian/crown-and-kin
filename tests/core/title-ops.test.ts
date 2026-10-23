import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { EditResult, HolderRef, Op } from '../../src/core/edit';
import { describeDelete } from '../../src/core/family-query';
import { parseBody, parseDynasty } from '../../src/core/parse';
import { newTitleId } from '../../src/core/title-ops';
import { applyOp } from '../../src/core/yaml-edit';
import { forgetRecall, recall, remember } from '../../src/core/yaml-patch';

// Spec §13.3–§13.5 and the M8 contract rules 6–8: the title ops, the written forms of holders,
// `card-title` on a person, delete-person (D57) and the `card-title` cleanup. Golden texts: each
// expected body is the old text with exactly the intended lines changed.

function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
const edit = (src: string, op: Op) => body(applyOp(src, op));
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};
function graph(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}
/** The ref a caller reads from the graph for holder `index` of title `title`. */
function ref(src: string, title: string, index: number): HolderRef {
	const t = graph(src).writtenTitles.find((x) => x.id === title)!;
	const h = t.holders.find((x) => x.index === index)!;
	const out: HolderRef = { title, index };
	if (h.person !== undefined) out.person = h.person;
	else if (h.name !== undefined) out.name = h.name;
	if (h.text !== undefined) out.text = h.text;
	return out;
}

const PEOPLE = [
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'  - id: roderick',
	'    name: Roderick Valmont',
	'    title: Lord Protector',
	'  - id: wren',
	'    name: Wren',
	'',
].join('\n');

const TITLES = [
	'houses:',
	'  - id: valmont',
	'    name: House Valmont',
	'',
	'titles:',
	'  - id: duke',
	'    name: Duke of Valmont',
	'    plural: Dukes of Valmont',
	'    numbering: written',
	'    holders:',
	'      # the early dukes',
	'      - {name: Aldric, number: I, from: 1062, to: 1101}',
	'      - {person: aldric, number: II, from: 1131, to: 1160}   # restored',
	'      - roderick',
	'      - person: wren       # hand-typed',
	'        from: 1175',
	'  # the counts',
	'  - id: count',
	'    name: Count of Orsini',
	'    holders: aldric',
	'',
	PEOPLE,
].join('\n');

describe('newTitleId (§6.8, title namespace)', () => {
	it('slugs the name and avoids the title ids and the ids taken in the batch', () => {
		expect(newTitleId(TITLES, 'King of Ostmark')).toBe('king-of-ostmark');
		expect(newTitleId(TITLES, 'Duke')).toBe('duke-2');
		expect(newTitleId(TITLES, 'Duke', new Set(['duke-2']))).toBe('duke-3');
		// Person and house ids are another namespace.
		expect(newTitleId(TITLES, 'Aldric')).toBe('aldric');
		expect(newTitleId(TITLES, '!!!')).toBe('title');
		expect(newTitleId('not: [valid', 'Duke')).toBe('duke');
	});
});

describe('add-title', () => {
	it('appends a title after the last title and its comments', () => {
		const src = TITLES.replace('    holders: aldric\n', '    holders: aldric\n    # about counts\n');
		const out = edit(src, { kind: 'add-title', id: 'king', name: 'King of Ostmark', plural: 'Kings of Ostmark' });
		expect(out).toBe(src.replace('    # about counts\n', '    # about counts\n  - id: king\n    name: King of Ostmark\n    plural: Kings of Ostmark\n'));
	});

	it('a new section goes directly after houses', () => {
		const src = 'houses:\n  - id: h\n    name: H\n\npeople:\n  - id: a\n    name: A\n';
		expect(edit(src, { kind: 'add-title', id: 'duke', name: 'Duke' })).toBe('houses:\n  - id: h\n    name: H\n\ntitles:\n  - id: duke\n    name: Duke\n\npeople:\n  - id: a\n    name: A\n');
		const late = 'people:\n  - id: a\n    name: A\n\nhouses:\n  - id: h\n    name: H\n';
		expect(edit(late, { kind: 'add-title', id: 'duke', name: 'Duke' })).toBe(`${late}\ntitles:\n  - id: duke\n    name: Duke\n`);
	});

	it('with no houses, directly before people; else at the end', () => {
		const src = 'options:\n  start: a\n\nunions: []\n\n# the people\npeople:\n  - id: a\n    name: A\n';
		expect(edit(src, { kind: 'add-title', id: 'duke', name: 'Duke' })).toBe(src.replace('# the people', 'titles:\n  - id: duke\n    name: Duke\n\n# the people'));
		const none = 'options:\n  start: a\n';
		expect(edit(none, { kind: 'add-title', id: 'duke', name: 'Duke' })).toBe('options:\n  start: a\n\ntitles:\n  - id: duke\n    name: Duke\n');
		expect(edit('', { kind: 'add-title', id: 'duke', name: 'Duke' })).toBe('titles:\n  - id: duke\n    name: Duke');
	});

	it('an empty titles key gets the list; a flow list gets a flow item', () => {
		expect(edit('titles:\npeople: []\n', { kind: 'add-title', id: 'duke', name: 'Duke' })).toBe('titles:\n  - id: duke\n    name: Duke\npeople: []\n');
		expect(edit('titles: [{id: a, name: A}]\npeople: []\n', { kind: 'add-title', id: 'b', name: 'B: the second' })).toBe(
			'titles: [{id: a, name: A}, {id: b, name: "B: the second"}]\npeople: []\n',
		);
	});

	it('returns the new id and refuses bad input', () => {
		const r = applyOp(TITLES, { kind: 'add-title', id: 'king', name: 'King' });
		expect(r.ok && r.created).toEqual(['king']);
		expect(code(TITLES, { kind: 'add-title', id: 'duke', name: 'Duke' })).toBe('id-taken');
		expect(code(TITLES, { kind: 'add-title', id: 'king', name: '  ' })).toBe('bad-value');
		expect(code(TITLES, { kind: 'add-title', id: ' king', name: 'King' })).toBe('bad-value');
		expect(code('titles: {a: 1}\npeople: []\n', { kind: 'add-title', id: 'king', name: 'King' })).toBe('bad-value');
		// An empty plural is not written.
		expect(edit(TITLES, { kind: 'add-title', id: 'king', name: 'King', plural: ' ' })).toBe(TITLES.replace('    holders: aldric\n', '    holders: aldric\n  - id: king\n    name: King\n'));
	});
});

describe('edit-title', () => {
	it('renames a title: only its name line changes', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', name: 'Grand Duke of Valmont' })).toBe(TITLES.replace('name: Duke of Valmont', 'name: Grand Duke of Valmont'));
	});

	it('adds, changes and removes the plural', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'count', plural: 'Counts of Orsini' })).toBe(TITLES.replace('    name: Count of Orsini\n', '    name: Count of Orsini\n    plural: Counts of Orsini\n'));
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', plural: 'Grand Dukes' })).toBe(TITLES.replace('plural: Dukes of Valmont', 'plural: Grand Dukes'));
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', plural: null })).toBe(TITLES.replace('    plural: Dukes of Valmont\n', ''));
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', name: 'Duke of Valmont', plural: 'Dukes of Valmont' })).toBe(TITLES);
	});

	it('a title with no name gets one; unknown ids and empty names are refused', () => {
		const src = 'titles:\n  - id: duke\n    holders: []\npeople: []\n';
		expect(edit(src, { kind: 'edit-title', id: 'duke', name: 'Duke' })).toBe('titles:\n  - id: duke\n    name: Duke\n    holders: []\npeople: []\n');
		expect(code(TITLES, { kind: 'edit-title', id: 'king', name: 'King' })).toBe('unknown-title');
		expect(code(TITLES, { kind: 'edit-title', id: 'duke', name: '' })).toBe('bad-value');
	});

	it('acts on the first title with the id', () => {
		const src = 'titles:\n  - {id: t, name: A}\n  - {id: t, name: B}\npeople: []\n';
		expect(edit(src, { kind: 'edit-title', id: 't', name: 'C' })).toBe('titles:\n  - {id: t, name: C}\n  - {id: t, name: B}\npeople: []\n');
	});
});

describe('delete-title', () => {
	it('removes the title with its holders; the comments above the next title stay', () => {
		expect(edit(TITLES, { kind: 'delete-title', id: 'duke' })).toBe(TITLES.replace(/  - id: duke\n[\s\S]*?        from: 1175\n/, ''));
	});

	it('removing the last title removes the titles section', () => {
		const src = 'houses: []\n\ntitles:\n  - id: t\n    name: T\n\npeople: []\n';
		expect(edit(src, { kind: 'delete-title', id: 't' })).toBe('houses: []\n\npeople: []\n');
		expect(code(src, { kind: 'delete-title', id: 'x' })).toBe('unknown-title');
	});
});

describe('add-holder (§13.4, rule 6)', () => {
	it('appends a one-line flow map after the last holder', () => {
		const out = edit(TITLES, { kind: 'add-holder', title: 'duke', fields: { person: 'wren', number: 'II', from: '1207' } });
		expect(out).toBe(TITLES.replace('        from: 1175\n', '        from: 1175\n      - {person: wren, number: II, from: 1207}\n'));
	});

	it('keys in the §13.0 order, values quoted only when needed', () => {
		const src = 'titles:\n  - id: t\n    holders:\n      - {name: X}\npeople: []\n';
		const out = edit(src, { kind: 'add-holder', title: 't', fields: { to: '1101', from: '1062', number: '2', as: 'true', name: 'Odo: the Lame' } });
		expect(out).toBe('titles:\n  - id: t\n    holders:\n      - {name: X}\n      - {name: "Odo: the Lame", as: "true", number: 2, from: 1062, to: 1101}\npeople: []\n');
	});

	it('a title with no holders key gets a block list', () => {
		const src = 'titles:\n  - id: t\n    name: T\npeople:\n  - {id: a, name: A}\n';
		expect(edit(src, { kind: 'add-holder', title: 't', fields: { person: 'a' } })).toBe('titles:\n  - id: t\n    name: T\n    holders:\n      - {person: a}\npeople:\n  - {id: a, name: A}\n');
		const flow = 'titles:\n  - {id: t, name: T}\npeople:\n  - {id: a, name: A}\n';
		expect(edit(flow, { kind: 'add-holder', title: 't', fields: { person: 'a' } })).toBe('titles:\n  - {id: t, name: T, holders: [{person: a}]}\npeople:\n  - {id: a, name: A}\n');
	});

	it('an empty holders value or [] becomes a block list; [] with a comment stays flow', () => {
		const empty = 'titles:\n  - id: t\n    holders:   # none yet\npeople:\n  - {id: a, name: A}\n';
		expect(edit(empty, { kind: 'add-holder', title: 't', fields: { person: 'a' } })).toBe('titles:\n  - id: t\n    holders:   # none yet\n      - {person: a}\npeople:\n  - {id: a, name: A}\n');
		const list = 'titles:\n  - id: t\n    holders: []\npeople:\n  - {id: a, name: A}\n';
		expect(edit(list, { kind: 'add-holder', title: 't', fields: { person: 'a' } })).toBe('titles:\n  - id: t\n    holders:\n      - {person: a}\npeople:\n  - {id: a, name: A}\n');
		const commented = 'titles:\n  - id: t\n    holders: [] # none\npeople:\n  - {id: a, name: A}\n';
		expect(edit(commented, { kind: 'add-holder', title: 't', fields: { person: 'a' } })).toBe('titles:\n  - id: t\n    holders: [{person: a}] # none\npeople:\n  - {id: a, name: A}\n');
	});

	it('holders: aldric first becomes a flow list; a flow list gets a flow item', () => {
		expect(edit(TITLES, { kind: 'add-holder', title: 'count', fields: { name: 'Odo' } })).toBe(TITLES.replace('holders: aldric', 'holders: [aldric, {name: Odo}]'));
		const flow = 'titles:\n  - id: t\n    holders: [a, {name: B}]\npeople:\n  - {id: a, name: A}\n';
		expect(edit(flow, { kind: 'add-holder', title: 't', fields: { person: 'a', to: '9' } })).toBe('titles:\n  - id: t\n    holders: [a, {name: B}, {person: a, to: 9}]\npeople:\n  - {id: a, name: A}\n');
	});

	it('refusals', () => {
		expect(code(TITLES, { kind: 'add-holder', title: 'king', fields: { person: 'wren' } })).toBe('unknown-title');
		expect(code(TITLES, { kind: 'add-holder', title: 'duke', fields: { person: 'ghost' } })).toBe('unknown-person');
		expect(code(TITLES, { kind: 'add-holder', title: 'duke', fields: { number: 'II' } })).toBe('bad-value');
		expect(code(TITLES, { kind: 'add-holder', title: 'duke', fields: {} })).toBe('bad-value');
		expect(code(TITLES, { kind: 'add-holder', title: 'duke', fields: { name: 7 as unknown as string } })).toBe('bad-value');
		expect(code('titles:\n  - id: t\n    holders: {person: a}\npeople:\n  - {id: a, name: A}\n', { kind: 'add-holder', title: 't', fields: { person: 'a' } })).toBe('bad-value');
	});
});

describe('edit-holder (§13.4, §13.5, rule 6)', () => {
	it('changes only that entry of a flow-map holder', () => {
		const out = edit(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'duke', 1), fields: { number: 'III', to: '1161' } });
		expect(out).toBe(TITLES.replace('{person: aldric, number: II, from: 1131, to: 1160}', '{person: aldric, number: III, from: 1131, to: 1161}'));
	});

	it('a block-map holder stays a block map', () => {
		const out = edit(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'duke', 3), fields: { number: 'I', to: '1207' } });
		expect(out).toBe(TITLES.replace('      - person: wren       # hand-typed\n        from: 1175\n', '      - person: wren       # hand-typed\n        number: I\n        from: 1175\n        to: 1207\n'));
	});

	it('a plain-string holder becomes a flow map; holders: aldric becomes a flow list', () => {
		expect(edit(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'duke', 2), fields: { number: 'II' } })).toBe(TITLES.replace('      - roderick\n', '      - {person: roderick, number: II}\n'));
		expect(edit(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'count', 0), fields: { from: '1140' } })).toBe(TITLES.replace('holders: aldric', 'holders: [{person: aldric, from: 1140}]'));
		const quoted = 'titles:\n  - id: t\n    holders:\n      - "0042"\npeople:\n  - {id: "0042", name: Odo}\n';
		expect(edit(quoted, { kind: 'edit-holder', holder: ref(quoted, 't', 0), fields: { as: 'Otto' } })).toBe(quoted.replace('- "0042"', '- {person: "0042", as: Otto}'));
	});

	it('removes a key with null or empty text; keeps unknown keys', () => {
		const src = 'titles:\n  - id: t\n    holders:\n      - {person: a, crowned: yes, number: II}\npeople:\n  - {id: a, name: A}\n';
		expect(edit(src, { kind: 'edit-holder', holder: ref(src, 't', 0), fields: { number: null } })).toBe(src.replace(', number: II', ''));
		expect(edit(src, { kind: 'edit-holder', holder: ref(src, 't', 0), fields: { number: ' ' } })).toBe(src.replace(', number: II', ''));
	});

	it('a holder not in the tree can become a person; a changed ruler name writes as', () => {
		const out = edit(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'duke', 0), fields: { person: 'wren', as: 'Aldric' } });
		expect(out).toBe(TITLES.replace('{name: Aldric, number: I,', '{person: wren, name: Aldric, as: Aldric, number: I,'));
	});

	it('nothing to change writes nothing', () => {
		expect(edit(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'duke', 1), fields: { number: 'II' } })).toBe(TITLES);
	});

	it('refusals: a stale ref, a person not in the tree, a holder with neither person nor name', () => {
		expect(code(TITLES, { kind: 'edit-holder', holder: { title: 'duke', index: 1, person: 'wren' }, fields: { number: 'I' } })).toBe('unknown-holder');
		expect(code(TITLES, { kind: 'edit-holder', holder: { title: 'duke', index: 9, person: 'wren' }, fields: { number: 'I' } })).toBe('unknown-holder');
		expect(code(TITLES, { kind: 'edit-holder', holder: { ...ref(TITLES, 'duke', 1), text: '{person: aldric}' }, fields: { number: 'I' } })).toBe('unknown-holder');
		expect(code(TITLES, { kind: 'edit-holder', holder: { title: 'king', index: 0, person: 'wren' }, fields: {} })).toBe('unknown-title');
		expect(code(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'duke', 1), fields: { person: 'ghost' } })).toBe('unknown-person');
		expect(code(TITLES, { kind: 'edit-holder', holder: ref(TITLES, 'duke', 1), fields: { person: null } })).toBe('bad-value');
		// An empty item or a list is not a holder.
		const odd = 'titles:\n  - id: t\n    holders:\n      -\n      - [a]\npeople: []\n';
		expect(code(odd, { kind: 'edit-holder', holder: { title: 't', index: 0 }, fields: { name: 'X' } })).toBe('unknown-holder');
		expect(code(odd, { kind: 'remove-holder', holder: { title: 't', index: 1 } })).toBe('unknown-holder');
		// A name-only holder is found by its name; a comment in the passed text does not matter.
		expect(code(TITLES, { kind: 'edit-holder', holder: { title: 'duke', index: 0, name: 'Aldric', text: '{name: Aldric, number: I, from: 1062, to: 1101} # x' }, fields: { number: 'I.' } })).toBe('ok');
	});
});

describe('remove-holder (§13.4)', () => {
	it('removes one item with its comments, also the comment lines it owns above it', () => {
		expect(edit(TITLES, { kind: 'remove-holder', holder: ref(TITLES, 'duke', 1) })).toBe(TITLES.replace('      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n', ''));
		expect(edit(TITLES, { kind: 'remove-holder', holder: ref(TITLES, 'duke', 0) })).toBe(TITLES.replace('      # the early dukes\n      - {name: Aldric, number: I, from: 1062, to: 1101}\n', ''));
	});

	it('a comment above a holder with a blank line between stays', () => {
		const src = 'titles:\n  - id: t\n    holders:\n      - {name: A}\n\n      # about B\n\n      - {name: B}\n      - {name: C}\npeople: []\n';
		expect(edit(src, { kind: 'remove-holder', holder: ref(src, 't', 1) })).toBe('titles:\n  - id: t\n    holders:\n      - {name: A}\n\n      # about B\n\n      - {name: C}\npeople: []\n');
	});

	it('removing the last holder leaves holders: []', () => {
		const src = 'titles:\n  - id: t\n    holders:   # the list\n      # only one\n      - {person: a}\n    plural: Ts\npeople:\n  - {id: a, name: A}\n';
		expect(edit(src, { kind: 'remove-holder', holder: ref(src, 't', 0) })).toBe('titles:\n  - id: t\n    holders: []   # the list\n    plural: Ts\npeople:\n  - {id: a, name: A}\n');
		expect(edit(TITLES, { kind: 'remove-holder', holder: ref(TITLES, 'count', 0) })).toBe(TITLES.replace('holders: aldric', 'holders: []'));
		const flow = 'titles:\n  - id: t\n    holders: [{person: a}]\npeople:\n  - {id: a, name: A}\n';
		expect(edit(flow, { kind: 'remove-holder', holder: ref(flow, 't', 0) })).toBe(flow.replace('[{person: a}]', '[]'));
		const two = 'titles:\n  - id: t\n    holders: [a, {name: B}]\npeople:\n  - {id: a, name: A}\n';
		expect(edit(two, { kind: 'remove-holder', holder: ref(two, 't', 0) })).toBe(two.replace('[a, {name: B}]', '[{name: B}]'));
	});

	it('the last holder at the end of the body', () => {
		const src = 'people:\n  - {id: a, name: A}\ntitles:\n  - id: t\n    holders:\n      - {person: a}';
		expect(edit(src, { kind: 'remove-holder', holder: ref(src, 't', 0) })).toBe('people:\n  - {id: a, name: A}\ntitles:\n  - id: t\n    holders: []');
	});
});

describe('set-holders (the Titles window, rule 8)', () => {
	const duke = (i: number) => ({ ref: ref(TITLES, 'duke', i) });

	it('moves an item earlier with its comments', () => {
		const out = edit(TITLES, { kind: 'set-holders', title: 'duke', items: [duke(0), duke(2), duke(1), duke(3)] });
		expect(out).toBe(
			TITLES.replace(
				'      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n      - roderick\n',
				'      - roderick\n      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n',
			),
		);
	});

	it('moves the first item (with the comment it owns) to the end', () => {
		const out = edit(TITLES, { kind: 'set-holders', title: 'duke', items: [duke(1), duke(2), duke(3), duke(0)] });
		expect(out).toBe(
			TITLES.replace(
				'      # the early dukes\n      - {name: Aldric, number: I, from: 1062, to: 1101}\n      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n      - roderick\n      - person: wren       # hand-typed\n        from: 1175\n',
				'      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n      - roderick\n      - person: wren       # hand-typed\n        from: 1175\n      # the early dukes\n      - {name: Aldric, number: I, from: 1062, to: 1101}\n',
			),
		);
	});

	it('adds, removes and edits in place when nothing moves', () => {
		const out = edit(TITLES, {
			kind: 'set-holders',
			title: 'duke',
			items: [{ add: { name: 'Odo' } }, duke(0), { ...duke(2), fields: { from: '1160' } }, { add: { person: 'aldric', to: '1170' } }, duke(3)],
		});
		// The new first item goes above the comment that the old first item owns.
		expect(out).toBe(
			TITLES.replace('      # the early dukes\n', '      - {name: Odo}\n      # the early dukes\n')
				.replace('      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n', '')
				.replace('      - roderick\n', '      - {person: roderick, from: 1160}\n      - {person: aldric, to: 1170}\n'),
		);
	});

	it('moves and edits in one op', () => {
		const out = edit(TITLES, { kind: 'set-holders', title: 'duke', items: [duke(3), { ...duke(0), fields: { number: 'Ia' } }] });
		expect(out).toBe(
			TITLES.replace(
				'      # the early dukes\n      - {name: Aldric, number: I, from: 1062, to: 1101}\n      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n      - roderick\n      - person: wren       # hand-typed\n        from: 1175\n',
				'      - person: wren       # hand-typed\n        from: 1175\n      # the early dukes\n      - {name: Aldric, number: Ia, from: 1062, to: 1101}\n',
			),
		);
	});

	it('an empty final list leaves holders: []', () => {
		const out = edit(TITLES, { kind: 'set-holders', title: 'duke', items: [] });
		expect(out).toBe(
			TITLES.replace(
				'    holders:\n      # the early dukes\n      - {name: Aldric, number: I, from: 1062, to: 1101}\n      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n      - roderick\n      - person: wren       # hand-typed\n        from: 1175\n',
				'    holders: []\n',
			),
		);
	});

	it('new holders for a title with none; a flow list moves on one line; holders: aldric', () => {
		const src = 'titles:\n  - id: t\n    name: T\npeople:\n  - {id: a, name: A}\n';
		expect(edit(src, { kind: 'set-holders', title: 't', items: [{ add: { name: 'B' } }, { add: { person: 'a' } }] })).toBe(
			'titles:\n  - id: t\n    name: T\n    holders:\n      - {name: B}\n      - {person: a}\npeople:\n  - {id: a, name: A}\n',
		);
		const flow = 'titles:\n  - id: t\n    holders: [a, {name: B}, {name: C}]\npeople:\n  - {id: a, name: A}\n';
		const refs = (s: string) => [0, 1, 2].map((i) => ({ ref: ref(s, 't', i) }));
		const [a, b, c] = refs(flow);
		expect(edit(flow, { kind: 'set-holders', title: 't', items: [c, a] })).toBe(flow.replace('[a, {name: B}, {name: C}]', '[{name: C}, a]'));
		expect(edit(flow, { kind: 'set-holders', title: 't', items: [a, { add: { name: 'X' } }, c] })).toBe(flow.replace('[a, {name: B}, {name: C}]', '[a, {name: X}, {name: C}]'));
		expect(edit(flow, { kind: 'set-holders', title: 't', items: [b] })).toBe(flow.replace('[a, {name: B}, {name: C}]', '[{name: B}]'));
		expect(edit(TITLES, { kind: 'set-holders', title: 'count', items: [{ add: { name: 'Odo' } }, { ref: ref(TITLES, 'count', 0), fields: { number: 'I' } }] })).toBe(
			TITLES.replace('holders: aldric', 'holders: [{name: Odo}, {person: aldric, number: I}]'),
		);
	});

	it('the same list writes nothing', () => {
		expect(edit(TITLES, { kind: 'set-holders', title: 'duke', items: [duke(0), duke(1), duke(2), duke(3)] })).toBe(TITLES);
	});

	it('refusals', () => {
		expect(code(TITLES, { kind: 'set-holders', title: 'duke', items: [duke(0), duke(0)] })).toBe('bad-value');
		expect(code(TITLES, { kind: 'set-holders', title: 'duke', items: [{ ref: ref(TITLES, 'count', 0) }] })).toBe('unknown-holder');
		expect(code(TITLES, { kind: 'set-holders', title: 'duke', items: [{ ref: { title: 'duke', index: 1, person: 'wren' } }] })).toBe('unknown-holder');
		expect(code(TITLES, { kind: 'set-holders', title: 'king', items: [] })).toBe('unknown-title');
		expect(code(TITLES, { kind: 'set-holders', title: 'duke', items: [{ add: { person: 'ghost' } }] })).toBe('unknown-person');
		expect(code(TITLES, { kind: 'set-holders', title: 'duke', items: [{} as never] })).toBe('bad-value');
	});
});

describe('CRLF bodies keep their line ends', () => {
	const crlf = (s: string) => s.replace(/\n/g, '\r\n');

	it('a move, an add and a new section', () => {
		const src = crlf(TITLES);
		const duke = (i: number) => ({ ref: ref(src, 'duke', i) });
		expect(edit(src, { kind: 'set-holders', title: 'duke', items: [duke(0), duke(2), duke(1), duke(3), { add: { name: 'Odo' } }] })).toBe(
			crlf(
				TITLES.replace(
					'      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n      - roderick\n      - person: wren       # hand-typed\n        from: 1175\n',
					'      - roderick\n      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n      - person: wren       # hand-typed\n        from: 1175\n      - {name: Odo}\n',
				),
			),
		);
		const plain = crlf('houses:\n  - id: h\n    name: H\npeople:\n  - id: a\n    name: A\n');
		expect(edit(plain, { kind: 'add-title', id: 't', name: 'T' })).toBe(crlf('houses:\n  - id: h\n    name: H\n\ntitles:\n  - id: t\n    name: T\n\npeople:\n  - id: a\n    name: A\n'));
		expect(edit(crlf('people:\n  - id: a\n    name: A\n'), { kind: 'add-title', id: 't', name: 'T' })).toBe(crlf('titles:\n  - id: t\n    name: T\n\npeople:\n  - id: a\n    name: A\n'));
	});
});

describe('the Titles window batch (rule 8): one write', () => {
	it('adds a title with holders, changes another and deletes a third', () => {
		const src = TITLES.replace('    holders: aldric\n', '    holders: aldric\n  - id: baron\n    name: Baron\n');
		const id = newTitleId(src, 'King of Ostmark');
		const out = edit(src, {
			kind: 'batch',
			ops: [
				{ kind: 'add-title', id, name: 'King of Ostmark' },
				{ kind: 'edit-title', id: 'count', name: 'Count of Orsini and Vell' },
				{ kind: 'set-holders', title: id, items: [{ add: { person: 'wren', from: '1200' } }] },
				{ kind: 'set-holders', title: 'duke', items: [{ ref: ref(src, 'duke', 0) }, { ref: ref(src, 'duke', 2) }, { ref: ref(src, 'duke', 3) }] },
				{ kind: 'delete-title', id: 'baron' },
			],
		});
		expect(out).toBe(
			TITLES.replace('      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n', '')
				.replace('Count of Orsini', 'Count of Orsini and Vell')
				.replace('    holders: aldric\n', '    holders: aldric\n  - id: king-of-ostmark\n    name: King of Ostmark\n    holders:\n      - {person: wren, from: 1200}\n'),
		);
	});
});

describe('card-title on a person (§13.3)', () => {
	it('goes after title, else after name; null removes it', () => {
		const withTitle = edit(TITLES, { kind: 'set-person-fields', id: 'roderick', fields: { 'card-title': 'count' } });
		expect(withTitle).toBe(TITLES.replace('    title: Lord Protector\n', '    title: Lord Protector\n    card-title: count\n'));
		const noTitle = edit(TITLES, { kind: 'set-person-fields', id: 'wren', fields: { 'card-title': 'duke' } });
		expect(noTitle).toBe(TITLES.replace('    name: Wren\n', '    name: Wren\n    card-title: duke\n'));
		expect(edit(noTitle, { kind: 'set-person-fields', id: 'wren', fields: { 'card-title': null } })).toBe(TITLES);
		expect(edit(TITLES, { kind: 'set-person-fields', id: 'wren', fields: { 'card-title': '0042' } })).toContain('    card-title: "0042"\n');
	});

	it('other new keys follow card-title', () => {
		const src = 'people:\n  - id: a\n    name: A\n    card-title: t\n';
		expect(edit(src, { kind: 'set-person-fields', id: 'a', fields: { house: 'h', title: 'Lord' } })).toBe('people:\n  - id: a\n    name: A\n    title: Lord\n    card-title: t\n    house: h\n');
	});
});

describe('delete-person also removes holder entries (D57)', () => {
	it('every entry in every title, in the same write; the titles stay', () => {
		const out = edit(TITLES, { kind: 'delete-person', id: 'aldric' });
		expect(out).toBe(
			TITLES.replace('      - {person: aldric, number: II, from: 1131, to: 1160}   # restored\n', '')
				.replace('holders: aldric', 'holders: []')
				.replace('  - id: aldric\n    name: Aldric Valmont\n', ''),
		);
	});

	it('titles with a duplicate id too, and a block list that loses its last holder', () => {
		const src = 'titles:\n  - id: t\n    holders:\n      - {person: a}\n  - id: t\n    holders: [b, a, {person: a, number: II}]\n  - holders: [a]\npeople:\n  - {id: a, name: A}\n  - {id: b, name: B}\n';
		expect(edit(src, { kind: 'delete-person', id: 'a' })).toBe('titles:\n  - id: t\n    holders: []\n  - id: t\n    holders: [b]\n  - holders: [a]\npeople:\n  - {id: b, name: B}\n');
	});

	it('the confirmation counts the written entries and their titles', () => {
		const g = graph(TITLES);
		expect(describeDelete(g, 'aldric', {}).holders).toEqual({ titles: 2, entries: 2 });
		expect(describeDelete(g, 'wren', {}).holders).toEqual({ titles: 1, entries: 1 });
		const dup = graph('titles:\n  - id: t\n    holders: [a]\n  - id: t\n    holders: [a, {person: a}]\npeople:\n  - {id: a, name: A}\n  - {id: b, name: B}\n');
		expect(describeDelete(dup, 'a', {}).holders).toEqual({ titles: 2, entries: 3 });
		expect(describeDelete(dup, 'b', {}).holders).toEqual({ titles: 0, entries: 0 });
		// A tree with no titles: the summary is as in 0.1.
		expect('holders' in describeDelete(graph(PEOPLE), 'wren', {})).toBe(false);
	});
});

describe('card-title cleanup (rule 7), once per write', () => {
	const SRC = [
		'titles:',
		'  - id: duke',
		'    holders: [a, b, {person: b, from: 1140}]',
		'  - id: count',
		'    holders: [a, b, c]',
		'people:',
		'  - {id: a, name: A, card-title: count}',
		'  - {id: b, name: B, card-title: duke}',
		'  - {id: c, name: C, card-title: duke}',
		'',
	].join('\n');

	it('remove-holder of the last entry of the selected title removes card-title', () => {
		expect(edit(SRC, { kind: 'remove-holder', holder: ref(SRC, 'count', 0) })).toBe(SRC.replace('[a, b, c]', '[b, c]').replace('{id: a, name: A, card-title: count}', '{id: a, name: A}'));
	});

	it('removing one of two entries keeps it; an invalid card-title stays', () => {
		expect(edit(SRC, { kind: 'remove-holder', holder: ref(SRC, 'duke', 1) })).toBe(SRC.replace('[a, b, {person: b, from: 1140}]', '[a, {person: b, from: 1140}]'));
		// C does not hold duke: the warning stays until the owner acts.
		expect(edit(SRC, { kind: 'remove-holder', holder: ref(SRC, 'count', 2) })).toBe(SRC.replace('[a, b, c]', '[a, b]'));
	});

	it('delete-title removes every card-title that names it, valid or not (supervisor ruling)', () => {
		expect(edit(SRC, { kind: 'delete-title', id: 'duke' })).toBe(
			SRC.replace('  - id: duke\n    holders: [a, b, {person: b, from: 1140}]\n', '')
				.replace('{id: b, name: B, card-title: duke}', '{id: b, name: B}')
				.replace('{id: c, name: C, card-title: duke}', '{id: c, name: C}'),
		);
	});

	it('edit-holder that changes the person, and set-holders', () => {
		expect(edit(SRC, { kind: 'edit-holder', holder: ref(SRC, 'count', 0), fields: { person: 'c' } })).toBe(
			SRC.replace('[a, b, c]', '[{person: c}, b, c]').replace('{id: a, name: A, card-title: count}', '{id: a, name: A}'),
		);
		expect(edit(SRC, { kind: 'set-holders', title: 'count', items: [{ ref: ref(SRC, 'count', 2) }] })).toBe(
			SRC.replace('[a, b, c]', '[c]').replace('{id: a, name: A, card-title: count}', '{id: a, name: A}'),
		);
	});

	it('in a batch, judged on the final data', () => {
		// Removed and added again: still held.
		const again = edit(SRC, { kind: 'batch', ops: [{ kind: 'remove-holder', holder: ref(SRC, 'count', 0) }, { kind: 'add-holder', title: 'count', fields: { person: 'a' } }] });
		expect(again).toBe(SRC.replace('[a, b, c]', '[b, c, {person: a}]'));
		// A card-title the batch wrote itself stays.
		const own = edit(SRC, {
			kind: 'batch',
			ops: [
				{ kind: 'set-person-fields', id: 'a', fields: { 'card-title': 'duke' } },
				{ kind: 'remove-holder', holder: ref(SRC, 'duke', 0) },
			],
		});
		expect(own).toBe(SRC.replace('[a, b, {person: b, from: 1140}]', '[b, {person: b, from: 1140}]').replace('card-title: count}', 'card-title: duke}'));
		// Two removals in one batch: the card-title goes once.
		const both = edit(SRC, {
			kind: 'batch',
			ops: [
				{ kind: 'remove-holder', holder: ref(SRC, 'duke', 1) },
				{ kind: 'remove-holder', holder: { title: 'duke', index: 1, person: 'b', text: '{person: b, from: 1140}' } },
			],
		});
		expect(both).toBe(SRC.replace('[a, b, {person: b, from: 1140}]', '[a]').replace('{id: b, name: B, card-title: duke}', '{id: b, name: B}'));
	});

	it('delete-title of the first of two titles with the id removes every card-title with that value', () => {
		const src = 'titles:\n  - {id: t, holders: [a]}\n  - {id: t, holders: [b]}\npeople:\n  - {id: a, name: A, card-title: t}\n  - {id: b, name: B, card-title: t}\n';
		expect(edit(src, { kind: 'delete-title', id: 't' })).toBe('titles:\n  - {id: t, holders: [b]}\npeople:\n  - {id: a, name: A}\n  - {id: b, name: B}\n');
	});

	it('set-holders keeps the written items that the window does not show (supervisor ruling)', () => {
		const src = [
			'titles:',
			'  - id: t',
			'    holders:',
			'      - {number: 0}     # no person and no name',
			'      - {person: a}',
			'      - {person: ghost}  # names nobody',
			'      - [x, y]',
			'      - {person: b}',
			'people:',
			'  - {id: a, name: A}',
			'  - {id: b, name: B}',
			'',
		].join('\n');
		const out = edit(src, { kind: 'set-holders', title: 't', items: [{ ref: ref(src, 't', 4) }, { ref: ref(src, 't', 1) }, { add: { name: 'C' } }] });
		expect(out).toBe(
			[
				'titles:',
				'  - id: t',
				'    holders:',
				'      - {number: 0}     # no person and no name',
				'      - {person: b}',
				'      - {person: a}',
				'      - {person: ghost}  # names nobody',
				'      - [x, y]',
				'      - {name: C}',
				'people:',
				'  - {id: a, name: A}',
				'  - {id: b, name: B}',
				'',
			].join('\n'),
		);
		// Removing every shown holder keeps the others.
		expect(edit(src, { kind: 'set-holders', title: 't', items: [] })).toBe(src.replace('      - {person: a}\n', '').replace('      - {person: b}\n', ''));
	});

	it('the data kept for the cleanup is cleared after each write, also a refused one', () => {
		const parsed = parseBody(SRC);
		if (!parsed.ok) throw new Error('parse');
		remember(SRC, parsed.data);
		expect(recall(SRC)).toBe(parsed.data);
		const out = edit(SRC, { kind: 'remove-holder', holder: ref(SRC, 'duke', 1) });
		expect(recall(SRC)).toBeUndefined();
		expect(recall(out)).toBeUndefined();
		remember(SRC, parsed.data);
		expect(code(SRC, { kind: 'remove-holder', holder: { title: 'duke', index: 99 } })).toBe('unknown-holder');
		expect(recall(SRC)).toBeUndefined();
		remember(SRC, parsed.data);
		forgetRecall();
		expect(recall(SRC)).toBeUndefined();
	});

	it('a tree with no card-title is not parsed again', () => {
		const src = 'titles:\n  - {id: t, holders: [a]}\npeople:\n  - {id: a, name: A}\n';
		expect(edit(src, { kind: 'remove-holder', holder: ref(src, 't', 0) })).toBe(src.replace('[a]', '[]'));
	});
});

describe('M8 fix round (review findings 1 and 2)', () => {
	const P = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n';

	it('a flow list whose items all go becomes [] in one piece; a comment after it stays', () => {
		const src = `titles:\n  - id: t\n    holders: [a, {person: b}] # the list\n${P}`;
		expect(edit(src, { kind: 'set-holders', title: 't', items: [] })).toBe(src.replace('[a, {person: b}]', '[]'));
		const multi = `titles:\n  - id: t\n    holders: [\n      a,   # first\n      {person: a, number: II},\n    ]   # after\n${P}`;
		expect(edit(multi, { kind: 'delete-person', id: 'a' })).toBe(`titles:\n  - id: t\n    holders: []   # after\npeople:\n  - {id: b, name: B}\n`);
		const inMap = `titles:\n  - {id: t, holders: [b, ]}\n${P}`;
		expect(edit(inMap, { kind: 'remove-holder', holder: ref(inMap, 't', 0) })).toBe(inMap.replace('[b, ]', '[]'));
	});

	it('a converted plain-string holder loses its tag and anchor', () => {
		const block = `titles:\n  - id: t\n    holders:\n      - &x !!str a\n${P}`;
		expect(edit(block, { kind: 'edit-holder', holder: ref(block, 't', 0), fields: { number: 'II' } })).toBe(block.replace('&x !!str a', '{person: a, number: II}'));
		const flow = `titles:\n  - id: t\n    holders: [!!str a, b]\n${P}`;
		expect(edit(flow, { kind: 'edit-holder', holder: ref(flow, 't', 0), fields: { number: 'II' } })).toBe(flow.replace('!!str a', '{person: a, number: II}'));
		const plain = `titles:\n  - id: t\n    holders: [a,b]\n${P}`;
		expect(edit(plain, { kind: 'edit-holder', holder: ref(plain, 't', 1), fields: { number: 'II' } })).toBe(plain.replace('[a,b]', '[a,{person: b, number: II}]'));
	});
});
