// 0.3 WP-B (the 0.3 contract C.2): B.3 where "Cancel" stands in the phone picker, and B.4 (below).
// The real proof is in Obsidian (harness steps `r028 ios find` and `r030 legend`); these tests hold the rules that a browser is not needed for.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { pickPerson } from '../src/obsidian/person-picker';
import { clearRelationCache } from '../src/view/relation-cache';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeHost } from './acceptance/tree-view-fakes';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const SRC = 'people:\n  - {id: a, name: Ann, born: 1100}\n  - {id: b, name: Bob, parents: [a], born: 1130}\n';

interface PickerLike {
	modalEl: FEl;
	inputEl: FEl;
	onOpen(): void;
}

describe('B.3: Cancel of the phone picker is outside the grey pill', () => {
	/** A pill in the prompt, with the sibling pointer that a real element has and the fake one has not. */
	function addPill(p: PickerLike, results: boolean): FEl {
		p.modalEl.empty();
		const pill = p.modalEl.createDiv({ cls: 'prompt-input-container' });
		pill.appendChild(p.inputEl);
		const list = results ? p.modalEl.createDiv({ cls: 'prompt-results' }) : null;
		Object.defineProperty(pill, 'nextElementSibling', { get: () => list });
		return pill;
	}

	function open(): PickerLike {
		const r = parseDynasty(SRC);
		if (!r.ok) throw new Error('parse');
		void pickPerson(fakeHost().app as never, deriveFamilies(r.tree), new Set(), 'Type', 'Find', false, null, null, { sourcePath: 'n.md' });
		return openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as PickerLike;
	}

	it('Cancel is a child of the prompt that follows the pill (Obsidian\'s prompt-input-container), not a child of the pill', () => {
		const p = open();
		// Obsidian puts the field in the pill, and the pill in the prompt, before the list. The fake modal has no such parts, so build them.
		const pill = addPill(p, true);
		p.onOpen();
		const cancels = p.modalEl.querySelectorAll('.dynasty-picker-cancel');
		expect(cancels).toHaveLength(1);
		expect(cancels[0]!.parentElement).toBe(p.modalEl);
		expect(pill.querySelector('.dynasty-picker-cancel')).toBeNull();
		// Cancel comes straight after the pill, before the list: the grid of the stylesheet puts both in row 1.
		const kids = p.modalEl.children;
		expect(kids.indexOf(cancels[0]!)).toBe(kids.indexOf(pill) + 1);
		expect(kids.indexOf(cancels[0]!)).toBeLessThan(kids.findIndex((k) => k.hasClass('prompt-results')));
	});

	it('Cancel still closes the picker', () => {
		const p = open();
		addPill(p, false);
		p.onOpen();
		const cancel = p.modalEl.querySelector('.dynasty-picker-cancel')!;
		expect(cancel.getText()).toBe('Cancel');
		expect(openModals.length).toBe(1);
		dispatch(cancel, 'click');
		expect(openModals.length).toBe(0);
	});

	it('a prompt without the pill still gets a Cancel button, as a child of the prompt', () => {
		const p = open();
		p.modalEl.empty();
		p.onOpen();
		expect(p.modalEl.querySelector('.dynasty-picker-cancel')?.parentElement).toBe(p.modalEl);
	});
});

// A rough guide only: it adds up the CSS numbers. The proof is the harness step `r030 legend`, which measures the real legend in Obsidian.
describe('B.4 (rough guide, arithmetic): the tight legend fits a 500 px note box', () => {
	const css = readFileSync(new URL('../styles/08-toolbar.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const px = (selector: string, prop: string): number => {
		// The rule starts a line; a longer selector that ends in the same words does not count.
		const i = css.indexOf(`\n${selector} {`);
		if (i < 0) throw new Error(`no rule ${selector}`);
		const m = new RegExp(String.raw`${prop}:\s*(\d+)px`).exec(css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i)));
		if (!m) throw new Error(`no ${prop} in ${selector}`);
		return Number(m[1]);
	};

	it('the content is at most the 445 px that a 500 px box leaves (0.2.8 measured 458 px with 24 px rows and 8 px padding; 10 of the 14 rows are one text line)', () => {
		const row = px('.dynasty-popover-legend.is-tight .dynasty-legend-row', 'min-height');
		const pad = px('.dynasty-popover-legend.is-tight', 'padding-top') + px('.dynasty-popover-legend.is-tight', 'padding-bottom');
		const content = 458 - 10 * (24 - row) - (16 - pad);
		expect(content).toBeLessThanOrEqual(445);
		// A row never goes below its 22 px sample, or the sample would overflow.
		expect(row).toBeGreaterThanOrEqual(22);
	});

	it('the full-screen legend (not tight) keeps its rows of 28 px', () => {
		expect(px('.dynasty-legend-row', 'min-height')).toBe(28);
	});
});
