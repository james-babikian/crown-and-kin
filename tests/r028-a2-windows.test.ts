import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// What the windows give to the person picker (`ctx`), and the scripted answers of the choice steps of the Add flows.
const calls: { ctx: unknown; title: string }[] = [];
vi.mock('../src/obsidian/person-picker', () => ({
	pickPerson: async (_app: unknown, _g: unknown, _ex: unknown, _ph: unknown, title: string, _allowNew?: boolean, _you?: unknown, _newRow?: unknown, ctx?: unknown) => {
		calls.push({ ctx, title });
		return null;
	},
}));
const chosen: unknown[] = [];
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => chosen.shift() ?? null }));

import { closePluginModals } from '../src/view/plugin-modals';
import { openState, renderSections, resetOpenSections } from '../src/obsidian/window-sections';
import { RowPictures, buildRow } from '../src/obsidian/window-parts';
import { addChild, addParent, addPartner, type FlowHost } from '../src/obsidian/family-flows';
import { TITLES_UI, WINDOW_UI } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_16, openWin, page } from './r027-window-support';

/*
 * Repair round 0.2.8, package A2 (windows, no change of look): the data that the windows give the person picker, the pictures
 * of the rows, the open state of new pages, the heir rows, and the texts. Run: npx vitest run tests/r028-a2-windows.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	resetOpenSections();
	calls.length = 0;
	chosen.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

describe('the data that the windows give the person picker (G.3)', () => {
	it('the Titles window gives the picture store, the note, the marked person and the relation settings', () => {
		const store = { resolve: () => ({ ok: false }) };
		const relationOptions = { half: true };
		const o = openWin(BODY_16, { pictures: store as never, me: () => 'jasper-carrow', relationOptions: (() => relationOptions) as never });
		const ctx = (o.win as unknown as { pickerPictures(): unknown }).pickerPictures();
		expect(ctx).toEqual({ pictures: store, sourcePath: 'n.md', me: 'jasper-carrow', relationOptions });
	});

	it('the Titles window with no marked person gives no person (the picker then shows no relation word)', () => {
		const o = openWin(BODY_16, { me: () => null });
		const ctx = (o.win as unknown as { pickerPictures(): Record<string, unknown> }).pickerPictures();
		expect('me' in ctx).toBe(false);
	});

	it('Add parent passes the context of the host to the picker', async () => {
		const ctx = { sourcePath: 'n.md', me: 'a' };
		const g = { people: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }], byId: new Map(), houses: new Map(), unions: [] };
		const host = {
			app: {},
			g,
			person: { id: 'a', name: 'Ann' },
			fam: { fullTypes: [], parents: [], partners: [], children: [] },
			name: (id: string) => id,
			ready: () => true,
			commit: async () => null,
			openNew: () => {},
			picker: () => ctx,
		} as unknown as FlowHost;
		chosen.push('birth', 'existing');
		await addParent(host).catch(() => {});
		chosen.push('existing');
		await addChild(host).catch(() => {});
		chosen.push('existing');
		await addPartner(host).catch(() => {});
		expect(calls.length).toBeGreaterThan(0);
		for (const c of calls) expect(c.ctx).toBe(ctx);
	});
});

describe('the heir rows of the line of succession (G.7)', () => {
	it('a tap on a row opens the person when the window has openPerson, and closes the window first', () => {
		const opened: string[] = [];
		const o = openWin(BODY_16, { openPerson: (id) => void opened.push(id) });
		const p = page(o, 'duke-of-carrowmere');
		dispatch(p.querySelectorAll('.dynasty-succ-item')[1], 'click');
		expect(opened).toEqual(['jasper-carrow']);
		expect(o.shown).toEqual([]);
		expect(o.closed.n).toBe(1);
	});
});

describe('the open state of new pages', () => {
	it('a new title keeps its own state while the window draws again', () => {
		const o = openWin(BODY_16);
		dispatch(o.content.querySelector('button.dynasty-lw-add')!, 'click');
		const first = o.content.querySelector('.dynasty-lw-page')!;
		dispatch(first.querySelector('[data-section="names"] .dynasty-section-head')!, 'click');
		expect(first.querySelector('[data-section="names"]')!.hasClass('is-open')).toBe(false);
		// The tap of the user on a new page is not stored for the saved titles.
		expect(openState('title', 'names')).toBeUndefined();
	});

	it('the default of a page is not stored: only a tap of the user is', () => {
		const host = new FEl('div');
		renderSections(host as never, 'thing', [
			{ key: 'a', title: 'A', summary: '', open: true, build: () => {} },
			{ key: 'b', title: 'B', summary: '', open: false, build: () => {} },
		]);
		expect(openState('thing', 'a')).toBeUndefined();
		expect(openState('thing', 'b')).toBeUndefined();
		dispatch(host.querySelectorAll('.dynasty-section-head')[0], 'click');
		expect(openState('thing', 'a')).toBe(false);
		expect(openState('thing', 'b')).toBeUndefined();
	});
});

describe('RowPictures: only the rows on screen ask the store', () => {
	/** A watcher that the test drives: `show(slot)` says that a slot came on screen. */
	function watching() {
		const seen: FEl[] = [];
		let cb: (e: { target: FEl; isIntersecting: boolean }[]) => void = () => {};
		class FakeObserver {
			constructor(fn: typeof cb) {
				cb = fn;
			}
			observe(el: FEl) {
				seen.push(el);
			}
			unobserve(el: FEl) {
				seen.splice(seen.indexOf(el), 1);
			}
			disconnect() {
				seen.length = 0;
			}
		}
		const view = { IntersectionObserver: FakeObserver, getComputedStyle: () => ({ overflowY: 'visible' }) };
		const slot = () => Object.assign(new FEl('span'), { ownerDocument: { defaultView: view } });
		return { seen, slot, show: (el: FEl) => cb([{ target: el, isIntersecting: true }]) };
	}
	const store = () => {
		const asked: string[] = [];
		return {
			asked,
			resolve: (l: string) => ({ ok: true, file: { path: l, name: l }, format: 'png' }),
			acquire: async (f: { path: string }) => {
				asked.push(f.path);
				return { url: 'blob:x', w: 1, h: 1, release: () => {} };
			},
		};
	};

	it('a row asks when it comes on screen, not before', async () => {
		const w = watching();
		const s = store();
		const pics = new RowPictures(s as never, 'n.md');
		const slots = [w.slot(), w.slot(), w.slot()];
		slots.forEach((el, i) => pics.show(el as never, `p${i}.png`, { px: 36, fit: 'portrait' }));
		await settle();
		expect(s.asked).toEqual([]);
		w.show(slots[1]);
		await settle();
		expect(s.asked).toEqual(['p1.png']);
		pics.release();
	});

	it('a row that is drawn again lets go of its copy (forget)', async () => {
		const released: string[] = [];
		const s = { ...store(), acquire: async () => ({ url: 'blob:x', w: 1, h: 1, release: () => void released.push('x') }) };
		const root = new FEl('div');
		const slot = root.createSpan();
		const pics = new RowPictures(s as never, 'n.md');
		pics.show(slot as never, 'a.png', { px: 36, fit: 'portrait' });
		await settle();
		pics.forget(root as never);
		expect(released).toEqual(['x']);
		pics.release();
		expect(released).toEqual(['x']);
	});

	it('rows that left the page are let go when many rows were drawn (a picker that is typed in)', async () => {
		let made = 0;
		let held = 0;
		const s = {
			...store(),
			acquire: async () => {
				made++;
				held++;
				let done = false;
				return { url: 'blob:x', w: 1, h: 1, release: () => void (done || ((done = true), held--)) };
			},
		};
		const pics = new RowPictures(s as never, 'n.md');
		for (let round = 0; round < 5; round++) {
			for (let i = 0; i < 40; i++) {
				const slot = new FEl('span');
				pics.show(slot as never, `p${i}.png`, { px: 36, fit: 'portrait' });
				// The list is drawn again: the old slot is off the page.
				slot.isConnected = false;
			}
			await settle();
		}
		expect(made).toBe(200);
		expect(held).toBeLessThan(100);
		pics.release();
		expect(held).toBe(0);
	});
});

