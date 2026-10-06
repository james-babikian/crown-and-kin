import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { newTitleId } from '../src/core/title-ops';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { draftChanged, maleNameOf, rebase, titleRows, windowOps, type TitleRow } from '../src/obsidian/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { TITLES_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { replaceOnce } from './acceptance/golden';
import { BODY_13 } from './acceptance/titles-support';
import { embed, fakeHandle, fakeHost, openSheetOn, type FakeHandle, type Host } from './acceptance/tree-view-fakes';
import { backButton, backToList, openPage } from './lw-support';

/*
 * D66 (spec §13.4): the "Name for a man" field of the Titles window (the draft, its ops together
 * with "Name for a woman", a new title, a stale Save, the field on the fakes with Save and one undo
 * step) and the edit sheet, which shows the male form to a holder with `sex: m`.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const graph = (body: string): FamilyGraph => {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('the sample does not parse');
	return deriveFamilies(r.tree);
};
const bodyOf = (r: ReturnType<typeof applyOp>) => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const keys = () => {
	let n = 0;
	return () => `k${n++}`;
};
const rowsOf = (body = BODY_13) => titleRows(graph(body), keys());
const titleOf = (rows: TitleRow[], id: string) => rows.find((t) => t.id === id)!;
const newId = (body: string) => (name: string, taken: ReadonlySet<string>) => newTitleId(body, name, taken);
const ops = (rows: TitleRow[], body = BODY_13) => windowOps(rows, newId(body));

const DUKE = '    name: Duke of Valmont\n';
const MALE_LINE = '    male-name: Prince of Valmont\n';
const FEMALE_LINE = '    female-name: Duchess of Valmont\n';
/** Sample tree 13 with the female form written and Elinor (`sex: f`, no written title) as the newest Duke of Valmont. */
const BODY_F = replaceOnce(
	replaceOnce(BODY_13, DUKE, DUKE + FEMALE_LINE),
	'      - {person: edmund, from: 1210, to: 1228}\n',
	'      - {person: edmund, from: 1210, to: 1228}\n      - {person: elinor, from: 1228}\n',
);
/** Sample tree 13 with both forms written. */
const BODY_MF = replaceOnce(BODY_F, DUKE, DUKE + MALE_LINE);

