import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { geometryFor, tallExtra } from '../../src/layout/geometry';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, device, flushFrames, installDom, resetDom, resizeAll, settle } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { fakeHandle, fakeHost } from './tree-view-fakes';

/*
 * Review of WP6.4 (scratch/review-6.4): D29 on css-change with the real measure.ts (its cache), and a
 * canvas whose widths change as they do when the face behind the same font name changes. The
 * acceptance test in tree-view-m6.test.ts wraps measureText outside its cache.
 */

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
	canvas.wide = 1;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

const DOWN = geometryFor(16, 'normal');
const TALL_H = DOWN.cardH + tallExtra(DOWN);

const NAMES = [
	'options:',
	'  start: will',
	'people:',
	'  - id: will',
	'    name: Wilhelmina Blackmere-Orsini',
	'  - id: bo',
	'    name: Bo',
	'    parents: [will]',
	'  - id: anna',
	'    name: Anna Blackmer',
	'    parents: [will]',
	'',
].join('\n');

function sizeRoot(root: FEl, w: number, h: number): void {
	for (const vp of root.querySelectorAll('.dynasty-viewport')) {
		vp.clientWidth = w;
		vp.clientHeight = h;
		const tb = vp.querySelector('.dynasty-toolbar');
		if (tb) Object.assign(tb, { offsetTop: 6, offsetHeight: 44, offsetLeft: w - 6 - 96, offsetWidth: 96 });
	}
}

function card(root: FEl, id: string) {
	const bg = root.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-card-bg`)!;
	return { h: Number(bg.getAttribute('height')) };
}

describe('review 6.4: D29 on css-change', () => {
	it('a name that no longer fits after a css-change (same font names) makes its card tall', async () => {
		device.coarse = true;
		device.width = 390;
		device.height = 844;
		const host = fakeHost();
		const handle = fakeHandle('n.md', NAMES);
		Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
		const el = new FEl('div');
		const info = { lineStart: 0, lineEnd: NAMES.split('\n').length + 1, text: '' };
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, NAMES, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		for (let i = 0; i < 3; i++) {
			sizeRoot(el, 342, 506);
			resizeAll();
			flushFrames();
		}
		expect(card(el, 'will').h).toBe(TALL_H);
		expect(card(el, 'anna').h).toBe(DOWN.cardH);
		// The theme's face for the same font name is wider now (the tree-view-m6 test's "text.wide = 1.2").
		canvas.wide = 1.2;
		view.onCssChange();
		flushFrames();
		expect(card(el, 'anna').h).toBe(TALL_H);
	});
});
