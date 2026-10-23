/*
 * The saved value of the fence index (0.4 WP-3a, the index contract 1.3). Pure code: the stamp of a note, the codec of the stamp list, and the check of a stored value.
 * `src/view/fence-index.ts` keeps the state and decides when to save; this file only turns state into a value and a value back into state, and never throws on bad input.
 */

/** A path key and a stamp, both unsigned 32 bit numbers. */
export type StampPair = readonly [key: number, stamp: number];

/** The flags of a note that holds a fence: 1 = `kin`, 2 = `kin-calendar`, 3 = both. */
export type FenceFlag = 1 | 2 | 3;

/** The value in the local storage of the vault. */
export interface StoreValue {
	v: 1;
	n: number;
	f: Record<string, FenceFlag>;
	s: string | null;
}

/** What a good stored value holds: the flags, and the stamps by path key. */
export interface StoredState {
	flags: Map<string, FenceFlag>;
	stamps: Map<number, number>;
}

/** The most notes with a fence that the value holds. */
export const MAX_FLAGS = 20_000;
/** The most characters of the value as JSON (the local storage is shared by all vaults and plugins). */
export const MAX_CHARS = 500_000;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** FNV-1a, 32 bits, unsigned, over the UTF-16 code units of a text. A code unit is cheaper than a byte encoding and equal for plain names. */
export function fnv1a32(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** The key of a path. */
export const pathKey = (path: string): number => fnv1a32(path);

/** The stamp of a note: it changes when the modified time or the size changes. */
export const stampOf = (mtime: number, size: number): number => fnv1a32(`${mtime}:${size}`);

/** The length of `encodeStore` for `count` pairs, to test a limit before the work. */
export const encodedLength = (count: number): number => 4 * Math.ceil((count * 8) / 3);

/** Turns pairs into base64 of little-endian uint32 pairs, sorted by key (8 bytes each). */
export function encodeStore(pairs: readonly StampPair[]): string {
	const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
	const bytes = new Uint8Array(sorted.length * 8);
	const view = new DataView(bytes.buffer);
	sorted.forEach(([key, stamp], i) => {
		view.setUint32(i * 8, key, true);
		view.setUint32(i * 8 + 4, stamp, true);
	});
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x2000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[]);
	return btoa(binary);
}

/** Turns base64 back into pairs. It gives null when the text is not valid base64 or its size is not a multiple of 8 bytes. */
export function decodeStore(text: string): StampPair[] | null {
	if (typeof text !== 'string' || !BASE64.test(text)) return null;
	let binary: string;
	try {
		binary = atob(text);
	} catch {
		return null;
	}
	if (binary.length % 8 !== 0) return null;
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const view = new DataView(bytes.buffer);
	const out: StampPair[] = [];
	for (let i = 0; i < bytes.length; i += 8) out.push([view.getUint32(i, true), view.getUint32(i + 4, true)]);
	return out;
}

const isFlag = (x: unknown): x is FenceFlag => x === 1 || x === 2 || x === 3;

/** Checks a stored value. It gives null for a value that is not good in every part (a broken store is ignored whole). Never throws. */
export function readStoreValue(raw: unknown): StoredState | null {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	if (value.v !== 1 || typeof value.n !== 'number' || !Number.isInteger(value.n) || value.n < 0) return null;
	const f = value.f;
	if (typeof f !== 'object' || f === null || Array.isArray(f)) return null;
	const names = Object.keys(f);
	if (names.length > MAX_FLAGS) return null;
	const flags = new Map<string, FenceFlag>();
	for (const name of names) {
		const flag = (f as Record<string, unknown>)[name];
		if (!isFlag(flag)) return null;
		flags.set(name, flag);
	}
	const stamps = new Map<number, number>();
	if (value.s !== null) {
		if (typeof value.s !== 'string') return null;
		const pairs = decodeStore(value.s);
		if (!pairs || pairs.length !== value.n) return null;
		for (const [key, stamp] of pairs) stamps.set(key, stamp);
	}
	return { flags, stamps };
}

/**
 * Builds the value to save. The stamp list is left out (`s` null) when the value would pass the character limit; it gives null when even the flags are too many or too long, and nothing is then saved.
 */
export function makeStoreValue(flags: ReadonlyMap<string, FenceFlag>, pairs: readonly StampPair[]): StoreValue | null {
	if (flags.size > MAX_FLAGS) return null;
	const f: Record<string, FenceFlag> = {};
	for (const [path, flag] of flags) f[path] = flag;
	const base = JSON.stringify(f).length + 40;
	if (base > MAX_CHARS) return null;
	if (pairs.length === 0 || base + encodedLength(pairs.length) > MAX_CHARS) return { v: 1, n: 0, f, s: null };
	return { v: 1, n: pairs.length, f, s: encodeStore(pairs) };
}
