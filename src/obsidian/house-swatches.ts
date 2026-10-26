/*
 * The colour swatches of a house on the edit page of the Houses window (D32, spec §5.8): the 12 house colours as a radio group, then "Other colour",
 * which opens the system colour window. A choice changes the swatches in place (G5 0.4): the Houses window keeps the draft and calls `paintHouseColour`.
 * The colours of the arms (D68) are drawn by the window, and this file marks them too.
 */

import { HOUSE_PALETTE } from '../render/styles';
import { HOUSES, HOUSE_COLOUR_NAMES } from '../render/ui-text';

/** A colour as the plugin writes it: `#rrggbb`. */
export const HEX = /^#[0-9a-f]{6}$/i;

/** What the palette of one house needs from the window. */
export interface PaletteSpec {
	/** The key of the house row: part of the `data-focus` names. */
	key: string;
	/** The id of the label "Colour" that names the group. */
	titleId: string;
	/** The name of the house, for the name of the group. */
	name: string;
	colour: string | null;
	/** A swatch was chosen: `hex` is the colour, `used` the swatch that has the focus after it. */
	pick: (hex: string, used: HTMLElement) => void;
	/** The window's guard: an action that fails never leaves an exception (spec §8). */
	guard: (run: () => void) => void;
}

/** Draws the 12 swatches and "Other colour" into `box`, the current colour with its ring. */
export function drawHousePalette(box: HTMLElement, o: PaletteSpec): void {
	const now = o.colour?.toLowerCase() ?? null;
	const grid = box.createDiv({ cls: ['dynasty-swatches', 'dynasty-house-colours'], attr: { role: 'radiogroup', 'aria-label': HOUSES.paletteTitle(o.name), 'aria-labelledby': o.titleId } });
	HOUSE_PALETTE.forEach((hex, i) => {
		const chosen = now === hex;
		const b = grid.createEl('button', {
			cls: chosen ? ['dynasty-swatch', 'dynasty-house-colour', 'is-selected'] : ['dynasty-swatch', 'dynasty-house-colour'],
			attr: { type: 'button', role: 'radio', 'aria-label': HOUSE_COLOUR_NAMES[i], 'aria-pressed': String(chosen), 'aria-checked': String(chosen), 'data-colour': hex, 'data-focus': `colour:${o.key}:${hex}` },
		});
		b.style.setProperty('--dynasty-house-color', hex);
		b.addEventListener('click', () => o.guard(() => o.pick(hex, b)));
	});
	// "Other colour": the last swatch. A colour that is not in the palette shows in this swatch, which then has a ring.
	const custom = isCustom(o.colour);
	const other = grid.createDiv({ cls: 'dynasty-house-other' });
	const swatch = other.createEl('button', {
		cls: custom ? ['dynasty-swatch', 'is-other', 'is-custom', 'is-selected'] : ['dynasty-swatch', 'is-other'],
		attr: { type: 'button', role: 'radio', 'aria-label': HOUSES.otherColour, 'aria-checked': String(custom), 'aria-pressed': String(custom), 'data-focus': `other-swatch:${o.key}` },
	});
	if (custom) swatch.style.setProperty('--dynasty-house-color', now);
	// The input lies over the swatch and takes a tap or a click itself (styles/21): iOS opens the colour window only for a tap on the input, never for
	// `showPicker()` or `click()` from code (G5 0.4, owner's iPhone). It is not a Tab stop and not read; the swatch is the control for the keyboard and a screen reader.
	const input = other.createEl('input', { cls: ['dynasty-sheet-colour', 'dynasty-house-other-input'], attr: { type: 'color', id: `${o.titleId}-other`, tabindex: '-1', 'aria-hidden': 'true', 'data-focus': `other:${o.key}` } });
	input.value = o.colour && HEX.test(o.colour) ? now! : '#888888';
	// Only a key press reaches the swatch now (Enter or Space on a computer); there the browser lets code open the colour window.
	swatch.addEventListener('click', () => o.guard(() => (input.showPicker ? input.showPicker() : input.click())));
	// The input keeps the focus: iOS closes its colour window at once, with no animation, when the focus moves while it is open (owner's iPhone, 0.4).
	input.addEventListener('change', () =>
		o.guard(() => {
			if (HEX.test(input.value)) o.pick(input.value.toLowerCase(), input);
		}),
	);
}

/** True for a colour that "Other colour" shows: a written `#rrggbb` that is not one of the 12. */
function isCustom(colour: string | null): boolean {
	return !!colour && HEX.test(colour) && !(HOUSE_PALETTE as readonly string[]).includes(colour.toLowerCase());
}

/**
 * Shows `colour` in the swatches of `box`, in place: the ring and the checked state move, and "Other colour" shows a colour that is not in the set.
 * A rebuild of the whole window for each tap drew a half-built frame on the iPhone, with the sections below over the colours (G5 0.4). The controls
 * stay; the focus goes to `used`, the swatch that was used (Safari gives a tapped button no focus). For "Other colour", `used` is the colour input,
 * which already has the focus: moving it would close the iPhone colour window.
 */
export function paintHouseColour(box: HTMLElement, colour: string | null, used: HTMLElement): void {
	if (used.isConnected && (used.doc ?? document).activeElement !== used) used.focus({ preventScroll: true });
	const now = colour?.toLowerCase() ?? null;
	const mark = (b: HTMLElement, on: boolean) => {
		b.toggleClass('is-selected', on);
		b.setAttribute('aria-pressed', String(on));
		if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', String(on));
	};
	for (const b of Array.from(box.querySelectorAll<HTMLElement>('.dynasty-house-colour, .dynasty-house-arms-colour'))) mark(b, b.getAttribute('data-colour') === now);
	const custom = isCustom(colour);
	const swatch = box.querySelector<HTMLElement>('.dynasty-swatch.is-other');
	if (swatch) {
		mark(swatch, custom);
		swatch.toggleClass('is-custom', custom);
		if (custom) swatch.style.setProperty('--dynasty-house-color', now);
		else swatch.style.removeProperty('--dynasty-house-color');
	}
	const input = box.querySelector<HTMLInputElement>('.dynasty-house-other-input');
	if (input && now && HEX.test(now) && input.value !== now) input.value = now;
}
