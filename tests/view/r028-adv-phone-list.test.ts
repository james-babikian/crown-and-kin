import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { computeGenerations } from '../../src/core/generations';
import { parseDynasty } from '../../src/core/parse';
import { cardLabels, needsLabels } from '../../src/core/titles';
import type { ListWord } from '../../src/render/dom/phone-list-dom';
import { BACK_LIMIT, listData, listStart, listWord, popTrail, pushTrail } from '../../src/view/phone-list';
import { relationsFor } from '../../src/view/relation-cache';
import { lineWords, successionDrawn } from '../../src/view/succession-view';
import { buildPhoneList, type PhoneListSpec } from '../../src/render/dom/phone-list-dom';
import { PHONE_LIST_UI, SUCCESSION_UI } from '../../src/render/ui-text';
import { FEl, resetDom } from '../acceptance/fake-dom';
import { resetObsidian, setIcon } from '../acceptance/fake-obsidian';
import { genPeople, peopleYaml, pick, q, rng, type GenPerson } from '../support/r028-advb-gen';
import { accName } from '../acceptance/accessible-name';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.8 adversarial round, target X6 (an internal note section 3): the phone list on the fake DOM. Written from spec
 * §5.5 (D144), §13.21 rules 37 and 38 and D173. It tests the LOGIC only: which rows, their order, the start person,
 * the "You" row, the relation and succession words, the sobriquet as one part, the accessible names and "no throw".
 * Not the markup details or the sizes: the phone list gets a new look (D198).
 *
 * Seeds are fixed; every failure message prints the seed. Deep mode: R028_DEEP=1.
 */

const DEEP = process.env.R028_DEEP === '1';
// A test takes at most 30 s, also in deep mode (an internal note section 2); the normal run takes a few seconds.
vi.setConfig({ testTimeout: 30_000 });
const N = DEEP ? 4 : 1;

useFakeDom({ css: true });
afterAll(() => {
	delete (globalThis as Record<string, unknown>).CSS;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
});

// ---------------------------------------------------------------------------------------------------------
// Trees

interface Tree {
	seed: number;
	people: GenPerson[];
	unions: [string, string][];
	src: string;
	g: FamilyGraph;
}

/** The partner of `centre` in a side link that names both partners of a listed union (D214), or null. The side link is a group of one type, minus the two parents that place the person. */
function sideUnionPartner(p: GenPerson, centre: string, unions: [string, string][]): string | null {
	const kind = (x: { type?: string }) => (x.type === 'adoptive' || x.type === 'ward' || x.type === 'rumoured' ? x.type : 'birth');
	const placed = placementOf(p);
	const placeKind = placed.length ? kind(p.parents.find((x) => x.id === placed[0])!) : null;
	for (const k of ['birth', 'adoptive', 'ward', 'rumoured']) {
		const ids = p.parents.filter((x) => kind(x) === k).map((x) => x.id);
		const rest = k === placeKind ? ids.slice(2) : ids;
		if (rest.length !== 2 || !rest.includes(centre)) continue;
		const other = rest[0] === centre ? rest[1] : rest[0];
		if (unions.some(([a, b]) => (a === centre && b === other) || (a === other && b === centre))) return other;
	}
	return null;
}

/** Parents of the type that places a person (spec §4.3: birth, else adoptive, else ward), at most two. */
function placementOf(p: GenPerson): string[] {
	const kind = (x: { type?: string }) => (x.type === 'adoptive' || x.type === 'ward' || x.type === 'rumoured' ? x.type : 'birth');
	// The `placement` key names the type, when the person has parents of that type.
	if (p.placement && p.parents.some((x) => kind(x) === p.placement)) return p.parents.filter((x) => kind(x) === p.placement).map((x) => x.id).slice(0, 2);
	for (const t of ['birth', 'adoptive', 'ward']) {
		const ps = p.parents.filter((x) => kind(x) === t).map((x) => x.id);
		if (ps.length) return ps.slice(0, 2);
	}
	return [];
}

function makeTree(seed: number, o: { n?: number; names?: 'plain' | 'odd'; sobriquets?: boolean; withTitle?: boolean } = {}): Tree | null {
	const rand = rng(seed);
	const people = genPeople(rand, { n: o.n ?? 6 + Math.floor(rand() * 26), oddParents: true, dates: true, twoParents: 0.55, names: o.names ?? 'plain' });
	const unions: [string, string][] = [];
	const has = (a: string, b: string) => unions.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
	// A child who has birth and adoptive parents may stand under the adoptive ones (`placement: adoptive`, spec §4.3).
	for (const p of people) {
		if (p.parents.some((x) => x.type === 'adoptive') && p.parents.some((x) => x.type === undefined || x.type === 'foster') && rand() < 0.5) p.placement = 'adoptive';
	}
	for (const p of people) {
		const pp = placementOf(p);
		if (pp.length === 2 && !has(pp[0], pp[1])) unions.push([pp[0], pp[1]]);
	}
	// A second union of one pair: the children keep the last-listed union (spec §4.3), the partner shows once.
	if (unions.length && rand() < 0.4) unions.splice(Math.floor(rand() * (unions.length + 1)), 0, [...pick(rand, unions)] as [string, string]);
	// A few partnerships without children, in the middle of the list.
	for (let k = 0; k < 3; k++) {
		const a = pick(rand, people).id;
		const b = pick(rand, people).id;
		if (a !== b && !has(a, b) && rand() < 0.5) unions.splice(Math.floor(rand() * (unions.length + 1)), 0, [a, b]);
	}
	if (o.sobriquets) for (const p of people) if (rand() < 0.4) p.sobriquet = pick(rand, ['the Bold', '“the Wise”', '  spaced   out ', '"straight"', 'a “b” c', 'Zoë 😀', 'الشجاع', '', '   ', 'x'.repeat(80)]);
	let src = peopleYaml(people);
	if (unions.length) src += `unions:\n${unions.map(([a, b]) => `  - {partners: [${a}, ${b}]}`).join('\n')}\n`;
	void o.withTitle;
	const r = parseDynasty(src);
	if (!r.ok) return null;
	return { seed, people, unions, src, g: deriveFamilies(r.tree) };
}

