import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { fakeLocalStorage } from '../support/fake-fence-vault';
import { advance, bootPlugin } from '../support/r04-wiring-app';
import { clock, resetDom, windowListenerCount } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G2 probe of part 3: Obsidian runs a `workspace.onLayoutReady` callback also when the plugin was turned off before the layout was ready. The calendar index guards
 * that case ("a late start must register nothing"); `startNoteIndex` in main.ts does not: it registers `saveWhenLeaving` on the window after the unload, and the
 * unload will never run that cleanup.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('a late layout-ready after the unload', () => {
	it('leaves no window listener of the plugin behind', async () => {
		const ls = fakeLocalStorage({ 'crown-and-kin-pending-renames': { v: 1, migrated: true, pendingRenames: [] } });
		const base = windowListenerCount();
		const b = await bootPlugin({ files: { 'A.md': 'Text.\n' }, stored: { ...DEFAULT_SETTINGS, settingsVersion: 1 }, ls });
		await advance(500);
		b.fake.unload();
		const afterUnload = windowListenerCount();
		// The layout becomes ready after the plugin is off.
		b.app.layoutReady();
		await advance(500);
		expect(windowListenerCount()).toBe(afterUnload);
		expect(afterUnload).toBeLessThanOrEqual(base);
	});
});
