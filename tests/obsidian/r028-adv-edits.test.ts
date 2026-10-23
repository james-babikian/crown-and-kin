import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
	class TFile {
		extension = 'md';
		constructor(public path: string) {}
	}
	class MarkdownView {}
	class Modal {}
	class Notice {}
	return { TFile, MarkdownView, Modal, Notice };
});

import { MarkdownView, TFile } from 'obsidian';
import { findBlocks } from '../../src/core/block-locate';
import { planWrite } from '../../src/core/block-write';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { rng } from '../support/r028-advb-gen';
import { FORMS, TOP_MARKS, baseBody, genOp, modelOf, tagsOf, type Base, type Form, type Gen, type Model } from '../support/r028-advb-edits-support';

/*
 * 0.2.8 adversarial round, target X4 (an internal note section 3), the pure layer: random sequences of edits on a note
 * that carries the tree in many forms. Written from spec §6.1 (locating, stale check, undo), §6.2 (minimal diff:
 * editing one person's field changes only that person's lines) and §6.3 to §6.10 (the edits). The checks:
 *
 * (1) every byte outside the body of the block stays the same, the fence lines and the prefix too, the line ending
 *     of the note too;
 * (2) after each edit the model equals the model before it with the intended change and nothing else (the reference
 *     of the support file, written from the spec); a refusal leaves the note as it was;
 * (3) comments and unknown keys of the nodes that stay survive;
 * (4) undo of the last write gives the body before it back, and the note text, exactly;
 * (5) a write over a body that changed after the read is refused as stale; a change outside the block is kept;
 * (6) a list keeps its form and its inner comments when an edit does not touch it.
 *
 * Seeds are fixed; every failure message prints the form, the seed and the step. Deep mode: R028_DEEP=1.
 */

const DEEP = process.env.R028_DEEP === '1';
// A test takes at most 30 s, also in deep mode (an internal note section 2); the normal run takes a few seconds.
vi.setConfig({ testTimeout: 30_000 });
const N = DEEP ? 4 : 1;
const OTHER = 'people:\n  - id: z0\n    name: Zed\n';

const editFn = (op: Op) => (b: string): { ok: true; body: string } | { ok: false; reason: string } => {
	const r = applyOp(b, op);
	return r.ok ? { ok: true, body: r.body } : { ok: false, reason: r.code };
};

/** JSON with the keys in order, so that two models written in different key orders compare equal. */
const stable = (x: unknown): string => JSON.stringify(x, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b))) : v));
const canon = (m: Model): string => stable(m);

/** The model with the ids of new houses wiped: the id of a new house comes from its name (§6.8) and the reference does not know it. */
function sameModel(got: Model, want: Model, order: 'exact' | 'subsequence'): string | null {
	const g = JSON.parse(JSON.stringify(got)) as Model;
	const w = JSON.parse(JSON.stringify(want)) as Model;
	for (const h of w.houses) if (h.id === '?') h.id = g.houses.find((x) => x.name === h.name && !w.houses.some((y) => y.id === x.id))?.id ?? '?';
	if (order === 'subsequence') {
		// The new person stands somewhere; the others keep their order.
		const ids = new Set(w.people.map((p) => p.id));
		if (g.people.length !== w.people.length) return 'the number of people';
		const gi = g.people.map((p) => p.id);
		const wi = w.people.map((p) => p.id);
		if ([...gi].sort().join() !== [...wi].sort().join()) return 'the set of people';
		const oldOrder = (xs: string[]) => xs.filter((x) => ids.has(x) && !x.startsWith('n'));
		if (oldOrder(gi).join() !== oldOrder(wi).join()) return 'the order of the old people';
		g.people.sort((a, b) => a.id.localeCompare(b.id));
		w.people.sort((a, b) => a.id.localeCompare(b.id));
	}
	return canon(g) === canon(w) ? null : `model differs at ${firstDiff(g, w, '')}`;
}

/** The first place where two plain values differ, as a path with both values. */
function firstDiff(a: unknown, b: unknown, path: string): string {
	if (stable(a) === stable(b)) return '';
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
		for (const k of keys) {
			const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
			if (d) return d;
		}
	}
	return `${path}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`;
}

interface Stats {
	kinds: Map<string, number>;
	refused: number;
	steps: number;
}

