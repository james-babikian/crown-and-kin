import { describe, expect, it } from 'vitest';
import { linkWord, listData, listStart, listWord, oldestParent, BACK_LIMIT, popTrail, pushTrail } from '../src/obsidian/phone-list';
import type { ListGroup, ListRow } from '../src/render/dom/phone-list-dom';
import { build, fixture } from './helpers';

/*
 * 0.2.5, WP-C2a (D144; contract C.3.1): the pure parts of the phone list. The start chain, the oldest parent, the
 * sections and groups of the list, the relation word of a row and the Back trail. All people are made up.
 */

const ids = (rows: readonly ListRow[]) => rows.map((r) => r.id);
const groupsOf = (groups: readonly ListGroup[]) => groups.map((gr) => ({ heading: gr.heading, rows: ids(gr.rows) }));

// Aldric and Isolde (married) have Roderick, Helena and Pia. Gareth is a rumoured father of Roderick. Roderick has two
// partners (Marta, then Ines), a child with each, one child with no listed partner (Kit), a rumoured child (Tam) and an
// adopted child (Pia, who stands with Aldric and Isolde and has a side link to Roderick).
const FAMILY = `
people:
  - {id: aldric, name: Aldric, sex: m, born: 1102}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: gareth, name: Gareth, sex: m, born: 1104}
  - {id: roderick, name: Roderick, sex: m, born: 1131, parents: [aldric, isolde, {id: gareth, type: rumoured}]}
  - {id: helena, name: Helena, sex: f, born: 1133, parents: [aldric, isolde]}
  - {id: pia, name: Pia, sex: f, born: 1135, parents: [aldric, isolde, {id: roderick, type: adoptive}]}
  - {id: marta, name: Marta, sex: f, born: 1133, died: 1170}
  - {id: ines, name: Ines, sex: f, born: 1140}
  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick, marta]}
  - {id: paulo, name: Paulo, sex: m, born: 1162, parents: [roderick, ines]}
  - {id: kit, name: Kit, sex: m, born: 1158, parents: [roderick]}
  - {id: tam, name: Tam, sex: m, born: 1160, parents: [{id: roderick, type: rumoured}]}
unions:
  - {partners: [aldric, isolde], type: marriage}
  - {partners: [roderick, marta], type: marriage}
  - {partners: [roderick, ines], type: marriage}
`;
const fam = build(FAMILY).g;

describe('listStart: the start chain (D144)', () => {
	const g = fam;
	const base = { session: null, pin: undefined, me: null, edited: null, g };

	it('takes the session choice first', () => {
		expect(listStart({ ...base, session: 'kit', pin: 'helena', me: 'lena', edited: 'paulo' })).toEqual({ id: 'kit', from: 'session' });
	});

	it('takes the pin when there is no session choice', () => {
		expect(listStart({ ...base, pin: 'helena', me: 'lena', edited: 'paulo' })).toEqual({ id: 'helena', from: 'pin' });
	});

	it('takes the marked person after the pin', () => {
		expect(listStart({ ...base, me: 'lena', edited: 'paulo' })).toEqual({ id: 'lena', from: 'me' });
	});

	it('takes the person edited last after the mark', () => {
		expect(listStart({ ...base, edited: 'paulo' })).toEqual({ id: 'paulo', from: 'edited' });
	});

	it('takes the oldest person who has children when nothing else is set', () => {
		expect(listStart(base)).toEqual({ id: 'aldric', from: 'oldest' });
	});

	it('skips a missing id on each rung', () => {
		expect(listStart({ ...base, session: 'nobody', pin: 'nobody', me: 'nobody', edited: 'nobody' })).toEqual({ id: 'aldric', from: 'oldest' });
		expect(listStart({ ...base, session: 'nobody', pin: 'helena' })).toEqual({ id: 'helena', from: 'pin' });
		expect(listStart({ ...base, me: 'nobody', edited: 'paulo' })).toEqual({ id: 'paulo', from: 'edited' });
	});

	it('skips the session value "all people" (null) and undefined', () => {
		expect(listStart({ ...base, session: null, pin: 'helena' })).toEqual({ id: 'helena', from: 'pin' });
		expect(listStart({ ...base, session: undefined, pin: 'helena' })).toEqual({ id: 'helena', from: 'pin' });
	});

	it('does not move the list after an edit of another person while a pin or a mark applies', () => {
		const a = listStart({ ...base, pin: 'helena', edited: 'kit' });
		const b = listStart({ ...base, pin: 'helena', edited: 'paulo' });
		expect(a).toEqual(b);
		const c = listStart({ ...base, me: 'lena', edited: 'kit' });
		const d = listStart({ ...base, me: 'lena', edited: 'paulo' });
		expect(c).toEqual(d);
		// With only the last edit and the oldest parent, the list follows the edit.
		expect(listStart({ ...base, edited: 'kit' })?.id).not.toBe(listStart({ ...base, edited: 'paulo' })?.id);
	});

	it('takes the first root when no person has a child', () => {
		const lone = build(`
people:
  - {id: a, name: A}
  - {id: b, name: B}
`).g;
		expect(listStart({ session: null, pin: undefined, me: null, edited: null, g: lone })).toEqual({ id: 'a', from: 'first' });
	});

	it('gives null for a tree with no people', () => {
		const empty = build('people: []\n').g;
		expect(listStart({ session: null, pin: undefined, me: null, edited: null, g: empty })).toBeNull();
	});
});

