/*
 * D293 (spec §0 D293, §13.1 "Half"): a child with a birth parent and an adoptive parent who are union partners of each
 * other has two legal parents. It is complete (the setting "Assume an unknown second parent" adds no unknown parent),
 * and in the half or full test its parents are the birth and the adoptive parents together. Each case runs with the
 * setting on and off, and in both directions. All names are made up.
 *
 * Wren and Calla are married. Pia is Wren's child, adopted by Calla. Fenn is Calla's child, adopted by Wren.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { legalParents, orderCouple } from '../../src/core/legal-parents';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import { cardRelationText, stepSentences } from '../../src/render/tree-info';

const SETTINGS: [string, RelationOptions][] = [
	['on', { oneParentUnknown: true }],
	['off', { oneParentUnknown: false }],
];

/** The block of a tree: Wren and Calla (sex given) are married; `extra` are more people, `union` is false for no union. */
function block(extra: string[], opts: { wren?: 'f' | 'm'; union?: boolean } = {}): string {
	return [
		'people:',
		`  - {id: wren, name: Wren, sex: ${opts.wren ?? 'f'}, born: 1940}`,
		'  - {id: calla, name: Calla, sex: f, born: 1938}',
		...extra.map((e) => `  - ${e}`),
		...(opts.union === false ? [] : ['unions:', '  - partners: [wren, calla]']),
	].join('\n');
}

