import { describe, expect, it, vi } from 'vitest';
import { findBlocks, type LocatedBlock } from '../../src/core/block-locate';
import { planWrite } from '../../src/core/block-write';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { genNote, type GenNote, type RealBlock } from '../support/r030-d-note-gen';
import { rng } from '../support/r028-advb-gen';
import { genOp, modelOf, type Model } from '../support/r028-advb-edits-support';

/*
 * 0.3 package D, T3 (the 0.3 contract D.1; the release plan worst case W1): random notes with random edits.
 *
 * The notes come from `r030-d-note-gen.ts`, which builds a note from CommonMark rules and writes down where the real
 * `kin` blocks are while it builds. The oracle is that knowledge, not `findBlocks`. Spec §6.1: the locating
 * handles fences of any length, fences nested in longer fences, callouts (also nested) and list items; fence lines are
 * never changed; the prefix goes back on every body line. The checks:
 *
 * (1) `findBlocks` finds exactly the real blocks of the generator: the number, the ordinal, the line numbers of the
 *     fences, the offsets and the text of the body, the prefix and the line ending of the note;
 * (2) a write through `planWrite` keeps every byte outside the body of the block (the fence lines, the prefix of the
 *     other lines, the line endings, the decoys, the other trees) and the lines of the new body, read back by the
 *     generator's own reader, are the new body;
 * (3) after a write the generator's knowledge (shifted by the change) and `findBlocks` agree again;
 * (4) a write on a clean note (no unclosed fence, the body as it was read) that the spec allows is accepted;
 * (5) a write over a body that is not the body in the note is refused as stale and gives no text.
 *
 * Every failure message prints the seed. To see one note: R030_SHOW=<seed>. Seeded; 200 notes in the normal run,
 * 1000 with R028_DEEP=1.
 */

const DEEP = process.env.R028_DEEP === '1';
vi.setConfig({ testTimeout: DEEP ? 300_000 : 60_000 });
// R030_COUNT and R030_BASE are for searching: more notes, or other seeds.
const COUNT = Number(process.env.R030_COUNT ?? (DEEP ? 1000 : 200));
/** Seeds for the tests; 7000 is only a start number. */
const SEEDS = Array.from({ length: COUNT }, (_, i) => Number(process.env.R030_BASE ?? 7000) + i);

/** A note for a message: the whole text with R030_SHOW_ALL=1, else the start (a failing note can be long). */
const show = (n: GenNote) => (process.env.R030_SHOW_ALL ? JSON.stringify(n.text) : `${JSON.stringify(n.text.slice(0, 400))}... (${n.text.length} characters; set R030_SHOW_ALL=1 or R030_SHOW=${n.seed})`);
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** Compares `findBlocks` with what the generator knows. Returns the first difference, or ''. */
function diffBlocks(got: readonly LocatedBlock[], want: readonly RealBlock[], loneCr: boolean): string {
	if (got.length !== want.length) return `number of blocks: found ${got.length}, real ${want.length}`;
	for (let i = 0; i < want.length; i++) {
		const g = got[i];
		const w = want[i];
		const fields: [string, unknown, unknown][] = [
			['ordinal', g.ordinal, i],
			['openLine', g.openLine, w.openLine],
			['closeLine', g.closeLine, w.closeLine],
			['bodyStart', g.bodyStart, w.bodyStart],
			['bodyEnd', g.bodyEnd, w.bodyEnd],
			['prefix', g.prefix, w.prefix],
			['body', g.body, w.body],
		];
		if (!loneCr) fields.push(['eol', g.eol, w.eol]);
		for (const [name, a, b] of fields) if (a !== b) return `block ${i}, ${name}: found ${JSON.stringify(a)}, real ${JSON.stringify(b)}`;
	}
	return '';
}

/**
 * The body lines that a region of the note holds, read by the rule of CommonMark and not by the plugin: every line
 * starts with the prefix (a blank line may be the prefix without its trailing white space, or empty when the prefix
 * has no quote mark); after a bare quote mark one space belongs to the mark. Null if a line does not fit.
 */
