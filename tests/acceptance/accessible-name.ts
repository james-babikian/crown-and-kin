import type { FEl } from './fake-dom';

/** The accessible name of a control: its `aria-label`, or else the text for a screen reader only that it holds (the phone list rows use this form). */
export function accName(el: FEl): string {
	return el.getAttribute('aria-label') ?? el.querySelector('.dynasty-sr-only')?.getText() ?? '';
}
