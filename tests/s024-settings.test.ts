// Tests of the 0.2.4 settings names (contract 3) that stay in 0.2.5: the break list and Reduce movement, their defaults, the read of old data and reducedMotion. The card style and the phone heights of 0.2.4 are gone (D144).
import { describe, expect, it } from 'vitest';
import { BREAK_WORDS_MAX, DEFAULT_SETTINGS, PHONE_DIRECTIONS, REDUCE_MOTIONS, normaliseSettings, reducedMotion, settingsChanges } from '../src/obsidian/settings';

describe('0.2.4 settings keys', () => {
	it('has the two keys with their defaults', () => {
		expect(DEFAULT_SETTINGS.breakWords).toBe('');
		expect(DEFAULT_SETTINGS.reduceMotion).toBe('system');
		expect(REDUCE_MOTIONS).toEqual(['system', 'on', 'off']);
	});

	it('gives the defaults for old data that lacks the keys', () => {
		const s = normaliseSettings({ embedHeightDesktop: 500, cardSize: 'compact' });
		expect(s.breakWords).toBe('');
		expect(s.reduceMotion).toBe('system');
		// 0.2.6 (D179): the stored card size is ignored.
		expect('cardSize' in s).toBe(false);
	});

	it('keeps a valid value and replaces a wrong one', () => {
		expect(normaliseSettings({ reduceMotion: 'on', breakWords: 'Long-na-munda' })).toMatchObject({ reduceMotion: 'on', breakWords: 'Long-na-munda' });
		expect(normaliseSettings({ reduceMotion: 3, breakWords: 7 })).toMatchObject({ reduceMotion: 'system', breakWords: '' });
	});

	it('treats a break list over the maximum length as not valid (it is kept raw, F.3)', () => {
		expect(normaliseSettings({ breakWords: 'a'.repeat(BREAK_WORDS_MAX + 50) }).breakWords).toBe('');
	});

	it('reports a changed new key', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, breakWords: 'a-b' })).toEqual(['breakWords']);
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, reduceMotion: 'off' })).toEqual(['reduceMotion']);
	});

});

// 0.2.5 (D150): the direction of the full-screen tree on a phone held upright.
describe('0.2.5 key phoneDirection', () => {
	it('starts on Sideways and lists its two values', () => {
		expect(DEFAULT_SETTINGS.phoneDirection).toBe('sideways');
		expect(PHONE_DIRECTIONS).toEqual(['sideways', 'down']);
	});

	it('gives the default for old data that lacks the key', () => {
		expect(normaliseSettings({ embedHeightDesktop: 500 }).phoneDirection).toBe('sideways');
	});

	it('keeps a valid value and replaces a wrong one', () => {
		expect(normaliseSettings({ phoneDirection: 'down' }).phoneDirection).toBe('down');
		expect(normaliseSettings({ phoneDirection: 'sideways' }).phoneDirection).toBe('sideways');
		for (const bad of ['up', 'Down', 3, null, true]) expect(normaliseSettings({ phoneDirection: bad }).phoneDirection).toBe('sideways');
	});

	it('reports a changed key', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, phoneDirection: 'down' })).toEqual(['phoneDirection']);
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