/** One sequence of edits through `planWrite` on a note of form `form`. Returns nothing; every check is an `expect`. */
type Style = 'plain' | 'indent4' | 'doc start' | 'indent3 and end marker';

/** The same body written another way: wider indent, a document start marker, a document end marker. */
function styled(body: string, style: Style): string {
	if (style === 'plain') return body;
	const spaces = (n: number) => ' '.repeat(n);
	// Every indent that is not zero grows by the same number of columns, so the keys of an item still line up with its dash.
	const wider = (n: number) => body.split('\n').map((l) => (l.startsWith(' ') ? spaces(n) + l : l)).join('\n');
	if (style === 'indent4') return wider(2);
	if (style === 'doc start') return `---\n${body}`;
	return `${wider(1)}\n...`;
}

function runSequence(seed: number, form: Form, steps: number, stats?: Stats, style: Style = 'plain'): void {
	const rand = rng(seed);
	const base: Base = baseBody(rand);
	base.body = styled(base.body, style);
	const { text: text0, ordinal } = form.wrap(base.body, OTHER);
	let text = text0;
	let body = findBlocks(text)[ordinal].body;
	const where = (step: number, g?: Gen) => `form "${form.name}", style "${style}", seed ${seed}, step ${step}${g ? `, ${g.kind} ${JSON.stringify(g.op)}` : ''}`;
	expect(body, where(0)).toBe(base.body);
	let model = modelOf(body).model;
	const registry = tagsOf(base).map((t) => ({ ...t }));
	const counter = { n: 0 };
	const nBlocks = findBlocks(text).length;

	for (let step = 1; step <= steps; step++) {
		const g = genOp(rand, model, counter);
		const before = findBlocks(text);
		const blk = before[ordinal];
		const plan = planWrite(text, ordinal, body, editFn(g.op));
		const out = g.ref(model);
		if (stats) {
			stats.kinds.set(g.kind, (stats.kinds.get(g.kind) ?? 0) + 1);
			stats.steps++;
		}
		if (!out.ok) {
			// A refusal named by the spec: nothing is written.
			expect(plan.ok, `${where(step, g)}: the spec refuses with "${out.code}", the plugin wrote\n${plan.ok ? plan.newBody : ''}`).toBe(false);
			if (!plan.ok) expect(out.code.split('|'), where(step, g)).toContain(plan.code === 'rejected' ? plan.reason : plan.code);
			if (stats) stats.refused++;
			continue;
		}
		if (!plan.ok) {
			throw new Error(`${where(step, g)}: refused with ${plan.code === 'rejected' ? plan.reason : plan.code}, the spec allows it\n${body}`);
		}
		const msg = where(step, g);
		// (1) Bytes outside the body of the block.
		expect(plan.newText.startsWith(text.slice(0, blk.bodyStart)), `${msg}: text before the body changed`).toBe(true);
		expect(plan.newText.endsWith(text.slice(blk.bodyEnd)), `${msg}: text after the body changed`).toBe(true);
		const after = findBlocks(plan.newText);
		expect(after.length, `${msg}: number of blocks`).toBe(nBlocks);
		expect(after[ordinal].openLine, `${msg}: the opening fence moved`).toBe(blk.openLine);
		expect(after[ordinal].prefix, `${msg}: the prefix changed`).toBe(blk.prefix);
		expect(after[ordinal].eol, `${msg}: the line ending changed`).toBe(blk.eol);
		before.forEach((b, i) => i !== ordinal && expect(after[i].body, `${msg}: another block changed`).toBe(b.body));
		if (blk.eol === '\r\n') expect(plan.newText.replace(/\r\n/g, '').includes('\n'), `${msg}: a bare line feed in a CRLF note`).toBe(false);
		else expect(plan.newText.includes('\r'), `${msg}: a carriage return in an LF note`).toBe(false);

		// (2) The model.
		const next = modelOf(plan.newBody);
		const diff = sameModel(next.model, out.model, out.order);
		expect(diff === null, `${msg}: ${diff}${process.env.R028_SHOW ? `\n--- before\n${body}\n--- after\n${plan.newBody}` : ''}`).toBe(true);

		// (3) Comments and unknown keys of the nodes that stay.
		for (const c of ['person', 'house', 'title'] as const) {
			const ids = new Set((c === 'person' ? next.model.people : c === 'house' ? next.model.houses : next.model.titles).map((x) => x.id));
			for (const t of registry) {
				if (t.kind !== c) continue;
				if (g.op.kind === 'set-house-id' && c === 'house' && t.id === g.op.id) t.id = g.op.newId;
				if (g.op.kind === 'set-title-id' && c === 'title' && t.id === g.op.id) t.id = g.op.newId;
				if (!ids.has(t.id)) continue;
				for (const mark of t.marks) if (body.includes(mark)) expect(plan.newBody.includes(mark), `${msg}: "${mark}" of ${c} ${t.id} is gone\n--- before\n${body}\n--- after\n${plan.newBody}`).toBe(true);
			}
		}
		for (const mark of TOP_MARKS) expect(plan.newBody.includes(mark), `${msg}: "${mark}" is gone`).toBe(true);

		// Minimal diff: a field edit of one person changes only the lines of that person (§6.2).
		if (g.op.kind === 'set-person-fields') {
			const removed = removedLines(body, plan.newBody);
			const own = itemLines(body, g.op.id);
			for (const l of removed) expect(own.includes(l), `${msg}: the line "${l}" of another node changed (own: ${JSON.stringify(own)})\n--- before\n${body}\n--- after\n${plan.newBody}`).toBe(true);
		}

		// Minimal diff: an edit that gives the same text writes nothing.
		if (g.idempotent && (step % 2 === 0 || DEEP)) {
			const again = applyOp(plan.newBody, g.op);
			expect(again.ok, `${msg}: the same edit twice`).toBe(true);
			if (again.ok) expect(again.body, `${msg}: the same edit twice changes the text`).toBe(plan.newBody);
		}

		text = plan.newText;
		body = plan.newBody;
		model = next.model;
	}
}

