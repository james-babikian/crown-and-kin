import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { clock, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, phone } from './acceptance/tree-view-fakes';

/*
 * Proof for the iPhone fault of 2026-10-07 (phone list shows no shields or pictures at first): the files are not
 * known when the list is drawn (the metadata cache has not indexed them), the picture store then announces them
 * (onChange, as main.ts does after the vault 'create' event), and the list is never filled.
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

describe('phone list: pictures whose files arrive after the first draw', () => {
	it('the list shows the arms and portrait once the store announces the files', async () => {
		let known = false;
		let hear: ((p: readonly string[]) => void) | null = null;
		const s = {
			resolve: (link: string) => (known ? { ok: true, file: { path: link.replace(/[[\]]/g, '') }, format: 'png' } : { ok: false, code: 'missing-picture', file: link }),
			check: async () => null,
			acquire: async () => ({ url: 'blob:x', w: 10, h: 10, release: () => {} }),
			onChange: (fn: (p: readonly string[]) => void) => ((hear = fn), () => {}),
		};
		phone();
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = s;
		const { el } = await embed(PICS, { host, handle: fakeHandle('n.md', PICS) });
		await settle();
		const row = () => el.querySelector('.dynasty-list-row[data-person="ann"]')!;
		expect(row().querySelector('.dynasty-hero-arms.has-picture')).toBeNull();
		known = true;
		hear!(['va-arms.png', 'ann.png']);
		await settle();
		expect(row().querySelector('.dynasty-hero-arms.has-picture img')).not.toBeNull();
		// Ann is the person in the centre: her portrait and arms stand in the column of the large row.
		expect(row().querySelector('.dynasty-hero-portrait.has-picture img')).not.toBeNull();
	});

	it('the file is on disk but the cache does not know it at first: the metadata cache event fills the list', async () => {
		let known = false;
		let resolves = 0;
		let acquires = 0;
		const s = {
			resolve: (link: string) => {
				resolves++;
				return known ? { ok: true, file: { path: link.replace(/[[\]]/g, '') }, format: 'png' } : { ok: false, code: 'missing-picture', file: link };
			},
			check: async () => null,
			acquire: async () => (acquires++, { url: 'blob:x', w: 10, h: 10, release: () => {} }),
			onChange: () => () => {},
		};
		phone();
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = s;
		let resolved: (() => void) | null = null;
		(host.app.metadataCache as unknown as { on: unknown }).on = (name: string, fn: () => void) => {
			if (name === 'resolved') resolved = fn;
			return {};
		};
		const { el } = await embed(PICS, { host, handle: fakeHandle('n.md', PICS) });
		await settle();
		const row = () => el.querySelector('.dynasty-list-row[data-person="ann"]')!;
		expect(row().querySelector('.dynasty-hero-arms.has-picture')).toBeNull();
		resolved!();
		await settle();
		expect(row().querySelector('.dynasty-hero-arms.has-picture')).toBeNull();
		known = true;
		resolved!();
		await settle();
		expect(row().querySelector('.dynasty-hero-arms.has-picture img')).not.toBeNull();
		// Ann is the person in the centre: her portrait and arms stand in the column of the large row.
		expect(row().querySelector('.dynasty-hero-portrait.has-picture img')).not.toBeNull();
		// Every picture is found now: a later event asks the store nothing.
		const before = resolves;
		const copies = acquires;
		resolved!();
		await settle();
		expect(resolves).toBe(before);
		expect(acquires).toBe(copies);
	});
});
