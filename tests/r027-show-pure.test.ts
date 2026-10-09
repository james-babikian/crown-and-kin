import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { cardLabel } from '../src/render/tree-info';
import { SUCCESSION_UI as T } from '../src/render/ui-text';
import { PHONE_MIN_SCALE, cardPosition, lineWords, linePeople, successionDrawn, successionFirstView } from '../src/obsidian/succession-view';
import { build } from './helpers';
import { BODY_16 } from './r027-window-support';

/*
 * Version 0.2.7, WP4 view (contract F, M.9): the pure parts of the Show view (what it draws, the first view, the words of the list and the
 * card label) and the rules of styles.css for the outline, the tabs and the bar.
 */

const g = build(BODY_16).g;
const SET = { limit: 5, oldAge: 110, youngDeathAge: 0 };
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const rule = (sel: string): string => {
	const i = css.indexOf(`\n${sel} {`);
	expect(i, sel).toBeGreaterThanOrEqual(0);
	return css.slice(i, css.indexOf('}', i));
};

describe('successionDrawn', () => {
	it('gives the ruler, the heirs, the ordinals and the bar sentence', () => {
		const d = successionDrawn(g, 'duke-of-carrowmere', SET)!;
		expect(d.ruler).toBe('bertram-carrow');
		expect(d.heirs).toEqual(['fenwick-carrow', 'jasper-carrow', 'cedric-carrow', 'dunstan-carrow']);
		expect([...d.ordinals]).toEqual([
			['fenwick-carrow', '1st'],
			['jasper-carrow', '2nd'],
			['cedric-carrow', '3rd'],
			['dunstan-carrow', '4th'],
		]);
		expect(d.sentence).toBe('Line of succession: Duke of Carrowmere, now');
		expect(linePeople(d)).toEqual(['bertram-carrow', ...d.heirs]);
	});

	it('uses the year of the line in the sentence', () => {
		const d = successionDrawn(g, 'countess-of-harrowfen', SET)!;
		expect(d.result.year).toBe(1215);
		expect(d.sentence).toBe('Line of succession: Countess of Harrowfen, 1215');
		expect(d.heirs).toHaveLength(5);
	});

	it('is null for a title that is gone or has no line', () => {
		expect(successionDrawn(g, 'no-such-title', SET)).toBeNull();
	});

	it('the length of the line follows the setting', () => {
		expect(successionDrawn(g, 'duke-of-carrowmere', { ...SET, limit: 2 })!.heirs).toEqual(['fenwick-carrow', 'jasper-carrow']);
	});
});

describe('open branches in the Show view (M.9)', () => {
	const TREE = [
		'titles:',
		'  - id: crown',
		'    name: Crown',
		'    succession: eldest-child',
		'    holders:',
		'      - {person: rex, from: 1100}',
		'people:',
		'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
		'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
		'  - {id: lost, name: Lost Ardent, sex: m, born: 1103, died: 1112, parents: [rex]}',
		'',
	].join('\n');

	it('a branch gets "?" in the ordinals, is not an heir and joins the line people', () => {
		const d = successionDrawn(build(TREE).g, 'crown', SET)!;
		expect(d.heirs).toEqual(['kid']);
		expect(d.branches).toEqual(['lost']);
		expect(d.ordinals.get('lost')).toBe('?');
		expect(d.ordinals.get('kid')).toBe('1st');
		expect(linePeople(d)).toEqual(['rex', 'kid', 'lost']);
		expect(cardPosition(d, 'lost')).toBe('open branch');
		expect(cardPosition(d, 'kid')).toBe('1st in line');
		expect(cardPosition(d, 'rex')).toBeUndefined();
		expect([...lineWords(d)].map(([id, w]) => [id, w.text])).toEqual([
			['kid', '1st in line'],
			['lost', 'Open branch'],
		]);
	});

	it('the setting for young deaths removes a branch', () => {
		const d = successionDrawn(build(TREE).g, 'crown', { ...SET, youngDeathAge: 18 })!;
		expect(d.branches).toEqual([]);
	});
});

