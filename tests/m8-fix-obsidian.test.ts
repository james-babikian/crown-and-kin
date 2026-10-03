import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { parseBody, readTree } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { withHolderIds } from '../src/obsidian/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { TITLES_UI, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

/*
 * M8 fix round (Obsidian): holder people with no written id get one in Save's write, and a refusal
 * for a person who is not in the tree, with an unchanged note, shows its own message and no stale loop.
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

// Aldric has an id; Bran and Bran (a second one) have none: `~2` and `~3`.
const BODY = [
	'titles:',
	'  - id: duke',
	'    name: Duke',
	'    holders:',
	'      - {person: a, number: I}',
	'people:',
	'  - id: a',
	'    name: Aldric Valmont',
	'  - name: Bran Valmont',
	'    parents: [a]',
	'  - name: Bran Valmont',
	'    parents: [a]',
	'',
].join('\n');

const load = (body: string) => {
	const p = parseBody(body);
	if (!p.ok) throw new Error('the sample does not parse');
	return { g: deriveFamilies(readTree(p.doc, p.data, body)), raw: p.data };
};

describe('withHolderIds', () => {
	it('gives each holder person with no written id one id, first, and names them by it', () => {
		const { g, raw } = load(BODY);
		const ops: Op[] = [
			{
				kind: 'set-holders',
				title: 'duke',
				items: [{ ref: { title: 'duke', index: 0, person: 'a' } }, { add: { person: '~2', number: 'II' } }, { add: { person: '~3' } }, { add: { person: '~2', number: 'III' } }, { add: { person: 'a' } }],
			},
		];
		const out = withHolderIds(ops, g, raw);
		expect(out.slice(0, 2)).toEqual([
			{ kind: 'set-person-fields', id: '~2', fields: { id: 'p1' } },
			{ kind: 'set-person-fields', id: '~3', fields: { id: 'p2' } },
		]);
		const r = applyOp(BODY, { kind: 'batch', ops: out });
		if (!r.ok) throw new Error(`refused: ${r.code}`);
		const g2 = load(r.body).g;
		expect(g2.titles[0].holders.map((h) => `${h.person}:${h.number ?? ''}`)).toEqual(['a:I', 'p1:II', 'p2:', 'p1:III', 'a:']);
		// The input ops stay as they were.
		expect((ops[0] as Extract<Op, { kind: 'set-holders' }>).items[1]).toEqual({ add: { person: '~2', number: 'II' } });
	});

	it('changes nothing when every holder person has a written id', () => {
		const { g, raw } = load(BODY);
		const ops: Op[] = [{ kind: 'set-holders', title: 'duke', items: [{ add: { person: 'a' } }, { add: { name: 'Orso' } }] }];
		expect(withHolderIds(ops, g, raw)).toEqual(ops);
	});
});

describe('Titles window: a refusal for a person who is not in the tree', () => {
	const click = async (el: FEl | null) => {
		expect(el).not.toBeNull();
		dispatch(el!, 'click', { detail: 1 });
		await settle();
	};

	it('with the same note shows its own message, keeps the window open, and does not loop', async () => {
		const handle = fakeHandle('n.md', BODY) as FakeHandle;
		handle.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'unknown-person' } })) as never);
		const host = fakeHost() as Host;
		const { el } = await embed(BODY, { handle, host });
		await click(el.querySelector('.dynasty-more'));
		await click(el.querySelector('.dynasty-more-titles'));
		const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl };
		const content = win.contentEl;
		const name = content.querySelector('.dynasty-title-row input')!;
		name.value = 'Grand Duke';
		dispatch(name, 'input');
		for (let i = 0; i < 2; i++) {
			await click(content.querySelector('.dynasty-sheet-save'));
			expect(notices).not.toContain(WRITE_TEXT.stale);
			expect(notices[notices.length - 1]).toBe(TITLES_UI.personGone);
			expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(TITLES_UI.personGone);
			expect(openModals.includes(win as never)).toBe(true);
			// The draft stays.
			expect(content.querySelector('.dynasty-title-row input')!.value).toBe('Grand Duke');
		}
		expect(handle.write).toHaveBeenCalledTimes(2);
	});
});
