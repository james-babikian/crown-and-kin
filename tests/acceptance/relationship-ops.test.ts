import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { ApplyOp, EditRefusal, EditResult, NewPersonId, Op, ParentKind, UnionRef } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import * as edit from '../../src/core/yaml-edit';
import { golden, replaceOnce } from './golden';
import { fixtureNote, fixtureSource, topLevelBlocks } from './load';

// Spec §4.2 (parent-entry write form), §4.3 (primary union, sibling groups), §5.9 (Add first
// person), §6.2 (insertion positions, minimal diff), §6.3 (drafts and relationship actions in one
// write), §6.4 (add actions, automatic marriage), §6.5 (sibling moves), §6.6 (cycles), §6.7
// (deletes, D5), §6.8 (ids), §10 "Unit tests cover: every op in core/ops". The decision notes "Second
// union for a couple", "Automatic marriage", "How a changed value is written", "Formatting
// details fixed by the WP2.1 tests". Contract: src/core/edit.ts (milestone 3 ops).
//
// Every expected text is hand-written in tests/golden/ or built here by replacing exact lines.
// Where the rules do not fix the bytes, the choice is written as a "Decision:" comment.
//
// Decision (which lines an item owns; used by insert, move and delete): a `people` or `unions`
// item is its own lines (with their end-of-line comments) plus the full-line comments directly
// above its "- " line, up to the previous item or a blank line. A comment between two siblings
// therefore belongs to the lower one. Blank lines belong to no item and stay where they are.
// - Move: the item moves with the comments it owns.
// - Insert "before X": above the comments X owns. "After X": directly below X's last line, so
//   above the next item's comments and above a blank line.
// - Delete or remove: the item's own lines go; the full-line comments above it stay, as for a
//   removed key in M2 (the decision notes), so no user comment is lost.

const applyOp: ApplyOp = edit.applyOp;
const newPersonId: NewPersonId = edit.newPersonId;

const NOTE9 = fixtureNote('09');
/** Fixture 9, the main tree. Bodies have no final newline, like `LocatedBlock.body`. */
const MAIN = topLevelBlocks(NOTE9)[0].replace(/\n$/, '');
/** Fixture 9, the second plain block: no options, houses or unions. */
const SECOND = topLevelBlocks(NOTE9)[1].replace(/\n$/, '');
const F1 = fixtureSource('01').replace(/\n$/, '');
const F2 = fixtureSource('02').replace(/\n$/, '');
const F8 = fixtureSource('08').replace(/\n$/, '');

type Ok = Extract<EditResult, { ok: true }>;

function ok(r: EditResult): Ok {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r;
}

/** Golden files end with one newline; a body has none. */
function expectGolden(r: EditResult, file: string): Ok {
	const o = ok(r);
	expect(o.body + '\n').toBe(golden(file));
	return o;
}

function expectRefused(r: EditResult, code: EditRefusal): void {
	expect(r.ok, `expected refusal ${code}`).toBe(false);
	expect(r).toMatchObject({ ok: false, code });
}

/** The new body reads back with no issue at all (§8). */
function expectClean(body: string): void {
	const r = parseDynasty(body);
	expect(r.ok).toBe(true);
	if (r.ok) expect(deriveFamilies(r.tree).issues.map((i) => i.code)).toEqual([]);
}

const effects = (r: EditResult) => ok(r).effects ?? [];

/** Applies ops one after the other, each on the previous result. */
function chain(body: string, ...ops: Op[]): string {
	return ops.reduce((b, op) => ok(applyOp(b, op)).body, body);
}

const birth = (id: string) => ({ id, type: 'birth' as const });
const U0: UnionRef = { index: 0, partners: ['aldous', '0017'] };
/** Written as [edric, joan]; a ref may name the partners in either order (contract). */
const U1: UnionRef = { index: 1, partners: ['joan', 'edric'] };

describe('newPersonId (§6.8)', () => {
	it('slug of the name, unique among person ids', () => {
		expect(newPersonId(MAIN, 'Ivo Harrow')).toBe('ivo-harrow');
		expect(newPersonId(MAIN, 'Edric')).toBe('edric-2');
		// The flow-map person and the quoted id count as taken.
		expect(newPersonId(MAIN, 'Joan')).toBe('joan-2');
		expect(newPersonId(MAIN, 'Mäud Quill')).toBe('maud-quill');
	});

	it('houses and unions have their own namespaces', () => {
		expect(newPersonId(MAIN, 'Harrow')).toBe('harrow');
		expect(newPersonId(MAIN, 'Harrow Quill')).toBe('harrow-quill');
	});

	it('empty → person; all digits → p- prefix; an empty body', () => {
		expect(newPersonId(MAIN, '')).toBe('person');
		expect(newPersonId(MAIN, '???')).toBe('person');
		expect(newPersonId(MAIN, '0017')).toBe('p-0017');
		expect(newPersonId('', 'Aldric Valmont')).toBe('aldric-valmont');
	});
});

