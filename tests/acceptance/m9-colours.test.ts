import { describe, expect, it } from 'vitest';
import { speedTest } from '../support/speed-test';
import { armsColoursOf, armsCopy64, comments14, deltaE, fixtureBytes } from './m9-support';

/*
 * Spec §13.6 "Colours from the arms" (decided method), D68, and the M9 core contract rule 10 with
 * amendment A5: `armsColours` of a 64 × 64 px RGBA copy. Sample tree 14 lists the expected colours
 * of its PNG arms in `# colours:` comments, computed with the decided method from a copy made with
 * resvg; the implementation must agree within ΔE (OKLab) 0.03 (spec §13.6 acceptance). These tests
 * wait for WP 9.1 (`src/core/arms-colours.ts`).
 */

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** A 64 × 64 picture of horizontal bands: each colour takes `rows` rows; `alpha` 255 unless given. */
function bands(parts: { colour: string; rows: number; alpha?: number }[]): Uint8Array {
	const out = new Uint8Array(64 * 64 * 4);
	let y = 0;
	for (const p of parts) {
		const [r, g, b] = hex(p.colour);
		for (let k = 0; k < p.rows && y < 64; k++, y++) {
			for (let x = 0; x < 64; x++) out.set([r, g, b, p.alpha ?? 255], (y * 64 + x) * 4);
		}
	}
	return out;
}

/** Every expected colour has its own result within `tol`; the counts are equal. */
function matches(got: string[], want: string[], tol: number): string[] {
	const problems: string[] = [];
	if (got.length !== want.length) problems.push(`${got.length} colours, expected ${want.length}: ${got.join(' ')}`);
	const free = [...got];
	for (const w of want) {
		const i = free.findIndex((g) => deltaE(g, w) < tol);
		if (i < 0) problems.push(`no colour within ΔE ${tol} of ${w} in ${got.join(' ')}`);
		else free.splice(i, 1);
	}
	return problems;
}

describe('sample tree 14: the colours of the PNG arms are the ones in the fixture comment (spec §13.6 acceptance, A5)', () => {
	const expected = comments14().colours;

	it('the comment lists both PNG arms', () => {
		expect([...expected.keys()].sort()).toEqual(['castellane-arms-lineart.png', 'valmont-arms.png']);
	});

	for (const [file, want] of expected) {
		it(`${file}: ${want.join(', ')}, each within ΔE 0.03, largest share first`, async () => {
			const armsColours = await armsColoursOf();
			const got = armsColours(armsCopy64(fixtureBytes(`pictures/${file}`), 'image/png'), 64, 64);
			expect(matches(got, want, 0.03)).toEqual([]);
			// The shares of the Valmont colours are far apart (about 67 %, 20 % and 10 %), so the order is fixed.
			got.forEach((g, i) => expect(deltaE(g, want[i]), `colour ${i + 1}`).toBeLessThan(0.03));
		});
	}
});

