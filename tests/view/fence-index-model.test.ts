import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFenceIndex } from '../../src/view/fence-index';
import { fakeFenceVault, fakeStore, turns } from '../support/fake-fence-vault';
import { Rng } from '../support/rng';

/*
 * G2 probe of part 3: a model test of the fence index. Random events (edit, add, remove, rename, with and without the `changed` event) come in the middle of the
 * verify pass (from inside `read`). When the index says `complete`, every note that really holds a tree must be in `notes('kin')` or in `unsure()`: the rename
 * scan reads those two sets only.
 */

const KIN = '```kin\npeople:\n  - id: a\n    name: A\n```\n';
const JS = '```js\nlet x = 1;\n```\n';
const PLAIN = 'Text.\n';
const TEXTS = [KIN, JS, PLAIN, `${JS}\n${KIN}`];

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const truth = (texts: Map<string, string>): string[] => [...texts].filter(([, t]) => t.includes('```kin\n')).map(([p]) => p).sort();

describe('fence index model', () => {
	for (let seed = 1; seed <= 300; seed++) {
		it(`seed ${seed}: a complete index misses no tree note`, async () => {
			const rng = new Rng(seed);
			const init: Record<string, string> = {};
			const n = 6 + rng.int(10);
			for (let i = 0; i < n; i++) init[`n${i}.md`] = rng.pick(TEXTS);
			const vault = fakeFenceVault(init, { cacheDone: rng.chance(0.7) });
			const store = fakeStore();
			// A second start on a store from a first one (so that stamps and renames meet).
			if (rng.chance(0.5)) {
				const first = createFenceIndex(fakeFenceVault(init), store);
				void first.start();
				await vi.advanceTimersByTimeAsync(1);
				await turns(200);
				first.dispose();
			}
			const idx = createFenceIndex(vault, store);
			let fresh = 100;
			const op = (): void => {
				const paths = [...vault.texts.keys()];
				if (!paths.length) return;
				const p = rng.pick(paths);
				const cache = rng.chance(0.6);
				switch (rng.int(5)) {
					case 0:
						vault.edit(p, rng.pick(TEXTS), { cache });
						break;
					case 1:
						vault.add(`n${fresh++}.md`, rng.pick(TEXTS), { cache });
						break;
					case 2:
						vault.remove(p);
						break;
					case 3:
						vault.rename(p, `r${fresh++}.md`);
						break;
					default:
						break;
				}
			};
			let ops = 0;
			vault.onRead = () => {
				if (ops++ < 12 && rng.chance(0.5)) op();
			};
			// Some events come before the pass, some after.
			const before = rng.int(3);
			void idx.start();
			for (let i = 0; i < before; i++) op();
			await vi.advanceTimersByTimeAsync(1);
			await turns(300);
			if (rng.chance(0.5)) op();
			await vi.advanceTimersByTimeAsync(20_000);
			await turns(300);
			await vi.advanceTimersByTimeAsync(20_000);
			expect(idx.complete).toBe(true);
			const known = new Set([...idx.notes('kin'), ...idx.unsure()]);
			const missed = truth(vault.texts).filter((p) => !known.has(p));
			expect(missed).toEqual([]);
			idx.dispose();
		});
	}
});
