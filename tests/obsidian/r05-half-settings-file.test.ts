import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DynastyTreePlugin from '../../src/obsidian/main';
import { clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian, type Plugin as FakePlugin } from '../acceptance/fake-obsidian';
import { fakeApp } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.5 repair (D313, ledger B-0008). Obsidian's `Plugin.loadData` does not throw for a half `data.json` (sync writes the
 * file in two parts): it logs "failed to read JSON" and gives `undefined`. `null` means that there is no file.
 * "Fails on the old code": the old `readData` took `undefined` for an empty file and wiped the settings.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
const WHOLE = { showDates: false, successionLength: 7, futureKey: { a: 1 } };

describe('B-0008: a half data.json is not an empty file', () => {
	it('an external change to a half file keeps the settings and the unknown key in the next save', async () => {
		const { plugin, fake } = await loadPlugin(WHOLE);
		expect(plugin.settings.showDates).toBe(false);
		fake.loadData = async () => undefined;
		await plugin.onExternalSettingsChange();
		expect(plugin.settings).toMatchObject({ showDates: false, successionLength: 7 });
		fake.loadData = async () => WHOLE;
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ ...WHOLE, oldAge: 90 });
	});

	it('a half file at start is recovered by the first save, as for a read that throws', async () => {
		const app = fakeApp();
		const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		let reads = 0;
		fake.loadData = async () => (reads++ === 0 ? undefined : WHOLE);
		await fake.load();
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ ...WHOLE, oldAge: 90 });
	});

	it('a file that is still half at the first save does not stop the save', async () => {
		const { plugin, fake } = await loadPlugin(undefined);
		fake.loadData = async () => undefined;
		await plugin.changeSettings({ oldAge: 90 });
		expect(last(fake)).toMatchObject({ oldAge: 90 });
	});

	it('no file (null) is still an empty file: the defaults apply and nothing is read twice', async () => {
		let reads = 0;
		const { plugin, fake } = await loadPlugin(null);
		const stored = fake.loadData.bind(fake);
		fake.loadData = async () => (reads++, stored());
		await plugin.changeSettings({ oldAge: 90 });
		expect(reads).toBe(0);
		expect(last(fake)).toMatchObject({ oldAge: 90 });
	});

	it('a read that throws is still unreadable', async () => {
		const { plugin, fake } = await loadPlugin(WHOLE);
		fake.loadData = async () => {
			throw new Error('busy');
		};
		await plugin.onExternalSettingsChange();
		expect(plugin.settings.showDates).toBe(false);
	});
});
