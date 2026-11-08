// The begetter link in the family graph and the edits (spec §0 D332): a side link of its own (never from a union dot, never an implicit
// union, never a placement parent), the edits with the limit by blood, `fullTypes` and the type chip of one link, the picker, the memo
// keys of the relation search, the cache keys, and the small tree of the finder (`lineSubgraph`).
import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParents, type FamilyGraph } from '../../src/core/derive';
import type { EditRefusal, Op } from '../../src/core/edit';
import { familyOf, linkTypeFull, pickerExclusions } from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import { REFUSAL_TEXT } from '../../src/core/refusal-text';
import { Kin } from '../../src/core/relation-kin';
import { computeRelations, findRelation, lineSubgraph, relationsKey } from '../../src/core/relations';
import { applyOp } from '../../src/core/yaml-edit';
import { DEFAULT_LAYOUT_SETTINGS } from '../../src/layout/layout';
import { geometryFor, layoutKey } from '../../src/layout/index';
import { build, fixture } from '../support/helpers';

const P = (id: string, parents = '', sex = ''): string => `  - {id: ${id}, name: ${id}${sex ? `, sex: ${sex}` : ''}${parents ? `, parents: [${parents}]` : ''}}`;
const small = (people: string[], unions: string[] = []): string => `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
const graph = (src: string): FamilyGraph => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
};
const begot = (id: string) => `{id: ${id}, type: begetter}`;

describe('the graph: a begetter link is a side link of its own (D332)', () => {
	it('sample tree 20 has 5 begetter side links, no union key, and no implicit union for a begetter', () => {
		const { g } = build(fixture('20'));
		const links = g.secondary.filter((e) => e.type === 'begetter');
		expect(links.map((e) => [e.child, ...e.parents])).toEqual([
			['ada', 'oswin'],
			['ivo', 'oswin'],
			['linnet', 'oswin'],
			['corin', 'hugo'],
			['rafe', 'esme'],
		]);
		expect(links.every((e) => e.unionKey === undefined)).toBe(true);
		expect(g.unions.filter((u) => u.implicit)).toEqual([]);
		expect(g.placementParents.get('ada')).toEqual(['isaut']);
		expect(g.placementType.get('ada')).toBe('birth');
	});

	it('two begetters with a listed union are two side links, never one from the union dot', () => {
		const g = graph(small([P('a'), P('b'), P('k', `${begot('a')}, ${begot('b')}`)], ['  - {partners: [a, b]}']));
		expect(g.secondary).toEqual([
			{ child: 'k', type: 'begetter', parents: ['a'] },
			{ child: 'k', type: 'begetter', parents: ['b'] },
		]);
		expect(g.unionByKey.get('u0')!.children).toEqual([]);
	});

	it('a child with only begetter links, or begetter and rumoured links, has no placement parent: a root', () => {
		for (const parents of [begot('a'), `${begot('a')}, {id: b, type: rumoured}`, `${begot('a')}, ${begot('b')}`]) {
			const g = graph(small([P('a'), P('b'), P('k', parents)]));
			expect(g.placementParents.get('k'), parents).toEqual([]);
			expect(g.placementType.has('k'), parents).toBe(false);
			expect(g.unions, parents).toEqual([]);
		}
	});

	it('a birth parent and a begetter make no implicit union, so they are no co-parents and no partners in the chain', () => {
		const g = graph(small([P('m'), P('f'), P('k', `m, ${begot('f')}`)]));
		expect(g.unions).toEqual([]);
		expect(computeRelations(g, 'm').get('f')).toBeUndefined();
		const chain = findRelation(g, 'm', 'f');
		expect(chain.kind === 'chain' && chain.steps.map((s) => s.word)).toEqual(['child', 'begetter']);
	});
});

describe('the edits and the limit by blood (D332)', () => {
	const run = (src: string, op: Op) => applyOp(src, op);
	const refusal = (src: string, op: Op): { code: EditRefusal; detail?: string } | null => {
		const out = run(src, op);
		return out.ok ? null : { code: out.code, ...(out.detail ? { detail: out.detail } : {}) };
	};
	const two = small([P('a'), P('b'), P('c'), P('k', 'a, b')]);

	it('Add parent with begetter writes the map form and never a marriage', () => {
		const src = small([P('a'), P('b'), P('k', 'a')]);
		const out = run(src, { kind: 'add-parent', child: 'k', parent: 'b', type: 'begetter' });
		expect(out.ok && out.body).toContain('parents: [a, {id: b, type: begetter}]');
		expect(out.ok && out.body).not.toContain('unions');
		expect(out.ok && out.effects).toBeFalsy();
	});

	it('Add parent refuses a third parent by blood, and one id as birth parent and begetter', () => {
		expect(refusal(two, { kind: 'add-parent', child: 'k', parent: 'c', type: 'begetter' })).toEqual({ code: 'limit' });
		expect(refusal(two, { kind: 'add-parent', child: 'k', parent: 'a', type: 'begetter' })).toEqual({ code: 'bad-value', detail: REFUSAL_TEXT.alreadyBloodParent });
		const one = small([P('a'), P('b'), P('k', begot('a'))]);
		expect(refusal(one, { kind: 'add-parent', child: 'k', parent: 'a', type: 'birth' })).toEqual({ code: 'bad-value', detail: REFUSAL_TEXT.alreadyBloodParent });
		expect(refusal(one, { kind: 'add-parent', child: 'k', parent: 'b', type: 'birth' })).toBeNull();
		// Other types do not count for the limit by blood.
		expect(refusal(two, { kind: 'add-parent', child: 'k', parent: 'c', type: 'adoptive' })).toBeNull();
	});

	it('Add person refuses three parents by blood and one id as birth parent and begetter', () => {
		const src = small([P('a'), P('b'), P('c')]);
		const add = (parents: { id: string; type: 'birth' | 'begetter' | 'adoptive' }[]) => refusal(src, { kind: 'add-person', id: 'k', fields: { name: 'K' }, parents });
		expect(add([{ id: 'a', type: 'birth' }, { id: 'b', type: 'birth' }, { id: 'c', type: 'begetter' }])).toEqual({ code: 'limit' });
		expect(add([{ id: 'a', type: 'birth' }, { id: 'a', type: 'begetter' }])).toEqual({ code: 'bad-value', detail: REFUSAL_TEXT.alreadyBloodParent });
		expect(add([{ id: 'a', type: 'birth' }, { id: 'b', type: 'begetter' }, { id: 'c', type: 'adoptive' }])).toBeNull();
	});

	it('the type change counts the other links: birth ↔ begetter on one link never meets the limit by blood', () => {
		expect(refusal(two, { kind: 'set-parent-type', child: 'k', parent: 'b', from: 'birth', to: 'begetter' })).toBeNull();
		const back = small([P('a'), P('b'), P('k', `a, ${begot('b')}`)]);
		expect(refusal(back, { kind: 'set-parent-type', child: 'k', parent: 'b', from: 'begetter', to: 'birth' })).toBeNull();
		const three = small([P('a'), P('b'), P('c'), P('k', 'a, b, {id: c, type: adoptive}')]);
		expect(refusal(three, { kind: 'set-parent-type', child: 'k', parent: 'c', from: 'adoptive', to: 'begetter' })).toEqual({ code: 'limit' });
		const doubled = small([P('a'), P('k', 'a, {id: a, type: adoptive}')]);
		expect(refusal(doubled, { kind: 'set-parent-type', child: 'k', parent: 'a', from: 'adoptive', to: 'begetter' })).toEqual({ code: 'bad-value', detail: REFUSAL_TEXT.alreadyBloodParent });
	});

	it('fullTypes is for a new parent: 2 parents by blood make birth and begetter full', () => {
		const full = (src: string) => familyOf(graph(src), 'k')!.fullTypes;
		expect(full(two)).toEqual(['birth', 'begetter']);
		expect(full(small([P('a'), P('b'), P('k', `a, ${begot('b')}`)]))).toEqual(['birth', 'begetter']);
		expect(full(small([P('a'), P('b'), P('k', `${begot('a')}, ${begot('b')}`)]))).toEqual(['birth', 'begetter']);
		expect(full(small([P('a'), P('k', 'a')]))).toEqual([]);
		// The same id as birth parent and begetter is one parent by blood.
		expect(full(small([P('a'), P('k', `a, ${begot('a')}`)]))).toEqual([]);
	});

	it('the type chip of one link (linkTypeFull): the changed link is left out', () => {
		const parents = familyOf(graph(two), 'k')!.parents;
		expect(linkTypeFull(parents, parents[1], 'begetter')).toBe(false);
		expect(linkTypeFull(parents, parents[1], 'adoptive')).toBe(false);
		expect(linkTypeFull(parents, parents[1], 'birth')).toBe(false);
		const mixed = familyOf(graph(small([P('a'), P('b'), P('c'), P('k', 'a, b, {id: c, type: adoptive}')])), 'k')!.parents;
		expect(linkTypeFull(mixed, mixed[2], 'begetter')).toBe(true);
		expect(linkTypeFull(mixed, mixed[2], 'birth')).toBe(true);
		expect(linkTypeFull(mixed, mixed[2], 'ward')).toBe(false);
		const doubled = familyOf(graph(small([P('a'), P('k', 'a, {id: a, type: adoptive}')])), 'k')!.parents;
		expect(linkTypeFull(doubled, doubled[1], 'begetter')).toBe(true);
	});

	it('the picker of Add parent leaves out the parents of both blood types for birth and begetter', () => {
		const g = graph(small([P('a'), P('b'), P('c'), P('k', `a, ${begot('b')}, {id: c, type: adoptive}`)]));
		for (const type of ['birth', 'begetter'] as const) expect([...pickerExclusions(g, 'k', 'add-parent', type)].sort(), type).toEqual(['a', 'b', 'k']);
		expect([...pickerExclusions(g, 'k', 'add-parent', 'adoptive')].sort()).toEqual(['c', 'k']);
	});
});

describe('the memo keys of the relation search have room for every parent type (D332)', () => {
	it('the begetter sets of one child never answer for the next child', () => {
		const g = graph(small([P('a'), P('b'), P('c'), P('k1', begot('a')), P('k2', 'b, c')]));
		const kin = new Kin(g, { oneParentUnknown: true });
		const [k1, k2] = [kin.idx.get('k1')!, kin.idx.get('k2')!];
		expect(k2).toBe(k1 + 1);
		expect(kin.parentsOfType(k1, 'begetter').list).toEqual([kin.idx.get('a')]);
		expect(kin.parentsOfType(k2, 'birth').list).toEqual([kin.idx.get('b'), kin.idx.get('c')]);
		expect(kin.incomplete(k1, 'begetter')).toBe(true);
		expect(kin.incomplete(k2, 'birth')).toBe(false);
	});

	it('release drops the memos of the blood sets, as the other memos of a batch, and the next answers stay equal', () => {
		const g = graph(small([P('a'), P('b'), P('k', `a, ${begot('b')}`)]));
		const kin = new Kin(g, { oneParentUnknown: true });
		const k = kin.idx.get('k')!;
		const memos = kin as unknown as { bloodSets: Map<number, unknown>; bloodCountedMemo: Map<number, unknown>; bloodLack: Uint8Array };
		const [set, counted, lacks] = [kin.bloodParents(k), kin.bloodCounted(k), kin.bloodIncomplete(k)];
		expect([memos.bloodSets.size, memos.bloodCountedMemo.size, memos.bloodLack[k]]).toEqual([1, 1, 1]);
		kin.release();
		expect([memos.bloodSets.size, memos.bloodCountedMemo.size, memos.bloodLack[k]]).toEqual([0, 0, 0]);
		expect(kin.bloodParents(k)).not.toBe(set);
		expect([kin.bloodParents(k), kin.bloodCounted(k), kin.bloodIncomplete(k)]).toEqual([set, counted, lacks]);
	});
});

describe('the cache keys carry the link type (D332)', () => {
	it('birth ↔ begetter on one link changes relationsKey and layoutKey', () => {
		const one = graph(small([P('a'), P('b'), P('k', 'a, b')]));
		const other = graph(small([P('a'), P('b'), P('k', `a, ${begot('b')}`)]));
		expect(relationsKey(one, 'a')).not.toBe(relationsKey(other, 'a'));
		const geo = geometryFor(16);
		expect(layoutKey(one, geo, DEFAULT_LAYOUT_SETTINGS, 'f')).not.toBe(layoutKey(other, geo, DEFAULT_LAYOUT_SETTINGS, 'f'));
	});
});

describe('the small tree of the finder (lineSubgraph, D332 §3)', () => {
	const { g } = build(fixture('20'));
	const sub = (from: string, to: string) => {
		const f = findRelation(g, from, to);
		if (f.kind !== 'named') throw new Error('no name');
		return lineSubgraph(g, f.relations[0].relation.line);
	};

	it('Lys → Oswin: Ada hangs from her begetter, with no union and no side link left', () => {
		const s = sub('lys', 'oswin');
		expect(s.placementParents.get('ada')).toEqual(['oswin']);
		expect(s.placementType.get('ada')).toBe('begetter');
		expect(s.secondary).toEqual([]);
		expect(s.unions).toEqual([]);
	});

	it('Ada → Ivo: the sibling line keeps the birth mother and makes no couple with the begetter', () => {
		const s = sub('ada', 'ivo');
		expect(s.people.map((p) => p.id).sort()).toEqual(['ada', 'isaut', 'ivo']);
		expect(s.unions).toEqual([]);
		expect(s.placementParents.get('ivo')).toEqual(['isaut']);
	});

	it('a child linked only by a begetter and a rumoured parent hangs from the begetter; the rumoured link stays a side link', () => {
		const src = small([P('a', '', 'm'), P('b', '', 'm'), P('k', `{id: b, type: rumoured}, ${begot('a')}`, 'm'), P('j', 'b, a', 'm')]);
		const tree = graph(src);
		const line = { people: ['j', 'a', 'k', 'b'], links: [{ parent: 'a', child: 'j', type: 'birth' as const }, { parent: 'a', child: 'k', type: 'begetter' as const }, { parent: 'b', child: 'k', type: 'rumoured' as const }, { parent: 'b', child: 'j', type: 'birth' as const }], unions: [] };
		const s = lineSubgraph(tree, line);
		expect(s.placementParents.get('k')).toEqual(['a']);
		expect(s.placementType.get('k')).toBe('begetter');
		expect(s.secondary).toEqual([{ child: 'k', type: 'rumoured', parents: ['b'] }]);
	});

	it('a begetter link of the line never joins a couple of the line, also when the two share a marriage', () => {
		const src = small([P('m', '', 'f'), P('f', '', 'm'), P('k', `m, ${begot('f')}`, 'm'), P('j', `m, ${begot('f')}`, 'm')], ['  - {partners: [m, f]}']);
		const tree = graph(src);
		const f = findRelation(tree, 'k', 'j');
		expect(f.kind === 'named' && f.relations[0].relation.line).toMatchObject({ people: ['k', 'm', 'j'], unions: [] });
		expect(drawnParents(tree, 'k')).toEqual([
			{ id: 'm', type: 'birth' },
			{ id: 'f', type: 'begetter' },
		]);
	});
});
