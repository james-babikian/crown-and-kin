import { describe, expect, it } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';
import { createUndoStack, planWrite } from '../../src/core/block-write';
import type { EditResult } from '../../src/core/edit';
import { describeDelete, type DeleteSummary } from '../../src/core/family-query';
import type { HolderRef } from '../../src/core/edit';
import { golden, replaceOnce } from './golden';
import { applyTitleOp, bodyOf, BODY_13, graphOf, holderRef, NOTE_13, refusal, titleOf, titleOpsModule, titlesModule, type AnyOp } from './titles-support';

/*
 * Spec §13.3 ("Show on the card", `card-title` cleanup), §13.4 (the Titles window and the sheet's
 * Titles section: add, edit, move and remove holders; add, rename and delete titles; Delete person,
 * D57), §13.5 (editing a number), §13.0 items 1 and 6, §6.2 (minimal diffs), and the M8 contract
 * rules 6–8 (now in the header of src/core/title-ops.ts). Every expected text is hand-written: whole bodies in
 * tests/golden/13-*.yaml, or sample tree 13 with exact lines replaced. Where the rules do not fix
 * the bytes, the choice is written as a "Decision:" comment (and listed in the WP 8.0 report).
 * These tests wait for WP 8.1 (`src/core/title-ops.ts` and the dispatch in `yaml-edit.ts`).
 */

/** Golden files end with one newline; a body has none. */
function expectGolden(r: EditResult, file: string, created: string[] = []): void {
	expect(bodyOf(r) + '\n').toBe(golden(file));
	if (r.ok) expect(r.created).toEqual(created);
}

const G = () => graphOf(BODY_13);
const ref = (title: string, index: number): HolderRef => holderRef(G(), title, index);
const apply = (op: AnyOp, body = BODY_13) => applyTitleOp(body, op);
const batch = (...ops: AnyOp[]): AnyOp => ({ kind: 'batch', ops });

const YA_CARD = '    name: Aldric Valmont\n    card-title: king-of-the-vale\n';
const YA_KING = '      - {person: young-aldric, number: III, from: 1180, to: 1210}\n';
const GODRIC = '      - [godric, 1250]\n';
const COUNT_TITLE = `  - id: count-of-orsini
    name: Count of Orsini
    plural: Counts of Orsini
    holders:
      - {name: Orso the Old, to: 1090}
      - {person: bertrand, from: 1090, to: 1128}
      # Co-rulers: the brothers Matteo and Piero.
      - {person: matteo, from: 1128, to: 1140}
      - {person: piero, to: 1140}
      - {person: cosimo, name: Cosimo Orsini, from: 1140, to: 1145}   # no person "cosimo"
      - {person: piero, from: 1145, to: 1160}
      - luca
      - {person: beatrice, from: 1190}   # typo for beatrix
      - {from: 1200}
`;

describe('the golden files start from sample tree 13 as stored', () => {
	it('BODY_13 is the located body of block 1', () => {
		expect(findBlocks(NOTE_13)[0].body).toBe(BODY_13);
		expect(BODY_13).toContain(COUNT_TITLE);
	});
});

