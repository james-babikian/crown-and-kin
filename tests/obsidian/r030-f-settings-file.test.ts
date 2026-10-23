import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DynastyTreePlugin from '../../src/obsidian/main';
import { DEFAULT_SETTINGS, REMOVED_KEYS, SETTINGS_VERSION, VERSION_KEY, buildStoredData, normaliseSettings, readStoredSettings, settingsChanges } from '../../src/view/settings';
import { clock, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian, type Plugin as FakePlugin } from '../acceptance/fake-obsidian';
import { fakeApp } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.3 WP-F (the 0.3 contract C.6, the release plan W7, T15): the settings file has a version; a key that this release does not
 * know, and a known key with a value that is not valid here, are written back unchanged; an external change waits
 * for a running save. "Fails on main": the test fails on the 0.2.8 code (`release-0.3.0` before this package).
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function loadPlugin(stored: unknown) {
	const app = fakeApp();
	const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
	const fake = plugin as unknown as FakePlugin;
	fake.stored = stored;
	await fake.load();
	return { plugin, fake };
}

const last = (fake: FakePlugin) => fake.saved[fake.saved.length - 1] as Record<string, unknown>;

/*
 * The `data.json` of each released shape: the DEFAULT_SETTINGS of that tag (`git show <tag>:src/obsidian/settings.ts`)
 * with one value that is not the default. 0.1.0 is the 6 keys of its settings-contract.ts.
 */
const SHAPES: { tag: string; stored: Record<string, unknown>; expect: Record<string, unknown>; removed: string[] }[] = [
	{
		tag: '0.1.0',
		stored: { embedHeightDesktop: 640, embedHeightPhone: 60, cardSize: 'normal', showDates: true, focusGenerations: 3, updateLinks: true },
		expect: { embedHeightDesktop: 640, showRelations: true, showPortraits: true },
		removed: ['embedHeightPhone', 'cardSize'],
	},
	{
		tag: '0.2.0',
		stored: { embedHeightDesktop: 500, embedHeightPhone: 60, cardSize: 'compact', showDates: true, showRelations: true, showPortraits: true, focusGenerations: 3, updateLinks: true },
		expect: { embedHeightDesktop: 500, oneParentUnknown: true, showHouseGeneration: true, phoneDirection: 'sideways' },
		removed: ['embedHeightPhone', 'cardSize'],
	},
	{
		tag: '0.2.4',
		stored: {
			embedHeightDesktop: 500,
			embedHeightPhone: 60,
			cardSize: 'normal',
			showDates: true,
			showRelations: true,
			showPortraits: true,
			showHouseGeneration: true,
			focusGenerations: 3,
			updateLinks: true,
			phoneCardStyle: 'whole',
			breakWords: 'Long-na-munda',
			reduceMotion: 'system',
		},
		expect: { breakWords: 'Long-na-munda', oneParentUnknown: true, successionLength: 5 },
		removed: ['embedHeightPhone', 'cardSize', 'phoneCardStyle'],
	},
	{
		tag: '0.2.6',
		stored: {
			embedHeightDesktop: 500,
			showDates: true,
			showRelations: true,
			oneParentUnknown: false,
			showPortraits: true,
			showHouseGeneration: true,
			focusGenerations: 3,
			updateLinks: true,
			breakWords: '',
			reduceMotion: 'system',
			phoneDirection: 'sideways',
		},
		expect: { oneParentUnknown: false, oldAge: 110, armsOnCards: 'few' },
		removed: [],
	},
	{
		tag: '0.2.8',
		stored: {
			embedHeightDesktop: 500,
			showDates: true,
			showRelations: true,
			oneParentUnknown: true,
			showPortraits: true,
			showHouseGeneration: true,
			focusGenerations: 3,
			updateLinks: true,
			breakWords: '',
			reduceMotion: 'system',
			phoneDirection: 'down',
			successionLength: 7,
			oldAge: 110,
			youngDeathAge: 0,
			armsOnCards: 'few',
			warnManyParents: true,
		},
		expect: { phoneDirection: 'down', successionLength: 7 },
		removed: [],
	},
];

describe('F.5: a data.json of each released shape', () => {
	for (const shape of SHAPES) {
		it(`${shape.tag} loads to the right values and keeps no removed key`, () => {
			const { settings, extras } = readStoredSettings(shape.stored);
			expect(settings).toMatchObject(shape.expect);
			expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
			// No file of an earlier release has the version, so it counts as absent and is written as 1.
			// 0.4: `pending` holds the renames of the file (none in a file of these shapes).
			expect(extras).toEqual({ version: 1, unknown: {}, invalid: {}, pending: [] });
			const written = buildStoredData(settings, extras, []);
			for (const k of shape.removed) expect(k in written).toBe(false);
			expect(written[VERSION_KEY]).toBe(1);
		});

		it(`${shape.tag} is saved by the plugin with the version and without the removed keys`, async () => {
			const { plugin, fake } = await loadPlugin(shape.stored);
			await plugin.changeSettings({ showDates: false });
			const saved = last(fake);
			expect(saved).toMatchObject({ ...shape.expect, showDates: false, settingsVersion: 1 });
			for (const k of REMOVED_KEYS) expect(k in saved).toBe(false);
		});
	}

	it('the removed keys are all the keys that an earlier release had and this one has not', () => {
		expect([...REMOVED_KEYS].sort()).toEqual(['cardSize', 'embedHeightPhone', 'phoneCardStyle']);
		for (const k of REMOVED_KEYS) expect(k in DEFAULT_SETTINGS).toBe(false);
		for (const shape of SHAPES) for (const k of Object.keys(shape.stored)) expect(k in DEFAULT_SETTINGS || REMOVED_KEYS.includes(k)).toBe(true);
	});
});

