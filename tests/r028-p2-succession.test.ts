/*
 * 0.2.8 work package P2: the line of succession. The case tables of the genealogy vets are run on the built engine:
 * D193 C01 to C22 (birth years inside a group, slot-fill), D195 C01 to C23 (holding the title through the spouse), the
 * gate vet rows F-KIN-10, F-KIN-11, I42, S3, I-1, I-2, and the notes of the result (D202, S2, S3, F-KIN-07, D195).
 *
 * The D195 lines of the vet were written before D193. Here the children of HF (H 1125, HB 1128, HSis 1131, written
 * H, HSis, HB) rank H, HB, HSis by year, and K2 (1162) ranks before D (1163); the lines below say so.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { specOf, successionLine, type SuccessionResult, type SuccessionSpec } from '../src/core/succession';

function graphOf(src: string): FamilyGraph {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	return deriveFamilies(r.tree);
}

/** The line of the first title; `over` changes the spec that the title keys give. */
function runLine(src: string, over: Partial<SuccessionSpec> = {}, limit = 99): { res: SuccessionResult; g: FamilyGraph } {
	const g = graphOf(src);
	const title = g.titles[0];
	return { res: successionLine(g, title, { ...specOf(title), ...over }, limit, 0), g };
}

// ---------- D193: C01 to C22 ----------

interface Kid { id: string; sex?: 'm' | 'f'; born?: string; parents?: string; ill?: boolean }
interface Case { id: string; ruler: 'm' | 'f'; kids: Kid[]; keys?: string[]; extra?: string[]; reign?: [number, number]; want: string; notes?: string }

const RUM = '[r, {id: x, type: rumoured}]';
const EQUAL_WOMEN = ['inherit: women-only', 'inherit-illegitimate: equal'];

const D193: Case[] = [
	{ id: 'C01', ruler: 'f', extra: ['h', 'x'], keys: EQUAL_WOMEN, kids: [{ id: 'Dy', sex: 'f', born: '1160', parents: '[r, h]' }, { id: 'Do', sex: 'f', born: '1155', parents: RUM }], want: 'Do Dy' },
	{ id: 'C02', ruler: 'f', extra: ['h', 'x'], keys: EQUAL_WOMEN, kids: [{ id: 'Dy', sex: 'f', born: '1155', parents: '[r, h]' }, { id: 'Do', sex: 'f', born: '1155', parents: RUM }], want: 'Dy Do', notes: 'order Dy Do' },
	{ id: 'C03', ruler: 'm', kids: [{ id: 'T2', born: '1155' }, { id: 'T1', born: '1155' }], want: 'T2 T1' },
	{ id: 'C04', ruler: 'm', kids: [{ id: 'U' }, { id: 'A', born: '1160' }, { id: 'B', born: '1155' }], want: 'U B A' },
	{ id: 'C05', ruler: 'm', kids: [{ id: 'A', born: '1160' }, { id: 'U' }, { id: 'B', born: '1150' }], want: 'B U A', notes: 'contradiction A U B' },
	{ id: 'C06', ruler: 'm', kids: [{ id: 'A', born: '1160' }, { id: 'B', born: '1155' }, { id: 'U' }], want: 'B A U' },
	{ id: 'C07', ruler: 'f', extra: ['h', 'x'], keys: EQUAL_WOMEN, kids: [{ id: 'Do', sex: 'f', parents: RUM }, { id: 'Dy', sex: 'f', born: '1160', parents: '[r, h]' }], want: 'Do Dy', notes: 'order Do Dy' },
	{ id: 'C08', ruler: 'm', keys: ['succession: youngest-child'], kids: [{ id: 'C', born: '1160' }, { id: 'A', born: '1150' }, { id: 'B', born: '1155' }], want: 'C B A' },
	{ id: 'C09', ruler: 'm', keys: ['succession: youngest-child'], kids: [{ id: 'A', born: '1150' }, { id: 'U' }, { id: 'B', born: '1160' }], want: 'B U A' },
	{ id: 'C10', ruler: 'm', reign: [1150, 1170], keys: ['succession: born-in-reign'], kids: [{ id: 'D', born: '1160' }, { id: 'A', born: '1145' }, { id: 'B', born: '1155' }, { id: 'C', born: '1148' }], want: 'B D A C' },
	{ id: 'C11', ruler: 'm', keys: ['inherit: men-first'], kids: [{ id: 'D', sex: 'f', born: '1150' }, { id: 'S2', sex: 'm', born: '1160' }, { id: 'S1', sex: 'm', born: '1155' }], want: 'S1 S2 D' },
	{ id: 'C12', ruler: 'm', keys: ['inherit: men-first-in-house'], kids: [{ id: 'D', sex: 'f', born: '1150' }, { id: 'S2', sex: 'm', born: '1160' }, { id: 'S1', sex: 'm', born: '1155' }], want: 'S1 S2 D' },
	{ id: 'C13', ruler: 'm', keys: ['inherit-illegitimate: after'], kids: [{ id: 'A', born: '1160' }, { id: 'B', born: '1150', ill: true }, { id: 'C', born: '1155' }], want: 'C A B' },
	{ id: 'C14', ruler: 'm', keys: ['inherit-illegitimate: equal'], kids: [{ id: 'A', born: '1160' }, { id: 'B', born: '1150', ill: true }, { id: 'C', born: '1155' }], want: 'B C A' },
	{ id: 'C15', ruler: 'm', keys: ['inherit-adopted: true'], kids: [{ id: 'N', born: '1150' }, { id: 'Ad', born: '1140', parents: '[{id: r, type: adoptive}]' }], want: 'Ad N' },
	{ id: 'C16', ruler: 'm', kids: [{ id: 'A', born: '1150' }, { id: 'Ru', born: '1140', parents: '[{id: r, type: rumoured}]' }], want: 'A' },
	{ id: 'C17', ruler: 'm', kids: [{ id: 'A', born: '150 BC' }, { id: 'B', born: '200 BC' }, { id: 'C', born: 'c. 175 BC' }], want: 'B C A' },
	{ id: 'C18', ruler: 'm', kids: [{ id: 'A', born: '1203' }, { id: 'B', born: '12 May 1203' }, { id: 'C', born: 'c. 1198' }], want: 'C A B' },
	{ id: 'C19', ruler: 'm', kids: [{ id: 'A', born: 'unknown' }, { id: 'B', born: '1150' }, { id: 'C', born: '1145' }], want: 'A C B' },
	{ id: 'C20', ruler: 'm', extra: ['w1', 'w2'], kids: [{ id: 'A', born: '1150', parents: '[r, w1]' }, { id: 'B', born: '1156', parents: '[r, w1]' }, { id: 'C', born: '1153', parents: '[r, w2]' }], want: 'A C B' },
	{ id: 'C21', ruler: 'm', kids: [{ id: 'A', sex: 'f', born: '1160' }, { id: 'B', sex: 'm', born: '1150' }], want: 'B A' },
	{ id: 'C22', ruler: 'm', extra: ['w1', 'w2'], kids: [{ id: 'A', parents: '[r, w1]' }, { id: 'C', parents: '[r, w2]' }], want: 'A C', notes: 'order A C' },
];

