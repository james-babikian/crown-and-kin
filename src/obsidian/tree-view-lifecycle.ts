/*
 * The life of a `TreeView`: the entry points Obsidian and the plugin call (`onload`, `onunload`, `retire`, a setting, the theme, the fonts, the
 * start-up wait), the `guard` that keeps every error out of the note (spec §8), the teardown, and the kept height of the block. Second layer of the chain
 * listed in `tree-view.ts`.
 */

import { setIcon } from 'obsidian';
import { sameBody } from '../core/block-match';
import { fontsChanged, usesFamily, type FontState } from '../render/fonts';
import { clearMeasureCache } from '../render/dom/measure';
import { fontsOf, readFonts } from '../render/dom/page-reads';
import { calloutBackdrop } from '../render/dom/theme-read';
import { buildCallout } from '../render/dom/widgets';
import { FULL_UI, UI } from '../render/ui-text';
import { keepPlaceShift, type Size, type View } from '../render/view-math';
import type { Handle } from './block-handle';
import { lastHeight, rememberHeight } from './block-height';
import type { BlockState } from '../view/block-state';
import { isPhoneDevice } from '../view/focus-mode';
import { releaseRelations } from '../view/relation-cache';
import { reducedMotion, type DynastySettings } from '../view/settings';
import { hasArms, hasPortraits, hasReign } from '../view/tree-view-helpers';
import { TreeViewBase } from './tree-view-base';
import type { KeepPlace } from './tree-view-types';

/** The height of the box that stands in for a tree on a phone, when no height of the block is known, in px. */
const PHONE_PLACEHOLDER_PX = 260;

/** D244: how long the place of the edited card waits for the first view of the re-render, in ms, counted from the end of the render. */
const EDIT_PLACE_MS = 5000;

// Events that must not reach the editor: in Live Preview they would move the cursor into the
// block and show its source (spec §7.2).
const STOPPED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend'];

/** The `--dynasty-callout-bg` value set on each toolbar and hint (so an equal value is not set again). */
const calloutBgSet = new WeakMap<HTMLElement, string | null>();

/** Lifecycle and environment of a tree view: load, unload, settings, theme, fonts and the safe wrapper for every entry point. */
export abstract class TreeViewLifecycle extends TreeViewBase {
	/**
	 * The calendar index changed (a scan ended, a calendar note changed): when this tree's reader key is another one, draw again with the kept anchor.
	 * Dates move no card, so the layout comes from the cache; the phone list keeps its centre person (spec §14 rule 9).
	 */
	datesChanged(): void {
		this.guard(() => {
			const was = this.reading;
			if (this.unloaded || !was || this.datesFor?.(was.link).key === was.key) return;
			if (!this.listMode) this.carry = this.keptAnchor();
			this.keepStart = this.listMode;
			this.render(this.fonts);
		});
	}

