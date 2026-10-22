/*
 * The form of the edit sheet (0.3.3, WP-1 A1; spec §6.3): the build of the window, its sections and their summaries, the header, the choices of a new person,
 * and the fields of Details and Notes. Third layer of the chain listed in `edit-sheet.ts`.
 */

import { setIcon } from 'obsidian';
import { readerOfTree } from '../view/calendar-index';
import { attachDateLine } from '../render/dom/date-line';
import type { UnionRef } from '../core/edit';
import { UNION_TYPES, type Person } from '../core/types';
import { dateLine, headTitle } from '../render/tree-info';
import { quotedSobriquet } from '../core/sobriquet';
import { joined, nb } from '../render/text-join';
import { NEW_SHEET, REMOVE, SHEET, UI, UNION_TYPE_TEXT, WINDOW_UI, WRITE_TEXT, partnerDetail } from '../render/ui-text';
import { CHANGE_UI } from '../render/change-text';
import { cardLabels, needsLabels } from '../core/titles';
import { familyOf } from '../core/family-query';
import type { NewRelation } from './family-flows';
import { drawableColour, endEntryOnEnter, nameDialog, sheetField } from './sheet-parts';
import { renderRelationLine } from './sheet-relation';
import { titlesBody, titlesSummary } from './sheet-titles';
import { buildShell } from './window-shell';
import { renderSections, type SectionSpec } from './window-sections';
import { RowPictures } from './window-parts';
import { EditSheetPortrait } from './edit-sheet-portrait';
import { TEXT_FIELDS, NEW_HOUSE, draftOf, placementChoices, findUnion, type Draft, type Loaded } from '../view/sheet-draft';

/** The build of the window, its header and its fields. */
export abstract class EditSheetForm extends EditSheetPortrait {
	// ---------- building the form ----------

	protected build(): void {
		if (this.closed) return;
		const el = this.contentEl;
		const kept = this.focusMark();
		this.shell?.dispose();
		this.rowPictures?.release();
		this.rowPictures = new RowPictures(this.o.pictures, this.o.sourcePath);
		el.empty();
		this.confirmEl = null;
		this.changeEl = null;
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
		this.paintChange();
		this.restoreFocus(kept);
	}

