import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Op } from '../../src/core/edit';
import { familyOf } from '../../src/core/family-query';
import { applyOp } from '../../src/core/yaml-edit';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { endedByChoice, openUnionEditor, showsEndedBy, type UnionValues } from '../../src/obsidian/union-edit';
import { UNION_EDIT } from '../../src/render/ui-text';
import { loadSheet } from '../../src/view/sheet-draft';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.5 step 1a-W (D306, D310, RULES §8 item 2 and §9 items 4 and 10): the "Ended by" choice of the partnership window. It shows for a
 * marriage and for an own type word, never removes a value by hiding, keeps a written value that it does not offer, and writes only what
 * the user changed. The window runs on the fakes; the write goes through the edit sheet and `applyOp` on a small note.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const settle = async () => {
	for (let i = 0; i < 6; i++) await tick();
};

const base: UnionValues = { type: 'marriage', start: '', end: '', endedBy: '' };

/** Opens the window and returns what Save sends (null while it has not sent). */
function open(initial: UnionValues) {
	const sent: { v: UnionValues | null } = { v: null };
	openUnionEditor({} as never, 'Aldric', 'Mara', initial, async (v) => {
		sent.v = v;
		return null;
	});
	const modal = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
	const root = modal.contentEl;
	const row = () => root.querySelector('[data-field="union-ended-by"]') as FEl;
	const select = (name: string) => root.querySelector(`[data-field="${name}"] select`) as FEl;
	const choose = (el: FEl, value: string) => {
		el.value = value;
		dispatch(el, 'change');
	};
	const save = () => {
		const buttons = modal.modalEl.querySelectorAll('button');
		dispatch(buttons.find((b) => b.getText() === 'Save') as FEl, 'click');
	};
	return { root, row, select, choose, save, sent };
}

const optionTexts = (sel: FEl) => sel.querySelectorAll('option').map((o) => [o.getAttribute('value'), o.getText()]);

describe('the choice and its texts', () => {
	it('the label, the four choices and the hint', () => {
		const w = open(base);
		expect(w.row().querySelector('label')!.getText()).toBe('Ended by');
		expect(optionTexts(w.select('union-ended-by'))).toEqual([
			['', 'Not known'],
			['divorce', 'Divorce'],
			['annulment', 'Annulment'],
			['death', 'Death'],
		]);
		const hint = w.row().querySelector('.dynasty-sheet-hint')!;
		expect(hint.getText()).toBe('After a divorce or an annulment, relation names on cards start with “Former”, for example “Former husband”.');
		expect(w.select('union-ended-by').getAttribute('aria-describedby')).toBe(hint.getAttribute('id'));
	});

	it('a text that the plugin shows has no contraction and a short sentence', () => {
		for (const t of [UNION_EDIT.ended.label, UNION_EDIT.ended.none, UNION_EDIT.ended.hint]) {
			expect(t).not.toMatch(/n't|'s |'re|'ll/);
			expect(t.split(/\s+/).length).toBeLessThanOrEqual(25);
		}
	});
});

describe('which types show the choice (D310)', () => {
	it('a marriage and an own type word show it; a betrothal, a concubinage and an affair do not', () => {
		expect(['marriage', 'morganatic', 'handfasting'].map(showsEndedBy)).toEqual([true, true, true]);
		expect(['betrothal', 'concubinage', 'affair'].map(showsEndedBy)).toEqual([false, false, false]);
		for (const [type, shown] of [['marriage', true], ['morganatic', true], ['betrothal', false], ['concubinage', false], ['affair', false]] as const) {
			const w = open({ ...base, type });
			expect(w.row().hidden, type).toBe(!shown);
		}
	});

	it('a type change shows or hides the choice', () => {
		const w = open(base);
		const type = w.select('union-type');
		w.choose(type, 'affair');
		expect(w.row().hidden).toBe(true);
		w.choose(type, 'marriage');
		expect(w.row().hidden).toBe(false);
	});
});

