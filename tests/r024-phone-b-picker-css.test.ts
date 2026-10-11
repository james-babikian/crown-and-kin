import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * 0.2.4 phone-B, rule 8 of spec §13.19 and D125 (3): the person list on the phone. The harness step `s024 picker` is the proof
 * in Obsidian (6 whole rows before the fix, 7 after, at a 301 px keyboard). These tests pin the rules in styles.css.
 *
 * NOT the proof of scratch/s024-picker (tests/s024-picker-keyboard-padding.test.ts): that test expects a `padding-bottom` of
 * the safe area only and rests on the wrong cause of D124 (D125). The rule here is a different one: the safe area space is
 * given up while the keyboard is up, and the test evaluates it for several keyboard heights.
 */

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const css = readFileSync(root('styles.css'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rule with exactly this selector (comments removed). */
function rule(selector: string): string {
	for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1]!.trim() === selector) return m[2]!;
	throw new Error(`no rule for ${selector}`);
}

/** The value of one declaration of a rule. */
function decl(selector: string, property: string): string {
	const m = new RegExp(`(?:^|[\\s;])${property}\\s*:\\s*([^;]+);`).exec(rule(selector));
	if (!m) throw new Error(`no ${property} in ${selector}`);
	return m[1]!.trim();
}

/** Evaluates `max(0px, calc(var(--a, 0px) - var(--b, 0px)))` with the two custom properties given in px. */
function paddingBottom(value: string, vars: Record<string, number>): number {
	const m = /^max\(0px,\s*calc\(var\((--[\w-]+),\s*0px\)\s*-\s*var\((--[\w-]+),\s*0px\)\)\)$/.exec(value);
	if (!m) throw new Error(`the padding rule has an unexpected shape: ${value}`);
	return Math.max(0, (vars[m[1]!] ?? 0) - (vars[m[2]!] ?? 0));
}

const PHONE = '.prompt.dynasty-picker.is-phone';

describe('D125 (3): no bottom space under the list while the keyboard is up', () => {
	const value = decl(PHONE, 'padding-bottom');
	const safe = '--safe-area-inset-bottom';
	const keyboard = '--keyboard-height';

	it('the rule names the safe area and the keyboard height', () => {
		expect(value).toContain(safe);
		expect(value).toContain(keyboard);
	});

	it('301 px keyboard (the iPhone value of the harness): no space', () => {
		expect(paddingBottom(value, { [safe]: 34, [keyboard]: 301 })).toBe(0);
	});

	it('346 px keyboard (with the predictive bar): no space', () => {
		expect(paddingBottom(value, { [safe]: 34, [keyboard]: 346 })).toBe(0);
	});

	it('no keyboard: the home bar keeps its space', () => {
		expect(paddingBottom(value, { [safe]: 34, [keyboard]: 0 })).toBe(34);
		expect(paddingBottom(value, { [safe]: 34 })).toBe(34);
	});

	it('the space is never negative and never bigger than the safe area', () => {
		for (const kb of [0, 1, 20, 34, 35, 100, 301, 500]) {
			const px = paddingBottom(value, { [safe]: 34, [keyboard]: kb });
			expect(px).toBeGreaterThanOrEqual(0);
			expect(px).toBeLessThanOrEqual(34);
		}
	});

	it('the padding is not the keyboard height (that would count the keyboard twice, the wrong cause of D124)', () => {
		expect(value).not.toMatch(/^var\(--keyboard-height/);
		expect(value).not.toMatch(/^calc\(var\(--keyboard-height/);
	});

	it('the height of the prompt still comes from the visible area, which already has the keyboard taken off', () => {
		expect(decl(PHONE, 'height')).toMatch(/var\(--dynasty-sheet-height/);
		expect(decl(PHONE, 'max-height')).toMatch(/var\(--dynasty-sheet-height/);
	});
});

describe('D125 (3): a lower head and a first row close to the field', () => {
	it('the top row (the field and Cancel, D212) has no space above or under it; the gap to the list is the list padding below', () => {
		const pad = decl('.dynasty-picker.is-phone .prompt-input-container', 'padding');
		expect(pad).toMatch(/^0 max\(var\(--size-4-3\), env\(safe-area-inset-right\)\) 0 max\(var\(--size-4-3\), env\(safe-area-inset-left\)\)$/);
	});

	it('the top still clears the notch: the prompt, not the grey pill, keeps the top safe area (0.2.8 iPhone finding)', () => {
		expect(decl(PHONE, 'padding-top')).toBe('env(safe-area-inset-top)');
	});

	it('the Cancel button keeps a 44 px hit area', () => {
		const r = rule('.dynasty-picker.is-phone .prompt-input-container button.dynasty-picker-cancel');
		expect(r).toMatch(/min-height:\s*44px/);
		expect(r).toMatch(/min-width:\s*44px/);
	});

	it('the list starts 4 px under the field; its bottom padding is left alone', () => {
		const r = rule('.dynasty-picker.is-phone .prompt-results');
		expect(r).toMatch(/padding-top:\s*var\(--size-4-1\)/);
		expect(r).not.toMatch(/padding-bottom/);
	});

	it('the field of the list is still 44 px high with a 16 px font (no zoom on iOS)', () => {
		const r = rule('.dynasty-picker.is-phone .prompt-input-container input.prompt-input');
		expect(r).toMatch(/min-height:\s*44px/);
		expect(r).toMatch(/font-size:\s*max\(16px/);
	});
});

describe('every window that picks a person uses this one prompt', () => {
	it('only person-picker.ts gives a modal the class dynasty-picker', async () => {
		const { readdirSync } = await import('node:fs');
		const dir = root('src/obsidian');
		const users = readdirSync(dir)
			.filter((f) => f.endsWith('.ts'))
			.filter((f) => /addClass\(\s*'dynasty-picker'\s*\)/.test(readFileSync(`${dir}/${f}`, 'utf8')));
		expect(users).toEqual(['person-picker.ts']);
	});

	it('Find, the focus picker, the relation finder, Add parent, child and partner, the sheet and the Titles window all call pickPerson', async () => {
		const { readdirSync } = await import('node:fs');
		const dir = root('src/obsidian');
		const callers = readdirSync(dir)
			.filter((f) => f.endsWith('.ts') && f !== 'person-picker.ts')
			.filter((f) => /pickPerson\(/.test(readFileSync(`${dir}/${f}`, 'utf8')))
			.sort();
		expect(callers).toEqual(['edit-sheet.ts', 'family-flows.ts', 'titles-window.ts', 'tree-view.ts']);
	});
});

describe('D122: the sobriquet in a list', () => {
	it('has regular weight, set after the marker of phone-B', () => {
		const at = css.indexOf('.dynasty-picker-sob {');
		expect(at).toBeGreaterThan(css.indexOf('/* phone-B: picker */'));
		expect(decl('.dynasty-picker-sob', 'font-weight')).toBe('var(--font-normal)');
	});
});
