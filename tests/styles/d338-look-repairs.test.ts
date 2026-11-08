import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setBarText } from '../../src/render/dom/bar-text';
import { SUCCESSION_UI } from '../../src/render/succession-text';
import { FEl } from '../acceptance/fake-dom';
import { visibleBarText } from '../support/bar-text-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D338 points 3 and 4: the rule in the bar of a line of succession is muted, and the Line section of a new title has the row of a saved title.
 * jsdom has no layout, so the test reads the style sheet that the plugin ships and the shape of the DOM that the code builds.
 */

useFakeDom({ window: true });

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const body = (selector: string): string => {
	const at = css.indexOf(`${selector} {`);
	expect(at, selector).toBeGreaterThanOrEqual(0);
	return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

describe('D338 point 3: the rule in the bar is muted', () => {
	it('the part after the dot is its own element with the class of the muted rule; the title, the dot and the hidden comma are not in it', () => {
		const el = setBarText(new FEl('div') as unknown as HTMLElement, SUCCESSION_UI.bar('Duke of Carrowmere', null, 'eldest-child')) as unknown as FEl;
		const rule = el.children.filter((c) => c.hasClass('dynasty-succession-rule'));
		expect(rule).toHaveLength(1);
		expect(rule[0].getText()).toBe('Eldest child first (primogeniture)');
		expect(visibleBarText(el)).toBe('Line of succession: Duke of Carrowmere, now · Eldest child first (primogeniture)');
		expect(el.children.find((c) => c.getAttribute('aria-hidden') === 'true')!.getText().trim()).toBe('·');
	});

	it('a sentence with no rule has no muted element', () => {
		const el = setBarText(new FEl('div') as unknown as HTMLElement, SUCCESSION_UI.bar('Crown', null)) as unknown as FEl;
		expect(el.children.some((c) => c.hasClass('dynasty-succession-rule'))).toBe(false);
	});

	it('the style sheet colours the rule with the muted text colour, for every bar that holds the text', () => {
		expect(body('.dynasty-succession-text .dynasty-succession-rule')).toMatch(/color:\s*var\(--text-muted\)/);
		// The tree bar, the full-screen bar and the phone list bar all use `.dynasty-succession-text`, and nothing sets the text itself muted.
		expect(body('.dynasty-list-succession')).toMatch(/color:\s*var\(--text-normal\)/);
	});
});

describe('D338 point 4: "Save and show" of a new title', () => {
	it('the style sheet makes the sentence take the room and the button compact at the right, with no space above it', () => {
		const note = body('.dynasty-succ-new > .dynasty-succ-msg');
		expect(note).toMatch(/flex:\s*1 1 0/);
		expect(note).toMatch(/min-width:\s*0/);
		const button = body('.dynasty-succ-save-show');
		expect(button).toMatch(/flex:\s*none/);
		expect(button).not.toMatch(/margin-top/);
		expect(button).not.toMatch(/width:\s*100%/);
	});

	it('the row of a saved title is the row that the new title uses', () => {
		const row = body('.dynasty-line-head');
		expect(row).toMatch(/display:\s*flex/);
		expect(row).toMatch(/justify-content:\s*space-between/);
	});
});
