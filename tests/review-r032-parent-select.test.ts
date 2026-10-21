import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { closePluginModals } from '../src/view/plugin-modals';
import { FEl, clock, device, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * G2 review of r032/select, the person window. The parent-type select is kept across the rebuild. A write that does not happen
 * (stale) rebuilds the window with the data of the note, and then the old code put the OLD value in the select it had abandoned.
 * Now that select is the live one.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = true;
	device.width = 390;
	device.height = 844;
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bran', '    parents: [a]', ''].join('\n');

describe('the kept parent-type select after a stale write', () => {
	it('shows the type that the note has now, not the type from before the window reloaded', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'b', sourcePath: 'n.md' })!;
		s.open();
		await settle();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		const sel = modal.querySelector('select.dynasty-family-select')!;
		expect(sel.value).toBe('birth');
		// Another view of the note makes the parent adoptive; this window has not heard of it.
		const external = applyOp(h.body, { kind: 'set-parent-type', child: 'b', parent: 'a', from: 'birth', to: 'adoptive' });
		if (!external.ok) throw new Error('setup');
		h.body = external.body;
		// The user picks "ward" in the old window. The write is refused as stale, and the window loads the note again.
		sel.focus();
		sel.value = 'ward';
		dispatch(sel, 'change');
		await settle();
		await settle();
		expect(h.ops, 'nothing was written').toHaveLength(0);
		const now = modal.querySelector('select.dynasty-family-select')!;
		expect(modal.querySelector('[data-parent="a"]')!.getAttribute('data-type'), 'the row shows the type of the note').toBe('adoptive');
		expect(now.value, 'the select shows the type of the note').toBe('adoptive');
	});
});

const TWO = ['people:', '  - id: a', '    name: Aldric', '  - id: c', '    name: Cora', '  - id: b', '    name: Bran', '    parents: [a, c]', ''].join('\n');

describe('the kept parent-type select with a second tap during the write', () => {
	it('a second select that is tapped while the first write runs does not take away the kept select of the first', async () => {
		const h = writingHandle(TWO);
		let go: () => void = () => undefined;
		const gate = new Promise<void>((r) => (go = r));
		const real = h.write.getMockImplementation()!;
		h.write.mockImplementation((async (op: never) => {
			await gate;
			return (real as (o: never) => Promise<unknown>)(op);
		}) as never);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'b', sourcePath: 'n.md' })!;
		s.open();
		await settle();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		const selA = modal.querySelector('[data-parent="a"] select')!;
		const selC = modal.querySelector('[data-parent="c"] select')!;
		selA.value = 'adoptive';
		dispatch(selA, 'change');
		// The second tap comes while the first write has not ended.
		selC.value = 'ward';
		dispatch(selC, 'change');
		await settle();
		go();
		await settle();
		await settle();
		expect(h.ops).toHaveLength(1);
		expect(modal.querySelector('[data-parent="a"] select'), 'the select that the user used first is still the one on the page').toBe(selA);
	});
});
