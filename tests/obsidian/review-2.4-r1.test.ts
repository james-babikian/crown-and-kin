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
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { findBlocks } from '../../src/core/block-locate';

const block = (body: string) => ['```kin', body, '```'].join('\n');
const A = 'people:\n  - id: a\n    name: Alys';
const B = 'people:\n  - id: b\n    name: Bran';

/** vault.read takes the text when called and returns it only when released (a slow disk read). */
function slowVault(path: string, initial: string) {
	let text = initial;
	const file = new (TFile as unknown as new (p: string) => { path: string; extension: string })(path);
	const pending: (() => void)[] = [];
	let slow = false;
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === path ? file : null),
			read: () => {
				const snap = text;
				if (!slow) return Promise.resolve(snap);
				return new Promise<string>((r) => pending.push(() => r(snap)));
			},
			process: async (_f: unknown, fn: (t: string) => string) => (text = fn(text)),
		},
		workspace: { getLeavesOfType: () => [] },
	};
	return { app, get: () => text, set: (t: string) => (text = t), slow: (on: boolean) => (slow = on), release: () => pending.splice(0).forEach((f) => f()) };
}

describe('review 2.4 r1: a resolve whose read overlaps a write', () => {
	it('does not put the old body back on the handle', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = slowVault(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const info = { text: t0, lineStart: 2, lineEnd: 6 } as never;
		const h = (await reg.resolve(path, info, A))!;
		// A second view of the block (another pane, or a re-render) starts to resolve; its read is slow.
		v.slow(true);
		const second = reg.resolve(path, info, A);
		// Meanwhile a Save writes the block (Reading view: vault.process).
		expect((await h.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'Alys II' } })).ok).toBe(true);
		const written = h.body;
		expect(findBlocks(v.get())[0].body).toBe(written);
		// The slow read returns the text from before the write; resolve() calls applyText with it.
		v.release();
		await second;
		expect(h.body).toBe(written); // fixed in round 2: an overlapped read does not replace bodies
	});

	it('so the next Save is refused as stale although nothing else changed the note', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), ''].join('\n');
		const v = slowVault(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const info = { text: t0, lineStart: 2, lineEnd: 6 } as never;
		const h = (await reg.resolve(path, info, A))!;
		v.slow(true);
		const second = reg.resolve(path, info, A);
		await h.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'Alys II' } });
		v.release();
		await second;
		v.slow(false);
		const out = await h.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'Alys III' } });
		expect(out.ok).toBe(true); // fixed in round 2
	});
});

describe('review 2.4 r1: rule (a), same number of blocks', () => {
	it('two blocks swapped in one change: each handle follows its own block (rule changed in fix round 2)', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), '', block(B), ''].join('\n');
		const v = slowVault(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const hA = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		const hB = (await reg.resolve(path, { text: t0, lineStart: 8, lineEnd: 12 } as never, B))!;
		v.set(['# Note', '', block(B), '', block(A), ''].join('\n'));
		await reg.sync(path);
		expect(hA.body).toBe(A);
		expect(hA.key.ordinal).toBe(1);
		expect(hB.body).toBe(B);
		expect(hB.key.ordinal).toBe(0);
	});

	it('after a swap, an open sheet (holding the handle) writes its person into its own block', async () => {
		const path = 'n.md';
		const t0 = ['# Note', '', block(A), '', block(B), ''].join('\n');
		const v = slowVault(path, t0);
		const reg = new HandleRegistry(v.app as never);
		const hA = (await reg.resolve(path, { text: t0, lineStart: 2, lineEnd: 6 } as never, A))!;
		v.set(['# Note', '', block(B), '', block(A), ''].join('\n'));
		// No sync before the Save: the write finds the swap itself (stale, then the block moved).
		const out = await hA.write({ kind: 'set-person-fields', id: 'a', fields: { name: 'Alys II' } });
		expect(out.ok).toBe(true);
		const [b0, b1] = findBlocks(v.get());
		expect(b0.body).toBe(B);
		expect(b1.body).toContain('Alys II');
	});
});
