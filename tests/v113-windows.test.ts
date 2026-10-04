import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import * as UI from '../src/render/ui-text';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { HousesWindow } from '../src/obsidian/houses-window';
import { openHousePage } from '../src/obsidian/house-page-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { FEl, clock, fakeDoc, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp } from './acceptance/tree-view-fakes';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';

/*
 * Version 0.2.3, work package "windows" (spec D113 items 1 to 5; search round findings C1 to C8): the texts of the
 * delete question, the capital letters of ID, the note and the refused Save of the ID windows, the focus and the
 * names of the sheet.
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
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
	const esc = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
	const m = new RegExp(`^\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
	if (!m) throw new Error(`no CSS rule for ${selector}`);
	return m[1];
}

describe('D113 item 5: the word ID is in capital letters in every text', () => {
	/** Every string that a text table gives, also the strings of functions called with sample arguments. */
	function strings(v: unknown, depth = 0): string[] {
		if (typeof v === 'string') return [v];
		if (depth > 4 || v === null || v === undefined) return [];
		if (typeof v === 'function') {
			const out: string[] = [];
			for (const args of [['Sample'], ['Sample', 'Other'], [2], [1], [['Sample']], ['a', 'b', 'c', 'd'], [1, 2]]) {
				try {
					out.push(...strings((v as (...a: unknown[]) => unknown)(...args), depth + 1));
				} catch {
					/* a wrong argument shape: the next try */
				}
			}
			return out;
		}
		if (typeof v === 'object') return Object.values(v as Record<string, unknown>).flatMap((x) => strings(x, depth + 1));
		return [];
	}

	it('no text of ui-text.ts has the word "id" or "Id" or "ids" in lower case or mixed case', () => {
		const bad: string[] = [];
		for (const s of strings(UI)) for (const m of s.matchAll(/\b[Ii][Dd][Ss]?\b/g)) if (m[0] !== 'ID' && m[0] !== 'IDs') bad.push(`${m[0]} in "${s}"`);
		expect(bad).toEqual([]);
	});

	it('the ID texts of D105, D106, D109 and D110', () => {
		expect(UI.SHEET.idLine('p12')).toBe('ID: p12');
		expect(UI.ID_UI.open).toBe('Change ID');
		expect(UI.ID_UI.make).toBe('Make ID from the name');
		expect(UI.ID_UI.use).toBe('Use this ID');
		expect(UI.ID_UI.newId('crown')).toBe('New ID: crown');
		expect(UI.ID_UI.keepOld).toBe('Keep old ID');
		expect(UI.ID_UI.windowTitle('House Thorne')).toBe('ID of House Thorne');
		expect(UI.ID_UI.taken).toBe('This ID is in use. Enter a different ID.');
		expect(UI.ID_UI.hint('house')).toBe('The ID is a short name. The plugin uses it to find this house. Most users never change it.');
	});
});

