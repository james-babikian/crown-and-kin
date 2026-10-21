import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { clock, fakeWin, flushFrames, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, phone } from './acceptance/tree-view-fakes';

/*
 * Search round 0.2.8, area A4 (view). Each test fails on release-0.2.8 (770f24b) for the reason in its name.
 * Run: npx vitest run tests/review-r028-view*.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const PICS = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}
people:
  - {id: ann, name: Ann, house: va, born: 1100, portrait: "[[ann.png]]"}
`;

/** A picture store whose files are found but whose file check says "too large". */
function badStore(onCheck: () => void = () => {}) {
	return {
		resolve: (link: string) => ({ ok: true, file: { path: link.replace(/[[\]]/g, ''), name: link.replace(/[[\]]/g, '') }, format: 'png' }),
		check: async () => {
			onCheck();
			return { ok: false, code: 'picture-too-large', file: 'va-arms.png' };
		},
		acquire: async () => null,
		onChange: () => () => {},
	};
}

const badgeCount = (el: { querySelector(s: string): { getText(): string } | null }) => el.querySelector('.dynasty-warning-badge .dynasty-warning-count')?.getText() ?? null;

describe('F-VIEW-01: the phone list never checks the picture files', () => {
	it('desktop control: a file the store calls too large puts a warning on the badge', async () => {
		desktop();
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = badStore();
		const { el } = await embed(PICS, { host, handle: fakeHandle('n.md', PICS) });
		flushFrames();
		runTimers(1000);
		await settle();
		flushFrames();
		await settle();
		expect(badgeCount(el as never)).not.toBeNull();
	});

	it('phone list: the same file shows no warning at all, because checkPictures never runs in list mode', async () => {
		phone();
		let checks = 0;
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = badStore(() => checks++);
		const { el } = await embed(PICS, { host, handle: fakeHandle('n.md', PICS) });
		flushFrames();
		runTimers(1000);
		await settle();
		flushFrames();
		await settle();
		expect(el.querySelector('.dynasty-list-row')).not.toBeNull();
		expect(checks).toBeGreaterThan(0);
		expect(badgeCount(el as never)).not.toBeNull();
	});
});

describe('I06 evidence: a desktop tree does not recover when the metadata cache finishes', () => {
	it('desktop: a picture link that was unknown at the first draw stays a warning after the cache event "resolved" (only the phone list listens)', async () => {
		desktop();
		let known = false;
		const store = {
			resolve: (link: string) => (known ? { ok: true, file: { path: link.replace(/[[\]]/g, ''), name: 'x.png' }, format: 'png' } : { ok: false, code: 'missing-picture', file: link }),
			check: async () => null,
			acquire: async () => null,
			onChange: () => () => {},
		};
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = store;
		let resolved: (() => void) | null = null;
		(host.app.metadataCache as unknown as { on: unknown }).on = (name: string, fn: () => void) => {
			if (name === 'resolved') resolved = fn;
			return {};
		};
		const { el } = await embed(PICS, { host, handle: fakeHandle('n.md', PICS) });
		flushFrames();
		await settle();
		expect(badgeCount(el as never)).not.toBeNull();
		known = true;
		resolved!();
		await settle();
		flushFrames();
		expect(badgeCount(el as never)).toBeNull();
	});
});

describe('F-VIEW-02: one failed read marks a picture "not a picture" until the app restarts', () => {
	it('a read that fails once (a file not yet downloaded) is remembered as picture-not-image; the next request does not read again', async () => {
		const { createPictureStore } = await import('../src/obsidian/picture-store');
		const { TFile } = await import('./acceptance/fake-obsidian');
		const { pngHead } = await import('./acceptance/m9-support');
		const f = Object.assign(new TFile('arms.png', 'png'), { name: 'arms.png', basename: 'arms', stat: { mtime: 1, ctime: 1, size: 1000 } });
		let reads = 0;
		const bytes = pngHead(200, 200);
		const io = {
			read: async () => {
				reads++;
				if (reads === 1) throw new Error('EBUSY: the file is not available yet');
				return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
			},
			decode: async () => ({ width: 200, height: 200, source: {} as CanvasImageSource, close() {} }),
			encode: async () => new Blob([new Uint8Array(100)], { type: 'image/png' }),
			rgba: async (_s: unknown, w: number, h: number) => new Uint8ClampedArray(w * h * 4),
			coarse: () => true,
			dpr: () => 3,
		};
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const store = createPictureStore({ metadataCache: {}, vault: {}, fileManager: {} } as never, io as never);
		const box = { w: 24, h: 24, fit: 'meet' as const };
		const first = await store.acquire(f as never, box);
		expect(first).toMatchObject({ ok: false, code: 'picture-not-image' });
		// The file is readable now (the sync finished). A later request, for example when the note is opened again, should try again.
		const second = await store.acquire(f as never, box);
		expect(second && 'url' in second ? 'copy' : second).toBe('copy');
		expect(reads).toBe(2);
	});
});