describe('add-person: where the new item goes (§6.2)', () => {
	it('a child of a couple goes directly after the last sibling of that union; keys in §4.1 order', () => {
		const op: Op = {
			kind: 'add-person',
			id: 'ivo',
			// Given out of order on purpose: the written keys follow §4.1.
			fields: { born: '1138', sex: 'm', house: 'harrow', name: 'Ivo Harrow' },
			parents: [birth('aldous'), birth('0017')],
			at: { kind: 'after-siblings', parents: ['aldous', '0017'] },
		};
		const o = expectGolden(applyOp(MAIN, op), '09-add-child-couple.yaml');
		expect(o.created).toEqual(['ivo']);
		expectClean(o.body);
	});

	it('the parents of after-siblings may be in either order, and may name the union', () => {
		const op: Op = {
			kind: 'add-person',
			id: 'ivo',
			fields: { name: 'Ivo Harrow', house: 'harrow', sex: 'm', born: '1138' },
			parents: [birth('aldous'), birth('0017')],
			at: { kind: 'after-siblings', parents: ['0017', 'aldous'], union: { index: 0, partners: ['0017', 'aldous'] } },
		};
		expectGolden(applyOp(MAIN, op), '09-add-child-couple.yaml');
	});

	it('a child of a single parent goes after the last child hung from that parent', () => {
		// Tamsin is Aldous's ward and has no other placement parent, so she hangs from Aldous like
		// Piers does (§4.3 "a child with one placement parent hangs directly from that parent"). She
		// is the last of that group, so the new child goes after her, before Joan.
		const op: Op = {
			kind: 'add-person',
			id: 'wat',
			fields: { illegitimate: true, name: 'Wat', sex: 'm' },
			parents: [birth('aldous')],
			at: { kind: 'after-siblings', parents: ['aldous'] },
		};
		const o = expectGolden(applyOp(MAIN, op), '09-add-child-single.yaml');
		expectClean(o.body);
	});

	it('no siblings yet: directly after the last of the parents (Joan, the flow-map person)', () => {
		// Decision: the blank line that ends `people` stays after the new item.
		const op: Op = {
			kind: 'add-person',
			id: 'alys',
			fields: { name: 'Alys Harrow', house: 'harrow', sex: 'f' },
			parents: [birth('edric'), birth('joan')],
			at: { kind: 'after-siblings', parents: ['edric', 'joan'], union: U1 },
		};
		const o = expectGolden(applyOp(MAIN, op), '09-add-child-no-siblings.yaml');
		expectClean(o.body);
	});

	it('no siblings yet, single parent: after that parent, above the next item\'s comment', () => {
		const op: Op = {
			kind: 'add-person',
			id: 'kit',
			fields: { name: 'Kit' },
			parents: [birth('piers')],
			at: { kind: 'after-siblings', parents: ['piers'] },
		};
		expect(ok(applyOp(MAIN, op)).body).toBe(
			replaceOnce(
				MAIN,
				'    parents: [aldous]\n  # Wards and married-in\n',
				'    parents: [aldous]\n  - id: kit\n    name: Kit\n    parents: [piers]\n  # Wards and married-in\n',
			),
		);
	});

	it('before a person: above the comment that person owns', () => {
		const op: Op = { kind: 'add-person', id: 'hawise', fields: { name: 'Hawise Quill', house: 'quill', sex: 'f' }, at: { kind: 'before', id: 'edric' } };
		expectGolden(applyOp(MAIN, op), '09-add-person-before.yaml');
	});

	it('after a person: below their last line (and its end-of-line comment), above the blank line', () => {
		const op: Op = { kind: 'add-person', id: 'hawise', fields: { name: 'Hawise Quill', house: 'quill', sex: 'f' }, at: { kind: 'after', id: '0017' } };
		expect(ok(applyOp(MAIN, op)).body).toBe(
			replaceOnce(
				MAIN,
				'    born: "1104-03-09"        # a quoted date\n',
				'    born: "1104-03-09"        # a quoted date\n  - id: hawise\n    name: Hawise Quill\n    house: quill\n    sex: f\n',
			),
		);
	});

	it('no placement: appended; parents as a flow sequence with birth plain and other types as flow maps (§4.2)', () => {
		// Also: a name with ": " and born "?" are double-quoted (the decision notes quoting rule); the
		// quoted id "0017" stays quoted inside the flow map.
		const op: Op = {
			kind: 'add-person',
			id: 'gilbert',
			fields: { name: 'Gilbert: the Foundling', sex: 'm', born: '?', placement: 'adoptive', notes: 'Found at the abbey gate.' },
			parents: [birth('edric'), { id: 'tamsin', type: 'adoptive' }, { id: '0017', type: 'ward' }, { id: 'piers', type: 'rumoured' }],
		};
		const o = expectGolden(applyOp(MAIN, op), '09-add-person-appended.yaml');
		expect(o.created).toEqual(['gilbert']);
		expectClean(o.body);
	});

	it('fixture 2: a child of Edmund and Beatrix goes after Piers, before Clarice\'s children', () => {
		const op: Op = {
			kind: 'add-person',
			id: 'joscelin',
			fields: { name: 'Joscelin Harrow', house: 'harrow', sex: 'm', born: '1138' },
			parents: [birth('edmund'), birth('beatrix')],
			at: { kind: 'after-siblings', parents: ['edmund', 'beatrix'], union: { index: 2, partners: ['edmund', 'beatrix'] } },
		};
		expect(ok(applyOp(F2, op)).body).toBe(
			replaceOnce(
				F2,
				'    parents: [edmund, beatrix]\n',
				'    parents: [edmund, beatrix]\n  - id: joscelin\n    name: Joscelin Harrow\n    house: harrow\n    sex: m\n    born: 1138\n    parents: [edmund, beatrix]\n',
			),
		);
	});

	it("fixture 2: a child of Edmund and Agnes goes after Maud, not after Edmund's last child", () => {
		const op: Op = {
			kind: 'add-person',
			id: 'aveline',
			fields: { name: 'Aveline Harrow', sex: 'f' },
			parents: [birth('edmund'), birth('agnes')],
			at: { kind: 'after-siblings', parents: ['edmund', 'agnes'] },
		};
		expect(ok(applyOp(F2, op)).body).toBe(
			replaceOnce(
				F2,
				'    born: 1130\n    parents: [edmund, agnes]\n',
				'    born: 1130\n    parents: [edmund, agnes]\n  - id: aveline\n    name: Aveline Harrow\n    sex: f\n    parents: [edmund, agnes]\n',
			),
		);
	});

	it('fixture 2: appended after the last person, above the blank line before unions', () => {
		const op: Op = { kind: 'add-person', id: 'wynn', fields: { name: 'Wynn' } };
		expect(ok(applyOp(F2, op)).body).toBe(
			replaceOnce(F2, '    parents: [edmund, clarice]\n\nunions:', '    parents: [edmund, clarice]\n  - id: wynn\n    name: Wynn\n\nunions:'),
		);
	});

	it('fixture 8: a new child placed under adoptive parents', () => {
		const op: Op = {
			kind: 'add-person',
			id: 'aubrey',
			fields: { name: 'Aubrey Valmont', placement: 'adoptive' },
			parents: [birth('gareth'), { id: 'aldric', type: 'adoptive' }, { id: 'isolde', type: 'adoptive' }],
			at: { kind: 'after-siblings', parents: ['aldric', 'isolde'] },
		};
		// Tomas is the only child placed under Aldric and Isolde.
		expect(ok(applyOp(F8, op)).body).toBe(
			replaceOnce(
				F8,
				'    placement: adoptive\n',
				'    placement: adoptive\n  - id: aubrey\n    name: Aubrey Valmont\n    parents: [gareth, {id: aldric, type: adoptive}, {id: isolde, type: adoptive}]\n    placement: adoptive\n',
			),
		);
	});

	describe('a child for a union that is not the pair\'s last-listed one (the decision notes "Relationship-op details")', () => {
		/** Fixture 1 after a second union for Roderick and Mathilde: u1 has an id and both children. */
		const TWO = golden('01-add-union-second.yaml').replace(/\n$/, '');
		const bran = (union: UnionRef): Op => ({
			kind: 'add-person',
			id: 'bran',
			fields: { name: 'Bran Valmont' },
			parents: [birth('roderick'), birth('mathilde')],
			at: { kind: 'after-siblings', parents: ['roderick', 'mathilde'], union },
		});

		it('the union gains an id and the new child gets union: with it', () => {
			// Edric and Joan's betrothal (no id, no children) is followed by a marriage.
			const withMarriage = chain(MAIN, { kind: 'add-union', partners: ['edric', 'joan'], type: 'marriage', start: '1158' });
			const op: Op = {
				kind: 'add-person',
				id: 'alys',
				fields: { name: 'Alys Harrow', sex: 'f' },
				parents: [birth('edric'), birth('joan')],
				at: { kind: 'after-siblings', parents: ['edric', 'joan'], union: U1 },
			};
			const o = expectGolden(applyOp(withMarriage, op), '09-add-child-earlier-union.yaml');
			expect(o.created).toContain('alys');
			expectClean(o.body);
		});

		it('a union that has an id already: after its last child, with union:', () => {
			expect(ok(applyOp(TWO, bran({ index: 1, partners: ['roderick', 'mathilde'] }))).body).toBe(
				replaceOnce(
					TWO,
					'    union: roderick-mathilde\n\nunions:',
					'    union: roderick-mathilde\n  - id: bran\n    name: Bran Valmont\n    parents: [roderick, mathilde]\n    union: roderick-mathilde\n\nunions:',
				),
			);
		});

		it('the last-listed union: no union: key; with no siblings there, after the last parent', () => {
			expect(ok(applyOp(TWO, bran({ index: 2, partners: ['mathilde', 'roderick'] }))).body).toBe(
				replaceOnce(TWO, '    born: 1136\n', '    born: 1136\n  - id: bran\n    name: Bran Valmont\n    parents: [roderick, mathilde]\n'),
			);
		});
	});

	it('refusals: id-taken (also for the quoted id), unknown people, an empty name', () => {
		expectRefused(applyOp(MAIN, { kind: 'add-person', id: 'edric', fields: { name: 'Edric' } }), 'id-taken');
		expectRefused(applyOp(MAIN, { kind: 'add-person', id: '0017', fields: { name: 'Maud' } }), 'id-taken');
		expectRefused(applyOp(MAIN, { kind: 'add-person', id: 'joan', fields: { name: 'Joan' } }), 'id-taken');
		expectRefused(applyOp(MAIN, { kind: 'add-person', id: 'x', fields: { name: 'X' }, parents: [birth('nobody')] }), 'unknown-person');
		expectRefused(applyOp(MAIN, { kind: 'add-person', id: 'x', fields: { name: 'X' }, at: { kind: 'before', id: 'nobody' } }), 'unknown-person');
		expectRefused(applyOp(MAIN, { kind: 'add-person', id: 'x', fields: { name: '' } }), 'bad-value');
		expectRefused(applyOp(MAIN, { kind: 'add-person', id: 'x', fields: {} }), 'bad-value');
	});
});

