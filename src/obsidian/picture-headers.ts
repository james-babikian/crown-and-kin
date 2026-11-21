/*
 * The header results of the picture store: what the first bytes of each picture file said (a supported format, or a problem), kept in memory
 * and, for a good part of them, in the plugin's local storage across sessions (spec §13.6, B14). It also holds the small helpers that every
 * part of the store shares: the file signature, the "not an image" problem and the test for a problem.
 * Nothing here throws: a damaged saved entry only means that the store checks the file again.
 */

import type { App, TFile } from 'obsidian';
import { judgeHeader, readPictureHeader, type PictureProblem, type SupportedFormat } from '../core/pictures';
import { guarded } from './start-guard';

/** What the first bytes of a file said: its format, or the problem. */
export type HeaderResult = { ok: true; format: SupportedFormat } | PictureProblem;

/** B14: the header results kept across sessions, in the plugin's local storage. */
export const HEADER_STORE_KEY = 'crown-and-kin-picture-headers';
/** The most header results kept. */
const HEADER_STORE_MAX = 2000;

type Kept = { sig: string; result: HeaderResult };

/** The file's mtime and size as one text, so a changed file never meets an old result or an old copy. */
export const sigOf = (f: TFile) => `${f.stat?.mtime ?? 0}:${f.stat?.size ?? 0}`;
/** The problem of a file that is not a picture the plugin can read. */
export const notImage = (f: TFile): PictureProblem => ({ ok: false, code: 'picture-not-image', file: f.name });
/** True if `x` is a picture problem and not a result. */
export const isProblem = (x: unknown): x is PictureProblem => !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false;

/** The header results of the store: memory first, then the results kept from earlier sessions. */
export class PictureHeaders {
	private readonly memory = new Map<string, Kept>();
	private saved: Map<string, Kept> | null = null;
	private saveTimer: number | null = null;

	constructor(
		private readonly app: App,
		private readonly isClosed: () => boolean,
	) {}

	private savedHeaders(): Map<string, Kept> {
		if (this.saved) return this.saved;
		const saved = new Map<string, Kept>();
		this.saved = saved;
		try {
			const raw: unknown = this.app.loadLocalStorage(HEADER_STORE_KEY);
			const list = raw && typeof raw === 'object' && Array.isArray((raw as { e?: unknown }).e) ? (raw as { e: unknown[] }).e : [];
			for (const x of list) {
				if (!Array.isArray(x) || typeof x[0] !== 'string' || typeof x[1] !== 'string' || !x[2] || typeof x[2] !== 'object') continue;
				saved.set(x[0], { sig: x[1], result: x[2] as HeaderResult });
			}
		} catch {
			// A damaged entry: the store checks the files again.
		}
		return saved;
	}

	private store(): void {
		this.saveTimer = null;
		guarded('cannot keep the picture checks', () => {
			const saved = this.saved;
			if (!saved) return;
			this.app.saveLocalStorage(HEADER_STORE_KEY, { v: 1, e: [...saved].map(([p, x]) => [p, x.sig, x.result]) });
		});
	}

	/** Keeps the result for the file as it is now; `keep` also keeps it across sessions (a decode fault lasts only until the plugin unloads). */
	remember(file: TFile, result: HeaderResult, keep: boolean): void {
		const sig = sigOf(file);
		this.memory.set(file.path, { sig, result });
		if (!keep) return;
		const s = this.savedHeaders();
		s.delete(file.path);
		s.set(file.path, { sig, result });
		// The oldest entries go first (a Map keeps its order of insertion).
		while (s.size > HEADER_STORE_MAX) s.delete(s.keys().next().value!);
		if (this.saveTimer === null && !this.isClosed()) this.saveTimer = window.setTimeout(() => this.store(), 1000);
	}

	/** The header result of the file as it is now (memory first, then the kept results), or null. */
	of(file: TFile): HeaderResult | null {
		const sig = sigOf(file);
		const m = this.memory.get(file.path);
		if (m && m.sig === sig) return m.result;
		const s = this.savedHeaders().get(file.path);
		if (s && s.sig === sig) {
			this.memory.set(file.path, s);
			return s.result;
		}
		return null;
	}

	/** The header verdict from bytes, remembered for the next check. */
	judge(file: TFile, bytes: ArrayBuffer): HeaderResult {
		const result = judgeHeader(readPictureHeader(new Uint8Array(bytes)), file.name);
		this.remember(file, result, true);
		return result;
	}

	/** O8: forgets the memory result of the path (the kept result stays; its signature no longer matches a changed file). */
	forget(path: string): void {
		this.memory.delete(path);
	}

	/** Plugin unload: writes the kept results now if a write was waiting. */
	flush(): void {
		if (this.saveTimer === null) return;
		window.clearTimeout(this.saveTimer);
		this.store();
	}
}