/** The lines of `before` that are not in `after`, as a multiset difference. */
function removedLines(before: string, after: string): string[] {
	const left = new Map<string, number>();
	for (const l of after.split('\n')) left.set(l, (left.get(l) ?? 0) + 1);
	const out: string[] = [];
	for (const l of before.split('\n')) {
		const c = left.get(l) ?? 0;
		if (c > 0) left.set(l, c - 1);
		else out.push(l);
	}
	return out;
}

/** The lines of the item of person `id` in `body`: its marker comment (if one stands right above it), the item, up to the next item, comment or key. */
function itemLines(body: string, id: string): string[] {
	const ls = body.split('\n');
	const head = new RegExp(`^( +)- (id: ${id}( |$)|\\{id: ${id}[,}])`);
	// A parent entry written as `- {id: p9, type: rumoured}` looks like a person: the person item is the least indented match.
	let at = -1;
	ls.forEach((l, i) => {
		if (head.test(l) && (at < 0 || head.exec(l)![1].length < head.exec(ls[at])![1].length)) at = i;
	});
	if (at < 0) return [];
	const indent = head.exec(ls[at])![1].length;
	const lead = (l: string) => l.length - l.trimStart().length;
	const start = at > 0 && /^ *# --- /.test(ls[at - 1]) && lead(ls[at - 1]) === indent ? at - 1 : at;
	let end = at + 1;
	while (end < ls.length && (ls[end].trim() === '' || lead(ls[end]) > indent)) end++;
	return ls.slice(start, end);
}

const SEEDS = (from: number, count: number) => Array.from({ length: count * N }, (_, i) => from + i);

