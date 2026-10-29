/*
 * The live pictures of one drawn tree (spec §13.0 item 3 "Live pictures", §13.6, §13.7). `buildScene` makes an empty slot for every arms and portrait place of
 * the drawn cards; this module decides which slots get an `<image>` now: only the slots of the shown
 * level of detail in or near the view, at most 150 (`livePictureSlots`). It asks the plugin's picture
 * store for a small copy of each, shows it with `setPicture`, and releases the copies of slots that
 * leave the view. The tree view calls `update` after its first view is ready for use, then when a
 * pan or zoom settles, never during a gesture. While a full-screen view of the same block covers the
 * tree, `pause` stops its requests until `resume`. One instance lives as long as one scene: a new scene
 * (a render, a new layout) destroys it and makes a new one.
 */

import type { TFile } from 'obsidian';
import type { PictureProblem } from '../core/pictures';
import { formatPortraitCrop, type CropFraction } from '../core/portrait-crop';
import type { Rect } from '../layout/model';
import { setArmsGap, setPicture, setSlotProblem, type PictureSlot, type SlotProblem } from '../render/dom/pictures';
import { MAX_LIVE_PICTURES, livePictureSlots, type Lod } from '../render/view-math';
import { isProblem, type CopyBox, type PictureCopy, type PictureStore } from './picture-store';

/** The live pictures of one scene. */
export interface LivePictures {
	/**
	 * Shows the pictures of the slots in or near `view` (layout px) at level `lod`, with copies made
	 * for zoom step `step` (1, 2 or 4); releases the others.
	 */
	update(view: Rect, lod: Lod, step?: number): void;
	/**
	 * B15: before the first `update`, shows the copies that the store has now (no decode, no new
	 * copy), so a tree drawn again after an edit has its pictures in its first frame.
	 */
	prime(view: Rect, lod: Lod, step?: number): void;
	/** O2: the picture of a person's arms or portrait cannot show (the file check found a problem). */
	problem(person: string, kind: PictureSlot['kind']): void;
	/** B15: these picture files changed: resolve every slot again and fetch new copies (the old copy stays until then). */
	refresh(paths: readonly string[]): void;
	/**
	 * A full-screen view of the same block covers this tree: the requests that wait stop, and no new
	 * request starts. The pictures on the cards stay. `update` and `refresh` only take note of the view.
	 */
	pause(): void;
	/** The full-screen view closed: the pictures of the last view load again. */
	resume(): void;
	/** Releases every copy and removes every picture element (a new scene, the plugin unloads). */
	destroy(): void;
	/** The number of `<image>` elements now (at most 150). */
	readonly images: number;
	/** Slots that wait for a copy now. */
	readonly pending: number;
}

/** What a slot shows or waits for. */
interface SlotState {
	/** The URL on the slot's `<image>`, or null. */
	url: string | null;
	/** The copy this slot holds (null for a copy that `prime` showed without holding it). */
	held: PictureCopy | null;
	/** The copy key the slot shows. */
	key: string | null;
	/** The request running for this slot. */
	req: { ctl: AbortController; key: string } | null;
	problem: SlotProblem;
}

/** Options of `createLivePictures`. */
export interface LiveOptions {
	/** Spec §13.13: the selected part of a portrait slot's person (`portraitCropOf`); null or absent = the automatic part. */
	cropOf?: (s: PictureSlot) => CropFraction | null;
	/** Hears the number of slots that wait for a copy, after each change (the harness reads it). */
	onPending?: (n: number) => void;
}

/** B10: the zoom step of a settled scale: the smallest of 1, 2 and 4 that is at least the scale (at most 4). */
export function zoomStep(scale: number): number {
	if (!(scale > 1)) return 1;
	return scale <= 2 ? 2 : 4;
}

const slotProblemOf = (p: PictureProblem): SlotProblem => (p.code === 'missing-picture' ? 'missing' : 'other');

/**
 * Makes the live pictures of one scene. `fileOf` gives a slot's file, or the problem of its link
 * (web address, missing file, extension); the view keeps one answer per link.
 */