describe('add-title (§13.4 Titles window, contract rule 6)', () => {
	it('goes at the end of titles, as a block map in the order id, name, plural; the caller chooses the id', () => {
		// Decision (supervisor ruling): a new title has no `holders` key until it gets a holder.
		expectGolden(apply({ kind: 'add-title', id: 'lord-of-harrowmere', name: 'Lord of Harrowmere', plural: 'Lords of Harrowmere' }), '13-add-title.yaml', ['lord-of-harrowmere']);
	});

	it('an id that a title has is refused id-taken, also the id of a duplicate', () => {
		expect(refusal(apply({ kind: 'add-title', id: 'duke-of-valmont', name: 'Duke' }))).toBe('id-taken');
		expect(refusal(apply({ kind: 'add-title', id: 'count-of-orsini', name: 'Count' }))).toBe('id-taken');
	});

	it('an empty name is refused bad-value', () => {
		expect(refusal(apply({ kind: 'add-title', id: 'x', name: '' }))).toBe('bad-value');
	});

	it('titles are their own namespace: newTitleId (§6.8, contract)', async () => {
		const { newTitleId } = await titleOpsModule();
		expect(newTitleId(BODY_13, 'Count of Orsini')).toBe('count-of-orsini-2');
		expect(newTitleId(BODY_13, 'Warden of the Marches')).toBe('warden-of-the-marches-2');
		// The title with no id and the entry that is not a title have no id to avoid.
		expect(newTitleId(BODY_13, 'Margrave of the Salt Coast')).toBe('margrave-of-the-salt-coast');
		// A person id is not a title id.
		expect(newTitleId(BODY_13, 'Aldric')).toBe('aldric');
		expect(newTitleId(BODY_13, 'Duke of Valmont', new Set(['duke-of-valmont-2']))).toBe('duke-of-valmont-3');
		expect(newTitleId('people:\n  - id: a\n    name: A', 'Duke of Valmont')).toBe('duke-of-valmont');
	});

	describe('a new titles section (§13.0 item 1)', () => {
		const add: AnyOp = { kind: 'add-title', id: 'duke-of-valmont', name: 'Duke of Valmont' };
		// Decision: as for every new section (M2, M3), one blank line separates it from its neighbours.
		it('directly after houses', () => {
			const body = 'houses:\n  - id: valmont\n    name: House Valmont\n\npeople:\n  - id: aldric\n    name: Aldric Valmont';
			expect(bodyOf(apply(add, body))).toBe(
				'houses:\n  - id: valmont\n    name: House Valmont\n\ntitles:\n  - id: duke-of-valmont\n    name: Duke of Valmont\n\npeople:\n  - id: aldric\n    name: Aldric Valmont',
			);
		});
		it('with no houses, directly before people', () => {
			const body = 'options:\n  start: aldric\n\npeople:\n  - id: aldric\n    name: Aldric Valmont';
			expect(bodyOf(apply(add, body))).toBe('options:\n  start: aldric\n\ntitles:\n  - id: duke-of-valmont\n    name: Duke of Valmont\n\npeople:\n  - id: aldric\n    name: Aldric Valmont');
		});
		it('with no houses and no people, at the end of the block', () => {
			expect(bodyOf(apply(add, 'options:\n  height: 400'))).toBe('options:\n  height: 400\n\ntitles:\n  - id: duke-of-valmont\n    name: Duke of Valmont');
		});
	});
});

describe('edit-title (§13.4 rename)', () => {
	it('name and plural: only those lines; numbering and count-with stay (§13.5 acceptance)', () => {
		expectGolden(apply({ kind: 'edit-title', id: 'king-of-the-vale', name: 'High King of the Vale', plural: 'High Kings of the Vale' }), '13-edit-title.yaml');
	});

	it('acts on the first title with the id (the one the tree uses)', () => {
		expect(bodyOf(apply({ kind: 'edit-title', id: 'count-of-orsini', name: 'Count of Orsini and Greyfen' }))).toBe(
			replaceOnce(BODY_13, '    name: Count of Orsini\n', '    name: Count of Orsini and Greyfen\n'),
		);
	});

	it('plural: null removes the key; a new plural goes after name', () => {
		expect(bodyOf(apply({ kind: 'edit-title', id: 'duke-of-valmont', plural: null }))).toBe(replaceOnce(BODY_13, '    plural: Dukes of Valmont\n', ''));
		expect(bodyOf(apply({ kind: 'edit-title', id: 'warden-of-the-marches', plural: 'Wardens of the Marches' }))).toBe(
			replaceOnce(BODY_13, '    name: Warden of the Marches\n', '    name: Warden of the Marches\n    plural: Wardens of the Marches\n'),
		);
	});

	it('the same name again changes nothing', () => {
		expect(bodyOf(apply({ kind: 'edit-title', id: 'duke-of-valmont', name: 'Duke of Valmont' }))).toBe(BODY_13);
	});

	it('an unknown title is refused unknown-title', () => {
		expect(refusal(apply({ kind: 'edit-title', id: 'emperor', name: 'Emperor' }))).toBe('unknown-title');
	});
});

