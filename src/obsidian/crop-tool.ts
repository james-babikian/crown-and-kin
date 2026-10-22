/*
 * The portrait crop tool (spec §13.13, D79, D90, D91). A window that shows the
 * whole picture under a round frame of fixed size. The owner moves and zooms the picture; the part
 * inside the frame is what the card shows. Save gives the part as fractions of the picture, or null
 * for the automatic part; Cancel, Escape and a press outside give nothing.
 *
 * The picture is a transient copy of at most 2048 px on the long side (size first, 40 MP limit, both
 * kept by the store) and is released when the window closes. The picture moves with a CSS transform
 * that comes from custom properties (`--dynasty-crop-*`), so no colour or style text is written here.
 * All the maths of the part (move, zoom, clamp) is in `core/portrait-crop.ts`; this file only maps
 * pointers, wheel, keys, buttons and the slider onto it.
 *
 * Behaviour (C1 to C8):
 * - Save gives a clamped `CropFraction`, or `null` when it is the automatic part. Cancel, Escape and a
 *   press outside give `cancel` and ask nothing.
 * - 0.2.8 contract G.9, D196 item 4: the tool has a dark surface in both themes. The title is at the top, the picture is under a
 *   circle in the middle, then the instruction text, the slider with its zoom icons, and the buttons: Cancel and Reset at the left, Save at
 *   the right. The edit sheet opens it at once after a new portrait; if the user closes it, the part that the plugin chose by itself stays.
 * - On a phone-width screen (`isPhoneWidth`) the tool fills the visible area with its buttons in a bottom bar of 44 px
 *   buttons and the title in the middle; otherwise it is a large window, 48 px from the edges of the screen (D212: no inner frame).
 * - One pointer drags (move). Two pointers move by the midpoint and zoom by the distance ratio about
 *   the midpoint. The wheel zooms by `exp(-deltaY * WHEEL_RATE)` about the pointer. The buttons zoom
 *   about the frame centre. The slider sets `side = 10^(-z)` (1 to 0.1). Keys (the picture area has
 *   focus): arrows move by `KEY_MOVE` of the frame (`KEY_MOVE_SHIFT` with Shift); `+`, `=` and `-`
 *   zoom by `KEY_ZOOM_STEP`. A drag by (dx, dy) screen px moves the crop by
 *   (-dx, -dy) * `side * min(w, h) / frameDiameter` picture px.
 * - The hint text depends on `matchMedia('(pointer: coarse)')`. Reset returns to the automatic part and
 *   does not close the tool.
 */

import { Modal, setIcon, type App, type TFile } from 'obsidian';
import { automaticCrop, clampCrop, isAutomaticCrop, moveCrop, readPortraitCrop, zoomCrop, CROP_MIN_SIDE, type CropFraction } from '../core/portrait-crop';
import { CROP_UI } from '../render/ui-text';
import { ignoreGhostClick, isPhoneWidth, phoneLayout } from './modal-layout';
import type { PictureCopy, PictureStore } from './picture-store';
import { trackModal } from '../view/plugin-modals';
import { nameDialog } from './sheet-parts';

/** What opens the crop tool. */
export interface CropToolOptions {
	app: App;
	file: TFile;
	store: PictureStore;
	/** The person's name, for the labels. */
	personName: string;
	/** The draft's part; null = the automatic part. */
	start: CropFraction | null;
}

/** What the crop tool answers: the saved part (null = the automatic part) or a cancel. */
export type CropResult = { kind: 'save'; crop: CropFraction | null } | { kind: 'cancel' };

/** The copy of the picture is at most this many px on the long side (spec §13.13). */
export const CROP_COPY_PX = 2048;
/**
 * The side of the box for a large copy, in CSS px (spec §13.13). The store multiplies the box by the pixel ratio (at most 3), so the box is smaller by the
 * same factor and the copy stays at `CROP_COPY_PX` px at most. The picture viewer asks for its copy the same way (D256).
 */
