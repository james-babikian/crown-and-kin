import { describe, expect, it } from 'vitest';
import { PARENT_LIMIT, PARENT_TYPES } from '../src/core/types';
import { DEFAULT_SETTINGS, normaliseSettings } from '../src/obsidian/settings';

// 0.2.8 P0: the stubs that later packages fill. They must exist, have their defaults and change nothing yet.

describe('PARENT_LIMIT (contract B.3)', () => {
	it('has one limit for each parent type: birth, adoptive and ward 2, rumoured 8', () => {
		expect(PARENT_LIMIT).toEqual({ birth: 2, adoptive: 2, ward: 2, rumoured: 8 });
		expect(Object.keys(PARENT_LIMIT).sort()).toEqual([...PARENT_TYPES].sort());
	});
});

describe('the new settings (contract A.4, A.5)', () => {
	it('have the defaults armsOnCards "few" and warnManyParents on', () => {
		expect(DEFAULT_SETTINGS.armsOnCards).toBe('few');
		expect(DEFAULT_SETTINGS.warnManyParents).toBe(true);
	});

	it('are filled in when old saved settings do not have them', () => {
		const old = { embedHeightDesktop: 640, showDates: false, successionLength: 7 };
		const s = normaliseSettings(old);
		expect(s.armsOnCards).toBe('few');
		expect(s.warnManyParents).toBe(true);
		expect(s.embedHeightDesktop).toBe(640);
		expect(s.showDates).toBe(false);
		expect(s.successionLength).toBe(7);
		expect(normaliseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it('keep a valid saved value and replace a wrong one with the default', () => {
		expect(normaliseSettings({ armsOnCards: 'all', warnManyParents: false })).toMatchObject({ armsOnCards: 'all', warnManyParents: false });
		expect(normaliseSettings({ armsOnCards: 'some', warnManyParents: 'no' })).toMatchObject({ armsOnCards: 'few', warnManyParents: true });
	});
});
