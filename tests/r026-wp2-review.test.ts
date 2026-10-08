import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS, type DynastySettings } from '../src/obsidian/settings';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, phone, type Host } from './acceptance/tree-view-fakes';

// WP2 review of the 0.2.6 merge: the phone list must follow the setting "Assume an unknown second parent" (D174).

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = [
	'options:',
	'  me: p12',
	'people:',
	'  - {id: p1, name: Mary, sex: f}',
	'  - {id: p12, name: Helen, sex: f, parents: [p1]}',
	'  - {id: p13, name: Ingrid, sex: f, parents: [p1]}',
	'',
].join('\n');

async function openList(settings: DynastySettings) {
	phone();
	const host = fakeHost(settings) as Host & { settings: DynastySettings };
	const out = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
	// Go to Mary: her list shows both daughters, so Ingrid has a word.
	dispatch(out.el.querySelector('.dynasty-list-row[data-person="p1"] .dynasty-list-go')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	resizeAll();
	flushFrames();
	return { ...out, host };
}
const word = (el: FEl, id: string) => el.querySelector(`.dynasty-list-row[data-person="${id}"] .dynasty-list-word`)?.getText() ?? null;

describe('WP2 review: phone list and D174', () => {
	it('the phone list names Ingrid "Sister" when "Assume an unknown second parent" is off', async () => {
		const { el } = await openList({ ...DEFAULT_SETTINGS, oneParentUnknown: false });
		expect(word(el, 'p13')).toMatch(/^Sister$/);
	});

	it('a change of the setting draws the list again with the new word', async () => {
		const { el, host, view } = await openList({ ...DEFAULT_SETTINGS, oneParentUnknown: true });
		const before = word(el, 'p13'); 		const prev = { ...host.settings };
		host.settings = { ...host.settings, oneParentUnknown: false };
		(view as unknown as { onSettingsChange(p: DynastySettings): void }).onSettingsChange(prev);
		expect(word(el, 'p13')).not.toBe(before);
	});
});
