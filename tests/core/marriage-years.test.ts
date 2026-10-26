/*
 * Version 0.5 step 1a-B: `MarriageYears` (ENDED, APART, FORMER with F4, the verdict of a word) and the cache key of the words
 * (`relationsKey`): an internal study §A, §3, §4, §6 and §9 ruling 5.
 */

import { describe, expect, it } from 'vitest';
import { compileCalendars } from '../../src/core/dates';
import type { FamilyGraph, FamilyUnion } from '../../src/core/derive';
import { MarriageYears } from '../../src/core/marriage-years';
import { computeRelations, lineSubgraph, relationsKey } from '../../src/core/relations';
import { CYCLES, graphOf, p, treeF, treeN, w, wordsOf, type Tree, type Wed } from './r05-marriage-years-trees';

/** A and B marry; `died` are their death texts. Returns the years of the graph and the one marriage. */
function pair(union: Omit<Wed, 'partners'>, died: [string?, string?] = ['1170', '1175'], born: [string?, string?] = ['1100', '1102']): { y: MarriageYears; u: FamilyUnion; g: FamilyGraph } {
	const tree: Tree = { people: [p('a', 'm', born[0], died[0]), p('b', 'f', born[1], died[1])], unions: [w('a', 'b', union)] };
	const g = graphOf(tree);
	return { y: new MarriageYears(g), u: g.unions[0], g };
}

describe('ENDED (RULES §A and §4)', () => {
	it('a divorce or an annulment ends the marriage with no year, in any case, and the aliases too', () => {
		for (const word of ['divorce', 'Divorce', ' DIVORCE ', 'annulment', 'divorced', 'annulled']) {
			const { y, u } = pair({ endedBy: word }, [undefined, undefined]);
			expect(y.ended(u), word).toBe(true);
		}
	});
	it('a value that is not in the list, or no value, gives no end by itself', () => {
		for (const word of ['separation', 'constructor', '__proto__', '', 'ended']) expect(pair({ endedBy: word }, [undefined, undefined]).y.ended(pair({ endedBy: word }, [undefined, undefined]).u), word).toBe(false);
	});
	it('the fallback: an exact end year before both exact death years', () => {
		const { y, u } = pair({ end: '1130' });
		expect(y.ended(u)).toBe(true);
	});
	it('the fallback needs both deaths, exact, and an end strictly before each', () => {
		expect(pair({ end: '1130' }, ['1170', undefined]).y.ended(pair({ end: '1130' }, ['1170', undefined]).u)).toBe(false);
		expect(pair({ end: '1130' }, ['1170', 'c. 1175']).y.ended(pair({ end: '1130' }, ['1170', 'c. 1175']).u)).toBe(false);
		expect(pair({ end: '1170' }).y.ended(pair({ end: '1170' }).u)).toBe(false);
		expect(pair({ end: '1175' }).y.ended(pair({ end: '1175' }).u)).toBe(false);
		expect(pair({ end: 'c. 1130' }).y.ended(pair({ end: 'c. 1130' }).u)).toBe(false);
		expect(pair({ end: 'after 1130' }).y.ended(pair({ end: 'after 1130' }).u)).toBe(false);
	});
	it('`ended-by: death` stops the fallback; an explicit divorce wins over the dates', () => {
		const dead = pair({ end: '1130', endedBy: 'death' });
		expect(dead.y.ended(dead.u)).toBe(false);
		const late = pair({ end: '1180', endedBy: 'divorce' });
		expect(late.y.ended(late.u)).toBe(true);
	});
	it('a living partner (`died: no`) gives no fallback (known limit)', () => {
		const { y, u } = pair({ end: '1130' }, ['alive', 'no']);
		expect(y.ended(u)).toBe(false);
	});
	it('allEnded needs a marriage and every one ended', () => {
		const { y, u } = pair({ endedBy: 'divorce' });
		expect(y.allEnded([])).toBe(false);
		expect(y.allEnded([u])).toBe(true);
		const open = pair({});
		expect(y.allEnded([u, open.u])).toBe(false);
	});
});

