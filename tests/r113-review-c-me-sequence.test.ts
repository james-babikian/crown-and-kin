import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, phone } from './acceptance/tree-view-fakes';

/*
 * Review round 0.2.3, area C, spec 13.18 rule 5, moved to the list of 0.2.5 (D144): what the list of a phone note stands on over a sequence
 * of edits of the mark. The start chain is the session choice, the pin, the marked person, the person edited last, the oldest person who has
 * children, the first root (spec §5.5).
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
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function line(n: number, ...options: string[]): string {
	const people = Array.from({ length: n }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n');
	return `${options.length ? `options:\n${options.map((o) => `  ${o}\n`).join('')}\n` : ''}people:\n${people}\n`;
}
const stands = (root: FEl) => {
	const r = root.querySelector('.dynasty-root')!;
	return [r.getAttribute('data-dynasty-focus'), r.getAttribute('data-dynasty-list-from')];
};
async function change(handle: ReturnType<typeof fakeHandle>, next: string) {
	handle.change(next);
	await settle();
	resizeAll();
	flushFrames();
}

describe('the list of a phone note over a sequence of changes of the mark (spec 13.18 rule 5, D144)', () => {
	it('an edit of another person does not move the list that stands on the marked person', async () => {
		phone();
		const a = line(7, 'me: p3');
		const handle = fakeHandle('n.md', a);
		const { el } = await embed(a, { handle });
		expect(stands(el)).toEqual(['p3', 'me']);
		handle.state.lastEdited = 'p5';
		await change(handle, a.replace('name: P5', 'name: Five'));
		expect(stands(el)).toEqual(['p3', 'me']);
	});

	it('the mark moved from p3 to p6 in one step: the list stands on p6', async () => {
		phone();
		const a = line(7, 'me: p3');
		const handle = fakeHandle('n.md', a);
		const { el } = await embed(a, { handle });
		const c = line(7, 'me: p6');
		handle.state.lastEdited = 'p6';
		await change(handle, c);
		expect(stands(el)).toEqual(['p6', 'me']);
	});

	it('mark, remove the mark, mark another person: the list stands on the person marked last', async () => {
		phone();
		const a = line(7, 'me: p3');
		const handle = fakeHandle('n.md', a);
		const { el } = await embed(a, { handle });
		expect(stands(el)).toEqual(['p3', 'me']);
		// "Remove the mark": no mark, no pin, no edit, so the oldest person who has children.
		const b = line(7);
		await change(handle, b);
		expect(stands(el)).toEqual(['p0', 'oldest']);
		// "This is me" on p6: the sheet sets the edited person first (edit-sheet.ts write()), then the text changes.
		const c = line(7, 'me: p6');
		handle.state.lastEdited = 'p6';
		await change(handle, c);
		expect(stands(el)).toEqual(['p6', 'me']);
	});

	it('with no mark the list follows the person saved last (B1: not an in-place write)', async () => {
		phone();
		const a = line(7);
		const handle = fakeHandle('n.md', a);
		const { el } = await embed(a, { handle });
		expect(stands(el)).toEqual(['p0', 'oldest']);
		handle.state.lastSaved = 'p4';
		await change(handle, a.replace('name: P4', 'name: Four'));
		expect(stands(el)).toEqual(['p4', 'edited']);
	});
});
