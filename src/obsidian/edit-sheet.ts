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

import { Modal, Notice, type App, type TFile } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { FieldValue, Op, ParentKind, PersonField, UnionKind, UnionRef } from '../core/edit';
import type { PersonFolds } from '../core/folds';
import { issueText } from '../core/messages';
import { pictureIssue } from '../core/pictures';
import { formatPortraitCrop, sameCropText } from '../core/portrait-crop';
import { nextPersonId } from '../core/id-gen';
import { newHouseId } from '../core/yaml-edit';
import { parseBody, readTree, referencedIds } from '../core/parse';
import { isMap, str, type Raw } from '../core/tolerate';
import { PARENT_TYPES, PLACEMENT_TYPES, UNION_TYPES, type Person, type Tree } from '../core/types';
import { linkTarget, relationInfo } from '../render/tree-info';
import { CROP_UI, FAMILY, FINDER_UI, FOCUS_UI, FOLD_UI, ME_UI, NEW_SHEET, NOTE_UI, PICTURES_UI, REMOVE, SHEET, UI, UNION_EDIT, UNION_TYPE_TEXT, WRITE_TEXT, deleteText, parentTypeText, partnerDetail, unionTypeText } from '../render/ui-text';
import { linkedNotePath, personNoteName } from '../core/note-make';
import { makePersonNote, openMadeNote, type MakeNoteMode, type MakePersonNoteOutcome, type SameNameAnswer } from './make-note';
import { normBody } from '../core/block-match';
import type { Handle, HandleWriteOutcome, Written } from './block-handle';
import type { ViewKind } from './block-state';
import { describeDelete, familyOf, type FamilyView, type ParentLink, type PartnerLink } from '../core/family-query';
import type { RelationOptions } from '../core/relations';
import { openCropTool, startCropOf } from './crop-tool';
import { addChild, addParent, addPartner, autoUnionNotice, unionOp, type FlowHost, type NewRelation } from './family-flows';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { pickPerson } from './person-picker';
import { currentPictureOf, pickPicture } from './picture-picker';
import type { PictureCopy, PictureStore } from './picture-store';
import { relationsFor, validMe } from './relation-cache';
import { freshOrStale, nameDialog, onWriteFailed, sheetField, showErrorLine } from './sheet-parts';
import { renderRelationBox, renderRelationStrip, type RelationView } from './sheet-relation';
import { titlesSection, type TitlesHost } from './sheet-titles';
import { undoNotice } from './undo-notice';
import { editUnion } from './union-edit';
import { trackModal } from './plugin-modals';

