/*
 * Seeded random numbers for the tests, in one place. The same seed gives the same numbers on every machine,
 * so a failure can be repeated. `rng` is mulberry32 (a small, good generator); `Rng` is the same generator as a
 * class with `int`, `chance` and `pick`; `lcg`, `xorshift` and `lcg31` are older generators that some tests
 * keep because their seeds are named in the decision notes (a seed gives other numbers on another generator, so the
 * tests that used one keep it). `hash32` makes a seed from a text.
 */

/** A 32-bit seed from a text (FNV-1a). */
export function hash32(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** mulberry32 as a class, with the helpers the fuzz tests use. */
export class Rng {
	private s: number;
	constructor(seed: number) {
		this.s = seed >>> 0;
	}
	/** mulberry32 */
	next(): number {
		let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	int(n: number): number {
		return Math.floor(this.next() * n);
	}
	chance(p: number): boolean {
		return this.next() < p;
	}
	pick<T>(xs: readonly T[]): T {
		return xs[this.int(xs.length)];
	}
}

/** A small seeded random generator (mulberry32): each call gives the next number in [0, 1). */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A linear congruential generator (multiplier 1664525, increment 1013904223) on 32 bits. */
export function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/** A linear congruential generator on 31 bits (multiplier 1103515245, increment 12345), in floating point. */
export function lcg31(seed: number): () => number {
	let x = seed;
	return () => {
		x = (x * 1103515245 + 12345) % 2147483648;
		return x / 2147483648;
	};
}

/** xorshift32 (a zero seed becomes 1). */
export function xorshift(seed: number): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 4294967296;
	};
}
