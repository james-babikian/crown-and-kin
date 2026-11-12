// The warning `calendar-year-past-end` after D342: an era has no length field in the Calendars window any more, so the warning tells the user to change the
// "Length (years)" of a cycle, and for an era to give its text line a later last year or to make the next era start later (an era with no last year ends where the next era starts).
import { describe, expect, it } from 'vitest';
import { codedIssue, issueText } from '../../src/core/messages';

const text = () => issueText(codedIssue('calendar-year-past-end', 'warning', { where: 'born', value: 'Reign of Aldric 50', person: 'Aldric' } as never));

describe('calendar-year-past-end names what to change for a cycle and for an era', () => {
	it('does not tell the user to change the length of an era in the Calendars window', () => {
		expect(text()).not.toMatch(/cycle or era is longer, change its length/);
		expect(text()).toContain('If the cycle is longer, change its “Length (years)” in the Calendars window.');
	});

	it('tells the user to give the era a later last year, or to make the next era start later', () => {
		expect(text().endsWith('If the era is longer, give the era a later last year, or make the next era start later.')).toBe(true);
	});

	it('keeps each sentence at 20 words or fewer', () => {
		for (const sentence of text().split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
	});
});
