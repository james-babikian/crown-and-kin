/*
 * T16 (the 0.3 contract E.4, the release plan W8): new code reads old trees.
 *
 * `tests/old-trees/` holds a copy of every sample tree of the tags v0.1.0 and v0.2.0, each with its tag in a header comment.
 * The copies use the old block word `dynasty`; they are not edited, and `support/old-tag.ts` reads them with the word `kin`
 * (0.3.1, D167). For every tree block in them this test checks that:
 * 1. the block parses and draws headless (or fails with the same hard error as before);
 * 2. its warnings equal the baseline in `tests/old-trees/baseline.json`, the warnings of the code of version 0.2.8
 *    (`main` when the file was recorded) for the same text. A change in a warning is a change in what the reader says
 *    about an old tree, so it needs a decision and a new baseline: run `RECORD_OLD_TREES=1 npx vitest run tests/old-trees.test.ts`;
 * 3. an edit through the ops changes only the lines of the edited item, in the whole note, and the reverse edit restores
 *    the bytes of the note.
 *
 * The other direction (old code reads new trees, W8): 0.3 adds no key to the format, so every key of a new tree is a key
 * that 0.2.8 reads. That the plugin keeps a key it does not know at every level is tested in the existing unknown-key tests
 * (for example `acceptance/title-ops.test.ts`, `acceptance/houses-ops.test.ts`, `acceptance/me-option.test.ts` and `acceptance/r027-childless.test.ts`); the tests
 * below add the keys that Format 1 reserves.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseDocument, isMap, isSeq } from 'yaml';
import { describe, expect, it } from 'vitest';
import { svgHash } from './acceptance/m11-support';
import { oldTag } from './support/old-tag';
import { findBlocks } from '../src/core/block-locate';
import { planWrite } from '../src/core/block-write';
import { deriveFamilies } from '../src/core/derive';
import { hardErrorText, issueText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import type { Op } from '../src/core/edit';

const ROOT = 'tests/old-trees';
const BASELINE = `${ROOT}/baseline.json`;
const TAGS = ['v0.1.0', 'v0.2.0'] as const;

interface BlockBaseline {
	/** `error` is a hard error: the tree does not draw, and `text` is the error box. */
	status: 'ok' | 'error';
	text?: string;
	warnings: { level: string; code: string; text: string }[];
}

const files = TAGS.flatMap((tag) => readdirSync(`${ROOT}/${tag}`).filter((f) => f.endsWith('.md')).sort().map((f) => ({ tag, file: f, key: `${tag}/${f}`, note: oldTag(readFileSync(`${ROOT}/${tag}/${f}`, 'utf8')) })));

function summarise(body: string): BlockBaseline {
	const parsed = parseDynasty(body);
	if (!parsed.ok) return { status: 'error', text: hardErrorText(parsed.error), warnings: [] };
	const g = deriveFamilies(parsed.tree);
	return { status: 'ok', warnings: g.issues.map((i) => ({ level: i.level, code: i.code, text: issueText(i) })) };
}

const current: Record<string, BlockBaseline[]> = {};
for (const f of files) current[f.key] = findBlocks(f.note).map((b) => summarise(b.body));

if (process.env.RECORD_OLD_TREES) writeFileSync(BASELINE, JSON.stringify(current, null, '\t') + '\n');
const recorded = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, BlockBaseline[]>;

describe('old sample trees: the copies', () => {
	it('every tree has its tag in the header comment, and the tags hold the trees they should', () => {
		expect(files.filter((f) => f.tag === 'v0.1.0')).toHaveLength(11);
		expect(files.filter((f) => f.tag === 'v0.2.0')).toHaveLength(16);
		for (const f of files) expect(f.note.split('\n', 1)[0]).toBe(`<!-- Old sample tree: a copy of fixtures/${f.file} at the tag ${f.tag}. Do not edit. -->`);
	});

	it('the baseline has an entry for every block of every tree', () => {
		expect(existsSync(BASELINE)).toBe(true);
		expect(Object.keys(recorded).sort()).toEqual(files.map((f) => f.key).sort());
		for (const f of files) expect(recorded[f.key]).toHaveLength(findBlocks(f.note).length);
	});
});

const done = { edits: 0, refused: 0, reversed: 0 };