	/**
	 * A setting changed (spec §9): the view draws again with it; the tree point at the centre is kept. The
	 * dates only change a class, and the heights only the box (D30).
	 */
	onSettingsChange(prev: DynastySettings): void {
		this.guard(() => {
			if (this.unloaded) return;
			const now = this.settings;
			// D150: the direction decides only on a phone held upright, so a computer, a tablet and a phone on its side do not turn.
			if (prev.phoneDirection !== now.phoneDirection && !this.listMode && this.turnDue()) {
				this.checkTurn();
				return;
			}
			// An open Show view draws again for the length of the line and the age for open branches (the age of the warning needs no redraw).
			if ((prev.successionLength !== now.successionLength || prev.youngDeathAge !== now.youngDeathAge) && (this.successionDrawn !== null || (this.listMode && !!this.peekState()?.succession))) {
				if (!this.listMode) this.carry = this.keptAnchor();
				this.render(this.fonts);
				return;
			}
			// D144: a list follows only the three settings that it shows, and the sibling setting (D174) when a mark gives relation words;
			// a new direction or break list changes nothing in it.
			if (this.listMode) {
				const kinWords = prev.oneParentUnknown !== now.oneParentUnknown && this.meId !== null;
				// The list does not follow "Arms on cards" (D209 item 6: only the top row shows arms), so a change of it draws the list again
				// without need; the badge counts by "Warn about more than 2 parents of a type".
				const arms = prev.armsOnCards !== now.armsOnCards;
				if (prev.showDates !== now.showDates || prev.showRelations !== now.showRelations || prev.showPortraits !== now.showPortraits || kinWords || arms || prev.warnManyParents !== now.warnManyParents) this.render(this.fonts);
				return;
			}
			const root = this.viewport?.parentElement ?? null;
			// The generations matter only while a focus family is drawn. Spec §13.3: "Show dates on cards"
			// also takes the reign off the title text line, which can change a card's height (D61).
			const reigns = prev.showDates !== now.showDates && hasReign(this.lastLayout?.opts.labels);
			// O10: "Show portraits on cards" gives or takes the portrait room: the tree is laid out again.
			const portraits = prev.showPortraits !== now.showPortraits && hasPortraits(this.g);
			// D118: a new list of break places can change which names need more text lines.
			const breaks = prev.breakWords !== now.breakWords;
			// D145: with a mark the plate with the relation word is part of the card, so the setting changes the card height: the tree is laid out again.
			const plate = prev.showRelations !== now.showRelations && this.meId !== null;
			// D174: the sibling setting gives other relation names. The card texts, the plate (D145), the list and the finder's result are made at a render,
			// so the view draws again; the new layout measures the new texts. A view with no mark and no finder shows none.
			const kin = prev.oneParentUnknown !== now.oneParentUnknown && (this.finderDrawn !== null || this.meId !== null);
			// D126 (1): "Reduce movement" is read when a movement starts, so a change needs no redraw.
			// D206: "Arms on cards" gives or takes the arms room of a card, so the tree is laid out again; "Warn about more than 2 parents" changes the badge.
			const armsRoom = prev.armsOnCards !== now.armsOnCards && hasArms(this.g);
			const warns = prev.warnManyParents !== now.warnManyParents;
			if (!reigns && !portraits && !breaks && !plate && !kin && !armsRoom && !warns && (prev.focusGenerations === now.focusGenerations || this.focusId === null)) {
				root?.toggleClass('dynasty-no-dates', !now.showDates);
				this.updateHeight();
				return;
			}
			this.carry = this.keptAnchor();
			this.render(this.fonts);
		});
	}

	/** Obsidian calls this once the block's container is in the DOM: wires listeners and renders it. */
	override onload(): void {
		this.binding.startAt = performance.now();
		this.host.views.add(this);
		for (const type of STOPPED_EVENTS) {
			this.registerDomEvent(this.containerEl, type as keyof HTMLElementEventMap, (e) => e.stopPropagation(), { passive: true });
		}
		// A focus that a Tab key makes arrives between the Tab's keydown and the next focusin (the browser
		// sends focus before focusin), keyup, press or click (see keyFocus).
		if (this.coarse && !this.full) {
			const win = this.containerEl.win;
			this.registerDomEvent(win, 'keydown', (e) => {
				if (e.key === 'Tab') this.tabbing = true;
			}, { capture: true });
			for (const type of ['focusin', 'keyup', 'pointerdown', 'click'] as const) this.registerDomEvent(win, type, () => (this.tabbing = false), { capture: true });
		}
		// A turn of the phone (D24, spec §7.5): any of these can be the first to report it.
		const win = this.containerEl.win;
		const turned = () => this.guard(() => this.checkTurn());
		this.registerDomEvent(win, 'resize', turned);
		this.registerDomEvent(win, 'orientationchange', () => {
			turned();
			// iOS can send orientationchange before the window has its new size.
			if (this.turnTimer) win.clearTimeout(this.turnTimer);
			this.turnTimer = win.setTimeout(() => {
				this.turnTimer = 0;
				if (!this.unloaded) turned();
			}, 300);
		});
		const portrait = win.matchMedia?.('(orientation: portrait)');
		if (portrait?.addEventListener) {
			portrait.addEventListener('change', turned);
			this.register(() => portrait.removeEventListener('change', turned));
		}
		// Esc closes the relation finder's result or the Show view of a line of succession and gives the focus back (spec §13.2). The window hears
		// it first, as for the popovers, so a full-screen view around the tree stays open.
		this.registerDomEvent(
			win,
			'keydown',
			(e) => {
				if (e.key !== 'Escape' || !(this.finderDrawn || this.successionDrawn) || this.popover?.isOpen) return;
				const active = this.containerEl.doc?.activeElement ?? null;
				if (!active || !this.viewport?.contains(active)) return;
				e.stopPropagation();
				e.preventDefault();
				this.guard(() => (this.successionDrawn ? this.closeSuccession() : this.closeFinder()));
			},
			{ capture: true },
		);
		// O9: a picture file changed, came or went: the pictures of this tree follow (no new layout).
		const store = this.host.pictures;
		if (store) this.unsubPictures = store.onChange((paths) => this.guard(() => this.picturesChanged(paths)));
		// The metadata cache indexes a new picture file late: a list with a missing link looks again when it has resolved.
		const mc = this.host.app?.metadataCache;
		if (store && mc && typeof mc.on === 'function') this.registerEvent(mc.on('resolved', () => this.guard(() => this.linksResolved())));
		this.binding.onload();
	}

