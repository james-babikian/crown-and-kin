import { describe, expect, it } from 'vitest';
import { createUndoStack, planWrite } from '../src/core/block-write';
import { deriveFamilies } from '../src/core/derive';
import type { EditResult, Op } from '../src/core/edit';
import { describeHouseIdChange } from '../src/core/house-ops';
import { parseDynasty } from '../src/core/parse';
import { describeTitleIdChange } from '../src/core/titles';
import { applyOp } from '../src/core/yaml-edit';

// Version 0.2.2, D109 (spec §13.17 rule 5): the ops set-house-id and set-title-id, and the counts
// that the confirm of the Houses and Titles windows shows.

const ok = (r: EditResult): string => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const edit = (src: string, op: Op) => ok(applyOp(src, op));
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};
const tree = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};
const batch = (...ops: Op[]): Op => ({ kind: 'batch', ops });
const setHouse = (id: string, newId: string): Op => ({ kind: 'set-house-id', id, newId });
const setTitle = (id: string, newId: string): Op => ({ kind: 'set-title-id', id, newId });
const lines = (...l: string[]) => l.join('\n') + '\n';

const HOUSES = lines(
	'# The houses',
	'houses:',
	'  - id: valmont   # the main house',
	'    name: House Valmont',
	'  - {id: orsini, name: House Orsini, color: "#112233"}',
	'  - id: "gray"',
	'    name: Gray',
	'',
	'people:',
	'  - id: p1',
	'    name: A',
	'    house: valmont   # heir',
	'  - {id: p2, name: B, house: valmont}',
	'  - {name: Nameless, house: valmont}',
	'  - id: p4',
	'    name: D',
	'    house: "valmont"',
	'  - id: p5',
	'    name: E',
	'    house: orsini',
	"  - {id: p6, name: F, house: 'gray'}",
);