describe('F.1: the settings version', () => {
	it('is not a setting: not in the defaults, not in the normalised settings, never in the changes', () => {
		expect(VERSION_KEY in DEFAULT_SETTINGS).toBe(false);
		expect(VERSION_KEY in normaliseSettings({ settingsVersion: 3 })).toBe(false);
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, showDates: false })).toEqual(['showDates']);
		expect(SETTINGS_VERSION).toBe(1);
	});

	it('the first save writes settingsVersion 1 (fails on main)', async () => {
		const { plugin, fake } = await loadPlugin(null);
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake).settingsVersion).toBe(1);
	});

	it.each([[0], [-2], [1.5], ['2'], [null], [true], [[2]], [{}]])('a stored version %j counts as absent and is written as 1 (fails on main)', async (v) => {
		const { plugin, fake } = await loadPlugin({ settingsVersion: v, showDates: false });
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake).settingsVersion).toBe(1);
		expect(last(fake).showDates).toBe(false);
	});

	it('a higher version is kept as stored (fails on main)', async () => {
		const { plugin, fake } = await loadPlugin({ settingsVersion: 4, showDates: false });
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ settingsVersion: 4, showDates: false, oldAge: 90 });
	});
});

describe('F.2: removed and unknown keys', () => {
	it('removed keys are dropped and not written again', async () => {
		const { plugin, fake } = await loadPlugin({ cardSize: 'compact', embedHeightPhone: 70, phoneCardStyle: 'whole', showDates: false });
		await plugin.changeSettings({ oldAge: 90 });
		const saved = last(fake);
		for (const k of REMOVED_KEYS) expect(k in saved).toBe(false);
		expect(saved.showDates).toBe(false);
	});

	it('an unknown key survives a change of another setting, with its value unchanged (fails on main)', async () => {
		const unknown = { nested: { a: [1, 2, { b: null }] }, 'future flag': true, text: 'x', n: 3 };
		const { plugin, fake } = await loadPlugin({ ...unknown, showDates: false });
		expect('nested' in plugin.settings).toBe(false);
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ ...unknown, showDates: false, oldAge: 90 });
		// It survives a second save and an external read as well.
		await plugin.changeSettings({ oldAge: 91 });
		expect(last(fake)).toMatchObject(unknown);
		fake.stored = last(fake);
		await plugin.onExternalSettingsChange();
		await plugin.changeSettings({ oldAge: 92 });
		expect(last(fake)).toMatchObject({ ...unknown, oldAge: 92 });
	});

	it('an unknown key named __proto__ stays plain data (fails on main)', async () => {
		const stored = JSON.parse('{"__proto__": {"polluted": true}, "showDates": false}');
		const { plugin, fake } = await loadPlugin(stored);
		await plugin.changeSettings({ oldAge: 90 });
		const saved = last(fake);
		expect(Object.keys(saved)).toContain('__proto__');
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('pendingRenames is never kept as an unknown key', () => {
		const { extras } = readStoredSettings({ pendingRenames: [{ oldPath: 'a.md', newPath: 'b.md', others: [] }], settingsVersion: 2 });
		expect('pendingRenames' in extras.unknown).toBe(false);
		expect(Object.keys(extras.unknown)).toEqual([]);
	});

	// 0.4 (the index contract 3, G2 part 3 item 2): the updater holds the list of the file from the start (in the fallback, as here with no local storage). A save writes what the updater holds, never the old copy of the file.
	it('a save writes the list that the updater holds, not the old copy of the file', async () => {
		const entry = { oldPath: 'a.md', newPath: 'b.md', others: [] };
		const { plugin, fake } = await loadPlugin({ pendingRenames: [entry] });
		// The note b.md does not exist here, so the updater drops the entry when it resumes; the file must not bring it back.
		await plugin.changeSettings({ oldAge: 90 });
		expect(plugin.links.pendingList()).toEqual([]);
		expect(last(fake).pendingRenames).toBeUndefined();
	});
});

