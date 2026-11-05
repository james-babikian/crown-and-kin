import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkNames, concatStyles } from '../../styles/concat.mjs';

/*
 * The design tokens of styles/00-tokens.css and the shared classes of styles/01-base.css: the token file is the first chunk, every token has
 * the value of the look before the tokens, the focus recipe has two tones, and the error edge never copies it.
 */

const tokens = readFileSync('styles/00-tokens.css', 'utf8');
const base = readFileSync('styles/01-base.css', 'utf8');
const phoneList = readFileSync('styles/31-phone-list.css', 'utf8');

/** The value of a custom property in the token file (first declaration). */
function token(name: string): string {
	const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
	expect(m, name).not.toBeNull();
	return m![1].trim();
}

/** The body of the first rule whose selector list holds `selector`. */
function ruleBody(css: string, selector: string): string {
	const at = css.indexOf(selector);
	expect(at, selector).toBeGreaterThanOrEqual(0);
	return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

describe('the token file', () => {
	it('is the first chunk of styles.css', () => {
		expect(chunkNames()[0]).toBe('00-tokens.css');
		expect(concatStyles().startsWith(tokens)).toBe(true);
	});

	it('uses color-mix() only behind @supports, and holds no colour literal', () => {
		if (tokens.includes('color-mix(')) expect(tokens).toContain('@supports');
		expect(tokens).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
	});

	it('the spacing scale is the 4 px scale of Obsidian in six steps', () => {
		const steps = [1, 2, 3, 4, 5, 6].map((n) => token(`--dynasty-space-${n}`));
		expect(steps).toEqual(['var(--size-4-1, 4px)', 'var(--size-4-2, 8px)', 'var(--size-4-3, 12px)', 'var(--size-4-4, 16px)', 'var(--size-4-6, 24px)', 'var(--size-4-8, 32px)']);
	});

	it('the radius roles take the theme; the kept literal is the multi-line field cap (D320); a phone button is a pill (D330 O-33)', () => {
		expect(token('--dynasty-radius-field')).toBe('var(--input-radius)');
		expect(token('--dynasty-radius-area')).toBe('min(var(--input-radius), 12px)');
		expect(token('--dynasty-radius-button')).toBe('var(--button-radius)');
		expect(token('--dynasty-radius-button-phone')).toBe('var(--dynasty-radius-pill)');
		expect(token('--dynasty-radius-pill')).toBe('999px');
		expect(token('--dynasty-radius-card')).toBe('min(var(--radius-m), 1.5em)');
		expect(ruleBody(tokens, 'body.is-phone,')).toContain('--dynasty-radius-field: 10px');
	});

	it('the icon sizes map to the sizes of Obsidian; the bar icon is 17 px with a mouse and the large icon of Obsidian on a phone (D330 O-28)', () => {
		expect([token('--dynasty-icon-s'), token('--dynasty-icon-m'), token('--dynasty-icon-l')]).toEqual(['var(--icon-s)', 'var(--icon-m)', 'var(--icon-l)']);
		expect(token('--dynasty-icon-bar')).toBe('17px');
		expect(ruleBody(tokens, 'body.is-phone,')).toContain('--dynasty-icon-bar: var(--icon-l)');
	});

	it('the two fonts are the text font and the interface font', () => {
		expect(token('--dynasty-font-name')).toBe('var(--font-text)');
		expect(token('--dynasty-font-tool')).toBe('var(--font-interface)');
	});

	it('the line weights and the hairline have names', () => {
		expect(token('--dynasty-hairline')).toBe('var(--dynasty-width-hairline) solid var(--background-modifier-border)');
		expect([token('--dynasty-width-hairline'), token('--dynasty-width-mark'), token('--dynasty-width-house'), token('--dynasty-width-house-card')]).toEqual(['1px', '2px', '3px', '4px']);
	});

	it('motion has names for the durations and the easings', () => {
		for (const name of ['--dynasty-dur-press', '--dynasty-dur-open', '--dynasty-dur-move', '--dynasty-dur-pulse', '--dynasty-ease', '--dynasty-ease-pulse']) token(name);
	});

	it('the card edge is the theme border grey as the plain value, one pixel wide; D330 O-01 mixes 14 % (dark 18 %) of the text colour in the card colour inside @supports', () => {
		expect(token('--dynasty-card-edge')).toBe('var(--background-modifier-border)');
		expect(token('--dynasty-card-edge-width')).toBe('1');
		expect(tokens).toMatch(/@supports \(color: color-mix\(in srgb, red 50%, blue\)\) \{\s*body \{\s*--dynasty-card-edge: color-mix\(in srgb, var\(--text-normal\) 14%, var\(--background-primary-alt\)\);/);
		expect(tokens).toMatch(/body\.theme-dark \{\s*--dynasty-card-edge: color-mix\(in srgb, var\(--text-normal\) 18%, var\(--background-primary-alt\)\);/);
	});
});

describe('the focus recipe and the error edge', () => {
	it('has two tones: the accent outside and the text colour next to the control; the inset pair for a control that fills its row', () => {
		expect(token('--dynasty-focus-outline')).toContain('var(--interactive-accent)');
		expect(token('--dynasty-focus-shadow')).toContain('var(--text-normal)');
		expect(token('--dynasty-focus-offset')).toBe('2px');
		expect(token('--dynasty-focus-inset-offset')).toBe('-2px');
		expect(token('--dynasty-focus-inset-shadow')).toMatch(/^inset .*var\(--text-normal\)$/);
	});

	it('the error edge uses the error colour and does not use a focus token or an offset', () => {
		for (const name of ['--dynasty-error-edge', '--dynasty-error-line', '--dynasty-error-focus-shadow']) {
			expect(token(name), name).toContain('var(--dynasty-error)');
			expect(token(name), name).not.toMatch(/focus|offset|accent|text-normal/);
		}
	});
});

describe('the shared classes of the base chunk', () => {
	it('the title role has a name font and a tool font', () => {
		expect(ruleBody(base, '.dynasty-title.is-name')).toContain('font-family: var(--dynasty-font-name)');
		expect(ruleBody(base, '.dynasty-title.is-tool')).toContain('font-family: var(--dynasty-font-tool)');
		const role = ruleBody(base, '.dynasty-title {');
		expect(role).toContain('font-size: var(--dynasty-type-title)');
		expect(role).toContain('font-weight: var(--dynasty-weight-semibold)');
	});

	it('the bar title stays on one line unless the window opts out with is-wrapping (D316)', () => {
		const body = ruleBody(base, '.dynasty-bar-line:not(.is-wrapping)');
		expect(body).toContain('white-space: nowrap');
		expect(body).toContain('text-overflow: ellipsis');
	});

	it('a field with an error takes the error edge, and a focused one keeps it without the focus recipe', () => {
		const rest = ruleBody(base, ".dynasty-sheet input[aria-invalid='true'],");
		expect(rest).toContain('border: var(--dynasty-error-edge)');
		const focused = ruleBody(base, ".dynasty-picker input[aria-invalid='true']:focus {");
		expect(focused).toContain('border-color: var(--dynasty-error)');
		expect(focused).toContain('box-shadow: var(--dynasty-error-focus-shadow)');
		expect(base.slice(base.indexOf('Shared roles'))).not.toMatch(/outline|--dynasty-focus-/);
	});

	it('the middle dot has no margin of its own: a text space gives it the same room on both sides', () => {
		expect(ruleBody(base, '.dynasty-jmark {')).not.toContain('margin');
		expect(ruleBody(base, '.dynasty-joined .dynasty-jitem > .dynasty-jmark')).toContain('margin-right: 0');
		// The phone list keeps its own margin rule; the rule of the base chunk has the higher specificity (three classes against two).
		expect(phoneList).toContain('.dynasty-list-text .dynasty-jmark {');
	});
});