export function largeCopySide(win: Window): number {
	let ratio = 1;
	try {
		const d = win.devicePixelRatio;
		ratio = Math.min(Math.max(Number.isFinite(d) ? d : 1, 1), 3);
	} catch {
		ratio = 1;
	}
	return Math.max(1, Math.floor(CROP_COPY_PX / ratio));
}
/** The Zoom in button enlarges the shown size by this factor (C4). */
export const ZOOM_IN_STEP = 1.25;
/** The Zoom out button shrinks the shown size to 0.8 (C4). */
export const ZOOM_OUT_STEP = 0.8;
/** The + and - keys zoom by this factor (C4). */
export const KEY_ZOOM_STEP = 1.1;
/** The wheel zooms by exp(-deltaY x this) (C4). */
export const WHEEL_RATE = 0.002;
/** An arrow key moves the picture by this part of the frame; Shift moves it by the larger part (C4). */
export const KEY_MOVE = 0.02;
/** An arrow key with Shift moves the picture by this part of the frame (C4). */
export const KEY_MOVE_SHIFT = 0.1;
/** The area around the frame is this many times the frame across, so the part outside the frame shows darker. */
const AREA_RATIO = 1.4;

/** The slider position `z` (0 to 1) of a side (C4: `side = 10^(-z)`). */
export function sliderOf(side: number): number {
	const s = Math.min(Math.max(Number.isFinite(side) ? side : 1, CROP_MIN_SIDE), 1);
	return Math.min(1, Math.max(0, -Math.log10(s)));
}

/** The side that slider position `z` means (C4). */
export function sideOf(z: number): number {
	const v = Math.min(1, Math.max(0, Number.isFinite(z) ? z : 0));
	return Math.pow(10, -v);
}

/** The factor of a wheel turn of `deltaY` (C4). */
export function cropWheelFactor(deltaY: number): number {
	return Math.exp(-(Number.isFinite(deltaY) ? deltaY : 0) * WHEEL_RATE);
}

/**
 * The crop after a drag of (dx, dy) screen px in a frame `frame` px across (C4): the picture follows
 * the pointer, so the part moves the other way. `w` and `h` are the picture sizes.
 */
export function dragCrop(crop: CropFraction, dx: number, dy: number, frame: number, w: number, h: number): CropFraction {
	if (!(frame > 0)) return crop;
	const k = (crop.side * Math.min(w, h)) / frame;
	return moveCrop(crop, -dx * k, -dy * k, w, h);
}

/** The frame and area sizes in CSS px for a window of `width` × `height` px (the area is the square the picture shows in). */
export function toolSizes(phone: boolean, width: number, height: number): { frame: number; area: number } {
	const safe = (v: number, fallback: number) => (Number.isFinite(v) && v > 0 ? v : fallback);
	const w = safe(width, 360);
	const h = safe(height, 640);
	// D212 crop-tool: the picture is as large as the window allows. A phone: the area takes the full width, and the rest of the window (title,
	// hint, zoom row and buttons) takes about 320 px. A computer: the window is 48 px from the edges of the screen and at most 900 px wide, and
	// the rest of the window takes about 280 px.
	const frame = phone ? Math.min(w / AREA_RATIO, Math.max(140, (h - 320) / AREA_RATIO)) : Math.min(480, Math.max(160, Math.min(Math.min(900, w - 96) - 48, h - 96 - 280) / AREA_RATIO));
	const f = Math.floor(frame);
	return { frame: f, area: Math.round(f * AREA_RATIO) };
}

interface Point {
	x: number;
	y: number;
}

class CropModal extends Modal {
	private crop: CropFraction = { left: 0, top: 0, side: 1 };
	private pic: { w: number; h: number } | null = null;
	private copy: PictureCopy | null = null;
	private abort: AbortController | null = null;
	private settled = false;
	private readonly cleanup: (() => void)[] = [];
	private readonly pointers = new Map<number, Point>();
	private frame = 240;
	private area = 336;
	private areaEl!: HTMLElement;
	private imgEl!: HTMLImageElement;
	private slider!: HTMLInputElement;
	private saveEl!: HTMLButtonElement;
	private statusEl!: HTMLElement;

