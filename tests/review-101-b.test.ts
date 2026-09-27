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

import { TFile } from 'obsidian';
import { findBlocks } from '../src/core/block-locate';
import { applyOp } from '../src/core/yaml-edit';
import { HandleRegistry } from '../src/obsidian/block-handle';

/*
 * Review of version 1.0.1, area B (the write path), on scratch/review-101-b. Each test shows one
 * defect and fails on release-1.0.1 (d23ba64).
 */

/** A vault with one note, no open editors: writes go through `vault.process`. */
function fakeApp(path: string, initial: string) {
	let text = initial;
	const file = new (TFile as unknown as new (p: string) => { path: string; extension: string })(path);
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === path ? file : null),
			read: async () => text,
			process: async (_f: unknown, fn: (t: string) => string) => {
				text = fn(text);
				return text;
			},
		},
		workspace: { getLeavesOfType: () => [] },
	};
	return { app, get: () => text, set: (t: string) => (text = t) };
}

const fence = (body: string) => ['```dynasty', body, '```'].join('\n');
const X = 'people:\n  - id: a\n    name: Alys';

describe('review 101-b: a stale write must not land in another block', () => {
	it('an edit in source of block 0 aborts the write; it does not write into an identical copy in block 1', async () => {
		const path = 'n.md';
		// Two identical trees (a copy kept lower in the note). Only block 0 is drawn, so only it has a handle.
		const t0 = ['# Note', '', fence(X), '', 'Copy:', '', fence(X), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h0 = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, X))!;
		expect(h0.key.ordinal).toBe(0);

		// The user (or sync) changes block 0 in the note text. Block 1 is not touched.
		const edited = X.replace('Alys', 'Alys of the Vale');
		v.set(['# Note', '', fence(edited), '', 'Copy:', '', fence(X), ''].join('\n'));

		// The open sheet of block 0 saves a field change.
		const out = await h0.write({ kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } });

		// Spec §6.1: the body differs from expectedBody, so the write aborts.
		const [b0, b1] = findBlocks(v.get());
		expect(b0.body).toBe(edited);
		expect(b1.body).toBe(X); // fails: block 1 (the copy) now holds "title: Queen"
		expect(out.ok).toBe(false);
	});
});

describe('review 101-b: a write after a block above was removed', () => {
	const Y = 'people:\n  - id: y\n    name: Yara';
	const Z = 'people:\n  - id: z\n    name: Zed';

	it('control: the handle of the middle block of three follows its block (stale, then one retry)', async () => {
		const path = 'n.md';
		const t0 = [fence(Y), '', fence(X), '', fence(Z), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 6, lineEnd: 10 } as never, X))!;
		expect(h.key.ordinal).toBe(1);
		v.set([fence(X), '', fence(Z), ''].join('\n'));
		const out = await h.write({ kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } });
		expect(out.ok).toBe(true);
	});

	it('the handle of the last block also follows its block (today: "missing", no retry)', async () => {
		const path = 'n.md';
		const t0 = [fence(Y), '', fence(X), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 6, lineEnd: 10 } as never, X))!;
		expect(h.key.ordinal).toBe(1);
		// Block 0 is removed (sync, or an edit in another pane); the 'modify' sync has not run yet.
		v.set([fence(X), ''].join('\n'));
		const out = await h.write({ kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } });
		// The handle moved to ordinal 0 during the failed first try, and the retry wrote there.
		// (Fix round: the proof expected `h.body` to stay X, which only holds if the write fails.)
		expect(h.key.ordinal).toBe(0);
		expect(out).toMatchObject({ ok: true }); // failed before the fix: { ok: false, code: 'missing' }
		expect(h.body).toBe(findBlocks(v.get())[0].body);
		expect(h.body).toContain('title: Queen');
	});
});

describe('review 101-b: a write that changes nothing', () => {
	it('adds no undo step, so "Undo last tree edit" undoes the last real edit', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', fence(X), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, X))!;
		const real = await h.write({ kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } });
		expect(real.ok).toBe(true);
		const afterReal = v.get();
		// The same value again (applyOp answers ok with the body unchanged).
		const same = await h.write({ kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } });
		expect(same.ok).toBe(true);
		expect(v.get()).toBe(afterReal);
		expect(h.undoSize).toBe(1); // fails: 2 (an entry whose before and after are the same body)
		const u = await h.undo();
		expect(u.ok).toBe(true);
		expect(findBlocks(v.get())[0].body).toBe(X); // one undo must remove "title: Queen"
	});
});

describe('review 101-b: add-house keeps the comments of the last house with that house', () => {
	it('a full-line comment under the last house stays under it, not under the new house', () => {
		const body = ['houses:', '  - id: h', '    name: H', '    # about h', 'people:', '  - id: a', '    name: A'].join('\n');
		const r = applyOp(body, { kind: 'add-house', name: 'Stark' });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// The decision notes "Relationship-op details": deeper-indented comments below an item belong to it.
		// add-person already does this (it inserts after itemEnd); add-house does not.
		expect(r.body).toBe(['houses:', '  - id: h', '    name: H', '    # about h', '  - id: stark', '    name: Stark', 'people:', '  - id: a', '    name: A'].join('\n'));
	});
});
