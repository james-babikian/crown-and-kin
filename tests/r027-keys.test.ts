// Contract 0.2.7 (WP2): the succession keys. Year reader, rule names, isDead, reading the title keys, the warnings.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { issueText } from '../src/core/messages';
import { parseDynasty, referencedIds, parseBody } from '../src/core/parse';
import { isDead, ordinal, readInherit, readRule, readThrough, readIllegitimate, yearOf } from '../src/core/succession-keys';
import { unwrapCurlyKeys } from '../src/core/tolerate';

const read = (body: string) => {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('parse');
	return r.tree;
};
const titleOf = (keys: string) => read(`people:\n  - {id: a, name: A}\n\ntitles:\n  - id: t\n    name: Duke\n${keys}`).titles![0];
const warnings = (keys: string, people = '  - {id: a, name: A}') => {
	const r = parseDynasty(`people:\n${people}\n\ntitles:\n  - id: t\n    name: Duke\n${keys}`);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree).issues;
};

describe('yearOf (K.5)', () => {
	const cases: [string, number | undefined][] = [
		['c. 1203', 1203],
		['12 May 1203', 1203],
		['1203-05-12', 1203],
		['spring of 870', 870],
		['spring 870', 870],
		['-200', -199], // §14 rule 8 (0.3.2): a minus number n is internal 1 - n.
		['−200', -199], // §14 rule 8 (0.3.2): a minus number n is internal 1 - n.
		['200 BC', -199], // §14 rule 8 (0.3.2): n BC is internal 1 - n.
		['200 B.C.', -199], // §14 rule 8 (0.3.2)
		['44 BCE', -43], // §14 rule 8 (0.3.2)
		['AD 45', 45],
		['45 AD', 45],
		['A.D. 45', 45],
		['45 CE', 45],
		['CE 45', 45],
		['1st century', undefined],
		['year 12', undefined],
		['12000', 12000],
		['12', 12],
		['0', 0],
		['-0', 0],
		['c. 12000', undefined],
		['12 May 1203 AD', 1203],
		['c. -200', 200],
		['', undefined],
		['   ', undefined],
		['unknown', undefined],
		['99999999999999999999', undefined],
	];
	for (const [text, year] of cases) it(`${JSON.stringify(text)} gives ${year}`, () => expect(yearOf(text)).toBe(year));
	it('gives undefined for no text', () => expect(yearOf(undefined)).toBeUndefined());
	it('returns 0 so callers must test for undefined', () => expect(yearOf('0')).toBe(0));
	it('does not use a lookbehind (iOS before 16.4 cannot parse one)', async () => {
		const src = (await import('node:fs')).readFileSync(new URL('../src/core/succession-keys.ts', import.meta.url), 'utf8');
		expect(src).not.toMatch(/\(\?<[!=]/);
	});
});

describe('rule names (A.1, K.1)', () => {
	it('reads the current names after trim and lower case', () => {
		expect(readRule(' Eldest-Child ')).toBe('eldest-child');
		expect(readInherit('MEN-FIRST')).toBe('men-first');
		expect(readThrough('Women')).toBe('women');
	});
	it('reads every old name', () => {
		const rules: Record<string, string> = {
			primogeniture: 'eldest-child',
			ultimogeniture: 'youngest-child',
			'brothers-first': 'siblings-first',
			seniority: 'siblings-first',
			'agnatic-seniority': 'siblings-first',
			proximity: 'nearest-relative',
			'proximity-of-blood': 'nearest-relative',
			porphyrogeniture: 'born-in-reign',
		};
		for (const [old, now] of Object.entries(rules)) expect(readRule(old)).toBe(now);
		const inherit: Record<string, string> = {
			'male-only': 'men-only',
			'semi-salic': 'men-first-in-house',
			'reverse-semi-salic': 'women-first-in-house',
			'male-first': 'men-first',
			'male-preference': 'men-first',
			none: 'no-preference',
			any: 'no-preference',
			'female-first': 'women-first',
			'female-preference': 'women-first',
			'female-only': 'women-only',
		};
		for (const [old, now] of Object.entries(inherit)) expect(readInherit(old)).toBe(now);
		expect(readThrough('male')).toBe('men');
		expect(readThrough('female')).toBe('women');
		expect(readThrough('any')).toBe('anyone');
	});
	it('gives undefined for another text, also for names on the object prototype', () => {
		expect(readRule('salic')).toBeUndefined();
		expect(readRule('constructor')).toBeUndefined();
		expect(readInherit('toString')).toBeUndefined();
		expect(readRule(undefined)).toBeUndefined();
	});
	it('reads inherit-illegitimate: no, after, equal, and the old true and false', () => {
		expect(readIllegitimate('no')).toBe('no');
		expect(readIllegitimate('FALSE')).toBe('no');
		expect(readIllegitimate('after')).toBe('after');
		expect(readIllegitimate('Equal')).toBe('equal');
		expect(readIllegitimate('true')).toBe('after');
		expect(readIllegitimate('yes')).toBe('after');
		expect(readIllegitimate('sometimes')).toBeUndefined();
	});
});

describe('ordinal', () => {
	it('writes the English suffix', () => {
		const want: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 20: '20th', 21: '21st', 22: '22nd', 23: '23rd', 101: '101st', 111: '111th', 112: '112th' };
		for (const [n, text] of Object.entries(want)) expect(ordinal(Number(n))).toBe(text);
	});
});

