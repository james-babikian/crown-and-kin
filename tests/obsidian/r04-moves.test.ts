import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BIG_TREE_CLASS, STANDING_LAYER_MAX_PEOPLE, keepsStandingLayer } from '../../src/obsidian/move-layer';
import type { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { block15, comments15 } from '../acceptance/m10-support';
import { desktop, embed, fakeHandle, fullViews, openFullScreen } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D285 (0.4, WP-4a): a pan or pinch of a very large tree on a phone is smooth. Two parts, both without a change that the user sees:
 * (1) the canvas of a tree with very many cards keeps no standing layer (the class `dynasty-big-tree`; the style sheet takes the layer away);
 * (2) the settle after a gesture and the idle fill write the tap areas only when they change and only near the view.
 */

useFakeDom({ window: true, css: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	desktop();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	vi.restoreAllMocks();
});

const SOURCE = block15(0);
const F = comments15();
const key = (name: string) => F.folds.get(name)!.key;
const run = async () => {
	await settle();
	clock.now += 2000;
	flushFrames();
};

interface View {
	scale: number;
	cx: number;
	cy: number;
}
interface Inner {
	panZoom: { view: View; size: { w: number; h: number }; setView(v: View, o?: { byUser?: boolean }): void };
	scene: { folds: { control: { spot: { x: number; y: number } }; hit: FEl; el: FEl; filled: boolean; fill(): void }[]; tags: { hit: FEl; over: FEl }[] };
	placeFolds(view: View, which?: unknown[]): void;
	foldWindow(view: View): ((f: unknown) => boolean) | null;
}
const inner = (view: TreeView) => view as unknown as Inner;

/** Counts the attribute writes on the tap areas, the signs and the tags while `fn` runs. */
async function writesDuring(fn: () => void | Promise<void>): Promise<{ hits: number; signs: number }> {
	const proto = FEl.prototype as unknown as { setAttribute(k: string, v: unknown): void };
	const orig = proto.setAttribute;
	const count = { hits: 0, signs: 0 };
	proto.setAttribute = function (this: FEl, k: string, v: unknown) {
		if (this.hasClass('dynasty-fold-hit') || this.hasClass('dynasty-tag-hit') || this.hasClass('dynasty-tag-over')) count.hits++;
		else if (this.hasClass('dynasty-fold') && k === 'transform') count.signs++;
		orig.call(this, k, v);
	};
	try {
		await fn();
	} finally {
		proto.setAttribute = orig;
	}
	return count;
}

const rects = (view: TreeView) => inner(view).scene.folds.map((f) => ['x', 'y', 'width', 'height'].map((k) => f.hit?.getAttribute(k) ?? '-').join(','));

describe('the size above which the canvas keeps no standing layer', () => {
	it('a tree of up to the limit keeps it, a larger tree does not', () => {
		expect(keepsStandingLayer(0)).toBe(true);
		expect(keepsStandingLayer(389)).toBe(true);
		expect(keepsStandingLayer(STANDING_LAYER_MAX_PEOPLE)).toBe(true);
		expect(keepsStandingLayer(STANDING_LAYER_MAX_PEOPLE + 1)).toBe(false);
		expect(keepsStandingLayer(2978)).toBe(false);
	});

	const flat = (n: number) => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;

	it('the canvas of a small tree has no class, the canvas of a tree above the limit has it', async () => {
		const small = await openFullScreen(flat(50));
		expect(small.root.querySelector('.dynasty-canvas')!.hasClass(BIG_TREE_CLASS)).toBe(false);
		(small.modal as unknown as { close(): void }).close();
		const big = await openFullScreen(flat(STANDING_LAYER_MAX_PEOPLE + 1));
		expect(big.root.querySelector('.dynasty-canvas')!.hasClass(BIG_TREE_CLASS)).toBe(true);
	});
});

describe('the settle writes the tap areas only when they change', () => {
	it('a pan to another place writes nothing to the tap areas or the signs', async () => {
		const handle = fakeHandle('n.md', SOURCE);
		const { view } = await embed(SOURCE, { handle });
		const v = inner(view);
		const start = { ...v.panZoom.view };
		// The first settle after the draw places everything; the pan then moves the centre only.
		v.panZoom.setView({ ...start }, { byUser: true });
		await run();
		const w = await writesDuring(async () => {
			v.panZoom.setView({ scale: start.scale, cx: start.cx + 40, cy: start.cy + 25 }, { byUser: true });
			await run();
		});
		expect(w).toEqual({ hits: 0, signs: 0 });
		// The counter works: a new zoom writes the tap areas.
		const z = await writesDuring(async () => {
			v.panZoom.setView({ scale: start.scale * 1.5, cx: start.cx, cy: start.cy }, { byUser: true });
			await run();
		});
		expect(z.hits).toBeGreaterThan(0);
	});

	it('a new zoom places the tap areas near the view as a full placing would, and the rest when it comes near', async () => {
		const handle = fakeHandle('n.md', SOURCE);
		for (const k of [key('A')]) (handle.state as { folds: Set<string> }).folds.delete(k);
		const { view } = await embed(SOURCE, { handle });
		const v = inner(view);
		for (const f of v.scene.folds) f.fill();
		const start = { ...v.panZoom.view };
		const zoomed = { scale: start.scale * 2.5, cx: start.cx, cy: start.cy };
		v.panZoom.setView(zoomed, { byUser: true });
		await run();
		const near = v.foldWindow(v.panZoom.view)!;
		const after = rects(view);
		// Placing every control by hand gives the rectangles the settle must have given the near ones.
		v.placeFolds(v.panZoom.view);
		const full = rects(view);
		v.scene.folds.forEach((f, i) => {
			if (near(f)) expect(after[i]).toBe(full[i]);
		});
		// A control that was far keeps its old rectangle until the view comes near it: then the settle places it as a full placing does.
		const far = v.scene.folds.filter((f) => !near(f));
		if (far.length) {
			const target = far[0];
			v.panZoom.setView({ scale: zoomed.scale, cx: target.control.spot.x, cy: target.control.spot.y }, { byUser: true });
			await run();
			expect(rects(view)[v.scene.folds.indexOf(target)]).toBe(full[v.scene.folds.indexOf(target)]);
		}
	});

	it('the idle chunk places only the controls that it filled', async () => {
		const handle = fakeHandle('n.md', SOURCE);
		(handle.state as { folds: Set<string> }).folds.clear();
		const { view } = await embed(SOURCE, { handle });
		const v = inner(view);
		const calls: number[] = [];
		const orig = v.placeFolds.bind(v);
		v.placeFolds = (vw: View, which?: unknown[]) => {
			calls.push(which ? which.length : -1);
			orig(vw, which);
		};
		await run();
		for (let i = 0; i < 20; i++) {
			clock.now += 500;
			flushFrames();
			await settle();
		}
		resizeAll();
		expect(calls.includes(-1)).toBe(false);
	});
});

describe('the hint labels do not lay the tree out again', () => {
	it('a hint label with nothing to say is hidden by visibility, not by display: none', () => {
		// Measured: a class change that took the label out of the layout cost 1 to 4 s of SVG text layout on a tree of thousands of people (phone profile, CPU 4x).
		const css = readFileSync('styles/09-read-only-resize.css', 'utf8');
		const rule = /\.dynasty-hint-slot:not\(\.dynasty-hint\)\s*\{([^}]*)\}/.exec(css);
		expect(rule).not.toBeNull();
		expect(rule![1]).toContain('visibility: hidden');
		expect(rule![1]).not.toContain('display: none');
	});
});
