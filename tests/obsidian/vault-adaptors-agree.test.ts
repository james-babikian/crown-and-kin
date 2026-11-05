import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { obsidianCalendarVault } from '../../src/obsidian/calendar-vault';
import { obsidianFenceVault } from '../../src/obsidian/fence-vault';

/*
 * The calendar vault and the fence vault take `read`, `on` and `cacheReady` from `vault-parts.ts`. On one fake app that logs every call,
 * the two adaptors make the same calls and give the same answers; each hands its own shape to its index.
 */

type Handler = (...args: unknown[]) => void;
const note = (path: string, ext = 'md'): TFile => Object.assign(new (TFile as unknown as new (p: string, e: string) => TFile)(path, ext), { stat: { mtime: 1, size: 3 } }) as TFile;

/** A fake app that logs every call the two adaptors make on it. */
function fakeApp() {
	const log: string[] = [];
	const handlers: { bus: string; name: string; fn: Handler }[] = [];
	const bus = (kind: string) => ({
		on(name: string, fn: Handler) {
			log.push(`on ${kind} ${name}`);
			const ref = { bus: kind, name, fn };
			handlers.push(ref);
			return ref;
		},
		offref(ref: unknown) {
			log.push(`offref ${(ref as { bus: string }).bus} ${(ref as { name: string }).name}`);
			const i = handlers.indexOf(ref as (typeof handlers)[number]);
			if (i >= 0) handlers.splice(i, 1);
		},
	});
	const file = note('A.md');
	const app = {
		vault: { ...bus('vault'), getMarkdownFiles: () => [file], getAbstractFileByPath: (p: string) => (p === 'A.md' ? file : null), cachedRead: async () => 'text' },
		metadataCache: { ...bus('meta'), getFileCache: () => null, getFirstLinkpathDest: () => file },
	};
	const fire = (b: string, name: string, ...args: unknown[]) => handlers.filter((h) => h.bus === b && h.name === name).forEach((h) => h.fn(...args));
	return { app: app as never, log, handlers, file, fire };
}

const calendarOf = (a: never, gate: { seen(): boolean; limitMs: number }) => obsidianCalendarVault(a, gate);
const fenceOf = (a: never, gate: { seen(): boolean; limitMs: number }) => obsidianFenceVault(a, { ...gate, done: () => false });

afterEach(() => vi.useRealTimers());

describe('the calendar vault and the fence vault share their vault reads', () => {
	it('`read` gives the same text and the same refusal for an unknown path', async () => {
		const x = fakeApp();
		const gate = { seen: () => true, limitMs: 50 };
		await expect(calendarOf(x.app, gate).read('A.md')).resolves.toBe(await fenceOf(x.app, gate).read('A.md'));
		await expect(calendarOf(x.app, gate).read('none.md')).rejects.toThrow('not a note');
		await expect(fenceOf(x.app, gate).read('none.md')).rejects.toThrow('not a note');
	});

	it('`cacheReady` makes the same calls on the app: at once if seen; else one handler for "resolved" and one timer, both ended by the first of the two', async () => {
		vi.useFakeTimers();
		const run = async (make: (a: never, gate: { seen(): boolean; limitMs: number }) => { cacheReady(): Promise<void> }, how: 'seen' | 'resolved' | 'limit') => {
			const x = fakeApp();
			const p = make(x.app, { seen: () => how === 'seen', limitMs: 50 }).cacheReady();
			if (how === 'resolved') x.fire('meta', 'resolved');
			if (how === 'limit') await vi.advanceTimersByTimeAsync(60);
			await p;
			return { log: x.log, left: x.handlers.length, timers: vi.getTimerCount() };
		};
		for (const how of ['seen', 'resolved', 'limit'] as const) {
			const c = await run(calendarOf, how);
			const f = await run(fenceOf, how);
			expect(c).toEqual(f);
			expect(c.left).toBe(0);
			expect(c.timers).toBe(0);
		}
	});

	it('`on` for cache, rename, delete and create makes the same registrations and the same removals', () => {
		const x = fakeApp();
		const gate = { seen: () => true, limitMs: 50 };
		const registrations = (v: { on(event: never, cb: () => void): () => void }) => {
			x.log.length = 0;
			for (const e of ['cache', 'rename', 'delete', 'create']) v.on(e as never, () => undefined)();
			return [...x.log];
		};
		const c = registrations(calendarOf(x.app, gate) as never);
		expect(registrations(fenceOf(x.app, gate) as never)).toEqual(c);
		expect(c).toEqual(['on meta changed', 'offref meta changed', 'on vault rename', 'offref vault rename', 'on vault delete', 'offref vault delete', 'on vault create', 'offref vault create']);
	});

	it('the calendar vault hands on paths: cache with the text, rename with the old path, delete and create with the path only; other files are skipped', () => {
		const x = fakeApp();
		const v = calendarOf(x.app, { seen: () => true, limitMs: 50 });
		const got: unknown[][] = [];
		const offs = (['cache', 'rename', 'delete', 'create'] as const).map((ev) => v.on(ev, (...args) => got.push([ev, ...args])));
		x.fire('meta', 'changed', x.file, 'the text', {});
		x.fire('vault', 'rename', x.file, 'Old.md');
		x.fire('vault', 'delete', x.file);
		x.fire('vault', 'create', x.file);
		expect(got).toEqual([['cache', 'A.md', 'the text'], ['rename', 'A.md', 'Old.md'], ['delete', 'A.md'], ['create', 'A.md']]);
		x.fire('vault', 'create', note('pic.png', 'png'));
		expect(got.length).toBe(4);
		offs.forEach((off) => off());
		expect(x.handlers.length).toBe(0);
	});
});
