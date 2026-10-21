import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Fix2 view check, V4: `sidewaysView` makes the names smaller only when the farthest child fits at 11 px or more. A person whose children stand in two columns
// (a child placed a generation lower with its other parent) keeps 14 px names, and the nearest child is still cut by 12 px at the right on a 360-point phone:
// the fault of V4, for any focus person with such a child.

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Rect } from '../src/layout/model';
import { sidewaysView } from '../src/view/focus-mode';
import { FullScreenModal } from '../src/obsidian/full-screen';
import type { View } from '../src/render/view-math';
import { FEl, clock, device, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { topLevelBlocks } from './acceptance/load';
import { fakeHandle, fakeHost, fullViews } from './acceptance/tree-view-fakes';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	vi.restoreAllMocks();
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
});

const sample = (file: string) => topLevelBlocks(readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)), 'utf8'))[0];

interface Priv {
	panZoom: { view: View | null };
	laid: { layout: { persons: Map<string, Rect>; geometry: { fontPx: number }; orientation: string } };
	g: { placementParents: Map<string, string[]> };
	focusId: string | null;
	insetTop: number;
	insetBottom: number;
}

const W = 360;
const H = 780;
const SAFE = 47;

async function open(source: string, font: number): Promise<Priv> {
	Object.assign(device, { coarse: true, width: W, height: H });
	const probe = { fontSize: `${font}px`, fontFamily: 'sans-serif', paddingTop: `${SAFE}px`, paddingLeft: '0px', paddingRight: '0px', getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
	(globalThis as Record<string, unknown>).getComputedStyle = () => probe;
	const host = fakeHost();
	const handle = fakeHandle('n.md', source);
	const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source, handle, peeked: null, readOnly: false };
	const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
	modal.open();
	await settle();
	const root = modal.containerEl as unknown as FEl;
	const vp = root.querySelector('.dynasty-viewport')!;
	vp.clientWidth = W;
	vp.clientHeight = H;
	Object.assign(vp.querySelector('.dynasty-toolbar')!, { offsetTop: H - 64, offsetHeight: 64, offsetLeft: 0, offsetWidth: W });
	const b = vp.querySelector('.dynasty-focus-bar');
	if (b) Object.assign(b, { offsetTop: SAFE, offsetHeight: 52, offsetLeft: 0, offsetWidth: W });
	resizeAll();
	flushFrames();
	return [...host.views].find((v) => v.isFull)! as unknown as Priv;
}

describe('fix2 check V4: children in two columns on an upright phone 360 points wide', () => {
	for (const font of [12, 16, 21, 28]) {
		it(`sample tree 7, focus Aldric Valmont, note font ${font} px: the nearest child is whole in width (names not under 11 px)`, async () => {
			const view = await open(`options:\n  focus: aldric-valmont\n\n${sample('07-four-hundred-people.md')}`, font);
			expect(view.focusId).toBe('aldric-valmont');
			expect(view.laid.layout.orientation).toBe('sideways');
			const v = view.panZoom.view!;
			const persons = view.laid.layout.persons;
			const kids = [...view.g.placementParents].filter(([, ps]) => ps.includes('aldric-valmont')).map(([k]) => k);
			expect(kids.length).toBe(2);
			const right = (id: string) => W / 2 + (persons.get(id)!.x + persons.get(id)!.w - v.cx) * v.scale;
			const left = (id: string) => W / 2 + (persons.get(id)!.x - v.cx) * v.scale;
			const nearest = kids.reduce((a, b) => (persons.get(a)!.x <= persons.get(b)!.x ? a : b));
			expect(v.scale * view.laid.layout.geometry.fontPx).toBeGreaterThanOrEqual(11 - 1e-6);
			expect(left(nearest)).toBeGreaterThanOrEqual(-0.5);
			expect(right(nearest), `${nearest}: right edge at ${right(nearest).toFixed(1)} px on a ${W} px screen, names ${(v.scale * view.laid.layout.geometry.fontPx).toFixed(2)} px`).toBeLessThanOrEqual(W + 0.5);
		});
	}

	it('sidewaysView: a second child two columns away does not stop the smaller names for the nearest column', () => {
		const me: Rect = { x: 0, y: 300, w: 180, h: 61 };
		const near = { card: { x: 236, y: 340, w: 180, h: 61 }, partners: [] };
		const far = { card: { x: 475, y: 170, w: 180, h: 61 }, partners: [] };
		const one = sidewaysView({ w: 360, h: 780 }, 16, { me, partners: [], children: [near], parents: [] }, 103, 712, me).view;
		const two = sidewaysView({ w: 360, h: 780 }, 16, { me, partners: [], children: [near, far], parents: [] }, 103, 712, me).view;
		const rightOfNear = (v: View) => 180 + (near.card.x + near.card.w - v.cx) * v.scale;
		expect(rightOfNear(one)).toBeLessThanOrEqual(360);
		expect(rightOfNear(two), `names ${(two.scale * 16).toFixed(2)} px`).toBeLessThanOrEqual(360);
	});
});