function d193Source(c: Case): string {
	const lines = [`  - {id: r, name: R, sex: ${c.ruler}, born: 1120}`];
	for (const e of c.extra ?? []) lines.push(`  - {id: ${e}, name: ${e}, sex: ${e === 'h' || e === 'x' ? 'm' : 'f'}, born: 1120}`);
	for (const k of c.kids) {
		const parts = [`id: ${k.id}`, `name: ${k.id}`];
		if (k.sex) parts.push(`sex: ${k.sex}`);
		if (k.born) parts.push(`born: ${JSON.stringify(k.born)}`);
		parts.push(`parents: ${k.parents ?? '[r]'}`);
		if (k.ill) parts.push('illegitimate: true');
		lines.push(`  - {${parts.join(', ')}}`);
	}
	const hold = c.reign ? `{person: r, from: ${c.reign[0]}, to: ${c.reign[1]}}` : '{person: r, from: 1140}';
	const keys = c.keys ?? [];
	const rule = keys.some((k) => k.startsWith('succession:')) ? [] : ['succession: eldest-child'];
	return `people:\n${lines.join('\n')}\ntitles:\n  - id: duke\n    name: Duke\n${[...rule, ...keys].map((k) => '    ' + k).join('\n')}\n    holders:\n      - ${hold}\n`;
}

