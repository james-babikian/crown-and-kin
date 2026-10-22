import { describe, expect, it } from 'vitest';
import type { CodedIssue, HardError, HardErrorCode, IssueCode, IssueParams } from '../src/core/messages';
import { calendarRefusalText, CALENDAR_REFUSAL_TEXT, codedIssue, hardErrorText, ISSUE_CODES, issueText, LIMIT_DETAIL } from '../src/core/messages';
import { checkCalendars, checkFormat } from '../src/core/dates';
import { CURLY_APOSTROPHE, quote } from '../src/core/quote';

// Typed as a full record, so a new code in messages.ts fails the typecheck until it gets a sample here.
const SAMPLES: Record<IssueCode, IssueParams> = {
	'duplicate-person-id': { id: 'hal', name: 'Hal Ashford' },
	'duplicate-union-id': { id: 'spring-wedding' },
	'missing-parent': { person: 'Wynn Ashford', ref: 'ghost' },
	'missing-partner': { union: '#5', partners: ['Piers Ashford', 'nobody'], ref: 'nobody', absent: ['nobody'] },
	'missing-house': { person: 'Wynn Ashford', ref: 'ashfurd' },
	'missing-union': { person: 'Cole Ashford', ref: 'second-wedding' },
	'union-not-of-parents': { person: 'Cole Ashford', ref: 'spring-wedding' },
	'missing-start': { ref: 'aldous' },
	'missing-focus': { ref: 'lost-heir' },
	'missing-me': { ref: 'roderik' },
	'me-not-id': {},
	'too-many-parents': { person: 'Joss Ashford', type: 'birth', count: 3, limit: 2 },
	'union-partner-count': { union: '#3', partners: ['Joss Ashford', 'Maren Holt', 'Piers Ashford'], count: 3 },
	'union-same-partner': { union: '#4', partners: ['Tilda Ashford', 'Tilda Ashford'], person: 'Tilda Ashford' },
	cycle: { people: ['Arn Marsh', 'Bram Marsh', 'Col Marsh'], dropped: 'Arn Marsh', parent: 'Col Marsh' },
	'self-parent': { person: 'Aldric Valmont' },
	'placement-without-parents': { person: 'Piers Ashford', placement: 'ward' },
	'house-color-null': { house: 'House Brennock', id: 'brennock', value: '#2e7d4f' },
	'duplicate-house-id': { id: 'valmont', house: 'House Valmont' },
	'unknown-union-type': { union: '#6', partners: ['Ranulf Brennock', 'Sela Brennock'], value: 'marriege', suggestion: 'marriage' },
	'unknown-placement': { person: 'Tilda Ashford', value: 'fostered' },
	'unknown-parent-type': { person: 'Edda Brennock', value: 'godfather', parent: 'Ranulf Brennock' },
	// 0.2.8 contract A.2 (D195): holding a title through the spouse.
	'through-spouse-no-partner': { person: 'Hugo', title: 'Duke of Valmont' },
	'through-spouse-no-marriage': { person: 'Hugo', title: 'Duke of Valmont' },
	'through-spouse-self': { person: 'Hugo', title: 'Duke of Valmont' },
	'through-spouse-no-claim': { person: 'Hugo', title: 'Duke of Valmont', count: 2, partners: ['Anna', 'Berta'], example: 'anna' },
	'through-spouse-several-claims': { person: 'Hugo', title: 'Duke of Valmont', count: 2, partners: ['Anna', 'Berta'], example: 'anna' },
	'through-spouse-not-partner': { person: 'Hugo', title: 'Duke of Valmont', ref: 'carl', other: 'Carl' },
	'through-spouse-unknown-person': { person: 'Hugo', title: 'Duke of Valmont', ref: 'carl' },
	'entry-not-map': { section: 'people', index: 3 },
	'missing-id': { section: 'people', index: 2, name: 'Aldric Valmont' },
	'section-wrong-shape': { section: 'unions' },
	'duplicate-title-id': { id: 'duke-of-valmont', title: 'Duke of Valmont' },
	'missing-holder': { title: 'Duke of Valmont', ref: 'aldrik' },
	'holder-empty': { title: 'Duke of Valmont', index: 4 },
	'card-title-not-held': { person: 'Roderick Valmont', ref: 'king-of-ostmark' },
	'missing-picture': { owner: 'arms', house: 'House Valmont', file: 'valmont-arms.png' },
	'picture-web': { owner: 'portrait', person: 'Aldric Valmont' },
	'picture-not-image': { owner: 'portrait', person: 'Wren', file: 'wren-photo.jpg', format: 'HEIC' },
	'picture-too-large': { owner: 'arms', house: 'House Greymane', file: 'huge-banner.png', pixels: 54 },
	'bad-portrait-crop': { person: 'Bertrand Valmont' },
	// Contract 0.2.7 A.5, K.4 (J.4, J.7): the succession keys, the sex spellings and the doubtful death texts.
	'unknown-succession': { title: 'Duke of Valmont', value: 'primogenitor' },
	'unknown-inherit': { title: 'Duke of Valmont', value: 'sideways' },
	'unknown-inherit-through': { title: 'Duke of Valmont', value: 'sideways' },
	'unknown-inherit-illegitimate': { title: 'Duke of Valmont', value: 'maybe' },
	'year-unreadable': { title: 'Duke of Valmont', value: 'the old days' },
	'missing-heir': { title: 'Duke of Valmont', ref: 'hugo' },
	'missing-excluded': { title: 'Duke of Valmont', ref: 'wren' },
	'sex-spelling': { person: 'Wren Valmont', value: 'F' },
	'died-doubtful': { person: 'Hugo Valmont', value: 'maybe' },
	// Contract 0.2.7 M.6: the person key `childless` on a person who has a birth child.
	'childless-has-child': { person: 'Aldric Valmont', child: 'Hugo Valmont' },
	// WP-4 step 4.2 (spec §14): the date warnings, the calendar problems and the calendar block.
	'year-zero': { where: 'year', title: 'Duke of Valmont', value: '0' },
	'calendar-year-zero': { where: 'born', person: 'Hugo Valmont', value: 'Qinglong Emperor 0' },
	'calendar-year-past-end': { where: 'reign', title: 'Duke of Valmont', value: 'Qinglong Emperor 12' },
	'fits-two-calendars': { where: 'died', person: 'Hugo Valmont', value: 'Qinglong Emperor 3', calendars: ['Reign names', 'Reign names (copy)'] },
	'calendar-no-anchor': { calendar: 'The Long Count' },
	'calendar-note-missing': { note: '[[Calendars of the Far Land]]' },
	'calendar-duplicate': { calendar: 'Reign names', note: 'Calendars 1.md', other: 'Calendars.md' },
	'calendar-block-invalid': { note: 'Calendars.md' },
	'calendar-entry-invalid': { note: 'Calendars.md', index: 2, why: 'no-name' },
	// Spec §14 rules 13 and 14.
	'calendar-name-mismatch': { where: 'born', person: 'Hugo Valmont', value: '22.13 Ju', list: 'Planets', expected: 'Saturn', written: 'Jupiter' },
	'calendar-list-invalid': { note: 'Calendars.md', calendar: 'The Long Count', index: 2, why: 'names' },
};

