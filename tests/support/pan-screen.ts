// Where a tree point is on screen after a pan, whichever way the picture is shown: by the scene <g> alone, or by the <g>, the margin offset of the <svg> (its left and top margin, D366, D367) and the wrapper transform.
import { expect } from 'vitest';

import { GESTURE_CLASS, type PanZoom } from '../../src/render/dom/pan-zoom';
import type { Size } from '../../src/render/view-math';
import type { FEl } from '../acceptance/fake-dom';

/** Where a tree point is on screen, read from the <g> transform, the margin offset of the <svg> and the wrapper transform: the one thing that must not depend on the path. */
export function onScreen(r: { scene: FEl; canvas: FEl }, p: { x: number; y: number }): { x: number; y: number } {
	const g = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(r.scene.getAttribute('transform') ?? '');
	if (!g) throw new Error('no scene transform');
	const [tx, ty, s] = [Number(g[1]), Number(g[2]), Number(g[3])];
	const mx = parseFloat((r.scene.parentElement as FEl).style.getPropertyValue('--dynasty-margin-left')) || 0;
	const my = parseFloat((r.scene.parentElement as FEl).style.getPropertyValue('--dynasty-margin-top')) || 0;
	const local = { x: p.x * s + tx - mx, y: p.y * s + ty - my };
	const w = r.canvas.hasClass(GESTURE_CLASS) ? /matrix\(([^)]+)\)/.exec(r.canvas.style.getPropertyValue('--dynasty-gesture-transform')) : null;
	if (!w) return local;
	const n = w[1].split(/[ ,]+/).map(Number);
	return { x: local.x * n[0] + n[4], y: local.y * n[3] + n[5] };
}

/** The screen shows `pz.view`: two tree points are where the view puts them, whichever of the two ways shows it. */
export function showsView(r: { scene: FEl; canvas: FEl; pz: PanZoom }, size: Size): void {
	const v = r.pz.view!;
	for (const p of [{ x: v.cx, y: v.cy }, { x: v.cx - 150, y: v.cy + 90 }]) {
		const at = onScreen(r, p);
		expect(at.x).toBeCloseTo((p.x - v.cx) * v.scale + size.w / 2, 1);
		expect(at.y).toBeCloseTo((p.y - v.cy) * v.scale + size.h / 2, 1);
	}
}