// ---------------------------------------------------------------------------------------------------------
// The list, built as the tree view builds it

interface Facts {
	session?: string | null;
	pin?: string;
	me?: string | null;
	edited?: string | null;
	showRelations?: boolean;
	showDates?: boolean;
	editable?: boolean;
	succession?: { titleId: string } | null;
}
interface Built {
	list: FEl;
	centre: string;
	from: string;
	rows: number;
	closed: number;
	spec: PhoneListSpec;
}

function render(t: { g: FamilyGraph }, f: Facts = {}): Built {
	const g = t.g;
	const me = f.me !== undefined && f.me !== null && g.byId.has(f.me) ? f.me : null;
	const start = listStart({ session: f.session, pin: f.pin, me, edited: f.edited ?? null, g });
	const centre = start?.id ?? g.people[0].id;
	const showRelations = f.showRelations ?? true;
	const rel = me !== null && showRelations ? relationsFor(g, me) : null;
	const drawn = f.succession ? successionDrawn(g, f.succession.titleId, { limit: 5, oldAge: 110, youngDeathAge: 0 }) : null;
	const words = drawn ? lineWords(drawn) : null;
	const labels = needsLabels(g) ? cardLabels(g) : undefined;
	const parent = new FEl('div', { cls: 'dynasty-viewport' });
	let closed = 0;
	const spec: PhoneListSpec = {
		g,
		data: listData(g, centre),
		me,
		showDates: f.showDates ?? true,
		editable: f.editable ?? true,
		word: (id): ListWord | null => words?.get(id) ?? listWord(id, { me, showRelations, cards: rel?.cards }),
		...(drawn ? { bar: { sentence: drawn.sentence, closeLabel: SUCCESSION_UI.barCloseLabel, onClose: () => void closed++ } } : {}),
		...(labels ? { labels } : {}),
		icon: setIcon as unknown as PhoneListSpec['icon'],
		onGo: () => undefined,
		onEdit: () => undefined,
	};
	const res = buildPhoneList(parent as unknown as HTMLElement, spec);
	const out: Built = { list: res.list as unknown as FEl, centre, from: start?.from ?? 'first', rows: res.rows, closed: 0, spec };
	Object.defineProperty(out, 'closed', { get: () => closed });
	return out;
}

const rowsIn = (list: FEl, section: string): string[] => list.querySelectorAll(`.dynasty-list-section[data-section="${section}"] .dynasty-list-row`).map((r) => r.getAttribute('data-person')!);

/** A flat text copy of a built list: tags, classes, attributes and text, for "the same DOM". */
function serial(el: FEl): string {
	return `${el.tag}[${[...el.classes].sort().join(' ')}][${[...el.attrs.entries()].sort().map(([k, v]) => `${k}=${v}`).join(';')}]${JSON.stringify(el.text)}(${el.children.map(serial).join(',')})`;
}

// ---------------------------------------------------------------------------------------------------------
// (2) the start person, §5.5

