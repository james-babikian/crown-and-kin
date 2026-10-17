import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oldTag } from '../support/old-tag';

const DIR = fileURLToPath(new URL('../golden/', import.meta.url));

/**
 * A hand-written expected output from tests/golden/, exactly as stored (LF, one final newline). A whole note (`.md`) was
 * recorded with the old block word and is never edited: it is read with the word `kin` (`support/old-tag.ts`, 0.3.1).
 */
export function golden(name: string): string {
	const text = readFileSync(DIR + name, 'utf8');
	return name.endsWith('.md') ? oldTag(text) : text;
}

/** Replaces exactly one occurrence, so a typo in an expected text cannot pass silently. */
export function replaceOnce(text: string, from: string, to: string): string {
	const at = text.indexOf(from);
	if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`);
	return text.slice(0, at) + to + text.slice(at + from.length);
}
