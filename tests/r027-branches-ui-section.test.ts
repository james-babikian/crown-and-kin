import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { closePluginModals } from '../src/obsidian/plugin-modals';
import { SUCCESSION_UI as T } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { lineRows, openWin, page, section } from './r027-window-support';

/*
 * Version 0.2.7, WP4 view (contract M.2, M.3, M.7, M.8): the grey rows of the open branches in the Succession section of the
 * Titles window, the note under the list, "and more branches", and the setting `youngDeathAge` as the window reads it.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

/** Rex has Kid, Miss and Late; Lost died at nine with no children; Early died at 40, between Kid and Miss. */
const TREE = [
	'titles:',
	'  - id: crown',
	'    name: Crown',
	'    succession: eldest-child',
	'    holders:',
	'      - {person: rex, from: 1100}',
	'people:',
	'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
	'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
	'  - {id: early, name: Early Ardent, sex: m, born: 1101, died: c. 1141, parents: [rex]}',
	'  - {id: miss, name: Miss Ardent, sex: f, born: 1102, parents: [rex]}',
	'  - {id: lost, name: Lost Ardent, sex: m, born: 1103, died: 1112, parents: [rex]}',
	'  - {id: late, name: Late Ardent, sex: m, born: 1150, parents: [rex]}',
	'',
].join('\n');

const branchRows = (p: FEl) => p.querySelectorAll('.dynasty-succ-branch-row').map((r) => r.getText());
/** Every row of the list in order: heirs ("1st…") and grey rows ("?…"). */
const order = (p: FEl) => p.querySelectorAll('.dynasty-succ-list [role="listitem"]').map((i) => i.querySelector('.dynasty-succ-ord')!.getText());

describe('the grey rows of the open branches', () => {
	it('stand at their place between the heirs, with the text of the note', () => {
		const o = openWin(TREE, { succession: { limit: () => 5, oldAge: () => 110, youngDeathAge: () => 0 } });
		const p = page(o, 'crown');
		expect(lineRows(p)).toEqual(['1stKid Ardent', '2ndMiss Ardent', '3rdLate Ardent']);
		expect(branchRows(p)).toEqual([`?${T.branchRow('Early Ardent', 'c. 1141')}`, `?${T.branchRow('Lost Ardent', '1112')}`]);
		expect(T.branchRow('Early Ardent', 'c. 1141')).toBe('Open branch of Early Ardent (died c. 1141): no children in the tree');
		// Early was born after Kid and before Miss; Lost after Miss and before Late.
		expect(order(p)).toEqual(['1st', '?', '2nd', '?', '3rd']);
	});

	it('the note shows with a row', () => {
		const o = openWin(TREE, { succession: { limit: () => 5, oldAge: () => 110, youngDeathAge: () => 0 } });
		const p = page(o, 'crown');
		expect(section(p).querySelector('[data-hint="branch-note"]')!.getText()).toBe(T.branchNote);
	});

	it('the note and the rows do not show when nobody has an open branch', () => {
		const o = openWin(TREE.replace('died: c. 1141, ', '').replace('died: 1112, ', ''), { succession: { limit: () => 5, oldAge: () => 110 } });
		const p = page(o, 'crown');
		expect(section(p).querySelector('[data-hint="branch-note"]')).toBeNull();
		expect(branchRows(p)).toEqual([]);
	});

	it('the setting for young deaths hides a branch of a person who died younger', () => {
		// Early died at 40, Lost at 9.
		const o = openWin(TREE, { succession: { limit: () => 5, oldAge: () => 110, youngDeathAge: () => 18 } });
		expect(branchRows(page(o, 'crown'))).toEqual([`?${T.branchRow('Early Ardent', 'c. 1141')}`]);
	});

	it('a row uses no place of the line: the limit counts heirs only', () => {
		const o = openWin(TREE, { succession: { limit: () => 1, oldAge: () => 110, youngDeathAge: () => 0 } });
		const p = page(o, 'crown');
		expect(lineRows(p)).toEqual(['1stKid Ardent']);
		// A row is reported when it stands at or before the end of the shown heirs: Early does, Lost (after the 2nd heir) does not.
		expect(branchRows(p)).toEqual([`?${T.branchRow('Early Ardent', 'c. 1141')}`]);
	});

	it('"and more branches" shows when more rows than the limit are cut', () => {
		const tree = TREE.replace('{id: kid, name: Kid Ardent, sex: m, born: 1100,', '{id: kid, name: Kid Ardent, sex: m, born: 1100, died: 1105,');
		const o = openWin(tree, { succession: { limit: () => 1, oldAge: () => 110, youngDeathAge: () => 0 } });
		const p = page(o, 'crown');
		// Kid and Early are both dead and childless before the first heir (Miss): two rows, one place.
		expect(lineRows(p)).toEqual(['1stMiss Ardent']);
		expect(branchRows(p)).toHaveLength(1);
		expect(section(p).querySelector('.dynasty-succ-more-branches')?.getText()).toBe(T.moreBranches);
	});

	it('"and more branches" does not show when no row is cut', () => {
		const o = openWin(TREE, { succession: { limit: () => 5, oldAge: () => 110, youngDeathAge: () => 0 } });
		expect(section(page(o, 'crown')).querySelector('.dynasty-succ-more-branches')).toBeNull();
	});

	it('a tap on a grey row shows the card, like a name', () => {
		const o = openWin(TREE, { succession: { limit: () => 5, oldAge: () => 110, youngDeathAge: () => 0 } });
		const p = page(o, 'crown');
		const b = p.querySelectorAll('.dynasty-succ-branch button')[0];
		dispatch(b, 'click');
		expect(o.shown).toEqual(['early']);
		expect(b.getAttribute('aria-label')).toBe(T.branchRowLabel(T.branchRow('Early Ardent', 'c. 1141')));
	});

	it('the window without the setting reads 0: every branch shows', () => {
		const o = openWin(TREE);
		expect(branchRows(page(o, 'crown'))).toHaveLength(2);
	});

	it('a row with a person who has no died text reads without the date', () => {
		expect(T.branchRow('Wren', '')).toBe('Open branch of Wren: no children in the tree');
	});
});
