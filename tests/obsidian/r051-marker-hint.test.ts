import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hintText } from '../../src/obsidian/calendar-parts';
import { CALENDAR_WINDOW_UI as T } from '../../src/render/calendar-text';
import { FEl, resetDom } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

// The Marker hint of the Calendars window: on a phone an example format broke across text lines. Each example format is one no-wrap span; the text is the same.

useFakeDom({ window: true });

describe('the Marker hint keeps each example format on one text line', () => {
	it('every example is a span of its own, the text is the text of the table, and the pieces between stay plain text', () => {
		resetDom();
		const hint = new FEl('div');
		hintText(hint as unknown as HTMLElement, T.markerHint, T.markerHintKeep);
		// The fake DOM keeps the text nodes before the child elements, so the order is checked by taking the spans out of the table text.
		expect(hint.text).toBe(T.markerHintKeep.reduce((t, k) => t.replace(k, ''), T.markerHint));
		const spans = hint.children.filter((c) => c.hasClass('dynasty-keep')).map((c) => c.getText());
		expect(spans).toEqual(['{planet}']);
		// The hint is about one word only: no full date format (owner, 0.5.1).
		expect(T.markerHint).not.toContain('{cycle}');
		expect(T.markerHint).not.toContain('{year}');
	});

	it('every kept example is really in the hint, and the style rule makes it no-wrap', () => {
		for (const k of T.markerHintKeep) expect(T.markerHint).toContain(k);
		const css = readFileSync('styles.css', 'utf8');
		expect(/\.dynasty-calendars \.dynasty-keep\s*\{[^}]*white-space:\s*nowrap/.test(css)).toBe(true);
	});

	it('a hint with no kept part is one plain text', () => {
		resetDom();
		const hint = new FEl('div');
		hintText(hint as unknown as HTMLElement, 'Write a word.');
		expect(hint.children).toHaveLength(0);
		expect(hint.getText()).toBe('Write a word.');
	});
});
