import type { FEl } from '../acceptance/fake-dom';

/** The text of an element in the fake DOM, without the parts that `skip` names. */
function walk(el: FEl, skip: (e: FEl) => boolean): string {
	return skip(el) ? '' : el.text + el.children.map((c) => walk(c, skip)).join('');
}

/** What a sighted user reads in the bar: the text without the hidden copy for a screen reader. */
export const visibleBarText = (el: FEl): string => walk(el, (e) => e.hasClass('dynasty-sr-only'));

/** What a screen reader reads in the bar: the text without the parts that are hidden from it (the dot). */
export const spokenBarText = (el: FEl): string => walk(el, (e) => e.getAttribute('aria-hidden') === 'true');
