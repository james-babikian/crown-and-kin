import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { foldControls, foldHidden, foldKey } from '../../src/core/folds';
import { computeGenerations } from '../../src/core/generations';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutKey, layoutTree } from '../../src/layout/index';
import type { EdgePath, LaidOut, LayoutSettings, PlacedFoldControl } from '../../src/layout/model';
import { recordLayout } from './layout-record';
import { block15, comments15, graphOf, sorted } from './m10-support';

/*
 * Spec §13.10 "Rules" (rows, layout, place of the button and the sign, hit areas) and the M10 fold rules
 * (F1-F6 of the layout): a fold makes a new layout without the hidden people; no shown person changes row and
 * a row with no shown person takes no room; a folded family keeps its couple line and its stem, which
 * ends at the spot of the "+ N" sign; the spots follow rule F5; the tag counts hidden partners; the
 * width and height include every mark and hit area; the cache key. The hidden people, the folded
 * families and the expected controls come from the comments of sample tree 15 (worked out by hand), so
 * these tests do not depend on WP 10.1. They wait for WP 10.2b.
 */

const F = comments15();
const SOURCE = block15(0);
const GEO = geometryFor(16, 'normal');
const EM = 16;
/** Half of a hit area of 44 px at scale 1. */
const HALF_HIT = 22;

type Settings = LayoutSettings;
type Laid = LaidOut;
type Mode = 'down' | 'wide' | 'narrow';

const settingsFor = (mode: Mode, hidden: readonly string[], folded: readonly string[], more: object = {}): Settings =>
	({
		...DEFAULT_LAYOUT_SETTINGS,
		...(mode === 'down' ? {} : { orientation: 'sideways', sidewaysCards: mode === 'narrow' ? 'narrow' : 'normal' }),
		foldHidden: [...hidden].sort(),
		foldedFamilies: [...folded].sort(),
		foldControls: true,
		...more,
	}) as Settings;

/** The layout of sample tree 15 for the set of folds `label` of the comments. */
function lay(label: string, mode: Mode = 'down', more: object = {}) {
	const set = F.sets.get(label)!;
	const folded = set.folds.map((n) => F.folds.get(n)!.key);
	clearLayoutCache();
	const g = graphOf(SOURCE);
	const laid = layoutTree(g, GEO, settingsFor(mode, set.hides, folded, more), 'font') as Laid;
	return { g, laid, set, layout: laid.layout, hidden: new Set(set.hides) };
}

const nameOf = (key: string) => [...F.folds.values()].find((f) => f.key === key)?.name ?? key;

/** The start and the end point of a path of the layout (absolute M, L, H, V and C, no spaces before a command). */
function ends(d: string): { start: { x: number; y: number }; end: { x: number; y: number } } {
	let x = 0;
	let y = 0;
	let start: { x: number; y: number } | undefined;
	for (const [, cmd, args] of d.matchAll(/([MLHVC])([^MLHVC]*)/g)) {
		const n = args.trim().split(/[ ,]+/).map(Number);
		if (cmd === 'M' || cmd === 'L') [x, y] = n;
		else if (cmd === 'H') x = n[0];
		else if (cmd === 'V') y = n[0];
		else [x, y] = n.slice(-2);
		start ??= { x, y };
	}
	return { start: start!, end: { x, y } };
}

