import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Obsidian's debounce on the fake window's timers (the shared fake runs the function at once). */
function debounce(fn: () => void, ms = 0, reset = false) {
	let timer: number | null = null;
	const win = () => (globalThis as unknown as { window: { setTimeout(f: () => void, ms: number): number; clearTimeout(id: number): void } }).window;
	const d = () => {
		if (timer !== null) {
			if (!reset) return d;
			win().clearTimeout(timer);
		}
		timer = win().setTimeout(() => {
			timer = null;
			fn();
		}, ms);
		return d;
	};
	d.cancel = () => {
		if (timer !== null) win().clearTimeout(timer);
		timer = null;
		return d;
	};
	d.run = () => {
		if (timer === null) return;
		d.cancel();
		fn();
	};
	return d;
}

vi.mock('obsidian', async () => ({ ...(await import('../acceptance/fake-obsidian')), debounce }));

import { TFile } from 'obsidian';
import DynastyTreePlugin from '../../src/obsidian/main';
import { pluginModalOpen } from '../../src/view/plugin-modals';
import { PENDING_KEY } from '../../src/view/settings';
import { undoNotice } from '../../src/obsidian/undo-notice';
import { SETTINGS_UI } from '../../src/render/ui-text';
import { clock, dispatch, resetDom, runTimers, settle, untilDone } from '../acceptance/fake-dom';
import { noticeList, resetObsidian, settingRows, type Plugin as FakePlugin, type PluginSettingTab, type TextComponent } from '../acceptance/fake-obsidian';
import { fakeApp, fakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/* Review 0.1.1 area E, findings 7, 8 and 9 (the decision notes "Version 0.1.1", area E rulings). */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function loadPlugin(stored: unknown = null, app = fakeApp()) {
	const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
	const fake = plugin as unknown as FakePlugin;
	fake.stored = stored;
	await fake.load();
	return { plugin, fake, app };
}

function heightField(fake: FakePlugin): { text: TextComponent; tab: PluginSettingTab } {
	const tab = fake.settingTabs[0];
	tab.display();
	const row = settingRows.find((s) => s.nameEl.getText() === SETTINGS_UI.heightDesktop)!;
	return { text: row.components[0] as TextComponent, tab };
}

/** Types the text one key at a time, as the field's `input` events do. */
async function typeText(text: TextComponent, value: string): Promise<void> {
	for (let i = 1; i <= value.length; i++) {
		text.fire(value.slice(0, i));
		await settle();
		runTimers(100);
	}
}

describe('the desktop height field (finding 9)', () => {
	it('stores the value 400 ms after the last key press, once', async () => {
		const { plugin, fake } = await loadPlugin();
		const { text } = heightField(fake);
		await typeText(text, '1200');
		// 100 ms after the last key press: nothing stored yet, also not "120".
		expect(plugin.settings.embedHeightDesktop).toBe(500);
		expect(fake.saved).toEqual([]);
		runTimers(299);
		expect(fake.saved).toEqual([]);
		runTimers(1);
		await settle();
		expect(plugin.settings.embedHeightDesktop).toBe(1200);
		expect(fake.saved).toHaveLength(1);
	});

	it('stores at once on Enter and on blur; a value out of range is not stored', async () => {
		const { plugin, fake } = await loadPlugin();
		const { text } = heightField(fake);
		text.fire('800');
		dispatch(text.inputEl, 'keydown', { key: 'Enter' });
		expect(plugin.settings.embedHeightDesktop).toBe(800);
		text.fire('700');
		dispatch(text.inputEl, 'blur');
		expect(plugin.settings.embedHeightDesktop).toBe(700);
		text.fire('50');
		dispatch(text.inputEl, 'blur');
		expect(plugin.settings.embedHeightDesktop).toBe(700);
		expect(text.getValue()).toBe('700');
		// The timers of those key presses are cancelled: no further save.
		await settle();
		runTimers(1000);
		await settle();
		expect(fake.saved).toHaveLength(2);
	});

	it('closing the settings stores a value that still waits', async () => {
		const { plugin, fake } = await loadPlugin();
		const { text, tab } = heightField(fake);
		text.fire('900');
		await settle();
		tab.hide();
		expect(plugin.settings.embedHeightDesktop).toBe(900);
		runTimers(1000);
		await settle();
		expect(fake.saved).toHaveLength(1);
	});
});

describe('the Undo Notice (finding 8)', () => {
	it('is tracked while it shows; after it hides by itself its button does nothing', async () => {
		const h = fakeHandle('n.md', 'people: []\n');
		expect(pluginModalOpen()).toBe(false);
		undoNotice('Aldric was deleted.', h as never, 'people: []\n');
		expect(pluginModalOpen()).toBe(true);
		const notice = noticeList[noticeList.length - 1];
		// Obsidian hides the Notice at its time.
		notice.hide();
		expect(pluginModalOpen()).toBe(false);
		dispatch(notice.noticeEl.querySelector('.dynasty-undo-button')!, 'click');
		await settle();
		expect(h.undo).not.toHaveBeenCalled();
	});

	it('Undo acts once', async () => {
		const h = fakeHandle('n.md', 'people: []\n');
		undoNotice('Aldric was deleted.', h as never, 'people: []\n');
		const notice = noticeList[noticeList.length - 1];
		const button = notice.noticeEl.querySelector('.dynasty-undo-button')!;
		dispatch(button, 'click');
		dispatch(button, 'click');
		await settle();
		expect(h.undo).toHaveBeenCalledTimes(1);
		expect(notice.hidden).toBe(true);
		expect(pluginModalOpen()).toBe(false);
	});
});

describe('rename events and the plugin load (finding 7)', () => {
	it('after the load, a rename waits for its link update with the stored setting; the handles follow a rename at any time', async () => {
		const app = fakeApp();
		Object.assign(app.vault, { getMarkdownFiles: () => [], getAbstractFileByPath: () => null });
		const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		const moved = vi.spyOn(plugin.handles, 'renamed');
		let read!: (v: unknown) => void;
		fake.loadData = () => new Promise((r) => (read = r));
		const loading = fake.load();
		const File = TFile as unknown as new (path: string, extension: string) => TFile;
		const fire = (to: string, from: string) => (app.vault as unknown as { fire(n: string, ...a: unknown[]): void }).fire('rename', new File(to, 'md'), from);
		fire('Keep.md', 'Castle.md');
		expect(moved).toHaveBeenCalledWith('Castle.md', 'Keep.md');
		read({ updateLinks: true, embedHeightDesktop: 800 });
		await loading;
		fire('Hall.md', 'Keep.md');
		expect(plugin.links.pendingList()).toEqual([{ oldPath: 'Keep.md', newPath: 'Hall.md', others: [] }]);
		await settle();
		const saved = fake.saved as Record<string, unknown>[];
		expect(saved[0].embedHeightDesktop).toBe(800);
		expect(saved[0][PENDING_KEY]).toEqual([{ oldPath: 'Keep.md', newPath: 'Hall.md', others: [] }]);
		await untilDone(plugin.links.idle());
	});
});
