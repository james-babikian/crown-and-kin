import { describe, expect, it } from 'vitest';
import type { CodedIssue, HardError, HardErrorCode, IssueCode, IssueParams } from '../src/core/messages';
import { codedIssue, hardErrorText, issueText } from '../src/core/messages';

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
	'too-many-parents': { person: 'Joss Ashford', type: 'birth', count: 3 },
	'union-partner-count': { union: '#3', partners: ['Joss Ashford', 'Maren Holt', 'Piers Ashford'], count: 3 },
	'union-same-partner': { union: '#4', partners: ['Tilda Ashford', 'Tilda Ashford'], person: 'Tilda Ashford' },
	cycle: { people: ['Arn Marsh', 'Bram Marsh', 'Col Marsh'], dropped: 'Arn Marsh', parent: 'Col Marsh' },
	'self-parent': { person: 'Aldric Valmont' },
	'placement-without-parents': { person: 'Piers Ashford', placement: 'ward' },
	'house-color-null': { house: 'House Brennock', id: 'brennock', value: '#2e7d4f' },
	'duplicate-house-id': { id: 'valmont', house: 'House Valmont' },
	'unknown-union-type': { union: '#6', partners: ['Ranulf Brennock', 'Sela Brennock'], value: 'handfasting' },
	'unknown-placement': { person: 'Tilda Ashford', value: 'fostered' },
	'unknown-parent-type': { person: 'Edda Brennock', value: 'godfather', parent: 'Ranulf Brennock' },
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
};

/** Spec §13.3 gives this warning three short sentences, §13.6 the HEIC text four (checked by ste-editor). */
const MOST_SENTENCES: Partial<Record<IssueCode, number>> = { 'card-title-not-held': 3, 'picture-not-image': 4 };

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
const unquoted = (text: string) => text.replace(/"[^"]*"/g, '""').replace(/\{[^}]*\}/g, '{}');

