import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFenceIndex } from '../../src/view/fence-index';
import { fakeFenceVault, fakeStore, turns } from '../support/fake-fence-vault';

/*
 * Fix round of part 3 (D282), item 7: the "no section" answer of the metadata cache is trusted only for a note that has no stamp and had no `create` or `modify` event in this session.
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

async function started(files: Record<string, string>) {
	const vault = fakeFenceVault(files);
	const idx = createFenceIndex(vault, fakeStore());
	void idx.start();
	await vi.advanceTimersByTimeAsync(1);
	await turns(100);
	expect(idx.complete).toBe(true);
	return { vault, idx };
}

describe('the "no section" shortcut of the fence index', () => {
	it('a note that never had a stamp is not read when the finished cache lists no section (first start)', async () => {
		const { vault } = await started({ 'a.md': 'Text.\n', 'b.md': 'More.\n' });
		expect(vault.reads).toEqual([]);
	});

	it('a modified note whose `changed` event comes is not read: the event brings the text', async () => {
		const { vault, idx } = await started({ 'a.md': 'Text.\n' });
		vault.edit('a.md', KIN);
		await vi.advanceTimersByTimeAsync(5000);
		expect(vault.reads).toEqual([]);
		expect(idx.notes('kin')).toEqual(['a.md']);
	});

	it('a renamed note that had a `modify` event with a stale cache is read at its new path', async () => {
		const { vault, idx } = await started({ 'a.md': 'Text.\n' });
		vault.sections.set('a.md', 'no');
		vault.edit('a.md', KIN, { cache: false });
		vault.sections.set('b.md', 'no');
		vault.rename('a.md', 'b.md');
		await vi.advanceTimersByTimeAsync(5000);
		await turns(100);
		expect(vault.reads).toContain('b.md');
		expect(idx.notes('kin')).toEqual(['b.md']);
	});
});
