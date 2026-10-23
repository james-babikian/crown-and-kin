/*
 * 0.4, owner decision D291: the cadet-title hint (`cadetHint`, src/core/succession-hint.ts).
 *
 * Part A: the 22 hint cases of the genealogy gate (data written from the gate's case table). Each runs three times: as written,
 *   with every `house:` removed, and with the `house:` values moved. The key `house` is never read, so the three answers are equal.
 * Part B: the nearest common ancestor and the order of the children (the gate's cases B1 to B8, and the undated pairs).
 * Part C: the 58 cadet cases of tests/support/r033-cadet-data.ts. The switch never adds a person to the line, and `house` changes nothing.
 * Part D: the first holder with the switch off, and the line that the caller can reuse.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionSpec } from '../../src/core/succession';
import { firstHolderOf } from '../../src/core/succession-first';
import { cadetHint } from '../../src/core/succession-hint';
import { build as buildCadet, CASES, type HouseMode } from '../support/r033-cadet-data';

interface P {
	id: string;
	sex?: string;
	born?: number;
	died?: number;
	parents?: string[];
	extra?: string;
}
interface C {
	id: string;
	what: string;
	people: P[];
	holders: string[];
	keys?: string[];
	spec?: Partial<SuccessionSpec>;
	/** The person the hint names, or null for no hint. */
	want: string | null;
	unions?: string[];
}

const HOUSE_NAMES = ['aldmark', 'brook', 'marsh'];

function note(c: C, mode: HouseMode): string {
	const row = (p: P, i: number) => {
		const parts = ['id: ' + p.id, 'name: ' + p.id];
		if (p.sex) parts.push('sex: ' + p.sex);
		if (mode !== 'none') parts.push('house: ' + HOUSE_NAMES[(mode === 'shuffle' ? i + 1 + p.id.length : i) % 3]);
		if (p.born !== undefined) parts.push('born: "' + p.born + '"');
		if (p.died !== undefined) parts.push('died: "' + p.died + '"');
		if (p.parents?.length) parts.push('parents: [' + p.parents.join(', ') + ']');
		if (p.extra) parts.push(p.extra);
		return '  - {' + parts.join(', ') + '}';
	};
	const keys = (c.keys ?? []).map((k) => '    ' + k).join('\n');
	const unions = c.unions?.length ? '\nunions:\n' + c.unions.map((u) => '  - ' + u).join('\n') : '';
	return 'people:\n' + c.people.map(row).join('\n') + unions + '\ntitles:\n  - id: t1\n    name: T\n' + keys + (keys ? '\n' : '') + '    holders:\n' + c.holders.map((h) => '      - ' + h).join('\n') + '\n';
}

const BASE: Partial<SuccessionSpec> = { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false };

function graphOf(src: string): FamilyGraph {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	return deriveFamilies(r.tree);
}

function hintOf(c: C, mode: HouseMode): string | null {
	const g = graphOf(note(c, mode));
	const t = g.titles[0];
	return cadetHint(g, t, { ...specOf(t), ...BASE, ...c.spec })?.person ?? null;
}

const H = (id: string) => '{person: ' + id + ', from: 1200}';
const henry = { id: 'henry', sex: 'm', born: 1140, died: 1190 };
const rob = { id: 'robert', sex: 'm', born: 1170, parents: ['henry'] };
const W = { id: 'william', sex: 'm', born: 1165, parents: ['henry'] };
const J = (parents: string[], extra?: string): P => ({ id: 'john', sex: 'm', born: 1168, parents, ...(extra ? { extra } : {}) });
const NOSON = { inherit: 'men-only', inheritThrough: 'men' } as const;
const mary = { id: 'mary', sex: 'f', born: 1165, parents: ['henry'] };