function readRegion(region: string, prefix: string): string[] | null {
	const out: string[] = [];
	const bare = prefix.endsWith('>');
	for (const raw of region.split(/\r\n|\r|\n/)) {
		if (raw === prefix || raw === prefix.trimEnd() || (raw === '' && !prefix.includes('>'))) {
			out.push('');
			continue;
		}
		if (!raw.startsWith(prefix)) return null;
		const rest = raw.slice(prefix.length);
		out.push(bare && rest.startsWith(' ') ? rest.slice(1) : rest);
	}
	return out;
}

const editFn = (op: Op) => (b: string): { ok: true; body: string } | { ok: false; reason: string } => {
	const r = applyOp(b, op);
	return r.ok ? { ok: true, body: r.body } : { ok: false, reason: r.code };
};

const hasLoneCr = (n: GenNote) => n.endings === 'mixed-cr';

describe('T3 (1) the generator itself', () => {
	it('is deterministic: the same seed gives the same note', () => {
		for (const seed of [7000, 7001, 7050]) expect(genNote(seed)).toEqual(genNote(seed));
	});

	it('reaches every kind of structure the brief names (a test that reaches nothing proves nothing)', () => {
		const seen = new Map<string, number>();
		const notes = SEEDS.map(genNote);
		for (const n of notes) for (const f of n.features) seen.set(f, (seen.get(f) ?? 0) + 1);
		const need = ['callouts 1', 'callouts 2', 'callouts 3', 'lists 1', 'lists 2', 'lists 3', 'numbered list', 'bullet list', 'tab indent', 'bare quote mark', 'top level', 'indented fence', 'fence on the marker line', 'callout on a marker line', 'callout and list on one marker line', 'lone CR before an empty line', 'tilde fence', 'long fence', 'info string variant', 'unclosed tree', 'unclosed decoy', 'bom', 'front matter', 'fence in front matter', 'decoy fence', 'decoy in a container', 'fence in a fence', 'indented code block', 'endings lf', 'endings crlf', 'endings mixed', 'endings mixed-cr'];
		for (const f of need) expect(seen.get(f) ?? 0, `feature "${f}" never generated: ${[...seen].map(([a, b]) => `${a}=${b}`).join(' ')}`).toBeGreaterThanOrEqual(DEEP ? 10 : 3);
		const trees = new Set(notes.map((n) => n.blocks.length));
		for (const k of [1, 2, 3]) expect(trees.has(k), `notes with ${k} trees`).toBe(true);
		expect(notes.filter((n) => n.clean).length).toBeGreaterThan(COUNT / 2);
		if (process.env.R030_SHOW) {
			const n = genNote(Number(process.env.R030_SHOW));
			console.log(`seed ${n.seed} ${n.features.join(', ')}\n${show(n)}\n${n.text.replace(/\r/g, '<CR>')}`);
		}
	});
});

describe('T3 (1) findBlocks finds exactly the real blocks', () => {
	it(`${COUNT} random notes: number, ordinal, fence lines, offsets, body, prefix and line ending`, () => {
		const bad: string[] = [];
		for (const seed of SEEDS) {
			const n = genNote(seed);
			const d = diffBlocks(findBlocks(n.text), n.blocks, hasLoneCr(n));
			if (d) bad.push(`seed ${seed} (${n.features.join(', ')}): ${d}\n  note: ${show(n)}`);
		}
		expect(bad.length, `${bad.length} of ${COUNT} notes differ. First:\n${bad.slice(0, Number(process.env.R030_MAX ?? 3)).join('\n')}`).toBe(0);
	});
});

interface Step {
	seed: number;
	step: number;
}

/**
 * One note, a few random edits one after the other. Returns the list of problems (empty if none), each with the seed
 * and the step. `strict`: the edit that the spec allows must be accepted (a clean note).
 */
