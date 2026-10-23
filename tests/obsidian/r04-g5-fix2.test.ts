// Second fix round of 0.4 part 6 (G5): the faults of the look, keyboard and phone check, held by tests where a unit test can hold them. Each block names its item.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { choose } from '../../src/obsidian/choice-modal';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { hintSide } from '../../src/obsidian/hint-place';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { TreeViewBase } from '../../src/obsidian/tree-view-base';
import { HOUSE_PALETTE } from '../../src/render/styles';
import { menuKey } from '../../src/render/dom/widgets';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, dispatch, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { cycleNote, eraNote } from '../support/calendar-vault';
import { openWindow } from '../support/calendar-window-app';
import { useFakeDom } from '../support/fake-dom-setup';
import { stripNotDisabled, writingHandle } from '../support/s113-c-support';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	// A window left open stays in the plugin's list of open windows, and a later test would see it.
	closePluginModals();
	vi.restoreAllMocks();
});

const chunk = (name: string): string => readFileSync(join(__dirname, '..', '..', 'styles', name), 'utf8');

/** The declarations of the first rule whose selector list holds `selector` exactly. */
function ruleOf(css: string, selector: string): string {
	const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const at = plain.split('}').find((r) => r.split('{')[0].split(',').some((s) => s.trim() === selector));
	return at ? at.split('{')[1] : '';
}

const BODY = ['people:', '  - id: a', '    name: Aldric', ''].join('\n');

