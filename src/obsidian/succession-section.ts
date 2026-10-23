/*
 * The two succession sections of the Titles window page (contract 0.2.7 sections D.3, E, J, K, L; 0.2.8 contract C, G.6, G.7): the
 * section "Line of succession" (the line that the draft gives, the button Show, the quiet notes) and the section "Rules of
 * succession" (the rule, who can inherit, the year, the switches, the named heirs and the excluded people). Both are drawn from
 * the `succ` fields of the draft row of one saved title and never write to the note; the window's Save does (`titles-draft.ts`).
 * The choices are dropdowns on every device; on a phone each one is the phone's own list (D208 item 3, phone-rules-native).
 * `titles-window.ts` makes one view for each edit page and puts its two bodies in the sections.
 */

import { setIcon } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { successionLine, type SuccessionNote, type SuccessionResult } from '../core/succession';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES, ordinal, type InheritIllegitimate } from '../core/succession-keys';
import { dateLine } from '../render/tree-info';
import { SUCCESSION_UI as T, TITLES_UI } from '../render/ui-text';
import { draftSpec, draftTitle, holderText, type SuccessionDraft, type TitleRow } from '../view/titles-draft';
import { afterNotes, heirNotes, rulerLabelOf } from '../view/succession-notes';
import { bodyHints, firstInfo, illegitimateHint } from './body-hint';
import { setRowHints, switchRow } from './switch-row';
import { RowPictures, buildRow, iconButton, personLead, textButton } from './window-parts';
import type { PictureStore } from './picture-store';

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
	/** True while the window has the phone layout: a field that gets the focus back then does not scroll the page. */
	phone(): boolean;
	/** The window of the page, for the timer (a note can be in a pop-out window). */
	win(): { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };
	/** A change of the draft: the window clears its error line. */
	edited(): void;
	/** Runs a step so that it never leaves an exception in Obsidian (spec §8). */
	guard(fn: () => void): void;
	/** A tap on a name of a list of people: the window shows the card in the tree. */
	showCard(id: string): void;
	/** G.7: a tap on a row of the line opens the person; the window gives the way to do so (absent: the card shows in the tree). */
	openPerson?(id: string): void;
	/** The Show button. */
	show(): void;
	/** The person picker for a named heir or an excluded person. `skip` is the people it must not offer. Null: cancelled. */
	pick(kind: 'heir' | 'exclude', skip: ReadonlySet<string>): Promise<string | null>;
	/** The line or the rules changed: the closed sections show their summary line. */
	summaries?(s: { line: string; rules: string }): void;
	/** The pictures of the rows (portraits and initials); absent: initials only. */
	pictures?: PictureStore;
	/** The tree's note, for the pictures. */
	sourcePath?: string;
}

/** What the window does with a section it made. */
export interface SuccessionView {
	/** The Rules section opened or closed. The cadet hint is computed only while it is open (D282, G2 of part 4). */
	rulesOpened(open: boolean): void;
	/** Draws the two bodies again from the draft; `focus` names the control (`data-focus`) that gets the focus. */
	draw(focus?: string): void;
	/** The result of the line now (for tests and for the Show button). */
	result(): SuccessionResult | null;
	/** The body of the section "Line of succession". */
	renderLine(parent: HTMLElement): void;
	/** The body of the section "Rules of succession". */
	renderRules(parent: HTMLElement): void;
	/** The one text line under the title of the closed section "Line of succession": "1st Aldric · 2nd Bran". */
	lineSummary(): string;
	/** The one text line under the title of the closed section "Rules of succession": "Eldest child first · No preference". */
	rulesSummary(): string;
	/** Stops the timer of the year field and lets go of the pictures. */
	dispose(): void;
}

/** The hints of the section for a draft (D.3, J.10, K.1). Pure, so a test can read them without a window. */
export function successionHints(s: SuccessionDraft): { rule: string | null; inherit: string[]; through: string | null; illegitimate: string | null } {
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
		illegitimate: rule === null || s.illegitimate === 'equal' ? null : illegitimateHint(inherit, through),
	};
}

/** A name of a rule without the technical term in brackets: "Eldest child first (primogeniture)" reads "Eldest child first". */
const short = (text: string): string => text.replace(/\s*\(.*\)$/, '');

