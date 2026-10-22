/*
 * What a tree view does for the user (0.3.3, WP-1 A1): opens the edit window of a person, of a new person, the Titles and Houses windows, expands to the
 * full-screen view, shows and centres people, and applies the folds (spec §13.10) and the focus. Seventh layer of the chain listed in `tree-view.ts`.
 */

import { Notice } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import { focusGenerationsFor, focusSubgraph } from '../core/focus-subgraph';
import { unfoldFor, type FoldControl } from '../core/folds';
import type { Tree } from '../core/types';
import { FOCUS_UI, UI, WRITE_TEXT } from '../render/ui-text';
import { keepSpot } from '../render/view-math';
import type { Handle } from './block-handle';
import { EditSheet } from './edit-sheet';
import { planFolds, withFolds } from '../view/fold-view';
import { HousesWindow } from './houses-window';
import { pickPerson } from './person-picker';
import { DEFAULT_SETTINGS } from '../view/settings';
import { TitlesWindow } from './titles-window';
import { TreeViewToolbar } from './tree-view-toolbar';
import { TreeViewBase } from './tree-view-base';
import type { FullSource, FoldAnchor } from './tree-view-types';

/** The actions that open windows or change what the view shows: people, folds and focus. */
export abstract class TreeViewActions extends TreeViewToolbar {
	/**
	 * Sets the session focus of this block (Focus, Focus here, a `+` badge; null: Clear focus)
	 * and draws every view of the block again with it (spec §5.6). Nothing is written.
	 */
	focusOn(id: string | null, target: string[] | null = null): void {
		const st = this.ensureState();
		if (id !== null && (this.full || !this.coarse)) TreeViewBase.unfoldForFocus(this.host, st, id);
		TreeViewBase.focusState(this.host, st, id, target, this);
	}

	/** The block's focus changed: draw again. An embed under an open full-screen view of the block waits until it closes. */
	syncFocus(own = false): void {
		this.guard(() => {
			if (this.unloaded) return;
			if (!own && !this.full && this.host.isFullOpenFor(this.key)) {
				this.focusStale = true;
				return;
			}
			this.carry = null;
			this.render(this.fonts);
		});
	}

	protected async openSheet(id: string, fromTap: boolean): Promise<void> {
		// A read-only embed never opens the edit sheet, also when a window calls this directly (G.7).
		if (this.inForeignView()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly) return;
		const sheet = EditSheet.create(this.host.app, {
			handle: h,
			personId: id,
			dates: this.datesFor,
			sourcePath: this.sourcePath,
			// The sheet of a new person that Add child, Add parent or Add partner opens has this hook too, so the anchor stays the person of this sheet (D244).
			beforeWrite: () => {
				this.keepView();
				TreeViewBase.sheetPerson.set(h.state, { id, until: performance.now() + 3000 });
			},
			fromTap,
			place: this.full ? 'full' : 'embed',
			openNote: (open) => this.openNote(open),
			focus: {
				here: (person) => {
					if (this.full || !this.coarse) TreeViewBase.unfoldForFocus(this.host, h.state, person);
					TreeViewBase.focusState(this.host, h.state, person);
				},
				changed: () => TreeViewBase.redrawState(this.host, h.state, { keepOwn: true }),
				pinning: () => TreeViewBase.dropOwnFocus(this.host, h.state),
			},
			finder: { show: (first, second) => TreeViewBase.showFinder(this.host, h.state, first, second, this) },
			folds: this.sheetFolds(h),
			pictures: this.host.pictures,
			relationOptions: this.relationOptions,
		});
		if (!sheet) {
			new Notice(WRITE_TEXT.personNotFound);
			return;
		}
		sheet.open();
	}

	/** Toolbar "Add person" and "Add first person": a sheet for a new person, added at the end (spec §6.10, §5.9). */
	protected async openNewPerson(): Promise<void> {
		if (this.readOnly || this.inForeignView()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly) return;
		const sheet = EditSheet.createNew(this.host.app, {
			handle: h,
			sourcePath: this.sourcePath,
			beforeWrite: () => this.keepView(),
			dates: this.datesFor,
			newPerson: { kind: 'person' },
			place: this.full ? 'full' : 'embed',
			openNote: (open) => this.openNote(open),
			pictures: this.host.pictures,
			relationOptions: this.relationOptions,
		});
		if (!sheet) {
			new Notice(WRITE_TEXT.invalid);
			return;
		}
		sheet.open();
	}

