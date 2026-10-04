import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { parseDynasty } from '../src/core/parse';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';

/*
 * Search round 0.2.3, area C. A person with no written id is named `~N` after their place in the list
 * (spec §8). The sheet reloads after a stale write by that name. When the note changed above the
 * person (sync, another pane), `~3` is another person: the sheet shows them and the kept draft goes to them.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
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
});

const BEFORE = ['people:', '  - id: a', '    name: Aldric', '  - name: Xavier', '  - name: Yvonne', ''].join('\n');
// Another device adds Zed above them: Xavier is ~3 now and Yvonne is ~4.
const AFTER = ['people:', '  - id: a', '    name: Aldric', '  - name: Zed', '  - name: Xavier', '  - name: Yvonne', ''].join('\n');

const titles = (body: string) => {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('parse');
	return Object.fromEntries(r.tree.people.map((p) => [p.name, p.title ?? null]));
};

describe('a stale sheet of a person with no written id', () => {
	async function staleSheet() {
		const h = writingHandle(BEFORE);
		const s = EditSheet.create({} as never, { handle: h as never, personId: '~3', sourcePath: 'n.md' })!;
		s.open();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		expect((modal.querySelector('[data-field="name"] input') as FEl).value).toBe('Yvonne');
		type(modal.querySelector('[data-field="title"] input')!, 'Lord');
		// The note changes under the open sheet.
		h.body = AFTER;
		await click(modal.querySelector('.dynasty-sheet-save'));
		return { h, modal };
	}

	it('after the stale Save the sheet still shows the person it was opened for', async () => {
		const { modal } = await staleSheet();
		expect((modal.querySelector('[data-field="name"] input') as FEl).value).toBe('Yvonne');
	});

	it('the second Save writes the draft to the person it was typed for, never to another person', async () => {
		const { h, modal } = await staleSheet();
		await click(modal.querySelector('.dynasty-sheet-save'));
		const t = titles(h.body);
		expect(t.Xavier).toBeNull();
		expect(t.Yvonne).toBe('Lord');
	});
});
