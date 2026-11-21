/*
 * The body of the section "Rules of succession" in the Titles window: the choices (rule, who can inherit, inherit through, children
 * marked as illegitimate), the year field, the switches and the hints under them. A choice changes the draft and asks for an
 * in-place redraw; only the parts that depend on it change (`patchRules`). The two people lists at the end come from
 * `succession-people-ui.ts`. Part of the split of `succession-section.ts`; no text and no behaviour changed.
 */

import { setIcon } from 'obsidian';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES, type InheritIllegitimate } from '../core/succession-keys';
import { afterPress } from '../render/dom/press-hold';
import { SUCCESSION_UI as T } from '../render/ui-text';
import type { SuccessionDraft } from '../view/titles-draft';
import { bodyHints, illegitimateHint } from './body-hint';
import { setRowHints, switchRow } from './switch-row';
import { peopleList } from './succession-people-ui';
import { drawLine } from './succession-line-ui';
import { badText, change, changeInPlace, stopTimer, type RulesUi, type SectionState } from './succession-state-ui';

/** The draft value for a written value that the plugin cannot read. */
const UNKNOWN = '?';
/** The year field recomputes the line this long after the last key press. */
const YEAR_MS = 300;

/** The hints of the section for a draft. Pure, so a test can read them without a window. */
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