describe.each(files)('old sample tree $key', ({ key, note }) => {
	const blocks = findBlocks(note);

	it('has tree blocks', () => {
		expect(blocks.length).toBeGreaterThan(0);
	});

	it('parses and draws headless, or gives the recorded hard error', () => {
		blocks.forEach((b, i) => {
			const hash = svgHash(b.body);
			if (recorded[key][i].status === 'error') expect(hash).toBe('error');
			else expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	it('gives the warnings of the baseline', () => {
		expect(blocks.map((b) => summarise(b.body))).toEqual(recorded[key]);
	});

	it('an edit through the ops changes only the lines of the edited item, and the reverse edit restores the note', () => {
		blocks.forEach((b, ordinal) => {
			const parsed = parseDynasty(b.body);
			if (!parsed.ok) return;
			const tree = parsed.tree;
			const ids = new Map<string, number>();
			for (const p of tree.people) ids.set(p.id, (ids.get(p.id) ?? 0) + 1);
			const person = tree.people.find((p) => !p.id.startsWith('~') && ids.get(p.id) === 1 && p.notes === undefined);
			const house = tree.houses.find((h) => tree.houses.filter((x) => x.id === h.id).length === 1);
			const title = (tree.titles ?? []).find((t) => (tree.titles ?? []).filter((x) => x.id === t.id).length === 1);
			const cases: { op: Op; undo: Op | null; section: 'people' | 'houses' | 'titles'; index: number }[] = [];
			if (person) cases.push({ op: { kind: 'set-person-fields', id: person.id, fields: { notes: 'Old tree test.' } }, undo: { kind: 'set-person-fields', id: person.id, fields: { notes: null } }, section: 'people', index: person.index });
			if (house) cases.push({ op: { kind: 'edit-house', id: house.id, name: 'Old tree test house' }, undo: null, section: 'houses', index: tree.houses.indexOf(house) });
			if (title) cases.push({ op: { kind: 'edit-title', id: title.id, name: 'Old tree test title' }, undo: null, section: 'titles', index: title.index });
			for (const c of cases) {
				const written = planWrite(note, ordinal, b.body, (body) => {
					const e = applyOp(body, c.op);
					return e.ok ? { ok: true, body: e.body } : { ok: false, reason: e.code };
				});
				// A refusal is allowed only for a tree that editing is off for (blocking issues).
				if (!written.ok) {
					done.refused++;
					expect(deriveFamilies(tree).issues.some((i) => i.level === 'blocking')).toBe(true);
					continue;
				}
				done.edits++;
				const region = changedLines(note, written.newText);
				const item = itemLines(note, b.openLine + 1, b.body, c.section, c.index);
				expect(item).toBeDefined();
				expect(region.start).toBeGreaterThanOrEqual(item!.start);
				expect(region.end).toBeLessThanOrEqual(item!.end + 1);
				if (c.undo) {
					const back = planWrite(written.newText, ordinal, written.newBody, (body) => {
						const e = applyOp(body, c.undo!);
						return e.ok ? { ok: true, body: e.body } : { ok: false, reason: e.code };
					});
					expect(back.ok && back.newText).toBe(note);
					done.reversed++;
				}
			}
		});
	});
});

describe('the edit test ran', () => {
	it('made edits in most trees; a refusal happened only for a tree with blocking issues', () => {
		expect(done.edits).toBeGreaterThan(60);
		expect(done.reversed).toBeGreaterThan(30);
		expect(done.refused).toBeLessThan(done.edits);
	});
});

describe('Format 1 reserved keys survive an edit', () => {
	const body = [
		'options:',
		'  start: aldric',
		'  format: 2',
		'titles:',
		'  - id: duchy',
		'    name: Duchy',
		'    numbering: roman',
		'    count-with: duchy',
		'    holders:',
		'      - {person: aldric}',
		'people:',
		'  - id: aldric',
		'    name: Aldric',
		'    something-new: kept',
		'',
	].join('\n');

	it('options.format, numbering, count-with and a key from the future stay after an edit of a person and of a title', () => {
		const a = applyOp(body, { kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric II' } });
		if (!a.ok) throw new Error(a.code);
		const b = applyOp(a.body, { kind: 'edit-title', id: 'duchy', name: 'Duchy of Valmont' });
		if (!b.ok) throw new Error(b.code);
		for (const text of ['format: 2', 'numbering: roman', 'count-with: duchy', 'something-new: kept']) expect(b.body).toContain(text);
	});
});

/** The first and one-past-last line of `before` that differ from `after`, after the common first and last lines are cut. */
function changedLines(before: string, after: string): { start: number; end: number } {
	const x = before.split('\n');
	const y = after.split('\n');
	let start = 0;
	while (start < x.length && start < y.length && x[start] === y[start]) start++;
	let tail = 0;
	while (tail < x.length - start && tail < y.length - start && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
	return { start, end: x.length - tail };
}

/** The first and last line, in the note, of item `index` of the list `section` of a block body that starts at note line `firstLine`. */
function itemLines(_note: string, firstLine: number, body: string, section: string, index: number): { start: number; end: number } | undefined {
	const doc = parseDocument(body, { schema: 'failsafe', logLevel: 'silent' });
	const top = doc.contents;
	if (!isMap(top)) return undefined;
	const list = top.get(section, true);
	if (!isSeq(list)) return undefined;
	const item = list.items[index] as { range?: [number, number, number] } | undefined;
	if (!item?.range) return undefined;
	const lineOf = (offset: number) => body.slice(0, offset).split('\n').length - 1;
	return { start: firstLine + lineOf(item.range[0]), end: firstLine + lineOf(Math.max(item.range[0], item.range[1] - 1)) };
}
