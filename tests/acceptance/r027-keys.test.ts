import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { describeDelete, type DeleteSummary } from '../../src/core/family-query';
import { issueText, type CodedIssue } from '../../src/core/messages';
import { parseBody, parseDynasty, referencedIds } from '../../src/core/parse';
import { specOf } from '../../src/core/succession';
import { INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES, isDead, ordinal, readInherit, readRule, readThrough, yearOf } from '../../src/core/succession-keys';
import type { RawMap } from '../../src/core/tolerate';
import type { Title } from '../../src/core/types';
import { allFixtures } from './load';
import { golden, replaceOnce } from './golden';
import { oldApplyOp, oldBuild } from './r027-old-builds';
import { applyTitleOp, bodyOf, refusal, type AnyOp } from './titles-support';

/*
 * Version 0.2.7, WP2: the new title keys (the 0.2.7 contract sections A, J, K): how they are read (old names,
 * `badKeys`, the year reader), the warnings that come from them, `isDead`, the writes of `edit-title`
 * (key order, plain text, switches, lists), Delete person, `referencedIds`, and the rule that the 0.2.6 and
 * 0.1.1 builds keep the keys on an edit (A.4). Every expected text is written by hand from the contract; whole
 * bodies are in tests/golden/16-*.yaml. These tests wait for WP 2.
 * Run: npx vitest run tests/acceptance/r027-keys.test.ts
 */

// ---- helpers ----

const PEOPLE = [
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'    sex: m',
	'  - id: hugo',
	'    name: Hugo Valmont',
	'    sex: m',
	'  - id: wren',
	'    name: Wren Valmont',
	'    sex: f',
	'  - id: tom',
	'    name: Tom Valmont',
	'    sex: m',
].join('\n');
const HOLDER = '      - {person: aldric, number: II, from: 1175}';

/** A block with one title `duke` that has these extra key lines (each line is indented by the helper). */
const withKeys = (...keys: string[]) => ['titles:', '  - id: duke', '    name: Duke', ...keys.map((k) => `    ${k}`), '    holders:', HOLDER, PEOPLE, ''].join('\n');

/** The tree as read (`Tree.titles[0]`), the graph, and its title. */
function read(...keys: string[]) {
	const r = parseDynasty(withKeys(...keys));
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	const g = deriveFamilies(r.tree);
	return { read: r.tree.titles![0], title: g.titles[0], g, issues: g.issues };
}
const has = (t: Title, key: string) => Object.prototype.hasOwnProperty.call(t, key);
const codesOf = (issues: CodedIssue[]) => issues.map((i) => i.code as string);
const textOf = (i: CodedIssue) => issueText(i);

// ---- yearOf (B.1, K.5) ----

describe('yearOf (contract K.5)', () => {
	const cases: [string | undefined, number | undefined][] = [
		['c. 1203', 1203],
		['12 May 1203', 1203],
		['1203-05-12', 1203],
		['spring 870', 870],
		['spring of 870', 870],
		['1203', 1203],
		[' 1203 ', 1203],
		['-200', -200],
		['−200', -200],
		['200 BC', -200],
		['200 bc', -200],
		['200BC', -200],
		['c. 200 BC', -200],
		['200 BCE', -200],
		['200 B.C.', -200],
		['200 B.C.E.', -200],
		['AD 45', 45],
		['45 AD', 45],
		['A.D. 45', 45],
		['45 CE', 45],
		['CE 45', 45],
		['12 May 1203 AD', 1203],
		['12', 12],
		['0', 0],
		['12000', 12000],
		['123456789012345', 123456789012345],
		['c. -200', 200],
		['1st century', undefined],
		['year 12', undefined],
		['c. 12000', undefined],
		['', undefined],
		['no date', undefined],
		['12345678901234567890', undefined],
		[undefined, undefined],
	];
	it.each(cases)('%j reads %j', (text, want) => {
		expect(yearOf(text)).toBe(want);
	});

	it('minus zero is zero', () => {
		expect(Object.is(yearOf('-0'), 0)).toBe(true);
	});

	it('the first run of three or four digits wins', () => {
		expect(yearOf('1203 and 1250')).toBe(1203);
		expect(yearOf('c. 1203/4')).toBe(1203);
	});

	it('agrees with the old phone-list reader on every date text of sample trees 1 to 15 (K.5)', () => {
		const old = (t: string) => {
			const m = /(?<!\d)\d{3,4}(?!\d)/.exec(t);
			return m ? Number(m[0]) : undefined;
		};
		let seen = 0;
		for (const f of allFixtures()) {
			if (Number(f.id.slice(0, 2)) > 15 || f.id === '16') continue;
			const parsed = parseDynasty(f.source);
			if (!parsed.ok) continue;
			const texts = [
				...parsed.tree.people.flatMap((p) => [p.born, p.died]),
				...(parsed.tree.titles ?? []).flatMap((t) => t.holders.flatMap((h) => [h.from, h.to])),
			];
			for (const t of texts) {
				if (t === undefined) continue;
				seen++;
				expect(yearOf(t), `${f.id}: ${t}`).toBe(old(t));
			}
		}
		expect(seen).toBeGreaterThan(100);
	});
});

