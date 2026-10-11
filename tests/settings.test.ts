import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PENDING_KEY, normaliseSettings, parseDesktopHeight, readPending, settingsChanges } from '../src/obsidian/settings';

// WP6.3: stored settings (spec §9, D30, D33). Every missing, wrong-type or out-of-range value becomes its default.

describe('normaliseSettings', () => {
	it('gives the defaults for nothing stored, or for data that is not an object', () => {
		for (const raw of [null, undefined, 0, 'x', true, [], [1, 2]]) expect(normaliseSettings(raw)).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps valid values', () => {
		const s = { embedHeightDesktop: 800, showDates: false, showRelations: false, oneParentUnknown: false, showPortraits: false, showHouseGeneration: false, focusGenerations: 0, updateLinks: false, breakWords: 'Long-na-munda', reduceMotion: 'on', phoneDirection: 'down', successionLength: 12, oldAge: 90, youngDeathAge: 30, armsOnCards: 'all', warnManyParents: false };
		expect(normaliseSettings(s)).toEqual(s);
		expect(normaliseSettings({ embedHeightDesktop: 100, focusGenerations: 10 })).toMatchObject({ embedHeightDesktop: 100, focusGenerations: 10 });
		expect(normaliseSettings({ embedHeightDesktop: 5000 })).toMatchObject({ embedHeightDesktop: 5000 });
	});

	it('"Show generation on the house page" (D113 item 4) is on by default; a stored false stays; a wrong type is on', () => {
		expect(DEFAULT_SETTINGS.showHouseGeneration).toBe(true);
		expect(normaliseSettings({ showHouseGeneration: false }).showHouseGeneration).toBe(false);
		expect(normaliseSettings({ showHouseGeneration: 'no' }).showHouseGeneration).toBe(true);
		expect(normaliseSettings({}).showHouseGeneration).toBe(true);
	});

	it('replaces each bad value by its own default and keeps the others', () => {
		const s = normaliseSettings({ embedHeightDesktop: 99, showDates: 'no', showRelations: 'yes', focusGenerations: 11, updateLinks: 1 });
		expect(s).toEqual(DEFAULT_SETTINGS);
		// 0.2.6 (D179): the card size is gone; a stored `cardSize` is ignored and is not written again.
		expect(normaliseSettings({ embedHeightDesktop: 5001, cardSize: 'compact' })).toEqual(DEFAULT_SETTINGS);
		expect(normaliseSettings({ embedHeightDesktop: 5001, showDates: false })).toEqual({ ...DEFAULT_SETTINGS, showDates: false });
	});

	it('refuses numbers written as text, NaN, infinity and negative numbers', () => {
		const s = normaliseSettings({ embedHeightDesktop: '600', focusGenerations: -1 });
		expect(s).toEqual(DEFAULT_SETTINGS);
		expect(normaliseSettings({ embedHeightDesktop: Number.POSITIVE_INFINITY }).embedHeightDesktop).toBe(500);
	});

	it('rounds heights, but refuses a generations number that is not whole', () => {
		expect(normaliseSettings({ embedHeightDesktop: 480.4 })).toMatchObject({ embedHeightDesktop: 480 });
		expect(normaliseSettings({ embedHeightDesktop: 99.6 }).embedHeightDesktop).toBe(100);
		expect(normaliseSettings({ focusGenerations: 2.5 }).focusGenerations).toBe(3);
	});

	it('ignores unknown keys and never returns the object it got', () => {
		const raw = { ...DEFAULT_SETTINGS, extra: 1 };
		const s = normaliseSettings(raw);
		expect(s).toEqual(DEFAULT_SETTINGS);
		expect(s).not.toBe(raw);
		expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
	});

	it('does not change the defaults object', () => {
		const s = normaliseSettings({});
		s.embedHeightDesktop = 900;
		expect(DEFAULT_SETTINGS.embedHeightDesktop).toBe(500);
	});
});

describe('parseDesktopHeight', () => {
	it('reads whole pixels in range, with or without "px"', () => {
		expect(parseDesktopHeight('500')).toBe(500);
		expect(parseDesktopHeight(' 720px ')).toBe(720);
		expect(parseDesktopHeight('100')).toBe(100);
		expect(parseDesktopHeight('5000 PX')).toBe(5000);
	});

	it('refuses anything else', () => {
		for (const t of ['', ' ', '99', '5001', '50%', '1e3', '12.5', '-300', 'abc', '600vh']) expect(parseDesktopHeight(t)).toBeNull();
	});
});

describe('settingsChanges', () => {
	it('lists the keys that differ', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toEqual([]);
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, showDates: false, embedHeightDesktop: 700 }).sort()).toEqual(['embedHeightDesktop', 'showDates']);
	});
});

// Fix round after the M6 iPhone test: renames that wait for a link update share data.json, under their own key.
describe('pending renames in data.json', () => {
	const entry = { oldPath: 'A/Old.md', newPath: 'A/New.md', others: ['B/Old.md'] };

	it('normaliseSettings ignores them: the settings are the same with or without the key', () => {
		const s = { embedHeightDesktop: 800, showDates: false, showRelations: false, oneParentUnknown: false, showPortraits: false, showHouseGeneration: false, focusGenerations: 0, updateLinks: false, breakWords: 'Long-na-munda', reduceMotion: 'on', phoneDirection: 'down', successionLength: 12, oldAge: 90, youngDeathAge: 30, armsOnCards: 'all', warnManyParents: false };
		expect(PENDING_KEY).toBe('pendingRenames');
		expect(normaliseSettings({ ...s, [PENDING_KEY]: [entry] })).toEqual(s);
		expect(normaliseSettings({ [PENDING_KEY]: [entry] })).toEqual(DEFAULT_SETTINGS);
	});

	it('readPending keeps good entries and drops bad ones', () => {
		expect(readPending({ ...DEFAULT_SETTINGS, [PENDING_KEY]: [entry] })).toEqual([entry]);
		expect(readPending({ [PENDING_KEY]: [{ oldPath: 'a.md', newPath: 'b.md' }] })).toEqual([{ oldPath: 'a.md', newPath: 'b.md', others: [] }]);
		expect(readPending({ [PENDING_KEY]: [{ oldPath: 'a.md', newPath: 'b.md', others: ['x.md', 3, '', null] }] })).toEqual([{ oldPath: 'a.md', newPath: 'b.md', others: ['x.md'] }]);
		const bad = [null, 1, 'x', [], { oldPath: 'a.md' }, { oldPath: '', newPath: 'b.md' }, { oldPath: 'a.md', newPath: 7 }];
		expect(readPending({ [PENDING_KEY]: [...bad, entry] })).toEqual([entry]);
	});

	it('readPending gives nothing for old data, no key, or a key that is not a list', () => {
		for (const raw of [null, undefined, 0, 'x', [], DEFAULT_SETTINGS, { [PENDING_KEY]: {} }, { [PENDING_KEY]: 'a' }]) expect(readPending(raw)).toEqual([]);
	});
});
