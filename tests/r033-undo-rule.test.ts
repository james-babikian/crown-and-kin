import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { readFileSync } from 'node:fs';
import type { Handle } from '../src/obsidian/block-handle';
import { undoIfUnchanged, undoNotice } from '../src/obsidian/undo-notice';
import { REMOVE, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { noticeList, notices, resetObsidian } from './acceptance/fake-obsidian';

// 0.3.3 WP-1 (steward note, the shared Undo rule): `undoNotice` and the text line of the edit window (`undoChange`) use one function, `undoIfUnchanged`.
// The edit window itself is tested in tests/r033-b5-change-line.test.ts and tests/review-r033-b15-undo-line.test.ts; here is the rule alone.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const WRITTEN = 'people:\n  - {id: a, name: Ann}\n';

type Facts = { body?: string; followed?: (w: string) => string; undoSize?: number; undo?: () => Promise<{ ok: boolean; code?: string }> };

/** Only the parts of a handle that the rule reads. */
function handle(o: Facts = {}) {
	const h = { body: o.body ?? WRITTEN, followed: o.followed, undoSize: o.undoSize, undo: vi.fn(o.undo ?? (async () => ({ ok: true }))) };
	return h as typeof h & Handle;
}

describe('undoIfUnchanged', () => {
	it('undoes while the block is still what the action wrote, and gives true with no Notice', async () => {
		const h = handle();
		expect(await undoIfUnchanged(h, WRITTEN)).toBe(true);
		expect(h.undo).toHaveBeenCalledTimes(1);
		expect(notices).toEqual([]);
	});

	it('refuses when the block changed after the action: the "changed" Notice, no undo', async () => {
		const h = handle({ body: `${WRITTEN}  - {id: b, name: Bea}\n` });
		expect(await undoIfUnchanged(h, WRITTEN)).toBe(false);
		expect(h.undo).not.toHaveBeenCalled();
		expect(notices).toEqual([WRITE_TEXT.undoChanged]);
	});

	it('a link update after a rename does not count as a change: `followed` gives the body to compare', async () => {
		const renamed = WRITTEN.replace('Ann', 'Anne');
		const h = handle({ body: renamed, followed: (w) => w.replace('Ann', 'Anne') });
		expect(await undoIfUnchanged(h, WRITTEN)).toBe(true);
		expect(h.undo).toHaveBeenCalledTimes(1);
	});

	it('with a depth, another write above the action refuses even when the body is the same again', async () => {
		const h = handle({ undoSize: 3 });
		expect(await undoIfUnchanged(h, WRITTEN, 2)).toBe(false);
		expect(h.undo).not.toHaveBeenCalled();
		expect(notices).toEqual([WRITE_TEXT.undoChanged]);
	});

	it('with a depth that matches, or a handle that does not count, it undoes; with no depth the count is not read', async () => {
		expect(await undoIfUnchanged(handle({ undoSize: 2 }), WRITTEN, 2)).toBe(true);
		expect(await undoIfUnchanged(handle({}), WRITTEN, 2)).toBe(true);
		expect(await undoIfUnchanged(handle({ undoSize: 9 }), WRITTEN)).toBe(true);
		expect(await undoIfUnchanged(handle({ undoSize: 9 }), WRITTEN, null)).toBe(true);
		expect(notices).toEqual([]);
	});

	it.each([
		['missing', WRITE_TEXT.undoMissing],
		['empty', WRITE_TEXT.undoEmpty],
		['other', WRITE_TEXT.undoChanged],
	])('the handle refuses with "%s": that Notice, false', async (code, text) => {
		const h = handle({ undo: async () => ({ ok: false, code }) });
		expect(await undoIfUnchanged(h, WRITTEN)).toBe(false);
		expect(notices).toEqual([text]);
	});

	it('an exception leaves no exception: it is logged, the "changed" Notice shows, and the answer is false', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const boom = new Error('boom');
		const h = handle({ undo: async () => { throw boom; } });
		expect(await undoIfUnchanged(h, WRITTEN)).toBe(false);
		expect(log).toHaveBeenCalledWith('Crown and Kin: cannot undo', boom);
		expect(notices).toEqual([WRITE_TEXT.undoChanged]);
	});
});

describe('undoNotice and the text line use it', () => {
	it('the Undo button of the Notice gives the done text and runs the callback after an undo, and the same refusals as the rule when it refuses', async () => {
		const done = vi.fn();
		const h = handle();
		undoNotice('Removed.', h, WRITTEN, done, 'Done.');
		const button = (noticeList[0] as unknown as { messageEl: FEl }).messageEl.querySelector('.dynasty-undo-button')!;
		expect(button.getText()).toBe(REMOVE.undo);
		dispatch(button, 'click', { button: 0 });
		await settle();
		expect(notices).toEqual(['Removed.', 'Done.']);
		expect(done).toHaveBeenCalledTimes(1);

		resetObsidian();
		const stale = handle({ body: `${WRITTEN}  - {id: b, name: Bea}\n` });
		const onUndone = vi.fn();
		undoNotice('Removed.', stale, WRITTEN, onUndone);
		dispatch((noticeList[0] as unknown as { messageEl: FEl }).messageEl.querySelector('.dynasty-undo-button')!, 'click', { button: 0 });
		await settle();
		expect(notices).toEqual(['Removed.', WRITE_TEXT.undoChanged]);
		expect(onUndone).not.toHaveBeenCalled();
	});

	it('the edit window has no copy of the rule: undoChange calls undoIfUnchanged with the depth of the line, and undoNotice calls it with none', () => {
		const writes = readFileSync('src/obsidian/edit-sheet-writes.ts', 'utf8');
		expect(writes).toContain('undoIfUnchanged(h, c.written, c.depth)');
		expect(writes).not.toContain('h.undoSize');
		expect(writes).not.toContain('WRITE_TEXT.undoMissing');
		const notice = readFileSync('src/obsidian/undo-notice.ts', 'utf8');
		expect(notice).toContain('await undoIfUnchanged(handle, written)');
		expect(notice.match(/WRITE_TEXT\.undoMissing/g)).toHaveLength(1);
	});
});
