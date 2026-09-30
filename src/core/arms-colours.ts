/*
 * "Colours from the arms" (spec §13.6, D68; contract rule 10 and A5): the main colours of a coat
 * of arms, for the colour choice of the Houses window. The Obsidian side draws the arms into a
 * 64 × 64 px copy (fitted with `fitMeet`, transparent around them) and gives its RGBA pixels here.
 * The method is the one the owner saw in the M9 preview (`scripts/m9-preview/colours.ts` on the
 * branch `v1.1/m9-preview`): pixels in OKLab, seeds from a coarse histogram, k-means, small groups
 * dropped, near groups merged. The colours come out exactly as the groups' means, with no change
 * for contrast. Pure and deterministic.
 */

type Lab = [number, number, number];

/** Groups closer than this (ΔE in OKLab) look nearly the same and are merged. */
export const MERGE_DE = 0.05;
/** Groups with less than this share of the counted pixels are dropped. */
export const MIN_SHARE = 0.05;
/** At most this many colours. */
const MAX_GROUPS = 5;
const ROUNDS = 25;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (0–255) to OKLab (Björn Ottosson's matrices). */
function oklab(r: number, g: number, b: number): Lab {
	const R = toLinear(r / 255);
	const G = toLinear(g / 255);
	const B = toLinear(b / 255);
	const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab to linear sRGB (may be outside 0–1). */
function linearRgb([L, a, b]: Lab): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const inGamut = (c: number[]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLab to lower-case #rrggbb; outside the sRGB gamut the chroma is reduced until it fits. */
function labHex(lab: Lab): string {
	let [L, a, b] = lab;
	L = Math.min(1, Math.max(0, L));
	let c = linearRgb([L, a, b]);
	for (let k = 0; k < 40 && !inGamut(c); k++) {
		a *= 0.93;
		b *= 0.93;
		c = linearRgb([L, a, b]);
	}
	return '#' + c.map((v) => Math.round(255 * toGamma(Math.min(1, Math.max(0, v)))).toString(16).padStart(2, '0')).join('');
}

const dist2 = (p: ArrayLike<number>, i: number, q: Lab) => {
	const d0 = p[i] - q[0];
	const d1 = p[i + 1] - q[1];
	const d2 = p[i + 2] - q[2];
	return d0 * d0 + d1 * d1 + d2 * d2;
};
const dist = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/**
 * The main colours of arms (spec §13.6): up to 5 lower-case #rrggbb texts, largest share first;
 * [] when no pixel counts. `rgba` holds `width` × `height` pixels, not premultiplied (as a
 * canvas's `getImageData` gives them). Pixels with alpha under 128 do not count.
 */
export function armsColours(rgba: ArrayLike<number>, width: number, height: number): string[] {
	try {
		const len = rgba?.length ?? 0;
		const want = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? width * height * 4 : len;
		const end = Math.min(len, want) - (Math.min(len, want) % 4);
		const pts: number[] = [];
		for (let i = 0; i < end; i += 4) {
			if (!(rgba[i + 3] >= 128)) continue;
			const p = oklab(rgba[i], rgba[i + 1], rgba[i + 2]);
			if (p.every(Number.isFinite)) pts.push(p[0], p[1], p[2]);
		}
		const count = pts.length / 3;
		if (count === 0) return [];

		// Seeds: the fullest bins of a coarse histogram, far enough apart, so the result does not depend on chance.
		const bins = new Map<string, { n: number; sum: Lab }>();
		for (let i = 0; i < pts.length; i += 3) {
			const key = `${Math.round(pts[i] / 0.06)},${Math.round(pts[i + 1] / 0.04)},${Math.round(pts[i + 2] / 0.04)}`;
			let bin = bins.get(key);
			if (!bin) bins.set(key, (bin = { n: 0, sum: [0, 0, 0] }));
			bin.n++;
			bin.sum[0] += pts[i];
			bin.sum[1] += pts[i + 1];
			bin.sum[2] += pts[i + 2];
		}
		const seeds: Lab[] = [];
		for (const bin of [...bins.values()].sort((x, y) => y.n - x.n)) {
			const c: Lab = [bin.sum[0] / bin.n, bin.sum[1] / bin.n, bin.sum[2] / bin.n];
			if (seeds.every((s) => dist(s, c) > MERGE_DE)) seeds.push(c);
			if (seeds.length === MAX_GROUPS) break;
		}

		let centres = seeds;
		let counts: number[] = [];
		for (let round = 0; round < ROUNDS; round++) {
			const sums = centres.map((): Lab => [0, 0, 0]);
			counts = centres.map(() => 0);
			for (let i = 0; i < pts.length; i += 3) {
				let best = 0;
				let bestD = dist2(pts, i, centres[0]);
				for (let k = 1; k < centres.length; k++) {
					const d = dist2(pts, i, centres[k]);
					if (d < bestD) {
						best = k;
						bestD = d;
					}
				}
				counts[best]++;
				sums[best][0] += pts[i];
				sums[best][1] += pts[i + 1];
				sums[best][2] += pts[i + 2];
			}
			centres = centres.map((c, k): Lab => (counts[k] ? [sums[k][0] / counts[k], sums[k][1] / counts[k], sums[k][2] / counts[k]] : c));
		}

		let groups = centres.map((lab, k) => ({ lab, n: counts[k] })).filter((x) => x.n / count >= MIN_SHARE);
		// Merge the first pair that looks nearly the same (pixel-weighted mean), until none does.
		for (let merged = true; merged; ) {
			merged = false;
			for (let i = 0; i < groups.length && !merged; i++) {
				for (let j = i + 1; j < groups.length && !merged; j++) {
					if (dist(groups[i].lab, groups[j].lab) >= MERGE_DE) continue;
					const n = groups[i].n + groups[j].n;
					const lab = [0, 1, 2].map((d) => (groups[i].lab[d] * groups[i].n + groups[j].lab[d] * groups[j].n) / n) as Lab;
					groups = [...groups.filter((_, k) => k !== i && k !== j), { lab, n }];
					merged = true;
				}
			}
		}
		return groups.sort((x, y) => y.n - x.n).map((x) => labHex(x.lab));
	} catch {
		return [];
	}
}
