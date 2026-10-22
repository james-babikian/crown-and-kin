import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { speedTest } from '../support/speed-test';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { readFileSync } from 'node:fs';
import { buildPictureTree, pickerKey, pickerRows, searchRows } from '../../src/core/picture-list';
import { cssRules, vf } from './m11-support';
import { FEl, dispatch, fakeWin, installDom, resetDom, settle } from './fake-dom';
import { openModals, resetObsidian } from './fake-obsidian';
import { pickerModule } from './m11-support';

/* Code review, M11 area A (picture list and house page). Run: npx vitest run tests/acceptance/m11-review-picker.test.ts */

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
	const M = (await pickerModule()) as { pickPicture: (a: never, o: never) => Promise<{ kind: 'choose'; link: string } | { kind: 'remove' } | { kind: 'cancel' }> };
	let result: string | null | undefined;
	const done = M.pickPicture((o.app ?? app()) as never, { sourcePath: 'Trees/Tree.md', title: 'Select', current: o.current ?? null } as never).then((v) => (result = v.kind === 'choose' ? v.link : null));
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
	speedTest('a search over 10 000 pictures sorts in under 150 ms (it runs on every key)', () => {
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

describe('A4 ruling: Enter on a picture row always chooses', () => {
	it('core: Enter on a picture row chooses even when armed is false (the current picture at open)', () => {
		const rows = pickerRows(buildPictureTree([vf('Art/lion.png')], () => true), new Set(['Art']), null);
		const state = { cursor: 'picture:Art/lion.png', selected: 'Art/lion.png', armed: false };
		expect(pickerKey(rows, state, 'Enter').action).toBe('choose');
	});

	it('picker: Enter at open, with the current picture under the cursor, chooses it', async () => {
		const { m, done } = await pick({ current: VAULT[0] });
		dispatch(search(m), 'keydown', { key: 'Enter' });
		const link = await done;
		expect(link).toContain('lion.png');
		expect(openModals).toHaveLength(0);
		expect(m).toBeDefined();
	});
});

describe('Ruling: a picture that cannot show gets a solid preview frame', () => {
	const rules = cssRules(readFileSync('styles.css', 'utf8'));
	const dashed = (r: { body: string }) => /border(-style)?\s*:[^;]*dashed/.test(r.body);

	it('no rule for the picker row preview frame (.dynasty-picture-thumb) makes the border dashed, except for a missing file (M9 rule)', () => {
		const hits = rules.filter((r) => r.selectors.some((s) => s.includes('.dynasty-picture-thumb') && !s.includes('-img')));
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.filter(dashed).filter((r) => !r.selectors.every((s) => s.includes('.is-missing')))).toEqual([]);
	});

	it('the problem state still has its own frame that is solid (a border is kept, not removed)', () => {
		const problem = rules.filter((r) => r.selectors.some((s) => s.includes('.dynasty-picture-thumb.is-problem')));
		for (const r of problem) expect(/border-style\s*:\s*(none|hidden)/.test(r.body)).toBe(false);
		const base = rules.find((r) => r.selectors.includes('.dynasty-picture-thumb'))!;
		expect(/border\s*:\s*1px solid/.test(base.body)).toBe(true);
	});
});