describe('X4 (1, 2, 3, 6) random edit sequences on notes of many forms', () => {
	for (const form of FORMS) {
		it(`form "${form.name}": bytes outside the block, the model, comments, unknown keys, lists`, () => {
			const stats: Stats = { kinds: new Map(), refused: 0, steps: 0 };
			for (const seed of SEEDS(100, FORMS.indexOf(form) % 2 === 0 ? 2 : 1)) runSequence(seed * 7 + form.name.length, form, 20 + (seed % 8), stats);
			expect(stats.steps).toBeGreaterThan(15);
		});
	}

	for (const style of ['indent4', 'doc start', 'indent3 and end marker'] as const) {
		it(`style "${style}": the same checks on a body written another way`, () => {
			const stats: Stats = { kinds: new Map(), refused: 0, steps: 0 };
			for (const seed of SEEDS(1300, 2)) runSequence(seed, FORMS[seed % 2 ? 0 : 9], 18, stats, style);
			expect(stats.steps).toBeGreaterThan(15);
		});
	}

	it('the generator reaches every kind of edit and the refusals (a test that reaches nothing proves nothing)', () => {
		const stats: Stats = { kinds: new Map(), refused: 0, steps: 0 };
		for (const seed of SEEDS(900, 6)) runSequence(seed, FORMS[0], 30, stats);
		const kinds = [...stats.kinds.keys()];
		for (const k of ['fields', 'add-person', 'add-parent', 'remove-parent', 'set-parent-type', 'add-union', 'edit-union', 'remove-union', 'move-sibling', 'delete-person', 'set-option', 'edit-house', 'add-house', 'set-house-id', 'delete-house', 'add-title', 'edit-title', 'add-holder', 'remove-holder', 'edit-holder', 'set-title-id', 'delete-title']) {
			expect(kinds, `kind ${k} never generated: ${[...stats.kinds].map(([a, b]) => `${a}=${b}`).join(' ')}`).toContain(k);
		}
		expect(stats.refused, 'refusals reached').toBeGreaterThan(10);
	});
});

// ---------------------------------------------------------------------------------------------------------
// Odd values: a value written by an edit reads back, and never ends the block early

describe('X4 odd values: what an edit writes reads back (spec §6.2), and never changes where the tree ends', () => {
	const ODD = ['```', '~~~ x', '````', '> [!note]', '- item', '# heading', '---', '...', 'a: b', '{x}', '[y]', "'", '"', '\\', '#', '%', '@x', '`x', '*a', '&b', '!c', '|', '>', 'line1\nline2', 'tab\there', 'a b', 'a\rb', 'a\r\nb', '😀', 'x'.repeat(500), 'yes', 'null', '~', '1e3', '0x10', 'true', '"quoted"', "it's", 'a #b', 'a: b # c', '***', '\\n', 'é', '- ', '? x', ': x', '\n```\n', '\n~~~kin\n', 'x\n```\ny'];
	for (const form of [FORMS[0], FORMS[11]]) {
		it(`form "${form.name}": name, born, title and house name`, () => {
			const base = baseBody(rng(5));
			const { text, ordinal } = form.wrap(base.body, OTHER);
			const body = findBlocks(text)[ordinal].body;
			let bad = 0;
			for (const v of ODD) {
				for (const field of ['name', 'born', 'title'] as const) {
					const plan = planWrite(text, ordinal, body, editFn({ kind: 'set-person-fields', id: 'p2', fields: { [field]: v } }));
					const msg = `form "${form.name}", ${field} = ${JSON.stringify(v)}`;
					if (!plan.ok) {
						// A refusal is allowed (it is a safe answer); damage is not.
						expect(plan.code, msg).toBe('rejected');
						continue;
					}
					const after = findBlocks(plan.newText);
					expect(after.length, `${msg}: the number of blocks`).toBe(findBlocks(text).length);
					expect(plan.newText.startsWith(text.slice(0, findBlocks(text)[ordinal].bodyStart)), `${msg}: text before`).toBe(true);
					expect(after[ordinal].body, `${msg}: the body as the next read finds it`).toBe(plan.newBody);
					const p = modelOf(plan.newBody).model.people.find((q) => q.id === 'p2')!;
					const got = field === 'name' ? p.name : field === 'born' ? p.born : p.title;
					if (got !== v.trim()) {
						bad++;
						throw new Error(`${msg}: reads back as ${JSON.stringify(got)}\n${plan.newBody}`);
					}
				}
				const house = planWrite(text, ordinal, body, editFn({ kind: 'edit-house', id: 'h0', name: v }));
				if (house.ok) expect(modelOf(house.newBody).model.houses.find((h) => h.id === 'h0')!.name, `house name ${JSON.stringify(v)}`).toBe(v.trim());
			}
			expect(bad).toBe(0);
		});
	}
});

// ---------------------------------------------------------------------------------------------------------
// (6) lists keep their form

