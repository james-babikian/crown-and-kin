/*
 * 0.3.3, owner decision D279 item 1: the 58 cadet-branch cases of the genealogy vet (an internal study, sections 5 and 7).
 * This file holds the data: a small tree builder over one frame of people (a founder `k`, his sons `s`, `f`, `t`, and so on),
 * and the cases. The test file `r033-cadet-succession.test.ts` runs them.
 *
 * A cadet branch is a person with `parents: [founder]` and another `house:` value. The line of succession never reads the
 * person key `house` (it follows birth and adoptive links only), so every case must give the same line with every `house:`
 * removed or shuffled. The expected lines were written by hand from spec §13.21 before any run.
 */

import type { SuccessionSpec } from '../src/core/succession';

/** One person of the frame: sex, born, died, parents (ids or `{id: x, type: y}` texts), house, and extra text for the row. */
export type Raw = [sex: string | undefined, born: number | string | undefined, died: number | string | undefined, parents: string[], house?: string, extra?: string];

/** The shared frame (scope section 5): k is the founder, s the senior King, f the cadet founder (house brook), t a brother. */
export const BASE: Record<string, Raw> = {
	k: ['m', 1100, 1160, [], 'aldmark'],
	s: ['m', 1125, undefined, ['k'], 'aldmark'],
	f: ['m', 1130, undefined, ['k'], 'brook'],
	t: ['m', 1135, undefined, ['k'], 'aldmark'],
	s1: ['m', 1150, undefined, ['s'], 'aldmark'],
	c1: ['m', 1155, undefined, ['f'], 'brook'],
	c2: ['m', 1158, undefined, ['f'], 'brook'],
	c3: ['f', 1160, undefined, ['f'], 'brook'],
	c1a: ['m', 1180, undefined, ['c1'], 'brook'],
};

const HOUSES = ['aldmark', 'brook', 'marsh'];

/** How the `house:` value is written: as given, left out, or moved to another of three names. */
export type HouseMode = 'as' | 'none' | 'shuffle';

function row(id: string, r: Raw, mode: HouseMode): string {
	const [sex, born, died, parents, house, extra] = r;
	const parts = [`id: ${id}`, `name: ${id.toUpperCase()}`];
	if (sex) parts.push(`sex: ${sex}`);
	if (house && mode !== 'none') parts.push(`house: ${mode === 'shuffle' ? HOUSES[(HOUSES.indexOf(house) + 1 + id.length) % 3] : house}`);
	if (born !== undefined) parts.push(`born: ${JSON.stringify(String(born))}`);
	if (died !== undefined) parts.push(`died: ${JSON.stringify(String(died))}`);
	if (parents.length) parts.push(`parents: [${parents.join(', ')}]`);
	if (extra) parts.push(extra);
	return `  - {${parts.join(', ')}}`;
}

/** A case: the frame with changes, the holder list, the keys, and the line that spec §13.21 gives. */
export interface Case {
	id: string;
	/** One line: why this is the line. */
	what: string;
	/** The frame people that are kept (default: all nine). */
	ids?: string[];
	/** Changes to frame people. */
	over?: Record<string, Partial<{ sex: string; born: number; died: number | undefined; parents: string[]; extra: string }>>;
	/** People added to the case. */
	extra?: Record<string, Raw>;
	/** Holder entries of the title, as written in the note. */
	holders: string[];
	/** Extra title keys, as written. */
	titleKeys?: string[];
	/** The succession keys; the title keys of the note are not read for these. */
	spec: Partial<SuccessionSpec>;
	/** The line (the heirs in order). */
	want: string[];
	/** The grey rows (open branches) the line must show. */
	rows?: string[];
	/** True when no line is possible: the first holder is not an ancestor of the ruler (heirs-of-body). */
	outside?: boolean;
	/** DOUBT: the plugin rule gives this line and a player may not expect it. RISK: a normal tree can give a surprising line. */
	flag?: 'DOUBT' | 'RISK';
	/** The risk number of the scope (section 4) that a later rule change would touch. */
	risk?: string;
	limit?: number;
}