describe('"Name for a man" in the Titles window draft (D66)', () => {
	it('starts with the written male-name; empty when none is written', () => {
		expect(titleOf(rowsOf(), 'duke-of-valmont').maleName).toBe('');
		expect(titleOf(rowsOf(BODY_MF), 'duke-of-valmont').maleName).toBe('Prince of Valmont');
		expect(titleOf(rowsOf(BODY_MF), 'duke-of-valmont').femaleName).toBe('Duchess of Valmont');
	});

	it('a typed name: edit-title writes male-name right after name and before female-name, one text line', () => {
		const rows = rowsOf(BODY_F);
		titleOf(rows, 'duke-of-valmont').maleName = ' Prince of Valmont ';
		expect(draftChanged(rows)).toBe(true);
		const o = ops(rows, BODY_F);
		expect(o).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', maleName: 'Prince of Valmont' }]);
		expect(bodyOf(applyOp(BODY_F, { kind: 'batch', ops: o }))).toBe(BODY_MF);
	});

	it('both fields typed together make one edit-title; the text lines go in the order name, male-name, female-name', () => {
		const rows = rowsOf();
		const duke = titleOf(rows, 'duke-of-valmont');
		duke.femaleName = 'Duchess of Valmont';
		duke.maleName = 'Prince of Valmont';
		const o = ops(rows);
		expect(o).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', maleName: 'Prince of Valmont', femaleName: 'Duchess of Valmont' }]);
		expect(bodyOf(applyOp(BODY_13, { kind: 'batch', ops: o }))).toBe(replaceOnce(BODY_13, DUKE, DUKE + MALE_LINE + FEMALE_LINE));
	});

	it('an empty field removes only its key; spaces only on a title without one change nothing', () => {
		const rows = rowsOf(BODY_MF);
		titleOf(rows, 'duke-of-valmont').maleName = '  ';
		const o = ops(rows, BODY_MF);
		expect(o).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', maleName: null }]);
		expect(bodyOf(applyOp(BODY_MF, { kind: 'batch', ops: o }))).toBe(BODY_F);
		const plain = rowsOf();
		titleOf(plain, 'count-of-orsini').maleName = '   ';
		expect(draftChanged(plain)).toBe(false);
		expect(ops(plain)).toEqual([]);
	});

	it('the same text with spaces changes nothing', () => {
		const rows = rowsOf(BODY_MF);
		titleOf(rows, 'duke-of-valmont').maleName = 'Prince of Valmont ';
		expect(draftChanged(rows)).toBe(false);
	});

	it('a new title: add-title with both names; an empty field writes none', () => {
		const rows = rowsOf();
		const blank = { baseName: null, plural: '', basePlural: null, baseMaleName: null, baseFemaleName: null, deleted: false, holders: [], baseRows: [] };
		rows.push({ ...blank, key: 'a', id: null, name: 'Queen of the Isles', maleName: ' King of the Isles ', femaleName: ' Queen of the Isles ' });
		rows.push({ ...blank, key: 'b', id: null, name: 'Reeve', maleName: ' ', femaleName: '' });
		const o = ops(rows);
		expect(o).toEqual([
			{ kind: 'add-title', id: 'queen-of-the-isles', name: 'Queen of the Isles', maleName: 'King of the Isles', femaleName: 'Queen of the Isles' },
			{ kind: 'add-title', id: 'reeve', name: 'Reeve' },
		]);
		expect(maleNameOf(rows[rows.length - 1])).toBeNull();
		const after = bodyOf(applyOp(BODY_13, { kind: 'batch', ops: o }));
		expect(after).toContain('  - id: queen-of-the-isles\n    name: Queen of the Isles\n    male-name: King of the Isles\n    female-name: Queen of the Isles\n');
		expect(graph(after).titles.find((t) => t.id === 'queen-of-the-isles')?.maleName).toBe('King of the Isles');
	});

	it('a stale Save keeps an edited male name; a male name written elsewhere comes through on an untouched title', () => {
		const rows = rowsOf();
		titleOf(rows, 'duke-of-valmont').maleName = 'Prince of Valmont';
		const other = replaceOnce(BODY_13, '    name: Count of Orsini\n', '    name: Count of Orsini\n    male-name: Grand Count of Orsini\n');
		const next = rebase(rows, rowsOf(other));
		expect(titleOf(next, 'duke-of-valmont').maleName).toBe('Prince of Valmont');
		expect(titleOf(next, 'count-of-orsini').maleName).toBe('Grand Count of Orsini');
		expect(ops(next, other)).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', maleName: 'Prince of Valmont' }]);
	});

	it('a stale Save keeps both edited names apart: the female name written elsewhere does not replace the male edit', () => {
		const rows = rowsOf();
		titleOf(rows, 'duke-of-valmont').maleName = 'Prince of Valmont';
		const other = replaceOnce(BODY_13, DUKE, DUKE + FEMALE_LINE);
		const next = rebase(rows, rowsOf(other));
		const duke = titleOf(next, 'duke-of-valmont');
		expect(duke.maleName).toBe('Prince of Valmont');
		expect(duke.femaleName).toBe('Duchess of Valmont');
		expect(ops(next, other)).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', maleName: 'Prince of Valmont' }]);
	});
});

// ---------- on the fakes ----------

function writingHandle(body = BODY_13): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	const undo: string[] = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		undo.push(h.body);
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	h.undo.mockImplementation((async () => {
		const prev = undo.pop();
		if (prev === undefined) return { ok: false, code: 'empty' };
		h.body = prev;
		return { ok: true };
	}) as never);
	return h;
}

const click = async (el: FEl | null) => {
	expect(el).not.toBeNull();
	dispatch(el!, 'click', { detail: 1 });
	await settle();
};
const cardText = (root: FEl, id: string, cls: string) =>
	root
		.querySelectorAll(`.dynasty-card[data-person="${id}"] .${cls}`)
		.map((e) => e.getText())
		.join(' ');

async function openTitles(handle = writingHandle()) {
	const host = fakeHost() as Host & { app: Record<string, unknown> };
	const { el } = await embed(handle.body, { handle, host });
	await click(el.querySelector('.dynasty-more'));
	await click(el.querySelector('.dynasty-more-titles'));
	const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl } | undefined;
	expect(win).toBeDefined();
	return { handle, content: win!.contentEl };
}