describe('X6 (2) the start person follows the §5.5 order', () => {
	/** Spec §5.5 rule 5: the smallest generation (§5.1), the earliest birth year (§13.21 rule 5), the document order. */
	function oldestRef(t: Tree): string | null {
		const gens = computeGenerations(t.g);
		const hasChild = new Set<string>();
		for (const p of t.people) for (const id of placementOf(p)) hasChild.add(id);
		let best: { id: string; gen: number; year: number; i: number } | null = null;
		t.people.forEach((p, i) => {
			if (!hasChild.has(p.id)) return;
			const parsed = t.g.byId.get(p.id)!;
			const m = parsed.born === undefined ? null : /^\s*-?\d+\s*$/.test(parsed.born) ? Number(parsed.born) : (/(?:^|\D)(\d{3,4})(?!\d)/.exec(parsed.born)?.[1] ?? null);
			const year = m === null ? Infinity : Number(m);
			const cur = { id: p.id, gen: gens.get(p.id) ?? 0, year, i };
			if (!best || cur.gen < best.gen || (cur.gen === best.gen && cur.year < best.year)) best = cur;
		});
		return best ? (best as { id: string }).id : null;
	}

	it('session, pin, mark, last edit, oldest parent, first root; a missing id is skipped on each rung', () => {
		let tried = 0;
		for (let seed = 100; seed < 100 + 150 * N; seed++) {
			const t = makeTree(seed);
			if (!t) continue;
			const rand = rng(seed + 9);
			const ids = t.people.map((p) => p.id);
			const maybe = (): string | undefined => (rand() < 0.4 ? undefined : rand() < 0.2 ? 'ghost' : pick(rand, ids));
			const session = maybe();
			const pin = maybe();
			const me = maybe();
			const edited = maybe();
			const valid = (x: string | undefined) => x !== undefined && ids.includes(x);
			// Only the dates texts of the generator without cycles are used, so the oracle is the plain reading of §5.5.
			let want: { id: string; from: string };
			if (valid(session)) want = { id: session!, from: 'session' };
			else if (valid(pin)) want = { id: pin!, from: 'pin' };
			else if (valid(me)) want = { id: me!, from: 'me' };
			else if (valid(edited)) want = { id: edited!, from: 'edited' };
			else {
				const old = oldestRef(t);
				if (old) want = { id: old, from: 'oldest' };
				else want = { id: t.people.find((p) => placementOf(p).length === 0)?.id ?? t.people[0].id, from: 'first' };
			}
			const b = render(t, { session: session ?? null, pin, me: me ?? null, edited: edited ?? null });
			expect({ id: b.centre, from: b.from }, `seed ${seed} session=${session} pin=${pin} me=${me} edited=${edited}\n${t.src}`).toEqual(want);
			expect(b.list.getAttribute('aria-label'), `seed ${seed}`).toBe(PHONE_LIST_UI.region(t.g.byId.get(b.centre)!.name));
			tried++;
		}
		expect(tried).toBeGreaterThan(100);
	});

	it('options.start is not part of the order (D144), and a save of another person does not move the list when a rung 1 to 3 applies', () => {
		for (let seed = 400; seed < 400 + 100 * N; seed++) {
			const t = makeTree(seed);
			if (!t) continue;
			const rand = rng(seed);
			const ids = t.people.map((p) => p.id);
			const pinned = pick(rand, ids);
			const a = render(t, { pin: pinned, edited: pick(rand, ids) });
			const b = render(t, { pin: pinned, edited: pick(rand, ids) });
			expect(a.centre, `seed ${seed}`).toBe(pinned);
			expect(b.centre, `seed ${seed}`).toBe(pinned);
			const withStart = parseDynasty(`${t.src}options:\n  start: ${pick(rand, ids)}\n`);
			if (withStart.ok) {
				const g2 = deriveFamilies(withStart.tree);
				expect(render({ g: g2 }).centre, `seed ${seed}: options.start moved the list`).toBe(render(t).centre);
			}
		}
	});
});

// ---------------------------------------------------------------------------------------------------------
// (1) the rows

