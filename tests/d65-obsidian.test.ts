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
import { draftChanged, femaleNameOf, rebase, titleRows, windowOps, type TitleRow } from '../src/obsidian/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { TITLES_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { replaceOnce } from './acceptance/golden';
import { BODY_13 } from './acceptance/titles-support';
import { embed, fakeHandle, fakeHost, openSheetOn, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

/*
 * D65 (spec §13.4): the "Name for a woman" field of the Titles window (the draft, its ops, a stale
 * Save, the field on the fakes with Save and one undo step) and the edit sheet's Titles section,
 * which shows the form of the title that the card uses (the female form for a person with `sex: f`).
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
const FEMALE_LINE = '    female-name: Duchess of Valmont\n';
/** Sample tree 13 with the female form written and Elinor (`sex: f`, no written title) as the newest Duke of Valmont. */
const BODY_F = replaceOnce(
	replaceOnce(BODY_13, DUKE, DUKE + FEMALE_LINE),
	'      - {person: edmund, from: 1210, to: 1228}\n',
	'      - {person: edmund, from: 1210, to: 1228}\n      - {person: elinor, from: 1228}\n',
);

describe('"Name for a woman" in the Titles window draft (D65)', () => {
	it('starts with the written female-name; empty when none is written', () => {
		expect(titleOf(rowsOf(), 'duke-of-valmont').femaleName).toBe('');
		expect(titleOf(rowsOf(BODY_F), 'duke-of-valmont').femaleName).toBe('Duchess of Valmont');
	});

	it('a typed name: edit-title writes female-name right after name, one text line', () => {
		const rows = rowsOf();
		titleOf(rows, 'duke-of-valmont').femaleName = ' Duchess of Valmont ';
		expect(draftChanged(rows)).toBe(true);
		const o = ops(rows);
		expect(o).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', femaleName: 'Duchess of Valmont' }]);
		expect(bodyOf(applyOp(BODY_13, { kind: 'batch', ops: o }))).toBe(replaceOnce(BODY_13, DUKE, DUKE + FEMALE_LINE));
	});

	it('an empty field removes the key; spaces only on a title without one change nothing', () => {
		const rows = rowsOf(BODY_F);
		titleOf(rows, 'duke-of-valmont').femaleName = '  ';
		const o = ops(rows, BODY_F);
		expect(o).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', femaleName: null }]);
		expect(bodyOf(applyOp(BODY_F, { kind: 'batch', ops: o }))).toBe(replaceOnce(BODY_F, FEMALE_LINE, ''));
		const plain = rowsOf();
		titleOf(plain, 'count-of-orsini').femaleName = '   ';
		expect(draftChanged(plain)).toBe(false);
		expect(ops(plain)).toEqual([]);
	});

	it('a changed name changes only its text line; the same text with spaces changes nothing', () => {
		const rows = rowsOf(BODY_F);
		titleOf(rows, 'duke-of-valmont').femaleName = 'Duchess of Valmont ';
		expect(draftChanged(rows)).toBe(false);
		titleOf(rows, 'duke-of-valmont').femaleName = 'Grand Duchess of Valmont';
		const o = ops(rows, BODY_F);
		expect(bodyOf(applyOp(BODY_F, { kind: 'batch', ops: o }))).toBe(replaceOnce(BODY_F, FEMALE_LINE, '    female-name: Grand Duchess of Valmont\n'));
	});

	it('a rename, a female name and a plural make one edit-title', () => {
		const rows = rowsOf();
		const king = titleOf(rows, 'king-of-the-vale');
		king.name = 'High King of the Vale';
		king.femaleName = 'High Queen of the Vale';
		king.plural = 'High Kings of the Vale';
		expect(ops(rows)).toEqual([{ kind: 'edit-title', id: 'king-of-the-vale', name: 'High King of the Vale', femaleName: 'High Queen of the Vale', plural: 'High Kings of the Vale' }]);
		const g = graph(bodyOf(applyOp(BODY_13, { kind: 'batch', ops: ops(rows) })));
		expect(g.titles.find((t) => t.id === 'king-of-the-vale')?.femaleName).toBe('High Queen of the Vale');
	});

	it('a new title: add-title with the female name; an empty field writes none', () => {
		const rows = rowsOf();
		const blank = { baseName: null, plural: '', basePlural: null, maleName: '', baseMaleName: null, baseFemaleName: null, deleted: false, holders: [], baseRows: [] };
		rows.push({ ...blank, key: 'a', id: null, name: 'Baron of Greyfen', femaleName: ' Baroness of Greyfen ' });
		rows.push({ ...blank, key: 'b', id: null, name: 'Reeve', femaleName: ' ' });
		expect(ops(rows)).toEqual([
			{ kind: 'add-title', id: 'baron-of-greyfen', name: 'Baron of Greyfen', femaleName: 'Baroness of Greyfen' },
			{ kind: 'add-title', id: 'reeve', name: 'Reeve' },
		]);
		expect(femaleNameOf(rows[rows.length - 1])).toBeNull();
	});

	it('a stale Save keeps an edited female name; a female name written elsewhere comes through on an untouched title', () => {
		const rows = rowsOf();
		titleOf(rows, 'duke-of-valmont').femaleName = 'Duchess of Valmont';
		const other = replaceOnce(BODY_13, '    name: Count of Orsini\n', '    name: Count of Orsini\n    female-name: Countess of Orsini\n');
		const next = rebase(rows, rowsOf(other));
		expect(titleOf(next, 'duke-of-valmont').femaleName).toBe('Duchess of Valmont');
		expect(titleOf(next, 'count-of-orsini').femaleName).toBe('Countess of Orsini');
		expect(ops(next, other)).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', femaleName: 'Duchess of Valmont' }]);
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
const top = () => openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
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

const titleBox = (content: FEl, id: string) => content.querySelector(`.dynasty-title-box[data-title="${id}"]`)!;

describe('"Name for a woman" in the Titles window on the fakes (D65)', () => {
	it('the field: a label with the visible text, the placeholder, an accessible name that starts with the visible text', async () => {
		const { content } = await openTitles(writingHandle(BODY_F));
		const field = titleBox(content, 'duke-of-valmont').querySelector('.dynasty-title-female')!;
		expect(field.tag).toBe('label');
		expect(field.getAttribute('data-field')).toBe('female-name');
		expect(field.querySelector('.dynasty-sheet-label')!.getText()).toBe(TITLES_UI.femaleLabel);
		const input = field.querySelector('input')!;
		expect(input.value).toBe('Duchess of Valmont');
		expect(input.getAttribute('placeholder')).toBe(TITLES_UI.femalePlaceholder);
		expect(input.getAttribute('aria-label')).toBe(TITLES_UI.femaleAria('Duke of Valmont'));
		expect(input.getAttribute('aria-label')!.startsWith(TITLES_UI.femaleLabel)).toBe(true);
		expect(titleBox(content, 'count-of-orsini').querySelector('.dynasty-title-female input')!.value).toBe('');
		// The fields share one grid in the order of the text: "Name for a man" (D66), "Name for a woman", then the plural.
		const fields = titleBox(content, 'duke-of-valmont').querySelector('.dynasty-title-fields')!;
		expect(fields.children.map((c) => c.getAttribute('data-field'))).toEqual(['male-name', 'female-name', 'plural']);
	});

	it('Save writes female-name in one write after the name; one undo restores the text', async () => {
		const { content, handle } = await openTitles();
		const input = titleBox(content, 'duke-of-valmont').querySelector('.dynasty-title-female input')!;
		input.value = 'Duchess of Valmont';
		dispatch(input, 'input');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		expect(handle.body).toBe(replaceOnce(BODY_13, DUKE, DUKE + FEMALE_LINE));
		await handle.undo();
		expect(handle.body).toBe(BODY_13);
	});
});

describe('the edit sheet shows the form of the title that the card uses (D65)', () => {
	async function sheetOf(id: string, body: string) {
		const handle = writingHandle(body);
		const { el } = await embed(handle.body, { handle });
		const sheet = await openSheetOn(el, id, 'mouse');
		return { el, handle, content: (sheet as unknown as { contentEl: FEl }).contentEl };
	}

	it('a holder with sex: f sees the female form, like her card; the aria names use it too', async () => {
		const { el, content } = await sheetOf('elinor', BODY_F);
		expect(cardText(el, 'elinor', 'dynasty-card-title')).toContain('Duchess of Valmont');
		const holding = content.querySelector('.dynasty-titles-section .dynasty-title-holding[data-title="duke-of-valmont"]')!;
		expect(holding.querySelector('.dynasty-title-holding-name')!.getText()).toBe('Duchess of Valmont');
		expect(holding.querySelector('.dynasty-edit-holder')!.getAttribute('aria-label')).toBe(TITLES_UI.entryEditLabel('Duchess of Valmont', 'from 1228'));
	});

	it('a man sees the name', async () => {
		const man = await sheetOf('roderick', BODY_F);
		expect(man.content.querySelector('.dynasty-title-holding-name')!.getText()).toBe('Duke of Valmont');
	});

	it('without a female-name, a woman sees the name', async () => {
		const plain = replaceOnce(BODY_F, FEMALE_LINE, '');
		const woman = await sheetOf('elinor', plain);
		expect(woman.content.querySelector('.dynasty-title-holding-name')!.getText()).toBe('Duke of Valmont');
	});

	it('the Add title list shows the titles by their name', async () => {
		const { content } = await sheetOf('elinor', BODY_F);
		await click(content.querySelector('.dynasty-add-title'));
		const labels = top().contentEl.querySelectorAll('.dynasty-choice-option .dynasty-choice-label').map((l) => l.getText());
		expect(labels[0]).toBe('Duke of Valmont');
	});
});
