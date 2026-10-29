/*
 * The picture viewer (spec §0 D256, owner wish N03): a window that shows a portrait or a coat of arms whole and large, and never changes a note. It opens
 * from the picture menu of the person window and the arms menu of the house page, and at once from a picture in a window that cannot change the note.
 *
 * The window shows the name, one text line, the whole picture, and (for a person with a portrait and arms) two small pictures that change the picture. The
 * picture shows at once, with no opening motion (D262). The surface is the theme's window colour.
 * - Computer: a large window, 48 px from the edges, that keeps its size. Esc, the Close button and a click outside close it; the focus goes back to the
 *   picture that opened it. The arrow keys change the picture; Tab stays inside.
 * - iPhone: full screen with a grip. A swipe down closes it in one slide (D220, D262, `sheet-swipe.ts`); a pinch or a double tap zooms from 1x to 4x, one finger moves the picture
 *   while it is zoomed, a sideways swipe changes the picture, and the swipe down and the small pictures are off while it is zoomed (`picture-touch.ts`).
 * - The large copy comes from the picture store like the copy of the crop tool: at most 2048 px, never larger than a raster picture itself, released when the
 *   window closes. The small pictures are small copies that the window holds the same way.
 */

import { Modal, type App } from 'obsidian';
import { REST, fitSize, stepIndex, type Size, type View } from '../render/dom/picture-gestures';
import { attachPictureTouch, type PictureTouch } from '../render/dom/picture-touch';
import { attachSheetSwipe } from '../render/dom/sheet-swipe';
import { VIEWER_UI } from '../render/viewer-text';
import { reducedMotion, type ReduceMotion } from '../view/settings';
import { trackModal } from '../view/plugin-modals';
import { largeCopySide } from './crop-tool';
import { ignoreGhostClick, phoneLayout, startWithoutFocus } from './modal-layout';
import type { PictureCopy, PictureStore, ResolvedPicture } from './picture-store';

/** One picture of the viewer and the texts that go with it. */
export interface ViewerPicture {
	kind: 'portrait' | 'arms';
	/** The link as it stands in the note. */
	link: string;
	/** The name above the picture. */
	heading: string;
	/** The one text line under the name. */
	line: string;
	/** The name of the window for a screen reader, and the text of the picture. */
	label: string;
	/** The name of the small picture that shows this one (a button for a screen reader). */
	show: string;
}

/** What opens the viewer. */
export interface ViewerOptions {
	app: App;
	store: PictureStore;
	sourcePath: string;
	pictures: readonly ViewerPicture[];
	/** The index of the picture to show first. */
	start: number;
	/** The picture that was tapped: the focus returns to it when the viewer closes. */
	opener: HTMLElement | null;
}

/** The side of a small picture in CSS px (52 px on a phone; the copy has room for both). */
const THUMB_PX = 52;

let motion: () => ReduceMotion = () => 'system';

/** The plugin tells the viewer where the setting "Reduce movement" is (D126); without it the viewer follows the device. Returns the function that undoes it. */
export function bindViewerMotion(read: () => ReduceMotion): () => void {
	motion = read;
	return () => {
		motion = () => 'system';
	};
}

type State = 'idle' | 'loading' | 'ready' | 'problem';

interface Slot {
	pic: ViewerPicture;
	found: ResolvedPicture;
	state: State;
	copy: PictureCopy | null;
	thumb: PictureCopy | null;
	ctl: AbortController | null;
	button: HTMLElement | null;
	thumbImg: HTMLElement | null;
}

let labelIds = 0;

class PictureViewer extends Modal {
	private index: number;
	private readonly slots: Slot[];
	private readonly cleanup: (() => void)[] = [];
	private closed = false;
	private touch: PictureTouch | null = null;
	private shown: Size = { w: 0, h: 0 };
	private shownSlot: Slot | null = null;
	private stage!: HTMLElement;
	private img!: HTMLImageElement;
	private status!: HTMLElement;
	private nameEl!: HTMLElement;
	/** The dialog's label, read by screen readers only: an `aria-label` on the window would show as Obsidian's hover tooltip. */
	private labelEl!: HTMLElement;
	private lineEl!: HTMLElement;

	constructor(
		app: App,
		private readonly o: ViewerOptions,
	) {
		super(app);
		this.slots = o.pictures.map((pic) => ({ pic, found: o.store.resolve(pic.link, o.sourcePath), state: 'idle', copy: null, thumb: null, ctl: null, button: null, thumbImg: null }));
		this.index = Math.min(Math.max(0, o.start), Math.max(0, this.slots.length - 1));
	}

	/** Not `win`: Obsidian's `Modal` owns that name as a property, and a method of the same name would be hidden by it. */
	private viewWindow(): Window {
		return this.modalEl.win ?? window;
	}

	/** D126: movement is reduced by the setting or, with "Follow the device", by the device. */
	private reduced(): boolean {
		let prefers = false;
		try {
			prefers = this.viewWindow().matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
		} catch {
			prefers = false;
		}
		return reducedMotion(motion(), prefers);
	}

