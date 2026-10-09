/*
 * The DOM of the phone list (D144, contract C.3.1): the family of one person as a list of rows that a thumb can
 * tap. `src/obsidian/phone-list.ts` works out WHAT the list holds (`ListData`, from the pure `listData`); this file
 * only builds it. The tree view (WP-C2b) calls `buildPhoneList` into the viewport, after the toolbar, and keeps the
 * result. Nothing in here reads the settings or the note: the caller passes in what it needs and the two actions.
 *
 * How the caller wires it:
 * - `buildPhoneList(parent, spec)` builds `.dynasty-list` (role region) and returns `{ rows, centre, list }`. `centre`
 *   is the heading of the centre section (`tabindex="-1"`): give it the focus after a move so a screen reader says it.
 * - A tap on a name (`button.dynasty-list-go`) calls `spec.onGo(id)`: move the list. A tap on a pencil
 *   (`button.dynasty-list-edit`) calls `spec.onEdit(id, fromTap)`: open the edit sheet. The centre row has ONE button,
 *   `button.dynasty-list-edit.dynasty-list-whole`, that covers the row and edits (moving to the same person would
 *   do nothing). `fromTap` is true when the click came from a finger or a pen, for the sheet's ghost-click guard.
 * - `setListEditable(list, on)` hides the pencils and makes the centre button inert (read-only trees). The caller runs
 *   it from `updateEditUi`; `spec.editable` is the starting state.
 * - Pictures: `spec.pictures(slots, id)` runs for each row with two empty slots (`arms` 28 x 34 px, `portrait` 40 x 40 px).
 *   The caller loads small copies and puts each one in with `showListPicture(slot, url)`.
 * - Test hooks (class names): `.dynasty-list-section[data-section]`, `.dynasty-list-head`, `.dynasty-list-sub`,
 *   `.dynasty-list-row[data-person]`, `.dynasty-list-me`, `.dynasty-has-house`, `.dynasty-list-go`, `.dynasty-list-edit`.
 *
 * Rules kept here: no `ul`, `li` or `h1` to `h6` (the note's own CSS styles them), only `div` with ARIA roles; no colour
 * in code (a house colour goes only into the custom property `--dynasty-house-color`; spec §5.8); the pictures are
 * not part of the accessible name. The look is in the block "C: phone list" of `styles.css`.
 */

import { setIcon } from 'obsidian';
import type { FamilyGraph } from '../../core/derive';
import { quote } from '../../core/quote';
import { cardLabels, needsLabels, type CardLabel } from '../../core/titles';
import type { ParentType } from '../../core/types';
import { dateLine } from '../tree-info';
import { PHONE_LIST_UI } from '../ui-text';

/** One row of the list: a person and why the person is in this section. */
export interface ListRow {
	id: string;
	role: 'parent' | 'centre' | 'partner' | 'child';
	/** The kind of parent link that puts a parent or a child here (birth, adoptive, ward, rumoured); absent for the centre and a partner. */
	link?: ParentType;
}

/** The sub-heading of a group of children: a partnership, children with no listed partner, or children of a side link only. */
export type ListHeading = { kind: 'partner'; partner: string } | { kind: 'solo' } | { kind: 'other' };

/** The children of one partnership (or of none); `heading` is null when the centre has no partnership at all. */
export interface ListGroup {
	heading: ListHeading | null;
	rows: ListRow[];
}

/** What the list holds, in the order it shows it. */
export interface ListData {
	centre: string;
	parents: ListRow[];
	/** The centre first, then each partner once in union order. */
	person: ListRow[];
	groups: ListGroup[];
}

/** The relation word of a row: the text on the row, and the lower-case phrase that the accessible name speaks. */
export interface ListWord {
	text: string;
	lower: string;
}

/** The two picture places of a row, empty until the caller puts a copy in. */
export interface ListPictureSlots {
	arms: HTMLElement;
	portrait: HTMLElement;
}

/** Everything `buildPhoneList` needs. */
export interface PhoneListSpec {
	g: FamilyGraph;
	data: ListData;
	/** The marked person, or null. The centre section says "You" only when it is this person. */
	me: string | null;
	showDates: boolean;
	/** False in a read-only tree: no pencil, and the centre button does nothing. */
	editable: boolean;
	/** The relation word of a person, or null (no mark, no word). */
	word(id: string): ListWord | null;
	/** The card labels of the tree; when absent they are worked out here. */
	labels?: ReadonlyMap<string, CardLabel> | undefined;
	/** Called once for each row, so the caller can load the pictures. */
	pictures?(slots: ListPictureSlots, id: string): void;
	onGo(id: string): void;
	onEdit(id: string, fromTap: boolean): void;
	/** 0.2.7 F.6: while the Show view of a line of succession is open, the bar at the top of the list: the sentence and an icon-only Close (D182). */
	bar?: { sentence: string; closeLabel: string; onClose(): void };
}

