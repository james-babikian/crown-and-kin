import { beforeEach, describe, expect, it } from 'vitest';

import { renderSections, resetOpenSections } from '../../src/obsidian/window-sections';
import { isolateName } from '../../src/render/name-bidi';
import { FEl, fakeWin, resetDom } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The summary line of a window section is split at " · " into items (window-sections.ts `summaryLine`). The Houses window gives
 * `isolateName(house name)` as the summary of Details, so a house name that holds " · " and a right-to-left letter must not be cut inside its isolate.
 */
useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetOpenSections();
});

const count = (s: string, ch: string) => s.split(ch).length - 1;
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('a section summary never splits a name isolate', () => {
	it('the Details summary of a house named "Banu Hashim · بنو هاشم" keeps each FSI with its PDI in one item', () => {
		const box = new FEl('div', { cls: 'dynasty-sheet-body' });
		(box as unknown as { ownerDocument: unknown }).ownerDocument = { defaultView: fakeWin };
		renderSections(box as never, 'name-isolate', [{ key: 'details', title: 'Details', summary: isolateName('Banu Hashim · بنو هاشم'), open: false, build: () => undefined }]);
		const items = all(box).filter((e) => e.hasClass('dynasty-jitem')).map((e) => e.getText());
		expect(items.length).toBeGreaterThan(0);
		for (const t of items) expect(count(t, '⁨'), JSON.stringify(t)).toBe(count(t, '⁩'));
	});
});
