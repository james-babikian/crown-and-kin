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
import { rebase, titleRows, windowOps, type TitleRow } from '../src/obsidian/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { TITLES_UI, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { lastMenu, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_13 } from './acceptance/titles-support';
import { embed, fakeHandle, fakeHost, openSheetOn, type FakeHandle, type Host } from './acceptance/tree-view-fakes';
import { openPage } from './lw-support';
import { cardLabels } from '../src/core/titles';

/*
 * Review of M8 area 3 (Obsidian): failing tests that prove the findings. Scratch branch only.
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
const keys = () => {
	let n = 0;
	return () => `k${n++}`;
};
const titleOf = (rows: TitleRow[], id: string) => rows.find((t) => t.id === id)!;
const bodyOf = (r: ReturnType<typeof applyOp>) => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};

function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	return h;
}

const click = async (el: FEl | null) => {
	expect(el).not.toBeNull();
	dispatch(el!, 'click', { detail: 1 });
	await settle();
};
const top = () => openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };

async function openTitles(body: string) {
	const handle = writingHandle(body);
	const host = fakeHost() as Host;
	const { el } = await embed(body, { handle, host });
	await click(el.querySelector('.dynasty-titles-button'));
	const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl; modalEl: FEl };
	expect(win).toBeDefined();
	return { handle, content: win.contentEl };
}

interface PickerLike {
	getSuggestions(q: string): unknown[];
	renderSuggestion(item: unknown, el: FEl): void;
	onChooseSuggestion(item: unknown, evt: unknown): void;
	close(): void;
}

async function pick(id: string): Promise<void> {
	const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as PickerLike | undefined;
	if (!p) throw new Error('no picker is open');
	const item = p.getSuggestions('').find((i) => {
		const el = new FEl('div');
		p.renderSuggestion(i, el);
		return el.getAttribute('data-person') === id;
	});
	if (!item) throw new Error(`the picker does not offer ${id}`);
	p.onChooseSuggestion(item, {});
	p.close();
	runTimers(0);
	await settle();
}

// Aldric has an id; Bran has none (he is `~2`). Orso is a holder who is not in the tree, with `as`.
const BODY = [
	'titles:',
	'  - id: duke',
	'    name: Duke',
	'    holders:',
	'      - {person: a, number: I}',
	'      - {name: Orso the Old, as: Orso, number: II, from: 1100}',
	'people:',
	'  - id: a',
	'    name: Aldric Valmont',
	'  - name: Bran Valmont',
	'    parents: [a]',
	'',
].join('\n');

describe('review M8 obsidian: Titles window, Add holder of a person with no id', () => {
	it('F1: Save writes the holder (the person gets an id in the same write), not a false stale message', async () => {
		const { handle, content } = await openTitles(BODY);
		// The holders show on the edit page of the title (D134); the window draws it again after each step.
		const box = () => content.querySelector('.dynasty-lw-page[data-title="duke"]')!;
		openPage(content, 'duke');
		await click(box().querySelector('.dynasty-holder-add'));
		await pick('~2');
		// The holder form: Save it as it is.
		await click(top().contentEl.querySelector('.dynasty-sheet-save'));
		expect(box().querySelectorAll('.dynasty-holder-row')).toHaveLength(3);
		await click(content.querySelector('.dynasty-sheet-save'));
		// The tree did not change under the window: no stale message.
		expect(notices).not.toContain(WRITE_TEXT.staleWindow);
		const g = graph(handle.body);
		const bran = g.people.find((p) => p.name === 'Bran Valmont')!;
		expect(g.titles[0].holders.map((h) => h.person ?? h.name)).toEqual(['a', 'Orso the Old', bran.id]);
	});
});

describe('review M8 obsidian: the holder form keeps `as` when only the name changes', () => {
	it('F2: a new name for a holder who is not in the tree keeps its written `as` (spec §13.5)', async () => {
		const { handle, content } = await openTitles(BODY);
		const box = () => content.querySelector('.dynasty-lw-page[data-title="duke"]')!;
		openPage(content, 'duke');
		await click(box().querySelectorAll('.dynasty-holder-more')[1]);
		lastMenu()!.item(TITLES_UI.edit)!.click();
		const form = top();
		const ruler = form.contentEl.querySelector('[data-field="ruler"] input')!;
		expect(ruler.value).toBe('Orso');
		const name = form.contentEl.querySelector('[data-field="holder-name"] input')!;
		name.value = 'Orso the Elder';
		dispatch(name, 'input');
		// The owner did not type in the ruler name field.
		await click(form.contentEl.querySelector('.dynasty-sheet-save'));
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.body).toContain('{name: Orso the Elder, as: Orso, number: II, from: 1100}');
	});
});

describe('review M8 obsidian: rebase of a restored ruler', () => {
	it('F3: an entry removed elsewhere does not take the draft edit of the other entry of the same person', () => {
		const rows = titleRows(graph(BODY_13), keys());
		const duke = titleOf(rows, 'duke-of-valmont');
		// Roderick's second reign (index 4, "number: I, from: 1163"): the owner adds "to: 1175" in the draft.
		const second = duke.holders[4];
		expect(second.values).toMatchObject({ person: 'roderick', number: 'I', from: '1163' });
		second.values = { ...second.values, to: '1175' };
		// Elsewhere: Roderick's first reign is removed; the second is unchanged.
		const other = BODY_13.replace('      - {person: roderick, from: 1150, to: 1158}\n', '');
		expect(other).not.toBe(BODY_13);
		const next = rebase(rows, titleRows(graph(other), keys()));
		const out = bodyOf(applyOp(other, { kind: 'batch', ops: windowOps(next, (n, t) => newTitleId(other, n, t)) }));
		const rod = graph(out).titles.find((t) => t.id === 'duke-of-valmont')!.holders.filter((h) => h.person === 'roderick');
		expect(rod.map((h) => `${h.number ?? ''}:${h.from ?? ''}:${h.to ?? ''}`)).toEqual(['I:1163:1175']);
	});
});

describe('review M8 obsidian: "Show on the card" with an unsaved title in the sheet', () => {
	it('F4: the card shows the title that the owner selected, also when the draft adds a written title', async () => {
		const handle = writingHandle(BODY_13);
		const { el } = await embed(BODY_13, { handle });
		const sheet = await openSheetOn(el, 'young-aldric', 'mouse');
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		// The draft: a title text typed in the Title field, not saved yet.
		const title = content.querySelector('[data-field="title"] input')!;
		title.value = 'Prince of Valmont';
		dispatch(title, 'input');
		// Show on the card: Duke of Valmont (the first title; the card shows King of the Vale now).
		await click(content.querySelector('.dynasty-title-holding[data-title="duke-of-valmont"] .dynasty-show-on-card'));
		expect(handle.ops).toHaveLength(1);
		expect(cardLabels(graph(handle.body)).get('young-aldric')!.title).toBe('Duke of Valmont');
	});
});

describe('review M8 obsidian: control (passes) - the sheet gives a person with no id an id for Add title', () => {
	it('C1: Add title → Duke on Bran (no id): one write, the holder names his new id', async () => {
		const handle = writingHandle(BODY);
		const { el } = await embed(BODY, { handle });
		const sheet = await openSheetOn(el, '~2', 'mouse');
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-add-title'));
		await click(top().contentEl.querySelectorAll('.dynasty-choice-option')[0]);
		await click(top().contentEl.querySelector('.dynasty-sheet-save'));
		const g = graph(handle.body);
		const bran = g.people.find((p) => p.name === 'Bran Valmont')!;
		expect(bran.id.startsWith('~')).toBe(false);
		expect(g.titles[0].holders.map((h) => h.person ?? h.name)).toEqual(['a', 'Orso the Old', bran.id]);
	});
});
