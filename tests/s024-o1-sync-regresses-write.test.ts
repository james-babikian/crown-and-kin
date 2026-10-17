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
 * Search round 0.2.4, area O, finding O1: `HandleRegistry.sync` decides that a read is fresh inside `readOnce`,
 * then applies it after one more `await`. An editor write is synchronous, so it can run in that gap: the old
 * text then replaces the handle's new body.
 */

const fence = (body: string) => ['```kin', body, '```'].join('\n');
const X = 'people:\n  - id: p\n    name: Alys';
const Y = 'people:\n  - id: q\n    name: Yara';

/** A note open in Live Preview: writes go through the editor, which is read and changed at once. */
function editorApp(path: string, initial: string) {
	let text = initial;
	const file = new (TFile as unknown as new (p: string) => { path: string; extension: string })(path);
	const view = Object.assign(new (MarkdownView as unknown as new () => object)(), {
		file,
		getMode: () => 'source',
		editor: {
			getValue: () => text,
			offsetToPos: (o: number) => o,
			transaction: () => undefined,
			cm: {
				get state() {
					return { doc: { length: text.length } };
				},
				dispatch: (t: { changes: { from: number; to: number; insert: string } }) => {
					text = text.slice(0, t.changes.from) + t.changes.insert + text.slice(t.changes.to);
				},
			},
		},
	});
	const app = {
		vault: { getAbstractFileByPath: (p: string) => (p === path ? file : null), read: async () => text, process: async () => text },
		workspace: { getLeavesOfType: () => [{ view }] },
	};
	return { app, get: () => text };
}

describe('O1: a read that started before an editor write does not replace the write', () => {
	it('a modify event and a write in the same task: the handle keeps the written body, and the next write is not stale', async () => {
		const t0 = [fence(X), '', fence(Y), ''].join('\n');
		const v = editorApp('n.md', t0);
		const reg = new HandleRegistry(v.app as never);
		const b = findBlocks(t0)[0];
		const h = (await reg.resolve('n.md', { text: t0, lineStart: b.openLine, lineEnd: b.openLine + 4 } as never, b.body))!;
		const seen: string[] = [];
		h.onChanged((body) => seen.push(body));
		// The vault's `modify` event, then a user write in the same task (an Undo, a second sheet, a link update).
		reg.modified('n.md');
		const first = await h.write({ kind: 'set-person-fields', id: 'p', fields: { title: 'Queen' } });
		expect(first.ok).toBe(true);
		await new Promise((r) => setTimeout(r, 20));
		expect(findBlocks(v.get())[0].body).toContain('title: Queen');
		// The handle and every view must show what the note holds.
		expect(h.body).toContain('title: Queen');
		expect(seen[seen.length - 1]).toContain('title: Queen');
		// Nothing else touched the note: a second edit must not be refused as stale.
		const second = await h.write({ kind: 'set-person-fields', id: 'p', fields: { title: 'Empress' } });
		expect(second).toMatchObject({ ok: true });
	});
});
