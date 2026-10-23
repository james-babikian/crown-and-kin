import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFenceIndex } from '../../src/view/fence-index';
import { fakeFenceVault, fakeStore, turns } from '../support/fake-fence-vault';

/*
 * G2 probe of part 3. The safety timer and the verify pass trust `sectionState === 'no'` (the metadata cache lists no section that can hold a block) and
 * stamp the note as "no fence" without a read. If the metadata cache has not indexed the new text yet, that answer is for the OLD text. The stamp is saved,
 * so a later start trusts it too. The `changed` event normally corrects the answer a moment later; this test fires it never (the app ends first, or the
 * indexing is slower than the safety wait).
 */

const KIN = '```kin\npeople:\n  - id: a\n    name: A\n```\n';

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('a stale metadata cache is stamped as "no fence"', () => {
	it('a modified note with a tree, whose cache still says "no section", is taken as no tree for good', async () => {
		const vault = fakeFenceVault({ 'a.md': 'Just text.\n', 'b.md': 'More text.\n' });
		const store = fakeStore();
		const idx = createFenceIndex(vault, store);
		void idx.start();
		await vi.advanceTimersByTimeAsync(1);
		await turns(100);
		expect(idx.complete).toBe(true);
		// A sync tool writes a tree into a.md. The metadata cache has not indexed it yet: sectionState still says 'no'. No `changed` event comes in the safety wait.
		vault.sections.set('a.md', 'no');
		vault.edit('a.md', KIN, { cache: false });
		await vi.advanceTimersByTimeAsync(5000);
		await turns(100);
		// The fix (D282): a note with a `modify` event is read, so the stale 'no' is not trusted. The proof first asserted that no read happened; that was the fault itself.
		expect(vault.reads.filter((p) => p === 'a.md')).toEqual(['a.md']);
		expect(idx.notes('kin')).toContain('a.md');
		// Read and proved: the note is a tree note and no longer unsure (the proof asserted both 'listed' and 'unsure', which no correct index gives).
		expect(idx.unsure().has('a.md')).toBe(false);
	});

	it('the "no fence" stamp reaches the saved copy, so the next start trusts it', async () => {
		const vault = fakeFenceVault({ 'a.md': 'Just text.\n' });
		const store = fakeStore();
		const idx = createFenceIndex(vault, store);
		void idx.start();
		await vi.advanceTimersByTimeAsync(1);
		await turns(100);
		vault.sections.set('a.md', 'no');
		vault.edit('a.md', KIN, { cache: false });
		await vi.advanceTimersByTimeAsync(5000);
		await turns(100);
		idx.dispose();
		// Next start: the file is the same (same stamp); the saved copy says no tree.
		const next = vault.clone();
		const second = createFenceIndex(next, store);
		void second.start();
		await vi.advanceTimersByTimeAsync(1);
		await turns(100);
		expect(second.complete).toBe(true);
		expect(second.notes('kin')).toContain('a.md');
	});
});
