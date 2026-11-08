/*
 * The quiet notes of the line of succession in the Titles window, and the note that says why the first heir is not a child of the ruler
 * (D334 Q11). The note stands above the heirs, like the note about the other holders. The words are in `succession-text.ts`; the facts come from
 * `core/succession-reason.ts`.
 */

import type { FamilyGraph } from '../core/derive';
import type { RelationOptions } from '../core/relations';
import type { SuccessionResult } from '../core/succession';
import { firstHeirReason, type FirstHeirSpec } from '../core/succession-reason';
import { SUCCESSION_UI as T } from '../render/ui-text';

/** A quiet text line of the line of succession. A warning is a roman text line in the text colour (D218 item 4), with no sign: the words carry the warning. */
export function quietNote(parent: HTMLElement, text: string, name: string, warn = false): void {
	parent.createDiv({ cls: warn ? ['dynasty-succ-note', 'is-warning'] : ['dynasty-succ-note'], attr: { 'data-note': name }, text });
}

/** What the note needs: the graph and the line, the rule of the draft, the relation options and the way to write a name. */
export interface FirstHeirNoteInput {
	g: FamilyGraph;
	res: SuccessionResult;
	spec: FirstHeirSpec | undefined;
	options: RelationOptions | undefined;
	nameOf: (id: string) => string;
	/** The name of the ruler as the line shows it ("Konrad VI"). */
	rulerLabel: (id: string) => string;
}

/** Draws the note when the first heir is not a child of the ruler (every rule); draws nothing when no reason is needed. */
export function firstHeirNote(box: HTMLElement, o: FirstHeirNoteInput): void {
	const why = firstHeirReason(o.g, o.res, o.spec, o.options);
	if (!why) return;
	if (why.kind === 'no-child') quietNote(box, T.firstHeirNoChild(o.rulerLabel(why.ruler), o.nameOf(why.heir), why.relation), 'first-heir');
	else if (why.kind === 'dead-child') quietNote(box, T.firstHeirDeadChild(o.nameOf(why.via), o.rulerLabel(why.ruler)), 'first-heir');
	else if (why.kind === 'barred') quietNote(box, T.firstHeirBarred[why.bar](o.nameOf(why.child), o.nameOf(why.heir)), 'first-heir');
	else if (why.kind === 'inherit') quietNote(box, T.firstHeirByRule(o.nameOf(why.heir), T.inherits[why.inherit]), 'first-heir');
	else quietNote(box, T.firstHeirByRule(o.nameOf(why.heir), T.rules[why.rule]), 'first-heir');
}