function writeSequence(n: GenNote, steps: number): string[] {
	const problems: string[] = [];
	const rand = rng(n.seed + 99);
	let text = n.text;
	let blocks: RealBlock[] = n.blocks.map((b) => ({ ...b }));
	const models: Model[] = blocks.map((b) => modelOf(b.body).model);
	const counter = { n: 0 };
	const loneCr = hasLoneCr(n);
	const fail = (at: Step, what: string) => problems.push(`seed ${at.seed}, step ${at.step} (${n.features.join(', ')}): ${what}`);
	for (let step = 1; step <= steps; step++) {
		const at: Step = { seed: n.seed, step };
		const ordinal = Math.floor(rand() * blocks.length);
		const blk = blocks[ordinal];
		const g = genOp(rand, models[ordinal], counter);
		const out = g.ref(models[ordinal]);
		const plan = planWrite(text, ordinal, blk.body, editFn(g.op));
		const label = `${g.kind} ${clip(JSON.stringify(g.op), 160)} on block ${ordinal}`;

		if (!out.ok) {
			// The reference of r028 still has the old limit of 2 rumoured parents; D200 P1 (spec §8) allows 8. Not the subject of this test.
			const oldLimit = out.code === 'limit' && JSON.stringify(g.op).includes('"rumoured"');
			if (plan.ok && !oldLimit) fail(at, `${label}: the spec refuses ("${out.code}"), the plugin wrote`);
			continue;
		}
		if (!plan.ok) {
			// (4) On a clean note an edit that the spec allows is never refused.
			if (n.clean) fail(at, `${label}: refused with ${plan.code === 'rejected' ? plan.reason : plan.code}, the spec allows it`);
			// Even a refusal must be safe: it has no text, so nothing is written.
			continue;
		}

		// (2) Every byte outside the body.
		const before = text.slice(0, blk.bodyStart);
		const after = text.slice(blk.bodyEnd);
		if (!plan.newText.startsWith(before)) {
			fail(at, `${label}: the text before the body changed`);
			break;
		}
		if (!plan.newText.endsWith(after) || plan.newText.length < before.length + after.length) {
			fail(at, `${label}: the text after the body changed`);
			break;
		}
		const region = plan.newText.slice(before.length, plan.newText.length - after.length);
		const read = readRegion(region, blk.prefix);
		if (!read || read.join('\n') !== plan.newBody) {
			fail(at, `${label}: the new body lines in the note do not read back as the new body (prefix ${JSON.stringify(blk.prefix)})\n  region: ${JSON.stringify(region)}\n  body: ${JSON.stringify(plan.newBody)}`);
			break;
		}
		// The line endings of the new lines follow the note when the note has one kind.
		if (n.endings === 'lf' && plan.newText.includes('\r')) fail(at, `${label}: a carriage return in an LF note`);
		if (n.endings === 'crlf' && plan.newText.replace(/\r\n/g, '').match(/[\r\n]/)) fail(at, `${label}: a bare line break in a CRLF note`);

		// (3) The generator's knowledge, moved by the change, and `findBlocks` agree.
		const oldLines = blk.body.split('\n').length;
		const newLines = plan.newBody.split('\n').length;
		const dLines = newLines - oldLines;
		const dChars = region.length - (blk.bodyEnd - blk.bodyStart);
		blocks = blocks.map((b, i) => {
			if (i < ordinal) return b;
			if (i === ordinal) return { ...b, body: plan.newBody, bodyEnd: b.bodyEnd + dChars, closeLine: b.closeLine === null ? null : b.closeLine + dLines };
			return { ...b, openLine: b.openLine + dLines, closeLine: b.closeLine === null ? null : b.closeLine + dLines, bodyStart: b.bodyStart + dChars, bodyEnd: b.bodyEnd + dChars };
		});
		text = plan.newText;
		const d = diffBlocks(findBlocks(text), blocks, loneCr);
		if (d) {
			fail(at, `${label}: after the write ${d}`);
			break;
		}
		models[ordinal] = modelOf(plan.newBody).model;
	}

	// (5) A write over a body that is not the body in the note is refused as stale, and gives no text.
	if (blocks.length > 0 && problems.length === 0) {
		const stale = planWrite(text, 0, `${blocks[0].body}\n# not the body`, editFn({ kind: 'set-person-fields', id: 'p0', fields: { name: 'X' } }));
		if (stale.ok || stale.code !== 'stale') problems.push(`seed ${n.seed}: a write over another body was not refused as stale: ${JSON.stringify(stale.ok ? 'written' : stale.code)}`);
		const missing = planWrite(text, blocks.length, blocks[0].body, editFn({ kind: 'set-person-fields', id: 'p0', fields: { name: 'X' } }));
		if (missing.ok || missing.code !== 'missing') problems.push(`seed ${n.seed}: a write at an ordinal that is not there was not refused as missing`);
	}
	return problems;
}