	constructor(
		app: App,
		private readonly o: CropToolOptions,
		private readonly done: (r: CropResult) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const m = this.modalEl;
		m.addClass('dynasty-sheet');
		m.addClass('dynasty-crop');
		this.cleanup.push(ignoreGhostClick(this));
		this.cleanup.push(trackModal(this, () => this.finish({ kind: 'cancel' })));
		this.build();
		this.cleanup.push(phoneLayout(this, () => this.layout()));
		void this.load();
		// Keys (arrows, plus, minus) work at once; Modal focuses the close button otherwise.
		this.areaEl.focus({ preventScroll: true });
	}

	override onClose(): void {
		for (const c of this.cleanup.splice(0)) c();
		this.abort?.abort();
		this.abort = null;
		this.pointers.clear();
		// The copy is a transient one: releasing it frees its memory now.
		this.copy?.release();
		this.copy = null;
		this.contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.done({ kind: 'cancel' });
		}
	}

	private finish(r: CropResult): void {
		if (this.settled) return;
		this.settled = true;
		this.done(r);
		this.close();
	}

	// ---------- the window ----------

	private build(): void {
		const el = this.contentEl;
		el.addClass('dynasty-sheet-content');
		nameDialog(this.modalEl, el.createDiv({ cls: ['dynasty-sheet-title', 'dynasty-crop-title'], text: CROP_UI.title(this.o.personName) }));
		const body = el.createDiv({ cls: ['dynasty-sheet-body', 'dynasty-crop-body'] });

		// The hint names the area for a screen reader. An aria-label would also show as a tooltip over the picture while it is dragged.
		this.areaEl = body.createDiv({ cls: 'dynasty-crop-area', attr: { tabindex: '0', role: 'group', 'aria-labelledby': 'dynasty-crop-hint' } });
		this.imgEl = this.areaEl.createEl('img', { cls: 'dynasty-crop-img', attr: { alt: '', draggable: 'false' } });
		this.areaEl.createDiv({ cls: 'dynasty-crop-frame', attr: { 'aria-hidden': 'true' } });
		this.wireArea();
		this.statusEl = body.createDiv({ cls: 'dynasty-crop-status', attr: { role: 'status' }, text: CROP_UI.loading });
		body.createDiv({ cls: 'dynasty-crop-hint', text: this.coarse() ? CROP_UI.hintTouch : CROP_UI.hintMouse, attr: { id: 'dynasty-crop-hint' } });

		const zoom = body.createDiv({ cls: 'dynasty-crop-zoom' });
		this.iconButton(zoom, '', CROP_UI.zoomOut, () => this.zoom(ZOOM_OUT_STEP), 'zoom-out');
		this.slider = zoom.createEl('input', { cls: 'dynasty-crop-slider', attr: { type: 'range', min: '0', max: '1', step: '0.001', value: '0', 'aria-label': CROP_UI.sliderLabel } });
		this.slider.addEventListener('input', () => this.zoomTo(sideOf(Number(this.slider.value))));
		this.iconButton(zoom, '', CROP_UI.zoomIn, () => this.zoom(ZOOM_IN_STEP), 'zoom-in');

		const bar = body.createDiv({ cls: 'dynasty-crop-bar' });
		const cancel = this.iconButton(bar, CROP_UI.cancel, CROP_UI.cancel, () => this.finish({ kind: 'cancel' }));
		cancel.addClass('dynasty-crop-cancel');
		const reset = this.iconButton(bar, CROP_UI.reset, CROP_UI.resetLabel, () => this.reset());
		reset.addClass('dynasty-crop-reset');
		bar.createSpan({ cls: 'dynasty-crop-spacer', attr: { 'aria-hidden': 'true' } });
		this.saveEl = this.iconButton(bar, CROP_UI.save, CROP_UI.save, () => this.save());
		this.saveEl.addClass('mod-cta', 'dynasty-crop-save');
		this.saveEl.disabled = true;
	}

	/** A button of at least 44 × 44 px with a label and the same text as its tooltip (spec §7.5). */
	private iconButton(parent: HTMLElement, text: string, label: string, run: () => void, icon?: string): HTMLButtonElement {
		const b = parent.createEl('button', { cls: text ? ['dynasty-btn', 'dynasty-crop-button'] : ['dynasty-icon-btn', 'dynasty-crop-button'], text, attr: { type: 'button', 'aria-label': label } });
		if (icon) setIcon(b, icon);
		b.addEventListener('click', () => {
			try {
				run();
			} catch (e) {
				console.error('Crown and Kin: the crop tool action failed', e);
			}
		});
		return b;
	}

	private hostWin(): Window {
		return this.modalEl.win ?? window;
	}

	private coarse(): boolean {
		try {
			return this.hostWin().matchMedia('(pointer: coarse)').matches;
		} catch {
			return false;
		}
	}

	/** Sets the frame size from the window; the picture is drawn again at the new size. */
	private layout(): void {
		const win = this.hostWin();
		const phone = isPhoneWidth(win);
		const vv = win.visualViewport;
		const sizes = toolSizes(phone, win.innerWidth, phone && vv ? vv.height : win.innerHeight);
		this.frame = sizes.frame;
		this.area = sizes.area;
		this.modalEl.style.setProperty('--dynasty-crop-frame', `${sizes.frame}px`);
		this.modalEl.style.setProperty('--dynasty-crop-area', `${sizes.area}px`);
		this.paint();
	}

	// ---------- the picture ----------

	private async load(): Promise<void> {
		const ctl = new AbortController();
		this.abort = ctl;
		const side = largeCopySide(this.hostWin());
		try {
			const r = await this.o.store.transient(this.o.file, { w: side, h: side, fit: 'meet' }, ctl.signal);
			if (ctl.signal.aborted || this.settled) {
				if (r && 'url' in r) r.release();
				return;
			}
			if (!r || !('url' in r) || !(r.w > 0 && r.h > 0)) {
				this.statusEl.setText(CROP_UI.problem);
				return;
			}
			this.copy = r;
			this.pic = { w: r.w, h: r.h };
			this.imgEl.setAttribute('src', r.url);
			this.imgEl.style.setProperty('--dynasty-crop-w', `${r.w}px`);
			this.imgEl.style.setProperty('--dynasty-crop-h', `${r.h}px`);
			this.crop = clampCrop(this.o.start ?? automaticCrop(r.w, r.h), r.w, r.h);
			this.statusEl.hide();
			this.saveEl.disabled = false;
			this.areaEl.addClass('has-picture');
			this.paint();
		} catch (e) {
			console.error('Crown and Kin: cannot load the picture for the crop tool', e);
			if (!this.settled) this.statusEl.setText(CROP_UI.problem);
		}
	}

	/** Puts the picture under the frame: the crop square fills the frame. */
	private paint(): void {
		const p = this.pic;
		if (!this.areaEl) return;
		if (!p) return;
		const scale = this.frame / (this.crop.side * Math.min(p.w, p.h));
		const off = (this.area - this.frame) / 2;
		this.areaEl.style.setProperty('--dynasty-crop-tx', `${(off - this.crop.left * p.w * scale).toFixed(2)}px`);
		this.areaEl.style.setProperty('--dynasty-crop-ty', `${(off - this.crop.top * p.h * scale).toFixed(2)}px`);
		this.areaEl.style.setProperty('--dynasty-crop-scale', scale.toFixed(6));
		this.slider.value = String(sliderOf(this.crop.side));
	}

	// ---------- moving and zooming ----------

	private set(next: CropFraction): void {
		this.crop = next;
		this.paint();
	}

	private move(dx: number, dy: number): void {
		const p = this.pic;
		if (!p) return;
		this.set(dragCrop(this.crop, dx, dy, this.frame, p.w, p.h));
	}

	private zoomAt(factor: number, at: Point): void {
		const p = this.pic;
		if (!p) return;
		this.set(zoomCrop(this.crop, factor, at, p.w, p.h));
	}

	private zoom(factor: number): void {
		this.zoomAt(factor, { x: 0.5, y: 0.5 });
	}

	private zoomTo(side: number): void {
		this.zoom(this.crop.side / side);
	}

	private reset(): void {
		const p = this.pic;
		if (!p) return;
		this.set(automaticCrop(p.w, p.h));
	}

	private save(): void {
		const p = this.pic;
		if (!p) return;
		const crop = clampCrop(this.crop, p.w, p.h);
		this.finish({ kind: 'save', crop: isAutomaticCrop(crop, p.w, p.h) ? null : crop });
	}

	/** The point of the frame (0 to 1 each way) under a screen point. */
	private frameAt(clientX: number, clientY: number): Point {
		const r = this.areaEl.getBoundingClientRect();
		const off = (this.area - this.frame) / 2;
		return { x: (clientX - r.left - off) / this.frame, y: (clientY - r.top - off) / this.frame };
	}

	// ---------- pointer, wheel and keys ----------

	private wireArea(): void {
		const a = this.areaEl;
		a.addEventListener('pointerdown', (e) => {
			if (!this.pic || (e.pointerType === 'mouse' && e.button !== 0)) return;
			this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			try {
				a.setPointerCapture(e.pointerId);
			} catch {
				// A pointer that is gone: the move events stop by themselves.
			}
			e.preventDefault();
		});
		a.addEventListener('pointermove', (e) => this.onMove(e));
		const up = (e: PointerEvent) => {
			this.pointers.delete(e.pointerId);
			try {
				a.releasePointerCapture(e.pointerId);
			} catch {
				// Nothing was captured.
			}
		};
		a.addEventListener('pointerup', up);
		a.addEventListener('pointercancel', up);
		// Not passive: the wheel must not scroll the window (C4).
		a.addEventListener(
			'wheel',
			(e) => {
				if (!this.pic) return;
				e.preventDefault();
				this.zoomAt(cropWheelFactor(e.deltaY), this.frameAt(e.clientX, e.clientY));
			},
			{ passive: false },
		);
		a.addEventListener('keydown', (e) => this.onKey(e));
	}

	private onMove(e: PointerEvent): void {
		const before = this.pointers.get(e.pointerId);
		if (!before || !this.pic) return;
		const now = { x: e.clientX, y: e.clientY };
		if (this.pointers.size === 1) {
			this.pointers.set(e.pointerId, now);
			this.move(now.x - before.x, now.y - before.y);
			return;
		}
		if (this.pointers.size !== 2) {
			this.pointers.set(e.pointerId, now);
			return;
		}
		const other = [...this.pointers].find(([id]) => id !== e.pointerId)?.[1];
		this.pointers.set(e.pointerId, now);
		if (!other) return;
		const oldMid = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 };
		const newMid = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
		const oldDist = Math.hypot(before.x - other.x, before.y - other.y);
		const newDist = Math.hypot(now.x - other.x, now.y - other.y);
		// The picture point under the midpoint stays under it: zoom about the old midpoint, then follow the midpoint.
		if (oldDist > 0 && newDist > 0) this.zoomAt(newDist / oldDist, this.frameAt(oldMid.x, oldMid.y));
		this.move(newMid.x - oldMid.x, newMid.y - oldMid.y);
	}

	private onKey(e: KeyboardEvent): void {
		if (!this.pic) return;
		const step = (e.shiftKey ? KEY_MOVE_SHIFT : KEY_MOVE) * this.frame;
		let handled = true;
		switch (e.key) {
			case 'ArrowLeft':
				this.move(-step, 0);
				break;
			case 'ArrowRight':
				this.move(step, 0);
				break;
			case 'ArrowUp':
				this.move(0, -step);
				break;
			case 'ArrowDown':
				this.move(0, step);
				break;
			case '+':
			case '=':
				this.zoom(KEY_ZOOM_STEP);
				break;
			case '-':
			case '_':
				this.zoom(1 / KEY_ZOOM_STEP);
				break;
			default:
				handled = false;
		}
		if (handled) {
			e.preventDefault();
			e.stopPropagation();
		}
	}
}

/** Opens the crop tool for a picture file; resolves to the saved part (null = automatic) or a cancel. Never rejects. */
export function openCropTool(options: CropToolOptions): Promise<CropResult> {
	return new Promise<CropResult>((resolve) => {
		try {
			new CropModal(options.app, options, resolve).open();
		} catch (e) {
			console.error('Crown and Kin: cannot open the crop tool', e);
			resolve({ kind: 'cancel' });
		}
	});
}

/** The part a sheet's draft text means for the tool's start: null when the text is empty or unreadable. */
export function startCropOf(text: string): CropFraction | null {
	const r = readPortraitCrop(text);
	return r.kind === 'ok' ? r.crop : null;
}
