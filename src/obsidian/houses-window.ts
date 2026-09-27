/*
 * The Houses window (spec §6.10, D32, D36): the houses of one tree with their names and colours. Like
 * the edit sheet it is a draft: Save writes every change in one write (one undo step), Cancel
 * writes nothing, and any other way to close asks first. A colour comes from the 12 house colours
 * (D32) or from the system colour window ("Other colour"). Deleting a house that people have asks
 * whether to remove the house from them or keep it (D32); after Save, a Notice with Undo says so.
 */

import { Modal, Notice, setIcon, type App } from 'obsidian';
import { deriveFamilies } from '../core/derive';
import type { Op } from '../core/edit';
import { parseDynasty } from '../core/parse';
import { HOUSE_PALETTE } from '../render/styles';
import { HOUSES, HOUSE_COLOUR_NAMES, REMOVE, SHEET, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';
import { drawableColour, freshOrStale, onWriteFailed, showErrorLine } from './sheet-parts';
import { undoNotice } from './undo-notice';

const HEX = /^#[0-9a-f]{6}$/i;

/** One house as the Houses window shows it: its id, name, colour and the people who have it. */
export interface LoadedHouse {
	id: string;
	name: string;
	/** As written in the tree; null when there is none. */
	colour: string | null;
	/** Names of the people who have this house, in tree order. */
	people: string[];
}

/** The tree's houses, loaded from one block body. */
export interface LoadedHouses {
	body: string;
	houses: LoadedHouse[];
}

/** One house in the draft. `id` null: a house added in this window. */
export interface HouseRow {
	key: string;
	id: string | null;
	name: string;
	colour: string | null;
	base: { name: string; colour: string | null } | null;
	/** Deleted in the draft, and what happens to its people (D32). */
	deleted: 'clear' | 'keep' | null;
	/** The user chose `deleted` in the D32 question; false for a house that had no people then. */
	asked?: boolean;
}

/** The houses of a block body, or why the window cannot edit them. */
export function loadHouses(body: string): { kind: 'ok'; data: LoadedHouses } | { kind: 'invalid' } | { kind: 'blocked' } {
	const parsed = parseDynasty(body);
	if (!parsed.ok) return { kind: 'invalid' };
	const tree = parsed.tree;
	if (deriveFamilies(tree).issues.some((i) => i.level === 'blocking')) return { kind: 'blocked' };
	const seen = new Set<string>();
	const houses: LoadedHouse[] = [];
	for (const h of tree.houses) {
		// The first house with an id is the one the tree uses (spec §8, the decision notes "Validation rules").
		if (seen.has(h.id)) continue;
		seen.add(h.id);
		const people: string[] = [];
		const ids = new Set<string>();
		for (const p of tree.people) {
			if (p.house !== h.id || ids.has(p.id)) continue;
			ids.add(p.id);
			people.push(p.name || p.id);
		}
		houses.push({ id: h.id, name: h.name, colour: h.color ?? null, people });
	}
	return { kind: 'ok', data: { body, houses } };
}

/** The houses as draft rows; `key` names each row in the window (an id can hold any text, a key cannot). */
export function rowsOf(data: LoadedHouses, key?: () => string): HouseRow[] {
	let n = 0;
	const next = key ?? (() => `h${n++}`);
	return data.houses.map((h) => ({ key: next(), id: h.id, name: h.name, colour: h.colour, base: { name: h.name, colour: h.colour }, deleted: null }));
}

const lower = (c: string | null) => (c === null ? null : c.toLowerCase());

/** D32: a new house takes the first house colour that no house in the draft uses. */
export function firstFreeColour(rows: HouseRow[]): string {
	const used = new Set(rows.filter((r) => !r.deleted).map((r) => lower(r.colour)));
	return HOUSE_PALETTE.find((c) => !used.has(c)) ?? HOUSE_PALETTE[0];
}

/** The draft as ops, in the order edits, deletes, new houses. Empty if nothing changed. */
export function houseOps(rows: HouseRow[]): Op[] {
	const edits: Op[] = [];
	const deletes: Op[] = [];
	const adds: Op[] = [];
	for (const r of rows) {
		if (r.id === null) {
			if (!r.deleted) adds.push({ kind: 'add-house', name: r.name.trim(), ...(r.colour && HEX.test(r.colour) ? { color: r.colour.toLowerCase() } : {}) });
			continue;
		}
		if (r.deleted) {
			deletes.push({ kind: 'delete-house', id: r.id, people: r.deleted });
			continue;
		}
		const base = r.base!;
		const name = r.name.trim() !== base.name ? r.name.trim() : undefined;
		const colour = lower(r.colour) !== lower(base.colour) && r.colour && HEX.test(r.colour) ? r.colour.toLowerCase() : undefined;
		if (name !== undefined || colour !== undefined) edits.push({ kind: 'edit-house', id: r.id, ...(name !== undefined ? { name } : {}), ...(colour !== undefined ? { color: colour } : {}) });
	}
	return [...edits, ...deletes, ...adds];
}

/** What opens a `HousesWindow`. */
export interface HousesOptions {
	handle: Handle;
	/** Runs just before the write, so the tree view keeps its view (spec §5.5). */
	beforeWrite?: () => void;
	/** Runs when the window has closed: the focus goes back to the Houses button (spec §5.2). */
	onClosed?: () => void;
}

/** The modal that lists a tree's houses and edits their names and colours (spec §6.10). */
export class HousesWindow extends Modal {
	private data: LoadedHouses;
	private rows: HouseRow[];
	private openKey: string | null = null;
	private keys = 0;
	private saving = false;
	private closing = false;
	private confirmEl: HTMLElement | null = null;
	/** Where the focus goes when a question over the window closes. */
	private confirmFrom: string | null = null;
	private errorEl: HTMLElement | null = null;
	private error = '';
	private readonly cleanup: (() => void)[] = [];

	/** Null, with a Notice, if the block cannot be edited now. */
	static create(app: App, o: HousesOptions): HousesWindow | null {
		const l = loadHouses(o.handle.body);
		if (l.kind === 'ok') return new HousesWindow(app, o, l.data);
		new Notice(l.kind === 'blocked' ? WRITE_TEXT.blocked : HOUSES.cannotOpen);
		return null;
	}

	private constructor(
		app: App,
		private readonly o: HousesOptions,
		data: LoadedHouses,
	) {
		super(app);
		this.data = data;
		this.rows = rowsOf(data, () => this.nextKey());
	}

	/** Builds the window and gives it the keyboard focus. */
	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-houses');
		this.cleanup.push(phoneLayout(this), trackModal(this, () => this.finish()));
		this.build();
		// Keyboard users start at the top of the window, not in the note below it.
		this.modalEl.setAttribute('tabindex', '-1');
		this.modalEl.focus({ preventScroll: true });
	}

	/** Runs the cleanup functions `onOpen` registered and hands the focus back to the caller. */
	override onClose(): void {
		// The focused control goes with the window: let go of it first, so the focus can go back to the Houses button.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		if (active && this.modalEl.contains(active)) active.blur();
		for (const c of this.cleanup.splice(0)) c();
		this.contentEl.empty();
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot return the focus', e);
		}
	}

	/** Esc, the X button, a press outside and Android back all come here (spec §6.3 commit model). */
	override close(): void {
		if (this.closing) {
			super.close();
			return;
		}
		if (this.confirmEl) {
			this.hideConfirm();
			return;
		}
		if (this.openKey !== null) {
			const key = this.openKey;
			this.openKey = null;
			this.build(`swatch:${key}`);
			return;
		}
		if (this.isDirty()) {
			this.showConfirm(SHEET.discardTitle, [HOUSES.discardText], null, [
				{ label: SHEET.keepEditing, cls: 'dynasty-sheet-keep', run: () => this.hideConfirm() },
				{ label: SHEET.discard, cls: 'mod-warning dynasty-sheet-discard', run: () => this.finish() },
			]);
			return;
		}
		this.finish();
	}

	private nextKey(): string {
		return `h${this.keys++}`;
	}

	private finish(): void {
		this.closing = true;
		this.close();
	}

	/** True if the draft has an unsaved change (an edit, a delete or a new house). */
	isDirty(): boolean {
		return houseOps(this.rows).length > 0;
	}

	// ---------- building the window ----------

	/** Draws the window again from the draft; `focus` names the control that gets the focus. */
	private build(focus: string | null = null): void {
		const el = this.contentEl;
		// A control that had the focus keeps it (for example Save after a stale write), so the focus never leaves the window.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		const had = active && el.contains(active) ? active.getAttribute('data-focus') : null;
		focus ??= had;
		el.empty();
		this.hideConfirm(false);
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		header.createDiv({ cls: 'dynasty-sheet-title', text: HOUSES.title });
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		const cancel = actions.createEl('button', { cls: 'dynasty-sheet-cancel', text: SHEET.cancel, attr: { type: 'button', 'data-focus': 'cancel' } });
		cancel.addEventListener('click', () => this.finish());
		const save = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-save'], text: SHEET.save, attr: { type: 'button', 'data-focus': 'save' } });
		save.addEventListener('click', () => void this.save());

		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		body.createDiv({ cls: 'dynasty-sheet-hint', text: HOUSES.intro });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.setText(this.error);
		this.errorEl.toggle(this.error !== '');
		const list = body.createDiv({ cls: 'dynasty-house-list' });
		const shown = this.rows.filter((r) => !r.deleted);
		if (!shown.length) list.createDiv({ cls: 'dynasty-house-none', text: HOUSES.none });
		for (const r of shown) this.row(list, r);
		const add = body.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-house-add'], text: HOUSES.add, attr: { type: 'button', 'data-focus': 'add' } });
		add.addEventListener('click', () => this.guard(() => this.addHouse()));
		if (focus) el.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
	}

	private label(r: HouseRow): string {
		return r.name.trim() || HOUSES.newHouse;
	}

	private row(list: HTMLElement, r: HouseRow): void {
		const row = list.createDiv({ cls: 'dynasty-house-row', attr: { 'data-house': r.id ?? r.key } });
		const open = this.openKey === r.key;
		const swatch = row.createEl('button', {
			cls: open ? ['dynasty-house-swatch', 'is-open'] : 'dynasty-house-swatch',
			attr: { type: 'button', 'aria-label': HOUSES.swatchLabel(this.label(r)), 'aria-expanded': String(open), 'data-focus': `swatch:${r.key}` },
		});
		// The only colour the plugin writes into the page is a house colour, as a custom property (spec §5.8).
		if (drawableColour(r.colour)) swatch.style.setProperty('--dynasty-house-color', r.colour);
		else swatch.addClass('is-none');
		swatch.addEventListener('click', () =>
			this.guard(() => {
				this.openKey = open ? null : r.key;
				this.build(`swatch:${r.key}`);
			}),
		);
		const name = row.createEl('input', { cls: 'dynasty-sheet-input', attr: { type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', 'aria-label': HOUSES.nameLabel, 'data-focus': `name:${r.key}` } });
		name.value = r.name;
		name.addEventListener('input', () => {
			r.name = name.value;
			this.clearError();
		});
		const n = r.id === null ? 0 : (this.data.houses.find((h) => h.id === r.id)?.people.length ?? 0);
		row.createDiv({ cls: 'dynasty-house-count', text: HOUSES.count(n) });
		const del = row.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-house-delete'], text: HOUSES.delete, attr: { type: 'button', 'aria-label': HOUSES.deleteLabel(this.label(r)), 'data-focus': `delete:${r.key}` } });
		del.addEventListener('click', () => this.guard(() => this.askDelete(r)));
		if (open) this.palette(list, r);
	}

	/** D32: the 12 house colours and "Other colour" (the system colour window). */
	private palette(list: HTMLElement, r: HouseRow): void {
		const box = list.createDiv({ cls: 'dynasty-house-palette', attr: { 'data-house': r.id ?? r.key } });
		const title = box.createDiv({ cls: 'dynasty-sheet-label', text: HOUSES.paletteTitle(this.label(r)) });
		const titleId = `dynasty-house-palette-${r.key}-${this.keys}`;
		title.setAttribute('id', titleId);
		const grid = box.createDiv({ cls: 'dynasty-house-colours', attr: { role: 'group', 'aria-labelledby': titleId } });
		HOUSE_PALETTE.forEach((hex, i) => {
			const chosen = lower(r.colour) === hex;
			const b = grid.createEl('button', {
				cls: chosen ? ['dynasty-house-colour', 'is-selected'] : 'dynasty-house-colour',
				attr: { type: 'button', 'aria-label': HOUSE_COLOUR_NAMES[i], 'aria-pressed': String(chosen), 'data-colour': hex, 'data-focus': `colour:${r.key}:${hex}` },
			});
			b.style.setProperty('--dynasty-house-color', hex);
			if (chosen) setIcon(b, 'check');
			b.addEventListener('click', () =>
				this.guard(() => {
					r.colour = hex;
					this.build(`colour:${r.key}:${hex}`);
				}),
			);
		});
		const other = box.createDiv({ cls: 'dynasty-house-other' });
		const id = `${titleId}-other`;
		const input = other.createEl('input', { cls: 'dynasty-sheet-colour', attr: { type: 'color', id, 'data-focus': `other:${r.key}` } });
		input.value = r.colour && HEX.test(r.colour) ? r.colour.toLowerCase() : '#888888';
		other.createEl('label', { cls: 'dynasty-house-other-label', text: HOUSES.otherColour, attr: { for: id } });
		input.addEventListener('change', () =>
			this.guard(() => {
				if (!HEX.test(input.value)) return;
				r.colour = input.value.toLowerCase();
				this.build(`other:${r.key}`);
			}),
		);
	}

	private addHouse(): void {
		const key = this.nextKey();
		this.rows.push({ key, id: null, name: '', colour: firstFreeColour(this.rows), base: null, deleted: null });
		this.openKey = null;
		this.clearError();
		this.build(`name:${key}`);
	}

	/** The control that takes the focus after a row goes: the next row's Delete, else Add house. */
	private focusAfter(r: HouseRow): string {
		const shown = this.rows.filter((x) => !x.deleted || x === r);
		const next = shown[shown.indexOf(r) + 1];
		return next ? `delete:${next.key}` : 'add';
	}

	private peopleOf(r: HouseRow): string[] {
		return r.id === null ? [] : (this.data.houses.find((h) => h.id === r.id)?.people ?? []);
	}

	private askDelete(r: HouseRow): void {
		const after = this.focusAfter(r);
		const people = this.peopleOf(r);
		const drop = (how: 'clear' | 'keep', asked: boolean) => {
			if (r.id === null) this.rows.splice(this.rows.indexOf(r), 1);
			else {
				r.deleted = how;
				r.asked = asked;
			}
			if (this.openKey === r.key) this.openKey = null;
			this.build(after);
		};
		if (!people.length) {
			drop('clear', false);
			return;
		}
		this.askPeople(r, people, `delete:${r.key}`, (how) => drop(how, true), () => this.hideConfirm());
	}

	/** The D32 question: what happens to the people of a house that is deleted. */
	private askPeople(r: HouseRow, people: string[], from: string | null, chose: (how: 'clear' | 'keep') => void, cancel: () => void): void {
		const name = r.base?.name || this.label(r);
		this.showConfirm(HOUSES.confirmTitle(name), [HOUSES.confirmPeople(people), HOUSES.confirmAsk], from, [
			{ label: HOUSES.clearLabel, detail: HOUSES.clearDetail, cls: 'dynasty-choice-option dynasty-house-clear', run: () => chose('clear') },
			{ label: HOUSES.keepLabel, detail: HOUSES.keepDetail, cls: 'dynasty-choice-option dynasty-house-keep', run: () => chose('keep') },
			{ label: HOUSES.cancel, cls: 'dynasty-sheet-keep', run: cancel },
		]);
	}

	/**
	 * A house deleted with no question (it had no people) can have people after a reload (sync,
	 * another pane): D32 lets the user choose for them before anything is written. True if it asked.
	 */
	private askAgain(): boolean {
		const r = this.rows.find((x) => x.id !== null && x.deleted && !x.asked && this.peopleOf(x).length > 0);
		if (!r) return false;
		this.askPeople(
			r,
			this.peopleOf(r),
			'save',
			(how) => {
				r.deleted = how;
				r.asked = true;
				this.build('save');
			},
			() => {
				// Cancel keeps the house: it comes back into the list.
				r.deleted = null;
				this.build('save');
			},
		);
		return true;
	}

	// ---------- questions over the window ----------

	private showConfirm(title: string, text: string[], from: string | null, buttons: { label: string; detail?: string; cls: string; run: () => void }[]): void {
		this.hideConfirm(false);
		// Without a named control, the focus goes back to the one that had it, else to Save (it must stay in the window).
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		this.confirmFrom = from ?? (active && this.contentEl.contains(active) ? active.getAttribute('data-focus') : null) ?? 'save';
		const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
		this.confirmEl = layer;
		const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
		const titleEl = box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: title });
		const titleId = `dynasty-houses-confirm-${Math.random().toString(36).slice(2, 8)}`;
		titleEl.setAttribute('id', titleId);
		layer.setAttribute('aria-labelledby', titleId);
		for (const t of text) box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
		const options = buttons.filter((b) => b.detail !== undefined);
		const choices = options.length ? box.createDiv({ cls: 'dynasty-choice-options' }) : null;
		const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
		let first: HTMLElement | null = null;
		for (const b of buttons) {
			const el = (b.detail !== undefined && choices ? choices : row).createEl('button', { cls: b.cls.split(' '), attr: { type: 'button' } });
			if (b.detail !== undefined) {
				el.createSpan({ cls: 'dynasty-choice-label', text: b.label });
				el.createSpan({ cls: 'dynasty-choice-detail', text: b.detail });
			} else el.setText(b.label);
			el.addEventListener('click', () => this.guard(b.run));
			first ??= el;
		}
		first?.focus();
	}

	private hideConfirm(refocus = true): void {
		const had = this.confirmEl !== null;
		this.confirmEl?.remove();
		this.confirmEl = null;
		if (had && refocus && this.confirmFrom) this.contentEl.querySelector<HTMLElement>(`[data-focus="${this.confirmFrom}"]`)?.focus();
		this.confirmFrom = null;
	}

	// ---------- writes ----------

	/** True if the window shows the handle's current body; otherwise the stale message and false (spec §6.1). */
	private fresh(): boolean {
		return freshOrStale(this.o.handle, this.data.body, (body) => this.stale(body));
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		const empty = this.rows.find((r) => !r.deleted && r.name.trim() === '' && (r.id === null || r.name.trim() !== r.base?.name));
		if (empty) {
			this.showError(HOUSES.needName);
			this.contentEl.querySelector<HTMLElement>(`[data-focus="name:${empty.key}"]`)?.focus();
			return;
		}
		if (this.askAgain()) return;
		const ops = houseOps(this.rows);
		if (!ops.length) {
			this.finish();
			return;
		}
		if (!this.fresh()) return;
		const deleted = this.rows.filter((r) => r.id !== null && r.deleted).map((r) => r.base?.name || r.id!);
		const h = this.o.handle;
		this.saving = true;
		this.modalEl.addClass('is-saving');
		let out: HandleWriteOutcome;
		try {
			this.o.beforeWrite?.();
			// One write, so one Undo reverts every change of the window (spec §6.1, D8).
			out = await h.write({ kind: 'batch', ops });
		} catch (e) {
			console.error('Dynasty Tree: cannot save the houses', e);
			this.refused(HOUSES.failed);
			return;
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
		if (!out.ok) {
			this.failed(out);
			return;
		}
		this.finish();
		if (deleted.length) {
			const others = ops.length > deleted.length;
			undoNotice(others ? `${HOUSES.deleted(deleted)} ${REMOVE.undoAlso}` : HOUSES.deleted(deleted), h, out.body);
		}
	}

	private failed(out: Exclude<HandleWriteOutcome, { ok: true }>): void {
		const h = this.o.handle;
		onWriteFailed(out, {
			stale: () => this.stale(h.body),
			missing: () => this.refused(HOUSES.missing),
			refused: (code) => {
				// A house that is not in the tree now: the tree changed under the window.
				if (code === 'unknown-house') this.stale(h.body);
				else if (code === 'blocked') this.refused(WRITE_TEXT.blocked);
				else if (code === 'invalid-yaml') this.refused(HOUSES.invalid);
				else this.refused(HOUSES.refused);
			},
		});
	}

	/** Spec §6.1 stale write: a Notice, the new data in the window, and the draft kept with a message that says so. */
	private stale(body: string): void {
		new Notice(WRITE_TEXT.stale);
		this.reload(body);
		this.showError(HOUSES.stale);
	}

	/**
	 * Shows the block's new houses. A house the user changed keeps the user's name or colour; the
	 * other values are the new ones. A house that is gone leaves the draft; new houses stay.
	 */
	private reload(body: string): void {
		const l = loadHouses(body);
		if (l.kind !== 'ok') {
			this.refused(l.kind === 'blocked' ? WRITE_TEXT.blocked : HOUSES.invalid);
			return;
		}
		const old = new Map(this.rows.filter((r) => r.id !== null).map((r) => [r.id!, r]));
		const next = rowsOf(l.data, () => this.nextKey()).map((fresh) => {
			const was = old.get(fresh.id!);
			if (!was) return fresh;
			return {
				...fresh,
				key: was.key,
				name: was.name !== was.base!.name ? was.name : fresh.name,
				colour: lower(was.colour) !== lower(was.base!.colour) ? was.colour : fresh.colour,
				deleted: was.deleted,
				asked: was.asked,
			};
		});
		this.data = l.data;
		this.rows = [...next, ...this.rows.filter((r) => r.id === null)];
		if (this.openKey !== null && !this.rows.some((r) => r.key === this.openKey)) this.openKey = null;
		this.build();
	}

	private refused(text: string): void {
		new Notice(text);
		this.showError(text);
	}

	private showError(text: string): void {
		this.error = text;
		showErrorLine(this.errorEl, text);
	}

	private clearError(): void {
		if (!this.error) return;
		this.error = '';
		this.errorEl?.hide();
	}

	/** A failed step never leaves an exception in Obsidian (spec §8). */
	private guard(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error('Dynasty Tree: the Houses window failed', e);
		}
	}
}
