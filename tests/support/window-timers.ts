/*
 * Setup file for every test file. Obsidian asks plugins to call `window.setTimeout` (a pop-out window
 * has its own timers), so the plugin code does. The tests run in Node, where `window` does not exist.
 * Before each test, this gives `window` the four timer functions if the file has set no
 * window of its own (many files do `window ??= fakeWin` in beforeAll, so the stub must come later).
 * The functions are bound late so that `vi.useFakeTimers()` still works.
 */
import { beforeEach } from 'vitest';

const g = globalThis as Record<string, unknown>;

beforeEach(() => {
	if (typeof g.window !== 'undefined') return;
	g.window = {
		setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a) as unknown as number,
		clearTimeout: (id?: number) => globalThis.clearTimeout(id as never),
		setInterval: (...a: Parameters<typeof setInterval>) => globalThis.setInterval(...a) as unknown as number,
		clearInterval: (id?: number) => globalThis.clearInterval(id as never),
	};
});