describe('armsColours: the decided method (spec §13.6; contract rule 10)', () => {
	it('lower-case #rrggbb texts', async () => {
		const armsColours = await armsColoursOf();
		const got = armsColours(bands([{ colour: '#1F4E9C', rows: 40 }, { colour: '#F2C230', rows: 24 }]), 64, 64);
		expect(got.length).toBeGreaterThan(0);
		for (const c of got) expect(c).toMatch(/^#[0-9a-f]{6}$/);
	});

	it('flat colours give their exact colours (the group mean), largest share first, with no contrast change (D68)', async () => {
		const armsColours = await armsColoursOf();
		const got = armsColours(bands([{ colour: '#f2c230', rows: 16 }, { colour: '#1f4e9c', rows: 48 }]), 64, 64);
		expect(matches(got, ['#1f4e9c', '#f2c230'], 0.002)).toEqual([]);
		expect(deltaE(got[0], '#1f4e9c')).toBeLessThan(0.002);
		// A very light and a very dark colour stay as they are (no change for contrast).
		const light = armsColours(bands([{ colour: '#fdfdfb', rows: 40 }, { colour: '#0a0a0a', rows: 24 }]), 64, 64);
		expect(matches(light, ['#fdfdfb', '#0a0a0a'], 0.002)).toEqual([]);
	});

	it('pixels more than half transparent (alpha under 128) do not count', async () => {
		const armsColours = await armsColoursOf();
		const got = armsColours(bands([{ colour: '#c8102e', rows: 40, alpha: 127 }, { colour: '#1f4e9c', rows: 24, alpha: 128 }]), 64, 64);
		expect(matches(got, ['#1f4e9c'], 0.002)).toEqual([]);
	});

	it('no pixel counts: no colours', async () => {
		const armsColours = await armsColoursOf();
		expect(armsColours(new Uint8Array(64 * 64 * 4), 64, 64)).toEqual([]);
		expect(armsColours(bands([{ colour: '#c8102e', rows: 64, alpha: 100 }]), 64, 64)).toEqual([]);
	});

	it('groups with less than 5 % of the counted pixels are dropped', async () => {
		const armsColours = await armsColoursOf();
		// 2 rows of 64 are 3.1 %; 4 rows are 6.25 %.
		const got = armsColours(bands([{ colour: '#c8102e', rows: 62 }, { colour: '#1f4e9c', rows: 2 }]), 64, 64);
		expect(matches(got, ['#c8102e'], 0.002)).toEqual([]);
		const kept = armsColours(bands([{ colour: '#c8102e', rows: 60 }, { colour: '#1f4e9c', rows: 4 }]), 64, 64);
		expect(matches(kept, ['#c8102e', '#1f4e9c'], 0.002)).toEqual([]);
		// Transparent pixels do not count: 3 blue rows among 30 counted rows are 10 %.
		const clear = armsColours(bands([{ colour: '#c8102e', rows: 27 }, { colour: '#1f4e9c', rows: 3 }, { colour: '#000000', rows: 34, alpha: 0 }]), 64, 64);
		expect(matches(clear, ['#c8102e', '#1f4e9c'], 0.002)).toEqual([]);
	});

	it('colours closer than ΔE 0.05 are one group, whose colour is their pixel-weighted mean', async () => {
		const armsColours = await armsColoursOf();
		expect(deltaE('#c8102e', '#c01a30')).toBeLessThan(0.05);
		const got = armsColours(bands([{ colour: '#c8102e', rows: 32 }, { colour: '#c01a30', rows: 32 }]), 64, 64);
		expect(got.length).toBe(1);
		expect(deltaE(got[0], '#c8102e')).toBeLessThan(0.05);
		expect(deltaE(got[0], '#c01a30')).toBeLessThan(0.05);
	});

	it('at most 5 colours, each at least 5 % (8 equal bands of very different colours)', async () => {
		const armsColours = await armsColoursOf();
		const eight = ['#c8102e', '#1f4e9c', '#1e7b3a', '#f2c230', '#141414', '#f7f7f4', '#6b2c7a', '#e07020'];
		const got = armsColours(
			bands(eight.map((colour) => ({ colour, rows: 8 }))),
			64,
			64,
		);
		expect(got.length).toBeGreaterThan(0);
		expect(got.length).toBeLessThanOrEqual(5);
		expect(new Set(got).size).toBe(got.length);
		// No two results look nearly the same (they would have merged).
		for (let i = 0; i < got.length; i++) for (let j = i + 1; j < got.length; j++) expect(deltaE(got[i], got[j])).toBeGreaterThanOrEqual(0.05);
	});

	it('deterministic: the same pixels always give the same colours', async () => {
		const armsColours = await armsColoursOf();
		const rgba = armsCopy64(fixtureBytes('pictures/valmont-arms.png'), 'image/png');
		const first = armsColours(rgba, 64, 64);
		for (let k = 0; k < 3; k++) expect(armsColours(new Uint8Array(rgba), 64, 64)).toEqual(first);
		// A Uint8ClampedArray (canvas getImageData) gives the same.
		expect(armsColours(new Uint8ClampedArray(rgba), 64, 64)).toEqual(first);
	});

	speedTest('under 50 ms for a 64 × 64 copy (spec §13.6 target)', async () => {
		const armsColours = await armsColoursOf();
		const rgba = armsCopy64(fixtureBytes('pictures/valmont-arms.png'), 'image/png');
		armsColours(rgba, 64, 64);
		const times: number[] = [];
		for (let k = 0; k < 5; k++) {
			const t0 = performance.now();
			armsColours(rgba, 64, 64);
			times.push(performance.now() - t0);
		}
		times.sort((a, b) => a - b);
		expect(times[2]).toBeLessThan(50);
	});
});
