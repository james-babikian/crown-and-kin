import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { cardLabels } from '../src/core/titles';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { SETTINGS_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_13 } from './acceptance/titles-support';
import { embed, fakeHandle, fakeHost, openSheetOn, type FakeHandle, type Host } from './acceptance/tree-view-fakes';
import { openPage } from './lw-support';

/*
 * M8 finishing round (G5 items): the holder buttons have a shape on a phone, a holder who is not in
 * the tree has the same name size as the others, the dates setting names the reigns, and "Show on the
 * card" decides from the draft title text also when the draft removes a saved title text.
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

const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rule whose selector list is exactly `selectors` (in any order). */
function rule(...selectors: string[]): string {
	const want = [...selectors].sort().join(',');
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const got = m[1]
			.split(',')
			.map((x) => x.trim())
			.sort()
			.join(',');
		if (got === want) return m[2];
	}
	throw new Error(`no rule for ${want}`);
}

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

const graph = (body: string) => {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('the sample does not parse');
	return deriveFamilies(r.tree);
};

/** The text of the person block of `id` in `body`, up to the next person. */
const personBlock = (body: string, id: string) => {
	const i = body.indexOf(`  - id: ${id}\n`);
	const j = body.indexOf('\n  - ', i + 1);
	return body.slice(i, j < 0 ? undefined : j);
};

describe('G5 M8 item 1: the buttons of a holder row have a visible shape and a 44 px hit area on a phone', () => {
	it('the buttons of the window (Cancel, Save, Add) have an edge that reaches 3:1 (I39)', () => {
		expect(rule('.dynasty-sheet-actions button', '.dynasty-sheet-confirm-actions button', '.dynasty-btn', '.dynasty-sheet button.dynasty-sheet-save-another')).toMatch(/border: 1px solid var\(--dynasty-btn-edge\)/);
	});

	it('the icon button (the menu "more" of a holder row) is 44 px on a phone', () => {
		const r = rule('.dynasty-sheet.is-phone .dynasty-icon-btn');
		expect(r).toMatch(/width: 44px/);
		expect(r).toMatch(/min-height: 44px/);
	});

	it('the row keeps a hit area of at least 44 px (spec §7.5); every row has one height, 48 px (D213)', () => {
		expect(rule('.dynasty-row')).toMatch(/min-height: 48px/);
	});
});

describe('G5 M8 item 2: a holder who is not in the tree has the same name size as the name buttons', () => {
	it('the name button and the name text have the Name role: Heading size, semibold, text font (D218 items 1 to 3)', () => {
		expect(rule('.dynasty-sheet button.dynasty-holder-name')).toMatch(/font-size: var\(--dynasty-type-heading\)/);
		const text = rule('.dynasty-sheet div.dynasty-holder-name', '.dynasty-sheet span.dynasty-holder-name');
		expect(text).toMatch(/font-size: var\(--dynasty-type-heading\)/);
		expect(text).toMatch(/font-weight: var\(--font-semibold\)/);
		expect(text).toMatch(/font-family: var\(--font-text\)/);
		expect(rule('.dynasty-sheet button.dynasty-holder-name')).toMatch(/font-weight: var\(--font-semibold\)/);
	});

	it('the Titles window gives the name text of a holder who is not in the tree the same class as the name buttons', async () => {
		const body = ['titles:', '  - id: duke', '    name: Duke', '    holders:', '      - {name: Orso the Old, number: I}', '      - {person: a, number: II}', 'people:', '  - id: a', '    name: Aldric Valmont', ''].join('\n');
		const handle = writingHandle(body);
		const { el } = await embed(body, { handle, host: fakeHost() as Host });
		await click(el.querySelector('.dynasty-titles-button'));
		const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl };
		expect(win).toBeDefined();
		const names = openPage(win.contentEl, 'duke').querySelectorAll('.dynasty-holder-name');
		expect(names.map((n) => n.tag.toLowerCase())).toEqual(['span', 'button']);
		expect(names[0].getAttribute('class')).toBe(names[1].getAttribute('class'));
	});
});

describe('G5 M8 item 3: the dates setting names the reigns', () => {
	it('says that the cards show the years of each reign, in 20 words or fewer', () => {
		expect(SETTINGS_UI.datesDesc).toMatch(/reign/);
		for (const sentence of SETTINGS_UI.datesDesc.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
	});
});

describe('G5 M8 item 5: "Show on the card" decides from the draft title text', () => {
	it('an empty draft title and the first title: card-title is removed, not written (Bertrand, saved title text)', async () => {
		const handle = writingHandle(BODY_13);
		expect(personBlock(BODY_13, 'bertrand')).toContain('title: Count Palatine of Orsini');
		const { el } = await embed(BODY_13, { handle });
		const sheet = await openSheetOn(el, 'bertrand', 'mouse');
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		// The draft: the Title field emptied, not saved yet.
		const title = content.querySelector('[data-field="title"] input')!;
		title.value = '';
		dispatch(title, 'input');
		await click(content.querySelector('.dynasty-title-holding[data-title="count-of-orsini"] .dynasty-show-on-card'));
		expect(handle.ops).toHaveLength(1);
		const block = personBlock(handle.body, 'bertrand');
		expect(block).not.toMatch(/^\s*title:/m);
		expect(block).not.toMatch(/card-title/);
		expect(cardLabels(graph(handle.body)).get('bertrand')!.title).toBe('Count of Orsini');
	});

	it('a draft title text and the first title: card-title is written (D63)', async () => {
		const handle = writingHandle(BODY_13);
		const { el } = await embed(BODY_13, { handle });
		const sheet = await openSheetOn(el, 'bertrand', 'mouse');
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		await click(content.querySelector('.dynasty-title-holding[data-title="count-of-orsini"] .dynasty-show-on-card'));
		expect(personBlock(handle.body, 'bertrand')).toMatch(/card-title: count-of-orsini/);
		expect(cardLabels(graph(handle.body)).get('bertrand')!.title).toBe('Count of Orsini');
	});
});