describe('add-person in an empty block (§5.9 "Add first person")', () => {
	// Decision: as for add-house in M2, a new section uses two-space indentation and "  - " items.

	it('an empty body', () => {
		const r = ok(applyOp('', { kind: 'add-person', id: 'aldric', fields: { name: 'Aldric Valmont', sex: 'm' } }));
		expect(r.body).toBe('people:\n  - id: aldric\n    name: Aldric Valmont\n    sex: m');
		expect(r.created).toEqual(['aldric']);
	});

	it('a comment-only body keeps the comment above', () => {
		expect(ok(applyOp('# nothing yet', { kind: 'add-person', id: 'aldric', fields: { name: 'Aldric' } })).body).toBe(
			'# nothing yet\npeople:\n  - id: aldric\n    name: Aldric',
		);
	});

	it('a body with only houses gets people after houses, one blank line between', () => {
		const body = 'houses:\n  - id: valmont\n    name: House Valmont';
		expect(ok(applyOp(body, { kind: 'add-person', id: 'aldric', fields: { name: 'Aldric', house: 'valmont' } })).body).toBe(
			'houses:\n  - id: valmont\n    name: House Valmont\n\npeople:\n  - id: aldric\n    name: Aldric\n    house: valmont',
		);
	});
});

describe('add-parent (§6.4, §4.2, the decision notes "Automatic marriage")', () => {
	it('a second birth parent with no union between them adds a marriage and reports auto-union', () => {
		// Decision: the automatic union is appended to `unions` with `type: marriage` written out
		// (§6.4 names the type, and the user edits it from the spouse list). Its partners are in the
		// order of the child's parent entries: the existing parent, then the new one.
		const r = applyOp(MAIN, { kind: 'add-parent', child: 'piers', parent: 'joan', type: 'birth' });
		expectGolden(r, '09-add-parent-auto-union.yaml');
		expect(effects(r)).toEqual(['auto-union']);
		expectClean(ok(r).body);
	});

	it('autoUnion: false adds only the parent entry', () => {
		const r = applyOp(MAIN, { kind: 'add-parent', child: 'piers', parent: 'joan', type: 'birth', autoUnion: false });
		expect(ok(r).body).toBe(replaceOnce(MAIN, '    parents: [aldous]\n  # Wards', '    parents: [aldous, joan]\n  # Wards'));
		expect(effects(r)).toEqual([]);
	});

	it('a second ward whose parents already have a union: no new union; a block list stays a block list', () => {
		// Decision: an existing block-style `parents` list keeps its style (minimal diff, §6.2); the
		// new entry is a new "- " item, in the §4.2 form (a flow map for a type other than birth).
		// §4.2 "always a flow sequence" applies to a list the plugin creates.
		const r = applyOp(MAIN, { kind: 'add-parent', child: 'tamsin', parent: '0017', type: 'ward' });
		expect(ok(r).body).toBe(
			replaceOnce(
				MAIN,
				'        since: 1140           # unknown key in a parent entry\n',
				'        since: 1140           # unknown key in a parent entry\n      - {id: "0017", type: ward}\n',
			),
		);
		expect(effects(r)).toEqual([]);
	});

	it('a block list gets a birth parent as a plain item', () => {
		const body = chain(MAIN, { kind: 'remove-parent', child: 'rosamund', parent: '0017', type: 'birth' });
		expect(ok(applyOp(body, { kind: 'add-parent', child: 'rosamund', parent: '0017', type: 'birth' })).body).toBe(MAIN);
	});

	it('an adoptive parent in a block list is a flow-map item', () => {
		expect(ok(applyOp(MAIN, { kind: 'add-parent', child: 'rosamund', parent: 'tamsin', type: 'adoptive' })).body).toBe(
			replaceOnce(MAIN, '      - "0017"\n  - id: piers', '      - "0017"\n      - {id: tamsin, type: adoptive}\n  - id: piers'),
		);
	});

	it('the flow-map person gets parents inside the braces, in §4.1 order', () => {
		expect(ok(applyOp(MAIN, { kind: 'add-parent', child: 'joan', parent: 'piers', type: 'birth' })).body).toBe(
			replaceOnce(MAIN, '{id: joan, name: Joan Marsh, sex: f, born: 1135}', '{id: joan, name: Joan Marsh, sex: f, born: 1135, parents: [piers]}'),
		);
	});

	it('a person with no parents gets a new flow sequence; the unknown last key does not decide the place', () => {
		expect(ok(applyOp(MAIN, { kind: 'add-parent', child: 'aldous', parent: 'joan', type: 'adoptive' })).body).toBe(
			replaceOnce(
				MAIN,
				'    epithet: the Patient      # unknown key in a person\n',
				'    epithet: the Patient      # unknown key in a person\n    parents: [{id: joan, type: adoptive}]\n',
			),
		);
	});

	describe('fixture 8: each type, first and second parent', () => {
		const entry = (t: ParentKind, id: string) => (t === 'birth' ? id : `{id: ${id}, type: ${t}}`);
		const TYPES: ParentKind[] = ['birth', 'adoptive', 'ward', 'rumoured'];

		for (const t of TYPES) {
			// The decision notes "Relationship-op details": only two birth or two adoptive parents are assumed
			// to be a couple; guardians and rumoured parents are not.
			const couple = t === 'birth' || t === 'adoptive';
			it(`${t}: Sabine gets Marek, then Gareth; the pair has no union, so ${couple ? 'a marriage is added' : 'nothing is added'}`, () => {
				const one = applyOp(F8, { kind: 'add-parent', child: 'sabine', parent: 'marek', type: t });
				expect(ok(one).body).toBe(replaceOnce(F8, '    born: 1135\n', `    born: 1135\n    parents: [${entry(t, 'marek')}]\n`));
				expect(effects(one)).toEqual([]);

				const two = applyOp(ok(one).body, { kind: 'add-parent', child: 'sabine', parent: 'gareth', type: t });
				const parents = replaceOnce(F8, '    born: 1135\n', `    born: 1135\n    parents: [${entry(t, 'marek')}, ${entry(t, 'gareth')}]\n`);
				expect(ok(two).body).toBe(couple ? parents + '\n  - partners: [marek, gareth]\n    type: marriage' : parents);
				expect(effects(two)).toEqual(couple ? ['auto-union'] : []);
			});

			it(`${t}: Sabine gets Gareth, then Odette; they have a union, so nothing is added`, () => {
				const two = applyOp(chain(F8, { kind: 'add-parent', child: 'sabine', parent: 'gareth', type: t }), {
					kind: 'add-parent',
					child: 'sabine',
					parent: 'odette',
					type: t,
				});
				expect(ok(two).body).toBe(replaceOnce(F8, '    born: 1135\n', `    born: 1135\n    parents: [${entry(t, 'gareth')}, ${entry(t, 'odette')}]\n`));
				expect(effects(two)).toEqual([]);
			});
		}

		it('two parents of different types: no union', () => {
			const two = applyOp(chain(F8, { kind: 'add-parent', child: 'sabine', parent: 'marek', type: 'birth' }), {
				kind: 'add-parent',
				child: 'sabine',
				parent: 'gareth',
				type: 'adoptive',
			});
			expect(ok(two).body).toBe(replaceOnce(F8, '    born: 1135\n', '    born: 1135\n    parents: [marek, {id: gareth, type: adoptive}]\n'));
			expect(effects(two)).toEqual([]);
		});

		it('a ward added to a flow list with other entries', () => {
			expect(ok(applyOp(F8, { kind: 'add-parent', child: 'jasper', parent: 'aldric', type: 'ward' })).body).toBe(
				replaceOnce(F8, '    born: 1128\n    parents: [marek, anna]', '    born: 1128\n    parents: [marek, anna, {id: aldric, type: ward}]'),
			);
		});
	});

	it('limit: a third parent of one type (§4.2)', () => {
		expectRefused(applyOp(MAIN, { kind: 'add-parent', child: 'edric', parent: 'piers', type: 'birth' }), 'limit');
		expectRefused(applyOp(F8, { kind: 'add-parent', child: 'tomas', parent: 'gareth', type: 'adoptive' }), 'limit');
		expectRefused(applyOp(F8, { kind: 'add-parent', child: 'tomas', parent: 'gareth', type: 'birth' }), 'limit');
		const twoWards = chain(MAIN, { kind: 'add-parent', child: 'tamsin', parent: '0017', type: 'ward' });
		expectRefused(applyOp(twoWards, { kind: 'add-parent', child: 'tamsin', parent: 'joan', type: 'ward' }), 'limit');
		// Other types are not full.
		expect(applyOp(F8, { kind: 'add-parent', child: 'tomas', parent: 'gareth', type: 'ward' }).ok).toBe(true);
	});

	it('cycle: the person themself, or a descendant through any parent type (§6.6, §8)', () => {
		const cases: [string, string, string, ParentKind][] = [
			[MAIN, 'aldous', 'aldous', 'birth'],
			[MAIN, 'aldous', 'edric', 'birth'],
			[MAIN, '0017', 'rosamund', 'adoptive'],
			// Tamsin is Aldous's ward.
			[MAIN, 'aldous', 'tamsin', 'rumoured'],
			// Fixture 8: Aldric adopted Tomas, whose son is Lucan.
			[F8, 'aldric', 'lucan', 'birth'],
			[F8, 'isolde', 'lucan', 'ward'],
			[F8, 'tomas', 'lucan', 'rumoured'],
			// Piers is Aldric's ward.
			[F8, 'aldric', 'piers', 'birth'],
			// Roderick is rumoured to be Marek's son.
			[F8, 'marek', 'roderick', 'adoptive'],
		];
		for (const [body, child, parent, type] of cases) {
			expectRefused(applyOp(body, { kind: 'add-parent', child, parent, type }), 'cycle');
		}
		// An adoptive/ward chain: Tamsin adopts Kit; now Kit cannot become Aldous's parent.
		const withKit = chain(MAIN, {
			kind: 'add-person',
			id: 'kit',
			fields: { name: 'Kit' },
			parents: [{ id: 'tamsin', type: 'adoptive' }],
			at: { kind: 'after', id: 'tamsin' },
		});
		expectRefused(applyOp(withKit, { kind: 'add-parent', child: 'aldous', parent: 'kit', type: 'ward' }), 'cycle');
	});

	it('unknown people', () => {
		expectRefused(applyOp(MAIN, { kind: 'add-parent', child: 'edric', parent: 'nobody', type: 'adoptive' }), 'unknown-person');
		expectRefused(applyOp(MAIN, { kind: 'add-parent', child: 'nobody', parent: 'edric', type: 'adoptive' }), 'unknown-person');
	});

	it('bad-value: already a parent of that type (the decision notes "Relationship-op details")', () => {
		expectRefused(applyOp(MAIN, { kind: 'add-parent', child: 'piers', parent: 'aldous', type: 'birth' }), 'bad-value');
		expectRefused(applyOp(MAIN, { kind: 'add-parent', child: 'tamsin', parent: 'aldous', type: 'ward' }), 'bad-value');
		expectRefused(applyOp(F8, { kind: 'add-parent', child: 'roderick', parent: 'marek', type: 'rumoured' }), 'bad-value');
	});
});

