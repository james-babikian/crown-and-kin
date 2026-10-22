// Behaviour of the helpers that the 0.3.3 clean-up (WP-1 A4) merged into one place, and the two stops that the plugin calls when it is turned off.
// Kept from the proofs of the code-steward (tests/r033-steward-proofs.test.ts, split in the after-pass): these have no other test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { YAMLMap, YAMLSeq } from 'yaml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPair, isRefusal, parse, topMap } from '../src/core/yaml-patch';
import { FEl, installDom, resetDom } from './acceptance/fake-dom';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the helpers that were two copies', () => {
	it('andList joins a list of texts with commas and "and"', async () => {
		const { andList } = await import('../src/core/messages');
		const cases: [string[], string][] = [[[], ''], [['a'], 'a'], [['a', 'b'], 'a and b'], [['a', 'b', 'c'], 'a, b and c'], [['a', 'b', 'c', 'd'], 'a, b, c and d'], [['', ''], ' and '], [['x, y', 'z'], 'x, y and z']];
		for (const [xs, want] of cases) expect(andList(xs), JSON.stringify(xs)).toBe(want);
	});

	it('isWhole is true for a safe whole number only', async () => {
		const { isWhole } = await import('../src/core/dates');
		for (const v of [0, 1, -1, 2 ** 53 - 1]) expect(isWhole(v), String(v)).toBe(true);
		for (const v of [1.5, NaN, Infinity, 2 ** 53, '1', null, undefined, {}, []]) expect(isWhole(v), String(v)).toBe(false);
	});

	it('finite keeps a finite number and gives the fallback for any other', async () => {
		const { finite } = await import('../src/core/portrait-crop');
		expect(finite(1.5, 7)).toBe(1.5);
		for (const v of [NaN, Infinity, -Infinity]) expect(finite(v, 7), String(v)).toBe(7);
	});

	it('emptyItems turns a list into `[]` and keeps the comment and the next key', async () => {
		const { emptyItems } = await import('../src/core/yaml-list');
		const emptied = (body: string) => {
			const p = parse(body);
			if (isRefusal(p)) throw new Error('parse');
			const pair = findPair(topMap(p) as YAMLMap, 'holders')!;
			const patches = emptyItems(p.src, pair.value as YAMLSeq, p.src.colonEnd(pair));
			// The patches do not overlap, so applying them from the end keeps the earlier positions.
			return [...patches].sort((a, b) => b.start - a.start).reduce((t, x) => t.slice(0, x.start) + x.text + t.slice(x.end), body);
		};
		expect(emptied('holders: [a, b] # note\n')).toBe('holders: [] # note\n');
		expect(emptied('holders:\n  - a\n  - b\nnext: 1\n')).toBe('holders: []\nnext: 1\n');
		expect(emptied('holders: []\n')).toBe('holders: []\n');
	});

	it('lockMap: a frozen Map and a relation result both refuse set, delete and clear', async () => {
		const { deepFreeze } = await import('../src/core/deep-freeze');
		const { computeRelations } = await import('../src/core/relations');
		const { parseDynasty } = await import('../src/core/parse');
		const { deriveFamilies } = await import('../src/core/derive');
		const frozen = deepFreeze(new Map([['a', 1]]));
		const parsed = parseDynasty('people:\n  - {id: a, name: A, sex: m}\n');
		if (!parsed.ok) throw new Error('parse');
		const rel = computeRelations(deriveFamilies(parsed.tree), 'a') as Map<string, unknown>;
		for (const m of [frozen as Map<string, unknown>, rel]) {
			expect(() => m.set('x', 1)).toThrow(TypeError);
			expect(() => m.delete('a')).toThrow(TypeError);
			expect(() => m.clear()).toThrow(TypeError);
			expect(() => m.set('x', 1)).toThrow('Cached results are read-only');
		}
	});
});

describe('the shared ResizeObserver of render/text-join.ts', () => {
	type Callback = (entries: { target: unknown }[]) => void;
	let callback: Callback = () => undefined;
	let watched: unknown[] = [];
	let disconnects = 0;

	beforeEach(() => {
		installDom();
		resetDom();
		watched = [];
		disconnects = 0;
		(globalThis as Record<string, unknown>).ResizeObserver = class {
			constructor(cb: Callback) {
				callback = cb;
			}
			observe(t: unknown) {
				watched.push(t);
			}
			unobserve(t: unknown) {
				watched = watched.filter((w) => w !== t);
			}
			disconnect() {
				disconnects++;
				watched = [];
			}
		};
		vi.resetModules();
	});

	it('lets go of a box that the observer reports as gone, and keeps the others', async () => {
		const { joined } = await import('../src/render/text-join');
		const boxes = [1, 2, 3].map(() => joined(new FEl('div') as never, 'x', ['A', 'B']));
		// A removed box that had a size is reported once (Chrome: contentRect 0, isConnected false) and then let go:
		(boxes[0] as unknown as FEl).isConnected = false;
		callback([{ target: boxes[0] }]);
		expect(watched).toEqual([boxes[1], boxes[2]]);
		// A removed box with no size (display: none) gets no callback in Chrome (measured 2026-10-21), so the observer holds it until the plugin stops it.
		expect(watched).toHaveLength(2);
	});

	it('stopJoinedWatch disconnects the observer and lets go of every box; a later joined text watches again', async () => {
		const { joined, stopJoinedWatch } = await import('../src/render/text-join');
		const box = joined(new FEl('div') as never, 'x', ['A', 'B']);
		expect(watched).toEqual([box]);
		stopJoinedWatch();
		expect(disconnects).toBe(1);
		expect(watched).toEqual([]);
		const again = joined(new FEl('div') as never, 'x', ['A', 'B']);
		expect(watched).toEqual([again]);
		// A second stop with nothing watched is harmless.
		stopJoinedWatch();
		stopJoinedWatch();
		expect(disconnects).toBe(2);
	});

	it('the plugin stops it when it is turned off: a call in onunload (onload is at its size-rule ceiling of 86 lines), not in onload', () => {
		const main = read('src/obsidian/main.ts');
		const at = main.indexOf('override onunload');
		expect(main.slice(at, at + 300)).toContain('stopJoinedWatch();');
		expect(main.slice(0, at)).not.toContain('stopJoinedWatch();');
	});
});

describe('the plugin stops the viewer motion when it is turned off', () => {
	it('main.ts calls the function that bindViewerMotion returns in onunload', () => {
		const main = read('src/obsidian/main.ts');
		expect(main.match(/viewerMotion/g)).toHaveLength(2);
		const at = main.indexOf('override onunload');
		expect(main.slice(at, at + 300)).toContain('this.viewerMotion();');
	});
});
