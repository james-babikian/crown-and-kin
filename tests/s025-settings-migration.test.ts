import { describe, expect, it } from 'vitest';
import { endSessionFocus, focusKey, newBlockState } from '../src/obsidian/block-state';
import * as focusMode from '../src/obsidian/focus-mode';
import * as settings from '../src/obsidian/settings';
import { DEFAULT_SETTINGS, normaliseSettings } from '../src/obsidian/settings';

/*
 * 0.2.5, WP-C2b (CONTRACT C.3.1 "Settings migration" and "What goes"): the settings of the phone preview of 0.2.4 are gone. There is no
 * migration code: `normaliseSettings` builds its result from the known keys, so a stored `data.json` of 0.2.4 loses the old keys at
 * the load and at the next save. 0.2.6 (branch sibling-labels, D174): the key `oneParentUnknown` joins them; a stored
 * file of 0.2.4 or 0.2.5 has no such key and gets the default (on). 0.2.6 (D179): `cardSize` goes too; a stored value is ignored and not written again. 0.2.7: `successionLength` and `oldAge` join them.
 */

const KEYS = ['embedHeightDesktop', 'showDates', 'showRelations', 'oneParentUnknown', 'showPortraits', 'showHouseGeneration', 'focusGenerations', 'updateLinks', 'phoneDirection', 'breakWords', 'reduceMotion', 'successionLength', 'oldAge', 'youngDeathAge'].sort();

describe('stored settings of 0.2.4', () => {
	const stored024 = {
		embedHeightDesktop: 640,
		embedHeightPhone: 70,
		cardSize: 'compact',
		showDates: false,
		showRelations: true,
		showPortraits: true,
		showHouseGeneration: true,
		focusGenerations: 2,
		updateLinks: true,
		phoneCardStyle: 'whole',
		breakWords: 'Long-na-munda',
		reduceMotion: 'on',
	};

	it('give the 14 keys of 0.2.7 and none of the removed ones; the values that stay are kept', () => {
		const s = normaliseSettings(stored024);
		expect(Object.keys(s).sort()).toEqual(KEYS);
		expect(s).toMatchObject({ embedHeightDesktop: 640, showDates: false, focusGenerations: 2, breakWords: 'Long-na-munda', reduceMotion: 'on', phoneDirection: 'sideways', oneParentUnknown: true });
		expect('phoneCardStyle' in s).toBe(false);
		expect('cardSize' in s).toBe(false);
		expect('embedHeightPhone' in s).toBe(false);
	});

	it('the defaults have the same 14 keys', () => {
		expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(KEYS);
	});
});

describe('what is gone', () => {
	it('settings.ts no longer exports the phone card style or the phone heights', () => {
		for (const name of ['PHONE_CARD_STYLES', 'PHONE_HEIGHTS', 'PHONE_HEIGHT', 'PHONE_STEP_POINTS', 'phoneHeightSteps']) expect(name in settings).toBe(false);
	});

	it('focus-mode.ts no longer exports the narrow card width', () => {
		for (const name of ['narrowCardWidth', 'NARROW_MAX_EM', 'NARROW_MIN_EM', 'NARROW_GAP_EM']) expect(name in focusMode).toBe(false);
	});

	it('the block state has no height step and no automatic mark', () => {
		const st = newBlockState();
		expect('heightStep' in st).toBe(false);
		expect('autoMark' in st).toBe(false);
		st.listBack = ['a'];
		endSessionFocus(st);
		expect('heightStep' in st && st.heightStep !== undefined).toBe(false);
		expect(st.listBack).toBeUndefined();
	});

	it('focusKey has no card kind: a sideways key is one key', () => {
		expect(focusKey(null, 0, 'sideways')).toBe('sideways|');
		expect(focusKey('a', 2, 'sideways')).toBe('sideways|focus:a:2');
		expect(focusKey('a', 2)).toBe('focus:a:2');
		expect(focusKey.length).toBeLessThanOrEqual(3);
	});
});