	/** Obsidian calls this when the block leaves the note: stops timers and tears the scene down. */
	override onunload(): void {
		this.unloaded = true;
		// A view whose tree was seen ends its open: a later call is a new wait. A view that went before its tree was seen (also one
		// that still waited for its start) keeps the open for the gap, because Obsidian often renders the block again at once and the
		// next call continues that wait (spec §7.7); sweepOpens takes it out after the gap, so no idle time is added.
		if (this.seenTree && this.opened && !this.openHeldElsewhere()) this.dropOpen();
		this.binding.clearTimers();
		if (this.turnTimer) this.containerEl.win.clearTimeout(this.turnTimer);
		this.host.views.delete(this);
		// The calendar index may drop the keys that only this view held.
		this.host.dates?.release?.(this);
		// The block's relation lookup (relation-cache.ts) goes with its last view; the embed and its full-screen view share one.
		if (![...this.host.views].some((v) => v.stateKey === this.key)) releaseRelations(this.key);
		this.binding.release();
		this.unsubPictures?.();
		this.unsubPictures = null;
		this.teardown();
	}

	/**
	 * The plugin is turned off while this tree is on the page (Obsidian does not unload a note's render
	 * children then): the tree stays as a read-only picture, its listeners and observers go, and no
	 * card, button or key writes through the old handle registry any more.
	 */
	retire(): void {
		if (this.unloaded) return;
		this.binding.readOnly = true;
		this.binding.placePending = false;
		this.guard(() => this.updateEditUi());
		this.unload();
	}

	/**
	 * The handle changed. A detached handle no longer knows its block: find the block again from
	 * what this view rendered. Otherwise the handle's new body is this block's new text: show it.
	 */
	protected changed(h: Handle, body: string): void {
		if (h !== this.handle) return;
		if (h.detached) {
			if (this.full) void this.binding.fullReattach();
			else void this.binding.reResolve();
			return;
		}
		if (sameBody(body, this.source)) return;
		// The full-screen view closes when its block can no longer be drawn (spec §7.1).
		if (this.full && !this.parse(body).ok) {
			this.full.close(FULL_UI.invalid);
			return;
		}
		this.source = body;
		this.dragHeight = null;
		this.carry = this.keptAnchor();
		if (this.carry) this.carry.byUser = true;
		this.keepPlace = this.placeToKeep(h.state) ?? this.keepPlace;
		this.render(this.fonts);
		// The window counts from the end of the render. A large tree on a phone can take longer than the window to draw, and the first view comes after that.
		if (this.keepPlace) this.keepPlace.until = performance.now() + EDIT_PLACE_MS;
	}

	/**
	 * D244: the card to keep in place over the re-render of a saved sheet. None when no sheet saved just now (a fold, a setting, a change in the
	 * note text), and none in the static touch preview, which shows its first view (D1). The writes that have no highlight (delete, focus, mark) change no place:
	 * a deleted person has no card after, a focus change draws another family.
	 */
	protected placeToKeep(st: BlockState): KeepPlace | null {
		const now = performance.now();
		const sheet = TreeViewBase.sheetPerson.get(st);
		const hl = st.highlight;
		if (!sheet || now > sheet.until || !hl || now > hl.until) return null;
		const view = this.panZoom?.view;
		const laid = this.laid;
		if (!view || !laid || !(this.full || !this.coarse)) return null;
		return { id: sheet.id, before: laid.layout.persons, view, orientation: laid.layout.orientation, until: now + EDIT_PLACE_MS };
	}

	/**
	 * D244: the view that shows the edited card where it showed before the edit, clamped like a dragged view (D222). It replaces the carried view
	 * and applies before `setView` (the one place, `resizedNow`); `reveal` in `showEdited` then brings a card in that is outside the free area.
	 */
	protected keptPlaceView(place: KeepPlace | null, size: Size): View | null {
		const laid = this.laid;
		if (!place || !laid || performance.now() > place.until || laid.layout.orientation !== place.orientation) return null;
		const free = this.full ? { free: { top: this.insetTop, bottom: this.insetBottom } } : {};
		return keepPlaceShift(place.before, laid.layout.persons, place.id, place.view, { bounds: this.bounds, size, ...free });
	}

