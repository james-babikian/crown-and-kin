/*
 * 0.2.8 test round, branch scratch/r028-test-kin. One FAILING test for each kept finding of the search round's
 * genealogy checker (an internal study, area A2 "kin", ids F-KIN-01 to F-KIN-12). The scratch scripts of the
 * checker were turned into tests; every case is small and written out by hand.
 *
 * Each test fails on release-0.2.8 for the reason in its name. Tests marked "owner choice" check today's fault; the
 * owner decides on the findings page what the right answer is. Tests marked "spec question" fail against the plain
 * words of the spec only if the spec is read as the finding reads it; the report lists the question.
 *
 * Run: npx vitest run tests/review-r028-kin.test.ts
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionResult } from '../../src/core/succession';
import { yearOf } from '../../src/core/succession-keys';
import { SUCCESSION_UI } from '../../src/render/ui-text';

function graphOf(src: string): FamilyGraph {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	return deriveFamilies(r.tree);
}

/** A title with one succession key list; people and holders are written as flow maps. */
function line(people: string[], holders: string[], keys: string[] = ['succession: eldest-child']): { res: SuccessionResult; g: FamilyGraph } {
	const src = `people:\n${people.map((p) => '  - ' + p).join('\n')}\ntitles:\n  - id: t\n    name: T\n${keys.map((k) => '    ' + k).join('\n')}\n    holders:\n${holders.map((h) => '      - ' + h).join('\n')}\n`;
	const g = graphOf(src);
	const t = g.titles[0];
	return { res: successionLine(g, t, specOf(t), 99, 110, 0), g };
}

describe('F-KIN-01 the year rule reads a year text wrongly and shows the line as sure (spec question)', () => {
	it('F-KIN-01: "BC 300" is -300, "1,250" is 1250, "12,000 BC" is -12000 (today 300, 250, 0)', () => {
		// Spec §13.21 rule 5 item 2 says "a number followed by BC", item 4 takes the first run of 3 or 4 digits. A
		// reader of a date text expects these three; the plugin gives a wrong year and no warning.
		// §14 rule 8 (0.3.2): n BC is internal 1 - n, so "BC 300" is -299 and "12,000 BC" is -11999.
		expect.soft(yearOf('BC 300'), 'BC before the number').toBe(-299);
		expect.soft(yearOf('1,250'), 'comma as a thousands mark').toBe(1250);
		expect.soft(yearOf('12,000 BC'), 'comma and BC').toBe(-11999);
	});

	it('F-KIN-01: a child born "1,250" is not in the line of the year 1200', () => {
		const { res } = line(
			['{id: r, name: R, sex: m, born: 1150}', '{id: c, name: C, sex: m, born: "1,250", parents: [r]}', '{id: d, name: D, sex: m, born: 1180, parents: [r]}', '{id: p, name: P, sex: m, born: 1100, died: 1140}'],
			['{person: p, from: 1100, to: 1140}', '{person: r, from: 1140}'],
			['succession: eldest-child', 'year: 1200'],
		);
		expect(res.heirs, 'C is born in 1250, 50 years after the year of the line').toEqual(['d']);
	});
});

describe('F-KIN-06 (spec silent) a BC year shows as a minus number in the succession texts', () => {
	it('F-KIN-06: the heading, the bar, the no-holder text and the age note write "225 BC", not "-225"', () => {
		// §14 rule 8 (0.3.2): the texts get internal years; -224 shows as 225 BC.
		const shown = [SUCCESSION_UI.lineAfter('Antiochus', -224), SUCCESSION_UI.bar('Seleucid throne', -224), SUCCESSION_UI.noRuler(-299), SUCCESSION_UI.old('Hero', 111, -199)];
		for (const s of shown) expect.soft(s, 'a minus sign before a year').not.toMatch(/-\d/);
		expect.soft(shown[0]).toMatch(/225\s?B\.?C/);
	});
});