	override onOpen(): void {
		try {
			this.openWindow();
		} catch (e) {
			// A half-built window must not stay on the screen (spec §8).
			console.error('Crown and Kin: cannot build the picture viewer', e);
			this.close();
		}
	}

	private openWindow(): void {
		const m = this.modalEl;
		m.addClass('dynasty-sheet');
		m.addClass('dynasty-viewer');
		m.toggleClass('dynasty-reduce-motion', this.reduced());
		// The class on the container lets the style sheet darken the screen behind the window in a light theme.
		this.containerEl.addClass('dynasty-viewer-container');
		m.setAttribute('role', 'dialog');
		m.setAttribute('aria-modal', 'true');
		m.setAttribute('tabindex', '-1');
		this.cleanup.push(ignoreGhostClick(this));
		this.cleanup.push(trackModal(this, () => this.close()));
		this.build();
		this.cleanup.push(phoneLayout(this, () => this.fit()));
		this.cleanup.push(attachSheetSwipe(m, { close: () => this.close(), reduced: () => this.reduced(), enabled: () => !this.touch?.zoomed() }));
		const key = (e: KeyboardEvent) => this.onKey(e);
		m.addEventListener('keydown', key);
		this.cleanup.push(() => m.removeEventListener('keydown', key));
		this.slots.forEach((_, i) => this.loadThumb(i));
		this.show(this.index);
		this.cleanup.push(startWithoutFocus(m));
	}

	override onClose(): void {
		if (this.closed) return;
		this.closed = true;
		for (const c of this.cleanup.splice(0)) c();
		this.touch?.dispose();
		this.touch = null;
		for (const s of this.slots) {
			s.ctl?.abort();
			s.copy?.release();
			s.thumb?.release();
			s.copy = null;
			s.thumb = null;
		}
		this.contentEl.empty();
		// The picture that opened the viewer may be gone (the window drew again); then the focus stays where Obsidian puts it.
		const opener = this.o.opener;
		if (opener?.isConnected) opener.focus({ preventScroll: true });
	}

	// ---------- the window ----------

	private build(): void {
		const el = this.contentEl;
		el.addClass('dynasty-viewer-content');
		el.createDiv({ cls: 'dynasty-sheet-grip', attr: { 'aria-hidden': 'true' } });
		const head = el.createDiv({ cls: 'dynasty-viewer-head' });
		const labelId = `dynasty-viewer-label-${++labelIds}`;
		this.labelEl = el.createSpan({ cls: 'dynasty-sr-only', attr: { id: labelId } });
		this.modalEl.setAttribute('aria-labelledby', labelId);
		this.nameEl = head.createDiv({ cls: 'dynasty-viewer-name' });
		this.lineEl = head.createDiv({ cls: 'dynasty-viewer-line' });
		this.stage = el.createDiv({ cls: 'dynasty-viewer-stage' });
		this.img = this.stage.createEl('img', { cls: 'dynasty-viewer-img', attr: { alt: '', draggable: 'false' } });
		this.status = this.stage.createDiv({ cls: 'dynasty-viewer-status', attr: { role: 'status' } });
		if (this.slots.length > 1) this.buildThumbs(el);
		const close = el.createEl('button', { cls: ['dynasty-btn', 'dynasty-viewer-close'], text: VIEWER_UI.close, attr: { type: 'button' } });
		close.addEventListener('click', () => this.close());
		this.touch = attachPictureTouch({
			stage: this.stage,
			sizes: () => (this.ready() ? { shown: this.shown, stage: this.stageSize() } : null),
			apply: (v) => this.apply(v),
			side: (dir) => this.step(dir),
		});
	}