const GATE: C[] = [
	{ id: 'A1', what: 'Robert is the younger son of Henry; Henry is dead and the elder brother William is alive', people: [henry, W, rob], holders: [H('robert')], want: 'william' },
	{ id: 'A2', what: 'Robert is an only child and Henry is alive', people: [{ id: 'henry', sex: 'm', born: 1140 }, rob], holders: [H('robert')], want: null },
	{ id: 'A3', what: 'Henry and William are dead; the nephew Edward is alive', people: [henry, { ...W, died: 1195 }, { id: 'edward', sex: 'm', born: 1190, parents: ['william'] }, rob], holders: [H('robert')], want: 'edward' },
	{ id: 'A4', what: 'the only sister Mary is alive; men only', people: [henry, mary, rob], holders: [H('robert')], spec: NOSON, want: null },
	{ id: 'A5', what: 'the same, no preference', people: [henry, mary, rob], holders: [H('robert')], want: 'mary' },
	{ id: 'A6', what: 'the half-brother John is alive', people: [henry, { id: 'mother2', sex: 'f', born: 1150 }, J(['henry', 'mother2']), rob], holders: [H('robert')], want: 'john' },
	{ id: 'A7', what: 'John is only the rumoured son of Henry', people: [henry, J(['{id: henry, type: rumoured}']), rob], holders: [H('robert')], want: null },
	{ id: 'A8a', what: 'John is adopted by Henry, adopted children off', people: [henry, J(['{id: henry, type: adoptive}']), rob], holders: [H('robert')], want: null },
	{ id: 'A8b', what: 'the same, adopted children on', people: [henry, J(['{id: henry, type: adoptive}']), rob], holders: [H('robert')], spec: { adopted: true }, want: 'john' },
	{ id: 'A9', what: 'John is a ward of Henry', people: [henry, J(['{id: henry, type: ward}']), rob], holders: [H('robert')], want: null },
	{ id: 'A10', what: 'a half-brother marked illegitimate, flag no', people: [henry, J(['henry'], 'illegitimate: true'), rob], holders: [H('robert')], want: null },
	{ id: 'A10b', what: 'the same, flag after', people: [henry, J(['henry'], 'illegitimate: true'), rob], holders: [H('robert')], spec: { illegitimate: 'after' }, want: 'john' },
	{ id: 'A11', what: 'the founder Alaric holds the title, no relatives', people: [{ id: 'alaric', sex: 'm', born: 1140 }, { id: 'son', sex: 'm', born: 1170, parents: ['alaric'] }], holders: [H('alaric')], want: null },
	{ id: 'A12', what: 'Duchess Matilda holds the title, her elder brother William is alive, men only', people: [henry, W, { id: 'matilda', sex: 'f', born: 1170, parents: ['henry'] }], holders: [H('matilda')], spec: NOSON, want: 'william' },
	{
		id: 'A13',
		what: 'Robert is dead, his son Charles rules; the uncle William is alive',
		people: [henry, W, { ...rob, died: 1195 }, { id: 'charles', sex: 'm', born: 1192, parents: ['robert'] }],
		holders: ['{person: robert, from: 1190, to: 1195}', '{person: charles, from: 1195}'],
		want: 'william',
	},
	{
		id: 'A14',
		what: 'an appanage reverts to William: the line of William is not of the body of Robert',
		people: [henry, W, { ...rob, died: 1195 }, { id: 'wson', sex: 'm', born: 1190, parents: ['william'] }],
		holders: ['{person: robert, from: 1190, to: 1195}', '{person: william, from: 1195}'],
		want: null,
	},
	{ id: 'A15', what: 'title year 1180: William is alive then', people: [{ ...henry, died: 1175 }, { ...W, died: 1185 }, rob], holders: ['{person: robert, from: 1170}'], keys: ['year: 1180'], spec: { year: '1180' }, want: 'william' },
	{ id: 'A16', what: 'title year 1190: William is dead in 1185 and has no children', people: [{ ...henry, died: 1175 }, { ...W, died: 1185 }, rob], holders: ['{person: robert, from: 1170}'], keys: ['year: 1190'], spec: { year: '1190' }, want: null },
	{ id: 'A17', what: 'the first entry has a name only; the second is Robert', people: [henry, W, rob], holders: ['{name: Old Duke, from: 1150, to: 1200}', H('robert')], want: 'william' },
	{
		id: 'A18',
		what: 'two living parents, no brother or sister',
		people: [{ id: 'henry', sex: 'm', born: 1140 }, { id: 'eleanor', sex: 'f', born: 1145 }, { id: 'robert', sex: 'm', born: 1170, parents: ['henry', 'eleanor'] }],
		holders: [H('robert')],
		want: null,
	},
	{ id: 'A19', what: 'one parent is listed (the second is unknown); William is alive', people: [{ id: 'henry', sex: 'm', born: 1140 }, W, rob], holders: [H('robert')], want: 'william' },
	{
		id: 'A21',
		what: 'Henry is dead and has no brother older than him; the younger uncle Ulf is alive (not of an older line)',
		people: [{ id: 'grand', sex: 'm', born: 1110, died: 1170 }, { ...henry, parents: ['grand'] }, { id: 'ulf', sex: 'm', born: 1145, parents: ['grand'] }, rob],
		holders: [H('robert')],
		want: null,
	},
];