	/**
	 * D267: the text line below Details with its Undo button. The polite live region stands in the window from the build on, empty, and the text goes into it
	 * later: a screen reader reads a change of a region it knows, and not always a region that is made new with its text. `reveal`: the line comes into view,
	 * because the action that made it stands in a section below Details.
	 */
	protected paintChange(reveal = false): void {
		const body = this.bodyEl;
		const change = this.change;
		if (!body || !this.sections) return;
		let line = this.changeEl && this.changeEl.parentElement === body ? this.changeEl : null;
		if (!line) {
			// The sections stand one after another in the body: the line goes in after Details.
			const kids = Array.from(body.children);
			const details = this.sections.el('details');
			const at = details ? kids.indexOf(details) : -1;
			line = body.createDiv({ cls: 'dynasty-sheet-change', attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', tabindex: '-1' } });
			body.insertBefore(line, at >= 0 ? (kids[at + 1] ?? null) : null);
			this.changeEl = line;
		}
		line.empty();
		if (!change) return;
		line.createSpan({ cls: 'dynasty-sheet-change-text', text: change.text });
		if (change.written !== null) {
			const undo = line.createEl('button', { cls: 'dynasty-sheet-change-undo', text: REMOVE.undo, attr: { type: 'button', 'aria-label': CHANGE_UI.undoLabel, 'data-focus': 'change-undo' } });
			undo.addEventListener('click', () => void this.undoChange());
		}
		if (reveal) line.scrollIntoView({ block: 'nearest' });
	}

	/** The sections of the window: all five for a person in the tree, Details and Notes for a new person. */
	protected sectionSpecs(): SectionSpec[] {
		const fam = this.data.fam;
		const specs: SectionSpec[] = [{ key: 'details', title: WINDOW_UI.sectionDetails, summary: this.detailsSummary(), open: true, build: (b) => this.detailsBody(b) }];
		if (!this.isNew && fam) specs.push({ key: 'family', title: WINDOW_UI.sectionFamily, summary: this.familySummary(), open: false, build: (b) => this.familyBody(b) });
		if (!this.isNew) specs.push({ key: 'titles', title: WINDOW_UI.sectionTitles, summary: titlesSummary(this.titlesHost()), open: false, build: (b) => titlesBody(b, this.titlesHost()) });
		specs.push({ key: 'notes', title: WINDOW_UI.sectionNotes, summary: this.notesSummary(), open: false, build: (b) => this.notesBody(b) });
		if (!this.isNew) specs.push({ key: 'actions', title: WINDOW_UI.sectionActions, summary: '', open: false, build: (b) => this.actionsBody(b, this.me()) });
		return specs;
	}

	/** Joins the parts of a summary with " · "; parts that are empty are left out. */
	protected sum(parts: (string | undefined)[]): string {
		return parts.filter((x): x is string => !!x).join(' · ');
	}

	protected detailsSummary(): string {
		const d = this.draft;
		const house = d.house === NEW_HOUSE ? this.newHouse.name.trim() : (this.data.g.houses?.get(d.house)?.name ?? '');
		const sex = d.sex === 'm' ? SHEET.sexMale : d.sex === 'f' ? SHEET.sexFemale : '';
		return this.sum([house || SHEET.noHouse, sex, dateLine({ ...this.data.person, born: d.born.trim() || undefined, died: d.died.trim() || undefined }, this.data.g.dates)]);
	}

	protected familySummary(): string {
		const fam = this.data.fam;
		if (!fam) return '';
		return WINDOW_UI.sumFamilyParts(fam.parents.length, fam.partners.length, this.childrenOf().length).join(' · ');
	}

	protected notesSummary(): string {
		const link = this.draft.link.trim();
		if (link) return WINDOW_UI.sumNotesLinked(link.replace(/^\[\[|\]\]$/g, ''));
		const first = this.draft.notes.split('\n').find((t) => t.trim() !== '');
		return first?.trim() ?? WINDOW_UI.sumNotesNone;
	}

	/** The closed sections show a summary of the draft: it follows the fields while the user types (it does not show the saved values). */
	protected updateSummaries(): void {
		this.sections?.setSummary('details', this.detailsSummary());
		this.sections?.setSummary('notes', this.notesSummary());
	}

	/** People who list this person as a parent, in tree order. */
	protected childrenOf(): Person[] {
		const id = this.data.person.id;
		return id === '' ? [] : this.data.g.people.filter((q) => q.parents.some((l) => l.id === id));
	}

	// ---------- the header (contract C, Q6H A) ----------

	/** The house of the draft: the written house, or the new house that the form asks for. */
	protected draftHouse(): { name: string; colour: string | null; arms: string | null } | null {
		const d = this.draft.house;
		if (d === '') return null;
		if (d === NEW_HOUSE) return this.newHouse.name.trim() ? { name: this.newHouse.name.trim(), colour: this.newHouse.color, arms: null } : null;
		const h = this.data.g.houses?.get(d);
		return h ? { name: h.name || h.id, colour: h.color ?? null, arms: h.arms?.trim() || null } : { name: SHEET.unknownHouse(d), colour: null, arms: null };
	}

	/** The name that the header, the labels and the bar show now. */
	protected shownName(): string {
		return this.draft.name.trim() || this.data.person.name || '';
	}

	/**
	 * The header: the name with the small personal arms after it, one detail text line (house, title, dates), then the relation text
	 * line, and the round portrait at the right (D209: 64 px, a faint outline, no house ring; no circle when there is no portrait). A tap
	 * on the portrait or on the arms opens the picture menu. The header follows the draft (`head.paint`).
	 */
	protected personHeader(parent: HTMLElement): void {
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
			if (titleText) parts.push(nb(headTitle(label, titleText, this.data.g.dates)));
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
	protected cardLabel() {
		const id = this.data.person.id;
		if (this.isNew || id === '' || !needsLabels(this.data.g)) return undefined;
		return cardLabels(this.data.g).get(id);
	}

	/** The detail text of a new person: "Child of A and B", "Partner of A", "Birth parent of A". */
	protected newDetail(): string {
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

	/**
	 * O2: the control that has the focus now, as a `data-focus` key and its place among the controls of that key. A rebuild
	 * removes it, and the browser then puts the focus on the page, outside the dialog (a keyboard user is lost).
	 */
	protected focusMark(): { key: string; index: number; start: number | null; end: number | null } | 'sheet' | null {
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
	protected restoreFocus(mark: ReturnType<EditSheetForm['focusMark']>): void {
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

	protected title(): string {
		const rel = this.rel;
		if (!rel) return this.data.person.name || SHEET.unnamed;
		return rel.kind === 'parent' ? NEW_SHEET.titleParent : rel.kind === 'child' ? NEW_SHEET.titleChild : rel.kind === 'partner' ? NEW_SHEET.titlePartner : NEW_SHEET.titlePerson;
	}

	/** The choices of a new person: the partnership of the parents of a child, the type of a new partnership, and the notes about them. */
	protected relationBox(parent: HTMLElement): void {
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
	protected baseOf(l: Loaded): Draft {
		const d = draftOf(l);
		const rel = this.rel;
		if (rel?.kind !== 'child' || !this.o.parentSheet) return d;
		const house = l.g.byId.get(rel.parent)?.house;
		return house && l.tree.houses.some((h) => h.id === house) ? { ...d, house } : d;
	}

	/** People the new person joins: the child, the parents or the partner. */
	protected relIds(): string[] {
		const rel = this.rel;
		if (!rel || rel.kind === 'person') return [];
		if (rel.kind === 'parent') return [rel.child];
		if (rel.kind === 'partner') return [rel.partner];
		return rel.other === null ? [rel.parent] : [rel.parent, rel.other];
	}

	/** The listed partnerships of a new child's two parents, in union order. */
	protected couple(rel: Extract<NewRelation, { kind: 'child' }>): UnionRef[] {
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
	protected checkRelation(): void {
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
	protected partnershipField(box: HTMLElement, rel: Extract<NewRelation, { kind: 'child' }>): void {
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

	/** Called after a field of the draft changed: the header and the summaries of the closed sections follow it. */
	protected fieldChanged(key: string): void {
		if (key === 'name' || key === 'sobriquet' || key === 'title' || key === 'born' || key === 'died' || key === 'house' || key === 'sex' || key === 'link' || key === 'notes') {
			this.head?.paint();
			this.updateSummaries();
		}
	}

	protected textField(
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

	protected select(parent: HTMLElement, key: 'house' | 'sex' | 'placement', label: string, options: [string, string][]): HTMLSelectElement {
		const { row, id } = sheetField(parent, label, key);
		const wrap = row.createDiv({ cls: 'dynasty-select' });
		const sel = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id, 'data-focus': `field:${key}` } });
		for (const [value, text] of options) sel.createEl('option', { text, attr: { value } });
		sel.value = this.draft[key];
		sel.disabled = this.readOnly;
		setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		return sel;
	}

	protected houseField(parent: HTMLElement): void {
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

	protected sexField(parent: HTMLElement): void {
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
	protected checkField(parent: HTMLElement, field: 'illegitimate' | 'childless', text: string, hintId?: string): void {
		const row = parent.createEl('label', { cls: 'dynasty-sheet-field dynasty-sheet-check dynasty-check', attr: { 'data-field': field } });
		const box = row.createEl('input', { attr: { type: 'checkbox', 'data-focus': `field:${field}` } });
		box.checked = this.draft[field];
		box.disabled = this.readOnly;
		row.createSpan({ cls: 'dynasty-sheet-label', text });
		if (hintId) box.setAttribute('aria-describedby', hintId);
		box.addEventListener('change', () => (this.draft[field] = box.checked));
	}

	protected placementField(parent: HTMLElement): void {
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
	protected detailsBody(body: HTMLElement): void {
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
	protected notesBody(body: HTMLElement): void {
		const stack = body.createDiv({ cls: 'dynasty-stack' });
		this.textField(stack, 'link', SHEET.link, { placeholder: SHEET.linkPlaceholder, autocapitalize: 'off' });
		this.textField(stack, 'notes', SHEET.notes, {}, true);
	}
}