	/** Called by the plugin on `css-change`: re-measure and re-layout only if a font changed (§5.8). */
	onCssChange(): void {
		this.guard(() => {
			// A list reads no fonts; only the callout colour of its bar follows the theme.
			if (this.listMode) {
				if (this.containerEl.isConnected) this.readTheme();
				return;
			}
			if (!this.fonts || !this.containerEl.isConnected) return;
			const now = this.blockFonts();
			if (fontsChanged(now, this.fonts)) this.rerender(now);
			// D29: the same fonts can measure other widths once a theme's font face is in use.
			else this.recheckTall(true);
			this.readTheme();
		});
	}

	/**
	 * The scene is in the document only after it is built, so the card corner radius is read at the first fill that finds it connected (every ribbon and badge needs it).
	 * The scene reads the card's own computed `rx` (the theme sets it from --radius-m); reading a theme variable here gave 4 px in themes with an 8 px card corner.
	 */
	protected learnRadius(): void {
		if (this.viewport?.isConnected) this.scene?.syncCornerRadius();
	}

	/** A theme change can change the card corner radius; the ribbons and badges are then drawn again. */
	protected recheckRadius(): void {
		if (this.viewport?.isConnected) this.scene?.syncCornerRadius(true);
	}

	/** Called by the plugin `THEME_RECHECK_MS` after `css-change`: a theme can change its colours a frame later (its style sheet still loads). */
	recheckTheme(): void {
		this.guard(() => {
			this.readTheme();
			this.recheckRadius();
		});
	}

	/** The fonts at the block's place in the note. */
	protected blockFonts(): FontState {
		const probe = this.fontProbe;
		return probe?.isConnected && probe.parentElement?.parentElement === this.containerEl ? fontsOf(probe) : readFonts(this.containerEl);
	}

	/**
	 * What one CSS rule cannot follow in every theme. The toolbar in a callout shows the
	 * callout's own background as the theme paints it (spec §10).
	 */
	protected readTheme(): boolean {
		const vp = this.viewport;
		if (!vp?.parentElement || !vp.isConnected) return false;
		// Outside a callout there is nothing to read (no computed style, spec §7.7).
		this.calloutBg = vp.closest('.callout') ? calloutBackdrop<HTMLElement>(vp, (e) => getComputedStyle(e).backgroundColor) : null;
		this.paintCalloutBg();
		return true;
	}

	/**
	 * The callout background goes on the toolbar and the hints themselves, not on the root: a custom
	 * property that changes on the root makes the engine compute the style of every card again.
	 */
	protected paintCalloutBg(): void {
		const vp = this.viewport;
		if (!vp) return;
		for (const el of Array.from(vp.querySelectorAll<HTMLElement>(':scope > .dynasty-toolbar, :scope > .dynasty-hint-slot, :scope > .dynasty-result'))) {
			const now = calloutBgSet.get(el) ?? null;
			if (now === this.calloutBg) continue;
			if (this.calloutBg === null) el.style.removeProperty('--dynasty-callout-bg');
			else el.style.setProperty('--dynasty-callout-bg', this.calloutBg);
			calloutBgSet.set(el, this.calloutBg);
		}
	}

	/**
	 * Reads the theme for a new viewport once its first frame is drawn (spec §7.7): a read before it
	 * would make the engine compute the style of the whole new tree an extra time.
	 */
	protected readThemeSoon(vp: HTMLElement): void {
		if (this.themeRead === vp) return;
		this.themeRead = vp;
		const win = this.containerEl.win;
		win.requestAnimationFrame(() => {
			const t = win.setTimeout(() => {
				this.timers.delete(t);
				this.guard(() => {
					if (this.viewport === vp && !this.readTheme()) this.themeRead = null;
				});
			}, 0);
			this.timers.add(t);
		});
	}

	/**
	 * Called by the plugin when web fonts finish loading. If one of ours loaded, the text was
	 * perhaps measured with a fallback font: truncate it again in place. The layout does not
	 * depend on text widths, so nothing moves and nothing is rebuilt.
	 */
	onFontsLoaded(families: string[]): void {
		this.guard(() => {
			if (!this.fonts || !this.scene || !usesFamily(this.fonts, families)) return;
			// D29: a name measured with a fallback font can need one text line more, or one less.
			if (this.recheckTall()) return;
			this.scene.refit();
		});
	}

	/** Re-lays out with new fonts and keeps the same tree point at the viewport centre (spec §7.5). */
	protected rerender(fonts: FontState): void {
		this.carry = this.keptAnchor();
		clearMeasureCache();
		this.render(fonts);
	}