describe('delete-title (§13.4, §13.3 cleanup)', () => {
	it('removes the title with its holders and every card-title that names it, in the same write', () => {
		expectGolden(apply({ kind: 'delete-title', id: 'king-of-the-vale' }), '13-delete-title-king.yaml');
	});

	it('acts on the first title with the id; the duplicate then becomes the title the tree uses', () => {
		const body = bodyOf(apply({ kind: 'delete-title', id: 'count-of-orsini' }));
		expect(body).toBe(replaceOnce(BODY_13, COUNT_TITLE, ''));
		expect(titleOf(graphOf(body), 'count-of-orsini').name).toBe('Count of the Salt Coast');
	});

	it('removes every card-title whose value is the title id, also one that was not valid (Isolde; spec §13.4, supervisor ruling)', () => {
		const body = bodyOf(apply({ kind: 'delete-title', id: 'duke-of-valmont' }));
		const duke = BODY_13.slice(BODY_13.indexOf('  - id: duke-of-valmont\n'), BODY_13.indexOf('  - id: count-of-orsini\n'));
		expect(duke.endsWith('      - {person: edmund, from: 1210, to: 1228}\n')).toBe(true);
		// The younger Aldric keeps his card-title: he still holds King of the Vale. count-with is not a card-title.
		expect(body).toBe(replaceOnce(replaceOnce(BODY_13, duke, ''), '    title: Duchess of Valmont\n    card-title: duke-of-valmont\n', '    title: Duchess of Valmont\n'));
	});

	it('removing the last title removes the titles section and the blank line after it', () => {
		const body = 'houses:\n  - id: valmont\n    name: House Valmont\n\ntitles:\n  - id: duke\n    name: Duke\n    holders: [aldric]\n\npeople:\n  - id: aldric\n    name: Aldric Valmont';
		expect(bodyOf(apply({ kind: 'delete-title', id: 'duke' }, body))).toBe('houses:\n  - id: valmont\n    name: House Valmont\n\npeople:\n  - id: aldric\n    name: Aldric Valmont');
	});

	it('an unknown title is refused unknown-title', () => {
		expect(refusal(apply({ kind: 'delete-title', id: 'emperor' }))).toBe('unknown-title');
	});
});

describe('add-holder (§13.4 sheet: Add title; a new holder is the newest ruler)', () => {
	it('a one-line flow map at the end of the list of the first title with the id', () => {
		expectGolden(apply({ kind: 'add-holder', title: 'count-of-orsini', fields: { person: 'beatrix', from: '1190' } }), '13-add-holder.yaml');
	});

	it('keys in the order person or name, as, number, from, to', () => {
		const op: AnyOp = { kind: 'add-holder', title: 'king-of-the-vale', fields: { to: '1240', from: '1230', number: 'II', as: 'Rodrick', person: 'king-roderick' } };
		expect(bodyOf(apply(op))).toBe(replaceOnce(BODY_13, GODRIC, GODRIC + '      - {person: king-roderick, as: Rodrick, number: II, from: 1230, to: 1240}\n'));
	});

	it('a holder who is not in the tree; values quoted only when plain YAML cannot hold them', () => {
		expect(bodyOf(apply({ kind: 'add-holder', title: 'duke-of-valmont', fields: { name: 'Aldric the Pretender', from: '1229' } }))).toBe(
			replaceOnce(BODY_13, '      - {person: edmund, from: 1210, to: 1228}\n', '      - {person: edmund, from: 1210, to: 1228}\n      - {name: Aldric the Pretender, from: 1229}\n'),
		);
		expect(bodyOf(apply({ kind: 'add-holder', title: 'count-of-orsini', fields: { name: 'Orso, the Younger' } }))).toBe(
			replaceOnce(BODY_13, '      - {from: 1200}\n', '      - {from: 1200}\n      - {name: "Orso, the Younger"}\n'),
		);
	});

	it('refusals: a person not in the tree, an unknown title, holders written as a map, no person and no name', () => {
		expect(refusal(apply({ kind: 'add-holder', title: 'duke-of-valmont', fields: { person: 'cosimo' } }))).toBe('unknown-person');
		expect(refusal(apply({ kind: 'add-holder', title: 'emperor', fields: { person: 'aldric' } }))).toBe('unknown-title');
		expect(refusal(apply({ kind: 'add-holder', title: 'warden-of-the-marches', fields: { person: 'aldric' } }))).toBe('bad-value');
		expect(refusal(apply({ kind: 'add-holder', title: 'duke-of-valmont', fields: { from: '1300' } }))).toBe('bad-value');
	});

	it('holders: aldric (one string) first becomes a flow list (contract rule 6)', () => {
		const body = 'titles:\n  - id: duke\n    name: Duke\n    holders: aldric\npeople:\n  - id: aldric\n    name: Aldric Valmont\n  - id: roderick\n    name: Roderick Valmont';
		expect(bodyOf(apply({ kind: 'add-holder', title: 'duke', fields: { person: 'roderick', from: '1150' } }, body))).toBe(
			replaceOnce(body, '    holders: aldric\n', '    holders: [aldric, {person: roderick, from: 1150}]\n'),
		);
	});

	it('a title with no holders key gets a holders list', () => {
		// Decision (supervisor ruling): a block list under `holders:`, after the other title keys.
		const body = 'titles:\n  - id: duke\n    name: Duke\npeople:\n  - id: aldric\n    name: Aldric Valmont';
		expect(bodyOf(apply({ kind: 'add-holder', title: 'duke', fields: { person: 'aldric' } }, body))).toBe(
			'titles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: aldric}\npeople:\n  - id: aldric\n    name: Aldric Valmont',
		);
	});
});

