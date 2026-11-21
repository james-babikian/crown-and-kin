/*
 * The pictures of one tree view as an object of its own (spec §13.0 item 3, §13.6–§13.8; architecture review step 11): resolving every arms
 * and portrait link of the tree, the live pictures of the scene, the background check of the files, the problems they add to the badge and the
 * pause under a full-screen view. The state is private to this object; it sees the view only through `PicturesPort`, which `TreeViewBase`
 * builds. This file imports no layer of the view chain, so no layer can reach the state except through the methods here.
 */

import type { TFile } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/messages';
import { portraitCropOf } from '../core/portrait-crop';
import { pictureIssue, type PictureProblem } from '../core/pictures';
import { visibleRect, type PanZoom } from '../render/dom/pan-zoom';
import type { PictureSlot } from '../render/dom/pictures';
import type { Scene } from '../render/dom/scene';
import type { Lod, View } from '../render/view-math';
import { ownerKey } from '../view/tree-view-helpers';
import { createLivePictures, zoomStep, type LivePictures } from './live-pictures';
import type { PictureStore, ResolvedPicture } from './picture-store';
import type { FullHost, PictureInfo, PictureUse } from './tree-view-types';

/** What the pictures need of their view: its place and drawing, read when asked, and the three calls back into it. */
export interface PicturesPort {
	readonly host: {
		readonly pictures?: PictureStore;
		readonly startedUp?: { cache(): boolean };
		isFullOpenFor(key: string): boolean;
	};
	readonly containerEl: HTMLElement;
	readonly key: string;
	readonly sourcePath: string;
	readonly unloaded: boolean;
	readonly full: FullHost | null;
	readonly whole: FamilyGraph | null;
	readonly g: FamilyGraph | null;
	readonly scene: Scene | null;
	readonly viewport: HTMLElement | null;
	readonly panZoom: PanZoom | null;
	readonly lod: Lod | null;
	/** The view's own set of timers, not a copy: the view clears it when it ends. */
	readonly timers: Set<number>;
	guard(fn: () => void): void;
	updateBadge(): void;
	refillList(): void;
}

/** True if some picture link was or is not found, or now leads to another file: only then can the list show something new. */
function linksChanged(before: ReadonlyMap<string, ResolvedPicture>, after: ReadonlyMap<string, ResolvedPicture> | undefined): boolean {
	if (!after) return true;
	for (const [link, r] of after) {
		const old = before.get(link);
		if (!r.ok || !old || !old.ok || old.file.path !== r.file.path) return true;
	}
	return false;
}

/** The picture state and work of one tree view. */
export class ViewPictures {
	/** The pictures of the whole tree, resolved at render; null with no picture store. */
	info: PictureInfo | null = null;
	/** The live pictures of the drawn scene. */
	live: LivePictures | null = null;
	/** The first view was ready for use: the live pictures may load (spec §13.0 item 3 "Pictures never delay the first view"). */
	started = false;
	/** Raised by every render: a background check or a start of the pictures from before it does nothing. */
	token = 0;
	/** The problems of the whole tree's text (spec §8); the picture warnings come on top (`allIssues`). */
	textIssues: CodedIssue[] = [];

	constructor(private readonly port: PicturesPort) {}

	/** The pictures are resolved again (the metadata cache learned a file): the badge, the cards and the list rows follow. */
	lookAgain(): void {
		const whole = this.port.whole;
		if (!whole || !this.info) return;
		const before = this.info.resolved;
		this.resolve(whole);
		this.port.updateBadge();
		this.live?.refresh([]);
		// The list rows only change when a link was or is missing (or points to another file). Asking again would take every picture out of its place for nothing.
		if (linksChanged(before, this.info?.resolved)) this.port.refillList();
		if (this.started) this.check();
	}

