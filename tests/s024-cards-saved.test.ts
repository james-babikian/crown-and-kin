import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { namesOnlyGeometry } from '../src/layout/geometry';
import type { Geometry } from '../src/layout/model';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { makePicture, type SaveSource } from '../src/obsidian/save-picture';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';
import { parseBreakList } from '../src/render/break-words';
import { clearMeasureCache } from '../src/render/dom/measure';
import { clock, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, phone } from './acceptance/tree-view-fakes';

// Contract 6.2: "Save as picture" from the phone preview always draws whole cards with the relation words, whatever style the preview shows
// (D119). `saveSource()` makes the geometry again (no `namesOnly` flag) and takes the relation line from the mark and not from the preview's
// geometry; `relations` go in only while "Show relation names on cards" is on. The setting only hides the text (D40), so the card keeps its height.

beforeAll(() => {
	installDom();
});

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

/** What the phone's view holds after the step "names-only style" draws it: the names-only geometry, no relation text line, no relation words. */
async function namesOnlyPreview(showRelations: boolean) {
	phone();
	const host = fakeHost() as ReturnType<typeof fakeHost> & { settings?: unknown };
	host.settings = { ...DEFAULT_SETTINGS, showRelations };
	const handle = fakeHandle('n.md', SRC);
	const { view } = await embed(SRC, { host, handle });
	const peek = view as unknown as Peek;
	peek.lastLayout.geo = namesOnlyGeometry(peek.lastLayout.geo);
	delete peek.lastLayout.settings.relationLine;
	delete peek.lastLayout.opts.relations;
	return peek;
}

/** The height of each card of the saved SVG, by person. */
function cardHeights(svg: string): Map<string, number> {
	const out = new Map<string, number>();
	for (const m of svg.matchAll(/<g[^>]*data-item="card:([^"]+)"[^>]*>\s*<rect[^>]*?height="([\d.]+)"/g)) out.set(m[1], Number(m[2]));
	return out;
}

describe('save from a phone preview: whole cards with relation words (contract 6.2)', () => {
	it('with the default style (names only) and "Show relation names on cards" on: the source has whole-card geometry, the relation line and the words; the picture has cards of 77 px and the words', async () => {
		const peek = await namesOnlyPreview(true);
		expect(peek.lastLayout.geo.namesOnly).toBe(true);
		const src = peek.saveSource()!;
		expect(src.geo.namesOnly).toBeUndefined();
		expect(src.geo.cardH).toBe(61);
		expect(src.relationLine).toBe(true);
		expect(src.relations?.get('bo')?.text).toBe('Child');
		const made = await makePicture(undefined, src, 'svg');
		const svg = new TextDecoder().decode(made.bytes);
		expect([...cardHeights(svg).values()]).toEqual([77, 77]);
		expect(svg).toMatch(/data-item="relation:bo"[^>]*>Child</);
		expect(svg).toMatch(/data-item="relation:ann"[^>]*>You</);
	});

	it('with "Show relation names on cards" off: the cards keep their height 77 and the words are not in the picture', async () => {
		const peek = await namesOnlyPreview(false);
		const src = peek.saveSource()!;
		expect(src.geo.namesOnly).toBeUndefined();
		expect(src.relationLine).toBe(true);
		expect(src.relations).toBeUndefined();
		const svg = new TextDecoder().decode((await makePicture(undefined, src, 'svg')).bytes);
		expect([...cardHeights(svg).values()]).toEqual([77, 77]);
		expect(svg).not.toContain('data-item="relation:bo"');
	});

	it('a tree with no mark has no relation line: cards of 61 px', async () => {
		phone();
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
