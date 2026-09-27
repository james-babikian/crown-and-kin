/*
 * The edit sheet (spec §6.3 fields, family, actions and commit model; §7.4 phone layout). Field
 * edits are a draft: Save writes once, only the changed fields; Cancel discards; any other way to
 * close asks first. A relationship action writes the draft in the same write. A new person is a
 * draft too: a sheet for them writes the person and the relationship together, on Save only.
 * The sheet reads the block from its handle, never from the rendered view, which the write replaces.
 *
 * Reading guide, top to bottom:
 * - Helpers above the class: loading the sheet's data (`loadSheet`), the draft shape, id and
 *   partnership lookup helpers used when a write gives a person their first id.
 * - `EditSheet`: state, then the sections marked with `// ---------- ... ----------` comments:
 *   building the form (fields, house, family, actions, delete), writes (the write itself, the
 *   relationship-action write, Save, reload after a write), and the confirm/error messages.
 */

import { Modal, Notice, type App } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { FieldValue, Op, ParentKind, PersonField, UnionKind, UnionRef } from '../core/edit';
import { issueText } from '../core/messages';
import { uniqueId } from '../core/id-gen';
import { newHouseId } from '../core/yaml-edit';
import { parseBody, readTree, referencedIds } from '../core/parse';
import { isMap, str, type Raw } from '../core/tolerate';
import { PARENT_TYPES, PLACEMENT_TYPES, UNION_TYPES, type Person, type Tree } from '../core/types';
import { linkTarget } from '../render/tree-info';
import { FAMILY, FOCUS_UI, NEW_SHEET, REMOVE, SHEET, UI, UNION_EDIT, UNION_TYPE_TEXT, WRITE_TEXT, deleteText, parentTypeText, partnerDetail, unionTypeText } from '../render/ui-text';
import { normBody } from '../core/block-match';
import type { Handle, HandleWriteOutcome, Written } from './block-handle';
import type { ViewKind } from './block-state';
import { describeDelete, familyOf, type FamilyView, type ParentLink, type PartnerLink } from '../core/family-query';
import { addChild, addParent, addPartner, autoUnionNotice, unionOp, type FlowHost, type NewRelation } from './family-flows';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { freshOrStale, onWriteFailed, sheetField, showErrorLine } from './sheet-parts';
import { undoNotice } from './undo-notice';
import { editUnion } from './union-edit';
import { trackModal } from './plugin-modals';

const TEXT_FIELDS = ['name', 'title', 'born', 'died', 'link', 'notes'] as const;
const NEW_HOUSE = '\u0000new';