describe('F2: rows (spec §13.10 "Rows")', () => {
	it('the layout has no hidden person: not in persons, rows, unions, tags or lines', () => {
		for (const label of ['A', 'B', 'A+B', 'NEST+IMPL', 'TWO2+BQ', 'COUSIN', 'R']) {
			const { layout, laid, hidden, g } = lay(label);
			for (const id of hidden) expect(layout.persons.has(id), `${label} ${id}`).toBe(false);
			expect(layout.persons.size, label).toBe(g.people.length - hidden.size);
			for (const row of layout.rows) for (const id of row) expect(hidden.has(id), `${label} row ${id}`).toBe(false);
			for (const u of g.unions) if (u.partners.some((p) => hidden.has(p))) expect(layout.unions.has(u.key), `${label} ${u.key}`).toBe(false);
			for (const id of layout.farTags.keys()) expect(hidden.has(id), `${label} tag ${id}`).toBe(false);
			for (const p of laid.edges.paths) for (const id of p.people) expect(hidden.has(id), `${label} path ${id}`).toBe(false);
			for (const m of laid.edges.markers) if (m.union) expect(layout.unions.has(m.union), `${label} marker ${m.union}`).toBe(true);
		}
	});

	it('no shown person changes row relative to the others, and the order of the rows does not change', () => {
		for (const label of ['A', 'B', 'NEST+IMPL', 'TWO2+BQ', 'R']) {
			const { g, layout, hidden } = lay(label);
			const gens = computeGenerations(g);
			const shown = g.people.filter((p) => !hidden.has(p.id)).map((p) => p.id);
			for (const a of shown) {
				for (const b of shown) {
					const before = Math.sign(gens.get(a)! - gens.get(b)!);
					const after = Math.sign(layout.persons.get(a)!.gen - layout.persons.get(b)!.gen);
					expect(after, `${label}: ${a} against ${b}`).toBe(before);
				}
			}
		}
	});

	it('a row with no shown person takes no room: the rows are dense, and there is one gap fewer than rows', () => {
		for (const label of ['A', 'B', 'A+B', 'R', 'NEST+IMPL']) {
			const { g, layout, hidden } = lay(label);
			const gens = computeGenerations(g);
			const used = new Set(g.people.filter((p) => !hidden.has(p.id)).map((p) => gens.get(p.id)!));
			expect(layout.rows.length, label).toBe(used.size);
			expect(layout.rowGaps.length, label).toBe(layout.rows.length - 1);
			expect(layout.rows.every((r) => r.length > 0), label).toBe(true);
			const dense = new Set([...layout.persons.values()].map((b) => b.gen));
			expect([...dense].sort((x, y) => x - y), label).toEqual([...dense].map((_, i) => i));
		}
		// Folding the branch A leaves two rows fewer than the whole tree (generations 4 and 5 have no shown person).
		clearLayoutCache();
		const whole = layoutTree(graphOf(SOURCE), GEO, { ...DEFAULT_LAYOUT_SETTINGS } as Settings, 'font');
		const a = lay('A').layout;
		expect(whole.layout.rows.length).toBe(6);
		expect(a.rows.length).toBe(4);
		expect(a.height).toBeLessThan(whole.layout.height);
	});

	it('fully hidden last generation with a tall card: every position, gap and size is finite', () => {
		// The people of the last rows are all hidden; one of them is in `tallCards` (a stale answer) and one name is long.
		const hiddenTall = F.folds.get('A')!.hides.filter((id) => !['osric'].includes(id)).slice(-3);
		for (const mode of ['down', 'wide', 'narrow'] as const) {
			const { layout } = lay('A', mode, { tallCards: hiddenTall, longNames: hiddenTall.slice(0, 1) });
			for (const b of layout.persons.values()) for (const v of [b.x, b.y, b.w, b.h, b.gen]) expect(Number.isFinite(v), `${mode} ${b.id}`).toBe(true);
			for (const gap of layout.rowGaps) expect(Number.isFinite(gap.top) && Number.isFinite(gap.bottom), mode).toBe(true);
			expect(Number.isFinite(layout.width) && Number.isFinite(layout.height), mode).toBe(true);
			expect(layout.width).toBeGreaterThan(0);
			expect(layout.height).toBeGreaterThan(0);
		}
	});

	it('only two people shown (the founders): one row, finite, no error', () => {
		const { layout } = lay('R');
		expect(layout.rows).toEqual([['aldric', 'isolde']]);
		expect(layout.rowGaps).toEqual([]);
		expect(Number.isFinite(layout.width) && Number.isFinite(layout.height)).toBe(true);
	});

	it('a made-up id in `foldHidden` changes nothing', () => {
		const { g } = lay('none');
		clearLayoutCache();
		const base = layoutTree(g, GEO, settingsFor('down', [], []), 'font');
		clearLayoutCache();
		const ghost = layoutTree(g, GEO, settingsFor('down', ['nobody', 'ghost'], []), 'font');
		expect(recordLayout(ghost)).toBe(recordLayout(base));
	});
});