describe('oldestParent (default: generation, then birth year, then document order)', () => {
	it('prefers the smallest generation over an earlier birth year', () => {
		// Zed is born long before the two roots but stands in generation 1 (he is the child of Top2). Top and Top2 stand in generation 0.
		const g = build(`
people:
  - {id: top2, name: Top2, born: 1100}
  - {id: zed, name: Zed, born: 1020, parents: [top2]}
  - {id: kid, name: Kid, born: 1200, parents: [zed]}
  - {id: top, name: Top, born: 1090}
  - {id: tkid, name: Tkid, born: 1130, parents: [top]}
`).g;
		expect(oldestParent(g)).toBe('top');
	});

	it('breaks a tie of generation by the earliest birth year', () => {
		const g = build(`
people:
  - {id: late, name: Late, born: 1200}
  - {id: early, name: Early, born: c. 1150}
  - {id: k1, name: K1, parents: [late]}
  - {id: k2, name: K2, parents: [early]}
`).g;
		expect(oldestParent(g)).toBe('early');
	});

	it('reads the first run of three or four digits as the year, and puts a person with no year last', () => {
		const g = build(`
people:
  - {id: none, name: None}
  - {id: late, name: Late, born: "12 Mar 1190"}
  - {id: k1, name: K1, parents: [none]}
  - {id: k2, name: K2, parents: [late]}
`).g;
		expect(oldestParent(g)).toBe('late');
	});

	it('breaks a tie of year by document order', () => {
		const g = build(`
people:
  - {id: second, name: Second, born: 1100}
  - {id: first, name: First, born: 1100}
  - {id: k1, name: K1, parents: [first]}
  - {id: k2, name: K2, parents: [second]}
`).g;
		expect(oldestParent(g)).toBe('second');
	});

	it('ignores people with no child, and gives null when nobody has a child', () => {
		const g = build(`
people:
  - {id: a, name: A, born: 1000}
  - {id: b, name: B, born: 1001}
`).g;
		expect(oldestParent(g)).toBeNull();
	});
});