interface Draft {
	name: string;
	title: string;
	house: string;
	sex: string;
	born: string;
	died: string;
	illegitimate: boolean;
	link: string;
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
		title: p.title ?? '',
		house: p.house ?? '',
		sex: p.sex ?? '',
		born: p.born ?? '',
		died: p.died ?? '',
		illegitimate: p.illegitimate,
		link: p.link ?? '',
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
		const next = uniqueId(l.g.byId.get(id)!.name, used);
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
	return [...give, ...mapIds(ops, (s) => ids.get(s) ?? s)];
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
	/** The kind of view that opened the sheet: the saved person is shown there (§5.5). */
	place?: ViewKind;
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
	/** The person left the tree while the sheet was open: the sheet shows the draft but cannot save it. */
	private gone = false;
	private confirmEl: HTMLElement | null = null;
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
		this.cleanup.push(phoneLayout(this, () => this.revealFocused()));
		this.cleanup.push(trackModal(this, () => this.finish()));
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
		for (const c of this.cleanup.splice(0)) c();
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
		return out;
	}

	// ---------- building the form ----------

	private build(): void {
		const el = this.contentEl;
		el.empty();
		this.confirmEl = null;
		el.addClass('dynasty-sheet-content');
		const ro = this.readOnly;
		this.modalEl.toggleClass('is-read-only', ro);

		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		header.createDiv({ cls: 'dynasty-sheet-title', text: this.title() });
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		const cancel = actions.createEl('button', { cls: 'dynasty-sheet-cancel', text: ro ? SHEET.close : SHEET.cancel, attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.finish());
		if (!ro) {
			const save = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-save'], text: SHEET.save, attr: { type: 'button' } });
			save.addEventListener('click', () => void this.save());
			if (this.rel?.kind === 'child') {
				// Spec §6.3: quick entry of several children; in the header, so it stays reachable (spec §7.4).
				const more = header.createEl('button', { cls: 'dynasty-sheet-save-another', text: NEW_SHEET.saveAnother, attr: { type: 'button' } });
				more.addEventListener('click', () => void this.save(true));
			}
		}

		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		this.bodyEl = body;
		body.addEventListener('focusin', () => this.revealFocused(300));
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

		this.textField(body, 'name', SHEET.name, { autocapitalize: 'words' });
		this.textField(body, 'title', SHEET.title);
		this.houseField(body);
		this.sexField(body);
		this.textField(body, 'born', SHEET.born);
		this.textField(body, 'died', SHEET.died);
		this.checkField(body);
		this.textField(body, 'link', SHEET.link, { placeholder: SHEET.linkPlaceholder });
		this.textField(body, 'notes', SHEET.notes, {}, true);
		this.placementField(body);

		if (!this.isNew) {
			this.familySection(body);
			this.actionsSection(body);
			if (!ro) this.deleteSection(body);
		}
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
			const alone = box.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-sheet-alone'], text: NEW_SHEET.noRelatives, attr: { type: 'button' } });
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

	private textField(parent: HTMLElement, key: (typeof TEXT_FIELDS)[number], label: string, o: { autocapitalize?: string; placeholder?: string } = {}, area = false): void {
		const { row, id } = sheetField(parent, label, key);
		// Plain attribute names (no spread), so the colour rule of eslint.config.mjs can check them; null writes no attribute.
		const extra = { autocapitalize: o.autocapitalize ?? null, placeholder: o.placeholder ?? null };
		// born and died are free text (fictional calendars): never a numeric keyboard (spec §7.4).
		const input = area
			? row.createEl('textarea', { cls: 'dynasty-sheet-input', attr: { id, rows: 4, autocapitalize: extra.autocapitalize, placeholder: extra.placeholder } })
			: row.createEl('input', { cls: 'dynasty-sheet-input', attr: { id, type: 'text', autocomplete: 'off', spellcheck: key === 'notes' ? 'true' : 'false', autocapitalize: extra.autocapitalize, placeholder: extra.placeholder } });
		input.value = this.draft[key];
		// Read-only, not disabled: the user can still select and copy the text.
		input.readOnly = this.readOnly;
		input.addEventListener('input', () => {
			this.draft[key] = input.value;
			this.clearError();
		});
	}

	private select(parent: HTMLElement, key: 'house' | 'sex' | 'placement', label: string, options: [string, string][]): HTMLSelectElement {
		const { row, id } = sheetField(parent, label, key);
		const sel = row.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input'], attr: { id } });
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
		const nameInput = name.row.createEl('input', { cls: 'dynasty-sheet-input', attr: { id: name.id, type: 'text', autocomplete: 'off', autocapitalize: 'words' } });
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
		const box = row.createEl('input', { attr: { type: 'checkbox' } });
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
		const b = parent.createEl('button', { cls: ['dynasty-sheet-action', cls], text, attr: { type: 'button' } });
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

	private parentRow(parent: HTMLElement, fam: FamilyView, link: ParentLink): void {
		const name = this.name(link.id);
		const row = parent.createDiv({ cls: 'dynasty-family-row', attr: { 'data-parent': link.id, 'data-type': link.type } });
		row.createDiv({ cls: 'dynasty-family-name', text: name });
		const controls = row.createDiv({ cls: 'dynasty-family-controls' });
		const sel = controls.createEl('select', { cls: ['dropdown', 'dynasty-family-select'], attr: { 'aria-label': FAMILY.parentTypeLabel(name) } });
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

	private actionsSection(parent: HTMLElement): void {
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

	private deleteSection(parent: HTMLElement): void {
		const sec = parent.createDiv({ cls: 'dynasty-sheet-section dynasty-delete' });
		const b = this.button(sec, FAMILY.deletePerson, 'dynasty-delete-person', () => this.confirmDelete());
		b.addClass('mod-warning');
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
		const sheet = EditSheet.createNew(this.app, { handle: this.o.handle, sourcePath: this.o.sourcePath, beforeWrite: this.o.beforeWrite, openNote: this.o.openNote, newPerson: rel, initialName: name, parentSheet: this, place: this.o.place });
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
			if (out.ok) return out;
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
				else if (code === 'unknown-union' || code === 'unknown-person') this.stale(h.body);
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
		const ids = idsFor(this.data, [this.data.person.id, ...namesIn(all)]);
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
		// The id newPersonId gives, also unused by the ids above.
		const id = uniqueId(name, takenIds(this.data, ids.values()));
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
		const s = describeDelete(this.data.g, p.id, { start: this.data.tree.options.start, focus: this.data.tree.options.focus });
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
		const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
		this.confirmEl = layer;
		const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
		box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: c.title });
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
		this.confirmEl?.remove();
		this.confirmEl = null;
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
		const r = loadSheet(body, this.isNew ? null : id);
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
