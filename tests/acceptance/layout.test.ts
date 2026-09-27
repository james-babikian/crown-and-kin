import { describe, expect, it } from 'vitest';
import type { EdgePath, PersonBox, StrokeKind, TreeLayout } from '../../src/layout/model';
import { allFixtures, fixtureSource } from './load';
import { geometry, layOut } from './pipeline';
import { specModel } from './spec-model';

// Spec §10 layout acceptance, through the single entry point `layoutTree` (§5.1).

const box = (layout: TreeLayout, id: string): PersonBox => {
	const b = layout.persons.get(id);
	if (!b) throw new Error(`No box for ${id}`);
	return b;
};

const rowOf = (layout: TreeLayout, id: string) => {
	const r = layout.rows.findIndex((row) => row.includes(id));
	if (r === -1) throw new Error(`${id} is in no row`);
	return { r, row: layout.rows[r], i: layout.rows[r].indexOf(id) };
};

const centre = (b: PersonBox) => b.x + b.w / 2;
const connects = (p: EdgePath, ...ids: string[]) => ids.every((id) => p.people.includes(id));

/** §5.3: each parent type's secondary link has its own line style. */
const SECONDARY_KIND: Record<string, StrokeKind[]> = {
	birth: ['birth-link'],
	adoptive: ['adoptive'],
	ward: ['ward'],
	rumoured: ['rumoured'],
};

