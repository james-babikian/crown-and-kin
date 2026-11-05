import { describe, expect, it } from 'vitest';
import { BIDI_FSI, BIDI_PDI } from '../../src/render/bidi-controls';
import { CHANGE_UI } from '../../src/render/change-text';
import { isolateName } from '../../src/render/name-bidi';

/* The list of parents is built from names that are isolated one by one, so the sentence holds no isolate inside an isolate (D322). */
const depth = (text: string): number => {
	let d = 0;
	let max = 0;
	for (const ch of text) {
		if (ch === BIDI_FSI) max = Math.max(max, ++d);
		else if (ch === BIDI_PDI) d--;
	}
	return max;
};

describe('Add child sentences', () => {
	const parents = `${isolateName('كريم Mansour')} and Aldric`;
	it.each([
		['added', CHANGE_UI.addedChild('Dara', parents, 'birth')],
		['undone', CHANGE_UI.undoneAddedChild('Dara', parents, 'birth')],
	])('%s: the list of parents is not wrapped again', (_k, text) => {
		expect(depth(text)).toBe(1);
		expect(text).toContain(`of ${parents}.`);
	});
	it('the words stay as they were for left-to-right names', () => {
		expect(CHANGE_UI.addedChild('Dara', 'Cora and Odo', 'ward')).toBe('The plugin added Dara as a ward of Cora and Odo.');
	});
});
