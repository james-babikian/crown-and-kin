import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { CodedIssue, IssueCode, IssueParams } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import type { Tree } from '../../src/core/types';
import { allFixtures, fixtureSource } from './load';

// Spec §8 and the codes in src/core/issues.ts. Tests assert codes, never message text.

const BLOCKING_CODES: IssueCode[] = ['duplicate-person-id', 'duplicate-union-id'];

function parseOk(source: string): Tree {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree;
}

/** Every issue for a block: `deriveFamilies` reports the parse issues together with its own. */
function issuesOf(source: string): CodedIssue[] {
	return deriveFamilies(parseOk(source)).issues;
}

const tally = (issues: { code: string; level: string }[]) => issues.map((i) => `${i.level}:${i.code}`).sort();

interface Expected {
	code: IssueCode;
	level: 'blocking' | 'warning';
	/** Each of these ids must be in `issue.ids`. */
	ids?: string[];
	/** Exactly these ids, in any order. */
	exactIds?: string[];
	params?: IssueParams;
}

describe('fixture 5 (malformed): spec §8, §10 item 5', () => {
	const expected: Expected[] = [
		// Edit-blocking errors.
		{ code: 'duplicate-person-id', level: 'blocking', ids: ['hal'], params: { id: 'hal' } },
		{ code: 'duplicate-union-id', level: 'blocking', params: { id: 'spring-wedding' } },
		// Missing references.
		{ code: 'missing-start', level: 'warning', params: { ref: 'aldous' } },
		{ code: 'missing-focus', level: 'warning', params: { ref: 'lost-heir' } },
		{ code: 'missing-parent', level: 'warning', ids: ['wynn'], params: { ref: 'ghost' } },
		{ code: 'missing-house', level: 'warning', ids: ['wynn'], params: { ref: 'ashfurd' } },
		{ code: 'missing-union', level: 'warning', ids: ['cole'], params: { ref: 'second-wedding' } },
		{ code: 'missing-partner', level: 'warning', params: { ref: 'nobody' } },
		// Structure.
		{ code: 'too-many-parents', level: 'warning', ids: ['joss'], params: { type: 'birth', count: 3 } },
		{ code: 'union-partner-count', level: 'warning', params: { count: 3 } },
		{ code: 'union-same-partner', level: 'warning', ids: ['tilda'] },
		{ code: 'cycle', level: 'warning', exactIds: ['arn', 'bram', 'col'] },
		{ code: 'placement-without-parents', level: 'warning', ids: ['piers'], params: { placement: 'ward' } },
		{ code: 'house-color-null', level: 'warning' },
		// Unknown values.
		{ code: 'unknown-union-type', level: 'warning', params: { value: 'handfasting' } },
		{ code: 'unknown-placement', level: 'warning', ids: ['tilda'], params: { value: 'fostered' } },
		{ code: 'unknown-parent-type', level: 'warning', ids: ['edda'], params: { value: 'godfather' } },
	];

	it('renders: parse succeeds (no hard error)', () => {
		expect(parseDynasty(fixtureSource('05')).ok).toBe(true);
	});

	it('reports exactly the expected codes and levels', () => {
		expect(tally(issuesOf(fixtureSource('05')))).toEqual(tally(expected));
	});

	it('has at least one blocking issue, so editing is off and the banner shows', () => {
		expect(issuesOf(fixtureSource('05')).some((i) => i.level === 'blocking')).toBe(true);
	});

	for (const e of expected) {
		if (!e.ids && !e.exactIds && !e.params) continue;
		it(`${e.code}: names the right people and values`, () => {
			const issue = issuesOf(fixtureSource('05')).find((i) => i.code === e.code);
			expect(issue).toBeDefined();
			if (e.ids) for (const id of e.ids) expect(issue!.ids ?? []).toContain(id);
			if (e.exactIds) expect([...(issue!.ids ?? [])].sort()).toEqual([...e.exactIds].sort());
			if (e.params) expect(issue!.params).toMatchObject(e.params);
		});
	}

	it('cycle: names the three people involved, in cycle order', () => {
		const cycle = issuesOf(fixtureSource('05')).find((i) => i.code === 'cycle')!;
		const names = cycle.params.people as string[];
		expect([...names].sort()).toEqual(['Arn Marsh', 'Bram Marsh', 'Col Marsh']);
		// Arn is Bram's parent, Bram is Col's, Col is Arn's. The spec does not fix the direction
		// or the starting person, so any rotation of the loop, either way round, is accepted.
		const rotations = (xs: string[]) => xs.map((_, i) => [...xs.slice(i), ...xs.slice(0, i)].join(' > '));
		const loop = ['Arn Marsh', 'Bram Marsh', 'Col Marsh'];
		expect([...rotations(loop), ...rotations([...loop].reverse())]).toContain(names.join(' > '));
		expect(['Arn Marsh', 'Bram Marsh', 'Col Marsh']).toContain(cycle.params.dropped);
	});
});

