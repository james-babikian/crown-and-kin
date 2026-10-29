/*
 * The two hints under the switch "Only descendants of the first holder can inherit" in the Titles window (spec §13.21 rule 14,
 * D291): the hint that names the first holder (or says what the switch would do while it is off), and the cadet hint. The section
 * calls `bodyHints` when it draws the switch. Pure: it reads the graph and the draft and returns two texts. The hint of the
 * illegitimate choice (`illegitimateHint`) is here too, as it is a hint that depends on the draft only.
 */

import type { FamilyGraph } from '../core/derive';
import type { SuccessionResult } from '../core/succession';
import { firstHolderOf } from '../core/succession-first';
import { cadetHint } from '../core/succession-hint';
import { SUCCESSION_UI as T } from '../render/ui-text';
import { draftSpec, draftTitle, holderLead, holderText, type SuccessionDraft, type TitleRow } from '../view/titles-draft';

const nameIn = (g: FamilyGraph, id: string) => g.byId.get(id)?.name ?? id;

/**
 * The first holder for the hints. Its name is the name in the holder list; with the key `through-spouse` on the first entry the
 * first holder is the spouse (rule 14), so then the person's own name. `skipped` is the text of the first entry when that entry is
 * not a person in the tree. The engine's own helper decides who the first holder is, also while the switch is off.
 */
export function firstInfo(g: FamilyGraph, row: TitleRow): { name: string; lead: string; skipped: string | null } | null {
	const entry = row.holders.find((h) => h.values.person !== undefined && g.byId.has(h.values.person));
	if (!entry) return null;
	const id = entry.values.person!;
	const holder = holderText(g, entry.values);
	const text = holder.ruler || nameIn(g, id);
	// `lead` is the name of the holder list (D319 item 2a); the hints keep `name`, the first word, which the cadet tests pin.
	const lead = holderLead(holder, entry.values) || nameIn(g, id);
	const title = draftTitle(g, row);
	const core = title ? firstHolderOf(g, title.holders) : null;
	if (!title || !core) return { name: text, lead, skipped: null };
	if (core.index > 0) return { name: nameIn(g, core.id), lead: nameIn(g, core.id), skipped: title.holders[0].name ?? title.holders[0].person ?? '' };
	return { name: core.id === id ? text : nameIn(g, core.id), lead: core.id === id ? lead : nameIn(g, core.id), skipped: null };
}

/** The cadet hint (D291), or ''. It runs the line two more times, so the caller reuses its own line when that line is complete. */
function cadetText(g: FamilyGraph, row: TitleRow, draft: SuccessionDraft, line: SuccessionResult | null, first: string | undefined): string {
	try {
		const title = draftTitle(g, row);
		if (!title) return '';
		const found = cadetHint(g, title, draftSpec(draft), line ? { line } : {});
		return found ? T.cadetHint(nameIn(g, found.person), first ?? nameIn(g, found.first)) : '';
	} catch (e) {
		console.error('Crown and Kin: cannot compute the cadet hint', e);
		return '';
	}
}

/**
 * The texts under the switch for a draft. While the switch is off, the first text says what it would do and the second is the
 * cadet hint; while it is on, the first text names the first holder and the second is empty. `line` is the line of the window
 * for this draft. `withCadet` is false while the Rules section is closed: the cadet hint runs the line two more times, so a
 * section that nobody sees must not pay for it.
 */
export function bodyHints(g: FamilyGraph, row: TitleRow, draft: SuccessionDraft, line: SuccessionResult | null, withCadet: boolean): { hint: string; extra: string } {
	const off = !draft.body;
	const info = firstInfo(g, row);
	let hint = '';
	if (info?.skipped !== undefined && info.skipped !== null) hint = off ? T.bodyHintSkippedOff(info.name, info.skipped) : T.bodyHintSkipped(info.name, info.skipped);
	else if (info) hint = off ? T.bodyHintOff(info.name) : T.bodyHint(info.name);
	return { hint, extra: off && withCadet ? cadetText(g, row, draft, line, info?.name) : '' };
}

/**
 * The hint of the illegitimate choice (spec §13.21 rules 10, 11, 26): only where a claim passes through women alone. That is
 * `inherit-through: women` with any form, or, with no written `inherit-through`, Women only. Women first in the whole dynasty has a
 * women-only first group, so it gets its own text. "Men" and "Anyone" give no hint.
 */
export function illegitimateHint(inherit: string, through: string): string | null {
	if (through === 'women') return T.illHint;
	if (through !== '') return null;
	return inherit === 'women-only' ? T.illHint : inherit === 'women-first-in-house' ? T.illHintFirstGroup : null;
}
