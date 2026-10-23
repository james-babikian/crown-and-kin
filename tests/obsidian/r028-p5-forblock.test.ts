import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HandleRegistry, FOR_BLOCK_WAIT_MS } from '../../src/obsidian/block-handle';
import { VIEW_NOTICE } from '../../src/render/view-text';
import { TFile, resetObsidian } from '../acceptance/fake-obsidian';

/*
 * 0.2.8 F-VIEW-04: `forBlock` waits for a slow write of the note (up to FOR_BLOCK_WAIT_MS), and tells the caller when it gave up, so
 * the link update shows a Notice and does not drop the note without a word.
 */

beforeEach(() => {
	resetObsidian();
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const NOTE = ['# Note', '', '```kin', 'people:', '  - id: alys', '    name: Alys', '    link: "[[Old Name]]"', '```', ''].join('\n');

function registry() {
	const file = new TFile('n.md', 'md');
	const app = {
		vault: { getAbstractFileByPath: (p: string) => (p === 'n.md' ? file : null), read: async () => NOTE, process: async (_f: unknown, fn: (t: string) => string) => fn(NOTE) },
		workspace: { getLeavesOfType: () => [] },
	};
	return { reg: new HandleRegistry(app as never), file };
}

describe('HandleRegistry.forBlock (F-VIEW-04)', () => {
	it('a write that ends inside the limit still gives the handle', async () => {
		const { reg } = registry();
		const done = reg.beginWrite(() => 'n.md');
		const p = reg.forBlock('n.md', 0, () => {
			throw new Error('no give-up expected');
		});
		await vi.advanceTimersByTimeAsync(700);
		done();
		await vi.advanceTimersByTimeAsync(100);
		expect(await p).not.toBeNull();
	});

	it('a note that stays busy past the limit gives null and says so through onBusy', async () => {
		const { reg } = registry();
		reg.beginWrite(() => 'n.md');
		const busy = vi.fn();
		const p = reg.forBlock('n.md', 0, busy);
		await vi.advanceTimersByTimeAsync(FOR_BLOCK_WAIT_MS + 500);
		expect(await p).toBeNull();
		expect(busy).toHaveBeenCalledTimes(1);
	});

	it('a block that is gone is null and no give-up', async () => {
		const { reg } = registry();
		const busy = vi.fn();
		expect(await reg.forBlock('n.md', 5, busy)).toBeNull();
		expect(await reg.forBlock('missing.md', 0, busy)).toBeNull();
		expect(busy).not.toHaveBeenCalled();
	});
});

describe('the Notice of a give-up', () => {
	it('the text names the note, the old link and the new text', () => {
		const t = VIEW_NOTICE.renameGaveUp('Notes/Family', 'Old Name', 'New Name');
		expect(t).toContain('Notes/Family');
		expect(t).toContain('“Old Name”');
		expect(t).toContain('“New Name”');
		expect(t).toContain('took too long');
		expect(t).toBe('After a rename, the plugin updates the links in the trees. In the note Notes/Family, this update took too long, and the plugin stopped it. If a tree in the note still has the link “Old Name”, replace it with “New Name”.');
	});

});
