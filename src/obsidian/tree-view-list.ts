/*
 * The views that are not a tree (0.3.3, WP-1 A1): the phone list (D144), its bar and its picture copies, the box of an empty block (spec §5.9) and the low bar of
 * a very large tree (spec §7.7). Ninth layer of the chain listed in `tree-view.ts`.
 */

import { Notice, setIcon, type TFile } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { pruneFolds } from '../core/folds';
import type { DateReader } from '../core/dates';
import { portraitCropOf } from '../core/portrait-crop';
import { cardLabels, needsLabels } from '../core/titles';
import type { ParseResult, Tree } from '../core/types';
import type { Orientation } from '../layout/model';
import { buildPhoneList, failListPicture, restoreListPictures, showListPicture, type ListPictureSlots } from '../render/dom/phone-list-dom';
import { Popover } from '../render/dom/widgets';
import type { RenderTiming } from '../render/tree-info';
import { ADD_UI, FOCUS_UI, FULL_UI, PHONE_LIST_UI, SUCCESSION_UI } from '../render/ui-text';
import { forgetHeight } from './block-height';
import type { BlockState } from '../view/block-state';
import { setFolds } from '../view/fold-view';
import { buildLargeBar, showBusy, type LargeBarParts } from './large-bar';
import type { LargeBar } from '../view/large-tree';
import { linkWord, listData, listIds, listStart, listWord, popTrail, type ListStartFacts } from '../view/phone-list';
import { pickPerson } from './person-picker';
import type { CopyBox } from './picture-store';
import { relationsFor, validMe } from '../view/relation-cache';
import { lineWords } from '../view/succession-view';
import { TreeViewFinder } from './tree-view-finder';
import { toolbarIn } from './tree-view-toolbar';
import { TreeViewBase } from './tree-view-base';
import { HIGHLIGHT_MS } from './tree-view-types';

/** D144: after a move the keyboard focus (and so a screen reader) goes to the heading of the centre section of the list. */
const LIST_FOCUS = '.dynasty-list-section[data-section="person"] .dynasty-list-head';

/**
 * D144, D209: the small picture copies of a list row, in CSS px (about twice the size on the screen, for a sharp copy): the arms of the large row are
 * 35 px high under a portrait and 56 px high alone; the portrait is 36 px in a row and 56 px in the large row.
 */
const LIST_ARMS_BOX: CopyBox = { w: 96, h: 120, fit: 'meet' };

const LIST_PORTRAIT_BOX: CopyBox = { w: 96, h: 96, fit: 'portrait' };

const HERO_PORTRAIT_BOX: CopyBox = { w: 128, h: 128, fit: 'portrait' };

/** The person a save just changed in a phone list and the time the row flash ends; kept per block, so a second build keeps the flash. */
const savedFlashes = new WeakMap<BlockState, { id: string; until: number }>();

/** The phone list, the empty block and the bar that stands in place of a very large tree. */
export abstract class TreeViewList extends TreeViewFinder {
	/** B1: the count of closed person windows (`st.listKeep`) that this list has read. */
	private keepSeen = 0;

	/** B1: the session choice that the start stood under; a tap on a name, Find or Back changes it, and then the list moves, also right after a window. */
	private startSession: string | null = null;

	/** The start of the phone list (spec §5.5): the rules of `listStart`, or the person the list stood on when only the calendars changed. */
	protected startOf(facts: ListStartFacts): ReturnType<typeof listStart> {
		// B1: behind an open person window, an in-place write keeps the list where it is. A window that has closed keeps it for the next draw, once: that draw can come after the window.
		const keep = facts.keep ?? 0;
		const afterWindow = keep > this.keepSeen;
		this.keepSeen = keep;
		const heldNow = (facts.hold || afterWindow) && (facts.session ?? null) === this.startSession;
		const kept = this.keepStart || heldNow ? this.listStartWas : null;
		this.keepStart = false;
		this.startSession = facts.session ?? null;
		this.listStartWas = kept && facts.g.byId.has(kept.id) ? kept : listStart(facts);
		return this.listStartWas;
	}

