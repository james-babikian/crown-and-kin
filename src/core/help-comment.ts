/*
 * The help comment that "Insert family tree" writes into an empty tree (spec §5.9, D34), and the
 * rule that takes it out again when the first person is added (D335). The sentence has one copy
 * here; `INSERT_UI.noteHint` in the render layer must equal it (a test pins that).
 */

import type { Parsed, Patch } from './yaml-patch';
import { commentsOf } from './yaml-patch';

/** The sentence of the help comment, with straight marks: it goes into the user's note. */
export const HELP_COMMENT = 'To add the first person, select "Add first person" in Reading view or Live Preview.';

/** The whole text line the command writes. */
export const HELP_LINE = `# ${HELP_COMMENT}`;

/**
 * The patch that removes the help comment line, or null. Only a line equal to `HELP_LINE` byte for
 * byte (a line ending is not part of it) that starts a comment counts, and only when it is the one
 * such line: with two copies the plugin cannot tell its own from the user's, so both stay.
 */
export function helpLineRemoval(p: Parsed): Patch | null {
	const text = p.src.text;
	if (!text.includes(HELP_LINE)) return null;
	const found: Patch[] = [];
	const starts = new Set(commentsOf(text).map((c) => c.offset));
	let at = 0;
	while (at <= text.length) {
		const nl = text.indexOf('\n', at);
		const lineEnd = nl < 0 ? text.length : nl;
		const content = text.slice(at, lineEnd);
		if ((content === HELP_LINE || content === `${HELP_LINE}\r`) && starts.has(at)) {
			const end = nl < 0 ? lineEnd : nl + 1;
			found.push({ start: at, end, text: '', allow: [at, end] });
		}
		if (nl < 0) break;
		at = nl + 1;
	}
	return found.length === 1 ? found[0] : null;
}
