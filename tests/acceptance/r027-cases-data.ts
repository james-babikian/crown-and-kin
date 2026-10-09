/*
 * The cases of the succession table (an internal study, S01 to S58) as data, for
 * `r027-succession-cases.test.ts` (spec D170 to D188, the 0.2.7 contract sections B, C, J and K). The trees and
 * the expected lines are copied by hand from the table; where a later section of the table, or the
 * contract, replaced an earlier line, this file holds the latest line. A run is one title with the keys of
 * the run; `want.heirs` is the expected `heirs` in order.
 */

/** The keys a run writes on the title, as the table's columns; a missing key is not written. */
export interface CaseKeys {
	succession: string;
	inherit: string;
	through?: string;
	illegitimate?: string;
	adopted?: boolean;
	year?: string;
	heir?: string[];
	exclude?: string[];
}

/** What a run expects. `kind` defaults to 'line'; `more` to false; `limit` to 50 (more than any line here). */
export interface CaseWant {
	heirs?: string[];
	kind?: string;
	more?: boolean;
	limit?: number;
	named?: [string, string][];
	old?: string[];
	/** For a `bad-rule` run: the key that `specOf` marks as unusable (`SuccessionSpec.bad`). */
	bad?: string;
	/** The succession warning codes the tree must give, in order (none when absent). */
	warns?: string[];
}

export interface CaseRun {
	id: string;
	tree: string;
	keys: CaseKeys;
	want: CaseWant;
}

/** One tree: the `people` items and the `holders` items of the title `duke` (one-line flow maps). */
export interface CaseTree {
	what: string;
	people: string[];
	holders: string[];
}