describe('D193: birth years rank the children of one parent inside a group (rule vet cases C01 to C22)', () => {
	for (const c of D193) {
		it(`${c.id}: ${c.want}`, () => {
			const { res } = runLine(d193Source(c));
			expect(res.heirs.join(' ')).toBe(c.want);
			// The notes (D202): a pair that only the order of the note put in order, or a break of the years and the note.
			const order = res.notes.filter((n) => n.kind === 'order-from-note').map((n) => `${n.params.a} ${n.params.b}`);
			const loops = res.notes.filter((n) => n.kind === 'order-contradiction').map((n) => (n.params.people as string[]).join(' '));
			const want = c.notes ?? '';
			expect(order).toEqual(want.startsWith('order ') ? [want.slice(6)] : []);
			expect(loops).toEqual(want.startsWith('contradiction ') ? [want.slice(14)] : []);
		});
	}

	it('a mixed set: dated and undated children, two partners, a gender step and youngest-child, in the right groups', () => {
		// Men first: S2 1160, U (no year), S1 1155 are one group; D 1150 is the other. Slot-fill puts S1 in the first place, S2 in the third.
		const people = ['{id: r, name: R, sex: m, born: 1100}', '{id: s2, name: S2, sex: m, born: 1160, parents: [r]}', '{id: u, name: U, sex: m, parents: [r]}', '{id: s1, name: S1, sex: m, born: 1155, parents: [r]}', '{id: d, name: D, sex: f, born: 1150, parents: [r]}'];
		const src = (rule: string) => `people:\n${people.map((p) => '  - ' + p).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: ${rule}\n    inherit: men-first\n    holders:\n      - {person: r, from: 1140}\n`;
		expect(runLine(src('eldest-child')).res.heirs).toEqual(['s1', 'u', 's2', 'd']);
		// youngest-child reverses each group, not the whole set: the men stay before the woman.
		expect(runLine(src('youngest-child')).res.heirs).toEqual(['s2', 'u', 's1', 'd']);
	});

	it('siblings-first and nearest-relative follow the year order in their last tie-break', () => {
		const people = ['{id: r, name: R, sex: m, born: 1100}', '{id: b, name: B, sex: m, born: 1130, parents: [r]}', '{id: a, name: A, sex: m, born: 1120, parents: [r]}'];
		for (const rule of ['siblings-first', 'nearest-relative']) {
			const src = `people:\n${people.map((p) => '  - ' + p).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: ${rule}\n    holders:\n      - {person: r, from: 1140}\n`;
			expect(runLine(src).res.heirs, rule).toEqual(['a', 'b']);
		}
	});

	it('the notes show only for people in the shown line (a limit of 1 hides the pair)', () => {
		const c = D193.find((x) => x.id === 'C22')!;
		expect(runLine(d193Source(c), {}, 1).res.notes).toEqual([]);
		expect(runLine(d193Source(c), {}, 2).res.notes.map((n) => n.kind)).toEqual(['order-from-note']);
	});

	it('a pair in two groups (a son and a daughter under men-first) gets no note: the gender step orders them', () => {
		const c: Case = { id: 'x', ruler: 'm', extra: ['w1', 'w2'], keys: ['inherit: men-first'], kids: [{ id: 'A', sex: 'f', parents: '[r, w1]' }, { id: 'C', sex: 'm', parents: '[r, w2]' }], want: 'C A' };
		const { res } = runLine(d193Source(c));
		expect(res.heirs).toEqual(['C', 'A']);
		expect(res.notes).toEqual([]);
	});

	it('youngest-child gives the pair in line order (the second child first)', () => {
		const c: Case = { id: 'x', ruler: 'm', extra: ['w1', 'w2'], keys: ['succession: youngest-child'], kids: [{ id: 'A', parents: '[r, w1]' }, { id: 'C', parents: '[r, w2]' }], want: 'C A' };
		const { res } = runLine(d193Source(c));
		expect(res.heirs).toEqual(['C', 'A']);
		expect(res.notes).toEqual([{ kind: 'order-from-note', params: { a: 'C', b: 'A' } }]);
	});
});

// ---------- D195: C01 to C23 ----------

const BASE = `
  - {id: F, name: F, sex: m, born: 1100, died: 1150}
  - {id: C, name: C, sex: f, born: 1130, died: 1190, parents: [F]}
  - {id: CS, name: CS, sex: f, born: 1133, parents: [F]}
  - {id: CB, name: CB, sex: m, born: 1135, parents: [F]}
  - {id: CSD, name: CSD, sex: f, born: 1160, parents: [CS]}
  - {id: CBS, name: CBS, sex: m, born: 1160, parents: [CB]}
  - {id: HF, name: HF, sex: m, born: 1095, died: 1140}
  - {id: H, name: H, sex: m, born: 1125, parents: [HF]}
  - {id: HSis, name: HSis, sex: f, born: 1131, parents: [HF]}
  - {id: HB, name: HB, sex: m, born: 1128, parents: [HF]}
  - {id: HSisD, name: HSisD, sex: f, born: 1158, parents: [HSis]}
  - {id: HBS, name: HBS, sex: m, born: 1155, parents: [HB]}
  - {id: W1, name: W1, sex: f, born: 1128, died: 1148}
  - {id: S1, name: S1, sex: m, born: 1148, parents: [H, W1]}
  - {id: K, name: K, sex: m, born: 1160, parents: [C, H]}
  - {id: D, name: D, sex: f, born: 1163, parents: [C, H]}`;
const U_HC = '\n  - {partners: [H, C], type: marriage}';
const U_BOTH = '\n  - {partners: [H, W1], type: marriage}\n  - {partners: [H, C], type: marriage}';
const K2 = '\n  - {id: K2, name: K2, sex: m, born: 1162, parents: [CS, H]}';
const sub = (s: string, a: string, b: string) => s.split(a).join(b);

interface Hold { p: string; from?: string; to?: string; key?: true | string }
const HF_H: Hold[] = [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: true }];