/** What `buildPhoneList` gives back. */
export interface PhoneListResult {
	rows: number;
	/** The heading of the centre section, which takes the focus after a move. */
	centre: HTMLElement;
	list: HTMLElement;
}

function isColour(value: string | undefined): value is string {
	if (!value) return false;
	try {
		return CSS.supports('color', value);
	} catch {
		return false;
	}
}

/** True when the click came from a finger or a pen (a key press or a mouse is not a tap). */
function fromTouch(e: Event): boolean {
	const type = (e as Partial<PointerEvent>).pointerType;
	return type === 'touch' || type === 'pen';
}

/** Puts a small picture copy into a slot of a row. */
export function showListPicture(slot: HTMLElement, url: string): void {
	slot.createEl('img', { cls: 'dynasty-picture', attr: { src: url, alt: '' } });
	slot.addClass('has-picture');
}

/** Makes a built list editable or read-only: hides the pencils and makes the centre button inert. */
export function setListEditable(list: HTMLElement, editable: boolean): void {
	list.toggleClass('is-read-only', !editable);
	for (const b of Array.from(list.querySelectorAll<HTMLElement>('.dynasty-list-edit'))) {
		if (b.hasClass('dynasty-list-whole')) {
			(b as HTMLButtonElement).disabled = !editable;
			b.setAttribute('aria-disabled', editable ? 'false' : 'true');
		} else b.toggle(editable);
	}
}