	/** The reader of this parse, and its key for `datesChanged`. */
	protected readerOf(parsed: ParseResult): DateReader | undefined {
		const link = parsed.ok ? parsed.tree.options.calendar : undefined;
		const reader = this.datesFor?.(link);
		this.reading = reader ? { link, key: reader.key } : null;
		return reader;
	}

	/**
	 * D144, contract C.3.1: a tree in a note on a phone is a list of the family of one person. The start chain picks
	 * the person (`listStart`); a tap on a name, Find and Back move it through the block state, so the full-screen
	 * view that Expand opens stands on the same person. Nothing is laid out or drawn as a tree, and nothing is written.
	 */
	protected renderList(el: HTMLElement, tree: Tree, whole: FamilyGraph, t0: number, t1: number): void {
		const st = this.ensureState();
		this.listMode = true;
		this.laid = this.scene = this.svg = this.lastLayout = this.canvasEl = this.panZoom = null;
		this.drawnKey = this.familyKey = null;
		this.pendingTarget = null;
		const kept = pruneFolds(whole, st.folds);
		if (kept !== st.folds) setFolds(st, kept);
		const me = validMe(whole, tree.options.me);
		this.meId = me;
		// A session choice that names nobody (the person was deleted) ends; a trail with no session position means nothing.
		if (st.focus?.id != null && !whole.byId.has(st.focus.id)) st.focus = null;
		if (!st.focus || st.focus.id === null) st.listBack = undefined;
		const start = this.startOf({ session: st.focus?.id, pin: tree.options.focus, me, edited: st.lastSaved, hold: st.listHold, keep: st.listKeep, g: whole });
		const centre = start?.id ?? whole.people[0].id;
		this.g = this.whole = whole;
		this.focusId = centre;
		this.focusStale = false;
		this.textIssues = whole.issues;
		this.resolvePictures(whole);
		// §5.5: a person just saved shows once. The list never moves for it: the row flashes, or a Notice says where to look.
		const saved = st.shown?.place === 'embed' ? st.shown.id : null;
		if (saved !== null) {
			st.shown = null;
			savedFlashes.set(st, { id: saved, until: performance.now() + HIGHLIGHT_MS });
		}

		const root = el.createDiv({
			cls: ['dynasty-root', 'dynasty-list-root'],
			attr: { 'data-dynasty-section': this.binding.sectionNote, 'data-dynasty-orientation': 'list', 'data-dynasty-focus': centre, 'data-dynasty-list-from': start?.from ?? 'first', 'data-dynasty-cards-pending': '0', 'data-dynasty-lines-pending': '0' },
		});
		this.placeClasses(root);
		const blocking = whole.issues.filter((i) => i.level === 'blocking');
		this.blocked = blocking.length > 0;
		this.buildBanner(root, blocking);
		const viewport = root.createDiv({ cls: ['dynasty-viewport', 'dynasty-list-viewport'] });
		this.viewport = viewport;
		this.barsPx = '';
		// The warning badge opens its problem list in this popover.
		this.popover = new Popover(viewport);
		this.buildListBar(viewport, st);
		const t2 = performance.now();

		const labels = needsLabels(whole) ? cardLabels(whole) : undefined;
		const rel = me !== null && this.settings.showRelations ? relationsFor(whole, me, this.relationOptions) : null;
		// 0.2.7 F.6: while the Show view is open, the list has the bar at its top, and each heir (each open branch) says its place in the place of the relation word.
		const succession = this.showViewFor(st, whole);
		this.successionDrawn = succession;
		const words = succession ? lineWords(succession) : null;
		const ctl = new AbortController();
		this.listAbort = ctl;
		const token = this.pictureToken;
		this.listCentre = centre;
		const data = listData(whole, centre);
		// WP-K: the words of the rows that show, in one request.
		rel?.cards.getMany(listIds(data));
		const result = buildPhoneList(viewport, {
			g: whole,
			data,
			me,
			showDates: this.settings.showDates,
			showPortraits: this.settings.showPortraits,
			editable: !this.readOnly && !this.blocked && !this.inForeignView(),
			word: (id) => words?.get(id) ?? listWord(id, { me, showRelations: this.settings.showRelations, cards: rel?.cards }),
			link: (row) => linkWord(whole, data, row),
			...(succession ? { bar: { sentence: succession.sentence, closeLabel: SUCCESSION_UI.barCloseLabel, onClose: () => this.guard(() => this.closeSuccession()) } } : {}),
			...(labels ? { labels } : {}),
			pictures: (slots, id) => this.listPictures(whole, slots, id, ctl.signal, token),
			icon: setIcon,
			onGo: (id) => this.guard(() => this.listMove(id)),
			onEdit: (id, fromTap) => this.guard(() => this.activate(id, fromTap)),
		});
		this.listEl = result.list;
		root.setAttribute('data-dynasty-people', String(result.rows));
		if (succession) root.setAttribute('data-dynasty-succession', succession.titleId);
		// A second build soon after the save (a note change event) must keep the flash, so the flash lives in the block state, not in this build.
		const flash = savedFlashes.get(st);
		const left = flash ? flash.until - performance.now() : 0;
		if (flash && left > 0 && whole.byId.has(flash.id)) {
			const row = result.list.querySelector<HTMLElement>(`.dynasty-list-row[data-person="${flash.id}"]`);
			if (row) this.flashRow(row, left);
			else if (saved !== null) new Notice(PHONE_LIST_UI.savedElsewhere);
		} else if (flash) {
			savedFlashes.delete(st);
		}
		this.watchLate(viewport, () => {
			this.updateEditUi();
			this.readThemeSoon(viewport);
			this.keepHeight();
		});
		this.updateEditUi();
		const moved = this.focusDue !== null;
		this.takeFocus();
		// After a move the list may start above the part of the note that shows: bring its top into view.
		if (moved && viewport.getBoundingClientRect().top < 0) viewport.scrollIntoView({ block: 'start' });
		const t3 = performance.now();
		const open = this.account(t0, t1, t2, t3);
		const timing: RenderTiming = { path: this.sourcePath, people: whole.people.length, ...open.parts };
		this.timing = { t0: open.start, t: timing };
		this.host.recordTiming(timing);
		this.markInteractive();
		this.keepHeight();
		// F-VIEW-01: the list checks its picture files too, so a file that is too large or not a picture shows on the badge.
		this.startPictures();
	}