describe('X6 (1) the rows are the start person’s parents, partners and children, in the order of §5.5', () => {
	it('sections, order, groups and headings on random trees', () => {
		let checked = 0;
		let withGroups = 0;
		for (let seed = 1000; seed < 1000 + 200 * N; seed++) {
			const t = makeTree(seed);
			if (!t) continue;
			const rand = rng(seed + 1);
			const centre = pick(rand, t.people).id;
			const showDates = rand() < 0.5;
			const b = render(t, { session: centre, showDates });
			const msg = (m: string) => `seed ${seed} centre ${centre}: ${m}\n${t.src}`;
			const byId = new Map(t.people.map((p) => [p.id, p]));
			const me = byId.get(centre)!;

			// Parents: the placement parents first, then the parents of every other link, each once (note order inside the first part).
			const place = placementOf(me);
			const side = me.parents.map((x) => x.id).filter((id) => !place.includes(id));
			const wantParents = [...place, ...side.filter((id, i) => side.indexOf(id) === i)];
			const gotParents = rowsIn(b.list, 'parents');
			expect(gotParents.slice(0, place.length), msg('placement parents first')).toEqual(place);
			expect([...gotParents].sort(), msg('all parents once')).toEqual([...wantParents].sort());
			expect(new Set(gotParents).size, msg('a parent twice')).toBe(gotParents.length);

			// The start person and each partner once, in the order of the unions.
			const partners: string[] = [];
			for (const [a, c] of t.unions) {
				const other = a === centre ? c : c === centre ? a : null;
				if (other !== null && !partners.includes(other)) partners.push(other);
			}
			expect(rowsIn(b.list, 'person'), msg('person section')).toEqual([centre]);
			expect(rowsIn(b.list, 'partners'), msg('partners section')).toEqual(partners);
			expect(b.list.querySelector('.dynasty-list-section[data-section="partners"]') !== null, msg('partners section only with partners')).toBe(partners.length > 0);
			// D209 item 2: the sections follow the order person, parents, partners, children.
			const order = b.list.querySelectorAll('.dynasty-list-section').map((s) => s.getAttribute('data-section'));
			expect(order, msg('section order')).toEqual(['person', 'parents', 'partners', 'children'].filter((s) => order.includes(s)));

			// Children: by partnership in the order of the unions, then the ones with one parent, then the side links. A child shows once.
			const shown = new Set<string>([centre]);
			const groups: { head: string | null; ids: string[] }[] = [];
			const lastOf = (a: string, c: string) => t.unions.reduce((k, [x, y], i) => ((x === a && y === c) || (x === c && y === a) ? i : k), -1);
			const unionOrder: string[] = [];
			t.unions.forEach(([a, c], i) => {
				const other = a === centre ? c : c === centre ? a : null;
				if (other !== null && lastOf(a, c) === i) unionOrder.push(other);
			});
			for (const pid of unionOrder) {
				const ids = t.people.filter((p) => {
					const pl = placementOf(p);
					return pl.length === 2 && pl.includes(centre) && pl.includes(pid) && !shown.has(p.id);
				}).map((p) => p.id);
				ids.forEach((id) => shown.add(id));
				// D214: a child that a side link of both partners names stands in the partnership too, after the placed children.
				const sides = t.people.filter((p) => !shown.has(p.id) && sideUnionPartner(p, centre, t.unions) === pid).map((p) => p.id);
				sides.forEach((id) => shown.add(id));
				ids.push(...sides);
				if (ids.length) groups.push({ head: PHONE_LIST_UI.withPartner(byId.get(pid)!.name), ids });
			}
			const solo = t.people.filter((p) => {
				const pl = placementOf(p);
				return pl.length === 1 && pl[0] === centre && !shown.has(p.id);
			}).map((p) => p.id);
			solo.forEach((id) => shown.add(id));
			if (solo.length) groups.push({ head: partners.length ? PHONE_LIST_UI.noPartner : null, ids: solo });
			const other = t.people.filter((p) => !shown.has(p.id) && p.parents.some((x) => x.id === centre) && !placementOf(p).includes(centre)).map((p) => p.id);

			// Read the built list back: sub-headings and rows in document order.
			const children = b.list.querySelector('.dynasty-list-section[data-section="children"]');
			const got: { head: string | null; ids: string[] }[] = [];
			if (children) {
				let cur: { head: string | null; ids: string[] } | null = null;
				for (const c of children.children) {
					if (c.classes.has('dynasty-list-sub')) {
						cur = { head: c.getText(), ids: [] };
						got.push(cur);
					} else if (c.classes.has('dynasty-list-row')) {
						if (!cur) got.push((cur = { head: null, ids: [] }));
						cur.ids.push(c.getAttribute('data-person')!);
					}
				}
			}
			// D209 item 7: a group heading shows only when there is more than one group.
			const total = groups.length + (other.length ? 1 : 0);
			if (total === 1) {
				const only = groups[0] ?? { head: null, ids: [] };
				expect(got.map((x) => x.head), msg('one group, no heading')).toEqual([null]);
				expect([...got[0].ids].sort(), msg('the one group')).toEqual([...(groups.length ? only.ids : other)].sort());
			} else {
				const gotOther = got.find((x) => x.head === PHONE_LIST_UI.otherChildren);
				expect(got.filter((x) => x !== gotOther), msg('children groups')).toEqual(groups);
				expect([...(gotOther?.ids ?? [])].sort(), msg('other children')).toEqual([...other].sort());
				if (!other.length) expect(gotOther, msg('other children heading')).toBeUndefined();
			}
			// The row count of the result.
			expect(b.rows, msg('row count')).toBe(b.list.querySelectorAll('.dynasty-list-row').length);
			// A child shows once.
			const childRows = rowsIn(b.list, 'children');
			expect(new Set(childRows).size, msg('a child twice')).toBe(childRows.length);
			if (groups.length) withGroups++;
			checked++;
		}
		expect(checked).toBeGreaterThan(100);
		expect(withGroups, 'trees with children').toBeGreaterThan(50);
	});

	it('the heading of the person section: "You" for the marked person, else "This person"; no section "Parents" without parents', () => {
		for (let seed = 1500; seed < 1500 + 100 * N; seed++) {
			const t = makeTree(seed);
			if (!t) continue;
			const rand = rng(seed);
			const centre = pick(rand, t.people).id;
			const marked = render(t, { session: centre, me: centre });
			expect(marked.list.querySelector('.dynasty-list-section[data-section="person"] .dynasty-list-head')!.getText(), `seed ${seed}`).toBe(PHONE_LIST_UI.headYou);
			const other = render(t, { session: centre, me: null });
			expect(other.list.querySelector('.dynasty-list-section[data-section="person"] .dynasty-list-head')!.getText(), `seed ${seed}`).toBe(PHONE_LIST_UI.headPerson);
			const hasParents = t.people.find((p) => p.id === centre)!.parents.length > 0;
			expect(other.list.querySelector('.dynasty-list-section[data-section="parents"]') !== null, `seed ${seed}`).toBe(hasParents);
		}
	});
});

// ---------------------------------------------------------------------------------------------------------
// (3) the "You" row and the relation words