describe('item 1: the Calendar note choice of the Calendars window has the drop-down arrow', () => {
	it('the select of the notes sits in a wrapper with the chevron icon, hidden from a screen reader', async () => {
		const { win } = await openWindow({ 'Alpha.md': cycleNote('Alpha Count'), 'Beta.md': eraNote('Beta Eras'), 'tree.md': 'plain' });
		const select = win.contentEl.querySelector('[data-focus="cal:note"]')!;
		const wrap = select.parentElement!;
		expect(wrap.hasClass('dynasty-select')).toBe(true);
		const chevron = wrap.querySelector('.dynasty-select-chevron');
		expect(chevron).not.toBeNull();
		expect(chevron!.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('item 2: the More list works as a menu for the keyboard', () => {
	const list = () => {
		const el = fakeDoc.body.createDiv({ cls: 'dynasty-popover' });
		const rows = ['a', 'b', 'c'].map((t) => el.createEl('button', { cls: 'dynasty-popover-item', text: t }));
		return { el, rows };
	};
	const key = (k: string, more: Record<string, unknown> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...more }) as unknown as KeyboardEvent;

	it('Arrow Down and Up move to the next and the earlier row and go round; Home and End go to the first and the last', () => {
		const { el, rows } = list();
		rows[0].focus();
		const host = el as unknown as HTMLElement;
		expect(menuKey(host, key('ArrowDown'))).toBe(true);
		expect(fakeDoc.activeElement).toBe(rows[1]);
		menuKey(host, key('ArrowUp'));
		menuKey(host, key('ArrowUp'));
		expect(fakeDoc.activeElement).toBe(rows[2]);
		menuKey(host, key('Home'));
		expect(fakeDoc.activeElement).toBe(rows[0]);
		menuKey(host, key('End'));
		expect(fakeDoc.activeElement).toBe(rows[2]);
	});

	it('leaves other keys, a key with a modifier, and a focus outside the rows alone', () => {
		const { el, rows } = list();
		const host = el as unknown as HTMLElement;
		rows[0].focus();
		expect(menuKey(host, key('Tab'))).toBe(false);
		expect(menuKey(host, key('ArrowDown', { shiftKey: true }))).toBe(false);
		expect(fakeDoc.activeElement).toBe(rows[0]);
		fakeDoc.body.createEl('button').focus();
		expect(menuKey(host, key('ArrowDown'))).toBe(false);
	});

	it('a row of the list with the keyboard focus has the ring of a toolbar button', () => {
		const rule = ruleOf(chunk('08-toolbar.css'), '.dynasty-popover .dynasty-popover-item:focus-visible');
		expect(rule).toContain('outline: 2px solid var(--interactive-accent)');
		expect(rule).toContain('box-shadow: inset 0 0 0 4px var(--text-normal)');
	});
});

describe('item 3: the check boxes of the person window show a focus ring', () => {
	it('the rule gives a tick box with the keyboard focus the ring of the window buttons', () => {
		const rule = ruleOf(chunk('10-edit-sheet.css'), ".dynasty-sheet .dynasty-check input[type='checkbox']:focus-visible");
		expect(rule).toContain('outline: 2px solid var(--background-modifier-border-focus)');
		expect(rule).toContain('box-shadow: 0 0 0 2px var(--interactive-accent)');
	});
});

describe('item 4: the focus comes back to the same place after a write drew it again', () => {
	it('a new-person window closes after the person window was built again: the focus goes to the same control there', () => {
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		s.open();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		const add = modal.querySelector('[data-focus="dynasty-add-child"]')!;
		add.focus();
		(s as unknown as { openNew(rel: unknown): void }).openNew({ kind: 'child', parent: 'a', other: null, union: null });
		const child = openModals[openModals.length - 1] as unknown as { close(): void; closing: boolean };
		expect(child).not.toBe(s);
		// The save of the child: the person window is built again, and its old button is gone with the focus.
		s.afterWrite(h.body);
		fakeDoc.activeElement = null;
		child.closing = true;
		child.close();
		const now = modal.querySelector('[data-focus="dynasty-add-child"]')!;
		expect(now).not.toBe(add);
		expect(fakeDoc.activeElement).toBe(now);
	});

	it('the card of the person gets the focus in the new drawing, only while the focus is on nothing', () => {
		const viewport = fakeDoc.body.createDiv();
		const card = viewport.createDiv({ cls: 'dynasty-card', attr: { 'data-person': 'a"b' } });
		viewport.createDiv({ cls: 'dynasty-card', attr: { 'data-person': 'c' } });
		const view = { unloaded: false, viewport };
		const host = { views: new Set([view]) } as never;
		const find = (vp: HTMLElement) => Array.from(vp.querySelectorAll<HTMLElement>('.dynasty-card')).find((c) => c.getAttribute('data-person') === 'a"b') ?? null;
		const other = fakeDoc.body.createEl('input');
		other.focus();
		TreeViewBase.refocusAfterRedraw(host, () => true, find, true, 2);
		expect(fakeDoc.activeElement).toBe(other);
		fakeDoc.activeElement = null;
		TreeViewBase.refocusAfterRedraw(host, () => true, find, true, 2);
		expect(fakeDoc.activeElement).toBe(card);
	});
});

describe('item 5: the first-view hint never covers a card', () => {
	const view = { scale: 1, cx: 200, cy: 400 };
	const size = { w: 400, h: 800 };
	// The hint at the right edge, 8 px from it, 28 px high, above the bottom bar.
	const hint = { x: 252, y: 700, w: 140, h: 28 };
	// A tree point (x, y) is at the screen point (x, y) at this view.
	it('stays at the right when no card is there (the look of the Default theme)', () => {
		expect(hintSide([{ x: 20, y: 100, w: 150, h: 60 }], view, size, hint)).toBe('right');
		// A card that only touches the hint is not covered.
		expect(hintSide([{ x: 252, y: 640, w: 140, h: 60 }], view, size, hint)).toBe('right');
	});

	it('goes to the left corner when a card is in the right corner', () => {
		expect(hintSide([{ x: 300, y: 690, w: 150, h: 60 }], view, size, hint)).toBe('left');
	});

	it('goes when both corners have a card', () => {
		expect(hintSide([{ x: 300, y: 690, w: 150, h: 60 }, { x: 0, y: 710, w: 100, h: 60 }], view, size, hint)).toBeNull();
	});

	it('follows the zoom and the pan of the view', () => {
		// At scale 2 around (100, 200), the card (140, 345)-(165, 360) is on the screen at (280, 690)-(330, 720): in the right corner.
		expect(hintSide([{ x: 140, y: 345, w: 25, h: 15 }], { scale: 2, cx: 100, cy: 200 }, size, hint)).toBe('left');
	});
});

describe('item 6: the choice window', () => {
	it('Shift+Tab on the first choice goes to the last control of the window, and Tab on the last back to the first', async () => {
		void choose(app(), { name: 'test', title: 'Question', choices: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }] });
		const m = openModals[openModals.length - 1] as unknown as { modalEl: FEl };
		const options = m.modalEl.querySelectorAll('.dynasty-choice-option');
		expect(fakeDoc.activeElement).toBe(options[0]);
		const back = dispatch(m.modalEl.querySelector('.dynasty-choice-option')!, 'keydown', { key: 'Tab', shiftKey: true });
		expect(back.defaultPrevented).toBe(true);
		const cancel = m.modalEl.querySelector('.dynasty-sheet-cancel')!;
		expect(fakeDoc.activeElement).toBe(cancel);
		dispatch(cancel, 'keydown', { key: 'Tab' });
		expect(fakeDoc.activeElement).toBe(options[0]);
		dispatch(options[0], 'keydown', { key: 'Tab' });
		expect(fakeDoc.activeElement).toBe(options[1]);
	});

	it('the title of a choice wraps on the phone bar, so a long note name shows whole', () => {
		const rule = ruleOf(chunk('12-choice-steps.css'), '.dynasty-choice .dynasty-bar .dynasty-bar-title');
		expect(rule).toContain('white-space: normal');
		expect(rule).not.toContain('ellipsis');
	});
});

describe('item 7: the window of a new partner starts in Name', () => {
	it('Obsidian puts the focus on "Type of partnership", the first control; the window moves it to Name', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'partner', partner: 'a' } } as never)!;
		s.open();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		const type = modal.querySelector('select')!;
		type.focus();
		await Promise.resolve();
		await Promise.resolve();
		expect(fakeDoc.activeElement).toBe(modal.querySelector('[data-field="name"] input'));
	});
});