describe('X4 (6) a list keeps its form and its inner comments when an edit does not touch it', () => {
	const BODY = [
		'people:',
		'  - id: a',
		'    name: A',
		'    parents: [x, # the father',
		'      y] # both',
		'  - id: b',
		'    name: B',
		'    parents:',
		'      - a # block form',
		'      # between',
		'      - x',
		'  - id: x',
		'    name: X',
		'  - id: y',
		'    name: Y',
		'titles:',
		'  - id: t',
		'    name: T',
		'    heir: [a, # the first',
		'      b]',
		'    exclude:',
		'      - y # block list',
		'    holders:',
		'      - person: a # holder',
		'        from: 1100',
		'',
	].join('\n');
	const LISTS = ['    parents: [x, # the father', '      y] # both', '    parents:', '      - a # block form', '      # between', '      - x', '    heir: [a, # the first', '      b]', '    exclude:', '      - y # block list', '      - person: a # holder'];
	const OPS: Op[] = [
		{ kind: 'set-person-fields', id: 'x', fields: { name: 'Xavier', born: '1000' } },
		{ kind: 'set-person-fields', id: 'y', fields: { sex: 'f', sobriquet: 'the Late' } },
		{ kind: 'add-person', id: 'n1', fields: { name: 'New' } },
		{ kind: 'add-union', partners: ['x', 'y'], type: 'marriage' },
		{ kind: 'set-option', key: 'me', value: 'x' },
		{ kind: 'add-house', name: 'House New' },
		{ kind: 'edit-title', id: 't', name: 'Throne' },
		{ kind: 'add-title', id: 't2', name: 'Other' },
		{ kind: 'edit-title', id: 't', succession: 'eldest-child' },
	];
	it('edits that do not touch a list leave its lines as they were', () => {
		for (const op of OPS) {
			const r = applyOp(BODY, op);
			expect(r.ok, JSON.stringify(op)).toBe(true);
			if (!r.ok) continue;
			for (const l of LISTS) expect(r.body.split('\n'), `${JSON.stringify(op)}: the line "${l}" changed\n${r.body}`).toContain(l);
		}
	});
});

// ---------------------------------------------------------------------------------------------------------
// (4) undo and (5) stale writes, through the real handle on a fake vault

function fakeApp(path: string, initial: string) {
	let text = initial;
	const file = new (TFile as unknown as new (p: string) => { path: string; extension: string })(path);
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === path ? file : null),
			read: async () => text,
			process: async (_f: unknown, fn: (t: string) => string) => {
				const next = fn(text);
				if (next !== text) text = next;
				return text;
			},
		},
		workspace: { getLeavesOfType: () => [] as unknown[] },
	};
	return { app, get: () => text, set: (t: string) => (text = t) };
}

async function handleFor(reg: HandleRegistry, path: string, text: string, ordinal: number) {
	const b = findBlocks(text)[ordinal];
	void MarkdownView;
	return (await reg.resolve(path, { text, lineStart: b.openLine, lineEnd: b.closeLine ?? b.openLine + b.body.split('\n').length + 1 } as never, b.body))!;
}

describe('X4 (4) undo gives the earlier body and the earlier note back, exactly', () => {
	for (const form of FORMS.filter((_, i) => i % 3 === 0)) {
		it(`form "${form.name}": up to 18 edits, then undo all of them`, async () => {
			for (const seed of SEEDS(300, 1)) {
				const rand = rng(seed + form.name.length);
				const base = baseBody(rand);
				const { text, ordinal } = form.wrap(base.body, OTHER);
				const fake = fakeApp('n.md', text);
				const reg = new HandleRegistry(fake.app as never);
				const h = await handleFor(reg, 'n.md', text, ordinal);
				expect(h.body, `seed ${seed}`).toBe(base.body);
				const texts: string[] = [text];
				const bodies: string[] = [h.body];
				let model = modelOf(h.body).model;
				const counter = { n: 0 };
				for (let step = 1; step <= 18; step++) {
					const g = genOp(rand, model, counter);
					const out = g.ref(model);
					const r = await h.write(g.op);
					const msg = `form "${form.name}", seed ${seed}, step ${step}, ${g.kind} ${JSON.stringify(g.op)}`;
					if (!out.ok) {
						expect(r.ok, msg).toBe(false);
						expect(fake.get(), `${msg}: a refusal changed the note`).toBe(texts[texts.length - 1]);
						continue;
					}
					expect(r.ok, `${msg}: ${r.ok ? '' : JSON.stringify(r)}`).toBe(true);
					if (fake.get() !== texts[texts.length - 1]) {
						texts.push(fake.get());
						bodies.push(h.body);
					}
					model = modelOf(h.body).model;
				}
				expect(h.undoSize, `seed ${seed}: undo entries for the writes that changed the note`).toBe(texts.length - 1);
				for (let i = texts.length - 1; i >= 1; i--) {
					expect(h.canUndo, `seed ${seed}: can undo at ${i}`).toBe(true);
					const u = await h.undo();
					expect(u.ok, `form "${form.name}", seed ${seed}: undo ${i}`).toBe(true);
					expect(fake.get(), `form "${form.name}", seed ${seed}: the note after undo ${i}`).toBe(texts[i - 1]);
					expect(h.body, `seed ${seed}: the body after undo ${i}`).toBe(bodies[i - 1]);
				}
				expect(fake.get(), `form "${form.name}", seed ${seed}: all undone`).toBe(text);
				const none = await h.undo();
				expect(none.ok).toBe(false);
			}
		});
	}
});

