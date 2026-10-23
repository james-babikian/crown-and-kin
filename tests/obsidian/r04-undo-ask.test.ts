import { beforeEach, describe, expect, it } from 'vitest';
import type { Handle, HandleRegistry } from '../../src/obsidian/block-handle';
import { noteBaseName, undoLastEditCommand } from '../../src/obsidian/undo-ask';
import { WRITE_TEXT } from '../../src/render/ui-text';
import { FEl, dispatch, installDom, resetDom, settle } from '../acceptance/fake-dom';
import { notices, openModals, resetObsidian } from '../acceptance/fake-obsidian';

/*
 * D284 (spec §6.1): the command "Undo last tree edit" undoes at once in the active note. For a tree in another
 * note it names the note and asks first (Undo, Cancel). Cancel, Esc and a press outside change nothing.
 */

type UndoOut = { ok: true } | { ok: false; code: 'empty' | 'missing' | 'changed' };

function fakeHandle(path: string, out: UndoOut = { ok: true }) {
	const h = {
		key: { path, ordinal: 0 },
		undone: 0,
		canUndo: true,
		undo: async () => {
			h.undone++;
			return out;
		},
	};
	return h;
}

function setup(active: string | null, handle: ReturnType<typeof fakeHandle> | null) {
	const app = { workspace: { getActiveFile: () => (active === null ? null : { path: active }) } };
	const handles = { undoTarget: () => handle };
	return { run: () => undoLastEditCommand(app as never, handles as unknown as HandleRegistry), handle: handle as unknown as Handle };
}

const question = () => openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-choice')) as unknown as { modalEl: FEl; contentEl: FEl; close(): void } | undefined;
const buttons = (m: { contentEl: FEl }) => m.contentEl.querySelectorAll('button');
const press = (b: FEl) => dispatch(b, 'click', { button: 0, clientX: 1, clientY: 1 });

beforeEach(() => {
	installDom();
	resetDom();
	resetObsidian();
});

describe('noteBaseName', () => {
	it('gives the last part of the path with no .md', () => {
		expect(noteBaseName('Families/House of Wessex.md')).toBe('House of Wessex');
		expect(noteBaseName('a.md')).toBe('a');
		expect(noteBaseName('dir/a.b.md')).toBe('a.b');
		expect(noteBaseName('no-extension')).toBe('no-extension');
	});
});

