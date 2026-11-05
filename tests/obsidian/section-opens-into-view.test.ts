import { beforeEach, describe, expect, it } from 'vitest';

import { renderSections, resetOpenSections, type SectionSpec } from '../../src/obsidian/window-sections';
import { FEl, device, dispatch, fakeWin, resetDom, runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * A section that the user opens scrolls into the visible part of the window body once it has opened (it grows over 200 ms), at once under
 * reduced motion. A section that is in view does not move the body, and no section closes by itself.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetOpenSections();
});

/** A body that shows 0 to 400 px and sections that lie where the test puts them. */
function setup() {
	const box = new FEl('div', { cls: 'dynasty-sheet-body' });
	// The section code reads the system setting through the window of the element.
	(box as unknown as { ownerDocument: unknown }).ownerDocument = { defaultView: fakeWin };
	box.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: 600, height: 400, right: 600, bottom: 400 });
	const scrolls: unknown[] = [];
	(box as unknown as { scrollTo: (o: unknown) => void }).scrollTo = (o) => scrolls.push(o);
	const specs: SectionSpec[] = ['one', 'two', 'three'].map((key) => ({ key, title: key, summary: '', open: false, build: () => undefined }));
	const view = renderSections(box as never, 'test', specs);
	const section = (key: string) => view.el(key) as unknown as FEl;
	const place = (key: string, top: number, bottom: number) => {
		section(key).getBoundingClientRect = () => ({ left: 0, top, x: 0, y: top, width: 600, height: bottom - top, right: 600, bottom });
	};
	const tap = (key: string) => dispatch(section(key).querySelector('.dynasty-section-head')!, 'click');
	return { box, view, place, tap, scrolls };
}

describe('a section that opens', () => {
	it('scrolls up so that its bottom shows, after it has opened, and keeps its heading in view', () => {
		const { box, place, tap, scrolls, view } = setup();
		place('two', 300, 700);
		tap('two');
		expect(view.isOpen('two')).toBe(true);
		// Nothing moves while it grows.
		expect(scrolls).toEqual([]);
		runTimers(400);
		// 300 px of it are below the body, and its heading is 300 px from the top: the whole 300 px.
		expect(scrolls).toEqual([{ top: box.scrollTop + 300, behavior: 'smooth' }]);
	});

	it('never lifts its own heading above the top of the body', () => {
		const { box, place, tap, scrolls } = setup();
		place('two', 100, 900);
		tap('two');
		runTimers(400);
		expect(scrolls).toEqual([{ top: box.scrollTop + 100, behavior: 'smooth' }]);
	});

	it('scrolls down when its heading is above the top', () => {
		const { box, place, tap, scrolls } = setup();
		box.scrollTop = 500;
		place('two', -60, 200);
		tap('two');
		runTimers(400);
		expect(scrolls).toEqual([{ top: 440, behavior: 'smooth' }]);
	});

	it('does not move the body when the section is in view', () => {
		const { place, tap, scrolls } = setup();
		place('two', 100, 350);
		tap('two');
		runTimers(400);
		expect(scrolls).toEqual([]);
	});

	it('jumps at once under reduced motion, with no animation', () => {
		device.reduceMotion = true;
		const { box, place, tap, scrolls } = setup();
		place('two', 300, 700);
		tap('two');
		expect(scrolls).toEqual([]);
		expect(box.scrollTop).toBe(300);
	});

	it('scrolls when the transition ends, before the wait is over, and only once', () => {
		const { box, place, tap, scrolls, view } = setup();
		place('two', 300, 700);
		tap('two');
		dispatch((view.el('two') as unknown as FEl).querySelector('.dynasty-section-wrap')!, 'transitionend');
		expect(scrolls).toHaveLength(1);
		runTimers(400);
		expect(scrolls).toHaveLength(1);
		void box;
	});

	it('does not scroll when the user closed it again before it had opened', () => {
		const { place, tap, scrolls } = setup();
		place('two', 300, 700);
		tap('two');
		tap('two');
		runTimers(400);
		expect(scrolls).toEqual([]);
	});

	it('does not scroll when a section closes, and leaves the other sections as they are', () => {
		const { place, tap, scrolls, view } = setup();
		view.open('one');
		tap('three');
		expect(view.isOpen('one')).toBe(true);
		expect(view.isOpen('three')).toBe(true);
		scrolls.length = 0;
		place('three', 300, 700);
		tap('three');
		runTimers(400);
		expect(scrolls).toEqual([]);
		expect(view.isOpen('one')).toBe(true);
	});

	it('scrolls for a section that the window opens in code (a refusal that stands in it)', () => {
		const { box, place, view, scrolls } = setup();
		place('three', 350, 600);
		view.open('three');
		runTimers(400);
		expect(scrolls).toEqual([{ top: box.scrollTop + 200, behavior: 'smooth' }]);
	});
});