export function createLivePictures(
	slots: readonly PictureSlot[],
	store: PictureStore,
	fileOf: (s: PictureSlot) => TFile | PictureProblem,
	opts: LiveOptions = {},
): LivePictures {
	const states: SlotState[] = slots.map(() => ({ url: null, held: null, key: null, req: null, problem: null }));
	/** Problems found after resolution (the file check, a failed decode), by path. */
	const bad = new Map<string, PictureProblem>();
	/** B15: a changed file gets a new number, so its slots ask for a new copy. */
	const versions = new Map<string, number>();
	let destroyed = false;
	let paused = false;
	let shown = 0;
	let waiting = 0;
	let last: { view: Rect; lod: Lod; step: number } | null = null;
	// O3: one arms copy per house for the Full and the Compact cards, at the larger (Compact) box.
	const compact = slots.find((s) => s.kind === 'arms' && s.lod === 'compact')?.rect;

	const boxOf = (s: PictureSlot, step: number): CopyBox => {
		const r = s.kind === 'arms' && compact ? compact : s.rect;
		const box: CopyBox = { w: r.w * step, h: r.h * step, fit: s.kind === 'portrait' ? 'portrait' : 'meet', onDevice: true };
		if (s.kind === 'portrait') {
			let crop: CropFraction | null = null;
			try {
				crop = opts.cropOf?.(s) ?? null;
			} catch (e) {
				console.error('Crown and Kin: cannot read the selected part of a portrait', e);
			}
			if (crop) box.crop = crop;
		}
		return box;
	};
	const keyOf = (file: TFile, box: CopyBox) => `${file.path}\u0000${versions.get(file.path) ?? 0}\u0000${box.w}x${box.h}\u0000${box.fit}${box.crop ? `\u0000${formatPortraitCrop(box.crop)}` : ''}`;

	const tellPending = () => {
		try {
			opts.onPending?.(waiting);
		} catch (e) {
			console.error('Crown and Kin: cannot report the pictures that wait', e);
		}
	};

	/** Shows `url` in slot `i`, or removes its picture; keeps the count of `<image>` elements. */
	const show = (i: number, url: string | null) => {
		const st = states[i];
		if (st.url === url) return;
		if (url === null) shown--;
		else if (st.url === null) shown++;
		st.url = url;
		setPicture(slots[i], url);
	};

	/** D219: shows the copy and, for arms, the gap that follows the outline that the store read from the picture (no gap while it is not known). */
	const showCopy = (i: number, url: string, file: TFile) => {
		show(i, url);
		if (slots[i].kind === 'arms') setArmsGap(slots[i], store.outlineOf?.(file) ?? null);
	};

	const stopRequest = (st: SlotState) => {
		if (!st.req) return;
		st.req.ctl.abort();
		st.req = null;
		waiting--;
	};

	/** Slot `i` leaves the live set, or cannot show: no request, no copy, no picture. */
	const clear = (i: number) => {
		const st = states[i];
		stopRequest(st);
		show(i, null);
		st.held?.release();
		st.held = null;
		st.key = null;
	};

	const setProblem = (i: number, p: SlotProblem) => {
		const st = states[i];
		if (st.problem === p) return;
		st.problem = p;
		if (p !== null) clear(i);
		setSlotProblem(slots[i], p);
	};

	/** The file of slot `i`, or null when it cannot show (its problem is set). */
	const target = (i: number): TFile | null => {
		let f: TFile | PictureProblem;
		try {
			f = fileOf(slots[i]);
		} catch (e) {
			console.error('Crown and Kin: cannot find the picture of a card', e);
			setProblem(i, 'other');
			return null;
		}
		if (isProblem(f)) {
			setProblem(i, slotProblemOf(f));
			return null;
		}
		const known = bad.get(f.path);
		if (known) {
			setProblem(i, slotProblemOf(known));
			return null;
		}
		setProblem(i, null);
		return f;
	};

	/** Starts the request of slot `i` for `file` at `box`, unless it shows or waits for that copy already. */
	const request = (i: number, file: TFile, box: CopyBox) => {
		const st = states[i];
		const key = keyOf(file, box);
		if (st.key === key && st.held) return;
		if (st.req?.key === key) return;
		stopRequest(st);
		const ctl = new AbortController();
		st.req = { ctl, key };
		waiting++;
		const done = () => {
			if (st.req?.ctl !== ctl) return false;
			st.req = null;
			waiting--;
			return true;
		};
		let p: Promise<PictureCopy | PictureProblem | null>;
		try {
			p = store.acquire(file, box, ctl.signal);
		} catch (e) {
			console.error('Crown and Kin: cannot ask for a picture', e);
			done();
			return;
		}
		p.then(
			(r) => {
				// A copy that arrives for a slot that no longer wants it goes back at once.
				if (destroyed || ctl.signal.aborted || !done()) {
					if (r && !isProblem(r)) r.release();
					return;
				}
				if (r === null) return;
				if (isProblem(r)) {
					// Every slot of the same file shows the problem (a house's arms on all its cards).
					bad.set(file.path, r);
					for (let j = 0; j < slots.length; j++) target(j);
					return;
				}
				// B10, B15: the new copy shows first; then the old one goes.
				const old = st.held;
				st.held = r;
				st.key = key;
				showCopy(i, r.url, file);
				old?.release();
			},
			(e: unknown) => {
				done();
				console.error('Crown and Kin: a picture did not load', e);
			},
		).finally(() => {
			if (!destroyed) tellPending();
		});
	};

	const run = (view: Rect, lod: Lod, step: number, peekOnly: boolean) => {
		if (paused && !peekOnly) return;
		const live = new Set(livePictureSlots(slots, view, lod, MAX_LIVE_PICTURES));
		for (let i = 0; i < slots.length; i++) {
			const st = states[i];
			if (!live.has(i) && (st.url !== null || st.req || st.held)) clear(i);
		}
		for (const i of live) {
			const file = target(i);
			if (!file) continue;
			const box = boxOf(slots[i], step);
			if (peekOnly) {
				const hit = store.peek(file, box);
				if (hit) {
					states[i].key = keyOf(file, box);
					showCopy(i, hit.url, file);
				}
				continue;
			}
			request(i, file, box);
		}
		tellPending();
	};

	const guarded = (what: string, fn: () => void) => {
		if (destroyed) return;
		try {
			fn();
		} catch (e) {
			console.error(`Crown and Kin: cannot ${what}`, e);
		}
	};

	// The frames of slots whose link already has a problem (a missing file: dashed) show from the start.
	for (let i = 0; i < slots.length; i++) {
		try {
			const f = fileOf(slots[i]);
			if (isProblem(f)) setProblem(i, slotProblemOf(f));
		} catch {
			// The first update tries again.
		}
	}

	return {
		update(view, lod, step = 1) {
			guarded('show the pictures', () => {
				last = { view, lod, step };
				run(view, lod, step, false);
			});
		},
		prime(view, lod, step = 1) {
			guarded('show the kept pictures', () => run(view, lod, step, true));
		},
		problem(person, kind) {
			guarded('show a picture problem', () => {
				for (let i = 0; i < slots.length; i++) if (slots[i].person === person && slots[i].kind === kind) setProblem(i, 'other');
			});
		},
		refresh(paths) {
			guarded('show the changed pictures', () => {
				for (const p of paths) {
					versions.set(p, (versions.get(p) ?? 0) + 1);
					bad.delete(p);
				}
				for (let i = 0; i < slots.length; i++) target(i);
				if (last) run(last.view, last.lod, last.step, false);
			});
		},
		pause() {
			guarded('stop the pictures', () => {
				if (paused) return;
				paused = true;
				for (const st of states) stopRequest(st);
				tellPending();
			});
		},
		resume() {
			guarded('show the pictures', () => {
				if (!paused) return;
				paused = false;
				if (last) run(last.view, last.lod, last.step, false);
			});
		},
		destroy() {
			if (destroyed) return;
			for (let i = 0; i < slots.length; i++) {
				try {
					clear(i);
				} catch {
					// The next slot still goes.
				}
			}
			destroyed = true;
			waiting = 0;
			tellPending();
		},
		get images() {
			return shown;
		},
		get pending() {
			return waiting;
		},
	};
}
