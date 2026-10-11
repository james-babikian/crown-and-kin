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

	it('on a phone, when the ruler and the 1st heir do not fit at the minimum scale, the view starts at the whole ruler at the readable zoom (G5 fix)', () => {
		const r = card(0, 0);
		const heirs = [card(323, 200)];
		const box = around([r, ...heirs]);
		// This box fits at 0.72: names of 11.5 px, so the finder fits it, but the phone minimum is 0.75.
		const fit = successionFirstView(box, size, 16, 60, r, heirs, 'down', 0);
		expect(fit.scale).toBeLessThan(PHONE_MIN_SCALE);
		expect(inside(heirs[0], shown(fit, size, 60))).toBe(true);
		const v = successionFirstView(box, size, 16, 60, r, heirs, 'down', PHONE_MIN_SCALE);
		expect(v.scale).toBeCloseTo(14 / 16);
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

	it('the ruler and the 1st heir do not fit together: the view starts at the whole ruler at readable names (G5 fix, spec §13.21 rule 35)', () => {
		const r = card(0, 0);
		const heirs = [card(3000, 200), card(3300, 200)];
		const box = around([r, ...heirs]);
		const computer = successionFirstView(box, size, 16, 60, r, heirs, 'down', 0);
		expect(computer.scale).toBeCloseTo(14 / 16);
		expect(inside(r, shown(computer, size, 60))).toBe(true);
		const phone = successionFirstView(box, size, 16, 60, r, heirs, 'down', PHONE_MIN_SCALE);
		// 14 px names (0.875) are above the minimum, so the fallback keeps them.
		expect(phone.scale).toBeGreaterThanOrEqual(PHONE_MIN_SCALE);
		expect(inside(r, shown(phone, size, 60))).toBe(true);
		// The G5 case: a ruler far to the left of the 1st heir must not leave the screen on a 390 px phone.
		const far = successionFirstView(around([r, card(480, 200)]), { w: 390, h: 844 }, 16, 60, r, [card(480, 200)], 'down', PHONE_MIN_SCALE);
		expect(inside(r, shown(far, { w: 390, h: 844 }, 60))).toBe(true);
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
	it('0.2.8 (G.13, I37 B): the Show bar is the banner of the finder, the sentence and Close in one row; the phone list has its own bar', () => {
		const bar = rule('.dynasty-result');
		expect(bar).toContain('display: flex');
		expect(bar).toContain('align-items: center');
		expect(rule('.dynasty-result-text')).toContain('min-width: 0');
		expect(rule('.dynasty-result-buttons')).toContain('margin: 0');
		// The bar of the phone list is in the flow of the list and has no result class.
		expect(rule('.dynasty-list-succession')).toContain('display: flex');
	});

	it('the marked row and the large row of the list have a 2 px transparent border (no frame, D209) that leaves the content where the other rows have it (D184, 0.2.8)', () => {
		const frame = rule('.dynasty-list-hero');
		expect(frame).toContain('border: 2px solid transparent');
		// The rows stand 8 px inside the block (the section's padding); the frame reaches the block's edge and keeps 6 px of its own padding (8 px = 2 px border + 6 px).
		expect(frame).toContain('margin: 4px -8px');
		expect(rule('.dynasty-list-me')).toContain('padding: 8px 6px');
		expect(frame).not.toContain('padding');
		// The large row is taller than the others: its padding is in the last rule of the class.
		const last = css.lastIndexOf('\n.dynasty-list-hero {');
		expect(css.slice(last, css.indexOf('}', last))).toContain('padding: 12px 6px');
		expect(rule('.dynasty-list-me')).toContain('border: 2px solid transparent');
	});

	it('the heir outline is the still look (0.2.8, D212: one accent border 2 px wide, no second ring), lighter than the highlight, and never the pulse', () => {
		expect(css).not.toContain('dynasty-heir-ring');
		const bg = rule('.dynasty-card.dynasty-heir .dynasty-card-bg');
		expect(bg).toContain('var(--interactive-accent)');
		expect(bg).toContain('stroke-width: 2;');
		expect(bg).toContain('non-scaling-stroke');
		expect(bg).not.toContain('animation');
		// The marked heir keeps the border of the marked card in the text colour.
		expect(rule('.dynasty-card.dynasty-heir.dynasty-card-me .dynasty-card-bg')).toContain('var(--text-normal)');
	});

	it('the ordinal tab: 0.8 em bold upright text, a 1 px border in the text colour, the card colour inside (0.2.8: no house tint)', () => {
		const text = rule('.dynasty-r1-tab-text,\n.dynasty-ordinal-tab-text');
		expect(text).toContain('* 0.8)');
		expect(text).toContain('font-style: normal');
		expect(text).toContain('font-weight: var(--font-semibold)');
		expect(text).toContain('fill: var(--text-normal)');
		const tab = rule('.dynasty-r1-tab,\n.dynasty-ordinal-tab');
		expect(tab).toContain('stroke: var(--text-normal)');
		expect(tab).toContain('stroke-width: 1');
		expect(tab).toContain('fill: var(--background-primary-alt)');
		expect(tab).not.toContain('var(--dynasty-house-color');
		expect(rule('.dynasty-r1-tab-base,\n.dynasty-ordinal-tab-base')).toContain('var(--background-primary-alt)');
		expect(css).toMatch(/\.dynasty-lod-compact \.dynasty-card-r1 \.dynasty-card-full > \.dynasty-ordinal-tab-group[^{]*\{\s*display: none/);
	});

	it('the tab and the outline carry no colour value', () => {
		// The @supports block of the opaque bar (0.2.8) holds a relative colour of a theme role; it is no colour value of the heir.
		const block = css.slice(css.indexOf('Version 0.2.7: the Show view')).replace(/@supports[^{]*\{[^{}]*\{[^{}]*\}\s*\}/g, '');
		expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
	});

	it('the Close of the list bar has a target of 44 x 44 px', () => {
		const close = rule('.dynasty-list-succession .dynasty-succession-close');
		expect(close).toContain('width: 44px');
		expect(close).toContain('height: 44px');
	});

	it('the checkbox pair of the edit sheet keeps its row at 44 px on a phone (a mouse needs 30 px)', () => {
		expect(rule('.dynasty-sheet.is-phone .dynasty-check')).toContain('min-height: 44px');
	});
});
