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
import { successionLine, type NamedHeirState, type SuccessionNote, type SuccessionResult } from '../core/succession';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES, ordinal, yearOf, type InheritIllegitimate } from '../core/succession-keys';
import { dateLine } from '../render/tree-info';
import { SUCCESSION_UI as T, TITLES_UI } from '../render/ui-text';
import { draftSpec, draftTitle, holderText, type SuccessionDraft, type TitleRow } from './titles-draft';
import { RowPictures, buildRow, iconButton, personLead, textButton } from './window-parts';
import type { PictureStore } from './picture-store';

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

/** A name of a rule without the technical term in brackets: "Eldest child first (primogeniture)" reads "Eldest child first". */
const short = (text: string): string => text.replace(/\s*\(.*\)$/, '');

/** The summary of the rules for a draft (contract C): the rule and who can inherit, without the terms; "None" for no rule. */
export function rulesSummary(s: SuccessionDraft): string {
	const rule = s.rule === '' ? T.ruleNone : s.rule === UNKNOWN ? T.unknownValue(null) : short(T.rules[s.rule]);
	const inherit = s.rule === '' || s.rule === UNKNOWN ? '' : s.inherit === '' ? short(T.inherits['no-preference']) : s.inherit === UNKNOWN ? T.unknownValue(null) : short(T.inherits[s.inherit]);
	return [rule, inherit].filter(Boolean).join(' · ');
}

