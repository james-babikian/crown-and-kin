/*
 * The edit sheet (spec §6.3 fields, family, actions and commit model; §7.4 phone layout). Field
 * edits are a draft: Save writes once, only the changed fields; Cancel discards; any other way to
 * close asks first. A relationship action writes the draft in the same write. A new person is a
 * draft too: a sheet for them writes the person and the relationship together, on Save only.
 * The sheet reads the block from its handle, never from the rendered view, which the write replaces.
 * The Titles section (spec §13.4) is in `sheet-titles.ts`; its actions write like the relationship actions.
 * The portrait (spec §13.7) is a draft field too: a larger round picture at the top, with Select
 * portrait (the picture picker) and Remove portrait; its picture is a copy that the picture store
 * does not keep, released when the sheet closes. Select the part (spec §13.13) opens the crop tool
 * (`crop-tool.ts`); the part is the draft field `portraitCrop`, and the round picture shows it.
 *
 * Reading guide, top to bottom:
 * - Helpers above the class: loading the sheet's data (`loadSheet`), the draft shape, id and
 *   partnership lookup helpers used when a write gives a person their first id.
 * - `EditSheet`: state, then the sections marked with `// ---------- ... ----------` comments:
 *   building the form (fields, house, family, actions, delete), writes (the write itself, the
 *   relationship-action write, Save, reload after a write), and the confirm/error messages.
 */

import { Modal, Notice, setIcon, type App, type TFile } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { deriveDated, readerOfTree, type DatesFor } from '../view/calendar-index';
import { attachDateLine } from '../render/dom/date-line';
import type { FieldValue, Op, ParentKind, PersonField, UnionKind, UnionRef } from '../core/edit';
import type { PersonFolds } from '../core/folds';
import { issueText } from '../core/messages';
import { pictureIssue } from '../core/pictures';
import { formatPortraitCrop, sameCropText } from '../core/portrait-crop';
import { nextPersonId } from '../core/id-gen';
import { newHouseId } from '../core/yaml-edit';
import { parseBody, readTree, referencedIds } from '../core/parse';
import { isMap, type Raw } from '../core/tolerate';
import { PARENT_LIMIT, PARENT_TYPES, PLACEMENT_TYPES, UNION_TYPES, type Person, type Tree } from '../core/types';
import { dateLine, linkTarget, relationInfo } from '../render/tree-info';
import { quotedSobriquet } from '../core/sobriquet';
import { joined, nb } from '../render/text-join';
import { FAMILY, FINDER_UI, FOCUS_UI, FOLD_UI, ME_UI, NEW_SHEET, NOTE_UI, PICTURES_UI, REMOVE, SHEET, UI, UNION_EDIT, UNION_TYPE_TEXT, WINDOW_UI, WRITE_TEXT, deleteText, parentTypeText, partnerDetail, unionTypeText } from '../render/ui-text';
import { linkedNotePath, personNoteName } from '../core/note-make';
import { makePersonNote, openMadeNote, type MakeNoteMode, type MakePersonNoteOutcome, type SameNameAnswer } from './make-note';
import { normBody } from '../core/block-match';
import { cardLabels, needsLabels } from '../core/titles';
import type { Handle, HandleWriteOutcome, Written } from './block-handle';
import type { ViewKind } from '../view/block-state';
import { describeDelete, familyOf, type FamilyView, type ParentLink, type PartnerLink } from '../core/family-query';
import type { RelationOptions } from '../core/relations';
import { openCropTool, startCropOf } from './crop-tool';
import { addChild, addParent, addPartner, autoUnionNotice, unionOp, type FlowHost, type NewRelation } from './family-flows';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { hasNoWrittenId, idsForPeople } from '../view/person-ids';
import { pickPerson, type PickerContext } from './person-picker';
import { currentPictureOf, pickPicture } from './picture-picker';
import type { PictureCopy, PictureStore } from './picture-store';
import { relationsFor, validMe } from '../view/relation-cache';
import { afterPaint, drawableColour, endEntryOnEnter, freshOrStale, nameDialog, onWriteFailed, sheetField, showErrorLine } from './sheet-parts';
import { renderRelationLine, type RelationView } from './sheet-relation';
import { titlesBody, titlesSummary, type TitlesHost } from './sheet-titles';
import { buildShell, type Shell } from './window-shell';
import { renderSections, type SectionsView, type SectionSpec } from './window-sections';
import { RowPictures, buildRow, iconButton, iconLead, personLead, showMenu, textButton, type MenuEntry } from './window-parts';
import { undoNotice } from './undo-notice';
import { personViewItems, viewPerson } from './viewer-sources';
import { editUnion } from './union-edit';
import { trackModal } from '../view/plugin-modals';

const TEXT_FIELDS = ['name', 'sobriquet', 'title', 'born', 'died', 'link', 'notes'] as const;
const NEW_HOUSE = '\u0000new';
/** Contract C (Q6H A): the round portrait of the header is 64 px across. */
export const SHEET_PORTRAIT_PX = 64;

interface Draft {
	name: string;
	/** D122: the model value, without the quote marks; the typed text is written as typed. */
	sobriquet: string;
	title: string;
	house: string;
	sex: string;
	born: string;
	died: string;
	illegitimate: boolean;
	/** M.5: the person died with no children (`childless`); the line of succession then shows no open branch for the person. */
	childless: boolean;
	link: string;
	/** Spec §13.7: the portrait link; '' = none. */
	portrait: string;
	/** Spec §13.13: the selected part of the portrait as written text; '' = none (the automatic part). */
	portraitCrop: string;
	/** 0.2.8 contract A.1: the personal arms link; '' = none. */
	arms: string;
	notes: string;
	placement: string;
}

interface Loaded {
	body: string;
	/** The body as plain data, for the id of a new house. */
	data: unknown;
	tree: Tree;
	g: FamilyGraph;
	/** The person; for a new person, a blank one that is not in the tree. */
	person: Person;
	/** Null for a new person. */
	fam: FamilyView | null;
	blocking: string[];
}

/** The result of `loadSheet`: the loaded data, an unparsable block, or the person is not in the tree. */
export type SheetLoad = { kind: 'ok'; data: Loaded } | { kind: 'invalid' } | { kind: 'gone' };

/** The new-house fields of a draft before the user types in them. */
const blankHouse = () => ({ name: '', color: '#888888' });

/** A person with no id and no fields, the starting point for a new-person draft. */
const blankPerson = (): Person => ({ id: '', name: '', parents: [], illegitimate: false, index: -1 });

/** The sheet's data for a person (or a new person, `id` null), or why there is none. */
export function loadSheet(body: string, id: string | null, dates?: DatesFor): SheetLoad {
	const parsed = parseBody(body);
	if (!parsed.ok) return { kind: 'invalid' };
	const tree = readTree(parsed.doc, parsed.data, body);
	const g = deriveDated(tree, dates);
	const person = id === null ? blankPerson() : g.byId.get(id);
	if (!person) return { kind: 'gone' };
	const blocking = g.issues.filter((i) => i.level === 'blocking').map(issueText);
	const fam = id === null ? null : familyOf(g, id);
	return { kind: 'ok', data: { body, data: parsed.data, tree, g, person, fam, blocking } };
}

function draftOf(l: Loaded): Draft {
	const p = l.person;
	return {
		name: p.name,
		sobriquet: p.sobriquet ?? '',
		title: p.title ?? '',
		house: p.house ?? '',
		sex: p.sex ?? '',
		born: p.born ?? '',
		died: p.died ?? '',
		illegitimate: p.illegitimate,
		childless: p.childless === true,
		link: p.link ?? '',
		portrait: p.portrait ?? '',
		portraitCrop: p.portraitCrop ?? '',
		arms: p.arms ?? '',
		notes: p.notes ?? '',
		placement: p.placement ?? (p.id ? l.g.placementType.get(p.id) : undefined) ?? '',
	};
}

/** Placement types the person has parents of (spec §4.3); an unknown parent type counts as birth. */
function placementChoices(p: Person): string[] {
	const out = new Set<string>();
	for (const ref of p.parents) {
		if (ref.type === 'rumoured') continue;
		out.add((PLACEMENT_TYPES as readonly string[]).includes(ref.type) ? ref.type : 'birth');
	}
	return PLACEMENT_TYPES.filter((t) => out.has(t));
}

/**
 * Finds a chosen partnership again in new data. The same index with the same text wins; else the
 * one union with the same text. Two unions of a couple can have the same text (a second
 * partnership with no id or dates), so several text matches are ambiguous: the user must choose.
 */
export function findUnion(candidates: UnionRef[], chosen: UnionRef): UnionRef | 'ambiguous' | null {
	const exact = candidates.find((u) => u.index === chosen.index && (chosen.text === undefined || u.text === chosen.text));
	if (exact) return exact;
	if (chosen.text === undefined) return null;
	const byText = candidates.filter((u) => u.text === chosen.text);
	if (byText.length > 1) return 'ambiguous';
	return byText[0] ?? null;
}

/** Keys of an op whose values never name a person. */
const NOT_IDS = new Set(['kind', 'fields', 'text', 'name', 'color', 'key', 'type', 'from', 'to', 'direction', 'map', 'start', 'end', 'people']);

/** A copy of `v` (ops, a relation) with every string that can name a person mapped by `f`. */
export function mapIds<T>(v: T, f: (id: string) => string, key = ''): T {
	if (NOT_IDS.has(key)) return v;
	if (typeof v === 'string') return f(v) as T;
	if (Array.isArray(v)) return v.map((x: unknown) => mapIds(x, f)) as T;
	if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapIds(x, f, k)])) as T;
	return v;
}

/** Every string of the ops that can name a person. */
function namesIn(ops: Op[]): string[] {
	const out: string[] = [];
	mapIds(ops, (s) => {
		out.push(s);
		return s;
	});
	return out;
}

/** True for a person with no written id (spec §8 warning): the tree names them `~N`, after their place in the list. */
function unwritten(l: Loaded, id: string): boolean {
	return hasNoWrittenId(l.g, l.data, id);
}

/**
 * The `~N` name of a person with no written id after the tree text changed (C2). `~N` follows the place
 * in the list, so an edit above the person (sync, another pane) makes `~N` another person. The person is
 * found by their written fields, else by their name; null when no one matches, or more than one, so the
 * sheet never shows or saves to another person.
 */
function sameUnwritten(was: Loaded, id: string, now: Loaded): string | null {
	const old = was.g.byId.get(id);
	const listOf = (l: Loaded): unknown[] | null => {
		const d = l.data as Raw;
		return isMap(d) && Array.isArray(d.people) ? d.people : null;
	};
	const text = (v: unknown): string | null => {
		try {
			return JSON.stringify(v) ?? null;
		} catch {
			return null;
		}
	};
	const before = listOf(was);
	const after = listOf(now);
	if (!old || !before || !after) return null;
	const oldText = text(before[old.index]);
	const candidates = now.g.people.filter((p) => unwritten(now, p.id));
	// Identical people cannot be told apart by their text: only the same place, with nothing changed above it, is certain.
	const unchangedAbove = text(before.slice(0, old.index)) === text(after.slice(0, old.index));
	const pick = (list: Person[]): string | null => (list.length === 1 ? list[0].id : unchangedAbove ? (list.find((p) => p.id === id)?.id ?? null) : null);
	const exact = oldText === null ? [] : candidates.filter((p) => text(after[p.index]) === oldText);
	if (exact.length) return pick(exact);
	return pick(candidates.filter((p) => p.name === old.name));
}

/** Every person id and reference written in the block, and `more`: a new id must be none of them. */
function takenIds(l: Loaded, more: Iterable<string> = []): Set<string> {
	const data = l.data as Raw;
	return new Set([...(isMap(data) ? referencedIds(data) : []), ...more]);
}

/**
 * New ids for the people in `names` that have no written id, before a write that names them. Their
 * `~N` follows their place in the list: a move or a new person above changes it, and a `~N` written
 * as a reference names nobody.
 */
function idsFor(l: Loaded, names: Iterable<string>): Map<string, string> {
	return idsForPeople(l.g, l.data, names);
}

type IdFields = Extract<Op, { kind: 'set-person-fields' }>['fields'] & { id?: string };

/** The ops of one write that first gives each person of `ids` their id, then names them by it. */
function withIds(ops: Op[], ids: ReadonlyMap<string, string>): Op[] {
	if (!ids.size) return ops;
	const give = [...ids].map(([id, next]): Op => ({ kind: 'set-person-fields', id, fields: { id: next } as IdFields }));
	return [...give, ...mapIds(ops, (s) => ids.get(s) ?? s).map((op) => holderPersons(op, ids))];
}

/** A holder's `person` sits in `fields`, which `mapIds` leaves alone (they hold names): it names a person too. */
function holderPersons(op: Op, ids: ReadonlyMap<string, string>): Op {
	if (op.kind === 'batch') return { ...op, ops: op.ops.map((o) => holderPersons(o, ids)) };
	if ((op.kind === 'add-holder' || op.kind === 'edit-holder') && typeof op.fields.person === 'string') {
		const next = ids.get(op.fields.person);
		if (next !== undefined) return { ...op, fields: { ...op.fields, person: next } };
	}
	return op;
}

/** Every string of the ops that can name a person, also a holder's `person` (see `holderPersons`). */
function holderNames(ops: Op[]): string[] {
	const out: string[] = [];
	for (const op of ops) {
		if (op.kind === 'batch') out.push(...holderNames(op.ops));
		else if ((op.kind === 'add-holder' || op.kind === 'edit-holder') && typeof op.fields.person === 'string') out.push(op.fields.person);
	}
	return out;
}

/** What the tree view gives the sheet for Hide descendants, Show descendants and the unfold after a write (F12, F15). */
export interface SheetFolds {
	/** 'live': a view that folds. 'preview': the static touch preview, which never shows folds (D85). */
	mode: 'live' | 'preview';
	/** The keys for this person now; in 'preview' computed without the fold state. */
	state(personId: string): PersonFolds;
	/** Folds every key of `state(id).open`; keeps the person's card in place. In 'preview': adds them to the block's folds and opens the full-screen view on the person. */
	hide(personId: string): void;
	/** Opens every key of `state(id).folded`; keeps the person's card in place. Not called in 'preview'. */
	show(personId: string): void;
	/** After each ok write: the sheet's person and the people the write added. */
	written(ids: readonly string[]): void;
}

interface SheetBase {
	handle: Handle;
	/** The name typed in the picker before "Create a new person". */
	initialName?: string;
	/** The sheet that started this one: its draft is written with the new person, and it shows the result. */
	parentSheet?: EditSheet;
	sourcePath: string;
	/** Runs just before a write, so the tree view can keep its view (spec §5.5). */
	beforeWrite?: () => void;
	/** Opened by a touch or pen tap: the click the browser makes from that tap must not close the sheet. */
	fromTap?: boolean;
	/** Opens a note for the tree view: the full-screen view closes first (spec §7.1). */
	openNote?: (open: () => Promise<void>) => void;
	/**
	 * Focus mode of the tree view (spec §5.6): Focus here; `pinning` ends the D21 own focus of the
	 * full-screen views before a pin write and returns the way back; `changed` redraws after a failed
	 * pin write, keeping those own focuses.
	 */
	focus?: { here(id: string): void; changed(): void; pinning?(): () => void };
	/**
	 * The relation finder of the tree view (spec §13.2): shows `second` as a relative of `first`. In
	 * the static phone preview it opens the full-screen view with the result (D1).
	 */
	finder?: { show(first: string, second: string): void };
	/**
	 * Fold a branch (spec §13.10): given by the tree view when it can fold or is a static
	 * touch preview. Absent in a sheet with no tree view (tests).
	 */
	folds?: SheetFolds;
	/** The kind of view that opened the sheet: the saved person is shown there (§5.5). */
	place?: ViewKind;
	/** Spec §14 rule 9: the date reader for the calendar link of the block; absent: plain years. */
	dates?: DatesFor;
	/** The plugin's picture store (M9 contract O3): the portrait picture and the picker's preview. */
	pictures?: PictureStore;
	/** D174: the sibling setting of the plugin, so the sheet names the relation as the cards do. Absent: the defaults. */
	relationOptions?: RelationOptions;
}