describe('what Save sends', () => {
	it('a window with no change sends nothing and closes', async () => {
		const w = open({ ...base, endedBy: 'divorce' });
		w.save();
		await settle();
		expect(w.sent.v).toBeNull();
		expect(openModals).toHaveLength(0);
	});

	it('a choice sends the value; "Not known" sends the empty value', async () => {
		const w = open(base);
		w.choose(w.select('union-ended-by'), 'annulment');
		w.save();
		await settle();
		expect(w.sent.v).toEqual({ ...base, endedBy: 'annulment' });
		const x = open({ ...base, endedBy: 'death' });
		x.choose(x.select('union-ended-by'), '');
		x.save();
		await settle();
		expect(x.sent.v).toEqual(base);
	});

	it('a value in another letter case is the known choice and is not sent as a change', async () => {
		const w = open({ ...base, endedBy: ' Divorce ' });
		expect(w.select('union-ended-by').value).toBe('divorce');
		expect(optionTexts(w.select('union-ended-by'))).toHaveLength(4);
		w.save();
		await settle();
		expect(w.sent.v).toBeNull();
	});

	it('a written value with no meaning shows as written, as a fifth choice, and stays', async () => {
		const raw = 'repudiated';
		const w = open({ ...base, endedBy: raw });
		const sel = w.select('union-ended-by');
		expect(sel.value).toBe(raw);
		expect(optionTexts(sel)).toEqual([['', 'Not known'], ['divorce', 'Divorce'], ['annulment', 'Annulment'], ['death', 'Death'], [raw, raw]]);
		// A change of the type alone leaves it.
		w.choose(w.select('union-type'), 'betrothal');
		w.save();
		await settle();
		expect(w.sent.v).toEqual({ ...base, type: 'betrothal', endedBy: raw });
	});

	it('a known alias (any letter case) shows as its known choice, with no fifth choice', async () => {
		for (const [raw, value, text] of [['divorced', 'divorce', 'Divorce'], [' Annulled ', 'annulment', 'Annulment'], ['DIVORCED', 'divorce', 'Divorce']] as const) {
			const w = open({ ...base, endedBy: raw });
			const sel = w.select('union-ended-by');
			expect(sel.value, raw).toBe(value);
			expect(optionTexts(sel), raw).toEqual([['', 'Not known'], ['divorce', 'Divorce'], ['annulment', 'Annulment'], ['death', 'Death']]);
			expect(optionTexts(sel).find(([v]) => v === value)![1]).toBe(text);
			// No change: nothing is sent. A change of the type alone sends the known value, which means the same as the note's text.
			w.choose(w.select('union-type'), 'betrothal');
			w.save();
			await settle();
			expect(w.sent.v, raw).toEqual({ ...base, type: 'betrothal', endedBy: value });
		}
	});

	it('a hidden choice keeps the value of the note, even after a pick before the hide', async () => {
		const w = open({ ...base, endedBy: 'death' });
		w.choose(w.select('union-ended-by'), 'divorce');
		w.choose(w.select('union-type'), 'concubinage');
		w.save();
		await settle();
		expect(w.sent.v).toEqual({ ...base, type: 'concubinage', endedBy: 'death' });
	});

	it('a pick shows again after hide and show, and then it is sent', async () => {
		const w = open(base);
		w.choose(w.select('union-ended-by'), 'divorce');
		w.choose(w.select('union-type'), 'affair');
		w.choose(w.select('union-type'), 'marriage');
		w.save();
		await settle();
		expect(w.sent.v).toEqual({ ...base, endedBy: 'divorce' });
	});

	it('the choice is a select, as the type choice: no numeric keyboard and the focus stays on the type choice at the start', () => {
		const w = open(base);
		expect(w.select('union-ended-by').tag).toBe('select');
		expect(w.select('union-ended-by').hasClass('dynasty-sheet-input')).toBe(true);
	});
});

describe('the helper', () => {
	it('endedByChoice: a known value or an alias in any case is the known value; other text as written; none is empty', () => {
		expect(['divorce', ' ANNULMENT', 'Death ', 'divorced', ' Annulled', 'x Y', '', undefined, null].map(endedByChoice)).toEqual(['divorce', 'annulment', 'death', 'divorce', 'annulment', 'x Y', '', '', '']);
	});
});

