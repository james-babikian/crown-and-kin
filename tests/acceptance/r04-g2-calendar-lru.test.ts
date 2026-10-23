import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calVault, cycleNote, makeIndex } from '../support/r04-calendar-fakes';
import { turns } from '../support/fake-fence-vault';

/*
 * G2 probe of part 3: the 200-key least-recently-used list of the calendar index with 201 or more trees in use at once. Each view asks `readerFor` for its key on every
 * draw, in the same order. With more keys than the list holds, each ask finds its key gone (the list drops the oldest one, which is the next one to be asked): the answer is
 * always the `pending` reader, a new load starts, the load ends with `onChange`, the views draw again, and the cycle never ends.
 */

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const later = async (ms = 1000): Promise<void> => {
	await turns();
	await vi.advanceTimersByTimeAsync(ms);
	await turns();
};

describe('more keys in use than the list keeps', () => {
	it('201 views that draw in turn get a ready reader after the loads, and no further change follows', async () => {
		const N = 201;
		const files: Record<string, string> = {};
		const links: Record<string, string> = {};
		for (let i = 0; i < N; i++) {
			files[`Cal${i}.md`] = cycleNote(`Count ${i}`);
			links[`[[Cal${i}]]`] = `Cal${i}.md`;
		}
		const vault = calVault(files, links);
		const index = await makeIndex(vault, {});
		let changes = 0;
		// The views draw again when the index tells a change, as `redrawForDates` does.
		const draw = (): number => {
			let pending = 0;
			for (let i = 0; i < N; i++) if (index.readerFor(`t${i}.md`, `[[Cal${i}]]`).key === 'pending') pending++;
			return pending;
		};
		index.onChange(() => {
			changes++;
			draw();
		});
		draw();
		// Time enough for any number of loads to end.
		await later(20_000);
		const settledChanges = changes;
		await later(20_000);
		// A quiet index: no further change and nothing pending.
		expect(changes).toBe(settledChanges);
		expect(draw()).toBe(0);
	});
});
