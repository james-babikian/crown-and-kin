import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/layout/model';
import { focusView } from '../src/view/focus-mode';
import type { View } from '../src/render/view-math';

// Check of the WP-8 view fix, item 6 (G3 F4): the names go under 14 px only when a child then shows whole beside the focus card ("If no child shows even then, the view is as before").

describe('item 6: the smaller names always buy a whole child', () => {
	const bounds = { x: 0, y: 0, w: 8000, h: 3000 };
	// A low area (a phone on its side between the bars).
	const area = { w: 844, h: 290 };
	const focus: Rect = { x: 3000, y: 1000, w: 180, h: 61 };
	const parent: Rect = { x: 3000, y: 859, w: 180, h: 61 };
	// A on the first child row, far to the right; B on the second child row, nearer.
	const childA: Rect = { x: 4120, y: 1141, w: 180, h: 61 };
	const childB: Rect = { x: 2200, y: 1282, w: 180, h: 61 };
	const whole = (v: View, b: Rect) => {
		const l = area.w / 2 + (b.x - v.cx) * v.scale;
		const t = area.h / 2 + (b.y - v.cy) * v.scale;
		return l >= -1e-6 && l + b.w * v.scale <= area.w + 1e-6 && t >= -1e-6 && t + b.h * v.scale <= area.h + 1e-6;
	};

	it('the low view (D30) at 14 px flips to the centred view at the smaller scale: the names must not shrink unless a child is whole', () => {
		const v = focusView(bounds, area, 16, focus, 0, [childA, childB], false, [parent]);
		const names = v.scale * 16;
		const kids = [childA, childB].filter((c) => whole(v, c));
		// Either the view is as before (14 px names), or a child is whole beside the whole focus card.
		expect(names >= 14 - 1e-6 || (whole(v, focus) && kids.length > 0), `names ${names.toFixed(2)} px, whole children ${kids.length}`).toBe(true);
	});
});
