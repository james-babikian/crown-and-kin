/*
 * 0.2.8 G5b, fault P7: the content of a Roundel card (name, dates, portrait, "You" tab) is centred on the whole card. The axis was 0.25 em right of the
 * middle, left over from the house strip of the old card (D197 replaced the strip by the top ribbon). The widths that fit names and relation words did not change.
 */
import { describe, expect, it } from 'vitest';
import { cardForm, cardText, geometryFor, roundelAxis, roundelPics } from '../../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../../src/layout/index';
import { renderSvg } from '../../src/render/svg-string';
import { build } from '../support/helpers';

const SIZES = [8, 10, 12, 14, 16, 20, 24, 36, 48];

describe('P7: the Roundel axis is the middle of the card', () => {
	it('axis, text anchor, portrait centre are cardW / 2 at every size', () => {
		for (const f of SIZES) {
			const geo = cardForm({ ...geometryFor(f), relationLine: true }, 'down');
			const t = cardText(geo, 1);
			expect(roundelAxis(geo), `f${f}`).toBe(geo.cardW / 2);
			expect(t.anchorX, `f${f}`).toBe(geo.cardW / 2);
			expect(t.r1!.axis, `f${f}`).toBe(geo.cardW / 2);
			expect(roundelPics(geo, { arms: false, portrait: true }).cx, `f${f}`).toBe(geo.cardW / 2);
			expect(roundelPics(geo, { arms: true, portrait: false }).arms!.x + roundelPics(geo, { arms: true, portrait: false }).arms!.w / 2, `f${f}`).toBeCloseTo(geo.cardW / 2, 9);
		}
	});

	it('the card width and the widths that fit text are the 0.2.7 numbers (only the inner offset moved)', () => {
		for (const f of SIZES) {
			const plain = geometryFor(f);
			const geo = cardForm({ ...plain, relationLine: true }, 'down');
			const t = cardText(geo, 1);
			const old = geo.cardW / 2 + 0.25 * f; // the 0.2.7 axis
			expect(geo.cardW, `f${f}`).toBe(plain.cardW);
			expect(t.textW, `f${f}`).toBe(10 * f);
			const signRight = geo.cardW - 0.5 * f;
			expect(t.nameWithSignW, `f${f}`).toBeCloseTo(2 * (signRight - 1.125 * f - 0.25 * f - old), 9);
			expect(t.relationW!, `f${f}`).toBeGreaterThan(t.textW);
		}
	});

	it('the saved picture centres the name and the portrait slot on the middle of the card', () => {
		const { g } = build('people:\n  - {id: a, name: Aldric}\n  - {id: b, name: Bert, parents: [a]}\n');
		clearLayoutCache();
		const geo = cardForm(geometryFor(16), 'down');
		const { layout, edges } = layoutTree(g, geo, { sweeps: 4, far: { maxCardWidths: Infinity, maxGenerations: Infinity } }, 'test');
		const svg = renderSvg(g, layout, edges);
		const box = layout.persons.get('a')!;
		const m = new RegExp(`<text x="([0-9.]+)"[^>]*text-anchor="middle"[^>]*>Aldric<`).exec(svg);
		expect(m, 'the name text').not.toBeNull();
		expect(Number(m![1])).toBeCloseTo(box.x + box.w / 2, 6);
	});
});
