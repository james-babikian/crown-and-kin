import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { geometryFor, smallLineOf } from '../src/layout/geometry';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { clearMeasureCache } from '../src/render/dom/measure';
import { FEl, clock, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost } from './acceptance/tree-view-fakes';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';

// 0.2.4 (contract 4.3 B, 8.3): rule B lifts the arms box and the portrait when the relation text does not fit beside them but fits the text width. The
// decision is part of the fit (`tallCardsFor`), so the view keeps it (`lastLayout.opts.lifted`), compares it in `recheckTall` after a font refit, and
// draws again when it changed: the boxes then move and the live scene agrees with the saved picture.
// 0.2.5 (D143, R-compact): the Roundel of the Normal size has no arms box at the lower right and no rule B, so these checks use the classic card, which the
// Compact size keeps in a top-to-bottom tree. The font widths that cross the two limits (the room beside the box, the text width) are found by a scan:
// on the compact card Di's text (16 characters) is already wider than the text width at the width 1, so it is cut and never lifts; a narrower font puts it between the limits.

const canvas = { wide: 1 };

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	const make = g.createEl as (tag: string, o?: unknown) => unknown;
	g.createEl = (tag: string, o?: unknown) => {
		if (tag !== 'canvas') return make(tag, o);
		const ctx = {
			font: '10px sans-serif',
			measureText(s: string) {
				const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16);
				return { width: Array.from(s).length * 0.6 * size * canvas.wide };
			},
		};
		return { getContext: () => ctx };
	};
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	clearMeasureCache();
	canvas.wide = 1;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

/** Four generations under the marked person `ann`; every card has a house with arms (the arms box at the lower right) a title and a date, so the relation text is the third text line, beside the box. */
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'options:',
	'  me: ann',
	'people:',
	'  - {id: ann, name: Ann, title: Duke, born: 1100, house: v}',
	'  - {id: bo, name: Bo, title: Duke, born: 1130, house: v, parents: [ann]}',
	'  - {id: cy, name: Cy, title: Duke, born: 1160, house: v, parents: [bo]}',
	'  - {id: di, name: Di, title: Duke, born: 1190, house: v, parents: [cy]}',
	'',
].join('\n');

interface Peek {
	lastLayout: { opts: { lifted?: ReadonlySet<string>; relations?: ReadonlyMap<string, { text: string }> } };
	recheckTall(fresh?: boolean): boolean;
	settings: { showRelations: boolean };
}

async function open(source = SRC) {
	desktop();
	const host = fakeHost() as ReturnType<typeof fakeHost> & { settings?: unknown };
	host.settings = { ...DEFAULT_SETTINGS, cardSize: 'compact' };
	const handle = fakeHandle('n.md', source);
	const out = await embed(source, { host, handle });
	return { ...out, peek: out.view as unknown as Peek, host };
}

const counts = (el: FEl) => el.querySelectorAll('.dynasty-card').length;

/** Changes the canvas font width in small steps until the longest relation text (Di's) no longer fits beside the arms box and lifts; true when it did. */
function widenUntilLifted(peek: Peek): boolean {
	for (let wide = 0.5; wide < 1; wide += 0.02) {
		canvas.wide = wide;
		clearMeasureCache();
		peek.recheckTall(true);
		if (peek.lastLayout.opts.lifted?.has('di')) return true;
	}
	return false;
}

describe('rule B: the lift is kept by the view and redrawn after a font refit (contract 4.3 B)', () => {
	it('the view keeps the set of lifted people and the relation words it was decided with', async () => {
		const { el, peek } = await open();
		expect(counts(el)).toBe(4);
		expect(peek.lastLayout.opts.relations?.get('di')?.text).toBeTruthy();
		expect(peek.lastLayout.opts.lifted ?? new Set()).toBeInstanceOf(Set);
	});

	it('with the fallback measure no card lifts; after the font changes the relation text of one card no longer fits beside the arms box and the set changes: recheckTall draws again', async () => {
		const { peek, view } = await open();
		const before = peek.lastLayout.opts.lifted ?? new Set<string>();
		expect(before.has('di')).toBe(false);
		const scene = (view as unknown as { scene: unknown }).scene;
		expect(widenUntilLifted(peek)).toBe(true);
		// The scene was built again: the live boxes follow the new set.
		expect((view as unknown as { scene: unknown }).scene).not.toBe(scene);
	});
});

describe('rule B: the lift reaches the live scene, follows the setting that shows the words, and is set on every path of measuredLayout', () => {
	const armsRect = (view: unknown, id: string) => (view as { scene: { pictures: { kind: string; lod: string; person: string; rect: { y: number } }[] } }).scene.pictures.find((p) => p.person === id && p.kind === 'arms' && p.lod === 'full')!.rect;

	it('a lifted card has its arms box one small text line higher in the scene that the redraw built', async () => {
		const { peek, view } = await open();
		const lower = armsRect(view, 'di').y;
		const other = armsRect(view, 'cy').y;
		// The text of Cy is shorter than the text of Di, so at the first width that lifts Di it still fits beside the box and only Di lifts.
		expect(widenUntilLifted(peek)).toBe(true);
		expect(peek.lastLayout.opts.lifted?.has('di')).toBe(true);
		expect(peek.lastLayout.opts.lifted?.has('cy')).toBe(false);
		expect(lower - armsRect(view, 'di').y).toBeCloseTo(smallLineOf(geometryFor(16, 'compact')), 6);
		expect(armsRect(view, 'cy').y).toBe(other);
	});

	it('a font that goes back takes the lift back, and a second refit with no change draws nothing', async () => {
		const { peek, view } = await open();
		expect(widenUntilLifted(peek)).toBe(true);
		const scene = (view as unknown as { scene: unknown }).scene;
		expect(peek.recheckTall(true)).toBe(false);
		expect((view as unknown as { scene: unknown }).scene).toBe(scene);
		canvas.wide = 0.5;
		clearMeasureCache();
		expect(peek.recheckTall(true)).toBe(true);
		expect(peek.lastLayout.opts.lifted?.size ?? 0).toBe(0);
	});

	it('with "Show relation names on cards" off nothing lifts (there is no word, D145); turning it on lifts again', async () => {
		const { peek, view, host } = await open();
		expect(widenUntilLifted(peek)).toBe(true);
		expect(peek.lastLayout.opts.lifted?.has('di')).toBe(true);
		const prev = { ...(host.settings as typeof DEFAULT_SETTINGS) };
		(host.settings as typeof DEFAULT_SETTINGS).showRelations = false;
		(view as unknown as { onSettingsChange(p: unknown): void }).onSettingsChange(prev);
		expect(peek.lastLayout.opts.lifted?.size ?? 0).toBe(0);
		const off = { ...(host.settings as typeof DEFAULT_SETTINGS) };
		(host.settings as typeof DEFAULT_SETTINGS).showRelations = true;
		(view as unknown as { onSettingsChange(p: unknown): void }).onSettingsChange(off);
		expect(peek.lastLayout.opts.lifted?.has('di')).toBe(true);
	});
});