describe('edit-holder (§13.4 sheet Edit, §13.5 number, §13.3 reign)', () => {
	it('a hand-typed block-map holder stays a block map; only the changed lines change (§13.4 acceptance)', () => {
		expectGolden(apply({ kind: 'edit-holder', holder: ref('duke-of-valmont', 3), fields: { number: 'II', to: '1164' } }), '13-edit-holder-block.yaml');
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('duke-of-valmont', 3), fields: { as: 'Gareth the Bold' } }))).toBe(
			replaceOnce(BODY_13, '        as: Gareth\n', '        as: Gareth the Bold\n'),
		);
	});

	it('editing a number changes only that holder line; unknown keys stay (§13.5 acceptance)', () => {
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('duke-of-valmont', 1), fields: { number: 'III' } }))).toBe(
			replaceOnce(BODY_13, '{person: aldric, number: II, from: 1110, to: 1150, epithet: the Wise}', '{person: aldric, number: III, from: 1110, to: 1150, epithet: the Wise}'),
		);
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('duke-of-valmont', 1), fields: { number: null } }))).toBe(
			replaceOnce(BODY_13, '{person: aldric, number: II, from: 1110, to: 1150, epithet: the Wise}', '{person: aldric, from: 1110, to: 1150, epithet: the Wise}'),
		);
	});

	it('editing a reign changes only that holder line; a new key goes in the key order (§13.3 acceptance)', () => {
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('duke-of-valmont', 4), fields: { to: '1175' } }))).toBe(
			replaceOnce(BODY_13, '{person: roderick, number: I, from: 1163}', '{person: roderick, number: I, from: 1163, to: 1175}'),
		);
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('count-of-orsini', 3), fields: { from: '1128' } }))).toBe(
			replaceOnce(BODY_13, '{person: piero, to: 1140}', '{person: piero, from: 1128, to: 1140}'),
		);
	});

	it('the end-of-line comment of the item stays', () => {
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('count-of-orsini', 4), fields: { to: '1146' } }))).toBe(
			replaceOnce(BODY_13, '{person: cosimo, name: Cosimo Orsini, from: 1140, to: 1145}   # no person', '{person: cosimo, name: Cosimo Orsini, from: 1140, to: 1146}   # no person'),
		);
	});

	it('an edited plain-string holder becomes a flow map (contract rule 6)', () => {
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('count-of-orsini', 6), fields: { from: '1160' } }))).toBe(
			replaceOnce(BODY_13, '      - luca\n', '      - {person: luca, from: 1160}\n'),
		);
		const body = 'titles:\n  - id: duke\n    name: Duke\n    holders: aldric\npeople:\n  - id: aldric\n    name: Aldric Valmont';
		expect(bodyOf(apply({ kind: 'edit-holder', holder: holderRef(graphOf(body), 'duke', 0), fields: { number: 'II' } }, body))).toBe(
			replaceOnce(body, '    holders: aldric\n', '    holders: [{person: aldric, number: II}]\n'),
		);
	});

	it('a changed person: the old holder loses the title, so their card-title goes in the same write (contract rule 7)', () => {
		expect(bodyOf(apply({ kind: 'edit-holder', holder: ref('king-of-the-vale', 0), fields: { person: 'edmund' } }))).toBe(
			replaceOnce(replaceOnce(BODY_13, YA_KING, '      - {person: edmund, number: III, from: 1180, to: 1210}\n'), YA_CARD, '    name: Aldric Valmont\n'),
		);
	});

	it('a ref that does not match the item is refused unknown-holder', () => {
		const good = ref('duke-of-valmont', 2);
		expect(refusal(apply({ kind: 'edit-holder', holder: { ...good, person: 'aldric' }, fields: { to: '1159' } }))).toBe('unknown-holder');
		expect(refusal(apply({ kind: 'edit-holder', holder: { ...good, text: '{person: roderick, from: 1150, to: 1159}' }, fields: { to: '1159' } }))).toBe('unknown-holder');
		expect(refusal(apply({ kind: 'edit-holder', holder: { ...good, index: 99 }, fields: { to: '1159' } }))).toBe('unknown-holder');
		expect(refusal(apply({ kind: 'edit-holder', holder: { ...good, title: 'emperor' }, fields: { to: '1159' } }))).toBe('unknown-title');
	});
});

