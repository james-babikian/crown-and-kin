import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { SHEET } from '../src/render/ui-text';
import { FEl, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * 1.1.1 WP3, D98 (spec §5.2, §13.4): the free field of the edit sheet is "Title text on the card", with one
 * hint line that tells it apart from the Titles section. The function does not change.
 * Run: npx vitest run tests/v111-obsidian-title.test.ts
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const BODY = `people:
  - id: aldric
    name: Aldric Valmont
    title: Duke of Valmont
`;

function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('Tree.md', body) as FakeHandle & { ops: Op[] };
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

function open() {
	const handle = writingHandle(BODY);
	const sheet = EditSheet.create({} as never, { handle: handle as never, personId: 'aldric', sourcePath: 'Tree.md' })!;
	sheet.open();
	return { content: (sheet as unknown as { contentEl: FEl }).contentEl, handle };
}

describe('D98: the Title field of the edit sheet', () => {
	it('the label reads "Title text on the card" and the hint reads the owner-approved sentence', () => {
		expect(SHEET.title).toBe('Title text on the card');
		expect(SHEET.titleHint).toBe('This text shows under the name on the card. For a title with a number and dates, use the Titles section below.');
		const { content } = open();
		const field = content.querySelector('[data-field="title"]')!;
		expect(field.querySelector('label')!.getText()).toBe('Title text on the card');
		expect(field.querySelector('.dynasty-sheet-hint')!.getText()).toBe(SHEET.titleHint);
	});

	it('the hint sits under the input, inside the field, and the input points to it', () => {
		const { content } = open();
		const field = content.querySelector('[data-field="title"]')!;
		const kids = field.children.map((c) => c.tag.toLowerCase());
		expect(kids).toEqual(['label', 'input', 'div']);
		const hint = field.querySelector('.dynasty-sheet-hint')!;
		expect(field.querySelector('input')!.getAttribute('aria-describedby')).toBe(hint.getAttribute('id'));
		expect(hint.getAttribute('id')).toMatch(/-hint$/);
	});

	it('only the title field has this hint; the other fields keep their labels', () => {
		const { content } = open();
		const hinted = content.querySelectorAll('.dynasty-sheet-field').filter((f) => f.querySelector('.dynasty-sheet-hint') !== null);
		expect(hinted.map((f) => f.getAttribute('data-field'))).toEqual(['title']);
		expect(content.querySelector('[data-field="name"] label')!.getText()).toBe('Name');
		expect(content.querySelector('[data-field="born"] label')!.getText()).toBe('Born');
	});

	it('the field still holds the title text and Save writes a change as before', async () => {
		const { content, handle } = open();
		const input = content.querySelector('[data-field="title"] input')!;
		expect(input.value).toBe('Duke of Valmont');
		input.value = 'Count of Valmont';
		dispatch(input, 'input');
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'aldric', fields: { title: 'Count of Valmont' } }]);
	});

	it('the two texts follow Simplified Technical English: sentences of 20 words or fewer, no contraction, no -ing word', () => {
		for (const text of [SHEET.title, SHEET.titleHint]) {
			for (const sentence of text.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
			expect(text).not.toMatch(/n't|'s\b|’s\b/);
			expect(text).not.toMatch(/\b\w+ing\b/);
		}
	});
});
