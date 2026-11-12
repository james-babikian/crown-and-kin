/*
 * D338 point 2, D341 (2): on a phone with a sideways tree, at the middle size (the Compact level), the ring of an heir stands in the middle of the left edge of its card,
 * where the child line arrives, and no longer on the corner of the card above (this changes the place rule of spec §13.21 rule 36). Other devices and the other
 * direction keep the corner of the word tab. The device decides (`isPhoneDevice`), never the width of the window. The owner's example is the Carrow sample of the
 * 0.5.3 design check ("Jasper Carrow", the 2nd heir): the ring on the left edge, centred on the card.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ordinalTabRect } from '../../src/layout/geometry';
import { RING_PX } from '../../src/render/dom/heir-ring';
import { allFixtures } from '../acceptance/load';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';
import { BODY_16 } from '../support/titles-window-support';
import { VALMONT_NOTE, overlaps, ringScene, type RingBox } from '../support/ring-scene';

useFakeDom({ css: true, createSvg: true });

const g16 = build(BODY_16).g;
const carrow = ringScene(g16, 'duke-of-carrowmere', { limit: 4, orientation: 'sideways' })!;
const carrowDown = ringScene(g16, 'duke-of-carrowmere', { limit: 4, orientation: 'down' })!;
const middle = (b: RingBox) => ({ x: b.rect.x + b.rect.w / 2, y: b.rect.y + b.rect.h / 2 });

describe('the Compact ring of a sideways tree on a phone', () => {
	it('stands in the middle of the left edge of the card, at mid-height, where the line arrives (at the size where the name keeps clear of it)', () => {
		// At a scale of 0.7 the name starts 10 px from the edge, more than half the ring.
		const boxes = carrow.place('compact', 0.7, true);
		expect(boxes).toHaveLength(4);
		for (const b of boxes) {
			const card = carrow.laid.layout.persons.get(b.id)!;
			expect(middle(b).x).toBeCloseTo(card.x, 1);
			expect(middle(b).y).toBeCloseTo(card.y + card.h / 2, 1);
			expect(b.rect.h * 0.7).toBeCloseTo(RING_PX.h, 2);
		}
	});

	it('the second heir ("Jasper Carrow") has the ring on its left edge and nothing above is covered', () => {
		const second = carrow.place('compact', 0.5, true).find((b) => b.text === '2')!;
		expect(second.id).toBe('jasper-carrow');
		const above = [...carrow.laid.layout.persons.entries()].filter(([id, p]) => id !== second.id && p.y + p.h <= carrow.laid.layout.persons.get(second.id)!.y);
		for (const [id, p] of above) expect(overlaps(second.rect, p, 0.01), id).toBe(false);
	});

	it('keeps the first letters of the name free: the ring moves left only as far as it must', () => {
		for (const scale of [0.5, 0.4, 0.3]) {
			for (const b of carrow.place('compact', scale, true)) {
				const name = carrow.nameStart.get(b.id)!;
				expect(overlaps(b.rect, name, 0.01), `${b.id} ${scale}`).toBe(false);
				// It still stands on the edge: the middle of the ring is left of the card's edge by less than half the ring.
				const card = carrow.laid.layout.persons.get(b.id)!;
				expect(b.rect.x).toBeLessThan(card.x);
				expect(b.rect.x + b.rect.w).toBeGreaterThan(card.x);
			}
		}
	});

	it('is the old place on every other device and in the other direction: the corner of the word tab', () => {
		for (const [rs, phone] of [[carrow, false], [carrowDown, true], [carrowDown, false]] as const) {
			const boxes = rs.place('compact', 0.4, phone);
			const k = 1 / 0.4;
			for (const b of boxes) {
				const box = rs.laid.layout.persons.get(b.id)!;
				const tab = ordinalTabRect(rs.laid.layout.geometry, !!box.portrait, !!box.arms, 3);
				expect(b.rect.y + b.rect.h, b.id).toBeCloseTo(box.y + tab.y + tab.h, 2);
				const left = rs.laid.layout.geometry.form === 'text';
				if (left) expect(b.rect.x, b.id).toBeCloseTo(box.x + tab.x, 2);
				else expect(b.rect.x + b.rect.w, b.id).toBeCloseTo(box.x + tab.x + tab.w, 2);
				expect(b.rect.h).toBeCloseTo(RING_PX.h * k, 2);
			}
		}
	});

	it('the device decides, not the window: placeRings gets `isPhone()` and the heir-ring file reads no width', () => {
		expect(readFileSync('src/obsidian/tree-view-placement.ts', 'utf8')).toContain('placeRings(this.scene.rings, this.lod, view.scale, this.isPhone())');
		const ring = readFileSync('src/render/dom/heir-ring.ts', 'utf8');
		expect(ring).not.toMatch(/innerWidth|clientWidth|matchMedia|max-width/);
	});
});

describe('no ring lies over another card or the start of a name at the middle size', () => {
	// The three sizes of the 0.5.3 capture: Full (no ring), Compact (a scale of 0.4) and Overview (0.12), on a computer and on a phone, in both directions.
	const cases: { name: string; rs: NonNullable<ReturnType<typeof ringScene>> }[] = [];
	for (const f of allFixtures()) {
		const g = build(f.id === '07b' ? VALMONT_NOTE : f.source).g;
		for (const t of g.titles) for (const orientation of ['down', 'sideways'] as const) {
			const rs = ringScene(g, t.id, { limit: 12, orientation });
			if (rs && rs.scene.rings.length) cases.push({ name: `${f.id} ${t.id} ${orientation}`, rs });
		}
	}

	it('the sweep covers the sample trees with a rule of succession in both directions', () => {
		expect(cases.length).toBeGreaterThanOrEqual(10);
		expect(new Set(cases.map((c) => c.name.split(' ')[0])).size).toBeGreaterThanOrEqual(3);
	});

	/** The rings of one case at the Compact level that lie over a card of another person, or over the start of their own name. */
	const hits = (scale: number, phone: boolean, sideways: boolean): string[] => {
		const out: string[] = [];
		for (const { name, rs } of cases.filter((c) => c.name.endsWith(sideways ? 'sideways' : 'down'))) {
			for (const b of rs.place('compact', scale, phone)) {
				for (const [id, p] of rs.laid.layout.persons) if (id !== b.id && overlaps(b.rect, p, 0.01)) out.push(`${name} ring ${b.text} over ${id}`);
				const start = rs.nameStart.get(b.id);
				if (start && overlaps(b.rect, start, 0.01)) out.push(`${name} ring ${b.text} over its name`);
			}
		}
		return out;
	};

	it('Compact at 0.4, top to bottom, on a computer and on a phone: no ring over a card of another person', () => {
		expect(hits(0.4, false, false)).toEqual([]);
		expect(hits(0.4, true, false)).toEqual([]);
	});

	it('Compact at 0.4 on a phone with a sideways tree: no ring over a card of another person and none over the start of a name (before the change: 26 of 45 rings covered a card)', () => {
		expect(hits(0.4, true, true)).toEqual([]);
	});

	it('Compact at 0.3 on a phone with a sideways tree: one ring lies over a card, the two-digit ring 10 of sample tree 07b (a known limit, pinned)', () => {
		expect(hits(0.3, true, true)).toEqual(['07b duke-of-valmont sideways ring 10 over corwin-lindqvist']);
	});

	it('Overview at 0.12 on a computer, top to bottom: no ring over a card of another person', () => {
		for (const { name, rs } of cases.filter((c) => c.name.endsWith('down'))) {
			for (const b of rs.place('overview', 0.12, false)) {
				for (const [id, p] of rs.laid.layout.persons) if (id !== b.id) expect(overlaps(b.rect, p, 0.01), `${name} ring ${b.text} over ${id}`).toBe(false);
			}
		}
	});
});
