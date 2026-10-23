import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Geometry } from '../../src/layout/model';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { makePicture, type SaveSource } from '../../src/obsidian/save-picture';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { parseBreakList } from '../../src/render/break-words';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

// "Save as picture" (contract 6.2): `saveSource()` makes the geometry again and takes the relation line from the mark and the setting `showRelations`;
// `relations` go in only while the setting is on. 0.2.5 (D145): with the setting off the plate goes, so the cards of the picture are one small text line
// shorter and the marked person has the You tab. The phone preview of 0.2.4 (D119) is gone with the list (D144); the picture comes from the computer.
// The card form and the tab are in s025-view-card.test.ts.

useFakeDom();

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	clearMeasureCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

const SRC = ['options:', '  me: ann', 'people:', '  - {id: ann, name: Ann, born: 1100}', '  - {id: bo, name: Bo, born: 1130, parents: [ann]}', ''].join('\n');

interface Peek {
	saveSource(): SaveSource | null;
	lastLayout: { geo: Geometry; settings: { relationLine?: boolean }; opts: { relations?: unknown } };
}

/** The height of each card of the saved SVG, by person. */
function cardHeights(svg: string): Map<string, number> {
	const out = new Map<string, number>();
	for (const m of svg.matchAll(/<g[^>]*data-item="card:([^"]+)"[^>]*>\s*<rect[^>]*?height="([\d.]+)"/g)) out.set(m[1], Number(m[2]));
	return out;
}

describe('save as picture: the plate follows the mark and the setting (contract 6.2, D145)', () => {
	it('with a mark and "Show relation names on cards" on: the relation line, the words, cards of 77 px', async () => {
		desktop();
		const host = fakeHost() as ReturnType<typeof fakeHost> & { settings?: unknown };
		host.settings = { ...DEFAULT_SETTINGS };
		const { view } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		const src = (view as unknown as Peek).saveSource()!;
		expect(src.relationLine).toBe(true);
		expect(src.relations?.get('bo')?.text).toBe('Child');
		const svg = new TextDecoder().decode((await makePicture(undefined, src, 'svg')).bytes);
		expect([...cardHeights(svg).values()]).toEqual([77, 77]);
		expect(svg).toMatch(/data-item="relation:bo"[^>]*>Child</);
		expect(svg).toMatch(/data-item="relation:ann"[^>]*>You</);
	});

	it('with "Show relation names on cards" off: no relation line, no words, cards of 61 px (D145)', async () => {
		desktop();
		const host = fakeHost() as ReturnType<typeof fakeHost> & { settings?: unknown };
		host.settings = { ...DEFAULT_SETTINGS, showRelations: false };
		const { view } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		const src = (view as unknown as Peek).saveSource()!;
		expect(src.relationLine).toBe(false);
		expect(src.relations).toBeUndefined();
		expect(src.youTab).toBe('ann');
		const svg = new TextDecoder().decode((await makePicture(undefined, src, 'svg')).bytes);
		expect([...cardHeights(svg).values()]).toEqual([61, 61]);
		expect(svg).not.toContain('data-item="relation:bo"');
	});

	it('a tree with no mark has no relation line: cards of 61 px', async () => {
		desktop();
		const plain = SRC.replace('  me: ann\n', '').replace('options:\n', '');
		const host = fakeHost() as ReturnType<typeof fakeHost> & { settings?: unknown };
		host.settings = { ...DEFAULT_SETTINGS };
		const { view } = await embed(plain, { host, handle: fakeHandle('n.md', plain) });
		const src = (view as unknown as Peek).saveSource()!;
		expect(src.relationLine).toBe(false);
		expect(src.relations).toBeUndefined();
		const svg = new TextDecoder().decode((await makePicture(undefined, src, 'svg')).bytes);
		expect([...cardHeights(svg).values()]).toEqual([61, 61]);
	});

	it('the break list of the settings goes to the source and to the picture', async () => {
		desktop();
		const host = fakeHost() as ReturnType<typeof fakeHost> & { settings?: unknown };
		host.settings = { ...DEFAULT_SETTINGS, breakWords: 'Bcdfghjklmnp-qrstvwxzbcdf' };
		const word = 'Bcdfghjklmnpqrstvwxzbcdf';
		const src = SRC.replace('name: Bo', `name: ${word}`);
		const { view } = await embed(src, { host, handle: fakeHandle('n.md', src) });
		const saved = (view as unknown as Peek).saveSource()!;
		expect(saved.breaks).toEqual(parseBreakList('Bcdfghjklmnp-qrstvwxzbcdf'));
		const svg = new TextDecoder().decode((await makePicture(undefined, saved, 'svg')).bytes);
		expect(svg).toContain('Bcdfghjklmnp-');
	});
});