describe('set-house-id: the item and every reference in one write', () => {
	it('changes the id and the house of every person, also a person with no id, and nothing else', () => {
		const out = edit(HOUSES, setHouse('valmont', 'crown'));
		expect(out).toBe(
			HOUSES.replace('id: valmont   # the main house', 'id: crown   # the main house')
				.replace('house: valmont   # heir', 'house: crown   # heir')
				.replace('{id: p2, name: B, house: valmont}', '{id: p2, name: B, house: crown}')
				.replace('{name: Nameless, house: valmont}', '{name: Nameless, house: crown}')
				.replace('house: "valmont"', 'house: "crown"'),
		);
		const t = tree(out);
		expect(t.houses.map((h) => h.id)).toEqual(['crown', 'orsini', 'gray']);
		expect(t.people.filter((p) => p.house === 'crown')).toHaveLength(4);
		// The same warnings as before: only the person with no id.
		expect(deriveFamilies(t).issues.map((i) => i.code)).toEqual(deriveFamilies(tree(HOUSES)).issues.map((i) => i.code));
	});

	it('a flow map item and a quoted value keep their style', () => {
		expect(edit(HOUSES, setHouse('orsini', 'ors'))).toBe(HOUSES.replace('{id: orsini,', '{id: ors,').replace('house: orsini', 'house: ors'));
		const out = edit(HOUSES, setHouse('gray', 'grey'));
		expect(out).toBe(HOUSES.replace('id: "gray"', 'id: "grey"').replace("house: 'gray'", "house: 'grey'"));
	});

	it('a digit-only id is quoted, so it stays text', () => {
		const out = edit(HOUSES, setHouse('orsini', '1234'));
		expect(out).toContain('{id: "1234", name: House Orsini');
		expect(out).toContain('house: "1234"');
		expect(tree(out).houses[1].id).toBe('1234');
		expect(tree(out).people.find((p) => p.id === 'p5')?.house).toBe('1234');
	});

	it('a curly-marked house value is read as the id and a changed value is written straight (D103)', () => {
		const src = lines('houses:', '  - id: “valmont”', '    name: V', '  - {id: orsini, name: O}', 'people:', '  - {id: p1, name: A, house: “valmont”}', '  - {id: p2, name: B, house: ‘valmont’}', '  - {id: p3, name: C, house: orsini}');
		const out = edit(src, setHouse('valmont', 'crown'));
		expect(out).toBe(src.replace('id: “valmont”', 'id: crown').replace('house: “valmont”', 'house: crown').replace('house: ‘valmont’', 'house: crown'));
		expect(tree(out).people.map((p) => p.house)).toEqual(['crown', 'crown', 'orsini']);
	});

	it('a CRLF body keeps its line breaks', () => {
		const out = edit(HOUSES.replace(/\n/g, '\r\n'), setHouse('valmont', 'crown'));
		expect(out.replace(/\r\n/g, '\n')).toBe(edit(HOUSES, setHouse('valmont', 'crown')));
		expect(out.split('\r\n').length).toBe(out.split('\n').length);
	});

	it('an id with a hyphen and digits is allowed', () => {
		expect(edit(HOUSES, setHouse('orsini', 'house-7'))).toContain('house: house-7');
	});

	it('a house that nobody uses changes its id only', () => {
		const src = lines('houses:', '  - {id: a, name: A}', 'people:', '  - {id: p1, name: One}');
		expect(edit(src, setHouse('a', 'b'))).toBe(src.replace('{id: a,', '{id: b,'));
	});

	it('is one write that Undo restores byte for byte', () => {
		const note = `# Note\n\n\`\`\`dynasty\n${HOUSES}\`\`\`\n\nText after.\n`;
		// A block body has no final line break.
		const first = planWrite(note, 0, HOUSES.replace(/\n$/, ''), (b) => {
			const r = applyOp(b, setHouse('valmont', 'crown'));
			return r.ok ? { ok: true, body: r.body } : { ok: false, reason: r.code };
		});
		if (!first.ok) throw new Error('write refused');
		expect(first.newText).not.toBe(note);
		const stack = createUndoStack();
		stack.push(first.oldBody, first.newBody);
		const undo = stack.undo(first.newBody);
		if (!undo.ok) throw new Error('undo refused');
		const back = planWrite(first.newText, 0, first.newBody, () => ({ ok: true, body: undo.body }));
		if (!back.ok) throw new Error('undo write refused');
		expect(back.newText).toBe(note);
	});

	it('an id change and a colour change in one batch are one write', () => {
		const out = edit(HOUSES, batch(setHouse('valmont', 'crown'), { kind: 'edit-house', id: 'crown', color: '#aabbcc' }));
		const t = tree(out);
		expect(t.houses[0]).toMatchObject({ id: 'crown', color: '#aabbcc' });
		expect(t.people.filter((p) => p.house === 'crown')).toHaveLength(4);
	});

	it('a batch changes a house id and a new house with the old name takes the next free id (ids come first)', () => {
		const r = applyOp(HOUSES, batch(setHouse('valmont', 'crown'), { kind: 'add-house', name: 'Crown' }));
		expect(r.ok && r.created).toEqual(['crown-2']);
	});
});