/** The summary of the rules for a draft: the rule and who can inherit, without the terms; "None" for no rule. */
export function rulesSummary(s: SuccessionDraft): string {
	const rule = s.rule === '' ? T.ruleNone : s.rule === UNKNOWN ? T.unknownValue(null) : short(T.rules[s.rule]);
	const inherit = s.rule === '' || s.rule === UNKNOWN ? '' : s.inherit === '' ? short(T.inherits['no-preference']) : s.inherit === UNKNOWN ? T.unknownValue(null) : short(T.inherits[s.inherit]);
	return [rule, inherit].filter(Boolean).join(' · ');
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

// ---------- choices: one dropdown; on a phone it opens the phone's own list ----------

interface ChoiceSpec {
	key: string;
	label: string;
	value: string;
	options: [string, string][];
	pick: (v: string) => void;
	unknown?: string | null;
	wide?: boolean;
}

function choice(box: HTMLElement, o: ChoiceSpec): void {
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

// The four choices of the rules body. Each one reads the draft when it is made.
function ruleChoice(st: SectionState, box: HTMLElement): void {
	const d = st.s();
	const real = d.rule !== '' && d.rule !== '?';
	choice(box, {
		key: 'rule',
		label: T.ruleLabel,
		value: d.rule === UNKNOWN ? UNKNOWN : real ? d.rule : '',
		unknown: badText(st, 'succession'),
		options: [['', T.ruleNone], ...SUCCESSION_RULES.map((r): [string, string] => [r, T.rules[r]])],
		// Choosing None removes the rule and the choice of who can inherit.
		pick: (v) =>
			changeInPlace(st, () => {
				d.rule = v as SuccessionDraft['rule'];
				if (v === '') d.inherit = '';
			}),
	});
}

function inheritChoice(st: SectionState, box: HTMLElement): void {
	const d = st.s();
	// An unwritten key shows as "No preference".
	choice(box, {
		key: 'inherit',
		label: T.inheritLabel,
		value: d.inherit === '' ? 'no-preference' : d.inherit,
		unknown: badText(st, 'inherit'),
		options: INHERIT_RULES.map((r): [string, string] => [r, T.inherits[r]]),
		pick: (v) => changeInPlace(st, () => void (d.inherit = v as SuccessionDraft['inherit'])),
	});
}

function throughChoice(st: SectionState, box: HTMLElement): void {
	const d = st.s();
	choice(box, {
		key: 'through',
		label: T.throughLabel,
		value: d.through,
		unknown: badText(st, 'inherit-through'),
		options: [['', T.throughSame], ...INHERIT_THROUGH.map((r): [string, string] => [r, T.throughs[r]])],
		pick: (v) => changeInPlace(st, () => void (d.through = v as SuccessionDraft['through'])),
	});
}

function illChoice(st: SectionState, box: HTMLElement): void {
	const d = st.s();
	choice(box, {
		key: 'illegitimate',
		label: T.illLabel,
		value: d.illegitimate,
		unknown: badText(st, 'inherit-illegitimate'),
		options: INHERIT_ILLEGITIMATE.map((r): [string, string] => [r, T.ills[r]]),
		pick: (v) => changeInPlace(st, () => void (d.illegitimate = v as InheritIllegitimate)),
		wide: true,
	});
}

/** The switch "body" with the hints that name the first holder and the cadet title (D291). */
function bodyRow(st: SectionState, switches: HTMLElement): HTMLElement {
	const d = st.s();
	const { hint, extra } = bodyHints(st.host.g(), st.host.row, d, st.result, st.rulesOpen);
	return switchRow(switches, { key: 'body', label: T.body, hint, extra, on: d.body, set: (v) => change(st, () => void (d.body = v), 'succ-body') });
}

/** The row of the switch stays; only its hint spans follow the line (a year commit or a choice must not replace the switch under a finger). */
export function patchBody(st: SectionState, u: RulesUi): void {
	const real = st.s().rule !== '' && st.s().rule !== '?';
	if (!real) {
		u.bodyRow?.remove();
		u.bodyRow = null;
		return;
	}
	if (!u.bodyRow) {
		u.bodyRow = bodyRow(st, u.switches);
		return;
	}
	const { hint, extra } = bodyHints(st.host.g(), st.host.row, st.s(), st.result, st.rulesOpen);
	setRowHints(u.bodyRow, 'body', { first: hint, cadet: extra });
}

/** What follows a choice: only the parts of the rules body that depend on it change, and no dropdown is made again. */
export function patchRules(st: SectionState, u: RulesUi): void {
	const d = st.s();
	const hints = successionHints(d);
	const real = d.rule !== '' && d.rule !== '?';
	setHints(u.rulePair, 'rule', hints.rule ? [hints.rule] : []);
	if (real) {
		if (!u.inheritPair || !u.throughPair) {
			u.inheritPair = pairBefore(u, u.yearPair);
			inheritChoice(st, u.inheritPair);
			u.throughPair = pairBefore(u, u.yearPair);
			throughChoice(st, u.throughPair);
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
	patchBody(st, u);
}

/** The year field. It changes the draft at once; the line follows on blur and 300 ms after the last key press. */
function yearField(st: SectionState, pair: HTMLElement): void {
	const host = st.host;
	const d = st.s();
	const field = pair.createEl('label', { cls: 'dynasty-sheet-field', attr: { 'data-succ': 'year' } });
	field.createSpan({ cls: 'dynasty-sheet-label', text: T.yearLabel });
	const year = field.createEl('input', {
		cls: ['dynasty-sheet-input', 'dynasty-input', 'dynasty-succ-year'],
		attr: { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', inputmode: 'text', 'aria-label': T.yearLabel, 'data-focus': 'succ-year' },
	});
	year.value = d.year;
	st.shown = d.year;
	const refresh = () => {
		stopTimer(st);
		if (st.shown === st.s().year) return;
		st.shown = st.s().year;
		drawLine(st, true);
		// The cadet hint is for the year of the line.
		if (st.ui && !st.s().body) patchBody(st, st.ui);
	};
	year.addEventListener('input', () =>
		host.guard(() => {
			st.s().year = year.value;
			host.edited();
			stopTimer(st);
			// The same key as the blur: a press under way holds the new line back, so the buttons do not move before the click.
			st.timer = host.win().setTimeout(() => afterPress(year, year, () => host.guard(refresh)), YEAR_MS);
		}),
	);
	year.addEventListener('blur', () => afterPress(year, year, () => host.guard(refresh)));
	year.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
			e.preventDefault();
			year.blur();
		}
	});
	hint(field, T.yearHint, 'year');
	// The note has a year that the plugin cannot read: the field is empty, and this hint names the text until the user types a year.
	if (d.yearBad !== undefined) {
		const bad = field.createDiv({ cls: ['dynasty-sheet-hint'], text: T.yearBad(d.yearBad), attr: { 'data-hint': 'year-bad' } });
		if (d.year.trim() !== '') bad.hide();
		year.addEventListener('input', () => (year.value.trim() === '' ? bad.show() : bad.hide()));
	}
}

/** The rules: the choices, the year, the switches, the named heirs and the excluded people. */
export function drawRules(st: SectionState, body: HTMLElement): void {
	// The people lists inside are drawn again: their pictures go back to the store first.
	st.pictures.forget(body);
	body.empty();
	const d = st.s();
	const hints = successionHints(d);
	const real = d.rule !== '' && d.rule !== '?';

	const grid = body.createDiv({ cls: ['dynasty-grid', 'is-stack'] });
	const pair = () => grid.createDiv({ cls: ['dynasty-succ-pair', 'is-wide'] });
	const rulePair = pair();
	ruleChoice(st, rulePair);
	hint(rulePair, hints.rule, 'rule');
	let inheritPair: HTMLElement | null = null;
	let throughPair: HTMLElement | null = null;
	if (real) {
		inheritPair = pair();
		inheritChoice(st, inheritPair);
		for (const h of hints.inherit) hint(inheritPair, h, 'inherit');
		throughPair = pair();
		throughChoice(st, throughPair);
		hint(throughPair, hints.through, 'through');
	}
	const yearPair = pair();
	yearField(st, yearPair);

	// Children marked as illegitimate.
	const illPair = pair();
	illChoice(st, illPair);
	hint(illPair, hints.illegitimate, 'illegitimate');

	const switches = body.createDiv({ cls: 'dynasty-rows' });
	switchRow(switches, { key: 'adopted', label: T.adopted, hint: T.adoptedHint, on: d.adopted, set: (v) => change(st, () => void (d.adopted = v), 'succ-adopted') });
	const bodySwitch = real ? bodyRow(st, switches) : null;
	st.ui = { grid, rulePair, inheritPair, throughPair, yearPair, illPair, switches, bodyRow: bodySwitch };

	peopleList(st, body, 'heir');
	peopleList(st, body, 'exclude');
}
