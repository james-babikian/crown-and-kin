/*
 * The DOM of the phone list (D144, contract C.3.1): the family of one person as a list of rows that a thumb can
 * tap. `src/view/phone-list.ts` works out WHAT the list holds (`ListData`, from the pure `listData`); this file
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
 * - Pictures (D209, D213): a row makes a picture place only for a picture it has (`spec.has`; without it, from the data), so a row with no picture is
 *   a whole row and has no empty disc. `spec.pictures(slots, id)` runs for each row with the places it made. The centre row has a column at the right with
 *   the portrait (56 px) and the arms under it (35 px; 56 px with no portrait); every other row has a 36 px portrait at the right and no arms. The caller
 *   loads small copies and puts each one in with `showListPicture(slot, url)`.
 * - 0.2.8 (D209, D210): the order is the person at the top (with a heading for a screen reader only), Parents, Partners, Children. A heading follows
 *   the count of its rows; "With <partner>" shows only when there is more than one group of children. The other rows have a 3 px house strip. A text line
 *   of items ("Adoptive father · 1102–1161") is a joined text line; its first item can be the kind of link (`spec.link`, D210).
 * - Test hooks (class names): `.dynasty-list-section[data-section]`, `.dynasty-list-head`, `.dynasty-list-sub`,
 *   `.dynasty-list-row[data-person]`, `.dynasty-list-me`, `.dynasty-has-house`, `.dynasty-list-go`, `.dynasty-list-edit`.
 *
 * Rules kept here: no `ul`, `li` or `h1` to `h6` (the note's own CSS styles them), only `div` with ARIA roles; no colour
 * in code (a house colour goes only into the custom property `--dynasty-house-color`; spec §5.8); the pictures are
 * not part of the accessible name. A button has no `aria-label` (Obsidian shows a tooltip for it): its name is a text for a screen reader only (`dynasty-sr-only`), and the visible parts are `aria-hidden`.
 * A picture place that cannot fill (the file is missing for good, or the store has no copy) is taken out of its row with `failListPicture`, and put back with `restoreListPictures`. The look is in the block "C: phone list" of `styles.css`.
 */

import type { FamilyGraph } from '../../core/derive';
import { quote } from '../../core/quote';
import { cardLabels, needsLabels, type CardLabel } from '../../core/titles';
import type { ParentType } from '../../core/types';
import { isColour } from '../colour-check';
import { joined, nb } from '../text-join';
import { dateLine, shownReign } from '../tree-info';
import { PHONE_LIST_UI } from '../ui-text';
import type { IconFn } from './widgets';

/** One row of the list: a person and why the person is in this section. */
export interface ListRow {
	id: string;
	role: 'parent' | 'centre' | 'partner' | 'child';
	/** The kind of link between the person at the top and this parent or child (birth, adoptive, ward, rumoured); absent for the centre and a partner. */
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
	/** Bold in the text colour: "You" and the place in a line of succession (D209). */
	strong?: boolean;
}

/** The picture places that a row made, empty until the caller puts a copy in. A row makes only the places for pictures it has. */
export interface ListPictureSlots {
	arms?: HTMLElement;
	portrait?: HTMLElement;
}

