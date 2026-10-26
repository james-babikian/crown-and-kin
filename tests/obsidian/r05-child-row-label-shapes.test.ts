import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { FEl, clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/* G2 scratch: WCAG 2.5.3 on the child row for many row shapes, with the contiguous-token rule of axe 4.14 (label-content-name-mismatch). */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

function tokens(s: string): string[] {
	let t = s.toLowerCase().normalize('NFKD');
	let prev: string;
	do {
		prev = t;
		t = t.replace(/\([^()]*\)/g, '');
	} while (t !== prev);
	t = t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	return t.split(/\s+/).filter(Boolean);
}
function contained(label: string, name: string): boolean {
	const l = tokens(label);
	const n = tokens(name);
	if (!l.length) return true;
	for (let i = 0; i + l.length <= n.length; i++) if (l.every((w, j) => w === n[i + j])) return true;
	return false;
}

const SHAPES: Record<string, string> = {
	'no year': '{id: b, name: Bob, parents: [a]}',
	'death only': '{id: b, name: Bob, died: 1180, parents: [a]}',
	'both': '{id: b, name: Bob, born: 1130, died: 1180, parents: [a]}',
	'approximate': '{id: b, name: Bob, born: "c. 1130", parents: [a]}',
	'dead no year': '{id: b, name: Bob, born: 1130, died: yes, parents: [a]}',
	'sobriquet': '{id: b, name: Bob, sobriquet: the Bold, born: 1130, parents: [a]}',
	'sobriquet parens': '{id: b, name: Bob, sobriquet: "the (Elder) Bold", born: 1130, parents: [a]}',
	'name parens': '{id: b, name: "Bob (II)", born: 1130, parents: [a]}',
	'arabic': '{id: b, name: "بوب", born: "١١٣٠", died: "١١٨٠", parents: [a]}',
	'calendar-ish': '{id: b, name: Bob, born: "12 March 1130", parents: [a]}',
	'maybe parent': '{id: b, name: Bob, born: 1130, parents: [{id: a, type: rumoured}]}',
	'half': '{id: b, name: Bob, born: 1130, parents: [a, x]}',
	'long name': '{id: b, name: "Bob Bobbington-Smythe of the Seven Hills and the Long Valley", born: 1130, parents: [a]}',
};

describe('G2 fix B: child row label holds the visible text', () => {
	for (const [shape, row] of Object.entries(SHAPES)) {
		for (const whose of ['a', 'x']) {
			it(`${shape} (window of ${whose})`, () => {
				const body = ['options:', '  me: a', 'people:', '  - {id: a, name: Ann, born: 1100}', '  - {id: x, name: Xan, born: 1101}', `  - ${row}`, ''].join('\n');
				const sheet = EditSheet.create({} as never, { handle: fakeHandle('n.md', body) as never, personId: whose, sourcePath: 'n.md' })!;
				sheet.open();
				const content = (sheet as unknown as { contentEl: FEl }).contentEl;
				const r = content.querySelectorAll('.dynasty-family-row').find((e) => e.getAttribute('data-child') === 'b');
				if (!r) return;
				const label = r.getAttribute('aria-label')!;
				// The fake keeps own text before the children; the real DOM order is: name, sobriquet span, space | word element, then the text after it.
				const title = r.querySelector('.dynasty-row-title')!;
				const sub = r.querySelector('.dynasty-row-sub')!;
				const visible = title.text.replace(/ $/, '') + title.children.map((c) => c.getText()).join('') + ' ' + sub.children.map((c) => c.getText()).join('') + sub.text;
				expect(contained(visible, label), `visible "${visible}" label "${label}"`).toBe(true);
				// order: the visible tokens appear in the same order
				expect(label.endsWith('Open this person.')).toBe(true);
			});
		}
	}
});