describe('remove-holder (§13.4 sheet Remove, §13.3 cleanup)', () => {
	it("removing a person's last entry of their selected title also removes their card-title", () => {
		expectGolden(apply({ kind: 'remove-holder', holder: ref('king-of-the-vale', 0) }), '13-remove-holder-card-title.yaml');
	});

	it('one reign of a restored ruler: only that line', () => {
		expect(bodyOf(apply({ kind: 'remove-holder', holder: ref('duke-of-valmont', 2) }))).toBe(replaceOnce(BODY_13, '      - {person: roderick, from: 1150, to: 1158}\n', ''));
	});

	it('a holder who is not in the tree; an item with its own end-of-line comment', () => {
		expect(bodyOf(apply({ kind: 'remove-holder', holder: ref('duke-of-valmont', 0) }))).toBe(replaceOnce(BODY_13, '      - {name: Aldric, number: I, from: 1062, to: 1110}\n', ''));
		expect(bodyOf(apply({ kind: 'remove-holder', holder: ref('count-of-orsini', 4) }))).toBe(
			replaceOnce(BODY_13, '      - {person: cosimo, name: Cosimo Orsini, from: 1140, to: 1145}   # no person "cosimo"\n', ''),
		);
	});

	it('card-title stays while the person still holds the title; it goes with the last entry; the last holder leaves holders: []', () => {
		const body =
			'titles:\n  - id: count\n    name: Count\n    holders: [a]\n  - id: duke\n    name: Duke\n    holders:\n      - {person: a, from: 1100, to: 1110}\n      - {person: a, from: 1120}\n' +
			'people:\n  - id: a\n    name: Aldo Brand\n    card-title: duke';
		const one = bodyOf(apply({ kind: 'remove-holder', holder: holderRef(graphOf(body), 'duke', 0) }, body));
		expect(one).toBe(replaceOnce(body, '      - {person: a, from: 1100, to: 1110}\n', ''));
		const two = bodyOf(apply({ kind: 'remove-holder', holder: holderRef(graphOf(one), 'duke', 0) }, one));
		expect(two).toBe('titles:\n  - id: count\n    name: Count\n    holders: [a]\n  - id: duke\n    name: Duke\n    holders: []\npeople:\n  - id: a\n    name: Aldo Brand');
	});

	it('a ref that does not match is refused unknown-holder', () => {
		expect(refusal(apply({ kind: 'remove-holder', holder: { ...ref('duke-of-valmont', 2), index: 1 } }))).toBe('unknown-holder');
	});
});