describe('add-union (§6.4 Add spouse, §4.3, the decision notes "Second union for a couple")', () => {
	// Decision: a new union is appended to `unions` as a block map with keys in the §4.1 order (id,
	// partners, type, start, end); `partners` is a flow sequence in the op's order; `type` is written
	// only when the op gives it (also for marriage). A child gets `union:` in the §4.1 order.
	//
	// Decision: the id given to an existing union comes from §6.8 applied to its two partner ids as
	// written, joined by a space ("roderick mathilde" → roderick-mathilde), unique among union ids.
	// It goes first, on the "- " line.

	it('a new pair: appended, with dates', () => {
		const r = ok(applyOp(MAIN, { kind: 'add-union', partners: ['piers', 'joan'], type: 'affair', start: '1155', end: '1158' }));
		expect(r.body).toBe(
			replaceOnce(MAIN, '    type: betrothal\n', '    type: betrothal\n  - partners: [piers, joan]\n    type: affair\n    start: 1155\n    end: 1158\n'),
		);
		expectClean(r.body);
	});

	it('a new pair with the quoted id, no type', () => {
		expect(ok(applyOp(MAIN, { kind: 'add-union', partners: ['0017', 'piers'] })).body).toBe(
			replaceOnce(MAIN, '    type: betrothal\n', '    type: betrothal\n  - partners: ["0017", piers]\n'),
		);
	});

	it('a pair whose union has an id: its children get union: with that id; the new union is appended', () => {
		const r = applyOp(MAIN, { kind: 'add-union', partners: ['aldous', '0017'], type: 'concubinage', start: '1150', end: '1155' });
		expectGolden(r, '09-add-union-second.yaml');
		expectClean(ok(r).body);
	});

	it('fixture 1: the existing union gains an id, and its children keep it', () => {
		const r = applyOp(F1, { kind: 'add-union', partners: ['roderick', 'mathilde'], start: '1165' });
		expectGolden(r, '01-add-union-second.yaml');
		const parsed = parseDynasty(ok(r).body);
		if (!parsed.ok) throw new Error('does not parse');
		const g = deriveFamilies(parsed.tree);
		expect(g.issues).toEqual([]);
		// §4.3: Edric and Alys stay under the first union; the new (last-listed) union has no children.
		expect(g.primaryUnion.get('edric')).toBe('u1');
		expect(g.primaryUnion.get('alys')).toBe('u1');
	});

	it('fixture 8: the adopted heir is a child of the adoptive union, so he gets union:', () => {
		const r = ok(applyOp(F8, { kind: 'add-union', partners: ['aldric', 'isolde'], type: 'marriage', start: '1140' }));
		let want = replaceOnce(F8, '    placement: adoptive\n', '    placement: adoptive\n    union: aldric-isolde\n');
		want = replaceOnce(want, '  - partners: [aldric, isolde]\n    start: 1129\n', '  - id: aldric-isolde\n    partners: [aldric, isolde]\n    start: 1129\n');
		expect(r.body).toBe(want + '\n  - partners: [aldric, isolde]\n    type: marriage\n    start: 1140');
		expectClean(r.body);
	});

	it('a pair whose last union has no children: that union gets no id (the decision notes "Relationship-op details")', () => {
		const once = ok(applyOp(MAIN, { kind: 'add-union', partners: ['edric', 'joan'], type: 'marriage', start: '1158' })).body;
		expect(once).toBe(replaceOnce(MAIN, '    type: betrothal\n', '    type: betrothal\n  - partners: [edric, joan]\n    type: marriage\n    start: 1158\n'));
		expectClean(once);
		expect(ok(applyOp(once, { kind: 'add-union', partners: ['joan', 'edric'], type: 'affair' })).body).toBe(
			replaceOnce(once, '    start: 1158\n', '    start: 1158\n  - partners: [joan, edric]\n    type: affair\n'),
		);
	});

	it('union ids stay unique in the union namespace: the second id for a pair gets -2', () => {
		const child = (id: string, name: string): Op => ({
			kind: 'add-person',
			id,
			fields: { name },
			parents: [birth('edric'), birth('joan')],
			at: { kind: 'after-siblings', parents: ['edric', 'joan'] },
		});
		const body = chain(
			MAIN,
			// Alys is the betrothal's child; the new marriage takes Bran; a third union follows.
			child('alys', 'Alys Harrow'),
			{ kind: 'add-union', partners: ['edric', 'joan'], type: 'marriage', start: '1158' },
			child('bran', 'Bran Harrow'),
			{ kind: 'add-union', partners: ['edric', 'joan'], type: 'affair' },
		);
		let want = replaceOnce(
			MAIN,
			'   # a flow-map person\n',
			'   # a flow-map person\n  - id: alys\n    name: Alys Harrow\n    parents: [edric, joan]\n    union: edric-joan\n' +
				'  - id: bran\n    name: Bran Harrow\n    parents: [edric, joan]\n    union: edric-joan-2\n',
		);
		want = replaceOnce(
			want,
			'  - partners: [edric, joan]\n    type: betrothal\n',
			'  - id: edric-joan\n    partners: [edric, joan]\n    type: betrothal\n' +
				'  - id: edric-joan-2\n    partners: [edric, joan]\n    type: marriage\n    start: 1158\n' +
				'  - partners: [edric, joan]\n    type: affair\n',
		);
		expect(body).toBe(want);
		expectClean(body);
	});

	it('a block without unions gets a unions section after people', () => {
		// Decision: like a new section in M2, one blank line separates it from people.
		const r = ok(applyOp(SECOND, { kind: 'add-union', partners: ['bertram', 'ysolde'], type: 'betrothal' }));
		expect(r.body).toBe(SECOND + '\n\nunions:\n  - partners: [bertram, ysolde]\n    type: betrothal');
	});

	it('refusals', () => {
		expectRefused(applyOp(MAIN, { kind: 'add-union', partners: ['edric', 'nobody'] }), 'unknown-person');
		expectRefused(applyOp(MAIN, { kind: 'add-union', partners: ['edric', 'edric'] }), 'bad-value');
	});
});