describe('X6 (3) one "You" row when a mark exists; the relation words', () => {
	it('the marked person says "You" wherever the row stands; no other row says it; no mark, no word', () => {
		let marked = 0;
		for (let seed = 2000; seed < 2000 + 140 * N; seed++) {
			const t = makeTree(seed);
			if (!t) continue;
			const rand = rng(seed + 3);
			const ids = t.people.map((p) => p.id);
			const me = pick(rand, ids);
			const centre = rand() < 0.5 ? me : pick(rand, ids);
			for (const showRelations of [true, false]) {
				const b = render(t, { session: centre, me, showRelations });
				const rows = b.list.querySelectorAll('.dynasty-list-row');
				const mine = rows.filter((r) => r.getAttribute('data-person') === me);
				const flagged = rows.filter((r) => r.classes.has('dynasty-list-me'));
				const label = `seed ${seed} me ${me} centre ${centre} relations ${showRelations}`;
				// The class of the marked row is on exactly the rows of the marked person.
				expect(flagged.map((r) => r.getAttribute('data-person')), label).toEqual(mine.map(() => me));
				if (me === centre) expect(mine, label).toHaveLength(1);
				for (const r of rows) {
					const word = r.querySelector('.dynasty-list-word')?.getText();
					const id = r.getAttribute('data-person')!;
					if (id === me) expect(word, `${label}: row ${id}`).toBe(PHONE_LIST_UI.you);
					else if (!showRelations) expect(word, `${label}: row ${id} (relation names off)`).toBeUndefined();
					else expect(word === PHONE_LIST_UI.you, `${label}: row ${id} says You`).toBe(false);
				}
				if (mine.length) marked++;
			}
			// No mark: no row has a word, no row is marked.
			const none = render(t, { session: centre, me: null });
			expect(none.list.querySelectorAll('.dynasty-list-word'), `seed ${seed}: words without a mark`).toHaveLength(0);
			expect(none.list.querySelectorAll('.dynasty-list-me'), `seed ${seed}: marked rows without a mark`).toHaveLength(0);
		}
		expect(marked).toBeGreaterThan(100);
	});

	it('the relation word of a row is the word of the card (the relation cache) when the setting is on', () => {
		for (let seed = 2500; seed < 2500 + 70 * N; seed++) {
			const t = makeTree(seed);
			if (!t) continue;
			const rand = rng(seed);
			const me = pick(rand, t.people).id;
			const rel = relationsFor(t.g, me);
			const b = render(t, { session: me, me });
			for (const r of b.list.querySelectorAll('.dynasty-list-row')) {
				const id = r.getAttribute('data-person')!;
				if (id === me) continue;
				const word = r.querySelector('.dynasty-list-word')?.getText();
				expect(word, `seed ${seed} row ${id}`).toBe(rel.cards.get(id)?.text);
			}
		}
	});
});

// ---------------------------------------------------------------------------------------------------------
// (4) accessible names, (7) no throw with odd names

describe('X6 (4) every control has an accessible name; (7) no throw with huge or odd names', () => {
	it('every button is a plain button with a name that holds the person’s name; the roles', () => {
		for (let seed = 3000; seed < 3000 + 120 * N; seed++) {
			const t = makeTree(seed, { names: 'odd', sobriquets: true });
			if (!t) continue;
			const rand = rng(seed);
			const me = rand() < 0.6 ? pick(rand, t.people).id : null;
			const b = render(t, { session: pick(rand, t.people).id, me, showDates: rand() < 0.5, editable: rand() < 0.8 });
			const label = `seed ${seed}`;
			expect(b.list.getAttribute('role'), label).toBe('region');
			expect(b.list.getAttribute('aria-label'), label).toBeTruthy();
			for (const btn of b.list.querySelectorAll('button')) {
				expect(btn.getAttribute('type'), label).toBe('button');
				expect(accName(btn), `${label}: a button with no name`).not.toBe('');
				expect(btn.getAttribute('aria-label'), `${label}: an aria-label gives a tooltip`).toBeNull();
			}
			for (const r of b.list.querySelectorAll('.dynasty-list-row')) {
				expect(r.getAttribute('role'), label).toBe('group');
				const id = r.getAttribute('data-person')!;
				const names = r.querySelectorAll('button').map((x) => accName(x));
				expect(names.length, `${label}: row ${id} has one or two buttons`).toBeGreaterThanOrEqual(1);
				expect(names.length, label).toBeLessThanOrEqual(2);
				const display = r.querySelector('.dynasty-list-name')!;
				// The accessible name holds the name the row shows, without the sobriquet (D127).
				const plain = display.getText().replace(/ “[^”]*”$/, '');
				for (const n of names) expect(n.includes(plain) || n.includes(t.g.byId.get(id)!.name), `${label}: name of row ${id}: ${n}`).toBe(true);
			}
			for (const h of b.list.querySelectorAll('.dynasty-list-head, .dynasty-list-sub')) {
				expect(h.getAttribute('role'), label).toBe('heading');
				expect(h.getText().trim(), `${label}: an empty heading`).not.toBe('');
			}
		}
	});

	it('a read-only tree hides every pencil and makes the centre button inert; the rows still move the list', () => {
		for (let seed = 3500; seed < 3500 + 60; seed++) {
			const t = makeTree(seed);
			if (!t) continue;
			const b = render(t, { editable: false });
			expect(b.list.hasClass('is-read-only'), `seed ${seed}`).toBe(true);
			for (const e of b.list.querySelectorAll('.dynasty-list-edit')) {
				if (e.hasClass('dynasty-list-whole')) expect(e.disabled, `seed ${seed}`).toBe(true);
				else expect(e.hidden, `seed ${seed}`).toBe(true);
			}
			for (const go of b.list.querySelectorAll('.dynasty-list-go')) expect(go.disabled, `seed ${seed}`).toBe(false);
		}
	});

	it('odd names: right to left, Chinese, emoji, zero-width, 2 000 characters, markup characters, no name text lost', () => {
		const odd = ['محمد بن علي', 'דוד המלך', '李小龍', '山田太郎', 'Ёлка Палкина', 'Σωκράτης', 'Zoë 😀👨‍👩‍👧', 'a​b​c', 'x'.repeat(2000), '<b>bold</b> & "quote"', '[[Link|Alias]]', '#tag', 'Ann: B', '- dash', "O'Neil", 'Ź̂ combining'];
		const people: GenPerson[] = odd.map((name, i) => ({ id: `p${i}`, name, parents: i === 0 ? [] : [{ id: 'p0' }], sex: i % 2 ? 'f' : 'm', born: String(1000 + i), sobriquet: i % 3 === 0 ? odd[(i + 5) % odd.length] : undefined }));
		const src = peopleYaml(people);
		const parsed = parseDynasty(src);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const g = deriveFamilies(parsed.tree);
		const b = render({ g }, { session: 'p0', me: 'p3' });
		expect(b.rows).toBe(odd.length);
		for (const [i, name] of odd.entries()) {
			const row = b.list.querySelector(`.dynasty-list-row[data-person="p${i}"]`)!;
			expect(row.querySelector('.dynasty-list-name')!.getText().startsWith(name), `row ${i}`).toBe(true);
			for (const btn of row.querySelectorAll('button')) expect(accName(btn), `row ${i}`).toContain(name);
		}
	});
});