describe('D113 item 1: the delete question of a house', () => {
	it('gives the count only, and the singular and plural texts agree', () => {
		expect(UI.HOUSES.confirmPeople(40)).toBe('40 people have this house.');
		expect(UI.HOUSES.confirmPeople(1)).toBe('1 person has this house.');
		expect(UI.HOUSES.confirmAsk(1)).toBe('Select what happens to this person.');
		expect(UI.HOUSES.clearLabel(1)).toBe('Remove the house from this person');
		expect(UI.HOUSES.clearDetail(1)).toBe('This person will have no house. The card will show no house colour.');
		expect(UI.HOUSES.keepLabel(1)).toBe('Keep the house for this person');
		expect(UI.HOUSES.keepDetail(1)).toBe('The tree text keeps the house for this person. The tree will show a warning for this person.');
		expect(UI.HOUSES.confirmAsk(2)).toBe('Select what happens to these people.');
		expect(UI.HOUSES.clearDetail(2)).toBe('These people will have no house. Their cards will show no house colour.');
		expect(UI.HOUSES.keepDetail(2)).toBe('The tree text keeps the house for these people. The tree will show a warning for each of them.');
	});

	it('the window asks with the singular texts for one person and shows no name', async () => {
		const body = ['houses:', '  - {id: valmont, name: House Valmont}', 'people:', '  - {id: a, name: Aldric Valmont, house: valmont}', ''].join('\n');
		const h = writingHandle(body);
		const win = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const modal = (win as unknown as { modalEl: FEl }).modalEl;
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-house-row[data-house="valmont"] .dynasty-house-delete'));
		const layer = modal.querySelector('.dynasty-sheet-confirm')!;
		expect(layer.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText())).toEqual(['1 person has this house.', 'Select what happens to this person.']);
		expect(layer.querySelector('.dynasty-house-clear .dynasty-choice-label')!.getText()).toBe('Remove the house from this person');
		expect(layer.querySelector('.dynasty-house-keep .dynasty-choice-detail')!.getText()).toBe(UI.HOUSES.keepDetail(1));
		// The three buttons are not in the part that scrolls.
		const scroll = layer.querySelector('.dynasty-sheet-confirm-scroll')!;
		expect(scroll.querySelector('button')).toBeNull();
		expect(layer.querySelectorAll('button')).toHaveLength(3);
	});

	it('the CSS: a box with a largest height, a layer with padding for the safe areas, one part that scrolls', () => {
		const layer = rule('.dynasty-sheet-confirm');
		expect(layer).toMatch(/padding-top:\s*max\(var\(--size-4-4\), env\(safe-area-inset-top/);
		expect(layer).toMatch(/padding-bottom:\s*max\(var\(--size-4-4\), env\(safe-area-inset-bottom/);
		const box = rule('.dynasty-sheet-confirm-box');
		expect(box).toMatch(/max-height:\s*100%/);
		expect(box).toMatch(/box-sizing:\s*border-box/);
		expect(rule('.dynasty-sheet-confirm-scroll')).toMatch(/overflow-y:\s*auto/);
	});
});

describe('D113 item 2: the note after "Use this ID"', () => {
	it('has the normal text colour and size; "Keep old ID" is a normal small button of at least 44 px', () => {
		const note = rule('.dynasty-id-new');
		expect(note).toMatch(/color:\s*var\(--text-normal\)/);
		expect(note).toMatch(/font-size:\s*var\(--font-ui-medium\)/);
		const button = rule('.dynasty-sheet button.dynasty-id-old');
		expect(button).toMatch(/min-height:\s*44px/);
		expect(button).toMatch(/background:\s*var\(--interactive-normal\)/);
		expect(button).toMatch(/color:\s*var\(--text-normal\)/);
		expect(button).not.toMatch(/--text-accent/);
	});

	it('on a phone the text takes the room that the button leaves, so the button stays on the line of the text', () => {
		expect(rule('.dynasty-sheet.is-phone .dynasty-id-new-text')).toMatch(/flex:\s*1 1 8em/);
	});
});

describe('D113 item 3: a refused Save shows its message once, in the row', () => {
	const HOUSES_BODY = ['houses:', '  - {id: valmont, name: House Valmont}', '  - {id: thorne, name: House Thorne}', 'people:', '  - {id: a, name: Aldric, house: valmont}', ''].join('\n');

	async function refusedHouses() {
		const h = writingHandle(HOUSES_BODY);
		const win = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-house-row[data-house="valmont"] .dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'house-valmont');
		await click(idWin.querySelector('.dynasty-id-use'));
		await click(content.querySelector('.dynasty-house-add'));
		const fresh = content.querySelectorAll('.dynasty-house-row').pop()!;
		type(fresh.querySelector('input')!, 'House Valmont');
		return { h, win, content, fresh };
	}

	it('the row has the class of the red edge while its draft is refused, and not after', async () => {
		const { content, fresh } = await refusedHouses();
		const row = content.querySelector('.dynasty-house-row[data-house="valmont"]')!;
		expect(row.hasClass('has-id-problem')).toBe(true);
		type(fresh.querySelector('input')!, 'House Other');
		expect(row.hasClass('has-id-problem')).toBe(false);
	});

	it('Save shows the reason once (in the note), nothing at the top, and puts the focus on "Change ID"', async () => {
		const { h, content } = await refusedHouses();
		await click(content.querySelector('.dynasty-sheet-save'));
		const row = content.querySelector('.dynasty-house-row[data-house="valmont"]')!;
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
		expect(row.querySelector('.dynasty-id-new-problem')!.getText()).toBe(UI.ID_UI.taken);
		const shown = ['.dynasty-sheet-error', '.dynasty-id-new-problem', '.dynasty-id-problem'].flatMap((q) => content.querySelectorAll(q)).filter((e) => e.getText() === UI.ID_UI.taken);
		expect(shown).toHaveLength(1);
		expect(fakeDoc.activeElement).toBe(row.querySelector('.dynasty-id-open'));
		expect(h.ops).toHaveLength(0);
	});

	it('an error at the top that is not about an ID still shows, and an earlier one goes when the ID is refused', async () => {
		const { content, fresh } = await refusedHouses();
		type(fresh.querySelector('input')!, '');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(UI.HOUSES.needName);
		type(fresh.querySelector('input')!, 'House Valmont');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
	});

	it('the Titles window does the same', async () => {
		const body = ['titles:', '  - {id: duke, name: Duke}', '  - {id: baron, name: Baron}', 'people:', '  - {id: a, name: Aldric, card-title: duke}', ''].join('\n');
		const h = writingHandle(body);
		const win = TitlesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-title-box[data-title="baron"] .dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'king');
		await click(idWin.querySelector('.dynasty-id-use'));
		await click(content.querySelector('.dynasty-title-add'));
		type(content.querySelectorAll('.dynasty-title-box').pop()!.querySelector('.dynasty-title-row input')!, 'King');
		await click(content.querySelector('.dynasty-sheet-save'));
		const row = content.querySelector('.dynasty-title-box[data-title="baron"] .dynasty-title-row')!;
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
		expect(row.hasClass('has-id-problem')).toBe(true);
		expect(row.querySelector('.dynasty-id-new-problem')!.getText()).toBe(UI.ID_UI.taken);
		expect(fakeDoc.activeElement).toBe(row.querySelector('.dynasty-id-open'));
		expect(h.ops).toHaveLength(0);
	});

	it('owner decision "3-both": the new row with the same name is marked too, with its own text, and both marks go when its name changes', async () => {
		const { h, content, fresh } = await refusedHouses();
		const saved = content.querySelector('.dynasty-house-row[data-house="valmont"]')!;
		expect(saved.hasClass('has-id-problem')).toBe(true);
		expect(fresh.hasClass('has-id-problem')).toBe(true);
		expect(saved.querySelector('.dynasty-id-new-problem')!.getText()).toBe(UI.ID_UI.taken);
		expect(fresh.querySelector('.dynasty-id-new-problem')!.getText()).toBe(UI.ID_UI.newName);
		const texts = () => content.querySelectorAll('.dynasty-id-new-problem').map((e) => e.getText()).filter((t) => t !== '');
		expect(texts()).toEqual([UI.ID_UI.taken, UI.ID_UI.newName]);
		// Save refuses, writes nothing and keeps the focus rule: the first saved row, not the new row.
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(h.ops).toHaveLength(0);
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
		expect(texts()).toEqual([UI.ID_UI.taken, UI.ID_UI.newName]);
		expect(fakeDoc.activeElement).toBe(saved.querySelector('.dynasty-id-open'));
		type(fresh.querySelector('input')!, 'House Other');
		expect(saved.hasClass('has-id-problem')).toBe(false);
		expect(fresh.hasClass('has-id-problem')).toBe(false);
		expect(texts()).toEqual([]);
		// The name gives the same ID again: both marks come back.
		type(fresh.querySelector('input')!, 'House Valmont');
		expect(texts()).toEqual([UI.ID_UI.taken, UI.ID_UI.newName]);
	});

	it('a new house whose ID is unique shows no mark, and the Save is not blocked by it', async () => {
		const h = writingHandle(HOUSES_BODY);
		const win = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-house-add'));
		const fresh = content.querySelectorAll('.dynasty-house-row').pop()!;
		type(fresh.querySelector('input')!, 'House Unique');
		expect(fresh.hasClass('has-id-problem')).toBe(false);
		expect(content.querySelectorAll('.dynasty-id-new-problem').map((e) => e.getText()).filter((t) => t !== '')).toEqual([]);
	});

	it('the Titles window marks the new title too', async () => {
		const body = ['titles:', '  - {id: duke, name: Duke}', '  - {id: baron, name: Baron}', 'people:', '  - {id: a, name: Aldric, card-title: duke}', ''].join('\n');
		const h = writingHandle(body);
		const win = TitlesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-title-box[data-title="baron"] .dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'king');
		await click(idWin.querySelector('.dynasty-id-use'));
		await click(content.querySelector('.dynasty-title-add'));
		const nameInput = content.querySelectorAll('.dynasty-title-box').pop()!.querySelector('.dynasty-title-row input')!;
		type(nameInput, 'King');
		const row = content.querySelector('.dynasty-title-box[data-title="baron"] .dynasty-title-row')!;
		const newRow = content.querySelectorAll('.dynasty-title-box').pop()!.querySelector('.dynasty-title-row')!;
		const texts = () => content.querySelectorAll('.dynasty-id-new-problem').map((e) => e.getText()).filter((t) => t !== '');
		expect(texts()).toEqual([UI.ID_UI.taken, UI.ID_UI.newName]);
		expect(newRow.hasClass('has-id-problem')).toBe(true);
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(h.ops).toHaveLength(0);
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
		expect(fakeDoc.activeElement).toBe(row.querySelector('.dynasty-id-open'));
		type(nameInput, 'Queen');
		expect(texts()).toEqual([]);
		expect(newRow.hasClass('has-id-problem')).toBe(false);
		expect(row.hasClass('has-id-problem')).toBe(false);
	});

	it('the CSS: a red edge of 3 px in the error colour', () => {
		const edge = rule('.dynasty-house-row.has-id-problem,\n.dynasty-title-row.has-id-problem');
		expect(edge).toMatch(/border-left:\s*3px solid var\(--text-error\)/);
	});
});

