/*
 * The Succession section of the Titles window (contract 0.2.7 sections D.3, E, J, K, L): the rule, who can inherit, the
 * year, the switches, the named heirs and the excluded people, and below them the line of succession that the draft gives.
 * It edits the `succ` fields of the draft row of one saved title and never writes to the note; the window's Save does
 * (`titles-draft.ts`). On a computer the choices are dropdowns; on a phone they are columns of buttons, because the long
 * names with their terms do not fit a closed dropdown at 390 px. `titles-window.ts` makes one section for each edit page.
 */

import { setIcon } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { successionLine, type NamedHeirState, type SuccessionResult } from '../core/succession';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES, ordinal, yearOf, type InheritIllegitimate } from '../core/succession-keys';
import { SUCCESSION_UI as T } from '../render/ui-text';
import { draftSpec, draftTitle, holderText, type SuccessionDraft, type TitleRow } from './titles-draft';

/** The inherit rules whose preferred sex is women (the hint of the illegitimate choice). */
const WOMEN_RULES: readonly string[] = ['women-only', 'women-first', 'women-first-in-house'];
/** The draft value for a written value that the plugin cannot read. */
const UNKNOWN = '?';
/** The year field recomputes the line this long after the last key press (E.2). */
const YEAR_MS = 300;

/** What the section needs from the window. */
export interface SectionHost {
	/** The family graph now: it changes when the window reloads. */
	g(): FamilyGraph;
	/** The draft row of the title; the section changes its `succ`. */
	row: TitleRow;
	/** The length of the line (the setting `successionLength`). */
	limit(): number;
	/** The age from which the line warns (the setting `oldAge`). */
	oldAge(): number;
	/** The age under which a death opens no branch (the setting `youngDeathAge`, M.7); 0 shows every open branch. */
	youngDeathAge(): number;
	/** True while the window has the phone layout. */
	phone(): boolean;
	/** The window of the page, for the timer (a note can be in a pop-out window). */
	win(): { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };
	/** A change of the draft: the window clears its error line. */
	edited(): void;
	/** Runs a step so that it never leaves an exception in Obsidian (spec §8). */
	guard(fn: () => void): void;
	/** A tap on a name: the window shows the card in the tree. */
	showCard(id: string): void;
	/** The Show button. */
	show(): void;
	/** The person picker for a named heir or an excluded person. `skip` is the people it must not offer. Null: cancelled. */
	pick(kind: 'heir' | 'exclude', skip: ReadonlySet<string>): Promise<string | null>;
}

/** What the window does with a section it made. */
export interface SuccessionView {
	/** Draws the whole section again from the draft; `focus` names the control (`data-focus`) that gets the focus. */
	draw(focus?: string): void;
	/** The window got wider or narrower: draws again if the layout (dropdown or buttons) changed. */
	relayout(): void;
	/** The result of the line now (for tests and for the Show button). */
	result(): SuccessionResult | null;
	/** Stops the timer of the year field. */
	dispose(): void;
}

/** The hints of the section for a draft (D.3, J.10, K.1). Pure, so a test can read them without a window. */
export function successionHints(s: SuccessionDraft): { rule: string | null; inherit: string[]; through: string | null; illegitimate: boolean } {
	const rule = s.rule === '' || s.rule === '?' ? null : s.rule;
	const inherit = s.inherit === '' || s.inherit === '?' ? 'no-preference' : s.inherit;
	const through = s.through === '' || s.through === '?' ? '' : s.through;
	const out: string[] = [];
	if (rule === 'eldest-child' && inherit === 'men-only' && through === 'men') out.push(T.salic);
	if (rule === 'eldest-child' && inherit === 'women-only' && through === 'women') out.push(T.salicReverse);
	const house = rule === 'siblings-first' || rule === 'nearest-relative';
	if (house && inherit === 'men-first-in-house') out.push(T.houseMen);
	if (house && inherit === 'women-first-in-house') out.push(T.houseWomen);
	return {
		rule: rule === 'siblings-first' ? T.siblingsHint : rule === 'nearest-relative' ? T.nearestHint : null,
		inherit: out,
		through: rule === 'eldest-child' && inherit === 'men-only' && through === 'women' ? T.matrilinealHint : null,
		illegitimate: rule !== null && WOMEN_RULES.includes(inherit) && s.illegitimate !== 'equal',
	};
}

