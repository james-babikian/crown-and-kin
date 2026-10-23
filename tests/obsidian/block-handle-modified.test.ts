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
import { findBlocks } from '../../src/core/block-locate';
import { HandleRegistry } from '../../src/obsidian/block-handle';

/* O3 (0.2.4): `modified` reads a note only when a handle holds it; a watcher is told in both cases. */

const text = ['```kin', 'people:', '  - id: p', '    name: Alys', '```', ''].join('\n');

function app(reads: { n: number }) {
	const files = new Map<string, TFile>();
	for (const p of ['tree.md', 'plain.md']) files.set(p, new (TFile as unknown as new (p: string) => TFile)(p));
	return {
		vault: {
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
			read: async () => {
				reads.n++;
				return text;
			},
		},
		workspace: { getLeavesOfType: () => [] },
	};
}

describe('HandleRegistry.modified', () => {
	it('reads a note with a handle once, and tells the watchers', async () => {
		const reads = { n: 0 };
		const reg = new HandleRegistry(app(reads) as never);
		const b = findBlocks(text)[0];
		await reg.resolve('tree.md', { text, lineStart: b.openLine, lineEnd: b.openLine + 4 } as never, b.body);
		reads.n = 0;
		const told: string[] = [];
		reg.watchNote((p) => told.push(p));
		reg.modified('tree.md');
		await new Promise((r) => setTimeout(r, 20));
		expect(reads.n).toBe(1);
		expect(told).toEqual(['tree.md']);
	});

	it('tells the watchers of a note with no handle and does not read it', async () => {
		const reads = { n: 0 };
		const reg = new HandleRegistry(app(reads) as never);
		const told: string[] = [];
		reg.watchNote((p) => told.push(p));
		reg.modified('plain.md');
		await new Promise((r) => setTimeout(r, 20));
		expect(reads.n).toBe(0);
		expect(told).toEqual(['plain.md']);
	});
});