// ---------------------------------------------------------------------------------------------------------
// (6) the sobriquet

describe('X6 (6) the sobriquet is one whole part (D122, D173)', () => {
	/** The text of a sobriquet as §4.1 says: white space runs become one space, one pair of double marks around the text is taken off. */
	function sobRef(raw: string | undefined): string | undefined {
		if (raw === undefined) return undefined;
		let t = raw.replace(/\s+/g, ' ').trim();
		if ((t.startsWith('“') || t.startsWith('„')) && t.endsWith('”')) t = t.slice(1, -1).trim();
		else if (t.length >= 2 && t.startsWith('"') && t.endsWith('"') && !/["“”„]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
		return t === '' ? undefined : t;
	}

	it('one span with the whole sobriquet in curly marks, after the name and a space that stands outside the span', () => {
		let withSob = 0;
		for (let seed = 4000; seed < 4000 + 120 * N; seed++) {
			const t = makeTree(seed, { names: 'odd', sobriquets: true });
			if (!t) continue;
			const rand = rng(seed);
			const b = render(t, { session: pick(rand, t.people).id, me: pick(rand, t.people).id });
			for (const r of b.list.querySelectorAll('.dynasty-list-row')) {
				const id = r.getAttribute('data-person')!;
				const raw = t.people.find((p) => p.id === id)!.sobriquet;
				const want = sobRef(raw);
				const name = r.querySelector('.dynasty-list-name')!;
				const spans = name.querySelectorAll('.dynasty-list-sob');
				const label = `seed ${seed} row ${id} sobriquet ${JSON.stringify(raw)}`;
				if (want === undefined) {
					expect(spans, label).toHaveLength(0);
					continue;
				}
				withSob++;
				expect(spans, label).toHaveLength(1);
				expect(spans[0].getText(), label).toBe(`“${want}”`);
				// The space between the name and the sobriquet is the only place for a line break: it stands in the name, not in the span.
				expect(name.text.endsWith(' '), `${label}: the space is outside the span`).toBe(true);
				expect(name.text.trim(), `${label}: the name`).not.toBe('');
				expect(name.children.filter((c) => c.classes.has('dynasty-list-sob')), label).toHaveLength(1);
			}
		}
		expect(withSob).toBeGreaterThan(100);
	});
});

// ---------------------------------------------------------------------------------------------------------
// (5) the Show view

/** Spec §13.21 rule 36: "1st", "2nd", "3rd", "4th" … "11th", "12th", "13th" … "21st". */
function ordinalRef(n: number): string {
	const t = n % 100;
	const s = t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
	return `${n}${s}`;
}

describe('X6 (5) "1st in line", "2nd in line", "Open branch" while the Show view is open; the relation words come back after Close', () => {
	/** A tree with one title: a ruler with a rule; some people dead. */
	function lineTree(seed: number): { t: Tree; titleId: string } | null {
		const t = makeTree(seed, { n: 10 + (seed % 25) });
		if (!t) return null;
		const rand = rng(seed + 55);
		// A ruler with descendants.
		const hasChild = new Set<string>();
		for (const p of t.people) for (const id of placementOf(p)) hasChild.add(id);
		const rulers = t.people.filter((p) => hasChild.has(p.id));
		if (!rulers.length) return null;
		const ruler = pick(rand, rulers).id;
		const rule = pick(rand, ['eldest-child', 'siblings-first', 'nearest-relative', 'youngest-child']);
		const src = `${t.src}titles:\n  - id: crown\n    name: ${q('The Crown')}\n    succession: ${rule}\n    inherit: ${pick(rand, ['no-preference', 'men-first', 'men-first-in-house'])}\n    holders:\n      - {person: ${ruler}, from: 1}\n`;
		const parsed = parseDynasty(src);
		if (!parsed.ok) return null;
		return { t: { ...t, src, g: deriveFamilies(parsed.tree) }, titleId: 'crown' };
	}

	it('each heir with a row says "Nth in line" in place of the relation word (also in place of "You"); a branch says "Open branch"; the others keep their word', () => {
		let heirRows = 0;
		let branchRows = 0;
		for (let seed = 5000; seed < 5000 + 150 * N; seed++) {
			const c = lineTree(seed);
			if (!c) continue;
			const { t, titleId } = c;
			const rand = rng(seed);
			const ids = t.people.map((p) => p.id);
			const me = rand() < 0.7 ? pick(rand, ids) : null;
			const drawn = successionDrawn(t.g, titleId, { limit: 5, oldAge: 110, youngDeathAge: 0 });
			if (!drawn) continue;
			// Centre on the ruler, so that heirs and branches have rows.
			const centre = rand() < 0.5 ? drawn.ruler : (drawn.heirs[0] ?? drawn.ruler);
			const before = render(t, { session: centre, me });
			const open = render(t, { session: centre, me, succession: { titleId } });
			const label = `seed ${seed} centre ${centre} me ${me}`;
			// The bar: a sentence and an icon-only Close with a name.
			const bar = open.list.querySelector('.dynasty-succession-bar');
			expect(bar, label).not.toBeNull();
			expect(bar!.querySelector('.dynasty-succession-text')!.getText(), label).toBe(drawn.sentence);
			const close = bar!.querySelector('button')!;
			expect(close.getAttribute('aria-label'), label).toBe(SUCCESSION_UI.barCloseLabel);
			expect(before.list.querySelector('.dynasty-succession-bar'), `${label}: bar before`).toBeNull();
			// The rows keep their number and their order.
			expect(open.rows, label).toBe(before.rows);
			expect(open.list.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person')), label).toEqual(before.list.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person')));
			for (const r of open.list.querySelectorAll('.dynasty-list-row')) {
				const id = r.getAttribute('data-person')!;
				const word = r.querySelector('.dynasty-list-word')?.getText();
				const heirAt = drawn.heirs.indexOf(id);
				if (heirAt >= 0) {
					expect(word, `${label}: heir ${id}`).toBe(`${ordinalRef(heirAt + 1)} in line`);
					heirRows++;
				} else if (drawn.branches.includes(id)) {
					expect(word, `${label}: branch ${id}`).toBe('Open branch');
					branchRows++;
				} else {
					expect(word, `${label}: other row ${id}`).toBe(before.list.querySelector(`.dynasty-list-row[data-person="${id}"] .dynasty-list-word`)?.getText());
				}
				// The accessible name of the row speaks the place.
				if (heirAt >= 0) for (const b of r.querySelectorAll('.dynasty-list-go')) expect(accName(b), label).toContain(`${ordinalRef(heirAt + 1).toLowerCase()} in line`);
			}
			// Close: the bar goes, the list is as before, with the relation words.
			const again = render(t, { session: centre, me });
			expect(serial(again.list), `${label}: after Close`).toBe(serial(before.list));
			close.listeners.get('click')?.[0]?.fn({ type: 'click' } as never);
			expect(open.closed, `${label}: Close calls the handler`).toBe(1);
		}
		expect(heirRows, 'heir rows reached').toBeGreaterThan(30);
		expect(branchRows, 'branch rows reached').toBeGreaterThan(5);
	});

	it('the ordinals run 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st in the words', () => {
		const words = new Map<string, ListWord>();
		for (let n = 1; n <= 30; n++) words.set(`x${n}`, { text: SUCCESSION_UI.inLine(ordinalRef(n)), lower: ordinalRef(n) });
		expect([...words.values()].map((w) => w.text).slice(0, 4)).toEqual(['1st in line', '2nd in line', '3rd in line', '4th in line']);
		expect(words.get('x11')!.text).toBe('11th in line');
		expect(words.get('x12')!.text).toBe('12th in line');
		expect(words.get('x13')!.text).toBe('13th in line');
		expect(words.get('x21')!.text).toBe('21st in line');
		expect(words.get('x22')!.text).toBe('22nd in line');
	});
});