describe('F.3: a known key with a value that is not valid here', () => {
	const stored = { reduceMotion: 'auto', phoneDirection: 'sideways', embedHeightDesktop: 'tall', focusGenerations: 99, showDates: null, armsOnCards: 'none' };

	it('reads as the default in memory', async () => {
		const { plugin } = await loadPlugin(stored);
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('the raw value is written back unchanged by a change of another setting (fails on main)', async () => {
		const { plugin, fake } = await loadPlugin(stored);
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ reduceMotion: 'auto', embedHeightDesktop: 'tall', focusGenerations: 99, showDates: null, armsOnCards: 'none', oldAge: 90, phoneDirection: 'sideways' });
		expect(plugin.settings.reduceMotion).toBe('system');
	});

	it('a valid value that is not the default is not an invalid value', () => {
		const { extras } = readStoredSettings({ reduceMotion: 'on', embedHeightDesktop: 480.5 });
		expect(extras.invalid).toEqual({});
	});

	it('the raw value goes when the user changes that setting (fails on main)', async () => {
		const { plugin, fake } = await loadPlugin(stored);
		await plugin.changeSettings({ reduceMotion: 'on' });
		expect(last(fake)).toMatchObject({ reduceMotion: 'on', embedHeightDesktop: 'tall' });
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake).reduceMotion).toBe('on');
	});

	it('the user sets the value that is already in memory: nothing changes, the raw value stays (G2 fix round, item 1)', async () => {
		const { plugin, fake } = await loadPlugin(stored);
		await plugin.changeSettings({ reduceMotion: 'system' });
		expect(fake.saved).toHaveLength(0);
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ reduceMotion: 'auto', embedHeightDesktop: 'tall' });
	});

	it('the user sets a value that differs from the one in memory: the raw value goes', async () => {
		const { plugin, fake } = await loadPlugin(stored);
		await plugin.changeSettings({ reduceMotion: 'on' });
		expect(last(fake)).toMatchObject({ reduceMotion: 'on', embedHeightDesktop: 'tall' });
	});

	it('an external change reads the new extras', async () => {
		const { plugin, fake } = await loadPlugin(stored);
		fake.stored = { reduceMotion: 'on', futureKey: 1 };
		await plugin.onExternalSettingsChange();
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ reduceMotion: 'on', futureKey: 1, oldAge: 90 });
		expect('embedHeightDesktop' in last(fake) && last(fake).embedHeightDesktop === 'tall').toBe(false);
	});
});

describe('F.4: an external change during a save', () => {
	/** A `saveData` that the test finishes by hand; the file then holds what was saved, changed by `sync` (a sync tool that writes after us). */
	function holdSave(fake: FakePlugin, sync: (data: object) => object = (d) => d) {
		let finish!: () => void;
		const gate = new Promise<void>((r) => (finish = r));
		fake.saveData = async (data: unknown) => {
			await gate;
			fake.saved.push(JSON.parse(JSON.stringify(data)));
			fake.stored = sync(data as object);
		};
		return finish;
	}

	it('waits for the save, so the read does not overwrite the change of the user (fails on main)', async () => {
		const { plugin, fake } = await loadPlugin({ embedHeightDesktop: 600 });
		const finish = holdSave(fake);
		const changing = plugin.changeSettings({ showDates: false });
		const external = plugin.onExternalSettingsChange();
		await settle();
		expect(plugin.settings.showDates).toBe(false);
		finish();
		await changing;
		await external;
		expect(plugin.settings).toMatchObject({ showDates: false, embedHeightDesktop: 600 });
		expect(last(fake)).toMatchObject({ showDates: false });
	});

	it('applies the external value that comes after the save', async () => {
		const { plugin, fake } = await loadPlugin(null);
		const finish = holdSave(fake, (d) => ({ ...d, embedHeightDesktop: 700 }));
		const changing = plugin.changeSettings({ showDates: false });
		const external = plugin.onExternalSettingsChange();
		finish();
		await changing;
		await external;
		expect(plugin.settings).toMatchObject({ showDates: false, embedHeightDesktop: 700 });
	});

	it('a save that starts while the file is read makes that read old, so the file is read again (fails on main)', async () => {
		const { plugin, fake } = await loadPlugin({ embedHeightDesktop: 600 });
		let first!: (v: unknown) => void;
		let reads = 0;
		fake.saveData = async (data: unknown) => {
			fake.saved.push(JSON.parse(JSON.stringify(data)));
			fake.stored = data;
		};
		fake.loadData = () => {
			reads += 1;
			return reads === 1 ? new Promise((r) => (first = r)) : Promise.resolve(fake.stored);
		};
		const external = plugin.onExternalSettingsChange();
		await settle();
		expect(reads).toBe(1);
		await plugin.changeSettings({ showDates: false });
		first({ embedHeightDesktop: 600 });
		await external;
		expect(reads).toBe(2);
		expect(plugin.settings).toMatchObject({ showDates: false, embedHeightDesktop: 600 });
	});

	it('a failed save does not stop the wait', async () => {
		const { plugin, fake } = await loadPlugin(null);
		fake.saveData = () => Promise.reject(new Error('disk full'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await plugin.changeSettings({ showDates: false });
		fake.stored = { embedHeightDesktop: 800 };
		await plugin.onExternalSettingsChange();
		expect(plugin.settings.embedHeightDesktop).toBe(800);
	});
});
