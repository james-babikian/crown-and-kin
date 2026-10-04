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
 * Search round 0.2.3, area D: the handle registry (spec §6.1).
 */

const fence = (body: string) => ['```dynasty', body, '```'].join('\n');
const X = 'people:\n  - id: a\n    name: Alys';
const queen = { kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } } as const;
const File = TFile as unknown as new (p: string) => { path: string; extension: string };

/** A vault of several notes; `editorFor` opens one of them in a fake Live Preview editor. */
function fakeVault(files: Record<string, string>, editorFor?: string) {
	const texts = new Map(Object.entries(files));
	const tfiles = new Map([...texts.keys()].map((p) => [p, new File(p)]));
	const reads: string[] = [];
	const leaves: { view: unknown }[] = [];
	if (editorFor) {
		leaves.push({
			view: Object.assign(new (MarkdownView as unknown as new () => object)(), {
				file: tfiles.get(editorFor),
				getMode: () => 'source',
				editor: {
					getValue: () => texts.get(editorFor)!,
					offsetToPos: (o: number) => o,
					transaction: () => undefined,
					cm: {
						get state() {
							return { doc: { length: texts.get(editorFor)!.length } };
						},
						dispatch: (t: { changes: { from: number; to: number; insert: string } }) => {
							const text = texts.get(editorFor)!;
							texts.set(editorFor, text.slice(0, t.changes.from) + t.changes.insert + text.slice(t.changes.to));
						},
					},
				},
			}),
		});
	}
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
			read: async (f: { path: string }) => {
				reads.push(f.path);
				return texts.get(f.path) ?? '';
			},
			process: async (f: { path: string }, fn: (t: string) => string) => {
				texts.set(f.path, fn(texts.get(f.path) ?? ''));
			},
		},
		workspace: { getLeavesOfType: () => leaves },
	};
	return { app, texts, reads };
}

/** The handle of block `ordinal` of `path`, as a view of that block takes it. */
async function handleOf(reg: HandleRegistry, path: string, text: string, ordinal: number) {
	const b = findBlocks(text)[ordinal];
	return (await reg.resolve(path, { text, lineStart: b.openLine, lineEnd: b.openLine + b.body.split('\n').length + 1 } as never, b.body))!;
}

describe('D2b: a block deleted above two identical blocks, before the note is saved', () => {
	it('"Add first person" in the first of two identical empty trees does not write into the second', async () => {
		// Three trees made with "Insert family tree": the two lower ones are the same empty template.
		const T = '# Add the people of your family here.';
		const A = 'people:\n  - id: a\n    name: Alys';
		const t0 = [fence(A), '', fence(T), '', fence(T), ''].join('\n');
		const v = fakeVault({ 'n.md': t0 }, 'n.md');
		const reg = new HandleRegistry(v.app as never);
		const h1 = await handleOf(reg, 'n.md', t0, 1);
		expect(h1.key.ordinal).toBe(1);
		// The user deletes the first tree in the editor; the file is not saved yet, so no `modify` event came.
		v.texts.set('n.md', [fence(T), '', fence(T), ''].join('\n'));
		const out = await h1.write({ kind: 'add-person', id: 'z', fields: { name: 'Zed' } });
		const [first, second] = findBlocks(v.texts.get('n.md')!);
		// The view of h1 is the tree that is now first. It must get the person, or nothing is written;
		// the tree that was below it must not.
		expect({ ok: out.ok, firstHasZed: first.body.includes('Zed'), secondHasZed: second.body.includes('Zed') }).not.toMatchObject({ secondHasZed: true });
	});
});

describe('D2: a copy of a block pasted above it, before the note is saved', () => {
	it('the handle of the original does not write into the pasted copy', async () => {
		const t0 = fence(X) + '\n';
		const v = fakeVault({ 'n.md': t0 }, 'n.md');
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		// The user copies the block and pastes it above itself: two identical blocks, the editor is newer than the file.
		const t1 = fence(X) + '\n\n' + fence(X) + '\n';
		v.texts.set('n.md', t1);
		const out = await h.write(queen);
		const [upper, lower] = findBlocks(v.texts.get('n.md')!);
		// Either the write is refused, or it goes to the lower block (the original); never to the pasted copy
		// while the lower block (the one the view shows) stays as it was.
		const wroteUpperOnly = upper.body.includes('Queen') && !lower.body.includes('Queen');
		expect({ ok: out.ok, wroteUpperOnly }).not.toEqual({ ok: true, wroteUpperOnly: true });
	});
});

describe('D2 fix: what the write does when the text no longer says which block the handle means', () => {
	it('refuses a copy pasted above (editor newer than the file), writes nothing and detaches the handle', async () => {
		const t0 = fence(X) + '\n';
		const v = fakeVault({ 'n.md': t0 }, 'n.md');
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		const t1 = fence(X) + '\n\n' + fence(X) + '\n';
		v.texts.set('n.md', t1);
		const out = await h.write(queen);
		expect(out).toEqual({ ok: false, code: 'stale' });
		expect(v.texts.get('n.md')).toBe(t1);
		expect(h.detached).toBe(true);
	});

	it('refuses the same without an editor (the file changed, no modify event yet)', async () => {
		const t0 = fence(X) + '\n';
		const v = fakeVault({ 'n.md': t0 });
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		const t1 = fence(X) + '\n\n' + fence(X) + '\n';
		v.texts.set('n.md', t1);
		const out = await h.write(queen);
		expect(out).toEqual({ ok: false, code: 'stale' });
		expect(v.texts.get('n.md')).toBe(t1);
	});

	it('still writes at the new place when a different block was added above (the body is unique)', async () => {
		const t0 = fence(X) + '\n';
		const v = fakeVault({ 'n.md': t0 }, 'n.md');
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 0);
		v.texts.set('n.md', fence('people:\n  - id: z\n    name: Zed') + '\n\n' + fence(X) + '\n');
		const out = await h.write(queen);
		expect(out.ok).toBe(true);
		const [upper, lower] = findBlocks(v.texts.get('n.md')!);
		expect(upper.body).not.toContain('Queen');
		expect(lower.body).toContain('Queen');
	});

	it('still writes when the text has not changed and another block has the same body', async () => {
		const t0 = fence(X) + '\n\n' + fence(X) + '\n';
		const v = fakeVault({ 'n.md': t0 }, 'n.md');
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, 'n.md', t0, 1);
		// Two blocks that were always two: the ordinal is the identity, as in version 0.2.2.
		expect((await h.write(queen)).ok).toBe(true);
		const [upper, lower] = findBlocks(v.texts.get('n.md')!);
		expect(upper.body).not.toContain('Queen');
		expect(lower.body).toContain('Queen');
	});
});