describe('C4: the answer to the question "Change the ID?" writes the draft as it is then', () => {
	it('a different ID change after the question asks again and writes nothing at once', async () => {
		const body = ['houses:', '  - {id: valmont, name: House Valmont}', '  - {id: orsini, name: House Orsini}', 'people:', '  - {id: a, name: Aldric, house: valmont}', ''].join('\n');
		const h = writingHandle(body);
		const win = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const modal = (win as unknown as { modalEl: FEl }).modalEl;
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-house-row[data-house="valmont"] .dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'house-valmont');
		await click(idWin.querySelector('.dynasty-id-use'));
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(modal.querySelector('.dynasty-sheet-confirm')).not.toBeNull();
		// Behind the question the draft gets a second ID change (a code path; the window itself rebuilds and drops the question).
		const rows = (win as unknown as { rows: { id: string | null; idDraft?: string }[] }).rows;
		rows.find((r) => r.id === 'orsini')!.idDraft = 'house-orsini';
		await click(modal.querySelector('.dynasty-id-change'));
		// The question was about one ID; now two change: the window asks again and writes nothing yet.
		expect(h.ops).toHaveLength(0);
		const lines = modal.querySelector('.dynasty-sheet-confirm')!.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText());
		expect(lines.filter((l) => l.includes('house-valmont') || l.includes('house-orsini'))).toHaveLength(2);
		await click(modal.querySelector('.dynasty-id-change'));
		expect(h.ops).toHaveLength(1);
		const t = parseDynasty(h.body);
		if (!t.ok) throw new Error('parse');
		expect((t.tree.houses ?? []).map((x) => x.id).sort()).toEqual(['house-orsini', 'house-valmont']);
	});
});