/** Spec §13.3 gives this warning three short sentences, §13.6 the HEIC text four (checked by ste-editor). */
const MOST_SENTENCES: Partial<Record<IssueCode, number>> = {
	'card-title-not-held': 3,
	'picture-not-image': 4,
	// Contract 0.2.7 A.5: the name of the title, what the plugin does, and the values to use (with the Salic hint: four).
	'unknown-succession': 4,
	'unknown-inherit': 3,
	'unknown-inherit-through': 3,
	'unknown-inherit-illegitimate': 3,
	'year-unreadable': 5,
	'unknown-union-type': 3,
	'cycle': 3,
	'self-parent': 2,
	'unknown-parent-type': 3,
	'union-partner-count': 3,
	'too-many-parents': 3,
	'through-spouse-no-partner': 3,
	'through-spouse-no-marriage': 3,
	'through-spouse-no-claim': 4,
	'through-spouse-self': 3,
	'picture-web': 4,
	'through-spouse-several-claims': 3,
	'through-spouse-not-partner': 3,
	'through-spouse-unknown-person': 3,
	'sex-spelling': 3,
	'died-doubtful': 3,
	// ruling 4.2 fix: the clarity editor's rewrites of the date texts say what the plugin does and what the user can do.
	'year-zero': 5,
	'calendar-year-zero': 4,
	'calendar-year-past-end': 5,
	'fits-two-calendars': 4,
	'calendar-no-anchor': 5,
	'calendar-note-missing': 3,
	'calendar-duplicate': 5,
	'calendar-block-invalid': 4,
	'calendar-entry-invalid': 3,
	'calendar-name-mismatch': 5,
	'calendar-list-invalid': 4,
};

