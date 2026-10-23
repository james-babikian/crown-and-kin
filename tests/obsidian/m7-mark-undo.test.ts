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
import type { Op } from '../../src/core/edit';
import { HandleRegistry } from '../../src/obsidian/block-handle';

/*
 * Spec §13.1 acceptance: "This is me", Remove "This is me" and a mark move are each undone by
 * Ctrl/Cmd+Z (the editor's own undo of the plugin's transaction) and by the command "Undo last tree
 * edit" (the plugin's undo, D8), also when "This is me" created the `options:` section. The ops are
 * the ones the edit sheet writes (an internal test checks the sheet side).
 */

interface Change {
	from: number;
	to: number;
	insert: string;
}

/**
 * A vault with one note. With `editor`, the note is open in Live Preview: the plugin's writes go
 * through `cm.dispatch`, and `ctrlZ` undoes the last change that went into the editor history, as
 * CodeMirror's history does.
 */
function fakeApp(path: string, initial: string, editor: boolean) {
	let text = initial;
	const history: { before: string; change: Change }[] = [];
	const outside: string[] = [];
	const file = new (TFile as unknown as new (p: string) => { path: string; extension: string })(path);
	const leaves: { view: unknown }[] = [];
	if (editor) {
		const view = Object.assign(new (MarkdownView as unknown as new () => object)(), {
			file,
			getMode: () => 'source',
			editor: {
				getValue: () => text,
				offsetToPos: (o: number) => o,
				transaction: () => {
					throw new Error('the plugin writes through cm.dispatch here');
				},
				cm: {
					get state() {
						return { doc: { length: text.length } };
					},
					dispatch: (t: { changes: Change; userEvent?: string; annotations?: unknown }) => {
						// A change with `addToHistory.of(false)` is not undoable by Ctrl/Cmd+Z.
						if (t.annotations !== undefined) outside.push(t.userEvent ?? '');
						else history.push({ before: text, change: t.changes });
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
			process: async (_f: unknown, fn: (t: string) => string) => {
				text = fn(text);
				return text;
			},
		},
		workspace: { getLeavesOfType: () => leaves },
	};
	return {
		app,
		history,
		outside,
		get: () => text,
		/** Ctrl/Cmd+Z in the editor: the inverse of the last change in the history. */
		ctrlZ: () => {
			const last = history.pop();
			if (!last) throw new Error('nothing to undo');
			const { from, insert } = last.change;
			const now = text.slice(0, from) + last.before.slice(from, last.change.to) + text.slice(from + insert.length);
			expect(now).toBe(last.before);
			text = now;
		},
	};
}

const fence = (body: string) => ['```kin', body, '```'].join('\n');
const PEOPLE = 'people:\n  - id: alan\n    name: Alan\n  - id: leo\n    name: Leo\n    parents: [alan]\n';
const NO_OPTIONS = ['# Note', '', fence(PEOPLE), '', 'After the tree.', ''].join('\n');
const WITH_FOCUS = ['# Note', '', fence(`options:\n  focus: leo\n\n${PEOPLE}`), ''].join('\n');
const mark = (id: string): Op => ({ kind: 'set-option', key: 'me', value: id });
const unmark: Op = { kind: 'set-option', key: 'me', value: null };

async function handleOf(reg: HandleRegistry, text: string) {
	const b = findBlocks(text)[0];
	return (await reg.resolve('n.md', { text, lineStart: b.openLine, lineEnd: b.openLine + b.body.split('\n').length + 1 } as never, b.body))!;
}

/** "Undo last tree edit" (main.ts `undoLastEdit`): the handle last written in the active note undoes its last write. */
async function undoCommand(reg: HandleRegistry): Promise<boolean> {
	const h = reg.undoTarget('n.md');
	if (!h) return false;
	return (await h.undo()).ok;
}

describe.each([
	['in Live Preview (an editor transaction)', true],
	['in Reading view (vault.process)', false],
])('"Undo last tree edit" undoes the mark %s', (_where, editor) => {
	it('This is me that created `options:`: the section goes away again, the note is as before', async () => {
		const v = fakeApp('n.md', NO_OPTIONS, editor);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, NO_OPTIONS);
		expect((await h.write(mark('alan'))).ok).toBe(true);
		expect(v.get()).toContain('options:\n  me: alan\n');
		expect(await undoCommand(reg)).toBe(true);
		expect(v.get()).toBe(NO_OPTIONS);
		expect(v.get()).not.toContain('options:');
	});

	it('This is me in an existing `options:`, a move of the mark, then Remove "This is me": each undo goes back one step', async () => {
		const v = fakeApp('n.md', WITH_FOCUS, editor);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, WITH_FOCUS);
		const steps = [WITH_FOCUS];
		for (const op of [mark('alan'), mark('leo'), unmark]) {
			expect((await h.write(op)).ok).toBe(true);
			steps.push(v.get());
		}
		expect(steps[1]).toContain('  focus: leo\n  me: alan\n');
		expect(steps[2]).toContain('  focus: leo\n  me: leo\n');
		expect(steps[3]).toBe(WITH_FOCUS);
		for (let i = steps.length - 2; i >= 0; i--) {
			expect(await undoCommand(reg)).toBe(true);
			expect(v.get()).toBe(steps[i]);
		}
		expect(await undoCommand(reg)).toBe(false);
	});

	it('Remove "This is me" that removes the last option: undo brings `options:` and the mark back', async () => {
		const marked = ['# Note', '', fence(`options:\n  me: leo\n\n${PEOPLE}`), ''].join('\n');
		const v = fakeApp('n.md', marked, editor);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, marked);
		expect((await h.write(unmark)).ok).toBe(true);
		expect(v.get()).not.toContain('options:');
		expect(await undoCommand(reg)).toBe(true);
		expect(v.get()).toBe(marked);
	});
});

describe('Ctrl/Cmd+Z undoes the mark (spec §6.1: one editor transaction in the history for each action)', () => {
	it('This is me that created `options:`, a move, and Remove "This is me": each is one undoable change', async () => {
		const v = fakeApp('n.md', NO_OPTIONS, true);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, NO_OPTIONS);
		const steps = [NO_OPTIONS];
		for (const op of [mark('alan'), mark('leo'), unmark]) {
			expect((await h.write(op)).ok).toBe(true);
			steps.push(v.get());
		}
		expect(v.history).toHaveLength(3);
		expect(v.outside).toEqual([]);
		// Remove "This is me" removed the only option, so the section went too.
		expect(steps[3]).toBe(NO_OPTIONS);
		for (let i = steps.length - 2; i >= 0; i--) {
			v.ctrlZ();
			expect(v.get()).toBe(steps[i]);
		}
		expect(v.get()).not.toContain('options:');
	});

	it('after Ctrl/Cmd+Z of This is me, the block is found again and the next mark writes one text line', async () => {
		const v = fakeApp('n.md', WITH_FOCUS, true);
		const reg = new HandleRegistry(v.app as never);
		const h = await handleOf(reg, WITH_FOCUS);
		expect((await h.write(mark('alan'))).ok).toBe(true);
		v.ctrlZ();
		expect(v.get()).toBe(WITH_FOCUS);
		// Obsidian reports the change of the note; the registry reads it.
		reg.applyText('n.md', v.get());
		expect((await h.write(mark('leo'))).ok).toBe(true);
		expect(v.get()).toBe(WITH_FOCUS.replace('  focus: leo\n', '  focus: leo\n  me: leo\n'));
		expect(await undoCommand(reg)).toBe(true);
		expect(v.get()).toBe(WITH_FOCUS);
		// The first mark was already undone by Ctrl/Cmd+Z: the plugin undo does not write it again.
		expect(await undoCommand(reg)).toBe(false);
		expect(v.get()).toBe(WITH_FOCUS);
	});
});