interface Case195 {
	id: string;
	people: string;
	unions: string;
	holders: Hold[];
	keys?: string[];
	/** True for a title with no rule (only named heirs). */
	noRule?: boolean;
	want: string;
	rows?: string;
	/** The warning code the key gives; the line is then the line of the holder (the key is ignored). */
	warns?: string;
	/** True when the window shows the through-spouse note. */
	note?: boolean;
}

function source195(c: Case195): string {
	const hold = (h: Hold) => `      - {person: ${h.p}${h.from ? ', from: ' + h.from : ''}${h.to ? ', to: ' + h.to : ''}${h.key === undefined ? '' : ', through-spouse: ' + (h.key === true ? 'true' : h.key)}}\n`;
	const keys = c.keys ?? [];
	const rule = c.noRule || keys.some((k) => k.startsWith('succession:')) ? [] : ['succession: eldest-child'];
	return `people:${c.people}\n\n${c.unions ? 'unions:' + c.unions + '\n\n' : ''}titles:\n  - id: duke\n    name: Duke\n${[...rule, ...keys].map((k) => '    ' + k).join('\n')}\n    holders:\n${c.holders.map(hold).join('')}`;
}

const TODAY_H = 'S1 K D HB HBS HSis HSisD';

const D195: Case195[] = [
	{ id: 'C01', people: BASE, unions: U_BOTH, holders: HF_H, want: 'K D CS CSD CB CBS', note: true },
	{ id: 'C02', people: sub(BASE, '  - {id: F,', '  - {id: V, name: V, sex: m, born: 1126, died: 1152}\n  - {id: CV, name: CV, sex: m, born: 1153, parents: [C, V]}\n  - {id: F,'), unions: '\n  - {partners: [C, V], type: marriage}\n  - {partners: [H, W1], type: marriage}\n  - {partners: [H, C], type: marriage}', holders: [{ p: 'HF', from: '1120', to: '1150' }, { p: 'C', from: '1150', key: true }], want: 'S1 K D HB HBS HSis HSisD', note: true },
	{ id: 'C03', people: BASE, unions: '\n  - {partners: [H, C], type: marriage}\n  - {partners: [H, W1], type: marriage}', holders: HF_H, want: 'K D CS CSD CB CBS', note: true },
	{ id: 'C04', people: sub(sub(BASE, 'parents: [C, H]', 'parents: [W2, H]'), '  - {id: K,', '  - {id: W2, name: W2, sex: f, born: 1130}\n  - {id: K,'), unions: '\n  - {partners: [H, W1], type: marriage}\n  - {partners: [H, W2], type: marriage}', holders: HF_H, want: TODAY_H, warns: 'through-spouse-no-claim' },
	{ id: 'C05', people: BASE + K2, unions: '\n  - {partners: [H, C], type: marriage}\n  - {partners: [H, CS], type: marriage}', holders: HF_H, want: 'S1 K K2 D HB HBS HSis HSisD', warns: 'through-spouse-several-claims' },
	{ id: 'C06', people: BASE + '\n  - {id: KS, name: KS, sex: m, born: 1185, parents: [K]}', unions: U_BOTH, holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', to: '1190', key: true }, { p: 'K', from: '1190' }], want: 'KS D CS CSD CB CBS' },
	{ id: 'C07', people: BASE, unions: U_BOTH, holders: HF_H, keys: ['heirs-of-body: true'], want: 'K D CS CSD CB CBS', note: true },
	{ id: 'C08', people: sub(BASE, 'parents: [H, W1]', 'parents: [H]'), unions: U_HC, holders: [{ p: 'H', from: '1150', key: true }], keys: ['heirs-of-body: true'], want: 'K D', note: true },
	{ id: 'C09', people: BASE, unions: U_BOTH, holders: HF_H, keys: ['inherit: women-only'], want: 'D CS CSD', note: true },
	{ id: 'C10', people: BASE, unions: U_BOTH, holders: HF_H, keys: ['inherit: men-only'], want: 'K CB CBS', note: true },
	{ id: 'C11', people: BASE, unions: U_BOTH, holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'C', from: '1150' }, { p: 'H', from: '1150', key: true }], want: 'K D CS CSD CB CBS', note: true },
	{ id: 'C12', people: BASE, unions: U_BOTH, holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: true }, { p: 'C', from: '1150' }], want: 'K D CS CSD CB CBS' },
	{ id: 'C13', people: BASE, unions: U_BOTH, holders: HF_H, keys: ['heir: HB', 'exclude: D'], want: 'HB K CS CSD CB CBS', note: true },
	{ id: 'C14', people: sub(sub(BASE, 'parents: [C, H]', 'parents: [H]'), 'parents: [H, W1]', 'parents: [H]'), unions: '', holders: HF_H, want: TODAY_H, warns: 'through-spouse-no-partner' },
	{ id: 'C15', people: BASE, unions: U_BOTH, holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: 'CB' }], want: TODAY_H, warns: 'through-spouse-not-partner' },
	{ id: 'C16', people: BASE + K2, unions: '\n  - {partners: [H, C], type: marriage}\n  - {partners: [H, CS], type: marriage}', holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: 'C' }], want: 'K D CS CSD K2 CB CBS', note: true },
	{
		id: 'C17',
		people: '\n  - {id: G, name: G, sex: m, born: 1070, died: 1120}\n  - {id: F, name: F, sex: m, born: 1100, died: 1150, parents: [G]}\n  - {id: U, name: U, sex: m, born: 1102, died: 1140, parents: [G]}\n  - {id: C, name: C, sex: f, born: 1130, died: 1190, parents: [F]}\n  - {id: CB, name: CB, sex: m, born: 1135, parents: [F]}\n  - {id: H, name: H, sex: m, born: 1125, parents: [U]}\n  - {id: HB, name: HB, sex: m, born: 1128, parents: [U]}\n  - {id: W1, name: W1, sex: f, born: 1128, died: 1148}\n  - {id: S1, name: S1, sex: m, born: 1148, parents: [H, W1]}\n  - {id: K, name: K, sex: m, born: 1160, parents: [C, H]}\n  - {id: D, name: D, sex: f, born: 1163, parents: [C, H]}',
		unions: U_BOTH,
		holders: [{ p: 'G', from: '1100', to: '1120' }, { p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: true }],
		want: 'K D CB S1 HB',
		note: true,
	},
	{ id: 'C18', people: BASE, unions: U_BOTH, holders: HF_H, keys: ['heir: HB'], noRule: true, want: 'HB' },
	{
		id: 'C19',
		people: '\n  - {id: F, name: F, sex: m, born: 1100, died: 1150}\n  - {id: C, name: C, sex: f, born: 1130, died: 1190, parents: [F]}\n  - {id: CB, name: CB, sex: m, born: 1135, parents: [F]}\n  - {id: H1, name: H1, sex: m, born: 1120, died: 1160}\n  - {id: H2, name: H2, sex: m, born: 1125}\n  - {id: W0, name: W0, sex: f, born: 1128, died: 1148}\n  - {id: H2S, name: H2S, sex: m, born: 1150, parents: [H2, W0]}\n  - {id: K1, name: K1, sex: m, born: 1155, parents: [C, H1]}\n  - {id: K2, name: K2, sex: m, born: 1165, parents: [C, H2]}',
		unions: '\n  - {partners: [H1, C], type: marriage}\n  - {partners: [H2, W0], type: marriage}\n  - {partners: [H2, C], type: marriage}',
		holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H1', from: '1150', to: '1160', key: true }, { p: 'H2', from: '1160', key: true }],
		want: 'K1 K2 CB',
		note: true,
	},
	{ id: 'C20', people: BASE, unions: U_BOTH, holders: HF_H, keys: ['succession: siblings-first'], want: 'CS CB K D CSD CBS', note: true },
	{ id: 'C21', people: BASE, unions: U_BOTH, holders: [{ p: 'HF', from: '1100', to: '1120' }, { p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: true }], want: 'K D CS CSD CB CBS', note: true },
	{ id: 'C22', people: sub(BASE, '{id: D, name: D, sex: f, born: 1163, parents: [C, H]}', '{id: D, name: D, sex: f, born: 1163, parents: [{id: C, type: rumoured}, {id: H, type: rumoured}]}'), unions: U_BOTH, holders: HF_H, want: 'K CS CSD CB CBS', note: true },
	{
		id: 'C23',
		people: sub(sub(BASE, '{id: CB, name: CB, sex: m, born: 1135, parents: [F]}', '{id: CB, name: CB, sex: m, born: 1135, died: 1160, parents: [F]}'), '  - {id: CBS, name: CBS, sex: m, born: 1160, parents: [CB]}\n', '') + '\n  - {id: HX, name: HX, sex: m, born: 1126, died: 1130, parents: [HF]}',
		unions: U_BOTH,
		holders: HF_H,
		want: 'K D CS CSD',
		rows: 'CB',
		note: true,
	},
];