/** Texts whose first sentence is a description of 21 to 25 words (STE allows 25 for a description; D205 words). */
// ruling 4.2 fix: the first sentence of calendar-note-missing is 15 words and holds the link, which the sample makes 5 words.
const LONG_SENTENCE: IssueCode[] = ['through-spouse-no-claim', 'through-spouse-several-claims', 'calendar-note-missing'];

/** Picture warnings name a picture file, which is not a note, so the word list allows "file" there (spec §13.6). */
const FILE_WORD: IssueCode[] = ['missing-picture', 'picture-not-image'];

const HARD: Record<HardErrorCode, HardError> = {
	'yaml-invalid': { code: 'yaml-invalid', line: 3, detail: 'Nested mappings are not allowed' },
	'not-a-map': { code: 'not-a-map' },
};

const BLOCKING: IssueCode[] = ['duplicate-person-id', 'duplicate-union-id'];
const issue = (code: IssueCode, params: IssueParams): CodedIssue => ({ code, level: BLOCKING.includes(code) ? 'blocking' : 'warning', params });

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/);
/** Quoted text is what the user typed (ids, YAML keys), so the word list does not apply to it. */
const unquoted = (text: string) => text.replace(/“[^”]*”/g, '“”').replace(/"[^"]*"/g, '""').replace(/\{[^}]*\}/g, '{}');

