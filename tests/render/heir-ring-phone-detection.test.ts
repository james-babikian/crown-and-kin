/*
 * Review proof for E3 (scratch): which devices lose the Overview ring of the heirs. The rule book says a phone is a coarse pointer and a short
 * SCREEN side under 600 px (isPhoneDevice). The ring is hidden by `.is-phone` (window width only) and by a coarse-pointer media rule on the window width.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPhoneDevice, isPhoneSideways } from '../../src/view/focus-mode';
import { isPhoneWidth } from '../../src/obsidian/modal-layout';

// The built stylesheet is a tracked artefact; the source chunk is what the rule is written in.
const css = readFileSync('styles/33-heir-cards-ordinal.css', 'utf8');
const hidesOnIsPhone = /\.modal\.dynasty-fullscreen\.is-phone \.dynasty-lod-overview \.dynasty-heir-numbers/.test(css);
const hidesOnDevice = /\.dynasty-root\.is-phone-device \.dynasty-lod-overview \.dynasty-heir-numbers \{\s*display: none;/.test(css);
// The tree view sets the device class on its root from the same test the bar uses (isPhoneDevice, through TreeView.isPhone).
const view = readFileSync('src/obsidian/tree-view.ts', 'utf8');
const lifecycle = readFileSync('src/obsidian/tree-view-lifecycle.ts', 'utf8');
const setsDeviceClass = /root\.toggleClass\('is-phone-device', this\.isPhone\(\)\)/.test(view) && /isPhone\(\): boolean \{\s*return isPhoneDevice\(this\.coarse, this\.containerEl\.win\)/.test(lifecycle);
const mediaHides = /@media \(pointer: coarse\) and \(max-width: 599px\) \{\s*\.dynasty-lod-overview \.dynasty-heir-numbers \{\s*display: none;/.test(css);

interface Device { name: string; coarse: boolean; w: number; h: number; screen: { width: number; height: number }; full: boolean }
const DEVICES: Device[] = [
	{ name: 'a computer window 500 px wide (mouse)', coarse: false, w: 500, h: 800, screen: { width: 1920, height: 1080 }, full: true },
	{ name: 'an iPad in a Split View window 500 px wide, full screen view', coarse: true, w: 500, h: 1000, screen: { width: 820, height: 1180 }, full: true },
	{ name: 'an iPad in a Split View window 500 px wide, tree in a note', coarse: true, w: 500, h: 1000, screen: { width: 820, height: 1180 }, full: false },
	{ name: 'an iPad full width, full screen view', coarse: true, w: 820, h: 1000, screen: { width: 820, height: 1180 }, full: true },
	{ name: 'an iPhone upright, full screen view', coarse: true, w: 390, h: 700, screen: { width: 390, height: 844 }, full: true },
	{ name: 'an iPhone on its side, full screen view', coarse: true, w: 844, h: 390, screen: { width: 390, height: 844 }, full: true },
];

/** What the stylesheet does to the ring at the Overview level for this device. */
function ringHidden(d: Device): boolean {
	const win = { innerWidth: d.w, innerHeight: d.h, screen: d.screen } as unknown as Window;
	const isPhoneClass = d.full && hidesOnIsPhone && isPhoneWidth(win);
	const sideClass = d.full && isPhoneSideways(d.coarse, win);
	const media = mediaHides && d.coarse && d.w <= 599;
	const deviceClass = hidesOnDevice && setsDeviceClass && isPhoneDevice(d.coarse, { innerWidth: d.w, innerHeight: d.h, screen: d.screen });
	return isPhoneClass || sideClass || media || deviceClass;
}

describe('which devices lose the Overview ring', () => {
	for (const d of DEVICES) {
		it(`${d.name}: the ring is hidden exactly when the device is a phone`, () => {
			const phone = isPhoneDevice(d.coarse, { innerWidth: d.w, innerHeight: d.h, screen: d.screen });
			expect(ringHidden(d)).toBe(phone);
		});
	}
});
