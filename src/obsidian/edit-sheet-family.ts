/*
 * The Family section of the edit sheet and the small pieces of rows and buttons it shares (0.3.3, WP-1 A1; spec §6.3, G.7): parents, partners, children, the place
 * among the siblings, a move to another person, and the update in place after a change of a parent type (r032). Fourth layer of the chain listed in `edit-sheet.ts`.
 */

import { setIcon } from 'obsidian';
import type { ParentKind } from '../core/edit';
import { PARENT_LIMIT, PARENT_TYPES } from '../core/types';
import { dateLine, relationInfo } from '../render/tree-info';
import { quotedSobriquet } from '../core/sobriquet';
import { FAMILY, ME_UI, SHEET, WINDOW_UI, parentTypeText, partnerDetail } from '../render/ui-text';
import type { FamilyView, ParentLink, PartnerLink } from '../core/family-query';
import { addChild, addParentFlow, addPartner } from './family-flows';
import { relationsFor, validMe } from '../view/relation-cache';
import { renderRelationLine, type RelationView } from './sheet-relation';
import { titlesBody, titlesSummary } from './sheet-titles';
import { buildRow, iconButton, iconLead, personLead, textButton } from './window-parts';
import { EditSheetForm } from './edit-sheet-form';
import { EditSheetBase } from './edit-sheet-base';
import { loadSheet, placementChoices, type Draft } from '../view/sheet-draft';

/** The Family section and the rows it is made of. */
export abstract class EditSheetFamily extends EditSheetForm {
	// ---------- Family, Actions, Delete (spec §6.3) ----------

	/** A button of the window (a `dynasty-btn`): it does nothing while a write runs, and a failing action never leaves an exception (spec §8). */
	protected button(parent: HTMLElement, text: string, cls: string, run: () => void, label?: string, icon?: string): HTMLButtonElement {
		const b = parent.createEl('button', { cls: ['dynasty-btn', cls], attr: { type: 'button', 'data-focus': cls } });
		if (icon) setIcon(b.createSpan({ cls: 'dynasty-btn-icon', attr: { 'aria-hidden': 'true' } }), icon);
		b.createSpan({ text });
		if (label) b.setAttribute('aria-label', label);
		b.addEventListener('click', () => this.press(run));
		return b;
	}