describe('listData: sections of the list', () => {
	it('lists the placement parents first, then the side links, with their link types', () => {
		const d = listData(fam, 'roderick');
		expect(ids(d.parents)).toEqual(['aldric', 'isolde', 'gareth']);
		expect(d.parents.map((r) => r.link)).toEqual(['birth', 'birth', 'rumoured']);
	});

	it('has no parents for a person with none', () => {
		expect(listData(fam, 'aldric').parents).toEqual([]);
	});

	it('puts the centre first, then each partner once in union order', () => {
		const d = listData(fam, 'roderick');
		expect(d.centre).toBe('roderick');
		expect(ids(d.person)).toEqual(['roderick', 'marta', 'ines']);
		expect(d.person.map((r) => r.role)).toEqual(['centre', 'partner', 'partner']);
	});

	it('groups the children by partnership, then no-partner children, then side-link children', () => {
		const d = listData(fam, 'roderick');
		expect(groupsOf(d.groups)).toEqual([
			{ heading: { kind: 'partner', partner: 'marta' }, rows: ['lena'] },
			{ heading: { kind: 'partner', partner: 'ines' }, rows: ['paulo'] },
			{ heading: { kind: 'solo' }, rows: ['kit'] },
			{ heading: { kind: 'other' }, rows: ['pia', 'tam'] },
		]);
		expect(d.groups[3].rows.map((r) => r.link)).toEqual(['adoptive', 'rumoured']);
	});

	it('shows a child only once', () => {
		const d = listData(fam, 'roderick');
		const all = d.groups.flatMap((gr) => ids(gr.rows));
		expect(new Set(all).size).toBe(all.length);
		// Pia stands with Aldric and Isolde too: there she is a child of the union, not of a side link.
		expect(groupsOf(listData(fam, 'aldric').groups)).toEqual([{ heading: { kind: 'partner', partner: 'isolde' }, rows: ['roderick', 'helena', 'pia'] }]);
	});

	it('gives a sub-heading to a partnership with one partner', () => {
		const d = listData(fam, 'aldric');
		expect(d.groups).toHaveLength(1);
		expect(d.groups[0].heading).toEqual({ kind: 'partner', partner: 'isolde' });
	});

	it('gives no sub-heading to children with no partnership at all', () => {
		const g = build(`
people:
  - {id: dad, name: Dad}
  - {id: c1, name: C1, parents: [dad]}
  - {id: c2, name: C2, parents: [dad]}
`).g;
		const d = listData(g, 'dad');
		expect(d.person.map((r) => r.id)).toEqual(['dad']);
		expect(groupsOf(d.groups)).toEqual([{ heading: null, rows: ['c1', 'c2'] }]);
	});

	it('names the no-partner group when a partnership exists, and leaves out a partnership with no child', () => {
		const g = build(`
people:
  - {id: dad, name: Dad}
  - {id: mum, name: Mum}
  - {id: c1, name: C1, parents: [dad]}
unions:
  - {partners: [dad, mum], type: marriage}
`).g;
		expect(groupsOf(listData(g, 'dad').groups)).toEqual([{ heading: { kind: 'solo' }, rows: ['c1'] }]);
		expect(ids(listData(g, 'dad').person)).toEqual(['dad', 'mum']);
	});

	it('lists a partner from an implicit partnership (shared children, no union written)', () => {
		const g = build(`
people:
  - {id: dad, name: Dad}
  - {id: mum, name: Mum}
  - {id: c1, name: C1, parents: [dad, mum]}
`).g;
		const d = listData(g, 'mum');
		expect(ids(d.person)).toEqual(['mum', 'dad']);
		expect(groupsOf(d.groups)).toEqual([{ heading: { kind: 'partner', partner: 'dad' }, rows: ['c1'] }]);
	});

	it('gives one group for each partnership, also with the same partner twice', () => {
		const g = build(`
people:
  - {id: dad, name: Dad}
  - {id: mum, name: Mum}
  - {id: c1, name: C1, parents: [dad, mum]}
unions:
  - {id: u1, partners: [dad, mum], type: betrothal}
  - {id: u2, partners: [dad, mum], type: marriage}
`).g;
		const d = listData(g, 'dad');
		expect(ids(d.person)).toEqual(['dad', 'mum']);
		// The child belongs to one union only; the other has no child and no group.
		expect(d.groups.flatMap((gr) => ids(gr.rows))).toEqual(['c1']);
	});

	it('has no children section data for a person with no child', () => {
		const d = listData(fam, 'lena');
		expect(d.groups).toEqual([]);
		expect(ids(d.parents)).toEqual(['roderick', 'marta']);
		expect(ids(d.person)).toEqual(['lena']);
	});
});

describe('listWord: the relation word of a row', () => {
	const cards = new Map([
		['kit', { text: 'Half-brother, maybe full', lower: 'half-brother' }],
		['roderick', { text: 'Father', lower: 'father' }],
	]);

	it('gives no word with no mark', () => {
		expect(listWord('kit', { me: null, showRelations: true, cards: undefined })).toBeNull();
		expect(listWord('kit', { me: null, showRelations: true, cards })).toBeNull();
	});

	it('gives the real relation word from the cache, and "You" for the marked person', () => {
		expect(listWord('kit', { me: 'lena', showRelations: true, cards })).toEqual({ text: 'Half-brother, maybe full', lower: 'half-brother' });
		expect(listWord('lena', { me: 'lena', showRelations: true, cards })).toEqual({ text: 'You', lower: 'you', strong: true });
	});

	it('gives no word for a person that the cache does not know', () => {
		expect(listWord('tam', { me: 'lena', showRelations: true, cards })).toBeNull();
	});

	it('gives only "You" when the setting is off', () => {
		expect(listWord('kit', { me: 'lena', showRelations: false, cards })).toBeNull();
		expect(listWord('lena', { me: 'lena', showRelations: false, cards })).toEqual({ text: 'You', lower: 'you', strong: true });
	});
});

