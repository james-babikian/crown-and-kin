/*
 * The bars of the temporary views of a tree view as an object of its own (review step 11): the result bar of the relation finder (spec §13.2,
 * D47–D49) and the bar of the Show view of a line of succession, with their menus and Close. The object sees the view only through
 * `FinderPort`; the view builds the port where the menu helpers of the toolbar are visible. This file imports no layer of the view chain.
 */

import { setIcon, type App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { setBarText } from '../render/dom/bar-text';
import { setNameText } from '../render/dom/name-marks';
import type { Popover, PopoverOptions } from '../render/dom/widgets';
import { finderSentence, stepSentences } from '../render/tree-info';
import { FINDER_UI, SUCCESSION_UI } from '../render/ui-text';
import type { BlockState, FinderState } from '../view/block-state';
import { showViewOf, type FinderDrawn } from '../view/render-plan';
import type { DynastySettings } from '../view/settings';
import { linePeople, type SuccessionDrawn } from '../view/succession-view';
import { BlockViews, type ViewLike } from './block-views';
import { pickPerson, type PickerContext } from './person-picker';
import type { FullHost } from './tree-view-types';

/** What the bars need of their view: its place and state, read when asked, and the menu helpers of its toolbar. */
export interface FinderPort<V = unknown> {
	readonly view: V;
	readonly host: { readonly app: App; readonly views: Set<V> };
	readonly unloaded: boolean;
	readonly full: FullHost | null;
	readonly coarse: boolean;
	readonly phone: boolean;
	readonly listMode: boolean;
	readonly whole: FamilyGraph | null;
	readonly settings: DynastySettings;
	readonly meId: string | null;
	readonly finderDrawn: FinderDrawn | null;
	readonly successionDrawn: SuccessionDrawn | null;
	/** After the next first view, the keyboard focus goes here (the view clears it). */
	focusDue: string | null;
	ensureState(): BlockState;
	pickerContext(): PickerContext;
	guard(fn: () => void): void;
	refocusTool(selector: string): void;
	readonly menu: {
		kind(): 'desktop' | 'phone' | 'list';
		popover(): Popover | null;
		place(opener: HTMLElement): { anchor?: DOMRect; opts: PopoverOptions };
		item(pop: Popover, el: HTMLElement, icon: string, text: string, cls: string, run: (keyboard: boolean) => void, label?: string): HTMLElement;
	};
}

/** Numbers the result bars, for their `aria-labelledby`. One count for the whole page, so the ids of the note and of a full-screen view of one block differ. */
let resultIds = 0;

/** The bars of the relation finder and of the Show view of one tree view. */
export class FinderBars<V extends ViewLike<V>> {
	constructor(private readonly port: FinderPort<V>) {}

	/**
	 * The banner of the relation finder's result (spec §13.2, D48): one row under the toolbar with the sentence, then the links
	 * Show the steps, Other relation, Show in the whole tree (or back to the line only) and Close. On a phone Close is an X with a 44 px
	 * tap area. The links wrap under the sentence when the row is narrow; the steps open as a list under them.
	 */
	buildResultBar(viewport: HTMLElement, before: HTMLElement, d: FinderDrawn, whole: FamilyGraph): void {
		const port = this.port;
		const { state: f, result } = d;
		const name = (id: string) => whole.byId.get(id)?.name || id;
		const phone = port.menu.kind() === 'phone';
		// Named by its sentence, not aria-label: Obsidian shows an aria-label as a tooltip on every free point of the bar.
		const id = `dynasty-result-${++resultIds}`;
		const bar = viewport.createDiv({ cls: ['dynasty-result', ...(phone ? ['dynasty-result-phone'] : [])], attr: { role: 'group', 'aria-labelledby': id } });
		// After the toolbar and before the cards in the Tab order (spec §5.2).
		viewport.insertBefore(bar, before);
		setNameText(bar.createDiv({ cls: 'dynasty-result-text', attr: { id, role: 'status', tabindex: -1 } }), finderSentence(whole, result, f.index));
		const steps = result.kind === 'named' ? (result.relations[f.index]?.steps ?? []) : result.kind === 'chain' ? result.steps : [];
		const list = bar.createEl('ol', { cls: 'dynasty-result-steps' });
		const sentences = stepSentences(whole, steps);
		for (const t of sentences.shown) setNameText(list.createEl('li'), t);
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
		if (phone) {
			// D212 (phone-banner-row): one row, the sentence, the link "Options" and the X. The link opens the actions in a sheet.
			const options = row.createEl('button', { cls: ['dynasty-result-button', 'dynasty-link', 'dynasty-result-options'], attr: { type: 'button', 'aria-label': FINDER_UI.optionsLabel, 'aria-haspopup': 'true', 'aria-expanded': 'false' } });
			options.createSpan({ text: FINDER_UI.options });
			setIcon(options.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
			options.addEventListener('click', () => port.guard(() => this.toggleBannerOptions(options, { steps: steps.length > 0, others, line: !!d.line }, d, toggleSteps)));
		} else {
			const button = (text: string, cls: string, run: () => void, label?: string) => {
				const b = row.createEl('button', { cls: ['dynasty-result-button', 'dynasty-link', cls], text, attr: { type: 'button' } });
				if (label) b.setAttribute('aria-label', label);
				b.addEventListener('click', () => port.guard(run));
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
		this.closeLink(row, 'dynasty-result-close', FINDER_UI.close, FINDER_UI.closeLabel, () => this.close());
	}

	/**
	 * The menu of the link "Options" in the phone banner (D212): Show the steps (or Hide), Other relation and Show in the whole tree (or Show only
	 * the line), as a sheet from the bottom like the other menus of the phone. Each row does what the link of the computer's banner does.
	 */
	private toggleBannerOptions(opener: HTMLElement, has: { steps: boolean; others: number; line: boolean }, d: FinderDrawn, toggleSteps: (after: (shown: boolean) => void) => void): void {
		const menu = this.port.menu;
		const pop = menu.popover();
		if (!pop) return;
		if (pop.kind === 'options') {
			pop.close();
			return;
		}
		const { state: f } = d;
		const name = (id: string) => this.port.whole?.byId.get(id)?.name || id;
		const where = menu.place(opener);
		pop.open(
			'options',
			(el) => {
				if (has.steps) {
					menu.item(pop, el, 'list', f.steps ? FINDER_UI.hideSteps : FINDER_UI.showSteps, 'dynasty-result-steps-button', () => toggleSteps(() => undefined));
				}
				if (has.others) {
					menu.item(pop, el, 'repeat', FINDER_UI.other, 'dynasty-result-other', () => this.finderChange({ index: (f.index + 1) % has.others }, '.dynasty-result-options'), FINDER_UI.otherLabel(name(f.second), name(f.first)));
				}
				if (has.line) {
					menu.item(pop, el, f.whole ? 'minimize-2' : 'maximize-2', f.whole ? FINDER_UI.lineOnly : FINDER_UI.whole, 'dynasty-result-whole', () => this.finderChange({ whole: !f.whole }, '.dynasty-result-options'));
				}
			},
			opener,
			where.anchor,
			where.opts,
		);
		opener.setAttribute('aria-expanded', 'true');
		pop.whenClosed(() => opener.setAttribute('aria-expanded', 'false'));
	}

	/** The Close of a banner: the word as a link on the computer, an X with a 44 px tap area on a phone. */
	private closeLink(row: HTMLElement, cls: string, text: string, label: string, run: () => void): HTMLElement {
		const icon = this.port.menu.kind() === 'phone';
		const b = row.createEl('button', { cls: ['dynasty-result-button', cls, ...(icon ? ['clickable-icon', 'dynasty-bar-x'] : ['dynasty-link'])], attr: { type: 'button', 'aria-label': label } });
		if (icon) setIcon(b.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'x');
		else b.setText(text);
		b.addEventListener('click', () => this.port.guard(run));
		return b;
	}

	/** Other relation, Show in the whole tree: the block's result changes, and its views draw it; the focus stays on the pressed button. */
	private finderChange(patch: Partial<FinderState>, refocus: string): void {
		const port = this.port;
		const st = port.ensureState();
		if (!st.finder) return;
		Object.assign(st.finder, patch);
		port.focusDue = refocus;
		BlockViews.of(port.host, st).finderRedraw();
	}

	/** Close (spec §13.2): the views show what they showed before (the focus family, or all people); the focus goes to the More button. */
	close(): void {
		const port = this.port;
		const st = port.ensureState();
		st.finder = null;
		port.focusDue = '.dynasty-more';
		BlockViews.of(port.host, st).finderRedraw();
	}

	// ---------- the Show view of a line of succession ----------

	/** The Show view the phone list draws: the same rule as for a tree, and a title that is gone ends the view. */
	showViewFor(st: BlockState, whole: FamilyGraph): SuccessionDrawn | null {
		const port = this.port;
		const { drawn, ended } = showViewOf(st, whole, port.settings, { full: !!port.full, coarse: port.coarse, phone: port.phone });
		if (ended) st.succession = null;
		return drawn;
	}

	/** The people that the folds must show: the finder's line, or the ruler, the heirs and the open branches of the Show view. */
	linePeople(): string[] | null {
		const drawn = this.port.successionDrawn;
		if (drawn) return linePeople(drawn);
		return this.port.finderDrawn?.line?.people ?? null;
	}

	/** The banner of the Show view: the sentence and Close in one row, with the look and the place of the finder's banner. */
	buildSuccessionBar(viewport: HTMLElement, before: HTMLElement, d: SuccessionDrawn): void {
		const id = `dynasty-result-${++resultIds}`;
		const bar = viewport.createDiv({ cls: ['dynasty-result', 'dynasty-succession-bar', ...(this.port.menu.kind() === 'phone' ? ['dynasty-result-phone'] : [])], attr: { role: 'group', 'aria-labelledby': id } });
		// After the toolbar and before the cards in the Tab order, like the finder's bar.
		viewport.insertBefore(bar, before);
		setBarText(bar.createDiv({ cls: ['dynasty-result-text', 'dynasty-succession-text'], attr: { id, role: 'status', tabindex: -1 } }), d.sentence);
		const row = bar.createDiv({ cls: 'dynasty-result-buttons' });
		this.closeLink(row, 'dynasty-succession-close', SUCCESSION_UI.barClose, SUCCESSION_UI.barCloseLabel, () => this.closeSuccession());
	}

	/** Close, Esc: the views show what they showed before; the focus goes back to More (the list: to Find). */
	closeSuccession(): void {
		const port = this.port;
		const st = port.ensureState();
		st.succession = null;
		port.focusDue = port.listMode ? '.dynasty-list-find' : '.dynasty-more';
		BlockViews.of(port.host, st).successionRedraw();
	}

	/** Relation (spec §13.2): the first person, then the second (not the first); the marked person is offered first. */
	async start(): Promise<void> {
		const port = this.port;
		const g = port.whole;
		if (!g || port.unloaded) return;
		const st = port.ensureState();
		const me = port.meId;
		const a = await pickPerson(port.host.app, g, new Set(), FINDER_UI.placeholder, FINDER_UI.firstTitle, false, me, null, { ...port.pickerContext(), titleOnPhone: true });
		if (a?.kind !== 'person') {
			port.guard(() => port.refocusTool('.dynasty-more'));
			return;
		}
		const b = await pickPerson(port.host.app, g, new Set([a.id]), FINDER_UI.placeholder, FINDER_UI.secondTitle, false, me !== a.id ? me : null, null, { ...port.pickerContext(), titleOnPhone: true });
		if (b?.kind !== 'person') {
			port.guard(() => port.refocusTool('.dynasty-more'));
			return;
		}
		port.guard(() => BlockViews.of(port.host, st).showFinder(a.id, b.id, port.unloaded ? null : port.view));
	}
}
