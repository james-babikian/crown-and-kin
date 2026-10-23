import { describe, expect, it, vi } from 'vitest';

/*
 * G2 review of 0.4 (scratch). `vaultPath` (normalizePath) is applied to the real path of an EXISTING folder,
 * so a folder whose name has a no-break space (or a decomposed letter) is no longer the folder that gets the new note.
 */

import type { App } from 'obsidian';
import { makeNote } from '../../src/obsidian/table-note';
import { freePath } from '../../src/obsidian/save-picture';

function appWithFolder(realPath: string) {
	const created: string[] = [];
	const folder = { path: realPath, name: realPath, isRoot: () => false, children: [] as unknown[] };
	const app = {
		fileManager: { getNewFileParent: () => folder, getAvailablePathForAttachment: async (n: string) => `${realPath}/${n}` },
		vault: {
			create: vi.fn(async (path: string) => {
				// Obsidian refuses to create a file in a folder that does not exist.
				if (!path.startsWith(`${realPath}/`)) throw new Error(`ENOENT: parent folder of ${path} does not exist`);
				created.push(path);
				return { path };
			}),
			getAbstractFileByPath: () => null,
			createFolder: vi.fn(),
			getRoot: () => ({ isRoot: () => true, path: '/', children: [] }),
		},
	};
	return { app: app as unknown as App, created };
}

describe('G2: vaultPath on the path of an existing folder', () => {
	it('makeNote puts the note in the folder that Obsidian chose, also when its name has a no-break space', async () => {
		const real = 'Notes Kings';
		const { app, created } = appWithFolder(real);
		const r = await makeNote(app, 'Trees/t.md', 'Aldric', 'x');
		expect(r.ok, JSON.stringify(r)).toBe(true);
		expect(created).toEqual([`${real}/Aldric.md`]);
	});

	it('makeNote puts the note in the folder that Obsidian chose, also when its name is decomposed (NFD)', async () => {
		const real = 'Café';
		const { app, created } = appWithFolder(real);
		const r = await makeNote(app, 'Trees/t.md', 'Aldric', 'x');
		expect(r.ok, JSON.stringify(r)).toBe(true);
		expect(created).toEqual([`${real}/Aldric.md`]);
	});

	it('freePath returns the path that Obsidian gave for the attachment, also with a no-break space in the folder', async () => {
		const real = 'Pictures for Kings';
		const { app } = appWithFolder(real);
		expect(await freePath(app, 'a.png', 'Trees/t.md')).toBe(`${real}/a.png`);
	});
});