const MODES: HouseMode[] = ['as', 'none', 'shuffle'];

describe('Part A: the 22 hint cases of the genealogy gate', () => {
	it('has 22 cases, each id once', () => {
		expect(GATE).toHaveLength(22);
		expect(new Set(GATE.map((c) => c.id)).size).toBe(22);
	});
	for (const c of GATE) {
		it(`${c.id}: ${c.what}`, () => {
			const [asWritten, none, shuffled] = MODES.map((m) => hintOf(c, m));
			expect(asWritten).toBe(c.want);
			// The key `house` is not read.
			expect(none).toBe(asWritten);
			expect(shuffled).toBe(asWritten);
		});
	}
});

describe('Part B: the nearest common ancestor and the order of the children', () => {
	const grand = { id: 'grand', sex: 'm', born: 1110, died: 1170 };
	const own = (id: string, born: number | undefined, parents: string[], more: Partial<P> = {}): P => ({ id, sex: 'm', ...(born !== undefined ? { born } : {}), parents, ...more });
	const B: C[] = [
		{ id: 'B1', what: 'Robert is the eldest son, the younger brother William is alive: no hint', people: [henry, { ...rob, born: 1160 }, W], holders: [H('robert')], want: null },
		{ id: 'B2', what: 'the elder brother Ulf of Henry is alive (a cadet of a cadet)', people: [grand, { ...henry, parents: ['grand'] }, own('ulf', 1135, ['grand']), rob], holders: [H('robert')], want: 'ulf' },
		{ id: 'B3', what: 'the younger brother Ulf of Henry is alive: no hint', people: [grand, { ...henry, parents: ['grand'] }, own('ulf', 1145, ['grand']), rob], holders: [H('robert')], want: null },
		{
			id: 'B4',
			what: 'no birth years at all; William is written before Robert',
			people: [{ id: 'henry', sex: 'm', died: 1190 }, own('william', undefined, ['henry']), own('robert', undefined, ['henry'])],
			holders: [H('robert')],
			want: 'william',
		},
		{
			id: 'B5',
			what: 'no birth years at all; Robert is written before William: no hint',
			people: [{ id: 'henry', sex: 'm', died: 1190 }, own('robert', undefined, ['henry']), own('william', undefined, ['henry'])],
			holders: [H('robert')],
			want: null,
		},
		{
			id: 'B6',
			what: 'double cousins: the elder cousin Cyril has two parents who are brother and sister of the parents of Robert',
			people: [
				{ id: 'grandh', sex: 'm', born: 1110, died: 1160 },
				{ id: 'granda', sex: 'm', born: 1112, died: 1160 },
				{ id: 'henry', sex: 'm', born: 1140, died: 1190, parents: ['grandh'] },
				{ id: 'henry2', sex: 'm', born: 1138, died: 1190, parents: ['grandh'] },
				{ id: 'eleanor', sex: 'f', born: 1142, parents: ['granda'] },
				{ id: 'eleanor2', sex: 'f', born: 1144, parents: ['granda'] },
				own('robert', 1170, ['henry', 'eleanor']),
				own('cyril', 1165, ['henry2', 'eleanor2']),
			],
			holders: [H('robert')],
			want: 'cyril',
		},
		{
			id: 'B7',
			what: 'three birth parents on Robert; the elder William is a child of Henry only',
			people: [henry, { id: 'mum', sex: 'f', born: 1145 }, { id: 'ex', sex: 'm', born: 1141 }, W, { ...rob, parents: ['henry', 'mum', 'ex'] }],
			holders: [H('robert')],
			want: 'william',
		},
		{
			id: 'B8',
			what: 'William is the son of a rumoured parent of Robert only: no claim link, no hint',
			people: [henry, { id: 'rum', sex: 'm', born: 1141 }, own('william', 1165, ['rum']), { ...rob, parents: ['henry', '{id: rum, type: rumoured}'] }],
			holders: [H('robert')],
			want: null,
		},
		{ id: 'B9', what: 'an undated brother written before Robert comes before him (an undated child keeps its place)', people: [henry, own('william', undefined, ['henry']), rob], holders: [H('robert')], want: 'william' },
		{ id: 'B10', what: 'an undated brother written after Robert comes after him: no hint', people: [henry, rob, own('william', undefined, ['henry'])], holders: [H('robert')], want: null },
		{ id: 'B11', what: 'two brothers with the same birth year: the order of the note decides (William first)', people: [henry, own('william', 1170, ['henry']), rob], holders: [H('robert')], want: 'william' },
		{ id: 'B12', what: 'two brothers with the same birth year: Robert is written first, no hint', people: [henry, rob, own('william', 1170, ['henry'])], holders: [H('robert')], want: null },
		{
			id: 'B13',
			what: 'the first person in the line who is senior is named, not a later one',
			people: [henry, own('mid', 1166, ['henry']), W, rob],
			holders: [H('robert')],
			want: 'william',
		},
		{
			id: 'B14',
			what: 'a younger brother in the line is not senior, but the nephew of an elder brother is',
			people: [henry, own('young', 1175, ['henry']), W, own('nephew', 1190, ['william']), rob],
			holders: [H('robert')],
			want: 'william',
		},
	];
	for (const c of B) {
		it(`${c.id}: ${c.what}`, () => {
			const [asWritten, none, shuffled] = MODES.map((m) => hintOf(c, m));
			expect(asWritten).toBe(c.want);
			expect(none).toBe(asWritten);
			expect(shuffled).toBe(asWritten);
		});
	}
});

