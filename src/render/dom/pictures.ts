/*
 * The picture slots of the drawn tree (spec §13.6, §13.7, M9): the places `buildScene` makes for
 * arms and portraits, and the two calls that fill them. `buildScene` makes the empty slots (and the
 * portrait frames) but never an `<image>`; the tree view's live pictures (`src/obsidian`) decide
 * which slots to fill (`livePictureSlots` in `view-math.ts`) and call `setPicture` with a small
 * copy's URL, and `setSlotProblem` when a picture cannot show. Nothing here reads the vault or makes
 * a URL, and no colour is written: styles.css styles the classes.
 */

import type { Rect } from '../../layout/model';

/** One place for a picture on a card (S1). */
export interface PictureSlot {
	kind: 'arms' | 'portrait';
	/** The level of detail the slot shows at: Full arms and portraits, or Compact arms. */
	lod: 'full' | 'compact';
	person: string;
	/** Arms: the house id (one small copy per house). */
	house?: string;
	/** The picture's box in layout px, absolute. */
	rect: Rect;
	/** The group the `<image>` goes into (class `dynasty-arms` or `dynasty-portrait`). */
	el: SVGGElement;
	/** Portrait: the frame circle (class `dynasty-portrait-frame`). */
	frame?: SVGCircleElement;
}

/** B1: a slot's picture problem: `missing` (the file is not in the vault: dashed frame), `other`, or null for none. */
export type SlotProblem = 'missing' | 'other' | null;

/** The class of a slot's picture element; styles.css keeps it from taking pointer events. */
export const PICTURE_CLASS = 'dynasty-picture';
/** Set on a slot's group while it shows a picture, so styles.css can drop the empty frame's fill. */
export const HAS_PICTURE_CLASS = 'has-picture';

/**
 * S2: shows `url` in the slot (one `<image>`, the slot's box, "xMidYMid meet": the picture keeps its
 * own proportions, D75), replaces the picture that is there, or removes it with null. A portrait
 * picture goes under its frame; the small copy is already the round upper-centre square.
 */
export function setPicture(slot: PictureSlot, url: string | null): void {
	const el = slot.el;
	const old = el.querySelector(`image.${PICTURE_CLASS}`);
	if (url === null) {
		old?.remove();
		el.removeClass(HAS_PICTURE_CLASS);
		return;
	}
	if (old) {
		old.setAttribute('href', url);
		return;
	}
	const r = slot.rect;
	const img = el.createSvg('image', {
		cls: PICTURE_CLASS,
		attr: { href: url, x: r.x, y: r.y, width: r.w, height: r.h, preserveAspectRatio: 'xMidYMid meet' },
	});
	if (slot.frame) el.insertBefore(img, slot.frame);
	el.addClass(HAS_PICTURE_CLASS);
}

/**
 * B1: marks a slot's problem. A portrait frame is dashed (`is-missing`) only for a missing file;
 * another problem, or a picture that still loads, keeps the solid empty frame. A problem also
 * removes the slot's picture, so arms with a problem show nothing.
 */
export function setSlotProblem(slot: PictureSlot, problem: SlotProblem): void {
	if (problem !== null) setPicture(slot, null);
	slot.frame?.toggleClass('is-missing', problem === 'missing');
}

/** S4: shows a small copy in a legend arms slot (from `buildLegend`), or empties it with null. */
export function setLegendArms(el: HTMLElement, url: string | null): void {
	el.empty();
	if (url !== null) el.createEl('img', { cls: PICTURE_CLASS, attr: { src: url, alt: '' } });
}
