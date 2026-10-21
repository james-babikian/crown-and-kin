import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { closePluginModals } from '../src/view/plugin-modals';
import type { SuccessionView } from '../src/obsidian/succession-section';
import { FEl, clock, device, dispatch, fakeDoc, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { openWin, page, save } from './r027-window-support';
import { stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * r032 (iPhone fault, 2026-10-17): a native drop-down stayed open after a choice in the Titles window, Succession section.
 * Cause: the section drew itself again inside the change event and gave the focus to the NEW select. The rule (option A): a
 * choice updates the page in place. The select that the user used stays, and the code gives the focus to no select. These
 * tests cannot show the iOS menu itself (Obsidian/WebKit only). They prove the element and the focus, and that nothing else changed.
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
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const KEYS = ['rule', 'inherit', 'through', 'illegitimate'] as const;
const TITLES = ['duke-of-carrowmere', 'countess-of-harrowfen', 'margrave-of-the-salt-coast', 'lord-of-wetherby'];

/** What a tap on a native select does: it gets the focus, then the user picks a value and `change` fires. */
function tapAndChoose(sel: FEl, value: string): void {
	sel.focus();
	sel.value = value;
	dispatch(sel, 'change');
}

/** A text picture of an element and everything in it, for a comparison (the element identity is not in it). */
function snap(el: FEl, depth = 0): string {
	// The ids and the links between ids are counters or random: the picture leaves them out.
	const attrs = [...el.attrs.entries()].filter(([k]) => !['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].includes(k)).sort().map(([k, v]) => `${k}=${v}`).join(' ');
	const form = el.tag === 'select' || el.tag === 'input' || el.tag === 'option' ? ` value=${el.value} checked=${el.checked} disabled=${el.disabled}` : '';
	const head = `${'  '.repeat(depth)}<${el.tag} .${[...el.classes].sort().join('.')} ${attrs}${form}${el.hidden ? ' hidden' : ''}> ${el.text}`;
	return [head, ...el.children.map((c) => snap(c, depth + 1))].join('\n');
}

/** The other values that a select offers. */
const otherValues = (sel: FEl): string[] => sel.children.map((o) => o.value || o.getAttribute('value') || '').filter((v) => v !== '?');

const viewOf = (o: ReturnType<typeof openWin>): SuccessionView => (o.win as unknown as { section: SuccessionView }).section;

describe('Titles window, Succession: a choice in a drop-down updates the page in place', () => {
	for (const key of KEYS) {
		it(`${key}: the select that the user used is still the one on the page, and the focus is not given to another select`, () => {
			const o = openWin();
			const p = page(o, 'duke-of-carrowmere');
			const old = p.querySelector(`[data-succ="${key}"] select`);
			if (!old) return; // the field does not exist for this title: nothing to prove
			const values = otherValues(old).filter((v) => v !== old.value);
			tapAndChoose(old, values[0]);
			expect(p.querySelector(`[data-succ="${key}"] select`)).toBe(old);
			const active = fakeDoc.activeElement;
			expect(active?.tag === 'select' ? active : null, 'the focus is on no select, or on the select that the user used').toSatisfy((a: FEl | null) => a === null || a === old);
		});
	}

	it('inherit: the select that the user tapped is still the one on the page (it is not destroyed under the open menu)', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		const old = p.querySelector('[data-succ="inherit"] select')!;
		tapAndChoose(old, old.value === 'men-only' ? 'women-only' : 'men-only');
		expect(p.querySelector('[data-succ="inherit"] select')).toBe(old);
	});

	it('a choice does not move the focus: a text field that has the focus keeps it', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		const year = p.querySelector('input.dynasty-succ-year')!;
		year.focus();
		const sel = p.querySelector('[data-succ="inherit"] select')!;
		sel.value = 'women-only';
		dispatch(sel, 'change');
		expect(fakeDoc.activeElement).toBe(year);
		expect(p.querySelector('input.dynasty-succ-year')).toBe(year);
	});

	it('the rule None removes the two choices and a real rule brings them back; the rule select stays', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		const rule = p.querySelector('[data-succ="rule"] select')!;
		tapAndChoose(rule, '');
		expect(p.querySelector('[data-succ="inherit"]')).toBeNull();
		expect(p.querySelector('[data-succ="through"]')).toBeNull();
		tapAndChoose(rule, 'siblings-first');
		expect(p.querySelector('[data-succ="rule"] select')).toBe(rule);
		const inherit = p.querySelector('[data-succ="inherit"] select');
		expect(inherit, 'the choice of who can inherit is back').not.toBeNull();
		// The new choices stand between the rule and the year, in the same order as a full draw.
		const order = p.querySelector('[data-succ="rule"]')!.parentElement!.parentElement!.children.map((c) => c.children[0]?.getAttribute('data-succ'));
		expect(order).toEqual(['rule', 'inherit', 'through', 'year', 'illegitimate']);
		// A select that came back works as well: its choice reaches the draft and keeps the select.
		tapAndChoose(inherit!, 'women-first-in-house');
		expect(p.querySelector('[data-succ="inherit"] select')).toBe(inherit);
		expect(p.querySelector('[data-hint="inherit"]')?.getText()).toBeTruthy();
	});

	// The page after a choice must be the page that a full draw gives, and the note must get the same change.
	for (const id of TITLES) {
		for (const key of KEYS) {
			it(`${id}, ${key}: each choice gives the same rows, hints and written value as a full draw`, async () => {
				const first = openWin();
				const firstPage = page(first, id);
				const sel0 = firstPage.querySelector(`[data-succ="${key}"] select`);
				if (!sel0) return; // this title has no such field (a title with no rule)
				const values = otherValues(sel0);
				expect(values.length).toBeGreaterThan(1);
				for (const value of values) {
					resetDom();
					const o = openWin();
					const p = page(o, id);
					const sel = p.querySelector(`[data-succ="${key}"] select`)!;
					tapAndChoose(sel, value);
					const inPlace = snap(p);
					expect(p.querySelector(`[data-succ="${key}"] select`) ?? sel).toBe(sel);
					// The full draw is what the section did before the repair: all the bodies, from the draft.
					viewOf(o).draw();
					const full = snap(p);
					expect(inPlace, `${id} ${key}=${value}`).toBe(full);
					await save(o);
					const written = JSON.stringify(o.handle.ops);
					// The same choice in a second window, then the full draw before the save: the same note change.
					resetDom();
					const o2 = openWin();
					const p2 = page(o2, id);
					const sel2 = p2.querySelector(`[data-succ="${key}"] select`)!;
					sel2.value = value;
					dispatch(sel2, 'change');
					viewOf(o2).draw();
					await save(o2);
					expect(JSON.stringify(o2.handle.ops), `${id} ${key}=${value}: the written change`).toBe(written);
				}
			});
		}
	}
});

describe('Person window, Family section: the parent-type select', () => {
	const BODY = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bran', '    parents: [a]', ''].join('\n');

	async function openSheet() {
		const qs = FEl.prototype.querySelector;
		vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'b', sourcePath: 'n.md' })!;
		s.open();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		return { s, h, modal };
	}

	it('after the choice the select is the same element, and the focus is not given to another select', async () => {
		const { h, modal } = await openSheet();
		const sel = modal.querySelector('select.dynasty-family-select');
		if (!sel) throw new Error('no parent-type select (the Family section may need to be opened)');
		sel.focus();
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		expect(h.ops.length, 'the change wrote').toBe(1);
		expect(modal.querySelector('select.dynasty-family-select'), 'the select that the user used is still the one on the page').toBe(sel);
		expect(sel.value).toBe('adoptive');
		// The page is updated in place (r032 fix round), so the select that the user used keeps its focus.
		expect(fakeDoc.activeElement).toBe(sel);
	});

	it('the written change and the page are the same as a full build', async () => {
		const { s, h, modal } = await openSheet();
		const sel = modal.querySelector('select.dynasty-family-select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		expect(h.ops).toEqual([expect.objectContaining({ kind: 'set-parent-type', child: 'b', parent: 'a', to: 'adoptive' })]);
		const kept = snap(modal);
		// A build makes a new select: this is the page that the code made before the repair.
		(s as unknown as { build(): void }).build();
		expect(modal.querySelector('select.dynasty-family-select')).not.toBe(sel);
		expect(snap(modal)).toBe(kept);
	});

	it('the same select still writes the next change', async () => {
		const { h, modal } = await openSheet();
		const sel = modal.querySelector('select.dynasty-family-select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		sel.value = 'biological';
		dispatch(sel, 'change');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		expect(h.ops.length).toBe(2);
		expect(h.ops[1]).toEqual(expect.objectContaining({ kind: 'set-parent-type', from: 'adoptive', to: 'biological' }));
		expect(modal.querySelector('select.dynasty-family-select')).toBe(sel);
	});
});