describe('Part C: the 58 cadet cases', () => {
	function lines(src: string, spec: Partial<SuccessionSpec>) {
		const g = graphOf(src);
		const t = g.titles[0];
		const mk = (body: boolean) => successionLine(g, t, { ...specOf(t), ...spec, heirs: undefined, body }, 1e9, 0);
		return { g, t, off: mk(false), on: mk(true) };
	}

	it('the switch never adds a person to the line (all 58 cases)', () => {
		let compared = 0;
		for (const c of CASES) {
			const { off, on } = lines(buildCadet(c, 'as'), c.spec);
			if (off.kind !== 'line' || on.kind !== 'line') continue;
			compared++;
			const kept = new Set(off.heirs);
			expect(on.heirs.filter((id) => !kept.has(id)), c.id).toEqual([]);
		}
		expect(compared).toBeGreaterThan(40);
	});

	it('the hint names a person who the switch removes, and `house` changes nothing (all 58 cases)', () => {
		let hints = 0;
		for (const c of CASES) {
			const answers = MODES.map((m) => {
				const g = graphOf(buildCadet(c, m));
				const t = g.titles[0];
				const spec = { ...specOf(t), ...c.spec, heirs: undefined, body: false };
				const hint = cadetHint(g, t, spec);
				if (hint) {
					const off = successionLine(g, t, spec, 1e9, 0);
					const on = successionLine(g, t, { ...spec, body: true }, 1e9, 0);
					expect(off.kind === 'line' && off.heirs.includes(hint.person), c.id).toBe(true);
					expect(on.kind === 'line' && on.heirs.includes(hint.person), c.id).toBe(false);
				}
				return hint?.person ?? null;
			});
			expect(answers[1], c.id).toBe(answers[0]);
			expect(answers[2], c.id).toBe(answers[0]);
			if (answers[0]) hints++;
		}
		// The cases hold cadet branches, so some give a hint and some do not.
		expect(hints).toBeGreaterThan(0);
		expect(hints).toBeLessThan(CASES.length);
	});
});

