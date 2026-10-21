import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { isPhoneWindow, orientationFor } from '../src/view/focus-mode';
import DynastyTreePlugin from '../src/obsidian/main';
import { DEFAULT_SETTINGS, type DynastySettings } from '../src/view/settings';
import { TreeView } from '../src/obsidian/tree-view';
import { SETTINGS_UI } from '../src/render/ui-text';
import { FEl, clock, device, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian, settingRows, type DropdownComponent, type Plugin as FakePlugin } from './acceptance/fake-obsidian';
import { desktop, fakeApp, fakeHost, openFullScreen, phone, phoneOnSide, tabletDevice, type Host } from './acceptance/tree-view-fakes';

// 0.2.5, WP-C1 (D150): the setting "Tree direction on a phone held upright" and the screen rule of `orientationFor`
// (the 0.2.5 contract C.3.2, gate finding C10): a tablet in a narrow window is top to bottom.

beforeAll(() => {
	installDom();
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

/** Four generations with two children in the second, so both directions have several rows and columns. */
const SRC = [
	'people:',
	'  - {id: ann, name: Ann, born: 1100}',
	'  - {id: bo, name: Bo, born: 1130, parents: [ann]}',
	'  - {id: cy, name: Cy, born: 1132, parents: [ann]}',
	'  - {id: di, name: Di, born: 1160, parents: [bo]}',
	'  - {id: ed, name: Ed, born: 1162, parents: [bo]}',
	'  - {id: flo, name: Flo, born: 1190, parents: [di]}',
	'',
].join('\n');

const orientation = (root: FEl) => root.querySelector('.dynasty-root')?.getAttribute('data-dynasty-orientation');

/** The settings of a host with `phoneDirection` set; the host object is the one the views read. */
function hostWith(direction: DynastySettings['phoneDirection']): Host {
	return fakeHost({ ...DEFAULT_SETTINGS, phoneDirection: direction });
}

/** What a change in the settings tab does: the host settings change, then the open view hears the old ones. */
function change(host: Host, view: TreeView, next: Partial<DynastySettings>): void {
	const prev = { ...(host.settings as DynastySettings) };
	host.settings = { ...prev, ...next };
	view.onSettingsChange(prev);
}

interface Peek {
	anchor(): { person: string } | null;
	saveSource(): { orientation: string } | null;
	orientation: string;
}

describe('orientationFor: the table of C.3.2 (D24, D150)', () => {
	const row = (coarse: boolean, w: number, h: number, screen: { width: number; height: number } | undefined, direction: 'sideways' | 'down' | undefined) => orientationFor(coarse, w, h, screen, direction);

	it('with Sideways (and with no direction given) a phone held upright is sideways, with or without the screen', () => {
		expect(orientationFor(true, 390, 844)).toBe('sideways');
		expect(row(true, 390, 844, { width: 390, height: 844 }, undefined)).toBe('sideways');
		expect(row(true, 390, 844, { width: 390, height: 844 }, 'sideways')).toBe('sideways');
	});

	it('with Like the computer a phone held upright is top to bottom, also with the keyboard open', () => {
		expect(row(true, 390, 844, { width: 390, height: 844 }, 'down')).toBe('down');
		expect(row(true, 390, 300, { width: 390, height: 844 }, 'down')).toBe('down');
		expect(row(true, 390, 844, undefined, 'down')).toBe('down');
	});

	it('a phone with the keyboard open (window 390 x 300 on a 390 x 844 screen) is still a phone', () => {
		expect(row(true, 390, 300, { width: 390, height: 844 }, 'sideways')).toBe('sideways');
	});

	it('an iPad (screen 820 x 1180) in a narrow Split View window (400 x 1100) is top to bottom, in both settings (gate proof)', () => {
		const screen = { width: 820, height: 1180 };
		expect(isPhoneWindow(true, 820, 1180)).toBe(false);
		expect(orientationFor(true, 400, 1100, screen)).toBe('down');
		expect(row(true, 400, 1100, screen, 'sideways')).toBe('down');
		expect(row(true, 400, 1100, screen, 'down')).toBe('down');
	});

	it('an iPad Stage Manager window (500 x 400 on an 820 screen) is top to bottom', () => {
		expect(row(true, 500, 400, { width: 820, height: 1180 }, 'sideways')).toBe('down');
	});

	it('a phone on its side, a tablet upright and a computer are top to bottom in both settings', () => {
		for (const d of ['sideways', 'down'] as const) {
			expect(row(true, 844, 390, { width: 390, height: 844 }, d)).toBe('down');
			expect(row(true, 820, 1180, { width: 820, height: 1180 }, d)).toBe('down');
			expect(row(false, 500, 900, { width: 1280, height: 800 }, d)).toBe('down');
		}
	});

	it('a screen with no size does not decide: the window decides, as before', () => {
		expect(row(true, 390, 844, { width: 0, height: 0 }, 'sideways')).toBe('sideways');
		expect(row(true, 390, 844, null as never, 'sideways')).toBe('sideways');
	});

	it('the keyboard rule is unchanged: a window as wide as the screen short side counts as upright', () => {
		expect(row(true, 375, 375, { width: 375, height: 812 }, 'sideways')).toBe('sideways');
		expect(row(true, 375, 375, { width: 375, height: 375 }, 'sideways')).toBe('down');
	});
});

describe('the full-screen view follows the setting (D150)', () => {
	it('a phone held upright: Sideways draws sideways, Like the computer draws top to bottom', async () => {
		phone();
		expect(orientation((await openFullScreen(SRC, { host: hostWith('sideways') })).root)).toBe('sideways');
		resetDom();
		resetObsidian();
		FullScreenModal.openViews.clear();
		phone();
		expect(orientation((await openFullScreen(SRC, { host: hostWith('down') })).root)).toBe('down');
	});

	it('a tablet with a narrow window (400 x 1100 on an 820 x 1180 screen) draws top to bottom (gate finding C10)', async () => {
		tabletDevice();
		device.width = 400;
		device.height = 1100;
		device.screenWidth = 820;
		device.screenHeight = 1180;
		expect(orientation((await openFullScreen(SRC, { host: hostWith('sideways') })).root)).toBe('down');
	});

	it('a phone on its side and a computer draw top to bottom whatever the setting says', async () => {
		phoneOnSide();
		expect(orientation((await openFullScreen(SRC, { host: hostWith('sideways') })).root)).toBe('down');
		resetDom();
		resetObsidian();
		FullScreenModal.openViews.clear();
		desktop();
		expect(orientation((await openFullScreen(SRC, { host: hostWith('sideways') })).root)).toBe('down');
	});

	it('a block with no tree follows the setting too (the empty block keeps its orientation attribute)', async () => {
		phone();
		const { root } = await openFullScreen('people:\n', { host: hostWith('down') });
		const attr = root.querySelectorAll('[data-dynasty-orientation]');
		expect(attr.length).toBeGreaterThan(0);
		for (const e of attr) expect(e.getAttribute('data-dynasty-orientation')).toBe('down');
	});
});

describe('a change of the setting while a full-screen view is open (C.3.2)', () => {
	it('on a phone held upright the tree is laid out again, with the same person at the centre', async () => {
		phone();
		const host = hostWith('sideways');
		const { root, handle } = await openFullScreen(SRC, { host });
		const view = [...host.views][0];
		const peek = view as unknown as Peek;
		expect(orientation(root)).toBe('sideways');
		const person = peek.anchor()?.person;
		const renders = host.renders ?? 0;
		change(host, view, { phoneDirection: 'down' });
		await settle();
		resizeAll();
		flushFrames();
		expect(orientation(root)).toBe('down');
		expect(peek.orientation).toBe('down');
		expect(host.renders ?? 0).toBeGreaterThan(renders);
		expect(peek.anchor()?.person).toBe(person);
		expect(handle?.write).not.toHaveBeenCalled();
		change(host, view, { phoneDirection: 'sideways' });
		await settle();
		resizeAll();
		flushFrames();
		expect(orientation(root)).toBe('sideways');
		expect(peek.anchor()?.person).toBe(person);
	});

	it('a computer, a tablet and a phone on its side draw nothing again', async () => {
		for (const make of [desktop, tabletDevice, phoneOnSide]) {
			resetDom();
			resetObsidian();
			FullScreenModal.openViews.clear();
			make();
			const host = hostWith('sideways');
			const { root } = await openFullScreen(SRC, { host });
			const view = [...host.views][0];
			const before = host.renders ?? 0;
			const svg = root.querySelector('.dynasty-svg');
			change(host, view, { phoneDirection: 'down' });
			await settle();
			expect(host.renders ?? 0, make.name).toBe(before);
			expect(root.querySelector('.dynasty-svg'), make.name).toBe(svg);
			expect(orientation(root), make.name).toBe('down');
		}
	});

	it('a change of another setting does not turn the tree', async () => {
		phone();
		const host = hostWith('sideways');
		const { root } = await openFullScreen(SRC, { host });
		const view = [...host.views][0];
		change(host, view, { showDates: false });
		await settle();
		expect(orientation(root)).toBe('sideways');
	});
});

describe('the saved picture follows the direction that the tree is shown in (C.3.2)', () => {
	it('top to bottom with Like the computer, sideways with Sideways', async () => {
		phone();
		const host = hostWith('down');
		await openFullScreen(SRC, { host });
		const view = [...host.views][0];
		expect((view as unknown as Peek).saveSource()?.orientation).toBe('down');
		change(host, view, { phoneDirection: 'sideways' });
		await settle();
		expect((view as unknown as Peek).saveSource()?.orientation).toBe('sideways');
	});
});

describe('the settings row (spec §9)', () => {
	async function loadPlugin(stored: unknown = null) {
		const app = fakeApp();
		const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		fake.stored = stored;
		await fake.load();
		return { plugin, fake };
	}
	const control = () => settingRows.find((s) => s.nameEl.getText() === SETTINGS_UI.phoneDirection)!.components[0] as DropdownComponent;
	const openTab = (fake: FakePlugin) => (fake.settingTabs[0] as unknown as { display(): void }).display();

	it('has the two choices in the plugin words, the stored value, an accessible name and a description', async () => {
		const { fake } = await loadPlugin({ phoneDirection: 'down' });
		openTab(fake);
		const c = control();
		expect(c.options).toEqual([
			['sideways', SETTINGS_UI.directionSideways],
			['down', SETTINGS_UI.directionDown],
		]);
		expect(c.getValue()).toBe('down');
		expect(c.selectEl.getAttribute('aria-label')).toBe(SETTINGS_UI.phoneDirection);
		const row = settingRows.find((s) => s.nameEl.getText() === SETTINGS_UI.phoneDirection)!;
		expect(row.descEl.getText()).toBe(SETTINGS_UI.phoneDirectionDesc);
	});

	it('starts on Sideways and stores a change', async () => {
		const { fake, plugin } = await loadPlugin();
		openTab(fake);
		expect(control().getValue()).toBe('sideways');
		control().fire('down');
		await settle();
		expect(plugin.settings.phoneDirection).toBe('down');
		expect(fake.saved[fake.saved.length - 1]).toEqual({ ...plugin.settings, settingsVersion: 1 });
	});

	it('a wrong choice is stored as Sideways', async () => {
		const { fake, plugin } = await loadPlugin();
		openTab(fake);
		control().fire('upside-down');
		await settle();
		expect(plugin.settings.phoneDirection).toBe('sideways');
	});
});
