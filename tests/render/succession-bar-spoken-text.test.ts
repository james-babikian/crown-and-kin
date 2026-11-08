import { describe, expect, it } from 'vitest';
import { setBarText } from '../../src/render/dom/bar-text';
import { SUCCESSION_UI } from '../../src/render/succession-text';
import { FEl } from '../acceptance/fake-dom';
import { spokenBarText, visibleBarText } from '../support/bar-text-support';
import { useFakeDom } from '../support/fake-dom-setup';

// B-0036: the bar shows a middle dot between the year and the rule. A screen reader gets a comma, and its text begins with the visible words.
useFakeDom({ window: true });

const make = (sentence: string): FEl => setBarText(new FEl('div') as unknown as HTMLElement, sentence) as unknown as FEl;

describe('the spoken text of the Show bar', () => {
	it('shows the dot and says a comma, and the spoken text begins with the visible words up to the dot', () => {
		const el = make(SUCCESSION_UI.bar('Duke of Carrowmere', null, 'eldest-child'));
		expect(visibleBarText(el)).toBe('Line of succession: Duke of Carrowmere, now · Eldest child first (primogeniture)');
		expect(spokenBarText(el)).toBe('Line of succession: Duke of Carrowmere, now, Eldest child first (primogeniture)');
		const upToDot = visibleBarText(el).split(' · ')[0];
		expect(spokenBarText(el).startsWith(upToDot)).toBe(true);
	});

	it('keeps the closing sentence, and a sentence with no rule is plain text', () => {
		expect(spokenBarText(make(SUCCESSION_UI.barNoHeir('Crown', 1150, 'siblings-first')))).toBe('Line of succession: Crown, 1150, Oldest generation first (lateral succession). No heir in the tree.');
		const plain = make(SUCCESSION_UI.bar('Crown', null));
		expect(plain.children.length).toBe(0);
		expect(plain.getText()).toBe('Line of succession: Crown, now');
	});

	it('splits at the last separator, so a title name with a dot keeps it', () => {
		const el = make(SUCCESSION_UI.bar('Crown · Realm', null, 'eldest-child'));
		expect(visibleBarText(el)).toBe('Line of succession: Crown · Realm, now · Eldest child first (primogeniture)');
		expect(spokenBarText(el)).toBe('Line of succession: Crown · Realm, now, Eldest child first (primogeniture)');
	});
});