/** The note text of a case. */
export function build(c: Case, mode: HouseMode): string {
	const ids = c.ids ?? Object.keys(BASE);
	const rows: string[] = [];
	for (const id of ids) {
		const r: Raw = [...BASE[id]];
		const o = c.over?.[id];
		if (o) {
			if ('sex' in o) r[0] = o.sex;
			if ('born' in o) r[1] = o.born;
			if ('died' in o) r[2] = o.died;
			if ('parents' in o) r[3] = o.parents ?? [];
			if ('extra' in o) r[5] = o.extra;
		}
		rows.push(row(id, r, mode));
	}
	for (const [id, r] of Object.entries(c.extra ?? {})) rows.push(row(id, r, mode));
	const keys = (c.titleKeys ?? []).map((x) => '    ' + x).join('\n');
	return `people:\n${rows.join('\n')}\ntitles:\n  - id: t1\n    name: T\n${keys}${keys ? '\n' : ''}    holders:\n${c.holders.map((h) => '      - ' + h).join('\n')}\n`;
}

const DUKE = ['{person: f, from: 1150, to: 1190}', '{person: c1, from: 1190}'];
const DEAD_F = { f: { died: 1190 } };
const base: Partial<SuccessionSpec> = { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false };
const S = (o: Partial<SuccessionSpec>): Partial<SuccessionSpec> => ({ ...base, ...o });