describe('APART (RULES §A)', () => {
	it('the marriage ended before K was born, or began after K died, by exact years', () => {
		// A (1100) and B (1102) marry 1120 to 1130; deaths 1170 and 1175.
		const k = graphOf({ people: [p('a', 'm', '1100', '1170'), p('b', 'f', '1102', '1175'), p('k1', 'f', '1135'), p('k2', 'f', '1125'), p('k3', 'f', '1100', '1110'), p('k4', 'f', undefined, '1119')], unions: [w('a', 'b', { start: '1120', end: '1130' })] });
		const yy = new MarriageYears(k);
		const uu = k.unions[0];
		expect(yy.apart(uu, 'k1')).toBe(true);
		expect(yy.apart(uu, 'k2')).toBe(false);
		expect(yy.apart(uu, 'k3')).toBe(true);
		expect(yy.apart(uu, 'k4')).toBe(true);
	});
	it('equal years never decide, and a side with a missing year does not count', () => {
		const k = graphOf({ people: [p('a', 'm', '1100', '1170'), p('b', 'f', '1102', '1175'), p('k1', 'f', '1130'), p('k2', 'f', undefined, '1120'), p('k3', 'f')], unions: [w('a', 'b', { start: '1120', end: '1130' })] });
		const y = new MarriageYears(k);
		const u = k.unions[0];
		expect(y.apart(u, 'k1')).toBe(false);
		expect(y.apart(u, 'k2')).toBe(false);
		expect(y.apart(u, 'k3')).toBe(false);
	});
	it('with no years at all nothing is apart', () => {
		const { y, u } = pair({}, [undefined, undefined], [undefined, undefined]);
		expect(y.apart(u, 'a')).toBe(false);
	});
	it('the least year of the end and both deaths counts as the end, the greatest of the start and both births as the start', () => {
		// The end is 1180, but A died in 1150: the marriage cannot last beyond 1150.
		const k = graphOf({ people: [p('a', 'm', '1100', '1150'), p('b', 'f', '1102', '1175'), p('k1', 'f', '1155')], unions: [w('a', 'b', { start: '1120', end: '1180' })] });
		expect(new MarriageYears(k).apart(k.unions[0], 'k1')).toBe(true);
		// No start: B was born in 1102, so the marriage began in 1102 at the earliest; K died in 1101.
		const j = graphOf({ people: [p('a', 'm', '1100', '1150'), p('b', 'f', '1102', '1175'), p('k1', 'f', '1090', '1101')], unions: [w('a', 'b', {})] });
		expect(new MarriageYears(j).apart(j.unions[0], 'k1')).toBe(true);
	});
});

describe('FORMER and F4 (D309)', () => {
	const tess = (tessDied?: string) => {
		const g = graphOf(treeN({ tessDied }));
		return { y: new MarriageYears(g), u: g.unions[0] };
	};
	it('a divorce that no one died before: former', () => {
		const { y, u } = tess();
		expect(y.former(u, ['tess'])).toBe(true);
		expect(y.former(u, ['pip', 'tess'])).toBe(true);
	});
	it('the blood-side person died before the exact end year: no "former"', () => {
		const { y, u } = tess('1145');
		expect(y.former(u, ['tess'])).toBe(false);
		expect(y.former(u, ['pip', 'tess'])).toBe(false);
		expect(y.former(u, ['pip'])).toBe(true);
	});
	it('a death in the year of the end, or after it, keeps "former"', () => {
		expect(tess('1150').y.former(tess('1150').u, ['tess'])).toBe(true);
		expect(tess('1160').y.former(tess('1160').u, ['tess'])).toBe(true);
	});
	it('a death with no exact year, or an end with no exact year, keeps "former"', () => {
		expect(tess('c. 1145').y.former(tess('c. 1145').u, ['tess'])).toBe(true);
		const g = graphOf({ people: [p('a', 'm'), p('b', 'f'), p('c', 'f', undefined, '1100')], unions: [w('a', 'b', { end: 'c. 1150', endedBy: 'divorce' })] });
		expect(new MarriageYears(g).former(g.unions[0], ['c'])).toBe(true);
	});
	it('a marriage that is not ended is never former', () => {
		const { y, u } = pair({});
		expect(y.former(u, ['a'])).toBe(false);
	});
});

describe('the verdict of a word', () => {
	const g = graphOf({
		people: [p('a', 'm', '1100', '1170'), p('b', 'f', '1102', '1175'), p('early', 'f', '1115'), p('late', 'f', '1140')],
		unions: [w('a', 'b', { start: '1120', end: '1130', endedBy: 'divorce' })],
	});
	const y = new MarriageYears(g);
	const us = g.unions;
	it('a step word holds if the marriage may overlap the life; "former" if the marriage is former', () => {
		expect(y.verdict(us, 'step', ['early'], ['early'])).toEqual([true, true]);
	});
	it('a step word that fails is the possessive form, "former" if every marriage ended', () => {
		expect(y.verdict(us, 'step', ['late'], ['late'])).toEqual([false, true]);
	});
	it('a step word holds if one of several people passes (the set, never the first)', () => {
		expect(y.verdict(us, 'step', ['late'], ['late', 'early'])).toEqual([true, true]);
		expect(y.verdict(us, 'step', ['late'], ['early', 'late'])).toEqual([true, true]);
	});
	it('a marriage that is not former makes the step word plain', () => {
		const open = graphOf({ people: [p('a', 'm'), p('b', 'f'), p('k', 'f', '1130')], unions: [w('a', 'b', {})] });
		expect(new MarriageYears(open).verdict(open.unions, 'step', ['k'], ['k'])).toEqual([true, false]);
	});
	it('a named word reads every marriage; a possessive reads ended only', () => {
		expect(y.verdict(us, 'named', ['late'])).toEqual([true, true]);
		expect(y.verdict(us, 'possessive', ['late'])).toEqual([true, true]);
		const dead = graphOf({ people: [p('a', 'm'), p('b', 'f'), p('t', 'f', undefined, '1125')], unions: [w('a', 'b', { end: '1130', endedBy: 'divorce' })] });
		const z = new MarriageYears(dead);
		expect(z.verdict(dead.unions, 'named', ['t'])).toEqual([true, false]);
		expect(z.verdict(dead.unions, 'possessive', ['t'])).toEqual([true, true]);
	});
});

