import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { FAMILY } from '../../src/render/ui-text';
import { FEl, clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';
import { writingHandle } from '../support/windows-sheets-support';

// D356 4 A: the Position heading names the two guardians of wards who are no couple; children of a couple keep "Position among siblings".

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

const people = (names: [string, string]) => ['people:', `  - {id: a, name: ${names[0]}}`, `  - {id: c, name: ${names[1]}}`, '  - {id: w1, name: Ward One, parents: [{id: a, type: ward}, {id: c, type: ward}]}', '  - {id: w2, name: Ward Two, parents: [{id: a, type: ward}, {id: c, type: ward}]}'].join('\n');

function headings(body: string, id: string): string[] {
	const s = EditSheet.create({} as never, { handle: writingHandle(body) as never, personId: id, sourcePath: 'n.md' } as never)!;
	s.open();
	const modal = (s as unknown as { modalEl: FEl }).modalEl;
	return modal.querySelectorAll('.dynasty-sub').map((e) => e.getText());
}

describe('D356 4 A', () => {
	it('wards of two guardians with no union: the heading names the guardians in note order', () => {
		const h = headings(`${people(['Roderick Harrow', 'Sabine Kestrel'])}\n`, 'w1');
		expect(h).toContain('Position among the wards of Roderick Harrow and Sabine Kestrel');
		expect(h).not.toContain(FAMILY.siblings);
	});
	it('right-to-left names are isolated', () => {
		expect(FAMILY.siblingsWards('דוד', 'Sabine')).toBe('Position among the wards of ⁨דוד⁩ and Sabine');
	});
	it('children of a couple keep "Position among siblings"', () => {
		const body = ['people:', '  - {id: a, name: Aldo}', '  - {id: c, name: Cara}', '  - {id: k1, name: K One, parents: [a, c]}', '  - {id: k2, name: K Two, parents: [a, c]}', 'unions:', '  - partners: [a, c]', ''].join('\n');
		const h = headings(body, 'k1');
		expect(h).toContain('Position among siblings');
		expect(h.some((t) => t.includes('wards'))).toBe(false);
	});
	it('a ward of three guardians keeps "Position among siblings"', () => {
		const body = ['people:', '  - {id: a, name: Aldo}', '  - {id: c, name: Cara}', '  - {id: d, name: Dora}', '  - {id: w1, name: Ward One, parents: [{id: a, type: ward}, {id: c, type: ward}, {id: d, type: ward}]}', '  - {id: w2, name: Ward Two, parents: [{id: a, type: ward}, {id: c, type: ward}, {id: d, type: ward}]}', ''].join('\n');
		const h = headings(body, 'w1');
		expect(h).toContain(FAMILY.siblings);
		expect(h.some((t) => t.includes('wards of'))).toBe(false);
	});
	it('two wards whose notes list the guardians in opposite orders show the same names, in the order of the first ward', () => {
		const body = ['people:', '  - {id: a, name: Roderick Harrow}', '  - {id: c, name: Sabine Kestrel}', '  - {id: w1, name: Ward One, parents: [{id: a, type: ward}, {id: c, type: ward}]}', '  - {id: w2, name: Ward Two, parents: [{id: c, type: ward}, {id: a, type: ward}]}', ''].join('\n');
		const want = 'Position among the wards of Roderick Harrow and Sabine Kestrel';
		expect(headings(body, 'w1')).toContain(want);
		expect(headings(body, 'w2')).toContain(want);
	});
});
