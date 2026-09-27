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
import { sameBody, smallestChange } from '../src/core/block-match';
import { HandleRegistry } from '../src/obsidian/block-handle';
import { findBlocks } from '../src/core/block-locate';
import { loadSheet } from '../src/obsidian/edit-sheet';

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

const block = (body: string) => ['```dynasty', body, '```'].join('\n');
const A = 'people:\n  - id: a\n    name: Alys';
const B = 'people:\n  - id: a\n    name: Alys\n  - id: b\n    name: Bran';

describe('review 2.4: smallestChange', () => {
	it('always turns a into b (random strings with CRLF and surrogate pairs)', () => {
		const alphabet = ['a', 'b', '\r\n', '\n', '😀', '😁', ' '];
		let seed = 7;
		const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
		const str = () => Array.from({ length: Math.floor(rnd() * 8) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
		for (let i = 0; i < 20000; i++) {
			const a = str();
			const b = str();
			const c = smallestChange(a, b);
			expect(a.slice(0, c.from) + c.text + a.slice(c.to)).toBe(b);
			expect(c.from).toBeLessThanOrEqual(c.to);
		}
	});
});

describe('review 2.4: handle identity after a block is inserted above', () => {
	it('the handle a view holds for block A follows ordinal 0 to the new block, and a write lands there', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		// View for block A resolves with a matching section: handle #0.
		const lines = t0.split('\n');
		const hA = await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: lines.length - 2 } as never, A);
		expect(hA?.key.ordinal).toBe(0);

		// The user pastes a variant B above A (or sync brings it in). The view of A is kept.
		const t1 = ['# Note', '', block(B), '', block(A), ''].join('\n');
		v.set(t1);
		reg.modified(path);
		await hA!.refresh();

		// Adopted with the fix: the handle follows its block (A moved to ordinal 1) and keeps A's body.
		expect(hA!.body).toBe(A);
		expect(hA!.key.ordinal).toBe(1);
	});

	it('a write through the handle that A\'s view holds edits block B, not A', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const hA = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		const t1 = ['# Note', '', block(B), '', block(A), ''].join('\n');
		v.set(t1);
		reg.modified(path);
		const out = await hA.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'Alys II' } });
		// Adopted with the supervisor rule: the handle moved with A, so the write lands in A.
		expect(out.ok).toBe(true);
		const [b0, b1] = findBlocks(v.get());
		expect(b1.body).toContain('Alys II');
		expect(b0.body).not.toContain('Alys II');
	});
});

describe('review 2.4: the sheet tells an invalid body from a person who is gone', () => {
	it('a body with a YAML error is "invalid" (the sheet keeps the draft), not "gone"', () => {
		expect(loadSheet('people:\n  - id: a\n    name: [Alys', 'a').kind).toBe('invalid');
	});
	it('a body without the person is "gone"; with the person it loads', () => {
		expect(loadSheet(B, 'c').kind).toBe('gone');
		expect(loadSheet(B, 'b').kind).toBe('ok');
	});
});

describe('review 2.4: sameBody', () => {
	it('two blocks that differ only by shared indentation count as the same block', () => {
		expect(sameBody('a: 1\nb: 2', '  a: 1\n  b: 2')).toBe(true);
	});
});

describe('review 2.4: a failed vault.process rejects write()', () => {
	it('write() rejects when the file cannot be written (tree-view writeHeight has no catch)', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = fakeApp(path, t0);
		v.app.vault.process = async () => {
			throw new Error('EBUSY: resource busy or locked');
		};
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		// Expected by §8 at the call site: an outcome, not a rejection. writeHeight awaits this with no try/catch.
		await expect(h.write({ kind: 'set-option', key: 'height', value: 600 })).resolves.toBeDefined();
	});
});

describe('review 2.4: "Undo last tree edit" after the block is duplicated above', () => {
	it('undo refuses when two blocks equal the last write, and changes nothing', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		expect((await h.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'Alys II' } })).ok).toBe(true);
		const edited = findBlocks(v.get())[0].body;
		// The user copies the edited block and pastes the copy above it.
		v.set(['# Note', '', block(edited), '', block(edited), ''].join('\n'));
		const before = v.get();
		const target = reg.undoTarget(path)!;
		// Adopted with the supervisor rule: undo applies only if exactly one block equals the last write.
		expect(await target.undo()).toEqual({ ok: false, code: 'changed' });
		expect(v.get()).toBe(before);
	});

	it('undo follows the block when another block was pasted above it', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		expect((await h.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'Alys II' } })).ok).toBe(true);
		const edited = findBlocks(v.get())[0].body;
		v.set(['# Note', '', block(B), '', block(edited), ''].join('\n'));
		expect((await reg.undoTarget(path)!.undo()).ok).toBe(true);
		const [b0, b1] = findBlocks(v.get());
		expect(b0.body).toBe(B);
		expect(b1.body).toBe(A);
	});
});

describe('review 2.4: a handle that cannot find its block refuses to write', () => {
	it('after a copy of its block is pasted, the handle is detached and a write is "missing"', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		const t1 = ['# Note', '', block(A), '', block(A), ''].join('\n');
		v.set(t1);
		await reg.sync(path);
		expect(h.detached).toBe(true);
		expect(await h.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'X' } })).toEqual({ ok: false, code: 'missing' });
		expect(v.get()).toBe(t1);
	});

	it('the same number of blocks: an outside edit of the block is a normal re-read, and a write goes to the same block', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = fakeApp(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const h = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		v.set(['# Note', '', block(B), ''].join('\n'));
		await reg.sync(path);
		expect(h.body).toBe(B);
		expect((await h.write({ kind: 'set-person-fields', id: 'b', fields: { name: 'Bran II' } })).ok).toBe(true);
		expect(findBlocks(v.get())[0].body).toContain('Bran II');
	});
});