describe('F-KIN-07 with heirs-of-body a first holder entry with only a name is skipped without a sign', () => {
	it('F-KIN-07: the first entry is "Old Duke" (a name only); the plugin does not name the second entry as the first holder', () => {
		const people = [
			'{id: od, name: Old Duke, sex: m, born: 1000, died: 1060}',
			'{id: x, name: X, sex: m, born: 1030, died: 1090, parents: [od]}',
			'{id: y, name: Y, sex: m, born: 1035, parents: [od]}',
			'{id: r, name: R, sex: m, born: 1060, parents: [x]}',
			'{id: z, name: Z, sex: m, born: 1100, parents: [r]}',
		];
		const { res, g } = line(people, ['{name: Old Duke, from: 1000, to: 1060}', '{person: x, from: 1060, to: 1090}', '{person: r, from: 1090}'], ['succession: eldest-child', 'heirs-of-body: true']);
		// Spec §13.21 rule 14 says "the first holder entry whose person is in the tree", which skips Old Duke. The
		// window then tells the user "The first holder is X", and Y (a son of Old Duke) is out of the line with no sign.
		// A tree warning, another first holder, or the note of the result (the hint of 0.2.8 an internal note 2.1) all count as a sign.
		const warned = g.issues.length > 0 || res.notes.some((n) => n.kind === 'body-skipped' && n.params.first === 'x' && n.params.entry === 'Old Duke');
		expect(res.firstHolder === 'x' && !warned, `firstHolder ${res.firstHolder}, ${g.issues.length} warnings`).toBe(false);
	});
});

describe('F-KIN-10 (owner choice) a co-ruler is listed as the first heir of the other', () => {
	it('F-KIN-10: A and B both rule from 1100; neither is an heir of the other, and R does not depend on the holder order', () => {
		const people = [
			'{id: f, name: F, sex: m, born: 1050, died: 1099}',
			'{id: a, name: A, sex: m, born: 1075, parents: [f]}',
			'{id: b, name: B, sex: m, born: 1080, parents: [f]}',
			'{id: c, name: C, sex: m, born: 1100, parents: [a]}',
		];
		const one = line(people, ['{person: a, from: 1100}', '{person: b, from: 1100}']).res;
		const two = line(people, ['{person: b, from: 1100}', '{person: a, from: 1100}']).res;
		const detail = `A first: R=${one.ruler} heirs=[${one.heirs}] co=[${one.coRulers}]; B first: R=${two.ruler} heirs=[${two.heirs}] co=[${two.coRulers}]`;
		for (const r of [one, two]) for (const co of r.coRulers) expect.soft(r.heirs, detail).not.toContain(co);
	});
});

describe('F-KIN-11 the climb orders the parents by the drawn order, not by the order in the note (§13.21 rule 13)', () => {
	it('F-KIN-11: R lists the adoptive parent a first and the birth parent b second: the walk goes through a first', () => {
		const people = (parents: string) => [
			'{id: a, name: A, sex: m, born: 1050}',
			'{id: b, name: B, sex: f, born: 1052}',
			'{id: sa, name: SA, sex: m, born: 1075, parents: [a]}',
			'{id: sb, name: SB, sex: m, born: 1076, parents: [b]}',
			`{id: r, name: R, sex: m, born: 1080, parents: ${parents}}`,
		];
		const keys = ['succession: eldest-child', 'inherit-adopted: true'];
		const adoptiveFirst = line(people('[{id: a, type: adoptive}, b]'), ['{person: r, from: 1100}'], keys).res;
		const birthFirst = line(people('[b, {id: a, type: adoptive}]'), ['{person: r, from: 1100}'], keys).res;
		expect.soft(birthFirst.heirs, 'b listed first').toEqual(['sb', 'sa']);
		expect(adoptiveFirst.heirs, 'a listed first (rule 13: "then in the order of parents in the note")').toEqual(['sa', 'sb']);
	});
});