describe('edit-union (§6.3 spouse Edit: type, start, end)', () => {
	it('type and start, found by a ref with the partners in the other order', () => {
		expect(ok(applyOp(MAIN, { kind: 'edit-union', union: U1, fields: { type: 'marriage', start: '1157' } })).body).toBe(
			replaceOnce(MAIN, '    type: betrothal\n', '    type: marriage\n    start: 1157\n'),
		);
	});

	it('a changed start keeps its place', () => {
		expect(ok(applyOp(MAIN, { kind: 'edit-union', union: U0, fields: { start: '1128' } })).body).toBe(replaceOnce(MAIN, '    start: 1129\n', '    start: 1128\n'));
	});

	it('a new end goes after the last entry, since only an unknown key follows start', () => {
		expect(ok(applyOp(MAIN, { kind: 'edit-union', union: U0, fields: { end: '1161' } })).body).toBe(
			replaceOnce(MAIN, '    witnessed-by: the Abbot   # unknown key in a union\n', '    witnessed-by: the Abbot   # unknown key in a union\n    end: 1161\n'),
		);
	});

	it('null removes a key (type back to the default)', () => {
		expect(ok(applyOp(MAIN, { kind: 'edit-union', union: U0, fields: { type: null } })).body).toBe(replaceOnce(MAIN, '    type: marriage\n', ''));
		expect(ok(applyOp(MAIN, { kind: 'edit-union', union: U0, fields: { start: null, type: null } })).body).toBe(
			replaceOnce(MAIN, '    type: marriage\n    start: 1129\n', ''),
		);
	});

	it('fixture 8: a type on a union that had none', () => {
		expect(ok(applyOp(F8, { kind: 'edit-union', union: { index: 3, partners: ['tomas', 'sabine'] }, fields: { type: 'betrothal' } })).body).toBe(
			F8 + '\n    type: betrothal',
		);
	});

	it('unknown-union for a stale ref', () => {
		expectRefused(applyOp(MAIN, { kind: 'edit-union', union: { index: 1, partners: ['aldous', '0017'] }, fields: { start: '1' } }), 'unknown-union');
		expectRefused(applyOp(MAIN, { kind: 'edit-union', union: { index: 2, partners: ['edric', 'joan'] }, fields: { start: '1' } }), 'unknown-union');
		expectRefused(applyOp(MAIN, { kind: 'edit-union', union: { index: 0, partners: ['aldous', 'edric'] }, fields: { start: '1' } }), 'unknown-union');
	});
});