describe('C2: the sheet of a person with no written ID after an edit above them', () => {
	const open = (body: string, id: string) => {
		const h = writingHandle(body);
		const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
		s.open();
		return { h, s, modal: (s as unknown as { modalEl: FEl }).modalEl };
	};
	const nameOf = (modal: FEl) => (modal.querySelector('[data-field="name"] input') as FEl).value;

	it('two identical people with no ID: the sheet cannot tell them apart, so it shows the person as gone (read-only)', async () => {
		const before = ['people:', '  - id: a', '    name: Aldric', '  - name: Twin', '  - name: Twin', ''].join('\n');
		const after = ['people:', '  - id: a', '    name: Aldric', '  - name: Zed', '  - name: Twin', '  - name: Twin', ''].join('\n');
		const { h, modal } = open(before, '~3');
		type(modal.querySelector('[data-field="title"] input')!, 'Lord');
		h.body = after;
		await click(modal.querySelector('.dynasty-sheet-save'));
		// ~3 is Zed now, and two people match the saved text: no certainty, so the sheet stays as a read-only copy.
		expect(modal.hasClass('is-read-only')).toBe(true);
		const t = parseDynasty(h.body);
		if (!t.ok) throw new Error('parse');
		expect(t.tree.people.every((p) => p.title === undefined)).toBe(true);
	});

	it('two identical people with no ID and a change below them: the sheet keeps its person', async () => {
		const before = ['people:', '  - id: a', '    name: Aldric', '  - name: Twin', '  - name: Twin', ''].join('\n');
		const { h, modal } = open(before, '~3');
		type(modal.querySelector('[data-field="title"] input')!, 'Lord');
		h.body = `${before}  - name: Late\n`;
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(modal.hasClass('is-read-only')).toBe(false);
		expect(nameOf(modal)).toBe('Twin');
		await click(modal.querySelector('.dynasty-sheet-save'));
		const r = parseDynasty(h.body);
		if (!r.ok) throw new Error('parse');
		expect(r.tree.people.map((p) => p.title ?? null)).toEqual([null, null, 'Lord', null]);
	});

	it('a person that another pane edited (a new title text) is found again by the name', async () => {
		const before = ['people:', '  - id: a', '    name: Aldric', '  - name: Xavier', '  - name: Yvonne', ''].join('\n');
		const after = ['people:', '  - id: a', '    name: Aldric', '  - name: Zed', '  - name: Xavier', '  - name: Yvonne', '    title: Duke', ''].join('\n');
		const { h, modal } = open(before, '~3');
		type(modal.querySelector('[data-field="born"] input')!, '1200');
		h.body = after;
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(nameOf(modal)).toBe('Yvonne');
		expect((modal.querySelector('[data-field="title"] input') as FEl).value).toBe('Duke');
	});

	it('a person that no longer exists at all: the sheet is read-only and writes nothing', async () => {
		const before = ['people:', '  - id: a', '    name: Aldric', '  - name: Xavier', ''].join('\n');
		const after = ['people:', '  - id: a', '    name: Aldric', '  - name: Someone Else', ''].join('\n');
		const { h, modal } = open(before, '~2');
		type(modal.querySelector('[data-field="title"] input')!, 'Lord');
		h.body = after;
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(modal.hasClass('is-read-only')).toBe(true);
		expect(h.ops).toHaveLength(0);
	});
});

