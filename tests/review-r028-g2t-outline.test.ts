/* G2 review probes for src/layout/arms-outline.ts (D219). */
import { describe, expect, it } from 'vitest';
import { armsGap, traceOutline } from '../src/layout/arms-outline';

function rnd(seed: number) {
	let s = seed >>> 0;
	return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const px = (w: number, h: number, a: (x: number, y: number) => number) => {
	const p = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[(y * w + x) * 4 + 3] = a(x, y);
	return p;
};
const nums = (d: string) => d.match(/-?[\d.e+-]+/g)!.map(Number);

describe('traceOutline probes', () => {
	it('random and degenerate alpha fields never throw and never give NaN', () => {
		const r = rnd(7);
		for (let n = 0; n < 300; n++) {
			const w = 1 + Math.floor(r() * 40);
			const h = 1 + Math.floor(r() * 40);
			const mode = n % 4;
			const o = traceOutline(px(w, h, () => (mode === 0 ? r() * 256 : mode === 1 ? (r() < 0.5 ? 255 : 0) : mode === 2 ? 128 : 127)), w, h);
			if (o) {
				expect(o.d).not.toMatch(/NaN|Infinity/);
				const a = armsGap(o, { x: 0, y: 0, w: 50, h: 60 }, 3);
				expect(a.d).not.toMatch(/NaN|Infinity/);
			}
		}
	});
	it('time: 128x128 noisy and checkerboard and big circle', () => {
		const r = rnd(3);
		const cases: [string, Uint8ClampedArray][] = [
			['noise', px(128, 128, () => (r() < 0.5 ? 255 : 0))],
			['checker', px(128, 128, (x, y) => ((x + y) % 2 ? 255 : 0))],
			['blobs', px(128, 128, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? 255 : 0))],
			['circle', px(128, 128, (x, y) => (Math.hypot(x - 64, y - 64) < 60 ? 255 : 0))],
			['opaque', px(128, 128, () => 255)],
		];
		for (const [name, p] of cases) {
			const t0 = performance.now();
			const o = traceOutline(p, 128, 128);
			const t = performance.now() - t0;
			console.log(name, t.toFixed(1), 'ms', o ? o.d.length : 0, 'chars');
			expect(t).toBeLessThan(50);
		}
	});
	it('a ring-shaped (holed) arms: stroke covers outer ring only; holes remain separate rings', () => {
		const o = traceOutline(px(40, 40, (x, y) => (Math.hypot(x - 20, y - 20) < 18 && Math.hypot(x - 20, y - 20) > 8 ? 255 : 0)), 40, 40)!;
		expect((o.d.match(/M/g) ?? []).length).toBe(2);
		expect(nums(o.d).every(Number.isFinite)).toBe(true);
	});
});
