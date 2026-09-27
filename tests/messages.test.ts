import { describe, expect, it } from 'vitest';
import type { CodedIssue, HardError, HardErrorCode, IssueCode, IssueParams } from '../src/core/issues';
import { hardErrorText, issueText } from '../src/core/messages';

// Typed as a full record, so a new code in issues.ts fails the typecheck until it gets a sample here.
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
};

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

function checkText(text: string) {
	expect(text.trim()).not.toBe('');
	expect(text).not.toMatch(UNFILLED);
	const parts = sentences(text);
	expect(parts.length).toBeLessThanOrEqual(2);
	for (const sentence of parts) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
	expect(unquoted(text)).not.toMatch(FORBIDDEN);
	expect(text).not.toMatch(/\b(don't|can't|isn't|doesn't|won't)\b/i);
}

describe('issueText: one STE entry per code', () => {
	for (const [code, params] of Object.entries(SAMPLES) as [IssueCode, IssueParams][]) {
		it(`${code}: filled, at most 2 sentences of at most 20 words, word list obeyed`, () => {
			checkText(issueText(issue(code, params)));
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
