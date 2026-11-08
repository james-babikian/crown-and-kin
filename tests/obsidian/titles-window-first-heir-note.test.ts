import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closePluginModals } from '../../src/view/plugin-modals';
import { SUCCESSION_UI as T } from '../../src/render/ui-text';
import { clock, device, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { choose, openWin, page } from '../support/titles-window-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D334 Q11: the Titles window line of succession says why the first heir is not a child of the ruler, in one quiet note above the heirs. The real window
 * runs on the fake DOM with made-up trees.
 */

useFakeDom({ window: true });

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

/** A title `crown` with the holder `k`, the people `people` and a rule. */
function tree(people: string[], rule = 'eldest-child'): string {
	return ['titles:', '  - id: crown', '    name: Crown', `    succession: ${rule}`, '    holders:', '      - {person: k, from: 1100}', 'people:', ...people.map((p) => `  - ${p}`), ''].join('\n');
}

const PARENTS = ['{id: f, name: Fenn Ardent, sex: m, born: 1050, died: 1099}', '{id: m, name: Mira Ardent, sex: f, born: 1052, died: 1101}'];
const noteOf = (body: string): string | undefined => {
	const o = openWin(body);
	return page(o, 'crown').querySelector('[data-note="first-heir"]')?.getText();
};

describe('the note about the first heir', () => {
	it('names the sister when the ruler has no child', () => {
		const text = noteOf(tree([...PARENTS, '{id: k, name: Konrad Ardent, sex: m, born: 1070, parents: [f, m]}', '{id: j, name: Jadwiga Ardent, sex: f, born: 1075, parents: [f, m]}']));
		expect(text).toBe(T.firstHeirNoChild('Konrad Ardent', 'Jadwiga Ardent', 'sister'));
		expect(text).toContain('has no child in the tree. So the first place in the line goes to');
	});

	it('names the dead child when a child of a dead child takes the place', () => {
		const text = noteOf(tree(['{id: k, name: Konrad Ardent, sex: m, born: 1070}', '{id: v, name: Hugo Ardent, sex: m, born: 1095, died: 1120, parents: [k]}', '{id: w, name: Wim Ardent, sex: m, born: 1118, parents: [v]}']));
		expect(text).toBe(T.firstHeirDeadChild('Hugo Ardent', 'Konrad Ardent'));
	});

	it('names the sex rule when it left a child out', () => {
		const text = noteOf(tree([...PARENTS, '{id: k, name: Konrad Ardent, sex: m, born: 1070, parents: [f, m]}', '{id: d, name: Dora Ardent, sex: f, born: 1095, parents: [k]}', '{id: b, name: Bran Ardent, sex: m, born: 1075, parents: [f, m]}'], 'eldest-child').replace('    succession: eldest-child', '    succession: eldest-child\n    inherit: men-only'));
		expect(text).toBe(T.firstHeirByRule('Bran Ardent', T.inherits['men-only']));
	});

	it('names the mark when the only child is illegitimate', () => {
		const text = noteOf(tree([...PARENTS, '{id: k, name: Konrad Ardent, sex: m, born: 1070, parents: [f, m]}', '{id: d, name: Dora Ardent, sex: f, born: 1095, parents: [k], illegitimate: true}', '{id: b, name: Bran Ardent, sex: m, born: 1075, parents: [f, m]}']));
		expect(text).toBe(T.firstHeirBarred.illegitimate('Dora Ardent', 'Bran Ardent'));
		expect(text).toContain('has the box “Illegitimate” ticked. For this title, children with this box ticked cannot inherit.');
	});

	it('gives the rule when the reason is none of these', () => {
		// Only one parent is listed for both, so the word for the sister is not sure.
		const text = noteOf(tree(['{id: f, name: Fenn Ardent, sex: m, born: 1050, died: 1099}', '{id: k, name: Konrad Ardent, sex: m, born: 1070, parents: [f]}', '{id: j, name: Jadwiga Ardent, sex: f, born: 1075, parents: [f]}']));
		expect(text).toBe(T.firstHeirByRule('Jadwiga Ardent', T.rules['eldest-child']));
	});

	it('shows no note when the first heir is a child of the ruler', () => {
		expect(noteOf(tree(['{id: k, name: Konrad Ardent, sex: m, born: 1070}', '{id: c, name: Cass Ardent, sex: m, born: 1095, parents: [k]}']))).toBeUndefined();
	});

	it('follows the rule dropdown: a change of the rule draws the note again', () => {
		const o = openWin(tree([...PARENTS, '{id: k, name: Konrad Ardent, sex: m, born: 1070, parents: [f, m]}', '{id: j, name: Jadwiga Ardent, sex: f, born: 1075, parents: [f, m]}']));
		const p = page(o, 'crown');
		expect(p.querySelector('[data-note="first-heir"]')).not.toBeNull();
		choose(p, 'rule', 'youngest-child');
		expect(o.content.querySelector('.dynasty-lw-page [data-note="first-heir"]')).not.toBeNull();
	});
});