describe('the card label and the texts', () => {
	it('cardLabel adds the place last, after the relation', () => {
		const p = g.byId.get('jasper-carrow')!;
		expect(cardLabel(p)).not.toContain('in line');
		expect(cardLabel(p, 'son', undefined, '2nd in line')).toBe(`${cardLabel(p, 'son')}, 2nd in line`);
		expect(cardLabel(p, undefined, undefined, 'open branch').endsWith(', open branch')).toBe(true);
	});

	it('the texts', () => {
		expect(T.bar('Duke of Valmont', 1210)).toBe('Line of succession: Duke of Valmont, 1210');
		expect(T.bar('Duke of Valmont', null)).toBe('Line of succession: Duke of Valmont, now');
		expect(T.barNoHeir('Duke of Valmont', 1210)).toBe('Line of succession: Duke of Valmont, 1210. No heir in the tree.');
		expect(T.barClose).toBe('Close');
		expect(T.barCloseLabel).toBe('Close the line of succession');
		expect(T.inLine('2nd')).toBe('2nd in line');
		expect(T.openBranchWord).toBe('Open branch');
	});
});

describe('the first view (F.2)', () => {
	const bounds = { x: 0, y: 0, w: 4000, h: 900 };
	const ruler = { x: 100, y: 100, w: 170, h: 60 };
	const size = { w: 390, h: 700 };

	it('a tree that fits at readable names is fitted', () => {
		const small = { x: 0, y: 0, w: 380, h: 600 };
		const v = successionFirstView(small, size, 16, 60, ruler, [], 'down', PHONE_MIN_SCALE);
		expect(v.scale).toBeGreaterThanOrEqual(PHONE_MIN_SCALE);
	});

	it('on a phone the scale is never below 0.75 and the ruler is in the view', () => {
		for (const orientation of ['down', 'sideways'] as const) {
			const v = successionFirstView(bounds, size, 16, 60, ruler, [], orientation, PHONE_MIN_SCALE);
			expect(v.scale).toBeGreaterThanOrEqual(PHONE_MIN_SCALE - 1e-9);
			const left = v.cx - size.w / 2 / v.scale;
			const right = v.cx + size.w / 2 / v.scale;
			const top = v.cy - size.h / 2 / v.scale;
			expect(ruler.x).toBeGreaterThanOrEqual(left);
			expect(ruler.x + ruler.w).toBeLessThanOrEqual(right);
			expect(ruler.y).toBeGreaterThanOrEqual(top);
		}
	});

	it('without the minimum the plain rule of the finder holds (names of 14 px at least once the fit is too small)', () => {
		const v = successionFirstView(bounds, size, 16, 60, ruler, [], 'down', 0);
		expect(v.scale).toBeCloseTo(14 / 16);
	});

	// The area below the bar that a view shows, in layout px (the view is centred in the free area, `inArea`).
	const shown = (v: { scale: number; cx: number; cy: number }, area: { w: number; h: number }, inset: number) => ({
		left: v.cx - area.w / 2 / v.scale,
		right: v.cx + area.w / 2 / v.scale,
		top: v.cy - area.h / 2 / v.scale + inset / v.scale,
		bottom: v.cy + area.h / 2 / v.scale,
	});
	const inside = (r: { x: number; y: number; w: number; h: number }, a: ReturnType<typeof shown>) =>
		r.x >= a.left - 1e-6 && r.x + r.w <= a.right + 1e-6 && r.y >= a.top - 1e-6 && r.y + r.h <= a.bottom + 1e-6;
	const around = (boxes: { x: number; y: number; w: number; h: number }[]) => {
		const x0 = Math.min(...boxes.map((b) => b.x));
		const y0 = Math.min(...boxes.map((b) => b.y));
		const x1 = Math.max(...boxes.map((b) => b.x + b.w));
		const y1 = Math.max(...boxes.map((b) => b.y + b.h));
		return { x: x0 - 24, y: y0 - 24, w: x1 - x0 + 48, h: y1 - y0 + 48 };
	};
	const card = (x: number, y: number) => ({ x, y, w: 170, h: 60 });

	it('on a computer the first view fits the ruler and every heir', () => {
		const big = { w: 1400, h: 900 };
		const r = card(600, 40);
		const heirs = [card(100, 200), card(400, 200), card(700, 200), card(1000, 200)];
		const v = successionFirstView(around([r, ...heirs]), big, 16, 60, r, heirs, 'down', 0);
		const a = shown(v, big, 60);
		for (const c of [r, ...heirs]) expect(inside(c, a)).toBe(true);
	});

	it('an open branch far away does not shrink the first view (the caller leaves it out of the box)', () => {
		const big = { w: 1400, h: 900 };
		const r = card(600, 40);
		const heirs = [card(500, 200), card(700, 200)];
		const v = successionFirstView(around([r, ...heirs]), big, 16, 60, r, heirs, 'down', 0);
		const far = successionFirstView(around([r, ...heirs, card(5000, 200)]), big, 16, 60, r, heirs, 'down', 0);
		expect(v.scale).toBeGreaterThanOrEqual(far.scale);
		// Without the far card in the box the whole line fits at its largest scale.
		expect(inside(card(700, 200), shown(v, big, 60))).toBe(true);
	});

	it('on a phone, when the fit is below the minimum scale, the view starts at the ruler at that scale', () => {
		const r = card(0, 0);
		const heirs = [card(323, 200)];
		const box = around([r, ...heirs]);
		// This box fits at 0.72: names of 11.5 px, so the finder fits it, but the phone minimum is 0.75.
		const fit = successionFirstView(box, size, 16, 60, r, heirs, 'down', 0);
		expect(fit.scale).toBeLessThan(PHONE_MIN_SCALE);
		expect(inside(heirs[0], shown(fit, size, 60))).toBe(true);
		const v = successionFirstView(box, size, 16, 60, r, heirs, 'down', PHONE_MIN_SCALE);
		expect(v.scale).toBeCloseTo(PHONE_MIN_SCALE);
		expect(inside(r, shown(v, size, 60))).toBe(true);
	});

	it('the whole line fits at readable names: every card is in the view', () => {
		const big = { w: 1400, h: 900 };
		const r = card(600, 40);
		const heirs = [card(100, 200), card(400, 200), card(1000, 200)];
		const v = successionFirstView(around([r, ...heirs]), big, 16, 60, r, heirs, 'down', 0);
		expect(v.scale * 16).toBeGreaterThanOrEqual(11);
		for (const c of [r, ...heirs]) expect(inside(c, shown(v, big, 60))).toBe(true);
	});

	it('the whole line is too wide: the ruler and the longest run of heirs that fits are in the view', () => {
		const big = { w: 1400, h: 900 };
		const r = card(600, 40);
		const heirs = [card(100, 200), card(400, 200), card(2000, 200), card(2300, 200)];
		const v = successionFirstView(around([r, ...heirs]), big, 16, 60, r, heirs, 'down', 0);
		const a = shown(v, big, 60);
		expect(v.scale * 16).toBeGreaterThanOrEqual(11);
		for (const c of [r, heirs[0], heirs[1]]) expect(inside(c, a)).toBe(true);
		expect(inside(heirs[2], a)).toBe(false);
		// The 3rd heir would need names of 10.3 px: the run stops before it.
		expect(v.scale).toBeGreaterThan(14 / 16);
	});

	it('the ruler and the 1st heir do not fit together: both start at the ruler at readable names', () => {
		const r = card(0, 0);
		const heirs = [card(3000, 200), card(3300, 200)];
		const box = around([r, ...heirs]);
		const computer = successionFirstView(box, size, 16, 60, r, heirs, 'down', 0);
		expect(computer.scale).toBeCloseTo(14 / 16);
		expect(inside(r, shown(computer, size, 60))).toBe(true);
		expect(inside(heirs[0], shown(computer, size, 60))).toBe(false);
		const phone = successionFirstView(box, size, 16, 60, r, heirs, 'down', PHONE_MIN_SCALE);
		// 14 px names (0.875) are above the minimum, so the fallback keeps them.
		expect(phone.scale).toBeGreaterThanOrEqual(PHONE_MIN_SCALE);
		expect(inside(r, shown(phone, size, 60))).toBe(true);
	});

	it('the phone run respects the minimum scale', () => {
		const r = card(0, 0);
		const heirs = [card(100, 150), card(323, 300), card(2000, 300)];
		const box = around([r, ...heirs]);
		// The ruler and 2 heirs fit at 0.72 (names of 11.5 px): good for a computer, under the phone minimum.
		const computer = successionFirstView(box, size, 16, 60, r, heirs, 'down', 0);
		expect(computer.scale).toBeLessThan(PHONE_MIN_SCALE);
		for (const c of [r, heirs[0], heirs[1]]) expect(inside(c, shown(computer, size, 60))).toBe(true);
		const phone = successionFirstView(box, size, 16, 60, r, heirs, 'down', PHONE_MIN_SCALE);
		expect(phone.scale).toBeGreaterThanOrEqual(PHONE_MIN_SCALE - 1e-9);
		expect(inside(r, shown(phone, size, 60))).toBe(true);
		expect(inside(heirs[0], shown(phone, size, 60))).toBe(true);
		expect(inside(heirs[1], shown(phone, size, 60))).toBe(false);
	});

	it('a line with no heir fits the ruler alone', () => {
		const big = { w: 1400, h: 900 };
		const r = card(600, 40);
		const v = successionFirstView(around([r]), big, 16, 60, r, [], 'down', 0);
		expect(inside(r, shown(v, big, 60))).toBe(true);
		const phone = successionFirstView(around([r]), size, 16, 60, r, [], 'down', PHONE_MIN_SCALE);
		expect(inside(r, shown(phone, size, 60))).toBe(true);
		expect(phone.scale).toBeGreaterThanOrEqual(PHONE_MIN_SCALE - 1e-9);
	});
});