describe('C3: the focus goes back into the sheet when a question closes', () => {
	it('to the control that had it, when the question closes without a choice', async () => {
		const body = ['people:', '  - id: a', '    name: Aldric', ''].join('\n');
		const h = writingHandle(body);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		s.open();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		const title = modal.querySelector('[data-field="title"] input')!;
		title.focus();
		type(title, 'Lord');
		s.close();
		expect(fakeDoc.activeElement).not.toBe(title);
		await click(modal.querySelector('.dynasty-sheet-confirm .dynasty-sheet-keep'));
		expect(fakeDoc.activeElement).toBe(title);
	});
});

describe('C5: "Remove partnership?" keeps the text that the owner wrote', () => {
	it('a type with capitals keeps them, and only the first letter of a known type is small', () => {
		expect(UI.REMOVE.partnershipText(UI.unionTypeText('Handfasting'), 'A', 'B')).toContain('the other (Handfasting) of A and B');
		expect(UI.REMOVE.partnershipText(UI.unionTypeText('affair'), 'A', 'B')).toContain('removes the affair of A and B');
	});
});

describe('C7: the arms box of the house page', () => {
	const page = (arms: boolean) => {
		const parsed = parseDynasty(`houses:\n  - {id: v, name: House Valmont${arms ? ', arms: "[[arms.png]]"' : ''}}\npeople:\n  - {id: a, name: Aldric, house: v}\n`);
		if (!parsed.ok) throw new Error('bad body');
		const win = openHousePage({} as never, { app: {} as never, houseId: 'v', whole: deriveFamilies(parsed.tree), sourcePath: 'Tree.md', show: () => {}, openNote: () => {} })!;
		return (win as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-hp-arms')!;
	};

	it('has a role and a real name when the house has arms', () => {
		const arms = page(true);
		expect(arms.getAttribute('role')).toBe('img');
		expect(arms.getAttribute('aria-label')).toBe('Arms of House Valmont');
	});

	it('an empty box has neither', () => {
		const arms = page(false);
		expect(arms.getAttribute('role')).toBeNull();
		expect(arms.getAttribute('aria-label')).toBeNull();
	});
});

describe('C8: the accessible name starts with the visible text', () => {
	it('of the buttons that the plugin names in ui-text.ts', () => {
		const pairs: [string, string][] = [
			[UI.ID_UI.open, UI.ID_UI.openAria('House Thorne')],
			[UI.ID_UI.keepOld, UI.ID_UI.keepOldAria('House Thorne')],
			[UI.ID_UI.make, UI.ID_UI.makeAria('House Thorne')],
			[UI.FOCUS_UI.pin, UI.FOCUS_UI.pinLabel('Aldric')],
			[UI.FOCUS_UI.unpin, UI.FOCUS_UI.unpinLabel('Aldric')],
			[UI.FOCUS_UI.focusHere, UI.FOCUS_UI.focusHereLabel('Aldric')],
			[UI.FAMILY.remove, UI.FAMILY.removeParentLabel('Aldric')],
			[UI.FAMILY.removePartnership, UI.FAMILY.removePartnershipLabel('Aldric')],
			[UI.FAMILY.edit, UI.FAMILY.editLabel('Aldric')],
		];
		for (const [visible, name] of pairs) expect(name.startsWith(visible), `"${name}" starts with "${visible}"`).toBe(true);
	});
});

describe('C6: a write that ends after the sheet closed draws nothing', () => {
	it('afterWrite and reload of a closed sheet do not build the form again', async () => {
		const body = ['people:', '  - id: a', '    name: Aldric', ''].join('\n');
		const h = writingHandle(body);
		const s = EditSheet.create(fakeApp() as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		s.open();
		const content = (s as unknown as { contentEl: FEl }).contentEl;
		s.close();
		await settle();
		expect(content.children).toHaveLength(0);
		s.afterWrite(body);
		s.reload(body);
		expect(content.children).toHaveLength(0);
	});
});