describe('remove-union (§6.7, D5)', () => {
	it('only the union item goes; the children keep both parents', () => {
		const r = applyOp(MAIN, { kind: 'remove-union', union: U0 });
		expectGolden(r, '09-remove-union-first.yaml');
		const parsed = parseDynasty(ok(r).body);
		if (!parsed.ok) throw new Error('does not parse');
		const g = deriveFamilies(parsed.tree);
		expect(g.issues).toEqual([]);
		// D5: the pair is still drawn as co-parents, with an implicit union.
		expect(g.placementParents.get('edric')).toEqual(['aldous', '0017']);
		const u = g.unionByKey.get(g.primaryUnion.get('rosamund')!)!;
		expect(u.implicit).toBe(true);
	});

	it('the comment above the removed union stays', () => {
		expect(ok(applyOp(MAIN, { kind: 'remove-union', union: U1 })).body).toBe(
			replaceOnce(MAIN, '  # Edric is promised to Joan.\n  - partners: [edric, joan]\n    type: betrothal\n', '  # Edric is promised to Joan.\n'),
		);
	});

	it('fixture 8: the first union', () => {
		expect(ok(applyOp(F8, { kind: 'remove-union', union: { index: 0, partners: ['isolde', 'aldric'] } })).body).toBe(
			replaceOnce(F8, '  - partners: [aldric, isolde]\n    start: 1129\n', ''),
		);
	});

	it('union: keys that named the removed union go in the same write (the decision notes "Relationship-op details")', () => {
		// Fixture 1 after a second union for Roderick and Mathilde; removing the first one leaves
		// Edric and Alys under the second.
		const two = golden('01-add-union-second.yaml').replace(/\n$/, '');
		const r = ok(applyOp(two, { kind: 'remove-union', union: { index: 1, partners: ['roderick', 'mathilde'] } }));
		expect(r.body).toBe(replaceOnce(F1, '    start: 1156', '    start: 1165'));
		expectClean(r.body);
	});

	it('removing the last union removes unions', () => {
		// Decision: like the last option (M2), the section goes with the blank line that separated it.
		const body = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n\nunions:\n  - partners: [a, b]';
		expect(ok(applyOp(body, { kind: 'remove-union', union: { index: 0, partners: ['a', 'b'] } })).body).toBe(
			'people:\n  - id: a\n    name: A\n  - id: b\n    name: B',
		);
	});

	it('unknown-union for a stale ref', () => {
		expectRefused(applyOp(MAIN, { kind: 'remove-union', union: { index: 0, partners: ['edric', 'joan'] } }), 'unknown-union');
		expectRefused(applyOp(MAIN, { kind: 'remove-union', union: { index: 7, partners: ['edric', 'joan'] } }), 'unknown-union');
	});
});

describe('set-parent-type (§6.3 parent type selector, §4.2 write form)', () => {
	it('plain → flow map, and back to the original bytes', () => {
		const adoptive = ok(applyOp(MAIN, { kind: 'set-parent-type', child: 'piers', parent: 'aldous', from: 'birth', to: 'adoptive' })).body;
		expect(adoptive).toBe(replaceOnce(MAIN, '    parents: [aldous]\n  # Wards', '    parents: [{id: aldous, type: adoptive}]\n  # Wards'));
		expect(ok(applyOp(adoptive, { kind: 'set-parent-type', child: 'piers', parent: 'aldous', from: 'adoptive', to: 'birth' })).body).toBe(MAIN);
	});

	it('the quoted id inside a flow map', () => {
		expect(ok(applyOp(MAIN, { kind: 'set-parent-type', child: 'edric', parent: '0017', from: 'birth', to: 'rumoured' })).body).toBe(
			replaceOnce(MAIN, '    parents: [aldous, "0017"]\n  - id: rosamund', '    parents: [aldous, {id: "0017", type: rumoured}]\n  - id: rosamund'),
		);
	});

	it('a block-list item keeps the spaces before its end-of-line comment', () => {
		expect(ok(applyOp(MAIN, { kind: 'set-parent-type', child: 'rosamund', parent: 'aldous', from: 'birth', to: 'ward' })).body).toBe(
			replaceOnce(MAIN, '      - aldous                # a block-style', '      - {id: aldous, type: ward}                # a block-style'),
		);
	});

	it('a block-map entry with an unknown key keeps its form; only type changes', () => {
		// Decision: the plain form cannot hold `since`, which §4.1 says must survive, so the entry
		// stays a map with `type: birth`.
		expect(ok(applyOp(MAIN, { kind: 'set-parent-type', child: 'tamsin', parent: 'aldous', from: 'ward', to: 'birth' })).body).toBe(
			replaceOnce(MAIN, '        type: ward\n', '        type: birth\n'),
		);
		expect(ok(applyOp(MAIN, { kind: 'set-parent-type', child: 'tamsin', parent: 'aldous', from: 'ward', to: 'adoptive' })).body).toBe(
			replaceOnce(MAIN, '        type: ward\n', '        type: adoptive\n'),
		);
	});

	it('fixture 8: an entry keeps its position in the list', () => {
		expect(ok(applyOp(F8, { kind: 'set-parent-type', child: 'tomas', parent: 'marek', from: 'birth', to: 'rumoured' })).body).toBe(
			replaceOnce(F8, '[marek, anna, {id: aldric', '[{id: marek, type: rumoured}, anna, {id: aldric'),
		);
		expect(ok(applyOp(F8, { kind: 'set-parent-type', child: 'roderick', parent: 'marek', from: 'rumoured', to: 'ward' })).body).toBe(
			replaceOnce(F8, '{id: marek, type: rumoured}', '{id: marek, type: ward}'),
		);
	});

	it('limit: the new type is full', () => {
		expectRefused(applyOp(F8, { kind: 'set-parent-type', child: 'tomas', parent: 'anna', from: 'birth', to: 'adoptive' }), 'limit');
		expectRefused(applyOp(F8, { kind: 'set-parent-type', child: 'piers', parent: 'aldric', from: 'ward', to: 'birth' }), 'limit');
	});

	it('a link that does not exist with that type is refused', () => {
		expectRefused(applyOp(MAIN, { kind: 'set-parent-type', child: 'piers', parent: 'aldous', from: 'ward', to: 'birth' }), 'bad-value');
		expectRefused(applyOp(MAIN, { kind: 'set-parent-type', child: 'piers', parent: 'edric', from: 'birth', to: 'ward' }), 'bad-value');
	});
});