/** The summary of the rules for a draft (contract C): the rule and who can inherit, without the terms; "None" for no rule. */
export function rulesSummary(s: SuccessionDraft): string {
	const rule = s.rule === '' ? T.ruleNone : s.rule === UNKNOWN ? T.unknownValue(null) : short(T.rules[s.rule]);
	const inherit = s.rule === '' || s.rule === UNKNOWN ? '' : s.inherit === '' ? short(T.inherits['no-preference']) : s.inherit === UNKNOWN ? T.unknownValue(null) : short(T.inherits[s.inherit]);
	return [rule, inherit].filter(Boolean).join(' · ');
}

/** The parts of the rules body that stay on the page between two choices. */
interface RulesUi {
	/** Each pair is one choice and its hints. */
	rulePair: HTMLElement;
	inheritPair: HTMLElement | null;
	throughPair: HTMLElement | null;
	/** The pair of the year: the pairs "Who can inherit" and "Inherit through" stand before it. */
	yearPair: HTMLElement;
	illPair: HTMLElement;
	/** The box of the switches and the row of the switch "body", which exists only when the rule is real. */
	switches: HTMLElement;
	bodyRow: HTMLElement | null;
	grid: HTMLElement;
}

/** A hint under a choice; no text, no hint. */
const hint = (box: HTMLElement, text: string | null, name: string): void => {
	if (text) box.createDiv({ cls: ['dynasty-sheet-hint'], text, attr: { 'data-hint': name } });
};

/** Puts the hints of one name in a pair again (the choice itself stays). */
function setHints(box: HTMLElement, name: string, texts: readonly string[]): void {
	for (const c of Array.from(box.children)) if (c.getAttribute('data-hint') === name) c.remove();
	for (const t of texts) hint(box, t, name);
}

/** A new pair in the grid, before `ref`. */
function pairBefore(u: RulesUi, ref: HTMLElement): HTMLElement {
	const pair = u.grid.createDiv({ cls: ['dynasty-succ-pair', 'is-wide'] });
	u.grid.insertBefore(pair, ref);
	return pair;
}

/** The one sentence for the live region: how many heirs the line has, or why it has none. */
function summary(res: SuccessionResult | null): string {
	if (!res || res.kind === 'no-rule') return '';
	if (res.kind === 'bad-rule') return T.badRule;
	if (res.kind === 'no-ruler') return T.noRuler(res.yearText);
	if (res.kind === 'ruler-not-in-tree') return T.rulerNotInTree(res.yearText);
	return res.heirs.length ? T.heirCount(res.heirs.length) : T.noHeir;
}

