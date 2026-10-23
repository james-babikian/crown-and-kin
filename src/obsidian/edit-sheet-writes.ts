/*
 * The writes of the edit sheet (0.3.3, WP-1 A1; spec §6.1, §6.3): the draft as an operation, the write through the handle, Save, the relationship writes, and the reload
 * after a write. Sixth layer of the chain listed in `edit-sheet.ts`.
 */

import { Notice } from 'obsidian';
import type { Op } from '../core/edit';
import { nextPersonId } from '../core/id-gen';
import { newHouseId } from '../core/yaml-edit';
import { NEW_SHEET, REMOVE, SHEET, UNION_EDIT, WRITE_TEXT, deleteText, unionTypeText } from '../render/ui-text';
import { normBody } from '../core/block-match';
import { andList } from '../core/messages';
import { CHANGE_UI } from '../render/change-text';
import type { HandleWriteOutcome, Written } from './block-handle';
import { describeDelete, type ParentLink, type PartnerLink } from '../core/family-query';
import { autoUnionNotice, unionOp } from './family-flows';
import { afterPaint, freshOrStale, onWriteFailed } from './sheet-parts';
import { undoIfUnchanged, undoNotice } from './undo-notice';
import { openUnionEditor } from './union-edit';
import { EditSheetActions } from './edit-sheet-actions';
import { SLOW_SAVE_PEOPLE, type DraftWritten, type EditSheetBase } from './edit-sheet-base';
import { NEW_HOUSE, loadSheet, findUnion, mapIds, opNames, unwritten, sameUnwritten, takenIds, idsFor, withIds, holderNames, type Draft } from '../view/sheet-draft';