describe('every fixture: spec §8 "nothing may throw", §10 "all fixtures render"', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}: lays out, with every person once and finite coordinates`, () => {
			const { g, layout, edges } = layOut(f.source);
			expect(layout.persons.size).toBe(g.people.length);
			for (const p of g.people) {
				const b = box(layout, p.id);
				for (const n of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(n)).toBe(true);
			}
			const inRows = layout.rows.flat();
			expect(inRows.length).toBe(new Set(inRows).size);
			expect([...inRows].sort()).toEqual(g.people.map((p) => p.id).sort());
			// A row holds one generation, and rows go down the generations.
			const gens = layout.rows.map((row) => new Set(row.map((id) => box(layout, id).gen)));
			for (const s of gens) expect(s.size).toBeLessThanOrEqual(1);
			const order = gens.filter((s) => s.size).map((s) => [...s][0]);
			expect(order).toEqual([...order].sort((a, b) => a - b));
			expect(Number.isFinite(layout.width) && Number.isFinite(layout.height)).toBe(true);
			for (const m of edges.markers) expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
			for (const p of edges.paths) expect(p.d).not.toMatch(/NaN|Infinity|undefined/);
		});
	}
});

describe('fixture 3 (first-cousin marriage): spec §10', () => {
	it('each person appears exactly once in persons and in rows', () => {
		const { tree, layout } = layOut(fixtureSource('03'));
		const ids = tree.people.map((p) => p.id).sort();
		expect([...layout.persons.keys()].sort()).toEqual(ids);
		expect(layout.rows.flat().sort()).toEqual(ids);
		for (const id of ids) expect(box(layout, id).id).toBe(id);
	});
});

describe('fixture 11 (close-kin marriages): spec §10', () => {
	it('the brother–sister couple sits side by side, joined by a marriage bar', () => {
		const { g, layout } = layOut(fixtureSource('11'));
		const varian = rowOf(layout, 'varian');
		const yseult = rowOf(layout, 'yseult');
		expect(yseult.r).toBe(varian.r);
		expect(Math.abs(yseult.i - varian.i)).toBe(1);
		const u = g.unions.find((x) => x.partners.includes('varian') && x.partners.includes('yseult'))!;
		expect(layout.unions.get(u.key)).toMatchObject({ bar: true, far: false });
	});

	it("the father–daughter couple's child is one generation below the younger partner", () => {
		const { layout } = layOut(fixtureSource('11'));
		const corwin = box(layout, 'corwin');
		const alys = box(layout, 'alys');
		expect(alys.gen).toBe(corwin.gen + 1);
		expect(box(layout, 'osric').gen).toBe(alys.gen + 1);
		expect(rowOf(layout, 'osric').r).toBe(rowOf(layout, 'alys').r + 1);
	});
});

describe('fixture 2 (three successive spouses): spec §10, §5.1', () => {
	const spouses = ['agnes', 'beatrix', 'clarice'];

	it('all three unions attach to the same person', () => {
		const { g, layout } = layOut(fixtureSource('02'));
		const unions = g.unions.filter((u) => !u.implicit && spouses.some((s) => u.partners.includes(s)));
		expect(unions).toHaveLength(3);
		for (const u of unions) {
			expect(u.partners).toContain('edmund');
			// Married-in spouses share Edmund's block, so they are never a far couple (D10).
			expect(layout.unions.get(u.key)?.far).toBe(false);
		}
	});

	it("every spouse is in Edmund's row, and his block is contiguous", () => {
		const { layout } = layOut(fixtureSource('02'));
		const { row, r } = rowOf(layout, 'edmund');
		for (const s of spouses) expect(rowOf(layout, s).r).toBe(r);
		const idx = ['edmund', ...spouses].map((id) => row.indexOf(id)).sort((a, b) => a - b);
		expect(idx[idx.length - 1] - idx[0]).toBe(idx.length - 1);
	});

	it('the first wife is on his left and later wives on his right, in union order (§5.1 step 2)', () => {
		const { layout } = layOut(fixtureSource('02'));
		const { row } = rowOf(layout, 'edmund');
		const start = row.indexOf('agnes');
		expect(row.slice(start, start + 4)).toEqual(['agnes', 'edmund', 'beatrix', 'clarice']);
	});

	it('union dots: a bar for adjacent partners, below the row halfway between for the others (§5.1 step 5)', () => {
		const { g, layout } = layOut(fixtureSource('02'));
		const point = (s: string) => layout.unions.get(g.unions.find((u) => u.partners.includes(s) && u.partners.includes('edmund'))!.key)!;
		expect(point('agnes').bar).toBe(true);
		expect(point('beatrix').bar).toBe(true);
		const clarice = point('clarice');
		const edmund = box(layout, 'edmund');
		expect(clarice.bar).toBe(false);
		expect(clarice.y).toBeGreaterThanOrEqual(edmund.y + edmund.h);
		expect(Math.abs(clarice.x - (centre(edmund) + centre(box(layout, 'clarice'))) / 2)).toBeLessThanOrEqual(1);
	});
});

describe('fixture 8 (parent types): spec §10, §4.3, §5.3', () => {
	it('the adopted heir sits under his adoptive parents', () => {
		const { g, layout, edges } = layOut(fixtureSource('08'));
		const aldric = box(layout, 'aldric');
		const isolde = box(layout, 'isolde');
		const tomas = box(layout, 'tomas');
		expect(isolde.gen).toBe(aldric.gen);
		expect(tomas.gen).toBe(aldric.gen + 1);
		const adoptive = g.unions.find((u) => u.partners.includes('aldric') && u.partners.includes('isolde'))!;
		expect(adoptive.children).toContain('tomas');
		const birth = g.unions.find((u) => u.partners.includes('marek') && u.partners.includes('anna'))!;
		expect(birth.children).not.toContain('tomas');
		// §5.1 step 4: children are centred under their parents' union dot.
		expect(Math.abs(centre(tomas) - layout.unions.get(adoptive.key)!.x)).toBeLessThan(tomas.w);
		// The drop that places him comes from the adoptive couple, in the adoptive style
		// (the decision notes "Lines to children placed under adoptive or ward parents").
		expect(edges.paths.some((p) => p.kind === 'adoptive' && connects(p, 'tomas', 'aldric', 'isolde'))).toBe(true);
		expect(edges.paths.some((p) => p.kind === 'descent' && connects(p, 'tomas') && (p.people.includes('marek') || p.people.includes('anna')))).toBe(false);
	});

	it("Tomas's birth parents are a birth-link side line", () => {
		const { edges } = layOut(fixtureSource('08'));
		for (const parent of ['marek', 'anna']) {
			expect(edges.paths.some((p) => p.kind === 'birth-link' && connects(p, parent, 'tomas'))).toBe(true);
		}
	});

	it('the ward link from Aldric to Piers is drawn in the ward style', () => {
		const { edges } = layOut(fixtureSource('08'));
		expect(edges.paths.some((p) => p.kind === 'ward' && connects(p, 'aldric', 'piers'))).toBe(true);
	});

	it("the rumoured father of Roderick is drawn in the rumoured style with a '?' marker between them", () => {
		const { layout, edges } = layOut(fixtureSource('08'));
		expect(edges.paths.some((p) => p.kind === 'rumoured' && connects(p, 'marek', 'roderick'))).toBe(true);
		const marek = box(layout, 'marek');
		const roderick = box(layout, 'roderick');
		expect(marek.gen).toBeLessThan(roderick.gen);
		const rumours = edges.markers.filter((m) => m.kind === 'rumour');
		expect(rumours.some((m) => m.y > marek.y && m.y < roderick.y)).toBe(true);
	});

	it('nothing else is drawn in a secondary style', () => {
		const { edges } = layOut(fixtureSource('08'));
		const allowed: { kind: StrokeKind; child: string; parents: string[] }[] = [
			{ kind: 'birth-link', child: 'tomas', parents: ['marek', 'anna'] },
			{ kind: 'ward', child: 'piers', parents: ['aldric'] },
			{ kind: 'rumoured', child: 'roderick', parents: ['marek'] },
			// His placement drop, and the family trunk above it, since he is the couple's only child.
			{ kind: 'adoptive', child: 'tomas', parents: ['aldric', 'isolde'] },
		];
		for (const p of edges.paths.filter((x) => allowed.some((a) => a.kind === x.kind))) {
			const ok = allowed.some(
				(a) => a.kind === p.kind && p.people.every((id) => id === a.child || a.parents.includes(id)) && a.parents.some((x) => p.people.includes(x)),
			);
			expect(ok, `${p.kind} line for ${p.people.join(', ')}`).toBe(true);
		}
	});
});

describe('an adoptive link that does not decide placement: spec §4.3, §5.3', () => {
	const source = [
		'people:',
		'  - {id: hugh, name: Hugh}',
		'  - {id: mary, name: Mary}',
		'  - {id: lord, name: Lord Brand}',
		'  - {id: lady, name: Lady Brand}',
		'  - id: kit',
		'    name: Kit',
		'    parents: [hugh, mary, {id: lord, type: adoptive}, {id: lady, type: adoptive}]',
		'unions:',
		'  - partners: [hugh, mary]',
		'  - partners: [lord, lady]',
		'',
	].join('\n');

	it('the child sits under the birth parents, and the adoptive parents get an adoptive side line', () => {
		const { g, layout, edges } = layOut(source);
		expect(g.unions.find((u) => u.partners.includes('hugh'))!.children).toEqual(['kit']);
		expect(box(layout, 'kit').gen).toBe(box(layout, 'hugh').gen + 1);
		for (const parent of ['lord', 'lady']) {
			expect(edges.paths.some((p) => p.kind === 'adoptive' && connects(p, parent, 'kit'))).toBe(true);
		}
	});
});

describe('secondary lines in every fixture: spec §4.2, §4.3, §5.3', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}: each secondary parent has a side line in its own style`, () => {
			const { tree, layout, edges } = layOut(f.source);
			const model = specModel(tree);
			const illegitimate = new Set(tree.people.filter((p) => p.illegitimate).map((p) => p.id));
			for (const s of model.secondary) {
				const kinds = [...SECONDARY_KIND[s.type]];
				if (s.type === 'birth' && illegitimate.has(s.child)) kinds.push('illegitimate');
				const found = edges.paths.some((p) => kinds.includes(p.kind) && connects(p, s.parent, s.child));
				expect(found, `${s.type} line ${s.parent} → ${s.child}`).toBe(true);
			}

			// §5.3: a small "?" marker on each rumoured line, near the two people it joins.
			const rumoured = model.secondary.filter((s) => s.type === 'rumoured');
			const markers = edges.markers.filter((m) => m.kind === 'rumour');
			if (!rumoured.length) expect(markers).toEqual([]);
			const { cardW, cardH } = geometry();
			for (const s of rumoured) {
				const a = box(layout, s.parent);
				const b = box(layout, s.child);
				const near = markers.some(
					(m) =>
						m.x >= Math.min(a.x, b.x) - cardW &&
						m.x <= Math.max(a.x + a.w, b.x + b.w) + cardW &&
						m.y >= Math.min(a.y, b.y) - cardH &&
						m.y <= Math.max(a.y + a.h, b.y + b.h) + cardH,
				);
				expect(near, `rumour marker for ${s.parent} → ${s.child}`).toBe(true);
			}
		});
	}
});