function part1(): Case[] {
	const ALL8 = ['k', 's', 'f', 't', 'c1', 'c2', 'c3', 'c1a'];
	const HOLD_K = ['{person: k, from: 1130, to: 1160}', '{person: s, from: 1160, to: 1190}', '{person: c1, from: 1190}'];
	const SD: Case['extra'] = { sd: ['f', 1155, undefined, ['s'], 'aldmark'] };
	const C3S: Case['extra'] = { ...SD, c3s: ['m', 1182, undefined, ['c3'], 'dax'] };
	const M12: Case['extra'] = { m1: ['m', 1180, undefined, ['c2'], 'marsh'], m2: ['m', 1183, undefined, ['c2'], 'marsh'] };
	const BAST: Case['extra'] = { b: ['m', 1128, undefined, ['k'], 'fitz', 'illegitimate: true'], bs: ['m', 1155, undefined, ['b'], 'fitz'] };
	const KS = ['{person: s, from: 1160}'];

	return [
		{ id: 'CB01', what: 'EC/NP cadet duchy, body off: the senior King s and his line come after the cadet line', over: DEAD_F, holders: DUKE, spec: S({}), want: ['c1a', 'c2', 'c3', 's', 's1', 't'], flag: 'DOUBT', risk: 'R2' },
		{ id: 'CB02', what: 'EC/NP cadet duchy, heirs-of-body on', over: DEAD_F, holders: DUKE, spec: S({ body: true }), want: ['c1a', 'c2', 'c3'] },
		{ id: 'CB03', what: 'SF cadet duchy body off: King s (uncle) is first heir', over: DEAD_F, holders: DUKE, spec: S({ rule: 'siblings-first' }), want: ['s', 't', 'c2', 'c3', 's1', 'c1a'], flag: 'DOUBT', risk: 'R2' },
		{ id: 'CB04', what: 'SF cadet duchy body on', over: DEAD_F, holders: DUKE, spec: S({ rule: 'siblings-first', body: true }), want: ['c2', 'c3', 'c1a'] },
		{ id: 'CB05', what: 'NR cadet duchy body off', over: DEAD_F, holders: DUKE, spec: S({ rule: 'nearest-relative' }), want: ['c1a', 'c2', 'c3', 's', 't', 's1'], flag: 'DOUBT', risk: 'R2' },
		{ id: 'CB06', what: 'NR cadet duchy body on', over: DEAD_F, holders: DUKE, spec: S({ rule: 'nearest-relative', body: true }), want: ['c1a', 'c2', 'c3'] },
		{ id: 'CB07', what: 'cadet c1 inherits the King title after childless s (EC/NP)', ids: ALL8, over: { s: { died: 1190 }, f: { died: 1190 } }, holders: HOLD_K, spec: S({}), want: ['c1a', 'c2', 'c3', 't'] },
		{ id: 'CB08', what: 'same, Salic (men-only/men): daughter c3 out', ids: ALL8, over: { s: { died: 1190 }, f: { died: 1190 } }, holders: HOLD_K, spec: S({ inherit: 'men-only', inheritThrough: 'men' }), want: ['c1a', 'c2', 't'] },
		{ id: 'CB09', what: 'same, SF: surviving uncle t before the brothers', ids: ALL8, over: { s: { died: 1190 }, f: { died: 1190 } }, holders: HOLD_K, spec: S({ rule: 'siblings-first' }), want: ['t', 'c2', 'c3', 'c1a'] },
		{ id: 'CB10a', what: 'cadet of a cadet (m1 holds Marsh), body on', over: DEAD_F, extra: M12, holders: ['{person: c2, from: 1180, to: 1210}', '{person: m1, from: 1210}'], spec: S({ body: true }), want: ['m2'] },
		{ id: 'CB10b', what: 'cadet of a cadet, body off', over: DEAD_F, extra: M12, holders: ['{person: c2, from: 1180, to: 1210}', '{person: m1, from: 1210}'], spec: S({}), want: ['m2', 'c1', 'c1a', 'c3', 's', 's1', 't'], flag: 'DOUBT', risk: 'R2' },
		{ id: 'CB11', what: 'semi-Salic King s with only daughter sd: the cadet men first', ids: ALL8, extra: SD, holders: KS, spec: S({ inherit: 'men-first-in-house' }), want: ['f', 'c1', 'c1a', 'c2', 't', 'sd', 'c3'] },
		{ id: 'CB12', what: 'semi-Salic: cadet grandson through a woman (c3s) only in pass 2', ids: ALL8, extra: C3S, holders: KS, spec: S({ inherit: 'men-first-in-house' }), want: ['f', 'c1', 'c1a', 'c2', 't', 'sd', 'c3', 'c3s'] },
		{ id: 'CB13', what: 'semi-Salic with inherit-through anyone: c3s in pass 1', ids: ALL8, extra: C3S, holders: KS, spec: S({ inherit: 'men-first-in-house', inheritThrough: 'anyone' }), want: ['f', 'c1', 'c1a', 'c2', 'c3s', 't', 'sd', 'c3'] },
		{ id: 'CB14', what: 'NR + semi-Salic: all men of the house before the king daughter', ids: ALL8, extra: { ...SD, ...M12 }, holders: KS, spec: S({ rule: 'nearest-relative', inherit: 'men-first-in-house' }), want: ['f', 't', 'c1', 'c2', 'c1a', 'm1', 'm2', 'sd', 'c3'] },
		{ id: 'CB15', what: 'reverse semi-Salic (women-first-in-house), queen q, cadet founded by younger daughter d2', ids: [], extra: { q: ['f', 1100, 1160, [], 'aldmark'], r: ['f', 1125, undefined, ['q'], 'aldmark'], d1: ['f', 1150, undefined, ['r'], 'aldmark'], d1s: ['m', 1175, undefined, ['d1'], 'aldmark'], rb: ['m', 1127, undefined, ['q'], 'aldmark'], d2: ['f', 1153, undefined, ['r'], 'brook'], d2d: ['f', 1178, undefined, ['d2'], 'brook'] }, holders: ['{person: r, from: 1160}'], spec: S({ inherit: 'women-first-in-house' }), want: ['d1', 'd2', 'd2d', 'd1s', 'rb'] },
		{ id: 'CB16a', what: 'bastard cadet b (Fitz), illegitimate: no', ids: ['k', 's', 't', 's1'], extra: BAST, holders: KS, spec: S({}), want: ['s1', 't'] },
		{ id: 'CB16b', what: 'same, after', ids: ['k', 's', 't', 's1'], extra: BAST, holders: KS, spec: S({ illegitimate: 'after' }), want: ['s1', 't', 'b', 'bs'] },
		{ id: 'CB16c', what: 'same, equal', ids: ['k', 's', 't', 's1'], extra: BAST, holders: KS, spec: S({ illegitimate: 'equal' }), want: ['s1', 'b', 'bs', 't'] },
		{ id: 'CB17', what: 'the bastard b holds the title: his son first, then the legitimate line (holder evidence)', ids: ['k', 's', 't', 's1'], extra: BAST, holders: ['{person: k, from: 1130, to: 1160}', '{person: b, from: 1160}'], spec: S({}), want: ['bs', 's', 's1', 't'], flag: 'DOUBT', risk: 'R7' },
	];
}