/** The edit page of a title: the window opens on the list, and a page is a second step (D134). */
const pageFor = (content: FEl, id: string) => {
	if (backButton(content)) backToList(content);
	return openPage(content, id);
};

describe('"Name for a man" in the Titles window on the fakes (D66)', () => {
	it('the field: a label with the visible text, the placeholder, an accessible name that starts with the visible text', async () => {
		const { content } = await openTitles(writingHandle(BODY_MF));
		const field = pageFor(content, 'duke-of-valmont').querySelector('.dynasty-title-male')!;
		expect(field.tag).toBe('label');
		expect(field.getAttribute('data-field')).toBe('male-name');
		expect(field.querySelector('.dynasty-sheet-label')!.getText()).toBe(TITLES_UI.maleLabel);
		const input = field.querySelector('textarea')!;
		expect(input.value).toBe('Prince of Valmont');
		expect(input.getAttribute('placeholder')).toBe(TITLES_UI.malePlaceholder);
		expect(input.getAttribute('aria-label')).toBe(TITLES_UI.maleAria('Duke of Valmont'));
		expect(input.getAttribute('aria-label')!.startsWith(TITLES_UI.maleLabel)).toBe(true);
		const page = pageFor(content, 'duke-of-valmont');
		expect(page.querySelectorAll('label.dynasty-sheet-field').map((c) => c.getAttribute('data-field'))).toEqual([null, 'male-name', 'female-name', 'plural']);
		expect(pageFor(content, 'count-of-orsini').querySelector('.dynasty-title-male textarea')!.value).toBe('');
	});

	it('a rename updates the accessible name of the field', async () => {
		const { content } = await openTitles();
		const box = pageFor(content, 'duke-of-valmont');
		const name = box.querySelector('.dynasty-title-name textarea')!;
		name.value = 'Prince of Valmont';
		dispatch(name, 'input');
		expect(box.querySelector('.dynasty-title-male textarea')!.getAttribute('aria-label')).toBe(TITLES_UI.maleAria('Prince of Valmont'));
	});

	it('Save writes male-name in one write after the name and before female-name; one undo restores the text', async () => {
		const { content, handle } = await openTitles(writingHandle(BODY_F));
		const input = pageFor(content, 'duke-of-valmont').querySelector('.dynasty-title-male textarea')!;
		input.value = 'Prince of Valmont';
		dispatch(input, 'input');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		expect(handle.body).toBe(BODY_MF);
		await handle.undo();
		expect(handle.body).toBe(BODY_F);
	});
});

describe('the edit sheet shows the form of the title that the card uses (D66)', () => {
	async function sheetOf(id: string, body: string) {
		const handle = writingHandle(body);
		const { el } = await embed(handle.body, { handle });
		const sheet = await openSheetOn(el, id, 'mouse');
		return { el, handle, content: (sheet as unknown as { contentEl: FEl }).contentEl };
	}
	const holdingName = (content: FEl) => content.querySelector('.dynasty-titles-section .dynasty-title-holding[data-title="duke-of-valmont"] .dynasty-title-holding-name')!.getText();

	it('a holder with sex: m sees the male form, like his card', async () => {
		const { el, content } = await sheetOf('roderick', BODY_MF);
		expect(cardText(el, 'roderick', 'dynasty-card-title')).toContain('Prince of Valmont');
		expect(holdingName(content)).toBe('Prince of Valmont');
	});

	it('a holder with sex: f sees the female form', async () => {
		const { content } = await sheetOf('elinor', BODY_MF);
		expect(holdingName(content)).toBe('Duchess of Valmont');
	});

	it('without a male-name, a man sees the name', async () => {
		const { content } = await sheetOf('roderick', BODY_F);
		expect(holdingName(content)).toBe('Duke of Valmont');
	});

	it('a holder whose sex is not written sees the name', async () => {
		const body = replaceOnce(BODY_MF, '  - id: roderick\n    name: Roderick Valmont\n    house: valmont\n    sex: m\n', '  - id: roderick\n    name: Roderick Valmont\n    house: valmont\n');
		const { content } = await sheetOf('roderick', body);
		expect(holdingName(content)).toBe('Duke of Valmont');
	});
});