describe('F3: tags to hidden partners (spec §13.10 "People drawn elsewhere stay")', () => {
	it('fold A: Clarice stays with a tag to Dorian, who is hidden; the union with Dorian draws no line and no sign', () => {
		const { layout, laid, g } = lay('A');
		const tag = layout.farTags.get('clarice')!;
		expect(tag).toBeDefined();
		expect(tag.spouses).toEqual(['dorian']);
		const cousins = g.unions.find((u) => u.partners.includes('dorian') && u.partners.includes('clarice'))!;
		expect(layout.unions.has(cousins.key)).toBe(false);
		expect(laid.edges.markers.some((m) => m.union === cousins.key)).toBe(false);
		expect(laid.edges.paths.some((p) => p.union === cousins.key)).toBe(false);
		// The hit area of the tag is at least 44 × 44 px and covers no other card.
		expect(tag.hit.w).toBeGreaterThanOrEqual(44);
		expect(tag.hit.h).toBeGreaterThanOrEqual(44);
		for (const b of layout.persons.values()) {
			if (b.id === 'clarice') continue;
			const overlap = Math.min(tag.hit.x + tag.hit.w, b.x + b.w) > Math.max(tag.hit.x, b.x) && Math.min(tag.hit.y + tag.hit.h, b.y + b.h) > Math.max(tag.hit.y, b.y);
			expect(overlap, `tag hit of clarice over ${b.id}`).toBe(false);
		}
	});

	it('fold A: Wanda has a tag to Corwin (hidden), listed with any far shown partner in the order of her unions', () => {
		const { layout } = lay('A');
		const tag = layout.farTags.get('wanda')!;
		expect(tag).toBeDefined();
		expect(tag.spouses).toContain('corwin');
		for (const s of tag.spouses) expect(['corwin', 'godric']).toContain(s);
		// Corwin (union u11) comes before Godric (union u18).
		if (tag.spouses.includes('godric')) expect(tag.spouses.indexOf('corwin')).toBeLessThan(tag.spouses.indexOf('godric'));
	});

	it('fold B: Dorian has a tag to Clarice, and Wanda to Godric', () => {
		const { layout } = lay('B');
		expect(layout.farTags.get('dorian')!.spouses).toEqual(['clarice']);
		expect(layout.farTags.get('wanda')!.spouses).toContain('godric');
	});

	it('the tag also for a couple that stood side by side before the fold (Spec §13.10)', () => {
		const text = [
			'people:',
			'  - {id: r1, name: R1}',
			'  - {id: r2, name: R2}',
			'  - {id: a1, name: A1, parents: [r1, r2]}',
			'  - {id: a2, name: A2, parents: [r1, r2]}',
			'  - {id: w1, name: W1}',
			'  - {id: w2, name: W2}',
			'  - {id: p, name: P, parents: [a1, w1]}',
			'  - {id: q, name: Q, parents: [a2, w2]}',
			'unions:',
			'  - partners: [r1, r2]',
			'  - partners: [a1, w1]',
			'  - partners: [a2, w2]',
			'  - partners: [p, q]',
			'',
		].join('\n');
		for (const mode of ['down', 'narrow'] as const) {
			const g = graphOf(text);
			clearLayoutCache();
			const before = layoutTree(g, GEO, settingsFor(mode, [], []), 'font') as Laid;
			// Precondition: before the fold, P and Q are a near couple with a bar and no tag.
			expect(before.layout.unions.get('u3')!.bar).toBe(true);
			expect(before.layout.farTags.has('p')).toBe(false);
			clearLayoutCache();
			const key = JSON.stringify(['a2', 'w2']);
			const after = layoutTree(g, GEO, settingsFor(mode, ['q'], [key]), 'font') as Laid;
			expect(after.layout.persons.has('q')).toBe(false);
			expect(after.layout.farTags.get('p')!.spouses).toEqual(['q']);
			expect(after.layout.unions.has('u3')).toBe(false);
			expect(after.edges.paths.some((p) => p.union === 'u3')).toBe(false);
		}
	});
});

