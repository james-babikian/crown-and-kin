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
 * D375 (3): the type chip of a parent row is off for a type that the same person already has or that makes the person both birth parent and
 * rumoured parent; the three refusals show their own texts in the window.
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

describe('the type chip and the refusals (D375 (3))', () => {
	const open = (body: string, personId: string) => {
		const h = writingHandle(body);
		const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
		s.open();
		return { h, modal: (s as unknown as { modalEl: FEl }).modalEl };
	};
	const texts = (modal: FEl) => {
		const out: string[] = [];
		const walk = (el: FEl) => {
			out.push(el.text);
			el.children.forEach(walk);
		};
		walk(modal);
		return out;
	};

	it('a rumoured entry and a birth entry of one person: the chip of the rumoured row cannot become birth, as the same type is there', async () => {
		const { modal } = open(tree(['{id: m, name: Mara}', '{id: c, name: Cass, parents: [m, {id: m, type: rumoured}]}']), 'c');
		await settle();
		const rows = modal.querySelectorAll('[data-parent="m"] select');
		expect(rows.length).toBeGreaterThan(0);
		for (const sel of rows) {
			const list = (sel.children as FEl[]).map((o) => [o.getAttribute('value'), o.disabled] as const);
			expect(list.find((o) => o[0] === 'adoptive')![1]).toBe(false);
		}
	});

	for (const [name, detail, text] of [
		['the rumoured-entry refusal', REFUSAL_TEXT.alreadyRumouredParent, WRITE_TEXT.alreadyRumouredParent],
		['the birth-entry refusal', REFUSAL_TEXT.alreadyBirthParent, WRITE_TEXT.alreadyBirthParent],
		['the same-type refusal', REFUSAL_TEXT.alreadyParent, WRITE_TEXT.alreadyParent],
	] as const) {
		it(`${name} shows its own text`, async () => {
			const { h, modal } = open(tree(['{id: m, name: Mara}', '{id: c, name: Cass, parents: [m]}']), 'c');
			await settle();
			h.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'bad-value', detail } })) as never);
			const sel = modal.querySelector('[data-parent="m"] select')!;
			sel.value = 'rumoured';
			dispatch(sel, 'change');
			await settle();
			await settle();
			expect(texts(modal)).toContain(text);
			expect(text).not.toBe(WRITE_TEXT.refused);
		});
	}

	it('the four texts differ, and the first is the refusal sentence', () => {
		expect(new Set([WRITE_TEXT.alreadyRumouredParent, WRITE_TEXT.alreadyBirthParent, WRITE_TEXT.alreadyParent, WRITE_TEXT.alreadyBloodParent]).size).toBe(4);
		expect(WRITE_TEXT.alreadyRumouredParent).toBe(REFUSAL_TEXT.alreadyRumouredParent);
	});
});
