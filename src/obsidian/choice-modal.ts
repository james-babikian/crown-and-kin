/*
 * One step of an add flow (spec §6.4): a title, a short text, and a list of choices as large
 * buttons. It looks like the edit sheet (same header with Cancel, same phone layout, spec §7.4).
 */

import { Modal, type App } from 'obsidian';
import { FLOW } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';

/** One large button in a choice step, and what choosing it returns. */
export interface Choice<T> {
	value: T;
	label: string;
	detail?: string;
	disabled?: boolean;
	/** Marks the recommended or default choice. */
	cta?: boolean;
	warning?: boolean;
}

/** What one choice step shows: its title, text, an optional list, and its choices. */
export interface ChoiceSpec<T> {
	title: string;
	text?: string[];
	/** Items shown as a list under the text (for example the partnerships a pair has now). */
	list?: string[];
	after?: string[];
	choices: Choice<T>[];
	/** A name for the harness and for CSS: `data-choice` on the modal. */
	name: string;
}

class ChoiceModal<T> extends Modal {
	private chosen = false;
	private readonly cleanup: (() => void)[] = [];

	constructor(
		app: App,
		private readonly spec: ChoiceSpec<T>,
		private readonly done: (value: T | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const m = this.modalEl;
		m.addClass('dynasty-sheet');
		m.addClass('dynasty-choice');
		m.setAttribute('data-choice', this.spec.name);
		this.cleanup.push(phoneLayout(this), ignoreGhostClick(this), trackModal(this, () => this.close()));
		const el = this.contentEl;
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		header.createDiv({ cls: 'dynasty-sheet-title', text: this.spec.title });
		const cancel = header.createDiv({ cls: 'dynasty-sheet-actions' }).createEl('button', { cls: 'dynasty-sheet-cancel', text: FLOW.cancel, attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());
		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		for (const t of this.spec.text ?? []) body.createDiv({ cls: 'dynasty-choice-text', text: t });
		if (this.spec.list?.length) {
			const ul = body.createEl('ul', { cls: 'dynasty-choice-list' });
			for (const t of this.spec.list) ul.createEl('li', { text: t });
		}
		for (const t of this.spec.after ?? []) body.createDiv({ cls: 'dynasty-choice-text', text: t });
		const list = body.createDiv({ cls: 'dynasty-choice-options' });
		let first: HTMLButtonElement | null = null;
		this.spec.choices.forEach((c, i) => {
			const cls = ['dynasty-choice-option'];
			if (c.cta) cls.push('mod-cta');
			if (c.warning) cls.push('mod-warning');
			const b = list.createEl('button', { cls, attr: { type: 'button', 'data-index': String(i) } });
			b.createSpan({ cls: 'dynasty-choice-label', text: c.label });
			if (c.detail) b.createSpan({ cls: 'dynasty-choice-detail', text: c.detail });
			b.disabled = !!c.disabled;
			b.addEventListener('click', () => {
				if (c.disabled) return;
				this.chosen = true;
				this.close();
				this.done(c.value);
			});
			if (!first && !c.disabled) first = b;
		});
		(first as HTMLButtonElement | null)?.focus();
	}

	override onClose(): void {
		for (const c of this.cleanup.splice(0)) c();
		this.contentEl.empty();
		if (!this.chosen) this.done(null);
	}
}

/** Shows the choices; resolves to the chosen value, or null after Cancel, Esc or a press outside. */
export function choose<T>(app: App, spec: ChoiceSpec<T>): Promise<T | null> {
	// A promise settles once: the close after a choice cannot turn the choice into null.
	return new Promise((resolve) => new ChoiceModal(app, spec, resolve).open());
}