// ---------------------------------------------------------------------------------------------------------
// Determinism and no change of the model

describe('X6 (7) no throw on trees with cycles, self-parents, unknown ids and odd partnerships', () => {
	it('every row names a person of the tree; a person shows once as a child; the result matches the rows', () => {
		let built = 0;
		for (let seed = 7000; seed < 7000 + 150 * N; seed++) {
			const rand = rng(seed);
			const people = genPeople(rand, { n: 4 + Math.floor(rand() * 20), oddParents: true, dates: true, twoParents: 0.6, cycles: true, oddSex: true, names: 'odd' });
			const ids = people.map((p) => p.id);
			// Dangling parents and unions that name nobody, three-person unions, a union of one person with themselves.
			for (const p of people) if (rand() < 0.1) p.parents.push({ id: 'ghost' });
			const unions: string[] = [];
			for (let k = 0; k < 2 + Math.floor(rand() * 6); k++) {
				const n = pick(rand, [1, 2, 2, 2, 3]);
				const ps: string[] = [];
				for (let i = 0; i < n; i++) ps.push(rand() < 0.1 ? 'ghost' : pick(rand, ids));
				unions.push(`  - {partners: [${ps.join(', ')}]${rand() < 0.3 ? ', type: ' + pick(rand, ['affair', 'betrothal', 'concubinage', 'banana']) : ''}}`);
			}
			const src = `${peopleYaml(people)}unions:\n${unions.join('\n')}\n${rand() < 0.3 ? `options:\n  me: ${pick(rand, ids)}\n  focus: ${pick(rand, [...ids, 'ghost'])}\n` : ''}`;
			const parsed = parseDynasty(src);
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			for (const centre of [ids[0], pick(rand, ids)]) {
				let b: Built;
				try {
					b = render({ g }, { session: centre, me: parsed.tree.options.me ?? null, pin: parsed.tree.options.focus });
				} catch (e) {
					throw new Error(`seed ${seed} centre ${centre}: threw ${String(e)}\n${src}`);
				}
				const rows = b.list.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person')!);
				for (const id of rows) expect(g.byId.has(id), `seed ${seed}: row ${id} is not in the tree\n${src}`).toBe(true);
				expect(b.rows, `seed ${seed}`).toBe(rows.length);
				const kids = rowsIn(b.list, 'children');
				expect(new Set(kids).size, `seed ${seed}: a child twice\n${src}`).toBe(kids.length);
				expect(rowsIn(b.list, 'person')[0], `seed ${seed}: the centre first`).toBe(b.centre);
				built++;
			}
		}
		expect(built).toBeGreaterThan(100);
	});
});

