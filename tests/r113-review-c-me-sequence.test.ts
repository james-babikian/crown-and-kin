import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { focusSubgraph } from '../src/core/focus-subgraph';
import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, phone } from './acceptance/tree-view-fakes';

/*
 * Review round 0.2.3, area C, spec 13.18 rule 5: what the phone preview shows over a sequence of edits of the mark.
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
const family1 = (src: string, id: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse');
	return [...new Set(focusSubgraph(r.tree, id, 1)!.tree.people.map((p) => p.id))].sort();
};
const everybody = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`).sort();
const drawn = (root: FEl) => [...new Set(root.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!))].sort();
async function change(handle: ReturnType<typeof fakeHandle>, next: string) {
	handle.change(next);
	await settle();
	resizeAll();
	flushFrames();
}

describe('the phone preview over a sequence of changes of the mark (spec 13.18 rule 5)', () => {
	it('an edit of another person does not move the family', async () => {
		phone();
		const a = line(7, 'me: p3');
		const handle = fakeHandle('n.md', a);
		const { el } = await embed(a, { handle });
		expect(drawn(el)).toEqual(family1(a, 'p3'));
		handle.state.lastEdited = 'p5';
		await change(handle, a.replace('name: P5', 'name: Five'));
		expect(drawn(el)).toEqual(family1(a, 'p3'));
	});

	it('the mark moved from p3 to p6 in one step: the preview shows the family of p6', async () => {
		phone();
		const a = line(7, 'me: p3');
		const handle = fakeHandle('n.md', a);
		const { el } = await embed(a, { handle });
		const c = line(7, 'me: p6');
		handle.state.lastEdited = 'p6';
		await change(handle, c);
		expect(drawn(el)).toEqual(family1(c, 'p6'));
	});

	it('mark, remove the mark, mark another person: the preview shows the family of the person marked last', async () => {
		phone();
		const a = line(7, 'me: p3');
		const handle = fakeHandle('n.md', a);
		const { el } = await embed(a, { handle });
		expect(drawn(el)).toEqual(family1(a, 'p3'));
		// "Remove the mark" on a small tree: the old rule stands, the whole tree.
		const b = line(7);
		await change(handle, b);
		expect(drawn(el)).toEqual(everybody(7));
		// "This is me" on p6: the sheet sets the edited person first (edit-sheet.ts write()), then the text changes.
		const c = line(7, 'me: p6');
		handle.state.lastEdited = 'p6';
		await change(handle, c);
		expect(drawn(el)).toEqual(family1(c, 'p6'));
	});
});
