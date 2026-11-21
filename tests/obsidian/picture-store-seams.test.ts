import { beforeEach, describe, expect, it } from 'vitest';

import type { App, TFile } from 'obsidian';
import { PictureEntries, STORE_BYTES, type Entry } from '../../src/obsidian/picture-entries';
import { HEADER_STORE_KEY, PictureHeaders } from '../../src/obsidian/picture-headers';
import type { PictureIO } from '../../src/obsidian/picture-io';
import { PRIORITY_CHECK, PRIORITY_LIVE, PRIORITY_NOW, PicturePipeline, type Task } from '../../src/obsidian/picture-pipeline';
import { resetDom, runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The seams of the picture store after the split of review step 12 (lane H1): the header cache and its restart, the queue with its limits, and the
 * list of copies. Each part is used alone here, so a change in one of them cannot hide behind the others.
 */

useFakeDom({ window: true });

beforeEach(() => resetDom());

const fileAt = (path: string, size = 1000, mtime = 1): TFile => ({ path, name: path.slice(path.lastIndexOf('/') + 1), extension: 'png', stat: { mtime, ctime: 1, size } }) as unknown as TFile;

/** An app whose local storage lives in a map that two stores can share (a restart). */
function appWith(storage: Map<string, unknown>): App {
	return { loadLocalStorage: (k: string) => storage.get(k) ?? null, saveLocalStorage: (k: string, v: unknown) => void storage.set(k, v) } as unknown as App;
}

describe('the header cache', () => {
	it('keeps a good result across a restart, and only for the file as it was', () => {
		const storage = new Map<string, unknown>();
		const first = new PictureHeaders(appWith(storage), () => false);
		const f = fileAt('a/arms.png');
		first.remember(f, { ok: true, format: 'png' }, true);
		expect(storage.has(HEADER_STORE_KEY)).toBe(false);
		runTimers(1500);
		expect(storage.has(HEADER_STORE_KEY)).toBe(true);

		const second = new PictureHeaders(appWith(storage), () => false);
		expect(second.of(f)).toEqual({ ok: true, format: 'png' });
		expect(second.of(fileAt('a/arms.png', 2000))).toBeNull();
		expect(second.of(fileAt('a/other.png'))).toBeNull();
	});

	it('keeps a decode fault only until the plugin unloads', () => {
		const storage = new Map<string, unknown>();
		const first = new PictureHeaders(appWith(storage), () => false);
		const f = fileAt('a/bad.png');
		first.remember(f, { ok: false, code: 'picture-not-image', file: 'bad.png' }, false);
		expect(first.of(f)).toMatchObject({ ok: false });
		first.flush();
		expect(new PictureHeaders(appWith(storage), () => false).of(f)).toBeNull();
	});

	it('writes at once on flush, never after the store closed, and forgets a path', () => {
		const storage = new Map<string, unknown>();
		const open = new PictureHeaders(appWith(storage), () => false);
		const f = fileAt('a/arms.png');
		open.remember(f, { ok: true, format: 'png' }, true);
		open.flush();
		expect(storage.has(HEADER_STORE_KEY)).toBe(true);
		open.forget(f.path);
		// The kept result still answers: its signature is the proof that the file is the same.
		expect(open.of(f)).toEqual({ ok: true, format: 'png' });

		const closedStorage = new Map<string, unknown>();
		const closed = new PictureHeaders(appWith(closedStorage), () => true);
		closed.remember(f, { ok: true, format: 'png' }, true);
		runTimers(5000);
		expect(closedStorage.size).toBe(0);
	});

	it('ignores a damaged saved list', () => {
		const storage = new Map<string, unknown>([[HEADER_STORE_KEY, { v: 1, e: [['a.png', 1, {}], 'x', ['b.png', '1:1000', { ok: true, format: 'png' }]] }]]);
		const h = new PictureHeaders(appWith(storage), () => false);
		expect(h.of(fileAt('a.png'))).toBeNull();
		expect(h.of(fileAt('b.png', 1000, 1))).toEqual({ ok: true, format: 'png' });
	});
});

/** A task that logs when it starts and ends only when the test lets it. */
function heldTask(log: string[], name: string, priority: number, exclusive = false, wanted = () => true) {
	const hold: { end: () => void } = { end: () => {} };
	const task: Task = {
		priority,
		exclusive,
		unwanted: () => !wanted(),
		drop: () => void log.push(`drop ${name}`),
		run: () => {
			log.push(`start ${name}`);
			return new Promise<void>((resolve) => {
				hold.end = () => {
					log.push(`end ${name}`);
					resolve();
				};
			});
		},
	};
	return { task, hold };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function pipelineOf(coarse: boolean): PicturePipeline {
	const io = { coarse: () => coarse } as unknown as PictureIO;
	return new PicturePipeline(io, new PictureHeaders(appWith(new Map()), () => false), () => false);
}

describe('the queue', () => {
	it('runs two jobs at once, and one on a touch device', async () => {
		for (const [coarse, atOnce] of [[false, 2], [true, 1]] as const) {
			const log: string[] = [];
			const pipe = pipelineOf(coarse);
			const jobs = ['a', 'b', 'c'].map((n) => heldTask(log, n, PRIORITY_LIVE));
			for (const j of jobs) pipe.enqueue(j.task);
			await tick();
			expect(log.filter((l) => l.startsWith('start')).length, `coarse ${coarse}`).toBe(atOnce);
			jobs[0].hold.end();
			await tick();
			expect(log.filter((l) => l.startsWith('start')).length, `coarse ${coarse} after one ended`).toBe(Math.min(3, atOnce + 1));
			for (const j of jobs) j.hold.end();
			await tick();
		}
	});

	it('serves a waiting window first, then the live pictures, then the file check; the same priority in order', async () => {
		const log: string[] = [];
		const pipe = pipelineOf(true);
		const first = heldTask(log, 'first', PRIORITY_LIVE);
		pipe.enqueue(first.task);
		const rest = [heldTask(log, 'check', PRIORITY_CHECK), heldTask(log, 'live2', PRIORITY_LIVE), heldTask(log, 'now', PRIORITY_NOW), heldTask(log, 'live3', PRIORITY_LIVE)];
		for (const r of rest) pipe.enqueue(r.task);
		await tick();
		first.hold.end();
		for (let i = 0; i < 6; i++) {
			await tick();
			for (const r of rest) r.hold.end();
		}
		await tick();
		expect(log.filter((l) => l.startsWith('start'))).toEqual(['start first', 'start now', 'start live2', 'start live3', 'start check']);
	});

	it('drops a job that nobody wants any more before it starts', async () => {
		const log: string[] = [];
		const pipe = pipelineOf(true);
		const busy = heldTask(log, 'busy', PRIORITY_LIVE);
		let wanted = true;
		const waiting = heldTask(log, 'waiting', PRIORITY_LIVE, false, () => wanted);
		pipe.enqueue(busy.task);
		pipe.enqueue(waiting.task);
		await tick();
		wanted = false;
		busy.hold.end();
		await tick();
		expect(log).toEqual(['start busy', 'end busy', 'drop waiting']);
	});

	it('holds the queue alone for a saved picture, after the running jobs end', async () => {
		const log: string[] = [];
		const pipe = pipelineOf(false);
		const a = heldTask(log, 'a', PRIORITY_LIVE);
		const solo = heldTask(log, 'solo', PRIORITY_NOW, true);
		const after = heldTask(log, 'after', PRIORITY_LIVE);
		pipe.enqueue(a.task);
		pipe.enqueue(solo.task);
		pipe.enqueue(after.task);
		await tick();
		expect(log).toEqual(['start a']);
		a.hold.end();
		await tick();
		expect(log).toEqual(['start a', 'end a', 'start solo']);
		solo.hold.end();
		await tick();
		expect(log).toEqual(['start a', 'end a', 'start solo', 'end solo', 'start after']);
		after.hold.end();
	});

	it('drops every job that has not started when the plugin unloads', async () => {
		const log: string[] = [];
		const pipe = pipelineOf(true);
		const busy = heldTask(log, 'busy', PRIORITY_LIVE);
		const waiting = heldTask(log, 'waiting', PRIORITY_LIVE);
		pipe.enqueue(busy.task);
		pipe.enqueue(waiting.task);
		await tick();
		pipe.dropQueue();
		expect(log).toEqual(['start busy', 'drop waiting']);
		busy.hold.end();
	});

	it('raises the number of a path, so an older job sees that it is stale', () => {
		const pipe = pipelineOf(false);
		expect(pipe.gen('a.png')).toBe(0);
		pipe.bump('a.png');
		expect(pipe.gen('a.png')).toBe(1);
		expect(pipe.gen('b.png')).toBe(0);
	});

	it('refuses a file over the limit without a read: 256 MB, and 64 MB on a touch device', () => {
		const big = fileAt('a/big.png', 100 * 1024 * 1024);
		expect(pipelineOf(false).sizeProblem(big)).toBeNull();
		expect(pipelineOf(true).sizeProblem(big)).toMatchObject({ ok: false, code: 'picture-too-large' });
		expect(pipelineOf(false).sizeProblem(fileAt('a/huge.png', 257 * 1024 * 1024))).toMatchObject({ code: 'picture-too-large' });
	});
});

function entry(key: string, path: string, bytes: number): Entry {
	return { key, path, url: `blob:${key}`, bytes, w: 10, h: 10, refs: 0, stale: false };
}

describe('the list of copies', () => {
	it('evicts the least recently used copy over the limit, and never a copy in use', () => {
		const gone: string[] = [];
		const list = new PictureEntries((k) => void gone.push(k));
		const a = entry('a s k', 'a', STORE_BYTES * 0.6);
		list.add(a);
		list.add(entry('b s k', 'b', STORE_BYTES * 0.3));
		const holdA = list.hold(a);
		// A read of `a` makes `b` the least recently used.
		list.held('a s k')!.release();
		list.add(entry('c s k', 'c', STORE_BYTES * 0.3));
		list.evict();
		expect(list.size).toBe(2);
		expect(list.held('b s k')).toBeNull();
		expect(gone).toEqual(['b s']);
		holdA.release();
		expect(list.size).toBe(2);
		expect(list.bytes).toBeLessThanOrEqual(STORE_BYTES);
	});

	it('keeps a copy in use after its file changed, and drops it at the last release', () => {
		const list = new PictureEntries(() => {});
		const e = entry('a\u0000s\u0000k', 'a', 100);
		list.add(e);
		const held = list.hold(e);
		list.invalidate('a');
		expect(list.size).toBe(0);
		expect(list.inUse()).toBe(1);
		expect(list.bytes).toBe(100);
		held.release();
		held.release();
		expect(list.inUse()).toBe(0);
		expect(list.bytes).toBe(0);
	});

	it('forgets the outline only with the last copy of the file', () => {
		const gone: string[] = [];
		const list = new PictureEntries((k) => void gone.push(k));
		const one = entry('a\u0000s\u00001x1\u0000meet', 'a', 10);
		const two = entry('a\u0000s\u00002x2\u0000meet', 'a', 10);
		list.add(one);
		list.add(two);
		list.invalidate('a');
		expect(gone).toEqual(['a\u0000s']);
		expect(list.size).toBe(0);
	});

	it('gives a peek that holds nothing and clears every copy', () => {
		const list = new PictureEntries(() => {});
		list.add(entry('a\u0000s\u0000k', 'a', 10));
		const p = list.peek('a\u0000s\u0000k')!;
		p.release();
		expect(list.inUse()).toBe(0);
		list.clear();
		expect(list.size).toBe(0);
		expect(list.bytes).toBe(0);
	});
});
