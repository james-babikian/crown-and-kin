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

describe('G5 M8 item 1: the holder buttons have a visible shape on a phone', () => {
	it('every button of the holder panel but the name has a border', () => {
		expect(rule('.dynasty-sheet .dynasty-holder-panel button:not(.dynasty-holder-name)')).toMatch(/border: 1px solid var\(--background-modifier-border\)/);
	});

	it('on a phone the panel has the fill of the window, not --background-secondary (the fill Obsidian gives a phone button), and a border', () => {
		const phone = rule('.dynasty-sheet.is-phone .dynasty-holder-panel');
		expect(phone).toMatch(/background: var\(--modal-background, var\(--background-primary\)\)/);
		expect(phone).not.toMatch(/--background-secondary/);
		expect(phone).toMatch(/border: 1px solid var\(--background-modifier-border\)/);
	});

	it('the buttons keep a 44 px hit area (spec §7.5)', () => {
		expect(rule('.dynasty-sheet-actions button', '.dynasty-sheet-action', '.dynasty-sheet-confirm-actions button')).toMatch(/min-height: 44px;[\s\S]*min-width: 44px/);
		expect(rule('.dynasty-sheet.is-phone .dynasty-holder-buttons > .dynasty-holder-move')).toMatch(/width: 44px/);
	});
});

describe('G5 M8 item 2: a holder who is not in the tree has the same name size and weight', () => {
	it('one rule sets the font size and weight of the name button and the name text', () => {
		const r = rule('.dynasty-sheet button.dynasty-holder-name', '.dynasty-sheet div.dynasty-holder-name');
		expect(r).toMatch(/font-size: var\(--font-ui-small\)/);
		expect(r).toMatch(/font-weight: var\(--font-semibold\)/);
		// No other rule gives the name text its own size or weight.
		for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const sels = m[1].split(',').map((x) => x.trim());
			if (sels.some((x) => /div\.dynasty-holder-name$/.test(x)) && sels.length === 1) expect(m[2]).not.toMatch(/font-(size|weight)/);
		}
	});

	it('the Titles window gives the name text of a holder who is not in the tree the same class as the name buttons', async () => {
		const body = ['titles:', '  - id: duke', '    name: Duke', '    holders:', '      - {name: Orso the Old, number: I}', '      - {person: a, number: II}', 'people:', '  - id: a', '    name: Aldric Valmont', ''].join('\n');
		const handle = writingHandle(body);
		const { el } = await embed(body, { handle, host: fakeHost() as Host });
		await click(el.querySelector('.dynasty-more'));
		await click(el.querySelector('.dynasty-more-titles'));
		const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl };
		expect(win).toBeDefined();
		const box = () => win.contentEl.querySelector('.dynasty-title-box[data-title="duke"]')!;
		await click(box().querySelector('.dynasty-title-toggle'));
		const names = box().querySelectorAll('.dynasty-holder-name');
		expect(names.map((n) => n.tag.toLowerCase())).toEqual(['div', 'button']);
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
