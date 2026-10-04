// The keyboard height of the phone layout (src/obsidian/modal-layout.ts): reading Obsidian's --keyboard-height and the visible height.
import { describe, expect, it } from 'vitest';
import { parseKeyboardHeight, visibleHeight } from '../src/obsidian/modal-layout';

describe('parseKeyboardHeight', () => {
	it('reads px values', () => {
		expect(parseKeyboardHeight('301px')).toBe(301);
		expect(parseKeyboardHeight(' 346.5px ')).toBe(346.5);
		expect(parseKeyboardHeight('301')).toBe(301);
	});
	it('gives 0 for a missing or invalid value', () => {
		for (const v of [undefined, null, '', 'auto', '-20px', '10em', '50%', 'NaNpx', 'calc(1px)']) expect(parseKeyboardHeight(v)).toBe(0);
	});
});

describe('visibleHeight', () => {
	it('is the viewport when there is no keyboard variable', () => {
		expect(visibleHeight(874, 0, 0)).toBe(874);
		expect(visibleHeight(420, 0, 454)).toBe(420);
	});
	it('takes the keyboard off a viewport that did not shrink (iPhone)', () => {
		expect(visibleHeight(874, 301, 0)).toBe(573);
	});
	it('does not take the keyboard off twice when the viewport shrank already', () => {
		expect(visibleHeight(573, 301, 301)).toBe(573);
		expect(visibleHeight(700, 301, 174)).toBe(573);
	});
	it('keeps a sane minimum', () => {
		expect(visibleHeight(500, 450, 0)).toBe(200);
		expect(visibleHeight(150, 450, 0)).toBe(150);
	});
});