describe('F5: the controls of the layout and their spots', () => {
	const MODES: Mode[] = ['down', 'wide', 'narrow'];

	it('`TreeLayout.folds` is the controls of the comments, each with a spot; open ones have count 0, folded ones the N of the comment', () => {
		const named = new Map([...F.folds.values()].map((f) => [f.key, f.name]));
		for (const mode of MODES) {
			for (const set of F.sets.values()) {
				const { layout } = lay(set.label, mode);
				const folds = layout.folds!;
				expect(folds, `${mode} ${set.label}`).toBeDefined();
				const mine = folds.filter((c) => named.has(c.key));
				expect(sorted(mine.filter((c) => !c.folded).map((c) => named.get(c.key)!)), `${mode} ${set.label} open`).toEqual(sorted(set.open));
				expect(sorted(mine.filter((c) => c.folded).map((c) => `${named.get(c.key)}:${c.count}`)), `${mode} ${set.label} folded`).toEqual(sorted([...set.folded].map(([n, c]) => `${n}:${c}`)));
				for (const c of folds) {
					expect(Number.isFinite(c.spot.x) && Number.isFinite(c.spot.y), `${mode} ${set.label} ${c.key}`).toBe(true);
					if (!c.folded) expect(c.count).toBe(0);
				}
				expect(new Set(folds.map((c) => c.key)).size, `${mode} ${set.label}`).toBe(folds.length);
			}
		}
	});

	it('without `foldControls` (the static preview) the layout has no controls, and with `foldControls` and no folds every control is an open button', () => {
		const set = F.sets.get('none')!;
		clearLayoutCache();
		const g = graphOf(SOURCE);
		const plain = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS } as Settings, 'font') as Laid;
		expect('folds' in plain.layout).toBe(false);
		expect(plain.layout.folds).toBeUndefined();
		const withControls = lay('none').layout;
		expect(withControls.folds!.length).toBeGreaterThanOrEqual(set.open.length);
		expect(withControls.folds!.every((c) => !c.folded)).toBe(true);
	});

	/** The spot that rule F5 gives for a control, from the markers and the `bar` flags of the same layout. */
	function expectedSpot(laid: Laid, c: PlacedFoldControl, mode: Mode): { x: number; y: number } | null {
		const { layout, edges } = laid;
		const sideways = mode !== 'down';
		const boxes = c.parents.map((id) => layout.persons.get(id)!);
		const gen = Math.max(...boxes.map((b) => b.gen));
		const next = layout.rowGaps[gen]?.bottom;
		const marker = c.union ? edges.markers.find((m) => m.union === c.union && (m.kind === 'union' || m.kind === 'implicit-union')) : undefined;
		if (boxes.length === 2 && new Set(boxes.map((b) => b.gen)).size > 1) return null;
		let spot: { x: number; y: number };
		let from: number;
		if (marker) {
			const bar = layout.unions.get(c.union!)!.bar;
			if (!sideways) {
				spot = bar ? { x: marker.x, y: Math.max(...boxes.map((b) => b.y + b.h)) + EM } : { x: marker.x, y: marker.y + 1.2 * EM };
				from = marker.y;
			} else {
				spot = bar ? { x: Math.max(...boxes.map((b) => b.x + b.w)) + EM, y: marker.y } : { x: marker.x + 1.2 * EM, y: marker.y };
				from = marker.x;
			}
		} else {
			const b = boxes[0];
			spot = sideways ? { x: b.x + b.w + EM, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y + b.h + EM };
			from = sideways ? b.x + b.w : b.y + b.h;
		}
		if (next !== undefined && next - from < 2 * EM) {
			const middle = from + (next - from) / 2;
			spot = sideways ? { x: middle, y: spot.y } : { x: spot.x, y: middle };
		}
		return spot;
	}

	it('the spot of every control follows rule F5 (down, sideways, sideways narrow; a bar, a dot below the anchor, a far pair, one parent)', () => {
		let bars = 0;
		let dots = 0;
		let solos = 0;
		let checked = 0;
		for (const mode of MODES) {
			for (const label of ['none', 'A', 'B', 'TWO2+BQ', 'NEST+IMPL', 'COUSIN']) {
				const { laid, layout } = lay(label, mode);
				for (const c of layout.folds!) {
					const want = expectedSpot(laid, c, mode);
					if (!want) continue;
					checked++;
					// Fix-round rulings V2/V4 (the decision notes "M10"): a control may move further down its own stem, away
					// from a tag or another control; a tagged single parent's control sits on the trunk's x.
					const along = mode === 'down' ? 'y' : 'x';
					const across = mode === 'down' ? 'x' : 'y';
					expect(c.spot[along], `${mode} ${label} ${nameOf(c.key)} ${along}`).toBeGreaterThanOrEqual(want[along] - 0.05);
					if (c.union) expect(c.spot[across], `${mode} ${label} ${nameOf(c.key)} ${across}`).toBeCloseTo(want[across], 1);
					if (!c.union) solos++;
					else if (layout.unions.get(c.union)!.bar) bars++;
					else dots++;
				}
			}
		}
		// The samples cover a bar, a dot below the anchor (a near pair that is not adjacent, a far pair) and one parent.
		expect(checked).toBeGreaterThan(60);
		expect(bars).toBeGreaterThan(10);
		expect(dots).toBeGreaterThan(2);
		expect(solos).toBeGreaterThan(2);
	});

	it('down, a bar: the spot is 1 em below the lower card of the parents, under the sign; a dot: 1.2 em below the sign (spec §13.10 "Place of the button")', () => {
		const { laid, layout } = lay('A');
		const control = (name: string) => layout.folds!.find((c) => c.key === F.folds.get(name)!.key)!;
		// A (Osric and Mathilde) is a bar.
		const a = control('A');
		const marker = laid.edges.markers.find((m) => m.union === a.union)!;
		expect(layout.unions.get(a.union!)!.bar).toBe(true);
		expect(a.spot.x).toBeCloseTo(marker.x, 6);
		const bottoms = a.parents.map((id) => layout.persons.get(id)!).map((b) => b.y + b.h);
		expect(a.spot.y).toBeCloseTo(Math.max(...bottoms) + EM, 6);
		// After fold A, Godric and Wanda (BQ) are adjacent in the pruned graph: a bar, like A.
		const bq = control('BQ');
		const bqBar = laid.edges.markers.find((m) => m.union === bq.union)!;
		expect(layout.unions.get(bq.union!)!.bar).toBe(true);
		expect(bq.spot.x).toBeCloseTo(bqBar.x, 6);
		// V2: below the lower card, and below a tag's tap area when one hangs there.
		expect(bq.spot.y).toBeGreaterThanOrEqual(Math.max(...bq.parents.map((id) => layout.persons.get(id)!).map((b) => b.y + b.h)) + EM - 1e-6);
		// A dot (a far pair, or a pair that is not adjacent): 1.2 em below the dot, on every set where one occurs.
		let dots = 0;
		for (const label of ['none', 'A', 'B', 'A+B', 'TWO2+BQ', 'NEST+IMPL', 'COUSIN', 'R']) {
			const l = lay(label);
			for (const c of l.layout.folds!) {
				if (!c.union || l.layout.unions.get(c.union)?.bar !== false) continue;
				const dot = l.laid.edges.markers.find((m) => m.union === c.union);
				if (!dot) continue;
				dots++;
				expect(c.spot.x, `${label} ${nameOf(c.key)}`).toBeCloseTo(dot.x, 6);
				// V2/V4: at least 1.2 em below the dot; further down its stem when a tag or another control is in the way.
				expect(c.spot.y, `${label} ${nameOf(c.key)}`).toBeGreaterThanOrEqual(dot.y + 1.2 * EM - 1e-6);
			}
		}
		expect(dots).toBeGreaterThan(0);
	});

	it('one parent: down, the card centre and 1 em below the card; sideways, 1 em right of the card and at its middle', () => {
		const { layout } = lay('A', 'down');
		const gs = layout.folds!.find((c) => c.key === F.folds.get('GS')!.key)!;
		const godric = layout.persons.get('godric')!;
		expect(gs.spot.x).toBeCloseTo(godric.x + godric.w / 2, 6);
		expect(gs.spot.y).toBeCloseTo(godric.y + godric.h + EM, 6);
		const side = lay('A', 'wide').layout;
		const gsSide = side.folds!.find((c) => c.key === F.folds.get('GS')!.key)!;
		const g2 = side.persons.get('godric')!;
		expect(gsSide.spot.x).toBeCloseTo(g2.x + g2.w + EM, 6);
		expect(gsSide.spot.y).toBeCloseTo(g2.y + g2.h / 2, 6);
	});
});