describe('F-VIEW-03: a view takes the state of the handle at its old ordinal before it knows its own block', () => {
	it('block A deleted from the editor before the registry has read the note: the redrawn block B uses and changes the state of handle A', async () => {
		const { HandleRegistry } = await import('../src/obsidian/block-handle');
		const { findBlocks } = await import('../src/core/block-locate');
		const { TFile: FakeTFile, MarkdownView: FakeMV } = await import('./acceptance/fake-obsidian');
		const { TreeView } = await import('../src/obsidian/tree-view');
		const { FEl, resizeAll } = await import('./acceptance/fake-dom');
		const fence = (b: string) => ['```kin', b, '```'].join('\n');
		const XA = 'people:\n  - id: alys\n    name: Alys';
		const YB = 'people:\n  - id: yara\n    name: Yara';
		const t0 = [fence(XA), '', fence(YB), ''].join('\n');
		let text = t0;
		const file = Object.assign(new FakeTFile('n.md', 'md'), {});
		const vaultApp = {
			vault: { getAbstractFileByPath: (p: string) => (p === 'n.md' ? file : null), read: async () => text, process: async (_f: unknown, fn: (t: string) => string) => (text = fn(text)) },
			workspace: { getLeavesOfType: () => [] },
		};
		void FakeMV;
		const reg = new HandleRegistry(vaultApp as never);
		const handleOf = async (ordinal: number, from: string) => {
			const b = findBlocks(from)[ordinal];
			return (await reg.resolve('n.md', { text: from, lineStart: b.openLine, lineEnd: b.openLine + b.body.split('\n').length + 1 } as never, b.body))!;
		};
		const hA = await handleOf(0, t0);
		const hB = await handleOf(1, t0);
		hA.state.focus = { id: 'alys' };
		hA.state.view = { scale: 1, cx: 9999, cy: 9999 };
		hA.state.viewFor = '';
		hA.state.views = { down: { view: hA.state.view, viewFor: '' } };

		// The user deletes block A in the editor. Obsidian draws block B again as block 0; the file event has not come yet.
		const t1 = [fence(YB), ''].join('\n');
		text = t1;
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { handles: unknown }).handles = reg;
		desktop();
		const el = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ text: t1, lineStart: 0, lineEnd: 3 }), addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, YB, { kind: 'embed', ctx } as never);
		view.load();
		// The first layout comes before the file read of `resolve` ends, as on a phone.
		const vp = el.querySelector('.dynasty-viewport')!;
		vp.clientWidth = 360;
		vp.clientHeight = 400;
		resizeAll();
		flushFrames();
		await settle();
		// B is now block 0 and its handle moved there.
		expect(hB.key.ordinal).toBe(0);
		// Handle A belongs to the deleted block: nothing of block B may read it or change it.
		const t = el.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '';
		expect.soft(t, 'block B opens at the saved view of the deleted block A').not.toContain('9819');
		expect.soft(hA.state.focus, 'the state of handle A is changed by block B').toEqual({ id: 'alys' });
	});
});

describe('F-VIEW-04: a link update meets a slow write and drops the whole note without a notice', () => {
	it('forBlock gives null (the block is "gone") for a note whose block exists, when a write runs longer than half a second', async () => {
		const { HandleRegistry } = await import('../src/obsidian/block-handle');
		const { findBlocks } = await import('../src/core/block-locate');
		const { TFile: FakeTFile } = await import('./acceptance/fake-obsidian');
		const { LinkUpdater } = await import('../src/obsidian/rename-links');
		const fence = (b: string) => ['```kin', b, '```'].join('\n');
		const X = 'people:\n  - id: alys\n    name: Alys\n    link: "[[Old Name]]"';
		let text = ['# Note', '', fence(X), ''].join('\n');
		const file = new FakeTFile('n.md', 'md');
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (p === 'n.md' ? file : null),
				read: async () => text,
				// A slow disk or a sync lock: the write takes 700 ms.
				process: async (_f: unknown, fn: (t: string) => string) => {
					const next = fn(text);
					await new Promise((r) => setTimeout(r, 700));
					text = next;
					return text;
				},
			},
			workspace: { getLeavesOfType: () => [] },
		};
		const reg = new HandleRegistry(app as never);
		const b = findBlocks(text)[0];
		const h = (await reg.resolve('n.md', { text, lineStart: b.openLine, lineEnd: b.openLine + 4 } as never, b.body))!;
		void LinkUpdater;
		// The user saves a change in the sheet; the write is under way when the link update asks for the block.
		const write = h.write({ kind: 'set-person-fields', id: 'alys', fields: { title: 'Queen' } });
		await new Promise((r) => setTimeout(r, 20));
		const got = await reg.forBlock('n.md', 0);
		await write;
		expect(findBlocks(text)).toHaveLength(1);
		expect(got).not.toBeNull();
	}, 10_000);
});