	/** One action of the Actions section: a row with an icon, tapped as a whole. `danger` shows it in the error colour (Delete). */
	protected actionRow(parent: HTMLElement, icon: string, text: string, cls: string, run: () => void, label?: string, danger = false): HTMLElement {
		const r = buildRow(parent, {
			tap: () => this.press(run),
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
	protected addLink(parent: HTMLElement, text: string, cls: string, run: () => void): HTMLButtonElement {
		const b = parent.createEl('button', { cls: ['dynasty-link', 'dynasty-add-link', cls], attr: { type: 'button', 'data-focus': cls } });
		setIcon(b.createSpan({ cls: 'dynasty-btn-icon', attr: { 'aria-hidden': 'true' } }), 'plus');
		b.createSpan({ text: FAMILY.addLink, attr: { 'aria-hidden': 'true' } });
		b.createSpan({ cls: 'dynasty-sr-only', text });
		b.addEventListener('click', () => this.press(run));
		return b;
	}

	/** The name of a person in a row: the name, then the sobriquet in curly marks. */
	protected rowName(title: HTMLElement, id: string): void {
		const p = this.data.g.byId.get(id);
		title.appendText(p?.name || id);
		if (p?.sobriquet) title.createSpan({ cls: 'dynasty-sob', text: ` ${quotedSobriquet(p.sobriquet)}` });
	}

	/** The relation word that a person row shows (D215), or undefined; the row's screen-reader name holds the same word. */
	protected relationWord(id: string): { text: string } | undefined {
		const me = this.me();
		return me && (id === me || this.data.person.id === me) ? relationsFor(this.data.g, me, this.o.relationOptions).cards.get(id) : undefined;
	}

	/** WP-K: the words of the parent rows and child rows come from one request. Only the window of the marked person shows them (D215). */
	protected warmRelationWords(fam: FamilyView): void {
		const me = this.me();
		if (!me || this.data.person.id !== me) return;
		relationsFor(this.data.g, me, this.o.relationOptions).cards.getMany([...fam.parents.map((l) => l.id), ...this.childrenOf().map((k) => k.id)]);
	}

	/**
	 * The second text line of a person row: the years, with the relation word to the marked person before them (the marked person in bold).
	 * D215: the word shows only in the window of the marked person. In another window it would read as a relation to that window's person
	 * ("Grandfather" for a father). "You" is a name, not a relation word, so it stays.
	 */
	protected rowSub(sub: HTMLElement, id: string): void {
		const me = this.me();
		const word = this.relationWord(id);
		if (me && word) sub.createEl(id === me ? 'b' : 'i', { text: word.text });
		const p = this.data.g.byId.get(id);
		const dates = p ? dateLine(p, this.data.g.dates) : '';
		if (dates) sub.appendText(`${word ? ' · ' : ''}${dates}`);
	}

	protected personRowLead(row: HTMLElement, id: string): void {
		const p = this.data.g.byId.get(id);
		personLead(row, { name: p?.name || id, ...(p?.portrait ? { portrait: p.portrait } : {}), ...(p?.portraitCrop ? { portraitCrop: p.portraitCrop } : {}) }, this.rowPictures ?? undefined);
	}

	/** The Family section: the three Add buttons, then Parents, Partners, Children and the place among the siblings (spec §6.3, G.7). */
	protected familyBody(body: HTMLElement): void {
		const fam = this.data.fam;
		if (!fam) return;
		this.warmRelationWords(fam);

		const group = (key: string, heading: string, add?: { text: string; cls: string; run: () => void }) => this.familyGroup(body, key, heading, add);
		const parents = group('parents', FAMILY.parents, { text: FAMILY.addParent, cls: 'dynasty-add-parent', run: () => void addParentFlow(this.flowHost()) });
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
	protected familyGroup(body: HTMLElement, key: string, heading: string, add?: { text: string; cls: string; run: () => void }): HTMLElement {
		const head = body.createDiv({ cls: 'dynasty-sub-row' });
		head.createDiv({ cls: 'dynasty-sub', text: heading });
		if (add && !this.readOnly) this.addLink(head, add.text, add.cls, add.run);
		return body.createDiv({ cls: ['dynasty-rows', 'dynasty-family-group'], attr: { 'data-family': key } });
	}

	/** The place among the siblings, with the two buttons that move the person; nothing for a person with no sibling group. */
	protected siblingsGroup(body: HTMLElement, fam: FamilyView): void {
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
	protected openPerson(id: string): void {
		if (this.isNew || this.gone || !this.data.g.byId.has(id)) return;
		const go = () => this.moveTo(id, true);
		if (this.isDirty()) this.showConfirm({ title: SHEET.discardTitle, text: [SHEET.discardText], confirm: SHEET.discard, confirmCls: 'dynasty-sheet-discard', keep: SHEET.keepEditing, onConfirm: go });
		else go();
	}

	/** The back link: the person before, with the same question when the draft has changes. */
	protected goBackTo(): void {
		const to = this.trail[this.trail.length - 1];
		if (to === undefined) return;
		const go = () => this.moveTo(to, false);
		if (this.isDirty()) this.showConfirm({ title: SHEET.discardTitle, text: [SHEET.discardText], confirm: SHEET.discard, confirmCls: 'dynasty-sheet-discard', keep: SHEET.keepEditing, onConfirm: go });
		else go();
	}

	/** Shows another person of the same tree in this window, from the body that the window holds now. */
	protected moveTo(id: string, forward: boolean): void {
		const was = this.data.person.id;
		const fresh = this.fresh();
		if (!fresh) return;
		const r = loadSheet(this.o.handle.body, id, this.o.dates);
		if (r.kind !== 'ok') return;
		if (forward) this.trail.push(was);
		else this.trail.pop();
		this.dropPortrait();
		this.take(r.data);
		this.gone = false;
		this.status = '';
		this.build();
		if (this.bodyEl) this.bodyEl.scrollTop = 0;
	}

	/** The marked person, if the tree has a mark that names a person (spec §13.1). */
	protected me(): string | null {
		return validMe(this.data.g, this.data.tree.options.me);
	}

	/**
	 * Spec §13.1, D146: what the relation text line shows for this person, or null when nothing shows (a new person, a tree with no mark).
	 * The names come from the whole tree, as on the cards. Show the line is not on the marked person's own sheet.
	 */
	protected makeRelationView(): RelationView | null {
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
	protected relLayout(): void {
		// The first layout runs inside `phoneLayout`, before the first build.
		if (this.bodyEl === null || this.closed) return;
		if (this.modalEl.hasClass('is-phone') !== this.builtPhone) this.build();
	}

	protected parentRow(parent: HTMLElement, fam: FamilyView, link: ParentLink): void {
		const name = this.name(link.id);
		const r = buildRow(parent, { cls: 'dynasty-family-row', attr: { 'data-parent': link.id, 'data-type': link.type }, lead: (row) => this.personRowLead(row, link.id) });
		r.title.addClass('dynasty-family-name');
		this.rowName(r.title, link.id);
		this.rowSub(r.sub, link.id);
		const controls = r.actions();
		controls.addClass('dynasty-family-controls');
		const chip = controls.createSpan({ cls: 'dynasty-chip-select' });
		// The name comes from a hidden text, not from an aria-label: Obsidian shows an aria-label as a tooltip over the chip.
		const chipId = `dynasty-chip-${++EditSheetBase.chipCounter}`;
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
	protected paintParentSelect(sel: HTMLSelectElement, fam: FamilyView, link: ParentLink): void {
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
	protected showParentTypes(body: string, ids?: ReadonlyMap<string, string>): void {
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
	protected placementSig(): string {
		return `${placementChoices(this.data.person).join(',')}|${this.base.placement}`;
	}

	/** Makes the field "Shown under" again, as the last field of Details: a type change can show it, hide it or change its choices. It is not the select that the user used. */
	protected paintPlacement(): void {
		const grid = this.sections?.el('details')?.querySelector<HTMLElement>('.dynasty-grid');
		if (!grid) return;
		grid.querySelector('select[data-focus="field:placement"]')?.parentElement?.parentElement?.remove();
		this.placementField(grid);
	}

	/** A text of the relation line that changes when the relation changes; the line is drawn again only then (its "more" text keeps its state). */
	protected relationSig(): string {
		return JSON.stringify(this.relView, (_k, v: unknown) => (typeof v === 'function' ? undefined : v));
	}

	/** Draws the relation text lines of the header again, if the relation to the marked person changed. */
	protected paintRelation(): void {
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
	protected paintSiblings(fam: FamilyView): void {
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

	protected partnerRow(parent: HTMLElement, link: PartnerLink): void {
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
}