describe('F5b: width and height include every mark and every hit area (spec §13.10 "Hit areas")', () => {
	it('right and below: the largest mark (the Overview sign) and the hit area of 44 px at scale 1 lie inside the layout', () => {
		for (const mode of ['down', 'wide', 'narrow'] as const) {
			for (const label of ['none', 'A', 'B', 'A+B', 'NEST+IMPL', 'R']) {
				const { layout } = lay(label, mode);
				for (const c of layout.folds!) {
					const tag = `${mode} ${label} ${nameOf(c.key)}`;
					expect(layout.height, tag).toBeGreaterThanOrEqual(c.spot.y + HALF_HIT - 1e-6);
					if (c.folded) {
						// "+ N": a pill 2 em high at Overview, anchored on the left, (text + 0.9 em) wide; the text is at most (2 + digits) × 1.5 em.
						const digits = String(c.count).length;
						const width = (0.9 + (2 + digits) * 1.5) * EM;
						expect(layout.width, tag).toBeGreaterThanOrEqual(c.spot.x - EM + width - 1e-6);
					} else {
						expect(layout.width, tag).toBeGreaterThanOrEqual(c.spot.x + HALF_HIT - 1e-6);
					}
				}
			}
		}
	});

	it('left and above: nothing lies at a negative coordinate (the layout moves everything by the same amount)', () => {
		for (const mode of ['down', 'wide', 'narrow'] as const) {
			for (const label of ['none', 'A', 'B', 'R']) {
				const { layout, laid } = lay(label, mode);
				for (const b of layout.persons.values()) {
					expect(b.x, `${mode} ${label} ${b.id}`).toBeGreaterThanOrEqual(-1e-6);
					expect(b.y, `${mode} ${label} ${b.id}`).toBeGreaterThanOrEqual(-1e-6);
				}
				for (const c of layout.folds!) {
					expect(c.spot.x - (c.folded ? EM : HALF_HIT), `${mode} ${label} ${nameOf(c.key)}`).toBeGreaterThanOrEqual(-1e-6);
					expect(c.spot.y - HALF_HIT, `${mode} ${label} ${nameOf(c.key)}`).toBeGreaterThanOrEqual(-1e-6);
				}
				for (const m of laid.edges.markers) {
					expect(m.x).toBeGreaterThanOrEqual(-1e-6);
					expect(m.y).toBeGreaterThanOrEqual(-1e-6);
				}
			}
		}
	});

	it('moving by the same amount keeps the picture: the distance between two cards is the same with and without controls', () => {
		clearLayoutCache();
		const g = graphOf(SOURCE);
		const off = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS } as Settings, 'font');
		const on = lay('none').layout;
		const dx = on.persons.get('aldric')!.x - off.layout.persons.get('aldric')!.x;
		const dy = on.persons.get('aldric')!.y - off.layout.persons.get('aldric')!.y;
		for (const id of ['isolde', 'osric', 'lucan', 'zenobia']) {
			const a = off.layout.persons.get(id);
			const b = on.persons.get(id);
			if (!a || !b) continue;
			expect(b.x - a.x).toBeCloseTo(dx, 6);
			// V2/V4: a gap may grow for a control that moved down its stem, so rows below can move down, never up.
			expect(b.y - a.y).toBeGreaterThanOrEqual(dy - 1e-6);
		}
	});
});