	private buildThumbs(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'dynasty-viewer-thumbs', attr: { role: 'group', 'aria-label': VIEWER_UI.group } });
		this.slots.forEach((s, i) => {
			const b = row.createEl('button', { cls: 'dynasty-viewer-thumb', attr: { type: 'button', 'aria-label': s.pic.show, 'aria-pressed': 'false' } });
			s.thumbImg = b.createEl('img', { attr: { alt: '', draggable: 'false' } });
			b.addEventListener('click', () => this.show(i));
			s.button = b;
		});
	}

	/** True when the current picture shows: only then can the picture be zoomed or moved. */
	private ready(): boolean {
		const s = this.slots[this.index];
		return s?.state === 'ready' && s.copy !== null && this.shown.w > 0;
	}

	private stageSize(): Size {
		const r = this.stage.getBoundingClientRect();
		return { w: r.width, h: r.height };
	}

	// ---------- the pictures ----------

	private show(i: number): void {
		this.index = i;
		const s = this.slots[i];
		if (!s) return;
		this.nameEl.setText(s.pic.heading);
		this.lineEl.setText(s.pic.line);
		this.labelEl.setText(s.pic.label);
		this.img.setAttribute('alt', s.pic.label);
		this.slots.forEach((x, k) => {
			x.button?.toggleClass('is-on', k === i);
			x.button?.setAttribute('aria-pressed', k === i ? 'true' : 'false');
		});
		this.touch?.reset();
		if (s.state === 'idle') this.load(s);
		this.paint();
	}

	/** Shows the state of the current picture: the large copy, the loading text or the problem text. */
	private paint(): void {
		const s = this.slots[this.index];
		if (!s) return;
		const ready = s.state === 'ready' && s.copy !== null;
		// A new picture starts at rest, also when it arrives late: the view of the picture before must not stay.
		if (this.shownSlot !== s) {
			this.shownSlot = s;
			this.shown = { w: 0, h: 0 };
			this.touch?.reset();
		}
		this.stage.toggleClass('has-picture', ready);
		this.status.toggleClass('is-hidden', ready);
		this.status.setText(ready ? '' : s.state === 'problem' ? VIEWER_UI.problem : VIEWER_UI.loading);
		if (!ready || !s.copy) return;
		this.img.setAttribute('src', s.copy.url);
		this.fit();
	}

	/** Sizes the whole picture to the stage. */
	private fit(): void {
		const s = this.slots[this.index];
		if (!s?.copy) return;
		const raster = s.found.ok && s.found.format !== 'svg';
		const shown = fitSize({ w: s.copy.w, h: s.copy.h }, this.stageSize(), raster);
		this.shown = shown;
		this.img.style.setProperty('--dynasty-vw-w', `${shown.w}px`);
		this.img.style.setProperty('--dynasty-vw-h', `${shown.h}px`);
		this.touch?.refit();
	}

	/** Draws the zoom and the move of the picture. */
	private apply(v: View): void {
		this.img.style.setProperty('--dynasty-vw-s', String(v.scale));
		this.img.style.setProperty('--dynasty-vw-x', `${Math.round(v.x)}px`);
		this.img.style.setProperty('--dynasty-vw-y', `${Math.round(v.y)}px`);
		this.modalEl.toggleClass('is-zoomed', v.scale > REST.scale);
	}

	private load(s: Slot): void {
		if (!s.found.ok) {
			s.state = 'problem';
			return;
		}
		s.state = 'loading';
		const ctl = new AbortController();
		s.ctl = ctl;
		const side = largeCopySide(this.viewWindow());
		this.o.store
			.transient(s.found.file, { w: side, h: side, fit: 'meet', noEnlarge: true }, ctl.signal)
			.then((r) => {
				const copy = r && 'url' in r && r.w > 0 && r.h > 0 ? r : null;
				if (this.closed || ctl.signal.aborted) {
					if (r && 'url' in r) r.release();
					return;
				}
				s.copy = copy;
				s.state = copy ? 'ready' : 'problem';
				if (this.slots[this.index] === s) this.paint();
			})
			.catch((e) => {
				console.error('Crown and Kin: cannot show the picture', e);
				s.state = 'problem';
				if (!this.closed && this.slots[this.index] === s) this.paint();
			});
	}

	private loadThumb(i: number): void {
		const s = this.slots[i];
		if (!s?.found.ok || !s.thumbImg) return;
		const img = s.thumbImg;
		this.o.store
			.acquire(s.found.file, { w: THUMB_PX, h: THUMB_PX, fit: 'meet' })
			.then((r) => {
				if (!r || !('url' in r)) return;
				if (this.closed) {
					r.release();
					return;
				}
				s.thumb = r;
				img.setAttribute('src', r.url);
			})
			.catch((e) => console.error('Crown and Kin: cannot show the small picture', e));
	}

	// ---------- the keyboard ----------

	private step(dir: number): void {
		const next = stepIndex(this.index, this.slots.length, dir);
		if (next !== this.index) this.show(next);
	}

	private onKey(e: KeyboardEvent): void {
		try {
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				if (this.slots.length < 2) return;
				e.preventDefault();
				this.step(e.key === 'ArrowRight' ? 1 : -1);
			} else if (e.key === 'Tab') this.holdFocus(e);
		} catch (err) {
			console.error('Crown and Kin: the picture viewer key failed', err);
		}
	}

	/** Tab stays inside the window: from the last control to the first, and back. */
	private holdFocus(e: KeyboardEvent): void {
		// The small pictures are hidden while the picture is zoomed, and a hidden control cannot take the focus.
		const zoomed = this.modalEl.hasClass('is-zoomed');
		const controls = Array.from(this.contentEl.querySelectorAll<HTMLElement>('button')).filter((b) => !(zoomed && b.hasClass('dynasty-viewer-thumb')));
		const first = controls[0];
		const last = controls[controls.length - 1];
		if (!first || !last) return;
		const active = this.modalEl.doc.activeElement;
		if (e.shiftKey && (active === first || active === this.modalEl)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}
}

/** Opens the viewer. It never throws: a failure is logged and the window that called stays as it is. */
export function openPictureViewer(o: ViewerOptions): void {
	try {
		if (o.pictures.length === 0) return;
		new PictureViewer(o.app, o).open();
	} catch (e) {
		console.error('Crown and Kin: cannot open the picture viewer', e);
	}
}
