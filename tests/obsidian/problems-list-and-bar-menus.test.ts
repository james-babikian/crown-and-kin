import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveFamilies } from '../../src/core/derive';
import { codedIssue } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { drawProblems, problemTarget } from '../../src/obsidian/problems-list';
import { fitIcon, toolbarIn } from '../../src/obsidian/tree-view-toolbar';
import { Popover, planPlace } from '../../src/render/dom/widgets';
import { PROBLEMS_HINT, PROBLEMS_OPEN, problemsTitle } from '../../src/render/ui-text';
import { TOOLBAR_UI } from '../../src/render/view-text';
import { FEl, device, dispatch, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 in the bars and their lists: the problem list is one box with a second action on a row that has a place to correct it (CH-02, UX-20), a popover opens on the side that has the room
 * (CH-01, UX-05), the Fit icon is checked against the icons of this Obsidian (CH-14), and the style rules of the bars (CH-04, CH-05, CH-11).
 */

useFakeDom({ window: true, css: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

const tree = (text: string) => {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error('does not parse');
	return deriveFamilies(r.tree);
};
const WHOLE = tree('houses:\n  - {id: harrow, name: House Harrow}\npeople:\n  - {id: oswin, name: Oswin Valmont, house: harrow}\n  - {id: wulf, name: Wulf Stranger}\n');

describe('where a problem is corrected (UX-20)', () => {
	it('an arms problem names the house, a problem about a person names the person, another problem has no place', () => {
		const arms = codedIssue('missing-picture', 'warning', { owner: 'arms', house: 'House Harrow', file: 'harrow-arms.png' }, ['harrow']);
		expect(problemTarget(arms, WHOLE)).toEqual({ kind: 'house', id: 'harrow', name: 'House Harrow' });
		const person = codedIssue('missing-house', 'warning', { person: 'Oswin Valmont', ref: 'x' }, ['oswin']);
		expect(problemTarget(person, WHOLE)).toEqual({ kind: 'person', id: 'oswin', name: 'Oswin Valmont' });
		expect(problemTarget(codedIssue('missing-house', 'warning', { ref: 'x' }), WHOLE)).toBeNull();
		expect(problemTarget(codedIssue('missing-house', 'warning', {}, ['nobody']), WHOLE)).toBeNull();
		expect(problemTarget(person, null)).toBeNull();
	});

	it('any problem whose first ID is an existing house names the house, not only an arms problem', () => {
		const colour = codedIssue('house-color-null', 'warning', { house: 'House Harrow', id: 'harrow' }, ['harrow']);
		expect(problemTarget(colour, WHOLE)).toEqual({ kind: 'house', id: 'harrow', name: 'House Harrow' });
		const twice = codedIssue('duplicate-house-id', 'warning', { id: 'harrow', house: 'House Harrow' }, ['harrow']);
		expect(problemTarget(twice, WHOLE)).toEqual({ kind: 'house', id: 'harrow', name: 'House Harrow' });
		// A house that is not in the tree, and an arms problem of such a house, have no window.
		expect(problemTarget(codedIssue('house-color-null', 'warning', { house: 'House Gone' }, ['gone']), WHOLE)).toBeNull();
		expect(problemTarget(codedIssue('missing-picture', 'warning', { owner: 'arms', house: 'House Gone', file: 'a.png' }, ['gone']), WHOLE)).toBeNull();
	});
});

describe('the problem list (CH-02, UX-20)', () => {
	const issues = [
		codedIssue('missing-picture', 'warning', { owner: 'arms', house: 'House Harrow', file: 'harrow-arms.png' }, ['harrow']),
		codedIssue('missing-house', 'blocking', { person: 'Oswin Valmont', ref: 'x' }, ['oswin']),
		codedIssue('duplicate-house-id', 'warning', { id: 'harrow' }),
	];
	function draw(sheet = false) {
		const el = new FEl('div');
		const shown: string[][] = [];
		const opened: string[] = [];
		const first = drawProblems(el as unknown as HTMLElement, {
			issues,
			whole: WHOLE,
			peopleOf: (i) => i.ids ?? [],
			show: (p) => shown.push(p),
			open: (t) => opened.push(t.name),
			close: () => undefined,
			icon: () => undefined,
			sheet,
		});
		return { el, first, shown, opened };
	}

	it('is one box: a title row, the hint and one row for each problem, with no callout', () => {
		const { el } = draw();
		expect(el.querySelector('.callout')).toBeNull();
		expect(el.querySelector('.dynasty-problems-title')!.getText()).toBe(problemsTitle(3));
		expect(el.querySelector('.dynasty-problems-hint')!.getText()).toBe(PROBLEMS_HINT);
		expect(el.querySelectorAll('li.dynasty-problem')).toHaveLength(3);
		expect(el.querySelector('li.is-blocking')).not.toBeNull();
	});

	it('gives a row with a place a second button, "Open House Harrow", with its own name for a screen reader', () => {
		const { el, shown, opened } = draw();
		const open = el.querySelectorAll('button.dynasty-problem-open');
		expect(open.map((b) => b.getText())).toEqual([PROBLEMS_OPEN.button('House Harrow'), PROBLEMS_OPEN.button('Oswin Valmont')]);
		expect(open[0]!.getAttribute('aria-label')).toBe(PROBLEMS_OPEN.label('House Harrow'));
		dispatch(open[1]!, 'click');
		expect(opened).toEqual(['Oswin Valmont']);
		// The text of the row is still the button that shows the people.
		dispatch(el.querySelectorAll('button.dynasty-problem-button')[0]!, 'click');
		expect(shown).toEqual([['harrow']]);
		// A problem with no place has its text and no button.
		const last = el.querySelectorAll('li.dynasty-problem')[2]!;
		expect(last.querySelector('button')).toBeNull();
		expect(last.querySelector('.dynasty-problem-text')).not.toBeNull();
	});

	it('a sheet has the head with Close; the first button is the one for the keyboard', () => {
		const sheet = draw(true);
		expect(sheet.el.querySelector('.dynasty-sheet-head .dynasty-sheet-close')).not.toBeNull();
		expect(sheet.first).toBe(sheet.el.querySelector('.dynasty-problem-button'));
		expect(draw(false).el.querySelector('.dynasty-sheet-close')).toBeNull();
	});
});

describe('a popover opens on the side that has the room (CH-01, UX-05)', () => {
	/** A host that is 800 px high at the top of the screen, and an anchor (a bar button) at `top`. */
	function open(top: number, build: (el: HTMLElement) => void = () => undefined, align: 'start' | 'centre' | 'end' = 'start') {
		device.height = 800;
		const host = new FEl('div');
		host.clientWidth = 1000;
		host.clientHeight = 800;
		const pop = new Popover(host as unknown as HTMLElement);
		const el = pop.open('more', build, null, { left: 900, top, right: 930, bottom: top + 30, width: 30, height: 30, x: 900, y: top, toJSON: () => ({}) } as DOMRect, { align });
		return el as unknown as FEl;
	}
	const sized = (h: number) => (el: HTMLElement) => Object.assign(el, { offsetHeight: h, offsetWidth: 200 });

	it('opens below the anchor when the list fits there', () => {
		const el = open(20, sized(300));
		expect(Number.parseInt(el.style.getPropertyValue('--dynasty-pop-y'), 10)).toBe(54);
	});

	it('opens above the anchor when there is no room below, and ends at the anchor', () => {
		const el = open(700, sized(300));
		expect(Number.parseInt(el.style.getPropertyValue('--dynasty-pop-y'), 10)).toBe(700 - 4 - 300);
	});

	it('ends at the right edge of the anchor with align end (the problem list at the right of the bar)', () => {
		const el = open(20, sized(100), 'end');
		expect(Number.parseInt(el.style.getPropertyValue('--dynasty-pop-x'), 10)).toBe(930 - 200);
	});

	it('caps the height to the room of the side it takes, so the list scrolls inside', () => {
		const el = open(390, sized(900));
		const room = Number.parseInt(el.style.getPropertyValue('--dynasty-pop-room'), 10);
		expect(room).toBeGreaterThan(0);
		expect(room).toBeLessThan(900);
	});

	it('uses the screen, not the whole host: a host taller than the window opens upward near the bottom of the window', () => {
		device.height = 600;
		const host = new FEl('div');
		host.clientWidth = 1000;
		host.clientHeight = 3000;
		const pop = new Popover(host as unknown as HTMLElement);
		const el = pop.open('more', sized(300), null, { left: 10, top: 560, right: 40, bottom: 590, width: 30, height: 30, x: 10, y: 560, toJSON: () => ({}) } as DOMRect, { align: 'start' }) as unknown as FEl;
		expect(Number.parseInt(el.style.getPropertyValue('--dynasty-pop-y'), 10)).toBe(560 - 4 - 300);
	});
});

describe('a bar at the foot of the window (K-06)', () => {
	const band = { top: 0, bottom: 800 };

	it('a tree box that starts at y 741 of 800: neither side has room, so the note scrolls the bar to the top and the list opens below it with all rows', () => {
		const at = { host: { top: 741, bottom: 1241 }, anchor: { top: 741, bottom: 785 }, band, h: 300 };
		expect(planPlace(at).scroll).toBe(741 - 8);
		// After that scroll the box stands at y 8 and the list opens below the bar, whole.
		const after = planPlace({ host: { top: 8, bottom: 508 }, anchor: { top: 8, bottom: 52 }, band, h: 300, noScroll: true });
		expect(after).toMatchObject({ up: false, scroll: 0 });
		expect(after.room).toBeGreaterThanOrEqual(300);
	});

	it('a bar at y 741 in a host that reaches above it opens the list above the bar, with its rows in sight', () => {
		const plan = planPlace({ host: { top: 100, bottom: 1300 }, anchor: { top: 741, bottom: 771 }, band, h: 300 });
		expect(plan).toMatchObject({ up: true, scroll: 0 });
		expect(plan.room).toBeGreaterThanOrEqual(300);
	});

	it('is never cut to a strip: when the scroll cannot help, the room of the host alone is used', () => {
		const plan = planPlace({ host: { top: 741, bottom: 1241 }, anchor: { top: 741, bottom: 785 }, band, h: 300, noScroll: true });
		expect(plan.room).toBeGreaterThan(300);
		expect(plan.scroll).toBe(0);
	});

	it('a host that is wholly in sight keeps the old rule: the side with the room, and a cap by the room of that side', () => {
		expect(planPlace({ host: { top: 0, bottom: 800 }, anchor: { top: 700, bottom: 730 }, band, h: 300 })).toMatchObject({ up: true, scroll: 0 });
		const tall = planPlace({ host: { top: 0, bottom: 800 }, anchor: { top: 390, bottom: 420 }, band, h: 900 });
		expect(tall.room).toBeLessThan(900);
		expect(tall.scroll).toBe(0);
	});

	it('the Popover scrolls the area around the host once, then opens below the bar', () => {
		device.height = 800;
		const scroller = new FEl('div');
		scroller.clientHeight = 800;
		scroller.scrollHeight = 2400;
		const host = scroller.createDiv();
		host.clientWidth = 400;
		host.clientHeight = 500;
		const rect = (top: number, h: number) => ({ left: 0, right: 400, top, bottom: top + h, width: 400, height: h, x: 0, y: top, toJSON: () => ({}) });
		vi.spyOn(FEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FEl) {
			return this === host ? rect(741 - scroller.scrollTop, 500) : rect(0, 800);
		});
		const before = globalThis.getComputedStyle;
		globalThis.getComputedStyle = ((e: FEl) => ({ overflowY: e === scroller ? 'auto' : 'visible' })) as unknown as typeof getComputedStyle;
		try {
			const pop = new Popover(host as unknown as HTMLElement);
			const anchor = { left: 300, top: 741, right: 340, bottom: 785, width: 40, height: 44, x: 300, y: 741, toJSON: () => ({}) } as DOMRect;
			const el = pop.open('problems', (e) => Object.assign(e, { offsetHeight: 300, offsetWidth: 200 }), null, anchor, { align: 'end' }) as unknown as FEl;
			expect(scroller.scrollTop).toBe(733);
			expect(el.style.getPropertyValue('--dynasty-pop-room')).toBe('');
			// The bar is at the top of the box now: the list opens right under it.
			expect(Number.parseInt(el.style.getPropertyValue('--dynasty-pop-y'), 10)).toBe(48);
		} finally {
			globalThis.getComputedStyle = before;
			vi.restoreAllMocks();
		}
	});
});

describe('a sheet keeps its plain rule (K-06)', () => {
	function openSheet(hostTop: number, hostHeight: number, inModal = false, more: Record<string, number> = {}) {
		device.height = 800;
		const outer = new FEl('div', inModal ? { cls: 'modal' } : undefined);
		const host = outer.createDiv();
		host.clientWidth = 390;
		host.clientHeight = hostHeight;
		vi.spyOn(FEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FEl) {
			const top = this === host ? hostTop : 0;
			const h = this === host ? hostHeight : 800;
			return { left: 0, right: 390, top, bottom: top + h, width: 390, height: h, x: 0, y: top, toJSON: () => ({}) };
		});
		const pop = new Popover(host as unknown as HTMLElement);
		const el = pop.open('problems', (e) => Object.assign(e, { offsetHeight: 300, offsetWidth: 390, ...more }), null, undefined, { sheet: true }) as unknown as FEl;
		return { el, host };
	}

	it('a sheet is placed by the styles alone: the code sets no place, no cap and no floating class, in a host taller than the screen or not', () => {
		for (const [top, height] of [
			[-500, 3000],
			[172, 293],
			[0, 800],
		]) {
			const { el } = openSheet(top, height);
			expect(el.hasClass('is-floating'), `${top} ${height}`).toBe(false);
			expect(el.style.getPropertyValue('--dynasty-pop-y'), `${top} ${height}`).toBe('');
			expect(el.style.getPropertyValue('--dynasty-pop-room'), `${top} ${height}`).toBe('');
		}
		vi.restoreAllMocks();
	});

	it('a sheet with more content below its foot has the fade (has-more), also in a modal window; the end of the content has none', () => {
		const tall = { scrollHeight: 600, clientHeight: 300, scrollTop: 0 };
		expect(openSheet(172, 293, false, tall).el.hasClass('has-more')).toBe(true);
		expect(openSheet(0, 800, true, tall).el.hasClass('has-more')).toBe(true);
		expect(openSheet(0, 800, true, { ...tall, scrollTop: 300 }).el.hasClass('has-more')).toBe(false);
		expect(openSheet(0, 800, true, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 }).el.hasClass('has-more')).toBe(false);
		vi.restoreAllMocks();
	});

	it('the sheet has its cover and its grip, and the panel has neither', () => {
		const { el, host } = openSheet(0, 800, true);
		expect(host.children.some((c) => c.classes.has('dynasty-cover'))).toBe(true);
		expect(el.querySelector('.dynasty-sheet-grip')).not.toBeNull();
		const other = new FEl('div');
		const panel = new Popover(other as unknown as HTMLElement).open('problems', (e) => Object.assign(e, { offsetHeight: 300, offsetWidth: 390 }), null, undefined, { panel: { anchor: () => ({ bottom: 48 }) as DOMRect } }) as unknown as FEl;
		expect(panel.hasClass('is-panel')).toBe(true);
		expect(panel.querySelector('.dynasty-sheet-grip')).toBeNull();
		expect(other.children.some((c) => c.classes.has('dynasty-cover'))).toBe(false);
		vi.restoreAllMocks();
	});
});

