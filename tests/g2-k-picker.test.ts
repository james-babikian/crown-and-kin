// G2 scratch proof (WP-K): the first Find on a marked tree that was drawn as a focus family pays for the whole tree.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { relationCallStats } from '../src/core/relations';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { pickPerson } from '../src/obsidian/person-picker';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost } from './acceptance/tree-view-fakes';
import { genModel, toText } from './r028-gen';

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
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const N = 80;
const ME = 'p40';
const BODY = toText({ ...genModel(17, { n: N, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: ME } });

describe('G2 K.2 picker', () => {
	it('opening Find on a marked tree (focus family drawn) works out only the first screenful of rows, not every person', async () => {
		desktop();
		const handle = fakeHandle('n.md', BODY);
		handle.state.focus = { id: 'p70' };
		await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle });
		const parsed = parseDynasty(BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		void pickPerson(fakeHost().app as never, g, new Set(), 'Type', 'Find', false, ME, null, { sourcePath: 'n.md', me: ME });
		const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as { getSuggestions(q: string): unknown[] };
		const start = relationCallStats.calls;
		const items = p.getSuggestions('');
		const worked = relationCallStats.calls - start;
		console.log(`rows ${items.length}, relation calls made by getSuggestions('') after a focus render: ${worked}`);
		// A screenful is about 12 rows; allow 25. Release 0.3.0 made 0 calls here (the render had worked out the whole tree).
		expect(worked).toBeLessThanOrEqual(25);
	});
});