function part2(): Case[] {
	const ALL8 = ['k', 's', 'f', 't', 'c1', 'c2', 'c3', 'c1a'];
	const ALL9 = ['k', 's', 'f', 't', 's1', 'c1', 'c2', 'c3', 'c1a'];
	const KS = ['{person: s, from: 1160}'];
	const ADOPT: Case['extra'] = { a: ['m', 1150, undefined, ['s', '{id: f, type: adoptive}'], 'brook'] };
	const HEIRESS: Case['extra'] = { e: ['f', 1130, undefined, [], 'z'], h: ['m', 1128, undefined, [], 'brook'], hw: ['f', 1130, undefined, [], 'brook'], hb: ['m', 1150, undefined, ['h', 'hw'], 'brook'], ek1: ['m', 1155, undefined, ['h', 'e'], 'z'], ek2: ['f', 1158, undefined, ['h', 'e'], 'z'] };

	return [
		{ id: 'CB18a', what: 'adoptee a (birth s, adoptive f), adopted on, body on, R=f', ids: ALL9, extra: ADOPT, holders: ['{person: f, from: 1150}'], spec: S({ adopted: true, body: true }), want: ['a', 'c1', 'c1a', 'c2', 'c3'] },
		{ id: 'CB18b', what: 'same, adopted off, body on', ids: ALL9, extra: ADOPT, holders: ['{person: f, from: 1150}'], spec: S({ body: true }), want: ['c1', 'c1a', 'c2', 'c3'] },
		{ id: 'CB18c', what: 'same, adopted off, body off: a stays in the birth family', ids: ALL9, extra: ADOPT, holders: ['{person: f, from: 1150}'], spec: S({}), want: ['c1', 'c1a', 'c2', 'c3', 's', 's1', 'a', 't'] },
		{ id: 'CB19', what: 'ward w of f and rumoured son rm of f never inherit', ids: ALL8, extra: { w: ['m', 1150, undefined, ['{id: f, type: ward}'], 'brook'], rm: ['m', 1151, undefined, ['{id: f, type: rumoured}'], 'brook'] }, holders: ['{person: f, from: 1150}'], spec: S({ body: true }), want: ['c1', 'c1a', 'c2', 'c3'] },
		{ id: 'CB20', what: 'named heir = cadet c1 on the King title (s has son s1)', ids: ALL9, holders: KS, spec: S({ heirs: ['c1'] }), want: ['c1', 's1', 'f', 'c1a', 'c2', 'c3', 't'], flag: 'DOUBT' },
		{ id: 'CB21', what: 'renounce: exclude f only; his children keep the claim', ids: ALL8, holders: KS, spec: S({ exclude: ['f'] }), want: ['c1', 'c1a', 'c2', 'c3', 't'] },
		{ id: 'CB22', what: 'renounce the whole branch by listing 5 people; later-born c4 is not excluded', ids: ALL8, extra: { c4: ['m', 1170, undefined, ['f'], 'brook'] }, holders: KS, spec: S({ exclude: ['f', 'c1', 'c1a', 'c2', 'c3'] }), want: ['c4', 't'], flag: 'RISK', risk: 'R4' },
		{ id: 'CB23a', what: 'jure uxoris: h (cadet) holds e county, through-spouse: e', ids: [], extra: HEIRESS, holders: ['{person: h, from: 1180, through-spouse: e}'], spec: S({}), want: ['ek1', 'ek2'] },
		{ id: 'CB23b', what: 'same, no through-spouse key: the child by the first partner comes first', ids: [], extra: HEIRESS, holders: ['{person: h, from: 1180}'], spec: S({}), want: ['hb', 'ek1', 'ek2'], flag: 'RISK', risk: 'R8' },
		{ id: 'CB24', what: 'cadet by marriage to heiress e: son ek1 holds after e', ids: [], extra: HEIRESS, holders: ['{person: e, from: 1160, to: 1190}', '{person: ek1, from: 1190}'], spec: S({}), want: ['ek2'] },
		{ id: 'CB25', what: 'matrilineal cadet: men-only, through women, NR: brother b then sister sons; b son out', ids: [], extra: { mm: ['f', 1100, undefined, [], 'wether'], r: ['m', 1130, undefined, ['mm'], 'wether'], b: ['m', 1135, undefined, ['mm'], 'wether'], z: ['f', 1138, undefined, ['mm'], 'wether'], bs: ['m', 1160, undefined, ['b'], 'wether'], q1: ['m', 1160, undefined, ['z'], 'pell'], q2: ['m', 1163, undefined, ['z'], 'pell'], qd: ['f', 1165, undefined, ['z'], 'pell'] }, holders: ['{person: r, from: 1160}'], spec: S({ rule: 'nearest-relative', inherit: 'men-only', inheritThrough: 'women' }), want: ['b', 'q1', 'q2'] },
		{ id: 'CB26', what: 'double claim: x child of s1 (senior) and c3 (cadet daughter); R = x; ancestor f out, his other sons in', ids: ALL9, extra: { x: ['m', 1181, undefined, ['s1', 'c3'], 'aldmark'] }, holders: ['{person: k, from: 1130, to: 1160}', '{person: s, from: 1160, to: 1175}', '{person: s1, from: 1175, to: 1200}', '{person: x, from: 1200}'], spec: S({}), want: ['c1', 'c1a', 'c2', 't'] },
		{ id: 'CB27', what: 'ultimogeniture, cadet duchy body off', over: DEAD_F, holders: DUKE, spec: S({ rule: 'youngest-child' }), want: ['c1a', 'c3', 'c2', 't', 's', 's1'], flag: 'DOUBT', risk: 'R2' },
	];
}

