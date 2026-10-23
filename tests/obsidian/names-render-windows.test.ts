// Spec §14 rule 15, D272 (WP-6 step 2): the names of the years in the windows. The Houses window rows, the Find row and its search text, the picture viewer
// line, the rows of the line of succession, the Titles window holder rows, the top of the person window; and the proof that the Born and Died fields and the
// note stay as written after the window opens and after Save.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Obsidian's own matcher is replaced by a plain one: every word of the query must be inside the text, in lower case.
vi.mock('obsidian', async () => ({
	...(await import('../acceptance/fake-obsidian')),
	prepareFuzzySearch: (query: string) => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return (text: string) => {
			const lower = text.toLowerCase();
			return words.every((w) => lower.includes(w)) ? { score: -text.length, matches: [] } : null;
		};
	},
}));

import { compileCalendars, type DateReader } from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { pickPerson } from '../../src/obsidian/person-picker';
import { personPictures } from '../../src/obsidian/viewer-sources';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, device, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { cycles, list } from '../dates-support/names';
import { openPage } from '../support/lw-support';
import { lineRows, openWin, page } from '../support/r027-window-support';
import { click, stripNotDisabled, type, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

/** A cycle calendar with the planets; 22.13 = Saturn, 22.14 = Jupiter, 22.15 = Mars. */
const reader: DateReader = compileCalendars([cycles('C', ['{cycle}.{year} {planet}', '{cycle}.{year}'], [list()])], true);
const dates = () => reader;
const graphOf = (body: string) => deriveFamilies((parseDynasty(body) as { ok: true; tree: never }).tree, { dates: reader });

const BODY = [
	'houses:', '  - {id: orsini, name: House Orsini}',
	'titles:', '  - id: crown', '    name: Crown', '    succession: eldest-child', '    holders:', '      - {person: aldric, number: II, from: "22.13", to: "22.14"}',
	'people:',
	'  - {id: aldric, name: Aldric Orsini, house: orsini, born: "22.10", died: "22.14", sex: m}',
	'  - {id: bran, name: Bran Orsini, house: orsini, born: "22.14", sex: m, parents: [aldric]}',
	'  - {id: cora, name: Cora Orsini, house: orsini, born: "22.15 Mars", sex: f, parents: [aldric]}',
	'  - {id: dag, name: Dag Brandt, born: "22.15", sex: m}',
	'',
].join('\n');

describe('§14 rule 15: the Houses window rows', () => {
	function open(over: Partial<{ dates: typeof dates | undefined; generation: boolean }> = {}) {
		const handle = writingHandle(BODY);
		const app = {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
		const win = HousesWindow.create(app as never, {
			handle: handle as never, sourcePath: 'n.md', onClosed: () => undefined,
			people: { show: () => undefined, openNote: () => undefined },
			...('dates' in over ? { dates: over.dates } : { dates }),
			...(over.generation === false ? { showGeneration: () => false } : {}),
		})!;
		win.open();
		return (win as unknown as { contentEl: FEl }).contentEl;
	}
	const subs = (content: FEl) => openPage(content, 'orsini').querySelector('[data-section="people"]')!.querySelectorAll('.dynasty-hp-row').map((r) => r.querySelector('.dynasty-row-sub')!.getText());

	it('shows the name after each date, with and without the generation', () => {
		expect(subs(open())).toEqual(['Generation 1 · 22.10 Ve\u2009–\u200922.14 Ju', 'Generation 2 · b. 22.14 Ju', 'Generation 2 · b. 22.15 Mars']);
		expect(subs(open({ generation: false }))).toEqual(['22.10 Ve\u2009–\u200922.14 Ju', 'b. 22.14 Ju', 'b. 22.15 Mars']);
	});

	it('shows the text as written when the window has no calendars', () => {
		expect(subs(open({ dates: undefined }))).toEqual(['Generation 1 · 22.10–22.14', 'Generation 2 · b. 22.14', 'Generation 2 · b. 22.15 Mars']);
	});
});

describe('§14 rule 15: the Find row and its search text', () => {
	interface PickerLike {
		getSuggestions(q: string): { kind: string; person?: { id: string; name: string } }[];
		renderSuggestion(item: unknown, el: FEl): void;
	}
	const openPicker = (g = graphOf(BODY), you: string | null = null): PickerLike => {
		void pickPerson({} as never, g, new Set(), 'Type', 'Find', false, you);
		return openModals[openModals.length - 1] as unknown as PickerLike;
	};
	const row = (p: PickerLike, id: string): FEl => {
		const el = new FEl('div');
		p.renderSuggestion(p.getSuggestions('').find((i) => i.person?.id === id), el);
		return el;
	};
	const ids = (p: PickerLike, q: string) => p.getSuggestions(q).filter((i) => i.kind === 'person').map((i) => i.person!.id);

	it('the visible row shows the name of the year; the one that is written shows once', () => {
		const p = openPicker();
		expect(row(p, 'bran').getText()).toContain('b. 22.14 Ju');
		expect(row(p, 'aldric').getText()).toContain('22.10 Ve\u2009–\u200922.14 Ju');
		expect(row(p, 'cora').getText()).toContain('b. 22.15 Mars');
		expect(row(p, 'cora').getText()).not.toContain('Mars Ma');
	});

	it('the search text has no name of a year: "ma" does not find Dag by the Mars of his year, only the one who wrote "Mars"', () => {
		const p = openPicker();
		expect(ids(p, 'ma')).toEqual(['cora']);
		expect(ids(p, 'sa')).toEqual([]);
		expect(ids(p, 'ju')).toEqual([]);
		expect(ids(p, '22.15').sort()).toEqual(['cora', 'dag']);
		// The text as written is still found.
		expect(ids(p, 'mars')).toEqual(['cora']);
	});

	it('the spoken text of the row has the full names, and the visible text is hidden from the screen reader', () => {
		const p = openPicker();
		const el = row(p, 'bran');
		expect(el.querySelector('.dynasty-sr-only')!.getText()).toBe('Bran Orsini, b. 22.14 Jupiter');
		expect(el.querySelector('.dynasty-picker-text')!.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('§14 rule 15: the picture viewer line', () => {
	it('the line of the portrait has the name of the year', () => {
		const g = graphOf(BODY);
		const person = g.byId.get('aldric')!;
		const kit = { app: {} as never, pictures: undefined, sourcePath: 'n.md', g, person, draft: { name: 'Aldric Orsini', portrait: '[[a.png]]', arms: '', house: 'orsini', title: '', born: '22.10', died: '22.14' } };
		const lines = personPictures(kit).map((p) => p.line);
		expect(lines[0]).toContain('22.10 Ve\u2009–\u200922.14 Ju');
		// A draft date that the user typed shows as typed, with its name.
		const typed = personPictures({ ...kit, draft: { ...kit.draft, born: '22.13', died: '' } }).map((p) => p.line);
		expect(typed[0]).toContain('b. 22.13 Sa');
	});
});

describe('§14 rule 15: the Titles window and the line of succession', () => {
	it('the rows of the line of succession show the dates with names', () => {
		const o = openWin(BODY, { dates });
		const p = page(o, 'crown');
		const rows = p.querySelectorAll('.dynasty-succ-item');
		expect(lineRows(p)[0]).toContain('Bran Orsini');
		expect(rows[0]!.querySelector('.dynasty-row-sub')!.getText()).toBe('b. 22.14 Ju');
	});

	it('the holder row shows the reign with names, and the heading of the line says the year as written', () => {
		const o = openWin(BODY, { dates });
		const p = page(o, 'crown');
		const sub = p.querySelectorAll('.dynasty-holder-row .dynasty-row-sub').map((s) => s.getText());
		expect(sub.join('|')).toContain('22.13 Sa\u2009–\u200922.14 Ju');
		// The sentence of the line names the year as written (SuccessionResult.yearText stays as written).
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toContain('22.14');
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).not.toContain('Ju');
	});

	it('the holder row has the text as written without calendars', () => {
		const o = openWin(BODY, { dates: () => compileCalendars([], true) });
		const p = page(o, 'crown');
		expect(p.querySelectorAll('.dynasty-holder-row .dynasty-row-sub').map((s) => s.getText()).join('|')).toContain('22.13–22.14');
	});
});

describe('§14 rule 15 and D272: the person window', () => {
	function openSheet(body = BODY, id = 'aldric') {
		const h = writingHandle(body);
		const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md', dates } as never)!;
		s.open();
		return { h, modal: (s as unknown as { modalEl: FEl }).modalEl };
	}
	const field = (modal: FEl, key: string) => modal.querySelector(`[data-field="${key}"] input`)!;

	it('the top of the window shows the names, the Born and Died fields show the text as written', () => {
		const { modal } = openSheet();
		expect(modal.querySelector('.dynasty-head-meta')!.getText()).toContain('22.10 Ve\u2009–\u200922.14 Ju');
		expect(field(modal, 'born').value).toBe('22.10');
		expect(field(modal, 'died').value).toBe('22.14');
	});

	it('Save with another field changed writes no date, and the note keeps the text as written', async () => {
		const { h, modal } = openSheet();
		type(field(modal, 'name'), 'Aldric Orsini II');
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(h.ops).toHaveLength(1);
		expect(Object.keys((h.ops[0] as { fields: object }).fields)).toEqual(['name']);
		expect(h.body).toContain('born: "22.10"');
		expect(h.body).toContain('died: "22.14"');
		expect(h.body).toBe(BODY.replace('name: Aldric Orsini,', 'name: Aldric Orsini II,'));
	});

	it('a typed date is written as typed, with no name; the top shows the name of the typed date', async () => {
		const { h, modal } = openSheet();
		type(field(modal, 'born'), '22.13');
		expect(modal.querySelector('.dynasty-head-meta')!.getText()).toContain('22.13 Sa\u2009–\u200922.14 Ju');
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect((h.ops[0] as { fields: Record<string, unknown> }).fields).toEqual({ born: '22.13' });
		expect(h.body).toContain('born: "22.13"');
		expect(h.body).not.toContain('Sa');
	});

	it('the whole note text is the same after an open and a Save with no change', async () => {
		const { h, modal } = openSheet();
		const before = h.body;
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(h.body).toBe(before);
	});
});
