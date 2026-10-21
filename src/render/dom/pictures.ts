/*
 * The picture slots of the drawn tree (spec §13.6, §13.7, M9): the places `buildScene` makes for
 * arms and portraits, and the two calls that fill them. `buildScene` makes the empty slots (and the
 * portrait frames) but never an `<image>`; the tree view's live pictures (`src/obsidian`) decide
 * which slots to fill (`livePictureSlots` in `view-math.ts`) and call `setPicture` with a small
 * copy's URL, and `setSlotProblem` when a picture cannot show. Nothing here reads the vault or makes
 * a URL, and no colour is written: styles.css styles the classes.
 */

import { armsGap, type ArmsOutline } from '../../layout/arms-outline';
import type { Rect } from '../../layout/model';

/** 0.2.8 (I05, D204): whose arms a slot shows: the arms of a house, or the personal arms of a person. */
export type PictureOwner = { house: string } | { person: string };

/** One place for a picture on a card (S1). */
export interface PictureSlot {
	kind: 'arms' | 'portrait';
	/** The level of detail the slot shows at: Full arms and portraits, or Compact arms. */
	lod: 'full' | 'compact';
	person: string;
	/** Arms only: the owner of the arms picture, the house (one small copy per house) or the person (personal arms). A portrait slot has none. */
	owner?: PictureOwner;
	/** The picture's box in layout px, absolute. */
	rect: Rect;
	/** The group the `<image>` goes into (class `dynasty-arms` or `dynasty-portrait`). */
	el: SVGGElement;
	/** Portrait: the frame circle (class `dynasty-portrait-frame`). */
	frame?: SVGCircleElement;
	/** D219: arms only. How wide the gap in the colour of the page is round the arms picture, in layout px. */
	gap?: number;
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
		// The gap belongs to the picture: without the picture it would be a hole in the card for nothing.
		setArmsGap(slot, null);
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

/** D219: the class of the path that makes the gap round arms; styles.css fills it and strokes it in the colour of the page. */
export const ARMS_GAP_CLASS = 'dynasty-arms-gap';

/**
 * D219: draws the gap in the colour of the page round the arms of `slot`: the outline of the picture, grown by `slot.gap`. One path, made when the
 * picture comes (the outline is read once for each picture file), so nothing is computed while the view pans. With null (the outline is not ready, or the slot has no picture)
 * the gap is removed: no gap is drawn until the shape is known.
 */
export function setArmsGap(slot: PictureSlot, outline: ArmsOutline | null): void {
	const el = slot.el;
	const old = el.querySelector(`path.${ARMS_GAP_CLASS}`);
	if (!outline || slot.kind !== 'arms' || !(slot.gap !== undefined && slot.gap > 0)) {
		old?.remove();
		return;
	}
	const g = armsGap(outline, slot.rect, slot.gap);
	if (old) {
		old.setAttribute('d', g.d);
		old.setAttribute('stroke-width', String(g.strokeWidth));
		return;
	}
	const path = el.createSvg('path', { cls: ARMS_GAP_CLASS, attr: { d: g.d, 'stroke-width': g.strokeWidth } });
	// Under the picture.
	el.prepend(path);
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