/** Words the project word list replaces, plus signs of an unfilled template. */
const FORBIDDEN = /\b(union|unions|node|nodes|edge|edges|graph|diagram|chart|layer|rank|fixture|file|document)\b/i;
const UNFILLED = /undefined|null|NaN|\[object|\$\{|\{\{|\?\?/;

function checkText(text: string, most = 2, file = false, words = 20) {
	expect(text.trim()).not.toBe('');
	expect(text).not.toMatch(UNFILLED);
	const parts = sentences(text);
	expect(parts.length).toBeLessThanOrEqual(most);
	for (const sentence of parts) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(words);
	expect(file ? unquoted(text).replace(/\bfile\b/g, '') : unquoted(text)).not.toMatch(FORBIDDEN);
	expect(text).not.toMatch(/\b(don't|can't|isn't|doesn't|won't)\b/i);
	// Spec D113: the word ID is in capital letters; only the key "id:" in an example (and quoted text) is lower case.
	expect(unquoted(text), text).not.toMatch(/(?<![\w-])ids?\b(?!:)/);
}

describe('issueText: one STE entry per code', () => {
	for (const [code, params] of Object.entries(SAMPLES) as [IssueCode, IssueParams][]) {
		it(`${code}: filled, at most 2 sentences of at most 20 words, word list obeyed`, () => {
			checkText(issueText(issue(code, params)), MOST_SENTENCES[code] ?? 2, FILE_WORD.includes(code), LONG_SENTENCE.includes(code) ? 25 : 20);
		});
		it(`${code}: still readable when the params are missing`, () => {
			const text = issueText(issue(code, {}));
			expect(text.trim()).not.toBe('');
			expect(text).not.toMatch(UNFILLED);
		});
	}

	it('uses names for people and quotes only ids that do not exist', () => {
		expect(issueText(issue('missing-parent', SAMPLES['missing-parent']))).toBe(
			'Wynn Ashford has a parent with the ID “ghost”, but no person has this ID. Correct the ID, or add the person.',
		);
		expect(issueText(issue('missing-partner', SAMPLES['missing-partner']))).toContain('the partnership of Piers Ashford and “nobody”');
	});

	it('gives the colour to quote when it was recovered', () => {
		expect(issueText(issue('house-color-null', SAMPLES['house-color-null']))).toBe('House Brennock has no colour. Put quotes around the colour: color: "#2e7d4f".');
		expect(issueText(issue('house-color-null', { house: 'valmont', id: 'valmont' }))).toMatch(/^The house “valmont” has no colour\. If you wrote a colour/);
	});

	it('covers every section for the shape codes', () => {
		for (const section of ['people', 'houses', 'unions', 'parents']) {
			checkText(issueText(issue('entry-not-map', { section, index: 2, person: 'Aldric Valmont' })));
			checkText(issueText(issue('missing-id', { section, index: 2, person: 'Aldric Valmont' })));
			checkText(issueText(issue('missing-id', { section, index: 2, name: 'House Valmont', person: 'Aldric Valmont' })));
		}
		for (const section of ['people', 'houses', 'unions', 'options']) checkText(issueText(issue('section-wrong-shape', { section })));
		checkText(issueText(issue('union-partner-count', { union: 'w', partners: [], count: 0 })));
		checkText(issueText(issue('union-partner-count', { union: '#1', partners: ['Aldric Valmont'], count: 1 })));
	});

	it('suggests the example id that the reader gives (D104), and p1 when there is none', () => {
		expect(issueText(issue('missing-id', { ...SAMPLES['missing-id'], example: 'p4' }))).toBe('Aldric Valmont has no ID. Add an ID, for example: id: p4.');
		expect(issueText(issue('missing-id', { section: 'people', index: 2 }))).toBe('Entry 2 in the “people” list has no ID. Add an ID, for example: id: p1.');
		// The name never makes the example.
		expect(issueText(issue('missing-id', SAMPLES['missing-id']))).not.toContain('aldric-valmont');
	});

	it('a duplicate person id shows the name and the id as NAME (id), without quote marks (D105)', () => {
		const text = (params: IssueParams) => issueText(issue('duplicate-person-id', params));
		expect(text({ id: 'p3', name: 'Aldric Valmont' })).toBe('Aldric Valmont (p3) has the same ID as another person. To edit the tree again, give each person a different ID.');
		// No name, or the name is the id: the id alone, in quote marks.
		expect(text({ id: 'p3', name: 'p3' })).toBe('More than one person has the ID “p3”. To edit the tree again, give each person a different ID.');
		expect(text({ id: 'p3', name: '' })).toBe(text({ id: 'p3' }));
		expect(text({ id: 'p3' })).toContain('“p3”');
	});
});

describe('issueText: title warnings (spec §13.3, §13.4)', () => {
	const text = (code: IssueCode, params: IssueParams) => issueText(issue(code, params));

	it('the titles section and its entries', () => {
		expect(text('section-wrong-shape', { section: 'titles' })).toBe('The “titles” section is not a list, so the tree ignores it. Start each title with “- id:”.');
		expect(text('entry-not-map', { section: 'titles', index: 2 })).toBe('Entry 2 in the “titles” list is not a title, so the tree does not show it. Start each title with “- id:”.');
		expect(text('missing-id', { section: 'titles', index: 3 })).toBe(
			'Entry 3 in the “titles” list has no ID, so the tree does not use this title. Add an ID, for example: id: duke-of-valmont.',
		);
		expect(text('missing-id', { section: 'titles', index: 3, name: 'Duke of Valmont' })).toBe(
			'Duke of Valmont has no ID, so the tree does not use this title. Add an ID, for example: id: duke-of-valmont.',
		);
		expect(text('missing-id', { section: 'titles', index: 1, name: 'King of Ostmark' })).toContain('id: king-of-ostmark.');
		expect(text('duplicate-title-id', SAMPLES['duplicate-title-id'])).toBe(
			'More than one title has the ID “duke-of-valmont”, and the tree uses only the first. Give each title a different ID.',
		);
	});

	it('the holders of a title', () => {
		expect(text('section-wrong-shape', { section: 'holders', title: 'Duke of Valmont' })).toBe(
			'The holders of the title Duke of Valmont are not a list, so the tree ignores them. Write each holder like this: - {person: aldric}.',
		);
		expect(text('entry-not-map', { section: 'holders', index: 5, title: 'Duke of Valmont' })).toBe(
			'Entry 5 in the holders of Duke of Valmont is not a holder. Write each holder like this: - {person: aldric}.',
		);
		expect(text('missing-holder', { title: 'Duke of Valmont', ref: 'aldrik' })).toBe(
			'The title Duke of Valmont has a holder with the ID “aldrik”, but no person has this ID. Correct the ID, or write the name of the holder.',
		);
		expect(text('missing-holder', { title: 'Duke of Valmont', ref: 'aldrik', name: 'Aldric' })).toBe(text('missing-holder', { title: 'Duke of Valmont', ref: 'aldrik' }));
		expect(text('holder-empty', SAMPLES['holder-empty'])).toBe('Entry 4 in the holders of Duke of Valmont has no person and no name. Add “person:” or “name:”.');
	});

	it('card-title-not-held', () => {
		expect(text('card-title-not-held', SAMPLES['card-title-not-held'])).toBe(
			'Roderick Valmont has “card-title: king-of-ostmark”, but Roderick Valmont does not hold a title with this ID. The card shows the first title instead. Correct the ID, or remove it.',
		);
	});

	it('the holder texts stay readable with no title name', () => {
		for (const params of [{ section: 'holders', index: 1 }, { ref: 'x' }, { index: 2 }] as IssueParams[]) {
			for (const code of ['section-wrong-shape', 'entry-not-map', 'missing-holder', 'holder-empty'] as IssueCode[]) {
				const t = text(code, params);
				expect(t).not.toMatch(UNFILLED);
				expect(t).not.toMatch(/ {2}/);
			}
		}
		expect(text('missing-holder', { ref: 'x' })).toMatch(/^A title has a holder/);
		expect(text('holder-empty', { index: 2 })).toBe('Entry 2 in the holders of a title has no person and no name. Add “person:” or “name:”.');
	});

	it('covers the new sections of the shape codes', () => {
		checkText(text('section-wrong-shape', { section: 'titles' }));
		checkText(text('section-wrong-shape', { section: 'holders', title: 'Duke of Valmont' }));
		checkText(text('entry-not-map', { section: 'titles', index: 2 }));
		checkText(text('entry-not-map', { section: 'holders', index: 2, title: 'Duke of Valmont' }));
		checkText(text('missing-id', { section: 'titles', index: 2, name: 'Duke of Valmont' }));
	});
});

describe('issueText: succession warnings (contract 0.2.7 A.5, J.4, J.7, K.4)', () => {
	const text = (code: IssueCode, params: IssueParams) => issueText(issue(code, params));
	const RULES = 'Use one of these rules: eldest-child, youngest-child, siblings-first, nearest-relative, born-in-reign.';

	it('unknown-succession lists the five rules', () => {
		expect(text('unknown-succession', { title: 'Duke of Valmont', value: 'primogenitor' })).toBe(
			`The title Duke of Valmont has “succession: primogenitor”. The plugin does not know this rule, so it shows no line of succession. ${RULES}`,
		);
	});

	it('unknown-succession with the value salic or semi-salic adds the hint sentence', () => {
		expect(text('unknown-succession', { title: 'Duke of Valmont', value: 'salic' })).toBe(
			`The title Duke of Valmont has “succession: salic”. The plugin does not know this rule, so it shows no line of succession. ${RULES} For the Salic law, use “succession: eldest-child” with “inherit: men-only”.`,
		);
		expect(text('unknown-succession', { title: 'Duke of Valmont', value: 'semi-salic' })).toBe(
			`The title Duke of Valmont has “succession: semi-salic”. The plugin does not know this rule, so it shows no line of succession. ${RULES} For the semi-Salic law, use “succession: eldest-child” with “inherit: men-first-in-house”.`,
		);
	});

	it('unknown-inherit lists the seven values', () => {
		expect(text('unknown-inherit', { title: 'Duke of Valmont', value: 'sideways' })).toBe(
			'The title Duke of Valmont has “inherit: sideways”. The plugin does not know this rule, so it shows no line of succession. Use one of these rules: men-only, men-first-in-house, men-first, no-preference, women-first, women-first-in-house, women-only.',
		);
	});

	it('unknown-inherit-through names the key and the three values (J.1, K.1)', () => {
		const t = text('unknown-inherit-through', { title: 'Duke of Valmont', value: 'sideways' });
		expect(t).toMatch(/^The title Duke of Valmont has “inherit-through: sideways”\. /);
		expect(t).toContain('shows no line of succession');
		expect(t).toContain('men, women, anyone');
	});

	it('unknown-inherit-illegitimate lists the three values', () => {
		expect(text('unknown-inherit-illegitimate', { title: 'Duke of Valmont', value: 'maybe' })).toBe(
			'The title Duke of Valmont has “inherit-illegitimate: maybe”. The plugin does not know this value, so it shows no line of succession. Use one of these values: no, after, equal.',
		);
	});

	it('year-unreadable says that the end of the last reign is used', () => {
		expect(text('year-unreadable', { title: 'Duke of Valmont', value: 'the old days' })).toBe(
			'The title Duke of Valmont has “year: the old days”. The plugin cannot find a year in it. The line of succession uses the end of the last reign. If the last reign has no end, the line is for now. Write the year as a number, for example “year: 1210”.',
		);
	});

	it('missing-heir and missing-excluded name the key and the ID', () => {
		expect(text('missing-heir', { title: 'Duke of Valmont', ref: 'hugo' })).toBe('The title Duke of Valmont has “heir: hugo”, but no person has this ID. Correct the ID, or remove it.');
		expect(text('missing-excluded', { title: 'Duke of Valmont', ref: 'wren' })).toBe('The title Duke of Valmont has “exclude: wren”, but no person has this ID. Correct the ID, or remove it.');
	});

	it('sex-spelling tells the user to write m or f', () => {
		expect(text('sex-spelling', { person: 'Wren Valmont', value: 'F' })).toBe(
			'Wren Valmont has “sex: F”. The plugin reads only “m” and “f” as a man and a woman. If you mean a man or a woman, write “sex: m” or “sex: f”.',
		);
	});

	it('childless-has-child names the person and the child, and gives two ways to fix it', () => {
		expect(text('childless-has-child', { person: 'Aldric Valmont', child: 'Hugo Valmont' })).toBe(
			'Aldric Valmont has “childless: true”, but Hugo Valmont is a child of Aldric Valmont in the tree. Remove “childless: true”, or correct the parents of Hugo Valmont.',
		);
	});

	it('died-doubtful says that the person counts as dead', () => {
		expect(text('died-doubtful', { person: 'Hugo Valmont', value: 'maybe' })).toBe(
			'Hugo Valmont has “died: maybe”. The plugin counts Hugo Valmont as dead. If Hugo Valmont is alive, remove “died: maybe” from the note.',
		);
	});
});

describe('issueText: picture warnings (spec §13.6, §13.7)', () => {
	const text = (code: IssueCode, params: IssueParams) => issueText(issue(code, params));
	const arms = { owner: 'arms', house: 'House Valmont' };
	const portrait = { owner: 'portrait', person: 'Aldric Valmont' };

	it('arms take "use" and "are", a portrait "uses" and "is"', () => {
		expect(text('missing-picture', { ...arms, file: 'x.png' })).toBe(
			'The arms of House Valmont use the picture “x.png”, but the vault has no file with this name. Correct the link, or select other arms.',
		);
		expect(text('missing-picture', { ...portrait, file: 'x.png' })).toBe(
			'The portrait of Aldric Valmont uses the picture “x.png”, but the vault has no file with this name. Correct the link, or select another portrait.',
		);
		expect(text('picture-web', arms)).toBe('The arms of House Valmont are a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.');
		expect(text('picture-web', portrait)).toBe('The portrait of Aldric Valmont is a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.');
	});

	it('picture-not-image names a known format, else says the file is not a picture', () => {
		expect(text('picture-not-image', { ...arms, file: 'x.tif', format: 'TIFF' })).toBe(
			'The arms of House Valmont use the picture “x.tif”. The plugin cannot show TIFF pictures. Save the picture as PNG or JPEG. Then select it again.',
		);
		expect(text('picture-not-image', { ...portrait, file: 'x.pdf' })).toBe(
			'The portrait of Aldric Valmont uses the file “x.pdf”, which is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.',
		);
	});

	it('picture-too-large gives the millions of pixels only when known (A6)', () => {
		expect(text('picture-too-large', { ...arms, file: 'x.png', pixels: 41 })).toBe(
			'The arms of House Valmont use the picture “x.png”, which is too large (41 million pixels). Use a picture with 40 million pixels or less.',
		);
		for (const pixels of [undefined, 0, Number.NaN]) {
			const params: IssueParams = { ...arms, file: 'x.png' };
			if (pixels !== undefined) params.pixels = pixels;
			expect(text('picture-too-large', params)).toBe('The arms of House Valmont use the picture “x.png”, which is too large. Use a picture with 40 million pixels or less.');
		}
	});

	it('with no owner, a person name makes it a portrait; with no names, the text still reads', () => {
		expect(text('picture-web', { person: 'Wren' })).toBe('The portrait of Wren is a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.');
		expect(text('picture-web', {})).toBe('The arms of a house are a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.');
		expect(text('missing-picture', { owner: 'portrait' })).toBe(
			'The portrait of a person uses the picture “?”, but the vault has no file with this name. Correct the link, or select another portrait.',
		);
	});

	it('the portrait forms of the other texts are in STE too', () => {
		checkText(text('missing-picture', { ...portrait, file: 'aldric.jpg' }), 2, true);
		checkText(text('picture-not-image', { ...arms, file: 'x.pdf' }), 2, true);
		checkText(text('picture-too-large', { ...portrait, file: 'x.png' }));
		checkText(text('picture-web', arms), 4);
	});
});

describe('hardErrorText', () => {
	for (const [code, error] of Object.entries(HARD)) {
		it(`${code}: filled and in STE`, () => {
			const text = hardErrorText(error);
			// F8: the parser's own message follows "Details:" in plain words (tests/r031-small-a.test.ts checks them).
			checkText(text.split(' Details: ')[0]);
			// "line" alone means a drawn line (project word list); a line of text is a "text line".
			expect(text.split(' Details: ')[0]).not.toMatch(/(?<!text )line/i);
		});
	}

	it('yaml-invalid shows the line and the parser message in plain words (F8)', () => {
		expect(hardErrorText(HARD['yaml-invalid'])).toBe(
			'Text line 3 of the tree text has an error. Correct this text line to show the tree. Details: The value of a field has a colon “:” in it. Put the value in quote marks.',
		);
		expect(hardErrorText({ code: 'yaml-invalid' })).toBe('The tree text has an error. Correct the text to show the tree.');
	});

	// WP-H2: the details that the plugin writes itself are plain words, in STE. Each has three short sentences (owner-approved words).
	for (const [key, detail] of [
		['tooLarge', LIMIT_DETAIL.tooLarge],
		['tooDeep', LIMIT_DETAIL.tooDeep],
		['duplicateKey', LIMIT_DETAIL.duplicateKey('born')],
	] as const) {
		it(`the limit detail ${key} is in STE`, () => {
			checkText(detail, 3);
			expect(detail).not.toMatch(/stack|exceeded|recursion|alias count|block|map/i);
			expect(hardErrorText({ code: 'yaml-invalid', detail })).toContain(detail);
		});
	}

	it('the limit details are the words that the owner approved', () => {
		expect(LIMIT_DETAIL.tooLarge).toBe(
			'The mark “*” repeats text that you named with the mark “&”. The tree text uses these marks so often that the plugin cannot read it. Replace some of the marks “*” with the text that they repeat.',
		);
		expect(LIMIT_DETAIL.tooDeep).toBe(
			'The tree text goes too many levels deep. A level is a list or a section inside another list or section. Remove the extra levels.',
		);
	});

	it('the repeated-key detail names the real key, and falls back to name for an odd key', () => {
		expect(LIMIT_DETAIL.duplicateKey('born')).toBe(
			'One person or section has the field “born:” two times. Delete one of the text lines, or change the name of the field.',
		);
		const fallback = 'One person or section has the same field two times, for example two “name:” text lines. Delete one of the text lines, or change the name of the field.';
		expect(LIMIT_DETAIL.duplicateKey()).toBe(fallback);
		expect(LIMIT_DETAIL.duplicateKey('a key with spaces and a very long name that fills the line')).toBe(fallback);
		expect(LIMIT_DETAIL.duplicateKey('x\ny')).toBe(fallback);
	});

	it('a hard error says "tree text", not "block"', () => {
		expect(hardErrorText({ code: 'not-a-map' })).toBe(
			'The tree text does not have sections such as “people:”. To show the tree, put each person in a list below “people:”.',
		);
		for (const e of [HARD['yaml-invalid'], { code: 'yaml-invalid' as const }, HARD['not-a-map']]) expect(hardErrorText(e)).not.toMatch(/block/i);
	});
});

describe('quote marks in the message table (D99)', () => {
	/** The one text with a straight quote mark on purpose: the YAML example that the user types. */
	const YAML_EXAMPLE: IssueCode = 'house-color-null';
	const everyText = (code: IssueCode): string[] => [issueText(issue(code, SAMPLES[code])), issueText(issue(code, {}))];

	it('SAMPLES has a sample for every code of the table', () => {
		expect(Object.keys(SAMPLES).sort()).toEqual([...ISSUE_CODES].sort());
	});

	it('no message has a straight double quote mark or apostrophe, except the YAML example', () => {
		for (const code of ISSUE_CODES) {
			if (code === YAML_EXAMPLE) continue;
			for (const text of everyText(code)) expect(text, code).not.toMatch(/["']/);
		}
		for (const error of Object.values(HARD)) expect(hardErrorText(error)).not.toMatch(/["']/);
		expect(hardErrorText({ code: 'not-a-map' })).toContain(quote('people:'));
	});

	it('the colour message keeps its YAML example straight and quotes the rest with curly marks', () => {
		const text = issueText(issue('house-color-null', { house: 'valmont', id: 'valmont' }));
		expect(text).toContain('color: "#8b1e3f".');
		expect(text).toContain(quote('valmont'));
		expect(text.replace('color: "#8b1e3f"', '')).not.toMatch(/["']/);
		const recovered = issueText(issue('house-color-null', SAMPLES['house-color-null']));
		expect(recovered).toBe('House Brennock has no colour. Put quotes around the colour: color: "#2e7d4f".');
	});

	it('a message quotes ids and keys with curly marks and leaves names bare', () => {
		const text = issueText(issue('missing-parent', SAMPLES['missing-parent']));
		expect(text).toContain(`the ID ${quote('ghost')}`);
		expect(text).toContain('Wynn Ashford has');
		expect(text).not.toContain(CURLY_APOSTROPHE);
	});
});

describe('codedIssue', () => {
	it('keeps ids only when there are some', () => {
		expect(codedIssue('self-parent', 'warning', { person: 'A' }, ['a'])).toEqual({ code: 'self-parent', level: 'warning', params: { person: 'A' }, ids: ['a'] });
		expect('ids' in codedIssue('duplicate-union-id', 'blocking', { id: 'u' }, [])).toBe(false);
		expect('ids' in codedIssue('missing-start', 'warning', { ref: 'x' })).toBe(false);
	});
});

describe('calendarRefusalText: the refusals of the Calendars window (spec §14 rule 3)', () => {
	const KEYS = Object.keys(CALENDAR_REFUSAL_TEXT);

	it('has a sentence for every key that checkFormat and checkCalendars give', () => {
		const given = new Set<string>();
		for (const [kind, format] of [['cycles', '{year}'], ['cycles', '{cycle}{year}'], ['eras', '{cycle} {year}'], ['eras', '{era} {era} {year}'], ['cycles', '{year} {cycle} {nope}']] as const) {
			const key = checkFormat(kind, format);
			if (key) given.add(key);
		}
		const cycles = (name: string, formats: string[], length = 5, start = 1) => ({ id: name, name, note: 'C.md', formats, kind: { type: 'cycles' as const, length, start } });
		const eras = (name: string, ...names: string[]) => ({ id: name, name, note: 'C.md', formats: ['{era} {year}'], kind: { type: 'eras' as const, eras: names.map((n) => ({ name: n, start: 1 })) } });
		for (const r of [...checkCalendars([cycles('A', ['{cycle} {year}']), cycles('B', ['{CYCLE} {year}'])]), ...checkCalendars([eras('A', 'Tang'), eras('B', 'tang')]), ...checkCalendars([eras('A', 'Tang', 'TANG')]), ...checkCalendars([cycles('A', ['{cycle} {year}']), cycles('A', ['{year} {cycle}'])]), ...checkCalendars([cycles('A', ['{cycle} {year}'], 0, 1.5)])]) given.add(r.key);
		expect([...given].sort()).toEqual([...KEYS].sort());
	});

	it('is short, in the active voice, names the other calendar and fills every place', () => {
		const samples: { calendar: string; key: string; other?: string }[] = [
			...KEYS.map((key) => ({ calendar: 'Reign names', key })),
			{ calendar: 'Reign names', key: 'calendar-format-duplicate', other: 'The Long Count' },
			{ calendar: 'Reign names', key: 'calendar-era-duplicate', other: 'Dynasties' },
		];
		for (const sample of samples) {
			const text = calendarRefusalText(sample);
			expect(text.trim(), sample.key).not.toBe('');
			expect(text, sample.key).not.toMatch(UNFILLED);
			const parts = sentences(text);
			// ruling 4.2 fix: a format refusal gives its rule, what is wrong with the format, and an example (3 sentences).
			expect(parts.length, text).toBeLessThanOrEqual(3);
			for (const part of parts) expect(part.split(/\s+/).length, part).toBeLessThanOrEqual(20);
			expect(unquoted(text), text).not.toMatch(FORBIDDEN);
		}
		expect(calendarRefusalText({ calendar: 'Reign names', key: 'calendar-era-duplicate', other: 'Dynasties' })).toBe('The calendar “Reign names” and the calendar “Dynasties” have the same era name. A date with this name would fit both. Change one era name.');
		expect(calendarRefusalText({ calendar: 'A', key: 'calendar-format-cycle' })).toBe('A cycle format needs {year} and {cycle}, one time each. It cannot have any other word in curly brackets. An example is “{year} Year of the {cycle} Cycle”.');
	});

	it('gives a plain sentence for a key it does not know, and never throws', () => {
		expect(calendarRefusalText({ calendar: 'A', key: 'something-new' })).toBe('The calendar has an error. Correct the calendar.');
		expect(() => calendarRefusalText(null as never)).not.toThrow();
		expect(calendarRefusalText(null as never)).toBe('The calendar has an error. Correct the calendar.');
	});
});
