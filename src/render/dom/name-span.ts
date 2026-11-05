/*
 * The DOM side of the name run (spec §0 D322, `render/name-bidi.ts`). A name that holds a right-to-left letter goes in a span with `dir="auto"` and the isolate rule
 * of the CSS (`dynasty-name-run`), so its first strong letter gives the direction of the whole name with its sobriquet, as on the cards. The block around it keeps
 * its own direction, so the place of the text and the ellipsis do not change. A name with no right-to-left letter is written as plain text: no extra element, and the
 * text of the row is the text it was. Never set `dir` on a block that holds a name: that would move the text to the other side.
 */
import { nameNeedsRun } from '../name-bidi';

/**
 * Opens the run of one name inside `parent`. It returns `parent` itself when none of `texts` (the name, the sobriquet and the parts written with them) holds a
 * right-to-left letter, else a new isolate span in `parent`. Append the name and its parts to the result.
 */
export function nameRun(parent: HTMLElement, ...texts: readonly (string | undefined)[]): HTMLElement {
	return nameNeedsRun(...texts) ? parent.createSpan({ cls: 'dynasty-name-run', attr: { dir: 'auto' } }) : parent;
}

/** A part that follows a name inside its run: a span of class `cls` with `text` (the caller writes the space and the curly marks). */
export interface NamePart {
	cls: string;
	text: string;
}

/**
 * Appends `name` and then its `parts` (the ruler name, the sobriquet) to `parent` as one run (`nameRun`), as the card draws a name with its sobriquet. A part that is
 * undefined is left out. Returns the element that holds the text: `parent`, or the isolate span.
 */
export function appendNameRun(parent: HTMLElement, name: string, parts: readonly (NamePart | undefined)[] = []): HTMLElement {
	const given = parts.filter((p): p is NamePart => p !== undefined);
	const run = nameRun(parent, name, ...given.map((p) => p.text));
	run.appendText(name);
	for (const p of given) run.createSpan({ cls: p.cls, text: p.text });
	return run;
}