	/** The bar above the list (D144, 0.2.8 G.13): the same flat row as the computer's toolbar: Add person and the tree text (made by `updateEditUi`) at the left, then Find, Back after a move, the problem badge and Expand. */
	protected buildListBar(viewport: HTMLElement, st: BlockState): void {
		// D182: the phone bar shows icons only; the full text is in the aria-label.
		const { bar, button } = toolbarIn(viewport);
		bar.createSpan({ cls: 'dynasty-grow', attr: { 'aria-hidden': 'true' } });
		button('search', PHONE_LIST_UI.findLabel, 'dynasty-list-find').addEventListener('click', () => this.guard(() => void this.listFind()));
		const back = st.listBack?.length ? popTrail(st.listBack, (id) => !!this.whole?.byId.has(id)) : null;
		if (back) {
			const name = this.whole?.byId.get(back.id)?.name ?? back.id;
			button('arrow-left', PHONE_LIST_UI.backLabel(name), 'dynasty-list-back').addEventListener('click', () => this.guard(() => this.listBackTap()));
		}
		this.updateBadge(bar);
		button('maximize', PHONE_LIST_UI.expandLabel, 'dynasty-expand').addEventListener('click', () => this.guard(() => void this.openFull(null)));
		this.orderBar(bar);
	}

	/** A tap on a name of the list: the list moves to that person and the old person goes on the Back trail. */
	protected listMove(id: string): void {
		if (id === this.focusId) return;
		this.focusDue = LIST_FOCUS;
		TreeViewBase.listGo(this.host, this.ensureState(), id, 'push', this.focusId, this);
	}

	/** Back: the list returns to the newest person of the trail who is still in the tree. */
	protected listBackTap(): void {
		const st = this.ensureState();
		const back = popTrail(st.listBack, (id) => !!this.whole?.byId.has(id));
		if (!back) return;
		this.focusDue = LIST_FOCUS;
		TreeViewBase.listGo(this.host, st, back.id, 'pop', this.focusId, this);
	}

