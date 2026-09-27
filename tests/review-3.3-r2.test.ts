import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
	class Notice {
		constructor(public text: unknown) {}
	}
	class Modal {
		modalEl = { addClass() {}, removeClass() {} };
		constructor(public app: unknown) {}
	}
	class SuggestModal {}
	return { Notice, Modal, SuggestModal };
});
// The partnership editor: Save at once with a new start date.
vi.mock('../src/obsidian/union-edit', () => ({
	editUnion: (_app: unknown, _a: string, _b: string, v: { type: string; start: string; end: string }, save: (v: unknown) => Promise<unknown>) => void save({ ...v, start: '1130' }),
}));

import type { Op } from '../src/core/edit';
import { familyOf } from '../src/core/family-query';
import { EditSheet, loadSheet } from '../src/obsidian/edit-sheet';

// Two partnerships of one couple with the same text: add-union gives no id to a childless union.
const TWIN = ['people:', '  - id: a', '    name: A', '  - id: b', '    name: B', 'unions:', '  - partners: [a, b]', '  - partners: [a, b]', ''].join('\n');

function handle(body: string, sent: Op[]) {
	return {
		body,
		state: { lastEdited: null, highlight: null },
		write: async (op: Op) => {
			sent.push(op);
			return { ok: false, code: 'missing' };
		},
	} as never;
}

describe('WP3.3 fix round: a partnership found again by its text', () => {
	it('Edit on the second of two same-text partnerships edits the second one', async () => {
		const sent: Op[] = [];
		const sheet = EditSheet.create({} as never, { handle: handle(TWIN, sent), personId: 'a', sourcePath: 'x.md' })!;
		const second = familyOf((loadSheet(TWIN, 'a') as unknown as { data: { g: never } }).data.g, 'a')!.partners[1];
		expect(second.union!.index).toBe(1);
		(sheet as unknown as { editPartnership(l: unknown): void }).editPartnership(second);
		await new Promise((r) => setTimeout(r, 0));
		expect(sent).toHaveLength(1);
		expect((sent[0] as { union: { index: number } }).union.index).toBe(1);
	});

	it('a new child for the second of two same-text partnerships keeps that partnership', () => {
		const parent = EditSheet.create({} as never, { handle: handle(TWIN, []), personId: 'a', sourcePath: 'x.md' })!;
		const second = familyOf((loadSheet(TWIN, 'a') as unknown as { data: { g: never } }).data.g, 'a')!.partners[1].union!;
		const child = EditSheet.createNew({} as never, { handle: handle(TWIN, []), sourcePath: 'x.md', parentSheet: parent, newPerson: { kind: 'child', parent: 'a', other: 'b', union: second } })!;
		expect((child as unknown as { rel: { union: { index: number } } }).rel.union.index).toBe(1);
	});
});