	/**
	 * More → Titles (spec §13.4, D49, D52): the Titles window of this block, on the computer and in the
	 * full-screen view (never in the static phone preview, spec §13.0 item 7).
	 */
	protected async openTitles(): Promise<void> {
		if (!this.canEditWindows()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly || this.unloaded) return;
		const st = h.state;
		const full = !!this.full;
		const host = this.host;
		const fromButton = !!this.viewport?.querySelector('.dynasty-titles-button');
		const win = TitlesWindow.create(this.host.app, {
			handle: h,
			dates: this.datesFor,
			sourcePath: this.sourcePath,
			reduced: () => this.reduced(),
			beforeWrite: () => this.keepView(),
			// The computer has a Titles button of its own; on the phone the window comes from More.
			onClosed: () => TreeViewBase.refocusButton(host, st, full, fromButton ? '.dynasty-titles-button' : '.dynasty-more'),
			show: (id) => TreeViewBase.showFound(host, st, full, id),
			openPerson: (id) => TreeViewBase.openPersonOf(host, st, full, id, this.unloaded ? null : this),
			pictures: host.pictures,
			me: () => this.meId,
			relationOptions: () => this.relationOptions,
			// Contract 0.2.7 E.4, K.10, M.7: Show opens the view of the line; the settings come from the host, because this view can be drawn again after a Save.
			showLine: (title) => TreeViewBase.showSuccession(host, st, title, this.unloaded ? null : this),
			succession: {
				limit: () => (host.settings ?? DEFAULT_SETTINGS).successionLength,
				oldAge: () => (host.settings ?? DEFAULT_SETTINGS).oldAge,
				youngDeathAge: () => (host.settings ?? DEFAULT_SETTINGS).youngDeathAge,
			},
		});
		win?.open();
	}

	/** Find's result (spec §6.10): a drawn person is centred and highlighted; else the view shows all people with them. */
	protected showFound(id: string): void {
		if (!this.whole?.byId.has(id)) return;
		this.showPeople([id]);
	}

	/**
	 * F11: shows people of the whole tree. If the drawn graph has them all, a fold that hides one opens (only the
	 * folds that hide it) and the view centres on them; if it does not, the view shows all people, as Find does.
	 */
	protected showPeople(ids: string[]): void {
		const g = this.g;
		if (g && ids.length && ids.every((id) => g.byId.has(id))) {
			if (!this.openFor(ids)) this.showPerson(ids[0], ids.slice(1));
		} else this.showOutside(ids);
	}

	/** Toolbar "Houses" (spec §6.10, D32, D36): the Houses window of this block. */
	protected async openHouses(): Promise<void> {
		if (this.readOnly || this.blocked || this.inForeignView()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly || this.unloaded) return;
		const st = h.state;
		const full = !!this.full;
		const win = HousesWindow.create(this.host.app, {
			handle: h,
			dates: this.datesFor,
			beforeWrite: () => this.keepView(),
			onClosed: () => TreeViewBase.refocusButton(this.host, st, full, '.dynasty-houses-button'),
			sourcePath: this.sourcePath,
			pictures: this.host.pictures,
			showGeneration: () => this.settings.showHouseGeneration,
			reduced: () => this.reduced(),
			people: {
				// This view if it is still drawn; after a Save the note draws the tree again, and the view of the same state shows the card.
				show: (id) => (this.unloaded ? TreeViewBase.showFound(this.host, st, full, id) : this.guard(() => this.showFound(id))),
				openNote: (open) => this.openNote(open),
			},
		});
		win?.open();
	}

	/** The view survives the re-render after a write (spec §5.5). */
	protected keepView(): void {
		const v = this.panZoom?.view;
		if (v && !this.unloaded) this.storeView(v);
	}

