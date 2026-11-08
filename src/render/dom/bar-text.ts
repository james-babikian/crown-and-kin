/*
 * The text of the bar of the Show view (B-0036). The sentence has a middle dot between the year and the rule. A screen reader reads that dot as a word or
 * skips it, so the element holds the dot as hidden decoration and a hidden comma for the reader. The name of the element then begins with the visible words
 * (WCAG 2.5.3) and says the same in speech as on the page. The one function is used by the bar on the tree and the bar of the phone list.
 */
import { BAR_SEPARATOR, SUCCESSION_UI } from '../succession-text';
import { setNameText } from './name-marks';

/** Writes `sentence` into `el`. A sentence with the separator becomes: the words before, a hidden comma, the visible dot (hidden from a reader), the words after. */
export function setBarText<T extends HTMLElement>(el: T, sentence: string): T {
	// The last separator: a title name can hold one, and the rule and the closing sentence never do.
	const at = sentence.lastIndexOf(BAR_SEPARATOR);
	if (at < 0) return setNameText(el, sentence);
	setNameText(el, sentence.slice(0, at));
	el.createSpan({ cls: 'dynasty-sr-only', text: SUCCESSION_UI.barSpokenSeparator });
	el.createSpan({ attr: { 'aria-hidden': 'true' }, text: BAR_SEPARATOR });
	// The rule has its own class so the style sheet can set it in the muted colour (D338 point 3); the words do not change.
	setNameText(el.createSpan({ cls: 'dynasty-succession-rule' }), sentence.slice(at + BAR_SEPARATOR.length));
	return el;
}