describe('set-holders (§13.4 Titles window: the final list of one title, contract rule 8)', () => {
	const r = (i: number) => ref('duke-of-valmont', i);

	it('reorder, edit, add and remove in one op: items move whole with their comments; only changed values are written', () => {
		const op: AnyOp = {
			kind: 'set-holders',
			title: 'duke-of-valmont',
			items: [{ ref: r(0) }, { ref: r(1) }, { ref: r(2), fields: { to: '1157' } }, { ref: r(3) }, { ref: r(5) }, { ref: r(4) }, { add: { person: 'king-roderick', from: '1228' } }],
		};
		expectGolden(apply(op), '13-set-holders.yaml');
	});

	it('items that are not shown holders stay in place, after the listed item that preceded them (supervisor ruling)', () => {
		const c = (i: number) => ref('count-of-orsini', i);
		const count = (t: string) => t.slice(t.indexOf('  - id: count-of-orsini\n'), t.indexOf('  - id: king-of-the-vale\n'));
		// Shown holders 0–6; items 7 (beatrice, nobody) and 8 (no person, no name) follow item 6 (luca).
		// Reversed: luca first, so the two dropped items follow it at the top; Orso last. Comments move
		// with their items (the co-rulers comment with Matteo).
		const body = bodyOf(apply({ kind: 'set-holders', title: 'count-of-orsini', items: [6, 5, 4, 3, 2, 1, 0].map((i) => ({ ref: c(i) })) }));
		expect(count(body)).toBe(`  - id: count-of-orsini
    name: Count of Orsini
    plural: Counts of Orsini
    holders:
      - luca
      - {person: beatrice, from: 1190}   # typo for beatrix
      - {from: 1200}
      - {person: piero, from: 1145, to: 1160}
      - {person: cosimo, name: Cosimo Orsini, from: 1140, to: 1145}   # no person "cosimo"
      - {person: piero, to: 1140}
      # Co-rulers: the brothers Matteo and Piero.
      - {person: matteo, from: 1128, to: 1140}
      - {person: bertrand, from: 1090, to: 1128}
      - {name: Orso the Old, to: 1090}
`);
		expect(body.replace(count(body), '')).toBe(BODY_13.replace(count(BODY_13), ''));
		// Luca removed: the two dropped items then follow Piero's second entry, the listed item before them.
		const without = bodyOf(apply({ kind: 'set-holders', title: 'count-of-orsini', items: [0, 1, 2, 3, 4, 5].map((i) => ({ ref: c(i) })) }));
		expect(without).toBe(replaceOnce(BODY_13, '      - luca\n', ''));
		// With no listed item before them (all shown holders removed), they come first.
		const none = bodyOf(apply({ kind: 'set-holders', title: 'count-of-orsini', items: [{ add: { person: 'beatrix' } }] }));
		expect(count(none)).toBe(`  - id: count-of-orsini
    name: Count of Orsini
    plural: Counts of Orsini
    holders:
      - {person: beatrice, from: 1190}   # typo for beatrix
      - {from: 1200}
      - {person: beatrix}
`);
	});

	it('the same list again changes nothing', () => {
		const items = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ ref: r(i) }));
		expect(bodyOf(apply({ kind: 'set-holders', title: 'duke-of-valmont', items }))).toBe(BODY_13);
	});

	it('a list without the younger Aldric: his card-title goes too (contract rule 7)', () => {
		const k = (i: number) => ref('king-of-the-vale', i);
		const body = bodyOf(apply({ kind: 'set-holders', title: 'king-of-the-vale', items: [{ ref: k(1) }, { ref: k(2) }] }));
		// The item that is not a holder is not in the window's list, but it is never removed (supervisor ruling).
		expect(body).toBe(replaceOnce(replaceOnce(BODY_13, YA_KING, ''), YA_CARD, '    name: Aldric Valmont\n'));
	});

	it('a ref that is used twice, or does not match, is refused', () => {
		expect(refusal(apply({ kind: 'set-holders', title: 'duke-of-valmont', items: [{ ref: r(0) }, { ref: r(0) }] }))).toBe('bad-value');
		expect(refusal(apply({ kind: 'set-holders', title: 'duke-of-valmont', items: [{ ref: { ...r(1), person: 'roderick' } }] }))).toBe('unknown-holder');
		expect(refusal(apply({ kind: 'set-holders', title: 'warden-of-the-marches', items: [{ add: { person: 'aldric' } }] }))).toBe('bad-value');
	});
});

describe('Titles window Save: one batch, one write (§13.4 acceptance, §13.0 item 6)', () => {
	it('add a title, rename a title, move, edit, add and remove holders, delete a title', () => {
		const r = (i: number) => ref('duke-of-valmont', i);
		const op = batch(
			{ kind: 'add-title', id: 'lord-of-harrowmere', name: 'Lord of Harrowmere', plural: 'Lords of Harrowmere' },
			{ kind: 'edit-title', id: 'king-of-the-vale', name: 'High King of the Vale' },
			{
				kind: 'set-holders',
				title: 'duke-of-valmont',
				items: [{ ref: r(0) }, { ref: r(1) }, { ref: r(2), fields: { to: '1157' } }, { ref: r(3) }, { ref: r(5) }, { ref: r(4) }, { add: { person: 'king-roderick', from: '1228' } }],
			},
			{ kind: 'delete-title', id: 'warden-of-the-marches' },
		);
		expectGolden(apply(op), '13-window-save.yaml', ['lord-of-harrowmere']);
	});

	it('a batch that refuses one op writes nothing', () => {
		const r = apply(batch({ kind: 'edit-title', id: 'king-of-the-vale', name: 'High King' }, { kind: 'delete-title', id: 'emperor' }));
		expect(refusal(r)).toBe('unknown-title');
	});
});

