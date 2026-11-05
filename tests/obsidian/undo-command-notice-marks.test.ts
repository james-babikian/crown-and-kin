import { beforeEach, describe, expect, it } from 'vitest';
import type { Handle, HandleRegistry } from '../../src/obsidian/block-handle';
import { undoLastEditCommand } from '../../src/obsidian/undo-ask';
import { notices, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The Notice of the command "Undo last tree edit" names the person with `CHANGE_UI.undone*` / `REMOVE.undoneDelete`, which put the name between FSI and PDI.
 * The command must pass the text through `noticeText`, so the two characters never reach the Notice as text (WebKit ignores them there). The fake Notice records
 * a fragment as its text and a string as it is, so a mark in the record means a plain string with marks.
 */
useFakeDom({ window: true });

beforeEach(() => {
	resetObsidian();
});

describe('the Notice of "Undo last tree edit" has no raw isolate marks', () => {
	it.each([
		['deleted', { kind: 'deleted', names: ['كريم Mansour'] }],
		['added-partner', { kind: 'added-partner', names: ['كريم Mansour', 'Edmund Vane'] }],
	])('%s', async (_k, label) => {
		const h = { key: { path: 'Trees/Alpha.md', ordinal: 0 }, canUndo: true, undo: async () => ({ ok: true, label }) };
		await undoLastEditCommand({ workspace: { getActiveFile: () => ({ path: 'Trees/Alpha.md' }) } } as never, { undoTarget: () => h as unknown as Handle } as unknown as HandleRegistry);
		expect(notices).toHaveLength(1);
		expect(/[⁨⁩]/.test(notices[0]!), JSON.stringify(notices[0])).toBe(false);
	});
});