describe('set-house-id: refusals change nothing', () => {
	const refused = (op: Op, expected: string, src = HOUSES) => {
		const r = applyOp(src, op);
		expect(r.ok ? 'ok' : r.code, JSON.stringify(op)).toBe(expected);
	};

	it('an empty id', () => refused(setHouse('valmont', ''), 'bad-value'));
	it('capitals, spaces and other characters', () => {
		for (const bad of ['Crown', 'cr own', ' crown', 'crown ', 'a_b', 'a.b', 'a:b', 'a#b']) refused(setHouse('valmont', bad), 'bad-value');
	});
	it('no letter and no digit', () => {
		for (const bad of ['-', '--', '---']) refused(setHouse('valmont', bad), 'bad-value');
	});
	it('an id that is not text', () => {
		refused(setHouse('valmont', 5 as unknown as string), 'bad-value');
		refused(setHouse('valmont', null as unknown as string), 'bad-value');
		refused(setHouse(7 as unknown as string, 'crown'), 'unknown-house');
	});
	it('an old id that no house has', () => refused(setHouse('ghost', 'crown'), 'unknown-house'));
	it('two houses with the old id', () => {
		const src = lines('houses:', '  - {id: a, name: A}', '  - {id: a, name: A2}', 'people:', '  - {id: p1, name: One, house: a}');
		refused(setHouse('a', 'b'), 'bad-value', src);
	});
	it('the id of another house, also of a house in the same Save (a swap and a chain)', () => {
		refused(setHouse('valmont', 'orsini'), 'id-taken');
		refused(setHouse('valmont', 'gray'), 'id-taken');
		refused(batch(setHouse('valmont', 'orsini'), setHouse('orsini', 'valmont')), 'id-taken');
		refused(batch(setHouse('valmont', 'crown'), setHouse('orsini', 'valmont'), setHouse('gray', 'orsini')), 'ok');
	});
	it('a dangling house value equal to the new id', () => {
		const src = HOUSES.replace('house: orsini', 'house: crown');
		refused(setHouse('valmont', 'crown'), 'id-taken', src);
		expect(applyOp(src, setHouse('valmont', 'crown'))).toEqual({ ok: false, code: 'id-taken' });
	});
	it('a house deleted with keep, and then the id of another house changed to the deleted id', () => {
		const src = lines('houses:', '  - {id: a, name: A}', '  - {id: b, name: B}', 'people:', '  - {id: p1, name: One, house: a}');
		refused(batch({ kind: 'delete-house', id: 'a', people: 'keep' }, setHouse('b', 'a')), 'id-taken', src);
		// With clear, the people lose the key and the id is free.
		expect(code(src, batch({ kind: 'delete-house', id: 'a', people: 'clear' }, setHouse('b', 'a')))).toBe('ok');
	});
	it('a tree that is blocked for editing', () => {
		refused(setHouse('valmont', 'crown'), 'blocked', HOUSES + '  - {id: p1, name: Twin}\n');
	});
	it('an anchor or an alias on the id, on a reference or on the item', () => {
		const onId = lines('houses:', '  - {id: &h valmont, name: V}', 'people:', '  - {id: p1, name: A, house: valmont}');
		refused(setHouse('valmont', 'crown'), 'bad-value', onId);
		const aliasId = lines('houses:', '  - {id: valmont, name: V}', 'people:', '  - {id: p1, name: A, house: &h valmont}', '  - {id: p2, name: B, house: *h}');
		refused(setHouse('valmont', 'crown'), 'bad-value', aliasId);
		const anchorRef = lines('houses:', '  - {id: valmont, name: V}', 'people:', '  - {id: p1, name: A, house: &h valmont}');
		refused(setHouse('valmont', 'crown'), 'bad-value', anchorRef);
		const onItem = lines('houses:', '  - &v {id: valmont, name: V}', 'people:', '  - {id: p1, name: A, house: valmont}');
		refused(setHouse('valmont', 'crown'), 'bad-value', onItem);
		const aliasName = lines('houses:', '  - {id: &x valmont, name: *x}', 'people:', '  - {id: p1, name: A}');
		refused(setHouse('valmont', 'crown'), 'bad-value', aliasName);
	});
	it('an anchor somewhere else is no reason', () => {
		const src = lines('houses:', '  - {id: valmont, name: V}', 'people:', '  - {id: p1, name: &n Aldric, house: valmont}', '  - {id: p2, name: *n}');
		expect(edit(src, setHouse('valmont', 'crown'))).toBe(src.replace('{id: valmont', '{id: crown').replace('house: valmont', 'house: crown'));
	});
	it('never throws for a body that is not text', () => {
		expect(applyOp(undefined as unknown as string, setHouse('a', 'b')).ok).toBe(false);
		expect(applyOp('a: [', setHouse('a', 'b')).ok).toBe(false);
	});
});

describe('set-house-id: the no-op', () => {
	it('an id equal to the old id is accepted and writes nothing, before every other check', () => {
		const out = applyOp(HOUSES, setHouse('valmont', 'valmont'));
		expect(out).toEqual({ ok: true, body: HOUSES, created: [] });
		// Also an old id that has capitals or that no house has.
		const odd = lines('houses:', '  - {id: House_Valmont, name: V}', 'people:', '  - {id: p1, name: A, house: House_Valmont}');
		expect(edit(odd, setHouse('House_Valmont', 'House_Valmont'))).toBe(odd);
		expect(edit(HOUSES, setHouse('ghost', 'ghost'))).toBe(HOUSES);
	});
	it('the old id with capitals can be changed to a valid id', () => {
		const odd = lines('houses:', '  - {id: House_Valmont, name: V}', 'people:', '  - {id: p1, name: A, house: House_Valmont}');
		expect(edit(odd, setHouse('House_Valmont', 'valmont'))).toBe(odd.replace(/House_Valmont/g, 'valmont'));
	});
});

