/*
 * The small ID window (spec §13.17 rule 5, D110): a modal over the Houses window or the Titles window
 * with the ID field of one row, the button "Make ID from the name", the reason a draft id is refused
 * and the buttons "Cancel" and "Use this ID". On a phone it is a sheet at the top of the screen whose
 * height follows the visible area (`phoneLayout`), so the keyboard never covers the field or the
 * buttons. It changes nothing in the note: "Use this ID" hands the id to the row's draft.
 */

import { Modal, type App } from 'obsidian';
import { ID_UI, SHEET } from '../render/ui-text';
import { reasonText, type IdKind, type IdReason } from './id-draft';
import { idField } from './id-field';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';
import { nameDialog } from './sheet-parts';

/** What the Houses window or the Titles window gives the small window. */
export interface IdWindowSpec {
	kind: IdKind;
	/** The name of the house or title, for the title and the accessible names. */
	item: string;
	/** The row's key, for the `data-focus` names. */
	key: string;
	/** The id in the row's draft. */
	value: string;
	/** Why `value` is refused now; null when it is allowed. */
	check: (value: string) => IdReason | null;
	/** What the button "Make ID from the name" gives; null when the name is empty. */
	make: () => string | null;
	/** "Use this ID": the id, with the spaces at both ends removed. */
	use: (value: string) => void;
	/** The window has closed; `used` is true after "Use this ID". */
	closed: (used: boolean) => void;
}

class IdWindow extends Modal {
	private used = false;
	private readonly cleanup: (() => void)[] = [];

	constructor(
		app: App,
		private readonly spec: IdWindowSpec,
	) {
		super(app);
	}

	override onOpen(): void {
		const s = this.spec;
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-id-window');
		this.cleanup.push(phoneLayout(this, undefined, false), ignoreGhostClick(this), trackModal(this, () => this.close()));
		const el = this.contentEl;
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		nameDialog(this.modalEl, header.createDiv({ cls: 'dynasty-sheet-title', text: ID_UI.windowTitle(s.item) }));
		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		body.createDiv({ cls: 'dynasty-sheet-hint', text: ID_UI.hint(s.kind) });
		let use: HTMLButtonElement | null = null;
		const refresh = (value: string) => {
			const why = s.check(value);
			view.setProblem(why ? reasonText(why) : '');
			if (use) use.disabled = why !== null;
		};
		const view = idField(body, {
			key: s.key,
			item: s.item,
			value: s.value,
			problem: '',
			onInput: refresh,
			onMake: () => {
				const made = s.make();
				if (made === null) return;
				view.setValue(made);
				refresh(made);
			},
			onEnter: () => use?.click(),
		});
		const actions = body.createDiv({ cls: ['dynasty-sheet-confirm-actions', 'dynasty-id-actions'] });
		actions.createEl('button', { cls: ['dynasty-sheet-cancel', 'dynasty-id-cancel'], text: SHEET.cancel, attr: { type: 'button', 'data-focus': 'id-cancel' } }).addEventListener('click', () => this.close());
		use = actions.createEl('button', { cls: ['mod-cta', 'dynasty-id-use'], text: ID_UI.use, attr: { type: 'button', 'data-focus': 'id-use' } });
		use.addEventListener('click', () => {
			if (use?.disabled) return;
			this.used = true;
			s.use(view.input.value.trim());
			this.close();
		});
		refresh(s.value);
		// The sheet is at the top of the screen, so the keyboard that this focus opens cannot cover the field.
		view.input.focus();
	}

	override onClose(): void {
		for (const c of this.cleanup.splice(0)) c();
		this.contentEl.empty();
		this.spec.closed(this.used);
	}
}

/** Opens the small ID window over the window that called. */
export function openIdWindow(app: App, spec: IdWindowSpec): void {
	new IdWindow(app, spec).open();
}
