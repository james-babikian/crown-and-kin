import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { afterPaint } from '../src/obsidian/sheet-parts';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';
import { DynastySettingTab, type SettingsHost } from '../src/obsidian/settings-tab';
import * as UIT from '../src/render/ui-text';
import { HOUSES, SETTINGS_UI, SHEET, TITLES_UI, WRITE_TEXT } from '../src/render/ui-text';
import * as VT from '../src/render/view-text';
import * as ST from '../src/render/succession-text';
import { FEl, clock, device, dispatch, fakeDoc, fakeWin, installDom, resetDom, runFrame, runTimers, settle } from './acceptance/fake-dom';
import { notices, resetObsidian, settingRows } from './acceptance/fake-obsidian';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';

/*
 * Version 0.3.1, package WP-S group S-B: the small points F6 (Save in a large tree shows that it saves), F7 (the computer
 * edit window starts in Name), F10 (settings groups and the word "default") and F11 (one text for a stale save).
 * F14 (screen-reader labels) waits for the supervisor's ruling on a rule; it has no test here.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
	device.coarse = false;
});

const BODY = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bran', '    parents: [a]', ''].join('\n');

function open(body = BODY, id = 'b') {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	const modal = (s as unknown as { modalEl: FEl }).modalEl;
	return { h, s, modal };
}

describe('F11: one text for a stale save', () => {
	it('the Notice and the red line of the edit sheet say the same words', async () => {
		const { h, modal } = open();
		type(modal.querySelector('[data-field="title"] input')!, 'Lord');
		h.body = `${BODY}# changed\n`;
		await click(modal.querySelector('.dynasty-sheet-save'));
		const line = modal.querySelector('.dynasty-sheet-error')!.getText();
		expect(line).not.toBe('');
		expect(notices).toEqual([line]);
	});

	it('the edit sheet, the Houses window and the Titles window use one constant', () => {
		expect(HOUSES.stale).toBe(WRITE_TEXT.staleWindow);
		expect(TITLES_UI.stale).toBe(WRITE_TEXT.staleWindow);
	});

	it('the text tells the owner what to do next', () => {
		expect(WRITE_TEXT.staleWindow).toContain('Select Save again');
	});
});

describe('F10a: the group "Cards" holds only card settings', () => {
	function groups(): Map<string, string[]> {
		const host = { settings: DEFAULT_SETTINGS, changeSettings: async () => undefined, clearCaches: () => undefined } as unknown as SettingsHost;
		new DynastySettingTab({} as never, host).display();
		const out = new Map<string, string[]>();
		for (const row of settingRows) {
			const head = row.settingEl.closest('.setting-group')!.querySelector('.setting-item-heading')!.getText();
			out.set(head, [...(out.get(head) ?? []), row.nameEl.getText()]);
		}
		return out;
	}

	it('the three settings of the line of succession are in their own group, after Relations and warnings (D246)', () => {
		const g = groups();
		expect(g.get(SETTINGS_UI.groups.succession)).toEqual([SETTINGS_UI.successionLength, SETTINGS_UI.oldAge, SETTINGS_UI.youngDeathAge]);
		const cards = g.get(SETTINGS_UI.groups.cards)!;
		for (const n of [SETTINGS_UI.successionLength, SETTINGS_UI.oldAge, SETTINGS_UI.youngDeathAge]) expect(cards).not.toContain(n);
		const order = [...g.keys()];
		expect(order.indexOf(SETTINGS_UI.groups.succession)).toBe(order.indexOf(SETTINGS_UI.groups.relations) + 1);
	});

	it('the group has a short plain name', () => {
		expect(SETTINGS_UI.groups.succession).toBe('Line of succession');
	});
});

describe('F10b: one word for the default', () => {
	const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
	const section = readme.slice(readme.indexOf('\n## Settings\n'), readme.indexOf('\n## Reduce movement\n'));

	it('the Settings section of the README has the group count and every group name of the settings page', () => {
		expect(section.length).toBeGreaterThan(500);
		expect(Object.keys(SETTINGS_UI.groups)).toHaveLength(8);
		expect(section).toContain('in eight groups');
		for (const name of Object.values(SETTINGS_UI.groups)) expect(section, name).toContain(`Group "${name}"`);
	});

	it('the README says "The default is", never "at first"', () => {
		expect(section).not.toMatch(/at first/i);
		expect(section).toContain('The default is 500.');
		expect(section).toContain('The default is 3.');
	});

	it('the texts of the settings page say "The default is" for a default', () => {
		for (const [key, text] of Object.entries(SETTINGS_UI)) {
			if (typeof text !== 'string') continue;
			expect(text, key).not.toMatch(/at first|by default|standard value/i);
		}
		expect(SETTINGS_UI.heightDesktopDesc).toContain('The default is 500.');
		expect(SETTINGS_UI.generationsDesc).toContain('The default is 3.');
	});
});

describe('F7: the computer edit window starts in Name', () => {
	const nameInput = (modal: FEl) => modal.querySelector('[data-field="name"] input') as FEl;

	it('a saved person: the focus is in Name, also when Obsidian moves it to the first control after the open', async () => {
		const { modal } = open();
		// What Obsidian does on a computer: the focus goes to the first control of the window ("Add portrait or arms").
		modal.querySelector('.dynasty-add-portrait')!.focus();
		await settle();
		expect(fakeDoc.activeElement).toBe(nameInput(modal));
	});

	it('a saved person with the focus left on the page: still Name', async () => {
		const { modal } = open();
		await settle();
		expect(fakeDoc.activeElement).toBe(nameInput(modal));
	});

	it('a touch screen: the focus is not put in Name, so the keyboard stays closed', async () => {
		device.coarse = true;
		const { modal } = open();
		await settle();
		expect(fakeDoc.activeElement).not.toBe(nameInput(modal));
		expect(modal.contains(fakeDoc.activeElement)).toBe(true);
	});

	it('a narrow window (a phone): the focus is not put in Name', async () => {
		device.width = 390;
		device.height = 844;
		const { modal } = open();
		await settle();
		expect(fakeDoc.activeElement).not.toBe(nameInput(modal));
	});

	it('a read-only window: the focus stays on the window', async () => {
		const { modal } = open(['people:', '  - id: a', '    name: Aldric', '  - id: a', '    name: Bran', ''].join('\n'), 'a');
		await settle();
		expect(modal.hasClass('is-read-only')).toBe(true);
		expect(fakeDoc.activeElement).not.toBe(nameInput(modal));
	});
});

describe('F6: Save in a large tree shows at once that it saves', () => {
	const big = (n: number) => ['people:', ...Array.from({ length: n }, (_, i) => `  - id: p${i}\n    name: Person ${i}`), ''].join('\n');
	const saveButton = (modal: FEl) => modal.querySelector('.dynasty-sheet-save') as FEl;

	async function press(modal: FEl) {
		type(modal.querySelector('[data-field="title"] input')!, 'Lord');
		dispatch(saveButton(modal), 'click', { detail: 1 });
		await settle();
	}

	it('a large tree: the sign shows, and the write waits for one paint', async () => {
		const { h, modal } = open(big(320), 'p5');
		await settle();
		await press(modal);
		expect(saveButton(modal).getText()).toBe(SHEET.saveWait);
		expect(modal.querySelector('.dynasty-sheet-status')!.getText()).toBe(SHEET.savingStatus);
		expect(modal.hasClass('is-saving')).toBe(true);
		// The write has not started: the browser has not painted the sign yet.
		expect(h.ops).toHaveLength(0);
		runFrame();
		runTimers(0);
		await settle();
		expect(h.ops).toHaveLength(1);
	});

	it('a large tree with paused frames: the write starts after the time limit', async () => {
		const { h, modal } = open(big(320), 'p5');
		await settle();
		await press(modal);
		expect(h.ops).toHaveLength(0);
		runTimers(150);
		await settle();
		expect(h.ops).toHaveLength(1);
	});

	it('a large tree: after a stale write the button says Save again and the sign is gone', async () => {
		const { h, modal } = open(big(320), 'p5');
		await settle();
		h.body = `${h.body}# changed\n`;
		await press(modal);
		runFrame();
		runTimers(0);
		await settle();
		expect(h.ops).toHaveLength(0);
		expect(saveButton(modal).getText()).toBe(SHEET.save);
		expect(modal.querySelector('.dynasty-sheet-status')?.getText() ?? '').not.toBe(SHEET.savingStatus);
		expect(modal.hasClass('is-saving')).toBe(false);
	});

	it('a small tree: no sign and no wait; the write starts at once', async () => {
		const { h, modal } = open();
		await settle();
		await press(modal);
		expect(h.ops).toHaveLength(1);
	});

	it('afterPaint ends at the frame, or at the limit if frames are paused', async () => {
		let frame: (() => void) | null = null;
		const timers: (() => void)[] = [];
		const win = {
			requestAnimationFrame: (cb: () => void) => void (frame = cb) as unknown as number,
			setTimeout: (cb: () => void) => timers.push(cb) as unknown as number,
			clearTimeout: () => undefined,
		};
		let done = false;
		void afterPaint(win as never, 100).then(() => (done = true));
		await Promise.resolve();
		expect(done).toBe(false);
		frame!();
		timers[1]!();
		await Promise.resolve();
		expect(done).toBe(true);
	});
});

describe('F7b: Enter in a single-line field ends the entry and never saves', () => {
	const nameInput = (modal: FEl) => modal.querySelector('[data-field="name"] input') as FEl;

	it('Enter in Name: the field loses the focus, nothing is written, the window stays open', async () => {
		const { h, modal } = open();
		await settle();
		expect(fakeDoc.activeElement).toBe(nameInput(modal));
		type(nameInput(modal), 'Brand');
		const e = dispatch(nameInput(modal), 'keydown', { key: 'Enter', isComposing: false, keyCode: 13 });
		await settle();
		expect(e.defaultPrevented).toBe(true);
		expect(fakeDoc.activeElement).not.toBe(nameInput(modal));
		expect(h.ops).toHaveLength(0);
		expect(modal.hasClass('is-saving')).toBe(false);
		expect(nameInput(modal).value).toBe('Brand');
	});

	it('an input method that accepts its text with Enter (keyCode 229, isComposing) is left alone', async () => {
		const { modal } = open();
		await settle();
		const a = dispatch(nameInput(modal), 'keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
		const b = dispatch(nameInput(modal), 'keydown', { key: 'Enter', isComposing: false, keyCode: 229 });
		expect(a.defaultPrevented).toBe(false);
		expect(b.defaultPrevented).toBe(false);
		expect(fakeDoc.activeElement).toBe(nameInput(modal));
	});

	it('another key is left alone, and a note (several text lines) keeps Enter as a new line', async () => {
		const { modal } = open();
		await settle();
		expect(dispatch(nameInput(modal), 'keydown', { key: 'a', keyCode: 65 }).defaultPrevented).toBe(false);
		const notes = modal.querySelector('[data-field="notes"] textarea') as FEl | null;
		if (notes) expect(dispatch(notes, 'keydown', { key: 'Enter', isComposing: false, keyCode: 13 }).defaultPrevented).toBe(false);
	});
});

describe('F14: one form for screen-reader labels (R1 to R3)', () => {
	/** Every UI constant of the three text files, with the name of the export. */
	const groups: [string, Record<string, unknown>][] = [];
	for (const mod of [UIT, VT, ST] as Record<string, unknown>[]) {
		for (const [name, v] of Object.entries(mod)) if (v && typeof v === 'object' && (name.endsWith('_UI') || name === 'UI')) groups.push([name, v as Record<string, unknown>]);
	}
	/** The label texts: the keys ending in Label or Aria, as text; a function is called with one name. */
	function labels(): { id: string; text: string; sibling: string | null }[] {
		const out: { id: string; text: string; sibling: string | null }[] = [];
		for (const [g, obj] of groups) {
			for (const [k, v] of Object.entries(obj)) {
				if (!/(Label|Aria)$/.test(k)) continue;
				let text: string | null = null;
				if (typeof v === 'string') text = v;
				else if (typeof v === 'function') {
					try {
						const r = (v as (a: string) => unknown)('Aldric');
						if (typeof r === 'string') text = r;
					} catch {
						text = null;
					}
				}
				if (text === null) continue;
				const base = k.replace(/(Label|Aria)$/, '');
				const sib = obj[base] ?? obj[base.replace(/^open$/, 'open')];
				out.push({ id: `${g}.${k}`, text, sibling: typeof sib === 'string' ? sib : null });
			}
		}
		return out;
	}
	// R3 rows and cards: "Name, relation. Action." keep their full stops.
	// The badge of a card is a two-fact sentence, like a row: it keeps its full stops.
	const ROWS = new Set(['PHONE_LIST_UI.goLabel', 'WINDOW_UI.openPersonLabel', 'FOCUS_UI.badgeLabel']);

	it('finds the labels', () => {
		expect(labels().length).toBeGreaterThan(40);
	});

	it('R1: no label ends with a full stop (rows of R3 excepted)', () => {
		const bad = labels().filter((l) => !ROWS.has(l.id) && l.text.trim().endsWith('.'));
		expect(bad.map((l) => `${l.id}: ${l.text}`)).toEqual([]);
	});

	it('R1: a label with a colon starts with the visible text of its control when the control has one', () => {
		const bad = labels().filter((l) => l.sibling !== null && l.text.includes(': ') && !l.text.startsWith(l.sibling));
		expect(bad.map((l) => `${l.id}: ${l.text} (visible: ${l.sibling})`)).toEqual([]);
	});

	it('the changed labels', () => {
		expect(VT.BLOCK_UI.openSourceLabel).toBe('Open note: open the note that contains this tree');
		expect(VT.BLOCK_UI.showTextLabel).toBe('Show the tree text: open the note and show the text of this tree');
		expect(VT.BLOCK_UI.resizeLabel).toBe('Drag to change the height of the tree');
		expect(VT.FINDER_UI.closeLabel).toBe('Close: show the tree as it was before');
		expect(ST.SUCCESSION_UI.moveEarlierLabel('Aldric')).toBe('Move earlier: move Aldric earlier');
		expect(ST.SUCCESSION_UI.moveLaterLabel('Aldric')).toBe('Move later: move Aldric later');
		expect(UIT.PICTURES_UI.armsButtonLabel('House Valmont')).toBe('Change the arms of House Valmont');
		expect(UIT.ID_UI.openAria('Duke')).toBe('Change ID: change the ID of Duke');
		expect(UIT.ID_UI.keepOldAria('Duke')).toBe('Keep old ID: keep the old ID of Duke');
		expect(UIT.ID_UI.makeAria('Duke')).toBe('Make ID from the name: make the ID of Duke from the name');
	});

	it('R3 is unchanged', () => {
		expect(VT.PHONE_LIST_UI.goLabel('Wren', 'half-sister')).toBe('Wren, half-sister. Show the family of Wren.');
		expect(UIT.WINDOW_UI.openPersonLabel('Wren', 'half-sister')).toBe('Wren, half-sister. Open this person.');
	});
});