describe('items 8 and 9: the colours of the Houses window', () => {
	const HOUSES_BODY = ['houses:', '  - id: thorne', '    name: House Thorne', `    color: "${HOUSE_PALETTE[0]}"`, 'people:', '  - id: a', '    name: Aldric', '    house: thorne', ''].join('\n');
	const page = () => {
		const win = HousesWindow.create({} as never, { handle: writingHandle(HOUSES_BODY) as never })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		dispatch(content.querySelector('button.dynasty-lw-row')!, 'click');
		return content;
	};

	it('a tap on a colour changes the swatches in place: the same elements, the ring and the checked state move, the focus on the colour', () => {
		const content = page();
		const body = content.querySelector('.dynasty-sheet-body')!;
		const swatches = content.querySelectorAll('.dynasty-house-colour');
		const sections = content.querySelectorAll('.dynasty-section');
		dispatch(swatches[4], 'click');
		expect(content.querySelector('.dynasty-sheet-body')).toBe(body);
		expect(content.querySelectorAll('.dynasty-house-colour')).toEqual(swatches);
		expect(content.querySelectorAll('.dynasty-section')).toEqual(sections);
		expect(swatches.filter((s) => s.hasClass('is-selected'))).toEqual([swatches[4]]);
		expect(swatches.map((s) => s.getAttribute('aria-checked'))).toEqual(swatches.map((_, i) => String(i === 4)));
		expect(fakeDoc.activeElement).toBe(swatches[4]);
	});

	it('a colour from "Other colour" shows in its swatch in place, and a colour of the set takes it out again', () => {
		const content = page();
		const input = content.querySelector('.dynasty-house-other input')!;
		const other = content.querySelector('.dynasty-swatch.is-other')!;
		input.value = '#12ab34';
		dispatch(input, 'change');
		expect(content.querySelector('.dynasty-house-other input')).toBe(input);
		expect(other.hasClass('is-custom')).toBe(true);
		expect(other.getAttribute('aria-checked')).toBe('true');
		expect(other.styleProps.get('--dynasty-house-color')).toBe('#12ab34');
		expect(content.querySelectorAll('.dynasty-house-colour').filter((s) => s.hasClass('is-selected'))).toEqual([]);
		dispatch(content.querySelectorAll('.dynasty-house-colour')[2], 'click');
		expect(other.hasClass('is-custom')).toBe(false);
		expect(other.getAttribute('aria-checked')).toBe('false');
		expect(other.styleProps.has('--dynasty-house-color')).toBe(false);
	});

	it('a colour from the iPhone colour window leaves the focus on the colour input, so the colour window does not close at once (owner iPhone test 0.4, 4d)', () => {
		const content = page();
		const input = content.querySelector('.dynasty-house-other input')!;
		input.focus();
		input.value = '#12ab34';
		dispatch(input, 'change');
		expect(fakeDoc.activeElement).toBe(input);
		expect(content.querySelector('.dynasty-swatch.is-other')!.hasClass('is-custom')).toBe(true);
	});

	it('a swatch keeps its colour under the finger: no tap highlight, and the pressed and hover states paint the house colour (owner iPhone test 0.4, 4b)', () => {
		const css = readFileSync(join(__dirname, '..', '..', 'styles', '21-houses-pictures.css'), 'utf8');
		expect(css).toMatch(/\.dynasty-sheet \.dynasty-swatch \{[^}]*-webkit-tap-highlight-color: transparent;[^}]*transition: none;/);
		expect(css).toMatch(/\.dynasty-sheet \.dynasty-swatch:is\(:hover, :active, :focus\) \{\s*background: var\(--dynasty-house-color\);/);
		expect(css).toMatch(/\.dynasty-sheet \.dynasty-swatch\.is-other:is\(:hover, :active, :focus\) \{\s*background: conic-gradient/);
	});

	it('the colour input lies over the "Other colour" swatch and takes the tap; the swatch stays the one control for the keyboard', () => {
		const content = page();
		const input = content.querySelector('.dynasty-house-other input')!;
		expect(input.getAttribute('tabindex')).toBe('-1');
		expect(input.getAttribute('aria-hidden')).toBe('true');
		const swatch = content.querySelector('.dynasty-swatch.is-other')!;
		expect(swatch.getAttribute('role')).toBe('radio');
		const rule = ruleOf(chunk('21-houses-pictures.css'), ".modal.dynasty-sheet input[type='color'].dynasty-house-other-input");
		expect(rule).toContain('pointer-events: auto');
		expect(rule).not.toContain('pointer-events: none');
		expect(rule).toContain('inset: 0');
		expect(rule).toContain('z-index: 1');
		// The input has the size of the swatch, not the 88 px of the colour field of the person window (a tap beside the swatch must not open the colour window).
		expect(rule).toContain('width: 100%');
		expect(rule).toContain('padding: 0');
	});
});

/** An app object for the choice window; the fake Modal does not use it. */
function app(): never {
	return {} as never;
}