describe('remove-parent (§6.7 Remove parent link)', () => {
	it('one entry of a flow list', () => {
		expect(ok(applyOp(MAIN, { kind: 'remove-parent', child: 'edric', parent: '0017', type: 'birth' })).body).toBe(
			replaceOnce(MAIN, '    parents: [aldous, "0017"]\n  - id: rosamund', '    parents: [aldous]\n  - id: rosamund'),
		);
	});

	it('the last entry removes the parents key', () => {
		expect(ok(applyOp(MAIN, { kind: 'remove-parent', child: 'piers', parent: 'aldous', type: 'birth' })).body).toBe(
			replaceOnce(MAIN, '    born: 1136\n    parents: [aldous]\n', '    born: 1136\n'),
		);
		expect(ok(applyOp(MAIN, { kind: 'remove-parent', child: 'tamsin', parent: 'aldous', type: 'ward' })).body).toBe(
			replaceOnce(
				MAIN,
				'    sex: f\n    parents:\n      - id: aldous\n        type: ward\n        since: 1140           # unknown key in a parent entry\n',
				'    sex: f\n',
			),
		);
	});

	it('an item of a block list, with its end-of-line comment', () => {
		expect(ok(applyOp(MAIN, { kind: 'remove-parent', child: 'rosamund', parent: 'aldous', type: 'birth' })).body).toBe(
			replaceOnce(MAIN, '      - aldous                # a block-style parents list\n', ''),
		);
		expect(ok(applyOp(MAIN, { kind: 'remove-parent', child: 'rosamund', parent: '0017', type: 'birth' })).body).toBe(
			replaceOnce(MAIN, '      - "0017"\n  - id: piers', '  - id: piers'),
		);
	});

	it('fixture 8: flow-map entries', () => {
		expect(ok(applyOp(F8, { kind: 'remove-parent', child: 'tomas', parent: 'aldric', type: 'adoptive' })).body).toBe(
			replaceOnce(F8, '[marek, anna, {id: aldric, type: adoptive}, {id: isolde, type: adoptive}]', '[marek, anna, {id: isolde, type: adoptive}]'),
		);
		expect(ok(applyOp(F8, { kind: 'remove-parent', child: 'roderick', parent: 'marek', type: 'rumoured' })).body).toBe(
			replaceOnce(F8, '[gareth, odette, {id: marek, type: rumoured}]', '[gareth, odette]'),
		);
	});

	it('only the entry of the given type', () => {
		expectRefused(applyOp(MAIN, { kind: 'remove-parent', child: 'piers', parent: 'aldous', type: 'ward' }), 'bad-value');
		expectRefused(applyOp(MAIN, { kind: 'remove-parent', child: 'piers', parent: 'edric', type: 'birth' }), 'bad-value');
	});
});

describe('move-sibling (§6.5, D2)', () => {
	it('a comment between two siblings belongs to the lower one and moves with it', () => {
		expectGolden(applyOp(MAIN, { kind: 'move-sibling', id: 'piers', direction: 'later' }), '09-move-piers-later.yaml');
		expectGolden(applyOp(MAIN, { kind: 'move-sibling', id: 'tamsin', direction: 'earlier' }), '09-move-piers-later.yaml');
	});

	it('the comment above the first sibling moves with it; the blank line above stays', () => {
		expectGolden(applyOp(MAIN, { kind: 'move-sibling', id: 'edric', direction: 'later' }), '09-move-edric-later.yaml');
		expectGolden(applyOp(MAIN, { kind: 'move-sibling', id: 'rosamund', direction: 'earlier' }), '09-move-edric-later.yaml');
	});

	it('moving back restores the original bytes', () => {
		expect(chain(MAIN, { kind: 'move-sibling', id: 'piers', direction: 'later' }, { kind: 'move-sibling', id: 'piers', direction: 'earlier' })).toBe(MAIN);
		expect(chain(MAIN, { kind: 'move-sibling', id: 'edric', direction: 'later' }, { kind: 'move-sibling', id: 'edric', direction: 'earlier' })).toBe(MAIN);
	});

	it('no-sibling at either end of the group, or with no group', () => {
		for (const [id, direction] of [
			['edric', 'earlier'],
			['rosamund', 'later'],
			['piers', 'earlier'],
			['tamsin', 'later'],
			['aldous', 'later'],
			['joan', 'earlier'],
		] as const) {
			expectRefused(applyOp(MAIN, { kind: 'move-sibling', id, direction }), 'no-sibling');
		}
	});

	it('fixture 2: groups are per union, so Maud cannot move past Piers', () => {
		expectRefused(applyOp(F2, { kind: 'move-sibling', id: 'maud', direction: 'later' }), 'no-sibling');
		expectRefused(applyOp(F2, { kind: 'move-sibling', id: 'piers', direction: 'earlier' }), 'no-sibling');
		expectRefused(applyOp(F2, { kind: 'move-sibling', id: 'sybil', direction: 'earlier' }), 'no-sibling');
	});

	it('fixture 2: the last person in people moves earlier; the blank line before unions stays', () => {
		const sybil = '  - id: sybil\n    name: Sybil Harrow\n    house: harrow\n    sex: f\n    born: 1145\n    parents: [edmund, clarice]\n';
		const osric = '  - id: osric\n    name: Osric Harrow\n    house: harrow\n    sex: m\n    born: 1148\n    parents: [edmund, clarice]\n';
		expect(ok(applyOp(F2, { kind: 'move-sibling', id: 'osric', direction: 'earlier' })).body).toBe(
			replaceOnce(F2, sybil + osric + '\nunions:', osric + sybil + '\nunions:'),
		);
	});

	it('siblings with another person between them: only the two siblings swap', () => {
		const body = [
			'people:',
			'  - id: a',
			'    name: A',
			'',
			'  # The elder son',
			'  - id: b',
			'    name: B',
			'    parents: [a]',
			'  - id: x',
			'    name: X',
			'  - id: c',
			'    name: C   # the younger son',
			'    parents: [a]',
		].join('\n');
		const want = [
			'people:',
			'  - id: a',
			'    name: A',
			'',
			'  - id: c',
			'    name: C   # the younger son',
			'    parents: [a]',
			'  - id: x',
			'    name: X',
			'  # The elder son',
			'  - id: b',
			'    name: B',
			'    parents: [a]',
		].join('\n');
		expect(ok(applyOp(body, { kind: 'move-sibling', id: 'b', direction: 'later' })).body).toBe(want);
		expect(ok(applyOp(body, { kind: 'move-sibling', id: 'c', direction: 'earlier' })).body).toBe(want);
		expectRefused(applyOp(body, { kind: 'move-sibling', id: 'x', direction: 'earlier' }), 'no-sibling');
	});

	it('unknown person', () => {
		expectRefused(applyOp(MAIN, { kind: 'move-sibling', id: 'nobody', direction: 'later' }), 'unknown-person');
	});
});