describe('F4: a folded family keeps its couple line and its stem (spec §13.10 "The line then ends at the place of the button")', () => {
	const stems = (laid: Laid, c: PlacedFoldControl): EdgePath[] =>
		laid.edges.paths.filter((p) => p.kind === 'descent' && p.child === undefined && p.parents !== undefined && [...p.parents].sort().join() === [...c.parents].sort().join() && (c.union ? p.union === c.union : p.union === undefined));

	it('each folded family with shown parents has one stem of kind `descent` with `union` and `parents`, ending at its spot, and no drop', () => {
		for (const mode of ['down', 'wide', 'narrow'] as const) {
			for (const label of ['A', 'B', 'A+B', 'TWO2+BQ', 'NEST+IMPL', 'COUSIN', 'R']) {
				const { laid, layout } = lay(label, mode);
				const folded = layout.folds!.filter((c) => c.folded);
				expect(folded.length, `${mode} ${label}`).toBeGreaterThan(0);
				for (const c of folded) {
					const tag = `${mode} ${label} ${nameOf(c.key)}`;
					const s = stems(laid, c);
					expect(s, tag).toHaveLength(1);
					const { start, end } = ends(s[0].d);
					expect(end.x, tag).toBeCloseTo(c.spot.x, 1);
					expect(end.y, tag).toBeCloseTo(c.spot.y, 1);
					// It runs away from the parents: down, or to the right when the tree is turned.
					if (mode === 'down') expect(end.y, tag).toBeGreaterThan(start.y);
					else expect(end.x, tag).toBeGreaterThan(start.x);
					// No drop: no straight line with a child of this family (all its children are hidden). A curved secondary path such as a birth-link (Tomas) stays.
					const drops = laid.edges.paths.filter((p) => p.child !== undefined && p.kind !== 'birth-link' && p.parents !== undefined && [...p.parents].sort().join() === [...c.parents].sort().join() && (c.union ? p.union === c.union : true));
					expect(drops, tag).toEqual([]);
				}
			}
		}
	});

	it('the couple line of a folded pair stays: the dot (or bar) and the marker are still there, also for a far pair and a pair that is not adjacent', () => {
		for (const mode of ['down', 'wide', 'narrow'] as const) {
			for (const [label, names] of [
				['A', ['A']],
				['TWO2+BQ', ['TWO2', 'BQ']],
				['A+B', ['A', 'B']],
			] as const) {
				const { laid, layout } = lay(label, mode);
				for (const name of names) {
					const c = layout.folds!.find((x) => x.key === F.folds.get(name)!.key)!;
					expect(c.folded, `${mode} ${label} ${name}`).toBe(true);
					expect(layout.unions.has(c.union!), `${mode} ${label} ${name} union`).toBe(true);
					const marker = laid.edges.markers.find((m) => m.union === c.union && (m.kind === 'union' || m.kind === 'implicit-union'));
					expect(marker, `${mode} ${label} ${name} marker`).toBeDefined();
					// The partners are joined by their line or, when far, each has a leg to the dot.
					const parts = laid.edges.paths.filter((p) => p.union === c.union && p.kind !== 'descent');
					expect(parts.length, `${mode} ${label} ${name} couple line`).toBeGreaterThan(0);
				}
			}
		}
	});

	it('an implicit union keeps its dot and its stem (Matthias and Rosalind fold as the only fold seen)', () => {
		const set = F.sets.get('NEST+IMPL')!;
		expect(set.folded.has('NEST')).toBe(true);
		// The implicit family is IMPL, which lies inside NEST: fold IMPL alone.
		const key = F.folds.get('IMPL')!.key;
		const hides = F.folds.get('IMPL')!.hides;
		clearLayoutCache();
		const g = graphOf(SOURCE);
		const laid = layoutTree(g, GEO, settingsFor('down', hides, [key]), 'font') as Laid;
		const c = laid.layout.folds!.find((x) => x.key === key)!;
		expect(c.folded).toBe(true);
		expect(c.union).toBe('i:["matthias","rosalind"]');
		expect(laid.layout.unions.has(c.union!)).toBe(true);
		expect(laid.edges.markers.some((m) => m.union === c.union && m.kind === 'implicit-union')).toBe(true);
		const s = stems(laid, c);
		expect(s).toHaveLength(1);
		expect(ends(s[0].d).end.x).toBeCloseTo(c.spot.x, 1);
		expect(ends(s[0].d).end.y).toBeCloseTo(c.spot.y, 1);
	});

	it('children of one parent (SOLO): the stem leaves the card of the parent and ends at the spot', () => {
		const key = F.folds.get('SOLO')!.key;
		const hides = F.folds.get('SOLO')!.hides;
		for (const mode of ['down', 'wide', 'narrow'] as const) {
			clearLayoutCache();
			const g = graphOf(SOURCE);
			const laid = layoutTree(g, GEO, settingsFor(mode, hides, [key]), 'font') as Laid;
			const c = laid.layout.folds!.find((x) => x.key === key)!;
			const s = stems(laid, c);
			expect(s, mode).toHaveLength(1);
			const { start, end } = ends(s[0].d);
			const b = laid.layout.persons.get('beatrix')!;
			if (mode === 'down') expect(start.y, mode).toBeCloseTo(b.y + b.h, 1);
			else expect(start.x, mode).toBeCloseTo(b.x + b.w, 1);
			expect(end.x, mode).toBeCloseTo(c.spot.x, 1);
			expect(end.y, mode).toBeCloseTo(c.spot.y, 1);
		}
	});

	it('the spot lies in the gap: under the parents and above the next row, with room for the sign (down)', () => {
		const { layout } = lay('A');
		for (const c of layout.folds!) {
			const boxes = c.parents.map((id) => layout.persons.get(id)!);
			const gen = Math.max(...boxes.map((b) => b.gen));
			expect(c.spot.y, nameOf(c.key)).toBeGreaterThan(Math.max(...boxes.map((b) => b.y + b.h)) - 1e-6);
			const next = layout.rowGaps[gen]?.bottom;
			// A sign is 1.25 em high, centred on the spot.
			if (next !== undefined && boxes.length && new Set(boxes.map((b) => b.gen)).size === 1) expect(c.spot.y + 0.625 * EM, nameOf(c.key)).toBeLessThanOrEqual(next + 1e-6);
		}
	});
});