	/** The problems of the badge: the tree text's, then the picture warnings in tree order. */
	allIssues(): CodedIssue[] {
		const info = this.info;
		if (!info) return this.textIssues;
		const su = this.port.host.startedUp;
		const pics: CodedIssue[] = [];
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			// D183: until the metadata cache has finished, a picture that it does not know yet is no warning.
			if (r && !r.ok) {
				if (r.code !== 'missing-picture' || !su || su.cache()) pics.push(pictureIssue(u.owner, r));
			} else {
				const found = info.found.get(i);
				if (found) pics.push(found);
			}
		});
		return pics.length ? [...this.textIssues, ...pics] : this.textIssues;
	}

	/**
	 * O1, O2: resolves every arms and portrait link of the whole tree once (web address, missing file,
	 * extension): also the portraits when "Show portraits on cards" is off. No file is read here.
	 */
	resolve(whole: FamilyGraph): void {
		const store = this.port.host.pictures;
		if (!store) {
			this.info = null;
			return;
		}
		const uses: PictureUse[] = [];
		for (const h of whole.houses.values()) if (h.arms) uses.push({ owner: { kind: 'arms', house: { id: h.id, name: h.name } }, link: h.arms });
		for (const p of whole.people) {
			if (p.portrait) uses.push({ owner: { kind: 'portrait', person: { id: p.id, name: p.name } }, link: p.portrait });
			// The personal arms of a person have the same warnings as the arms of a house.
			if (p.arms) uses.push({ owner: { kind: 'portrait', person: { id: p.id, name: p.name }, arms: true }, link: p.arms });
		}
		const resolved = new Map<string, ResolvedPicture>();
		for (const u of uses) if (!resolved.has(u.link)) resolved.set(u.link, store.resolve(u.link, this.port.sourcePath));
		const old = this.info;
		// A found warning stays for a file that did not change (a change drops it first, see `changed`).
		const found = new Map<number, CodedIssue>();
		if (old) {
			uses.forEach((u, i) => {
				const j = old.uses.findIndex((o) => o.link === u.link && ownerKey(o.owner) === ownerKey(u.owner));
				const f = j >= 0 ? old.found.get(j) : undefined;
				if (f) found.set(i, f);
			});
		}
		this.info = { uses, resolved, found };
	}

	/** The file of a picture slot, or the problem of its link. */
	file(slot: PictureSlot): TFile | PictureProblem {
		const whole = this.port.whole;
		const personal = slot.owner && 'person' in slot.owner ? whole?.byId.get(slot.owner.person)?.arms : undefined;
		const link = slot.kind === 'arms' ? (personal ?? (slot.owner && 'house' in slot.owner ? whole?.houses.get(slot.owner.house)?.arms : undefined)) : whole?.byId.get(slot.person)?.portrait;
		const r = link !== undefined ? this.info?.resolved.get(link) : undefined;
		if (!r) return { ok: false, code: 'picture-not-image', file: link ?? '' };
		return r.ok ? r.file : r;
	}

	/** Lets the live pictures of the old scene go, and keeps the start state and the token: for a redraw in place (D29). */
	dropLive(): void {
		this.live?.destroy();
		this.live = null;
	}

	/** The end of a scene or of the view: every picture copy goes, and a start or a check from before does nothing any more. */
	release(): void {
		this.token++;
		this.started = false;
		this.dropLive();
	}

	/** O5: the live pictures of the scene just drawn; the old ones go first. */
	makeLive(): void {
		this.dropLive();
		const port = this.port;
		const store = port.host.pictures;
		const slots = port.scene?.pictures ?? [];
		if (!store || !slots.length) return;
		const root = port.viewport?.parentElement ?? null;
		this.live = createLivePictures(slots, store, (s) => this.file(s), {
			// Spec §13.13: a card shows the part of the portrait that the tree text names.
			cropOf: (s) => {
				const person = s.kind === 'portrait' ? port.whole?.byId.get(s.person) : undefined;
				return person ? portraitCropOf(person) : null;
			},
			// B15: the harness reads how many pictures still wait.
			onPending: (n) => {
				const v = String(n);
				if (root?.isConnected && root.getAttribute('data-dynasty-pictures-pending') !== v) root.setAttribute('data-dynasty-pictures-pending', v);
			},
		});
		// Drawn again under an open full-screen view of the block (an edit there): it waits until the view closes.
		if (this.hiddenUnderFull()) this.live.pause();
	}

	/**
	 * Spec §13.0 item 3 "Pictures never delay the first view": the pictures start after the frame that
	 * made the first view ready for use (`markInteractive` measures that frame), then one background
	 * check of the files.
	 */
	start(): void {
		const port = this.port;
		if (this.started || !port.host.pictures || !this.info) return;
		const token = this.token;
		const win = port.containerEl.win;
		win.requestAnimationFrame(() =>
			win.requestAnimationFrame(() => {
				const t = win.setTimeout(() => {
					port.timers.delete(t);
					port.guard(() => {
						if (token !== this.token || port.unloaded || this.started) return;
						this.started = true;
						const pz = port.panZoom;
						if (pz?.view && !pz.busy) this.show(pz.view);
						this.check();
					});
				}, 0);
				port.timers.add(t);
			}),
		);
	}

	/**
	 * O5, B10: the pictures of the cards in or near `view` at the shown level of detail, with copies at
	 * the zoom step of its scale. Before the first view is ready, only the copies the store has now
	 * (B15: a tree drawn again after an edit shows them in its first frame).
	 */
	show(view: View): void {
		const live = this.live;
		const pz = this.port.panZoom;
		const lod = this.port.lod;
		if (!live || !pz || !lod) return;
		const rect = visibleRect(view, pz.size);
		if (!rect) return;
		if (this.started) live.update(rect, lod, zoomStep(view.scale));
		else live.prime(rect, lod, zoomStep(view.scale));
	}

	/**
	 * O2: one background check of each picture file (too large, not a picture by its bytes), at the
	 * store's lowest priority. A problem changes only the badge and the frames. When the check ends, the
	 * root gets `data-dynasty-pictures="checked"` (for the harness).
	 */
	check(): void {
		const port = this.port;
		const info = this.info;
		const store = port.host.pictures;
		const root = port.viewport?.parentElement ?? null;
		if (!info || !store || !root || !info.uses.length) return;
		const token = this.token;
		root.removeAttribute('data-dynasty-pictures');
		const files = new Map<string, TFile>();
		for (const r of info.resolved.values()) if (r.ok) files.set(r.file.path, r.file);
		const current = () => token === this.token && !port.unloaded && this.info === info;
		const one = async (file: TFile) => {
			let p: PictureProblem | null = null;
			try {
				p = await store.check(file);
			} catch (e) {
				console.error('Crown and Kin: cannot check the picture', e);
			}
			const problem = p;
			if (problem && current()) port.guard(() => this.fileProblem(info, file, problem));
		};
		void Promise.all([...files.values()].map(one)).then(() => {
			if (current() && root.isConnected) root.setAttribute('data-dynasty-pictures', 'checked');
		});
	}

	/** O2: the file check found a problem: its warning goes on the badge and the cards show no picture. */
	private fileProblem(info: PictureInfo, file: TFile, p: PictureProblem): void {
		const drawn = this.port.g;
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			if (!r?.ok || r.file.path !== file.path) return;
			info.found.set(i, pictureIssue(u.owner, p));
			if (u.owner.kind === 'portrait') this.live?.problem(u.owner.person.id, u.owner.arms ? 'arms' : 'portrait');
			else if (drawn) {
				const house = u.owner.house.id;
				// A person with personal arms shows those, so a problem of the house arms is not theirs.
				for (const person of drawn.people) if (person.house === house && !person.arms) this.live?.problem(person.id, 'arms');
			}
		});
		this.port.updateBadge();
	}

	/**
	 * O9: picture files changed, came or went (main.ts groups the vault events). A tree that uses one of
	 * them, or has a link to a missing file, resolves its pictures again, updates its badge and fetches
	 * the new copies; nothing is laid out again.
	 */
	changed(paths: readonly string[]): void {
		const info = this.info;
		const whole = this.port.whole;
		if (!info || !whole || this.port.unloaded || !this.port.viewport) return;
		const touched = new Set(paths);
		const uses = [...info.resolved.values()].some((r) => (r.ok ? touched.has(r.file.path) : r.code === 'missing-picture'));
		if (!uses) return;
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			if (r?.ok && touched.has(r.file.path)) info.found.delete(i);
		});
		this.resolve(whole);
		this.port.updateBadge();
		this.live?.refresh(paths);
		this.port.refillList();
		if (this.started) this.check();
	}

	/**
	 * The metadata cache finished indexing (I06: the tree on a computer looks too, not only the phone list). Only a view that has a link to a
	 * missing picture looks again, and only the links that were missing are asked: nothing else costs time when every picture is found.
	 */
	linksResolved(): void {
		const info = this.info;
		const port = this.port;
		const store = port.host.pictures;
		if (!info || !port.whole || !store || port.unloaded || !port.viewport) return;
		let late = false;
		for (const [link, r] of info.resolved) {
			if (!r.ok && r.code === 'missing-picture' && store.resolve(link, port.sourcePath).ok) {
				late = true;
				break;
			}
		}
		if (!late) return;
		this.lookAgain();
	}

	/** True for a note's tree while a full-screen view of the same block covers it. */
	private hiddenUnderFull(): boolean {
		return !this.port.full && this.port.host.isFullOpenFor(this.port.key);
	}

	/**
	 * A full-screen view of this block opened over this tree: its picture requests that wait stop, and
	 * it starts no new ones while it is hidden, so the full-screen view gets the store first.
	 */
	pause(): void {
		this.live?.pause();
	}

	/** The full-screen view over this tree closed: the pictures of the shown area load again. */
	resume(): void {
		if (this.port.unloaded || this.hiddenUnderFull()) return;
		this.live?.resume();
	}
}