/** Builds the list into `parent` (the viewport, after the toolbar) and returns the row count and the heading to focus. */
export function buildPhoneList(parent: HTMLElement, spec: PhoneListSpec): PhoneListResult {
	const { g, data, me } = spec;
	const labels: ReadonlyMap<string, CardLabel> | undefined = spec.labels ?? (needsLabels(g) ? cardLabels(g) : undefined);
	const nameOf = (id: string): string => labels?.get(id)?.name ?? g.byId.get(id)?.name ?? id;
	const list = parent.createDiv({ cls: 'dynasty-list', attr: { role: 'region', 'aria-label': PHONE_LIST_UI.region(nameOf(data.centre)) } });
	let rows = 0;

	if (spec.bar) {
		const bar = spec.bar;
		const el = list.createDiv({ cls: 'dynasty-succession-bar dynasty-list-succession', attr: { role: 'group' } });
		el.createDiv({ cls: 'dynasty-succession-text', text: bar.sentence });
		// D182: an icon with an aria-label, 44 px; the sentence is the visible text.
		const close = el.createEl('button', { cls: ['clickable-icon', 'dynasty-succession-close', 'dynasty-succession-close-icon'], attr: { type: 'button', 'aria-label': bar.closeLabel } });
		setIcon(close.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'x');
		close.addEventListener('click', () => bar.onClose());
	}

	const section = (kind: 'parents' | 'person' | 'children', title: string) => {
		const el = list.createDiv({ cls: 'dynasty-list-section', attr: { 'data-section': kind } });
		const head = el.createDiv({ cls: 'dynasty-list-head', attr: { role: 'heading', 'aria-level': '3', tabindex: '-1' }, text: title });
		return { el, head };
	};

	const content = (into: HTMLElement, id: string, word: ListWord | null) => {
		const p = g.byId.get(id)!;
		const label = labels?.get(id);
		into.createSpan({ cls: 'dynasty-list-strip', attr: { 'aria-hidden': 'true' } });
		// Spans, not divs: a button holds only inline content. The CSS makes them blocks.
		const text = into.createSpan({ cls: 'dynasty-list-text' });
		const name = text.createSpan({ cls: 'dynasty-list-name' });
		name.appendText(nameOf(id));
		const sob = label?.sobriquet ?? p.sobriquet;
		if (sob) {
			// The space is outside the span: it is the only place where the line can break, so the sobriquet moves whole (D173 item 2).
			name.appendText(' ');
			name.createSpan({ cls: 'dynasty-list-sob', text: quote(sob) });
		}
		const years = spec.showDates ? dateLine(p) : undefined;
		if (word || years) {
			const meta = text.createSpan({ cls: 'dynasty-list-meta' });
			if (word) meta.createSpan({ cls: 'dynasty-list-word', text: word.text });
			if (years) meta.createSpan({ cls: 'dynasty-list-years', text: `${word ? ' · ' : ''}${years}` });
		}
		const title = label?.title ?? p.title;
		if (title) text.createSpan({ cls: 'dynasty-list-title', text: title });
		const pics = into.createSpan({ cls: 'dynasty-list-pics', attr: { 'aria-hidden': 'true' } });
		return { arms: pics.createSpan({ cls: 'dynasty-list-arms' }), portrait: pics.createSpan({ cls: 'dynasty-list-portrait' }) };
	};

	const row = (into: HTMLElement, r: ListRow) => {
		const p = g.byId.get(r.id);
		if (!p) return;
		rows++;
		const centre = r.role === 'centre';
		const word = spec.word(r.id);
		const el = into.createDiv({ cls: ['dynasty-list-row', ...(r.id === me ? ['dynasty-list-me'] : [])], attr: { role: 'group', 'data-person': r.id } });
		// A hook for the tests and the harness; nothing shows it yet.
		if (r.link && r.link !== 'birth') el.setAttribute('data-link', r.link);
		const house = p.house ? g.houses.get(p.house)?.color : undefined;
		if (isColour(house)) {
			el.style.setProperty('--dynasty-house-color', house);
			el.addClass('dynasty-has-house');
		}
		const display = nameOf(r.id);
		let slots: ListPictureSlots;
		if (centre) {
			// The centre person is already in the middle, so the one button edits.
			const whole = el.createEl('button', { cls: ['dynasty-list-edit', 'dynasty-list-whole'], attr: { type: 'button', 'aria-label': PHONE_LIST_UI.editLabel(display) } });
			slots = content(whole, r.id, word);
			setIcon(whole.createSpan({ cls: 'dynasty-list-edit-icon', attr: { 'aria-hidden': 'true' } }), 'pencil');
			whole.addEventListener('click', (e) => {
				if (!list.hasClass('is-read-only')) spec.onEdit(r.id, fromTouch(e));
			});
		} else {
			const go = el.createEl('button', { cls: 'dynasty-list-go', attr: { type: 'button', 'aria-label': PHONE_LIST_UI.goLabel(display, word?.lower) } });
			slots = content(go, r.id, word);
			go.addEventListener('click', () => spec.onGo(r.id));
			const edit = el.createEl('button', { cls: 'dynasty-list-edit', attr: { type: 'button', 'aria-label': PHONE_LIST_UI.editLabel(display) } });
			setIcon(edit.createSpan({ cls: 'dynasty-list-edit-icon', attr: { 'aria-hidden': 'true' } }), 'pencil');
			edit.addEventListener('click', (e) => {
				if (!list.hasClass('is-read-only')) spec.onEdit(r.id, fromTouch(e));
			});
		}
		spec.pictures?.(slots, r.id);
	};

	if (data.parents.length) {
		const s = section('parents', PHONE_LIST_UI.headParents);
		for (const r of data.parents) row(s.el, r);
	}
	const person = section('person', data.centre === me ? PHONE_LIST_UI.headYou : PHONE_LIST_UI.headPerson);
	for (const r of data.person) row(person.el, r);
	if (data.groups.some((gr) => gr.rows.length)) {
		const s = section('children', PHONE_LIST_UI.headChildren);
		for (const gr of data.groups) {
			if (!gr.rows.length) continue;
			if (gr.heading) s.el.createDiv({ cls: 'dynasty-list-sub', attr: { role: 'heading', 'aria-level': '4' }, text: subHeading(spec, gr.heading) });
			for (const r of gr.rows) row(s.el, r);
		}
	}
	setListEditable(list, spec.editable);
	return { rows, centre: person.head, list };
}

/** The text of the sub-heading of a group of children. */
function subHeading(spec: PhoneListSpec, h: ListHeading): string {
	if (h.kind === 'solo') return PHONE_LIST_UI.noPartner;
	if (h.kind === 'other') return PHONE_LIST_UI.otherChildren;
	const partner = spec.g.byId.get(h.partner);
	return PHONE_LIST_UI.withPartner(partner ? partner.name : h.partner, partner && spec.showDates ? dateLine(partner) : undefined);
}
