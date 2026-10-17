import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Review of 0.3.1 fix3 point 3 (code-reviewer). The D28 hint ("↓ 12 more children") of the harness case `wp64-hint.md`
 * (an internal harness script, HINT: Paul with 14 children) in the full-screen view of an upright phone. The fakes give the
 * hint slot the box that the plugin's CSS gives it (right 8 px, 28 px high, top from --dynasty-hint-top, bottom from
 * --dynasty-hint-bottom, about 6.6 px for each letter and 2 x 8 px padding).
 */

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Rect } from '../src/layout/model';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, runTimers } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fullViews } from './acceptance/tree-view-fakes';
import { onScreen, openFull, upright, type Screen } from './r031-fix3-support';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	vi.restoreAllMocks();
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
});

const person = (id: string, name: string, extra: string[] = []) => [`  - id: ${id}`, `    name: ${name}`, ...extra.map((e) => `    ${e}`)].join('\n');
const HINT = [
	'options:',
	'  start: paul',
	'houses:',
	'  - id: ardent',
	'    name: House Ardent',
	'    color: "#8c2041"',
	'people:',
	person('paul', 'Paul Ardent', ['house: ardent']),
	person('quin', 'Quin Ardent', ['sex: f']),
	...Array.from({ length: 14 }, (_, i) => person(`k${i + 1}`, `Kid ${i + 1} Ardent`, ['house: ardent', 'parents: [paul, quin]'])),
	'unions:',
	'  - partners: [paul, quin]',
	'',
].join('\n');

/** Gives each hint slot the box that the CSS gives it. */
function cssBoxes(root: FEl, s: Screen): void {
	const vp = root.querySelector('.dynasty-viewport')!;
	for (const dir of ['up', 'down']) {
		const el = root.querySelector(`.dynasty-hint-slot[data-dir="${dir}"]`)!;
		const shown = () => el.hasClass('dynasty-hint');
		const w = () => (shown() ? Math.round(el.getText().length * 6.6 + 16) : 0);
		Object.defineProperty(el, 'offsetWidth', { get: w, configurable: true });
		Object.defineProperty(el, 'offsetHeight', { get: () => (shown() ? 28 : 0), configurable: true });
		Object.defineProperty(el, 'offsetLeft', { get: () => s.w - 8 - w(), configurable: true });
		Object.defineProperty(el, 'offsetTop', {
			get: () => (dir === 'up' ? parseFloat(el.style.getPropertyValue('--dynasty-hint-top')) || 4 : (vp.clientHeight || s.h) - (parseFloat(el.style.getPropertyValue('--dynasty-hint-bottom')) || 4) - 28),
			configurable: true,
		});
	}
}

describe('review fix3 point 3: the D28 hint of the harness case with 14 children', () => {
	// Passes on b336e236 (before fix3). Fails at 725b6455: the up hint stands on the children's column (Kid 7 just below the focus bar), so fix3 hides it.
	for (const font of [12, 16, 21, 28]) {
		for (const [w, h] of [[360, 780], [390, 844], [393, 852], [430, 932]] as const) {
			it(`upright ${w} x ${h}, note font ${font} px: the first view names the children outside the box (D28), as the harness check "treeview hint, full screen" wants`, async () => {
				const s = upright(font, w, h);
				const { view, root } = await openFull(HINT, s);
				cssBoxes(root, s);
				expect(view.laid.layout.orientation).toBe('sideways');
				// Count again at the same view, as a settle that the plugin starts does (not a drag).
				view.panZoom.setView({ ...view.panZoom.view! });
				flushFrames();
				runTimers(300);
				flushFrames();
				const kids = [...(view.laid.layout.persons as Map<string, Rect>)].filter(([id]) => /^k\d+$/.test(id)).map(([id, b]) => ({ id, o: onScreen(view, s, b) }));
				const above = kids.filter((k) => k.o.top < view.insetTop - 0.5).length;
				const below = kids.filter((k) => k.o.top >= view.insetTop - 0.5 && k.o.bottom > s.h - view.insetBottom + 0.5).length;
				const shown = (dir: string) => {
					const el = root.querySelector(`.dynasty-hint-slot[data-dir="${dir}"]`)!;
					return { shown: el.hasClass('dynasty-hint'), text: el.getText() };
				};
				expect({ up: shown('up'), down: shown('down') }).toEqual({
					up: above ? { shown: true, text: expect.stringMatching(/more child/) } : { shown: false, text: '' },
					down: below ? { shown: true, text: expect.stringMatching(/more child/) } : { shown: false, text: '' },
				});
			});
		}
	}
});