const TITLES = lines(
	'titles:',
	'  - id: duke   # first',
	'    name: Duke of Valmont',
	'    holders: [p1, {person: p2}]',
	'  - {id: king, name: King, holders: []}',
	'houses:',
	'  - {id: duke, name: House Duke}',
	'people:',
	'  - {id: p1, name: A, card-title: duke, house: duke}',
	'  - id: p2',
	'    name: B',
	'    card-title: "duke"',
	'  - {name: C, card-title: duke}',
	'  - {id: p4, name: D, card-title: king}',
);

describe('set-title-id: the item and every card-title in one write', () => {
	it('changes the id and the card-title of every person, also one with no id, and nothing else', () => {
		const out = edit(TITLES, setTitle('duke', 'count'));
		expect(out).toBe(
			TITLES.replace('id: duke   # first', 'id: count   # first')
				.replace('card-title: duke, house: duke}', 'card-title: count, house: duke}')
				.replace('card-title: "duke"', 'card-title: "count"')
				.replace('{name: C, card-title: duke}', '{name: C, card-title: count}'),
		);
		const t = tree(out);
		expect(t.titles?.map((x) => x.id)).toEqual(['count', 'king']);
		// The house of the same name is another namespace and stays.
		expect(t.houses[0].id).toBe('duke');
		expect(t.people[0].house).toBe('duke');
		expect(deriveFamilies(t).issues.map((i) => i.code)).toEqual(deriveFamilies(tree(TITLES)).issues.map((i) => i.code));
	});

	it('the holders are person ids and stay as they are', () => {
		const out = edit(TITLES, setTitle('duke', 'count'));
		expect(out).toContain('holders: [p1, {person: p2}]');
	});

	it('is the same one-write change for a title that nobody uses', () => {
		expect(edit(TITLES, setTitle('king', 'monarch'))).toBe(TITLES.replace('{id: king,', '{id: monarch,').replace('card-title: king', 'card-title: monarch'));
	});

	it('a house id change leaves the card-title alone', () => {
		const out = edit(TITLES, setHouse('duke', 'ducal'));
		expect(out).toContain('card-title: duke, house: ducal}');
		expect(out).toContain('holders: [p1');
	});

	it('Undo restores the text byte for byte', () => {
		const note = `\`\`\`dynasty\n${TITLES}\`\`\`\n`;
		const plan = planWrite(note, 0, TITLES.replace(/\n$/, ''), (b) => {
			const r = applyOp(b, setTitle('duke', 'count'));
			return r.ok ? { ok: true, body: r.body } : { ok: false, reason: r.code };
		});
		if (!plan.ok) throw new Error('refused');
		const stack = createUndoStack();
		stack.push(plan.oldBody, plan.newBody);
		const undo = stack.undo(plan.newBody);
		if (!undo.ok) throw new Error('undo');
		const back = planWrite(plan.newText, 0, plan.newBody, () => ({ ok: true, body: undo.body }));
		if (!back.ok) throw new Error('undo write refused');
		expect(plan.newText).not.toBe(note);
		expect(back.newText).toBe(note);
	});

	it('a curly-marked card-title is not read as the id (D103 covers house only), so it is a dangling value', () => {
		const src = lines('titles:', '  - {id: duke, name: D}', 'people:', '  - {id: p1, name: A, card-title: “duke”}');
		expect(edit(src, setTitle('duke', 'count'))).toBe(src.replace('{id: duke,', '{id: count,'));
	});
});