function part3(): Case[] {
	const ALL8 = ['k', 's', 'f', 't', 'c1', 'c2', 'c3', 'c1a'];
	const ALL9 = ['k', 's', 'f', 't', 's1', 'c1', 'c2', 'c3', 'c1a'];
	const KS = ['{person: s, from: 1160}'];
	const SD: Case['extra'] = { sd: ['f', 1155, undefined, ['s'], 'aldmark'] };
	const C3S: Case['extra'] = { ...SD, c3s: ['m', 1182, undefined, ['c3'], 'dax'] };

	return [
		{ id: 'CB28', what: 'born-in-reign: c0 born before f got the duchy ranks after the reign-born kids', ids: ['k', 'f', 'c1', 'c2', 'c3', 'c1a'], extra: { c0: ['m', 1148, undefined, ['f'], 'brook'] }, holders: ['{person: f, from: 1150, to: 1190}'], spec: S({ rule: 'born-in-reign', body: true }), want: ['c1', 'c1a', 'c2', 'c3', 'c0'] },
		{ id: 'CB29', what: 'year 1175: c1a (b. 1180) not born; line is after f', over: DEAD_F, holders: DUKE, titleKeys: ['year: 1175'], spec: S({ body: true, year: '1175' }), want: ['c1', 'c2', 'c3'] },
		{ id: 'CB30', what: 'apanage reverts: s1 (senior) holds the duchy after c1; first holder f; body on', over: { f: { died: 1190 }, c1: { died: 1200 } }, holders: ['{person: f, from: 1150, to: 1190}', '{person: c1, from: 1190, to: 1200}', '{person: s1, from: 1200}'], spec: S({ body: true }), want: [], outside: true, flag: 'DOUBT', risk: 'R13' },
		{ id: 'CB31', what: 'same as CB30 but s dead, body off: heirs general of s1, depth first (f line before t)', over: { f: { died: 1190 }, s: { died: 1199 }, c1: { died: 1200 } }, holders: ['{person: f, from: 1150, to: 1190}', '{person: c1, from: 1190, to: 1200}', '{person: s1, from: 1200}'], spec: S({}), want: ['c1a', 'c2', 'c3', 't'] },
		{ id: 'CB32', what: 'women-first on King: cadet daughter c3 first among f kids', ids: ALL9, holders: KS, spec: S({ inherit: 'women-first' }), want: ['s1', 'f', 'c3', 'c1', 'c1a', 'c2', 't'] },
		{ id: 'CB33', what: 'open branch: t dead, no children recorded, King s', ids: ALL9, over: { t: { died: 1180 } }, holders: KS, spec: S({}), want: ['s1', 'f', 'c1', 'c1a', 'c2', 'c3'], rows: ['t'] },
		{ id: 'CB34', what: 'Salic King: cadet through a daughter c3s out; sd out', ids: ALL8, extra: C3S, holders: KS, spec: S({ inherit: 'men-only', inheritThrough: 'men' }), want: ['f', 'c1', 'c1a', 'c2', 't'] },
		{ id: 'CB35', what: 'same-name cadet: named heir by id, two people called Henry', ids: ['k', 's', 'f', 't'], extra: { henry: ['m', 1150, undefined, ['s'], 'aldmark'], 'henry-2': ['m', 1155, undefined, ['f'], 'brook'] }, holders: KS, spec: S({ heirs: ['henry-2'] }), want: ['henry-2', 'henry', 'f', 't'] },
		{ id: 'CB36', what: 'co-rulers: s and f both start in 1160; R is f (the last entry that has started); s is a co-ruler, not in the line, and passes the claim', ids: ['k', 's', 'f', 't', 'c1', 'c2'], holders: ['{person: s, from: 1160}', '{person: f, from: 1160}'], spec: S({}), want: ['c1', 'c2', 't'] },
		{ id: 'CB37', what: 'SF with semi-Salic on cadet duchy body off', over: DEAD_F, extra: SD, holders: DUKE, spec: S({ rule: 'siblings-first', inherit: 'men-first-in-house' }), want: ['s', 't', 'c2', 's1', 'c1a', 'c3', 'sd'], flag: 'DOUBT', risk: 'R2' },
		{ id: 'CB38', what: 'illegitimate cadet founder c0 of Duke f, after + SF', ids: ['k', 'f', 'c1', 'c2'], extra: { c0: ['m', 1148, undefined, ['f'], 'brook', 'illegitimate: true'], c0s: ['m', 1170, undefined, ['c0'], 'brook'] }, holders: ['{person: f, from: 1150}'], spec: S({ rule: 'siblings-first', illegitimate: 'after', body: true }), want: ['c1', 'c2', 'c0', 'c0s'] },
	];
}

