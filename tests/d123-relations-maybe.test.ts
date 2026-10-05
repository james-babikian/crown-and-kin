import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, relationRunStats, type Relation } from '../src/core/relations';
import { cardRelationText, MAYBE_TEXT, relationSummary, spokenRelation } from '../src/render/tree-info';
import { relationsFor, clearRelationCache } from '../src/obsidian/relation-cache';
import { build, fixture } from './helpers';

// D123 (spec §13.1 and §13.19 rule 6): what a rumoured parent could change in a blood relation.
// All names in this file are made up.

/** Compact lines "id sex parent[:type]…". */
function tree(people: string[], me?: string): FamilyGraph {
	const out = me ? [`options:`, `  me: ${me}`, 'people:'] : ['people:'];
	for (const line of people) {
		const [id, sex, ...parents] = line.split(' ');
		out.push(`  - id: ${id}`, `    name: ${id}`);
		if (sex !== '-') out.push(`    sex: ${sex}`);
		if (parents.length) {
			const refs = parents.map((p) => {
				const [pid, type] = p.split(':');
				return type ? `{id: ${pid}, type: ${type}}` : pid;
			});
			out.push(`    parents: [${refs.join(', ')}]`);
		}
	}
	const r = parseDynasty(out.join('\n') + '\n');
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

const rels = (g: FamilyGraph, id: string, me = 'E'): readonly Relation[] => computeRelations(g, me).get(id) ?? [];
const names = (g: FamilyGraph, id: string, me = 'E') => rels(g, id, me).map((r) => r.text);

const base = ['M f', 'R m', 'F m', 'E m M R:rumoured', 'G m R M', 'A m F M'];
const a = tree([...base, 'S f M R:rumoured']);
const b = tree([...base, 'S f M']);
const c = tree([...base, 'S f M R']);
const d = tree([...base, 'Q m', 'S f M Q:rumoured']);

describe('D123: cards and sheet words (contract 2.2 and 2.4)', () => {
	it('case a: the card of the half-brother says ", maybe full"; the maybe is full with the name Brother', () => {
		const g = rels(a, 'G');
		expect(g[0].text).toBe('Half-brother');
		expect(g[0].maybe).toEqual({ effect: 'full', text: 'Brother', lower: 'brother' });
		expect(cardRelationText(g[0])).toBe('Half-brother, maybe full');
		expect(cardRelationText(g[0])).toBe(`${g[0].text}${MAYBE_TEXT.cardFull}`);
		expect(spokenRelation(g[0])).toBe('half-brother, or brother if the rumoured links are true');
	});
	it('case a: the rumoured line says brother, not half-brother', () => {
		expect(names(a, 'G')).toEqual(['Half-brother', 'Rumoured brother']);
	});
	it('case a: A (no rumoured link at all) and S (full by sure and by rumoured parents) get no maybe', () => {
		expect(rels(a, 'A')[0].maybe).toBeUndefined();
		expect(rels(a, 'S')[0].maybe).toBeUndefined();
	});
	it('case b (no father listed for S): Sister, no maybe, no extra name', () => {
		expect(names(b, 'S')).toEqual(['Sister']);
		expect(rels(b, 'S')[0].maybe).toBeUndefined();
	});
	it('case c: Half-sister, maybe full', () => {
		const s = rels(c, 'S');
		expect(s[0].text).toBe('Half-sister');
		expect(s[0].maybe).toEqual({ effect: 'full', text: 'Sister', lower: 'sister' });
		expect(names(c, 'S')).toEqual(['Half-sister', 'Rumoured sister']);
		expect(cardRelationText(s[0])).toBe('Half-sister, maybe full');
	});
	it('case d: Sister with maybe half; the list holds Rumoured half-sister; the card and the spoken text add nothing', () => {
		const s = rels(d, 'S');
		expect(s[0].text).toBe('Sister');
		expect(s[0].maybe).toEqual({ effect: 'half', text: 'Half-sister', lower: 'half-sister' });
		expect(s.map((r) => r.text)).toEqual(['Sister', 'Rumoured half-sister']);
		expect(cardRelationText(s[0])).toBe('Sister');
		expect(spokenRelation(s[0])).toBe('sister');
	});
	it("case c': no rumoured link, no maybe anywhere", () => {
		const c2 = tree(['M f', 'R m', 'F m', 'E m F M', 'G m R M', 'A m F M', 'S f F M']);
		for (const id of ['G', 'A', 'S']) for (const r of rels(c2, id)) expect(r.maybe).toBeUndefined();
	});
	it('the sheet: the maybe paragraph comes from the first relation only; the Also list prints r.lower', () => {
		const g = rels(a, 'G');
		expect(relationSummary(g, false)).toEqual({
			main: 'Relation to you: Half-brother.',
			also: 'Also: rumoured brother.',
			maybe: 'If every rumoured link is true, this person is your brother.',
		});
		const s = rels(d, 'S');
		expect(relationSummary(s, false).maybe).toBe('If every rumoured link is true, this person is your half-sister.');
		expect(relationSummary(rels(b, 'S'), false).maybe).toBeUndefined();
		expect(relationSummary(undefined, false).maybe).toBeUndefined();
		expect(relationSummary(g, true).maybe).toBeUndefined();
	});
	it('the sheet: a maybe on a later relation gives no paragraph', () => {
		const g = rels(a, 'G');
		const swapped = [{ ...g[1] }, g[0]];
		expect(relationSummary(swapped, false).maybe).toBeUndefined();
	});
	it('the card map of the relation cache holds only { text, lower }', () => {
		clearRelationCache();
		const g = a;
		const out = relationsFor(g, 'E');
		expect(out.cards.get('G')).toEqual({ text: 'Half-brother, maybe full', lower: 'half-brother, or brother if the rumoured links are true' });
		expect(out.cards.get('A')).toEqual({ text: 'Half-brother', lower: 'half-brother' });
		expect(Object.keys(out.cards.get('G')!).sort()).toEqual(['lower', 'text']);
		clearRelationCache();
	});
});

describe('D123: the oracle is not "every rumoured parent becomes birth" (gate proofs)', () => {
	const caseB = ['M f', 'R m', 'F m', 'E m M R:rumoured', 'G m R M', 'A m F M', 'S f M'];
	it('case b says Sister (the oracle with rumoured links as birth links must also say Sister)', () => {
		const asBirth = tree(caseB.map((l) => l.replace(':rumoured', '')));
		expect(names(tree(caseB), 'S')).toEqual(['Sister']);
		expect(names(asBirth, 'S')).toEqual(['Half-sister']);
	});
	const cousins = ['g1 m', 'g2 f', 'g3 f', 'g4 m', 'g5 m', 'f1 m g1 g2', 'f2 m g1 g2', 'm1 f g3 g4', 'm2 f g3 g5', 'E m f1 m1', 'P m f2 m2'];
	it('cousins: First cousin and Half first cousin, with no rumour', () => {
		expect(names(tree(cousins), 'P')).toEqual(['First cousin', 'Half first cousin']);
	});
	it('cousins with ONE unrelated rumoured link in the ancestry: still no maybe, no Rumoured entry', () => {
		const variants = [
			[...cousins, 'Z m', 'g6 m Z:rumoured', 'E2 m f1 g6:rumoured'],
			[...cousins, 'Z m', 'm3 f g3 Z:rumoured'],
			[...cousins.filter((l) => !l.startsWith('g1 ')), 'Z m', 'g1 m Z:rumoured'],
			[...cousins.filter((l) => !l.startsWith('P ')), 'Z m', 'm3 f g3 g5 Z:rumoured', 'P m f2 m3'],
			[...cousins.filter((l) => !l.startsWith('g5 ')), 'Z m', 'g5 m g1:rumoured'],
		];
		for (const rows of variants) {
			const list = rels(tree(rows), 'P');
			expect(list.map((r) => r.text).filter((t) => /^Rumoured/.test(t))).toEqual([]);
			for (const r of list) expect(r.maybe).toBeUndefined();
		}
	});
});

describe('D123: a double relation and a by-marriage name never get a maybe', () => {
	it('double first cousins whose parents have different rumoured parents: Double first cousin, no maybe', () => {
		const rows = ['g1 m', 'g2 f', 'g3 f', 'g4 m', 'Z m', 'Y m', 'f1 m g1 g2 Z:rumoured', 'f2 m g1 g2 Y:rumoured', 'm1 f g3 g4', 'm2 f g3 g4', 'E m f1 m1', 'P m f2 m2'];
		for (const order of [rows, [...rows].reverse()]) {
			const list = rels(tree(order), 'P');
			expect(list[0].text).toBe('Double first cousin');
			for (const r of list) expect(r.maybe).toBeUndefined();
		}
	});
	it('a by-marriage name has no maybe', () => {
		const src = [
			'options:',
			'  me: E',
			'people:',
			'  - {id: M, name: M, sex: f}',
			'  - {id: R, name: R, sex: m}',
			'  - {id: E, name: E, sex: m, parents: [M, {id: R, type: rumoured}]}',
			'  - {id: G, name: G, sex: m, parents: [R, M]}',
			'  - {id: W, name: W, sex: f}',
			'unions:',
			'  - {partners: [G, W], type: marriage}',
		].join('\n');
		const parsed = parseDynasty(src + '\n');
		if (!parsed.ok) throw new Error(parsed.error.code);
		const w = rels(deriveFamilies(parsed.tree), 'W');
		expect(w[0].kind).toBe('by-marriage');
		for (const r of w) expect(r.maybe).toBeUndefined();
	});
});

describe('D123: equal names merge and keep the maybe, in both person orders', () => {
	// P is a half first cousin of E through two routes. Route 1 (grandparent g1): f2 has g1 (sure) and g2 (rumoured), f1 has g1 and g2,
	// so the pair is half and the rumour would make it full. Route 2 (grandparent g3): m1 and m2 share only g3, no rumour.
	const rows = ['g1 m', 'g2 f', 'g3 f', 'g4 m', 'g5 m', 'f1 m g1 g2', 'f2 m g1 g2:rumoured', 'm1 f g3 g4', 'm2 f g3 g5', 'E m f1 m1', 'P m f2 m2'];
	const check = (g: FamilyGraph) => {
		const list = rels(g, 'P');
		const half = list.filter((r) => r.lower === 'half first cousin');
		expect(half).toHaveLength(1);
		expect(half[0].maybe).toEqual({ effect: 'full', text: 'First cousin', lower: 'first cousin' });
		expect(list[0]).toBe(half[0]);
		expect(list.map((r) => r.text)).toContain('Rumoured first cousin');
		const found = findRelation(g, 'E', 'P');
		if (found.kind !== 'named') throw new Error('named');
		expect(found.relations.filter((x) => x.relation.lower === 'half first cousin').map((x) => x.relation.maybe)).toEqual([half[0].maybe]);
	};
	it('document order 1', () => check(tree(rows)));
	it('document order 2 (the route without a rumour comes first)', () => {
		const reorder = ['g3 f', 'g4 m', 'g5 m', 'g1 m', 'g2 f', 'm1 f g3 g4', 'm2 f g3 g5', 'f1 m g1 g2', 'f2 m g1 g2:rumoured', 'E m f1 m1', 'P m f2 m2'];
		check(tree(reorder));
	});
	it('reverse person order', () => check(tree([...rows].reverse())));
});

describe('D123: findRelation equals computeRelations (both builders)', () => {
	const trees: [string, FamilyGraph][] = [
		['a', a],
		['b', b],
		['c', c],
		['d', d],
		['fixture 4', build(fixture('04')).g],
		['fixture 8', build(fixture('08')).g],
		['fixture 12', build(fixture('12')).g],
	];
	for (const [label, g] of trees) {
		it(`${label}: every ordered pair gives the same names, kinds and maybe`, () => {
			const ids = g.people.map((p) => p.id);
			for (const first of ids) {
				const all = computeRelations(g, first);
				for (const second of ids) {
					if (first === second) continue;
					const found = findRelation(g, first, second);
					const want = all.get(second);
					if (found.kind !== 'named') {
						expect(want === undefined || want.length === 0).toBe(true);
						continue;
					}
					expect(found.relations.map((x) => [x.relation.text, x.relation.lower, x.relation.kind, x.relation.distance, x.relation.maybe])).toEqual(
						want!.map((x) => [x.text, x.lower, x.kind, x.distance, x.maybe]),
					);
				}
			}
		});
	}
});

describe('D123: the finder step word of a sibling step with a rumoured link', () => {
	it('case a: through R the step says "rumoured brother", not "rumoured half-brother"', () => {
		const found = findRelation(a, 'E', 'G');
		if (found.kind !== 'named') throw new Error('named');
		const words = found.relations.map((x) => x.steps.map((s) => s.word));
		expect(words).toEqual([['half-brother'], ['rumoured brother']]);
	});
	it('case c: E (rumoured R) and S (birth R) through R: rumoured sister', () => {
		const found = findRelation(c, 'E', 'S');
		if (found.kind !== 'named') throw new Error('named');
		expect(found.relations.map((x) => x.steps.map((s) => s.word))).toEqual([['half-sister'], ['rumoured sister']]);
	});
	it('case d: E (rumoured R) and S (rumoured Q): both names show the sure line, so both steps say sister', () => {
		const found = findRelation(d, 'E', 'S');
		if (found.kind !== 'named') throw new Error('named');
		expect(found.relations.map((x) => x.relation.lower)).toEqual(['sister', 'rumoured half-sister']);
		expect(found.relations.map((x) => x.steps.map((s) => s.word))).toEqual([['sister'], ['sister']]);
	});
	it('a step with no rumoured link keeps the sure half word', () => {
		const found = findRelation(b, 'E', 'G');
		if (found.kind !== 'named') throw new Error('named');
		expect(found.relations[0].steps.map((s) => s.word)).toEqual(['half-brother']);
	});
});

describe('D123: the second comparison runs only where a rumoured link lies in the ancestry', () => {
	it('a tree with no rumoured link: zero extra work', () => {
		const g = build(fixture('03')).g;
		relationRunStats.second = 0;
		for (const p of g.people) computeRelations(g, p.id);
		expect(relationRunStats.second).toBe(0);
		const cousins = tree(['g1 m', 'g2 f', 'g3 f', 'g4 m', 'g5 m', 'f1 m g1 g2', 'f2 m g1 g2', 'm1 f g3 g4', 'm2 f g3 g5', 'E m f1 m1', 'P m f2 m2']);
		for (const p of cousins.people) computeRelations(cousins, p.id);
		findRelation(cousins, 'E', 'P');
		expect(relationRunStats.second).toBe(0);
	});
	it('a tree with a rumoured link counts the comparisons', () => {
		relationRunStats.second = 0;
		computeRelations(a, 'E');
		expect(relationRunStats.second).toBeGreaterThan(0);
	});
	it('a pair whose ancestry has no rumoured link is not compared, though the tree has one', () => {
		const g = tree(['g1 m', 'g2 f', 'x1 m g1 g2', 'x2 m g1 g2', 'Z m', 'Y m', 'W m Z:rumoured']);
		relationRunStats.second = 0;
		computeRelations(g, 'x1');
		expect(relationRunStats.second).toBe(0);
	});
});

// A small seeded generator.
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

describe('D123: random trees against an independent brute force (rules 1 to 5)', () => {
	// Children C0..Cn of up to four parents. For every pair (me, p) and every common parent X, the sets S (birth parents), R (rumoured
	// parents) and the two comparisons are worked out here, with no use of the plugin's search.
	type Kid = { id: string; sex: string; parents: { id: string; type: 'birth' | 'rumoured' }[] };
	const sib = (sex: string, half: boolean) => `${half ? 'half-' : ''}${sex === 'm' ? 'brother' : sex === 'f' ? 'sister' : 'sibling'}`;
	function expected(kids: Kid[], me: Kid, p: Kid): Map<string, 'full' | 'half' | undefined> {
		const out = new Map<string, 'full' | 'half' | undefined>();
		const idsOf = (k: Kid, t: 'birth' | 'rumoured') => k.parents.filter((x) => x.type === t).map((x) => x.id);
		const sure = (k: Kid) => [...idsOf(k, 'birth')].sort().join(',');
		const all = (k: Kid) => k.parents.map((x) => x.id).sort().join(',');
		const rum = (k: Kid) => idsOf(k, 'rumoured').sort().join(',');
		const add = (name: string, effect?: 'full' | 'half') => {
			if (!out.has(name)) out.set(name, effect);
			else if (effect && (out.get(name) === undefined || (effect === 'full' && out.get(name) === 'half'))) out.set(name, effect);
		};
		for (const x of me.parents) {
			const link = p.parents.find((y) => y.id === x.id);
			if (!link) continue;
			if (x.type === 'birth' && link.type === 'birth') {
				const half = sure(me) !== sure(p);
				let effect: 'full' | 'half' | undefined;
				if (half && (rum(me) !== '' || rum(p) !== '') && all(me) === all(p)) effect = 'full';
				if (!half && rum(me) !== '' && rum(p) !== '' && rum(me) !== rum(p)) effect = 'half';
				add(sib(p.sex, half), effect);
				if (effect) add(`rumoured ${sib(p.sex, effect === 'full' ? false : true)}`);
			} else {
				add(`rumoured ${sib(p.sex, all(me) !== all(p))}`);
			}
		}
		void kids;
		return out;
	}
	it('300 random trees', () => {
		const rand = rng(20261004);
		let checked = 0;
		let withMaybe = 0;
		for (let round = 0; round < 300; round++) {
			const nParents = 2 + Math.floor(rand() * 3);
			const nKids = 3 + Math.floor(rand() * 4);
			const parents = Array.from({ length: nParents }, (_, i) => `P${i}`);
			const kids: Kid[] = [];
			for (let i = 0; i < nKids; i++) {
				const chosen = parents.filter(() => rand() < 0.55);
				kids.push({
					id: `C${i}`,
					sex: ['m', 'f', '-'][Math.floor(rand() * 3)],
					parents: chosen.map((id) => ({ id, type: rand() < 0.4 ? ('rumoured' as const) : ('birth' as const) })),
				});
			}
			const lines = [...parents.map((id) => `${id} ${rand() < 0.5 ? 'm' : 'f'}`), ...kids.map((k) => `${k.id} ${k.sex} ${k.parents.map((x) => (x.type === 'birth' ? x.id : `${x.id}:rumoured`)).join(' ')}`.trim())];
			const g = tree(lines);
			for (const me of kids) {
				const all = computeRelations(g, me.id);
				for (const other of kids) {
					if (other === me) continue;
					const want = expected(kids, me, other);
					const got = all.get(other.id) ?? [];
					expect(got.map((r) => r.lower).sort(), `round ${round} ${me.id}>${other.id}\n${lines.join('\n')}`).toEqual([...want.keys()].sort());
					for (const r of got) {
						expect(r.maybe?.effect, `round ${round} ${me.id}>${other.id} ${r.lower}\n${lines.join('\n')}`).toBe(want.get(r.lower));
						if (r.maybe) withMaybe++;
					}
					checked++;
				}
			}
		}
		expect(checked).toBeGreaterThan(1000);
		expect(withMaybe).toBeGreaterThan(50);
	});
});

describe('D123: timing with a rumoured link on every person (contract 2.3)', () => {
	/** `gens` rows of `width` people; each person has a couple of the row above as parents, the second link of the type `second`. */
	function dense(second: 'rumoured' | 'birth', gens = 10, width = 40): FamilyGraph {
		const rand = rng(77);
		const lines: string[] = [];
		for (let g = 0; g < gens; g++) {
			for (let i = 0; i < width; i++) {
				const id = `n${g}x${i}`;
				if (g === 0) {
					lines.push(`${id} ${i % 2 ? 'f' : 'm'}`);
					continue;
				}
				const couple = Math.floor(rand() * (width / 2));
				const a1 = `n${g - 1}x${couple * 2}`;
				const a2 = `n${g - 1}x${couple * 2 + 1}`;
				lines.push(`${id} ${i % 2 ? 'f' : 'm'} ${a1} ${second === 'rumoured' ? `${a2}:rumoured` : a2}`);
			}
		}
		return tree(lines);
	}
	const time = (g: FamilyGraph, me: string) => {
		const t = performance.now();
		computeRelations(g, me);
		return performance.now() - t;
	};
	it('at most 2.2 times the birth tree, and under 300 ms', () => {
		const rumoured = dense('rumoured');
		const birth = dense('birth');
		expect(rumoured.people.length).toBe(400);
		const me = 'n9x0';
		time(rumoured, me);
		time(birth, me);
		// Alternate the two trees and keep the best of each, so a pause of the machine hits both.
		let withRumour = Infinity;
		let without = Infinity;
		for (let k = 0; k < 7; k++) {
			withRumour = Math.min(withRumour, time(rumoured, me));
			without = Math.min(without, time(birth, me));
		}
		console.log(`computeRelations, 400 people, rumoured on every person, last row marked: ${withRumour.toFixed(1)} ms; as birth: ${without.toFixed(1)} ms; ratio ${(withRumour / without).toFixed(2)}`);
		expect(withRumour).toBeLessThan(300);
		expect(withRumour).toBeLessThanOrEqual(2.2 * without);
	}, 60_000);
});