describe('D195: holding the title through the spouse (rule vet cases C01 to C23)', () => {
	for (const c of D195) {
		it(`${c.id}: ${c.warns ? 'the key is ignored and warns ' + c.warns : c.want}`, () => {
			const src = source195(c);
			const { res, g } = runLine(src);
			expect(res.kind === 'line' ? res.heirs.join(' ') : res.kind).toBe(c.want);
			expect(res.openBranches.map((b) => b.id).join(' ')).toBe(c.rows ?? '');
			const codes = g.issues.map((i) => i.code).filter((code) => code.startsWith('through-spouse'));
			expect(codes).toEqual(c.warns ? [c.warns] : []);
			// The window keeps the holder as the ruler and shows the note (not for a ruler entry without the key, or an ignored key).
			const note = res.notes.find((n) => n.kind === 'through-spouse');
			expect(!!note).toBe(!!c.note);
		});
	}

	it('the holder stays the ruler and the spouse is the person of the note (C01)', () => {
		const { res } = runLine(source195(D195[0]));
		expect(res.ruler).toBe('H');
		expect(res.notes).toContainEqual({ kind: 'through-spouse', params: { holder: 'H', spouse: 'C' } });
		// S is not in the line and gets no tag; neither does the husband.
		expect(res.heirs).not.toContain('C');
		expect(res.heirs).not.toContain('H');
	});

	it('C02: the wife holds with the key; the husband is S and her child by another man is out', () => {
		const { res } = runLine(source195(D195[1]));
		expect(res.ruler).toBe('C');
		expect(res.notes).toContainEqual({ kind: 'through-spouse', params: { holder: 'C', spouse: 'H' } });
		expect(res.heirs).not.toContain('CV');
	});

	it('C05 and C04: the partner list in the warning names both partners', () => {
		const warnings = (c: Case195) => runLine(source195(c)).g.issues.filter((i) => i.code.startsWith('through-spouse'));
		const w5 = warnings(D195.find((c) => c.id === 'C05')!)[0];
		expect(w5.params).toMatchObject({ person: 'H', title: 'Duke', count: 2, partners: ['C', 'CS'], example: 'C' });
		const w4 = warnings(D195.find((c) => c.id === 'C04')!)[0];
		expect(w4.params).toMatchObject({ person: 'H', count: 2, partners: ['W1', 'W2'] });
	});

	it('no warning without succession or heir, and none for an entry with a name only', () => {
		const c = D195.find((x) => x.id === 'C14')!;
		const bare = source195({ ...c, keys: [] }).replace('    succession: eldest-child\n', '');
		expect(graphOf(bare).issues.filter((i) => i.code.startsWith('through-spouse'))).toEqual([]);
		const named = source195({ ...c, holders: [{ p: 'F', from: '1120', to: '1150' }] }).replace('      - {person: F, from: 1120, to: 1150}', '      - {name: Ghost, through-spouse: true}');
		expect(graphOf(named).issues.filter((i) => i.code.startsWith('through-spouse'))).toEqual([]);
	});

	it('a named id that names nobody warns, and the line is the line of the holder', () => {
		const c: Case195 = { id: 'x', people: BASE, unions: U_BOTH, holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: 'GHOST' }], want: TODAY_H };
		const { res, g } = runLine(source195(c));
		expect(g.issues.filter((i) => i.code.startsWith('through-spouse')).map((i) => i.code)).toEqual(['through-spouse-unknown-person']);
		expect(res.heirs.join(' ')).toBe(TODAY_H);
	});

	it('a concubine, an affair partner and a betrothed are not a candidate; a named id may be any partner', () => {
		const withUnion = (type: string, key?: string): Case195 => ({
			id: 'x',
			people: sub(BASE, '  - {id: W1,', '  - {id: W1,'),
			unions: `\n  - {partners: [H, W1], type: marriage}\n  - {partners: [H, C], type: ${type}}`,
			holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', key: key ?? true }],
			want: '',
		});
		for (const type of ['concubinage', 'affair', 'betrothal']) {
			// W1 is the only candidate (C is out), whatever her claim.
			const { res } = runLine(source195(withUnion(type)));
			expect(res.notes.find((n) => n.kind === 'through-spouse')?.params, type).toEqual({ holder: 'H', spouse: 'W1' });
			// The id of the concubine names her.
			const named = runLine(source195(withUnion(type, 'C')));
			expect(named.res.notes.find((n) => n.kind === 'through-spouse')?.params, type).toEqual({ holder: 'H', spouse: 'C' });
		}
	});

	it('an implicit partner (a shared child, no union) is a candidate', () => {
		const c: Case195 = { id: 'x', people: BASE, unions: '', holders: HF_H, want: '' };
		// K and D name C and H as parents; S1 names H and W1. Both C and W1 are partners; C is related to the holder F.
		const { res, g } = runLine(source195(c));
		expect(g.issues.filter((i) => i.code.startsWith('through-spouse'))).toEqual([]);
		expect(res.notes.find((n) => n.kind === 'through-spouse')?.params).toEqual({ holder: 'H', spouse: 'C' });
	});

	it('born-in-reign: the reigns of the keyed entry also count for the spouse (the child born in the purple)', () => {
		// C holds through H (1150 to 1190). Her son K (1160) is born in the reign; her son J (1140) is not.
		const people = `
  - {id: F, name: F, sex: m, born: 1100, died: 1150}
  - {id: C, name: C, sex: f, born: 1130, parents: [F]}
  - {id: H, name: H, sex: m, born: 1125}
  - {id: J, name: J, sex: m, born: 1156, parents: [C, H]}
  - {id: K, name: K, sex: m, born: 1160, parents: [C, H]}
  - {id: L, name: L, sex: m, born: 1145, parents: [C, H]}`;
		const c: Case195 = { id: 'x', people, unions: U_HC, holders: [{ p: 'F', from: '1120', to: '1150' }, { p: 'H', from: '1150', to: '1190', key: true }], keys: ['succession: born-in-reign'], want: '' };
		const { res } = runLine(source195(c));
		// J and K are born during the reign (1150 to 1190) and rank first, by year; L is before it.
		expect(res.heirs).toEqual(['J', 'K', 'L']);
		expect(res.notes.filter((n) => n.kind === 'born-in-reign-no-from')).toEqual([]);
	});
});