describe('"Undo last tree edit" (D284)', () => {
	it('undoes at once in the active note, with no question, and names the note', async () => {
		const h = fakeHandle('Trees/Alpha.md');
		await setup('Trees/Alpha.md', h).run();
		expect(question()).toBeUndefined();
		expect(h.undone).toBe(1);
		expect(notices).toEqual([WRITE_TEXT.undoDoneIn('Alpha')]);
		expect(notices[0]).toContain('“Alpha”');
	});

	it('asks first for another note: the title names the note, Undo has the focus, the window has a name for a screen reader', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const p = setup('Trees/Alpha.md', h).run();
		await settle();
		const m = question()!;
		expect(m).toBeDefined();
		expect(h.undone).toBe(0);
		expect(m.modalEl.getText()).toContain(WRITE_TEXT.undoAskTitle('Beta'));
		expect(WRITE_TEXT.undoAskTitle('Beta')).toBe('Undo the last tree edit in “Beta”?');
		expect(buttons(m).map((b) => b.getText().trim())).toContain('Undo');
		expect(m.modalEl.getAttribute('role') ?? 'dialog').toBe('dialog');
		expect(m.modalEl.getAttribute('aria-labelledby') ?? m.modalEl.getAttribute('aria-label')).toBeTruthy();
		m.close();
		await p;
	});

	it('shows the name of the note in a visible body line, in two sentences', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const p = setup('Trees/Alpha.md', h).run();
		await settle();
		const m = question()!;
		const lines = m.contentEl.querySelectorAll('.dynasty-choice-text').map((e) => e.getText());
		expect(lines).toEqual(['The last tree edit is in the note “Beta”, not in the active note.', 'If you select Undo, the plugin reverses that edit in “Beta”.']);
		expect(WRITE_TEXT.undoAskText('Beta')).toEqual(lines);
		m.close();
		await p;
	});

	it('Undo in the question undoes and the Notice names the note', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const p = setup('Trees/Alpha.md', h).run();
		await settle();
		const m = question()!;
		press(buttons(m).find((b) => b.getText().trim() === 'Undo')!);
		await p;
		expect(h.undone).toBe(1);
		expect(notices).toEqual([WRITE_TEXT.undoDoneIn('Beta')]);
		expect(question()).toBeUndefined();
	});

	it('checks again after Undo: if the handle is no longer the undo target of that note, it shows the refusal and changes nothing', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const other = fakeHandle('Trees/Beta.md');
		let target: ReturnType<typeof fakeHandle> = h;
		const app = { workspace: { getActiveFile: () => ({ path: 'Trees/Alpha.md' }) } };
		const handles = { undoTarget: () => target };
		const p = undoLastEditCommand(app as never, handles as unknown as HandleRegistry);
		await settle();
		// While the question is open, a later edit makes another handle the target of that note.
		target = other;
		press(buttons(question()!).find((b) => b.getText().trim() === 'Undo')!);
		await p;
		expect(h.undone).toBe(0);
		expect(other.undone).toBe(0);
		expect(notices).toEqual([WRITE_TEXT.undoChanged]);
	});

	it('refuses at once with no question when the edit in another note cannot be undone now (it was undone with Ctrl+Z)', async () => {
		const h = fakeHandle('Trees/Beta.md');
		h.canUndo = false;
		await setup('Trees/Alpha.md', h).run();
		expect(question()).toBeUndefined();
		expect(h.undone).toBe(0);
		expect(notices).toEqual([WRITE_TEXT.undoChanged]);
	});

	it('in the active note it keeps the undo of the handle, which gives its own refusal', async () => {
		const h = fakeHandle('Trees/Alpha.md', { ok: false, code: 'changed' });
		h.canUndo = false;
		await setup('Trees/Alpha.md', h).run();
		expect(question()).toBeUndefined();
		expect(h.undone).toBe(1);
		expect(notices).toEqual([WRITE_TEXT.undoChanged]);
	});

	it('Cancel changes nothing and shows no Notice', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const p = setup('Trees/Alpha.md', h).run();
		await settle();
		const m = question()!;
		press(buttons(m).find((b) => b.getText().trim() === 'Cancel')!);
		await p;
		expect(h.undone).toBe(0);
		expect(notices).toEqual([]);
		expect(question()).toBeUndefined();
	});

	it('Esc (Obsidian closes the top window) changes nothing', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const p = setup('Trees/Alpha.md', h).run();
		await settle();
		question()!.close();
		await p;
		expect(h.undone).toBe(0);
		expect(notices).toEqual([]);
	});

	it('asks also when no note is active', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const p = setup(null, h).run();
		await settle();
		expect(question()).toBeDefined();
		question()!.close();
		await p;
		expect(h.undone).toBe(0);
	});

	it('a second tap of the command does not stack a second question', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const s = setup('Trees/Alpha.md', h);
		const p1 = s.run();
		await settle();
		await s.run();
		expect(openModals.filter((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-choice'))).toHaveLength(1);
		question()!.close();
		await p1;
	});

	it('keeps today’s refusals after the question and in the active note', async () => {
		for (const [code, text] of [
			['missing', WRITE_TEXT.undoMissing],
			['empty', WRITE_TEXT.undoEmpty],
			['changed', WRITE_TEXT.undoChanged],
		] as const) {
			resetObsidian();
			const asked = setup('Trees/Alpha.md', fakeHandle('Trees/Beta.md', { ok: false, code }));
			const p = asked.run();
			await settle();
			press(buttons(question()!).find((b) => b.getText().trim() === 'Undo')!);
			await p;
			expect(notices).toEqual([text]);
			resetObsidian();
			await setup('Trees/Alpha.md', fakeHandle('Trees/Alpha.md', { ok: false, code })).run();
			expect(notices).toEqual([text]);
		}
	});

	it('names the new name when the note is renamed while the question is open', async () => {
		const h = fakeHandle('Trees/Beta.md');
		const p = setup('Trees/Alpha.md', h).run();
		await settle();
		h.key = { path: 'Trees/Gamma.md', ordinal: 0 };
		press(buttons(question()!).find((b) => b.getText().trim() === 'Undo')!);
		await p;
		expect(notices).toEqual([WRITE_TEXT.undoDoneIn('Gamma')]);
	});

	it('says there is nothing to undo when no handle has an edit', async () => {
		await setup('Trees/Alpha.md', null).run();
		expect(notices).toEqual([WRITE_TEXT.undoEmpty]);
		expect(question()).toBeUndefined();
	});

	it('shows the cannot-undo Notice if the handle throws', async () => {
		const h = fakeHandle('Trees/Alpha.md');
		h.undo = async () => {
			throw new Error('boom');
		};
		await setup('Trees/Alpha.md', h).run();
		expect(notices).toEqual([WRITE_TEXT.undoChanged]);
	});
});