describe('delete-person (§6.7)', () => {
	it('Aldous: his item, his id in every parent entry (plain, block, map), his union; nobody else', () => {
		const r = applyOp(MAIN, { kind: 'delete-person', id: 'aldous' });
		expectGolden(r, '09-delete-aldous.yaml');
		expectClean(ok(r).body);
	});

	it('Edric: options.start pointed to him and goes; his union goes; the comments above stay', () => {
		const r = applyOp(MAIN, { kind: 'delete-person', id: 'edric' });
		expectGolden(r, '09-delete-edric.yaml');
		expectClean(ok(r).body);
	});

	it('fixture 8: flow-map entries of other types', () => {
		const aldric = '  - id: aldric\n    name: Aldric Valmont\n    title: Duke of Valmont\n    house: valmont\n    sex: m\n    born: 1102\n    died: 1161\n';
		let want = replaceOnce(F8, aldric, '');
		want = replaceOnce(want, '[marek, anna, {id: aldric, type: adoptive}, {id: isolde, type: adoptive}]', '[marek, anna, {id: isolde, type: adoptive}]');
		want = replaceOnce(want, '[gareth, odette, {id: aldric, type: ward}]', '[gareth, odette]');
		want = replaceOnce(want, '  - partners: [aldric, isolde]\n    start: 1129\n', '');
		expect(ok(applyOp(F8, { kind: 'delete-person', id: 'aldric' })).body).toBe(want);
	});

	it('fixture 8: a birth parent who is also a rumoured parent elsewhere', () => {
		const marek = '  - id: marek\n    name: Marek Drakemoor\n    title: Margrave of Drakemoor\n    house: drakemoor\n    sex: m\n    born: 1100\n';
		let want = replaceOnce(F8, marek, '');
		want = replaceOnce(want, '    parents: [marek, anna]\n', '    parents: [anna]\n');
		want = replaceOnce(want, '[marek, anna, {id: aldric', '[anna, {id: aldric');
		want = replaceOnce(want, '[gareth, odette, {id: marek, type: rumoured}]', '[gareth, odette]');
		want = replaceOnce(want, '  - partners: [marek, anna]\n', '');
		expect(ok(applyOp(F8, { kind: 'delete-person', id: 'marek' })).body).toBe(want);
	});

	it('union: keys that named a removed union go too (the decision notes "Relationship-op details")', () => {
		// Fixture 1 after a second union for Roderick and Mathilde; Mathilde is deleted.
		const two = golden('01-add-union-second.yaml').replace(/\n$/, '');
		let want = replaceOnce(F1, '  - id: mathilde\n    name: Mathilde Harrow\n    sex: f\n    born: 1136\n', '');
		want = replaceOnce(want, '    born: 1158\n    parents: [roderick, mathilde]\n', '    born: 1158\n    parents: [roderick]\n');
		want = replaceOnce(want, '    born: 1161\n    parents: [roderick, mathilde]\n', '    born: 1161\n    parents: [roderick]\n');
		want = replaceOnce(want, '\n  - partners: [roderick, mathilde]\n    start: 1156', '');
		const r = ok(applyOp(two, { kind: 'delete-person', id: 'mathilde' }));
		expect(r.body).toBe(want);
		expectClean(r.body);
	});

	it('options.start and options.focus go; the last option removes options', () => {
		const people = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n    parents: [a]';
		expect(ok(applyOp(`options:\n  start: a\n  focus: a\n  height: 400\n\n${people}`, { kind: 'delete-person', id: 'a' })).body).toBe(
			'options:\n  height: 400\n\npeople:\n  - id: b\n    name: B',
		);
		expect(ok(applyOp(`options:\n  start: a\n  focus: b\n\n${people}`, { kind: 'delete-person', id: 'a' })).body).toBe(
			'options:\n  focus: b\n\npeople:\n  - id: b\n    name: B',
		);
		expect(ok(applyOp(`options:\n  start: a\n  focus: a\n\n${people}`, { kind: 'delete-person', id: 'a' })).body).toBe('people:\n  - id: b\n    name: B');
	});

	it('unknown person', () => {
		expectRefused(applyOp(MAIN, { kind: 'delete-person', id: 'nobody' }), 'unknown-person');
	});
});

describe('batch: a new person and the relationship in one write (§6.3 "New people are drafts")', () => {
	it('new spouse: add-person after the person, then add-union', () => {
		const r = applyOp(MAIN, {
			kind: 'batch',
			ops: [
				{ kind: 'add-person', id: 'hawise', fields: { name: 'Hawise Fenn', sex: 'f', born: '1138' }, at: { kind: 'after', id: 'piers' } },
				{ kind: 'add-union', partners: ['piers', 'hawise'], start: '1158' },
			],
		});
		const o = expectGolden(r, '09-batch-new-spouse.yaml');
		expect(o.created).toEqual(['hawise']);
		expectClean(o.body);
	});

	it('new child, with the open sheet\'s unsaved field change in the same write', () => {
		const r = applyOp(MAIN, {
			kind: 'batch',
			ops: [
				{ kind: 'set-person-fields', id: 'edric', fields: { title: 'Heir of Greyfen' } },
				{
					kind: 'add-person',
					id: 'alys',
					fields: { name: 'Alys Harrow', house: 'harrow', sex: 'f', born: '1159' },
					parents: [birth('edric'), birth('joan')],
					at: { kind: 'after-siblings', parents: ['edric', 'joan'], union: U1 },
				},
			],
		});
		const o = expectGolden(r, '09-batch-new-child.yaml');
		expect(o.created).toEqual(['alys']);
		expectClean(o.body);
	});

	it('new parent: add-person before the child, then add-parent', () => {
		const r = applyOp(MAIN, {
			kind: 'batch',
			ops: [
				{ kind: 'add-person', id: 'wat-marsh', fields: { name: 'Wat Marsh', sex: 'm' }, at: { kind: 'before', id: 'joan' } },
				{ kind: 'add-parent', child: 'joan', parent: 'wat-marsh', type: 'birth' },
			],
		});
		const o = expectGolden(r, '09-batch-new-parent.yaml');
		expect(o.created).toEqual(['wat-marsh']);
		expectClean(o.body);
	});

	it('new second parent: the automatic marriage is reported from inside a batch', () => {
		const r = applyOp(MAIN, {
			kind: 'batch',
			ops: [
				{ kind: 'add-person', id: 'wat-marsh', fields: { name: 'Wat Marsh', sex: 'm' }, at: { kind: 'before', id: 'piers' } },
				{ kind: 'add-parent', child: 'piers', parent: 'wat-marsh', type: 'birth' },
			],
		});
		expect(effects(r)).toEqual(['auto-union']);
		expect(ok(r).body).toContain('  - partners: [aldous, wat-marsh]\n    type: marriage');
		expectClean(ok(r).body);
	});

	it('new spouse in a block with no unions section', () => {
		const r = ok(
			applyOp(SECOND, {
				kind: 'batch',
				ops: [
					{ kind: 'add-person', id: 'alys-fenn', fields: { name: 'Alys Fenn', sex: 'f' }, at: { kind: 'after', id: 'bertram' } },
					{ kind: 'add-union', partners: ['bertram', 'alys-fenn'] },
				],
			}),
		);
		expect(r.body).toBe(
			replaceOnce(SECOND, '    sex: m\n', '    sex: m\n  - id: alys-fenn\n    name: Alys Fenn\n    sex: f\n') + '\n\nunions:\n  - partners: [bertram, alys-fenn]',
		);
	});

	it('if the relationship is refused, nothing is written (the new person neither)', () => {
		const r = applyOp(MAIN, {
			kind: 'batch',
			ops: [
				{ kind: 'add-person', id: 'wat-marsh', fields: { name: 'Wat Marsh' }, at: { kind: 'before', id: 'edric' } },
				{ kind: 'add-parent', child: 'edric', parent: 'wat-marsh', type: 'birth' },
			],
		});
		expectRefused(r, 'limit');
	});
});