	protected tagActivated(spouses: readonly string[], tagEl: SVGGElement, hit: SVGRectElement): void {
		if (spouses.length === 1) {
			this.jumpTo(spouses[0]);
			return;
		}
		const g = this.g;
		if (!g || !this.popover) return;
		this.popover.open(
			'spouses',
			(el) => {
				el.createDiv({ cls: 'dynasty-popover-title', text: UI.spouseListTitle });
				for (const id of spouses) {
					const b = el.createEl('button', { cls: 'dynasty-popover-item', text: g.byId.get(id)?.name ?? id });
					b.addEventListener('click', () => {
						this.popover?.close();
						this.guard(() => this.jumpTo(id));
					});
				}
				el.querySelector<HTMLElement>('button')?.focus();
			},
			tagEl,
			hit.getBoundingClientRect(),
		);
	}

	/**
	 * A far-couple tag was chosen. A static touch embed cannot move (D1): it opens the full-screen
	 * view centred on the partner and highlighted instead (spec §0 D17).
	 */
	protected jumpTo(id: string): void {
		if (!this.full && this.coarse) {
			void this.openFull(id);
			return;
		}
		this.showPeople([id]);
	}

	/** Expand (spec §6.10, §7.1): the same block, handle and view state in a full-screen modal. */
	protected async openFull(target: string | null, focus: string | null = null, focusDue: string | null = null): Promise<void> {
		if (this.unloaded || this.full || this.opening) return;
		const foreign = this.inForeignView();
		// A second press while the handle is checked must not open a second modal.
		this.opening = true;
		let h: Handle | null;
		try {
			h = this.readOnly || foreign ? null : await this.validHandle();
		} finally {
			this.opening = false;
		}
		if (this.unloaded) return;
		const from: FullSource = {
			key: this.key,
			sourcePath: this.sourcePath,
			source: this.source,
			handle: h,
			peeked: this.handle ?? this.binding.peeked,
			readOnly: this.readOnly || foreign || !h,
			focusDue,
		};
		this.host.openFull(from, target, this.containerEl, focus);
	}

	/**
	 * "Choose a person" on a bar that does not draw (D227 item 3): the same picker as Focus, then the session focus shows the family of the chosen person.
	 * If that family itself passes the top, the render shows the bar again.
	 */
	protected async chooseFromBar(whole: FamilyGraph, button: HTMLElement | null): Promise<void> {
		// A retired view is only a picture: its button opens nothing.
		if (this.unloaded) return;
		const picked = await pickPerson(this.host.app, whole, new Set(), FOCUS_UI.pickerPlaceholder, FOCUS_UI.pickerTitle, false, null, null, this.pickerContext());
		if (picked?.kind !== 'person' || this.unloaded) {
			// No choice: the keyboard focus goes back to the button (spec §5.2).
			if (button?.isConnected) button.focus({ preventScroll: true });
			return;
		}
		this.guard(() => this.focusOn(picked.id));
	}

	// ---------- folds (spec §13.10, D83–D85) ----------

	/** A tap or key on a fold button or sign: the family folds or opens, and the control stays at the same screen place (F10). */
	protected toggleFold(c: FoldControl): void {
		const st = this.ensureState();
		const next = new Set(st.folds);
		if (c.folded) next.delete(c.key);
		else next.add(c.key);
		TreeViewBase.changeFolds(this.host, st, next, { anchor: { kind: 'spot', key: c.key }, origin: this });
	}