describe('isDead (J.7)', () => {
	it('is false when died is absent or an alive word', () => {
		expect(isDead({})).toBe(false);
		for (const w of ['false', 'no', 'alive', 'living', 'never', ' No ', 'ALIVE']) expect(isDead({ died: w })).toBe(false);
	});
	it('is true for every other text', () => {
		for (const w of ['1203', 'in infancy', '?', 'unknown', 'killed in battle']) expect(isDead({ died: w })).toBe(true);
	});
});

describe('reading the title keys (A, K.1, K.3)', () => {
	it('adds no field to a title without the keys', () => {
		const t = titleOf('    holders: []\n');
		for (const k of ['succession', 'inherit', 'inheritThrough', 'inheritIllegitimate', 'inheritAdopted', 'year', 'heirs', 'exclude', 'badKeys']) expect(k in t).toBe(false);
	});
	it('reads the keys as written, trimmed', () => {
		const t = titleOf(
			'    succession: " eldest-child "\n    inherit: men-first\n    inherit-through: male\n    inherit-illegitimate: after\n    inherit-adopted: true\n    year: 1210\n    heir: hugo\n    exclude: [bo, cy]\n',
		);
		expect(t).toMatchObject({ succession: 'eldest-child', inherit: 'men-first', inheritThrough: 'men', inheritIllegitimate: 'after', inheritAdopted: true, year: '1210', heirs: ['hugo'], exclude: ['bo', 'cy'] });
		expect(t.badKeys).toBeUndefined();
	});
	it('keeps an old name as written in succession and inherit', () => {
		const t = titleOf('    succession: primogeniture\n    inherit: semi-salic\n');
		expect(t.succession).toBe('primogeniture');
		expect(t.inherit).toBe('semi-salic');
	});
	it('reads inherit-illegitimate: true and yes as after, false and no as nothing', () => {
		expect(titleOf('    inherit-illegitimate: true\n').inheritIllegitimate).toBe('after');
		expect(titleOf('    inherit-illegitimate: yes\n').inheritIllegitimate).toBe('after');
		expect(titleOf('    inherit-illegitimate: equal\n').inheritIllegitimate).toBe('equal');
		const no = titleOf('    inherit-illegitimate: false\n');
		expect('inheritIllegitimate' in no).toBe(false);
		expect(no.badKeys).toBeUndefined();
		expect(titleOf('    inherit-illegitimate: no\n').badKeys).toBeUndefined();
	});
	it('puts an unusable inherit-illegitimate and inherit-through into badKeys', () => {
		const t = titleOf('    inherit-illegitimate: sometimes\n    inherit-through: both\n');
		expect(t.badKeys).toEqual({ 'inherit-illegitimate': 'sometimes', 'inherit-through': 'both' });
		expect('inheritIllegitimate' in t).toBe(false);
		expect('inheritThrough' in t).toBe(false);
	});
	it('reads inherit-adopted with bool: on and 1 read as off', () => {
		expect(titleOf('    inherit-adopted: yes\n').inheritAdopted).toBe(true);
		expect('inheritAdopted' in titleOf('    inherit-adopted: on\n')).toBe(false);
		expect('inheritAdopted' in titleOf('    inherit-adopted: false\n')).toBe(false);
	});
	it('ignores a key with an empty value', () => {
		const t = titleOf('    succession:\n    inherit: ""\n    year:\n    heir:\n    exclude: []\n');
		expect(t.badKeys).toBeUndefined();
		for (const k of ['succession', 'inherit', 'year', 'heirs', 'exclude']) expect(k in t).toBe(false);
	});
	it('puts a list or a map value into badKeys as flow text and leaves the field undefined', () => {
		const t = titleOf('    succession: [eldest-child, 3]\n    inherit: {a: b}\n    year: [1210]\n    heir: {id: x}\n');
		expect(t.badKeys).toEqual({ succession: '[eldest-child, 3]', inherit: '{…}', year: '[1210]', heir: '{…}' });
		for (const k of ['succession', 'inherit', 'year', 'heirs']) expect(k in t).toBe(false);
	});
	it('reads a numeric year and heir as text', () => {
		const t = titleOf('    year: 1210\n    heir: 42\n');
		expect(t.year).toBe('1210');
		expect(t.heirs).toEqual(['42']);
	});
	it('reads a list of heirs in order, skips an item that is not text and notes it', () => {
		const t = titleOf('    heir: [hugo, [x], wren]\n');
		expect(t.heirs).toEqual(['hugo', 'wren']);
		expect(t.badKeys).toEqual({ heir: '[hugo, …, wren]' });
	});
	it('takes the curly marks off heir and exclude, scalar or list (D103)', () => {
		const data = { titles: [{ heir: '“hugo”', exclude: ['“bo”', 'cy'] }] };
		unwrapCurlyKeys(data);
		expect(data.titles[0]).toEqual({ heir: 'hugo', exclude: ['bo', 'cy'] });
		const t = titleOf('    heir: “hugo”\n');
		expect(t.heirs).toEqual(['hugo']);
	});
	it('counts heir and exclude ids as referenced ids, also when holders is a map', () => {
		const parsed = parseBody('titles:\n  - id: t\n    heir: hugo\n    exclude: [bo, cy]\n    holders: {a: b}\n');
		if (!parsed.ok) throw new Error('parse');
		const ids = referencedIds(parsed.data as Record<string, unknown>);
		expect([...ids].sort()).toEqual(['bo', 'cy', 'hugo']);
	});
});