describe('set-title-id: refusals change nothing', () => {
	const refused = (op: Op, expected: string, src = TITLES) => {
		const r = applyOp(src, op);
		expect(r.ok ? 'ok' : r.code, JSON.stringify(op)).toBe(expected);
	};
	it('an empty id, bad characters, no letter or digit, an id that is not text', () => {
		refused(setTitle('duke', ''), 'bad-value');
		for (const bad of ['Count', ' count', 'co unt', 'c_c', '-', '--']) refused(setTitle('duke', bad), 'bad-value');
		refused(setTitle('duke', 3 as unknown as string), 'bad-value');
	});
	it('an old id that no title has', () => refused(setTitle('ghost', 'count'), 'unknown-title'));
	it('two titles with the old id', () => {
		refused(setTitle('a', 'b'), 'bad-value', lines('titles:', '  - {id: a, name: A}', '  - {id: a, name: A2}', 'people:', '  - {id: p1, name: One}'));
	});
	it('the id of another title, a swap and a chain', () => {
		refused(setTitle('duke', 'king'), 'id-taken');
		refused(batch(setTitle('duke', 'king'), setTitle('king', 'duke')), 'id-taken');
	});
	it('a dangling card-title value equal to the new id', () => {
		refused(setTitle('duke', 'baron'), 'id-taken', TITLES.replace('card-title: king', 'card-title: baron'));
		const src = lines('titles:', '  - {id: crown, name: Crown, holders: [a]}', 'people:', '  - {id: a, name: A}', '  - {id: b, name: B, card-title: king}');
		expect(applyOp(src, setTitle('crown', 'king'))).toEqual({ ok: false, code: 'id-taken' });
	});
	it('an anchor or an alias on the id, on a reference or on the item', () => {
		refused(setTitle('duke', 'count'), 'bad-value', lines('titles:', '  - {id: &t duke, name: D}', 'people:', '  - {id: p1, name: A, card-title: duke}'));
		refused(setTitle('duke', 'count'), 'bad-value', lines('titles:', '  - {id: duke, name: D}', 'people:', '  - {id: p1, name: A, card-title: &t duke}', '  - {id: p2, name: B, card-title: *t}'));
		refused(setTitle('duke', 'count'), 'bad-value', lines('titles:', '  - &x {id: duke, name: D}', 'people:', '  - {id: p1, name: A, card-title: duke}'));
	});
	it('a tree that is blocked for editing', () => {
		refused(setTitle('duke', 'count'), 'blocked', TITLES + '  - {id: p1, name: Twin}\n');
	});
	it('the no-op is accepted, before every other check', () => {
		expect(applyOp(TITLES, setTitle('duke', 'duke'))).toEqual({ ok: true, body: TITLES, created: [] });
		expect(edit(TITLES, setTitle('ghost', 'ghost'))).toBe(TITLES);
	});
});

describe('set-title-id in a batch with the holder ops', () => {
	// The title id op comes first, so the later ops of the row name the new id (spec §13.17 rule 5).
	const BODY = lines('titles:', '  - id: crown', '    name: Crown', '    holders: [x, y]', 'people:', '  - {id: x, name: X, card-title: crown}', '  - {id: y, name: Y}');

	it('a holder removal after the id change leaves no card-title that names a title the person does not hold', () => {
		const out = edit(BODY, batch(setTitle('crown', 'king'), { kind: 'set-holders', title: 'king', items: [] }));
		expect(out).not.toContain('card-title');
		expect(tree(out).titles?.[0]).toMatchObject({ id: 'king', holders: [] });
	});

	it('the same ops in the other order give the same result', () => {
		const out = edit(BODY, batch({ kind: 'set-holders', title: 'crown', items: [] }, setTitle('crown', 'king')));
		expect(out).not.toContain('card-title');
		expect(out).toContain('id: king');
	});

	it('a chain of id changes in one batch is followed by the cleanup', () => {
		const out = edit(BODY, batch(setTitle('crown', 'a'), setTitle('a', 'b'), { kind: 'set-holders', title: 'b', items: [] }));
		expect(out).not.toContain('card-title');
	});

	it('a holder who stays keeps the card-title under the new id', () => {
		const ref = { title: 'king', index: 0, person: 'x' };
		const out = edit(BODY, batch(setTitle('crown', 'king'), { kind: 'set-holders', title: 'king', items: [{ ref }] }));
		expect(out).toContain('card-title: king');
	});

	it('an id change and a rename of the title are one write', () => {
		const out = edit(BODY, batch(setTitle('crown', 'king'), { kind: 'edit-title', id: 'king', name: 'The King' }));
		expect(tree(out).titles?.[0]).toMatchObject({ id: 'king', name: 'The King' });
		expect(out).toContain('card-title: king');
	});

	it('delete-title after the id change removes the card-titles of the new id', () => {
		const out = edit(BODY, batch(setTitle('crown', 'king'), { kind: 'delete-title', id: 'king' }));
		expect(out).not.toContain('card-title');
		expect(out).not.toContain('titles');
	});
});

