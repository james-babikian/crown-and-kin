import { describe, expect, it } from 'vitest';
import { REMOVE, unionTypeText } from '../src/render/ui-text';

/*
 * Search round 0.2.3, area C. The question "Remove partnership?" lower-cases the partnership type, also a
 * type that the owner wrote and the plugin does not know ("Other (Handfasting)").
 */

describe('Remove partnership question', () => {
	it('shows the name of an unknown partnership type as the owner wrote it', () => {
		const text = REMOVE.partnershipText(unionTypeText('Handfasting'), 'Aldric', 'Beata');
		expect(text).toContain('Handfasting');
	});

	it('control: a known type is lower-case in the sentence', () => {
		expect(REMOVE.partnershipText(unionTypeText('betrothal'), 'Aldric', 'Beata')).toContain('removes the betrothal of Aldric and Beata');
	});
});