describe('the succession warnings (A.5, K.4)', () => {
	const only = (keys: string, code: string) => warnings(keys).filter((i) => i.code === code);
	it('give none for a title without the keys or with good keys', () => {
		expect(warnings('    holders: []\n')).toEqual([]);
		expect(warnings('    succession: eldest-child\n    inherit: men-only\n    inherit-through: men\n    inherit-illegitimate: after\n    year: 1210\n    heir: a\n    exclude: a\n')).toEqual([]);
		expect(warnings('    succession: primogeniture\n    inherit: male-only\n')).toEqual([]);
	});
	it('warn about an unknown succession, with the Salic hint', () => {
		const [w] = only('    succession: salic\n', 'unknown-succession');
		expect(issueText(w)).toBe(
			'The title Duke has “succession: salic”. The plugin does not know this rule, so it shows no line of succession. Use one of these rules: eldest-child, youngest-child, siblings-first, nearest-relative, born-in-reign. For the Salic law, use “succession: eldest-child” with “inherit: men-only”.',
		);
		expect(issueText(only('    succession: Semi-Salic\n', 'unknown-succession')[0])).toContain('For the semi-Salic law, use “succession: eldest-child” with “inherit: men-first-in-house”.');
		expect(issueText(only('    succession: lottery\n', 'unknown-succession')[0])).not.toContain('For the');
	});
	it('warn about an unknown inherit, inherit-through and inherit-illegitimate', () => {
		expect(issueText(only('    inherit: sons\n', 'unknown-inherit')[0])).toBe(
			'The title Duke has “inherit: sons”. The plugin does not know this rule, so it shows no line of succession. Use one of these rules: men-only, men-first-in-house, men-first, no-preference, women-first, women-first-in-house, women-only.',
		);
		expect(issueText(only('    inherit-through: both\n', 'unknown-inherit-through')[0])).toContain('“inherit-through: both”');
		expect(issueText(only('    inherit-illegitimate: maybe\n', 'unknown-inherit-illegitimate')[0])).toBe(
			'The title Duke has “inherit-illegitimate: maybe”. The plugin does not know this value, so it shows no line of succession. Use one of these values: no, after, equal.',
		);
	});
	it('use the flow text for a list value', () => {
		expect(issueText(only('    succession: [a, b]\n', 'unknown-succession')[0])).toContain('“succession: [a, b]”');
	});
	it('warn about an unreadable year only when the title has a rule or a named heir', () => {
		expect(only('    year: Easter\n', 'year-unreadable')).toEqual([]);
		expect(issueText(only('    year: Easter\n    succession: eldest-child\n', 'year-unreadable')[0])).toBe(
			'The title Duke has “year: Easter”. The plugin cannot find a year in it. The line of succession uses the end of the last reign. If the last reign has no end, the line is for now. Write the year as a number, for example “year: 1210”.',
		);
		expect(only('    year: Easter\n    heir: a\n', 'year-unreadable')).toHaveLength(1);
		expect(only('    year: -200\n    heir: a\n', 'year-unreadable')).toEqual([]);
	});
	it('warn once for each heir or excluded id that names nobody', () => {
		const heir = only('    heir: [a, ghost, ghost, ghost2]\n', 'missing-heir');
		expect(heir.map((w) => w.params.ref)).toEqual(['ghost', 'ghost2']);
		expect(issueText(heir[0])).toBe('The title Duke has “heir: ghost”, but no person has this ID. Correct the ID, or remove it.');
		const ex = only('    exclude: ghost\n', 'missing-excluded');
		expect(issueText(ex[0])).toBe('The title Duke has “exclude: ghost”, but no person has this ID. Correct the ID, or remove it.');
		expect(only('    heir: {x: y}\n', 'missing-heir').map((w) => w.params.ref)).toEqual(['{…}']);
	});
	it('give no ids and are emitted once, for the first title with an id', () => {
		const r = parseDynasty('people:\n  - {id: a, name: A}\n\ntitles:\n  - {id: t, name: One, succession: lottery}\n  - {id: t, name: Two, succession: lottery}\n');
		if (!r.ok) throw new Error('parse');
		const w = deriveFamilies(r.tree).issues.filter((i) => i.code === 'unknown-succession');
		expect(w).toHaveLength(1);
		expect(w[0].ids).toBeUndefined();
		expect(w[0].params.title).toBe('One');
	});
	it('warn about a sex spelling and a doubtful died, per person, with the person id', () => {
		const people = '  - {id: a, name: Aldric, sex: Male, died: "?"}\n  - {id: b, name: Bo, sex: M, died: Unknown}\n  - {id: c, name: Cy, sex: m, died: no}\n  - {id: d, name: Di, sex: X, died: maybe}\n  - {id: e, name: Ed, sex: "f.", died: 1200}';
		const issues = warnings('    holders: []\n', people);
		const sex = issues.filter((i) => i.code === 'sex-spelling');
		expect(sex.map((i) => i.ids)).toEqual([['a'], ['b'], ['e']]);
		expect(issueText(sex[0])).toBe('Aldric has “sex: Male”. The plugin reads only “m” and “f” as a man and a woman. If you mean a man or a woman, write “sex: m” or “sex: f”.');
		const died = issues.filter((i) => i.code === 'died-doubtful');
		expect(died.map((i) => i.ids)).toEqual([['a'], ['b'], ['d']]);
		expect(issueText(died[0])).toBe('Aldric has “died: ?”. The plugin counts Aldric as dead. If Aldric is alive, remove “died: ?” from the note.');
	});
	it('do not warn about m, f, another letter or an alive word', () => {
		const people = '  - {id: a, name: A, sex: m, died: alive}\n  - {id: b, name: B, sex: f, died: false}\n  - {id: c, name: C, sex: x}';
		expect(warnings('    holders: []\n', people)).toEqual([]);
	});
	it('skip a second person with the same id', () => {
		const issues = warnings('    holders: []\n', '  - {id: a, name: A, sex: Male}\n  - {id: a, name: A2, sex: Female}');
		expect(issues.filter((i) => i.code === 'sex-spelling')).toHaveLength(1);
	});
});
