// Fix round of step 4.2, ruling 4: `planWrite` counts the ordinal in the fence language it is given.
import { describe, expect, it } from 'vitest';
import { planWrite } from '../src/core/block-write';

const NOTE = '```kin\npeople: []\n```\n\n```kin-calendar\ncalendars: []\n```\n\n```kin-calendar\ncalendars: [a]\n```\n';
const append = (b: string) => ({ ok: true as const, body: `${b}\n# x` });

describe('planWrite with a fence language', () => {
	it('writes the second kin-calendar block by its ordinal and leaves every other block alone', () => {
		const r = planWrite(NOTE, 1, 'calendars: [a]', append, 'kin-calendar');
		expect(r).toMatchObject({ ok: true, newBody: 'calendars: [a]\n# x', oldBody: 'calendars: [a]' });
		if (r.ok) expect(r.newText).toBe(NOTE.replace('calendars: [a]', 'calendars: [a]\n# x'));
	});

	it('the default language is kin, so ordinal 0 is the tree block', () => {
		expect(planWrite(NOTE, 0, 'people: []', append)).toMatchObject({ ok: true, oldBody: 'people: []' });
		expect(planWrite(NOTE, 0, 'calendars: []', append)).toMatchObject({ ok: false, code: 'stale' });
	});

	it('says missing when the language has no block at the ordinal, and stale when the body differs', () => {
		expect(planWrite(NOTE, 2, '', append, 'kin-calendar')).toEqual({ ok: false, code: 'missing' });
		expect(planWrite(NOTE, 0, 'people: []', append, 'kin-calendar')).toMatchObject({ ok: false, code: 'stale', currentBody: 'calendars: []' });
	});

	it('refuses a body that would end the block early, also in a kin-calendar block', () => {
		const r = planWrite(NOTE, 0, 'calendars: []', () => ({ ok: true, body: 'a\n```\nb' }), 'kin-calendar');
		expect(r).toMatchObject({ ok: false, code: 'rejected' });
	});
});
