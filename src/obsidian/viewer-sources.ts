/*
 * What the picture viewer shows for a person and for a house (spec §0 D256), and the menu item "View portrait" / "View arms" that opens it. A person has a
 * portrait and arms: the personal arms, else the arms of the house (the arms that the card shows). A house page has its arms. A picture that cannot
 * resolve (a missing note, a web address) is left out, so the menu item never opens a viewer that has nothing to show. The windows pass a small kit of
 * what they know; this file never writes.
 */

import type { App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { cardLabels, needsLabels } from '../core/titles';
import type { Person } from '../core/types';
import { dateLine } from '../render/tree-info';
import { VIEWER_UI } from '../render/viewer-text';
import { openPictureViewer, type ViewerPicture } from './picture-viewer';
import type { PictureStore } from './picture-store';
import type { MenuEntry } from './window-parts';

/** What every window gives the viewer. */
export interface ViewerKit {
	app: App;
	pictures: PictureStore | undefined;
	sourcePath: string | undefined;
}

/** What the person window gives the viewer: the tree, the person and the draft of the form (the pictures the window shows now). */
export interface PersonKit extends ViewerKit {
	g: FamilyGraph;
	person: Person;
	draft: { name: string; portrait: string; arms: string; house: string; title: string; born: string; died: string };
}

/** What the house page gives the viewer: the name of the house and its arms link in the draft. */
export interface HouseKit extends ViewerKit {
	name: string;
	arms: string | null;
}

/** The pictures of a person: the portrait, then the personal arms or else the arms of the house. */
export function personPictures(kit: PersonKit): ViewerPicture[] {
	const d = kit.draft;
	const name = d.name.trim() || kit.person.name || '';
	const heading = name || VIEWER_UI.unnamed;
	const who = name || VIEWER_UI.thisPerson;
	const out: ViewerPicture[] = [];
	const portrait = d.portrait.trim();
	if (portrait) {
		const label = kit.person.id !== '' && needsLabels(kit.g) ? cardLabels(kit.g).get(kit.person.id) : undefined;
		const dates = dateLine({ ...kit.person, born: d.born.trim() || undefined, died: d.died.trim() || undefined }, kit.g.dates) ?? '';
		out.push({ kind: 'portrait', link: portrait, heading, line: VIEWER_UI.portraitLine([label?.title ?? d.title.trim(), dates]), label: VIEWER_UI.portraitOf(who), show: VIEWER_UI.showPortrait });
	}
	const own = d.arms.trim();
	const house = d.house !== '' ? kit.g.houses?.get(d.house) : undefined;
	const arms = own || house?.arms?.trim() || '';
	if (arms) {
		const owner = own ? who : house?.name || house?.id || '';
		const line = own ? VIEWER_UI.personalArms : owner ? VIEWER_UI.armsOf(owner) : VIEWER_UI.arms;
		out.push({ kind: 'arms', link: arms, heading, line, label: owner ? VIEWER_UI.armsOf(owner) : VIEWER_UI.arms, show: VIEWER_UI.showArms });
	}
	return out;
}

/** The arms of a house page. */
export function housePictures(kit: HouseKit): ViewerPicture[] {
	const arms = kit.arms?.trim();
	if (!arms) return [];
	const name = kit.name.trim();
	// The name above already says whose arms these are, so the text line is one word; the screen-reader label keeps the owner.
	const label = name ? VIEWER_UI.armsOf(name) : VIEWER_UI.arms;
	return [{ kind: 'arms', link: arms, heading: name || VIEWER_UI.arms, line: VIEWER_UI.arms, label, show: VIEWER_UI.showArms }];
}

/** Only the pictures that the store can find; none without a store. */
function showable(kit: ViewerKit, pics: ViewerPicture[]): ViewerPicture[] {
	const store = kit.pictures;
	return store ? pics.filter((p) => store.resolve(p.link, kit.sourcePath ?? '').ok) : [];
}

/** The picture to start with: the arms when the arms mark was tapped (or `want` says arms), else the portrait; else the first that exists. */
function startFor(anchor: HTMLElement | null, pics: ViewerPicture[], want?: ViewerPicture['kind']): number {
	const kind = want ?? (anchor?.hasClass('dynasty-arms-mark') ? 'arms' : 'portrait');
	return Math.max(0, pics.findIndex((p) => p.kind === kind));
}

function open(kit: ViewerKit, pics: ViewerPicture[], anchor: HTMLElement | null, want?: ViewerPicture['kind']): void {
	if (!kit.pictures || pics.length === 0) return;
	openPictureViewer({ app: kit.app, store: kit.pictures, sourcePath: kit.sourcePath ?? '', pictures: pics, start: startFor(anchor, pics, want), opener: anchor });
}

/** What a window asks for must not throw: a failure is logged and the window gets no viewer (spec §8). */
function safely<T>(fn: () => T, fallback: T): T {
	try {
		return fn();
	} catch (e) {
		console.error('Crown and Kin: cannot prepare the picture viewer', e);
		return fallback;
	}
}

/** A tap on a picture of a person window that cannot change the note: the viewer opens at once. */
export function viewPerson(kit: PersonKit, anchor: HTMLElement): void {
	const pics = safely(() => showable(kit, personPictures(kit)), []);
	safely(() => open(kit, pics, anchor), undefined);
}

/**
 * A tap on a card of a tree that cannot change the note (a tree shown from another note, a Canvas card, a hover preview; D269): the viewer opens at once with the
 * pictures of the person as the card shows them. It reads the person from the tree, so it needs no block handle. A card with no picture that can show does nothing.
 * `want` is the picture under the finger: the arms on the card start the viewer on the arms.
 */
export function viewCard(kit: ViewerKit & { g: FamilyGraph; person: Person }, anchor: HTMLElement | null, want?: ViewerPicture['kind']): void {
	const p = kit.person;
	const draft = { name: p.name, portrait: p.portrait ?? '', arms: p.arms ?? '', house: p.house ?? '', title: p.title ?? '', born: p.born ?? '', died: p.died ?? '' };
	const pics = safely(() => showable(kit, personPictures({ ...kit, draft })), []);
	safely(() => open(kit, pics, anchor, want), undefined);
}

/** The first items of the picture menu of a person window: "View portrait" or "View arms", and a line. None when nothing can show. */
export function personViewItems(kit: PersonKit, anchor: HTMLElement): (MenuEntry | 'sep')[] {
	return safely(() => menuItems(kit, showable(kit, personPictures(kit)), anchor), []);
}

/** The first items of the arms menu of a house page. */
export function houseViewItems(kit: HouseKit, anchor: HTMLElement): (MenuEntry | 'sep')[] {
	return safely(() => menuItems(kit, showable(kit, housePictures(kit)), anchor), []);
}

function menuItems(kit: ViewerKit, pics: ViewerPicture[], anchor: HTMLElement): (MenuEntry | 'sep')[] {
	const first = pics[startFor(anchor, pics)];
	if (!first) return [];
	return [{ icon: 'eye', label: first.kind === 'portrait' ? VIEWER_UI.viewPortrait : VIEWER_UI.viewArms, run: () => open(kit, pics, anchor) }, 'sep'];
}