describe('ordinal (contract D)', () => {
	it.each([
		[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [5, '5th'], [10, '10th'], [11, '11th'], [12, '12th'], [13, '13th'], [14, '14th'],
		[20, '20th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [24, '24th'], [100, '100th'], [101, '101st'], [111, '111th'], [112, '112th'], [113, '113th'], [121, '121st'],
	])('%i is %s', (n, want) => {
		expect(ordinal(n)).toBe(want);
	});
});

describe('isDead (contract J.7)', () => {
	it.each([undefined, 'false', 'False', ' no ', 'NO', 'alive', 'Alive', 'living', ' LIVING ', 'never'])('died: %j means alive', (died) => {
		expect(isDead({ died })).toBe(false);
	});

	it.each(['1185', 'c. 1185', 'in infancy', 'killed in battle', '?', 'unknown', 'maybe', 'alive and well', 'not alive', 'yes', 'true'])('died: %j means dead', (died) => {
		expect(isDead({ died })).toBe(true);
	});
});

// ---- Reading the keys (A.1, K.3, K.4) ----

describe('reading the succession keys of a title (contract A, K.3, K.4)', () => {
	it('every key is read into its field, in the tree as read and in the graph', () => {
		const t = read(
			'succession: eldest-child',
			'inherit: men-first-in-house',
			'inherit-through: women',
			'inherit-illegitimate: equal',
			'inherit-adopted: true',
			'year: 1210',
			'heir: hugo',
			'exclude: [wren, tom]',
		);
		for (const title of [t.read, t.title]) {
			expect(title).toMatchObject({
				succession: 'eldest-child',
				inherit: 'men-first-in-house',
				inheritThrough: 'women',
				inheritIllegitimate: 'equal',
				inheritAdopted: true,
				year: '1210',
				heirs: ['hugo'],
				exclude: ['wren', 'tom'],
			});
			expect(has(title, 'badKeys')).toBe(false);
		}
		expect(t.issues).toEqual([]);
	});

	it('a title with none of the keys has none of the fields', () => {
		const t = read();
		for (const key of ['succession', 'inherit', 'inheritThrough', 'inheritIllegitimate', 'inheritAdopted', 'year', 'heirs', 'exclude', 'badKeys']) {
			expect(has(t.read, key), key).toBe(false);
			expect(has(t.title, key), key).toBe(false);
		}
	});

	it('a value is kept as written (trimmed), and read after trim and lower case', () => {
		const t = read('succession: "  Eldest-Child "', 'inherit: " Men-Only"');
		expect([t.title.succession, t.title.inherit]).toEqual(['Eldest-Child', 'Men-Only']);
		expect(specOf(t.title)).toMatchObject({ rule: 'eldest-child', inherit: 'men-only' });
		expect(t.issues).toEqual([]);
	});

	it('the old names are kept as written, read as the new names, and give no warning (A.1)', () => {
		const rules: [string, string][] = [
			['primogeniture', 'eldest-child'],
			['ultimogeniture', 'youngest-child'],
			['brothers-first', 'siblings-first'],
			['seniority', 'siblings-first'],
			['agnatic-seniority', 'siblings-first'],
			['proximity', 'nearest-relative'],
			['proximity-of-blood', 'nearest-relative'],
			['porphyrogeniture', 'born-in-reign'],
		];
		for (const [old, now] of rules) {
			const t = read(`succession: ${old}`);
			expect(t.title.succession, old).toBe(old);
			expect(specOf(t.title).rule, old).toBe(now);
			expect(readRule(old), old).toBe(now);
			expect(t.issues, old).toEqual([]);
		}
		const inherits: [string, string][] = [
			['male-only', 'men-only'],
			['semi-salic', 'men-first-in-house'],
			['reverse-semi-salic', 'women-first-in-house'],
			['male-first', 'men-first'],
			['male-preference', 'men-first'],
			['none', 'no-preference'],
			['any', 'no-preference'],
			['female-first', 'women-first'],
			['female-preference', 'women-first'],
			['female-only', 'women-only'],
		];
		for (const [old, now] of inherits) {
			const t = read('succession: eldest-child', `inherit: ${old}`);
			expect(t.title.inherit, old).toBe(old);
			expect(specOf(t.title).inherit, old).toBe(now);
			expect(readInherit(old), old).toBe(now);
			expect(t.issues, old).toEqual([]);
		}
		for (const [old, now] of [['male', 'men'], ['female', 'women'], ['any', 'anyone']]) {
			const t = read('succession: eldest-child', `inherit-through: ${old}`);
			expect(specOf(t.title).inheritThrough, old).toBe(now);
			expect(readThrough(old), old).toBe(now);
			expect(t.issues, old).toEqual([]);
		}
	});

	it('the new names read as themselves; a value the plugin does not know reads as nothing', () => {
		for (const rule of SUCCESSION_RULES) expect(readRule(rule)).toBe(rule);
		for (const rule of INHERIT_RULES) expect(readInherit(rule)).toBe(rule);
		for (const rule of INHERIT_THROUGH) expect(readThrough(rule)).toBe(rule);
		expect([readRule('salic'), readRule('one-sex-first'), readRule(''), readRule(undefined)]).toEqual([undefined, undefined, undefined, undefined]);
		expect([readInherit('sideways'), readInherit(undefined)]).toEqual([undefined, undefined]);
		expect([readThrough('sideways'), readThrough(undefined)]).toEqual([undefined, undefined]);
		expect(SUCCESSION_RULES).toEqual(['eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative', 'born-in-reign']);
		expect(INHERIT_RULES).toEqual(['men-only', 'men-first-in-house', 'men-first', 'no-preference', 'women-first', 'women-first-in-house', 'women-only']);
		expect(INHERIT_THROUGH).toEqual(['men', 'women', 'anyone']);
	});

	it('a key with an empty value is not written: no field and no warning', () => {
		for (const line of ['succession:', 'succession: ""', 'inherit:', 'inherit-through: "  "', 'year:', 'heir:', 'exclude:', 'inherit-illegitimate:', 'inherit-adopted:']) {
			const t = read(line);
			expect(Object.keys(t.title).filter((k) => !['id', 'name', 'plural', 'holders', 'index', 'items'].includes(k)), line).toEqual([]);
			expect(t.issues, line).toEqual([]);
		}
	});

	it('a number in `year` or `heir` is text', () => {
		const t = read('succession: eldest-child', 'year: 1210', 'heir: 12');
		expect([t.title.year, t.title.heirs]).toEqual(['1210', ['12']]);
	});

	it('defaults of the spec: no-preference, illegitimate no, adopted off; an absent rule is not set', () => {
		const spec = specOf(read('succession: eldest-child').title);
		expect(spec).toMatchObject({ rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false });
		expect(spec.bad).toBeUndefined();
		expect(specOf(read().title).rule).toBeUndefined();
	});

	it('the spec carries every key the engine reads', () => {
		const spec = specOf(
			read('succession: youngest-child', 'inherit: women-first', 'inherit-through: anyone', 'inherit-illegitimate: after', 'inherit-adopted: true', 'year: c. 1210', 'heir: [hugo, wren]', 'exclude: tom').title,
		);
		expect(spec).toMatchObject({
			rule: 'youngest-child',
			inherit: 'women-first',
			inheritThrough: 'anyone',
			illegitimate: 'after',
			adopted: true,
			year: 'c. 1210',
			heirs: ['hugo', 'wren'],
			exclude: ['tom'],
		});
	});
});

describe('inherit-illegitimate and inherit-adopted (contract A.1)', () => {
	it.each([
		['no', undefined, 'no'],
		['after', 'after', 'after'],
		['equal', 'equal', 'equal'],
		['After', 'after', 'after'],
		[' EQUAL ', 'equal', 'equal'],
		['true', 'after', 'after'],
		['True', 'after', 'after'],
		['yes', 'after', 'after'],
		['false', undefined, 'no'],
		['False', undefined, 'no'],
	])('inherit-illegitimate: %s', (written, field, spec) => {
		const t = read('succession: eldest-child', `inherit-illegitimate: "${written}"`);
		expect(t.title.inheritIllegitimate).toBe(field);
		expect(has(t.title, 'inheritIllegitimate')).toBe(field !== undefined);
		expect(specOf(t.title).illegitimate).toBe(spec);
		expect(specOf(t.title).bad).toBeUndefined();
		expect(t.issues).toEqual([]);
	});

	it('another text: badKeys, no field, the warning, and a line of kind bad-rule (the spec is marked)', () => {
		const t = read('succession: eldest-child', 'inherit-illegitimate: maybe');
		expect(has(t.title, 'inheritIllegitimate')).toBe(false);
		expect(t.title.badKeys).toEqual({ 'inherit-illegitimate': 'maybe' });
		expect(specOf(t.title).bad).toBe('inherit-illegitimate');
		expect(t.issues.map((i) => [i.code, i.params.value])).toEqual([['unknown-inherit-illegitimate', 'maybe']]);
	});

	it.each(['true', 'True', 'yes', 'YES'])('inherit-adopted: %s is on', (written) => {
		const t = read('succession: eldest-child', `inherit-adopted: ${written}`);
		expect(t.title.inheritAdopted).toBe(true);
		expect(specOf(t.title).adopted).toBe(true);
	});

	it.each(['false', 'no', 'on', '1', 'Y', 'maybe'])('inherit-adopted: %s is off, with no field and no warning', (written) => {
		const t = read('succession: eldest-child', `inherit-adopted: "${written}"`);
		expect(has(t.title, 'inheritAdopted')).toBe(false);
		expect(specOf(t.title).adopted).toBe(false);
		expect(t.issues).toEqual([]);
	});
});

describe('values that cannot be used: badKeys (contract A.1, K.3, K.4)', () => {
	it('a list or a map: the flow text of the value, and the field stays undefined', () => {
		const t = read('succession: [eldest-child, youngest-child]', 'inherit: {a: b}', 'year: [1200, {a: 1}]');
		expect(t.title.badKeys).toEqual({ succession: '[eldest-child, youngest-child]', inherit: '{…}', year: '[1200, …]' });
		for (const key of ['succession', 'inherit', 'year']) expect(has(t.title, key), key).toBe(false);
		expect(t.read.badKeys).toEqual(t.title.badKeys);
	});

	it('inherit-through as a list', () => {
		const t = read('succession: eldest-child', 'inherit-through: [men]');
		expect(t.title.badKeys).toEqual({ 'inherit-through': '[men]' });
		expect(specOf(t.title).bad).toBe('inherit-through');
	});

	it('a map in heir or exclude: the flow text in badKeys, and the missing-heir / missing-excluded warning with that text', () => {
		const t = read('succession: eldest-child', 'heir: {a: b}', 'exclude: {c: d}');
		expect(t.title.badKeys).toEqual({ heir: '{…}', exclude: '{…}' });
		expect(has(t.title, 'heirs')).toBe(false);
		expect(has(t.title, 'exclude')).toBe(false);
		expect(t.issues.map((i) => [i.code, i.params.ref ?? i.params.value]).sort()).toEqual([['missing-excluded', '{…}'], ['missing-heir', '{…}']]);
	});

	it('a list item that is not a scalar is skipped and recorded in badKeys', () => {
		const t = read('succession: eldest-child', 'exclude: [wren, {a: b}, tom]');
		expect(t.title.exclude).toEqual(['wren', 'tom']);
		expect(t.title.badKeys).toEqual({ exclude: '[wren, …, tom]' });
	});

	it('an empty list is nothing written', () => {
		const t = read('succession: eldest-child', 'heir: []', 'exclude: []');
		expect(has(t.title, 'heirs')).toBe(false);
		expect(has(t.title, 'exclude')).toBe(false);
		expect(t.issues).toEqual([]);
	});

	it('the specOf of a bad value marks the key', () => {
		expect(specOf(read('succession: salic').title).bad).toBe('succession');
		expect(specOf(read('succession: [a, b]').title).bad).toBe('succession');
		expect(specOf(read('succession: eldest-child', 'inherit: sideways').title).bad).toBe('inherit');
		expect(specOf(read('succession: eldest-child', 'inherit-through: sideways').title).bad).toBe('inherit-through');
		// A year and a heir that cannot be used never bar the line (A.5 "Effect").
		expect(specOf(read('succession: eldest-child', 'year: "the old days"', 'heir: ghost').title).bad).toBeUndefined();
	});
});

describe('heirs and the excluded: lists, curly marks (contract K.3)', () => {
	it('one id or a list, in written order', () => {
		expect(read('heir: hugo').title.heirs).toEqual(['hugo']);
		expect(read('heir: [wren, hugo]').title.heirs).toEqual(['wren', 'hugo']);
		expect(read('exclude: tom').title.exclude).toEqual(['tom']);
		expect(read('heir:\n      - wren\n      - hugo').title.heirs).toEqual(['wren', 'hugo']);
	});

	it('curly quote marks from a phone keyboard are unwrapped in heir and exclude (D103), scalar or list', () => {
		const t = read('heir: “hugo”', 'exclude: [“wren”, “tom”]');
		expect([t.title.heirs, t.title.exclude]).toEqual([['hugo'], ['wren', 'tom']]);
		expect(t.issues).toEqual([]);
	});
});

// ---- The warnings (A.5, K.4) ----

describe('the warnings of the new keys (contract A.5, K.4)', () => {
	const only = (...keys: string[]) => read(...keys).issues;

	it('succession that is not a rule or an old name: unknown-succession, with the written value', () => {
		const issues = only('succession: salic');
		expect(issues.map((i) => i.code)).toEqual(['unknown-succession']);
		expect(issues[0].params).toMatchObject({ title: 'Duke', value: 'salic' });
		expect(issues[0].level).toBe('warning');
		expect(issues[0].ids ?? []).toEqual([]);
		expect(textOf(issues[0])).toContain('For the Salic law, use “succession: eldest-child” with “inherit: men-only”.');
	});

	it('the value semi-salic in `succession` adds the hint for the semi-Salic law', () => {
		expect(textOf(only('succession: semi-salic')[0])).toContain('For the semi-Salic law, use “succession: eldest-child” with “inherit: men-first-in-house”.');
	});

	it('the list value of succession gives the warning with the flow text', () => {
		const issues = only('succession: [a, b]');
		expect(issues.map((i) => [i.code, i.params.value])).toEqual([['unknown-succession', '[a, b]']]);
	});

	it('inherit, inherit-through and inherit-illegitimate that are not values', () => {
		expect(only('succession: eldest-child', 'inherit: sideways').map((i) => [i.code, i.params.value])).toEqual([['unknown-inherit', 'sideways']]);
		expect(only('succession: eldest-child', 'inherit-through: sideways').map((i) => [i.code, i.params.value])).toEqual([['unknown-inherit-through', 'sideways']]);
		expect(only('succession: eldest-child', 'inherit-illegitimate: sometimes').map((i) => [i.code, i.params.value])).toEqual([['unknown-inherit-illegitimate', 'sometimes']]);
	});

	it('a key that is bad on a title with no succession still gives its warning', () => {
		expect(only('inherit: sideways').map((i) => i.code)).toEqual(['unknown-inherit']);
	});

	it('year-unreadable: only when the title has succession or heir', () => {
		expect(only('succession: eldest-child', 'year: "the old days"').map((i) => [i.code, i.params.value])).toEqual([['year-unreadable', 'the old days']]);
		expect(only('heir: hugo', 'year: "the old days"').map((i) => i.code)).toEqual(['year-unreadable']);
		expect(only('year: "the old days"')).toEqual([]);
		expect(only('succession: eldest-child', 'year: 1210')).toEqual([]);
		expect(only('succession: eldest-child', 'year: c. 1210')).toEqual([]);
		expect(only('succession: eldest-child', 'year: 200 BC')).toEqual([]);
		expect(only('succession: eldest-child', 'year: "AD 45"')).toEqual([]);
	});

	it('missing-heir and missing-excluded: one warning for each id that names nobody, in list order', () => {
		const issues = only('heir: [hugo, ghost, ghost2]', 'exclude: [wren, nobody]');
		expect(issues.map((i) => [i.code, i.params.ref])).toEqual([
			['missing-heir', 'ghost'],
			['missing-heir', 'ghost2'],
			['missing-excluded', 'nobody'],
		]);
		expect(issues.every((i) => i.params.title === 'Duke')).toBe(true);
	});

	it('the texts of the real warnings (the whole sentence, with curly quotes)', () => {
		const issues = only('succession: primogenitor', 'year: "the old days"', 'heir: ghost');
		expect(Object.fromEntries(issues.map((i) => [i.code, textOf(i)]))).toEqual({
			'unknown-succession':
				'The title Duke has “succession: primogenitor”. The plugin does not know this rule, so it shows no line of succession. Use one of these rules: eldest-child, youngest-child, siblings-first, nearest-relative, born-in-reign.',
			'year-unreadable':
				'The title Duke has “year: the old days”. The plugin cannot find a year in it, so the line of succession uses the end of the last reign. Write the year as a number, for example “year: 1210”.',
			'missing-heir': 'The title Duke has “heir: ghost”, but no person has this ID. Correct the ID, or remove it.',
		});
	});

	it('a title with a duplicate id: only the first is read, so only the first gives warnings', () => {
		const body = ['titles:', '  - id: duke', '    name: Duke', '    succession: eldest-child', '  - id: duke', '    name: Again', '    succession: salic', PEOPLE, ''].join('\n');
		const r = parseDynasty(body);
		if (!r.ok) throw new Error('parse');
		expect(codesOf(deriveFamilies(r.tree).issues)).toEqual(['duplicate-title-id']);
	});

	it('the codes are warnings that belong to the tree, not to a person (no ids)', () => {
		for (const i of only('succession: salic', 'inherit: x', 'inherit-through: x', 'inherit-illegitimate: x', 'year: "no year"', 'heir: ghost', 'exclude: ghost')) {
			expect(i.level).toBe('warning');
			expect(i.ids ?? []).toEqual([]);
		}
	});
});

describe('the warning died-doubtful (contract J.7, K.7)', () => {
	const people = (died: string) => `people:\n  - id: hugo\n    name: Hugo Valmont\n    died: ${died}\n`;
	const issuesOf = (died: string) => {
		const r = parseDynasty(people(died));
		if (!r.ok) throw new Error('parse');
		return deriveFamilies(r.tree).issues;
	};

	it.each(['"?"', 'unknown', 'maybe', 'perhaps', 'possibly', 'uncertain', '" Maybe "', 'UNKNOWN'])('died: %s gives one warning that names the person', (died) => {
		const issues = issuesOf(died);
		expect(issues.map((i) => [i.code, i.params.person, i.ids])).toEqual([['died-doubtful', 'Hugo Valmont', ['hugo']]]);
		const value = died.replace(/^"|"$/g, '').trim();
		expect(issues[0].params.value).toBe(value);
		expect(textOf(issues[0])).toBe(`Hugo Valmont has “died: ${value}”. The plugin counts Hugo Valmont as dead. If Hugo Valmont is alive, remove “died: ${value}” from the note.`);
	});

	it.each(['1185', '"c. 1185"', 'alive', 'false', '"in infancy"', 'no', 'never', '"killed in battle"'])('died: %s gives no warning', (died) => {
		expect(issuesOf(died)).toEqual([]);
	});

	it('a duplicate person that is skipped gives no second warning', () => {
		const r = parseDynasty(`people:\n  - id: hugo\n    name: Hugo\n    died: maybe\n  - id: hugo\n    name: Second\n    died: unknown\n`);
		if (!r.ok) throw new Error('parse');
		expect(deriveFamilies(r.tree).issues.map((i) => [i.code, i.ids]).sort()).toEqual([['died-doubtful', ['hugo']], ['duplicate-person-id', ['hugo']]]);
	});
});

describe('referencedIds (contract A.6, K.3)', () => {
	const ids = (body: string) => {
		const p = parseBody(body);
		if (!p.ok) throw new Error('parse');
		return [...referencedIds(p.data as RawMap)].sort();
	};

	it('includes every heir and every excluded id, scalar or list, with no person for them', () => {
		expect(ids('titles:\n  - id: t\n    heir: [a, b]\n    exclude: c\n    holders: [d]\npeople: []\n')).toEqual(['a', 'b', 'c', 'd']);
	});

	it('also when the holders are a map (the early continue must not skip them)', () => {
		expect(ids('titles:\n  - id: t\n    heir: x\n    exclude: [y]\n    holders: {person: e}\npeople: []\n')).toEqual(['x', 'y']);
	});
});

// ---- Writes (A.3, K.3, K.4) ----

const BASE = ['titles:', '  - id: duke-of-valmont', '    name: Duke of Valmont', '    plural: Dukes of Valmont', '    holders:', HOLDER, PEOPLE, ''].join('\n').replace(/\n$/, '');
const apply = (op: Record<string, unknown>, body = BASE) => applyTitleOp(body, { kind: 'edit-title', id: 'duke-of-valmont', ...op } as AnyOp);
const write = (op: Record<string, unknown>, body = BASE) => bodyOf(apply(op, body));
const goldenBody = (file: string) => golden(file).replace(/\n$/, '');

describe('edit-title writes the succession keys (contract A.3, K.4)', () => {
	it('all keys at once: in the order of K.4, each on its own line, plain text, a list for several ids (golden)', () => {
		expect(
			write({
				succession: 'eldest-child',
				inherit: 'men-only',
				inheritThrough: 'men',
				inheritIllegitimate: 'after',
				inheritAdopted: true,
				year: '1210',
				heirs: ['hugo'],
				exclude: ['wren', 'tom'],
			}),
		).toBe(goldenBody('16-edit-title-all-keys.yaml'));
	});

	it('new keys land between the keys that are there, in the order of K.4 (golden)', () => {
		const start = BASE.replace('    holders:\n', '    succession: eldest-child\n    year: 1210\n    holders:\n');
		expect(write({ inherit: 'men-first', inheritIllegitimate: 'equal', heirs: ['hugo'], exclude: ['wren'] }, start)).toBe(goldenBody('16-edit-title-between.yaml'));
	});

	it('a key added alone goes after the key before it in the order, and before `holders`', () => {
		expect(write({ succession: 'youngest-child' })).toBe(replaceOnce(BASE, '    plural: Dukes of Valmont\n', '    plural: Dukes of Valmont\n    succession: youngest-child\n'));
		expect(write({ heirs: ['hugo'] })).toBe(replaceOnce(BASE, '    plural: Dukes of Valmont\n', '    plural: Dukes of Valmont\n    heir: hugo\n'));
	});

	it('year and the switches are written plain, never quoted; text that plain YAML cannot hold is quoted', () => {
		const out = write({ year: '1210', inheritAdopted: true });
		expect(out).toContain('\n    year: 1210\n');
		expect(out).toContain('\n    inherit-adopted: true\n');
		expect(write({ year: 'c. 1210' })).toContain('\n    year: c. 1210\n');
		expect(write({ year: '200 BC' })).toContain('\n    year: 200 BC\n');
		expect(write({ year: '1210: spring' })).toContain('\n    year: "1210: spring"\n');
	});

	it('null (or empty text) removes the key; other keys stay, also unknown ones', () => {
		const start = BASE.replace('    holders:\n', '    seat: Valmont Keep\n    succession: eldest-child\n    inherit: men-only\n    year: 1210\n    heir: hugo\n    exclude: [wren, tom]\n    holders:\n');
		expect(write({ succession: null }, start)).toBe(replaceOnce(start, '    succession: eldest-child\n', ''));
		expect(write({ inherit: null }, start)).toBe(replaceOnce(start, '    inherit: men-only\n', ''));
		expect(write({ year: null }, start)).toBe(replaceOnce(start, '    year: 1210\n', ''));
		expect(write({ year: '' }, start)).toBe(replaceOnce(start, '    year: 1210\n', ''));
		expect(write({ heirs: null }, start)).toBe(replaceOnce(start, '    heir: hugo\n', ''));
		expect(write({ exclude: null }, start)).toBe(replaceOnce(start, '    exclude: [wren, tom]\n', ''));
		expect(write({ inheritThrough: null }, start)).toBe(start);
	});

	it('a change in one key leaves every other line of the note alone, comments included', () => {
		const start = BASE.replace('    holders:\n', '    succession: eldest-child   # the law of 1190\n    # the year of the line\n    year: 1210\n    holders:\n');
		expect(write({ inherit: 'men-only' }, start)).toBe(replaceOnce(start, '    succession: eldest-child   # the law of 1190\n', '    succession: eldest-child   # the law of 1190\n    inherit: men-only\n'));
		expect(write({ succession: 'youngest-child' }, start)).toContain('    # the year of the line\n    year: 1210\n');
	});

	it('the same value again changes nothing', () => {
		const start = BASE.replace('    holders:\n', '    succession: eldest-child\n    inherit: men-only\n    year: 1210\n    holders:\n');
		expect(write({ succession: 'eldest-child', inherit: 'men-only', year: '1210' }, start)).toBe(start);
	});
});

describe('edit-title: the switches (contract A.3)', () => {
	const T = (line: string) => BASE.replace('    holders:\n', `    ${line}\n    holders:\n`);

	it('inheritAdopted: true writes the key; it keeps a text that already reads as true', () => {
		expect(write({ inheritAdopted: true })).toBe(replaceOnce(BASE, '    plural: Dukes of Valmont\n', '    plural: Dukes of Valmont\n    inherit-adopted: true\n'));
		expect(write({ inheritAdopted: true }, T('inherit-adopted: yes'))).toBe(T('inherit-adopted: yes'));
		expect(write({ inheritAdopted: true }, T('inherit-adopted: True'))).toBe(T('inherit-adopted: True'));
		expect(write({ inheritAdopted: true }, T('inherit-adopted: false'))).toBe(T('inherit-adopted: true'));
	});

	it('inheritAdopted: false removes the key only when it is there', () => {
		expect(write({ inheritAdopted: false })).toBe(BASE);
		expect(write({ inheritAdopted: false }, T('inherit-adopted: true'))).toBe(BASE);
	});

	it('inheritIllegitimate: a word is written; "no" removes the key; a text that reads as the same value stays', () => {
		expect(write({ inheritIllegitimate: 'after' })).toBe(replaceOnce(BASE, '    plural: Dukes of Valmont\n', '    plural: Dukes of Valmont\n    inherit-illegitimate: after\n'));
		expect(write({ inheritIllegitimate: 'no' })).toBe(BASE);
		expect(write({ inheritIllegitimate: 'no' }, T('inherit-illegitimate: equal'))).toBe(BASE);
		expect(write({ inheritIllegitimate: 'after' }, T('inherit-illegitimate: true'))).toBe(T('inherit-illegitimate: true'));
		expect(write({ inheritIllegitimate: 'after' }, T('inherit-illegitimate: yes'))).toBe(T('inherit-illegitimate: yes'));
		expect(write({ inheritIllegitimate: 'equal' }, T('inherit-illegitimate: true'))).toBe(T('inherit-illegitimate: equal'));
		expect(write({ inheritIllegitimate: 'after' }, T('inherit-illegitimate: equal'))).toBe(T('inherit-illegitimate: after'));
	});

	it('S41: choosing "after" on a title that has `true` keeps the text `true`', () => {
		const body = BASE.replace('    holders:\n', '    succession: eldest-child\n    inherit-illegitimate: true\n    holders:\n');
		expect(write({ inheritIllegitimate: 'after' }, body)).toBe(body);
	});
});

describe('edit-title: refusals (contract A.3, K.3, K.4)', () => {
	it.each([
		['succession that is not a rule', { succession: 'salic' }],
		['an old name of a rule', { succession: 'primogeniture' }],
		['inherit that is not a value', { inherit: 'sideways' }],
		['an old name of inherit', { inherit: 'semi-salic' }],
		['inherit-through that is not a value', { inheritThrough: 'sideways' }],
		['an old name of inherit-through', { inheritThrough: 'male' }],
		['inherit-illegitimate that is not a value', { inheritIllegitimate: 'maybe' }],
		['a switch that is not a boolean', { inheritAdopted: 'yes' }],
	])('%s: bad-value', (_what, op) => {
		expect(refusal(apply(op))).toBe('bad-value');
	});

	it('a new heir or excluded person who is not in the tree: unknown-person', () => {
		expect(refusal(apply({ heirs: ['ghost'] }))).toBe('unknown-person');
		expect(refusal(apply({ exclude: ['hugo', 'ghost'] }))).toBe('unknown-person');
	});

	it('an id that is already written is exempt from the check; only a new id is checked', () => {
		const start = BASE.replace('    holders:\n', '    heir: ghost\n    holders:\n');
		expect(refusal(apply({ heirs: ['ghost', 'hugo'] }, start))).toBe('ok');
		expect(write({ heirs: ['ghost', 'hugo'] }, start)).toContain('\n    heir: [ghost, hugo]\n');
		expect(refusal(apply({ heirs: ['ghost', 'nobody'] }, start))).toBe('unknown-person');
	});

	it('a refused op writes nothing and an unknown title is refused unknown-title', () => {
		expect(refusal(applyTitleOp(BASE, { kind: 'edit-title', id: 'nobody', succession: 'eldest-child' } as AnyOp))).toBe('unknown-title');
	});
});

describe('edit-title: one id or several (contract K.3)', () => {
	const T = (line: string) => BASE.replace('    holders:\n', `    ${line}\n    holders:\n`);

	it('one id is a scalar, several are a flow list', () => {
		expect(write({ heirs: ['hugo'] })).toContain('\n    heir: hugo\n');
		expect(write({ heirs: ['hugo', 'wren'] })).toContain('\n    heir: [hugo, wren]\n');
		expect(write({ exclude: ['tom'] })).toContain('\n    exclude: tom\n');
		expect(write({ exclude: ['tom', 'wren', 'hugo'] })).toContain('\n    exclude: [tom, wren, hugo]\n');
	});

	it('a scalar becomes a list when an id is added, and a list becomes a scalar when one is left', () => {
		expect(write({ heirs: ['hugo', 'wren'] }, T('heir: hugo'))).toBe(T('heir: [hugo, wren]'));
		expect(write({ heirs: ['hugo'] }, T('heir: [hugo, wren]'))).toBe(T('heir: hugo'));
		expect(write({ heirs: ['wren', 'hugo'] }, T('heir: [hugo, wren]'))).toBe(T('heir: [wren, hugo]'));
	});

	it('the ids already written (as a list) are a no-op, in any written form', () => {
		expect(write({ heirs: ['hugo'] }, T('heir: hugo'))).toBe(T('heir: hugo'));
		expect(write({ heirs: ['hugo', 'wren'] }, T('heir: [hugo, wren]'))).toBe(T('heir: [hugo, wren]'));
		const block = BASE.replace('    holders:\n', '    heir:\n      - hugo\n      - wren\n    holders:\n');
		expect(write({ heirs: ['hugo', 'wren'] }, block)).toBe(block);
		expect(write({ exclude: ['tom', 'wren'] }, T('exclude:   [tom,  wren]'))).toBe(T('exclude:   [tom,  wren]'));
	});

	it('an edit of another key keeps a hand-written list as it is', () => {
		const start = T('heir:   [hugo,   wren]   # my choice');
		expect(write({ succession: 'eldest-child' }, start)).toContain('    heir:   [hugo,   wren]   # my choice\n');
	});
});

describe('Delete person removes the person from heir and exclude, in the same write (contract A.6, K.3)', () => {
	const BODY = [
		'titles:',
		'  - id: duke',
		'    name: Duke of Valmont',
		'    succession: eldest-child',
		'    heir: hugo',
		'    exclude: [wren, tom]',
		'    holders:',
		'      - {person: aldric, from: 1175}',
		'  - id: count',
		'    name: Count of Orsini',
		'    heir: [tom, hugo]',
		'    exclude: wren',
		'    holders: []',
		'  - id: duke',
		'    name: Duke again',
		'    heir: hugo',
		'    exclude: [hugo]',
		'  - id: baron',
		'    name: Baron',
		'    exclude: [hugo, wren]',
		PEOPLE,
	].join('\n');
	const del = (id: string, body = BODY) => bodyOf(applyTitleOp(body, { kind: 'delete-person', id }));
	const summary = (id: string, body = BODY) => {
		const r = parseDynasty(body);
		if (!r.ok) throw new Error('parse');
		return describeDelete(deriveFamilies(r.tree), id, {}) as DeleteSummary & { heirs?: number; excluded?: number };
	};

	it('a scalar goes, a list loses the id and stays a list, an empty list goes; also in a title that loses to a duplicate id (golden)', () => {
		expect(del('hugo')).toBe(goldenBody('16-delete-person-heirs.yaml'));
	});

	it('a list of one stays a list; a deleted person who is in no key changes nothing there', () => {
		expect(del('wren')).toContain('\n    exclude: [tom]\n');
		expect(del('wren')).toContain('\n    exclude: [hugo]\n');
		expect(del('wren')).not.toContain('exclude: wren');
		expect(del('aldric')).toContain('\n    heir: hugo\n    exclude: [wren, tom]\n');
	});

	it('the confirmation counts the titles, from the written titles (a duplicate id counts on its own); a count of 0 is absent', () => {
		expect(summary('hugo')).toMatchObject({ heirs: 3, excluded: 2 });
		expect(summary('wren')).toMatchObject({ excluded: 3 });
		expect(summary('wren')).not.toHaveProperty('heirs');
		expect(summary('tom')).toMatchObject({ heirs: 1, excluded: 1 });
		expect(summary('aldric')).not.toHaveProperty('heirs');
		expect(summary('aldric')).not.toHaveProperty('excluded');
	});
});

// ---- The keys survive an edit by an older build (A.4) ----

describe('the 0.2.6 and 0.1.1 builds keep the new keys on an edit (contract A.4, spec §13.0 item 2)', () => {
	const KEYS = [
		'    succession: eldest-child',
		'    inherit: men-first-in-house',
		'    inherit-through: women',
		'    inherit-illegitimate: after',
		'    inherit-adopted: true',
		'    year: 1210',
		'    heir: hugo',
		'    exclude: [wren, tom]',
	];
	const NOTE = ['titles:', '  - id: duke', '    name: Duke', ...KEYS, '    holders:', HOLDER, PEOPLE, ''].join('\n');
	const keyLines = (body: string) => body.split('\n').filter((l) => KEYS.includes(l));

	it('the current build keeps every key line of a title when another field changes', () => {
		for (const op of [
			{ kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric the Old' } },
			{ kind: 'edit-title', id: 'duke', name: 'Duke of Valmont' },
			{ kind: 'edit-holder', holder: { title: 'duke', index: 0, person: 'aldric' }, fields: { to: '1200' } },
			{ kind: 'set-option', key: 'start', value: 'aldric' },
		]) {
			const out = bodyOf(applyTitleOp(NOTE, op as AnyOp));
			expect(keyLines(out), JSON.stringify(op)).toEqual(KEYS);
			expect(out, JSON.stringify(op)).toContain(KEYS.join('\n'));
		}
	});

	for (const tag of ['v0.2.6', 'v0.1.1']) {
		const dir = oldBuild(tag);
		const ops: Record<string, unknown>[] =
			tag === 'v0.2.6'
				? [
						{ kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric the Old' } },
						{ kind: 'edit-title', id: 'duke', name: 'Duke of Valmont', plural: 'Dukes of Valmont' },
						{ kind: 'edit-holder', holder: { title: 'duke', index: 0, person: 'aldric' }, fields: { to: '1200' } },
						{ kind: 'set-option', key: 'start', value: 'aldric' },
					]
				: [
						{ kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric the Old' } },
						{ kind: 'set-option', key: 'start', value: 'aldric' },
					];
		it.skipIf(dir === null)(`${tag}: every key line stays, in its place, after ${ops.length} different edits`, async () => {
			const applyOld = await oldApplyOp(dir!);
			for (const op of ops) {
				const r = applyOld(NOTE, op);
				expect(r.ok, JSON.stringify(op)).toBe(true);
				if (!r.ok) continue;
				expect(keyLines(r.body), JSON.stringify(op)).toEqual(KEYS);
				// The key lines are still one block, in the same order.
				expect(r.body).toContain(KEYS.join('\n'));
			}
		});

		it.skipIf(dir === null)(`${tag}: Delete person leaves a heir id that names nobody, and the current build then warns (missing-heir)`, async () => {
			const applyOld = await oldApplyOp(dir!);
			const r = applyOld(NOTE, { kind: 'delete-person', id: 'hugo' });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.body).toContain('\n    heir: hugo\n');
			const parsed = parseDynasty(r.body);
			if (!parsed.ok) throw new Error('parse');
			expect(deriveFamilies(parsed.tree).issues.map((i) => [i.code, i.params.ref])).toContainEqual(['missing-heir', 'hugo']);
		});
	}
});
