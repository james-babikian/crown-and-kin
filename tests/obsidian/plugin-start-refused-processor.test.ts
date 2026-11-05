import { Text } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 0.4 WP-1b, pre-mortem item 8: a refused code block processor or a missing editor module stops one feature, not the plugin.
 * The plugin still loads (commands, settings tab), the user gets one Notice, and the console has each error.
 */

import DynastyTreePlugin from '../../src/obsidian/main';
import { TallBlockParser, tallBlockParser, useLanguage } from '../../src/obsidian/live-preview';
import { beginStart, guardStart } from '../../src/obsidian/start-guard';
import { UI } from '../../src/render/view-text';
import { clock, resetDom, settle } from '../acceptance/fake-dom';
import { noticeList, notices, resetObsidian, type Plugin as FakePlugin } from '../acceptance/fake-obsidian';
import { fakeApp } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function loadPlugin(refuse: (lang: string) => boolean) {
	// Package W: the plugin reads the local storage of the vault (the pending renames), so the app fake has one.
	const app = { ...fakeApp(), loadLocalStorage: () => null, saveLocalStorage: () => undefined };
	const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
	const fake = plugin as unknown as FakePlugin;
	const real = fake.registerMarkdownCodeBlockProcessor.bind(fake);
	vi.spyOn(fake, 'registerMarkdownCodeBlockProcessor').mockImplementation((lang, fn) => {
		if (refuse(lang)) throw new Error(`Code block processor for ${lang} already registered`);
		real(lang, fn);
	});
	await fake.load();
	return fake;
}

describe('the start of the plugin when Obsidian refuses a code block processor', () => {
	it('loads as before when nothing is refused: no Notice, no error', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fake = await loadPlugin(() => false);
		expect([...fake.codeBlockProcessors.keys()].sort()).toEqual(['kin', 'kin-calendar']);
		expect(noticeList).toHaveLength(0);
		expect(error).not.toHaveBeenCalled();
	});

	it('the tree block is refused: the calendar block, the commands and the settings tab still start; one Notice', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fake = await loadPlugin((lang) => lang === 'kin');
		expect([...fake.codeBlockProcessors.keys()]).toEqual(['kin-calendar']);
		expect(fake.commands.length).toBeGreaterThan(0);
		expect(fake.settingTabs).toHaveLength(1);
		expect(notices).toEqual([UI.startFailed]);
		expect(error).toHaveBeenCalledTimes(1);
	});

	it('both blocks are refused: the plugin still loads, and the user gets one Notice, not two', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fake = await loadPlugin(() => true);
		expect(fake.codeBlockProcessors.size).toBe(0);
		expect(fake.commands.length).toBeGreaterThan(0);
		expect(noticeList).toHaveLength(1);
		expect(error).toHaveBeenCalledTimes(2);
		// A second start (the plugin is turned off and on) tells the user again.
		await loadPlugin(() => true);
		expect(noticeList).toHaveLength(2);
		await settle();
	});

	it('guardStart returns whether the step ran', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		beginStart();
		expect(guardStart('a step', () => {})).toBe(true);
		expect(guardStart('a step', () => { throw new Error('refused'); })).toBe(false);
		expect(noticeList).toHaveLength(1);
	});
});

describe('Live Preview help when the editor modules are missing or changed', () => {
	const doc = Text.of(['# Title', '```kin', 'people:', '  - id: a', '```']);

	afterEach(() => {
		useLanguage(null);
	});

	it('a missing module turns the help off and nothing throws', () => {
		vi.useFakeTimers();
		useLanguage(null);
		const view = { state: { doc }, viewport: { from: 0, to: doc.length } };
		const parser = new TallBlockParser(view as never);
		expect(() => vi.advanceTimersByTime(300)).not.toThrow();
		parser.destroy();
		vi.useRealTimers();
	});

	it('with no page there is no extension and no error, and a module that fails to load gives null with an error line', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(tallBlockParser()).toBeNull();
		expect(error).not.toHaveBeenCalled();
		// The fake page has no `documentElement`, which the real module reads when it loads: it fails as a changed module would.
		vi.stubGlobal('document', { documentElement: {} });
		expect(tallBlockParser()).toBeNull();
		expect(error).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});
});