describe('Part D: the first holder with the switch off, and the reused line', () => {
	it('firstHolderOf gives the first entry with a person in the tree, and agrees with the line when the switch is on', () => {
		const c: C = { id: 'D1', what: '', people: [henry, W, rob], holders: ['{name: Old Duke, from: 1150, to: 1200}', H('robert')], want: null };
		const g = graphOf(note(c, 'none'));
		const t = g.titles[0];
		expect(firstHolderOf(g, t.holders)).toEqual({ index: 1, id: 'robert' });
		const on = successionLine(g, t, { ...specOf(t), ...BASE, body: true }, 99, 0);
		expect(on.kind === 'line' && on.firstHolder).toBe('robert');
	});

	it('a first entry with through-spouse names the spouse, as the line does', () => {
		const c: C = {
			id: 'D2',
			what: '',
			people: [{ id: 'henry', sex: 'm', born: 1100, died: 1150 }, { id: 'cecile', sex: 'f', born: 1105, died: 1160 }, { id: 'kid', sex: 'm', born: 1130, parents: ['henry', 'cecile'] }],
			unions: ['{partners: [henry, cecile], type: marriage}'],
			holders: ['{person: henry, from: 1120, to: 1150, through-spouse: true}', '{person: kid, from: 1150}'],
			want: null,
		};
		const g = graphOf(note(c, 'none'));
		const t = g.titles[0];
		expect(firstHolderOf(g, t.holders)?.id).toBe('cecile');
		const on = successionLine(g, t, { ...specOf(t), ...BASE, body: true }, 99, 0);
		expect(on.kind === 'line' && on.firstHolder).toBe('cecile');
	});

	it('no person of the entries in the tree gives no first holder and no hint', () => {
		const c: C = { id: 'D3', what: '', people: [henry, rob], holders: ['{name: Old Duke, from: 1150}'], want: null };
		const g = graphOf(note(c, 'none'));
		expect(firstHolderOf(g, g.titles[0].holders)).toBeNull();
		expect(cadetHint(g, g.titles[0], { ...BASE, ...specOf(g.titles[0]) } as SuccessionSpec)).toBeNull();
	});

	it('with the switch on, with no rule or with a bad rule there is no hint', () => {
		const g = graphOf(note(GATE[0], 'none'));
		const t = g.titles[0];
		const spec = { ...specOf(t), ...BASE } as SuccessionSpec;
		expect(cadetHint(g, t, spec)?.person).toBe('william');
		expect(cadetHint(g, t, { ...spec, body: true })).toBeNull();
		expect(cadetHint(g, t, { ...spec, rule: undefined })).toBeNull();
		expect(cadetHint(g, t, { ...spec, bad: 'inherit' })).toBeNull();
	});

	it('names the first holder, and reuses a complete line without a change of the answer', () => {
		const g = graphOf(note(GATE[0], 'none'));
		const t = g.titles[0];
		const spec = { ...specOf(t), ...BASE } as SuccessionSpec;
		const whole = successionLine(g, t, spec, 99, 0);
		const short = successionLine(g, t, spec, 0, 0);
		expect(cadetHint(g, t, spec)).toEqual({ person: 'william', first: 'robert' });
		expect(cadetHint(g, t, spec, { line: whole })).toEqual({ person: 'william', first: 'robert' });
		// A line cut by the limit is not complete: it is not reused, and the answer is the same.
		expect(short.kind === 'line' && short.more).toBe(true);
		expect(cadetHint(g, t, spec, { line: short })).toEqual({ person: 'william', first: 'robert' });
	});

	it('the title year is read: in 1190 William is dead and the hint goes (the line of the same year)', () => {
		const c = GATE.find((x) => x.id === 'A16')!;
		const g = graphOf(note(c, 'none'));
		const t = g.titles[0];
		expect(cadetHint(g, t, { ...specOf(t), ...BASE, year: '1180' })?.person).toBe('william');
		expect(cadetHint(g, t, { ...specOf(t), ...BASE, year: '1190' })).toBeNull();
	});
});