	/** Find: the picker of the whole tree; a choice moves the list, no choice gives the keyboard focus back to Find. */
	protected async listFind(): Promise<void> {
		const g = this.whole;
		if (!g || this.unloaded) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FULL_UI.findPlaceholder, FULL_UI.findTitle, false, null, null, this.pickerContext());
		if (this.unloaded) return;
		if (picked?.kind !== 'person') {
			this.guard(() => this.refocusTool('.dynasty-list-find'));
			return;
		}
		this.guard(() => this.listMove(picked.id));
	}

	/** A still outline on the row of a person that a save changed, for two seconds (no animation, so Reduce movement has nothing to change). */
	protected flashRow(row: HTMLElement, ms: number = HIGHLIGHT_MS): void {
		row.addClass('dynasty-list-flash');
		const win = this.containerEl.win;
		const t = win.setTimeout(() => {
			this.timers.delete(t);
			row.removeClass('dynasty-list-flash');
		}, ms);
		this.timers.add(t);
	}

	/**
	 * The small picture copies of one row (0.2.8): the portrait when "Show portraits on cards" is on, and for the large row the arms (D209 rule A: the personal
	 * arms first, else the arms of the house; the list does not follow "Arms on cards"). The row made a place for each picture it has. The portrait of the large row is 56 px, the others 36 px.
	 */
	protected listPictures(whole: FamilyGraph, slots: ListPictureSlots, id: string, signal: AbortSignal, token: number): void {
		const store = this.host.pictures;
		const info = this.pictureInfo;
		const p = whole.byId.get(id);
		if (!p) return;
		if (!store || !info) {
			// No store: nothing will ever fill the places.
			for (const slot of [slots.arms, slots.portrait]) failListPicture(slot);
			return;
		}
		const su = this.host.startedUp;
		// D213: a file that the metadata cache may not know yet keeps its place; any other file that cannot show leaves no empty place.
		const fileOf = (link: string | undefined): TFile | null | 'wait' => {
			const r = link !== undefined ? info.resolved.get(link) : undefined;
			if (r?.ok) return r.file;
			return r && r.code === 'missing-picture' && su && !su.cache() ? 'wait' : null;
		};
		const load = (file: TFile | null | 'wait', box: CopyBox, slot: HTMLElement) => {
			if (file === 'wait') return;
			if (!file) {
				failListPicture(slot);
				return;
			}
			const live = () => !signal.aborted && token === this.pictureToken && !this.unloaded && slot.isConnected;
			void store.acquire(file, box, signal).then(
				(c) => {
					if (!c || !('url' in c)) {
						if (live()) this.guard(() => failListPicture(slot));
						return;
					}
					if (!live()) {
						c.release();
						return;
					}
					this.listCopies.push(c);
					this.guard(() => showListPicture(slot, c.url));
				},
				(e: unknown) => {
					console.error('Crown and Kin: cannot show a picture in the list', e);
					if (live()) this.guard(() => failListPicture(slot));
				},
			);
		};
		const hero = this.listCentre === id;
		if (hero && slots.arms) load(fileOf(p.arms ?? (p.house !== undefined ? whole.houses.get(p.house)?.arms : undefined)), LIST_ARMS_BOX, slots.arms);
		if (this.settings.showPortraits && slots.portrait) {
			const crop = portraitCropOf(p);
			load(fileOf(p.portrait), { ...(hero ? HERO_PORTRAIT_BOX : LIST_PORTRAIT_BOX), ...(crop ? { crop } : {}) }, slots.portrait);
		}
	}

	/** The picture copies of the rows go back to the store (the list is drawn again, or the view ends). */
	protected releaseList(): void {
		this.listAbort?.abort();
		this.listAbort = null;
		for (const c of this.listCopies.splice(0)) c.release();
		this.listEl = null;
	}

	/**
	 * The first view is set: the next frame draws the cards, and the input is already wired. The frame
	 * after that starts only when that one has been painted, so its start is the time to interactive
	 * (spec §7.7). The owner reads it with the "Show render timing" command.
	 */
	protected markInteractive(): void {
		const m = this.timing;
		if (!m) return;
		this.timing = null;
		const win = this.containerEl.win;
		const open = this.opened;
		win.requestAnimationFrame(() => {
			// The first frame: a tree in the page at this time was seen, also when Obsidian takes it out before the second frame.
			const seen = !this.unloaded && this.containerEl.isConnected;
			if (seen) this.seenTree = true;
			win.requestAnimationFrame(() => {
				if (this.unloaded) return;
				if (!seen && !this.containerEl.isConnected) {
					// A tree that Obsidian replaced before the user saw it is not the wait: the open goes on with the next render, unless no view holds it.
					if (open && this.opened === open && !this.openHeldElsewhere()) this.dropOpen();
					return;
				}
				m.t.interactiveMs = performance.now() - m.t0;
				if (open && this.opened === open) this.dropOpen();
			});
		});
	}

	/** A block with no people: one "Add first person" button (spec §5.9). */
	protected renderEmpty(el: HTMLElement, g: FamilyGraph): void {
		this.g = g;
		this.laid = null;
		this.scene = null;
		this.svg = null;
		this.blocked = false;
		const root = el.createDiv({ cls: 'dynasty-root dynasty-empty-root', attr: { 'data-dynasty-cards-pending': '0', 'data-dynasty-people': '0', 'data-dynasty-section': this.binding.sectionNote, 'data-dynasty-orientation': this.orientation } });
		this.placeClasses(root);
		const box = root.createDiv({ cls: 'dynasty-empty' });
		this.emptyEl = box;
		box.createDiv({ cls: 'dynasty-empty-text', text: ADD_UI.empty });
		const add = box.createEl('button', { cls: ['mod-cta', 'dynasty-add-first'], text: ADD_UI.addFirst, attr: { type: 'button' } });
		add.addEventListener('click', () => this.guard(() => void this.openNewPerson()));
		// On a phone, Close is the only way out of the full-screen view, also after the last person is deleted.
		if (this.full) {
			const { bar } = toolbarIn(root, false);
			bar.createSpan({ cls: 'dynasty-grow', attr: { 'aria-hidden': 'true' } });
			this.closeButton(bar);
		}
		this.updateEditUi();
		this.watchLate(box, () => this.updateEditUi());
	}

	/**
	 * 0.3 (spec §7.7, D159, D223, D226): the low bar stands in place of the tree. Nothing is laid out, nothing is drawn as a tree and nothing is written. The view
	 * is left as `renderEmpty` leaves it: no layout, no scene, no view. The note has no toolbar. The full-screen view has a bar with Focus, Find and Close
	 * so the way out is never a dead end; for that its pickers keep the whole graph and the mark.
	 */
	protected renderBar(el: HTMLElement, tree: Tree, whole: FamilyGraph, bar: LargeBar, count: number, orientation: Orientation): void {
		// Spec §7.7 (render timing): the bar is not a tree that a user sees, so the open ends here; a tap on the button starts a new one.
		this.dropOpen();
		this.large = bar;
		// The note keeps no empty box of the old tree's height, and a restart must not make the note jump from the height of a tree that is not drawn.
		// The full-screen view shares the key of the note's block: only the note's own bar forgets the note's height (as keepHeight skips the full view).
		if (!this.full) forgetHeight(this.host.app, this.key);
		this.laid = this.scene = this.svg = this.lastLayout = this.canvasEl = this.panZoom = null;
		this.g = null;
		this.drawnKey = this.familyKey = null;
		this.focusId = null;
		this.finderDrawn = this.successionDrawn = this.finderAlt = null;
		this.blocked = false;
		this.whole = this.full ? whole : null;
		this.meId = this.full ? validMe(whole, tree.options.me) : null;
		const phoneFull = !!this.full && this.isPhone();
		const root = el.createDiv({
			cls: ['dynasty-root', 'dynasty-large-root'],
			attr: { 'data-dynasty-large': bar.kind, 'data-dynasty-count': String(count), 'data-dynasty-cards-pending': '0', 'data-dynasty-lines-pending': '0', 'data-dynasty-section': this.binding.sectionNote, 'data-dynasty-orientation': orientation },
		});
		this.placeClasses(root);
		let parts: LargeBarParts;
		const actions = { onDraw: () => this.guard(() => this.drawLarge(parts)), onChoose: () => this.guard(() => void this.chooseFromBar(whole, parts.choose)) };
		if (this.full) {
			// The viewport holds the bar and the toolbar, so the popovers and the phone's bottom bar work as in a tree.
			const viewport = root.createDiv({ cls: ['dynasty-viewport', 'dynasty-large-viewport'] });
			this.viewport = viewport;
			this.popover = new Popover(viewport);
			parts = buildLargeBar(viewport, bar, count, phoneFull, actions);
			this.buildBarToolbar(viewport);
		} else {
			parts = buildLargeBar(root, bar, count, phoneFull, actions);
		}
		this.watchLate(this.viewport ?? parts.bar);
		// A key press on the Focus button asked for the keyboard focus on the new button; a request left over must not pull the focus later.
		this.takeFocus();
	}

	/** The bar of the full-screen view with a large tree: Find and Focus choose a person, and Close leaves. Nothing that works on the whole tree. */
	protected buildBarToolbar(viewport: HTMLElement): void {
		const { bar, button } = toolbarIn(viewport);
		button('search', FULL_UI.find, 'dynasty-find').addEventListener('click', () => this.guard(() => void this.find()));
		const focus = button('crosshair', FOCUS_UI.focus, 'dynasty-focus');
		focus.setAttribute('aria-haspopup', 'true');
		focus.setAttribute('aria-expanded', 'false');
		focus.addEventListener('click', (e) => this.guard(() => this.toggleFocusList(focus, !e.detail)));
		if (this.barKind() !== 'phone') bar.createSpan({ cls: 'dynasty-grow', attr: { 'aria-hidden': 'true' } });
		this.closeButton(bar);
		this.orderBar(bar);
	}

	/**
	 * The tap on "Draw the tree" (spec §7.7): the block remembers the tap for the session, the button gives way to a short text, one frame is painted, and then
	 * the same render draws the tree (the bar is gone unless the tree is above its top). Keyboard focus moves to the tree box, because the button is gone.
	 */
	protected drawLarge(parts: LargeBarParts): void {
		// A retired view is only a picture: its button does nothing, and the page must not say that it draws.
		if (this.unloaded) return;
		const st = this.ensureState();
		st.largeTapped = true;
		showBusy(parts);
		const from = performance.now();
		const win = this.containerEl.win;
		// Two frames: the first paints the text, the second starts the work, so the user sees that it began.
		win.requestAnimationFrame(() =>
			win.requestAnimationFrame(() =>
				this.guard(() => {
					// A render in the meantime (a setting, a note change) has already drawn with the memory of the tap.
					if (this.unloaded || !parts.bar.isConnected) return;
					this.dropOpen();
					this.openNow(from);
					// The budget starts here, just before the work: a page that was hidden between the tap and its frames must not use up the time of a tree never tried.
					this.budgetFrom = performance.now();
					this.render(this.fonts);
					const box = this.containerEl.querySelector<HTMLElement>('.dynasty-viewport, .dynasty-large-bar');
					if (box) {
						box.setAttribute('tabindex', '-1');
						box.focus({ preventScroll: true });
					}
				}),
			),
		);
	}

	/**
	 * The rows of the list get their picture copies again, in place: no new draw, so the scroll place and the
	 * focus stay. The old copies go back to the store once.
	 */
	protected refillList(): void {
		const list = this.listEl;
		const whole = this.whole;
		if (!list || !whole || !list.isConnected) return;
		this.listAbort?.abort();
		for (const c of this.listCopies.splice(0)) c.release();
		const ctl = new AbortController();
		this.listAbort = ctl;
		const token = this.pictureToken;
		for (const row of Array.from(list.querySelectorAll<HTMLElement>('.dynasty-list-row[data-person]'))) {
			restoreListPictures(row);
			const arms = row.querySelector<HTMLElement>('.dynasty-hero-arms') ?? undefined;
			const portrait = row.querySelector<HTMLElement>('.dynasty-list-portrait, .dynasty-hero-portrait') ?? undefined;
			if (!arms && !portrait) continue;
			for (const slot of [arms, portrait]) {
				if (!slot) continue;
				slot.removeClass('has-picture');
				for (const img of Array.from(slot.querySelectorAll('img'))) img.remove();
			}
			this.listPictures(whole, { ...(arms ? { arms } : {}), ...(portrait ? { portrait } : {}) }, row.getAttribute('data-person') ?? '', ctl.signal, token);
		}
	}
}
