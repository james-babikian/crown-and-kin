/*
 * The temporary views of a tree view (0.3.3, WP-1 A1): the result bar of the relation finder (spec §13.2, D47–D49) and the bar of the Show view of a line of
 * succession (contract 0.2.7 F). Eighth layer of the chain listed in `tree-view.ts`.
 */

import { setIcon } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { finderSentence, stepSentences } from '../render/tree-info';
import { FINDER_UI, SUCCESSION_UI } from '../render/ui-text';
import type { BlockState, FinderState } from '../view/block-state';
import { pickPerson } from './person-picker';
import { showViewOf, type FinderDrawn } from '../view/render-plan';
import { linePeople, type SuccessionDrawn } from '../view/succession-view';
import { TreeViewActions } from './tree-view-actions';
import { TreeViewBase } from './tree-view-base';

/** Numbers the result bars, for their `aria-labelledby`. */
let resultIds = 0;

/** The relation finder's bar and the Show view's bar, with their menus and Close. */
export abstract class TreeViewFinder extends TreeViewActions {
	// ---------- the relation finder (spec §13.2, D47, D48, D49) ----------

	/**
	 * The banner of the relation finder's result (spec §13.2, D48; 0.2.8 G.13): one row under the toolbar with the sentence, then the links
	 * Show the steps, Other relation, Show in the whole tree (or back to the line only) and Close. On a phone Close is an X with a 44 px
	 * tap area. The links wrap under the sentence when the row is narrow; the steps open as a list under them.
	 */
	protected buildResultBar(viewport: HTMLElement, before: HTMLElement, d: FinderDrawn, whole: FamilyGraph): void {
		const { state: f, result } = d;
		const name = (id: string) => whole.byId.get(id)?.name || id;
		// Named by its sentence, not aria-label: Obsidian shows an aria-label as a tooltip on every free point of the bar.
		const id = `dynasty-result-${++resultIds}`;
		const bar = viewport.createDiv({ cls: ['dynasty-result', ...(this.barKind() === 'phone' ? ['dynasty-result-phone'] : [])], attr: { role: 'group', 'aria-labelledby': id } });
		// After the toolbar and before the cards in the Tab order (spec §5.2).
		viewport.insertBefore(bar, before);
		bar.createDiv({ cls: 'dynasty-result-text', text: finderSentence(whole, result, f.index), attr: { id, role: 'status', tabindex: -1 } });
		const steps = result.kind === 'named' ? (result.relations[f.index]?.steps ?? []) : result.kind === 'chain' ? result.steps : [];
		const list = bar.createEl('ol', { cls: 'dynasty-result-steps' });
		const sentences = stepSentences(whole, steps);
		for (const t of sentences.shown) list.createEl('li', { text: t });
		if (sentences.more) list.createEl('li', { cls: 'dynasty-result-more-steps', text: FINDER_UI.moreSteps(sentences.more) });
		list.toggle(f.steps);
		const row = bar.createDiv({ cls: 'dynasty-result-buttons' });
		const others = result.kind === 'named' && result.relations.length > 1 ? result.relations.length : 0;
		// Only the bar changes: the tree is not drawn again.
		const toggleSteps = (after: (shown: boolean) => void) => {
			f.steps = !f.steps;
			list.toggle(f.steps);
			after(f.steps);
		};
		if (this.barKind() === 'phone') {
			// D212 (phone-banner-row): one row, the sentence, the link "Options" and the X. The link opens the actions in a sheet.
			const options = row.createEl('button', { cls: ['dynasty-result-button', 'dynasty-link', 'dynasty-result-options'], attr: { type: 'button', 'aria-label': FINDER_UI.optionsLabel, 'aria-haspopup': 'true', 'aria-expanded': 'false' } });
			options.createSpan({ text: FINDER_UI.options });
			setIcon(options.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
			options.addEventListener('click', () => this.guard(() => this.toggleBannerOptions(options, { steps: steps.length > 0, others, line: !!d.line }, d, toggleSteps)));
		} else {
			const button = (text: string, cls: string, run: () => void, label?: string) => {
				const b = row.createEl('button', { cls: ['dynasty-result-button', 'dynasty-link', cls], text, attr: { type: 'button' } });
				if (label) b.setAttribute('aria-label', label);
				b.addEventListener('click', () => this.guard(run));
				return b;
			};
			if (steps.length) {
				const toggle = button(f.steps ? FINDER_UI.hideSteps : FINDER_UI.showSteps, 'dynasty-result-steps-button', () =>
					toggleSteps((shown) => {
						toggle.setText(shown ? FINDER_UI.hideSteps : FINDER_UI.showSteps);
						toggle.setAttribute('aria-expanded', String(shown));
					}),
				);
				toggle.setAttribute('aria-expanded', String(f.steps));
			}
			if (others) button(FINDER_UI.other, 'dynasty-result-other', () => this.finderChange({ index: (f.index + 1) % others }, '.dynasty-result-other'), FINDER_UI.otherLabel(name(f.second), name(f.first)));
			if (d.line) button(f.whole ? FINDER_UI.lineOnly : FINDER_UI.whole, 'dynasty-result-whole', () => this.finderChange({ whole: !f.whole }, '.dynasty-result-whole'));
		}
		this.closeLink(row, 'dynasty-result-close', FINDER_UI.close, FINDER_UI.closeLabel, () => this.closeFinder());
	}

	/**
	 * The menu of the link "Options" in the phone banner (D212): Show the steps (or Hide), Other relation and Show in the whole tree (or Show only
	 * the line), as a sheet from the bottom like the other menus of the phone. Each row does what the link of the computer's banner does.
	 */
	protected toggleBannerOptions(opener: HTMLElement, has: { steps: boolean; others: number; line: boolean }, d: FinderDrawn, toggleSteps: (after: (shown: boolean) => void) => void): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'options') {
			pop.close();
			return;
		}
		const { state: f } = d;
		const name = (id: string) => this.whole?.byId.get(id)?.name || id;
		const where = this.menuPlace(opener);
		pop.open(
			'options',
			(el) => {
				if (has.steps) {
					this.menuItem(pop, el, 'list', f.steps ? FINDER_UI.hideSteps : FINDER_UI.showSteps, 'dynasty-result-steps-button', () => toggleSteps(() => undefined));
				}
				if (has.others) {
					this.menuItem(pop, el, 'repeat', FINDER_UI.other, 'dynasty-result-other', () => this.finderChange({ index: (f.index + 1) % has.others }, '.dynasty-result-options'), FINDER_UI.otherLabel(name(f.second), name(f.first)));
				}
				if (has.line) {
					this.menuItem(pop, el, f.whole ? 'minimize-2' : 'maximize-2', f.whole ? FINDER_UI.lineOnly : FINDER_UI.whole, 'dynasty-result-whole', () => this.finderChange({ whole: !f.whole }, '.dynasty-result-options'));
				}
			},
			opener,
			where.anchor,
			where.opts,
		);
		opener.setAttribute('aria-expanded', 'true');
		pop.whenClosed(() => opener.setAttribute('aria-expanded', 'false'));
	}

	/** The Close of a banner: the word as a link on the computer, an X with a 44 px tap area on a phone (0.2.8 G.13, I37). */
	protected closeLink(row: HTMLElement, cls: string, text: string, label: string, run: () => void): HTMLElement {
		const icon = this.barKind() === 'phone';
		const b = row.createEl('button', { cls: ['dynasty-result-button', cls, ...(icon ? ['clickable-icon', 'dynasty-bar-x'] : ['dynasty-link'])], attr: { type: 'button', 'aria-label': label } });
		if (icon) setIcon(b.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'x');
		else b.setText(text);
		b.addEventListener('click', () => this.guard(run));
		return b;
	}

	/** Other relation, Show in the whole tree: the block's result changes, and its views draw it; the focus stays on the pressed button. */
	protected finderChange(patch: Partial<FinderState>, refocus: string): void {
		const st = this.ensureState();
		if (!st.finder) return;
		Object.assign(st.finder, patch);
		this.focusDue = refocus;
		TreeViewBase.finderRedraw(this.host, st);
	}

	/** Close (spec §13.2): the views show what they showed before (the focus family, or all people); the focus goes to the More button. */
	protected closeFinder(): void {
		const st = this.ensureState();
		st.finder = null;
		this.focusDue = '.dynasty-more';
		TreeViewBase.finderRedraw(this.host, st);
	}

	// ---------- the Show view of a line of succession (contract 0.2.7 F) ----------

	/** The Show view the phone list draws (F.6): the same rule as for a tree, and a title that is gone ends the view. */
	protected showViewFor(st: BlockState, whole: FamilyGraph): SuccessionDrawn | null {
		const { drawn, ended } = showViewOf(st, whole, this.settings, { full: !!this.full, coarse: this.coarse, phone: this.isPhone() });
		if (ended) st.succession = null;
		return drawn;
	}

	/** The people that the folds must show: the finder's line, or the ruler, the heirs and the open branches of the Show view (F.2, M.9). */
	protected linePeopleNow(): string[] | null {
		if (this.successionDrawn) return linePeople(this.successionDrawn);
		return this.finderDrawn?.line?.people ?? null;
	}

	/** The banner of the Show view (F.3, 0.2.8 G.13): the sentence and Close in one row, with the look and the place of the finder's banner. */
	protected buildSuccessionBar(viewport: HTMLElement, before: HTMLElement, d: SuccessionDrawn): void {
		const id = `dynasty-result-${++resultIds}`;
		const bar = viewport.createDiv({ cls: ['dynasty-result', 'dynasty-succession-bar', ...(this.barKind() === 'phone' ? ['dynasty-result-phone'] : [])], attr: { role: 'group', 'aria-labelledby': id } });
		// After the toolbar and before the cards in the Tab order, like the finder's bar.
		viewport.insertBefore(bar, before);
		bar.createDiv({ cls: ['dynasty-result-text', 'dynasty-succession-text'], text: d.sentence, attr: { id, role: 'status', tabindex: -1 } });
		const row = bar.createDiv({ cls: 'dynasty-result-buttons' });
		this.closeLink(row, 'dynasty-succession-close', SUCCESSION_UI.barClose, SUCCESSION_UI.barCloseLabel, () => this.closeSuccession());
	}

	/** Close, Esc: the views show what they showed before; the focus goes back to More (the list: to Find). */
	protected closeSuccession(): void {
		const st = this.ensureState();
		st.succession = null;
		this.focusDue = this.listMode ? '.dynasty-list-find' : '.dynasty-more';
		TreeViewBase.successionRedraw(this.host, st);
	}

	/** Relation (spec §13.2): the first person, then the second (not the first); the marked person is offered first. */
	protected async startFinder(): Promise<void> {
		const g = this.whole;
		if (!g || this.unloaded) return;
		const st = this.ensureState();
		const me = this.meId;
		const a = await pickPerson(this.host.app, g, new Set(), FINDER_UI.placeholder, FINDER_UI.firstTitle, false, me, null, this.pickerContext());
		if (a?.kind !== 'person') {
			this.guard(() => this.refocusTool('.dynasty-more'));
			return;
		}
		const b = await pickPerson(this.host.app, g, new Set([a.id]), FINDER_UI.placeholder, FINDER_UI.secondTitle, false, me !== a.id ? me : null, null, this.pickerContext());
		if (b?.kind !== 'person') {
			this.guard(() => this.refocusTool('.dynasty-more'));
			return;
		}
		this.guard(() => TreeViewBase.showFinder(this.host, st, a.id, b.id, this.unloaded ? null : this));
	}
}
