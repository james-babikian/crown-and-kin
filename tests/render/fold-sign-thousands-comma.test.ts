// The "+ N" fold sign writes its number like the fold labels (D376 (a)), and the layout counts the comma in the width of the sign.
import { describe, expect, it } from 'vitest';
import { FOLD_EM, foldExtent } from '../../src/layout/fold-spots';
import { signText } from '../../src/render/scene-model';
import { FOLD_UI, groupCount } from '../../src/render/view-text';

describe('the fold sign number', () => {
	it('has a thousands comma and keeps small numbers as they are', () => {
		expect(signText(1200)).toBe('+ 1,200');
		expect(signText(12)).toBe('+ 12');
		expect(signText(999)).toBe('+ 999');
		expect(signText(1000000)).toBe('+ 1,000,000');
	});

	it.each([0, 1, 12, 999, 1000, 1200, 12345, 1000000])('writes %i as the labels do', (n) => {
		expect(signText(n)).toBe(`+ ${groupCount(n)}`);
		if (n > 1) expect(FOLD_UI.showLabel(['A'], n)).toContain(groupCount(n));
	});

	it('widens the control rectangle by the comma', () => {
		const at = (count: number) => foldExtent({ folded: true, count } as never, { x: 0, y: 0 }, 16).w;
		const step = FOLD_EM.signTextOverview * 16;
		expect(at(1200) - at(120)).toBeCloseTo(2 * step, 9);
		expect(at(12) - at(1)).toBeCloseTo(step, 9);
	});
});