/** Everything `buildPhoneList` needs. */
export interface PhoneListSpec {
	g: FamilyGraph;
	data: ListData;
	/** The marked person, or null. The centre section says "You" only when it is this person. */
	me: string | null;
	showDates: boolean;
	/** "Show portraits on cards": a row makes its portrait place only when it is on and the person has a portrait. */
	showPortraits?: boolean;
	/** False in a read-only tree: no pencil, and the centre button does nothing. */
	editable: boolean;
	/** The relation word of a person, or null (no mark, no word). */
	word(id: string): ListWord | null;
	/** D210: the kind of parent or child link of a row, seen from the person at the top; null for a plain birth link. */
	link?(row: ListRow): ListWord | null;
	/** The pictures that a person has, so that the row makes its picture places at once (no shift when a copy arrives). */
	has?(id: string): { portrait: boolean; arms: boolean };
	/** The card labels of the tree; when absent they are worked out here. */
	labels?: ReadonlyMap<string, CardLabel> | undefined;
	/** Called once for each row, so the caller can load the pictures. */
	pictures?(slots: ListPictureSlots, id: string): void;
	/** Obsidian's `setIcon`, passed by the shell (this layer does not import `obsidian`). */
	icon: IconFn;
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

/** True when the click came from a finger or a pen (a key press or a mouse is not a tap). */
function fromTouch(e: Event): boolean {
	const type = (e as Partial<PointerEvent>).pointerType;
	return type === 'touch' || type === 'pen';
}

/** Puts a small picture copy into a slot of a row. A row that made no place for the picture (the person has none) gives no slot, and nothing happens. */
export function showListPicture(slot: HTMLElement | undefined, url: string): void {
	if (!slot) return;
	slot.createEl('img', { cls: 'dynasty-picture', attr: { src: url, alt: '' } });
	slot.addClass('has-picture');
}

/** What `failListPicture` took out, in the order it took it, so that `restoreListPictures` can put it back. */
const taken = new WeakMap<HTMLElement, Array<() => void>>();

function indexIn(parent: HTMLElement, child: HTMLElement): number {
	return Array.from(parent.children).indexOf(child);
}

function putAt(parent: HTMLElement, child: HTMLElement, at: number): void {
	parent.insertBefore(child, (parent.children[at] as HTMLElement | undefined) ?? null);
}

/**
 * A picture that cannot show (the file is missing for good, or the store has no copy) leaves no empty place in its row (D213): the slot goes out of the row,
 * with its holder when it was the last one, and the large row loses `has-column` when no column is left. `restoreListPictures` undoes it.
 */
export function failListPicture(slot: HTMLElement | undefined): void {
	const holder = slot?.parentElement;
	const owner = holder?.parentElement;
	const row = slot?.closest<HTMLElement>('.dynasty-list-row');
	if (!slot || !holder || !owner || !row) return;
	const slotAt = indexIn(holder, slot);
	const hero = holder.hasClass('dynasty-hero-col');
	slot.addClass('is-failed');
	slot.remove();
	let holderAt = -1;
	if (!holder.children.length) {
		holderAt = indexIn(owner, holder);
		holder.remove();
	}
	if (hero) {
		holder.toggleClass('no-portrait', !holder.querySelector('.dynasty-hero-portrait'));
		if (holderAt >= 0) owner.removeClass('has-column');
	}
	const list = taken.get(row) ?? [];
	list.push(() => {
		if (holderAt >= 0) putAt(owner, holder, holderAt);
		putAt(holder, slot, slotAt);
		slot.removeClass('is-failed');
		if (hero) {
			holder.toggleClass('no-portrait', !holder.querySelector('.dynasty-hero-portrait'));
			owner.addClass('has-column');
		}
	});
	taken.set(row, list);
}

/** Puts back every picture place that `failListPicture` took out of the row (the pictures are asked for again: a file came, or changed). */
export function restoreListPictures(row: HTMLElement): void {
	const list = taken.get(row);
	if (!list) return;
	taken.delete(row);
	for (const undo of list.reverse()) undo();
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
		spec.icon(close.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'x');
		close.addEventListener('click', () => bar.onClose());
	}

	const section = (kind: 'parents' | 'person' | 'partners' | 'children', title: string) => {
		const el = list.createDiv({ cls: 'dynasty-list-section', attr: { 'data-section': kind } });
		const head = el.createDiv({ cls: 'dynasty-list-head', attr: { role: 'heading', 'aria-level': '3', tabindex: '-1' }, text: title });
		return { el, head };
	};

	const aboutYou = data.centre === me;
	const has = (id: string) => {
		if (spec.has) return spec.has(id);
		const p = g.byId.get(id)!;
		const arms = p.arms ?? (p.house !== undefined ? g.houses.get(p.house)?.arms : undefined);
		return { portrait: spec.showPortraits !== false && !!p.portrait, arms: id === data.centre && !!arms };
	};

	const content = (into: HTMLElement, id: string, word: ListWord | null, link: ListWord | null, large: boolean) => {
		const p = g.byId.get(id)!;
		const label = labels?.get(id);
		if (!large) into.createSpan({ cls: 'dynasty-list-strip', attr: { 'aria-hidden': 'true' } });
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
		const years = spec.showDates ? dateLine(p, g.dates) : undefined;
		const title = label?.title ?? p.title;
		// D210: in a list about You the kind of link takes the place of the relation word. A strong word ("You", a place in the line) stays.
		const shown = link && aboutYou && id !== me && !word?.strong ? null : word;
		// The title is a text line of its own in the large row (with its reign, G.2: the reign never breaks), and a part of the joined text line elsewhere.
		const parts = [
			link ? createSpan({ cls: 'dynasty-list-link', text: link.text }) : null,
			shown ? createSpan({ cls: ['dynasty-list-word', ...(shown.strong ? ['is-strong'] : [])], text: shown.text }) : null,
			years ? createSpan({ cls: 'dynasty-list-years', text: years }) : null,
			!large && title ? createSpan({ cls: 'dynasty-list-title', text: title }) : null,
		];
		if (parts.some(Boolean)) joined(text, 'dynasty-list-meta', parts, 'span');
		if (large && title) {
			const reign = spec.showDates ? shownReign(label, g.dates, 'shown') : undefined;
			text.createSpan({ cls: 'dynasty-list-title dynasty-hero-title', text: nb(reign ? `${title} ${reign}` : title) });
		}
		// D213: a place for a picture only when the person has one; no initials disc, no empty ring.
		const pic = has(id);
		const slots: ListPictureSlots = {};
		if (large) {
			if (pic.portrait || pic.arms) {
				const col = into.createSpan({ cls: ['dynasty-hero-col', ...(pic.portrait ? [] : ['no-portrait'])], attr: { 'aria-hidden': 'true' } });
				if (pic.portrait) slots.portrait = col.createSpan({ cls: 'dynasty-hero-portrait' });
				if (pic.arms) slots.arms = col.createSpan({ cls: 'dynasty-hero-arms' });
			}
		} else if (pic.portrait) {
			slots.portrait = into.createSpan({ cls: 'dynasty-list-pics', attr: { 'aria-hidden': 'true' } }).createSpan({ cls: 'dynasty-list-portrait' });
		}
		return { slots, shown };
	};