describe('T3 (2, 3, 4, 5) random edits through planWrite', () => {
	it(`${COUNT} random notes, up to 4 edits each: bytes outside the body, the body lines, the blocks after the write, no refusal on a clean note`, () => {
		const problems: string[] = [];
		let writes = 0;
		for (const seed of SEEDS) {
			const n = genNote(seed);
			if (n.blocks.length === 0) continue;
			const rand = rng(seed + 5);
			const p = writeSequence(n, 1 + Math.floor(rand() * 4));
			writes++;
			problems.push(...p);
		}
		expect(writes).toBeGreaterThan(COUNT / 3);
		expect(problems.length, `${problems.length} problems. First:\n${problems.slice(0, Number(process.env.R030_MAX ?? 3)).join('\n')}`).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------------------
// Findings of package D. Each test states what the spec requires (§6.1). The faults were fixed
// in WP-J of 0.3 (15be3014; the tests are plain `it`; D286 removed the last `it.fails` words). The random
// notes above avoid these three shapes on purpose (see `r030-d-note-gen.ts`); the shapes are written by hand here.

describe('T3 findings (known faults, minimal notes)', () => {

	it('F1 a list that starts on the marker line of a list item inside a callout that starts there too ("- > -    item") hides the fence below it', () => {
		// CommonMark: the fence is inside the inner list item (content column 5 inside the callout), so it is a block.
		const text = ['- > -    item', '  >      ```kin', '  >      people: []', '  >      ```', ''].join('\n');
		const found = findBlocks(text);
		expect(found.map((b) => [b.openLine, b.closeLine, b.body])).toEqual([[1, 3, 'people: []']]);
	});

	it('F3 a line ending of a lone CR next to a blank line: the edit is refused (CR, empty line, LF read as one CRLF) in a note that the spec allows to edit', () => {
		const body = 'people:\n  - id: a\n    name: A\n\nx-end: 1';
		// Break after "  - id: a" is a lone CR; the blank line ends with LF.
		const text = '```kin\npeople:\n  - id: a\r    name: A\n\nx-end: 1\n```\n';
		const block = findBlocks(text)[0];
		expect(block.body).toBe(body);
		const plan = planWrite(text, 0, body, editFn({ kind: 'set-person-fields', id: 'a', fields: { name: 'Ab' } }));
		expect(plan.ok, JSON.stringify(plan)).toBe(true);
	});

	it('F4 a thematic break written "- - -" is read as nested list items: a fence indented by 3 spaces after it is not closed by "```" at the margin and swallows the next tree', () => {
		// CommonMark: "- - -" is a thematic break (it wins over a list item), so the fence below is a top level fence with a 3 space indent.
		const text = ['- - -', '', '   ```kin', '   people: []', '```', '', '```kin', 'people: [] # second', '```', ''].join('\n');
		const found = findBlocks(text);
		expect(found.map((b) => [b.openLine, b.closeLine, b.body])).toEqual([
			[2, 4, 'people: []'],
			[6, 8, 'people: [] # second'],
		]);
	});

	it('the same notes without the fault shape are found (the shapes above are the only cause)', () => {
		// F1 with a gap that keeps the inner content column at 3 or less: found.
		const near = ['- > - item', '  >   ```kin', '  >   people: []', '  >   ```', ''].join('\n');
		expect(findBlocks(near).map((b) => b.body)).toEqual(['people: []']);
		// F4 with "---": found, and the second tree too.
		const rule = ['---', '', '   ```kin', '   people: []', '```', '', '```kin', 'people: [] # second', '```', ''].join('\n');
		expect(findBlocks(`# t\n\n${rule}`).map((b) => b.body)).toEqual(['people: []', 'people: [] # second']);
		// F3 with CRLF and with LF only: accepted.
		for (const eol of ['\n', '\r\n']) {
			const text = ['```kin', 'people:', '  - id: a', '    name: A', '', 'x-end: 1', '```', ''].join(eol);
			const plan = planWrite(text, 0, 'people:\n  - id: a\n    name: A\n\nx-end: 1', editFn({ kind: 'set-person-fields', id: 'a', fields: { name: 'Ab' } }));
			expect(plan.ok, JSON.stringify(eol)).toBe(true);
		}
	});
});