/** Draws the Succession section of a saved title into `parent`. */
export function successionSection(parent: HTMLElement, host: SectionHost): SuccessionView {
	const root = parent.createDiv({ cls: 'dynasty-succ', attr: { role: 'group', 'aria-label': T.heading, 'data-section': 'succession' } });
	root.createDiv({ cls: 'dynasty-sheet-section-title', text: T.heading });
	const body = root.createDiv({ cls: 'dynasty-succ-body' });
	// One short sentence that a screen reader says when the line changes. It stays outside the body, which draws again at each change.
	const live = root.createDiv({ cls: 'dynasty-succ-live', attr: { 'aria-live': 'polite', 'data-succ': 'summary' } });
	const s = () => host.row.succ!;
	let drawnPhone = host.phone();
	let result: SuccessionResult | null = null;
	let timer: number | null = null;
	let lineEl: HTMLElement | null = null;

	const nameOf = (id: string) => host.g().byId.get(id)?.name ?? id;
	/** The text the note has for a key that the plugin cannot read, or null if the window cannot show it. */
	const badText = (key: 'succession' | 'inherit' | 'inherit-through' | 'inherit-illegitimate'): string | null => {
		const t = host.row.id === null ? undefined : host.g().titles?.find((x) => x.id === host.row.id);
		const raw = key === 'succession' ? t?.succession : key === 'inherit' ? t?.inherit : undefined;
		const text = (raw ?? t?.badKeys?.[key] ?? '').trim();
		return text === '' ? null : text;
	};
	const stop = () => {
		if (timer !== null) host.win().clearTimeout(timer);
		timer = null;
	};
	const change = (fn: () => void, focus?: string) =>
		host.guard(() => {
			fn();
			host.edited();
			draw(focus);
		});

	/** The line for the draft, on the current graph (E.2). Null if the title is not in the tree. */
	function compute(): SuccessionResult | null {
		try {
			const title = draftTitle(host.g(), host.row);
			if (!title) return null;
			return successionLine(host.g(), title, draftSpec(s()), host.limit(), host.oldAge(), host.youngDeathAge());
		} catch (e) {
			console.error('Dynasty Tree: cannot compute the line of succession', e);
			return null;
		}
	}

	// ---------- choices: a dropdown on a computer, a column of buttons on a phone ----------

	function choice(box: HTMLElement, o: { key: string; label: string; value: string; options: [string, string][]; pick: (v: string) => void; unknown?: string | null }): void {
		if (host.phone()) {
			const group = box.createDiv({ cls: 'dynasty-succ-choice-group', attr: { role: 'radiogroup', 'aria-label': o.label, 'data-succ': o.key } });
			group.createDiv({ cls: 'dynasty-sheet-label', text: o.label });
			const column = group.createDiv({ cls: 'dynasty-succ-choices' });
			for (const [value, text] of o.options) {
				const on = value === o.value;
				const b = column.createEl('button', {
					cls: on ? ['dynasty-sheet-action', 'dynasty-succ-choice', 'is-selected'] : ['dynasty-sheet-action', 'dynasty-succ-choice'],
					text,
					attr: { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-value': value, 'data-focus': `succ-${o.key}:${value}` },
				});
				b.addEventListener('click', () => {
					if (!on) o.pick(value);
				});
			}
			return;
		}
		const field = box.createEl('label', { cls: 'dynasty-sheet-field', attr: { 'data-succ': o.key } });
		field.createSpan({ cls: 'dynasty-sheet-label', text: o.label });
		const sel = field.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input'], attr: { 'aria-label': o.label, 'data-focus': `succ-${o.key}` } });
		// A written value that the plugin cannot read has its own first option, so that choosing the default can remove it.
		const options: [string, string][] = o.value === UNKNOWN ? [[UNKNOWN, T.unknownValue(o.unknown ?? null)], ...o.options] : o.options;
		for (const [value, text] of options) sel.createEl('option', { text, attr: { value } });
		sel.value = o.value;
		sel.addEventListener('change', () => {
			if (sel.value !== UNKNOWN) o.pick(sel.value);
		});
	}

	const hint = (box: HTMLElement, text: string | null, name: string) => {
		if (text) box.createDiv({ cls: 'dynasty-sheet-hint', text, attr: { 'data-hint': name } });
	};

	function switchRow(box: HTMLElement, o: { key: string; label: string; hint: string; on: boolean; set: (v: boolean) => void }): void {
		const pair = box.createDiv({ cls: 'dynasty-succ-pair', attr: { 'data-succ': o.key } });
		const row = pair.createEl('label', { cls: 'dynasty-succ-switch' });
		row.createSpan({ cls: 'dynasty-succ-switch-text', text: o.label });
		const track = row.createDiv({ cls: o.on ? ['checkbox-container', 'is-enabled'] : ['checkbox-container'] });
		const input = track.createEl('input', { attr: { type: 'checkbox', role: 'switch', 'aria-label': o.label, 'data-focus': `succ-${o.key}` } });
		input.checked = o.on;
		input.addEventListener('change', () => o.set(input.checked));
		if (o.hint) pair.createDiv({ cls: 'dynasty-sheet-hint', text: o.hint });
	}

	// ---------- the whole section ----------

	function draw(focus?: string): void {
		const doc = body.doc;
		const had = focus ?? (doc.activeElement && body.contains(doc.activeElement as HTMLElement) ? (doc.activeElement as HTMLElement).getAttribute('data-focus') : null);
		stop();
		body.empty();
		drawnPhone = host.phone();
		const d = s();
		const hints = successionHints(d);
		const real = d.rule !== '' && d.rule !== '?';

		const pair = () => body.createDiv({ cls: 'dynasty-succ-pair' });
		// Rule. Choosing None removes the rule and the choice of who can inherit (E.3).
		let box = pair();
		choice(box, {
			key: 'rule',
			label: T.ruleLabel,
			value: d.rule === UNKNOWN ? UNKNOWN : real ? d.rule : '',
			unknown: badText('succession'),
			options: [['', T.ruleNone], ...SUCCESSION_RULES.map((r): [string, string] => [r, T.rules[r]])],
			pick: (v) =>
				change(() => {
					d.rule = v as SuccessionDraft['rule'];
					if (v === '') d.inherit = '';
				}, `succ-rule${host.phone() ? `:${v}` : ''}`),
		});
		hint(box, hints.rule, 'rule');
		if (real) {
			// Who can inherit. An unwritten key shows as "No preference" (E.3).
			box = pair();
			choice(box, {
				key: 'inherit',
				label: T.inheritLabel,
				value: d.inherit === '' ? 'no-preference' : d.inherit,
				unknown: badText('inherit'),
				options: INHERIT_RULES.map((r): [string, string] => [r, T.inherits[r]]),
				pick: (v) => change(() => void (d.inherit = v as SuccessionDraft['inherit']), `succ-inherit${host.phone() ? `:${v}` : ''}`),
			});
			for (const h of hints.inherit) hint(box, h, 'inherit');
			box = pair();
			choice(box, {
				key: 'through',
				label: T.throughLabel,
				value: d.through,
				unknown: badText('inherit-through'),
				options: [['', T.throughSame], ...INHERIT_THROUGH.map((r): [string, string] => [r, T.throughs[r]])],
				pick: (v) => change(() => void (d.through = v as SuccessionDraft['through']), `succ-through${host.phone() ? `:${v}` : ''}`),
			});
			hint(box, hints.through, 'through');
		}

		// Year. The field changes the draft at once; the line follows on blur and 300 ms after the last key press.
		box = pair();
		const field = box.createEl('label', { cls: 'dynasty-sheet-field', attr: { 'data-succ': 'year' } });
		field.createSpan({ cls: 'dynasty-sheet-label', text: T.yearLabel });
		const year = field.createEl('input', {
			cls: ['dynasty-sheet-input', 'dynasty-succ-year'],
			attr: { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': T.yearLabel, 'data-focus': 'succ-year' },
		});
		year.value = d.year;
		let shown = d.year;
		const refresh = () => {
			stop();
			if (shown === s().year) return;
			shown = s().year;
			drawLine();
		};
		year.addEventListener('input', () =>
			host.guard(() => {
				s().year = year.value;
				host.edited();
				stop();
				timer = host.win().setTimeout(() => host.guard(refresh), YEAR_MS);
			}),
		);
		year.addEventListener('blur', () => host.guard(refresh));
		year.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
				e.preventDefault();
				year.blur();
			}
		});
		hint(box, T.yearHint, 'year');
		// The note has a year that the plugin cannot read: the field is empty, and this hint names the text until the owner types a year.
		if (d.yearBad !== undefined) {
			const bad = box.createDiv({ cls: 'dynasty-sheet-hint', text: T.yearBad(d.yearBad), attr: { 'data-hint': 'year-bad' } });
			if (d.year.trim() !== '') bad.hide();
			year.addEventListener('input', () => (year.value.trim() === '' ? bad.show() : bad.hide()));
		}

		// Children marked as illegitimate.
		box = pair();
		choice(box, {
			key: 'illegitimate',
			label: T.illLabel,
			value: d.illegitimate,
			unknown: badText('inherit-illegitimate'),
			options: INHERIT_ILLEGITIMATE.map((r): [string, string] => [r, T.ills[r]]),
			pick: (v) => change(() => void (d.illegitimate = v as InheritIllegitimate), `succ-illegitimate${host.phone() ? `:${v}` : ''}`),
		});
		if (hints.illegitimate) hint(box, T.illHint, 'illegitimate');

		switchRow(body, { key: 'adopted', label: T.adopted, hint: T.adoptedHint, on: d.adopted, set: (v) => change(() => void (d.adopted = v), 'succ-adopted') });
		if (real) {
			const first = firstHolder();
			switchRow(body, { key: 'body', label: T.body, hint: first ? T.bodyHint(first) : '', on: d.body, set: (v) => change(() => void (d.body = v), 'succ-body') });
		}

		// The line is computed first: the notes under the named heirs read it.
		result = compute();
		peopleList('heir');
		peopleList('exclude');

		lineEl = body.createDiv({ cls: 'dynasty-succ-line', attr: { role: 'region', 'aria-label': T.heading } });
		drawLine(false);

		if (had) body.querySelector<HTMLElement>(`[data-focus="${had}"]`)?.focus({ preventScroll: host.phone() });
	}

	/** The one sentence for the live region: how many heirs the line has, or why it has none. */
	function summary(res: SuccessionResult | null): string {
		if (!res || res.kind === 'no-rule') return '';
		if (res.kind === 'bad-rule') return T.badRule;
		if (res.kind === 'no-ruler') return T.noRuler(res.year);
		if (res.kind === 'ruler-not-in-tree') return T.rulerNotInTree(res.year);
		return res.heirs.length ? T.heirCount(res.heirs.length) : T.noHeir;
	}

	/** The first holder who is in the tree, in the draft, as the holder list names him (L.2). */
	function firstHolder(): string | null {
		const g = host.g();
		for (const h of host.row.holders) {
			const p = h.values.person;
			if (p !== undefined && g.byId.has(p)) return holderText(g, h.values).ruler || nameOf(p);
		}
		return null;
	}

	// ---------- named heirs and excluded people ----------

	function peopleList(kind: 'heir' | 'exclude'): void {
		const d = s();
		const list = kind === 'heir' ? d.heirs : d.exclude;
		const title = host.row.name.trim() || T.heading;
		const panel = body.createDiv({ cls: ['dynasty-holder-panel', 'dynasty-succ-people'], attr: { 'data-succ': kind === 'heir' ? 'heirs' : 'exclude' } });
		panel.createDiv({ cls: 'dynasty-sheet-label', text: kind === 'heir' ? T.heirsLabel : T.excludeLabel });
		panel.createDiv({ cls: 'dynasty-sheet-hint', text: kind === 'heir' ? T.heirsHint : T.excludeHint });
		const rows = panel.createDiv({ cls: 'dynasty-holder-list' });
		if (!list.length) rows.createDiv({ cls: ['dynasty-holder-none', 'dynasty-sheet-hint'], text: kind === 'heir' ? T.heirsNone : T.excludeNone });
		const g = host.g();
		list.forEach((id, i) => {
			const inTree = g.byId.has(id);
			const who = nameOf(id);
			const row = rows.createDiv({ cls: inTree ? 'dynasty-holder-row' : ['dynasty-holder-row', 'is-not-in-tree'], attr: { 'data-person': id } });
			const words = row.createDiv({ cls: 'dynasty-holder-text' });
			if (inTree) {
				const name = words.createEl('button', { cls: 'dynasty-holder-name', attr: { type: 'button', 'aria-label': `${who}: show the card in the tree`, 'data-focus': `succ-${kind}-name:${id}` } });
				name.createSpan({ cls: 'dynasty-holder-label', text: who });
				name.addEventListener('click', () => host.guard(() => host.showCard(id)));
			} else {
				words.createDiv({ cls: 'dynasty-holder-name', text: id });
				words.createDiv({ cls: 'dynasty-holder-note', text: T.heirNotInTree });
			}
			const state = kind === 'heir' ? result?.namedHeirs.find((h) => h.id === id)?.state : undefined;
			const text = state ? stateText(state, id) : null;
			if (text) words.createDiv({ cls: 'dynasty-holder-note', text, attr: { 'data-note': state ?? '' } });
			const born = result?.noYear.find((n) => n.id === id && n.what === 'born');
			if (kind === 'heir' && born) words.createDiv({ cls: 'dynasty-holder-note', text: T.noYearDate(who), attr: { 'data-note': 'no-year' } });
			const buttons = row.createDiv({ cls: 'dynasty-holder-buttons' });
			if (kind === 'heir') {
				const move = (dir: -1 | 1, cls: string, icon: string, label: string, aria: string) => {
					const b = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-holder-move', `dynasty-succ-${cls}`], attr: { type: 'button', 'aria-label': aria, 'data-focus': `succ-heir-${cls}:${id}` } });
					setIcon(b.createSpan({ cls: 'dynasty-holder-move-icon' }), icon);
					b.createSpan({ cls: 'dynasty-holder-move-text', text: label });
					const to = i + dir;
					b.disabled = to < 0 || to >= list.length;
					b.addEventListener('click', () => {
						if (to < 0 || to >= list.length) return;
						const end = to === 0 || to === list.length - 1;
						change(() => void ([list[i], list[to]] = [list[to], list[i]]), end ? `succ-heir-${dir < 0 ? 'later' : 'earlier'}:${id}` : `succ-heir-${cls}:${id}`);
					});
				};
				move(-1, 'earlier', 'arrow-up', T.moveEarlier, T.moveEarlierLabel(who));
				move(1, 'later', 'arrow-down', T.moveLater, T.moveLaterLabel(who));
			}
			const remove = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-holder-remove'], text: T.remove, attr: { type: 'button', 'aria-label': T.removeLabel(who), 'data-focus': `succ-${kind}-remove:${id}` } });
			remove.addEventListener('click', () => {
				const at = list.indexOf(id);
				if (at < 0) return;
				const next = list[at + 1] ?? list[at - 1];
				change(() => void list.splice(at, 1), next !== undefined ? `succ-${kind}-remove:${next}` : `succ-${kind}-add`);
			});
		});
		const add = panel.createEl('button', {
			cls: ['dynasty-sheet-action', 'dynasty-succ-add'],
			text: kind === 'heir' ? T.addHeir : T.addExclude,
			attr: { type: 'button', 'aria-label': kind === 'heir' ? T.addHeirLabel(title) : T.addExcludeLabel(title), 'data-focus': `succ-${kind}-add` },
		});
		add.addEventListener('click', () =>
			host.guard(() => {
				// The ruler is never offered; nor is a person who is on the list already.
				const skip = new Set<string>(list);
				if (result?.ruler) skip.add(result.ruler);
				void host.pick(kind, skip).then(
					(id) => {
						host.guard(() => {
							// The list as it is now: the window can have drawn the page again while the picker was open.
							const now = kind === 'heir' ? s().heirs : s().exclude;
							if (id !== null && !now.includes(id)) change(() => void now.push(id), `succ-${kind}-add`);
							else draw(`succ-${kind}-add`);
						});
					},
					(e) => console.error('Dynasty Tree: the picker failed', e),
				);
			}),
		);
	}

	function stateText(state: NamedHeirState, id: string): string | null {
		const name = nameOf(id);
		const y = result?.year ?? null;
		if (state === 'not-alive') return T.heirNotAlive(name, y);
		if (state === 'not-born') return T.heirNotBorn(name, y);
		if (state === 'is-ruler') return T.heirIsRuler(name);
		if (state === 'excluded') return T.heirExcluded(name);
		return null;
	}

	// ---------- the line ----------

	function drawLine(recompute = true): void {
		const el = lineEl;
		if (!el) return;
		el.empty();
		if (recompute) result = compute();
		const res = result;
		const d = s();
		// A new year can make a named heir dead or not born yet: the notes under the named heirs follow it.
		live.setText(summary(res));
		if (!res || res.kind === 'no-rule') {
			el.hide();
			if (recompute) refreshStates();
			return;
		}
		el.show();
		const y = res.year;
		if (res.kind === 'bad-rule') {
			el.createDiv({ cls: 'dynasty-succ-msg', text: T.badRule, attr: { 'data-msg': 'bad-rule' } });
			return;
		}
		if (res.kind === 'no-ruler') {
			el.createDiv({ cls: 'dynasty-succ-msg', text: T.noRuler(y), attr: { 'data-msg': 'no-ruler' } });
			if (recompute) refreshStates();
			return;
		}
		if (res.kind === 'ruler-not-in-tree') {
			el.createDiv({ cls: 'dynasty-succ-msg', text: T.rulerNotInTree(y), attr: { 'data-msg': 'ruler-not-in-tree' } });
			if (recompute) refreshStates();
			return;
		}
		const g = host.g();
		const ruler = res.ruler ?? '';
		el.createDiv({ cls: 'dynasty-succ-heading', text: T.lineHeading(rulerLabel(ruler, y), y), attr: { role: 'heading', 'aria-level': '3' } });
		const note = (text: string, name: string, warn = false) => {
			const n = el.createDiv({ cls: warn ? ['dynasty-succ-note', 'is-warning'] : ['dynasty-succ-note'], attr: { 'data-note': name } });
			if (warn) setIcon(n.createSpan({ cls: 'dynasty-succ-note-icon', attr: { 'aria-hidden': 'true' } }), 'alert-triangle');
			n.createSpan({ text });
		};
		if (res.coRulers.length) note(T.coRulers(res.coRulers.length + 1, rulerLabel(ruler, y), y), 'co-rulers');
		for (const n of res.noYear) {
			if (n.what !== 'reign') continue;
			const entry = n.entry === undefined ? undefined : host.row.holders[n.entry];
			note(T.noYearReign(entry ? holderText(g, entry.values).ruler : nameOf(n.id)), 'no-year-reign', true);
		}
		if (d.through !== '' && d.through !== '?' && ruler && g.byId.has(ruler) && !g.byId.get(ruler)?.sex) note(T.rulerNoSex(nameOf(ruler)), 'ruler-no-sex', true);
		if (res.leftOutNoSex > 0) note(T.leftOutNoSex(res.leftOutNoSex), 'no-sex', true);
		if (res.noBirthYear > 0) note(T.noBirthYear(res.noBirthYear), 'no-birth-year', true);
		if (res.outsideBody) note(T.outsideBody(rulerLabel(ruler, y), firstHolder() ?? ''), 'outside-body', true);
		const list = el.createDiv({ cls: 'dynasty-succ-list', attr: { role: 'list' } });
		// M.2, M.3: a grey row stands before the heir at its `before` place (after that many heirs); the rows that remain stand after the last heir.
		let nextBranch = 0;
		const branches = (upTo: number) => {
			while (nextBranch < res.openBranches.length && res.openBranches[nextBranch].before <= upTo) branchRow(list, res.openBranches[nextBranch++].id);
		};
		res.heirs.forEach((id, i) => {
			branches(i);
			const item = list.createDiv({ cls: 'dynasty-succ-item', attr: { role: 'listitem', 'data-person': id } });
			const row = item.createDiv({ cls: 'dynasty-succ-row' });
			const ord = ordinal(i + 1);
			row.createSpan({ cls: 'dynasty-succ-ord', text: ord });
			const name = row.createEl('button', { cls: 'dynasty-holder-name', attr: { type: 'button', 'aria-label': T.lineRowLabel(nameOf(id), ord), 'data-focus': `succ-line:${id}` } });
			name.createSpan({ cls: 'dynasty-holder-label', text: nameOf(id) });
			name.addEventListener('click', () => host.guard(() => host.showCard(id)));
			const sub = (text: string, kind: string, warn: boolean) => {
				const n = item.createDiv({ cls: warn ? ['dynasty-succ-subnote', 'is-warning'] : ['dynasty-succ-subnote'], attr: { 'data-note': kind } });
				if (warn) setIcon(n.createSpan({ cls: 'dynasty-succ-note-icon', attr: { 'aria-hidden': 'true' } }), 'alert-triangle');
				n.createSpan({ text });
			};
			if (res.old.includes(id)) sub(T.old(nameOf(id), host.oldAge(), y), 'old', true);
			if (res.noYear.some((n) => n.id === id && n.what === 'born')) sub(T.noYearDate(nameOf(id)), 'no-year', true);
		});
		branches(Infinity);
		if (!res.heirs.length && !res.outsideBody) el.createDiv({ cls: 'dynasty-succ-msg', text: T.noHeir, attr: { 'data-msg': 'no-heir' } });
		if (res.more) el.createDiv({ cls: 'dynasty-succ-more', text: T.more });
		if (res.moreBranches) el.createDiv({ cls: 'dynasty-succ-more dynasty-succ-more-branches', text: T.moreBranches });
		if (res.openBranches.length) el.createDiv({ cls: 'dynasty-sheet-hint dynasty-succ-branch-note', text: T.branchNote, attr: { 'data-hint': 'branch-note' } });
		// Show works for a line, also an empty one (E.4).
		const buttons = el.createDiv({ cls: 'dynasty-succ-buttons' });
		const show = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-succ-show'], text: T.show, attr: { type: 'button', 'aria-label': T.showLabel, 'data-focus': 'succ-show' } });
		show.addEventListener('click', () => host.guard(() => host.show()));
		if (recompute) refreshStates();
	}

	/** A grey row of the line (M.8): a person who died and has no children in the tree. The row taps like a name and uses no place. */
	function branchRow(list: HTMLElement, id: string): void {
		const p = host.g().byId.get(id);
		const text = T.branchRow(nameOf(id), p?.died ?? '');
		const item = list.createDiv({ cls: 'dynasty-succ-branch', attr: { role: 'listitem', 'data-person': id, 'data-branch': 'open' } });
		const row = item.createDiv({ cls: 'dynasty-succ-branch-row' });
		row.createSpan({ cls: 'dynasty-succ-ord', text: T.branchMark, attr: { 'aria-hidden': 'true' } });
		const name = row.createEl('button', { cls: 'dynasty-holder-name', attr: { type: 'button', 'aria-label': T.branchRowLabel(text), 'data-focus': `succ-branch:${id}` } });
		name.createSpan({ cls: 'dynasty-holder-label', text });
		name.addEventListener('click', () => host.guard(() => host.showCard(id)));
	}

	/** The notes under the named heirs follow the line (a new year can make a named heir dead or not born yet). */
	function refreshStates(): void {
		const res = result;
		for (const row of Array.from(body.querySelectorAll('[data-succ="heirs"] .dynasty-holder-row'))) {
			const id = row.getAttribute('data-person') ?? '';
			const words = row.querySelector('.dynasty-holder-text');
			if (!words) continue;
			for (const n of Array.from(words.querySelectorAll('[data-note]'))) n.remove();
			const state = res?.namedHeirs.find((h) => h.id === id)?.state;
			const text = state ? stateText(state, id) : null;
			if (text) words.createDiv({ cls: 'dynasty-holder-note', text, attr: { 'data-note': state ?? '' } });
			if (res?.noYear.some((n) => n.id === id && n.what === 'born')) words.createDiv({ cls: 'dynasty-holder-note', text: T.noYearDate(nameOf(id)), attr: { 'data-note': 'no-year' } });
		}
	}

	/** "Aldric II": the ruler text of the holder entry of R that the year reaches; else the name. */
	function rulerLabel(id: string, year: number | null): string {
		const g = host.g();
		let pick: string | null = null;
		for (const h of host.row.holders) {
			if (h.values.person !== id) continue;
			const from = yearOf(h.values.from);
			if (pick === null || year === null || from === undefined || from <= year) pick = holderText(g, h.values).ruler;
		}
		return pick || nameOf(id);
	}

	draw();
	return {
		draw,
		relayout: () => {
			if (drawnPhone !== host.phone()) draw();
		},
		result: () => result,
		dispose: stop,
	};
}
