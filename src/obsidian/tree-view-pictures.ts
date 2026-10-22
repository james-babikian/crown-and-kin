/*
 * The pictures of a tree view (0.3.3, WP-1 A1; spec §13.0 item 3, §13.6–§13.8; M9 contract O1–O5, O9–O11): resolving every arms and portrait link of the tree,
 * the live pictures of the scene, the background check of the files, the problems they add to the badge, the pause under a full-screen view, and the data
 * of the saved picture. Fifth layer of the chain listed in `tree-view.ts`.
 */

import type { TFile } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/messages';
import { portraitCropOf } from '../core/portrait-crop';
import { pictureIssue, type PictureProblem } from '../core/pictures';
import { cardForm, geometryFor } from '../layout/geometry';
import { visibleRect } from '../render/dom/pan-zoom';
import type { PictureSlot } from '../render/dom/pictures';
import type { View } from '../render/view-math';
import { createLivePictures, zoomStep } from './live-pictures';
import type { ResolvedPicture } from './picture-store';
import { relationsFor } from '../view/relation-cache';
import { SaveWindow, savePicture, type SaveSource } from './save-picture';
import { ownerKey } from '../view/tree-view-helpers';
import { TreeViewScene } from './tree-view-scene';
import { TreeViewBase } from './tree-view-base';
import type { PictureUse, PictureInfo } from './tree-view-types';

/** Picture handling of a tree view: links, live pictures, the file check and the saved picture. */
export abstract class TreeViewPictures extends TreeViewScene {
	/** The pictures are resolved again (the metadata cache learned a file): the badge, the cards and the list rows follow. */
	protected picturesLookAgain(): void {
		const whole = this.whole;
		if (!whole || !this.pictureInfo) return;
		this.resolvePictures(whole);
		this.updateBadge();
		this.live?.refresh([]);
		this.refillList();
		if (this.picturesOn) this.checkPictures();
	}

	// ---------- pictures (spec §13.0 item 3, §13.6–§13.8; M9 contract O1–O5, O9–O11) ----------

