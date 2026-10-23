import { beforeEach, describe, expect } from 'vitest';
import { speedTest } from '../support/speed-test';

import { TFile as VaultFile } from 'obsidian';
import { resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.8 G3 said the picture picker opens in 333 to 485 ms (target 300 ms, spec 13.14). The harness timer starts at the click that
 * opens the arms menu, so it also counts the 150 ms wait of `clickMenuOf` and the lookup of the menu item. This test times what the
 * plugin itself does from the call to the first drawn rows, for the 2 000 pictures in 100 folders of the spec; the budget is far
 * below 300 ms, so a slow step (a sort or a search of the whole vault on every open) fails here before the harness sees it.
 */
useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
});

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function vault(n: number, folders: number): VaultFile[] {
	const out: VaultFile[] = [];
	const add = (path: string, ext: string) => out.push(Object.assign(new File(path, ext), { name: path.slice(path.lastIndexOf('/') + 1), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile);
	for (let i = 0; i < n; i++) add(`Art/f${i % folders}/pic ${i}.png`, 'png');
	for (let i = 0; i < n; i++) add(`Notes/n${i}.md`, 'md');
	return out;
}

describe('the picture picker opens fast on a large vault', () => {
	speedTest('2 000 pictures in 100 folders: the call to the first rows takes under 100 ms of plugin work', async () => {
		const files = vault(2000, 100);
		const { pickPicture } = await import('../../src/obsidian/picture-picker');
		const app = { vault: { getFiles: () => files, getAbstractFileByPath: () => null }, fileManager: { generateMarkdownLink: () => '' }, metadataCache: {}, loadLocalStorage: () => null, saveLocalStorage: () => {} };
		const t0 = performance.now();
		void pickPicture(app as never, { sourcePath: 'n.md', title: 'T' });
		const ms = performance.now() - t0;
		const m = openModals[openModals.length - 1] as unknown as { contentEl: { querySelectorAll(s: string): unknown[] }; close(): void };
		await settle();
		expect(m.contentEl.querySelectorAll('[role="treeitem"]').length).toBeGreaterThan(1);
		m.close();
		expect(ms).toBeLessThan(100);
	});
});