function graphOf(source: string) {
	const r = parseDynasty(source + '\n');
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

const PIA = '{id: pia, name: Pia, sex: f, parents: [wren, {id: calla, type: adoptive}]}';
const FENN = '{id: fenn, name: Fenn, sex: m, parents: [calla, {id: wren, type: adoptive}]}';

/** The card text and the "Also" names of `other` as seen from `me`, joined with " | ". */
function words(source: string, me: string, other: string, options: RelationOptions): string {
	const list = computeRelations(graphOf(source), me, options).get(other) ?? [];
	return list.map(cardRelationText).join(' | ');
}

/** Both directions of one pair for both settings: `want` is the card text from `a` to `b` and from `b` to `a`. */
function check(source: string, a: string, b: string, want: { ab: string; ba: string; off?: { ab: string; ba: string } }) {
	for (const [name, options] of SETTINGS) {
		const w = name === 'off' && want.off ? want.off : want;
		expect(words(source, a, b, options), `${name}: ${a} to ${b}`).toBe(w.ab);
		expect(words(source, b, a, options), `${name}: ${b} to ${a}`).toBe(w.ba);
	}
}

describe('D293: two legal parents through an adoption', () => {
	it('each adopted by the partner of the birth parent of the other: adoptive siblings, not half (V5)', () => {
		check(block([PIA, FENN]), 'pia', 'fenn', { ab: 'Adoptive brother', ba: 'Adoptive sister' });
	});

	it('the same with a man and a woman (V1)', () => {
		check(block([PIA, FENN], { wren: 'm' }), 'pia', 'fenn', { ab: 'Adoptive brother', ba: 'Adoptive sister' });
	});

	it('a sibling who is only the second parent\'s child stays half, with both settings (the fixture case, finding A)', () => {
		const src = block([PIA, '{id: fenn, name: Fenn, sex: m, parents: [calla]}']);
		check(src, 'pia', 'fenn', { ab: 'Adoptive half-brother', ba: 'Adoptive half-sister' });
	});

	it('a man and a woman: a sibling who is only the step-parent\'s child stays half (V2)', () => {
		const src = block([PIA, '{id: q, name: Quin, sex: m, parents: [calla]}'], { wren: 'm' });
		check(src, 'pia', 'q', { ab: 'Adoptive half-brother', ba: 'Adoptive half-sister' });
	});

	it('a child of both partners and Pia share two legal parents: Brother, because they share a birth parent (V3)', () => {
		check(block([PIA, '{id: y, name: Yan, sex: m, parents: [wren, calla]}']), 'pia', 'y', { ab: 'Brother', ba: 'Sister' });
	});

	it('the same when the child lists the parents in the other order', () => {
		check(block([PIA, '{id: y, name: Yan, sex: m, parents: [calla, wren]}']), 'pia', 'y', { ab: 'Brother', ba: 'Sister' });
	});

	it('two children of Wren, both adopted by Calla: Brother', () => {
		check(block([PIA, '{id: pia2, name: Pat, sex: m, parents: [wren, {id: calla, type: adoptive}]}']), 'pia', 'pia2', { ab: 'Brother', ba: 'Sister' });
	});

	it('a child of Wren alone is half to Pia with both settings; the setting adds the maybe only when on', () => {
		const src = block([PIA, '{id: z, name: Zed, sex: m, parents: [wren]}']);
		check(src, 'pia', 'z', {
			ab: 'Half-brother, maybe full',
			ba: 'Half-sister, maybe full',
			off: { ab: 'Half-brother', ba: 'Half-sister' },
		});
	});

	it('both children list both partners as birth parents: Brother (V6, unchanged)', () => {
		const src = block(['{id: pia, name: Pia, sex: f, parents: [wren, calla]}', '{id: fenn, name: Fenn, sex: m, parents: [calla, wren]}']);
		check(src, 'pia', 'fenn', { ab: 'Brother', ba: 'Sister' });
	});

	it('both children adopted by both, one of them by birth too: Adoptive brother (V7, unchanged)', () => {
		const src = block(['{id: pia, name: Pia, sex: f, parents: [{id: wren, type: adoptive}, {id: calla, type: adoptive}]}', '{id: fenn, name: Fenn, sex: m, parents: [wren, calla]}']);
		check(src, 'pia', 'fenn', { ab: 'Adoptive brother', ba: 'Adoptive sister' });
	});

	it('a full adoption by a couple, with unrelated birth parents listed, stays Adoptive brother (V4)', () => {
		const src = [
			'people:',
			'  - {id: a1, name: A1, sex: f}',
			'  - {id: a2, name: A2, sex: f}',
			'  - {id: u, name: U, sex: f}',
			'  - {id: v, name: V, sex: m}',
			'  - {id: t, name: T, sex: m, parents: [u, v, {id: a1, type: adoptive}, {id: a2, type: adoptive}]}',
			'  - {id: k, name: K, sex: m, parents: [a1, a2]}',
			'unions:',
			'  - partners: [a1, a2]',
		].join('\n');
		check(src, 't', 'k', { ab: 'Adoptive brother', ba: 'Adoptive brother' });
	});

	it('a child with two birth parents and an adoptive partner of one keeps the two birth parents', () => {
		const src = block(['{id: s, name: Sam, sex: m}', '{id: pia, name: Pia, sex: f, parents: [wren, s, {id: calla, type: adoptive}]}', '{id: y, name: Yan, sex: m, parents: [wren, s]}']);
		check(src, 'pia', 'y', { ab: 'Brother', ba: 'Sister' });
	});

	it('if the birth parent and the adoptive parent are not partners, nothing changes', () => {
		const src = block([PIA, FENN], { union: false });
		check(src, 'pia', 'fenn', {
			ab: 'Adoptive half-brother',
			ba: 'Adoptive half-sister',
			off: { ab: 'Adoptive brother', ba: 'Adoptive sister' },
		});
	});

	it('the cousins of two such siblings and the sibling\'s child follow the new full rule', () => {
		const src = block([PIA, FENN, '{id: kp, name: Kay, sex: f, parents: [pia]}', '{id: kf, name: Kit, sex: m, parents: [fenn]}']);
		check(src, 'pia', 'kf', { ab: 'Adoptive nephew', ba: 'Adoptive aunt' });
		check(src, 'kp', 'kf', { ab: 'Adoptive first cousin', ba: 'Adoptive first cousin' });
	});

	it('a rumoured parent on Pia gives "maybe half" as for any complete child', () => {
		const src = block(['{id: xav, name: Xavier, sex: m}', '{id: pia, name: Pia, sex: f, parents: [wren, {id: calla, type: adoptive}, {id: xav, type: rumoured}]}', '{id: y, name: Yan, sex: m, parents: [wren, calla]}']);
		check(src, 'pia', 'y', { ab: 'Brother, maybe half | Rumoured half-brother', ba: 'Sister, maybe half | Rumoured half-sister' });
	});

	it('the second test counts birth and rumoured parents, not the legal parents: Pia and Yves share Wren and a rumoured Xavier', () => {
		const src = block(['{id: xav, name: Xavier, sex: m}', '{id: pia, name: Pia, sex: f, parents: [wren, {id: calla, type: adoptive}, {id: xav, type: rumoured}]}', '{id: y2, name: Yves, sex: m, parents: [wren, xav]}']);
		check(src, 'pia', 'y2', { ab: 'Half-brother, maybe full | Rumoured brother', ba: 'Half-sister, maybe full | Rumoured sister' });
	});

	it('a child with two adoptive parents has no legal parents of D293 (Calla is married to Wren and to Dora)', () => {
		const src = [
			'people:',
			'  - {id: wren, name: Wren, sex: f}',
			'  - {id: calla, name: Calla, sex: f}',
			'  - {id: dora, name: Dora, sex: f}',
			'  - {id: quill, name: Quill, sex: f, parents: [wren, {id: calla, type: adoptive}, {id: dora, type: adoptive}]}',
			'  - {id: tess, name: Tess, sex: m, parents: [calla, dora]}',
			'  - {id: sam, name: Sam, sex: m, parents: [wren, calla]}',
			'unions:',
			'  - partners: [wren, calla]',
			'  - partners: [calla, dora]',
		].join('\n');
		check(src, 'tess', 'quill', { ab: 'Adoptive sister', ba: 'Adoptive brother' });
		check(src, 'quill', 'sam', {
			ab: 'Half-brother, maybe full | Adoptive half-brother',
			ba: 'Half-sister, maybe full | Adoptive half-sister',
			off: { ab: 'Half-brother | Adoptive half-brother', ba: 'Half-sister | Adoptive half-sister' },
		});
	});

	it('the words do not depend on the order of the people or of the parents', () => {
		const people = [PIA, FENN, '{id: y, name: Yan, sex: m, parents: [calla, wren]}', '{id: z, name: Zed, sex: m, parents: [wren]}'];
		const want = new Map<string, string>();
		const orders = [people, [...people].reverse(), [people[2], people[0], people[3], people[1]], [people[1], people[3], people[0], people[2]]];
		for (const list of orders) {
			for (const [name, options] of SETTINGS) {
				const g = graphOf(block(list));
				for (const me of ['pia', 'fenn', 'y', 'z']) {
					const rel = computeRelations(g, me, options);
					for (const other of ['pia', 'fenn', 'y', 'z']) {
						if (me === other) continue;
						const key = `${name} ${me} ${other}`;
						const text = (rel.get(other) ?? []).map(cardRelationText).join(' | ');
						if (want.has(key)) expect(text, key).toBe(want.get(key));
						else want.set(key, text);
					}
				}
			}
		}
		expect(want.get('on pia fenn')).toBe('Adoptive brother');
		expect(want.get('off fenn y')).toBe('Brother');
	});

	it('the finder shows the adoptive links when the name is adoptive, and the birth links when it is Brother', () => {
		const g = graphOf(block([PIA, FENN, '{id: y, name: Yan, sex: m, parents: [wren, calla]}']));
		for (const [, options] of SETTINGS) {
			const adoptive = findRelation(g, 'pia', 'fenn', options);
			expect(adoptive.kind).toBe('named');
			if (adoptive.kind !== 'named') return;
			expect(stepSentences(g, adoptive.relations[0].steps).shown).toEqual(['Calla is Pia’s adoptive mother.', 'Wren is Calla’s wife.', 'Fenn is Wren’s adopted son.']);
			const sibling = findRelation(g, 'pia', 'y', options);
			if (sibling.kind !== 'named') throw new Error('expected a name');
			expect(stepSentences(g, sibling.relations[0].steps).shown).toEqual(['Wren is Pia’s mother.', 'Calla is Wren’s wife.', 'Yan is Calla’s son.']);
		}
	});
});

describe('D293: the two helpers', () => {
	const share = (a: number, b: number) => (a === 0 && b === 1) || (a === 1 && b === 0);

	it('legalParents joins one birth parent and an adoptive partner, in the order of the links', () => {
		const links = [{ p: 0, type: 'birth' as const }, { p: 1, type: 'adoptive' as const }];
		expect(legalParents(links, 'birth', share)).toEqual([0, 1]);
		expect(legalParents(links, 'adoptive', share)).toEqual([0, 1]);
		expect(legalParents([...links].reverse(), 'birth', share)).toEqual([1, 0]);
	});

	it('legalParents gives nothing for other links, other parents or other counts', () => {
		const links = [{ p: 0, type: 'birth' as const }, { p: 1, type: 'adoptive' as const }];
		expect(legalParents(links, 'rumoured', share)).toBeUndefined();
		expect(legalParents(links, 'ward', share)).toBeUndefined();
		expect(legalParents(links, 'birth', () => false)).toBeUndefined();
		expect(legalParents([...links, { p: 2, type: 'birth' as const }], 'birth', share)).toBeUndefined();
		expect(legalParents([{ p: 0, type: 'birth' as const }], 'birth', share)).toBeUndefined();
		expect(legalParents([{ p: 0, type: 'birth' as const }, { p: 0, type: 'adoptive' as const }], 'birth', share)).toBeUndefined();
		expect(legalParents([...links, { p: 3, type: 'adoptive' as const }], 'birth', share)).toBeUndefined();
	});

	it('orderCouple puts the parent with the best links first, then the parent whose line shows the worse link', () => {
		const flat = () => 0;
		expect(orderCouple([5, 6], flat, flat)).toEqual([5, 6]);
		expect(orderCouple([5, 6], (v) => (v === 5 ? 1 : 0), (v) => (v === 5 ? 0 : 0))).toEqual([6, 5]);
		// Both parents tie at 1: the first child links to 5 by 0 and to 6 by 1, the second the other way round.
		const r1 = (v: number) => (v === 5 ? 0 : 1);
		const r2 = (v: number) => (v === 5 ? 1 : 0);
		expect(orderCouple([5, 6], r1, r2)).toEqual([6, 5]);
		expect(orderCouple([6, 5], r1, r2)).toEqual([6, 5]);
		expect(orderCouple([5], r1, r2)).toEqual([5]);
	});
});
