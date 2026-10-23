/*
 * The set-up that most DOM tests repeated: install the fake DOM of tests/acceptance/fake-dom.ts before the tests of
 * a file (or of a describe block, when it is called inside one). The options add the globals that some files need:
 * `window` (the fake window, when no other window is set), `css` (a `CSS.supports` that accepts a hex colour and
 * refuses the rest, because the fake window has no CSS object) and `createSvg` (Obsidian's global, for code that
 * makes the detached holder of the card content).
 */
import { beforeAll } from 'vitest';
import { FEl, fakeWin, installDom } from '../acceptance/fake-dom';

export interface FakeDomOptions {
	window?: boolean;
	css?: boolean;
	createSvg?: boolean;
}

/** Registers a `beforeAll` that installs the fake DOM (and the globals of `opts`). */
export function useFakeDom(opts: FakeDomOptions = {}): void {
	beforeAll(() => {
		installDom();
		const g = globalThis as Record<string, unknown>;
		if (opts.window) g.window ??= fakeWin;
		if (opts.css) g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
		if (opts.createSvg) g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
	});
}
