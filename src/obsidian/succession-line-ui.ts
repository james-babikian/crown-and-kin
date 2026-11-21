/*
 * The body of the section "Line of succession" in the Titles window: the line that the draft gives (the heir rows, the grey rows
 * of open branches, the quiet notes), the button Show and the sentence for a screen reader. `drawLine` makes the body again from
 * `st.result`. Part of the split of `succession-section.ts`; no text and no behaviour changed.
 */

import { ordinal } from '../core/succession-keys';
import type { SuccessionNote, SuccessionResult } from '../core/succession';
import { dateLineShown, isolateDate, isolateName, withoutBidiControls } from '../render/tree-info';
import { SUCCESSION_UI as T } from '../render/ui-text';
import { draftSpec, holderLead, holderText } from '../view/titles-draft';
import { afterNotes, bornDateUnread } from '../view/succession-notes';
import { firstInfo } from './body-hint';
import { firstHeirNote, quietNote as note } from './first-heir-note';
import { buildRow, textButton } from './window-parts';
import { compute, type SectionState } from './succession-state-ui';
import { lead, refreshStates } from './succession-people-ui';

/** A quiet note of the result with its text. */
type TextNote = { n: SuccessionNote; text: string };

/** The one sentence for the live region: how many heirs the line has, or why it has none. */
function summary(res: SuccessionResult | null): string {
	if (!res || res.kind === 'no-rule') return '';
	if (res.kind === 'bad-rule') return T.badRule;
	if (res.kind === 'no-ruler') return T.noRuler(res.yearText);
	if (res.kind === 'ruler-not-in-tree') return T.rulerNotInTree(res.yearText);
	return res.heirs.length ? T.heirCount(res.heirs.length) : T.noHeir;
}

/** The one text line under the title of the closed section "Line of succession": "1st Aldric · 2nd Bran". */
export function lineSummary(st: SectionState): string {
	const res = st.result;
	if (!res || res.kind !== 'line' || !res.heirs.length) return T.noHeir;
	return res.heirs
		.slice(0, 2)
		.map((id, i) => `${ordinal(i + 1)} ${isolateName(st.nameOf(id))}`)
		.join(' · ');
}

/** The text of a quiet note of the result, or null when the note has no text here. `body-skipped` is the hint of its switch. */
function noteText(st: SectionState, n: SuccessionNote): string | null {
	const p = n.params;
	const name = (id: string | string[] | undefined) => st.nameOf(String(id ?? ''));
	if (n.kind === 'order-from-note') return p.reason === 'same-year' ? T.orderFromNoteSameYear(name(p.a), name(p.b)) : T.orderFromNote(name(p.a), name(p.b));
	if (n.kind === 'order-contradiction') return T.orderContradiction((Array.isArray(p.people) ? p.people : [String(p.people ?? '')]).map(st.nameOf));
	if (n.kind === 'co-rulers-not-in-line') return T.coRulersNotInLine;
	if (n.kind === 'born-in-reign-no-from') return T.bornInReignNoFrom(name(p.parent));
	if (n.kind === 'through-spouse') return T.throughSpouseNote(name(p.holder), name(p.spouse));
	if (n.kind === 'died-no-year') return T.diedNoYear(name(p.person), String(p.year ?? ''));
	return null;
}

/** The heir after whose row a note stands: the last person of the note in the line; null when no row of the line has it. */
function anchorOf(st: SectionState, n: SuccessionNote, heirs: readonly string[]): string | null {
	const p = n.params;
	// A death date with no year: the note stands under the row of the person, if the line has one (`afterNotes` places the others).
	if (n.kind === 'died-no-year') return String(p.person ?? '');
	let ids: string[] = [];
	if (n.kind === 'order-from-note') ids = [String(p.b ?? '')];
	else if (n.kind === 'order-contradiction') ids = Array.isArray(p.people) ? p.people : [];
	else if (n.kind === 'born-in-reign-no-from') ids = heirs.filter((h) => st.host.g().byId.get(h)?.parents.some((l) => l.id === p.parent));
	const rows = heirs.filter((h) => ids.includes(h));
	return rows.length ? rows[rows.length - 1] : null;
}

