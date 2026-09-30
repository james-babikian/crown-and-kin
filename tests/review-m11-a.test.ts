import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { buildPictureTree, searchRows } from '../src/core/picture-list';
import { FEl, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { pickerModule } from './acceptance/m11-support';

/* Code review, M11 area A (picture list and house page). Run: npx vitest run tests/review-m11-a.test.ts */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}
const VAULT = ['Art/lion.png', 'Art/eagle.png', 'root.png'].map(file);

type Picker = { contentEl: FEl; modalEl: FEl; close(): void };

function app(createBinary?: (path: string, data: ArrayBuffer) => Promise<unknown>) {
	return {
		metadataCache: { getFirstLinkpathDest: () => null },
		vault: { getAbstractFileByPath: () => null, getFiles: () => VAULT, createBinary },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

async function pick(o: { current?: VaultFile | null; app?: unknown } = {}) {
	const M = (await pickerModule()) as { pickPicture: (a: never, o: never) => Promise<string | null> };
	let result: string | null | undefined;
	const done = M.pickPicture((o.app ?? app()) as never, { sourcePath: 'Trees/Tree.md', title: 'Select', current: o.current ?? null } as never).then((v) => (result = v));
	const m = openModals[openModals.length - 1] as unknown as Picker;
	return { m, done, result: () => result };
}
const search = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-search')!;

describe('A1: IME composition', () => {
	it('Enter that confirms an IME composition (isComposing) does not choose the current picture', async () => {
		const { m, result } = await pick({ current: VAULT[0] });
		dispatch(search(m), 'keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
		await settle();
		expect(result()).toBeUndefined();
		expect(openModals).toHaveLength(1);
	});

	it('Arrow keys during a composition are not taken from the IME (no preventDefault, no cursor move)', async () => {
		const { m } = await pick();
		const e = dispatch(search(m), 'keydown', { key: 'ArrowDown', isComposing: true, keyCode: 229 });
		expect(e.defaultPrevented).toBe(false);
	});
});

describe('A2: search cost', () => {
	it('a search over 10 000 pictures sorts in under 150 ms (it runs on every key)', () => {
		const files = Array.from({ length: 10000 }, (_, i) => {
			const name = `Picture ${(i * 7919) % 10000} final.png`;
			return { path: `Folder ${i % 200}/${name}`, name, extension: 'png' };
		});
		const tree = buildPictureTree(files, () => true);
		const t = performance.now();
		searchRows(tree, 'png', null);
		expect(performance.now() - t).toBeLessThan(150);
	});
});

describe('A3: Cancel while a device picture is being copied', () => {
	it('after Cancel the picture from the device is not written into the vault', async () => {
		const createBinary = vi.fn(async (path: string) => Object.assign(file(path), {}));
		const a = app(createBinary as never) as ReturnType<typeof app> & { fileManager: Record<string, unknown> };
		a.fileManager.getAvailablePathForAttachment = async (n: string) => n;
		const { m, done } = await pick({ app: a });
		// A PNG header: signature, IHDR length, "IHDR", width 4, height 4.
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0]);
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const dev = m.contentEl.querySelector('.dynasty-picture-file')! as FEl & { files?: unknown[]; value: string };
		dev.files = [{ name: 'me.png', size: png.length, arrayBuffer: async () => (await gate, png.buffer) }];
		dispatch(dev, 'change');
		dispatch(m.contentEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(await done).toBeNull();
		release();
		await settle();
		expect(createBinary).not.toHaveBeenCalled();
	});
});
