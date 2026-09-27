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
import { findBlocks } from '../src/core/block-locate';
import { HandleRegistry } from '../src/obsidian/block-handle';

/*
 * Write-path rules of the version 1.0.1 area B fix round (the decision notes "Version 1.0.1"): a copy of a
 * block is not the block moved (1), a `missing` write is retried like a stale one (3), and a write
 * that changes nothing leaves no trace (4).
 */

/** A vault with one note. With `editor`, the note is open in Live Preview and writes go through it. */
function fakeApp(path: string, initial: string, editor = false) {
	let text = initial;
	const calls = { process: 0, dispatch: 0, transaction: 0 };
	const file = new (TFile as unknown as new (p: string) => { path: string; extension: string })(path);
	const leaves: { view: unknown }[] = [];
	if (editor) {
		const view = Object.assign(new (MarkdownView as unknown as new () => object)(), {
			file,
			getMode: () => 'source',
			editor: {
				getValue: () => text,
				offsetToPos: (o: number) => o,
				transaction: () => calls.transaction++,
				cm: {
					get state() {
						return { doc: { length: text.length } };
					},
					dispatch: (t: { changes: { from: number; to: number; insert: string } }) => {
						calls.dispatch++;
						text = text.slice(0, t.changes.from) + t.changes.insert + text.slice(t.changes.to);
					},
				},
			},
		});
		leaves.push({ view });
	}
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === path ? file : null),
			read: async () => text,
			// Like Obsidian: the same text back means no file write.
			process: async (_f: unknown, fn: (t: string) => string) => {
				const next = fn(text);
				if (next !== text) {
					calls.process++;
					text = next;
				}
				return text;
			},
		},
		workspace: { getLeavesOfType: () => leaves },
	};
	return { app, calls, get: () => text, set: (t: string) => (text = t) };
}

const fence = (body: string) => ['```dynasty', body, '```'].join('\n');
const X = 'people:\n  - id: a\n    name: Alys';
const Y = 'people:\n  - id: y\n    name: Yara';
const queen = { kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } } as const;

/** The handle of block `ordinal` of `text`, taken as a view of that block would take it. */
async function handleOf(reg: HandleRegistry, path: string, text: string, ordinal: number) {
	const b = findBlocks(text)[ordinal];
	return (await reg.resolve(path, { text, lineStart: b.openLine, lineEnd: b.openLine + b.body.split('\n').length + 1 } as never, b.body))!;
}

describe('a copy of a block is not the block moved (area B (1))', () => {
	it('the original block deleted, its copy kept lower down: the stale write aborts and the copy stays as it was', async () => {
		const t0 = [fence(X), '', fence(Y), '', 'Copy:', '', fence(X), ''].join('\n');
		const v = fakeApp('n.md', t0);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		expect(h.key.ordinal).toBe(0);
		const t1 = [fence(Y), '', 'Copy:', '', fence(X), ''].join('\n');
		v.set(t1);
		const out = await h.write(queen);
		expect(out).toMatchObject({ ok: false, code: 'stale' });
		expect(h.detached).toBe(true);
		expect(v.get()).toBe(t1);
	});

	it('the original block deleted, the note read again: the handle is detached and does not write the copy', async () => {
		const t0 = [fence(X), '', 'Copy:', '', fence(X), ''].join('\n');
		const v = fakeApp('n.md', t0);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		const t1 = ['Copy:', '', fence(X), ''].join('\n');
		v.set(t1);
		await reg.sync('n.md');
		expect(h.detached).toBe(true);
		expect(await h.write(queen)).toMatchObject({ ok: false, code: 'missing' });
		expect(v.get()).toBe(t1);
	});

	it('two different blocks swapped: the handle follows its block and writes it', async () => {
		const t0 = [fence(X), '', fence(Y), ''].join('\n');
		const v = fakeApp('n.md', t0);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		v.set([fence(Y), '', fence(X), ''].join('\n'));
		const out = await h.write(queen);
		expect(out.ok).toBe(true);
		expect(h.key.ordinal).toBe(1);
		const [b0, b1] = findBlocks(v.get());
		expect(b0.body).toBe(Y);
		expect(b1.body).toContain('title: Queen');
	});

	it('a write makes its block a copy of another: an edit of the other block later is not a move', async () => {
		const W = X + '\n    title: Queen';
		const t0 = [fence(X), '', fence(W), ''].join('\n');
		const v = fakeApp('n.md', t0);
		const reg = new HandleRegistry(v.app as never);
		const h0 = await handleOf(reg, 'n.md', t0, 0);
		const h1 = await handleOf(reg, 'n.md', t0, 1);
		expect((await h0.write(queen)).ok).toBe(true);
		expect(h0.body).toBe(W);
		// Block 1 is edited in place. Block 0 held W before this change too, so h1 stays on block 1.
		const t1 = [fence(W), '', fence(W.replace('Alys', 'Alys of the Vale')), ''].join('\n');
		v.set(t1);
		reg.applyText('n.md', t1);
		expect([h0.key.ordinal, h0.detached]).toEqual([0, false]);
		expect([h1.key.ordinal, h1.detached]).toEqual([1, false]);
	});
});

describe('a missing write is retried under the same rules (area B (3))', () => {
	it('the last block, a copy of it removed above: the handle cannot tell them apart and does not write', async () => {
		const t0 = [fence(X), '', fence(Y), '', fence(X), ''].join('\n');
		const v = fakeApp('n.md', t0);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 2);
		expect(h.key.ordinal).toBe(2);
		const t1 = [fence(Y), '', fence(X), ''].join('\n');
		v.set(t1);
		const out = await h.write(queen);
		expect(out).toMatchObject({ ok: false, code: 'missing' });
		expect(v.get()).toBe(t1);
	});
});

describe('a write that changes nothing (area B (4))', () => {
	it('set-option to the current value: written, but no file write, no undo step and no event', async () => {
		const t0 = ['# Note', '', fence('options:\n  generations: 3\n' + X), ''].join('\n');
		const v = fakeApp('n.md', t0);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		const events: string[] = [];
		h.onChanged((b) => events.push(b));
		const out = await h.write({ kind: 'set-option', key: 'generations', value: 3 });
		expect(out.ok).toBe(true);
		expect(v.get()).toBe(t0);
		expect(v.calls.process).toBe(0);
		expect(h.undoSize).toBe(0);
		expect(h.lastWritePath).toBeNull();
		expect(events).toEqual([]);
		expect(reg.undoTarget('n.md')).toBeNull();
	});

	it('in an open editor: no editor change, and "Undo last tree edit" keeps its target', async () => {
		const t0 = [fence(X), '', fence(Y), ''].join('\n');
		const v = fakeApp('n.md', t0, true);
		const reg = new HandleRegistry(v.app as never);
		const h0 = await handleOf(reg, 'n.md', t0, 0);
		const h1 = await handleOf(reg, 'n.md', t0, 1);
		expect((await h0.write(queen)).ok).toBe(true);
		expect(v.calls.dispatch).toBe(1);
		const after = v.get();
		// The same value again in the other block's own terms: set Yara's name to Yara.
		const same = await h1.write({ kind: 'set-person-fields', id: 'y', fields: { name: 'Yara' } });
		expect(same.ok).toBe(true);
		expect(v.get()).toBe(after);
		expect(v.calls.dispatch).toBe(1);
		expect(v.calls.transaction).toBe(0);
		expect(h1.undoSize).toBe(0);
		expect(reg.undoTarget('n.md')).toBe(h0);
	});
});
