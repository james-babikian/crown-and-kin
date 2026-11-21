// A level change through the tree view (wheel zoom on sample tree 07) makes the text of the Compact and sign pills before the level class is set,
// so no frame shows an empty pill (the decision notes "Hidden tag pills wait for their level").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSource } from '../acceptance/load';
import { FEl, clock, dispatch, flushFrames, resetDom, settle, wheel } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fullViews } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true, css: true });
beforeEach(() => { resetDom(); resetObsidian(); desktop(); vi.spyOn(performance, 'now').mockImplementation(() => clock.now); });
afterEach(() => { for (const m of fullViews()) (m as unknown as { close(): void }).close(); vi.restoreAllMocks(); });

const SOURCE = fixtureSource('07');
const lodOf = (v: unknown) => (v as { lod: string | null }).lod;
const pillText = (el: FEl, cls: string) => el.querySelectorAll(`.${cls} .dynasty-tag-text`).map((t) => t.children.length + (t.textContent ?? '').length);

describe('the pill text exists before the level class is set', () => {
	it('compact and overview', async () => {
		const { view, el, vp } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000; flushFrames();
		const svg = (view as unknown as { svg: FEl }).svg;
		const seen: Record<string, number[]> = {};
		const orig = svg.addClass.bind(svg);
		svg.addClass = (...c: string[]) => {
			for (const k of c) {
				const lvl = k.replace('dynasty-lod-', '');
				if (lvl === 'compact') seen.compact = pillText(el, 'dynasty-tag-compact');
				if (lvl === 'overview') seen.overview = pillText(el, 'dynasty-tag-sign');
			}
			orig(...c);
		};
		for (let i = 0; i < 60 && lodOf(view) !== 'overview'; i++) { dispatch(vp, 'wheel', { ...wheel(0, 250), ctrlKey: true }); flushFrames(); }
		expect(lodOf(view)).toBe('overview');
		expect(el.querySelectorAll('.dynasty-tag-sign').length).toBeGreaterThan(0);
		for (const lvl of Object.keys(seen)) {
			expect(seen[lvl].length, lvl).toBeGreaterThan(0);
			expect(seen[lvl].every((n) => n > 0), `${lvl} pills have text before class`).toBe(true);
		}
		expect(Object.keys(seen)).toContain('overview');
	});
	it('lazy tags that attach while at overview get text at once, and the compact text when compact shows', async () => {
		const { view, el, vp } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000; flushFrames();
		for (let i = 0; i < 60 && lodOf(view) !== 'overview'; i++) { dispatch(vp, 'wheel', { ...wheel(0, 250), ctrlKey: true }); flushFrames(); }
		(view as unknown as { scene: { fill: { fillAll(): number } } }).scene.fill.fillAll();
		const sign = pillText(el, 'dynasty-tag-sign');
		expect(sign.length).toBeGreaterThan(0);
		expect(sign.every((n) => n > 0)).toBe(true);
		for (let i = 0; i < 60 && lodOf(view) !== 'compact'; i++) { dispatch(vp, 'wheel', { ...wheel(0, -60), ctrlKey: true }); flushFrames(); }
		expect(lodOf(view)).toBe('compact');
		const comp = pillText(el, 'dynasty-tag-compact');
		expect(comp.length).toBeGreaterThan(0);
		expect(comp.every((n) => n > 0)).toBe(true);
	});
});