describe('any sex value is valid (D12): spec §4.1, §8', () => {
	const withSex = (sex: string) => `people:\n  - id: p1\n    name: Test Person\n    sex: ${sex}\n`;

	for (const [label, sex] of [
		['x', 'x'],
		['empty string', '""'],
	] as const) {
		it(`sex: ${label} produces no issue`, () => {
			expect(issuesOf(withSex(sex))).toEqual([]);
		});
	}

	// Contract 0.2.7 J.4, K.9: a capital letter is a spelling of "man" that the plugin does not read, so it gets the warning sex-spelling.
	it('sex: M produces one warning, sex-spelling, and the value is kept', () => {
		const issues = issuesOf(withSex('M'));
		expect(issues.map((i) => [i.code, i.level, i.params.person, i.params.value, i.ids])).toEqual([['sex-spelling', 'warning', 'Test Person', 'M', ['p1']]]);
	});
});

describe('fixture 10 (hand-typing): spec §3, §8 "Tolerated silently", §10 item 10', () => {
	const tree = () => parseOk(fixtureSource('10'));
	const person = (id: string) => tree().people.find((p) => p.id === id)!;
	const refs = (id: string) => person(id).parents.map((r) => ({ id: r.id, type: r.type }));

	it('parses', () => {
		expect(parseDynasty(fixtureSource('10')).ok).toBe(true);
	});

	it('keeps born: 1102-03-04 as the exact string, not a date', () => {
		expect(person('aldric').born).toBe('1102-03-04');
		expect(person('aldric').died).toBe('1161');
	});

	it('stringifies numeric ids and numeric references to them', () => {
		expect(tree().people.map((p) => p.id)).toEqual(['aldric', '42', '43', 'wren', '0042', 'piers']);
		expect(refs('43')).toEqual([
			{ id: 'aldric', type: 'birth' },
			{ id: '42', type: 'birth' },
		]);
		expect(tree().unions[0].partners).toEqual(['aldric', '42']);
	});

	it('flattens an unquoted [[link]]', () => {
		expect(person('wren').link).toBe('[[Wren of the Marches]]');
	});

	it('reads a single string where a list was expected as a one-item list', () => {
		expect(refs('wren')).toEqual([{ id: 'aldric', type: 'birth' }]);
	});

	it('keeps a leading-zero id exactly as written, distinct from the same number without zeros', () => {
		expect(person('0042').name).toBe('Ser Gareth Orsini');
		expect(person('42').name).toBe('Isolde Orsini');
		expect(refs('piers')).toEqual([{ id: '0042', type: 'birth' }]);
	});

	it('reads a numeric options.start as the id string it refers to', () => {
		expect(tree().options.start).toBe('43');
	});

	it('reports only the unquoted colour', () => {
		const issues = issuesOf(fixtureSource('10'));
		expect(tally(issues)).toEqual(['warning:house-color-null']);
		expect(tree().houses[0].color ?? undefined).toBeUndefined();
	});
});

describe('fixture 11 (close-kin marriages): spec §10 acceptance', () => {
	it('has no issues at all', () => {
		expect(parseOk(fixtureSource('11')).issues).toEqual([]);
		expect(issuesOf(fixtureSource('11'))).toEqual([]);
	});
});

describe('every fixture: spec §8, §10 acceptance', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}: parses, and each issue has the level its code requires`, () => {
			for (const i of issuesOf(f.source)) {
				expect(`${i.code}:${i.level}`).toBe(`${i.code}:${BLOCKING_CODES.includes(i.code) ? 'blocking' : 'warning'}`);
			}
		});
		if (f.id === '05') continue;
		it(`fixture ${f.id}: no blocking issues`, () => {
			expect(issuesOf(f.source).filter((i) => i.level === 'blocking')).toEqual([]);
		});
	}

	// Hand-written, well-formed trees: any warning here would be a false alarm.
	for (const id of ['01', '02', '03', '04', '08', '09', '11', '12']) {
		it(`fixture ${id}: no issues`, () => {
			expect(tally(issuesOf(fixtureSource(id)))).toEqual([]);
		});
	}
});

describe('hard errors: spec §8', () => {
	it('invalid YAML returns yaml-invalid with the 1-based line and the parser message', () => {
		const r = parseDynasty('people:\n  - id: aldric\n    name: Aldric: Duke of Valmont\n');
		expect(r).toMatchObject({ ok: false, error: { code: 'yaml-invalid', line: 3 } });
		if (!r.ok) expect(r.error.detail).toMatch(/\S/);
	});

	it('a tab used as indentation is invalid YAML on its line', () => {
		expect(parseDynasty('people:\n  - id: aldric\n\tname: Aldric\n')).toMatchObject({ ok: false, error: { code: 'yaml-invalid', line: 3 } });
	});

	it('an unclosed flow list is invalid YAML', () => {
		expect(parseDynasty('people:\n  - id: a\n    parents: [b\n  - id: c\n')).toMatchObject({ ok: false, error: { code: 'yaml-invalid', line: expect.any(Number) } });
	});

	it('a top-level list returns not-a-map', () => {
		expect(parseDynasty('- id: aldric\n  name: Aldric\n')).toMatchObject({ ok: false, error: { code: 'not-a-map' } });
	});

	it('a top-level scalar returns not-a-map', () => {
		expect(parseDynasty('Aldric married Isolde\n')).toMatchObject({ ok: false, error: { code: 'not-a-map' } });
	});

	it('an empty block is not an error (spec §5.9)', () => {
		for (const body of ['', '\n', '# nothing yet\n']) {
			const r = parseDynasty(body);
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.tree.people).toEqual([]);
				expect(r.tree.issues).toEqual([]);
			}
		}
	});
});