	/** The problems of the badge: the tree text's, then the picture warnings in tree order (O2). */
	protected allIssues(): CodedIssue[] {
		const info = this.pictureInfo;
		if (!info) return this.textIssues;
		const su = this.host.startedUp;
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
	protected resolvePictures(whole: FamilyGraph): void {
		const store = this.host.pictures;
		if (!store) {
			this.pictureInfo = null;
			return;
		}
		const uses: PictureUse[] = [];
		for (const h of whole.houses.values()) if (h.arms) uses.push({ owner: { kind: 'arms', house: { id: h.id, name: h.name } }, link: h.arms });
		for (const p of whole.people) {
			if (p.portrait) uses.push({ owner: { kind: 'portrait', person: { id: p.id, name: p.name } }, link: p.portrait });
			// 0.2.8 (I05, contract A.1): the personal arms of a person have the same warnings as the arms of a house.
			if (p.arms) uses.push({ owner: { kind: 'portrait', person: { id: p.id, name: p.name }, arms: true }, link: p.arms });
		}
		const resolved = new Map<string, ResolvedPicture>();
		for (const u of uses) if (!resolved.has(u.link)) resolved.set(u.link, store.resolve(u.link, this.sourcePath));
		const old = this.pictureInfo;
		// A found warning stays for a file that did not change (a change drops it first, see picturesChanged).
		const found = new Map<number, CodedIssue>();
		if (old) {
			uses.forEach((u, i) => {
				const j = old.uses.findIndex((o) => o.link === u.link && ownerKey(o.owner) === ownerKey(u.owner));
				const f = j >= 0 ? old.found.get(j) : undefined;
				if (f) found.set(i, f);
			});
		}
		this.pictureInfo = { uses, resolved, found };
	}

	/** The file of a picture slot, or the problem of its link (O1). */
	protected pictureFile(slot: PictureSlot): TFile | PictureProblem {
		const info = this.pictureInfo;
		const personal = slot.owner && 'person' in slot.owner ? this.whole?.byId.get(slot.owner.person)?.arms : undefined;
		const link = slot.kind === 'arms' ? (personal ?? (slot.owner && 'house' in slot.owner ? this.whole?.houses.get(slot.owner.house)?.arms : undefined)) : this.whole?.byId.get(slot.person)?.portrait;
		const r = link !== undefined ? info?.resolved.get(link) : undefined;
		if (!r) return { ok: false, code: 'picture-not-image', file: link ?? '' };
		return r.ok ? r.file : r;
	}

	/** O5: the live pictures of the scene just drawn; the old ones go first. */
	protected makeLive(): void {
		this.live?.destroy();
		this.live = null;
		const store = this.host.pictures;
		const slots = this.scene?.pictures ?? [];
		if (!store || !slots.length) return;
		const root = this.viewport?.parentElement ?? null;
		this.live = createLivePictures(slots, store, (s) => this.pictureFile(s), {
			// Spec §13.13: a card shows the part of the portrait that the tree text names.
			cropOf: (s) => {
				const person = s.kind === 'portrait' ? this.whole?.byId.get(s.person) : undefined;
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
	 * check of the files (O2).
	 */
	protected startPictures(): void {
		if (this.picturesOn || !this.host.pictures || !this.pictureInfo) return;
		const token = this.pictureToken;
		const win = this.containerEl.win;
		win.requestAnimationFrame(() =>
			win.requestAnimationFrame(() => {
				const t = win.setTimeout(() => {
					this.timers.delete(t);
					this.guard(() => {
						if (token !== this.pictureToken || this.unloaded || this.picturesOn) return;
						this.picturesOn = true;
						const pz = this.panZoom;
						if (pz?.view && !pz.busy) this.showPictures(pz.view);
						this.checkPictures();
					});
				}, 0);
				this.timers.add(t);
			}),
		);
	}

	/**
	 * O5, B10: the pictures of the cards in or near `view` at the shown level of detail, with copies at
	 * the zoom step of its scale. Before the first view is ready, only the copies the store has now
	 * (B15: a tree drawn again after an edit shows them in its first frame).
	 */
	protected showPictures(view: View): void {
		const live = this.live;
		const pz = this.panZoom;
		const lod = this.lod;
		if (!live || !pz || !lod) return;
		const rect = visibleRect(view, pz.size);
		if (!rect) return;
		if (this.picturesOn) live.update(rect, lod, zoomStep(view.scale));
		else live.prime(rect, lod, zoomStep(view.scale));
	}

	/**
	 * O2: one background check of each picture file (too large, not a picture by its bytes), at the
	 * store's lowest priority. A problem changes only the badge and the frames. When the check ends, the
	 * root gets `data-dynasty-pictures="checked"` (for the harness).
	 */
	protected checkPictures(): void {
		const info = this.pictureInfo;
		const store = this.host.pictures;
		const root = this.viewport?.parentElement ?? null;
		if (!info || !store || !root || !info.uses.length) return;
		const token = this.pictureToken;
		root.removeAttribute('data-dynasty-pictures');
		const files = new Map<string, TFile>();
		for (const r of info.resolved.values()) if (r.ok) files.set(r.file.path, r.file);
		const current = () => token === this.pictureToken && !this.unloaded && this.pictureInfo === info;
		const one = async (file: TFile) => {
			let p: PictureProblem | null = null;
			try {
				p = await store.check(file);
			} catch (e) {
				console.error('Crown and Kin: cannot check the picture', e);
			}
			const problem = p;
			if (problem && current()) this.guard(() => this.fileProblem(info, file, problem));
		};
		void Promise.all([...files.values()].map(one)).then(() => {
			if (current() && root.isConnected) root.setAttribute('data-dynasty-pictures', 'checked');
		});
	}

	/** O2: the file check found a problem: its warning goes on the badge and the cards show no picture. */
	protected fileProblem(info: PictureInfo, file: TFile, p: PictureProblem): void {
		const drawn = this.g;
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
		this.updateBadge();
	}

	/**
	 * O9: picture files changed, came or went (main.ts groups the vault events). A tree that uses one of
	 * them, or has a link to a missing file, resolves its pictures again, updates its badge and fetches
	 * the new copies; nothing is laid out again.
	 */
	protected picturesChanged(paths: readonly string[]): void {
		const info = this.pictureInfo;
		const whole = this.whole;
		if (!info || !whole || this.unloaded || !this.viewport) return;
		const touched = new Set(paths);
		const uses = [...info.resolved.values()].some((r) => (r.ok ? touched.has(r.file.path) : r.code === 'missing-picture'));
		if (!uses) return;
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			if (r?.ok && touched.has(r.file.path)) info.found.delete(i);
		});
		this.resolvePictures(whole);
		this.updateBadge();
		this.live?.refresh(paths);
		this.refillList();
		if (this.picturesOn) this.checkPictures();
	}

	/**
	 * The metadata cache finished indexing (I06: the tree on a computer looks too, not only the phone list). Only a view that has a link to a
	 * missing picture looks again, and only the links that were missing are asked: nothing else costs time when every picture is found.
	 */
	protected linksResolved(): void {
		const info = this.pictureInfo;
		const whole = this.whole;
		const store = this.host.pictures;
		if (!info || !whole || !store || this.unloaded || !this.viewport) return;
		let late = false;
		for (const [link, r] of info.resolved) {
			if (!r.ok && r.code === 'missing-picture' && store.resolve(link, this.sourcePath).ok) {
				late = true;
				break;
			}
		}
		if (!late) return;
		this.picturesLookAgain();
	}

	/** True for a note's tree while a full-screen view of the same block covers it. */
	protected hiddenUnderFull(): boolean {
		return !this.full && this.host.isFullOpenFor(this.key);
	}

	/**
	 * A full-screen view of this block opened over this tree: its picture requests that wait stop, and
	 * it starts no new ones while it is hidden, so the full-screen view gets the store first.
	 */
	pausePictures(): void {
		this.guard(() => this.live?.pause());
	}

	/** The full-screen view over this tree closed: the pictures of the shown area load again. */
	resumePictures(): void {
		this.guard(() => {
			if (this.unloaded || this.hiddenUnderFull()) return;
			this.live?.resume();
		});
	}

	/**
	 * More → Save as picture (spec §13.8, O11): the window "Save as a picture", then the save of what
	 * this view draws now (P1). The view stays in use while the picture is made.
	 */
	protected openSave(): void {
		const src = this.saveSource();
		if (!src) return;
		const app = this.host.app;
		const store = this.host.pictures;
		const host = this.host;
		const st = this.peekState();
		const full = !!this.full;
		new SaveWindow(app, {
			save: (kind) => void savePicture(app, store, src, kind),
			onClosed: () => {
				if (st) TreeViewBase.refocusButton(host, st, full, '.dynasty-more');
			},
		}).open();
	}

	/** P1: the drawn graph and this view's settings, for the saved picture. */
	protected saveSource(): SaveSource | null {
		const g = this.g;
		const laid = this.laid;
		const last = this.lastLayout;
		if (!g || !laid || !last) return null;
		const opts = last.opts;
		const name = this.sourcePath.split('/').pop() ?? this.sourcePath;
		const focus = this.focusId !== null ? this.whole?.byId.get(this.focusId)?.name : undefined;
		// The saved picture shows the card form of the direction it is drawn in, whole cards (D148 2A, D150 5): the geometry is made again, with no flag of the view.
		// The plate follows the mark, the finder's small tree and the setting, as at the draw; with no plate a marked person gets the "You" tab.
		const small = this.finderDrawn?.line && !this.finderDrawn.state.whole;
		const rel = this.meId !== null && !small && this.whole ? relationsFor(this.whole, this.meId, this.relationOptions) : null;
		const relationLine = rel !== null && this.settings.showRelations;
		// Batched whenever there is a mark, so no card is worked out alone when the line is off.
		if (rel) rel.cards.getMany(laid.layout.persons.keys());
		const orientation = laid.layout.orientation ?? 'down';
		const breaks = this.breakList();
		return {
			g,
			...(opts.labels ? { labels: opts.labels } : {}),
			...(rel && relationLine ? { relations: rel.cards } : {}),
			...(opts.me !== undefined ? { me: opts.me } : {}),
			...(opts.line ? { line: opts.line } : {}),
			orientation,
			geo: cardForm(geometryFor(last.geo.fontPx), orientation),
			relationLine,
			...(this.meId !== null && !relationLine ? { youTab: this.meId } : {}),
			...(breaks.size ? { breaks } : {}),
			fonts: opts.fonts,
			showDates: this.settings.showDates,
			showPortraits: this.settings.showPortraits,
			armsOnCards: this.settings.armsOnCards,
			sourcePath: this.sourcePath,
			note: name.replace(/\.md$/i, ''),
			...(focus !== undefined ? { focusName: focus } : {}),
			...(this.foldPlan?.foldedList.length ? { folds: { hidden: this.foldPlan.hiddenList, folded: this.foldPlan.foldedList } } : {}),
			// F.5: while the Show view is open, the saved picture has the tabs, the outlines and the bar sentence.
			...(this.successionDrawn ? { succession: { ordinalCards: [...this.successionDrawn.ordinals.keys()], heirs: this.successionDrawn.heirs, ordinals: this.successionDrawn.ordinals, sentence: this.successionDrawn.sentence } } : {}),
		};
	}
}