/** A sheet for a person of the tree. */
export type PersonSheetOptions = SheetBase & { personId: string; newPerson?: undefined };

/** A sheet for a new, unsaved person and how they join the tree (spec §6.3 "New people are drafts"). */
export type NewSheetOptions = SheetBase & { newPerson: NewRelation; personId?: undefined };

/** How the sheet was opened: for a person already in the tree, or for a new one. */
export type SheetOptions = PersonSheetOptions | NewSheetOptions;

/** A write of a relationship action; `withFields`: it also saved field changes of the draft. */
type DraftWritten = Written & { withFields: boolean };

interface ConfirmSpec {
	title: string;
	text: string[];
	confirm: string;
	confirmCls: string;
	keep?: string;
	onConfirm: () => void;
}

/** A tree with this many people or more draws for a noticeable time after a write, so the sheet shows its sign first (F6). */
const SLOW_SAVE_PEOPLE = 300;

/** The modal that shows and edits one person's fields, family and relationship actions. */
export class EditSheet extends Modal {
	private data: Loaded;
	private base: Draft;
	private draft: Draft;
	private newHouse = blankHouse();
	/** Partnership type of a new partner (spec §6.4: default marriage). */
	private unionType: string = 'marriage';
	private saving = false;
	private closing = false;
	/** `onClose` ran: a write that ends later must not draw the sheet again, which would start a portrait copy that nobody releases (C6). */
	private closed = false;
	/** The person left the tree while the sheet was open: the sheet shows the draft but cannot save it. */
	private gone = false;
	private confirmEl: HTMLElement | null = null;
	/** The control that had the focus when a question opened; the focus goes back to it when the question closes (C3). */
	private confirmFrom: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	/** The text line under the header for a problem with the portrait, and what the round portrait showed last (so a repaint that changes nothing leaves it alone). */
	private problemEl: HTMLElement | null = null;
	private portraitKey = '';
	/** The parent type of the last relationship write, for the text of a `limit` refusal. */
	private limitType: string | undefined;
	private status = '';
	/** The last message a failed write showed; the partnership editor shows it too. */
	private lastError = '';
	/** The sheet is on screen (an Undo from a Notice reloads it only then). */
	private shown = false;
	/** How a new person joins the tree; can change when a related person or partnership goes away. */
	private rel: NewRelation | null;
	/** Why the new person cannot be saved as they are, shown in the relation box. */
	private relNote: string | null = null;
	private relBlocked = false;
	/** Names of the related people when the sheet opened, for the message if one leaves the tree. */
	private readonly relNames = new Map<string, string>();
	private readonly cleanup: (() => void)[] = [];
	/**
	 * Spec §13.7: the portrait copy on screen (not kept by the store) and the link it shows. `path` is
	 * the file of the link; `waiting` is true when the file changed while its copy was made (the next
	 * change event of the store starts a new copy).
	 */
	private portrait: { link: string; crop: string; path: string | null; copy: PictureCopy | null; problem: string | null; missing: boolean; loading: boolean; waiting: boolean } | null = null;
	private portraitAbort: AbortController | null = null;
	/** The round portrait button of the header: a copy that arrives changes only this. */
	private portraitFrame: HTMLElement | null = null;
	/** D209 item 5: the text link "Add portrait" in the row of "Open all"; shown while the header has no picture. */
	private addPortraitEl: HTMLElement | null = null;
	/** Gives the hidden names of the parent type chips their ids. */
	private static chipCounter = 0;
	/**
	 * The parent link that each parent-type select shows now. A change of a parent type updates the page in place (r032: a native
	 * select that is destroyed under the finger can keep its phone menu open), so the one listener of a select reads its link here.
	 */
	private parentSelects = new WeakMap<HTMLElement, ParentLink>();
	/** The text block of the header that holds the relation text lines, and a text of the relation that it shows (to draw it again only when it changes). */
	private relHost: HTMLElement | null = null;
	private relSig = '';
	/** The frame of the window (Cancel, Save, the scrolling body) and its sections, drawn again with the form. */
	private shell: Shell | null = null;
	private sections: SectionsView | null = null;
	/** The pictures of the rows and of the small arms marks of the header; released when the form is drawn again and when the window closes. */
	private rowPictures: RowPictures | null = null;
	/** Contract C: the header draws the name, the detail line and the personal arms; these follow the draft. */
	private head: { paint(): void; arms(): void } | null = null;
	/** What the form showed last: a window that crosses 600 px (a turn, a resize) draws again, because the frame differs. */
	private builtPhone = false;
	/** G.7: the people the user came from by a child row, the nearest last. */
	private readonly trail: string[] = [];
	/** What the relation line shows for this build (null: nothing). */
	private relView: RelationView | null = null;
	/** Spec §13.11: the slot in the Actions list for Make a note, what it shows now, and the busy flag of the flow (N2). */
	private noteSlot: HTMLElement | null = null;
	private noteKey = '';
	private noteBusy = false;
	/** Called when the same-name question goes away without a choice; it settles the question as Cancel. */
	private dismissQuestion: (() => void) | null = null;

	/** Returns null if the person is not in the block (the view was out of date). */
	static create(app: App, o: PersonSheetOptions): EditSheet | null {
		const l = loadSheet(o.handle.body, o.personId, o.dates);
		return l.kind === 'ok' ? new EditSheet(app, o, l.data) : null;
	}

	/** A sheet for a new person; null if the block does not parse. */
	static createNew(app: App, o: NewSheetOptions): EditSheet | null {
		const l = loadSheet(o.parentSheet?.data.body ?? o.handle.body, null, o.dates);
		return l.kind === 'ok' ? new EditSheet(app, o, l.data) : null;
	}

	private constructor(
		app: App,
		private readonly o: SheetOptions,
		loaded: Loaded,
	) {
		super(app);
		this.data = loaded;
		this.rel = o.newPerson ? { ...o.newPerson } : null;
		this.base = this.baseOf(loaded);
		this.draft = { ...this.base, name: o.initialName ?? this.base.name };
		for (const id of this.relIds()) this.relNames.set(id, this.name(id));
		this.checkRelation();
	}

	get isNew(): boolean {
		return this.o.newPerson !== undefined;
	}

	get readOnly(): boolean {
		return this.gone || this.data.blocking.length > 0;
	}

	private name(id: string): string {
		return this.data.g.byId.get(id)?.name || id;
	}

