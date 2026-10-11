import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { HousesWindow } from '../src/obsidian/houses-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { fixture } from './helpers';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp } from './acceptance/tree-view-fakes';
import { backToList, listRows, openPage } from './lw-support';
import { stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * Search round 0.2.3, area C. WCAG 2.5.3 (Label in Name): the accessible name of a button contains its
 * visible text, so that Voice Control on the iPhone ("Tap Change id") and speech software find it. The
 * convention of the windows is "visible text: longer sentence" ("Change ID: change the ID of X").
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** The text that a person sees and a speech program reads: text in an element with aria-hidden="true" (initials, icons) is decoration. */
const readable = (el: FEl): string => (el.getAttribute('aria-hidden') === 'true' ? '' : el.text + el.children.map(readable).join(''));

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function mismatches(root: FEl): string[] {
	const out: string[] = [];
	for (const b of root.querySelectorAll('button')) {
		// 0.2.8: a row has a title (its label) and a second text line (a description); the label is the title, and the initials circle is decoration.
		const title = b.querySelector('.dynasty-row-title');
		const visible = readable(title ?? b).trim();
		const label = b.getAttribute('aria-label');
		if (!visible || !label) continue;
		if (!` ${norm(label)} `.includes(` ${norm(visible)} `)) out.push(`"${visible}" is not in "${label}"`);
	}
	return [...new Set(out.map((x) => x.replace(/"[^"]*" is not in "([^"]*)"/, (m) => m)))];
}

describe('label in name', () => {
	it('Houses window and the Titles window: the list and every edit page', () => {
		const h = writingHandle(fixture('13'));
		// The labels differ only by the name, so one message of each kind is enough.
		const seen = new Set<string>();
		const fresh = (found: string[]) => found.filter((m) => !seen.has(m.replace(/ in ".*"/, '')) && (seen.add(m.replace(/ in ".*"/, '')), true));
		const scan = (modal: FEl, content: FEl): string[] => {
			const out = fresh(mismatches(modal));
			// The list rows have no label of their own; their visible text is their name. Every page is scanned.
			expect(listRows(content).length).toBeGreaterThan(0);
			const keys = listRows(content).map((r) => r.getAttribute('data-focus')!.slice('row:'.length));
			for (const key of keys) {
				const page = openPage(content, key);
				// A page without a labelled button would make the scan prove nothing.
				expect(page.querySelectorAll('button').some((b) => b.getAttribute('aria-label') && b.getText().trim())).toBe(true);
				out.push(...fresh(mismatches(modal)));
				backToList(content);
			}
			return out;
		};
		const hw = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		hw.open();
		const out = scan((hw as unknown as { modalEl: FEl }).modalEl, (hw as unknown as { contentEl: FEl }).contentEl);
		closePluginModals();
		const tw = TitlesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		tw.open();
		out.push(...scan((tw as unknown as { modalEl: FEl }).modalEl, (tw as unknown as { contentEl: FEl }).contentEl));
		expect(out).toEqual([]);
	});

	it('the edit sheet of a person with parents, partners, a title, a house', () => {
		const body = fixture('13');
		const h = writingHandle(body);
		const ids = [...body.matchAll(/^\s*- id: (\S+)/gm)].map((m) => m[1]);
		const all = new Set<string>();
		for (const id of ids.slice(0, 30)) {
			const s = EditSheet.create(fakeApp() as never, { handle: h as never, personId: id, sourcePath: 'n.md' });
			if (!s) continue;
			s.open();
			for (const m of mismatches((s as unknown as { modalEl: FEl }).modalEl)) all.add(m.replace(/"/g, ''));
			closePluginModals();
		}
		expect([...all].sort()).toEqual([]);
	});
});