describe('row labels and texts', () => {
	it('a tap row with no label is named by its two text lines, joined by their ids (not "GwenDaughter")', () => {
		const row = buildRow(new FEl('div') as never, { tap: () => {} });
		const ids = row.row.getAttribute('aria-labelledby')!.split(' ');
		expect(ids).toEqual([row.title.id, row.sub.id]);
		expect(ids.every(Boolean)).toBe(true);
		// A row with its own label, and a row that is not a button, are left alone.
		expect(buildRow(new FEl('div') as never, { tap: () => {}, label: 'Open Gwen' }).row.getAttribute('aria-labelledby')).toBeNull();
		expect(buildRow(new FEl('div') as never, {}).row.getAttribute('aria-labelledby')).toBeNull();
	});

	it('the reign after a name and the label of a name button come from TITLES_UI', () => {
		expect(TITLES_UI.reign('1160–1207')).toBe('(r. 1160–1207)');
		expect(TITLES_UI.showCardLabel('Ann')).toBe('Ann: show the card in the tree');
	});

	it('"this person" is lower case inside a sentence; the portrait link says what it does', () => {
		expect(WINDOW_UI.portraitOf(WINDOW_UI.thisPersonInSentence)).toBe('Portrait of this person');
		expect(WINDOW_UI.addPortrait).toBe('Add portrait or arms');
		expect(WINDOW_UI.addPortraitHasArms).toBe('Add portrait');
	});

	it('a person row with one year says which year it is', () => {
		expect(WINDOW_UI.personRowSub(2, '', '1161')).toBe('Generation 2 · d. 1161');
		expect(WINDOW_UI.personRowSub(2, '1131', '')).toBe('Generation 2 · b. 1131');
		expect(WINDOW_UI.personRowSub(2, '1131', '1161')).toBe('Generation 2 · 1131–1161');
		expect(WINDOW_UI.personRowSub(2, '', '')).toBe('Generation 2');
	});
});