export const TREES: Record<string, CaseTree> = {
	'S01': {
		what: 'Eldest child first, all five gender rules, one house (living uncle, brother, nephew); limit and "more"',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1130, parents: [f]}',
			'{id: uc, name: Uc, sex: m, born: 1155, parents: [u]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: bs, name: Bs, sex: m, born: 1178, parents: [b]}',
			'{id: s1, name: S1, sex: m, born: 1175, parents: [r]}',
			'{id: d1, name: D1, sex: f, born: 1176, parents: [r]}',
			'{id: s2, name: S2, sex: m, born: 1178, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S02': {
		what: 'Agnatic transmission: a daughter\'s son and a brother\'s daughter are out under men-only; eldest child, three gender rules',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1130, parents: [f]}',
			'{id: uc, name: Uc, sex: m, born: 1155, parents: [u]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: bd, name: Bd, sex: f, born: 1180, parents: [b]}',
			'{id: d1, name: D1, sex: f, born: 1172, parents: [r]}',
			'{id: s2, name: S2, sex: m, born: 1175, parents: [r]}',
			'{id: ds, name: Ds, sex: m, born: 1195, parents: [d1]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S03': {
		what: 'Dead eldest sons: s0 dead without children, s1 dead with a son and a daughter ("died: c. 1195" has a year). Representation',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: s0, name: S0, sex: m, born: 1168, died: 1188, parents: [r]}',
			'{id: s1, name: S1, sex: m, born: 1170, died: "c. 1195", parents: [r]}',
			'{id: d1, name: D1, sex: f, born: 1172, parents: [r]}',
			'{id: s2, name: S2, sex: m, born: 1175, parents: [r]}',
			'{id: g1, name: G1, sex: f, born: 1190, parents: [s1]}',
			'{id: g2, name: G2, sex: m, born: 1192, parents: [s1]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S04': {
		what: 'Written order, not birth years, ranks siblings (D2); twins in written order; youngest child first reverses the written order',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: t1, name: T1, sex: m, born: 1180, parents: [r]}',
			'{id: t2, name: T2, sex: m, born: 1180, parents: [r]}',
			'{id: y, name: Y, sex: m, born: 1170, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S05': {
		what: 'Ruler is a woman under men-only: the contract does not test R\'s own sex (the walk starts below R)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: f, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: s, name: S, sex: m, born: 1175, parents: [r]}',
			'{id: d, name: D, sex: f, born: 1177, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S06': {
		what: 'Youngest child first (Borough English) with representation; a younger and an older brother of R',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: ob, name: Ob, sex: m, born: 1145, parents: [a1]}',
			'{id: r, name: R, sex: m, born: 1149, parents: [a1]}',
			'{id: yb, name: Yb, sex: m, born: 1155, parents: [a1]}',
			'{id: c1, name: C1, sex: m, born: 1175, parents: [r]}',
			'{id: c2, name: C2, sex: m, born: 1177, parents: [r]}',
			'{id: c3, name: C3, sex: m, born: 1180, parents: [r]}',
			'{id: c2s, name: C2s, sex: m, born: 1200, parents: [c2]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S07': {
		what: 'Youngest child first with the four gender rules that sort sexes (R has daughters and sons mixed)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: d1, name: D1, sex: f, born: 1170, parents: [r]}',
			'{id: s1, name: S1, sex: m, born: 1172, parents: [r]}',
			'{id: s2, name: S2, sex: m, born: 1175, parents: [r]}',
			'{id: d2, name: D2, sex: f, born: 1177, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S08': {
		what: 'Brothers before children (agnatic seniority): a living uncle, then brothers and cousins of the same generation, then children. Senior line decides inside a generation',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1130, parents: [f]}',
			'{id: uu, name: Uu, sex: m, born: 1135, parents: [f]}',
			'{id: uc, name: Uc, sex: m, born: 1155, parents: [u]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: bs, name: Bs, sex: m, born: 1178, parents: [b]}',
			'{id: s1, name: S1, sex: m, born: 1175, parents: [r]}',
			'{id: s2, name: S2, sex: m, born: 1178, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S09': {
		what: 'Brothers before children with a gender rule: the generation is the outer key, so a sister comes before a son (note)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: sis, name: Sis, sex: f, born: 1148, parents: [a1]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: s, name: S, sex: m, born: 1175, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S10': {
		what: 'Nearest relative first: a living younger son (degree 1) before the son of a dead elder son (degree 2); descendants of R before a brother at the same degree. Contrast with eldest child',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1130, parents: [f]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: bn, name: Bn, sex: m, born: 1180, parents: [b]}',
			'{id: es, name: Es, sex: m, born: 1170, died: 1190, parents: [r]}',
			'{id: ys, name: Ys, sex: m, born: 1180, parents: [r]}',
			'{id: gs, name: Gs, sex: m, born: 1189, parents: [es]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S11': {
		what: '1199: Richard I dies without issue. Brother John (degree 2), sister Joan (degree 2), nephew Arthur, son of the dead elder brother Geoffrey (degree 3). Proximity of blood against primogeniture with representation',
		people: [
			'{id: hen, name: Hen, sex: m, born: 1133, died: 1189}',
			'{id: ric, name: Ric, sex: m, born: 1157, died: 1199, parents: [hen]}',
			'{id: geo, name: Geo, sex: m, born: 1158, died: 1186, parents: [hen]}',
			'{id: joa, name: Joa, sex: f, born: 1165, parents: [hen]}',
			'{id: joh, name: Joh, sex: m, born: 1166, parents: [hen]}',
			'{id: arthur, name: Arthur, sex: m, born: 1187, parents: [geo]}',
		],
		holders: ['{person: hen, from: 1154, to: 1189}', '{person: ric, from: 1189, to: 1199}'],
	},
	'S12': {
		what: 'Born during the reign first: children of R born in the reign of R (from 1180) first; R\'s brothers ranked by the reign of their father a1 (1150 to 1180); a brother born in the year the reign began counts as in the reign',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: ob, name: Ob, sex: m, born: 1145, parents: [a1]}',
			'{id: r, name: R, sex: m, born: 1149, parents: [a1]}',
			'{id: b0, name: B0, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1155, parents: [a1]}',
			'{id: b2, name: B2, sex: m, born: 1160, parents: [a1]}',
			'{id: c1, name: C1, sex: m, born: 1170, parents: [r]}',
			'{id: c2, name: C2, sex: m, born: 1182, parents: [r]}',
			'{id: c3, name: C3, sex: m, born: 1185, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S13': {
		what: 'Born during the reign: a reign that ended before the Year field (year 1190, last reign 1150 to 1180); children born in 1150 and in 1180 count, a child born in 1181 is born after the reign and is alive at 1190; with no Year field the line is for 1180 and the child of 1181 is not born yet',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: x, name: X, sex: m, born: 1149, parents: [a1]}',
			'{id: y, name: Y, sex: m, born: 1150, parents: [a1]}',
			'{id: z, name: Z, sex: m, born: 1180, parents: [a1]}',
			'{id: w, name: W, sex: m, born: 1181, parents: [a1]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}'],
	},
	'S14': {
		what: 'Born during the reign with a gender rule: the gender step is the outer key (H3)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: s0, name: S0, sex: m, born: 1170, parents: [r]}',
			'{id: d0, name: D0, sex: f, born: 1172, parents: [r]}',
			'{id: s1, name: S1, sex: m, born: 1182, parents: [r]}',
			'{id: d1, name: D1, sex: f, born: 1184, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S15': {
		what: 'One sex first, other only when none is left (semi-Salic law): male collaterals of the male line come before R\'s own daughters',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1130, parents: [f]}',
			'{id: uc, name: Uc, sex: m, born: 1155, parents: [u]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: bs, name: Bs, sex: m, born: 1178, parents: [b]}',
			'{id: d1, name: D1, sex: f, born: 1172, parents: [r]}',
			'{id: d2, name: D2, sex: f, born: 1175, parents: [r]}',
			'{id: ds, name: Ds, sex: m, born: 1195, parents: [d1]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S16': {
		what: 'Semi-Salic, no male of the male line left: the women of the last holder first (Pragmatic Sanction), then the women of earlier lines',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: sis, name: Sis, sex: f, born: 1152, parents: [a1]}',
			'{id: d1, name: D1, sex: f, born: 1172, parents: [r]}',
			'{id: d2, name: D2, sex: f, born: 1175, parents: [r]}',
			'{id: ds, name: Ds, sex: m, born: 1195, parents: [d1]}',
			'{id: ss, name: Ss, sex: m, born: 1180, parents: [sis]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S17': {
		what: 'Named heir (G): alive and outside the filters, in the line, dead, the ruler, not in the tree. Men-only',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: ded, name: Ded, sex: m, born: 1160, died: 1190, parents: [a1]}',
			'{id: s1, name: S1, sex: m, born: 1175, parents: [r]}',
			'{id: d, name: D, sex: f, born: 1177, parents: [r]}',
			'{id: s2, name: S2, sex: m, born: 1180, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S18': {
		what: 'Illegitimate children, switch off and on. Off: out, and the legitimate children of a bastard pass no claim. On: the contract ranks by written order (a bastard eldest son first)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: bs, name: Bs, sex: m, born: 1170, parents: [r], illegitimate: true}',
			'{id: ls, name: Ls, sex: m, born: 1175, parents: [r]}',
			'{id: bsc, name: Bsc, sex: m, born: 1192, parents: [bs]}',
			'{id: lsc, name: Lsc, sex: m, born: 1200, parents: [ls]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S19': {
		what: 'Adopted child (adoptive link only), switch off and on',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: ad, name: Ad, sex: m, born: 1170, parents: [{id: r, type: adoptive}]}',
			'{id: bs, name: Bs, sex: m, born: 1175, parents: [r]}',
			'{id: ads, name: Ads, sex: m, born: 1195, parents: [ad]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S20': {
		what: 'The ruler is adopted (Tomas of sample 8): the title passed through the adoptive father. Birth family Drakemoor (bp, bw, bb) is not the house',
		people: [
			'{id: bp, name: Bp, sex: m, born: 1100, died: 1160}',
			'{id: bw, name: Bw, sex: f, born: 1108, died: 1170}',
			'{id: bb, name: Bb, sex: m, born: 1129, parents: [bp, bw]}',
			'{id: fa, name: Fa, sex: m, born: 1102, died: 1161}',
			'{id: nat, name: Nat, sex: m, born: 1135, parents: [fa]}',
			'{id: r, name: R, sex: m, born: 1131, parents: [bp, bw, {id: fa, type: adoptive}], placement: adoptive}',
			'{id: rs, name: Rs, sex: m, born: 1160, parents: [r]}',
		],
		holders: ['{person: fa, from: 1129, to: 1161}', '{person: r, from: 1161}'],
	},
	'S21': {
		what: 'Ward, rumoured, three birth parents. Only real birth links carry a claim (switches on make no difference to ward and rumoured)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: wf, name: Wf, sex: m, born: 1140}',
			'{id: wm, name: Wm, sex: f, born: 1145}',
			'{id: w, name: W, sex: m, born: 1170, parents: [wf, wm, {id: r, type: ward}]}',
			'{id: rf, name: Rf, sex: m, born: 1141}',
			'{id: rm, name: Rm, sex: f, born: 1146}',
			'{id: rs, name: Rs, sex: m, born: 1172, parents: [{id: r, type: rumoured}, rf, rm]}',
			'{id: rs2, name: Rs2, sex: m, born: 1173, parents: [{id: r, type: rumoured}]}',
			'{id: c3p, name: C3p, sex: m, born: 1174, parents: [r, wm, wf]}',
			'{id: s, name: S, sex: m, born: 1176, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S22': {
		what: 'Sex "x" and no sex: with a preference rule after the preferred sex (D171 item 9); out with a one-sex rule, and their children get no claim through them',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: x1, name: X1, sex: x, born: 1170, parents: [r]}',
			'{id: d, name: D, sex: f, born: 1172, parents: [r]}',
			'{id: n1, name: N1, born: 1174, parents: [r]}',
			'{id: s, name: S, sex: m, born: 1176, parents: [r]}',
			'{id: xk, name: Xk, sex: m, born: 1200, parents: [x1]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S23': {
		what: 'Year field before the last reign (the line of 1170, ruler a1); a person who died in 1170 is dead; a person who died in 1171 and one born in 1170 are alive; a child born in 1172 is not born yet. Without the field the line is for 1210 and R = r',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1149, died: 1210, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1155, parents: [a1]}',
			'{id: b2, name: B2, sex: m, born: 1160, died: 1170, parents: [a1]}',
			'{id: b3, name: B3, sex: m, born: 1162, died: 1171, parents: [a1]}',
			'{id: b4, name: B4, sex: m, born: 1170, parents: [a1]}',
			'{id: s1, name: S1, sex: m, born: 1172, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180, to: 1210}'],
	},
	'S24': {
		what: 'A holder entry with no dates after the ruler of the Year field (B.3): holders pa (to 1110), pb (1110 to 1130), pc (no dates); year 1120',
		people: [
			'{id: pa, name: Pa, sex: m, born: 1060, died: 1110}',
			'{id: pb, name: Pb, sex: m, born: 1085, died: 1130, parents: [pa]}',
			'{id: pc, name: Pc, sex: m, born: 1110, parents: [pb]}',
			'{id: pd, name: Pd, sex: m, born: 1112, parents: [pb]}',
		],
		holders: ['{person: pa, to: 1110}', '{person: pb, from: 1110, to: 1130}', '{person: pc}'],
	},
	'S25': {
		what: 'Result kinds: no ruler (Year before the first reign), ruler not in the tree, holder with no dates',
		people: [
			'{id: x, name: X, sex: m, born: 1100}',
			'{id: xs, name: Xs, sex: m, born: 1130, parents: [x]}',
		],
		holders: ['{name: Old Duke, from: 1050, to: 1100}', '{person: x, from: 1100}'],
	},
	'S26': {
		what: 'Cousin marriage: gc is reached twice (through the son s1 of R, and through cuf, daughter of the uncle u); the first place wins; for brothers-first the shortest walk from f gives the generation',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a, name: A, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1130, parents: [f]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a]}',
			'{id: s1, name: S1, sex: m, born: 1175, parents: [r]}',
			'{id: cuf, name: Cuf, sex: f, born: 1176, parents: [u]}',
			'{id: gc, name: Gc, sex: m, born: 1200, parents: [s1, cuf]}',
		],
		holders: ['{person: a, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S27': {
		what: 'The title came through the mother: R\'s mother M is a daughter of the old holder g; R\'s father P is an outsider with a brother pb. Contract C.6 (b) as written ("in up of an earlier holder") does not find M',
		people: [
			'{id: g, name: G, sex: m, born: 1100, died: 1150}',
			'{id: mb, name: Mb, sex: m, born: 1128, parents: [g]}',
			'{id: m, name: M, sex: f, born: 1125, parents: [g]}',
			'{id: pf, name: Pf, sex: m, born: 1095, died: 1140}',
			'{id: pp, name: Pp, sex: m, born: 1123, parents: [pf]}',
			'{id: pb, name: Pb, sex: m, born: 1125, parents: [pf]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [pp, m]}',
			'{id: rs, name: Rs, sex: m, born: 1152, parents: [pp, m]}',
		],
		holders: ['{person: g, from: 1100, to: 1150}', '{person: r, from: 1150}'],
	},
	'S28': {
		what: 'A died text with no year (D171 item 6 as the contract reads it), Y a number. Eldest son e: "died: in infancy"; y2: "died: killed in battle"',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1200}',
			'{id: e, name: E, sex: m, born: 1170, died: "in infancy", parents: [a1]}',
			'{id: y, name: Y, sex: m, born: 1175, parents: [a1]}',
			'{id: y2, name: Y2, sex: m, born: 1180, died: "killed in battle", parents: [a1]}',
		],
		holders: ['{person: a1, from: 1150, to: 1200}'],
	},
	'S29': {
		what: 'The same people with Y = now (the last reign has no end): any written died text means dead',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1200}',
			'{id: e, name: E, sex: m, born: 1170, died: "in infancy", parents: [a1]}',
			'{id: y, name: Y, sex: m, born: 1175, parents: [a1]}',
			'{id: y2, name: Y2, sex: m, born: 1180, died: "killed in battle", parents: [a1]}',
		],
		holders: ['{person: a1, from: 1150}'],
	},
	'S30': {
		what: 'A ruler who is dead before Y is still the ruler of the last entry; the line is the line after him (Y = now)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, died: 1190, parents: [a1]}',
			'{id: s, name: S, sex: m, born: 1175, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S31': {
		what: 'Children of two partners: the contract ranks all claim children of R in written order, not in the order of the partnership dots. x2 (partner w2, born 1170) is written before x1 (partner w1, born 1172); the unions list puts w1 first',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: w1, name: W1, sex: f, born: 1152}',
			'{id: w2, name: W2, sex: f, born: 1155}',
			'{id: x2, name: X2, sex: m, born: 1170, parents: [r, w2]}',
			'{id: x1, name: X1, sex: m, born: 1172, parents: [r, w1]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S32': {
		what: 'Y = now, a person with no died and a born year 115 years before the latest year of the tree (uncle u, born 1075; the tree reaches 1190). The contract lists u as alive; the 110-year rule of FamilySearch, Ancestry and Gramps does not',
		people: [
			'{id: f, name: F, sex: m, born: 1050, died: 1120}',
			'{id: a1, name: A1, sex: m, born: 1100, died: 1160, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1075, parents: [f]}',
			'{id: uc, name: Uc, sex: m, born: 1105, parents: [u]}',
			'{id: r, name: R, sex: m, born: 1130, parents: [a1]}',
			'{id: s, name: S, sex: m, born: 1190, parents: [r]}',
		],
		holders: ['{person: a1, from: 1130, to: 1160}', '{person: r, from: 1160}'],
	},
	'S37': {
		what: 'A bastard son of R and a legitimate brother of R (after = after every legitimate person)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1155, parents: [a1]}',
			'{id: bs, name: Bs, sex: m, born: 1175, parents: [r], illegitimate: true}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S38': {
		what: 'Women-only, an illegitimate elder daughter of a female ruler',
		people: [
			'{id: g, name: G, sex: f, born: 1100, died: 1170}',
			'{id: m, name: M, sex: f, born: 1130, died: 1190, parents: [g]}',
			'{id: d2, name: D2, sex: f, born: 1150, parents: [m], illegitimate: true}',
			'{id: s, name: S, sex: m, born: 1152, parents: [m]}',
			'{id: d1, name: D1, sex: f, born: 1155, parents: [m]}',
			'{id: gd2, name: Gd2, sex: f, born: 1175, parents: [d2]}',
			'{id: gd1, name: Gd1, sex: f, born: 1180, parents: [d1]}',
		],
		holders: ['{person: g, from: 1130, to: 1170}', '{person: m, from: 1170, to: 1190}'],
	},
	'S39': {
		what: 'Women-only, the only daughter is flagged',
		people: [
			'{id: m, name: M, sex: f, born: 1130, died: 1190}',
			'{id: s, name: S, sex: m, born: 1150, parents: [m], illegitimate: true}',
			'{id: sd, name: Sd, sex: f, born: 1175, parents: [s]}',
			'{id: d, name: D, sex: f, born: 1155, parents: [m], illegitimate: true}',
		],
		holders: ['{person: m, from: 1160}'],
	},
	'S40': {
		what: 'Men-first with a mixed set (the tree is made up from the children the table lists).',
		people: [
			'{id: a1, name: A1, sex: m, born: 1095, died: 1180}',
			'{id: r, name: R, sex: m, born: 1120, parents: [a1]}',
			'{id: bd, name: Bd, sex: f, born: 1150, parents: [r], illegitimate: true}',
			'{id: ld, name: Ld, sex: f, born: 1155, parents: [r]}',
			'{id: ls, name: Ls, sex: m, born: 1160, parents: [r]}',
			'{id: bs, name: Bs, sex: m, born: 1170, parents: [r], illegitimate: true}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S42': {
		what: 'Youngest child first with men first in the whole house',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1155, parents: [a1]}',
			'{id: bd, name: Bd, sex: f, born: 1178, parents: [b]}',
			'{id: d1, name: D1, sex: f, born: 1170, parents: [r]}',
			'{id: s1, name: S1, sex: m, born: 1172, parents: [r]}',
			'{id: s2, name: S2, sex: m, born: 1175, parents: [r]}',
			'{id: d2, name: D2, sex: f, born: 1177, parents: [r]}',
			'{id: gs, name: Gs, sex: m, born: 1200, parents: [d2]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S43': {
		what: 'Siblings before children with men first in the whole house (every man before every woman)',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}',
			'{id: u, name: U, sex: m, born: 1130, parents: [f]}',
			'{id: ud, name: Ud, sex: f, born: 1157, parents: [u]}',
			'{id: uc, name: Uc, sex: m, born: 1160, parents: [u]}',
			'{id: sis, name: Sis, sex: f, born: 1148, parents: [a1]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: d1, name: D1, sex: f, born: 1172, parents: [r]}',
			'{id: s1, name: S1, sex: m, born: 1175, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S44': {
		what: 'Nearest relative first with women first in the whole house (a woman ruler). Holders `{g, from 1130, to 1170}`, `{m, from 1170, to 1190}`',
		people: [
			'{id: g, name: G, sex: f, born: 1100, died: 1170}',
			'{id: sis, name: Sis, sex: f, born: 1132, parents: [g]}',
			'{id: m, name: M, sex: f, born: 1130, died: 1190, parents: [g]}',
			'{id: sd, name: Sd, sex: f, born: 1155, parents: [sis]}',
			'{id: ss, name: Ss, sex: m, born: 1157, parents: [sis]}',
			'{id: d1, name: D1, sex: f, born: 1152, parents: [m]}',
			'{id: s, name: S, sex: m, born: 1154, parents: [m]}',
			'{id: gd1, name: Gd1, sex: f, born: 1178, parents: [d1]}',
			'{id: gs, name: Gs, sex: m, born: 1180, parents: [d1]}',
		],
		holders: ['{person: g, from: 1130, to: 1170}', '{person: m, from: 1170, to: 1190}'],
	},
	'S45': {
		what: 'Born during the reign with men first in the whole house',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1155, parents: [a1]}',
			'{id: bd, name: Bd, sex: f, born: 1178, parents: [b]}',
			'{id: s0, name: S0, sex: m, born: 1170, parents: [r]}',
			'{id: d0, name: D0, sex: f, born: 1172, parents: [r]}',
			'{id: s1, name: S1, sex: m, born: 1182, parents: [r]}',
			'{id: d1, name: D1, sex: f, born: 1184, parents: [r]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S46': {
		what: 'Nested with `inherit-illegitimate` (illegitimacy passes outside, sex passes inside)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1155, parents: [a1]}',
			'{id: bd, name: Bd, sex: f, born: 1178, parents: [b]}',
			'{id: d, name: D, sex: f, born: 1172, parents: [r]}',
			'{id: bs, name: Bs, sex: m, born: 1175, parents: [r], illegitimate: true}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
	'S47': {
		what: 'The climb of each pass. Holders `{g, from 1100, to 1150}`, `{r, from 1150}`',
		people: [
			'{id: g, name: G, sex: m, born: 1100, died: 1150}',
			'{id: mb, name: Mb, sex: m, born: 1128, parents: [g]}',
			'{id: m, name: M, sex: f, born: 1125, parents: [g]}',
			'{id: pf, name: Pf, sex: m, born: 1095, died: 1140}',
			'{id: pp, name: Pp, sex: m, born: 1123, parents: [pf]}',
			'{id: pb, name: Pb, sex: m, born: 1125, parents: [pf]}',
			'{id: r, name: R, sex: m, born: 1150, parents: [pp, m]}',
			'{id: rs, name: Rs, sex: m, born: 1152, parents: [pp, m]}',
		],
		holders: ['{person: g, from: 1100, to: 1150}', '{person: r, from: 1150}'],
	},
	'S49': {
		what: 'Avunculate (K.1). Holders gm (1130–1170), r (from 1170)',
		people: [
			'{id: gm, name: Gm, sex: f, born: 1100, died: 1160}',
			'{id: r, name: R, sex: m, born: 1130, parents: [gm]}',
			'{id: sis, name: Sis, sex: f, born: 1132, parents: [gm]}',
			'{id: bro, name: Bro, sex: m, born: 1135, parents: [gm]}',
			'{id: rs1, name: Rs1, sex: m, born: 1155, parents: [r]}',
			'{id: rd1, name: Rd1, sex: f, born: 1157, parents: [r]}',
			'{id: sn1, name: Sn1, sex: m, born: 1156, parents: [sis]}',
			'{id: sd1, name: Sd1, sex: f, born: 1158, parents: [sis]}',
			'{id: sds, name: Sds, sex: m, born: 1180, parents: [sd1]}',
			'{id: bs, name: Bs, sex: m, born: 1160, parents: [bro]}',
		],
		holders: ['{person: gm, from: 1130, to: 1170}', '{person: r, from: 1170}'],
	},
	'S50': {
		what: 'Edward III. R = ch4',
		people: [
			'{id: pf, name: Pf, sex: m, born: 1240, died: 1285}',
			'{id: cv, name: Cv, sex: m, born: 1270, died: 1325, parents: [pf]}',
			'{id: ph6, name: Ph6, sex: m, born: 1293, parents: [cv]}',
			'{id: f, name: F, sex: m, born: 1268, died: 1314, parents: [pf]}',
			'{id: lx, name: Lx, sex: m, born: 1289, died: 1316, parents: [f]}',
			'{id: ph5, name: Ph5, sex: m, born: 1292, died: 1322, parents: [f]}',
			'{id: ph5d, name: Ph5d, sex: f, born: 1315, parents: [ph5]}',
			'{id: ch4, name: Ch4, sex: m, born: 1294, died: 1328, parents: [f]}',
			'{id: isa, name: Isa, sex: f, born: 1295, died: 1358, parents: [f]}',
			'{id: ed3, name: Ed3, sex: m, born: 1312, parents: [isa]}',
		],
		holders: ['{person: f, from: 1285, to: 1314}', '{person: ch4, from: 1322, to: 1328}'],
	},
	'S51': {
		what: '(a) tests `passes` with the key written. Holders f (1140–1170), r (from 1170). men-only + women → rsn, msn',
		people: [
			'{id: gf, name: Gf, sex: m, born: 1100, died: 1160}',
			'{id: gm, name: Gm, sex: f, born: 1105, died: 1165}',
			'{id: gs, name: Gs, sex: f, born: 1128, parents: [gf, gm]}',
			'{id: gsn, name: Gsn, sex: m, born: 1130, parents: [gf, gm]}',
			'{id: f, name: F, sex: m, born: 1125, died: 1170, parents: [gf, gm]}',
			'{id: m, name: M, sex: f, born: 1128}',
			'{id: r, name: R, sex: m, born: 1150, parents: [f, m]}',
			'{id: rsis, name: Rsis, sex: f, born: 1152, parents: [f, m]}',
			'{id: rsn, name: Rsn, sex: m, born: 1175, parents: [rsis]}',
			'{id: msn, name: Msn, sex: m, born: 1130, parents: [m]}',
		],
		holders: ['{person: f, from: 1140, to: 1170}', '{person: r, from: 1170}'],
	},
	'S52': {
		what: 'Half-brothers through the father and the mother (K.2). Holder r only (from 1150)',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: m, name: M, sex: f, born: 1105}',
			'{id: w2, name: W2, sex: f, born: 1106}',
			'{id: h0, name: H0, sex: m, born: 1101}',
			'{id: hp, name: Hp, sex: m, born: 1125, parents: [f, w2]}',
			'{id: hpd, name: Hpd, sex: f, born: 1127, parents: [f, w2]}',
			'{id: hm, name: Hm, sex: m, born: 1126, parents: [h0, m]}',
			'{id: hmd, name: Hmd, sex: f, born: 1128, parents: [h0, m]}',
			'{id: r, name: R, sex: m, born: 1130, parents: [f, m]}',
			'{id: s1, name: S1, sex: m, born: 1155, parents: [r]}',
		],
		holders: ['{person: r, from: 1150}'],
	},
	'S53': {
		what: 'Chains of different length (level from R). Holder r (from 1140)',
		people: [
			'{id: ffa, name: Ffa, sex: m, born: 1020, died: 1080}',
			'{id: gu, name: Gu, sex: m, born: 1055, parents: [ffa]}',
			'{id: ff, name: Ff, sex: m, born: 1050, died: 1110, parents: [ffa]}',
			'{id: u, name: U, sex: m, born: 1080, parents: [ff]}',
			'{id: f, name: F, sex: m, born: 1078, died: 1140, parents: [ff]}',
			'{id: m, name: M, sex: f, born: 1085}',
			'{id: h0, name: H0, sex: m, born: 1086}',
			'{id: hm, name: Hm, sex: m, born: 1110, parents: [h0, m]}',
			'{id: r, name: R, sex: m, born: 1115, parents: [f, m]}',
			'{id: s1, name: S1, sex: m, born: 1140, parents: [r]}',
		],
		holders: ['{person: r, from: 1140}'],
	},
	'S54': {
		what: 'Cousins are R\'s parents (reached twice; ancestors never heirs). Holder r (from 1150)',
		people: [
			'{id: f0, name: F0, sex: m, born: 1050, died: 1100}',
			'{id: c0, name: C0, sex: m, born: 1078, parents: [f0]}',
			'{id: a, name: A, sex: m, born: 1075, parents: [f0]}',
			'{id: b, name: B, sex: m, born: 1080, parents: [f0]}',
			'{id: p1, name: P1, sex: m, born: 1100, parents: [a]}',
			'{id: x1, name: X1, sex: f, born: 1104, parents: [a]}',
			'{id: p2, name: P2, sex: f, born: 1102, parents: [b]}',
			'{id: y1, name: Y1, sex: m, born: 1106, parents: [b]}',
			'{id: r, name: R, sex: m, born: 1130, parents: [p1, p2]}',
			'{id: r2, name: R2, sex: m, born: 1132, parents: [p1, p2]}',
		],
		holders: ['{person: r, from: 1150}'],
	},
	'S55': {
		what: 'The mother is the father\'s niece; the father held. Holders f (1100–1150), r (from 1150). no-preference: s1 (never m)',
		people: [
			'{id: ff, name: Ff, sex: m, born: 1050, died: 1100}',
			'{id: b, name: B, sex: m, born: 1078, died: 1120, parents: [ff]}',
			'{id: f, name: F, sex: m, born: 1075, died: 1150, parents: [ff]}',
			'{id: m, name: M, sex: f, born: 1100, parents: [b]}',
			'{id: r, name: R, sex: m, born: 1125, parents: [f, m]}',
			'{id: s1, name: S1, sex: m, born: 1150, parents: [r]}',
		],
		holders: ['{person: f, from: 1100, to: 1150}', '{person: r, from: 1150}'],
	},
	'S56': {
		what: 'Ancestors at distance 2 by path. Holder r (from 1140)',
		people: [
			'{id: ff, name: Ff, sex: m, born: 1050, died: 1100}',
			'{id: fm, name: Fm, sex: f, born: 1052, died: 1110}',
			'{id: x0, name: X0, sex: m, born: 1052, died: 1100}',
			'{id: mf, name: Mf, sex: m, born: 1055, died: 1105}',
			'{id: mm, name: Mm, sex: f, born: 1057, died: 1115}',
			'{id: y0, name: Y0, sex: f, born: 1056}',
			'{id: fmh, name: Fmh, sex: m, born: 1078, parents: [x0, fm]}',
			'{id: mfh, name: Mfh, sex: m, born: 1079, parents: [mf, y0]}',
			'{id: f, name: F, sex: m, born: 1080, died: 1140, parents: [ff, fm]}',
			'{id: m, name: M, sex: f, born: 1082, parents: [mf, mm]}',
			'{id: r, name: R, sex: m, born: 1115, parents: [f, m]}',
		],
		holders: ['{person: r, from: 1140}'],
	},
	'S57': {
		what: 'The S52 tree with illegitimate: true on hp.',
		people: [
			'{id: f, name: F, sex: m, born: 1100, died: 1150}',
			'{id: m, name: M, sex: f, born: 1105}',
			'{id: w2, name: W2, sex: f, born: 1106}',
			'{id: h0, name: H0, sex: m, born: 1101}',
			'{id: hp, name: Hp, sex: m, born: 1125, parents: [f, w2], illegitimate: true}',
			'{id: hpd, name: Hpd, sex: f, born: 1127, parents: [f, w2]}',
			'{id: hm, name: Hm, sex: m, born: 1126, parents: [h0, m]}',
			'{id: hmd, name: Hmd, sex: f, born: 1128, parents: [h0, m]}',
			'{id: r, name: R, sex: m, born: 1130, parents: [f, m]}',
			'{id: s1, name: S1, sex: m, born: 1155, parents: [r]}',
		],
		holders: ['{person: r, from: 1150}'],
	},
	'S58': {
		what: 'Named heirs and exclusion (K.3). Holders a1 (1150–1180), r (from 1180)',
		people: [
			'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
			'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
			'{id: b, name: B, sex: m, born: 1152, parents: [a1]}',
			'{id: dd, name: Dd, sex: m, born: 1160, died: 1185, parents: [a1]}',
			'{id: e, name: E, sex: m, born: 1170, parents: [r]}',
			'{id: f2, name: F2, sex: f, born: 1172, parents: [r]}',
			'{id: s3, name: S3, sex: m, born: 1175, parents: [r]}',
			'{id: es, name: Es, sex: m, born: 1195, parents: [e]}',
			'{id: ed, name: Ed, sex: f, born: 1196, parents: [e]}',
		],
		holders: ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'],
	},
};

/** A copy of a tree with some people lines or the holders replaced (the variants of the table: S52j to S52l, S48, S54e). */
function variant(of: string, what: string, edit: { people?: [string, string][]; holders?: string[] }): CaseTree {
	const base = TREES[of];
	const people = base.people.map((line) => edit.people?.find(([from]) => from === line)?.[1] ?? line);
	for (const [from] of edit.people ?? []) if (!base.people.includes(from)) throw new Error(`${of} has no line ${from}`);
	return { what, people, holders: edit.holders ?? base.holders };
}

TREES['S52j'] = variant('S52', 'S52 with r\'s parents written mother first', {
	people: [['{id: r, name: R, sex: m, born: 1130, parents: [f, m]}', '{id: r, name: R, sex: m, born: 1130, parents: [m, f]}']],
});
TREES['S52k'] = variant('S52', 'S52 with f as an earlier holder (1120 to 1150)', { holders: ['{person: f, from: 1120, to: 1150}', '{person: r, from: 1150}'] });
TREES['S52l'] = variant('S52', 'S52 with m as an earlier holder (1120 to 1150)', { holders: ['{person: m, from: 1120, to: 1150}', '{person: r, from: 1150}'] });
TREES['S54e'] = variant('S54', 'S54 with f0 as an earlier holder (1070 to 1100)', { holders: ['{person: f0, from: 1070, to: 1100}', '{person: r, from: 1150}'] });

/** The owner's scenario (D188): an enatic queen, a daughter with three rumoured fathers. Title "Queen" is `duke` here. */
TREES['S48'] = {
	what: 'An enatic queen, a daughter with three rumoured fathers (the title Queen)',
	people: [
		'{id: gm, name: Gm, sex: f, born: 1100, died: 1160}',
		'{id: q, name: Queen, sex: f, born: 1130, parents: [gm]}',
		'{id: qs, name: QSis, sex: f, born: 1133, parents: [gm]}',
		'{id: f1, name: F1, sex: m, born: 1125}',
		'{id: f2, name: F2, sex: m, born: 1127}',
		'{id: f3, name: F3, sex: m, born: 1128}',
		'{id: f1s, name: F1son, sex: m, born: 1150, parents: [f1]}',
		'{id: d, name: Daughter, sex: f, born: 1155, parents: [q, {id: f1, type: rumoured}, {id: f2, type: rumoured}, {id: f3, type: rumoured}]}',
	],
	holders: ['{person: gm, from: 1140, to: 1160}', '{person: q, from: 1160}'],
};
TREES['S48i'] = variant('S48', 'S48 with the daughter marked illegitimate', {
	people: [
		[
			'{id: d, name: Daughter, sex: f, born: 1155, parents: [q, {id: f1, type: rumoured}, {id: f2, type: rumoured}, {id: f3, type: rumoured}]}',
			'{id: d, name: Daughter, sex: f, born: 1155, parents: [q, {id: f1, type: rumoured}, {id: f2, type: rumoured}, {id: f3, type: rumoured}], illegitimate: true}',
		],
	],
});
TREES['S48L'] = variant('S48', 'S48, the title Lord: f1 holds from 1150', { holders: ['{person: f1, from: 1150}'] });
TREES['S48Li'] = variant('S48i', 'S48, the title Lord, daughter marked illegitimate', { holders: ['{person: f1, from: 1150}'] });

export const RUNS: CaseRun[] = [
	{ id: 'S01a', tree: 'S01', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'd1', 's2', 'b', 'bs', 'u', 'uc'] } },
	{ id: 'S01b', tree: 'S01', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['s1', 's2', 'b', 'bs', 'u', 'uc'] } },
	{ id: 'S01c', tree: 'S01', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['s1', 's2', 'd1', 'b', 'bs', 'u', 'uc'] } },
	{ id: 'S01d', tree: 'S01', keys: { succession: 'eldest-child', inherit: 'women-first' }, want: { heirs: ['d1', 's1', 's2', 'b', 'bs', 'u', 'uc'] } },
	{ id: 'S01e', tree: 'S01', keys: { succession: 'eldest-child', inherit: 'women-only' }, want: { heirs: ['d1'] } },
	{ id: 'S01f', tree: 'S01', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'd1'], limit: 2, more: true } },
	{ id: 'S02a', tree: 'S02', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['s2', 'b', 'u', 'uc'] } },
	{ id: 'S02b', tree: 'S02', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['d1', 'ds', 's2', 'b', 'bd', 'u', 'uc'] } },
	{ id: 'S02c', tree: 'S02', keys: { succession: 'eldest-child', inherit: 'women-only' }, want: { heirs: ['d1'] } },
	{ id: 'S02d', tree: 'S02', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['s2', 'd1', 'ds', 'b', 'bd', 'u', 'uc'] } },
	{ id: 'S03a', tree: 'S03', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['g2', 'g1', 's2', 'd1'] } },
	{ id: 'S03b', tree: 'S03', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['g1', 'g2', 'd1', 's2'] } },
	{ id: 'S03c', tree: 'S03', keys: { succession: 'nearest-relative', inherit: 'no-preference' }, want: { heirs: ['d1', 's2', 'g1', 'g2'] } },
	{ id: 'S03d', tree: 'S03', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['g2', 's2'] } },
	{ id: 'S04a', tree: 'S04', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['t1', 't2', 'y'] } },
	{ id: 'S04b', tree: 'S04', keys: { succession: 'youngest-child', inherit: 'no-preference' }, want: { heirs: ['y', 't2', 't1'] } },
	{ id: 'S05a', tree: 'S05', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['s', 'b'] } },
	{ id: 'S06a', tree: 'S06', keys: { succession: 'youngest-child', inherit: 'no-preference' }, want: { heirs: ['c3', 'c2', 'c2s', 'c1', 'yb', 'ob'] } },
	{ id: 'S06b', tree: 'S06', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['c1', 'c2', 'c2s', 'c3', 'ob', 'yb'] } },
	{ id: 'S07a', tree: 'S07', keys: { succession: 'youngest-child', inherit: 'men-first' }, want: { heirs: ['s2', 's1', 'd2', 'd1'] } },
	{ id: 'S07b', tree: 'S07', keys: { succession: 'youngest-child', inherit: 'women-first' }, want: { heirs: ['d2', 'd1', 's2', 's1'] } },
	{ id: 'S07c', tree: 'S07', keys: { succession: 'youngest-child', inherit: 'men-only' }, want: { heirs: ['s2', 's1'] } },
	{ id: 'S07d', tree: 'S07', keys: { succession: 'youngest-child', inherit: 'women-only' }, want: { heirs: ['d2', 'd1'] } },
	{ id: 'S08a', tree: 'S08', keys: { succession: 'brothers-first', inherit: 'no-preference' }, want: { heirs: ['u', 'uu', 'b', 'uc', 's1', 's2', 'bs'] } },
	{ id: 'S09a', tree: 'S09', keys: { succession: 'brothers-first', inherit: 'men-first' }, want: { heirs: ['b', 'sis', 's'] } },
	{ id: 'S09b', tree: 'S09', keys: { succession: 'brothers-first', inherit: 'no-preference' }, want: { heirs: ['sis', 'b', 's'] } },
	{ id: 'S09c', tree: 'S09', keys: { succession: 'brothers-first', inherit: 'men-only' }, want: { heirs: ['b', 's'] } },
	{ id: 'S09d', tree: 'S09', keys: { succession: 'brothers-first', inherit: 'women-first' }, want: { heirs: ['sis', 'b', 's'] } },
	{ id: 'S10a', tree: 'S10', keys: { succession: 'nearest-relative', inherit: 'no-preference' }, want: { heirs: ['ys', 'gs', 'b', 'bn', 'u'] } },
	{ id: 'S10b', tree: 'S10', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['gs', 'ys', 'b', 'bn', 'u'] } },
	{ id: 'S11a', tree: 'S11', keys: { succession: 'nearest-relative', inherit: 'men-first' }, want: { heirs: ['joh', 'joa', 'arthur'] } },
	{ id: 'S11b', tree: 'S11', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['arthur', 'joh', 'joa'] } },
	{ id: 'S11c', tree: 'S11', keys: { succession: 'nearest-relative', inherit: 'men-only' }, want: { heirs: ['joh', 'arthur'] } },
	{ id: 'S11d', tree: 'S11', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['arthur', 'joh'] } },
	{ id: 'S12a', tree: 'S12', keys: { succession: 'born-in-reign', inherit: 'no-preference' }, want: { heirs: ['c2', 'c3', 'c1', 'b0', 'b', 'b2', 'ob'] } },
	{ id: 'S12b', tree: 'S12', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['c1', 'c2', 'c3', 'ob', 'b0', 'b', 'b2'] } },
	{ id: 'S13a', tree: 'S13', keys: { succession: 'born-in-reign', inherit: 'no-preference', year: '1190' }, want: { heirs: ['y', 'z', 'x', 'w'] } },
	{ id: 'S13b', tree: 'S13', keys: { succession: 'born-in-reign', inherit: 'no-preference' }, want: { heirs: ['y', 'z', 'x'] } },
	{ id: 'S14a', tree: 'S14', keys: { succession: 'born-in-reign', inherit: 'men-first' }, want: { heirs: ['s1', 's0', 'd1', 'd0'] } },
	{ id: 'S14b', tree: 'S14', keys: { succession: 'born-in-reign', inherit: 'no-preference' }, want: { heirs: ['s1', 'd1', 's0', 'd0'] } },
	{ id: 'S14c', tree: 'S14', keys: { succession: 'born-in-reign', inherit: 'women-first' }, want: { heirs: ['d1', 'd0', 's1', 's0'] } },
	{ id: 'S14d', tree: 'S14', keys: { succession: 'born-in-reign', inherit: 'men-only' }, want: { heirs: ['s1', 's0'] } },
	{ id: 'S15a', tree: 'S15', keys: { succession: 'eldest-child', inherit: 'men-first-in-house' }, want: { heirs: ['b', 'bs', 'u', 'uc', 'd1', 'ds', 'd2'] } },
	{ id: 'S15b', tree: 'S15', keys: { succession: 'eldest-child', inherit: 'women-first-in-house' }, want: { heirs: ['d1', 'd2', 'ds', 'b', 'bs', 'u', 'uc'] } },
	{ id: 'S15c', tree: 'S15', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['d1', 'ds', 'd2', 'b', 'bs', 'u', 'uc'] } },
	{ id: 'S15d', tree: 'S15', keys: { succession: 'eldest-child', inherit: 'semi-salic' }, want: { heirs: ['b', 'bs', 'u', 'uc', 'd1', 'ds', 'd2'] } },
	{ id: 'S15e', tree: 'S15', keys: { succession: 'one-sex-first', inherit: 'men-first' }, want: { kind: 'bad-rule', bad: 'succession', warns: ['unknown-succession'] } },
	{ id: 'S16a', tree: 'S16', keys: { succession: 'eldest-child', inherit: 'men-first-in-house' }, want: { heirs: ['d1', 'ds', 'd2', 'sis', 'ss'] } },
	{ id: 'S16b', tree: 'S16', keys: { succession: 'eldest-child', inherit: 'women-first-in-house' }, want: { heirs: ['d1', 'd2', 'sis', 'ds', 'ss'] } },
	{ id: 'S17a', tree: 'S17', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['s1', 's2', 'b'] } },
	{ id: 'S17b', tree: 'S17', keys: { succession: 'eldest-child', inherit: 'men-only', heir: ['d'] }, want: { heirs: ['d', 's1', 's2', 'b'], named: [['d', 'first']] } },
	{ id: 'S17c', tree: 'S17', keys: { succession: 'eldest-child', inherit: 'men-only', heir: ['s2'] }, want: { heirs: ['s2', 's1', 'b'], named: [['s2', 'first']] } },
	{ id: 'S17d', tree: 'S17', keys: { succession: 'eldest-child', inherit: 'men-only', heir: ['ded'] }, want: { heirs: ['s1', 's2', 'b'], named: [['ded', 'not-alive']] } },
	{ id: 'S17e', tree: 'S17', keys: { succession: 'eldest-child', inherit: 'men-only', heir: ['r'] }, want: { heirs: ['s1', 's2', 'b'], named: [['r', 'is-ruler']] } },
	{ id: 'S17f', tree: 'S17', keys: { succession: 'eldest-child', inherit: 'men-only', heir: ['ghost'] }, want: { heirs: ['s1', 's2', 'b'], named: [['ghost', 'not-in-tree']], warns: ['missing-heir'] } },
	{ id: 'S18a', tree: 'S18', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['ls', 'lsc'] } },
	{ id: 'S18b', tree: 'S18', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'after' }, want: { heirs: ['ls', 'lsc', 'bs', 'bsc'] } },
	{ id: 'S18c', tree: 'S18', keys: { succession: 'nearest-relative', inherit: 'no-preference', illegitimate: 'after' }, want: { heirs: ['ls', 'lsc', 'bs', 'bsc'] } },
	{ id: 'S18d', tree: 'S18', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'equal' }, want: { heirs: ['bs', 'bsc', 'ls', 'lsc'] } },
	{ id: 'S18e', tree: 'S18', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'true' }, want: { heirs: ['ls', 'lsc', 'bs', 'bsc'] } },
	{ id: 'S18f', tree: 'S18', keys: { succession: 'nearest-relative', inherit: 'no-preference', illegitimate: 'equal' }, want: { heirs: ['bs', 'ls', 'bsc', 'lsc'] } },
	{ id: 'S18g', tree: 'S18', keys: { succession: 'siblings-first', inherit: 'no-preference', illegitimate: 'after' }, want: { heirs: ['ls', 'lsc', 'bs', 'bsc'] } },
	{ id: 'S18h', tree: 'S18', keys: { succession: 'siblings-first', inherit: 'no-preference', illegitimate: 'equal' }, want: { heirs: ['bs', 'ls', 'bsc', 'lsc'] } },
	{ id: 'S19a', tree: 'S19', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['bs'] } },
	{ id: 'S19b', tree: 'S19', keys: { succession: 'eldest-child', inherit: 'no-preference', adopted: true }, want: { heirs: ['ad', 'ads', 'bs'] } },
	{ id: 'S19c', tree: 'S19', keys: { succession: 'nearest-relative', inherit: 'no-preference', adopted: true }, want: { heirs: ['ad', 'bs', 'ads'] } },
	// S20: the table's first reading of S20b (rs, bb) is a DISPUTE; the contract (C.6 (a)) climbs to the earlier holder fa through the adoptive link
	// whatever the switch says, so both runs give rs, nat (the table's recommended line).
	{ id: 'S20a', tree: 'S20', keys: { succession: 'eldest-child', inherit: 'no-preference', adopted: true }, want: { heirs: ['rs', 'nat'] } },
	{ id: 'S20b', tree: 'S20', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['rs', 'nat'] } },
	{ id: 'S21a', tree: 'S21', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'true', adopted: true }, want: { heirs: ['c3p', 's'] } },
	{ id: 'S21b', tree: 'S21', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['c3p', 's'] } },
	{ id: 'S22a', tree: 'S22', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['s', 'x1', 'xk', 'd', 'n1'] } },
	{ id: 'S22b', tree: 'S22', keys: { succession: 'eldest-child', inherit: 'women-first' }, want: { heirs: ['d', 'x1', 'xk', 'n1', 's'] } },
	{ id: 'S22c', tree: 'S22', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['x1', 'xk', 'd', 'n1', 's'] } },
	{ id: 'S22d', tree: 'S22', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['s'] } },
	{ id: 'S22e', tree: 'S22', keys: { succession: 'eldest-child', inherit: 'women-only' }, want: { heirs: ['d'] } },
	{ id: 'S23a', tree: 'S23', keys: { succession: 'eldest-child', inherit: 'no-preference', year: 'c. 1170' }, want: { heirs: ['r', 'b', 'b3', 'b4'] } },
	{ id: 'S23b', tree: 'S23', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'b', 'b4'] } },
	// S24a: the table's first line (pd) is a DISPUTE; contract B.3 makes pb the ruler of 1120 (pc has no date and pb's reign runs to 1130), so pc, pd.
	{ id: 'S24a', tree: 'S24', keys: { succession: 'eldest-child', inherit: 'no-preference', year: '1120' }, want: { heirs: ['pc', 'pd'] } },
	{ id: 'S25a', tree: 'S25', keys: { succession: 'eldest-child', inherit: 'no-preference', year: '1075' }, want: { kind: 'ruler-not-in-tree' } },
	{ id: 'S25b', tree: 'S25', keys: { succession: 'eldest-child', inherit: 'no-preference', year: '1040' }, want: { kind: 'no-ruler' } },
	{ id: 'S25c', tree: 'S25', keys: { succession: 'eldest-child', inherit: 'no-preference', year: '1150' }, want: { heirs: ['xs'] } },
	{ id: 'S26a', tree: 'S26', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'gc', 'u', 'cuf'] } },
	{ id: 'S26b', tree: 'S26', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['s1', 'gc', 'u'] } },
	{ id: 'S26c', tree: 'S26', keys: { succession: 'brothers-first', inherit: 'no-preference' }, want: { heirs: ['u', 'cuf', 's1', 'gc'] } },
	{ id: 'S26d', tree: 'S26', keys: { succession: 'nearest-relative', inherit: 'no-preference' }, want: { heirs: ['s1', 'gc', 'u', 'cuf'] } },
	// S27a: the table's first line (rs, pb) is a DISPUTE; contract K.2 (the title came through the mother) gives rs, mb.
	{ id: 'S27a', tree: 'S27', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['rs', 'mb'] } },
	{ id: 'S27b', tree: 'S27', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['rs', 'pb'] } },
	// S28, S29, S32: the owner's answers D185 (a death text with no year is dead; no presumed death by age, only the `old` warning).
	{ id: 'S28a', tree: 'S28', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['y'] } },
	{ id: 'S29a', tree: 'S29', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['y'] } },
	{ id: 'S30a', tree: 'S30', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s'] } },
	{ id: 'S31a', tree: 'S31', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['x2', 'x1'] } },
	{ id: 'S32a', tree: 'S32', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s', 'u', 'uc'], old: ['u'] } },
	{ id: 'S37a', tree: 'S37', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'no' }, want: { heirs: ['b'] } },
	{ id: 'S37b', tree: 'S37', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'after' }, want: { heirs: ['b', 'bs'] } },
	{ id: 'S37c', tree: 'S37', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'equal' }, want: { heirs: ['bs', 'b'] } },
	{ id: 'S38a', tree: 'S38', keys: { succession: 'eldest-child', inherit: 'women-only', illegitimate: 'no' }, want: { heirs: ['d1', 'gd1'] } },
	{ id: 'S38b', tree: 'S38', keys: { succession: 'eldest-child', inherit: 'women-only', illegitimate: 'after' }, want: { heirs: ['d1', 'gd1', 'd2', 'gd2'] } },
	{ id: 'S38c', tree: 'S38', keys: { succession: 'eldest-child', inherit: 'women-only', illegitimate: 'equal' }, want: { heirs: ['d2', 'gd2', 'd1', 'gd1'] } },
	{ id: 'S38d', tree: 'S38', keys: { succession: 'eldest-child', inherit: 'women-first', illegitimate: 'equal' }, want: { heirs: ['d2', 'gd2', 'd1', 'gd1', 's'] } },
	{ id: 'S39a', tree: 'S39', keys: { succession: 'eldest-child', inherit: 'women-only', illegitimate: 'no' }, want: { heirs: [] } },
	{ id: 'S39b', tree: 'S39', keys: { succession: 'eldest-child', inherit: 'women-only', illegitimate: 'after' }, want: { heirs: ['d'] } },
	{ id: 'S39c', tree: 'S39', keys: { succession: 'eldest-child', inherit: 'women-only', illegitimate: 'equal' }, want: { heirs: ['d'] } },
	{ id: 'S40a', tree: 'S40', keys: { succession: 'eldest-child', inherit: 'men-first', illegitimate: 'no' }, want: { heirs: ['ls', 'ld'] } },
	{ id: 'S40b', tree: 'S40', keys: { succession: 'eldest-child', inherit: 'men-first', illegitimate: 'after' }, want: { heirs: ['ls', 'ld', 'bs', 'bd'] } },
	{ id: 'S40c', tree: 'S40', keys: { succession: 'eldest-child', inherit: 'men-first', illegitimate: 'equal' }, want: { heirs: ['ls', 'bs', 'bd', 'ld'] } },
	{ id: 'S40d', tree: 'S40', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'after' }, want: { heirs: ['ls', 'ld', 'bs', 'bd'] } },
	{ id: 'S40e', tree: 'S40', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'equal' }, want: { heirs: ['ls', 'bs', 'bd', 'ld'] } },
	{ id: 'S41a', tree: 'S37', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'maybe' }, want: { kind: 'bad-rule', bad: 'inherit-illegitimate', warns: ['unknown-inherit-illegitimate'] } },
	{ id: 'S41b', tree: 'S37', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'true' }, want: { heirs: ['b', 'bs'] } },
	{ id: 'S41c', tree: 'S37', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'false' }, want: { heirs: ['b'] } },
	{ id: 'S42a', tree: 'S42', keys: { succession: 'youngest-child', inherit: 'men-first-in-house' }, want: { heirs: ['s2', 's1', 'b', 'd2', 'gs', 'd1', 'bd'] } },
	{ id: 'S42b', tree: 'S42', keys: { succession: 'youngest-child', inherit: 'men-first' }, want: { heirs: ['s2', 's1', 'd2', 'gs', 'd1', 'b', 'bd'] } },
	{ id: 'S42c', tree: 'S42', keys: { succession: 'youngest-child', inherit: 'women-first-in-house' }, want: { heirs: ['d2', 'd1', 'gs', 's2', 's1', 'b', 'bd'] } },
	{ id: 'S43a', tree: 'S43', keys: { succession: 'siblings-first', inherit: 'men-first-in-house' }, want: { heirs: ['u', 'b', 'uc', 's1', 'sis', 'ud', 'd1'] } },
	{ id: 'S43b', tree: 'S43', keys: { succession: 'siblings-first', inherit: 'men-first' }, want: { heirs: ['u', 'b', 'uc', 'sis', 'ud', 's1', 'd1'] } },
	{ id: 'S43c', tree: 'S43', keys: { succession: 'siblings-first', inherit: 'women-first-in-house' }, want: { heirs: ['sis', 'd1', 'u', 'ud', 'b', 'uc', 's1'] } },
	{ id: 'S44a', tree: 'S44', keys: { succession: 'nearest-relative', inherit: 'women-first-in-house' }, want: { heirs: ['d1', 'gd1', 'sis', 'sd', 's', 'gs', 'ss'] } },
	{ id: 'S44b', tree: 'S44', keys: { succession: 'nearest-relative', inherit: 'women-first' }, want: { heirs: ['d1', 's', 'gd1', 'gs', 'sis', 'sd', 'ss'] } },
	{ id: 'S44c', tree: 'S44', keys: { succession: 'siblings-first', inherit: 'women-first-in-house' }, want: { heirs: ['sis', 'd1', 'sd', 'gd1', 's', 'ss', 'gs'] } },
	{ id: 'S45a', tree: 'S45', keys: { succession: 'born-in-reign', inherit: 'men-first-in-house' }, want: { heirs: ['s1', 's0', 'b', 'd1', 'd0', 'bd'] } },
	{ id: 'S45b', tree: 'S45', keys: { succession: 'born-in-reign', inherit: 'men-first' }, want: { heirs: ['s1', 's0', 'd1', 'd0', 'b', 'bd'] } },
	{ id: 'S46a', tree: 'S46', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'no' }, want: { heirs: ['b', 'd', 'bd'] } },
	{ id: 'S46b', tree: 'S46', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'after' }, want: { heirs: ['b', 'd', 'bd', 'bs'] } },
	{ id: 'S46c', tree: 'S46', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'equal' }, want: { heirs: ['bs', 'b', 'd', 'bd'] } },
	{ id: 'S46d', tree: 'S46', keys: { succession: 'eldest-child', inherit: 'women-first-in-house', illegitimate: 'after' }, want: { heirs: ['d', 'b', 'bd', 'bs'] } },
	{ id: 'S46e', tree: 'S46', keys: { succession: 'eldest-child', inherit: 'men-first', illegitimate: 'after' }, want: { heirs: ['d', 'b', 'bd', 'bs'] } },
	{ id: 'S47a', tree: 'S47', keys: { succession: 'eldest-child', inherit: 'men-first-in-house' }, want: { heirs: ['rs', 'pb', 'mb'] } },
	{ id: 'S47b', tree: 'S47', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['rs', 'mb'] } },
	{ id: 'S47c', tree: 'S47', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['rs', 'pb'] } },
	{ id: 'S47d', tree: 'S47', keys: { succession: 'siblings-first', inherit: 'men-first-in-house' }, want: { heirs: ['pb', 'rs', 'mb'] } },
	{ id: 'S47e', tree: 'S47', keys: { succession: 'nearest-relative', inherit: 'men-first-in-house' }, want: { heirs: ['rs', 'pb', 'mb'] } },
	{ id: 'S49a', tree: 'S49', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['rs1', 'bro', 'bs'] } },
	{ id: 'S49b', tree: 'S49', keys: { succession: 'eldest-child', inherit: 'men-only', through: 'women' }, want: { heirs: ['sn1', 'sds', 'bro'] } },
	{ id: 'S49c', tree: 'S49', keys: { succession: 'eldest-child', inherit: 'men-only', through: 'anyone' }, want: { heirs: ['rs1', 'sn1', 'sds', 'bro', 'bs'] } },
	{ id: 'S49d', tree: 'S49', keys: { succession: 'eldest-child', inherit: 'men-only', through: 'men' }, want: { heirs: ['rs1'] } },
	{ id: 'S49e', tree: 'S49', keys: { succession: 'eldest-child', inherit: 'no-preference', through: 'women' }, want: { heirs: ['sis', 'sn1', 'sd1', 'sds', 'bro'] } },
	{ id: 'S49f', tree: 'S49', keys: { succession: 'nearest-relative', inherit: 'men-only', through: 'women' }, want: { heirs: ['bro', 'sn1', 'sds'] } },
	{ id: 'S49g', tree: 'S49', keys: { succession: 'siblings-first', inherit: 'men-only', through: 'women' }, want: { heirs: ['bro', 'sn1', 'sds'] } },
	{ id: 'S49h', tree: 'S49', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', through: 'women' }, want: { heirs: ['sn1', 'sds', 'bro', 'sis', 'sd1'] } },
	{ id: 'S50a', tree: 'S50', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['ph6'] } },
	{ id: 'S50b', tree: 'S50', keys: { succession: 'eldest-child', inherit: 'men-only', through: 'anyone' }, want: { heirs: ['ed3', 'ph6'] } },
	{ id: 'S50c', tree: 'S50', keys: { succession: 'eldest-child', inherit: 'men-only', through: 'women' }, want: { heirs: [] } },
	{ id: 'S50d', tree: 'S50', keys: { succession: 'eldest-child', inherit: 'men-only', through: 'men' }, want: { heirs: ['ph6'] } },
	{ id: 'S50e', tree: 'S50', keys: { succession: 'siblings-first', inherit: 'men-only', through: 'anyone' }, want: { heirs: ['ph6', 'ed3'] } },
	{ id: 'S50f', tree: 'S50', keys: { succession: 'nearest-relative', inherit: 'men-only', through: 'anyone' }, want: { heirs: ['ed3', 'ph6'] } },
	{ id: 'S50g', tree: 'S50', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', through: 'anyone' }, want: { heirs: ['ed3', 'ph6', 'ph5d', 'isa'] } },
	{ id: 'S50h', tree: 'S50', keys: { succession: 'eldest-child', inherit: 'men-first-in-house' }, want: { heirs: ['ph6', 'ph5d', 'isa', 'ed3'] } },
	{ id: 'S51a', tree: 'S51', keys: { succession: 'eldest-child', inherit: 'men-only', through: 'women' }, want: { heirs: ['rsn', 'msn'] } },
	{ id: 'S52a', tree: 'S52', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'hp', 'hpd', 'hm', 'hmd'] } },
	{ id: 'S52b', tree: 'S52', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['s1', 'hp', 'hpd', 'hm', 'hmd'] } },
	{ id: 'S52c', tree: 'S52', keys: { succession: 'eldest-child', inherit: 'women-first' }, want: { heirs: ['s1', 'hmd', 'hm', 'hpd', 'hp'] } },
	{ id: 'S52d', tree: 'S52', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['s1', 'hp'] } },
	{ id: 'S52e', tree: 'S52', keys: { succession: 'eldest-child', inherit: 'women-only' }, want: { heirs: ['hmd'] } },
	{ id: 'S52f', tree: 'S52', keys: { succession: 'siblings-first', inherit: 'no-preference' }, want: { heirs: ['hp', 'hpd', 'hm', 'hmd', 's1'] } },
	{ id: 'S52g', tree: 'S52', keys: { succession: 'nearest-relative', inherit: 'no-preference' }, want: { heirs: ['s1', 'hp', 'hpd', 'hm', 'hmd'] } },
	{ id: 'S52h', tree: 'S52', keys: { succession: 'eldest-child', inherit: 'men-first-in-house' }, want: { heirs: ['s1', 'hp', 'hpd', 'hm', 'hmd'] } },
	{ id: 'S52i', tree: 'S52', keys: { succession: 'eldest-child', inherit: 'women-first-in-house' }, want: { heirs: ['hmd', 's1', 'hm', 'hpd', 'hp'] } },
	{ id: 'S53a', tree: 'S53', keys: { succession: 'siblings-first', inherit: 'no-preference' }, want: { heirs: ['gu', 'u', 'hm', 's1'] } },
	{ id: 'S53b', tree: 'S53', keys: { succession: 'nearest-relative', inherit: 'no-preference' }, want: { heirs: ['s1', 'hm', 'u', 'gu'] } },
	{ id: 'S54a', tree: 'S54', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['r2', 'x1', 'y1', 'c0'] } },
	{ id: 'S54b', tree: 'S54', keys: { succession: 'eldest-child', inherit: 'women-first' }, want: { heirs: ['r2', 'y1', 'x1', 'c0'] } },
	{ id: 'S54c', tree: 'S54', keys: { succession: 'eldest-child', inherit: 'men-only' }, want: { heirs: ['r2', 'c0', 'y1'] } },
	{ id: 'S54d', tree: 'S54', keys: { succession: 'siblings-first', inherit: 'no-preference' }, want: { heirs: ['c0', 'x1', 'y1', 'r2'] } },
	{ id: 'S55a', tree: 'S55', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1'] } },
	{ id: 'S56a', tree: 'S56', keys: { succession: 'eldest-child', inherit: 'men-first' }, want: { heirs: ['fmh', 'mfh'] } },
	{ id: 'S56b', tree: 'S56', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['fmh', 'mfh'] } },
	{ id: 'S56c', tree: 'S56', keys: { succession: 'eldest-child', inherit: 'women-first' }, want: { heirs: ['mfh', 'fmh'] } },
	{ id: 'S57a', tree: 'S57', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'no' }, want: { heirs: ['s1', 'hpd', 'hm', 'hmd'] } },
	{ id: 'S57b', tree: 'S57', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'after' }, want: { heirs: ['s1', 'hpd', 'hm', 'hmd', 'hp'] } },
	{ id: 'S57c', tree: 'S57', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'equal' }, want: { heirs: ['s1', 'hp', 'hpd', 'hm', 'hmd'] } },
	{ id: 'S57d', tree: 'S57', keys: { succession: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'after' }, want: { heirs: ['s1', 'hpd', 'hm', 'hmd', 'hp'] } },
	{ id: 'S58a', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['e', 'es', 'ed', 'f2', 's3', 'b'] } },
	{ id: 'S58b', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'no-preference', exclude: ['e'] }, want: { heirs: ['es', 'ed', 'f2', 's3', 'b'] } },
	{ id: 'S58c', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'no-preference', exclude: ['e', 'es', 'ed'] }, want: { heirs: ['f2', 's3', 'b'] } },
	{ id: 'S58d', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'no-preference', heir: ['s3', 'e'], exclude: ['e'] }, want: { heirs: ['s3', 'es', 'ed', 'f2', 'b'], named: [['s3', 'first'], ['e', 'excluded']] } },
	{ id: 'S58e', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'no-preference', heir: ['b', 'ghost', 'dd', 'r', 's3', 'b'] }, want: { heirs: ['b', 's3', 'e', 'es', 'ed', 'f2'], named: [['b', 'first'], ['ghost', 'not-in-tree'], ['dd', 'not-alive'], ['r', 'is-ruler'], ['s3', 'first']], warns: ['missing-heir'] } },
	{ id: 'S58f', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'no-preference', heir: ['s3', 'ghost', 'b'] }, want: { heirs: ['s3', 'b'], limit: 2, more: true, named: [['s3', 'first'], ['ghost', 'not-in-tree'], ['b', 'first']], warns: ['missing-heir'] } },
	{ id: 'S58g', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'no-preference', heir: ['e'] }, want: { heirs: ['e'], limit: 1, more: true, named: [['e', 'first']] } },
	{ id: 'S58h', tree: 'S58', keys: { succession: 'nearest-relative', inherit: 'no-preference', exclude: ['e'] }, want: { heirs: ['f2', 's3', 'es', 'ed', 'b'] } },
	{ id: 'S58i', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'men-only', exclude: ['e'] }, want: { heirs: ['es', 's3', 'b'] } },
	{ id: 'S58j', tree: 'S58', keys: { succession: 'eldest-child', inherit: 'men-only', heir: ['f2'] }, want: { heirs: ['f2', 'e', 'es', 's3', 'b'], named: [['f2', 'first']] } },
];