describe('card-title cleanup once per write, after all ops of a batch (contract rule 7)', () => {
	it('removed and added again in one batch: the card-title stays', () => {
		const body = bodyOf(
			apply(batch({ kind: 'remove-holder', holder: ref('king-of-the-vale', 0) }, { kind: 'add-holder', title: 'king-of-the-vale', fields: { person: 'young-aldric', number: 'III', from: '1180', to: '1210' } })),
		);
		expect(body).toBe(replaceOnce(replaceOnce(BODY_13, YA_KING, ''), GODRIC, GODRIC + YA_KING));
	});

	it('removed with another edit of the person: the card-title goes, in the same write', () => {
		const body = bodyOf(apply(batch({ kind: 'remove-holder', holder: ref('king-of-the-vale', 0) }, { kind: 'set-person-fields', id: 'young-aldric', fields: { born: '1141' } })));
		expect(body).toBe(replaceOnce(replaceOnce(replaceOnce(BODY_13, YA_KING, ''), YA_CARD, '    name: Aldric Valmont\n'), '    born: 1140\n', '    born: 1141\n'));
	});

	it('a card-title changed in the same batch is not removed', () => {
		const body = bodyOf(
			apply(batch({ kind: 'set-person-fields', id: 'young-aldric', fields: { 'card-title': 'duke-of-valmont' } }, { kind: 'remove-holder', holder: ref('king-of-the-vale', 0) })),
		);
		expect(body).toBe(replaceOnce(replaceOnce(BODY_13, YA_KING, ''), YA_CARD, '    name: Aldric Valmont\n    card-title: duke-of-valmont\n'));
	});

	it('a card-title that was not valid before the write is not touched (Isolde)', () => {
		const body = bodyOf(apply({ kind: 'remove-holder', holder: ref('duke-of-valmont', 1) }));
		expect(body).toContain('    card-title: duke-of-valmont\n');
	});
});

describe('"Show on the card" writes only the card-title line (§13.3 acceptance)', () => {
	it('after name when there is no written title', async () => {
		const { cardTitleOp } = await titlesModule();
		expectGolden(apply(cardTitleOp(G(), 'edmund', 'king-of-the-vale')), '13-card-title-edmund.yaml');
	});

	it('after title when there is one (D63)', async () => {
		const { cardTitleOp } = await titlesModule();
		expect(bodyOf(apply(cardTitleOp(G(), 'bertrand', 'count-of-orsini')))).toBe(
			replaceOnce(BODY_13, '    title: Count Palatine of Orsini\n', '    title: Count Palatine of Orsini\n    card-title: count-of-orsini\n'),
		);
	});

	it('selecting the first title, with no written title, removes the key', async () => {
		const { cardTitleOp } = await titlesModule();
		expect(bodyOf(apply(cardTitleOp(G(), 'young-aldric', 'duke-of-valmont')))).toBe(replaceOnce(BODY_13, YA_CARD, '    name: Aldric Valmont\n'));
	});

	it('set-person-fields card-title: null removes it; the same value again changes nothing', () => {
		expect(bodyOf(apply({ kind: 'set-person-fields', id: 'king-roderick', fields: { 'card-title': null } }))).toBe(
			replaceOnce(BODY_13, '    title: Prince of the Vale\n    card-title: king-of-the-vale\n', '    title: Prince of the Vale\n'),
		);
		expect(bodyOf(apply({ kind: 'set-person-fields', id: 'king-roderick', fields: { 'card-title': 'king-of-the-vale' } }))).toBe(BODY_13);
	});
});