/** Words the project word list replaces, plus signs of an unfilled template. */
const FORBIDDEN = /\b(union|unions|node|nodes|edge|edges|graph|diagram|chart|layer|rank|fixture|file|document)\b/i;
const UNFILLED = /undefined|null|NaN|\[object|\$\{|\{\{|\?\?/;

function checkText(text: string, most = 2, file = false) {
	expect(text.trim()).not.toBe('');
	expect(text).not.toMatch(UNFILLED);
	const parts = sentences(text);
	expect(parts.length).toBeLessThanOrEqual(most);
	for (const sentence of parts) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
	expect(file ? unquoted(text).replace(/\bfile\b/g, '') : unquoted(text)).not.toMatch(FORBIDDEN);
	expect(text).not.toMatch(/\b(don't|can't|isn't|doesn't|won't)\b/i);
}

describe('issueText: one STE entry per code', () => {
	for (const [code, params] of Object.entries(SAMPLES) as [IssueCode, IssueParams][]) {
		it(`${code}: filled, at most 2 sentences of at most 20 words, word list obeyed`, () => {
			checkText(issueText(issue(code, params)), MOST_SENTENCES[code] ?? 2, FILE_WORD.includes(code));
		});
		it(`${code}: still readable when the params are missing`, () => {
			const text = issueText(issue(code, {}));
			expect(text.trim()).not.toBe('');
			expect(text).not.toMatch(UNFILLED);
		});
	}

	it('uses names for people and quotes only ids that do not exist', () => {
		expect(issueText(issue('missing-parent', SAMPLES['missing-parent']))).toBe(
			'Wynn Ashford has a parent with the id "ghost", but no person has this id. Correct the id, or add the person.',
		);
		expect(issueText(issue('missing-partner', SAMPLES['missing-partner']))).toContain('the partnership of Piers Ashford and "nobody"');
	});

	it('gives the colour to quote when it was recovered', () => {
		expect(issueText(issue('house-color-null', SAMPLES['house-color-null']))).toBe('House Brennock has no colour. Put quotes around the colour: color: "#2e7d4f".');
		expect(issueText(issue('house-color-null', { house: 'valmont', id: 'valmont' }))).toMatch(/^The house "valmont" has no colour\. If you wrote a colour/);
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

	it('suggests an id made from the name', () => {
		expect(issueText(issue('missing-id', SAMPLES['missing-id']))).toContain('id: aldric-valmont');
	});
});

describe('issueText: title warnings (spec §13.3, §13.4)', () => {
	const text = (code: IssueCode, params: IssueParams) => issueText(issue(code, params));

	it('the titles section and its entries', () => {
		expect(text('section-wrong-shape', { section: 'titles' })).toBe('The "titles" section is not a list, so the tree ignores it. Start each title with "- id:".');
		expect(text('entry-not-map', { section: 'titles', index: 2 })).toBe('Entry 2 in the "titles" list is not a title, so the tree does not show it. Start each title with "- id:".');
		expect(text('missing-id', { section: 'titles', index: 3 })).toBe(
			'Entry 3 in the "titles" list has no id, so the tree does not use this title. Add an id, for example: id: duke-of-valmont.',
		);
		expect(text('missing-id', { section: 'titles', index: 3, name: 'Duke of Valmont' })).toBe(
			'Duke of Valmont has no id, so the tree does not use this title. Add an id, for example: id: duke-of-valmont.',
		);
		expect(text('missing-id', { section: 'titles', index: 1, name: 'King of Ostmark' })).toContain('id: king-of-ostmark.');
		expect(text('duplicate-title-id', SAMPLES['duplicate-title-id'])).toBe(
			'More than one title has the id "duke-of-valmont", and the tree uses only the first. Give each title a different id.',
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
			'The title Duke of Valmont has a holder with the id "aldrik", but no person has this id. Correct the id, or write the name of the holder.',
		);
		expect(text('missing-holder', { title: 'Duke of Valmont', ref: 'aldrik', name: 'Aldric' })).toBe(text('missing-holder', { title: 'Duke of Valmont', ref: 'aldrik' }));
		expect(text('holder-empty', SAMPLES['holder-empty'])).toBe('Entry 4 in the holders of Duke of Valmont has no person and no name. Add "person:" or "name:".');
	});

	it('card-title-not-held', () => {
		expect(text('card-title-not-held', SAMPLES['card-title-not-held'])).toBe(
			'Roderick Valmont has "card-title: king-of-ostmark", but Roderick Valmont does not hold a title with this id. The card shows the first title instead. Correct the id, or remove it.',
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
		expect(text('holder-empty', { index: 2 })).toBe('Entry 2 in the holders of a title has no person and no name. Add "person:" or "name:".');
	});

	it('covers the new sections of the shape codes', () => {
		checkText(text('section-wrong-shape', { section: 'titles' }));
		checkText(text('section-wrong-shape', { section: 'holders', title: 'Duke of Valmont' }));
		checkText(text('entry-not-map', { section: 'titles', index: 2 }));
		checkText(text('entry-not-map', { section: 'holders', index: 2, title: 'Duke of Valmont' }));
		checkText(text('missing-id', { section: 'titles', index: 2, name: 'Duke of Valmont' }));
	});
});

describe('issueText: picture warnings (spec §13.6, §13.7)', () => {
	const text = (code: IssueCode, params: IssueParams) => issueText(issue(code, params));
	const arms = { owner: 'arms', house: 'House Valmont' };
	const portrait = { owner: 'portrait', person: 'Aldric Valmont' };

	it('arms take "use" and "are", a portrait "uses" and "is"', () => {
		expect(text('missing-picture', { ...arms, file: 'x.png' })).toBe(
			'The arms of House Valmont use the picture "x.png", but the vault has no file with this name. Correct the link, or select other arms.',
		);
		expect(text('missing-picture', { ...portrait, file: 'x.png' })).toBe(
			'The portrait of Aldric Valmont uses the picture "x.png", but the vault has no file with this name. Correct the link, or select another portrait.',
		);
		expect(text('picture-web', arms)).toBe('The arms of House Valmont are a web address. The plugin shows only pictures from the vault.');
		expect(text('picture-web', portrait)).toBe('The portrait of Aldric Valmont is a web address. The plugin shows only pictures from the vault.');
	});

	it('picture-not-image names a known format, else says the file is not a picture', () => {
		expect(text('picture-not-image', { ...arms, file: 'x.tif', format: 'TIFF' })).toBe(
			'The arms of House Valmont use the picture "x.tif". The plugin cannot show TIFF pictures. Save the picture as PNG or JPEG. Then select it again.',
		);
		expect(text('picture-not-image', { ...portrait, file: 'x.pdf' })).toBe(
			'The portrait of Aldric Valmont uses the file "x.pdf", which is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.',
		);
	});

	it('picture-too-large gives the millions of pixels only when known (A6)', () => {
		expect(text('picture-too-large', { ...arms, file: 'x.png', pixels: 41 })).toBe(
			'The arms of House Valmont use the picture "x.png", which is too large (41 million pixels). Use a picture with 40 million pixels or less.',
		);
		for (const pixels of [undefined, 0, Number.NaN]) {
			const params: IssueParams = { ...arms, file: 'x.png' };
			if (pixels !== undefined) params.pixels = pixels;
			expect(text('picture-too-large', params)).toBe('The arms of House Valmont use the picture "x.png", which is too large. Use a picture with 40 million pixels or less.');
		}
	});

	it('with no owner, a person name makes it a portrait; with no names, the text still reads', () => {
		expect(text('picture-web', { person: 'Wren' })).toBe('The portrait of Wren is a web address. The plugin shows only pictures from the vault.');
		expect(text('picture-web', {})).toBe('The arms of a house are a web address. The plugin shows only pictures from the vault.');
		expect(text('missing-picture', { owner: 'portrait' })).toBe(
			'The portrait of a person uses the picture "?", but the vault has no file with this name. Correct the link, or select another portrait.',
		);
	});

	it('the portrait forms of the other texts are in STE too', () => {
		checkText(text('missing-picture', { ...portrait, file: 'aldric.jpg' }), 2, true);
		checkText(text('picture-not-image', { ...arms, file: 'x.pdf' }), 2, true);
		checkText(text('picture-too-large', { ...portrait, file: 'x.png' }));
		checkText(text('picture-web', arms));
	});
});

describe('hardErrorText', () => {
	for (const [code, error] of Object.entries(HARD)) {
		it(`${code}: filled and in STE`, () => {
			const text = hardErrorText(error);
			// The parser's own message follows "Details:" and is shown as it is (spec §8).
			checkText(text.split(' Details: ')[0]);
			// "line" alone means a drawn line (project word list); a line of text is a "text line".
			expect(text.split(' Details: ')[0]).not.toMatch(/(?<!text )line/i);
		});
	}

	it('yaml-invalid shows the line and the parser message', () => {
		expect(hardErrorText(HARD['yaml-invalid'])).toBe(
			'The block has an error on text line 3. Correct this text line to show the tree. Details: Nested mappings are not allowed',
		);
		expect(hardErrorText({ code: 'yaml-invalid' })).toBe('The block has an error. Correct the text to show the tree.');
	});
});

describe('codedIssue', () => {
	it('keeps ids only when there are some', () => {
		expect(codedIssue('self-parent', 'warning', { person: 'A' }, ['a'])).toEqual({ code: 'self-parent', level: 'warning', params: { person: 'A' }, ids: ['a'] });
		expect('ids' in codedIssue('duplicate-union-id', 'blocking', { id: 'u' }, [])).toBe(false);
		expect('ids' in codedIssue('missing-start', 'warning', { ref: 'x' })).toBe(false);
	});
});
