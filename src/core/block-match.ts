/*
 * Pure rules that tie a BlockHandle to one `dynasty` block of a note (spec §6.1, the work plan §3.4):
 * comparing a located body with the body Obsidian rendered, finding the block again after the
 * note changed, and the smallest text change for an editor transaction. No `obsidian` import.
 */

/**
 * Obsidian gives a code block processor the body without its fence lines and container prefix.
 * Line endings and trailing spaces can differ from the located body, so compare in this form.
 */
export function normBody(s: string): string {
	return s
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((l) => l.trimEnd())
		.join('\n')
		.replace(/\n+$/, '');
}

const lead = (l: string) => /^[ \t]*/.exec(l)?.[0] ?? '';

/** Removes the leading whitespace that every non-blank line shares. */
export function dedent(s: string): string {
	const lines = s.split('\n');
	let common: string | null = null;
	for (const l of lines) {
		if (l.trim() === '') continue;
		const own = lead(l);
		if (common === null) common = own;
		else {
			let i = 0;
			while (i < common.length && i < own.length && common[i] === own[i]) i++;
			common = common.slice(0, i);
		}
		if (!common) return s;
	}
	if (!common) return s;
	const cut = common.length;
	return lines.map((l) => l.slice(Math.min(cut, lead(l).length))).join('\n');
}

/**
 * True if a body that Obsidian gave a code block processor and a located body are the same text.
 * In Live Preview Obsidian keeps a list item's indentation on every line of the source (Reading
 * view removes it); an indentation shared by all lines cannot change which block it is.
 */
export function sameBody(a: string, b: string): boolean {
	const x = normBody(a);
	const y = normBody(b);
	return x === y || dedent(x) === dedent(y);
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * The smallest replacement that turns `a` into `b`, as offsets into `a`. An editor transaction
 * of only this span keeps the cursor, the selection and the scroll where they were.
 */
export function smallestChange(a: string, b: string): { from: number; to: number; text: string } {
	const max = Math.min(a.length, b.length);
	let p = 0;
	while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
	let s = 0;
	while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
	// Never split a surrogate pair: the editor counts code units, but a half character is not text.
	if (p > 0 && isHigh(a.charCodeAt(p - 1))) p--;
	if (s > 0 && isLow(a.charCodeAt(a.length - s))) s--;
	return { from: p, to: a.length - s, text: b.slice(p, b.length - s) };
}

/** Where a handle's block is after the note changed. */
export type Relocation = { kind: 'keep' | 'moved'; ordinal: number } | { kind: 'detached' };

/**
 * Finds a handle's block again in the note's new blocks (supervisor rules, the decision notes):
 * - the number of blocks did not change: the block at the ordinal still has `expectedBody` → keep;
 *   else exactly one other block has it → that block (blocks were swapped); else keep the ordinal
 *   (the block was edited in place, an ordinary stale case);
 * - the number changed: the block is the one new block whose body equals `expectedBody`; with no
 *   such block, or several, the handle is detached and must not write.
 */
export function relocate(bodies: readonly string[], previousCount: number, ordinal: number, expectedBody: string): Relocation {
	const same: number[] = [];
	bodies.forEach((b, i) => {
		if (b === expectedBody) same.push(i);
	});
	if (bodies.length === previousCount) {
		if (ordinal >= bodies.length) return { kind: 'detached' };
		if (bodies[ordinal] === expectedBody) return { kind: 'keep', ordinal };
		return same.length === 1 ? { kind: 'moved', ordinal: same[0] } : { kind: 'keep', ordinal };
	}
	return same.length === 1 ? { kind: same[0] === ordinal ? 'keep' : 'moved', ordinal: same[0] } : { kind: 'detached' };
}

/**
 * Relocates several handles of one note at once. Two handles that would land on the same block are
 * both detached, so a block never has two handles that disagree about it.
 */
export function relocateAll(bodies: readonly string[], handles: readonly { count: number; ordinal: number; body: string }[]): Relocation[] {
	const out = handles.map((h) => relocate(bodies, h.count, h.ordinal, h.body));
	const claims = new Map<number, number>();
	for (const r of out) if (r.kind !== 'detached') claims.set(r.ordinal, (claims.get(r.ordinal) ?? 0) + 1);
	return out.map((r) => (r.kind !== 'detached' && (claims.get(r.ordinal) ?? 0) > 1 ? { kind: 'detached' } : r));
}

/**
 * The block an undo may restore: the one block whose body is exactly what the plugin last wrote.
 * None or several (a copy was pasted) give null, and the undo is refused.
 */
export function undoBlock(bodies: readonly string[], lastWritten: (body: string) => boolean): number | null {
	const same: number[] = [];
	bodies.forEach((b, i) => {
		if (lastWritten(b)) same.push(i);
	});
	return same.length === 1 ? same[0] : null;
}