describe('Delete person also removes their holder entries (§6.7, D57)', () => {
	it('in every title, also a title that loses to a duplicate id, in the same write', () => {
		expectGolden(apply({ kind: 'delete-person', id: 'gareth' }), '13-delete-gareth.yaml');
	});

	it('the confirmation counts the titles and entries from the written items', () => {
		const g = G();
		const holders = (id: string) => (describeDelete(g, id, {}) as DeleteSummary & { holders?: { titles: number; entries: number } }).holders;
		expect(holders('gareth')).toEqual({ titles: 2, entries: 2 });
		expect(holders('roderick')).toEqual({ titles: 1, entries: 2 });
		expect(holders('young-aldric')).toEqual({ titles: 2, entries: 2 });
		expect(holders('luca')).toEqual({ titles: 1, entries: 1 });
		expect(holders('elinor')).toEqual({ titles: 0, entries: 0 });
	});

	it('a title that loses its last holder stays, with an empty holder list', () => {
		const body = 'titles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: a, from: 1100}\npeople:\n  - id: a\n    name: A\n  - id: b\n    name: B';
		expect(bodyOf(apply({ kind: 'delete-person', id: 'a' }, body))).toBe('titles:\n  - id: duke\n    name: Duke\n    holders: []\npeople:\n  - id: b\n    name: B');
	});

	it('the younger Aldric: no holder names him afterwards, and the other holders stay', () => {
		const g = graphOf(bodyOf(apply({ kind: 'delete-person', id: 'young-aldric' })));
		expect(g.titles.flatMap((t) => t.holders.filter((x) => x.person === 'young-aldric'))).toEqual([]);
		expect(g.titles.map((t) => [t.id, t.holders.length])).toEqual([
			['duke-of-valmont', 6],
			['count-of-orsini', 7],
			['king-of-the-vale', 2],
			['warden-of-the-marches', 0],
		]);
	});
});

describe('undo: one step restores the text (§13.3, §13.4 acceptance; D8)', () => {
	const cases: [string, () => AnyOp][] = [
		['delete-title with card-title cleanup', () => ({ kind: 'delete-title', id: 'king-of-the-vale' })],
		['remove-holder with card-title cleanup', () => ({ kind: 'remove-holder', holder: ref('king-of-the-vale', 0) })],
		['delete-person (D57)', () => ({ kind: 'delete-person', id: 'gareth' })],
		['Show on the card', () => ({ kind: 'set-person-fields', id: 'edmund', fields: { 'card-title': 'king-of-the-vale' } })],
		['edit a block-map holder', () => ({ kind: 'edit-holder', holder: ref('duke-of-valmont', 3), fields: { to: '1164' } })],
		[
			'Titles window Save',
			() =>
				batch(
					{ kind: 'add-title', id: 'lord-of-harrowmere', name: 'Lord of Harrowmere' },
					{ kind: 'set-holders', title: 'duke-of-valmont', items: [0, 1, 2, 3, 5, 4].map((i) => ({ ref: ref('duke-of-valmont', i) })) },
					{ kind: 'delete-title', id: 'warden-of-the-marches' },
				),
		],
	];
	for (const [name, op] of cases) {
		it(name, () => {
			const plan = planWrite(NOTE_13, 0, BODY_13, (body) => {
				const r = applyTitleOp(body, op());
				return r.ok ? { ok: true, body: r.body } : { ok: false, reason: r.code };
			});
			expect(plan.ok).toBe(true);
			if (!plan.ok) return;
			expect(plan.newBody).not.toBe(BODY_13);
			const stack = createUndoStack();
			stack.push(plan.oldBody, plan.newBody);
			const undone = stack.undo(plan.newBody);
			expect(undone).toEqual({ ok: true, body: BODY_13 });
			const back = planWrite(plan.newText, 0, plan.newBody, () => ({ ok: true, body: BODY_13 }));
			expect(back.ok && back.newText).toBe(NOTE_13);
		});
	}
});

describe('editing is off in a blocked tree (§8)', () => {
	it('title ops are refused blocked', () => {
		const body = 'titles:\n  - id: duke\n    holders: [a]\npeople:\n  - id: a\n    name: A\n  - id: a\n    name: A again';
		expect(refusal(apply({ kind: 'add-holder', title: 'duke', fields: { name: 'Orso' } }, body))).toBe('blocked');
		expect(refusal(apply({ kind: 'add-title', id: 'count', name: 'Count' }, body))).toBe('blocked');
		expect(refusal(apply({ kind: 'delete-title', id: 'duke' }, body))).toBe('blocked');
	});
});