function part4(): Case[] {
	const ALL9 = ['k', 's', 'f', 't', 's1', 'c1', 'c2', 'c3', 'c1a'];
	const NOS1 = ['k', 's', 'f', 't', 'c1', 'c2', 'c3', 'c1a'];
	const KS = ['{person: s, from: 1160}'];
	const ADOPTED_C1: Case['over'] = { c1: { parents: ['f', '{id: s, type: adoptive}'] } };
	const BAST: Case['extra'] = { b: ['m', 1128, undefined, ['k'], 'fitz', 'illegitimate: true'], bs: ['m', 1155, undefined, ['b'], 'fitz'], sd: ['f', 1155, undefined, ['s'], 'aldmark'] };

	return [
		{ id: 'CB39', what: 'King s (no kids) adopts cadet c1: adopted on', ids: NOS1, over: ADOPTED_C1, holders: KS, spec: S({ adopted: true }), want: ['c1', 'c1a', 'f', 'c2', 'c3', 't'] },
		{ id: 'CB40', what: 'same, adopted off: c1 stays in the cadet line', ids: NOS1, over: ADOPTED_C1, holders: KS, spec: S({}), want: ['f', 'c1', 'c1a', 'c2', 'c3', 't'] },
		{ id: 'CB41', what: 'title made for the bastard b (first holder), illegitimate: no, body on', ids: ['k', 's', 't'], extra: BAST, holders: ['{person: b, from: 1160}'], spec: S({ body: true }), want: ['bs'] },
		{ id: 'CB42', what: 'semi-Salic + after: legit daughter sd before the bastard line', ids: ['k', 's', 't'], extra: BAST, holders: KS, spec: S({ inherit: 'men-first-in-house', illegitimate: 'after' }), want: ['t', 'sd', 'b', 'bs'] },
		{ id: 'CB43', what: 'ALL9, King s alive with son s1: year 1140 (before the cadet kids exist)', ids: ALL9, holders: ['{person: k, from: 1100, to: 1160}', '{person: s, from: 1160}'], titleKeys: ['year: 1140'], spec: S({ year: '1140' }), want: ['s', 'f', 't'] },
	];
}