	/**
	 * F10, F17: draws the tree again with the block's folds, in place: the graph, the fonts and the toolbar stay, only
	 * the layout and the scene are made again. The acting view keeps its anchor at the same screen place (`keepSpot`
	 * for a control; the card for a sheet action, or the first parent when the control is gone); others keep the card
	 * nearest their centre. With `targets`, the view then centres on them and highlights them.
	 */
	protected foldsChanged(anchor: FoldAnchor | null, targets: string[]): void {
		if (this.unloaded) return;
		// An embed under an open full-screen view of the block draws again when that closes (as for a focus change).
		if (!this.full && this.host.isFullOpenFor(this.key)) {
			this.focusStale = true;
			return;
		}
		const { g, whole, lastLayout: last, panZoom: pz, laid } = this;
		if (!laid) return;
		// A view that has no size (the other mode of the note, hidden) draws when it shows: its resize sees `foldsStale`.
		if (!(this.viewport && this.viewport.clientWidth > 0)) {
			this.foldsStale = true;
			return;
		}
		if (!g || !whole || !last || !pz?.view || this.finderAlt) {
			this.carry = this.keptAnchor();
			this.pendingTarget = targets.length ? targets : null;
			this.render(this.fonts);
			return;
		}
		const view = pz.view;
		const control = anchor?.kind === 'spot' ? laid.layout.folds?.find((c) => c.key === anchor.key) : undefined;
		const keep = control?.spot ?? null;
		const near = anchor?.kind === 'person' ? this.anchorOn(anchor.id) : control ? this.anchorOn(control.parents[0]) : null;
		const fallback = near ?? this.keptAnchor();
		const active = this.containerEl.doc?.activeElement as Element | null | undefined;
		const focused = this.foldByKey ? (active?.closest?.('.dynasty-fold')?.getAttribute('data-fold') ?? null) : null;
		this.foldByKey = false;
		const plan = planFolds(g, whole, this.ensureState().folds, true, this.linePeopleNow());
		this.foldPlan = plan;
		const next = this.layOut(g, last.geo, withFolds(last.settings, plan, true), last.opts.fonts, last.opts.labels, plan.hidden);
		last.settings = next.settings;
		this.redraw(g, next.laid);
		// `redraw` asks for a first view; a fold keeps the view.
		this.firstDue = false;
		const to = anchor?.kind === 'spot' ? next.laid.layout.folds?.find((c) => c.key === anchor.key)?.spot : undefined;
		const kept = keep && to ? keepSpot(view, keep, to) : fallback ? this.fromAnchor(fallback) : null;
		pz.setView(kept ?? view, { byUser: true });
		if (targets.length) this.showPerson(targets[0], targets.slice(1));
		if (focused) this.scene?.folds.find((f) => f.control.key === focused)?.el.focus({ preventScroll: true });
	}

	/**
	 * F11: opens the folds that hide `ids` in the drawn graph (and no other) and draws again with the view centred on
	 * them. False when no fold hides them, so the caller centres as before.
	 */
	protected openFor(ids: string[]): boolean {
		const { g, whole, foldPlan: plan } = this;
		if (!g || !whole || !plan) return false;
		const hidden = ids.filter((id) => plan.hidden.has(id));
		if (!hidden.length) return false;
		const st = this.ensureState();
		TreeViewBase.changeFolds(this.host, st, unfoldFor(g, whole, st.folds, hidden), { origin: this, targets: ids });
		return true;
	}

	/** The graph that Focus on `focus` will draw, made from `tree` as `render` makes it. */
	protected focusGraph(tree: Tree, focus: string): FamilyGraph | null {
		const n = focusGenerationsFor(tree.options, this.settings.focusGenerations);
		const sub = focusSubgraph(tree, focus, n);
		return sub ? deriveFamilies(sub.tree, { dates: this.whole?.dates.reader }) : null;
	}

	/**
	 * Find or the problem list chose people that the view does not draw (spec §6.10). Find is not a
	 * focus choice, so a result of the finder stays (spec §13.2): its small tree switches to the whole
	 * tree, or, with no line, the view shows all people with the bar. Without a result the view shows
	 * all people, as before.
	 */
	protected showOutside(ids: string[]): void {
		const st = this.ensureState();
		const f = st.finder;
		if (!f || !this.finderDrawn) {
			this.focusOn(null, ids);
			return;
		}
		if (this.finderDrawn.line) {
			f.whole = true;
			TreeViewBase.finderRedraw(this.host, st, this, ids);
			return;
		}
		st.focus = { id: null };
		st.shown = null;
		TreeViewBase.redrawState(this.host, st, { target: ids, origin: this });
	}
}