const TEXT_FIELDS = ['name', 'sobriquet', 'title', 'born', 'died', 'link', 'notes'] as const;
const NEW_HOUSE = '\u0000new';
/** Spec §13.7: the sheet's portrait is about 96 px across. */
export const SHEET_PORTRAIT_PX = 96;

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
	link: string;
	/** Spec §13.7: the portrait link; '' = none. */
	portrait: string;
	/** Spec §13.13: the selected part of the portrait as written text; '' = none (the automatic part). */
	portraitCrop: string;
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
export function loadSheet(body: string, id: string | null): SheetLoad {
	const parsed = parseBody(body);
	if (!parsed.ok) return { kind: 'invalid' };
	const tree = readTree(parsed.doc, parsed.data, body);
	const g = deriveFamilies(tree);
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
		link: p.link ?? '',
		portrait: p.portrait ?? '',
		portraitCrop: p.portraitCrop ?? '',
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
	const p = l.g.byId.get(id);
	const data = l.data as Raw;
	if (!p || !isMap(data) || !Array.isArray(data.people)) return false;
	const raw = data.people[p.index] as Raw;
	return str(isMap(raw) ? raw.id : undefined) !== id;
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
	const ids = new Map<string, string>();
	const used = takenIds(l);
	for (const id of names) {
		if (ids.has(id) || !unwritten(l, id)) continue;
		const next = nextPersonId(used);
		used.add(next);
		ids.set(id, next);
	}
	return ids;
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
	private portraitEl: HTMLElement | null = null;
	/** The round frame and the problem text of the portrait: a copy that arrives changes only these. */
	private portraitFrame: HTMLElement | null = null;
	private portraitHint: HTMLElement | null = null;
	/** Spec §13.13: the Select the part button; it shows when the portrait can show. */
	private partButton: HTMLButtonElement | null = null;
	/** D146, D147: what the relation infobox shows for this build (null: nothing), and whether that build drew the phone strip. */
	private relView: RelationView | null = null;
	private relPhone = false;
	/** Spec §13.11: the slot in the Actions list for Make a note, what it shows now, and the busy flag of the flow (N2). */
	private noteSlot: HTMLElement | null = null;
	private noteKey = '';
	private noteBusy = false;
	/** Called when the same-name question goes away without a choice; it settles the question as Cancel. */
	private dismissQuestion: (() => void) | null = null;

	/** Returns null if the person is not in the block (the view was out of date). */
	static create(app: App, o: PersonSheetOptions): EditSheet | null {
		const l = loadSheet(o.handle.body, o.personId);
		return l.kind === 'ok' ? new EditSheet(app, o, l.data) : null;
	}

	/** A sheet for a new person; null if the block does not parse. */
	static createNew(app: App, o: NewSheetOptions): EditSheet | null {
		const l = loadSheet(o.parentSheet?.data.body ?? o.handle.body, null);
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
		if (this.isNew) this.focusName();
		else if (!this.modalEl.contains(this.modalEl.doc?.activeElement ?? null)) {
			// On a phone the sheet can open with the focus left on the page, so a Tab key would reach the tree below it.
			this.modalEl.setAttribute('tabindex', '-1');
			this.modalEl.focus({ preventScroll: true });
		}
	}

	/** Runs the cleanup functions `onOpen` registered and empties the modal. */
	override onClose(): void {
		this.shown = false;
		this.closed = true;
		this.settleQuestion();
		for (const c of this.cleanup.splice(0)) c();
		// O7: the sheet's portrait copy is released when the sheet closes.
		this.dropPortrait();
		this.portraitEl = null;
		this.portraitFrame = null;
		this.portraitHint = null;
		this.partButton = null;
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
		// Spec §13.7: Select portrait and Remove portrait are draft edits; Save writes them with the other fields.
		const portrait = this.draft.portrait.trim();
		if (portrait !== this.base.portrait.trim()) out.portrait = portrait === '' ? null : portrait;
		// Spec §13.13, D91: the part follows the picture. A changed part is written (or removed); a part that is kept while
		// the link text changes to the same file is written again, so the core rule that a new picture drops its part keeps it.
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
		el.empty();
		this.confirmEl = null;
		this.settleQuestion();
		this.noteSlot = null;
		this.noteKey = '';
		el.addClass('dynasty-sheet-content');
		const ro = this.readOnly;
		this.modalEl.toggleClass('is-read-only', ro);
		this.relView = this.makeRelationView();
		this.relPhone = this.modalEl.hasClass('is-phone');

		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		nameDialog(this.modalEl, header.createDiv({ cls: 'dynasty-sheet-title', text: this.title() }));
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		const cancel = actions.createEl('button', { cls: 'dynasty-sheet-cancel', text: ro ? SHEET.close : SHEET.cancel, attr: { type: 'button', 'data-focus': 'cancel' } });
		cancel.addEventListener('click', () => this.finish());
		if (!ro) {
			const save = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-save'], text: SHEET.save, attr: { type: 'button', 'data-focus': 'save' } });
			save.addEventListener('click', () => void this.save());
			if (this.rel?.kind === 'child') {
				// Spec §6.3: quick entry of several children; in the header, so it stays reachable (spec §7.4).
				const more = header.createEl('button', { cls: 'dynasty-sheet-save-another', text: NEW_SHEET.saveAnother, attr: { type: 'button', 'data-focus': 'save-another' } });
				more.addEventListener('click', () => void this.save(true));
			}
		}

		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		this.bodyEl = body;
		body.addEventListener('focusin', () => this.revealFocused(300));
		// D147: the strip is the first child, so it is right under the header and before the portrait in the reading order.
		if (this.relView && this.relPhone) renderRelationStrip(body, this.relView);
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

		this.portraitField(body);
		// A read-only sheet with no portrait has no portrait row; the box then stands alone where the row would be.
		if (this.relView && !this.relPhone && !this.portraitEl) renderRelationBox(body, this.relView);
		this.textField(body, 'name', SHEET.name, { autocapitalize: 'words' });
		// D122: the card adds the quote marks, so the hint says so; a sobriquet usually starts with a small letter.
		const sobInput = this.textField(body, 'sobriquet', SHEET.sobriquet, { autocapitalize: 'none' });
		const sobId = sobInput.getAttribute('id') ?? '';
		sobInput.parentElement?.createDiv({ cls: 'dynasty-sheet-hint', text: SHEET.sobriquetHint, attr: { id: `${sobId}-hint` } });
		sobInput.setAttribute('aria-describedby', `${sobId}-hint`);
		const titleInput = this.textField(body, 'title', SHEET.title);
		// D98: the hint points to the Titles section, which the sheet of a new person does not have.
		if (!this.isNew) {
			const titleId = titleInput.getAttribute('id') ?? '';
			titleInput.parentElement?.createDiv({ cls: 'dynasty-sheet-hint', text: SHEET.titleHint, attr: { id: `${titleId}-hint` } });
			titleInput.setAttribute('aria-describedby', `${titleId}-hint`);
		}
		this.houseField(body);
		this.sexField(body);
		this.textField(body, 'born', SHEET.born);
		this.textField(body, 'died', SHEET.died);
		this.checkField(body);
		this.textField(body, 'link', SHEET.link, { placeholder: SHEET.linkPlaceholder });
		this.textField(body, 'notes', SHEET.notes, {}, true);
		this.placementField(body);

		if (!this.isNew) {
			// Spec §13.4: between the fields and Family.
			titlesSection(body, this.titlesHost());
			const me = this.me();
			this.familySection(body);
			this.actionsSection(body, me);
			if (!ro) this.deleteSection(body);
			this.idLine(body);
		}
		this.restoreFocus(kept);
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
			if (target) {
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

	/** What the new person will be, and for a new partner the type of the partnership. */
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
		const text =
			rel.kind === 'parent'
				? NEW_SHEET.parentOf(rel.type, this.name(rel.child))
				: rel.kind === 'child'
					? NEW_SHEET.childOf(this.name(rel.parent), rel.other === null ? null : this.name(rel.other))
					: NEW_SHEET.partnerOf(this.name(rel.partner));
		box.createDiv({ cls: 'dynasty-sheet-relation-text', text });
		if (rel.kind === 'child') this.partnershipField(box, rel);
		if (rel.kind !== 'partner') return;
		const { row, id } = sheetField(box, NEW_SHEET.unionType, 'union-type');
		const sel = row.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input'], attr: { id } });
		for (const t of UNION_TYPES) sel.createEl('option', { text: UNION_TYPE_TEXT[t], attr: { value: t } });
		sel.value = this.unionType;
		sel.addEventListener('change', () => (this.unionType = sel.value));
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
			this.build();
		});
	}

	// ---------- the portrait (spec §13.7) ----------

	/** The portrait at the top of the sheet: the round picture (about 96 px), Select portrait and Remove portrait. */
	private portraitField(parent: HTMLElement): void {
		if (this.readOnly && !this.draft.portrait.trim()) {
			this.portraitEl = null;
			return;
		}
		this.portraitEl = parent.createDiv({ cls: ['dynasty-sheet-field', 'dynasty-sheet-portrait'], attr: { 'data-field': 'portrait' } });
		this.drawPortrait();
	}

	/** Draws the portrait part again from the draft (after Select or Remove). */
	private drawPortrait(focus?: 'select' | 'remove' | 'part'): void {
		const sec = this.portraitEl;
		if (!sec) return;
		sec.empty();
		sec.createDiv({ cls: 'dynasty-sheet-label', text: PICTURES_UI.portraitHeading });
		const row = sec.createDiv({ cls: 'dynasty-sheet-portrait-row' });
		this.portraitFrame = row.createDiv({ cls: 'dynasty-sheet-portrait-frame' });
		this.portraitHint = null;
		this.partButton = null;
		const link = this.draft.portrait.trim();
		if (!this.readOnly) {
			const buttons = row.createDiv({ cls: 'dynasty-sheet-portrait-buttons' });
			const select = this.button(buttons, PICTURES_UI.selectPortrait, 'dynasty-select-portrait', () => void this.selectPortrait());
			if (focus === 'select') select.focus();
			if (link) {
				const remove = this.button(buttons, PICTURES_UI.removePortrait, 'dynasty-remove-portrait', () => {
					this.portraitLinkChanged('');
					this.draft.portrait = '';
					this.clearError();
					this.drawPortrait('select');
				});
				if (focus === 'remove') remove.focus();
				// Shown once the portrait can show (paintPortrait); a picture with a problem has no part to select.
				const part = this.button(buttons, CROP_UI.select, 'dynasty-select-part', () => void this.selectPart(), CROP_UI.selectLabel);
				part.toggle(false);
				this.partButton = part;
				if (focus === 'part') part.focus();
			}
		}
		// Last in the row: the box stands right of the frame and the buttons (D146). This part builds the row again, so it builds the box again.
		if (this.relView && !this.relPhone) {
			row.addClass('has-relinfo');
			renderRelationBox(row, this.relView);
		}
		this.paintPortrait();
	}

	/**
	 * Shows the portrait state in the frame and the problem text. A copy that arrives comes here only,
	 * so the buttons stay the same elements and keep the focus and a press under way (O2).
	 */
	private paintPortrait(): void {
		const sec = this.portraitEl;
		const frame = this.portraitFrame;
		if (!sec || !frame || !sec.contains(frame)) return;
		const link = this.draft.portrait.trim();
		const p = link ? this.portraitFor(link) : null;
		// The file resolves and its copy has no problem (a copy still loading counts, so the focus can stay on the button).
		this.partButton?.toggle(!!p && p.path !== null && p.problem === null);
		frame.empty();
		frame.removeClass('is-none', 'is-loading', 'is-missing');
		if (!p) frame.addClass('is-none');
		else if (p.copy) frame.createEl('img', { cls: 'dynasty-sheet-portrait-img', attr: { src: p.copy.url, alt: '' } });
		else if (p.loading) frame.addClass('is-loading');
		// B1: only a missing file gives the dashed frame; the other problems a solid empty one.
		else frame.addClass(p.missing ? 'is-missing' : 'is-none');
		const text = p?.problem ?? null;
		if (text === null) {
			this.portraitHint?.remove();
			this.portraitHint = null;
		} else if (this.portraitHint && sec.contains(this.portraitHint)) {
			if (this.portraitHint.getText() !== text) this.portraitHint.setText(text);
		} else this.portraitHint = sec.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-sheet-portrait-problem'], text });
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
			console.error('Dynasty Tree: cannot show the portrait', e);
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
			.catch((e) => console.error('Dynasty Tree: cannot show the portrait', e));
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
		const picked = await pickPicture(this.app, { sourcePath: this.o.sourcePath, store: this.o.pictures, title: PICTURES_UI.pickerPortraitTitle(name), current, remove });
		if (!this.shown) return;
		if (picked.kind === 'choose') {
			this.portraitLinkChanged(picked.link);
			this.draft.portrait = picked.link;
			this.clearError();
		} else if (picked.kind === 'remove') {
			// The same as the Remove portrait button: the draft changes; Save writes it.
			this.portraitLinkChanged('');
			this.draft.portrait = '';
			this.clearError();
		}
		this.drawPortrait('select');
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
		this.drawPortrait('part');
	}

	private textField(parent: HTMLElement, key: (typeof TEXT_FIELDS)[number], label: string, o: { autocapitalize?: string; placeholder?: string } = {}, area = false): HTMLInputElement | HTMLTextAreaElement {
		const { row, id } = sheetField(parent, label, key);
		// Plain attribute names (no spread), so the colour rule of eslint.config.mjs can check them; null writes no attribute.
		const extra = { autocapitalize: o.autocapitalize ?? null, placeholder: o.placeholder ?? null };
		// born and died are free text (fictional calendars): never a numeric keyboard (spec §7.4).
		const input = area
			? row.createEl('textarea', { cls: 'dynasty-sheet-input', attr: { id, rows: 4, autocapitalize: extra.autocapitalize, placeholder: extra.placeholder, 'data-focus': `field:${key}` } })
			: row.createEl('input', { cls: 'dynasty-sheet-input', attr: { id, type: 'text', autocomplete: 'off', spellcheck: key === 'notes' ? 'true' : 'false', autocapitalize: extra.autocapitalize, placeholder: extra.placeholder, 'data-focus': `field:${key}` } });
		input.value = this.draft[key];
		// Read-only, not disabled: the user can still select and copy the text.
		input.readOnly = this.readOnly;
		input.addEventListener('input', () => {
			this.draft[key] = input.value;
			this.clearError();
			// The button and its label follow the draft name and link (N1).
			if (key === 'link' || key === 'name') this.updateNoteButton();
		});
		return input;
	}

	private select(parent: HTMLElement, key: 'house' | 'sex' | 'placement', label: string, options: [string, string][]): HTMLSelectElement {
		const { row, id } = sheetField(parent, label, key);
		const sel = row.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input'], attr: { id, 'data-focus': `field:${key}` } });
		for (const [value, text] of options) sel.createEl('option', { text, attr: { value } });
		sel.value = this.draft[key];
		sel.disabled = this.readOnly;
		return sel;
	}

	private houseField(parent: HTMLElement): void {
		const houses = this.data.tree.houses;
		const opts: [string, string][] = [['', SHEET.noHouse], ...houses.map((h): [string, string] => [h.id, h.name])];
		const current = this.base.house;
		if (current && !houses.some((h) => h.id === current)) opts.push([current, SHEET.unknownHouse(current)]);
		if (!this.readOnly) opts.push([NEW_HOUSE, SHEET.newHouse]);
		const sel = this.select(parent, 'house', SHEET.house, opts);
		sel.addEventListener('change', () => (this.draft.house = sel.value));
		if (this.readOnly) return;
		const form = parent.createDiv({ cls: 'dynasty-sheet-subform' });
		const name = sheetField(form, SHEET.newHouseName, 'new-house-name');
		const nameInput = name.row.createEl('input', { cls: 'dynasty-sheet-input', attr: { id: name.id, type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'words' } });
		nameInput.value = this.newHouse.name;
		nameInput.addEventListener('input', () => {
			this.newHouse.name = nameInput.value;
			this.clearError();
		});
		const colour = sheetField(form, SHEET.newHouseColour, 'new-house-color');
		const colourInput = colour.row.createEl('input', { cls: 'dynasty-sheet-colour', attr: { id: colour.id, type: 'color' } });
		colourInput.value = this.newHouse.color;
		colourInput.addEventListener('input', () => (this.newHouse.color = colourInput.value));
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
		sel.addEventListener('change', () => (this.draft.sex = sel.value));
	}

	private checkField(parent: HTMLElement): void {
		// The whole row is the label, so the hit area is the full row (spec §7.5).
		const row = parent.createEl('label', { cls: 'dynasty-sheet-field dynasty-sheet-check', attr: { 'data-field': 'illegitimate' } });
		const box = row.createEl('input', { attr: { type: 'checkbox', 'data-focus': 'field:illegitimate' } });
		box.checked = this.draft.illegitimate;
		box.disabled = this.readOnly;
		row.createSpan({ cls: 'dynasty-sheet-label', text: SHEET.illegitimate });
		box.addEventListener('change', () => (this.draft.illegitimate = box.checked));
	}

	private placementField(parent: HTMLElement): void {
		const choices = placementChoices(this.data.person);
		// Spec §6.3: only when the person has parents of more than one placement type.
		if (choices.length < 2) return;
		const opts: [string, string][] = choices.map((t) => [t, SHEET.placement[t] ?? t]);
		if (this.base.placement && !choices.includes(this.base.placement)) opts.push([this.base.placement, SHEET.placementOther(this.base.placement)]);
		const sel = this.select(parent, 'placement', SHEET.shownUnder, opts);
		sel.parentElement?.createDiv({ cls: 'dynasty-sheet-hint', text: SHEET.shownUnderHint });
		sel.addEventListener('change', () => (this.draft.placement = sel.value));
	}

	// ---------- Family, Actions, Delete (spec §6.3) ----------

	private button(parent: HTMLElement, text: string, cls: string, run: () => void, label?: string): HTMLButtonElement {
		const b = parent.createEl('button', { cls: ['dynasty-sheet-action', cls], text, attr: { type: 'button', 'data-focus': cls } });
		if (label) b.setAttribute('aria-label', label);
		b.addEventListener('click', () => {
			if (this.saving) return;
			try {
				run();
			} catch (e) {
				console.error('Dynasty Tree: the sheet action failed', e);
			}
		});
		return b;
	}

	/** The Family section (spec §6.3). */
	private familySection(parent: HTMLElement): void {
		const fam = this.data.fam;
		if (!fam) return;
		const ro = this.readOnly;
		const sec = parent.createDiv({ cls: 'dynasty-sheet-section dynasty-family' });
		sec.createDiv({ cls: 'dynasty-sheet-section-title', text: FAMILY.heading });

		const parents = sec.createDiv({ cls: 'dynasty-family-group', attr: { 'data-family': 'parents' } });
		parents.createDiv({ cls: 'dynasty-sheet-label', text: FAMILY.parents });
		if (!fam.parents.length) parents.createDiv({ cls: 'dynasty-family-empty', text: FAMILY.noParents });
		for (const link of fam.parents) this.parentRow(parents, fam, link);

		const partners = sec.createDiv({ cls: 'dynasty-family-group', attr: { 'data-family': 'partners' } });
		partners.createDiv({ cls: 'dynasty-sheet-label', text: FAMILY.partners });
		if (!fam.partners.length) partners.createDiv({ cls: 'dynasty-family-empty', text: FAMILY.noPartners });
		for (const link of fam.partners) this.partnerRow(partners, link);

		const sib = fam.siblings;
		if (sib) {
			const group = sec.createDiv({ cls: 'dynasty-family-group', attr: { 'data-family': 'siblings' } });
			group.createDiv({ cls: 'dynasty-sheet-label', text: FAMILY.siblings });
			group.createDiv({ cls: 'dynasty-family-position', text: FAMILY.position(sib.index + 1, sib.group.length) });
			if (!ro) {
				const row = group.createDiv({ cls: 'dynasty-family-buttons' });
				this.button(row, FAMILY.moveEarlier, 'dynasty-move-earlier', () => void this.moveSibling('earlier')).disabled = !sib.canMoveEarlier;
				this.button(row, FAMILY.moveLater, 'dynasty-move-later', () => void this.moveSibling('later')).disabled = !sib.canMoveLater;
			}
		}
	}

	/** The marked person, if the tree has a mark that names a person (spec §13.1). */
	private me(): string | null {
		return validMe(this.data.g, this.data.tree.options.me);
	}

	/**
	 * Spec §13.1, D146: what the infobox shows for this person, or null when nothing shows (a new person, a tree with no mark).
	 * The names come from the whole tree, as on the cards. Show the line is not on the marked person's own sheet.
	 */
	private makeRelationView(): RelationView | null {
		if (this.isNew || !this.data.fam) return null;
		const me = this.me();
		if (me === null) return null;
		const p = this.data.person;
		const v: RelationView = relationInfo(relationsFor(this.data.g, me, this.o.relationOptions).all.get(p.id), p.id === me);
		const finder = this.o.finder;
		if (v.kind !== 'me' && finder && !this.gone) {
			v.addLineButton = (parent) => void this.button(parent, ME_UI.showLine, 'dynasty-show-line', () => this.leaveFor(() => finder.show(me, p.id)), ME_UI.showLineLabel(p.name || p.id));
		}
		return v;
	}

	/** D147: a window that crosses 600 px (a turn, a resize) swaps the box and the strip. The build keeps the draft and the focus. */
	private relLayout(): void {
		// The first layout runs inside `phoneLayout`, before the first build.
		if (this.bodyEl === null || this.closed || this.relView === null) return;
		if (this.modalEl.hasClass('is-phone') !== this.relPhone) this.build();
	}

	private parentRow(parent: HTMLElement, fam: FamilyView, link: ParentLink): void {
		const name = this.name(link.id);
		const row = parent.createDiv({ cls: 'dynasty-family-row', attr: { 'data-parent': link.id, 'data-type': link.type } });
		row.createDiv({ cls: 'dynasty-family-name', text: name });
		const controls = row.createDiv({ cls: 'dynasty-family-controls' });
		const sel = controls.createEl('select', { cls: ['dropdown', 'dynasty-family-select'], attr: { 'aria-label': FAMILY.parentTypeLabel(name), 'data-focus': 'parent-type' } });
		const count = (t: string) => fam.parents.filter((l) => l.type === t).length;
		for (const t of PARENT_TYPES) {
			const opt = sel.createEl('option', { text: parentTypeText(t), attr: { value: t } });
			// A type that has 2 parents already is full (spec §4.2).
			opt.disabled = t !== link.type && count(t) >= 2;
		}
		sel.value = link.type;
		sel.disabled = this.readOnly;
		sel.addEventListener('change', () => {
			const to = sel.value as ParentKind;
			if (to === link.type) return;
			void this.writeWithDraft([{ kind: 'set-parent-type', child: this.data.person.id, parent: link.id, from: link.type, to }]).then((out) => {
				if (!out) sel.value = link.type;
			});
		});
		if (this.readOnly) return;
		this.button(controls, FAMILY.remove, 'dynasty-remove-parent', () => void this.removeParent(link), FAMILY.removeParentLabel(name));
	}

	private partnerRow(parent: HTMLElement, link: PartnerLink): void {
		const name = this.name(link.partner);
		const row = parent.createDiv({ cls: 'dynasty-family-row', attr: { 'data-partner': link.partner, 'data-union': link.union ? String(link.union.index) : 'none' } });
		const text = row.createDiv({ cls: 'dynasty-family-name' });
		text.createDiv({ text: name });
		text.createDiv({ cls: 'dynasty-family-detail', text: partnerDetail(link.type, link.start, link.end) });
		if (this.readOnly || !link.union) return;
		const controls = row.createDiv({ cls: 'dynasty-family-controls' });
		this.button(controls, FAMILY.edit, 'dynasty-edit-union', () => void this.editPartnership(link), FAMILY.editLabel(name));
		this.button(controls, FAMILY.removePartnership, 'dynasty-remove-union', () => this.confirmRemovePartnership(link), FAMILY.removePartnershipLabel(name));
	}

	/** The Actions section (spec §6.3); `me` is the marked person (spec §13.1), or null. */
	private actionsSection(parent: HTMLElement, me: string | null): void {
		const sec = parent.createDiv({ cls: 'dynasty-sheet-section dynasty-actions' });
		sec.createDiv({ cls: 'dynasty-sheet-section-title', text: FAMILY.actions });
		const list = sec.createDiv({ cls: 'dynasty-actions-list' });
		if (!this.readOnly) {
			this.button(list, FAMILY.addParent, 'dynasty-add-parent', () => void addParent(this.flowHost()));
			this.button(list, FAMILY.addChild, 'dynasty-add-child', () => void addChild(this.flowHost()));
			this.button(list, FAMILY.addPartner, 'dynasty-add-partner', () => void addPartner(this.flowHost()));
		}
		const p = this.data.person;
		const focus = this.o.focus;
		if (focus && !this.gone) this.button(list, FOCUS_UI.focusHere, 'dynasty-focus-here', () => this.leaveFor(() => focus.here(p.id)), FOCUS_UI.focusHereLabel(p.name));
		if (!this.readOnly) {
			// D18: one pin per tree; the pinned person's sheet offers to remove it.
			if (this.data.tree.options.focus === p.id) this.button(list, FOCUS_UI.unpin, 'dynasty-unpin', () => void this.pin(false), FOCUS_UI.unpinLabel(p.name));
			else this.button(list, FOCUS_UI.pin, 'dynasty-pin', () => void this.pin(true), FOCUS_UI.pinLabel(p.name));
			// Spec §13.1: one mark per tree; the marked person's sheet offers to remove it.
			if (me === p.id) this.button(list, ME_UI.unmark, 'dynasty-unmark-me', () => void this.markMe(false), ME_UI.unmarkLabel(p.name));
			else this.button(list, ME_UI.mark, 'dynasty-mark-me', () => void this.markMe(true), ME_UI.markLabel(p.name));
		}
		// Spec §13.10: Hide descendants and Show descendants write nothing, so they are in a read-only tree too; not for a new person.
		const folds = this.o.folds;
		if (folds && !this.isNew && !this.gone) {
			const state = folds.state(p.id);
			if (state.open.length) this.button(list, FOLD_UI.hideDescendants, 'dynasty-hide-descendants', () => this.leaveFor(() => folds.hide(p.id)), FOLD_UI.hideDescendantsLabel(p.name));
			if (state.folded.length) this.button(list, FOLD_UI.showDescendants, 'dynasty-show-descendants', () => this.leaveFor(() => folds.show(p.id)), FOLD_UI.showDescendantsLabel(p.name));
		}
		const finder = this.o.finder;
		if (finder && !this.gone) this.button(list, ME_UI.showRelationTo, 'dynasty-relation-to', () => void this.relationTo(finder), ME_UI.showRelationToLabel(p.name));
		// Spec §13.11: Make a note / Make the linked note, before Open link.
		if (!this.readOnly) {
			this.noteSlot = list.createDiv({ cls: 'dynasty-note-slot' });
			this.updateNoteButton();
		}
		const linktext = linkTarget(this.data.person.link);
		if (linktext) {
			this.button(list, SHEET.openLink, 'dynasty-sheet-open-link', () =>
				this.leaveFor(() => {
					const open = () => this.app.workspace.openLinkText(linktext, this.o.sourcePath, false);
					if (this.o.openNote) this.o.openNote(open);
					else void open().catch((e) => console.error('Dynasty Tree: cannot open link', e));
				}),
			);
		}
		if (!list.childElementCount) sec.remove();
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

	private noteLabelName(): string {
		return this.draft.name.trim() || this.data.person.name || SHEET.unnamed;
	}

	/** Shows, changes or removes the button when the draft name or link changes; it keeps the button when nothing changed. */
	private updateNoteButton(): void {
		const slot = this.noteSlot;
		if (!slot) return;
		const mode = this.noteMode();
		const name = this.noteLabelName();
		const key = mode ? `${mode}|${name}` : '';
		if (key === this.noteKey) return;
		this.noteKey = key;
		slot.empty();
		if (!mode) return;
		const text = mode === 'new' ? NOTE_UI.make : NOTE_UI.makeLinked;
		const label = mode === 'new' ? NOTE_UI.makeLabel(name) : NOTE_UI.makeLinkedLabel(name);
		this.button(slot, text, 'dynasty-make-note', () => void this.makeNoteFlow(mode), label);
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
			console.error('Dynasty Tree: cannot make the note', e);
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
			else void go().catch((e) => console.error('Dynasty Tree: cannot open the note', e));
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
				this.reload(h.body, id !== was && loadSheet(h.body, id).kind === 'gone' ? was : id);
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
		const picked = await pickPerson(this.app, this.data.g, new Set([p.id]), FINDER_UI.placeholder, FINDER_UI.otherTitle, false, me !== p.id ? me : null);
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
		parent.createDiv({ cls: 'dynasty-sheet-id', text: SHEET.idLine(id) });
	}

	private deleteSection(parent: HTMLElement): void {
		const sec = parent.createDiv({ cls: 'dynasty-sheet-section dynasty-delete' });
		const b = this.button(sec, FAMILY.deletePerson, 'dynasty-delete-person', () => this.confirmDelete());
		b.addClass('mod-warning');
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
			button: (parent, text, cls, run, label) => this.button(parent, text, cls, run, label),
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
		};
	}

	private openNew(rel: NewRelation, name?: string): void {
		const sheet = EditSheet.createNew(this.app, { handle: this.o.handle, sourcePath: this.o.sourcePath, beforeWrite: this.o.beforeWrite, openNote: this.o.openNote, newPerson: rel, initialName: name, parentSheet: this, place: this.o.place, pictures: this.o.pictures, folds: this.o.folds, relationOptions: this.o.relationOptions });
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
			console.error('Dynasty Tree: cannot save', e);
			restore();
			this.refused(WRITE_TEXT.failed);
			return null;
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
	}

	/** F12: tells the tree view about an ok write, so a person the fold hides (the sheet's or an added one) shows. It never fails the write. */
	private foldsWritten(highlight: string | null, created: readonly string[]): void {
		const folds = this.o.folds;
		if (!folds) return;
		const own = highlight ?? (this.isNew ? null : this.data.person.id);
		try {
			folds.written([...new Set([...(own ? [own] : []), ...created])]);
		} catch (e) {
			console.error('Dynasty Tree: cannot show the people that folds hide', e);
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
				else if (code === 'limit') this.refused(WRITE_TEXT.limit);
				else if (code === 'no-sibling') this.refused(WRITE_TEXT.noSibling);
				else this.refused(WRITE_TEXT.refused);
			},
		});
	}

	/**
	 * A relationship action with the draft in the same write; the sheet stays open and shows the
	 * result. A person of the write with no written id gets one in it; the sheet's own person always
	 * does, so the sheet follows them by that id afterwards.
	 */
	private async writeWithDraft(ops: Op[], highlight: string | null = this.data.person.id): Promise<DraftWritten | null> {
		this.lastError = '';
		const pending = this.pendingOps();
		if (pending === null) return null;
		const all = [...pending, ...ops];
		const ids = idsFor(this.data, [this.data.person.id, ...namesIn(all), ...holderNames(all)]);
		const out = await this.write(withIds(all, ids), highlight === null ? null : (ids.get(highlight) ?? highlight));
		if (!out) return null;
		this.afterWrite(out.body, ids);
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
			this.reload(h.body, id !== was && loadSheet(h.body, id).kind === 'gone' ? was : id);
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
		// The id newPersonId gives (D104), also unused by the ids above.
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
		const r = loadSheet(out.body, null);
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
		const r = loadSheet(body, this.isNew ? null : id);
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
		new Notice(WRITE_TEXT.stale);
		this.reload(body);
		if (!this.readOnly) this.showError(WRITE_TEXT.staleInSheet);
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
			const now = loadSheet(body, null);
			if (now.kind === 'ok') {
				const same = sameUnwritten(this.data, id, now.data);
				if (same === null) {
					this.markGone();
					return;
				}
				target = same;
			}
		}
		const r = loadSheet(body, this.isNew ? null : target);
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