describe('styles.css', () => {
	it('D192: on a computer the Show bar is one row; the phone bar and the finder bar are left alone', () => {
		const sel = '.dynasty-result.dynasty-succession-bar:not(.modal.dynasty-fullscreen.is-phone *)';
		const bar = rule(sel);
		expect(bar).toContain('display: flex');
		expect(bar).toContain('align-items: center');
		expect(rule(`${sel} .dynasty-succession-text`)).toContain('min-width: 0');
		expect(rule(`${sel} .dynasty-result-buttons`)).toContain('margin: 0');
		// Every D192 rule needs both classes, so the finder bar (no succession class) and the phone list bar (no result class) never match.
		expect(css).not.toMatch(/^\.dynasty-succession-bar[^{]*\{[^}]*display: flex/m);
	});

	it('the "You" row of the editable list is worked from the icon size, not from 18 px (D184)', () => {
		const whole = rule('.dynasty-list button.dynasty-list-edit.dynasty-list-whole');
		expect(whole).toContain('padding-right: calc(20.5px - var(--icon-size, var(--icon-m, 18px)) / 2)');
		expect(rule('.dynasty-list button.dynasty-list-edit.dynasty-list-whole .dynasty-list-edit-icon')).toContain('margin-left: calc(10.5px + 0.5em - var(--icon-size, var(--icon-m, 18px)) / 2)');
	});

	it('the heir outline is the still look, lighter than the highlight, and never the pulse', () => {
		const ring = rule('.dynasty-card.dynasty-heir .dynasty-card-ring');
		expect(ring).toContain('stroke-width: 6');
		expect(ring).not.toContain('animation');
		const bg = rule('.dynasty-card.dynasty-heir .dynasty-card-bg');
		expect(bg).toContain('var(--interactive-accent)');
		expect(bg).toContain('stroke-width: 3');
		// The marked heir keeps its 3 px border in the text colour.
		expect(rule('.dynasty-card.dynasty-heir.dynasty-card-me .dynasty-card-bg')).toContain('var(--text-normal)');
	});

	it('the ordinal tab: 0.85 em bold upright text, a 1 px border in the text colour, the plate background', () => {
		const text = rule('.dynasty-ordinal-tab-text');
		expect(text).toContain('* 0.85');
		expect(text).toContain('font-style: normal');
		expect(text).toContain('font-weight: var(--bold-weight, 700)');
		expect(text).toContain('fill: var(--text-normal)');
		const tab = rule('.dynasty-ordinal-tab');
		expect(tab).toContain('stroke: var(--text-normal)');
		expect(tab).toContain('stroke-width: 1');
		expect(tab).toContain('var(--dynasty-house-color');
		expect(tab).toContain('fill-opacity: 0.17');
		expect(rule('.theme-dark .dynasty-ordinal-tab')).toContain('fill-opacity: 0.26');
		expect(rule('.dynasty-ordinal-tab-base')).toContain('var(--background-primary-alt)');
		expect(css).toMatch(/\.dynasty-lod-compact \.dynasty-card-r1 \.dynasty-card-full > \.dynasty-ordinal-tab-group[^{]*\{\s*display: none/);
	});

	it('the tab and the outline carry no colour value', () => {
		const block = css.slice(css.indexOf('Version 0.2.7: the Show view'));
		expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
	});

	it('the Close of the list bar has a target of 44 x 44 px', () => {
		const close = rule('.dynasty-list-succession .dynasty-succession-close');
		expect(close).toContain('width: 44px');
		expect(close).toContain('height: 44px');
	});

	it('the checkbox pair of the edit sheet keeps its row at 44 px', () => {
		expect(rule('.dynasty-sheet-check')).toContain('min-height: 44px');
	});
});
