import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DynastyTreePlugin from '../../src/obsidian/main';
import { BREAK_WORDS_MAX } from '../../src/view/settings';
import { SETTINGS_UI } from '../../src/render/ui-text';
import { clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian, settingRows, type Plugin as FakePlugin, type TextComponent } from '../acceptance/fake-obsidian';
import { fakeApp } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

async function loadPlugin(stored: unknown) {
	const app = fakeApp();
	const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
	const fake = plugin as unknown as FakePlugin;
	fake.stored = stored;
	await fake.load();
	return { plugin, fake };
}
const last = (fake: FakePlugin) => fake.saved[fake.saved.length - 1] as Record<string, unknown>;

describe('G2 WP-F', () => {
	it('1: only focusing and leaving the height field must not drop a kept raw value (F.3)', async () => {
		const { plugin, fake } = await loadPlugin({ embedHeightDesktop: 99999, futureKey: 1 });
		(fake.settingTabs[0] as unknown as { display(): void }).display();
		const row = settingRows.find((s) => s.nameEl.getText() === SETTINGS_UI.heightDesktop)!;
		const text = row.components[0] as TextComponent;
		expect(text.getValue()).toBe('500');
		// The user only tabs through the field: a blur, no typing.
		dispatch(text.inputEl as never, 'blur');
		await settle();
		expect(plugin.settings.embedHeightDesktop).toBe(500);
		// No save is needed, or if one happens the raw value must survive.
		const saved = fake.saved.length ? last(fake) : { embedHeightDesktop: 99999 };
		expect(saved.embedHeightDesktop).toBe(99999);
	});

	it('2: a file that cannot be read during an external change keeps the settings and the extras', async () => {
		const { plugin, fake } = await loadPlugin({ showDates: false, futureKey: { a: 1 }, reduceMotion: 'auto', settingsVersion: 3 });
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		// A sync tool is half way through writing data.json: the read throws.
		fake.loadData = () => Promise.reject(new SyntaxError('Unexpected end of JSON input'));
		await plugin.onExternalSettingsChange();
		expect(plugin.settings.showDates).toBe(false);
		fake.loadData = async () => fake.stored;
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ showDates: false, futureKey: { a: 1 }, reduceMotion: 'auto', settingsVersion: 3 });
	});

	it('3: a startup read error must not make the first save wipe the file', async () => {
		const app = fakeApp();
		const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		fake.stored = { futureKey: 1, showDates: false, settingsVersion: 2 };
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		// One failed read, as when a sync tool holds the file for a moment: the second read works.
		const read = fake.loadData.bind(fake);
		fake.loadData = () => {
			fake.loadData = read;
			return Promise.reject(new Error('EBUSY'));
		};
		await fake.load();
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ futureKey: 1, showDates: false, settingsVersion: 2 });
	});

	it('4: a break list longer than the limit is kept as stored (a newer version may allow more)', async () => {
		const long = 'x'.repeat(BREAK_WORDS_MAX + 20);
		const { plugin, fake } = await loadPlugin({ breakWords: long });
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake).breakWords).toBe(long);
	});

	it('5: an external change with a non-object file keeps nothing and does not throw', async () => {
		const { plugin, fake } = await loadPlugin({ futureKey: 1 });
		for (const v of [null, [1], 'text', 7]) {
			fake.stored = v;
			await plugin.onExternalSettingsChange();
			await plugin.changeSettings({ oldAge: 90 + (typeof v === 'number' ? 1 : 0) });
			expect(last(fake).settingsVersion).toBe(1);
		}
	});

	// Pinned limit (D286; recorded in the architecture notes §5.3, on `onExternalSettingsChange`): a change that could not be saved lives only in memory. When sync then reports the old file,
	// the file wins and the change is gone from the screen too. The other rule (keep the unsaved change over the file) would drop a real change of another device, and the
	// owner has not chosen between the two. A repair is a rule, not a bug fix, so the test asserts the result of today.
	it('known limit 6: a user change while the external read is pending, then a failed save, is lost; the stored file wins', async () => {
		const { plugin, fake } = await loadPlugin({ embedHeightDesktop: 600 });
		fake.saveData = () => Promise.reject(new Error('disk full'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await plugin.changeSettings({ showDates: false });
		fake.stored = { embedHeightDesktop: 600 }; // the old file
		await plugin.onExternalSettingsChange();
		expect(plugin.settings.showDates).toBe(true);
		expect(plugin.settings.embedHeightDesktop).toBe(600);
	});

	it('7: a file with 200 000 unknown keys is written back', async () => {
		const big: Record<string, unknown> = {};
		for (let i = 0; i < 200000; i++) big['k' + i] = { i };
		const { plugin, fake } = await loadPlugin(big);
		await plugin.changeSettings({ oldAge: 90 });
		expect(Object.keys(last(fake)).length).toBeGreaterThan(200000);
	});
});

describe('G2 WP-F fix round', () => {
	it('a real change of a field clears its kept raw value and saves', async () => {
		const { plugin, fake } = await loadPlugin({ embedHeightDesktop: 99999, futureKey: 1 });
		await plugin.changeSettings({ embedHeightDesktop: 600 });
		expect(last(fake)).toMatchObject({ embedHeightDesktop: 600, futureKey: 1 });
	});

	it('no change, no save', async () => {
		const { plugin, fake } = await loadPlugin({ embedHeightDesktop: 99999 });
		await plugin.changeSettings({ embedHeightDesktop: 500 });
		expect(fake.saved).toHaveLength(0);
	});

	it('a read that fails again at the first save: the save goes on with the defaults', async () => {
		const app = fakeApp();
		const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		fake.loadData = () => Promise.reject(new Error('EBUSY'));
		await fake.load();
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ oldAge: 90, settingsVersion: 1 });
		expect(fake.saved).toHaveLength(1);
	});

	it('a break list over the limit reads as the default and a new list replaces the raw one', async () => {
		const long = 'x'.repeat(BREAK_WORDS_MAX + 1);
		const { plugin, fake } = await loadPlugin({ breakWords: long });
		expect(plugin.settings.breakWords).toBe('');
		await plugin.changeSettings({ breakWords: 'Val-mont' });
		expect(last(fake).breakWords).toBe('Val-mont');
	});
});