describe('the reader that is not ready: years do not count, ended-by does (RULES §5.1)', () => {
	const tree = (union: Omit<Wed, 'partners'>) => treeF(union);
	it('the fallback waits for the calendar; the key does not', () => {
		const g = graphOf(tree({ start: '1120', end: '1130' }), compileCalendars([CYCLES], false));
		expect(wordsOf(g, 'fa', 'fb')).toBe('Wife');
		expect(wordsOf(graphOf(tree({ start: '1120', end: '1130', endedBy: 'divorce' }), compileCalendars([CYCLES], false)), 'fa', 'fb')).toBe('Former wife');
	});
	it('no step word is removed while the reader is not ready', () => {
		const g = graphOf(tree({ start: '1120', end: '1130', endedBy: 'death' }), compileCalendars([CYCLES], false));
		expect(wordsOf(g, 'fd', 'fb')).toBe('Stepmother');
	});
});

describe('the key of the words (RULES §6, §9 ruling 5)', () => {
	const f = (union: Omit<Wed, 'partners'>, more: Partial<Tree> = {}): FamilyGraph => graphOf({ ...treeF(union), ...more });
	const key = (g: FamilyGraph) => relationsKey(g, 'fa');
	it('a change of only `ended-by` makes a new key and a new card word', () => {
		const open = f({ start: '1120' });
		const divorced = f({ start: '1120', endedBy: 'divorce' });
		expect(key(open)).not.toBe(key(divorced));
		expect(wordsOf(open, 'fa', 'fb')).toBe('Wife');
		expect(wordsOf(divorced, 'fa', 'fb')).toBe('Former wife');
		expect(computeRelations(divorced, 'fa').get('fb')?.[0].text).toBe('Former wife');
	});
	it('the key reads the meaning of `ended-by`, not the spelling', () => {
		expect(key(f({ endedBy: 'divorce' }))).toBe(key(f({ endedBy: ' Divorced ' })));
		expect(key(f({ endedBy: 'separation' }))).toBe(key(f({})));
		expect(key(f({ endedBy: 'death' }))).not.toBe(key(f({})));
		expect(key(f({ endedBy: 'annulment' }))).not.toBe(key(f({ endedBy: 'divorce' })));
	});
	it('a change of `start`, `end`, `born` or `died` makes a new key', () => {
		const base = f({ start: '1120', end: '1130' });
		expect(key(f({ start: '1121', end: '1130' }))).not.toBe(key(base));
		expect(key(f({ start: '1120', end: '1131' }))).not.toBe(key(base));
		expect(key(f({ start: '1120', end: '1130' }, { people: treeF({}).people.map((x) => (x.id === 'fa' ? { ...x, died: '1171' } : x)) }))).not.toBe(key(base));
		expect(key(f({ start: '1120', end: '1130' }, { people: treeF({}).people.map((x) => (x.id === 'fc' ? { ...x, born: '1126' } : x)) }))).not.toBe(key(base));
	});
	it('an identical tree keeps the key', () => {
		const base = f({ start: '1120' });
		expect(key(f({ start: '1120' }))).toBe(key(base));
	});
	it('the readiness and the key of the reader are in the key', () => {
		const tree = treeF({ start: '1120', end: '1130' });
		expect(relationsKey(graphOf(tree, compileCalendars([CYCLES], false)), 'fa')).not.toBe(relationsKey(graphOf(tree, compileCalendars([CYCLES], true)), 'fa'));
		expect(relationsKey(graphOf(tree, compileCalendars([CYCLES], true)), 'fa')).not.toBe(relationsKey(graphOf(tree), 'fa'));
	});
});

describe('lineSubgraph keeps `ended-by` (RULES §9 ruling 3)', () => {
	it('the small tree of a line has the key of the marriage', () => {
		const g = graphOf(treeF({ start: '1120', endedBy: 'annulment' }));
		const sub = lineSubgraph(g, { people: ['fa', 'fb'], links: [], unions: ['u0'] });
		expect(sub.unions.map((u) => u.endedBy)).toEqual(['annulment']);
	});
});
