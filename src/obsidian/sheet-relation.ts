/*
 * The relation to the marked person at the top of the edit sheet (spec §13.1, D146, D147). On a computer it is a box in
 * the free area right of the portrait buttons. On a phone it is a strip under the header that opens to the other
 * relations and the button Show the line. The edit sheet decides which one to draw (the class `is-phone`) and passes a
 * `RelationView`; this file only draws it. The texts come from `RelationInfo` in `src/render/tree-info.ts`.
 */

import { setIcon } from 'obsidian';
import { RELINFO, type RelationInfo } from '../render/tree-info';

/** What the box and the strip show for one person: the texts, and a function that adds the button Show the line (absent when there is none). */
export interface RelationView extends RelationInfo {
	addLineButton?: (parent: HTMLElement) => void;
}

/**
 * Whether the strip is open. One object for all sheets while Obsidian runs (D147): a build and the next sheet read it,
 * a tap sets it. It is never written to a file, so it starts closed when the plugin loads.
 */
export const relationStrip: { open: boolean } = { open: false };

/** A short random suffix for the id of the open part, in the same way as the dialog title id. */
const randomId = () => Math.random().toString(36).slice(2, 8);

/** The text lines under the value: "Also: ...", the D123 paragraph, then the button. */
function extras(parent: HTMLElement, v: RelationView): void {
	if (v.also) parent.createDiv({ cls: 'dynasty-relinfo-also', text: v.also });
	if (v.maybe) parent.createDiv({ cls: ['dynasty-relinfo-also', 'dynasty-relinfo-maybe'], text: v.maybe });
	v.addLineButton?.(parent);
}

/** The computer look (E.3.2): title, value, "Also", the D123 paragraph and the button, in a box. The caller puts it last in the portrait row. */
export function renderRelationBox(parent: HTMLElement, v: RelationView): HTMLElement {
	const box = parent.createDiv({ cls: ['dynasty-relinfo', 'dynasty-relinfo-box'] });
	if (v.kind === 'me') box.addClass('is-me');
	if (v.kind === 'none') box.addClass('is-none');
	if (v.title) box.createDiv({ cls: 'dynasty-relinfo-title', text: v.title });
	box.createDiv({ cls: 'dynasty-relinfo-value', text: v.value });
	extras(box, v);
	return box;
}

/**
 * The phone look (E.3.3): the strip. It adds the strip at the end of `parent`, so the caller makes it the first child of
 * the sheet body. A strip with nothing to open (the marked person, or no other text and no button) is a plain `div`.
 * `ids` makes the suffix of the id that links the head to the open part; a test can fix it.
 */
export function renderRelationStrip(parent: HTMLElement, v: RelationView, ids: () => string = randomId): HTMLElement {
	const strip = parent.createDiv({ cls: ['dynasty-relinfo', 'dynasty-relinfo-strip'] });
	const hasMore = !!v.also || !!v.maybe || !!v.addLineButton;
	const openable = v.kind !== 'me' && hasMore;
	if (!openable) {
		strip.addClass('is-static');
		const head = strip.createDiv({ cls: 'dynasty-relinfo-head' });
		head.createSpan({ cls: 'dynasty-relinfo-text', text: v.sentence });
		if (v.others > 0) head.createSpan({ cls: 'dynasty-relinfo-count', text: RELINFO.more(v.others) });
		return strip;
	}
	const id = `dynasty-relinfo-more-${ids()}`;
	// The label holds the visible text word for word (WCAG 2.5.3), so voice control finds the head by what it shows.
	const head = strip.createEl('button', {
		cls: 'dynasty-relinfo-head',
		attr: { type: 'button', 'aria-expanded': String(relationStrip.open), 'aria-controls': id, 'aria-label': RELINFO.stripLabel(v.sentence, v.others), 'data-focus': 'relinfo' },
	});
	head.createSpan({ cls: 'dynasty-relinfo-text', text: v.sentence });
	if (v.others > 0) head.createSpan({ cls: 'dynasty-relinfo-count', text: RELINFO.more(v.others) });
	const icon = head.createSpan({ cls: 'dynasty-relinfo-icon', attr: { 'aria-hidden': 'true' } });
	// The open part stays in the page when it is closed, so `aria-controls` always points at an element.
	const more = strip.createDiv({ cls: 'dynasty-relinfo-more', attr: { id } });
	extras(more, v);
	const paint = () => {
		head.setAttribute('aria-expanded', String(relationStrip.open));
		more.toggle(relationStrip.open);
		icon.empty();
		setIcon(icon, relationStrip.open ? 'chevron-up' : 'chevron-down');
		strip.toggleClass('is-open', relationStrip.open);
	};
	head.addEventListener('click', () => {
		relationStrip.open = !relationStrip.open;
		paint();
	});
	paint();
	return strip;
}
