/*
 * Fixed text of arms, portraits, the picture picker, Save as picture and the portrait crop tool.
 * Simplified Technical English (ASD-STE100) and the project word list apply. `ui-text.ts` re-exports every name, so old imports keep working.
 */

import type { PictureProblem } from '../core/pictures';
import { quote } from '../core/quote';
import { isolateName } from './name-bidi';

/**
 * Arms, portraits and the picture picker (spec §13.6, §13.7; D67–D69, D75–D78). "Colours from the arms" shows the exact colours of the arms (D68).
 */
export const PICTURES_UI = {
	// The Houses window (spec §13.6).
	/** The accessible name of the arms box of a house; a tap on it opens the picker. */
	armsLabel: (house: string) => `Select the arms of ${house}`,
	/** The spoken name of the arms button of a house in the Houses window (it opens a menu). */
	armsButtonLabel: (house: string) => `Change the arms of ${house}`,
	selectArms: 'Select arms',
	removeArms: 'Remove arms',
	coloursFromArms: 'Colours from the arms',
	/** D330 O-19: the visible label of the colours from the arms; `coloursFromArms` stays the screen-reader name. */
	fromArms: 'From the arms',
	armsColourLabel: (n: number) => `Colour ${n} from the arms`,
	// The edit sheet (spec §13.7).
	selectPortrait: 'Select portrait',
	removePortrait: 'Remove portrait',
	// The picture picker (spec §13.6 "Picture picker", D69).
	pickerPortraitTitle: (name: string) => `Select a portrait for ${isolateName(name)}`,
	/** The short title in the bar of the picture picker on a phone (D212 picker-grid). */
	pickerBarPortrait: 'Portrait',
	pickerBarArms: 'Arms',
	search: 'Type the name of a picture',
	searchLabel: 'Find a picture in the vault',
	fromDevice: 'Add a picture from this device',
	fromDeviceDetail: 'The plugin copies the picture into the attachment folder of this note.',
	topFolder: 'Top folder of the vault',
	noMatch: 'The vault has no picture with this name.',
	noPictures: 'The vault has no pictures.',
	select: 'Select',
	cancel: 'Cancel',
	added: (name: string, folder: string) =>
		folder ? `The plugin added the picture ${quote(name)} to the folder ${quote(folder)}.` : `The plugin added the picture ${quote(name)} to the top folder of the vault.`,
	addFailed: 'The plugin cannot add the picture because of an error. Try again.',
} as const;

/** The picture list (spec §13.14, D92 to D95): the folder rows, the mark on the current picture and the search limit. */
export const PICKER_UI = {
	inUse: 'In use',
	inUseLabel: 'This picture is in use now',
	openFolder: (path: string) => `Open the folder ${path}`,
	closeFolder: (path: string) => `Close the folder ${path}`,
	more: 'The vault has more pictures with this name. Type more of the name.',
} as const;

/**
 * B2 (spec §13.6 "Picture picker"): the Notice for a file from the device that fails the format or
 * size check (§13.0 item 3). The plugin writes no file then.
 */
export function deviceNotice(problem: PictureProblem): string {
	if (problem?.code === 'picture-not-image' && problem.format) return `The plugin cannot show this ${problem.format} picture. Save the picture as PNG or JPEG. Then select it again.`;
	if (problem?.code === 'picture-too-large') {
		return typeof problem.pixels === 'number'
			? `This picture is too large (${problem.pixels} million pixels). Use a picture with 40 million pixels or less.`
			: 'This picture is too large. Use a picture with 40 million pixels or less.';
	}
	return 'This file is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.';
}

/**
 * Save as picture (spec §13.8, D70–D74): the More item, the window with the
 * kind of file, and the Notices of the save.
 */
export const SAVE_UI = {
	more: 'Save as picture',
	moreLabel: 'Save as picture: save the tree as a picture',
	title: 'Save as picture',
	/** The accessible name of the two choices of the window. */
	kindLabel: 'Kind of file',
	png: 'PNG',
	pngDetail: 'A picture that most apps and devices can open.',
	svg: 'SVG',
	svgDetail: 'A picture that stays sharp at every size.',
	save: 'Save',
	cancel: 'Cancel',
	progress: 'The plugin makes the picture. This can take some time.',
	saved: (name: string, folder: string) =>
		folder ? `The plugin saved the picture ${quote(name)} in the folder ${quote(folder)}.` : `The plugin saved the picture ${quote(name)} in the top folder of the vault.`,
	small: 'The tree is very large. The names are small in this picture.',
	smallSvg: 'If you want sharp names, save the tree as SVG (a picture that stays sharp at every size).',
	share: 'Share',
	shareLabel: (name: string) => `Share the picture ${quote(name)}`,
	failed: 'The plugin cannot save the picture because of an error. Try again.',
} as const;

/**
 * The portrait crop tool (spec §13.13, D79, D90): the button in the edit sheet, the window and
 * its hints. The buttons also show their label as a tooltip.
 */
export const CROP_UI = {
	title: 'Crop the portrait',
	/** D330 O-34: the second, lighter line under the title: the name only. */
	nameLine: (name: string) => name,
	hintTouch: 'Move the picture with one finger. Zoom with two fingers.',
	hintMouse: 'Drag the picture to move it. Use the mouse wheel or the slider to zoom.',
	zoomOut: 'Zoom out',
	zoomIn: 'Zoom in',
	sliderLabel: 'Zoom',
	save: 'Save',
	cancel: 'Cancel',
	reset: 'Reset',
	resetLabel: 'Reset: select the automatic part again',
	loading: 'The plugin loads the picture.',
	problem: 'The plugin cannot show this picture.',
} as const;