describe('X4 (5) a write over a body that changed after the read is refused as stale', () => {
	for (const form of [FORMS[0], FORMS[4], FORMS[11], FORMS[15]]) {
		it(`form "${form.name}": a change inside the block is refused, a change outside is kept`, async () => {
			for (const seed of SEEDS(500, 2)) {
				const rand = rng(seed);
				const base = baseBody(rand);
				const { text, ordinal } = form.wrap(base.body, OTHER);
				const fake = fakeApp('n.md', text);
				const reg = new HandleRegistry(fake.app as never);
				const h = await handleFor(reg, 'n.md', text, ordinal);
				const g = genOp(rand, modelOf(h.body).model, { n: 0 });
				// A sync changes the text of the note outside the block: the write goes through and keeps that change.
				const outside = text.replace('Some text', 'Other words');
				fake.set(outside);
				const first = await h.write({ kind: 'set-person-fields', id: 'p1', fields: { name: 'Outside' } });
				expect(first.ok, `form "${form.name}", seed ${seed}: a change outside the block`).toBe(true);
				expect(fake.get().includes('Other words'), `form "${form.name}", seed ${seed}: the change outside the block was lost`).toBe(true);
				// A sync changes the body: the write is refused, the note stays as the sync made it.
				const b = findBlocks(fake.get())[ordinal];
				const changed = fake.get().slice(0, b.bodyEnd) + (b.closeLine === null ? '\n# edited elsewhere' : '\n# edited elsewhere') + fake.get().slice(b.bodyEnd);
				const insideOk = findBlocks(changed)[ordinal]?.body.includes('# edited elsewhere');
				if (!insideOk) continue;
				fake.set(changed);
				const second = await h.write(g.op);
				expect(second.ok, `form "${form.name}", seed ${seed}: a write over a changed body must be refused (${g.kind})`).toBe(false);
				if (!second.ok) expect(second.code, `form "${form.name}", seed ${seed}`).toBe('stale');
				expect(fake.get(), `form "${form.name}", seed ${seed}: the refused write changed the note`).toBe(changed);
				// The handle read the new body: the next write works on it and keeps the sync's change.
				const third = await h.write({ kind: 'set-person-fields', id: 'p2', fields: { name: 'After' } });
				expect(third.ok, `form "${form.name}", seed ${seed}: the write after the re-read`).toBe(true);
				expect(fake.get().includes('# edited elsewhere'), `form "${form.name}", seed ${seed}: the sync's change was lost`).toBe(true);
			}
		});
	}
});

// ---------------------------------------------------------------------------------------------------------
// Failing proof T-X4-01 (scratch/r028-test-x4). Not for the passing branch until the supervisor rules.

describe('T-X4-01 a fence inside front matter is not a block, also when the note starts with a byte order mark (spec question)', () => {
	it('T-X4-01: the tree after a BOM and front matter with a fenced example is block number 0', () => {
		const tree = 'people:\n  - id: a\n    name: Aldric';
		const matter = '---\ndescription: |\n  ```kin\n  people: []\n  ```\n---\n';
		const plain = findBlocks(`${matter}\`\`\`kin\n${tree}\n\`\`\`\n`);
		const withBom = findBlocks(`﻿${matter}\`\`\`kin\n${tree}\n\`\`\`\n`);
		expect(plain.map((b) => b.body), 'without a BOM').toEqual([tree]);
		expect(withBom.map((b) => b.body), 'with a BOM').toEqual([tree]);
	});
});
