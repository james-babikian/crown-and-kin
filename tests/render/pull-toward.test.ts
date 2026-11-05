import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTRAST_TOKENS, contrastChoices, contrastRatio, mixRgb, pullToward } from '../../src/render/dom/theme-read';
import { resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { loadPlugin } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.8 (D212 contrast-tokens, package C2): the grey, link, edge and error colours are computed at run time. Each is pulled toward the text colour in 5 % steps
 * until text reaches 4.5:1 and a line 3:1 on the page, card and window surfaces; a colour that is strong enough stays as the style sheet has it.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const hex = (css: string): number[] | null => {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css.trim());
	return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};
const rgbOf = (css: string): number[] => (/^rgb\((\d+), (\d+), (\d+)\)$/.exec(css) ?? []).slice(1).map(Number);

describe('pullToward', () => {
	const white = [255, 255, 255];
	const black = [0, 0, 0];

	it('keeps a colour that is strong enough', () => {
		expect(pullToward([60, 60, 60], black, [white], 4.5)).toEqual([60, 60, 60]);
	});

	it('moves a faint grey toward the text colour in the fewest 5 % steps that reach the contrast', () => {
		const faint = [160, 160, 160];
		expect(contrastRatio(faint, white)).toBeLessThan(4.5);
		const pick = pullToward(faint, black, [white], 4.5);
		expect(contrastRatio(pick, white)).toBeGreaterThanOrEqual(4.5);
		// One step back is not enough.
		const steps = Math.round((faint[0] - pick[0]) / (faint[0] / 20));
		const back = mixRgb(faint, black, (steps - 1) / 20);
		expect(contrastRatio(back, white)).toBeLessThan(4.5);
	});

	it('reaches the contrast on every surface, not only the first', () => {
		const surfaces = [white, [235, 235, 235], [210, 210, 215]];
		const pick = pullToward([150, 150, 150], black, surfaces, 4.5);
		for (const s of surfaces) expect(contrastRatio(pick, s)).toBeGreaterThanOrEqual(4.5);
	});

	it('takes the text colour when no step reaches the contrast', () => {
		expect(pullToward([150, 150, 150], [120, 120, 120], [[130, 130, 130]], 4.5)).toEqual([120, 120, 120]);
	});

	it('works in a dark theme (toward a light text colour)', () => {
		const pick = pullToward([90, 90, 90], [230, 230, 230], [[30, 30, 30]], 4.5);
		expect(contrastRatio(pick, [30, 30, 30])).toBeGreaterThanOrEqual(4.5);
	});
});

describe('contrastChoices', () => {
	const page = {
		'--text-normal': '#222222',
		'--background-primary': '#ffffff',
		'--background-primary-alt': '#f3f3f3',
		'--background-secondary': '#eeeeee',
		'--modal-background': '#ffffff',
		'--interactive-normal': '#f2f3f5',
		'--interactive-hover': '#e9e9e9',
		'--dynasty-muted': '#8a8a8a',
		'--text-muted': '#8a8a8a',
		'--dynasty-link': '#6d7ee0',
		'--text-accent': '#6d7ee0',
		'--dynasty-edge': '#b0b0b0',
		'--dynasty-error': '#cc3333',
		'--text-error': '#cc3333',
	};
	const read = (vars: Record<string, string>) => (name: string) => vars[name] ?? '';

	it('lists the four tokens', () => {
		expect(CONTRAST_TOKENS.map((t) => t.token)).toEqual(['--dynasty-muted', '--dynasty-link', '--dynasty-edge', '--dynasty-error']);
	});

	it('gives a new value for a faint token and null for a strong one, and the new value reaches the target on every surface', () => {
		const picks = contrastChoices(read(page), hex);
		for (const t of CONTRAST_TOKENS) {
			const surfaces = t.on.map((s) => hex(page[s as keyof typeof page])!);
			const base = hex(page[t.token as keyof typeof page])!;
			const own = Math.min(...surfaces.map((s) => contrastRatio(base, s)));
			const value = picks[t.token];
			if (own >= t.min) expect(value, t.token).toBeNull();
			else {
				expect(value, t.token).not.toBeNull();
				for (const s of surfaces) expect(contrastRatio(rgbOf(value!), s), t.token).toBeGreaterThanOrEqual(t.min);
			}
		}
		// This page has a faint grey and a faint link.
		expect(picks['--dynasty-muted']).not.toBeNull();
		expect(picks['--dynasty-link']).not.toBeNull();
	});

	it('a line needs 3:1, text 4.5:1', () => {
		const picks = contrastChoices(read({ ...page, '--dynasty-edge': '#cfcfcf' }), hex);
		expect(contrastRatio(rgbOf(picks['--dynasty-edge']!), [255, 255, 255])).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(rgbOf(picks['--dynasty-edge']!), [255, 255, 255])).toBeLessThan(4.5);
	});

	it('starts from the plain theme role when the static token cannot be read', () => {
		const picks = contrastChoices(read({ ...page, '--dynasty-muted': 'color-mix(weird)' }), hex);
		expect(picks['--dynasty-muted']).not.toBeNull();
	});

	it('leaves every token static when the text colour or the surfaces cannot be read', () => {
		expect(Object.values(contrastChoices(read({ ...page, '--text-normal': 'weird' }), hex))).toEqual([null, null, null, null]);
		const none = contrastChoices(read({ '--text-normal': '#222222', '--text-muted': '#8a8a8a' }), hex);
		expect(none['--dynasty-muted']).toBeNull();
	});
});

describe('the plugin writes the tokens on the page and takes them off on unload', () => {
	it('removes all four custom properties when the plugin unloads', async () => {
		const body = (globalThis as unknown as { document: { body: { style: { setProperty(k: string, v: string): void; removeProperty(k: string): void } } } }).document.body;
		const { plugin } = await loadPlugin();
		for (const t of CONTRAST_TOKENS) body.style.setProperty(t.token, 'rgb(1, 2, 3)');
		const remove = vi.spyOn(body.style, 'removeProperty');
		(plugin as unknown as { unload(): void }).unload();
		for (const t of CONTRAST_TOKENS) expect(remove).toHaveBeenCalledWith(t.token);
	});
});