describe('the counts of the Id confirmation (whole tree, §13.17 rule 5)', () => {
	const graph = (src: string) => deriveFamilies(tree(src));

	it('describeHouseIdChange: 0, 1 and 2 or more people, a person with no id counts', () => {
		const g = graph(HOUSES);
		expect(describeHouseIdChange(g, 'valmont')).toEqual({ people: 4 });
		expect(describeHouseIdChange(g, 'orsini')).toEqual({ people: 1 });
		expect(describeHouseIdChange(g, 'gray')).toEqual({ people: 1 });
		expect(describeHouseIdChange(graph(lines('houses:', '  - {id: a, name: A}')), 'a')).toEqual({ people: 0 });
		expect(describeHouseIdChange(g, 'ghost')).toEqual({ people: 0 });
	});

	it('describeTitleIdChange counts the people whose card-title is the id', () => {
		const g = graph(TITLES);
		expect(describeTitleIdChange(g, 'duke')).toEqual({ people: 3 });
		expect(describeTitleIdChange(g, 'king')).toEqual({ people: 1 });
		expect(describeTitleIdChange(g, 'ghost')).toEqual({ people: 0 });
	});

	it('the count of the whole tree is the number of references the op changes', () => {
		const out = edit(HOUSES, setHouse('valmont', 'crown'));
		expect(describeHouseIdChange(graph(out), 'crown').people).toBe(describeHouseIdChange(graph(HOUSES), 'valmont').people);
		expect(describeHouseIdChange(graph(out), 'valmont').people).toBe(0);
	});

	it('never throws for a graph that is missing', () => {
		expect(describeHouseIdChange(undefined as never, 'a')).toEqual({ people: 0 });
		expect(describeTitleIdChange(undefined as never, 'a')).toEqual({ people: 0 });
	});
});

describe('property: random trees', () => {
	// A small seeded generator: houses h0..h3, people with a house in a random style, comments here and there.
	function rng(seed: number) {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	function body(seed: number) {
		const rand = rng(seed);
		const out = ['houses:'];
		for (let k = 0; k < 4; k++) out.push(rand() < 0.5 ? `  - {id: h${k}, name: H${k}}` : `  - id: h${k}   # c${k}\n    name: H${k}`);
		out.push('people:');
		const n = 3 + Math.floor(rand() * 10);
		for (let i = 0; i < n; i++) {
			const h = `h${Math.floor(rand() * 5)}`;
			const value = rand() < 0.3 ? `"${h}"` : rand() < 0.2 ? `'${h}'` : h;
			out.push(rand() < 0.5 ? `  - {id: p${i}, name: P${i}, house: ${value}}` : `  - id: p${i}\n    name: P${i}\n    house: ${value}${rand() < 0.3 ? '   # note' : ''}`);
		}
		return out.join('\n') + '\n';
	}

	it('a change gives the same data under the new id, and the reverse change gives the text back', () => {
		for (let seed = 1; seed <= 60; seed++) {
			const src = body(seed);
			const before = tree(src);
			const from = `h${seed % 4}`;
			const out = edit(src, setHouse(from, 'moved'));
			const after = tree(out);
			expect(after.houses.map((h) => h.id), `seed ${seed}`).toEqual(before.houses.map((h) => (h.id === from ? 'moved' : h.id)));
			expect(after.people.map((p) => p.house), `seed ${seed}`).toEqual(before.people.map((p) => (p.house === from ? 'moved' : p.house)));
			expect(describeHouseIdChange(deriveFamilies(after), 'moved').people).toBe(describeHouseIdChange(deriveFamilies(before), from).people);
			expect(edit(out, setHouse('moved', from)), `seed ${seed}`).toBe(src);
		}
	});
});
