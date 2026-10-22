/*
 * The portrait and the personal arms of the edit sheet (0.3.3, WP-1 A1; spec §13.7, §13.13): the round picture in the header, its copy, the menu of the picture,
 * Select portrait, Select personal arms, Select the part, and the links "Add portrait" and "Open linked note". Second layer of the chain listed in `edit-sheet.ts`.
 */

import { Notice } from 'obsidian';
import { issueText } from '../core/messages';
import { pictureIssue } from '../core/pictures';
import { formatPortraitCrop } from '../core/portrait-crop';
import { linkTarget } from '../render/tree-info';
import { PICTURES_UI, SHEET, WINDOW_UI } from '../render/ui-text';
import { openCropTool, startCropOf } from './crop-tool';
import { currentPictureOf, pickPicture } from './picture-picker';
import { showMenu, type MenuEntry } from './window-parts';
import { personViewItems, viewPerson } from './viewer-sources';
import { EditSheetBase } from './edit-sheet-base';
import { SHEET_PORTRAIT_PX } from './edit-sheet-base';

/** The portrait, the personal arms and the links under the header. */
export abstract class EditSheetPortrait extends EditSheetBase {
	/** The short menu of the portrait and the personal arms (D198 Q6H A). It starts with View portrait or View arms (D256); a window that cannot change the note opens the viewer at once. A new person has no portrait yet. */
	protected pictureMenu(anchor: HTMLElement): void {
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

	// ---------- the portrait (spec §13.7) ----------

	/**
	 * Shows the portrait state in the round button of the header and the problem text under it. A copy that arrives comes here
	 * only, so the rest of the header keeps its elements and the focus (O2).
	 */
	protected paintPortrait(): void {
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
	protected addPortraitLink(row: HTMLElement | null): void {
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
	protected openNoteLink(row: HTMLElement | null): void {
		if (!row || this.isNew) return;
		const linktext = linkTarget(this.data.person.link);
		if (!linktext) return;
		const link = row.createEl('button', { cls: ['dynasty-link', 'dynasty-open-note', 'dynasty-sheet-open-link'], text: SHEET.openLink, attr: { type: 'button', 'data-focus': 'dynasty-sheet-open-link' } });
		link.addEventListener('click', () =>
			this.press(() =>
				this.leaveFor(() => {
					const open = () => this.app.workspace.openLinkText(linktext, this.o.sourcePath, false);
					if (this.o.openNote) this.o.openNote(open);
					else void open().catch((e) => console.error('Crown and Kin: cannot open link', e));
				}),
			),
		);
		// Left of "Open all", which stands last in the row.
		const all = row.querySelector('.dynasty-openall-button');
		if (all) row.insertBefore(link, all);
		else row.appendChild(link);
	}

	protected paintAddPortrait(): void {
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
	protected focusPortraitIfLost(): void {
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
	protected portraitFilesChanged(paths: readonly string[]): void {
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
	protected portraitFor(link: string): NonNullable<EditSheetBase['portrait']> {
		// The copy shows the draft's part, so a new part makes a new copy.
		const part = startCropOf(this.draft.portraitCrop);
		const cropText = part ? formatPortraitCrop(part) : '';
		if (this.portrait?.link === link && this.portrait.crop === cropText) return this.portrait;
		this.dropPortrait();
		const store = this.o.pictures;
		const who = { id: this.data.person.id, name: this.draft.name.trim() || this.data.person.name };
		const problemText = (x: Parameters<typeof pictureIssue>[1]) => issueText(pictureIssue({ kind: 'portrait', person: who }, x));
		const state: NonNullable<EditSheetBase['portrait']> = { link, crop: cropText, path: null, copy: null, problem: null, missing: false, loading: false, waiting: false };
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

	protected dropPortrait(): void {
		this.portraitAbort?.abort();
		this.portraitAbort = null;
		this.portrait?.copy?.release();
		this.portrait = null;
	}

	/** Select portrait (spec §13.7): the picture picker; the chosen link goes into the draft. */
	protected async selectPortrait(): Promise<void> {
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
	protected async selectArms(): Promise<void> {
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
	protected portraitLinkChanged(next: string): void {
		const before = this.draft.portrait.trim();
		const after = next.trim();
		if (this.draft.portraitCrop === '') return;
		if (!this.sameFile(before, after)) this.draft.portraitCrop = '';
	}

	/** True when both links resolve to the same vault file (or, with no store, have the same text). */
	protected sameFile(a: string, b: string): boolean {
		if (a === b) return true;
		if (a === '' || b === '') return false;
		const store = this.o.pictures;
		if (!store) return false;
		const x = store.resolve(a, this.o.sourcePath);
		const y = store.resolve(b, this.o.sourcePath);
		return x.ok && y.ok && x.file.path === y.file.path;
	}

	/** Select the part (spec §13.13): the crop tool over the sheet; Save puts the part into the draft. */
	protected async selectPart(): Promise<void> {
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
}
