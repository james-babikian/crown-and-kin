import { describe, expect, it } from 'vitest';
import { FLOW, NEW_SHEET, deleteText, parentTypeText, partnerDetail, unionDates, unionTypeText } from '../../src/render/ui-text';

describe('family texts (WP3.3)', () => {
	it('builds the §6.7 delete confirmation with the same meaning as the spec example', () => {
		expect(deleteText('Aldric Valmont', { unions: 2, childLinks: 3, clearsStart: false, clearsFocus: false })).toEqual([
			'The plugin also removes 2 partnerships of this person.',
			'The plugin removes Aldric Valmont as a parent of 3 people.',
			'The plugin does not delete other people.',
		]);
	});

	it('uses the singular for one partnership and one child, and names the start person', () => {
		expect(deleteText('Wren', { unions: 1, childLinks: 1, clearsStart: true, clearsFocus: true })).toEqual([
			'The plugin also removes 1 partnership of this person.',
			'The plugin removes Wren as a parent of 1 person.',
			'The tree starts at this person now. After the delete, it will start at a different person.',
			'The tree shows the family of this person now. After the delete, it will show all people.',
			'The plugin does not delete other people.',
		]);
	});

	it('says only that nobody else is deleted when nothing else changes', () => {
		expect(deleteText('Wren', { unions: 0, childLinks: 0, clearsStart: false, clearsFocus: false })).toEqual(['The plugin does not delete other people.']);
	});

	it('writes partnership dates and types', () => {
		expect(unionDates('1129', '1161')).toBe('1129–1161');
		expect(unionDates('1129')).toBe('from 1129');
		expect(unionDates(undefined, '1161')).toBe('until 1161');
		expect(unionDates()).toBe('');
		expect(partnerDetail('marriage', '1129')).toBe('Marriage, from 1129');
		expect(partnerDetail(null)).toBe('No recorded partnership');
		expect(unionTypeText('handfast')).toBe('Other (handfast)');
		expect(parentTypeText('ward')).toBe('Guardian');
	});

	it('names the new person and the picker row', () => {
		expect(NEW_SHEET.childOf('Roderick Valmont', 'Mathilde Harrow')).toBe('Child of Roderick Valmont and Mathilde Harrow');
		expect(NEW_SHEET.childOf('Roderick Valmont', null)).toBe('Child of Roderick Valmont');
		expect(NEW_SHEET.parentOf('adoptive', 'Tomas')).toBe('Adoptive parent of Tomas');
		expect(FLOW.createNew('  Ann ')).toBe('Create a new person “Ann”');
		expect(FLOW.createNew('')).toBe('Create a new person');
	});

	it('keeps plugin sentences within the STE length limit (20 words)', () => {
		const long = 'Aldric Valmont';
		const texts = [
			...deleteText(long, { unions: 2, childLinks: 3, clearsStart: true, clearsFocus: true }),
			FLOW.autoUnion(long, long),
			FLOW.existingWarn,
			FLOW.childTypeText(long, `${long} and ${long}`),
		];
		for (const t of texts) {
			for (const sentence of t.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
		}
	});
});
