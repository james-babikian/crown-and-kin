/*
 * The relation to the marked person in the header of the person window (0.2.8 contract C, D197 Q8 A, G.8). It is one text line: "Your first cousin · 4 more · Show the
 * line". "4 more" opens a second text line "Also: …". "Show the line" is a link in the same text line. The sentence of the
 * D123 "maybe" keeps its own quiet text line. The texts come from `RelationInfo` in `src/render/tree-info.ts`
 * (`cardRelationText` is the one source for the word, as on the card and in the phone list). This file only draws them.
 */

import { RELINFO, type RelationInfo } from '../render/tree-info';
import { joined } from '../render/text-join';
import { WINDOW_UI } from '../render/ui-text';

/** What the line shows for one person: the texts, and the action of "Show the line" (absent when there is none). */
export interface RelationView extends RelationInfo {
	showLine?: { label: string; aria: string; run(): void };
}

/** The small first letter of a relation word: "Half-sister, maybe full" reads "Your half-sister, maybe full". */
export function lowerFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Draws the relation lines into `parent` and returns the first element. */
export function renderRelationLine(parent: HTMLElement, v: RelationView): HTMLElement {
	if (v.kind === 'me') return parent.createDiv({ cls: ['dynasty-head-rel', 'is-me'], text: v.value });
	// A person with no relation keeps the button: the line view then says so in its own words.
	const parts: (HTMLElement | string)[] = [v.kind === 'none' ? v.value : WINDOW_UI.relationYour(lowerFirst(v.value))];
	let also: HTMLElement | null = null;
	if (v.kind !== 'none' && v.others > 0 && v.also) {
		const more = createEl('button', { cls: ['dynasty-link', 'dynasty-more'], attr: { type: 'button', 'aria-expanded': 'false', 'aria-label': WINDOW_UI.moreLabel(v.others), 'data-focus': 'relation-more' } });
		more.createSpan({ text: RELINFO.more(v.others) });
		parts.push(more);
		const text = v.also;
		more.addEventListener('click', () => {
			if (also) {
				const open = also.hasClass('is-open');
				also.toggleClass('is-open', !open);
				also.toggle(!open);
				more.setAttribute('aria-expanded', String(!open));
			}
		});
		also = parent.createDiv({ cls: ['dynasty-head-maybe', 'dynasty-relation-also'], text });
		also.hide();
	}
	if (v.showLine) {
		const s = v.showLine;
		const b = createEl('button', { cls: ['dynasty-link', 'dynasty-showline', 'dynasty-show-line'], attr: { type: 'button', 'aria-label': s.aria, 'data-focus': 'dynasty-show-line' } });
		b.createSpan({ text: s.label });
		b.addEventListener('click', () => s.run());
		parts.push(b);
	}
	const line = joined(parent, 'dynasty-head-rel', parts);
	if (v.kind === 'none') line.addClass('is-none');
	// The "Also" text line stands under the first line, so the line is moved before it.
	if (also) parent.insertBefore(line, also);
	if (v.maybe) parent.createDiv({ cls: ['dynasty-head-maybe', 'dynasty-relation-maybe'], text: v.maybe });
	return line;
}