describe('the Fit icon (CH-14, K-05)', () => {
	// An Obsidian that draws the new name with the paths of the old one (the fault of K-05), and one that draws it as itself.
	const aliased = (name: string) => (name === 'lucide-fullscreen' || name === 'maximize' ? 'svg-icon lucide-maximize' : `svg-icon lucide-${name}`);
	const own = (name: string) => `svg-icon ${name.startsWith('lucide-') ? name : `lucide-${name}`}`;

	it('is `lucide-fullscreen` where this Obsidian has the icon and draws it differently from Expand', () => {
		expect(fitIcon(['lucide-fullscreen', 'lucide-minimize'], own)).toBe('lucide-fullscreen');
	});

	it('falls back to `minimize` when the icon is missing or is drawn as Expand', () => {
		expect(fitIcon(['lucide-minimize'], own)).toBe('minimize');
		expect(fitIcon([], own)).toBe('minimize');
		expect(fitIcon(['lucide-fullscreen', 'lucide-minimize'], aliased)).toBe('minimize');
	});

	it('Fit and Expand never draw the same SVG class', () => {
		for (const look of [own, aliased]) expect(look(fitIcon(['lucide-fullscreen'], look))).not.toBe(look('maximize'));
	});
});

describe('the style rules of the bars (CH-04, CH-05, CH-11)', () => {
	const css = readFileSync('styles/08-toolbar.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	it('rows of a list are 30 px high with a mouse and keep 44 px for a finger', () => {
		expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.dynasty-popover \.dynasty-popover-item,\s*\.dynasty-popover \.dynasty-problem-button\s*\{\s*min-height:\s*30px/);
		expect(css).toMatch(/\.dynasty-popover \.dynasty-popover-item,\s*\.dynasty-popover \.dynasty-problem-button\s*\{[^}]*min-height:\s*44px/);
	});

	it('the last button of a bar ends 8 px inside the line, with a mouse only', () => {
		expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.dynasty-toolbar > \.dynasty-tool:last-child\s*\{\s*margin-right:/);
	});

	it('the bar has its name from a hidden text (aria-labelledby), so no tooltip shows between two buttons (CH-11)', () => {
		const bar = toolbarIn(new FEl('div') as unknown as HTMLElement).bar as unknown as FEl;
		expect(bar.getAttribute('aria-label')).toBeNull();
		const id = bar.getAttribute('aria-labelledby')!;
		const name = bar.querySelector('.dynasty-sr-only')!;
		expect(name.getAttribute('id')).toBe(id);
		expect(name.getText()).toBe(TOOLBAR_UI.region);
		// Two bars have two names.
		expect(toolbarIn(new FEl('div') as unknown as HTMLElement).bar.getAttribute('aria-labelledby')).not.toBe(id);
		expect(css).not.toContain('--no-tooltip');
	});

	it('the phone set of buttons keeps its last button in place with a mouse', () => {
		expect(css).toMatch(/\.modal\.dynasty-fullscreen\.is-phone \.dynasty-toolbar > \.dynasty-tool:last-child,\s*\.modal\.dynasty-fullscreen\.is-phone-side \.dynasty-toolbar > \.dynasty-tool:last-child\s*\{\s*margin-right:\s*0/);
	});

	it('the lit Focus button is drawn on its chip (::before), not as the whole 44 px box', () => {
		expect(css).toMatch(/\.dynasty-toolbar \.dynasty-focus\.is-active,\s*\.dynasty-toolbar \.dynasty-focus\.is-active:hover\s*\{\s*background-color:\s*transparent;\s*box-shadow:\s*none/);
		expect(css).toMatch(/\.dynasty-toolbar \.dynasty-focus\.is-active::before,\s*\.dynasty-toolbar \.dynasty-focus\.is-active:hover::before\s*\{[^}]*border:\s*var\(--dynasty-width-hairline\) solid var\(--interactive-accent\)/);
	});

	it('the problem list has one left edge: no margin on a row, none before "Open"', () => {
		expect(css).toMatch(/\.dynasty-popover \.dynasty-problems-list > li\.dynasty-problem\s*\{\s*margin:\s*0 0 var\(--dynasty-space-1\) 0/);
		expect(css).toMatch(/\.dynasty-popover \.dynasty-problem-open\s*\{[^}]*margin-left:\s*0/);
	});

	it('the legend sheet and the problem sheet stand 16 px in, the title on the same edge, and Close is 44 px wide', () => {
		expect(css).toMatch(/\.dynasty-popover-legend\.is-sheet,\s*\.dynasty-popover-problems\.is-sheet\s*\{\s*padding-left:\s*max\(var\(--dynasty-space-4\)/);
		expect(css).toMatch(/\.dynasty-sheet-head\s*\{[^}]*padding:\s*0 0 var\(--dynasty-space-1\) 0/);
		expect(css).toMatch(/\.dynasty-sheet-head \.dynasty-sheet-close\s*\{\s*min-width:\s*44px/);
	});

	it('the small problem pop-up of a note hangs under the bar: its place comes from the code, it is at most 280 px wide, ends at the right edge of the list, has no cap and no fade', () => {
		const rule = css.match(/\.dynasty-popover\.is-panel \{[^}]*\}/)![0];
		expect(rule).toMatch(/top:\s*var\(--dynasty-pop-y\)/);
		expect(rule).toMatch(/right:\s*0/);
		expect(rule).toMatch(/width:\s*min\(280px, 100%\)/);
		expect(rule).toMatch(/max-height:\s*none/);
		expect(rule).toMatch(/padding:\s*var\(--dynasty-space-3\)/);
		expect(rule).toMatch(/gap:\s*var\(--dynasty-space-3\)/);
		expect(css).not.toContain('is-floating');
		expect(css).not.toContain('is-panel.has-more');
		// A short box of Live Preview cuts at its edge: the box is as tall as the pop-up needs while it is open.
		expect(readFileSync('styles/31-phone-list.css', 'utf8')).toMatch(/\.dynasty-viewport\.dynasty-list-viewport\.has-pop-panel\s*\{\s*min-height:\s*var\(--dynasty-pop-need, 0\)/);
	});

	it('the legend keeps a cap only as a guard: at most the room of the box, and no cap of its own in a normal note box', () => {
		expect(css).toMatch(/\.dynasty-popover\.dynasty-popover-legend:not\(\.is-sheet\)\s*\{[^}]*max-height:\s*min\(calc\(100% - 52px\), var\(--dynasty-pop-room, 100%\)\)/);
		// The compact form of the legend in a box of 500 px: 14 rows of 22 px, two headings, the title and the padding (about 409 px) fit in the 448 px that the cap leaves.
		const tight = 14 * 22 + 2 * 20 + 21 + 26.5 + 14;
		expect(tight).toBeLessThanOrEqual(500 - 52);
	});

	it('the legend is 360 px wide on a computer, so no label wraps and it does not scroll at a 16 px font in a 500 px note box', () => {
		expect(css).toMatch(/\.dynasty-popover\.dynasty-popover-legend:not\(\.is-sheet\)\s*\{[^}]*width:\s*min\(360px, 100% - 8px\)/);
		// Measured in Chrome with the built CSS at 16 px: 475 px of content at 320 px wide, with two labels on two lines. At 360 px they take one line each, 17 px less each.
		const at320 = 475;
		const wrapped = 2 * 17;
		expect(at320 - wrapped).toBeLessThanOrEqual(500 - 52);
		expect(readFileSync('styles/08-toolbar.css', 'utf8')).not.toContain('about 409 px');
	});
});