	// An aria-label makes Obsidian show a tooltip over the row. A text for a screen reader only gives the name, and the visible parts are hidden from it.
	const nameBy = (button: HTMLElement, name: string) => {
		for (const part of Array.from(button.children) as HTMLElement[]) if (!part.hasClass('dynasty-list-edit-icon')) part.setAttribute('aria-hidden', 'true');
		button.createSpan({ cls: 'dynasty-sr-only', text: name });
	};

	const row = (into: HTMLElement, r: ListRow) => {
		const p = g.byId.get(r.id);
		if (!p) return;
		rows++;
		const centre = r.role === 'centre';
		const word = spec.word(r.id);
		const link = centre ? null : (spec.link?.(r) ?? null);
		const el = into.createDiv({ cls: ['dynasty-list-row', ...(centre ? ['dynasty-list-hero'] : []), ...(r.id === me ? ['dynasty-list-me'] : [])], attr: { role: 'group', 'data-person': r.id } });
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
			const whole = el.createEl('button', { cls: ['dynasty-list-edit', 'dynasty-list-whole'], attr: { type: 'button' } });
			slots = content(whole, r.id, word, null, true).slots;
			nameBy(whole, PHONE_LIST_UI.editLabel(display));
			// The picture column starts level with the first text line of the name, so the text stands at the top only when there is a column.
			if (slots.portrait || slots.arms) whole.addClass('has-column');
			spec.icon(whole.createSpan({ cls: 'dynasty-list-edit-icon', attr: { 'aria-hidden': 'true' } }), 'pencil');
			whole.addEventListener('click', (e) => {
				if (!list.hasClass('is-read-only')) spec.onEdit(r.id, fromTouch(e));
			});
		} else {
			const go = el.createEl('button', { cls: 'dynasty-list-go', attr: { type: 'button' } });
			const made = content(go, r.id, word, link, false);
			slots = made.slots;
			// D210: the accessible name says the kind of link ("Aldric Valmont, guardian of Piers Orsini, your grandfather. Show the family of Aldric Valmont.").
			nameBy(go, PHONE_LIST_UI.goLabel(display, made.shown?.lower, link ? { lower: link.lower, of: nameOf(data.centre) } : undefined, { you: r.id === me, place: !!made.shown?.strong && made.shown.lower !== PHONE_LIST_UI.you.toLowerCase() }));
			go.addEventListener('click', () => spec.onGo(r.id));
			const edit = el.createEl('button', { cls: 'dynasty-list-edit', attr: { type: 'button' } });
			spec.icon(edit.createSpan({ cls: 'dynasty-list-edit-icon', attr: { 'aria-hidden': 'true' } }), 'pencil');
			nameBy(edit, PHONE_LIST_UI.editLabel(display));
			edit.addEventListener('click', (e) => {
				if (!list.hasClass('is-read-only')) spec.onEdit(r.id, fromTouch(e));
			});
		}
		spec.pictures?.(slots, r.id);
	};

	// D209 item 2: the person at the top. Its heading is for a screen reader only (the large row says who it is).
	const person = section('person', aboutYou ? PHONE_LIST_UI.headYou : PHONE_LIST_UI.headPerson);
	row(person.el, data.person[0]);
	if (data.parents.length) {
		const s = section('parents', data.parents.length === 1 ? PHONE_LIST_UI.headParent : PHONE_LIST_UI.headParents);
		for (const r of data.parents) row(s.el, r);
	}
	const partners = data.person.slice(1);
	if (partners.length) {
		const s = section('partners', partners.length === 1 ? PHONE_LIST_UI.headPartner : PHONE_LIST_UI.headPartners);
		for (const r of partners) row(s.el, r);
	}
	const groups = data.groups.filter((gr) => gr.rows.length);
	if (groups.length) {
		const count = groups.reduce((n, gr) => n + gr.rows.length, 0);
		const s = section('children', count === 1 ? PHONE_LIST_UI.headChild : PHONE_LIST_UI.headChildren);
		for (const gr of groups) {
			// D209 item 7: a group heading only tells the groups apart.
			if (gr.heading && groups.length > 1) s.el.createDiv({ cls: 'dynasty-list-sub', attr: { role: 'heading', 'aria-level': '4' }, text: subHeading(spec, gr.heading) });
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
	return PHONE_LIST_UI.withPartner(partner ? partner.name : h.partner);
}