/** Makes the succession view of a saved title; the window puts `renderLine` and `renderRules` in its two sections. */
export function successionSection(host: SectionHost): SuccessionView {
	const s = () => host.row.succ!;
	const pictures = new RowPictures(host.pictures, host.sourcePath ?? '');
	let rulesEl: HTMLElement | null = null;
	let lineEl: HTMLElement | null = null;
	let result: SuccessionResult | null = null;
	let timer: number | null = null;
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
		for (const [value, text] of options) sel.createEl('option', { text, attr: { value } });
		sel.value = o.value;
		setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		sel.addEventListener('change', () => {
			if (sel.value !== UNKNOWN) o.pick(sel.value);
		});
	}

	const hint = (box: HTMLElement, text: string | null, name: string) => {
		if (text) box.createDiv({ cls: ['dynasty-sheet-hint'], text, attr: { 'data-hint': name } });
	};

	/** A switch with its label and an optional hint: one row (`dynasty-rule`), the switch at the right. */
	function switchRow(box: HTMLElement, o: { key: string; label: string; hint: string; on: boolean; set: (v: boolean) => void }): void {
		const pair = box.createDiv({ cls: 'dynasty-succ-pair', attr: { 'data-succ': o.key } });
		const row = pair.createEl('label', { cls: ['dynasty-succ-switch', 'dynasty-rule'] });
		const text = row.createSpan({ cls: 'dynasty-rule-text' });
		text.createSpan({ cls: 'dynasty-succ-switch-text', text: o.label });
		const track = row.createDiv({ cls: o.on ? ['checkbox-container', 'is-enabled'] : ['checkbox-container'] });
		const input = track.createEl('input', { attr: { type: 'checkbox', role: 'switch', 'aria-label': o.label, 'data-focus': `succ-${o.key}` } });
		input.checked = o.on;
		input.addEventListener('change', () => o.set(input.checked));
		if (o.hint) pair.createDiv({ cls: ['dynasty-sheet-hint'], text: o.hint });
	}

	// ---------- the whole view ----------

	function draw(focus?: string): void {
		const mounted = rulesEl ?? lineEl;
		const doc = mounted?.doc;
		const had = focus ?? (doc?.activeElement && mounted?.contains(doc.activeElement as HTMLElement) ? (doc.activeElement as HTMLElement).getAttribute('data-focus') : null);
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
				}, 'succ-rule'),
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
				pick: (v) => change(() => void (d.inherit = v as SuccessionDraft['inherit']), 'succ-inherit'),
			});
			for (const h of hints.inherit) hint(box, h, 'inherit');
			box = pair();
			choice(box, {
				key: 'through',
				label: T.throughLabel,
				value: d.through,
				unknown: badText('inherit-through'),
				options: [['', T.throughSame], ...INHERIT_THROUGH.map((r): [string, string] => [r, T.throughs[r]])],
				pick: (v) => change(() => void (d.through = v as SuccessionDraft['through']), 'succ-through'),
			});
			hint(box, hints.through, 'through');
		}

		// Year. The field changes the draft at once; the line follows on blur and 300 ms after the last key press.
		box = pair();
		const field = box.createEl('label', { cls: 'dynasty-sheet-field', attr: { 'data-succ': 'year' } });
		field.createSpan({ cls: 'dynasty-sheet-label', text: T.yearLabel });
		const year = field.createEl('input', {
			cls: ['dynasty-sheet-input', 'dynasty-input', 'dynasty-succ-year'],
			attr: { type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', inputmode: 'numeric', 'aria-label': T.yearLabel, 'data-focus': 'succ-year' },
		});
		year.value = d.year;
		let shown = d.year;
		const refresh = () => {
			stop();
			if (shown === s().year) return;
			shown = s().year;
			drawLine(true);
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
		box = pair();
		choice(box, {
			key: 'illegitimate',
			label: T.illLabel,
			value: d.illegitimate,
			unknown: badText('inherit-illegitimate'),
			options: INHERIT_ILLEGITIMATE.map((r): [string, string] => [r, T.ills[r]]),
			pick: (v) => change(() => void (d.illegitimate = v as InheritIllegitimate), 'succ-illegitimate'),
			wide: true,
		});
		if (hints.illegitimate) hint(box, T.illHint, 'illegitimate');

		const switches = body.createDiv({ cls: 'dynasty-rows' });
		switchRow(switches, { key: 'adopted', label: T.adopted, hint: T.adoptedHint, on: d.adopted, set: (v) => change(() => void (d.adopted = v), 'succ-adopted') });
		if (real) {
			const first = firstHolder();
			const skipped = result?.notes.find((n) => n.kind === 'body-skipped');
			// F-KIN-07: the first entry has a name only, so the hint says which holder the plugin uses instead.
			const bodyHint = skipped ? T.bodyHintSkipped(nameOf(String(skipped.params.first)), String(skipped.params.entry)) : first ? T.bodyHint(first) : '';
			switchRow(switches, { key: 'body', label: T.body, hint: bodyHint, on: d.body, set: (v) => change(() => void (d.body = v), 'succ-body') });
		}

		peopleList(body, 'heir');
		peopleList(body, 'exclude');
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
			const state = kind === 'heir' ? result?.namedHeirs.find((h) => h.id === id)?.state : undefined;
			const text = state ? stateText(state, id) : null;
			const text2 = r.sub.parentElement;
			if (text) text2?.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text, attr: { 'data-note': state ?? '' } });
			const born = result?.noYear.find((n) => n.id === id && n.what === 'born');
			if (kind === 'heir' && born) text2?.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text: T.noYearDate(who), attr: { 'data-note': 'no-year' } });
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
						(e) => console.error('Dynasty Tree: the picker failed', e),
					);
				}),
			{ icon: 'plus', label: kind === 'heir' ? T.addHeirLabel(title) : T.addExcludeLabel(title), focus: `succ-${kind}-add` },
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

	/** The text of a quiet note of the result (G.6), or null when the note has no text here. `body-skipped` is the hint of its switch. */
	function noteText(n: SuccessionNote): string | null {
		const p = n.params;
		const name = (id: string | string[] | undefined) => nameOf(String(id ?? ''));
		if (n.kind === 'order-from-note') return p.reason === 'same-year' ? T.orderFromNoteSameYear(name(p.a), name(p.b)) : T.orderFromNote(name(p.a), name(p.b));
		if (n.kind === 'order-contradiction') return T.orderContradiction((Array.isArray(p.people) ? p.people : [String(p.people ?? '')]).map(nameOf));
		if (n.kind === 'co-rulers-not-in-line') return T.coRulersNotInLine;
		if (n.kind === 'born-in-reign-no-from') return T.bornInReignNoFrom(name(p.parent));
		if (n.kind === 'through-spouse') return T.throughSpouseNote(name(p.holder), name(p.spouse));
		return null;
	}

	/** The heir after whose row a note stands: the last person of the note in the line (G.6); null when no row of the line has it. */
	function anchorOf(n: SuccessionNote, heirs: readonly string[]): string | null {
		const p = n.params;
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
		const y = res.year;
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
		head.createEl('b', { cls: 'dynasty-succ-heading', text: T.lineAfter(rulerLabel(ruler, y), y), attr: { role: 'heading', 'aria-level': '3' } });
		// Show works for a line, also an empty one (E.4).
		textButton(head, ['dynasty-btn', 'dynasty-succ-show'], T.show, () => host.guard(() => host.show()), { icon: 'eye', label: T.showLabel, focus: 'succ-show' });
		const note = (parent: HTMLElement, text: string, name: string, warn = false) => {
			// A warning is a quiet roman text line in the text colour (D218 item 4), with no sign (quiet-warnings): the words carry the warning.
			parent.createDiv({ cls: warn ? ['dynasty-succ-note', 'is-warning'] : ['dynasty-succ-note'], attr: { 'data-note': name }, text });
		};
		const notes = res.notes.map((n) => ({ n, text: noteText(n) })).filter((x): x is { n: SuccessionNote; text: string } => x.text !== null);
		// The holder who holds through the spouse comes first, then the other holders; each note that belongs to a row stands under that row.
		for (const x of notes) if (x.n.kind === 'through-spouse') note(box, x.text, x.n.kind);
		if (res.coRulers.length) note(box, T.coRulers(res.coRulers.length + 1, rulerLabel(ruler, y), y), 'co-rulers');
		for (const x of notes) if (x.n.kind === 'co-rulers-not-in-line') note(box, x.text, x.n.kind);
		for (const n of res.noYear) {
			if (n.what !== 'reign') continue;
			const entry = n.entry === undefined ? undefined : host.row.holders[n.entry];
			note(box, T.noYearReign(entry ? holderText(g, entry.values).ruler : nameOf(n.id)), 'no-year-reign', true);
		}
		if (d.through !== '' && d.through !== '?' && ruler && g.byId.has(ruler) && !g.byId.get(ruler)?.sex) note(box, T.rulerNoSex(nameOf(ruler)), 'ruler-no-sex', true);
		if (res.leftOutNoSex > 0) note(box, T.leftOutNoSex(res.leftOutNoSex), 'no-sex', true);
		if (res.noBirthYear > 0) note(box, T.noBirthYear(res.noBirthYear), 'no-birth-year', true);
		if (res.outsideBody) note(box, T.outsideBody(rulerLabel(ruler, y), firstHolder() ?? ''), 'outside-body', true);
		const list = box.createDiv({ cls: ['dynasty-rows', 'dynasty-succ-list'], attr: { role: 'list' } });
		// M.2, M.3: a grey row stands before the heir at its `before` place (after that many heirs); the rows that remain stand after the last heir.
		let nextBranch = 0;
		const branches = (upTo: number) => {
			while (nextBranch < res.openBranches.length && res.openBranches[nextBranch].before <= upTo) branchRow(list, res.openBranches[nextBranch++].id);
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
			const dates = p ? dateLine(p) : '';
			if (dates) r.sub.setText(dates);
			const sub = (text: string, kind: string, warn: boolean) => {
				r.row.parentElement?.createDiv({ cls: warn ? ['dynasty-succ-subnote', 'is-warning'] : ['dynasty-succ-subnote'], attr: { 'data-note': kind }, text });
			};
			if (res.old.includes(id)) sub(T.old(nameOf(id), host.oldAge(), y), 'old', true);
			if (res.noYear.some((n) => n.id === id && n.what === 'born')) sub(T.noYearDate(nameOf(id)), 'no-year', true);
			for (const x of under.get(id) ?? []) note(list, x.text, x.n.kind);
		});
		branches(Infinity);
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
			const state = res?.namedHeirs.find((h) => h.id === id)?.state;
			const text = state ? stateText(state, id) : null;
			if (text) words.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text, attr: { 'data-note': state ?? '' } });
			if (res?.noYear.some((n) => n.id === id && n.what === 'born')) words.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text: T.noYearDate(nameOf(id)), attr: { 'data-note': 'no-year' } });
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

	result = compute();
	return {
		draw,
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