/** A grey row of the line: a person who died and has no children in the tree. The row taps like a name and uses no place. The spoken name has the same words with no isolate controls. */
function branchRow(st: SectionState, list: HTMLElement, id: string): void {
	const p = st.host.g().byId.get(id);
	const text = T.branchRow(st.nameOf(id), isolateDate(p?.died ?? ''));
	const r = buildRow(list, {
		ord: T.branchMark,
		tap: () => st.host.guard(() => st.host.showCard(id)),
		label: T.branchRowLabel(withoutBidiControls(text)),
		cls: ['dynasty-succ-branch', 'is-open-branch'],
		attr: { role: 'listitem', 'data-person': id, 'data-branch': 'open', 'data-focus': `succ-branch:${id}` },
		chevron: false,
	});
	r.title.createSpan({ cls: 'dynasty-holder-label', text });
}

/** The notes above the list: the holder who holds through the spouse, the co-rulers, the first heir and the date warnings. */
function notesAbove(st: SectionState, box: HTMLElement, res: SuccessionResult, notes: TextNote[]): void {
	const host = st.host;
	const g = host.g();
	const ruler = res.ruler ?? '';
	// The holder who holds through the spouse comes first, then the other holders; each note that belongs to a row stands under that row.
	for (const x of notes) if (x.n.kind === 'through-spouse') note(box, x.text, x.n.kind);
	if (res.coRulers.length) note(box, T.coRulers(res.coRulers.length + 1, st.rulerLabel(ruler, res.year), res.yearText), 'co-rulers');
	for (const x of notes) if (x.n.kind === 'co-rulers-not-in-line') note(box, x.text, x.n.kind);
	firstHeirNote(box, { g, res, spec: draftSpec(st.s()), options: host.relationOptions?.(), nameOf: st.nameOf, rulerLabel: (id) => (id === ruler ? st.rulerLabel(id, res.year) : st.nameOf(id)) });
	for (const n of res.noYear) {
		if (n.what !== 'reign') continue;
		const entry = n.entry === undefined ? undefined : host.row.holders[n.entry];
		note(box, T.noYearReign(entry ? holderLead(holderText(g, entry.values), entry.values) : st.nameOf(n.id)), 'no-year-reign', true);
	}
	if (st.s().through !== '' && st.s().through !== '?' && ruler && g.byId.has(ruler) && !g.byId.get(ruler)?.sex) note(box, T.rulerNoSex(st.nameOf(ruler)), 'ruler-no-sex', true);
	if (res.leftOutNoSex > 0) note(box, T.leftOutNoSex(res.leftOutNoSex), 'no-sex', true);
	if (res.noBirthYear > 0) note(box, T.noBirthYear(res.noBirthYear), 'no-birth-year', true);
	if (res.outsideBody) note(box, T.outsideBody(st.rulerLabel(ruler, res.year), firstInfo(g, host.row)?.lead ?? ''), 'outside-body', true);
}

/** The rows of the heirs and of the open branches, each with the notes that stand under it. */
function heirRows(st: SectionState, box: HTMLElement, res: SuccessionResult, notes: TextNote[]): void {
	const host = st.host;
	const g = host.g();
	const y = res.yearText;
	const list = box.createDiv({ cls: ['dynasty-rows', 'dynasty-succ-list'], attr: { role: 'list' } });
	const under = new Map<string, TextNote[]>();
	for (const x of notes) {
		const at = anchorOf(st, x.n, res.heirs);
		if (at !== null) under.set(at, [...(under.get(at) ?? []), x]);
	}
	// A grey row stands before the heir at its `before` place (after that many heirs); the rows that remain stand after the last heir.
	let nextBranch = 0;
	const branches = (upTo: number) => {
		while (nextBranch < res.openBranches.length && res.openBranches[nextBranch].before <= upTo) {
			const id = res.openBranches[nextBranch++].id;
			branchRow(st, list, id);
			for (const x of under.get(id) ?? []) note(list, x.text, x.n.kind);
		}
	};
	res.heirs.forEach((id, i) => {
		branches(i);
		const ord = ordinal(i + 1);
		const open = (): void => (host.openPerson ? host.openPerson(id) : host.showCard(id));
		const r = buildRow(list, {
			ord,
			tap: () => host.guard(open),
			label: T.lineRowLabel(st.nameOf(id), ord),
			cls: 'dynasty-succ-item',
			attr: { role: 'listitem', 'data-person': id, 'data-focus': `succ-line:${id}` },
			chevron: false,
			lead: (row) => lead(st, row, id),
		});
		r.title.createSpan({ cls: 'dynasty-holder-label', text: isolateName(st.nameOf(id)) });
		const p = g.byId.get(id);
		const dates = p ? dateLineShown(p, g.dates) : '';
		if (dates) r.sub.setText(dates);
		const sub = (text: string, kind: string, warn: boolean) => void r.row.parentElement?.createDiv({ cls: warn ? ['dynasty-succ-subnote', 'is-warning'] : ['dynasty-succ-subnote'], attr: { 'data-note': kind }, text });
		if (res.old.includes(id)) sub(T.old(st.nameOf(id), host.oldAge(), y), 'old', true);
		if (bornDateUnread(res, g, id)) sub(T.noYearDate(st.nameOf(id)), 'no-year', true);
		for (const x of under.get(id) ?? []) note(list, x.text, x.n.kind);
	});
	branches(Infinity);
	for (const x of afterNotes(res, g, under, st.nameOf, host.row.name)) note(list, x.text, x.kind);
}

