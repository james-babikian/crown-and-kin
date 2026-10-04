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
import { click, stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * Search round 0.2.3, area C. WCAG 2.5.3 (Label in Name): the accessible name of a button contains its
 * visible text, so that Voice Control on the iPhone ("Tap Change id") and speech software find it. The
 * convention of the Titles window is "visible text: longer sentence" ("Show holders: show the holders of X").
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

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function mismatches(root: FEl): string[] {
	const out: string[] = [];
	for (const b of root.querySelectorAll('button')) {
		const visible = b.getText().trim();
		const label = b.getAttribute('aria-label');
		if (!visible || !label) continue;
		if (!` ${norm(label)} `.includes(` ${norm(visible)} `)) out.push(`"${visible}" is not in "${label}"`);
	}
	return [...new Set(out.map((x) => x.replace(/"[^"]*" is not in "([^"]*)"/, (m) => m)))];
}

describe('label in name', () => {
	it('Houses window and the Titles window', async () => {
		const h = writingHandle(fixture('13'));
		const hw = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		hw.open();
		const hm = (hw as unknown as { modalEl: FEl }).modalEl;
		await click(hm.querySelector('.dynasty-house-swatch'));
		// One row of each kind is enough: the labels differ only by the house name.
		const seen = new Set<string>();
		const out = mismatches(hm).filter((m) => !seen.has(m.replace(/ in ".*"/, '')) && (seen.add(m.replace(/ in ".*"/, '')), true));
		closePluginModals();
		const tw = TitlesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		tw.open();
		const tm = (tw as unknown as { modalEl: FEl }).modalEl;
		await click(tm.querySelector('.dynasty-title-toggle'));
		out.push(...mismatches(tm).filter((m) => !seen.has(m.replace(/ in ".*"/, '')) && (seen.add(m.replace(/ in ".*"/, '')), true)));
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
			for (const m of mismatches((s as unknown as { modalEl: FEl }).modalEl)) all.add(m.replace(/ in ".*"/, '').replace(/"/g, '') + ' ...');
			closePluginModals();
		}
		expect([...all].sort()).toEqual([]);
	});
});
