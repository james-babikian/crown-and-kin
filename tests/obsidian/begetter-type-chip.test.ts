import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REFUSAL_TEXT } from '../../src/core/refusal-text';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { WRITE_TEXT } from '../../src/render/window-text';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, device, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { stripNotDisabled, writingHandle } from '../support/windows-sheets-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D332: the type chip of a parent row lists Begetter last, takes the per-link blood rule (`linkTypeFull`), and shows its own text for the refusal
 * "already a birth parent or a begetter".
 */

useFakeDom({ window: true });

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

const tree = (people: string[], extra: string[] = []) => ['people:', ...people.map((p) => `  - ${p}`), ...extra, ''].join('\n');

describe('the type chip of a parent row', () => {
	const open = (body: string, personId: string) => {
		const h = writingHandle(body);
		const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
		s.open();
		return { h, modal: (s as unknown as { modalEl: FEl }).modalEl };
	};
	const options = (modal: FEl, parent: string) => (modal.querySelector(`[data-parent="${parent}"] select`)!.children as FEl[]).map((o) => [o.getAttribute('value'), o.text, o.disabled] as const);

	it('lists the 5 types with Begetter last, and a swap between birth and begetter is open when the parents by blood are 2', async () => {
		const { modal } = open(tree(['{id: m, name: Mara}', '{id: f, name: Finn}', '{id: c, name: Cass, parents: [m, {id: f, type: begetter}]}']), 'c');
		await settle();
		expect(options(modal, 'f')).toEqual([
			['birth', 'Birth parent', false],
			['adoptive', 'Adoptive parent', false],
			['ward', 'Guardian', false],
			['rumoured', 'Rumoured parent', false],
			['begetter', 'Begetter', false],
		]);
		expect(options(modal, 'm').find((o) => o[0] === 'begetter')![2]).toBe(false);
	});

	it('disables Birth parent and Begetter on a third parent, who would make 3 parents by blood', async () => {
		const { modal } = open(tree(['{id: m, name: Mara}', '{id: f, name: Finn}', '{id: x, name: Xan}', '{id: c, name: Cass, parents: [m, f, {id: x, type: adoptive}]}']), 'c');
		await settle();
		const x = options(modal, 'x');
		expect(x.find((o) => o[0] === 'birth')![2]).toBe(true);
		expect(x.find((o) => o[0] === 'begetter')![2]).toBe(true);
		expect(x.find((o) => o[0] === 'ward')![2]).toBe(false);
	});

	it('a refusal "already a birth parent or a begetter" shows its own text in the window', async () => {
		const { h, modal } = open(tree(['{id: m, name: Mara}', '{id: c, name: Cass, parents: [m]}']), 'c');
		await settle();
		h.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'bad-value', detail: REFUSAL_TEXT.alreadyBloodParent } })) as never);
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'begetter';
		dispatch(sel, 'change');
		await settle();
		await settle();
		const texts: string[] = [];
		const walk = (el: FEl) => {
			texts.push(el.text);
			el.children.forEach(walk);
		};
		walk(modal);
		expect(texts).toContain(WRITE_TEXT.alreadyBloodParent);
	});
});
