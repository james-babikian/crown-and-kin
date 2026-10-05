// Tests of the 0.2.4 settings names (contract 3): the three new keys, their defaults, the read of old data, reducedMotion and phoneHeightSteps.
import { describe, expect, it } from 'vitest';
import { BREAK_WORDS_MAX, DEFAULT_SETTINGS, PHONE_CARD_STYLES, REDUCE_MOTIONS, normaliseSettings, phoneHeightSteps, reducedMotion, settingsChanges } from '../src/obsidian/settings';
import { wholeCardSettings } from './acceptance/phone-style';

describe('0.2.4 settings keys', () => {
	it('has the three new keys with their defaults', () => {
		expect(DEFAULT_SETTINGS.phoneCardStyle).toBe('names-shield');
		expect(DEFAULT_SETTINGS.breakWords).toBe('');
		expect(DEFAULT_SETTINGS.reduceMotion).toBe('system');
		expect(PHONE_CARD_STYLES).toEqual(['names-shield', 'names-portrait', 'whole']);
		expect(REDUCE_MOTIONS).toEqual(['system', 'on', 'off']);
	});

	it('gives the defaults for old data that lacks the keys', () => {
		const s = normaliseSettings({ embedHeightDesktop: 500, cardSize: 'compact' });
		expect(s.phoneCardStyle).toBe('names-shield');
		expect(s.breakWords).toBe('');
		expect(s.reduceMotion).toBe('system');
		expect(s.cardSize).toBe('compact');
	});

	it('keeps a valid value and replaces a wrong one', () => {
		expect(normaliseSettings({ phoneCardStyle: 'whole', reduceMotion: 'on', breakWords: 'Long-na-munda' })).toMatchObject({ phoneCardStyle: 'whole', reduceMotion: 'on', breakWords: 'Long-na-munda' });
		expect(normaliseSettings({ phoneCardStyle: 'tiny', reduceMotion: 3, breakWords: 7 })).toMatchObject({ phoneCardStyle: 'names-shield', reduceMotion: 'system', breakWords: '' });
	});

	it('cuts the break list at the maximum length', () => {
		expect(normaliseSettings({ breakWords: 'a'.repeat(BREAK_WORDS_MAX + 50) }).breakWords).toHaveLength(BREAK_WORDS_MAX);
	});

	it('reports a changed new key', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, phoneCardStyle: 'whole' })).toEqual(['phoneCardStyle']);
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, breakWords: 'a-b' })).toEqual(['breakWords']);
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, reduceMotion: 'off' })).toEqual(['reduceMotion']);
	});

	it('wholeCardSettings is the default with the whole style and overrides', () => {
		expect(wholeCardSettings()).toEqual({ ...DEFAULT_SETTINGS, phoneCardStyle: 'whole' });
		expect(wholeCardSettings({ showDates: false }).showDates).toBe(false);
	});
});

describe('reducedMotion', () => {
	it('follows the device only for the choice system', () => {
		expect(reducedMotion('on', false)).toBe(true);
		expect(reducedMotion('off', true)).toBe(false);
		expect(reducedMotion('system', true)).toBe(true);
		expect(reducedMotion('system', false)).toBe(false);
	});
});

describe('phoneHeightSteps', () => {
	it('gives 40, 60 and 80 at the default', () => {
		expect(phoneHeightSteps(60)).toEqual([40, 60, 80]);
	});

	it('gives three different, increasing values for every base from 40 to 80', () => {
		for (let b = 40; b <= 80; b++) {
			const [lo, mid, hi] = phoneHeightSteps(b);
			expect(mid).toBe(b);
			expect(lo).toBeLessThan(mid);
			expect(hi).toBeGreaterThan(mid);
			expect(lo).toBeGreaterThanOrEqual(30);
			expect(hi).toBeLessThanOrEqual(90);
		}
	});
});