	protected guard(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error('Crown and Kin: the tree view failed', e);
			// S7: a tree hidden until its first view must not stay hidden after an error.
			this.showTree();
			if (this.full) {
				// On a phone the full-screen view has no other way out: close it (spec §8).
				try {
					this.teardown();
				} catch {
					// Closing still works.
				}
				this.full.close(FULL_UI.failed);
				return;
			}
			try {
				this.teardown();
				this.containerEl.empty();
				buildCallout(this.containerEl, 'error', UI.errorTitle, 'dynasty-error', setIcon).content.createDiv({ text: UI.internalError });
			} catch {
				// Nothing more can be done safely; the rest of the note still renders.
			}
		}
	}

	protected teardown(): void {
		// B11: a new scene or the end of the view releases every picture copy of the old one.
		this.pictureToken++;
		this.picturesOn = false;
		this.live?.destroy();
		this.live = null;
		this.releaseList();
		this.tips?.destroy();
		this.tips = null;
		this.panZoom?.destroy();
		this.panZoom = null;
		this.cancelPulse();
		this.popover?.close();
		this.popover = null;
		this.observer?.disconnect();
		this.observer = null;
		this.heightWatch?.disconnect();
		this.heightWatch = null;
		this.heightRoot = null;
		for (const t of this.timers) this.containerEl.win.clearTimeout(t);
		this.timers.clear();
		this.ringTimers.clear();
		this.hoverPopover = null;
	}

	/**
	 * The box that stands in for the tree. An svg of the height, because the plugin styles may not be there yet and a style attribute is not allowed.
	 * The `display` attribute makes it a block with no style sheet: an inline svg sits on a text baseline and the root grows by the gap under it.
	 */
	protected showPlaceholder(): void {
		const el = this.containerEl;
		el.empty();
		this.binding.waiting = true;
		const phone = this.coarse && this.isPhone();
		const px = lastHeight(this.host.app, this.key) ?? (phone ? PHONE_PLACEHOLDER_PX : this.settings.embedHeightDesktop);
		const box = el.createDiv({ cls: ['dynasty-root', 'dynasty-placeholder'], attr: { 'aria-busy': 'true', 'data-dynasty-placeholder': '' } });
		box.createSvg('svg', { cls: 'dynasty-placeholder-box', attr: { width: '100%', height: String(Math.round(px)), display: 'block', 'aria-hidden': 'true' } });
	}

	/** The plugin tells that a start condition came (the styles, the stored settings, the metadata cache): look at once, and count the pictures again. */
	startUpDone(): void {
		this.guard(() => {
			if (this.unloaded) return;
			if (this.binding.waiting) {
				this.binding.startLook();
				return;
			}
			// A tree that drew before the metadata cache was ready had no count of missing pictures: look again.
			this.picturesLookAgain();
		});
	}

	/**
	 * The height of this block's root is kept for the next cold start (D183). A read of `offsetHeight` in the middle of the first draw lays the whole page out
	 * early (46 ms at 4x CPU on sample tree 07b) and again when the draw goes on. So a resize observer reads it, once the page is laid out, and again when the
	 * root changes (the resize handle comes later than the first draw).
	 */
	protected keepHeight(): void {
		// The full-screen view is as high as the window; its height must not stand in for the note block (D183).
		if (this.full) return;
		const root = this.viewport?.parentElement ?? this.listEl?.parentElement?.parentElement ?? null;
		if (!root?.isConnected) return;
		if (typeof ResizeObserver !== 'function') {
			this.readHeight(root);
			return;
		}
		if (this.heightRoot === root) return;
		this.heightWatch?.disconnect();
		this.heightRoot = root;
		this.heightWatch = new ResizeObserver(() => this.guard(() => this.readHeight(root)));
		this.heightWatch.observe(root);
	}

	protected readHeight(root: HTMLElement): void {
		if (root.isConnected && root.offsetHeight > 0) rememberHeight(this.host.app, this.key, root.offsetHeight);
	}

	/**
	 * A phone, upright or on its side: a tree in a note is a list (D144), and the full-screen view has the D20 focus
	 * family. The screen decides, not the window: an on-screen keyboard makes a tablet's window lower than 600 px, but not its screen.
	 */
	protected isPhone(): boolean {
		return isPhoneDevice(this.coarse, this.containerEl.win);
	}

	/** D242: the full-screen window has just got or lost the phone-sideways look; the bar is at another edge, so the free area is measured again. */
	barMoved(): void {
		this.guard(() => this.resized());
	}

	/**
	 * D126 (1): movement is reduced, by the setting or, with "Follow the device", by the device. Read from the view's own window
	 * (a pop-out window has its own media query) each time the highlight or a window starts, so a change of the device setting counts at once. No view change moves (D235).
	 */
	protected reduced(): boolean {
		const prefers = this.containerEl.win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
		return reducedMotion(this.settings.reduceMotion, prefers);
	}
}
