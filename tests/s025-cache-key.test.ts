// 0.2.5 WP-B1 (CONTRACT B.6, B.5 test 2): the layout cache key follows the card form, the plate setting and the "You" tab,
// and a layout never comes back from the cache for the other plate setting.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { sampleSources } from './acceptance/m11-support';

function graph(id: string): FamilyGraph {
	const s = sampleSources().find((x) => x.id === id)!;
	const parsed = parseDynasty(s.source);
	if (!parsed.ok) throw new Error('parse');
	return deriveFamilies(parsed.tree);
}
const g = graph('01');
const me = g.people[g.people.length - 1].id;
const other = g.people[0].id;
const base = (o: Partial<LayoutSettings> = {}): LayoutSettings => ({ ...DEFAULT_LAYOUT_SETTINGS, ...o });
const normal = geometryFor(12);
const key = (geo = cardForm(normal, 'down'), o: Partial<LayoutSettings> = {}) => layoutKey(g, geo, base(o), 'font');

describe('layoutKey (0.2.5)', () => {
	it('is equal for equal inputs', () => {
		expect(key()).toBe(key());
		expect(key(cardForm(normal, 'down'), { youTab: me })).toBe(key(cardForm(normal, 'down'), { youTab: me }));
	});

	it('differs for the card form', () => {
		const down = key(cardForm(normal, 'down'));
		expect(down).not.toBe(key(normal));
		expect(layoutKey(g, cardForm(normal, 'sideways'), base({ orientation: 'sideways' }), 'font')).not.toBe(layoutKey(g, normal, base({ orientation: 'sideways' }), 'font'));
	});

	it('differs for relationLine', () => {
		expect(key(cardForm(normal, 'down'), { relationLine: true })).not.toBe(key());
	});

	it('differs for youTab, and for two ids', () => {
		expect(key(cardForm(normal, 'down'), { youTab: me })).not.toBe(key());
		expect(key(cardForm(normal, 'down'), { youTab: me })).not.toBe(key(cardForm(normal, 'down'), { youTab: other }));
	});

	it('a youTab that is not a person of the graph leaves the key as it was', () => {
		expect(key(cardForm(normal, 'down'), { youTab: 'nobody-here' })).toBe(key());
	});

	it('the pictures decide the crown, so they change the key of a Roundel; a text-card tree ignores the picture lists', () => {
		const houseId = [...g.houses.keys()][0] ?? 'h';
		const roundelPics = key(cardForm(normal, 'down'), { portraits: [other] });
		expect(roundelPics).not.toBe(key());
		const side = (o: Partial<LayoutSettings>) => layoutKey(g, cardForm(normal, 'sideways'), base({ orientation: 'sideways', ...o }), 'font');
		expect(side({ portraits: [other], arms: [houseId] })).toBe(side({}));
		const classic = (o: Partial<LayoutSettings>) => layoutKey(g, normal, base({ orientation: 'sideways', ...o }), 'font');
		expect(classic({ portraits: [other] })).not.toBe(classic({}));
	});

	it('a list of ids that are not in the graph gives the Roundel the crown, so the key carries it', () => {
		// The crown follows the lists as the caller gave them (`drawnGeometry` has no graph), so two lists that differ in crown must differ in key.
		expect(key(cardForm(normal, 'down'), { portraits: ['not-in-this-tree'] })).not.toBe(key());
	});

	it('the old classic keys do not carry the new parts', () => {
		expect(key(normal)).toBe(layoutKey(g, normal, base(), 'font'));
	});
});

describe('layoutTree cache (0.2.5)', () => {
	it('the plate setting never returns the other setting\'s cached layout', () => {
		clearLayoutCache();
		const geo = cardForm(normal, 'down');
		const on = layoutTree(g, geo, base({ relationLine: true }), 'font');
		const off = layoutTree(g, geo, base(), 'font');
		expect(off).not.toBe(on);
		expect(on.layout.geometry.cardH).toBeGreaterThan(off.layout.geometry.cardH);
		expect(layoutTree(g, geo, base({ relationLine: true }), 'font')).toBe(on);
		expect(layoutTree(g, geo, base(), 'font')).toBe(off);
	});

	it('marking another person re-lays out only when the plate is OFF', () => {
		clearLayoutCache();
		const geo = cardForm(normal, 'down');
		const a = layoutTree(g, geo, base({ youTab: me }), 'font');
		const b = layoutTree(g, geo, base({ youTab: other }), 'font');
		expect(b).not.toBe(a);
		expect(a.layout.youTab).toBe(me);
		expect(b.layout.youTab).toBe(other);
	});

	it('TreeLayout.youTab is set only when the id is a person of the drawn graph', () => {
		clearLayoutCache();
		const geo = cardForm(normal, 'down');
		const gone = layoutTree(g, geo, base({ youTab: 'nobody-here' }), 'font');
		expect(gone.layout.youTab).toBeUndefined();
		expect(gone.layout.geometry.reach).toBeUndefined();
		const none = layoutTree(g, geo, base(), 'font');
		expect(gone).toBe(none);
	});
});