describe('X6 the Back trail keeps at most 20 people, the newest last, and skips people who are gone (spec §5.5)', () => {
	it('pushTrail drops the oldest after 20; popTrail gives the newest person still in the tree and the trail without the missing ones', () => {
		const rand = rng(77);
		let trail: string[] | undefined;
		const all: string[] = [];
		for (let i = 0; i < 60; i++) {
			const id = `p${Math.floor(rand() * 30)}`;
			const before = trail ? [...trail] : undefined;
			trail = pushTrail(trail, id);
			all.push(id);
			expect(trail.length, `step ${i}`).toBeLessThanOrEqual(BACK_LIMIT);
			expect(trail, `step ${i}`).toEqual(all.slice(-BACK_LIMIT));
			expect(before === undefined || before.every((x, j) => x === (before as string[])[j]), 'the old trail is not changed').toBe(true);
		}
		const gone = new Set(['p1', 'p2', 'p3', 'p4', 'p5']);
		const has = (id: string) => !gone.has(id);
		const out = popTrail(trail, has);
		const want = [...trail!].reverse().find(has);
		if (want === undefined) expect(out).toBeNull();
		else {
			expect(out!.id).toBe(want);
			expect(out!.rest).toEqual(trail!.slice(0, trail!.lastIndexOf(want)).filter(has));
		}
		expect(popTrail(undefined, has)).toBeNull();
		expect(popTrail([], has)).toBeNull();
		expect(popTrail(['p1', 'p2'], has)).toBeNull();
	});
});

describe('X6 the same input gives the same list; the build changes nothing', () => {
	it('two builds of one input are equal, and the model is not changed', () => {
		for (let seed = 6000; seed < 6000 + 50 * N; seed++) {
			const t = makeTree(seed, { names: 'odd', sobriquets: true });
			if (!t) continue;
			const before = JSON.stringify(t.g.people);
			const rand = rng(seed);
			const f: Facts = { session: pick(rand, t.people).id, me: pick(rand, t.people).id, showDates: rand() < 0.5, showRelations: rand() < 0.5 };
			expect(serial(render(t, f).list), `seed ${seed}`).toBe(serial(render(t, f).list));
			expect(JSON.stringify(t.g.people), `seed ${seed}: the model changed`).toBe(before);
		}
	});

	it('a tree of one person and a tree with no parents or children', () => {
		const one = parseDynasty('people:\n  - {id: a, name: Alone}\n');
		expect(one.ok).toBe(true);
		if (!one.ok) return;
		const g = deriveFamilies(one.tree);
		const b = render({ g });
		expect(b.rows).toBe(1);
		expect(rowsIn(b.list, 'person')).toEqual(['a']);
		expect(b.list.querySelector('.dynasty-list-section[data-section="parents"]')).toBeNull();
		expect(b.list.querySelector('.dynasty-list-section[data-section="children"]')).toBeNull();
	});
});
