import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export interface FixtureBlock {
	/** The file name up to its first '-': a two-digit number such as '05', or '07b' (spec §13.0 item 9). */
	id: string;
	file: string;
	/** Body of the first top-level kin block in the note, each line ending in '\n'. */
	source: string;
}

/**
 * Bodies of the kin blocks whose fences start at the beginning of a line (``` or ~~~, any
 * length), each line ending in '\n'. A fence line inside another fence is content: the closing
 * fence must use the same character and be at least as long (spec §6.1). This is a small scanner
 * of its own, so the tests stay independent of src/core/block-locate. Blocks in callouts or list
 * items are not top-level and are not returned.
 */
export function topLevelBlocks(md: string): string[] {
	const out: string[] = [];
	let open: { char: string; len: number; dynasty: boolean; lines: string[] } | null = null;
	for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
		if (!open) {
			const m = /^(`{3,}|~{3,})(.*)$/.exec(line);
			// A backtick fence's info string cannot contain a backtick (CommonMark).
			if (!m || (m[1][0] === '`' && m[2].includes('`'))) continue;
			open = { char: m[1][0], len: m[1].length, dynasty: /^kin(\s|$)/.test(m[2].trim()), lines: [] };
			continue;
		}
		const close = /^(`{3,}|~{3,})[ \t]*$/.exec(line);
		if (close && close[1][0] === open.char && close[1].length >= open.len) {
			if (open.dynasty) out.push(open.lines.map((l) => l + '\n').join(''));
			open = null;
		} else {
			open.lines.push(line);
		}
	}
	return out;
}

/** Every fixture note that has a top-level kin block, in file order. */
export function allFixtures(): FixtureBlock[] {
	const out: FixtureBlock[] = [];
	for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()) {
		const source = topLevelBlocks(readFileSync(DIR + file, 'utf8'))[0];
		if (source !== undefined) out.push({ id: file.slice(0, file.indexOf('-')), file, source });
	}
	return out;
}

export function fixtureSource(id: string): string {
	const f = allFixtures().find((x) => x.id === id);
	if (!f) throw new Error(`No fixture ${id}`);
	return f.source;
}

/** The whole text of a fixture note, exactly as stored. */
export function fixtureNote(id: string): string {
	const file = readdirSync(DIR).find((f) => f.startsWith(`${id}-`) && f.endsWith('.md'));
	if (!file) throw new Error(`No fixture ${id}`);
	return readFileSync(DIR + file, 'utf8');
}
