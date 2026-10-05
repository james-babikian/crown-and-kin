import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
	class TFile {
		extension = 'md';
		constructor(public path: string) {}
	}
	class MarkdownView {}
	class Modal {}
	class Notice {}
	return { TFile, MarkdownView, Modal, Notice };
});

import { TFile } from 'obsidian';
import { HandleRegistry } from '../src/obsidian/block-handle';

/*
 * Search round 0.2.4, area O, finding O3: main.ts calls `handles.modified(path)` for every Markdown `modify` event of
 * the vault. `modified` reads the whole note and scans it, also for a note that has no tree and no handle, and it keeps
 * a `lastSeen` entry for it. A sync of many notes (or a `git pull`) then reads every one of them.
 */

describe('O3: a modify event of a note with no tree', () => {
	it('does not read the note and keeps nothing for it', async () => {
		let reads = 0;
		const files = new Map<string, TFile>();
		const make = (p: string) => {
			const f = new (TFile as unknown as new (p: string) => TFile)(p);
			files.set(p, f);
			return f;
		};
		for (let i = 0; i < 200; i++) make(`n${i}.md`);
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => files.get(p) ?? null,
				read: async () => {
					reads++;
					return 'Just text, no tree here.\n';
				},
			},
			workspace: { getLeavesOfType: () => [] },
		};
		const reg = new HandleRegistry(app as never);
		for (let i = 0; i < 200; i++) reg.modified(`n${i}.md`);
		await new Promise((r) => setTimeout(r, 50));
		expect(reads).toBe(0);
		expect((reg as unknown as { lastSeen: Map<string, string[]> }).lastSeen.size).toBe(0);
	});
});