/** The writes of the sheet: the draft, Save, the relationship writes and the reload. */
export abstract class EditSheetWrites extends EditSheetActions {
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
	protected validate(): boolean {
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
	protected fresh(): boolean {
		return freshOrStale(this.o.handle, this.data.body, (body) => this.stale(body));
	}

	protected buildOp(): Op | null {
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
	protected newPersonOps(id: string, taken: string[]): Op[] {
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
				ops.push({ kind: 'add-person', id, fields, parents: parents.map((p) => ({ id: p, type: 'birth' })), at: { kind: 'after-siblings', parents, ...(rel.union ? { union: rel.union } : {}) } });
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
	 * Notice and in the sheet, and the draft stays. `saves`: the write is a Save that closes the window (or a Save and add another);
	 * only that moves the phone list to the person (B1). An in-place write does not.
	 */
	protected async write(ops: Op[], highlight: string | null, saves = false): Promise<Written | null> {
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
		const prev = { lastEdited: h.state.lastEdited, lastSaved: h.state.lastSaved, listHold: h.state.listHold, highlight: h.state.highlight, shown: h.state.shown };
		const restore = () => {
			h.state.lastEdited = prev.lastEdited;
			h.state.lastSaved = prev.lastSaved;
			h.state.listHold = prev.listHold;
			h.state.highlight = prev.highlight;
			h.state.shown = prev.shown;
		};
		// Set before the write: the re-render that follows can run before the write returns.
		if (highlight) {
			h.state.lastEdited = highlight;
			if (saves) {
				h.state.lastSaved = highlight;
				h.state.listHold = false;
			} else {
				h.state.listHold = true;
				this.holdsList = true;
			}
			h.state.highlight = { id: highlight, until: performance.now() + 3000 };
			h.state.shown = { id: highlight, place: this.o.place ?? 'embed' };
		}
		try {
			if (slow) await afterPaint(this.modalEl.win ?? window);
			this.o.beforeWrite?.();
			const out = await h.write(op);
			if (out.ok) {
				// A Save moves the list (rung 4): the earlier in-place writes of this window hold it no more, also after the window closes.
				if (saves) this.holdsList = false;
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
			if (this.closed) this.endHold();
		}
	}

	/**
	 * B1: the window no longer holds the phone list. The hold does not just stop: the next redraw of each list of the block still keeps the person it
	 * stands on (`listKeep`, a count that each list reads once), because a redraw can come after the window (a write that ended late, a note change).
	 * Nothing to do for a window that did not write in place, or that ended with a Save.
	 */
	protected endHold(): void {
		if (!this.holdsList) return;
		this.holdsList = false;
		const st = this.o.handle.state;
		st.listHold = false;
		st.listKeep = (st.listKeep ?? 0) + 1;
	}

	/** F6: the sign that a write runs: the Save button and the status line say "Wait" until the write ends. */
	protected showSaving(on: boolean): void {
		this.shell?.save?.setText(on ? SHEET.saveWait : SHEET.save);
		this.statusEl?.setText(on ? SHEET.savingStatus : this.status);
		this.statusEl?.toggle(on || this.status !== '');
	}

	/** F12: tells the tree view about an ok write, so a person the fold hides (the sheet's or an added one) shows. It never fails the write. */
	protected foldsWritten(highlight: string | null, created: readonly string[]): void {
		const folds = this.o.folds;
		if (!folds) return;
		const own = highlight ?? (this.isNew ? null : this.data.person.id);
		try {
			folds.written([...new Set([...(own ? [own] : []), ...created])]);
		} catch (e) {
			console.error('Crown and Kin: cannot show the people that folds hide', e);
		}
	}

	protected failed(out: Exclude<HandleWriteOutcome, { ok: true }>): void {
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
	protected async writeWithDraft(ops: Op[], highlight: string | null = this.data.person.id, show: 'build' | 'in-place' = 'build'): Promise<DraftWritten | null> {
		this.lastError = '';
		const pending = this.pendingOps();
		if (pending === null) return null;
		const all = [...pending, ...ops];
		// The refusal `limit` says which type is full: the text differs for a rumoured parent (contract B.3).
		this.limitType = ops.map((op) => (op.kind === 'add-parent' ? op.type : op.kind === 'set-parent-type' ? op.to : undefined)).find((t) => t !== undefined);
		const ids = idsFor(this.data, [this.data.person.id, ...opNames(all), ...holderNames(all)]);
		const out = await this.write(withIds(all, ids), highlight === null ? null : (ids.get(highlight) ?? highlight));
		if (!out) return null;
		// 'in-place' is for a control that the user is using now (r032). A write that carries field changes needs the full form again.
		if (show === 'in-place' && pending.length === 0) this.showParentTypes(out.body, ids);
		else this.afterWrite(out.body, ids);
		return { ...out, withFields: pending.length > 0 };
	}

	/**
	 * The Notice with Undo after a removal or a note write. Undo reverts the whole write, so the Notice says when
	 * the write also saved field changes; after Undo the open sheet shows the restored data. `was`:
	 * the person's id before the write, which Undo gives back if the write gave them their first id.
	 * `undone` is the text after Undo, when it is not the generic one.
	 */
	protected removedNotice(text: string, out: DraftWritten, was: string, undone?: string): void {
		const h = this.o.handle;
		undoNotice(out.withFields ? `${text} ${REMOVE.undoAlso}` : text, h, out.body, () => {
			if (!this.shown) return;
			const id = this.data.person.id;
			// reload, not afterWrite: text typed after the removal stays in the draft.
			this.reload(h.body, id !== was && loadSheet(h.body, id, this.o.dates).kind === 'gone' ? was : id);
		}, undone);
	}

	protected async save(another = false): Promise<void> {
		if (this.saving || this.readOnly) return;
		if (!this.validate()) return;
		if (!this.isNew) {
			const op = this.buildOp();
			if (!op) {
				this.finish();
				return;
			}
			if (await this.write([op], this.data.person.id, true)) this.finish();
			return;
		}
		if (this.relBlocked) {
			this.showError(this.relNote ?? NEW_SHEET.needPartnership);
			return;
		}
		const parent = this.o.parentSheet;
		const pending = parent ? parent.pendingOps() : [];
		const parentWas = parent?.data.person.id ?? '';
		if (pending === null) {
			this.showError(WRITE_TEXT.needNameFirst);
			return;
		}
		const name = this.draft.name.trim();
		// The related people and the parent sheet's person get an id if they have none (see `idsFor`).
		const ids = idsFor(this.data, [...(parent ? [parent.data.person.id] : []), ...this.relIds(), ...opNames(pending)]);
		// The next free person id (D104), also unused by the ids above.
		const id = nextPersonId(takenIds(this.data, ids.values()));
		const taken = pending.flatMap((op) => (op.kind === 'batch' ? op.ops : [op])).filter((op) => op.kind === 'add-house').map((op) => (op.kind === 'add-house' && parent ? newHouseId(parent.data.data, op.name) : ''));
		const out = await this.write(withIds([...pending, ...this.newPersonOps(id, taken)], ids), id, true);
		if (!out) {
			// The parent sheet shows the same new data as this one after a stale write.
			if (parent && normBody(parent.data.body) !== normBody(this.o.handle.body)) parent.reload(this.o.handle.body);
			return;
		}
		parent?.afterWrite(out.body, ids);
		const old = this.rel!;
		if (parent) this.announceAdded(parent, name, parentWas, out, pending.length > 0);
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
		this.take(r.data);
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
	 * D267: the text line of the window for an action that wrote at once. A later action replaces it. `written`: the body of the write, which Undo needs
	 * to find unchanged. `withFields`: the write also saved field changes of this window, which Undo removes too (the text says so).
	 */
	announce(text: string, written: string, was: string, withFields: boolean): void {
		const size = this.o.handle.undoSize;
		this.change = { text: withFields ? `${text} ${REMOVE.undoAlso}` : text, written, was, depth: typeof size === 'number' ? size : null };
		this.paintChange(true);
	}

	/** D267: the window that started this one comes back and says what the Save changed. A new person with no relative says nothing. */
	protected announceAdded(parent: EditSheetBase, name: string, was: string, out: Written, withFields: boolean): void {
		const text = this.addedText(this.rel!, name, out.effects);
		if (text) parent.announce(text, out.body, was, withFields);
	}

	/** The text of the line for the new person that a Save added to the window that started this one (D267); null when the new person has no relative. */
	protected addedText(rel: NonNullable<EditSheetWrites['rel']>, name: string, effects: readonly string[]): string | null {
		switch (rel.kind) {
			case 'parent': {
				// The marriage is with the child's first parent of the same type (the data of this window is from before the write).
				const otherId = effects.includes('auto-union') ? this.data.g.byId.get(rel.child)?.parents.find((l) => l.type === rel.type)?.id : undefined;
				return otherId === undefined ? CHANGE_UI.addedParent(name, this.name(rel.child), rel.type) : CHANGE_UI.addedParentAndMarriage(name, this.name(rel.child), rel.type, this.name(otherId));
			}
			case 'child':
				return CHANGE_UI.addedChild(name, andList([rel.parent, ...(rel.other === null ? [] : [rel.other])].map((id) => this.name(id))), 'birth');
			case 'partner':
				return CHANGE_UI.addedPartner(name, this.name(rel.partner));
			default:
				return null;
		}
	}

	/**
	 * Undo of the text line (D267). It acts only while the block is still what the action wrote (or what a link update after a rename made of it), as the
	 * Undo of a Notice does (`undoNotice`); otherwise it refuses with the same Notice. The window stays open and shows the restored data.
	 */
	protected async undoChange(): Promise<void> {
		const c = this.change;
		const h = this.o.handle;
		if (!c || c.written === null || this.changeBusy || this.saving) return;
		this.changeBusy = true;
		try {
			// The depth check: when another write stands above the one of the line, the body can be the same again (a pin set and removed).
			if (!(await undoIfUnchanged(h, c.written, c.depth))) return;
			this.change = { text: CHANGE_UI.undone, written: null, was: c.was, depth: null };
			if (!this.shown) return;
			const id = this.data.person.id;
			// reload, not afterWrite: text typed after the action stays in the draft.
			this.reload(h.body, id !== c.was && loadSheet(h.body, id, this.o.dates).kind === 'gone' ? c.was : id);
			this.paintChange();
			this.changeEl?.focus({ preventScroll: true });
		} catch (e) {
			console.error('Crown and Kin: cannot undo', e);
			new Notice(WRITE_TEXT.undoChanged);
		} finally {
			this.changeBusy = false;
		}
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
		this.take(r.data);
		this.gone = false;
		this.build();
		if (this.bodyEl) this.bodyEl.scrollTop = top;
	}

	protected async moveSibling(direction: 'earlier' | 'later'): Promise<void> {
		await this.writeWithDraft([{ kind: 'move-sibling', id: this.data.person.id, direction }]);
		// The buttons are rebuilt; keep the keyboard focus on the one the user pressed.
		this.contentEl.querySelector<HTMLButtonElement>(`.dynasty-move-${direction}:not(:disabled)`)?.focus();
	}

	protected async removeParent(link: ParentLink): Promise<void> {
		const child = this.data.person;
		const parentName = this.name(link.id);
		const out = await this.writeWithDraft([{ kind: 'remove-parent', child: child.id, parent: link.id, type: link.type }]);
		if (out) this.removedNotice(REMOVE.removedParent(parentName, child.name), out, child.id);
	}

	protected editPartnership(link: PartnerLink): void {
		const u = link.union;
		if (!u || this.pendingOps() === null || !this.fresh()) return;
		const values = (l: PartnerLink) => ({ type: l.type ?? 'marriage', start: l.start ?? '', end: l.end ?? '' });
		openUnionEditor(this.app, this.data.person.name, this.name(link.partner), values(link), async (next) => {
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

	protected confirmRemovePartnership(link: PartnerLink): void {
		const u = link.union;
		if (!u || this.pendingOps() === null || !this.fresh()) return;
		const a = this.data.person.name;
		const b = this.name(link.partner);
		const was = this.data.person.id;
		this.showConfirm({
			title: REMOVE.partnershipTitle,
			text: [REMOVE.partnershipText(unionTypeText(link.type ?? 'marriage'), a, b), REMOVE.canUndo],
			confirm: REMOVE.removeConfirm,
			confirmCls: 'dynasty-confirm-remove-union',
			keep: REMOVE.cancel,
			onConfirm: () =>
				void this.writeWithDraft([{ kind: 'remove-union', union: u }]).then((out) => {
					if (out) this.removedNotice(REMOVE.removedPartnership(a, b), out, was);
				}),
		});
	}

	protected confirmDelete(): void {
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
	protected async deletePerson(): Promise<void> {
		const p = this.data.person;
		const h = this.o.handle;
		const out = await this.write([{ kind: 'delete-person', id: p.id }], null);
		if (!out) return;
		if (h.state.lastEdited === p.id) h.state.lastEdited = null;
		if (h.state.lastSaved === p.id) h.state.lastSaved = null;
		this.finish();
		undoNotice(REMOVE.deleted(p.name), h, out.body);
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