// The write path: the real edit sheet, the real window and `applyOp` on a small note.
const NOTE = (union: string) => ['people:', '  - id: a', '    name: A', '  - id: b', '    name: B', 'unions:', `  - partners: [a, b]${union}`, ''].join('\n');

async function editAndSave(body: string, pick: (w: ReturnType<typeof open>) => void): Promise<Op[]> {
	const sent: Op[] = [];
	const handle = {
		body,
		state: { lastEdited: null, highlight: null },
		write: async (op: Op) => {
			sent.push(op);
			return { ok: false, code: 'missing' };
		},
	} as never;
	const sheet = EditSheet.create({} as never, { handle, personId: 'a', sourcePath: 'x.md' })!;
	const link = familyOf((loadSheet(body, 'a') as unknown as { data: { g: never } }).data.g, 'a')!.partners[0];
	(sheet as unknown as { editPartnership(l: unknown): void }).editPartnership(link);
	const modal = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
	const w = {
		root: modal.contentEl,
		select: (name: string) => modal.contentEl.querySelector(`[data-field="${name}"] select`) as FEl,
		choose: (el: FEl, value: string) => {
			el.value = value;
			dispatch(el, 'change');
		},
		save: () => dispatch(modal.modalEl.querySelectorAll('button').find((b) => b.getText() === 'Save') as FEl, 'click'),
	} as unknown as ReturnType<typeof open>;
	pick(w);
	w.save();
	await settle();
	return sent;
}

const edit = (ops: Op[]) => ops.map((o) => (o as { fields?: unknown }).fields);
const applied = (body: string, ops: Op[]) => {
	const r = applyOp(body, ops[0]);
	if (!r.ok) throw new Error(`refused: ${r.code}`);
	return r.body;
};

describe('the write of the edit sheet', () => {
	it('a choice writes ended-by after end, one edit-union, no other key', async () => {
		const body = NOTE('\n    start: 1200\n    end: 1230');
		const ops = await editAndSave(body, (w) => w.choose(w.select('union-ended-by'), 'divorce'));
		expect(edit(ops)).toEqual([{ 'ended-by': 'divorce' }]);
		expect(applied(body, ops)).toBe(NOTE('\n    start: 1200\n    end: 1230\n    ended-by: divorce'));
	});

	it('"Not known" removes the key and leaves the other keys', async () => {
		const body = NOTE('\n    end: 1230\n    ended-by: death');
		const ops = await editAndSave(body, (w) => w.choose(w.select('union-ended-by'), ''));
		expect(edit(ops)).toEqual([{ 'ended-by': null }]);
		expect(applied(body, ops)).toBe(NOTE('\n    end: 1230'));
	});

	it('Save with no change writes nothing', async () => {
		expect(await editAndSave(NOTE('\n    ended-by: Death'), () => undefined)).toEqual([]);
		expect(await editAndSave(NOTE('\n    ended-by: divorced'), () => undefined)).toEqual([]);
		expect(await editAndSave(NOTE(''), () => undefined)).toEqual([]);
	});

	it('a type change alone keeps the value in the note, also when the choice hides', async () => {
		const body = NOTE('\n    ended-by: divorced');
		const ops = await editAndSave(body, (w) => w.choose(w.select('union-type'), 'affair'));
		expect(edit(ops)).toEqual([{ type: 'affair' }]);
		expect(applied(body, ops)).toBe(NOTE('\n    type: affair\n    ended-by: divorced'));
	});

	it('a marriage with its own type word shows the choice and writes only ended-by', async () => {
		const body = NOTE('\n    type: morganatic');
		const ops = await editAndSave(body, (w) => w.choose(w.select('union-ended-by'), 'death'));
		expect(edit(ops)).toEqual([{ 'ended-by': 'death' }]);
		expect(applied(body, ops)).toBe(NOTE('\n    type: morganatic\n    ended-by: death'));
	});

	it('an unknown written value is replaced only when the user picks another choice', async () => {
		const body = NOTE('\n    ended-by: repudiated');
		const ops = await editAndSave(body, (w) => w.choose(w.select('union-ended-by'), 'annulment'));
		expect(edit(ops)).toEqual([{ 'ended-by': 'annulment' }]);
		expect(applied(body, ops)).toBe(NOTE('\n    ended-by: annulment'));
	});
});
