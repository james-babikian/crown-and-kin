import { describe, expect, it } from 'vitest';
import { chooseFocus, type FocusFacts } from '../src/obsidian/focus-mode';

/*
 * Fix round 0.2.3, spec §13.18 rule 5: the family that came from the mark ends when the mark changes or goes;
 * the full-screen view (no `mark` fact) never ends the family that the preview remembered.
 */

const base = (o: Partial<FocusFacts>): FocusFacts => ({
	session: null,
	pin: undefined,
	phone: true,
	auto: null,
	has: () => true,
	marked: false,
	large: () => false,
	start: () => 's',
	...o,
});

describe('chooseFocus and the mark', () => {
	it('keeps the family while the mark is the one it came from', () => {
		expect(chooseFocus(base({ auto: 'p3', autoMark: 'p3', mark: 'p3', marked: true }))).toMatchObject({ id: 'p3', auto: 'p3', autoMark: 'p3' });
	});

	it('drops the family when the mark is removed', () => {
		expect(chooseFocus(base({ auto: 'p3', autoMark: 'p3', mark: null, marked: false }))).toMatchObject({ id: null, auto: null, autoMark: null });
	});

	it('chooses again when the mark moved', () => {
		const c = chooseFocus(base({ auto: 'p3', autoMark: 'p3', mark: 'p6', marked: true, start: () => 'p6' }));
		expect(c).toMatchObject({ id: 'p6', auto: 'p6', autoMark: 'p6' });
	});

	it('the full-screen view leaves the remembered family as it is', () => {
		expect(chooseFocus(base({ auto: 'p3', autoMark: 'p3', marked: false }))).toMatchObject({ id: null, auto: 'p3', autoMark: 'p3' });
	});
});