// D210, D214: the sample tree 08 (parent types) is the case table of the genealogy check.
describe('linkWord and the side link of a partnership (D210, D214)', () => {
	const g8 = build(fixture('08')).g;
	const word = (centre: string, id: string) => {
		const d = listData(g8, centre);
		const row = [...d.parents, ...d.groups.flatMap((gr) => gr.rows)].find((r) => r.id === id)!;
		return linkWord(g8, d, row)?.text ?? null;
	};

	it('parent rows: the kind of link, with Birth only beside an adoptive parent', () => {
		expect(['aldric', 'isolde', 'marek', 'anna'].map((p) => word('tomas', p))).toEqual(['Adoptive father', 'Adoptive mother', 'Birth father', 'Birth mother']);
		expect(['aldric', 'gareth', 'odette'].map((p) => word('piers', p))).toEqual(['Guardian', null, null]);
		expect(['gareth', 'marek'].map((p) => word('roderick', p))).toEqual([null, 'Rumoured father']);
		expect(word('jasper', 'marek')).toBeNull();
	});

	it('child rows: the kind of link, none for a birth child', () => {
		expect(['tomas', 'piers'].map((c) => word('aldric', c))).toEqual(['Adopted son', 'Ward']);
		expect(word('marek', 'roderick')).toBe('Rumoured son');
		expect(word('marek', 'jasper')).toBeNull();
		expect(word('marek', 'tomas')).toBeNull();
	});

	it('gives the neutral word to a person with no sex, and none to the centre or a partner', () => {
		const g = build(`
people:
  - {id: a, name: A, sex: m}
  - {id: k, name: K, parents: [{id: a, type: adoptive}]}
  - {id: w, name: W, sex: f, parents: [{id: a, type: ward}]}
`).g;
		const d = listData(g, 'a');
		expect(d.groups.flatMap((gr) => gr.rows).map((r) => linkWord(g, d, r)?.text)).toEqual(['Adopted child', 'Ward']);
		expect(linkWord(g, d, d.person[0])).toBeNull();
		const dk = listData(g, 'k');
		expect(linkWord(g, dk, dk.parents[0])).toEqual({ text: 'Adoptive father', lower: 'adoptive father' });
	});

	it('lists a birth child drawn under adoptive parents in the partnership with the other birth parent, not under Other children', () => {
		const d = listData(g8, 'marek');
		expect(groupsOf(d.groups)).toEqual([
			{ heading: { kind: 'partner', partner: 'anna' }, rows: ['jasper', 'tomas'] },
			{ heading: { kind: 'other' }, rows: ['roderick'] },
		]);
		expect(d.groups[0].rows.map((r) => r.link)).toEqual(['birth', 'birth']);
		expect(groupsOf(listData(g8, 'anna').groups)).toEqual([{ heading: { kind: 'partner', partner: 'marek' }, rows: ['jasper', 'tomas'] }]);
		// Aldric's list keeps Tomas as the adopted son in the partnership with Isolde.
		expect(groupsOf(listData(g8, 'aldric').groups)).toEqual([
			{ heading: { kind: 'partner', partner: 'isolde' }, rows: ['tomas'] },
			{ heading: { kind: 'other' }, rows: ['piers'] },
		]);
	});
});

describe('the Back trail', () => {
	it('pushes new entries last and keeps at most 20, dropping the oldest', () => {
		let t: string[] | undefined;
		for (let i = 0; i < BACK_LIMIT + 5; i++) t = pushTrail(t, `p${i}`);
		expect(BACK_LIMIT).toBe(20);
		expect(t).toHaveLength(20);
		expect(t![0]).toBe('p5');
		expect(t![19]).toBe('p24');
	});

	it('does not change the array that it was given', () => {
		const t = ['a'];
		const n = pushTrail(t, 'b');
		expect(t).toEqual(['a']);
		expect(n).toEqual(['a', 'b']);
	});

	it('pops the newest person who is still in the tree and skips a missing id', () => {
		const out = popTrail(['kit', 'gone', 'lena', 'gone2'], (id) => fam.byId.has(id));
		expect(out).toEqual({ id: 'lena', rest: ['kit'] });
		expect(popTrail(['gone'], (id) => fam.byId.has(id))).toBeNull();
		expect(popTrail(undefined, () => true)).toBeNull();
		expect(popTrail([], () => true)).toBeNull();
	});
});