// S05 with the key `inherit-through` (table, after S49: "S05 with the key").
const S05 = (id: string, through: string, heirs: string[]): CaseRun => ({ id, tree: 'S05', keys: { succession: 'eldest-child', inherit: 'men-only', through }, want: { heirs } });
RUNS.push(S05('S05b', 'men', ['b']), S05('S05c', 'women', ['s']), S05('S05d', 'anyone', ['s', 'b']));

RUNS.push(
	{ id: 'S52j', tree: 'S52j', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'hm', 'hmd', 'hp', 'hpd'] } },
	{ id: 'S52k', tree: 'S52k', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'hp', 'hpd'] } },
	{ id: 'S52l', tree: 'S52l', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['s1', 'hm', 'hmd'] } },
	{ id: 'S54e', tree: 'S54e', keys: { succession: 'eldest-child', inherit: 'no-preference' }, want: { heirs: ['r2', 'x1', 'y1', 'c0'] } },
);

// S48: the Queen (a, b, c) and the Lord (d). The four gender rules, each run with the two values the table names.
const S48_INHERIT = ['women-only', 'women-first', 'women-first-in-house', 'no-preference'];
for (const inherit of S48_INHERIT) {
	for (const illegitimate of ['no', 'equal']) {
		RUNS.push({ id: `S48a/${inherit}/${illegitimate}`, tree: 'S48', keys: { succession: 'eldest-child', inherit, illegitimate }, want: { heirs: ['d', 'qs'] } });
	}
	RUNS.push({ id: `S48b/${inherit}`, tree: 'S48i', keys: { succession: 'eldest-child', inherit, illegitimate: 'no' }, want: { heirs: ['qs'] } });
	RUNS.push({ id: `S48c/${inherit}`, tree: 'S48i', keys: { succession: 'eldest-child', inherit, illegitimate: 'equal' }, want: { heirs: ['d', 'qs'] } });
}
// S48d: a rumoured link carries no claim, so the daughter is never the Lord's heir, marked or not.
RUNS.push(
	{ id: 'S48d/not-marked', tree: 'S48L', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'equal' }, want: { heirs: ['f1s'] } },
	{ id: 'S48d/marked', tree: 'S48Li', keys: { succession: 'eldest-child', inherit: 'no-preference', illegitimate: 'equal' }, want: { heirs: ['f1s'] } },
);
