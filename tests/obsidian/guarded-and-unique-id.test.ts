import { afterEach, describe, expect, it, vi } from 'vitest';
import { guarded } from '../../src/obsidian/start-guard';
import { uniqueId } from '../../src/obsidian/sheet-parts';

/*
 * `guarded` (start-guard.ts) is the one place that turns a throwing step into a console line; `uniqueId` (sheet-parts.ts) is the one
 * place that makes the id of an element that another element points to.
 */

afterEach(() => vi.restoreAllMocks());

describe('guarded', () => {
	it('gives the result of a step that does not throw, and logs nothing', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		expect(guarded('x failed', () => 5)).toBe(5);
		expect(guarded('x failed', () => 5, 9)).toBe(5);
		expect(err).not.toHaveBeenCalled();
	});

	it('logs the label after the plugin name, with the error, and gives the fallback or nothing', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const boom = new Error('boom');
		const fail = () => {
			throw boom;
		};
		expect(guarded('cannot return the focus', fail)).toBeUndefined();
		expect(guarded('cannot prepare the picture viewer', fail, 'fallback')).toBe('fallback');
		expect(err.mock.calls).toEqual([
			['Crown and Kin: cannot return the focus', boom],
			['Crown and Kin: cannot prepare the picture viewer', boom],
		]);
	});

	it('a fallback of null or false is a fallback, not "no fallback"', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fail = (): boolean | null => {
			throw new Error('x');
		};
		expect(guarded('a', fail, null)).toBeNull();
		expect(guarded('a', fail, false)).toBe(false);
	});
});

describe('uniqueId', () => {
	it('is the prefix, a dash and the first six characters after "0." of the random number in base 36', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.123456);
		expect(uniqueId('dynasty-dialog-title')).toBe(`dynasty-dialog-title-${(0.123456).toString(36).slice(2, 8)}`);
	});

	it('gives two different ids for the same prefix', () => {
		const ids = new Set(Array.from({ length: 50 }, () => uniqueId('p')));
		expect(ids.size).toBe(50);
		for (const id of ids) expect(id).toMatch(/^p-[a-z0-9]{1,6}$/);
	});
});
