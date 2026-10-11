import { describe, expect, it } from 'vitest';
import { ROUNDEL_EM, SIGN_LINE_CLEAR_PX, TAB_REACH_PAD_PX, cardForm, geometryFor } from '../src/layout/geometry';

// 0.2.5 (B.2): `cardForm` only sets `form`; it changes no number, so no old picture or cache key moves.

describe('cardForm', () => {
	it('down gives the Roundel; nothing else changes', () => {
		const geo = geometryFor(16);
		const out = cardForm(geo, 'down');
		expect(out).toEqual({ ...geo, form: 'roundel' });
		expect(out.cardH).toBe(geo.cardH);
		expect(out.crown).toBeUndefined();
		expect(out.reach).toBeUndefined();
	});

	it('sideways gives the text card', () => {
		expect(cardForm(geometryFor(16), 'sideways').form).toBe('text');
	});

	it('every direction has a form (0.2.6, D179: no card size keeps the classic card)', () => {
		for (const f of [8, 12, 16, 48]) {
			expect(cardForm(geometryFor(f), 'down').form).toBe('roundel');
			expect(cardForm(geometryFor(f), 'sideways').form).toBe('text');
		}
	});

	it('is idempotent', () => {
		const once = cardForm(geometryFor(12), 'down');
		expect(cardForm(once, 'down')).toBe(once);
	});

	it('a geometry with no form is unchanged by the new optional fields (no key appears)', () => {
		const geo = geometryFor(16);
		expect(Object.keys(geo)).not.toContain('form');
		expect(Object.keys(geo)).not.toContain('crown');
		expect(Object.keys(geo)).not.toContain('reach');
	});
});

describe('Roundel constants', () => {
	it('hold the numbers of contract B.2', () => {
		expect(ROUNDEL_EM).toEqual({ crown: 0.75, reach: 1.6, medal: 1, ring: 0.15, halo: 0.2, above: 0.25, column: 10, plateMore: 0.25, armsGap: 0.55, tabW: 2.3, tabH: 1.15, tabAbove: 0.55, tabAboveText: 0.9, wordRaise: 0.15 });
		expect(TAB_REACH_PAD_PX).toBe(1);
		expect(SIGN_LINE_CLEAR_PX).toBe(5);
	});
});