describe('toggles and the cache key (spec §13.10 acceptance; F1)', () => {
	it('a second tap restores the same layout: fold, then open gives the same TreeLayout as before', () => {
		const g = graphOf(SOURCE);
		const key = F.folds.get('A')!.key;
		const hides = F.folds.get('A')!.hides;
		for (const mode of ['down', 'wide', 'narrow'] as const) {
			clearLayoutCache();
			const first = layoutTree(g, GEO, settingsFor(mode, [], []), 'font');
			const folded = layoutTree(g, GEO, settingsFor(mode, hides, [key]), 'font');
			const again = layoutTree(g, GEO, settingsFor(mode, [], []), 'font');
			expect(recordLayout(folded), mode).not.toBe(recordLayout(first));
			expect(recordLayout(again), mode).toBe(recordLayout(first));
			// Without the cache too.
			clearLayoutCache();
			expect(recordLayout(layoutTree(g, GEO, settingsFor(mode, [], []), 'font')), mode).toBe(recordLayout(first));
		}
	});

	it('the cache key includes `foldHidden`, `foldedFamilies` and `foldControls`; empty or absent leaves the M9 key', () => {
		const g: FamilyGraph = graphOf(SOURCE);
		const key = (extra: object) => layoutKey(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, ...extra } as Settings, 'font');
		const base = key({});
		const a = F.folds.get('A')!;
		expect(key({ foldHidden: [] })).toBe(base);
		expect(key({ foldedFamilies: [] })).toBe(base);
		expect(key({ foldControls: undefined })).toBe(base);
		expect(key({ foldHidden: a.hides })).not.toBe(base);
		expect(key({ foldedFamilies: [a.key] })).not.toBe(base);
		expect(key({ foldControls: true })).not.toBe(base);
		expect(key({ foldHidden: a.hides })).not.toBe(key({ foldedFamilies: [a.key] }));
		// Order and repeats do not matter.
		expect(key({ foldHidden: [...a.hides].reverse() })).toBe(key({ foldHidden: a.hides }));
		expect(key({ foldedFamilies: [a.key, F.folds.get('B')!.key] })).toBe(key({ foldedFamilies: [F.folds.get('B')!.key, a.key, a.key] }));
		// Two different sets of folded families give two keys.
		expect(key({ foldedFamilies: [a.key] })).not.toBe(key({ foldedFamilies: [F.folds.get('B')!.key] }));
	});

	it('the layout of a tree without folds is the layout of M9 (nothing about a fold is in it)', () => {
		clearLayoutCache();
		const g = graphOf(SOURCE);
		const plain = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS } as Settings, 'font');
		clearLayoutCache();
		const empty = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [], foldedFamilies: [] } as Settings, 'font');
		expect(recordLayout(empty)).toBe(recordLayout(plain));
	});
});

/* Adopted from the M10 review A (`m10/review-a`, finding 1). Waits for the fix round. */
describe('review A: folding a family never hides its own parent (spec §13.10)', () => {
	it('father with a daughter as partner: fold `a` keeps `a`, keeps the control, and lays out a non-empty tree', () => {
		// a is a root. b is a's sole-parent child. c is the child of a and b. a's only partner is b.
		const g = graphOf(['people:', '  - {id: a, name: A}', '  - {id: b, name: B, parents: [a]}', '  - {id: c, name: C, parents: [a, b]}', ''].join('\n'));
		const folds = new Set([foldKey(['a'])]);
		const hidden = foldHidden(g, folds);
		expect(hidden.has('a')).toBe(false);
		expect(foldControls(g, folds, hidden).some((c) => c.key === foldKey(['a']))).toBe(true);
		clearLayoutCache();
		const { layout } = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [...hidden], foldedFamilies: [...folds], foldControls: true } as Settings, 'f');
		expect(layout.persons.size).toBeGreaterThan(0);
		expect(layout.rows.every((r) => r.length > 0)).toBe(true);
	});
});
