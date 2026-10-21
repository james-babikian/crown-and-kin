import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Counts the layout calls: a redraw by the calendar index must come from the layout cache (spec §14 rule 9, the architecture notes §5.7).
const layoutCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/layout/pipeline', async (original) => {
	const real = await original<typeof import('../src/layout/pipeline')>();
	return {
		...real,
		arrangeTree: (...args: Parameters<typeof real.arrangeTree>) => {
			layoutCalls.n++;
			return real.arrangeTree(...args);
		},
	};
});

import { FullScreenModal } from '../src/obsidian/full-screen';
import { redrawForDates } from '../src/obsidian/calendar-feature';
import { clearLayoutCache } from '../src/layout/index';
import { createCalendarIndex } from '../src/view/calendar-index';
import { clearRelationCache } from '../src/view/relation-cache';
import { FEl, clock, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards, phone } from './acceptance/tree-view-fakes';
import { eraNote, fakeVault } from './support/calendar-vault';

/*
 * Step 4.3 of WP-4: a tree draws with the reader that the calendar index gives it. A change of the index draws it again with the kept anchor and with no new layout
 * (dates move no card, only the text of a card), and the phone list stays on its centre person. Real `TreeView` on the fake page, real index on a fake vault.
 */

beforeAll(() => {
	installDom();
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	clearLayoutCache();
	layoutCalls.n = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

// A person who died in a calendar year and has no birth text: the card hides a death text with no year (I19) until a calendar reads it.
const DIED = ['people:', '  - id: aldric', '    name: Aldric Valmont', '    died: Qinglong Emperor 3', '  - id: bran', '    name: Bran Valmont', '    parents: [aldric]', ''].join('\n');

const ready = async () => {
	const vault = fakeVault({ 'Calendars.md': eraNote() });
	const index = createCalendarIndex(vault, { pause: async () => undefined });
	return { vault, index };
};

const cardDates = (el: FEl, id: string) => el.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-card-dates`)?.getText() ?? null;

async function settled(): Promise<void> {
	await settle();
	resizeAll();
	flushFrames();
}

describe('a tree reads its dates through the reader of the index', () => {
	it('draws at once with the plain reader, then again after the scan, with the written date and with no new layout', async () => {
		desktop();
		const { index } = await ready();
		const host = fakeHost();
		(host as unknown as { dates: unknown }).dates = index;
		const { el, view } = await embed(DIED, { host, handle: fakeHandle('n.md', DIED) });
		fillAllCards(el);
		// Not ready: plain years only, so the death text with no year and no birth text shows as the sign.
		expect(index.ready).toBe(false);
		expect(cardDates(el, 'aldric')).toBe('†');
		const calls = layoutCalls.n;
		expect(calls).toBeGreaterThan(0);

		await index.start();
		(view as unknown as { datesChanged(): void }).datesChanged();
		await settled();
		fillAllCards(el);
		expect(cardDates(el, 'aldric')).toMatch(/^d\. Qinglong/);
		expect(layoutCalls.n).toBe(calls);
	});

	it('a change of the index that leaves the reader key as it was draws nothing again', async () => {
		desktop();
		const { index } = await ready();
		await index.start();
		const host = fakeHost();
		(host as unknown as { dates: unknown }).dates = index;
		const { el, view } = await embed(DIED, { host, handle: fakeHandle('n.md', DIED) });
		fillAllCards(el);
		const before = (host as { renders?: number }).renders;
		(view as unknown as { datesChanged(): void }).datesChanged();
		await settled();
		expect((host as { renders?: number }).renders).toBe(before);
	});

	it('redrawForDates calls each open view, the ones on screen first', async () => {
		desktop();
		const shown = { datesChanged: vi.fn(), offScreen: false };
		const hidden = { datesChanged: vi.fn(), offScreen: true };
		const turns: number[] = [];
		redrawForDates([hidden, shown] as never, (fn, turn) => {
			turns.push(turn);
			fn();
		});
		expect(shown.datesChanged).toHaveBeenCalledTimes(1);
		expect(hidden.datesChanged).toHaveBeenCalledTimes(1);
		expect(turns).toEqual([0]);
	});
});

// Aldric is born in a calendar year (139 once the calendar reads it, after Berta's 1100) and Berta in a plain year: with the plain reader Berta is the oldest parent.
const LIST = [
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'    born: Qinglong Emperor 10',
	'  - id: berta',
	'    name: Berta Corwin',
	'    born: "1100"',
	'  - id: cara',
	'    name: Cara Valmont',
	'    parents: [aldric]',
	'  - id: dirk',
	'    name: Dirk Corwin',
	'    parents: [berta]',
	'',
].join('\n');

describe('the phone list keeps its centre person when the index changes', () => {
	it('stays on the person it stood on, although the calendar changes who is the oldest parent', async () => {
		phone();
		const { index } = await ready();
		const host = fakeHost();
		(host as unknown as { dates: unknown }).dates = index;
		const { el, view } = await embed(LIST, { host, handle: fakeHandle('n.md', LIST) });
		const centre = () => el.querySelector('.dynasty-root')?.getAttribute('data-dynasty-focus');
		expect(centre()).toBe('berta');
		await index.start();
		(view as unknown as { datesChanged(): void }).datesChanged();
		await settled();
		expect(centre()).toBe('berta');
		// A new view of the same note, drawn after the scan, starts on the oldest parent that the calendar finds.
		const fresh = await embed(LIST, { host, handle: fakeHandle('n.md', LIST) });
		expect(fresh.el.querySelector('.dynasty-root')?.getAttribute('data-dynasty-focus')).toBe('aldric');
	});
});