/** The line itself: the heading, the button Show, the notes, the rows and the closing hints. */
function drawHeirs(st: SectionState, box: HTMLElement, res: SuccessionResult): void {
	const host = st.host;
	const ruler = res.ruler ?? '';
	const head = box.createDiv({ cls: 'dynasty-line-head' });
	head.createEl('b', { cls: 'dynasty-succ-heading', text: T.lineAfter(st.rulerLabel(ruler, res.year), res.yearText), attr: { role: 'heading', 'aria-level': '3' } });
	// Show works for a line, also an empty one.
	textButton(head, ['dynasty-btn', 'dynasty-succ-show'], T.show, () => host.guard(() => host.show()), { icon: 'eye', label: T.showLabel, focus: 'succ-show' });
	const notes = res.notes.map((n) => ({ n, text: noteText(st, n) })).filter((x): x is TextNote => x.text !== null);
	notesAbove(st, box, res, notes);
	heirRows(st, box, res, notes);
	if (!res.heirs.length && !res.outsideBody) box.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-succ-msg'], text: T.noHeir, attr: { 'data-msg': 'no-heir' } });
	if (res.more) box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-succ-more'], text: T.more });
	if (res.moreBranches) box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-succ-more', 'dynasty-succ-more-branches'], text: T.moreBranches });
	if (res.openBranches.length) box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-succ-branch-note'], text: T.branchNote, attr: { 'data-hint': 'branch-note' } });
}

/** Draws the line again. `recompute` makes the result again from the draft first. */
export function drawLine(st: SectionState, recompute = true): void {
	const el = st.lineEl;
	if (!el) return;
	st.pictures.forget(el);
	el.empty();
	if (recompute) st.result = compute(st);
	const res = st.result;
	// A new year can make a named heir dead or not born yet: the notes under the named heirs follow it.
	st.live?.setText(summary(res));
	st.summaries();
	const box = el.createDiv({ cls: ['dynasty-line-box', 'dynasty-succ-line'], attr: { role: 'region', 'aria-label': T.heading } });
	const msg = (text: string, kind: string, quiet = false) => box.createDiv({ cls: quiet ? ['dynasty-sheet-none', 'dynasty-succ-msg'] : 'dynasty-succ-msg', text, attr: { 'data-msg': kind } });
	// The messages of a line that cannot be drawn. A wrong rule leaves the notes under the named heirs as they are.
	if (!res || res.kind === 'no-rule') msg(T.noHeir, 'no-rule', true);
	else if (res.kind === 'bad-rule') return void msg(T.badRule, 'bad-rule');
	else if (res.kind === 'no-ruler') msg(T.noRuler(res.yearText), 'no-ruler');
	else if (res.kind === 'ruler-not-in-tree') msg(T.rulerNotInTree(res.yearText), 'ruler-not-in-tree');
	else drawHeirs(st, box, res);
	if (recompute) refreshStates(st);
}
