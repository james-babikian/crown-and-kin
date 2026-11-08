import { describe, expect, it } from 'vitest';
import { HOUSES, ID_UI, REMOVE, TITLES_UI } from '../../src/render/ui-text';

// D334 Q8: a text that stands beside an Undo button does not say "You can undo this."; the confirm question has no button and keeps it.
describe('texts beside an Undo button', () => {
	const beside = [
		REMOVE.deleted('Aldric Valmont'),
		REMOVE.removedPartnership('Aldric Valmont', 'Edith Valmont'),
		REMOVE.removedParent('Aldric Valmont', 'Roderick Valmont'),
		HOUSES.deleted(['House Valmont']),
		HOUSES.deleted(['House A', 'House B']),
		ID_UI.changed(1),
		ID_UI.changed(3),
		TITLES_UI.deleted(['Duke of Valmont']),
		TITLES_UI.deleted(['A', 'B']),
		TITLES_UI.removed('Aldric Valmont', 'Duke of Valmont'),
	];
	it('end after the change and never add the Undo sentence', () => {
		for (const text of beside) expect(text).not.toMatch(/undo/i);
	});
	it('keep the sentence for the confirm question that has no Undo button', () => {
		expect(REMOVE.canUndo).toBe('You can undo this.');
	});
});
