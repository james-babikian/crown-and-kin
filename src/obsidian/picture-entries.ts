/*
 * The list of small copies of the picture store (spec §13.0 item 3): a least-recently-used list of encoded copies in a 24 MB limit, each with a
 * blob URL and a count of holders. A copy in use is never evicted; a copy whose file changed while it was in use leaves at its last release.
 * `picture-store.ts` makes the copies; this file only keeps them.
 */

import type { TFile } from 'obsidian';
import { linkOf } from './picture-io';

/** O3: the encoded copies of all trees, in bytes (spec §13.0 item 3: 24 MB). */
export const STORE_BYTES = 24_000_000;

/** A small copy in use; `release` lets the store forget it (it acts once). */
export interface PictureCopy {
	url: string;
	w: number;
	h: number;
	release(): void;
}

/** One copy in the list. */
export interface Entry {
	key: string;
	path: string;
	url: string;
	bytes: number;
	w: number;
	h: number;
	refs: number;
	/** The file changed while the copy was in use: it leaves at its last release. */
	stale: boolean;
}

/** A list entry for a copy, from the device or just drawn. A device that cannot make a link gives null, so the request ends with no picture. */
export function entryOf(file: TFile, key: string, c: { blob: Blob; w: number; h: number }): Entry | null {
	const url = linkOf(c.blob);
	return url === null ? null : { key, path: file.path, url, bytes: c.blob.size, w: c.w, h: c.h, refs: 0, stale: false };
}

/** A transient copy belongs to its one caller: its release revokes the URL. */
export function own(e: Entry): PictureCopy {
	let done = false;
	return {
		url: e.url,
		w: e.w,
		h: e.h,
		release() {
			if (done) return;
			done = true;
			URL.revokeObjectURL(e.url);
		},
	};
}

/** The least-recently-used list of copies, with the holders of each. */
export class PictureEntries {
	private readonly lru = new Map<string, Entry>();
	/** Copies whose file changed while they were in use. */
	private readonly staleInUse = new Set<Entry>();
	private total = 0;

	/** `forgetOutline` hears the file key (path and signature) when the last copy of a file leaves. */
	constructor(private readonly forgetOutline: (fileKey: string) => void) {}

	/** The encoded bytes of the copies the list holds. */
	get bytes(): number {
		return this.total;
	}

	/** The copies in the list. */
	get size(): number {
		return this.lru.size;
	}

	/** The copies with at least one holder. */
	inUse(): number {
		let n = 0;
		for (const e of this.lru.values()) if (e.refs > 0) n++;
		for (const e of this.staleInUse) if (e.refs > 0) n++;
		return n;
	}

	private touch(e: Entry): void {
		this.lru.delete(e.key);
		this.lru.set(e.key, e);
	}

	/** The copy for `key`, now held for the caller; null when the list has none. */
	held(key: string): PictureCopy | null {
		const e = this.lru.get(key);
		if (!e) return null;
		this.touch(e);
		return this.hold(e);
	}

	/** B15: the copy for `key` with no holder (its `release` does nothing); null when the list has none. */
	peek(key: string): PictureCopy | null {
		const e = this.lru.get(key);
		if (!e) return null;
		this.touch(e);
		return { url: e.url, w: e.w, h: e.h, release() {} };
	}

	/** Puts a new copy in the list; the caller holds it before `evict`. */
	add(e: Entry): void {
		this.lru.set(e.key, e);
		this.total += e.bytes;
	}

	/** Counts one more holder of the copy. */
	hold(e: Entry): PictureCopy {
		e.refs++;
		let done = false;
		return {
			url: e.url,
			w: e.w,
			h: e.h,
			release: () => {
				if (done) return;
				done = true;
				e.refs = Math.max(0, e.refs - 1);
				if (e.refs > 0) return;
				if (e.stale) this.drop(e);
				else this.evict();
			},
		};
	}

	private drop(e: Entry): void {
		if (this.lru.get(e.key) === e) this.lru.delete(e.key);
		this.staleInUse.delete(e);
		// The outline belongs to the file and its signature: it leaves with the last copy of that file.
		const fileKey = e.key.split('\u0000').slice(0, 2).join('\u0000');
		const sameFile = (o: Entry) => o !== e && o.key.startsWith(`${fileKey}\u0000`);
		if (![...this.lru.values()].some(sameFile) && ![...this.staleInUse].some(sameFile)) this.forgetOutline(fileKey);
		// `bytes` goes to 0, so a second drop of the same copy counts nothing.
		this.total -= e.bytes;
		e.bytes = 0;
		try {
			URL.revokeObjectURL(e.url);
		} catch {
			// Nothing to free.
		}
	}

	/** O3: the least recently used copies leave until the list fits; a copy in use never leaves. */
	evict(): void {
		if (this.total <= STORE_BYTES) return;
		for (const e of [...this.lru.values()]) {
			if (this.total <= STORE_BYTES) break;
			if (e.refs === 0) this.drop(e);
		}
	}

	/** O8, O9: forgets every copy of the path. A copy in use stays until its release. */
	invalidate(path: string): void {
		for (const e of [...this.lru.values()]) {
			if (e.path !== path) continue;
			if (e.refs === 0) this.drop(e);
			else {
				// B15: the view fetches the new copy before it lets the old one go.
				this.lru.delete(e.key);
				e.stale = true;
				this.staleInUse.add(e);
			}
		}
	}

	/** Plugin unload: revokes every URL. */
	clear(): void {
		for (const e of [...this.lru.values(), ...this.staleInUse]) this.drop(e);
		this.lru.clear();
		this.staleInUse.clear();
	}
}