// ---------- Gate vet rows ----------

describe('gate vet rows: F-KIN-10 (S2), F-KIN-11, I42, S3, I-1, I-2, F-KIN-07', () => {
	const head = 'people:\n';

	it('F-KIN-10: co-rulers are never in the line, and the line does not depend on the holder order', () => {
		const people = ['{id: f, name: F, sex: m, born: 1050, died: 1099}', '{id: a, name: A, sex: m, born: 1075, parents: [f]}', '{id: b, name: B, sex: m, born: 1080, parents: [f]}', '{id: c, name: C, sex: m, born: 1100, parents: [a]}'];
		const src = (first: string, second: string) => `${head}${people.map((p) => '  - ' + p).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: eldest-child\n    holders:\n      - {person: ${first}, from: 1100}\n      - {person: ${second}, from: 1100}\n`;
		const one = runLine(src('a', 'b')).res;
		const two = runLine(src('b', 'a')).res;
		expect(one.heirs).toEqual(['c']);
		expect(two.heirs).toEqual(['c']);
		// R is the last started entry; the other holder is a co-ruler. A co-ruler still passes the claim to the children (c).
		expect([one.ruler, one.coRulers]).toEqual(['b', ['a']]);
		expect([two.ruler, two.coRulers]).toEqual(['a', ['b']]);
		expect(one.notes).toContainEqual({ kind: 'co-rulers-not-in-line', params: {} });
	});

	it('S2: a co-ruler is no open branch', () => {
		const people = ['{id: f, name: F, sex: m, born: 1050, died: 1099}', '{id: a, name: A, sex: m, born: 1075, died: yes, parents: [f]}', '{id: b, name: B, sex: m, born: 1080, parents: [f]}'];
		const src = `${head}${people.map((p) => '  - ' + p).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: eldest-child\n    heir: a\n    holders:\n      - {person: a, from: 1100}\n      - {person: b, from: 1100}\n`;
		const { res } = runLine(src);
		expect(res.openBranches).toEqual([]);
	});

	it('D195: the holder and the spouse both have the named-heir state "ruler"', () => {
		const c: Case195 = { id: 'x', people: BASE, unions: U_BOTH, holders: HF_H, keys: ['heir: [H, C, HB]'], want: '' };
		const { res } = runLine(source195(c));
		expect(res.namedHeirs).toEqual([
			{ id: 'H', state: 'is-ruler' },
			{ id: 'C', state: 'is-ruler' },
			{ id: 'HB', state: 'first' },
		]);
		expect(res.heirs[0]).toBe('HB');
	});

	it('F-KIN-11: the climb follows the parents in the order of the note', () => {
		const people = (parents: string) => ['{id: a, name: A, sex: m, born: 1050}', '{id: b, name: B, sex: f, born: 1052}', '{id: sa, name: SA, sex: m, born: 1075, parents: [a]}', '{id: sb, name: SB, sex: m, born: 1076, parents: [b]}', `{id: r, name: R, sex: m, born: 1080, parents: ${parents}}`];
		const src = (parents: string) => `${head}${people(parents).map((p) => '  - ' + p).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: eldest-child\n    inherit-adopted: true\n    holders:\n      - {person: r, from: 1100}\n`;
		expect(runLine(src('[{id: a, type: adoptive}, b]')).res.heirs).toEqual(['sa', 'sb']);
		expect(runLine(src('[b, {id: a, type: adoptive}]')).res.heirs).toEqual(['sb', 'sa']);
	});

	it('I42: a dead person who lists himself as a parent is still an open branch; a cycle link still closes it', () => {
		const src = (self: string, extra = '') =>
			`${head}  - {id: R, name: R, sex: m, born: 1100, died: 1160${extra}}\n  - {id: D, name: D, sex: m, born: 1130, died: 1150, parents: [R${self}]}\n  - {id: E, name: E, sex: m, born: 1135, parents: [R]}\ntitles:\n  - id: t\n    name: T\n    succession: eldest-child\n    holders:\n      - {person: R, from: 1120, to: 1160}\n      - {person: E, from: 1160}\n`;
		expect(runLine(src('')).res.openBranches.map((b) => b.id)).toEqual(['D']);
		expect(runLine(src(', D')).res.openBranches.map((b) => b.id)).toEqual(['D']);
		// A cycle (D lists R, R lists D) is a link to a child: D is a parent of R, so D has a child.
		expect(runLine(src('', ', parents: [D]')).res.openBranches).toEqual([]);
	});

	it('S3: with born-in-reign, a holder entry with no start year gives the note and the rank of eldest-child', () => {
		const src = (from: string) => `${head}  - {id: R, name: R, sex: m, born: 1100}\n  - {id: A, name: A, sex: m, born: 1130, parents: [R]}\n  - {id: B, name: B, sex: m, born: 1125, parents: [R]}\n  - {id: C, name: C, sex: m, born: 1140, parents: [R]}\ntitles:\n  - id: t\n    name: T\n    succession: born-in-reign\n    holders:\n      - {person: R${from}}\n`;
		const none = runLine(src('')).res;
		expect(none.heirs).toEqual(['B', 'A', 'C']);
		expect(none.notes).toEqual([{ kind: 'born-in-reign-no-from', params: { parent: 'R' } }]);
		// With a start year the rule works, and the note is gone.
		const some = runLine(src(', from: 1135')).res;
		expect(some.heirs).toEqual(['C', 'B', 'A']);
		expect(some.notes).toEqual([]);
		// A start year that is no year counts as none.
		expect(runLine(src(', from: long ago')).res.notes.map((n) => n.kind)).toEqual(['born-in-reign-no-from']);
	});

	const PEOPLE_I = (kYear: string) => `people:
  - {id: F, name: F, sex: m, born: 1100, died: 1150}
  - {id: C, name: C, sex: f, born: 1130, died: 1190, parents: [F]}
  - {id: CS, name: CS, sex: f, born: 1133, parents: [F]}
  - {id: CB, name: CB, sex: m, born: 1135, parents: [F]}
  - {id: HF, name: HF, sex: m, born: 1095, died: 1140}
  - {id: H, name: H, sex: m, born: 1125, parents: [HF]}
  - {id: V, name: V, sex: m, born: 1126, died: 1152}
  - {id: K, name: K, sex: m${kYear}, parents: [C, H]}
  - {id: D, name: D, sex: f, born: 1163, parents: [C, H]}
  - {id: CV, name: CV, sex: m, born: 1153, parents: [C, V]}
  - {id: HX, name: HX, sex: m, born: 1140, parents: [H]}
unions:
  - {partners: [H, C], type: marriage}
  - {partners: [C, V], type: marriage}
titles:
  - id: duke
    name: Duke
    succession: eldest-child
    holders:
      - {person: F, from: 1120, to: 1150}
      - {person: H, from: 1150, through-spouse: true}
`;

	it('I-1: D193 with D195: the spouse C has children by two men; CV (1153) ranks before K (1160) and D (1163)', () => {
		expect(runLine(PEOPLE_I(', born: 1160')).res.heirs).toEqual(['CV', 'K', 'D', 'CS', 'CB']);
	});

	it('I-2: K has no year: K keeps its place, CV takes the earlier of the dated places, and the pair gets the note', () => {
		const { res } = runLine(PEOPLE_I(''));
		expect(res.heirs).toEqual(['K', 'CV', 'D', 'CS', 'CB']);
		expect(res.notes).toContainEqual({ kind: 'order-from-note', params: { a: 'K', b: 'CV' } });
	});

	it('F-KIN-07: with heirs-of-body and a name-only first entry the result says which holder it takes', () => {
		const people = ['{id: od, name: Old Duke, sex: m, born: 1000, died: 1060}', '{id: x, name: X, sex: m, born: 1030, died: 1090, parents: [od]}', '{id: y, name: Y, sex: m, born: 1035, parents: [od]}', '{id: r, name: R, sex: m, born: 1060, parents: [x]}'];
		const src = `${head}${people.map((p) => '  - ' + p).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: eldest-child\n    heirs-of-body: true\n    holders:\n      - {name: Old Duke, from: 1000, to: 1060}\n      - {person: x, from: 1060, to: 1090}\n      - {person: r, from: 1090}\n`;
		const { res } = runLine(src);
		expect(res.firstHolder).toBe('x');
		expect(res.notes).toContainEqual({ kind: 'body-skipped', params: { first: 'x', entry: 'Old Duke' } });
		// No note when the first entry is a person in the tree.
		const plain = src.replace('{name: Old Duke, from: 1000, to: 1060}', '{person: od, from: 1000, to: 1060}');
		expect(runLine(plain).res.notes.filter((n) => n.kind === 'body-skipped')).toEqual([]);
	});

	it('the order contradiction note names the people of the break once, in the order of the note', () => {
		const c = D193.find((x) => x.id === 'C05')!;
		const { res } = runLine(d193Source(c));
		expect(res.notes).toEqual([{ kind: 'order-contradiction', params: { people: ['A', 'U', 'B'] } }]);
	});
});
