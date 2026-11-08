import { describe, expect, it } from 'vitest';
import { SUCCESSION_UI as T } from '../../src/render/ui-text';

// D334 Q11: the three texts of the note about the first heir follow the STE rules and the word list.
describe('the texts about the first heir', () => {
	const texts = [
		T.firstHeirNoChild('Konrad VI', 'Jadwiga', 'sister'),
		T.firstHeirNoChild('Konrad VI', 'Wim', 'half-brother'),
		T.firstHeirDeadChild('Hugo of Valmont', 'Konrad VI'),
		// The name of the rule is an existing text of the Rule list ("during" is a word of it); the test checks the new words around it.
		T.firstHeirByRule('Jadwiga', 'Rule name'),
	];

	it('say the three facts in plain sentences', () => {
		expect(T.firstHeirNoChild('Konrad VI', 'Jadwiga', 'sister')).toBe('Konrad VI has no child in the tree. So the first place in the line goes to Jadwiga, the sister of Konrad VI.');
		expect(T.firstHeirDeadChild('Hugo of Valmont', 'Konrad VI')).toBe('Hugo of Valmont, a child of Konrad VI, is dead. So the children of Hugo of Valmont come first, in the place of Hugo of Valmont.');
		expect(T.firstHeirByRule('Jadwiga', T.rules['eldest-child'])).toBe('Jadwiga comes first because of the rule “Eldest child first (primogeniture)”.');
	});

	it('keep each sentence short, with no -ing word and no word of the word list that is banned', () => {
		for (const t of texts) {
			for (const sentence of t.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
			expect(t, t).not.toMatch(/\b[A-Za-z]{3,}ing\b/);
			expect(t, t).not.toMatch(/\b(graph|diagram|chart|node|tile|union|edge|layer|rank|fixture)\b/i);
		}
	});
});
