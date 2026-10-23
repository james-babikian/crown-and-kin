import { beforeEach, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import {
	RELATION_BUDGET_BYTES,
	RELATION_CACHE_SIZE,
	clearRelationCache,
	estimateRelationBytes,
	moveRelationBlock,
	moveRelationBlocks,
	relationCacheInfo,
	relationStats,
	relationsFor,
	releaseRelations,
} from '../../src/view/relation-cache';
import { genModel, toText } from '../support/r028-gen';
import { desktop, embed, fakeHandle, fakeHost, loadPlugin } from '../acceptance/tree-view-fakes';
import { resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { useFakeDom } from '../support/fake-dom-setup';

// 0.4 WP-3b: the relation lookups are bounded. One block keeps one lookup, the lookups together stay under a size budget (least recently
// used first, never the one just asked for), and a closed view or a renamed note leaves no key behind. The tests count the entries of the
// cache (`relationCacheInfo`); none of them depends on when the garbage collector runs.

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	clearRelationCache();
	relationStats.evicted = 0;
});

function graphOf(text: string): FamilyGraph {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** A small tree; a different `seed` is a different shape, so a different lookup key. */
function small(seed: number, n = 40): { g: FamilyGraph; ids: string[] } {
	const g = graphOf(toText({ ...genModel(seed, { n, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 10 }), options: { me: 'p20' } }));
	return { g, ids: g.people.map((p) => p.id) };
}

const ME = 'p20';
const lookups = () => relationCacheInfo().lookups;

describe('one lookup for each block', () => {
	it('a new lookup of a block takes the older one of the same block out', () => {
		const a = small(1);
		const b = small(2);
		relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		expect(lookups()).toBe(1);
		relationsFor(b.g, ME, undefined, 'n.md\u0000#0');
		expect(lookups()).toBe(1);
		expect(relationStats.evicted).toBe(1);
		// The first tree is a new lookup again.
		const before = relationStats.computed;
		relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		expect(relationStats.computed - before).toBe(1);
		expect(lookups()).toBe(1);
	});

	it('two blocks keep one lookup each', () => {
		const a = small(1);
		const b = small(2);
		relationsFor(a.g, ME, undefined, 'one.md\u0000#0');
		relationsFor(b.g, ME, undefined, 'two.md\u0000#0');
		expect(lookups()).toBe(2);
		expect(relationCacheInfo().blocks.sort()).toEqual(['one.md\u0000#0', 'two.md\u0000#0']);
	});

	it('another mark or another setting of the same block also replaces the lookup', () => {
		const a = small(1);
		relationsFor(a.g, 'p20', { oneParentUnknown: true }, 'n.md\u0000#0');
		relationsFor(a.g, 'p20', { oneParentUnknown: false }, 'n.md\u0000#0');
		relationsFor(a.g, 'p21', { oneParentUnknown: false }, 'n.md\u0000#0');
		expect(lookups()).toBe(1);
	});

	it('the full-screen view and the block share the lookup of an unchanged tree (same block key)', () => {
		const a = small(1);
		const first = relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		const before = relationStats.computed;
		expect(relationsFor(a.g, ME, undefined, 'n.md\u0000#0')).toBe(first);
		expect(relationsFor(graphOf(toText({ ...genModel(1, { n: 40, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 10 }), options: { me: ME } })), ME, undefined, 'n.md\u0000#0')).toBe(first);
		expect(relationStats.computed - before).toBe(0);
		expect(relationStats.evicted).toBe(0);
	});

	it('a sheet or a picker of the block asks with the same key and gets the lookup of the view', () => {
		const a = small(1);
		const view = relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		expect(relationsFor(a.g, ME, undefined, 'n.md\u0000#0')).toBe(view);
		expect(relationsFor(a.g, ME)).toBe(view);
		expect(lookups()).toBe(1);
	});

	it('a block that hits an older lookup of its tree (an undo) takes the newer one out', () => {
		const a = small(1);
		const b = small(2);
		const old = relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		relationsFor(b.g, ME, undefined, 'n.md\u0000#0');
		const again = relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		expect(again).not.toBe(old);
		expect(lookups()).toBe(1);
	});

	it('a lookup that two blocks share goes when the last block leaves it', () => {
		const a = small(1);
		const b = small(2);
		relationsFor(a.g, ME, undefined, 'one.md\u0000#0');
		relationsFor(a.g, ME, undefined, 'two.md\u0000#0');
		expect(lookups()).toBe(1);
		relationsFor(b.g, ME, undefined, 'one.md\u0000#0');
		expect(lookups()).toBe(2);
		relationsFor(b.g, ME, undefined, 'two.md\u0000#0');
		expect(lookups()).toBe(1);
	});
});

describe('callers with no block', () => {
	it('keep the old count: at most RELATION_CACHE_SIZE lookups, the oldest first', () => {
		const g = small(1).g;
		const marks = g.people.slice(0, RELATION_CACHE_SIZE + 3).map((p) => p.id);
		for (const m of marks) relationsFor(g, m);
		expect(lookups()).toBe(RELATION_CACHE_SIZE);
		const before = relationStats.computed;
		relationsFor(g, marks[marks.length - 1]);
		expect(relationStats.computed - before).toBe(0);
		relationsFor(g, marks[0]);
		expect(relationStats.computed - before).toBe(1);
	});

	it('do not push out the lookups of blocks', () => {
		const g = small(1).g;
		relationsFor(g, ME, undefined, 'n.md\u0000#0');
		for (const p of g.people.slice(0, RELATION_CACHE_SIZE + 3)) relationsFor(g, p.id, { oneParentUnknown: false });
		const before = relationStats.computed;
		relationsFor(g, ME, undefined, 'n.md\u0000#0');
		expect(relationStats.computed - before).toBe(0);
	});
});

describe('the size budget', () => {
	it('the estimate follows the measured heap of a lookup (19, 45, 121 and 240 MB at 500, 1 000, 2 000 and 3 000 people, all named)', () => {
		const MB = 1048576;
		const named = { 500: 445, 1000: 840, 2000: 1714, 3000: 2546 } as const;
		const measured = { 500: 19.2, 1000: 44.9, 2000: 121, 3000: 240.1 } as const;
		for (const n of [500, 1000, 2000, 3000] as const) {
			const est = estimateRelationBytes(n, named[n]) / MB;
			expect(est / measured[n]).toBeGreaterThan(0.85);
			expect(est / measured[n]).toBeLessThan(1.2);
		}
		// Two lookups of 1 000 people fit the budget, three do not.
		expect(2 * estimateRelationBytes(1000, 840)).toBeLessThanOrEqual(RELATION_BUDGET_BYTES);
		expect(3 * estimateRelationBytes(1000, 840)).toBeGreaterThan(RELATION_BUDGET_BYTES);
	});

	it('names asked for count: a lookup grows while views ask, and the next ask applies the budget', () => {
		const a = small(1, 60);
		const r = relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		const empty = relationCacheInfo().bytes;
		r.cards.getMany(a.ids);
		expect(relationCacheInfo().bytes).toBeGreaterThan(empty + 10 * 30_000);
	});

	/** Same tree, a different mark each: the lookups are different keys of a tree of `n` people, for block names b0, b1, ... */
	function fill(g: FamilyGraph, marks: string[], blocks: string[]): void {
		marks.forEach((m, i) => relationsFor(g, m, undefined, blocks[i]).cards.getMany(g.people.map((p) => p.id)));
	}

	it('the least recently used lookup goes first when the total is over the budget, and the one just asked for stays', () => {
		const t = small(3, 400);
		const per = estimateRelationBytes(400, 380);
		// Enough blocks to go over the budget, so some must be evicted.
		const count = Math.ceil(RELATION_BUDGET_BYTES / per) + 2;
		const marks = t.ids.slice(0, count);
		expect(marks.length).toBe(count);
		const blocks = marks.map((_, i) => `b${i}.md\u0000#0`);
		for (let i = 0; i < count; i++) {
			relationsFor(t.g, marks[i], undefined, blocks[i]).cards.getMany(t.ids);
			// Block 0 is used again and again, so it is never the least recently used.
			if (i > 0) relationsFor(t.g, marks[0], undefined, blocks[0]);
			const info = relationCacheInfo();
			expect(info.bytes).toBeLessThanOrEqual(RELATION_BUDGET_BYTES);
			expect(info.blocks).toContain(blocks[i]);
			expect(info.blocks).toContain(blocks[0]);
		}
		expect(relationStats.evicted).toBeGreaterThan(0);
		// The block that was asked for first and then never again is the one that went: it works its lookup out again.
		const before = relationStats.computed;
		relationsFor(t.g, marks[1], undefined, blocks[1]);
		expect(relationStats.computed - before).toBe(1);
	});

	it('eviction goes in order of use', () => {
		const t = small(3, 400);
		const per = estimateRelationBytes(400, 380);
		const fit = Math.floor(RELATION_BUDGET_BYTES / per);
		expect(fit).toBeGreaterThanOrEqual(3);
		const marks = t.ids.slice(0, fit + 1);
		const blocks = marks.map((_, i) => `b${i}.md\u0000#0`);
		fill(t.g, marks.slice(0, fit), blocks);
		expect(lookups()).toBe(fit);
		// Block 0 was asked first; ask it again, so block 1 is now the least recently used.
		relationsFor(t.g, marks[0], undefined, blocks[0]);
		relationsFor(t.g, marks[fit], undefined, blocks[fit]).cards.getMany(t.ids);
		const held = relationCacheInfo().blocks;
		expect(held).toContain(blocks[0]);
		expect(held).toContain(blocks[fit]);
		expect(held).not.toContain(blocks[1]);
	});

	it('an ask never evicts the lookup it returns', () => {
		const t = small(5, 30);
		relationsFor(t.g, ME, undefined, 'small.md\u0000#0').cards.getMany(t.ids);
		const gBig = small(6, 60);
		const r = relationsFor(gBig.g, ME, undefined, 'big.md\u0000#0');
		expect(relationCacheInfo().blocks).toContain('big.md\u0000#0');
		expect(relationsFor(gBig.g, ME, undefined, 'big.md\u0000#0')).toBe(r);
	});
});

describe('release and rename', () => {
	it('a released lookup stays as an idle one; a block that asks for the same tree gets it back with no new work', () => {
		const a = small(1);
		const r = relationsFor(a.g, ME, undefined, 'one.md\u0000#0');
		relationsFor(small(2).g, ME, undefined, 'two.md\u0000#0');
		releaseRelations('one.md\u0000#0');
		expect(relationCacheInfo().blocks).toEqual(['two.md\u0000#0']);
		expect(relationCacheInfo()).toMatchObject({ lookups: 2, idle: 1 });
		releaseRelations('unknown.md\u0000#0');
		expect(relationCacheInfo().idle).toBe(1);
		const before = relationStats.computed;
		expect(relationsFor(a.g, ME, undefined, 'one.md\u0000#0')).toBe(r);
		expect(relationStats.computed - before).toBe(0);
		expect(relationCacheInfo()).toMatchObject({ idle: 0 });
		expect(relationCacheInfo().blocks.sort()).toEqual(['one.md\u0000#0', 'two.md\u0000#0']);
	});

	it('a block that asks for another tree after its release takes its idle lookup out (an edit between two views)', () => {
		const a = small(1);
		const b = small(2);
		relationsFor(a.g, ME, undefined, 'n.md\u0000#0');
		releaseRelations('n.md\u0000#0');
		relationsFor(b.g, ME, undefined, 'n.md\u0000#0');
		expect(lookups()).toBe(1);
		expect(relationCacheInfo().idle).toBe(0);
	});

	it('idle lookups are evicted before lookups in use, whatever their order of use', () => {
		const t = small(3, 400);
		const per = estimateRelationBytes(400, 380);
		const fit = Math.floor(RELATION_BUDGET_BYTES / per);
		const marks = t.ids.slice(0, fit + 1);
		const blocks = marks.map((_, i) => `b${i}.md\u0000#0`);
		marks.slice(0, fit).forEach((m, i) => relationsFor(t.g, m, undefined, blocks[i]).cards.getMany(t.ids));
		// Block 'fit - 1' was used last; releasing it makes it idle, so it goes before the older blocks that are in use.
		releaseRelations(blocks[fit - 1]);
		relationsFor(t.g, marks[fit], undefined, blocks[fit]).cards.getMany(t.ids);
		const held = relationCacheInfo().blocks;
		expect(held).not.toContain(blocks[fit - 1]);
		expect(held).toContain(blocks[0]);
		expect(held).toContain(blocks[fit]);
		expect(relationCacheInfo().idle).toBe(0);
	});

	it('idle lookups count in the cap of the lookups with no block', () => {
		const g = small(1).g;
		const marks = g.people.slice(0, RELATION_CACHE_SIZE + 3).map((p) => p.id);
		marks.forEach((m, i) => relationsFor(g, m, undefined, `b${i}.md\u0000#0`));
		marks.forEach((_, i) => releaseRelations(`b${i}.md\u0000#0`));
		relationsFor(g, ME, { oneParentUnknown: false });
		expect(lookups()).toBeLessThanOrEqual(RELATION_CACHE_SIZE);
	});

	it('a renamed note moves its blocks, held and released; the old key holds nothing', () => {
		const a = small(1);
		relationsFor(a.g, ME, undefined, 'old.md\u0000#0');
		const b = small(2);
		relationsFor(b.g, ME, undefined, 'old.md\u0000#1');
		relationsFor(small(3).g, ME, undefined, 'older.md\u0000#0');
		releaseRelations('old.md\u0000#1');
		moveRelationBlocks('old.md', 'new.md');
		expect(relationCacheInfo().blocks.sort()).toEqual(['new.md\u0000#0', 'older.md\u0000#0']);
		// The lookup is still the one for the unchanged tree, now under the new key.
		const before = relationStats.computed;
		relationsFor(a.g, ME, undefined, 'new.md\u0000#0');
		expect(relationStats.computed - before).toBe(0);
		// The released block, renamed, still takes its idle lookup out when it gets another tree.
		relationsFor(small(4).g, ME, undefined, 'new.md\u0000#1');
		expect(lookups()).toBe(3);
		expect(relationCacheInfo().idle).toBe(0);
	});

	it('a block whose key changes (Obsidian told its place) keeps its lookup under the new key', () => {
		const a = small(1);
		const r = relationsFor(a.g, ME, undefined, 'n.md\u0000text abc');
		moveRelationBlock('n.md\u0000text abc', 'n.md\u0000#2');
		expect(relationCacheInfo().blocks).toEqual(['n.md\u0000#2']);
		expect(relationsFor(a.g, ME, undefined, 'n.md\u0000#2')).toBe(r);
		releaseRelations('n.md\u0000#2');
		expect(relationCacheInfo()).toMatchObject({ blocks: [], idle: 1 });
	});
});

describe('the views', () => {
	const BODY = toText({ ...genModel(17, { n: 60, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: 'p30' } });
	const KEY = 'n.md\u0000#0';

	it('a block draws with its key, a redraw makes no new lookup, and the closed view makes the lookup idle', async () => {
		desktop();
		const handle = fakeHandle('n.md', BODY);
		const host = fakeHost();
		const { view } = await embed(BODY, { host, handle });
		expect(relationCacheInfo().blocks).toEqual([KEY]);
		const before = relationStats.computed;
		const drawn = host.renders ?? 0;
		// A setting that changes the cards draws the tree again from the same graph: a hit, no new lookup.
		view.onSettingsChange({ ...DEFAULT_SETTINGS, showRelations: !DEFAULT_SETTINGS.showRelations });
		expect(host.renders).toBeGreaterThan(drawn);
		expect(relationStats.computed - before).toBe(0);
		view.unload();
		expect(relationCacheInfo()).toMatchObject({ lookups: 1, blocks: [], idle: 1 });
	});

	it('unload, then the same block draws again (a switch of reading and edit view): no new lookup', async () => {
		desktop();
		const handle = fakeHandle('n.md', BODY);
		const host = fakeHost();
		const one = await embed(BODY, { host, handle });
		const before = relationStats.computed;
		one.view.unload();
		expect(relationCacheInfo().idle).toBe(1);
		await embed(BODY, { host, handle });
		expect(relationStats.computed - before).toBe(0);
		expect(relationCacheInfo()).toMatchObject({ lookups: 1, blocks: [KEY], idle: 0 });
	});

	it('the block and its second view share one lookup; it is idle only with the last view', async () => {
		desktop();
		const handle = fakeHandle('n.md', BODY);
		const host = fakeHost();
		const one = await embed(BODY, { host, handle });
		const two = await embed(BODY, { host, handle });
		expect(lookups()).toBe(1);
		one.view.unload();
		expect(relationCacheInfo()).toMatchObject({ blocks: [KEY], idle: 0 });
		two.view.unload();
		expect(relationCacheInfo()).toMatchObject({ blocks: [], idle: 1 });
	});

	it('a renamed note: the plugin moves the lookup to the new key', async () => {
		desktop();
		const handle = fakeHandle('n.md', BODY);
		const { plugin, host } = await loadPlugin();
		const { view } = await embed(BODY, { host, handle });
		expect(relationCacheInfo().blocks).toEqual([KEY]);
		(plugin as unknown as { renamed(a: string, b: string): void }).renamed('n.md', 'moved.md');
		expect(relationCacheInfo().blocks).toEqual(['moved.md\u0000#0']);
		view.unload();
		expect(relationCacheInfo()).toMatchObject({ blocks: [], idle: 1 });
	});
});
