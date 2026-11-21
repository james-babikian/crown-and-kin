/*
 * The two people lists of the section "Rules of succession" in the Titles window: the named heirs and the excluded people. Each row
 * has the name (a tap shows the card), the notes that the line gives for a named heir, the buttons to move and remove, and the
 * button that adds a person through the picker. Part of the split of `succession-section.ts`; no text and no behaviour changed.
 */

import { SUCCESSION_UI as T, TITLES_UI } from '../render/ui-text';
import { isolateName } from '../render/tree-info';
import { heirNotes } from '../view/succession-notes';
import { buildRow, iconButton, personLead, textButton } from './window-parts';
import { change, type SectionState } from './succession-state-ui';

type Kind = 'heir' | 'exclude';

/** The lead of a person row: the initials, and the portrait when the copy comes. */
export function lead(st: SectionState, row: HTMLElement, id: string): void {
	const p = st.host.g().byId.get(id);
	personLead(row, { name: p?.name ?? id, ...(p?.portrait ? { portrait: p.portrait } : {}), ...(p?.portraitCrop ? { portraitCrop: p.portraitCrop } : {}) }, st.pictures);
}

/** The buttons that move a named heir earlier or later in the list. */
function moveButtons(st: SectionState, buttons: HTMLElement, list: string[], i: number, id: string, who: string): void {
	const move = (dir: -1 | 1, cls: string, icon: string, aria: string) => {
		const to = i + dir;
		const btn = iconButton(
			buttons,
			icon,
			aria,
			() => {
				if (to < 0 || to >= list.length) return;
				const end = to === 0 || to === list.length - 1;
				change(st, () => void ([list[i], list[to]] = [list[to], list[i]]), end ? `succ-heir-${dir < 0 ? 'later' : 'earlier'}:${id}` : `succ-heir-${cls}:${id}`);
			},
			{ cls: ['dynasty-holder-move', `dynasty-succ-${cls}`], focus: `succ-heir-${cls}:${id}` },
		);
		btn.disabled = to < 0 || to >= list.length;
	};
	move(-1, 'earlier', 'arrow-up', T.moveEarlierLabel(who));
	move(1, 'later', 'arrow-down', T.moveLaterLabel(who));
}

/** One row of a people list. */
function personRow(st: SectionState, rows: HTMLElement, kind: Kind, list: string[], id: string, i: number): void {
	const inTree = st.host.g().byId.has(id);
	const who = st.nameOf(id);
	const r = buildRow(rows, {
		cls: inTree ? ['dynasty-holder-row'] : ['dynasty-holder-row', 'is-not-in-tree'],
		attr: { 'data-person': id },
		lead: inTree ? (row) => lead(st, row, id) : undefined,
	});
	if (inTree) {
		const name = r.title.createEl('button', { cls: 'dynasty-holder-name', attr: { type: 'button', 'aria-label': TITLES_UI.showCardLabel(who), 'data-focus': `succ-${kind}-name:${id}` } });
		name.createSpan({ cls: 'dynasty-holder-label', text: isolateName(who) });
		name.addEventListener('click', () => st.host.guard(() => st.host.showCard(id)));
	} else {
		r.title.createSpan({ cls: 'dynasty-holder-name', text: id });
		r.sub.createSpan({ cls: 'dynasty-holder-note', text: T.heirNotInTree });
	}
	for (const x of kind === 'heir' ? heirNotes(st.result, id, st.nameOf) : []) r.sub.parentElement?.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text: x.text, attr: { 'data-note': x.note } });
	const buttons = r.actions();
	buttons.addClass('dynasty-holder-buttons');
	const removeIt = () => {
		const at = list.indexOf(id);
		if (at < 0) return;
		const next = list[at + 1] ?? list[at - 1];
		change(st, () => void list.splice(at, 1), next !== undefined ? `succ-${kind}-remove:${next}` : `succ-${kind}-add`);
	};
	if (kind === 'heir') moveButtons(st, buttons, list, i, id, who);
	iconButton(buttons, 'x', T.removeLabel(who), removeIt, { cls: 'dynasty-holder-remove', focus: `succ-${kind}-remove:${id}` });
}

/** The button that opens the picker and adds the person who is chosen. */
function addButton(st: SectionState, panel: HTMLElement, kind: Kind, list: string[]): void {
	const host = st.host;
	const title = host.row.name.trim() || T.heading;
	textButton(
		panel.createDiv({ cls: 'dynasty-actions' }),
		['dynasty-btn', 'dynasty-succ-add'],
		kind === 'heir' ? T.addHeir : T.addExclude,
		() =>
			host.guard(() => {
				// The ruler is never offered; nor is a person who is on the list already.
				const skip = new Set<string>(list);
				if (st.result?.ruler) skip.add(st.result.ruler);
				void host.pick(kind, skip).then(
					(id) => {
						host.guard(() => {
							// The list as it is now: the window can have drawn the page again while the picker was open.
							const now = kind === 'heir' ? st.s().heirs : st.s().exclude;
							if (id !== null && !now.includes(id)) change(st, () => void now.push(id), `succ-${kind}-add`);
							else st.redraw({ kind: 'all', focus: `succ-${kind}-add` });
						});
					},
					(e) => console.error('Crown and Kin: the picker failed', e),
				);
			}),
		{ icon: 'plus', label: kind === 'heir' ? T.addHeirLabel(title) : T.addExcludeLabel(title), focus: `succ-${kind}-add` },
	);
}

/** One list of people (named heirs or excluded people) with its heading, hint, rows and add button. */
export function peopleList(st: SectionState, body: HTMLElement, kind: Kind): void {
	const d = st.s();
	const list = kind === 'heir' ? d.heirs : d.exclude;
	const panel = body.createDiv({ cls: ['dynasty-holder-panel', 'dynasty-succ-people'], attr: { 'data-succ': kind === 'heir' ? 'heirs' : 'exclude' } });
	panel.createDiv({ cls: ['dynasty-sub', 'dynasty-sheet-label'], text: kind === 'heir' ? T.heirsLabel : T.excludeLabel });
	panel.createDiv({ cls: ['dynasty-sheet-hint'], text: kind === 'heir' ? T.heirsHint : T.excludeHint });
	const rows = panel.createDiv({ cls: ['dynasty-rows', 'dynasty-holder-list'] });
	if (!list.length) rows.createDiv({ cls: ['dynasty-holder-none', 'dynasty-sheet-none'], text: kind === 'heir' ? T.heirsNone : T.excludeNone });
	list.forEach((id, i) => personRow(st, rows, kind, list, id, i));
	addButton(st, panel, kind, list);
}

/** The notes under the named heirs follow the line (a new year can make a named heir dead or not born yet). */
export function refreshStates(st: SectionState): void {
	const body = st.rulesEl;
	if (!body) return;
	for (const row of Array.from(body.querySelectorAll('[data-succ="heirs"] .dynasty-holder-row'))) {
		const id = row.getAttribute('data-person') ?? '';
		const words = row.querySelector('.dynasty-row-text');
		if (!words) continue;
		for (const n of Array.from(words.querySelectorAll('[data-note]'))) n.remove();
		for (const x of heirNotes(st.result, id, st.nameOf)) words.createSpan({ cls: ['dynasty-holder-note', 'dynasty-row-sub'], text: x.text, attr: { 'data-note': x.note } });
	}
}