	/** Builds the form and gives the focus to the name field (a new person) or the modal itself. */
	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		if (this.isNew) this.modalEl.addClass('is-new');
		if (this.o.fromTap) this.cleanup.push(ignoreGhostClick(this));
		// On a phone the visible area shrinks when the keyboard opens; the header stays in it (spec §7.4).
		this.cleanup.push(
			phoneLayout(this, () => {
				this.relLayout();
				this.revealFocused();
			}),
		);
		this.cleanup.push(trackModal(this, () => this.finish()));
		const store = this.o.pictures;
		if (store) this.cleanup.push(store.onChange((paths) => this.portraitFilesChanged(paths)));
		this.shown = true;
		this.build();
		if (this.isNew) this.focusNameAfterOpen();
		else {
			if (!this.modalEl.contains(this.modalEl.doc?.activeElement ?? null)) {
				// On a phone the sheet can open with the focus left on the page, so a Tab key would reach the tree below it.
				this.modalEl.setAttribute('tabindex', '-1');
				this.modalEl.focus({ preventScroll: true });
			}
			// F7: a computer has a keyboard, so the window starts in Name, as for a new person. A phone would open its keyboard.
			if (this.startsInName()) this.focusNameAfterOpen();
		}
	}

	/** True if a saved person's window starts with the focus in Name: not a read-only window, not a phone, not a touch screen (spec §7: the pointer and the width decide, not `Platform`). */
	private startsInName(): boolean {
		if (this.readOnly || this.gone || this.modalEl.hasClass('is-phone')) return false;
		const win = this.modalEl.win ?? window;
		return win.matchMedia?.('(pointer: coarse)')?.matches !== true;
	}

	private focusNameAfterOpen(): void {
		this.focusName();
		// Why: after `onOpen` returns, Obsidian moves the focus to the first control of the window when the device has a
		// physical keyboard (a computer). That control is "Open all" or "Add portrait or arms". A phone has no such step.
		void Promise.resolve().then(() => {
			if (!this.shown || this.closing) return;
			const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
			const typing = !!active && this.contentEl.contains(active) && active.matches('input, textarea, select');
			if (!typing) this.focusName();
		});
	}

	/** Runs the cleanup functions `onOpen` registered and empties the modal. */
	override onClose(): void {
		this.shown = false;
		this.closed = true;
		this.settleQuestion();
		for (const c of this.cleanup.splice(0)) c();
		// O7: the sheet's portrait copy is released when the sheet closes.
		this.dropPortrait();
		this.portraitFrame = null;
		this.addPortraitEl = null;
		this.shell?.dispose();
		this.shell = null;
		this.sections = null;
		this.rowPictures?.release();
		this.rowPictures = null;
		this.head = null;
		this.contentEl.empty();
	}

	/** Esc, the X button, a press outside and Android back all come here (spec §6.3). */
	override close(): void {
		if (this.closing) {
			super.close();
			return;
		}
		if (this.confirmEl) {
			this.hideConfirm();
			return;
		}
		if (this.isDirty()) {
			this.showConfirm({
				title: SHEET.discardTitle,
				text: [this.isNew ? NEW_SHEET.discardText : SHEET.discardText],
				confirm: SHEET.discard,
				confirmCls: 'dynasty-sheet-discard',
				keep: SHEET.keepEditing,
				onConfirm: () => this.finish(),
			});
			return;
		}
		this.finish();
	}

	private finish(): void {
		this.closing = true;
		this.close();
	}

	private isDirty(): boolean {
		if (this.readOnly) return false;
		return Object.keys(this.changedFields()).length > 0 || this.draft.house === NEW_HOUSE;
	}

	private changedFields(): Partial<Record<PersonField, FieldValue>> {
		const out: Partial<Record<PersonField, FieldValue>> = {};
		for (const f of TEXT_FIELDS) {
			const now = this.draft[f].trim();
			if (now !== this.base[f].trim()) out[f] = now === '' ? null : now;
		}
		for (const f of ['sex', 'placement'] as const) {
			if (this.draft[f] !== this.base[f]) out[f] = this.draft[f] === '' ? null : this.draft[f];
		}
		if (this.draft.house !== this.base.house && this.draft.house !== NEW_HOUSE) out.house = this.draft.house === '' ? null : this.draft.house;
		if (this.draft.illegitimate !== this.base.illegitimate) out.illegitimate = this.draft.illegitimate;
		if (this.draft.childless !== this.base.childless) out.childless = this.draft.childless;
		// Spec §13.7: Select portrait and Remove portrait are draft edits; Save writes them with the other fields.
		const portrait = this.draft.portrait.trim();
		if (portrait !== this.base.portrait.trim()) out.portrait = portrait === '' ? null : portrait;
		// Spec §13.13, D91: the part follows the picture. A changed part is written (or removed); a part that is kept while
		// the link text changes to the same file is written again, so the core rule that a new picture drops its part keeps it.
		// 0.2.8 contract A.1: Select personal arms and Remove personal arms are draft edits too.
		const arms = this.draft.arms.trim();
		if (arms !== this.base.arms.trim()) out.arms = arms === '' ? null : arms;
		const crop = this.draft.portraitCrop.trim();
		if (!sameCropText(crop, this.base.portraitCrop.trim())) out['portrait-crop'] = crop === '' ? null : crop;
		else if (out.portrait !== undefined && out.portrait !== null && crop !== '') out['portrait-crop'] = crop;
		return out;
	}

	// ---------- building the form ----------

	private build(): void {
		if (this.closed) return;
		const el = this.contentEl;
		const kept = this.focusMark();
		this.shell?.dispose();
		this.rowPictures?.release();
		this.rowPictures = new RowPictures(this.o.pictures, this.o.sourcePath);
		el.empty();
		this.confirmEl = null;
		this.settleQuestion();
		this.noteSlot = null;
		this.noteKey = '';
		this.addPortraitEl = null;
		const ro = this.readOnly;
		this.modalEl.toggleClass('is-read-only', ro);
		this.relView = this.makeRelationView();
		this.builtPhone = this.modalEl.hasClass('is-phone');

		const shell = buildShell({
			modalEl: this.modalEl,
			contentEl: el,
			title: this.title(),
			// A new person has no header with a name yet, so the bar shows the title.
			titled: this.isNew,
			cancelLabel: ro ? SHEET.close : SHEET.cancel,
			saveLabel: ro ? null : SHEET.save,
			onCancel: () => this.finish(),
			onSave: () => void this.save(),
			// Spec §6.3: quick entry of several children; in the footer (a phone: under the bar), so it stays reachable (spec §7.4).
			...(!ro && this.rel?.kind === 'child' ? { extra: { text: NEW_SHEET.saveAnother, focus: 'save-another', run: () => void this.save(true) } } : {}),
		});
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		const body = shell.body;
		this.bodyEl = body;
		body.addEventListener('focusin', () => this.revealFocused(300));
		// G.7: a child row opened this person; the way back names the person before.
		const before = this.trail[this.trail.length - 1];
		if (before !== undefined) shell.setBack(this.name(before), WINDOW_UI.backToLabel(this.name(before)), () => this.goBackTo());
		if (ro) {
			const banner = body.createDiv({ cls: ['callout', 'dynasty-sheet-banner'], attr: { 'data-callout': 'warning' } });
			banner.createDiv({ cls: 'callout-title' }).createDiv({ cls: 'callout-title-inner', text: UI.bannerTitle });
			const c = banner.createDiv({ cls: 'callout-content' });
			if (this.gone) c.createDiv({ text: WRITE_TEXT.personGone });
			else {
				c.createDiv({ text: UI.bannerLead });
				const list = c.createEl('ul');
				for (const t of this.data.blocking) list.createEl('li', { text: t });
			}
		}
		this.statusEl = body.createDiv({ cls: 'dynasty-sheet-status', attr: { role: 'status' } });
		this.statusEl.setText(this.status);
		this.statusEl.toggle(this.status !== '');
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.hide();
		if (this.isNew) this.relationBox(body);

		this.personHeader(body);
		this.sections = renderSections(body, 'person', this.sectionSpecs(), () => shell.checkOverflow(), this.isNew ? this : undefined);
		this.openNoteLink(this.sections.openAllRow);
		this.addPortraitLink(this.sections.openAllRow);
		this.restoreFocus(kept);
	}

	/** The sections of the window: all five for a person in the tree, Details and Notes for a new person. */
	private sectionSpecs(): SectionSpec[] {
		const fam = this.data.fam;
		const specs: SectionSpec[] = [{ key: 'details', title: WINDOW_UI.sectionDetails, summary: this.detailsSummary(), open: true, build: (b) => this.detailsBody(b) }];
		if (!this.isNew && fam) specs.push({ key: 'family', title: WINDOW_UI.sectionFamily, summary: this.familySummary(), open: false, build: (b) => this.familyBody(b) });
		if (!this.isNew) specs.push({ key: 'titles', title: WINDOW_UI.sectionTitles, summary: titlesSummary(this.titlesHost()), open: false, build: (b) => titlesBody(b, this.titlesHost()) });
		specs.push({ key: 'notes', title: WINDOW_UI.sectionNotes, summary: this.notesSummary(), open: false, build: (b) => this.notesBody(b) });
		if (!this.isNew) specs.push({ key: 'actions', title: WINDOW_UI.sectionActions, summary: '', open: false, build: (b) => this.actionsBody(b, this.me()) });
		return specs;
	}

	/** Joins the parts of a summary with " · "; parts that are empty are left out. */
	private sum(parts: (string | undefined)[]): string {
		return parts.filter((x): x is string => !!x).join(' · ');
	}

	private detailsSummary(): string {
		const d = this.draft;
		const house = d.house === NEW_HOUSE ? this.newHouse.name.trim() : (this.data.g.houses?.get(d.house)?.name ?? '');
		const sex = d.sex === 'm' ? SHEET.sexMale : d.sex === 'f' ? SHEET.sexFemale : '';
		return this.sum([house || SHEET.noHouse, sex, dateLine({ ...this.data.person, born: d.born.trim() || undefined, died: d.died.trim() || undefined }, this.data.g.dates)]);
	}

	private familySummary(): string {
		const fam = this.data.fam;
		if (!fam) return '';
		return WINDOW_UI.sumFamilyParts(fam.parents.length, fam.partners.length, this.childrenOf().length).join(' · ');
	}

	private notesSummary(): string {
		const link = this.draft.link.trim();
		if (link) return WINDOW_UI.sumNotesLinked(link.replace(/^\[\[|\]\]$/g, ''));
		const first = this.draft.notes.split('\n').find((t) => t.trim() !== '');
		return first?.trim() ?? WINDOW_UI.sumNotesNone;
	}

	/** The closed sections show a summary of the draft: it follows the fields while the user types (it does not show the saved values). */
	private updateSummaries(): void {
		this.sections?.setSummary('details', this.detailsSummary());
		this.sections?.setSummary('notes', this.notesSummary());
	}

	/** People who list this person as a parent, in tree order. */
	private childrenOf(): Person[] {
		const id = this.data.person.id;
		return id === '' ? [] : this.data.g.people.filter((q) => q.parents.some((l) => l.id === id));
	}

	// ---------- the header (contract C, Q6H A) ----------

	/** The house of the draft: the written house, or the new house that the form asks for. */
	private draftHouse(): { name: string; colour: string | null; arms: string | null } | null {
		const d = this.draft.house;
		if (d === '') return null;
		if (d === NEW_HOUSE) return this.newHouse.name.trim() ? { name: this.newHouse.name.trim(), colour: this.newHouse.color, arms: null } : null;
		const h = this.data.g.houses?.get(d);
		return h ? { name: h.name || h.id, colour: h.color ?? null, arms: h.arms?.trim() || null } : { name: SHEET.unknownHouse(d), colour: null, arms: null };
	}

	/** The name that the header, the labels and the bar show now. */
	private shownName(): string {
		return this.draft.name.trim() || this.data.person.name || '';
	}

	/**
	 * The header: the name with the small personal arms after it, one detail text line (house, title, dates), then the relation text
	 * line, and the round portrait at the right (D209: 64 px, a faint outline, no house ring; no circle when there is no portrait). A tap
	 * on the portrait or on the arms opens the picture menu. The header follows the draft (`head.paint`).
	 */
	private personHeader(parent: HTMLElement): void {
		const head = parent.createDiv({ cls: ['dynasty-head', 'dynasty-person-head', 'dynasty-q6h-A'] });
		const text = head.createDiv({ cls: 'dynasty-head-text' });
		const nameLine = text.createDiv({ cls: 'dynasty-head-name' });
		const nameText = nameLine.createSpan();
		let armsMark: HTMLElement | null = null;
		const metaHost = text.createDiv({ cls: 'dynasty-head-metahost' });
		this.relHost = text;
		this.relSig = this.relationSig();
		if (this.relView) renderRelationLine(text, this.relView);
		// D209 item 4: the portrait stands at the right of the name.
		const pic = head.createEl('button', { cls: 'dynasty-pic', attr: { type: 'button', 'aria-haspopup': 'menu', 'data-focus': 'portrait' } });
		this.portraitFrame = pic;
		pic.addEventListener('click', () => this.pictureMenu(pic));
		const problem = parent.createDiv({ cls: 'dynasty-head-problem' });
		problem.hide();

		const paintName = () => {
			nameText.empty();
			const name = this.draft.name.trim();
			if (name) {
				nameText.appendText(name);
				const sob = this.draft.sobriquet.trim();
				if (sob) nameText.createSpan({ cls: 'dynasty-sob', text: ` ${quotedSobriquet(sob)}` });
			} else nameText.createSpan({ cls: 'is-empty', text: this.isNew ? WINDOW_UI.enterName : SHEET.unnamed });
			this.shell?.setTitle(this.isNew ? this.title() : name || SHEET.unnamed, this.isNew);
		};
		const paintMeta = () => {
			metaHost.empty();
			const parts: (HTMLElement | string)[] = [];
			const house = this.draftHouse();
			if (house) {
				const hs = createSpan({ cls: 'dynasty-house' });
				if (house.arms) {
					const slot = hs.createSpan({ cls: 'dynasty-house-armsmark' });
					this.rowPictures?.show(slot, house.arms, { px: 30, fit: 'meet' });
				} else hs.createSpan({ cls: 'dynasty-house-dot' });
				hs.appendText(house.name);
				parts.push(hs);
			}
			const label = this.cardLabel();
			const titleText = label?.title ?? this.draft.title.trim();
			if (titleText) parts.push(nb(label?.title && label.reign ? `${titleText} ${label.reign}` : titleText));
			const dates = dateLine({ ...this.data.person, born: this.draft.born.trim() || undefined, died: this.draft.died.trim() || undefined }, this.data.g.dates);
			if (dates) parts.push(dates);
			if (this.isNew && this.rel) parts.push(this.newDetail());
			if (parts.length) joined(metaHost, 'dynasty-head-meta', parts);
			const colour = house?.colour;
			if (drawableColour(colour)) head.style.setProperty('--dynasty-house-color', colour);
			else head.style.removeProperty('--dynasty-house-color');
			head.toggleClass('has-house', !!house);
		};
		const paintArms = () => {
			armsMark?.remove();
			armsMark = null;
			// "Add portrait or arms" becomes "Add portrait" when the person has arms.
			this.paintAddPortrait();
			const link = this.draft.arms.trim();
			if (!link) return;
			const name = this.shownName() || WINDOW_UI.thisPersonInSentence;
			armsMark = nameLine.createEl('button', { cls: 'dynasty-arms-mark', attr: { type: 'button', 'aria-label': WINDOW_UI.armsOfPerson(name), 'aria-haspopup': 'menu', 'data-focus': 'personal-arms' } });
			armsMark.addEventListener('click', () => this.pictureMenu(armsMark!));
			this.rowPictures?.show(armsMark, link, { px: 44, fit: 'meet' });
		};
		this.head = {
			paint: () => {
				paintName();
				paintMeta();
				this.paintPortrait();
			},
			arms: paintArms,
		};
		paintName();
		paintMeta();
		paintArms();
		this.problemEl = problem;
		this.paintPortrait();
	}

	/** The card label of the person (title text and reign as the card shows them), or undefined when the tree has no titles. */
	private cardLabel() {
		const id = this.data.person.id;
		if (this.isNew || id === '' || !needsLabels(this.data.g)) return undefined;
		return cardLabels(this.data.g).get(id);
	}

	/** The detail text of a new person: "Child of A and B", "Partner of A", "Birth parent of A". */
	private newDetail(): string {
		const rel = this.rel;
		if (!rel) return '';
		const kind = rel.kind === 'parent' ? NEW_SHEET.titleParent : rel.kind === 'child' ? NEW_SHEET.titleChild : rel.kind === 'partner' ? NEW_SHEET.titlePartner : NEW_SHEET.titlePerson;
		const detail =
			rel.kind === 'parent'
				? NEW_SHEET.parentOf(rel.type, this.name(rel.child))
				: rel.kind === 'child'
					? NEW_SHEET.childOf(this.name(rel.parent), rel.other === null ? null : this.name(rel.other))
					: rel.kind === 'partner'
						? NEW_SHEET.partnerOf(this.name(rel.partner))
						: '';
		return this.sum([kind, detail]);
	}

	/** The short menu of the portrait and the personal arms (D198 Q6H A). It starts with View portrait or View arms (D256); a window that cannot change the note opens the viewer at once. A new person has no portrait yet. */
	private pictureMenu(anchor: HTMLElement): void {
		const kit = { app: this.app, pictures: this.o.pictures, sourcePath: this.o.sourcePath, g: this.data.g, person: this.data.person, draft: this.draft };
		if (this.readOnly) return viewPerson(kit, anchor);
		if (this.isNew) {
			new Notice(WINDOW_UI.saveFirst);
			return;
		}
		const link = this.draft.portrait.trim();
		const p = link ? this.portraitFor(link) : null;
		const items: (MenuEntry | 'sep')[] = [...personViewItems(kit, anchor), { icon: 'image', label: PICTURES_UI.selectPortrait, run: () => void this.selectPortrait() }];
		if (link) {
			// Shown once the portrait can show; a picture with a problem has no part to select.
			if (p && p.path !== null && p.problem === null) items.push({ icon: 'crop', label: WINDOW_UI.selectPart, run: () => void this.selectPart() });
			items.push({
				icon: 'trash-2',
				label: PICTURES_UI.removePortrait,
				warning: true,
				run: () => {
					this.portraitLinkChanged('');
					this.draft.portrait = '';
					this.clearError();
					this.head?.paint();
				},
			});
		}
		items.push('sep', { icon: 'shield', label: WINDOW_UI.selectPersonalArms, run: () => void this.selectArms() });
		if (this.draft.arms.trim()) {
			items.push({
				icon: 'trash-2',
				label: WINDOW_UI.removePersonalArms,
				warning: true,
				run: () => {
					this.draft.arms = '';
					this.clearError();
					this.head?.arms();
				},
			});
		}
		showMenu(anchor, items);
	}

	/**
	 * O2: the control that has the focus now, as a `data-focus` key and its place among the controls of that key. A rebuild
	 * removes it, and the browser then puts the focus on the page, outside the dialog (a keyboard user is lost).
	 */
	private focusMark(): { key: string; index: number; start: number | null; end: number | null } | 'sheet' | null {
		const el = this.contentEl;
		const active = this.modalEl.doc?.activeElement as HTMLInputElement | null | undefined;
		if (!active || !el.contains(active)) return null;
		const key = active.getAttribute('data-focus');
		if (!key) return 'sheet';
		const index = Array.from(el.querySelectorAll<HTMLElement>(`[data-focus="${key}"]`)).indexOf(active);
		const caret = typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number';
		return { key, index: Math.max(0, index), start: caret ? active.selectionStart : null, end: caret ? active.selectionEnd : null };
	}

	/**
	 * O2: gives the focus back to the same control of the new form (the same key and place, never a disabled one), or
	 * to the sheet itself when that control is gone (Pin becomes Unpin). `preventScroll`: the scroll place is kept.
	 */
	private restoreFocus(mark: ReturnType<EditSheet['focusMark']>): void {
		if (mark === null || this.closing || !this.shown) return;
		if (mark !== 'sheet') {
			const same = Array.from(this.contentEl.querySelectorAll<HTMLInputElement>(`[data-focus="${mark.key}"]`)).filter((c) => !c.disabled);
			const target = same[Math.min(mark.index, same.length - 1)];
			// Every control here was made by the build that just ran. A select that is new and gets the focus in code can open its phone
			// menu again, so a touch screen leaves the focus on the sheet instead (r032). A select that the user used is not rebuilt (the
			// changes of a select update the page in place), so it never comes here and keeps the focus it has.
			const touch = (this.modalEl.win ?? window).matchMedia?.('(pointer: coarse)')?.matches === true;
			if (target && !(touch && target.matches('select'))) {
				target.focus({ preventScroll: true });
				if (mark.start !== null && mark.end !== null && target.setSelectionRange) target.setSelectionRange(mark.start, mark.end);
				return;
			}
		}
		this.modalEl.setAttribute('tabindex', '-1');
		this.modalEl.focus({ preventScroll: true });
	}

	private title(): string {
		const rel = this.rel;
		if (!rel) return this.data.person.name || SHEET.unnamed;
		return rel.kind === 'parent' ? NEW_SHEET.titleParent : rel.kind === 'child' ? NEW_SHEET.titleChild : rel.kind === 'partner' ? NEW_SHEET.titlePartner : NEW_SHEET.titlePerson;
	}

	/** The choices of a new person: the partnership of the parents of a child, the type of a new partnership, and the notes about them. */
	private relationBox(parent: HTMLElement): void {
		const rel = this.rel;
		if (!rel || (rel.kind === 'person' && !this.relNote)) return;
		const box = parent.createDiv({ cls: 'dynasty-sheet-relation' });
		if (this.relNote) box.createDiv({ cls: 'dynasty-sheet-relation-note', text: this.relNote, attr: { role: 'alert' } });
		if (rel.kind === 'person') return;
		if (this.relBlocked && this.relIds().some((id) => !this.data.g.byId.has(id))) {
			// A related person left the tree: keep the draft, and offer to add the person alone.
			const alone = box.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-sheet-alone'], text: NEW_SHEET.noRelatives, attr: { type: 'button', 'data-focus': 'alone' } });
			alone.addEventListener('click', () => {
				this.rel = { kind: 'person' };
				this.relNote = null;
				this.relBlocked = false;
				this.build();
			});
			return;
		}
		// The text "Child of A and B" stands in the detail line of the header; the box keeps the choices and the notes.
		if (rel.kind === 'child') this.partnershipField(box, rel);
		if (rel.kind === 'partner') {
			const { row, id } = sheetField(box, NEW_SHEET.unionType, 'union-type');
			const sel = row.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input'], attr: { id } });
			for (const t of UNION_TYPES) sel.createEl('option', { text: UNION_TYPE_TEXT[t], attr: { value: t } });
			sel.value = this.unionType;
			sel.addEventListener('change', () => (this.unionType = sel.value));
		}
		if (!box.childElementCount) box.remove();
	}

	/**
	 * The values the draft starts from. D16: a new child added from a person's sheet starts with
	 * that person's house (if the tree has it); it is part of the base, so only the user's own
	 * changes make the sheet ask "Discard changes?".
	 */
	private baseOf(l: Loaded): Draft {
		const d = draftOf(l);
		const rel = this.rel;
		if (rel?.kind !== 'child' || !this.o.parentSheet) return d;
		const house = l.g.byId.get(rel.parent)?.house;
		return house && l.tree.houses.some((h) => h.id === house) ? { ...d, house } : d;
	}

	/** People the new person joins: the child, the parents or the partner. */
	private relIds(): string[] {
		const rel = this.rel;
		if (!rel || rel.kind === 'person') return [];
		if (rel.kind === 'parent') return [rel.child];
		if (rel.kind === 'partner') return [rel.partner];
		return rel.other === null ? [rel.parent] : [rel.parent, rel.other];
	}

	/** The listed partnerships of a new child's two parents, in union order. */
	private couple(rel: Extract<NewRelation, { kind: 'child' }>): UnionRef[] {
		if (rel.other === null) return [];
		const fam = familyOf(this.data.g, rel.parent);
		return (fam?.partners ?? []).filter((l) => l.partner === rel.other && l.union).map((l) => l.union!);
	}

	/**
	 * Checks that the new person can still join the tree as chosen, after the sheet loaded new data
	 * (the decision notes "Union references"). The chosen partnership is found again
	 * by its text; if it is gone, the user must choose again. A related person who is gone blocks
	 * Save; the draft stays.
	 */
	private checkRelation(): void {
		this.relNote = null;
		this.relBlocked = false;
		const rel = this.rel;
		if (!rel || rel.kind === 'person') return;
		const gone = this.relIds().find((id) => !this.data.g.byId.has(id));
		if (gone) {
			this.relNote = `${NEW_SHEET.relativeGone(this.relNames.get(gone) ?? gone)} ${NEW_SHEET.relativeGoneHelp}`;
			this.relBlocked = true;
			return;
		}
		if (rel.kind !== 'child' || !rel.union) return;
		const chosen = rel.union;
		const couple = this.couple(rel);
		const match = findUnion(couple, chosen);
		if (match && match !== 'ambiguous') {
			rel.union = match;
			return;
		}
		rel.union = undefined;
		if (couple.length) {
			this.relNote = NEW_SHEET.partnershipLost;
			this.relBlocked = true;
		} else this.relNote = NEW_SHEET.partnershipGone;
	}

	/** For a child of a couple with several partnerships, or after the chosen one went away: which partnership. */
	private partnershipField(box: HTMLElement, rel: Extract<NewRelation, { kind: 'child' }>): void {
		const couple = this.couple(rel);
		if (couple.length < 2 && !(this.relBlocked && couple.length)) return;
		const fam = familyOf(this.data.g, rel.parent);
		const { row, id } = sheetField(box, NEW_SHEET.partnership, 'partnership');
		const sel = row.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input'], attr: { id } });
		if (!rel.union) sel.createEl('option', { text: NEW_SHEET.choosePartnership, attr: { value: '' } });
		couple.forEach((u, i) => {
			const l = fam?.partners.find((x) => x.union?.index === u.index);
			sel.createEl('option', { text: l ? partnerDetail(l.type, l.start, l.end) : String(i + 1), attr: { value: String(i) } });
		});
		sel.value = rel.union ? String(couple.findIndex((u) => u.index === rel.union!.index)) : '';
		sel.addEventListener('change', () => {
			if (sel.value === '') return;
			rel.union = couple[Number(sel.value)];
			this.relNote = null;
			this.relBlocked = false;
			// r032: no build inside the change event of this select (a native select that is taken out under the finger can keep its
			// phone menu open). What the choice changes is only the note that asked for it and the empty choice; both go away here.
			for (const el of Array.from(box.children)) if (el.hasClass('dynasty-sheet-relation-note')) el.remove();
			for (const opt of Array.from(sel.querySelectorAll<HTMLOptionElement>('option'))) if (opt.getAttribute('value') === '') opt.remove();
		});
	}

	// ---------- the portrait (spec §13.7) ----------

	/**
	 * Shows the portrait state in the round button of the header and the problem text under it. A copy that arrives comes here
	 * only, so the rest of the header keeps its elements and the focus (O2).
	 */
	private paintPortrait(): void {
		const frame = this.portraitFrame;
		if (!frame || !this.bodyEl?.contains(frame)) return;
		const link = this.draft.portrait.trim();
		const p = link ? this.portraitFor(link) : null;
		const name = this.shownName();
		const key = [p?.copy?.url ?? '', p?.loading ? 'l' : '', p?.missing ? 'm' : '', name, p?.problem ?? ''].join('|');
		const host = this.problemEl;
		if (key === this.portraitKey && frame.hasClass('is-painted')) return;
		this.portraitKey = key;
		frame.addClass('is-painted');
		frame.empty();
		frame.removeClass('is-none', 'is-loading', 'has-picture');
		if (p?.copy) {
			frame.addClass('has-picture');
			frame.createEl('img', { cls: 'dynasty-pic-img', attr: { src: p.copy.url, alt: '' } });
		} else if (p?.loading) {
			// The copy is on its way: the 64 px slot keeps its place and draws nothing, so the header does not jump when the picture comes.
			frame.addClass('is-loading');
		} else {
			// D213: no picture, no circle. The text link "Add portrait" (saved person) is the way to add one; a problem shows in the text under the header.
			frame.addClass('is-none');
		}
		frame.setAttribute('aria-label', WINDOW_UI.portraitOf(name || WINDOW_UI.thisPersonInSentence));
		this.paintAddPortrait();
		const text = p?.problem ?? null;
		if (!host) return;
		if (text === null) {
			host.hide();
			host.setText('');
		} else {
			host.setText(text);
			host.show();
		}
	}

	/**
	 * D209 item 5, D218 item 8: "Add portrait or arms", a small text link at the left of the row of "Open all". Only a saved person that can
	 * change has it, and only while the person has no portrait. Its tap opens the picture menu (Select portrait, Select personal arms), so the
	 * arms stay reachable for a person with no portrait. A person with personal arms already sees "Add portrait".
	 */
	private addPortraitLink(row: HTMLElement | null): void {
		this.addPortraitEl = null;
		if (!row || this.isNew || this.readOnly) return;
		const link = row.createEl('button', { cls: ['dynasty-link', 'dynasty-add-portrait'], attr: { type: 'button', 'data-focus': 'add-portrait' } });
		link.addEventListener('click', () => this.pictureMenu(link));
		row.prepend(link);
		this.addPortraitEl = link;
		this.paintAddPortrait();
	}

	/**
	 * D218 item 9 (N23): "Open linked note", a text link left of "Open all", for a saved person that has a link. It stands in the row
	 * under the header, not in the closed Actions section, so a fresh window shows it. It closes the window and then opens the note.
	 */
	private openNoteLink(row: HTMLElement | null): void {
		if (!row || this.isNew) return;
		const linktext = linkTarget(this.data.person.link);
		if (!linktext) return;
		const link = row.createEl('button', { cls: ['dynasty-link', 'dynasty-open-note', 'dynasty-sheet-open-link'], text: SHEET.openLink, attr: { type: 'button', 'data-focus': 'dynasty-sheet-open-link' } });
		link.addEventListener('click', () => {
			if (this.saving) return;
			try {
				this.leaveFor(() => {
					const open = () => this.app.workspace.openLinkText(linktext, this.o.sourcePath, false);
					if (this.o.openNote) this.o.openNote(open);
					else void open().catch((e) => console.error('Crown and Kin: cannot open link', e));
				});
			} catch (e) {
				console.error('Crown and Kin: the sheet action failed', e);
			}
		});
		// Left of "Open all", which stands last in the row.
		const all = row.querySelector('.dynasty-openall-button');
		if (all) row.insertBefore(link, all);
		else row.appendChild(link);
	}

	private paintAddPortrait(): void {
		const link = this.addPortraitEl;
		if (!link) return;
		link.setText(this.draft.arms.trim() ? WINDOW_UI.addPortraitHasArms : WINDOW_UI.addPortrait);
		const hold = link === link.doc.activeElement;
		const show = this.portraitFrame?.hasClass('is-none') === true;
		link.toggle(show);
		// A hidden control cannot keep the focus: it would drop to the page, outside the window. The portrait takes its place.
		if (hold && !show) this.portraitFrame?.focus({ preventScroll: true });
	}

	/**
	 * When the picture picker closes, the focus is on the page or on the hidden "Add portrait" link: the link hides itself when a portrait
	 * is chosen. This moves the focus to the portrait (`data-focus="portrait"`) unless it is already inside the window.
	 */
	private focusPortraitIfLost(): void {
		const frame = this.portraitFrame;
		if (!frame || !this.shown || frame.hasClass('is-none')) return;
		const active = frame.doc.activeElement;
		const lost = !active || active === frame.doc.body || !this.modalEl.contains(active) || active === this.addPortraitEl;
		if (lost) frame.focus({ preventScroll: true });
	}

	/**
	 * O3, O9: picture files changed (main.ts, after its wait). When one is the portrait's file, or the
	 * link had no file, or its copy was dropped because the file changed, the sheet asks again.
	 */
	private portraitFilesChanged(paths: readonly string[]): void {
		const p = this.portrait;
		if (!this.shown || !p) return;
		const hit = (p.path !== null && paths.includes(p.path)) || p.missing || p.waiting;
		if (!hit) return;
		this.dropPortrait();
		try {
			this.paintPortrait();
		} catch (e) {
			console.error('Crown and Kin: cannot show the portrait', e);
		}
	}

	/** The sheet's portrait state for `link`; starts the copy when the link is new. */
	private portraitFor(link: string): NonNullable<EditSheet['portrait']> {
		// The copy shows the draft's part, so a new part makes a new copy.
		const part = startCropOf(this.draft.portraitCrop);
		const cropText = part ? formatPortraitCrop(part) : '';
		if (this.portrait?.link === link && this.portrait.crop === cropText) return this.portrait;
		this.dropPortrait();
		const store = this.o.pictures;
		const who = { id: this.data.person.id, name: this.draft.name.trim() || this.data.person.name };
		const problemText = (x: Parameters<typeof pictureIssue>[1]) => issueText(pictureIssue({ kind: 'portrait', person: who }, x));
		const state: NonNullable<EditSheet['portrait']> = { link, crop: cropText, path: null, copy: null, problem: null, missing: false, loading: false, waiting: false };
		this.portrait = state;
		if (!store) return state;
		const found = store.resolve(link, this.o.sourcePath);
		if (!found.ok) {
			state.missing = found.code === 'missing-picture';
			state.problem = problemText(found);
			return state;
		}
		state.path = found.file.path;
		state.loading = true;
		const ctl = new AbortController();
		this.portraitAbort = ctl;
		void store
			.transient(found.file, { w: SHEET_PORTRAIT_PX, h: SHEET_PORTRAIT_PX, fit: 'portrait', ...(part ? { crop: part } : {}) }, ctl.signal)
			.then((c) => {
				if (ctl.signal.aborted || this.portrait !== state) {
					if (c && 'url' in c) c.release();
					return;
				}
				// O3: null means the file changed during the copy: the frame waits for the store's change event.
				if (c === null) {
					state.waiting = true;
					return;
				}
				state.loading = false;
				if ('url' in c) state.copy = c;
				else state.problem = problemText(c);
				if (this.shown) this.paintPortrait();
			})
			.catch((e) => console.error('Crown and Kin: cannot show the portrait', e));
		return state;
	}

	private dropPortrait(): void {
		this.portraitAbort?.abort();
		this.portraitAbort = null;
		this.portrait?.copy?.release();
		this.portrait = null;
	}

	/** Select portrait (spec §13.7): the picture picker; the chosen link goes into the draft. */
	private async selectPortrait(): Promise<void> {
		const name = this.draft.name.trim() || this.data.person.name || SHEET.unnamed;
		// V1: the sheet's draft value is the current picture.
		const current = currentPictureOf(this.o.pictures, this.draft.portrait?.trim(), this.o.sourcePath);
		// D97: the list has a Remove row only when the draft has a portrait.
		const remove = this.draft.portrait.trim() ? PICTURES_UI.removePortrait : undefined;
		const picked = await pickPicture(this.app, { sourcePath: this.o.sourcePath, store: this.o.pictures, title: PICTURES_UI.pickerPortraitTitle(name), barTitle: PICTURES_UI.pickerBarPortrait, current, remove, hint: WINDOW_UI.pickPortraitHint });
		if (!this.shown) return;
		if (picked.kind === 'choose') {
			this.portraitLinkChanged(picked.link);
			this.draft.portrait = picked.link;
			this.clearError();
			this.head?.paint();
			this.focusPortraitIfLost();
			// D196 item 4: the crop tool opens at once. If the user closes it, the part that the plugin chose by itself stays.
			await this.selectPart();
			return;
		}
		if (picked.kind === 'remove') {
			// The same as the Remove portrait item: the draft changes; Save writes it.
			this.portraitLinkChanged('');
			this.draft.portrait = '';
			this.clearError();
		}
		this.head?.paint();
	}

	/** Select personal arms (contract A.1, D198): the picture picker; the chosen link goes into the draft. */
	private async selectArms(): Promise<void> {
		const name = this.shownName() || WINDOW_UI.thisPersonInSentence;
		const current = currentPictureOf(this.o.pictures, this.draft.arms.trim(), this.o.sourcePath);
		const remove = this.draft.arms.trim() ? WINDOW_UI.removePersonalArms : undefined;
		const picked = await pickPicture(this.app, { sourcePath: this.o.sourcePath, store: this.o.pictures, title: WINDOW_UI.pickArms(name), barTitle: PICTURES_UI.pickerBarArms, current, remove, hint: WINDOW_UI.pickArmsHint });
		if (!this.shown) return;
		if (picked.kind === 'choose') this.draft.arms = picked.link;
		else if (picked.kind === 'remove') this.draft.arms = '';
		this.clearError();
		this.head?.arms();
	}

	/**
	 * D91: a draft link that names another file drops the draft's part. The same file (even with other
	 * link text) keeps it; `changedFields` then writes the part again so the core rule does not drop it.
	 */
	private portraitLinkChanged(next: string): void {
		const before = this.draft.portrait.trim();
		const after = next.trim();
		if (this.draft.portraitCrop === '') return;
		if (!this.sameFile(before, after)) this.draft.portraitCrop = '';
	}

	/** True when both links resolve to the same vault file (or, with no store, have the same text). */
	private sameFile(a: string, b: string): boolean {
		if (a === b) return true;
		if (a === '' || b === '') return false;
		const store = this.o.pictures;
		if (!store) return false;
		const x = store.resolve(a, this.o.sourcePath);
		const y = store.resolve(b, this.o.sourcePath);
		return x.ok && y.ok && x.file.path === y.file.path;
	}

	/** Select the part (spec §13.13): the crop tool over the sheet; Save puts the part into the draft. */
	private async selectPart(): Promise<void> {
		const store = this.o.pictures;
		const link = this.draft.portrait.trim();
		if (!store || link === '') return;
		const found = store.resolve(link, this.o.sourcePath);
		if (!found.ok) return;
		const name = this.draft.name.trim() || this.data.person.name || SHEET.unnamed;
		const r = await openCropTool({ app: this.app, file: found.file, store, personName: name, start: startCropOf(this.draft.portraitCrop) });
		if (!this.shown) return;
		if (r.kind === 'save') {
			this.draft.portraitCrop = r.crop ? formatPortraitCrop(r.crop) : '';
			this.clearError();
		}
		this.head?.paint();
	}

	/** Called after a field of the draft changed: the header and the summaries of the closed sections follow it. */
	private fieldChanged(key: string): void {
		if (key === 'name' || key === 'sobriquet' || key === 'title' || key === 'born' || key === 'died' || key === 'house' || key === 'sex' || key === 'link' || key === 'notes') {
			this.head?.paint();
			this.updateSummaries();
		}
	}

	private textField(
		parent: HTMLElement,
		key: (typeof TEXT_FIELDS)[number],
		label: string,
		o: { autocapitalize?: string; placeholder?: string; wide?: boolean; hint?: string } = {},
		area = false,
	): HTMLInputElement | HTMLTextAreaElement {
		const { row, id } = sheetField(parent, label, key);
		if (o.wide) row.addClass('is-wide');
		// Plain attribute names (no spread), so the colour rule of eslint.config.mjs can check them; null writes no attribute.
		const extra = { autocapitalize: o.autocapitalize ?? null, placeholder: o.placeholder ?? null };
		// D196 item 1: a name is not a sentence, so the keyboard adds no capital and no correction. A note is text, so it keeps the spell check.
		// born and died are free text (fictional calendars): never a numeric keyboard (spec §7.4).
		const input = area
			? row.createEl('textarea', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id, rows: 4, autocapitalize: extra.autocapitalize, placeholder: extra.placeholder, 'data-focus': `field:${key}` } })
			: row.createEl('input', {
					cls: ['dynasty-sheet-input', 'dynasty-input'],
					attr: { id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: extra.autocapitalize, placeholder: extra.placeholder, 'data-focus': `field:${key}` },
				});
		input.value = this.draft[key];
		if (key === 'born' || key === 'died') attachDateLine(row, input, () => readerOfTree(this.o.dates, this.data.tree) ?? this.data.g.dates.reader, this.o.dates?.onChange, (stop) => this.cleanup.push(stop));
		// Read-only, not disabled: the user can still select and copy the text.
		input.readOnly = this.readOnly;
		if (o.hint) {
			const hintId = `${id}-hint`;
			row.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: o.hint, attr: { id: hintId } });
			input.setAttribute('aria-describedby', hintId);
		}
		// A note is several text lines, so its Enter stays a new line.
		if (!area) endEntryOnEnter(input as HTMLInputElement);
		input.addEventListener('input', () => {
			this.draft[key] = input.value;
			this.clearError();
			// The button and its label follow the draft name and link (N1).
			if (key === 'link' || key === 'name') this.updateNoteButton();
			this.fieldChanged(key);
		});
		return input;
	}

	private select(parent: HTMLElement, key: 'house' | 'sex' | 'placement', label: string, options: [string, string][]): HTMLSelectElement {
		const { row, id } = sheetField(parent, label, key);
		const wrap = row.createDiv({ cls: 'dynasty-select' });
		const sel = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id, 'data-focus': `field:${key}` } });
		for (const [value, text] of options) sel.createEl('option', { text, attr: { value } });
		sel.value = this.draft[key];
		sel.disabled = this.readOnly;
		setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		return sel;
	}

	private houseField(parent: HTMLElement): void {
		const houses = this.data.tree.houses;
		const opts: [string, string][] = [['', SHEET.noHouse], ...houses.map((h): [string, string] => [h.id, h.name])];
		const current = this.base.house;
		if (current && !houses.some((h) => h.id === current)) opts.push([current, SHEET.unknownHouse(current)]);
		if (!this.readOnly) opts.push([NEW_HOUSE, SHEET.newHouse]);
		const sel = this.select(parent, 'house', SHEET.house, opts);
		sel.addEventListener('change', () => {
			this.draft.house = sel.value;
			this.fieldChanged('house');
		});
		if (this.readOnly) return;
		const form = parent.createDiv({ cls: ['dynasty-sheet-subform', 'is-wide'] });
		const name = sheetField(form, SHEET.newHouseName, 'new-house-name');
		const nameInput = name.row.createEl('input', {
			cls: ['dynasty-sheet-input', 'dynasty-input'],
			attr: { id: name.id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off' },
		});
		nameInput.value = this.newHouse.name;
		endEntryOnEnter(nameInput);
		nameInput.addEventListener('input', () => {
			this.newHouse.name = nameInput.value;
			this.clearError();
			this.fieldChanged('house');
		});
		const colour = sheetField(form, SHEET.newHouseColour, 'new-house-color');
		const colourInput = colour.row.createEl('input', { cls: 'dynasty-sheet-colour', attr: { id: colour.id, type: 'color' } });
		colourInput.value = this.newHouse.color;
		colourInput.addEventListener('input', () => {
			this.newHouse.color = colourInput.value;
			this.fieldChanged('house');
		});
		const show = () => form.toggle(sel.value === NEW_HOUSE);
		show();
		sel.addEventListener('change', () => {
			this.clearError();
			show();
			if (sel.value === NEW_HOUSE) nameInput.focus();
		});
	}

	private sexField(parent: HTMLElement): void {
		const opts: [string, string][] = [
			['', SHEET.sexNone],
			['m', SHEET.sexMale],
			['f', SHEET.sexFemale],
		];
		// D12: any value is valid; an unusual one stays selectable so the sheet never changes it by itself.
		if (this.base.sex && this.base.sex !== 'm' && this.base.sex !== 'f') opts.push([this.base.sex, SHEET.sexOther(this.base.sex)]);
		const sel = this.select(parent, 'sex', SHEET.sex, opts);
		sel.addEventListener('change', () => {
			this.draft.sex = sel.value;
			this.fieldChanged('sex');
		});
	}

	/** One tick box: the whole row is the label, so the hit area is the full row (spec §7.5). */
	private checkField(parent: HTMLElement, field: 'illegitimate' | 'childless', text: string, hintId?: string): void {
		const row = parent.createEl('label', { cls: 'dynasty-sheet-field dynasty-sheet-check dynasty-check', attr: { 'data-field': field } });
		const box = row.createEl('input', { attr: { type: 'checkbox', 'data-focus': `field:${field}` } });
		box.checked = this.draft[field];
		box.disabled = this.readOnly;
		row.createSpan({ cls: 'dynasty-sheet-label', text });
		if (hintId) box.setAttribute('aria-describedby', hintId);
		box.addEventListener('change', () => (this.draft[field] = box.checked));
	}

	private placementField(parent: HTMLElement): void {
		const choices = placementChoices(this.data.person);
		// Spec §6.3: only when the person has parents of more than one placement type.
		if (choices.length < 2) return;
		const opts: [string, string][] = choices.map((t) => [t, SHEET.placement[t] ?? t]);
		if (this.base.placement && !choices.includes(this.base.placement)) opts.push([this.base.placement, SHEET.placementOther(this.base.placement)]);
		const sel = this.select(parent, 'placement', SHEET.shownUnder, opts);
		sel.parentElement?.parentElement?.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: SHEET.shownUnderHint });
		sel.addEventListener('change', () => (this.draft.placement = sel.value));
	}

	// ---------- the sections (contract C) ----------

	/** Details: name, sobriquet, title text, house, sex, born, died, and the two tick boxes. */
	private detailsBody(body: HTMLElement): void {
		const grid = body.createDiv({ cls: 'dynasty-grid' });
		this.textField(grid, 'name', SHEET.name, { autocapitalize: 'off' });
		// D122: the card adds the quote marks, so the hint says so; a sobriquet usually starts with a small letter.
		this.textField(grid, 'sobriquet', SHEET.sobriquet, { autocapitalize: 'off', hint: SHEET.sobriquetHint });
		// D98: the hint points to the Titles section, which the window of a new person does not have.
		this.textField(grid, 'title', SHEET.title, { autocapitalize: 'off', wide: true, ...(this.isNew ? {} : { hint: SHEET.titleHint }) });
		this.houseField(grid);
		this.sexField(grid);
		this.textField(grid, 'born', SHEET.born);
		this.textField(grid, 'died', SHEET.died);
		const checks = grid.createDiv({ cls: ['dynasty-sheet-field', 'is-wide', 'dynasty-checks-field'] });
		const row = checks.createDiv({ cls: 'dynasty-checks' });
		const hintId = 'dynasty-sheet-childless-hint';
		this.checkField(row, 'illegitimate', SHEET.illegitimate);
		this.checkField(row, 'childless', SHEET.childless, hintId);
		checks.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: SHEET.childlessHint, attr: { id: hintId } });
		this.placementField(grid);
	}

	/** Notes: the linked note and the notes. */
	private notesBody(body: HTMLElement): void {
		const stack = body.createDiv({ cls: 'dynasty-stack' });
		this.textField(stack, 'link', SHEET.link, { placeholder: SHEET.linkPlaceholder, autocapitalize: 'off' });
		this.textField(stack, 'notes', SHEET.notes, {}, true);
	}

	// ---------- Family, Actions, Delete (spec §6.3) ----------

	/** A button of the window (a `dynasty-btn`): it does nothing while a write runs, and a failing action never leaves an exception (spec §8). */
	private button(parent: HTMLElement, text: string, cls: string, run: () => void, label?: string, icon?: string): HTMLButtonElement {
		const b = parent.createEl('button', { cls: ['dynasty-btn', cls], attr: { type: 'button', 'data-focus': cls } });
		if (icon) setIcon(b.createSpan({ cls: 'dynasty-btn-icon', attr: { 'aria-hidden': 'true' } }), icon);
		b.createSpan({ text });
		if (label) b.setAttribute('aria-label', label);
		b.addEventListener('click', () => {
			if (this.saving) return;
			try {
				run();
			} catch (e) {
				console.error('Crown and Kin: the sheet action failed', e);
			}
		});
		return b;
	}

	/** One action of the Actions section: a row with an icon, tapped as a whole. `danger` shows it in the error colour (Delete). */
	private actionRow(parent: HTMLElement, icon: string, text: string, cls: string, run: () => void, label?: string, danger = false): HTMLElement {
		const r = buildRow(parent, {
			tap: () => {
				if (this.saving) return;
				try {
					run();
				} catch (e) {
					console.error('Crown and Kin: the sheet action failed', e);
				}
			},
			cls: ['dynasty-action-row', cls, ...(danger ? ['is-danger', 'mod-warning'] : [])],
			attr: { 'data-focus': cls },
			...(label ? { label } : {}),
			chevron: false,
			lead: (row) => iconLead(row, icon),
		});
		r.title.setText(text);
		return r.row;
	}

	/**
	 * An "Add" link at a group heading of the Family section. It shows a plus mark and "Add"; a screen reader and voice control get the full
	 * name ("Add parent") from a hidden text, not from an aria-label, which Obsidian would show as a tooltip.
	 */
	private addLink(parent: HTMLElement, text: string, cls: string, run: () => void): HTMLButtonElement {
		const b = parent.createEl('button', { cls: ['dynasty-link', 'dynasty-add-link', cls], attr: { type: 'button', 'data-focus': cls } });
		setIcon(b.createSpan({ cls: 'dynasty-btn-icon', attr: { 'aria-hidden': 'true' } }), 'plus');
		b.createSpan({ text: FAMILY.addLink, attr: { 'aria-hidden': 'true' } });
		b.createSpan({ cls: 'dynasty-sr-only', text });
		b.addEventListener('click', () => {
			if (this.saving) return;
			try {
				run();
			} catch (e) {
				console.error('Crown and Kin: the sheet action failed', e);
			}
		});
		return b;
	}

	/** The name of a person in a row: the name, then the sobriquet in curly marks. */
	private rowName(title: HTMLElement, id: string): void {
		const p = this.data.g.byId.get(id);
		title.appendText(p?.name || id);
		if (p?.sobriquet) title.createSpan({ cls: 'dynasty-sob', text: ` ${quotedSobriquet(p.sobriquet)}` });
	}

	/** The relation word that a person row shows (D215), or undefined; the row's screen-reader name holds the same word. */
	private relationWord(id: string): { text: string } | undefined {
		const me = this.me();
		return me && (id === me || this.data.person.id === me) ? relationsFor(this.data.g, me, this.o.relationOptions).cards.get(id) : undefined;
	}

	/** WP-K: the words of the parent rows and child rows come from one request. Only the window of the marked person shows them (D215). */
	private warmRelationWords(fam: FamilyView): void {
		const me = this.me();
		if (!me || this.data.person.id !== me) return;
		relationsFor(this.data.g, me, this.o.relationOptions).cards.getMany([...fam.parents.map((l) => l.id), ...this.childrenOf().map((k) => k.id)]);
	}

	/**
	 * The second text line of a person row: the years, with the relation word to the marked person before them (the marked person in bold).
	 * D215: the word shows only in the window of the marked person. In another window it would read as a relation to that window's person
	 * ("Grandfather" for a father). "You" is a name, not a relation word, so it stays.
	 */
	private rowSub(sub: HTMLElement, id: string): void {
		const me = this.me();
		const word = this.relationWord(id);
		if (me && word) sub.createEl(id === me ? 'b' : 'i', { text: word.text });
		const p = this.data.g.byId.get(id);
		const dates = p ? dateLine(p, this.data.g.dates) : '';
		if (dates) sub.appendText(`${word ? ' · ' : ''}${dates}`);
	}

	private personRowLead(row: HTMLElement, id: string): void {
		const p = this.data.g.byId.get(id);
		personLead(row, { name: p?.name || id, ...(p?.portrait ? { portrait: p.portrait } : {}), ...(p?.portraitCrop ? { portraitCrop: p.portraitCrop } : {}) }, this.rowPictures ?? undefined);
	}

	/** The Family section: the three Add buttons, then Parents, Partners, Children and the place among the siblings (spec §6.3, G.7). */
	private familyBody(body: HTMLElement): void {
		const fam = this.data.fam;
		if (!fam) return;
		this.warmRelationWords(fam);

		const group = (key: string, heading: string, add?: { text: string; cls: string; run: () => void }) => this.familyGroup(body, key, heading, add);
		const parents = group('parents', FAMILY.parents, { text: FAMILY.addParent, cls: 'dynasty-add-parent', run: () => void addParent(this.flowHost()) });
		if (!fam.parents.length) parents.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-family-empty'], text: FAMILY.noParents });
		for (const link of fam.parents) this.parentRow(parents, fam, link);

		const partners = group('partners', FAMILY.partners, { text: FAMILY.addPartner, cls: 'dynasty-add-partner', run: () => void addPartner(this.flowHost()) });
		if (!fam.partners.length) partners.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-family-empty'], text: FAMILY.noPartners });
		for (const link of fam.partners) this.partnerRow(partners, link);

		// G.7: a child row opens that person in this window, with a way back.
		const children = group('children', WINDOW_UI.children, { text: FAMILY.addChild, cls: 'dynasty-add-child', run: () => void addChild(this.flowHost()) });
		const kids = this.childrenOf();
		if (!kids.length) children.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-family-empty'], text: WINDOW_UI.noChildren });
		for (const kid of kids) {
			const name = kid.name || kid.id;
			const r = buildRow(children, {
				tap: () => this.openPerson(kid.id),
				label: WINDOW_UI.openPersonLabel(name, this.relationWord(kid.id)?.text),
				cls: 'dynasty-family-row',
				attr: { 'data-child': kid.id },
				lead: (row) => this.personRowLead(row, kid.id),
			});
			r.title.addClass('dynasty-family-name');
			this.rowName(r.title, kid.id);
			this.rowSub(r.sub, kid.id);
		}

		this.siblingsGroup(body, fam);
	}

	/** D212: a group of the Family section: a heading with a quiet "+ Add" link at its right, then the rows. */
	private familyGroup(body: HTMLElement, key: string, heading: string, add?: { text: string; cls: string; run: () => void }): HTMLElement {
		const head = body.createDiv({ cls: 'dynasty-sub-row' });
		head.createDiv({ cls: 'dynasty-sub', text: heading });
		if (add && !this.readOnly) this.addLink(head, add.text, add.cls, add.run);
		return body.createDiv({ cls: ['dynasty-rows', 'dynasty-family-group'], attr: { 'data-family': key } });
	}

	/** The place among the siblings, with the two buttons that move the person; nothing for a person with no sibling group. */
	private siblingsGroup(body: HTMLElement, fam: FamilyView): void {
		const sib = fam.siblings;
		if (!sib) return;
		const place = this.familyGroup(body, 'siblings', FAMILY.siblings);
		const r = buildRow(place, { cls: 'dynasty-family-row' });
		r.title.addClass('dynasty-family-position');
		r.title.setText(FAMILY.position(sib.index + 1, sib.group.length));
		if (!this.readOnly) {
			const actions = r.actions();
			this.button(actions, FAMILY.moveEarlier, 'dynasty-move-earlier', () => void this.moveSibling('earlier')).disabled = !sib.canMoveEarlier;
			this.button(actions, FAMILY.moveLater, 'dynasty-move-later', () => void this.moveSibling('later')).disabled = !sib.canMoveLater;
		}
	}

	/**
	 * G.7: a child row opens that person in this window. With unsaved changes the window first asks "Discard changes?", because the
	 * draft belongs to the person on screen. The way back names the person that the user came from.
	 */
	private openPerson(id: string): void {
		if (this.isNew || this.gone || !this.data.g.byId.has(id)) return;
		const go = () => this.moveTo(id, true);
		if (this.isDirty()) this.showConfirm({ title: SHEET.discardTitle, text: [SHEET.discardText], confirm: SHEET.discard, confirmCls: 'dynasty-sheet-discard', keep: SHEET.keepEditing, onConfirm: go });
		else go();
	}

	/** The back link: the person before, with the same question when the draft has changes. */
	private goBackTo(): void {
		const to = this.trail[this.trail.length - 1];
		if (to === undefined) return;
		const go = () => this.moveTo(to, false);
		if (this.isDirty()) this.showConfirm({ title: SHEET.discardTitle, text: [SHEET.discardText], confirm: SHEET.discard, confirmCls: 'dynasty-sheet-discard', keep: SHEET.keepEditing, onConfirm: go });
		else go();
	}

	/** Shows another person of the same tree in this window, from the body that the window holds now. */
	private moveTo(id: string, forward: boolean): void {
		const was = this.data.person.id;
		const fresh = this.fresh();
		if (!fresh) return;
		const r = loadSheet(this.o.handle.body, id, this.o.dates);
		if (r.kind !== 'ok') return;
		if (forward) this.trail.push(was);
		else this.trail.pop();
		this.dropPortrait();
		this.data = r.data;
		this.base = this.baseOf(r.data);
		this.draft = { ...this.base };
		this.newHouse = blankHouse();
		this.gone = false;
		this.status = '';
		this.build();
		if (this.bodyEl) this.bodyEl.scrollTop = 0;
	}

	/** The marked person, if the tree has a mark that names a person (spec §13.1). */
	private me(): string | null {
		return validMe(this.data.g, this.data.tree.options.me);
	}

	/**
	 * Spec §13.1, D146: what the relation text line shows for this person, or null when nothing shows (a new person, a tree with no mark).
	 * The names come from the whole tree, as on the cards. Show the line is not on the marked person's own sheet.
	 */
	private makeRelationView(): RelationView | null {
		if (this.isNew || !this.data.fam) return null;
		const me = this.me();
		if (me === null) return null;
		const p = this.data.person;
		const v: RelationView = relationInfo(relationsFor(this.data.g, me, this.o.relationOptions).all.get(p.id), p.id === me);
		const finder = this.o.finder;
		if (v.kind !== 'me' && finder && !this.gone) v.showLine = { label: ME_UI.showLine, aria: ME_UI.showLineLabel(p.name || p.id), run: () => this.leaveFor(() => finder.show(me, p.id)) };
		return v;
	}

	/** D147: a window that crosses 600 px (a turn, a resize) draws again, because a phone has a bar and a computer has a footer. The build keeps the draft and the focus. */
	private relLayout(): void {
		// The first layout runs inside `phoneLayout`, before the first build.
		if (this.bodyEl === null || this.closed) return;
		if (this.modalEl.hasClass('is-phone') !== this.builtPhone) this.build();
	}

	private parentRow(parent: HTMLElement, fam: FamilyView, link: ParentLink): void {
		const name = this.name(link.id);
		const r = buildRow(parent, { cls: 'dynasty-family-row', attr: { 'data-parent': link.id, 'data-type': link.type }, lead: (row) => this.personRowLead(row, link.id) });
		r.title.addClass('dynasty-family-name');
		this.rowName(r.title, link.id);
		this.rowSub(r.sub, link.id);
		const controls = r.actions();
		controls.addClass('dynasty-family-controls');
		const chip = controls.createSpan({ cls: 'dynasty-chip-select' });
		// The name comes from a hidden text, not from an aria-label: Obsidian shows an aria-label as a tooltip over the chip.
		const chipId = `dynasty-chip-${++EditSheet.chipCounter}`;
		chip.createSpan({ cls: 'dynasty-sr-only', text: FAMILY.parentTypeLabel(name), attr: { id: chipId } });
		const sel = chip.createEl('select', { cls: ['dropdown', 'dynasty-family-select'], attr: { 'aria-labelledby': chipId, 'data-focus': 'parent-type' } });
		for (const t of PARENT_TYPES) sel.createEl('option', { text: parentTypeText(t), attr: { value: t } });
		this.paintParentSelect(sel, fam, link);
		sel.disabled = this.readOnly;
		setIcon(chip.createSpan({ cls: 'dynasty-chip-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		sel.addEventListener('change', () => {
			const now = this.parentSelects.get(sel) ?? link;
			const to = sel.value as ParentKind;
			if (to === now.type) return;
			// The page changes in place after the write: this select is never taken out of the page while the user uses it.
			void this.writeWithDraft([{ kind: 'set-parent-type', child: this.data.person.id, parent: now.id, from: now.type, to }], this.data.person.id, 'in-place').then(
				(out) => {
					const cur = this.parentSelects.get(sel);
					if (!out && cur) sel.value = cur.type;
				},
				(e) => console.error('Crown and Kin: cannot change the type of the parent', e),
			);
		});
		if (this.readOnly) return;
		iconButton(controls, 'x', FAMILY.removeParentLabel(name), () => void this.removeParent(this.parentSelects.get(sel) ?? link), { cls: 'dynasty-remove-parent', focus: 'dynasty-remove-parent' });
	}

	/** Sets what a parent-type select derives from the parent types: the link it answers for, its value, and the types that are full. */
	private paintParentSelect(sel: HTMLSelectElement, fam: FamilyView, link: ParentLink): void {
		this.parentSelects.set(sel, link);
		const count = (t: string) => fam.parents.filter((l) => l.type === t).length;
		for (const opt of Array.from(sel.querySelectorAll<HTMLOptionElement>('option'))) {
			const t = opt.getAttribute('value') as ParentKind;
			// A type that has its most parents already is full (spec §4.2, `PARENT_LIMIT`).
			opt.disabled = t !== link.type && count(t) >= PARENT_LIMIT[t];
		}
		sel.value = link.type;
	}

	/**
	 * r032: shows the result of a changed parent type without a build. The select that the user used stays in the page (a native select
	 * that is taken out under the finger can keep its phone menu open), so only what depends on the types is set again: the rows of
	 * the parents, the relation text line, the place among the siblings, the Titles section and the summaries. A page that differs from
	 * what a build gives (the rows are not there, the person did not load) is built again.
	 */
	private showParentTypes(body: string, ids?: ReadonlyMap<string, string>): void {
		const id = ids?.get(this.data.person.id) ?? this.data.person.id;
		const r = loadSheet(body, id, this.o.dates);
		const fam = r.kind === 'ok' ? r.data.fam : null;
		const rows = this.bodyEl ? Array.from(this.bodyEl.querySelectorAll<HTMLElement>('.dynasty-family-row[data-parent]')) : [];
		if (r.kind !== 'ok' || !fam || rows.length !== fam.parents.length) {
			this.afterWrite(body, ids);
			return;
		}
		// A build hides an old refusal or stale message; the in-place path must too.
		this.clearError();
		const placementBefore = this.placementSig();
		const was = this.base;
		const firstId = id !== this.data.person.id;
		this.data = r.data;
		// The write gave the sheet person a first id: the "ID" line at the end of the body appears, as after a build.
		const actions = firstId ? this.bodyEl?.querySelector<HTMLElement>('.dynasty-actions-list')?.parentElement : null;
		if (actions) {
			actions.querySelector('.dynasty-sheet-id')?.remove();
			this.idLine(actions);
		}
		this.base = this.baseOf(r.data);
		// A field that the user did not change follows the note (the shown-under type comes from the parent types); text typed since stays.
		const next = { ...this.base };
		for (const k of Object.keys(next) as (keyof Draft)[]) if (this.draft[k] !== was[k]) (next as Record<string, unknown>)[k] = this.draft[k];
		this.draft = next;
		this.gone = false;
		this.relView = this.makeRelationView();
		this.warmRelationWords(fam);
		fam.parents.forEach((link, i) => {
			const row = rows[i];
			// The id of a parent with no written id changes with the write; the row follows the parent by its place in the list.
			row.setAttribute('data-parent', link.id);
			row.setAttribute('data-type', link.type);
			const sub = row.querySelector<HTMLElement>('.dynasty-row-sub');
			if (sub) {
				sub.empty();
				this.rowSub(sub, link.id);
			}
			const sel = row.querySelector<HTMLSelectElement>('select.dynasty-family-select');
			if (sel) this.paintParentSelect(sel, fam, link);
		});
		this.paintRelation();
		this.paintSiblings(fam);
		if (this.placementSig() !== placementBefore) this.paintPlacement();
		const titles = this.sections?.el('titles')?.querySelector<HTMLElement>('.dynasty-section-body');
		if (titles) {
			titles.empty();
			titlesBody(titles, this.titlesHost());
		}
		this.head?.paint();
		this.sections?.setSummary('family', this.familySummary());
		this.sections?.setSummary('titles', titlesSummary(this.titlesHost()));
		this.updateSummaries();
		this.shell?.checkOverflow();
	}

	/** What decides the field "Shown under": the types the person has parents of, and the type that the note has. */
	private placementSig(): string {
		return `${placementChoices(this.data.person).join(',')}|${this.base.placement}`;
	}

	/** Makes the field "Shown under" again, as the last field of Details: a type change can show it, hide it or change its choices. It is not the select that the user used. */
	private paintPlacement(): void {
		const grid = this.sections?.el('details')?.querySelector<HTMLElement>('.dynasty-grid');
		if (!grid) return;
		grid.querySelector('select[data-focus="field:placement"]')?.parentElement?.parentElement?.remove();
		this.placementField(grid);
	}

	/** A text of the relation line that changes when the relation changes; the line is drawn again only then (its "more" text keeps its state). */
	private relationSig(): string {
		return JSON.stringify(this.relView, (_k, v: unknown) => (typeof v === 'function' ? undefined : v));
	}

	/** Draws the relation text lines of the header again, if the relation to the marked person changed. */
	private paintRelation(): void {
		const host = this.relHost;
		const sig = this.relationSig();
		if (!host || sig === this.relSig) return;
		this.relSig = sig;
		for (const el of Array.from(host.children)) {
			if (el.hasClass('dynasty-head-rel') || el.hasClass('dynasty-relation-also') || el.hasClass('dynasty-relation-maybe')) el.remove();
		}
		if (this.relView) renderRelationLine(host, this.relView);
	}

	/** Draws the place among the siblings again: a type change can give a person a sibling group, or take it away. It stands last in the section. */
	private paintSiblings(fam: FamilyView): void {
		const old = this.bodyEl?.querySelector<HTMLElement>('[data-family="siblings"]');
		const body = (this.bodyEl?.querySelector<HTMLElement>('[data-family="parents"]'))?.parentElement;
		if (!body) return;
		if (old) {
			// The heading stands just before its group.
			const kids = Array.from(body.children);
			kids[kids.indexOf(old) - 1]?.remove();
			old.remove();
		}
		this.siblingsGroup(body, fam);
	}

	private partnerRow(parent: HTMLElement, link: PartnerLink): void {
		const name = this.name(link.partner);
		const r = buildRow(parent, {
			cls: 'dynasty-family-row',
			attr: { 'data-partner': link.partner, 'data-union': link.union ? String(link.union.index) : 'none' },
			lead: (row) => this.personRowLead(row, link.partner),
		});
		r.title.addClass('dynasty-family-name');
		this.rowName(r.title, link.partner);
		r.sub.addClass('dynasty-family-detail');
		r.sub.setText(`⚭ ${partnerDetail(link.type, link.start, link.end)}`);
		// The box of the end controls stands also when it is empty, so the pictures of the rows keep one vertical line.
		const controls = r.actions();
		controls.addClass('dynasty-family-controls');
		if (this.readOnly || !link.union) return;
		textButton(controls, ['dynasty-link', 'dynasty-edit-union'], FAMILY.edit, () => void this.editPartnership(link), { label: FAMILY.editLabel(name), focus: 'dynasty-edit-union' });
		iconButton(controls, 'x', FAMILY.removePartnershipLabel(name), () => this.confirmRemovePartnership(link), { cls: 'dynasty-remove-union', focus: 'dynasty-remove-union' });
	}

	/** The Actions section (spec §6.3); `me` is the marked person (spec §13.1), or null. Delete and the ID line stand last. */
	private actionsBody(body: HTMLElement, me: string | null): void {
		const list = body.createDiv({ cls: ['dynasty-rows', 'dynasty-actions-list'] });
		const p = this.data.person;
		const focus = this.o.focus;
		if (focus && !this.gone) this.actionRow(list, 'crosshair', FOCUS_UI.focusHere, 'dynasty-focus-here', () => this.leaveFor(() => focus.here(p.id)), FOCUS_UI.focusHereLabel(p.name));
		if (!this.readOnly) {
			// D18: one pin per tree; the pinned person's sheet offers to remove it.
			if (this.data.tree.options.focus === p.id) this.actionRow(list, 'pin', FOCUS_UI.unpin, 'dynasty-unpin', () => void this.pin(false), FOCUS_UI.unpinLabel(p.name));
			else this.actionRow(list, 'pin', FOCUS_UI.pin, 'dynasty-pin', () => void this.pin(true), FOCUS_UI.pinLabel(p.name));
			// Spec §13.1: one mark per tree; the marked person's sheet offers to remove it.
			if (me === p.id) this.actionRow(list, 'user-check', ME_UI.unmark, 'dynasty-unmark-me', () => void this.markMe(false), ME_UI.unmarkLabel(p.name));
			else this.actionRow(list, 'user-check', ME_UI.mark, 'dynasty-mark-me', () => void this.markMe(true), ME_UI.markLabel(p.name));
		}
		// Spec §13.10: Hide descendants and Show descendants write nothing, so they are in a read-only tree too; not for a new person.
		const folds = this.o.folds;
		if (folds && !this.isNew && !this.gone) {
			const state = folds.state(p.id);
			if (state.open.length) this.actionRow(list, 'fold-vertical', FOLD_UI.hideDescendants, 'dynasty-hide-descendants', () => this.leaveFor(() => folds.hide(p.id)), FOLD_UI.hideDescendantsLabel(p.name));
			if (state.folded.length) this.actionRow(list, 'fold-vertical', FOLD_UI.showDescendants, 'dynasty-show-descendants', () => this.leaveFor(() => folds.show(p.id)), FOLD_UI.showDescendantsLabel(p.name));
		}
		const finder = this.o.finder;
		if (finder && !this.gone) this.actionRow(list, 'git-branch', ME_UI.showRelationTo, 'dynasty-relation-to', () => void this.relationTo(finder), ME_UI.showRelationToLabel(p.name));
		// Spec §13.11: Make a note / Make the linked note, before Open link.
		if (!this.readOnly) {
			this.noteSlot = list.createDiv({ cls: 'dynasty-note-slot' });
			this.updateNoteButton();
		}
		// D218 item 9: "Open linked note" stands in the row under the header (`openNoteLink`), not here.
		if (!this.readOnly) this.actionRow(list, 'trash-2', FAMILY.deletePerson, 'dynasty-delete-person', () => this.confirmDelete(), undefined, true);
		this.idLine(body);
	}

	// ---------- Make a note (spec §13.11) ----------

	/** N1: which button the draft offers, or null. Not in a read-only sheet, a gone person or a new person. */
	private noteMode(): MakeNoteMode | null {
		if (this.readOnly || this.isNew) return null;
		const link = this.draft.link.trim();
		if (link === '') return 'new';
		const lp = linkedNotePath(link);
		if (!lp) return null;
		const dest = this.app.metadataCache.getFirstLinkpathDest(lp.path.replace(/\.md$/i, ''), this.o.sourcePath);
		return dest ? null : 'linked';
	}

	/** Shows, changes or removes the button when the draft name or link changes; it keeps the button when nothing changed. */
	private updateNoteButton(): void {
		const slot = this.noteSlot;
		if (!slot) return;
		const mode = this.noteMode();
		const name = this.draft.name.trim() || this.data.person.name || SHEET.unnamed;
		const key = mode ? `${mode}|${name}` : '';
		if (key === this.noteKey) return;
		this.noteKey = key;
		slot.empty();
		if (!mode) return;
		const text = mode === 'new' ? NOTE_UI.make : NOTE_UI.makeLinked;
		const label = mode === 'new' ? NOTE_UI.makeLabel(name) : NOTE_UI.makeLinkedLabel(name);
		this.actionRow(slot, 'file-text', text, 'dynasty-make-note', () => void this.makeNoteFlow(mode), label);
	}

	/** N2, N3: the flow, then what the sheet shows for its result. A busy flag covers the whole flow. */
	private async makeNoteFlow(mode: MakeNoteMode): Promise<void> {
		if (this.noteBusy || this.saving || this.readOnly || this.isNew) return;
		this.noteBusy = true;
		const p = this.data.person;
		const wanted = mode === 'linked' ? (linkedNotePath(this.draft.link.trim())?.name ?? '') : personNoteName({ name: this.draft.name });
		try {
			const out = await makePersonNote({
				app: this.app,
				mode,
				personId: p.id,
				name: this.draft.name,
				link: this.draft.link.trim(),
				sourcePath: this.o.sourcePath,
				loadedBody: this.data.body,
				ready: () => this.pendingOps() !== null && this.fresh(),
				alive: () => this.shown && !this.gone && !this.closing,
				handle: this.o.handle,
				ask: (name, free) => this.askSameName(name, free),
				write: (link) => this.writeWithDraft([{ kind: 'set-person-fields', id: p.id, fields: { link } }]),
			});
			this.afterNote(out, mode, wanted, p.id);
		} catch (e) {
			console.error('Crown and Kin: cannot make the note', e);
			new Notice(NOTE_UI.cannot(wanted));
		} finally {
			this.noteBusy = false;
		}
	}

	/** The Notices and the next step for the result of the flow (N2 steps 6 and 7, N3). */
	private afterNote(out: MakePersonNoteOutcome, mode: MakeNoteMode, wanted: string, was: string): void {
		const open = (file: TFile) => {
			const go = () => openMadeNote(this.app, file);
			if (this.o.openNote) this.o.openNote(go);
			else void go().catch((e) => console.error('Crown and Kin: cannot open the note', e));
		};
		switch (out.kind) {
			case 'made':
			case 'linked-existing': {
				if (out.written) {
					this.noteNotice(out.kind === 'made' ? NOTE_UI.made(out.file.basename) : NOTE_UI.linkedTo(out.file.basename), out.written as DraftWritten, out.file.basename, was);
					this.finish();
					open(out.file);
				} else if (mode === 'linked') this.leaveFor(() => open(out.file));
				return;
			}
			case 'made-linked':
				new Notice(NOTE_UI.madeOnly(out.file.basename));
				// The tree is not written in this mode, so unsaved changes are asked about before the sheet closes.
				this.leaveFor(() => open(out.file));
				return;
			case 'link-not-added':
				new Notice(NOTE_UI.linkNotAdded(out.file.basename));
				return;
			case 'failed':
				new Notice(NOTE_UI.cannot(wanted));
				return;
			case 'stale':
				this.stale(this.o.handle.body);
				return;
			default:
				return;
		}
	}

	/** N4: the success Notice with Undo. Undo reverts the whole write; the note stays in the vault. */
	private noteNotice(text: string, out: DraftWritten, name: string, was: string): void {
		const h = this.o.handle;
		// One Notice after Undo: the note text replaces the generic one (spec §13.11).
		undoNotice(
			out.withFields ? `${text} ${REMOVE.undoAlso}` : text,
			h,
			out.body,
			() => {
				if (!this.shown) return;
				const id = this.data.person.id;
				this.reload(h.body, id !== was && loadSheet(h.body, id, this.o.dates).kind === 'gone' ? was : id);
			},
			NOTE_UI.undone(name),
		);
	}

	/** The same-name question (N2 step 2): resolves with the choice, and with Cancel if the question goes away. */
	private askSameName(name: string, free: string): Promise<SameNameAnswer> {
		return new Promise((resolve) => {
			this.hideConfirm();
			this.rememberFocus();
			let settled = false;
			const settle = (answer: SameNameAnswer) => {
				if (settled) return;
				settled = true;
				this.dismissQuestion = null;
				resolve(answer);
			};
			const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
			this.confirmEl = layer;
			this.dismissQuestion = () => settle('cancel');
			const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
			box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: NOTE_UI.askTitle(name) });
			const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
			const choice = (text: string, cls: string, answer: SameNameAnswer) => {
				const b = row.createEl('button', { cls, text, attr: { type: 'button' } });
				b.addEventListener('click', () => {
					settle(answer);
					this.hideConfirm();
				});
				return b;
			};
			const cancel = choice(NOTE_UI.askCancel, 'dynasty-sheet-keep', 'cancel');
			choice(NOTE_UI.askLink, 'dynasty-note-ask-link', 'link');
			choice(NOTE_UI.askNew(free), 'dynasty-note-ask-new', 'new');
			cancel.focus();
		});
	}

	/** Settles the same-name question as Cancel, if one waits. */
	private settleQuestion(): void {
		const d = this.dismissQuestion;
		this.dismissQuestion = null;
		d?.();
	}

	/** Closes the sheet, then runs `then`; with unsaved changes, only after "Discard changes?". */
	private leaveFor(then: () => void): void {
		const go = () => {
			this.finish();
			then();
		};
		if (this.isDirty()) this.showConfirm({ title: SHEET.discardTitle, text: [SHEET.discardText], confirm: SHEET.discard, confirmCls: 'dynasty-sheet-discard', keep: SHEET.keepEditing, onConfirm: go });
		else go();
	}

	/**
	 * Pin focus here / Remove pin (D18): writes or removes `options.focus`, with the draft in the same
	 * write like the other actions. Both end the session focus, so every view shows the new pin, or
	 * after Remove pin the default. The sheet stays open and shows the other button.
	 */
	private async pin(on: boolean): Promise<void> {
		const h = this.o.handle;
		const before = h.state.focus;
		// Before the write: the redraw that follows it can run before the write returns.
		h.state.focus = null;
		const restoreOwn = this.o.focus?.pinning?.() ?? (() => undefined);
		// Not an edit of the person (no highlight, no last edited person): after Remove pin a phone opens on the start person again (D20).
		const out = await this.writeWithDraft([{ kind: 'set-option', key: 'focus', value: on ? this.data.person.id : null }], null);
		if (out) return;
		// Nothing was written: the views show what they showed before.
		if (h.state.focus === null) h.state.focus = before;
		restoreOwn();
		this.o.focus?.changed();
	}

	/**
	 * This is me / Remove "This is me" (spec §13.1): writes or removes `options.me`, with the draft in
	 * the same write (§6.3). It moves the mark from anyone else (one line). Not an edit of the person:
	 * no highlight, no last edited person. The sheet stays open and shows the other button.
	 */
	private async markMe(on: boolean): Promise<void> {
		await this.writeWithDraft([{ kind: 'set-option', key: 'me', value: on ? this.data.person.id : null }], null);
	}

	/**
	 * Show the relation to… (spec §13.2): the picker with every other person and no "Create" row, the
	 * marked person first. The picked person is the first person of the finder, this person the second.
	 */
	private async relationTo(finder: NonNullable<SheetBase['finder']>): Promise<void> {
		const p = this.data.person;
		const me = this.me();
		const picked = await pickPerson(this.app, this.data.g, new Set([p.id]), FINDER_UI.placeholder, FINDER_UI.otherTitle, false, me !== p.id ? me : null, null, this.pickerContext());
		if (picked?.kind !== 'person' || !this.shown) return;
		this.leaveFor(() => finder.show(picked.id, p.id));
	}

	/**
	 * D106: "Id: p12", a small grey text line at the very end of the body. Only for a person whose id is
	 * written in the tree text: a person with no id has only the `~N` name that the tree gives them.
	 */
	private idLine(parent: HTMLElement): void {
		const id = this.data.person.id;
		if (this.gone || !this.data.g.byId.has(id) || unwritten(this.data, id)) return;
		parent.createDiv({ cls: ['dynasty-sheet-id', 'dynasty-id'], text: SHEET.idLine(id) });
	}

	/** What the Titles section (spec §13.4) uses of the sheet: its data, its draft and its writes. */
	private titlesHost(): TitlesHost {
		return {
			app: this.app,
			data: () => ({ body: this.data.body, g: this.data.g, person: this.data.person }),
			readOnly: this.readOnly,
			draftTitle: () => this.draft.title.trim(),
			ready: () => this.pendingOps() !== null && this.fresh(),
			write: async (ops) => !!(await this.writeWithDraft(ops)),
			writeRemoval: async (ops, text) => {
				const was = this.data.person.id;
				const out = await this.writeWithDraft(ops);
				if (out) this.removedNotice(text, out, was);
				return !!out;
			},
			lastError: () => this.lastError,
			button: (parent, text, cls, run, label, icon) => this.button(parent, text, cls, run, label, icon),
		};
	}

	private flowHost(): FlowHost {
		const fam = this.data.fam!;
		return {
			app: this.app,
			g: this.data.g,
			person: this.data.person,
			fam,
			name: (id) => this.name(id),
			ready: () => this.pendingOps() !== null && this.fresh(),
			commit: (ops, highlight) => this.writeWithDraft(ops, highlight),
			openNew: (rel, name) => this.openNew(rel, name),
			// D211: the lists of Add parent, Add child and Add partner name no relation, unless this window is about the marked person: the words say "to You", and in the window of another person they would be read as relations to that person.
			picker: () => ({ ...this.pickerContext(), ...(this.me() === this.data.person.id ? {} : { me: null }) }),
		};
	}

	/** The rows of the person picker: portraits, the marked person for the relation word, and the relation settings (G.3). */
	private pickerContext(): PickerContext {
		const me = this.me();
		return { ...(this.o.pictures ? { pictures: this.o.pictures } : {}), sourcePath: this.o.sourcePath, me, ...(this.o.relationOptions ? { relationOptions: this.o.relationOptions } : {}) };
	}

	private openNew(rel: NewRelation, name?: string): void {
		const sheet = EditSheet.createNew(this.app, { handle: this.o.handle, sourcePath: this.o.sourcePath, beforeWrite: this.o.beforeWrite, openNote: this.o.openNote, newPerson: rel, initialName: name, parentSheet: this, place: this.o.place, pictures: this.o.pictures, folds: this.o.folds, relationOptions: this.o.relationOptions, dates: this.o.dates });
		sheet?.open();
	}

	// ---------- writes ----------

	/**
	 * The draft as ops for a relationship write (spec §6.3: the same write). Null, with the reason
	 * shown, if the draft cannot be written; empty if nothing changed.
	 */
	pendingOps(): Op[] | null {
		if (this.readOnly || this.isNew || !this.isDirty()) return [];
		if (!this.validate()) return null;
		const op = this.buildOp();
		return op ? [op] : [];
	}

	/** True if the draft has a name, and a name for a new house; otherwise shows what is missing. */
	private validate(): boolean {
		if (this.draft.name.trim() === '') {
			this.showError(SHEET.needName);
			return false;
		}
		if (this.draft.house === NEW_HOUSE && this.newHouse.name.trim() === '') {
			this.showError(SHEET.needHouseName);
			return false;
		}
		return true;
	}

	/** True if the sheet shows the handle's current body; otherwise the stale message and false. */
	private fresh(): boolean {
		return freshOrStale(this.o.handle, this.data.body, (body) => this.stale(body));
	}

	private buildOp(): Op | null {
		const fields = this.changedFields();
		if (this.draft.house === NEW_HOUSE) {
			// The id that add-house gives the new house in this body (spec §6.8), so both go in one write.
			const name = this.newHouse.name.trim();
			const house = newHouseId(this.data.data, name);
			return {
				kind: 'batch',
				ops: [
					{ kind: 'add-house', name, color: this.newHouse.color },
					{ kind: 'set-person-fields', id: this.data.person.id, fields: { ...fields, house } },
				],
			};
		}
		if (!Object.keys(fields).length) return null;
		return { kind: 'set-person-fields', id: this.data.person.id, fields };
	}

	/** The ops that add the new person and their relationship (spec §6.2 positions, §6.4). */
	private newPersonOps(id: string, taken: string[]): Op[] {
		const rel = this.rel!;
		const fields = this.changedFields();
		delete fields.placement;
		// The start house (D16) is in the base, so it is not a change; a new person still needs it written.
		if (fields.house === undefined && this.draft.house !== '' && this.draft.house !== NEW_HOUSE) fields.house = this.draft.house;
		const ops: Op[] = [];
		if (this.draft.house === NEW_HOUSE) {
			const name = this.newHouse.name.trim();
			// A house the parent sheet's draft adds in the same write takes its id first.
			const data = (this.data.data ?? {}) as { houses?: unknown[] };
			const houses = [...(Array.isArray(data.houses) ? data.houses : []), ...taken.map((t) => ({ id: t }))];
			ops.push({ kind: 'add-house', name, color: this.newHouse.color });
			fields.house = newHouseId({ ...data, houses }, name);
		}
		switch (rel.kind) {
			case 'person':
				ops.push({ kind: 'add-person', id, fields });
				break;
			case 'parent':
				ops.push({ kind: 'add-person', id, fields, at: { kind: 'before', id: rel.child } }, { kind: 'add-parent', child: rel.child, parent: id, type: rel.type });
				break;
			case 'child': {
				const parents = rel.other === null ? [rel.parent] : [rel.parent, rel.other];
				ops.push({ kind: 'add-person', id, fields, parents: parents.map((p) => ({ id: p, type: 'birth' as ParentKind })), at: { kind: 'after-siblings', parents, ...(rel.union ? { union: rel.union } : {}) } });
				break;
			}
			case 'partner':
				ops.push({ kind: 'add-person', id, fields, at: { kind: 'after', id: rel.partner } }, unionOp(rel.partner, id, this.unionType));
				break;
		}
		return ops;
	}

	/**
	 * One write through the handle, with the stale check first (spec §6.1). `highlight` is the
	 * person the tree shows and highlights after the write (spec §5.5). Failures are reported in a
	 * Notice and in the sheet, and the draft stays.
	 */
	private async write(ops: Op[], highlight: string | null): Promise<Written | null> {
		if (this.saving || this.readOnly || !ops.length) return null;
		const h = this.o.handle;
		// The handle already knows of a change the user has not seen: same result as a stale write.
		if (!this.fresh()) return null;
		const op: Op = ops.length === 1 ? ops[0] : { kind: 'batch', ops };
		this.saving = true;
		this.modalEl.addClass('is-saving');
		// F6: a write of a large tree ends with a long draw of the tree. The sign must be on the screen before that work starts.
		const slow = this.data.g.people.length >= SLOW_SAVE_PEOPLE;
		if (slow) this.showSaving(true);
		const prev = { lastEdited: h.state.lastEdited, highlight: h.state.highlight, shown: h.state.shown };
		const restore = () => {
			h.state.lastEdited = prev.lastEdited;
			h.state.highlight = prev.highlight;
			h.state.shown = prev.shown;
		};
		// Set before the write: the re-render that follows can run before the write returns.
		if (highlight) {
			h.state.lastEdited = highlight;
			h.state.highlight = { id: highlight, until: performance.now() + 3000 };
			h.state.shown = { id: highlight, place: this.o.place ?? 'embed' };
		}
		try {
			if (slow) await afterPaint(this.modalEl.win ?? window);
			this.o.beforeWrite?.();
			const out = await h.write(op);
			if (out.ok) {
				this.foldsWritten(highlight, out.created);
				return out;
			}
			restore();
			this.failed(out);
			return null;
		} catch (e) {
			console.error('Crown and Kin: cannot save', e);
			restore();
			this.refused(WRITE_TEXT.failed);
			return null;
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
			if (slow) this.showSaving(false);
		}
	}

	/** F6: the sign that a write runs: the Save button and the status line say "Wait" until the write ends. */
	private showSaving(on: boolean): void {
		this.shell?.save?.setText(on ? SHEET.saveWait : SHEET.save);
		this.statusEl?.setText(on ? SHEET.savingStatus : this.status);
		this.statusEl?.toggle(on || this.status !== '');
	}

	/** F12: tells the tree view about an ok write, so a person the fold hides (the sheet's or an added one) shows. It never fails the write. */
	private foldsWritten(highlight: string | null, created: readonly string[]): void {
		const folds = this.o.folds;
		if (!folds) return;
		const own = highlight ?? (this.isNew ? null : this.data.person.id);
		try {
			folds.written([...new Set([...(own ? [own] : []), ...created])]);
		} catch (e) {
			console.error('Crown and Kin: cannot show the people that folds hide', e);
		}
	}

	private failed(out: Exclude<HandleWriteOutcome, { ok: true }>): void {
		const h = this.o.handle;
		// A failed Save never discards the draft: the user can copy the text or Cancel.
		onWriteFailed(out, {
			stale: () => this.stale(h.body),
			missing: () => this.refused(WRITE_TEXT.missing),
			refused: (code) => {
				if (code === 'unknown-person' && !this.isNew) this.markGone();
				else if (code === 'blocked') {
					new Notice(WRITE_TEXT.blocked);
					this.reload(h.body);
				} else if (code === 'invalid-yaml') this.refused(WRITE_TEXT.invalid);
				// A partnership, title or holder that the sheet showed is not in the tree now: the tree changed.
				else if (code === 'unknown-union' || code === 'unknown-person' || code === 'unknown-title' || code === 'unknown-holder' || code === 'id-taken') this.stale(h.body);
				else if (code === 'cycle') this.refused(WRITE_TEXT.cycle);
				else if (code === 'limit') this.refused(WRITE_TEXT.limit(this.limitType));
				else if (code === 'no-sibling') this.refused(WRITE_TEXT.noSibling);
				else this.refused(WRITE_TEXT.refused);
			},
		});
	}

	/**
	 * A relationship action with the draft in the same write; the sheet stays open and shows the
	 * result. A person of the write with no written id gets one in it; the sheet's own person always
	 * does, so the sheet follows them by that id afterwards. `show`: 'in-place' updates the page without a build (see `showParentTypes`).
	 */
	private async writeWithDraft(ops: Op[], highlight: string | null = this.data.person.id, show: 'build' | 'in-place' = 'build'): Promise<DraftWritten | null> {
		this.lastError = '';
		const pending = this.pendingOps();
		if (pending === null) return null;
		const all = [...pending, ...ops];
		// The refusal `limit` says which type is full: the text differs for a rumoured parent (contract B.3).
		this.limitType = ops.map((op) => (op.kind === 'add-parent' ? op.type : op.kind === 'set-parent-type' ? op.to : undefined)).find((t) => t !== undefined);
		const ids = idsFor(this.data, [this.data.person.id, ...namesIn(all), ...holderNames(all)]);
		const out = await this.write(withIds(all, ids), highlight === null ? null : (ids.get(highlight) ?? highlight));
		if (!out) return null;
		// 'in-place' is for a control that the user is using now (r032). A write that carries field changes needs the full form again.
		if (show === 'in-place' && pending.length === 0) this.showParentTypes(out.body, ids);
		else this.afterWrite(out.body, ids);
		return { ...out, withFields: pending.length > 0 };
	}

	/**
	 * The Notice with Undo after a removal. Undo reverts the whole write, so the Notice says when
	 * the write also saved field changes; after Undo the open sheet shows the restored data. `was`:
	 * the person's id before the write, which Undo gives back if the write gave them their first id.
	 */
	private removedNotice(text: string, out: DraftWritten, was: string): void {
		const h = this.o.handle;
		undoNotice(out.withFields ? `${text} ${REMOVE.undoAlso}` : text, h, out.body, () => {
			if (!this.shown) return;
			const id = this.data.person.id;
			// reload, not afterWrite: text typed after the removal stays in the draft.
			this.reload(h.body, id !== was && loadSheet(h.body, id, this.o.dates).kind === 'gone' ? was : id);
		});
	}

	private async save(another = false): Promise<void> {
		if (this.saving || this.readOnly) return;
		if (!this.validate()) return;
		if (!this.isNew) {
			const op = this.buildOp();
			if (!op) {
				this.finish();
				return;
			}
			if (await this.write([op], this.data.person.id)) this.finish();
			return;
		}
		if (this.relBlocked) {
			this.showError(this.relNote ?? NEW_SHEET.needPartnership);
			return;
		}
		const parent = this.o.parentSheet;
		const pending = parent ? parent.pendingOps() : [];
		if (pending === null) {
			this.showError(WRITE_TEXT.needNameFirst);
			return;
		}
		const name = this.draft.name.trim();
		// The related people and the parent sheet's person get an id if they have none (see `idsFor`).
		const ids = idsFor(this.data, [...(parent ? [parent.data.person.id] : []), ...this.relIds(), ...namesIn(pending)]);
		// The next free person id (D104), also unused by the ids above.
		const id = nextPersonId(takenIds(this.data, ids.values()));
		const taken = pending.flatMap((op) => (op.kind === 'batch' ? op.ops : [op])).filter((op) => op.kind === 'add-house').map((op) => (op.kind === 'add-house' && parent ? newHouseId(parent.data.data, op.name) : ''));
		const out = await this.write(withIds([...pending, ...this.newPersonOps(id, taken)], ids), id);
		if (!out) {
			// The parent sheet shows the same new data as this one after a stale write.
			if (parent && normBody(parent.data.body) !== normBody(this.o.handle.body)) parent.reload(this.o.handle.body);
			return;
		}
		parent?.afterWrite(out.body, ids);
		const old = this.rel!;
		if (old.kind === 'parent') {
			const other = this.data.g.byId.get(old.child)?.parents.find((l) => l.type === old.type && l.id !== id)?.id;
			autoUnionNotice(out, name, other && this.name(other));
		}
		if (!another) {
			this.finish();
			return;
		}
		// The next child has the same parents, now under the ids the write gave them.
		const rel = mapIds(old, (s) => ids.get(s) ?? s);
		this.rel = rel;
		for (const [was, now] of ids) {
			const n = this.relNames.get(was);
			if (n !== undefined) this.relNames.set(now, n);
		}
		// "Save and add another child": a fresh draft with the same parents, from the new body.
		const r = loadSheet(out.body, null, this.o.dates);
		if (r.kind !== 'ok') {
			this.finish();
			return;
		}
		this.data = r.data;
		this.base = this.baseOf(r.data);
		this.draft = { ...this.base };
		this.newHouse = blankHouse();
		// The write can give the chosen partnership an id, which changes its text: take the
		// partnership the new child is under now.
		if (rel.kind === 'child' && rel.union) {
			const key = r.data.g.primaryUnion.get(id);
			const index = key ? r.data.g.unionByKey.get(key)?.unionIndex : undefined;
			rel.union = this.couple(rel).find((u) => u.index === index) ?? rel.union;
		}
		this.checkRelation();
		this.status = NEW_SHEET.savedAnother(name);
		this.build();
		this.focusName();
	}

	/**
	 * After a write from this sheet (or from a new-person sheet it started): show the new data. `ids`:
	 * the ids the write gave to people with none; the sheet follows its person by the new id.
	 */
	afterWrite(body: string, ids?: ReadonlyMap<string, string>): void {
		const id = ids?.get(this.data.person.id) ?? this.data.person.id;
		const r = loadSheet(body, this.isNew ? null : id, this.o.dates);
		if (r.kind !== 'ok') {
			this.reload(body, id);
			return;
		}
		const top = this.bodyEl?.scrollTop ?? 0;
		this.data = r.data;
		this.base = this.baseOf(r.data);
		this.draft = { ...this.base };
		this.newHouse = blankHouse();
		this.gone = false;
		this.build();
		if (this.bodyEl) this.bodyEl.scrollTop = top;
	}

	private async moveSibling(direction: 'earlier' | 'later'): Promise<void> {
		await this.writeWithDraft([{ kind: 'move-sibling', id: this.data.person.id, direction }]);
		// The buttons are rebuilt; keep the keyboard focus on the one the user pressed.
		this.contentEl.querySelector<HTMLButtonElement>(`.dynasty-move-${direction}:not(:disabled)`)?.focus();
	}

	private async removeParent(link: ParentLink): Promise<void> {
		const child = this.data.person;
		const parentName = this.name(link.id);
		const out = await this.writeWithDraft([{ kind: 'remove-parent', child: child.id, parent: link.id, type: link.type }]);
		if (out) this.removedNotice(REMOVE.removedParent(parentName, child.name), out, child.id);
	}

	private editPartnership(link: PartnerLink): void {
		const u = link.union;
		if (!u || this.pendingOps() === null || !this.fresh()) return;
		const values = (l: PartnerLink) => ({ type: l.type ?? 'marriage', start: l.start ?? '', end: l.end ?? '' });
		editUnion(this.app, this.data.person.name, this.name(link.partner), values(link), async (next) => {
			// The sheet can have loaded new data since the editor opened: find the partnership again.
			const rows = (this.data.fam?.partners ?? []).filter((l) => l.partner === link.partner && l.union);
			const found = findUnion(
				rows.map((l) => l.union!),
				u,
			);
			if (found === 'ambiguous') return UNION_EDIT.ambiguous;
			const now = found ? rows.find((l) => l.union!.index === found.index) : undefined;
			if (!now?.union) return UNION_EDIT.gone;
			const current = values(now);
			const fields: Partial<Record<'type' | 'start' | 'end', string | null>> = {};
			// Marriage is the default: choosing it removes the key (spec §4.1).
			if (next.type !== current.type) fields.type = next.type === 'marriage' ? null : next.type;
			if (next.start !== current.start) fields.start = next.start === '' ? null : next.start;
			if (next.end !== current.end) fields.end = next.end === '' ? null : next.end;
			if (!Object.keys(fields).length) return null;
			const out = await this.writeWithDraft([{ kind: 'edit-union', union: now.union, fields }]);
			return out ? null : this.lastError || WRITE_TEXT.refused;
		});
	}

	private confirmRemovePartnership(link: PartnerLink): void {
		const u = link.union;
		if (!u || this.pendingOps() === null || !this.fresh()) return;
		const a = this.data.person.name;
		const b = this.name(link.partner);
		const was = this.data.person.id;
		this.showConfirm({
			title: REMOVE.partnershipTitle,
			text: [REMOVE.partnershipText(unionTypeText((link.type as UnionKind | null) ?? 'marriage'), a, b), REMOVE.canUndo],
			confirm: REMOVE.removeConfirm,
			confirmCls: 'dynasty-confirm-remove-union',
			keep: REMOVE.cancel,
			onConfirm: () =>
				void this.writeWithDraft([{ kind: 'remove-union', union: u }]).then((out) => {
					if (out) this.removedNotice(REMOVE.removedPartnership(a, b), out, was);
				}),
		});
	}

	private confirmDelete(): void {
		if (!this.fresh()) return;
		const p = this.data.person;
		const o = this.data.tree.options;
		const s = describeDelete(this.data.g, p.id, { start: o.start, focus: o.focus, me: o.me });
		this.showConfirm({
			title: REMOVE.deleteTitle(p.name),
			text: [...deleteText(p.name, s), REMOVE.canUndo],
			confirm: REMOVE.deleteConfirm,
			confirmCls: 'dynasty-confirm-delete',
			keep: REMOVE.cancel,
			onConfirm: () => void this.deletePerson(),
		});
	}

	/** Spec §6.7: the draft of a person who is deleted is not written. */
	private async deletePerson(): Promise<void> {
		const p = this.data.person;
		const h = this.o.handle;
		const out = await this.write([{ kind: 'delete-person', id: p.id }], null);
		if (!out) return;
		if (h.state.lastEdited === p.id) h.state.lastEdited = null;
		this.finish();
		undoNotice(REMOVE.deleted(p.name), h, out.body);
	}

	// ---------- messages ----------

	private focusName(): void {
		this.contentEl.querySelector<HTMLInputElement>('[data-field="name"] input')?.focus();
	}

	private revealFocused(delay = 0): void {
		const run = () => {
			const a = this.modalEl.doc.activeElement as HTMLElement | null;
			if (a && this.contentEl.contains(a) && a.matches('input, select, textarea')) a.scrollIntoView({ block: 'nearest' });
		};
		if (delay) (this.modalEl.win ?? window).setTimeout(run, delay);
		else run();
	}

	private showError(text: string): void {
		this.lastError = text;
		showErrorLine(this.errorEl, text);
	}

	private clearError(): void {
		this.errorEl?.hide();
		if (this.status) {
			this.status = '';
			this.statusEl?.hide();
		}
	}

	/** A question over the sheet ("Discard changes?", a delete) until the user chooses. */
	private showConfirm(c: ConfirmSpec): void {
		this.hideConfirm();
		this.rememberFocus();
		const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
		this.confirmEl = layer;
		const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
		const titleEl = box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: c.title });
		// The question has a name, like the questions of the Houses and Titles windows.
		const titleId = `dynasty-sheet-confirm-${Math.random().toString(36).slice(2, 8)}`;
		titleEl.setAttribute('id', titleId);
		layer.setAttribute('aria-labelledby', titleId);
		for (const t of c.text) box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
		const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
		const keep = row.createEl('button', { cls: 'dynasty-sheet-keep', text: c.keep ?? SHEET.keepEditing, attr: { type: 'button' } });
		const go = row.createEl('button', { cls: ['mod-warning', c.confirmCls], text: c.confirm, attr: { type: 'button' } });
		keep.addEventListener('click', () => this.hideConfirm());
		go.addEventListener('click', () => {
			this.hideConfirm();
			c.onConfirm();
		});
		keep.focus();
	}

	private hideConfirm(): void {
		const had = this.confirmEl !== null;
		this.confirmEl?.remove();
		this.confirmEl = null;
		this.settleQuestion();
		if (had) this.focusBack();
	}

	/** Notes the control that has the focus now, so a question that closes with no choice can give it back. */
	private rememberFocus(): void {
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		this.confirmFrom = active && this.contentEl.contains(active) ? active : null;
	}

	/** The focus must stay in the sheet when a question goes: the focused button goes with it (C3). */
	private focusBack(): void {
		const from = this.confirmFrom;
		this.confirmFrom = null;
		if (this.closing || !this.shown) return;
		if (from && this.contentEl.contains(from) && !(from as HTMLButtonElement).disabled) {
			from.focus();
			return;
		}
		this.modalEl.setAttribute('tabindex', '-1');
		this.modalEl.focus({ preventScroll: true });
	}

	/** Spec §6.1 stale write: a Notice, the new data in the sheet, and the draft kept with a message that says so. */
	private stale(body: string): void {
		new Notice(WRITE_TEXT.staleWindow);
		this.reload(body);
		if (!this.readOnly) this.showError(WRITE_TEXT.staleWindow);
	}

	/** The person is not in the tree now: keep the sheet open, read-only, with the draft to copy (§8). */
	private markGone(): void {
		this.lastError = WRITE_TEXT.personGone;
		new Notice(WRITE_TEXT.personGone);
		this.gone = true;
		this.build();
	}

	/** The write did not happen: say so in a Notice and in the sheet, and keep the draft. */
	private refused(text: string): void {
		new Notice(text);
		this.showError(text);
	}

	/**
	 * Shows the block's new data (spec §6.1 "refresh any open sheet"). Fields the user changed keep
	 * the user's text; the other fields show the new values. `id`: the person to show, if their id
	 * changed with the write.
	 */
	reload(body: string, id = this.data.person.id): void {
		let target = id;
		// A person with no written id is named `~N`, which follows the place in the list: find them again (C2).
		if (!this.isNew && unwritten(this.data, id)) {
			const now = loadSheet(body, null, this.o.dates);
			if (now.kind === 'ok') {
				const same = sameUnwritten(this.data, id, now.data);
				if (same === null) {
					this.markGone();
					return;
				}
				target = same;
			}
		}
		const r = loadSheet(body, this.isNew ? null : target, this.o.dates);
		if (r.kind === 'invalid') {
			// The draft stays, editable; a later Save compares with the new body and says so again.
			this.refused(WRITE_TEXT.invalid);
			return;
		}
		if (r.kind === 'gone') {
			this.markGone();
			return;
		}
		const l = r.data;
		this.gone = false;
		const fresh = this.baseOf(l);
		const next = { ...fresh };
		for (const k of Object.keys(fresh) as (keyof Draft)[]) {
			if (this.draft[k] !== this.base[k]) (next as Record<string, unknown>)[k] = this.draft[k];
		}
		this.data = l;
		this.base = fresh;
		this.draft = next;
		this.checkRelation();
		this.build();
	}
}