/** Makes the succession view of a saved title; the window puts `renderLine` and `renderRules` in its two sections. */
export function successionSection(host: SectionHost): SuccessionView {
	const s = () => host.row.succ!;
	const pictures = new RowPictures(host.pictures, host.sourcePath ?? '');
	let rulesEl: HTMLElement | null = null;
	let lineEl: HTMLElement | null = null;
	let result: SuccessionResult | null = null;
	let timer: number | null = null;
	// True while the Rules section is open. The window tells it (`rulesOpened`).
	let rulesOpen = false;
	// The year that the line shows now (the year field redraws the line only when the draft year differs from it).
	let shown = '';
	// The parts of the rules body that a choice can add, remove or change; a choice updates these in place (r032).
	let ui: RulesUi | null = null;
	// One short sentence that a screen reader says when the line changes. It stays outside the bodies, which draw again at each change.
	let live: HTMLElement | null = null;

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
	// A choice in a dropdown: the dropdown that the user used stays on the page, and the focus does not move. On a phone, a select
	// that is destroyed and made again inside its own change event keeps its menu open, and a new select that gets the focus opens (r032).
	const changeInPlace = (fn: () => void) =>
		host.guard(() => {
			fn();
			host.edited();
			update();
		});

	/** The line for the draft, on the current graph (E.2). Null if the title is not in the tree. */
	function compute(): SuccessionResult | null {
		try {
			const title = draftTitle(host.g(), host.row);
			if (!title) return null;
			return successionLine(host.g(), title, draftSpec(s()), host.limit(), host.oldAge(), host.youngDeathAge());
		} catch (e) {
			console.error('Crown and Kin: cannot compute the line of succession', e);
			return null;
		}
	}

	function lineSummary(): string {
		const res = result;
		if (!res || res.kind !== 'line' || !res.heirs.length) return T.noHeir;
		return res.heirs
			.slice(0, 2)
			.map((id, i) => `${ordinal(i + 1)} ${nameOf(id)}`)
			.join(' · ');
	}

	const summaries = () => host.summaries?.({ line: lineSummary(), rules: rulesSummary(s()) });

	// ---------- choices: one dropdown; on a phone it opens the phone's own list ----------

	function choice(box: HTMLElement, o: { key: string; label: string; value: string; options: [string, string][]; pick: (v: string) => void; unknown?: string | null; wide?: boolean }): void {
		const field = box.createEl('label', { cls: ['dynasty-sheet-field', ...(o.wide ? ['is-wide'] : [])], attr: { 'data-succ': o.key } });
		field.createSpan({ cls: 'dynasty-sheet-label', text: o.label });
		const wrap = field.createDiv({ cls: 'dynasty-select' });
		const sel = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { 'aria-label': o.label, 'data-focus': `succ-${o.key}` } });
		// A written value that the plugin cannot read has its own first option, so that choosing the default can remove it.
		const options: [string, string][] = o.value === UNKNOWN ? [[UNKNOWN, T.unknownValue(o.unknown ?? null)], ...o.options] : o.options;
		let unknownOption: HTMLElement | null = null;
		for (const [value, text] of options) {
			const opt = sel.createEl('option', { text, attr: { value } });
			if (value === UNKNOWN) unknownOption = opt;
		}
		sel.value = o.value;
		setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		sel.addEventListener('change', () => {
			if (sel.value === UNKNOWN) return;
			o.pick(sel.value);
			// The draft has a value now, so the entry for the unreadable text goes (it stood only until the first choice).
			unknownOption?.remove();
			unknownOption = null;
		});
	}

	// ---------- the whole view ----------

	/**
	 * What follows a choice in a dropdown. It changes only the parts that depend on the choice: the hints, the two choices that
	 * exist only for a real rule, the switch "body", the line and the notes under the named heirs. No dropdown is made again
	 * and the focus stays where it is.
	 */
	function update(): void {
		stop();
		result = compute();
		shown = s().year;
		if (rulesEl && ui) patchRules(ui);
		if (lineEl) drawLine(false);
		refreshStates();
		summaries();
	}

	function patchRules(u: RulesUi): void {
		const d = s();
		const hints = successionHints(d);
		const real = d.rule !== '' && d.rule !== '?';
		setHints(u.rulePair, 'rule', hints.rule ? [hints.rule] : []);
		if (real) {
			if (!u.inheritPair || !u.throughPair) {
				u.inheritPair = pairBefore(u, u.yearPair);
				inheritChoice(u.inheritPair);
				u.throughPair = pairBefore(u, u.yearPair);
				throughChoice(u.throughPair);
			}
			setHints(u.inheritPair, 'inherit', hints.inherit);
			setHints(u.throughPair, 'through', hints.through ? [hints.through] : []);
		} else {
			u.inheritPair?.remove();
			u.throughPair?.remove();
			u.inheritPair = null;
			u.throughPair = null;
		}
		setHints(u.illPair, 'illegitimate', hints.illegitimate ? [hints.illegitimate] : []);
		// The cadet hint depends on the line, so the hint spans of the switch row follow it.
		patchBody(u);
	}

	// The four choices of the rules body. Each one reads the draft when it is made.
	function ruleChoice(box: HTMLElement): void {
		const d = s();
		const real = d.rule !== '' && d.rule !== '?';
		choice(box, {
			key: 'rule',
			label: T.ruleLabel,
			value: d.rule === UNKNOWN ? UNKNOWN : real ? d.rule : '',
			unknown: badText('succession'),
			options: [['', T.ruleNone], ...SUCCESSION_RULES.map((r): [string, string] => [r, T.rules[r]])],
			// Choosing None removes the rule and the choice of who can inherit (E.3).
			pick: (v) =>
				changeInPlace(() => {
					d.rule = v as SuccessionDraft['rule'];
					if (v === '') d.inherit = '';
				}),
		});
	}

	function inheritChoice(box: HTMLElement): void {
		const d = s();
		// An unwritten key shows as "No preference" (E.3).
		choice(box, {
			key: 'inherit',
			label: T.inheritLabel,
			value: d.inherit === '' ? 'no-preference' : d.inherit,
			unknown: badText('inherit'),
			options: INHERIT_RULES.map((r): [string, string] => [r, T.inherits[r]]),
			pick: (v) => changeInPlace(() => void (d.inherit = v as SuccessionDraft['inherit'])),
		});
	}

	function throughChoice(box: HTMLElement): void {
		const d = s();
		choice(box, {
			key: 'through',
			label: T.throughLabel,
			value: d.through,
			unknown: badText('inherit-through'),
			options: [['', T.throughSame], ...INHERIT_THROUGH.map((r): [string, string] => [r, T.throughs[r]])],
			pick: (v) => changeInPlace(() => void (d.through = v as SuccessionDraft['through'])),
		});
	}

	function illChoice(box: HTMLElement): void {
		const d = s();
		choice(box, {
			key: 'illegitimate',
			label: T.illLabel,
			value: d.illegitimate,
			unknown: badText('inherit-illegitimate'),
			options: INHERIT_ILLEGITIMATE.map((r): [string, string] => [r, T.ills[r]]),
			pick: (v) => changeInPlace(() => void (d.illegitimate = v as InheritIllegitimate)),
			wide: true,
		});
	}

	/** The switch "body" with the hints that name the first holder and the cadet title (L.2, F-KIN-07, D291). */
	function bodyRow(switches: HTMLElement): HTMLElement {
		const d = s();
		const { hint, extra } = bodyHints(host.g(), host.row, d, result, rulesOpen);
		return switchRow(switches, { key: 'body', label: T.body, hint, extra, on: d.body, set: (v) => change(() => void (d.body = v), 'succ-body') });
	}

	/** The row of the switch stays; only its hint spans follow the line (a year commit or a choice must not replace the switch under a finger). */
	function patchBody(u: RulesUi): void {
		const real = s().rule !== '' && s().rule !== '?';
		if (!real) {
			u.bodyRow?.remove();
			u.bodyRow = null;
			return;
		}
		if (!u.bodyRow) {
			u.bodyRow = bodyRow(u.switches);
			return;
		}
		const { hint, extra } = bodyHints(host.g(), host.row, s(), result, rulesOpen);
		setRowHints(u.bodyRow, 'body', { first: hint, cadet: extra });
	}

	function draw(focus?: string): void {
		const mounted = rulesEl ?? lineEl;
		const doc = mounted?.doc;
		const had = focus ?? (doc?.activeElement && mounted?.contains(doc.activeElement) ? (doc.activeElement as HTMLElement).getAttribute('data-focus') : null);
		stop();
		// The line is computed first: the notes under the named heirs read it.
		result = compute();
		if (rulesEl) drawRules(rulesEl);
		if (lineEl) drawLine(false);
		summaries();
		if (had) (rulesEl ?? lineEl)?.querySelector<HTMLElement>(`[data-focus="${had}"]`)?.focus({ preventScroll: host.phone() });
	}

	/** The rules: the choices, the year, the switches, the named heirs and the excluded people. */
	function drawRules(body: HTMLElement): void {
		// The people lists inside are drawn again: their pictures go back to the store first.
		pictures.forget(body);
		body.empty();
		const d = s();
		const hints = successionHints(d);
		const real = d.rule !== '' && d.rule !== '?';

		const grid = body.createDiv({ cls: ['dynasty-grid', 'is-stack'] });
		const pair = () => grid.createDiv({ cls: ['dynasty-succ-pair', 'is-wide'] });
		const rulePair = pair();
		ruleChoice(rulePair);
		hint(rulePair, hints.rule, 'rule');
		let inheritPair: HTMLElement | null = null;
		let throughPair: HTMLElement | null = null;
		if (real) {
			inheritPair = pair();
			inheritChoice(inheritPair);
			for (const h of hints.inherit) hint(inheritPair, h, 'inherit');
			throughPair = pair();
			throughChoice(throughPair);
			hint(throughPair, hints.through, 'through');
		}

		// Year. The field changes the draft at once; the line follows on blur and 300 ms after the last key press.
		const yearPair = pair();
		const field = yearPair.createEl('label', { cls: 'dynasty-sheet-field', attr: { 'data-succ': 'year' } });
		field.createSpan({ cls: 'dynasty-sheet-label', text: T.yearLabel });
		const year = field.createEl('input', {
			cls: ['dynasty-sheet-input', 'dynasty-input', 'dynasty-succ-year'],
			attr: { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', inputmode: 'text', 'aria-label': T.yearLabel, 'data-focus': 'succ-year' },
		});
		year.value = d.year;
		shown = d.year;
		const refresh = () => {
			stop();
			if (shown === s().year) return;
			shown = s().year;
			drawLine(true);
			// The cadet hint is for the year of the line.
			if (ui && !s().body) patchBody(ui);
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
		hint(field, T.yearHint, 'year');
		// The note has a year that the plugin cannot read: the field is empty, and this hint names the text until the owner types a year.
		if (d.yearBad !== undefined) {
			const bad = field.createDiv({ cls: ['dynasty-sheet-hint'], text: T.yearBad(d.yearBad), attr: { 'data-hint': 'year-bad' } });
			if (d.year.trim() !== '') bad.hide();
			year.addEventListener('input', () => (year.value.trim() === '' ? bad.show() : bad.hide()));
		}

		// Children marked as illegitimate.
		const illPair = pair();
		illChoice(illPair);
		hint(illPair, hints.illegitimate, 'illegitimate');

		const switches = body.createDiv({ cls: 'dynasty-rows' });
		switchRow(switches, { key: 'adopted', label: T.adopted, hint: T.adoptedHint, on: d.adopted, set: (v) => change(() => void (d.adopted = v), 'succ-adopted') });
		const bodySwitch = real ? bodyRow(switches) : null;
		ui = { grid, rulePair, inheritPair, throughPair, yearPair, illPair, switches, bodyRow: bodySwitch };

		peopleList(body, 'heir');
		peopleList(body, 'exclude');
	}

	/** The lead of a person row: the initials, and the portrait when the copy comes. */
	function lead(row: HTMLElement, id: string): void {
		const p = host.g().byId.get(id);
		personLead(row, { name: p?.name ?? id, ...(p?.portrait ? { portrait: p.portrait } : {}), ...(p?.portraitCrop ? { portraitCrop: p.portraitCrop } : {}) }, pictures);
	}

	// ---------- named heirs and excluded people ----------

	function peopleList(body: HTMLElement, kind: 'heir' | 'exclude'): void {
		const d = s();
		const list = kind === 'heir' ? d.heirs : d.exclude;
		const title = host.row.name.trim() || T.heading;
		const panel = body.createDiv({ cls: ['dynasty-holder-panel', 'dynasty-succ-people'], attr: { 'data-succ': kind === 'heir' ? 'heirs' : 'exclude' } });
		panel.createDiv({ cls: ['dynasty-sub', 'dynasty-sheet-label'], text: kind === 'heir' ? T.heirsLabel : T.excludeLabel });
		panel.createDiv({ cls: ['dynasty-sheet-hint'], text: kind === 'heir' ? T.heirsHint : T.excludeHint });
		const rows = panel.createDiv({ cls: ['dynasty-rows', 'dynasty-holder-list'] });
		if (!list.length) rows.createDiv({ cls: ['dynasty-holder-none', 'dynasty-sheet-none'], text: kind === 'heir' ? T.heirsNone : T.excludeNone });
		const g = host.g();
		list.forEach((id, i) => {
			const inTree = g.byId.has(id);
			const who = nameOf(id);
			const r = buildRow(rows, {
				cls: inTree ? ['dynasty-holder-row'] : ['dynasty-holder-row', 'is-not-in-tree'],
				attr: { 'data-person': id },
				lead: inTree ? (row) => lead(row, id) : undefined,
			});
			if (inTree) {
				const name = r.title.createEl('button', { cls: 'dynasty-holder-name', attr: { type: 'button', 'aria-label': TITLES_UI.showCardLabel(who), 'data-focus': `succ-${kind}-name:${id}` } });
				name.createSpan({ cls: 'dynasty-holder-label', text: who });
				name.addEventListener('click', () => host.guard(() => host.showCard(id)));
			} else {
				r.title.createSpan({ cls: 'dynasty-holder-name', text: id });
				r.sub.createSpan({ cls: 'dynasty-holder-note', text: T.heirNotInTree });
			}
			for (const x of kind === 'heir' ? heirNotes(result, id, nameOf) : []) r.sub.parentElement?.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text: x.text, attr: { 'data-note': x.note } });
			const buttons = r.actions();
			buttons.addClass('dynasty-holder-buttons');
			const removeIt = () => {
				const at = list.indexOf(id);
				if (at < 0) return;
				const next = list[at + 1] ?? list[at - 1];
				change(() => void list.splice(at, 1), next !== undefined ? `succ-${kind}-remove:${next}` : `succ-${kind}-add`);
			};
			if (kind === 'heir') {
				const move = (dir: -1 | 1, cls: string, icon: string, aria: string) => {
					const to = i + dir;
					const btn = iconButton(
						buttons,
						icon,
						aria,
						() => {
							if (to < 0 || to >= list.length) return;
							const end = to === 0 || to === list.length - 1;
							change(() => void ([list[i], list[to]] = [list[to], list[i]]), end ? `succ-heir-${dir < 0 ? 'later' : 'earlier'}:${id}` : `succ-heir-${cls}:${id}`);
						},
						{ cls: ['dynasty-holder-move', `dynasty-succ-${cls}`], focus: `succ-heir-${cls}:${id}` },
					);
					btn.disabled = to < 0 || to >= list.length;
				};
				move(-1, 'earlier', 'arrow-up', T.moveEarlierLabel(who));
				move(1, 'later', 'arrow-down', T.moveLaterLabel(who));
			}
			iconButton(buttons, 'x', T.removeLabel(who), removeIt, { cls: 'dynasty-holder-remove', focus: `succ-${kind}-remove:${id}` });
		});
		textButton(
			panel.createDiv({ cls: 'dynasty-actions' }),
			['dynasty-btn', 'dynasty-succ-add'],
			kind === 'heir' ? T.addHeir : T.addExclude,
			() =>
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
						(e) => console.error('Crown and Kin: the picker failed', e),
					);
				}),
			{ icon: 'plus', label: kind === 'heir' ? T.addHeirLabel(title) : T.addExcludeLabel(title), focus: `succ-${kind}-add` },
		);
	}

	// ---------- the line ----------

	/** The text of a quiet note of the result (G.6), or null when the note has no text here. `body-skipped` is the hint of its switch. */
	function noteText(n: SuccessionNote): string | null {
		const p = n.params;
		const name = (id: string | string[] | undefined) => nameOf(String(id ?? ''));
		if (n.kind === 'order-from-note') return p.reason === 'same-year' ? T.orderFromNoteSameYear(name(p.a), name(p.b)) : T.orderFromNote(name(p.a), name(p.b));
		if (n.kind === 'order-contradiction') return T.orderContradiction((Array.isArray(p.people) ? p.people : [String(p.people ?? '')]).map(nameOf));
		if (n.kind === 'co-rulers-not-in-line') return T.coRulersNotInLine;
		if (n.kind === 'born-in-reign-no-from') return T.bornInReignNoFrom(name(p.parent));
		if (n.kind === 'through-spouse') return T.throughSpouseNote(name(p.holder), name(p.spouse));
		if (n.kind === 'died-no-year') return T.diedNoYear(name(p.person), String(p.year ?? ''));
		return null;
	}

	/** The heir after whose row a note stands: the last person of the note in the line (G.6); null when no row of the line has it. */
	function anchorOf(n: SuccessionNote, heirs: readonly string[]): string | null {
		const p = n.params;
		// A death date with no year: the note stands under the row of the person, if the line has one (`afterNotes` places the others).
		if (n.kind === 'died-no-year') return String(p.person ?? '');
		let ids: string[] = [];
		if (n.kind === 'order-from-note') ids = [String(p.b ?? '')];
		else if (n.kind === 'order-contradiction') ids = Array.isArray(p.people) ? p.people : [];
		else if (n.kind === 'born-in-reign-no-from') ids = heirs.filter((h) => host.g().byId.get(h)?.parents.some((l) => l.id === p.parent));
		const rows = heirs.filter((h) => ids.includes(h));
		return rows.length ? rows[rows.length - 1] : null;
	}

	function drawLine(recompute = true): void {
		const el = lineEl;
		if (!el) return;
		pictures.forget(el);
		el.empty();
		if (recompute) result = compute();
		const res = result;
		const d = s();
		// A new year can make a named heir dead or not born yet: the notes under the named heirs follow it.
		live?.setText(summary(res));
		summaries();
		const box = el.createDiv({ cls: ['dynasty-line-box', 'dynasty-succ-line'], attr: { role: 'region', 'aria-label': T.heading } });
		if (!res || res.kind === 'no-rule') {
			box.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-succ-msg'], text: T.noHeir, attr: { 'data-msg': 'no-rule' } });
			if (recompute) refreshStates();
			return;
		}
		const y = res.yearText;
		if (res.kind === 'bad-rule') {
			box.createDiv({ cls: 'dynasty-succ-msg', text: T.badRule, attr: { 'data-msg': 'bad-rule' } });
			return;
		}
		if (res.kind === 'no-ruler') {
			box.createDiv({ cls: 'dynasty-succ-msg', text: T.noRuler(y), attr: { 'data-msg': 'no-ruler' } });
			if (recompute) refreshStates();
			return;
		}
		if (res.kind === 'ruler-not-in-tree') {
			box.createDiv({ cls: 'dynasty-succ-msg', text: T.rulerNotInTree(y), attr: { 'data-msg': 'ruler-not-in-tree' } });
			if (recompute) refreshStates();
			return;
		}
		const g = host.g();
		const ruler = res.ruler ?? '';
		const head = box.createDiv({ cls: 'dynasty-line-head' });
		head.createEl('b', { cls: 'dynasty-succ-heading', text: T.lineAfter(rulerLabel(ruler, res.year), y), attr: { role: 'heading', 'aria-level': '3' } });
		// Show works for a line, also an empty one (E.4).
		textButton(head, ['dynasty-btn', 'dynasty-succ-show'], T.show, () => host.guard(() => host.show()), { icon: 'eye', label: T.showLabel, focus: 'succ-show' });
		const note = (parent: HTMLElement, text: string, name: string, warn = false) => {
			// A warning is a quiet roman text line in the text colour (D218 item 4), with no sign (quiet-warnings): the words carry the warning.
			parent.createDiv({ cls: warn ? ['dynasty-succ-note', 'is-warning'] : ['dynasty-succ-note'], attr: { 'data-note': name }, text });
		};
		const notes = res.notes.map((n) => ({ n, text: noteText(n) })).filter((x): x is { n: SuccessionNote; text: string } => x.text !== null);
		// The holder who holds through the spouse comes first, then the other holders; each note that belongs to a row stands under that row.
		for (const x of notes) if (x.n.kind === 'through-spouse') note(box, x.text, x.n.kind);
		if (res.coRulers.length) note(box, T.coRulers(res.coRulers.length + 1, rulerLabel(ruler, res.year), y), 'co-rulers');
		for (const x of notes) if (x.n.kind === 'co-rulers-not-in-line') note(box, x.text, x.n.kind);
		for (const n of res.noYear) {
			if (n.what !== 'reign') continue;
			const entry = n.entry === undefined ? undefined : host.row.holders[n.entry];
			note(box, T.noYearReign(entry ? holderText(g, entry.values).ruler : nameOf(n.id)), 'no-year-reign', true);
		}
		if (d.through !== '' && d.through !== '?' && ruler && g.byId.has(ruler) && !g.byId.get(ruler)?.sex) note(box, T.rulerNoSex(nameOf(ruler)), 'ruler-no-sex', true);
		if (res.leftOutNoSex > 0) note(box, T.leftOutNoSex(res.leftOutNoSex), 'no-sex', true);
		if (res.noBirthYear > 0) note(box, T.noBirthYear(res.noBirthYear), 'no-birth-year', true);
		if (res.outsideBody) note(box, T.outsideBody(rulerLabel(ruler, res.year), firstInfo(host.g(), host.row)?.name ?? ''), 'outside-body', true);
		const list = box.createDiv({ cls: ['dynasty-rows', 'dynasty-succ-list'], attr: { role: 'list' } });
		// M.2, M.3: a grey row stands before the heir at its `before` place (after that many heirs); the rows that remain stand after the last heir.
		let nextBranch = 0;
		const branches = (upTo: number) => {
			while (nextBranch < res.openBranches.length && res.openBranches[nextBranch].before <= upTo) {
				const id = res.openBranches[nextBranch++].id;
				branchRow(list, id);
				for (const x of under.get(id) ?? []) note(list, x.text, x.n.kind);
			}
		};
		const under = new Map<string, { n: SuccessionNote; text: string }[]>();
		for (const x of notes) {
			const at = anchorOf(x.n, res.heirs);
			if (at !== null) under.set(at, [...(under.get(at) ?? []), x]);
		}
		res.heirs.forEach((id, i) => {
			branches(i);
			const ord = ordinal(i + 1);
			const open = (): void => (host.openPerson ? host.openPerson(id) : host.showCard(id));
			const r = buildRow(list, {
				ord,
				tap: () => host.guard(open),
				label: T.lineRowLabel(nameOf(id), ord),
				cls: 'dynasty-succ-item',
				attr: { role: 'listitem', 'data-person': id, 'data-focus': `succ-line:${id}` },
				chevron: false,
				lead: (row) => lead(row, id),
			});
			r.title.createSpan({ cls: 'dynasty-holder-label', text: nameOf(id) });
			const p = g.byId.get(id);
			const dates = p ? dateLine(p, g.dates) : '';
			if (dates) r.sub.setText(dates);
			const sub = (text: string, kind: string, warn: boolean) => {
				r.row.parentElement?.createDiv({ cls: warn ? ['dynasty-succ-subnote', 'is-warning'] : ['dynasty-succ-subnote'], attr: { 'data-note': kind }, text });
			};
			if (res.old.includes(id)) sub(T.old(nameOf(id), host.oldAge(), y), 'old', true);
			if (res.noYear.some((n) => n.id === id && n.what === 'born')) sub(T.noYearDate(nameOf(id)), 'no-year', true);
			for (const x of under.get(id) ?? []) note(list, x.text, x.n.kind);
		});
		branches(Infinity);
		for (const x of afterNotes(res, g, under, nameOf, host.row.name)) note(list, x.text, x.kind);
		if (!res.heirs.length && !res.outsideBody) box.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-succ-msg'], text: T.noHeir, attr: { 'data-msg': 'no-heir' } });
		if (res.more) box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-succ-more'], text: T.more });
		if (res.moreBranches) box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-succ-more', 'dynasty-succ-more-branches'], text: T.moreBranches });
		if (res.openBranches.length) box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-succ-branch-note'], text: T.branchNote, attr: { 'data-hint': 'branch-note' } });
		if (recompute) refreshStates();
	}

	/** A grey row of the line (M.8): a person who died and has no children in the tree. The row taps like a name and uses no place. */
	function branchRow(list: HTMLElement, id: string): void {
		const p = host.g().byId.get(id);
		const text = T.branchRow(nameOf(id), p?.died ?? '');
		const r = buildRow(list, {
			ord: T.branchMark,
			tap: () => host.guard(() => host.showCard(id)),
			label: T.branchRowLabel(text),
			cls: ['dynasty-succ-branch', 'is-open-branch'],
			attr: { role: 'listitem', 'data-person': id, 'data-branch': 'open', 'data-focus': `succ-branch:${id}` },
			chevron: false,
		});
		r.title.createSpan({ cls: 'dynasty-holder-label', text });
	}

	/** The notes under the named heirs follow the line (a new year can make a named heir dead or not born yet). */
	function refreshStates(): void {
		const res = result;
		const body = rulesEl;
		if (!body) return;
		for (const row of Array.from(body.querySelectorAll('[data-succ="heirs"] .dynasty-holder-row'))) {
			const id = row.getAttribute('data-person') ?? '';
			const words = row.querySelector('.dynasty-row-text');
			if (!words) continue;
			for (const n of Array.from(words.querySelectorAll('[data-note]'))) n.remove();
			for (const x of heirNotes(res, id, nameOf)) words.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text: x.text, attr: { 'data-note': x.note } });
		}
	}

	const rulerLabel = (id: string, year: number | null) => rulerLabelOf(host.g(), host.row.holders, id, year, nameOf(id));

	result = compute();
	return {
		draw,
		rulesOpened(open) {
			if (open === rulesOpen) return;
			rulesOpen = open;
			// A section that opens gets its cadet hint now; the one that closes keeps the page as it is.
			if (open && ui) host.guard(() => patchBody(ui!));
		},
		result: () => result,
		renderLine(parent) {
			live = parent.createDiv({ cls: 'dynasty-succ-live', attr: { 'aria-live': 'polite', 'data-succ': 'summary' } });
			lineEl = parent.createDiv({ cls: 'dynasty-succ-linebody' });
			drawLine(false);
		},
		renderRules(parent) {
			rulesEl = parent;
			drawRules(parent);
		},
		lineSummary,
		rulesSummary: () => rulesSummary(s()),
		dispose: () => {
			stop();
			pictures.release();
		},
	};
}