function part5(): Case[] {
	const HEIRESS: Case['extra'] = { e: ['f', 1130, 1185, [], 'z'], h: ['m', 1128, 1189, [], 'brook'], hw: ['f', 1130, undefined, [], 'brook'], hb: ['m', 1150, undefined, ['h', 'hw'], 'brook'], ek1: ['m', 1155, undefined, ['h', 'e'], 'z'], ek2: ['f', 1158, undefined, ['h', 'e'], 'z'], ek1s: ['m', 1185, undefined, ['ek1'], 'z'] };

	return [
		{ id: 'CB44', what: 'heiress chain: h holds through e (1180-1190), son ek1 after; hb is not e kin', ids: [], extra: HEIRESS, holders: ['{person: h, from: 1180, to: 1190, through-spouse: e}', '{person: ek1, from: 1190}'], spec: S({}), want: ['ek1s', 'ek2'] },
		{ id: 'CB44b', what: 'same, through-spouse: true (two candidates e and hw, no other holder): key ignored', ids: [], extra: HEIRESS, holders: ['{person: h, from: 1180, to: 1190, through-spouse: true}', '{person: ek1, from: 1190}'], spec: S({}), want: ['ek1s', 'ek2'] },
		{ id: 'CB44c', what: 'heiress e holds first, then h through e: true resolves by the other holder e', ids: [], extra: HEIRESS, holders: ['{person: e, from: 1160, to: 1180}', '{person: h, from: 1180, to: 1190, through-spouse: true}', '{person: ek1, from: 1190}'], spec: S({}), want: ['ek1s', 'ek2'] },
	];
}

function part6(): Case[] {
	const AGE: Case['extra'] = { k: ['m', 1080, 1150, [], 'aldmark'], s: ['m', 1105, 1180, ['k'], 'aldmark'], f: ['m', 1112, 1175, ['k'], 'brook'], r: ['m', 1140, undefined, ['s'], 'aldmark'], r2: ['m', 1150, undefined, ['s'], 'aldmark'], cc: ['m', 1135, undefined, ['f'], 'brook'] };

	return [
		{ id: 'CB47', what: 'SF level-mates of two branches: cadet cousin cc (b.1135) is older than R (1140) and than brother r2 (1150)', ids: [], extra: AGE, holders: ['{person: s, from: 1150, to: 1180}', '{person: r, from: 1180}'], spec: S({ rule: 'siblings-first' }), want: ['r2', 'cc'], flag: 'DOUBT', risk: 'R9' },
		{ id: 'CB47b', what: 'same, nearest-relative', ids: [], extra: AGE, holders: ['{person: s, from: 1150, to: 1180}', '{person: r, from: 1180}'], spec: S({ rule: 'nearest-relative' }), want: ['r2', 'cc'] },
	];
}

function part7(): Case[] {
	const MOM: Case['extra'] = { z2: ['m', 1100, 1150, [], 'other'], q: ['f', 1105, 1170, [], 'maternal'], f: ['m', 1130, undefined, ['q'], 'brook'], h2: ['m', 1120, undefined, ['q', 'z2'], 'maternal'], c1: ['m', 1155, undefined, ['f'], 'brook'], c2: ['m', 1158, undefined, ['f'], 'brook'] };
	const MOM2: Case['extra'] = { ...MOM, k: ['m', 1100, 1160, [], 'aldmark'], f: ['m', 1130, undefined, ['k', 'q'], 'brook'] };

	return [
		{ id: 'CB48a', what: 'first holder f has a mother q who also had son h2 by another man; switch off', ids: [], extra: MOM2, holders: ['{person: f, from: 1150}'], spec: S({}), want: ['c1', 'c2', 'h2'], flag: 'DOUBT', risk: 'R6' },
		{ id: 'CB48b', what: 'same, switch on', ids: [], extra: MOM2, holders: ['{person: f, from: 1150}'], spec: S({ body: true }), want: ['c1', 'c2'] },
		{ id: 'CB48c', what: 'same, men-first-in-house (Salic-like): the maternal half-brother h2 enters in pass 2 only? (q is a woman)', ids: [], extra: MOM2, holders: ['{person: f, from: 1150}'], spec: S({ inherit: 'men-first-in-house' }), want: ['c1', 'c2', 'h2'] },
	];
}

function part8(): Case[] {
	return [
		{ id: 'CB49', what: 'men-first on King s with only a daughter sd: R own daughter before the cadet uncle', ids: ['k', 's', 'f', 't', 'c1', 'c2', 'c3', 'c1a'], extra: { sd: ['f', 1155, undefined, ['s'], 'aldmark'] }, holders: ['{person: s, from: 1160}'], spec: S({ inherit: 'men-first' }), want: ['sd', 'f', 'c1', 'c1a', 'c2', 'c3', 't'] },
	];
}

/** The 58 cases, in the order of the scope table (A to E); CB45 and CB46 cannot be written and are `it.todo` in the test file. */
export const CASES: Case[] = [...part1(), ...part2(), ...part3(), ...part4(), ...part5(), ...part6(), ...part7(), ...part8()];
