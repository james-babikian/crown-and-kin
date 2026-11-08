// The line of succession and the begetter link (spec §0 D332, §13.21): a begetter link carries no claim (rule 10), the climb to an earlier
// holder never follows it (rule 13), and it counts for "has a drawn family" (rule 23 item 4) and for `childless-has-child`. Rows 35 and 36
// of the begetter study on sample tree 20.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionResult } from '../../src/core/succession';
import { build, fixture } from '../support/helpers';

const run = (source: string, title = 0): SuccessionResult => {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error('parse');
	const g = deriveFamilies(r.tree);
	const t = g.titles[title];
	const spec = specOf(t);
	return successionLine(g, t, { ...spec, rule: spec.rule ?? 'eldest-child' }, 99, 110);
};
const heirs = (source: string, title = 0) => run(source, title).heirs.map(String);

describe('sample tree 20: a begotten child never inherits (rule 10)', () => {
	it('row 35: the Barony of Thorne after Oswin, 1145, is Bram, Tam, Elfa, Wynn (no Ada, Ivo, Lys or Linnet)', () => {
		expect(build(fixture('20')).g.titles.map((t) => t.id)).toEqual(['thorne', 'merrow']);
		expect(heirs(fixture('20'), 0)).toEqual(['bram', 'tam', 'elfa', 'wynn']);
	});

	it('row 36: the Lady of Merrow after Isaut, 1145, is Ada, Lys, Ivo, Corin, Tristan, Wynn (the begetter changes nothing)', () => {
		expect(heirs(fixture('20'), 1)).toEqual(['ada', 'lys', 'ivo', 'corin', 'tristan', 'wynn']);
	});
});

describe('the climb to an earlier holder never follows a begetter link (rule 13)', () => {
	// K held the title after G and died childless; K's link to G decides whether the line climbs to G's son S.
	const source = (type: string) => `titles:
  - id: t
    name: Title
    succession: eldest-child
    year: 1160
    holders:
      - {person: g, from: 1100, to: 1130}
      - {person: k, from: 1130, to: 1150}
people:
  - {id: g, name: G, sex: m, born: 1070, died: 1130}
  - {id: w, name: W, sex: f, born: 1072}
  - {id: s, name: S, sex: m, born: 1095, parents: [g, w]}
  - {id: m, name: M, sex: f, born: 1090}
  - {id: k, name: K, sex: m, born: 1110, died: 1150, childless: true, parents: [m, {id: g, type: ${type}}]}
  - {id: j, name: J, sex: m, born: 1112, parents: [m]}
unions:
  - partners: [g, w]
`;

	it('a birth link climbs to G and gives S', () => {
		expect(heirs(source('birth'))).toEqual(['s']);
	});

	it('a begetter link does not climb, as a rumoured link does not: the line goes through K\'s mother to J', () => {
		expect(heirs(source('begetter'))).toEqual(['j']);
		expect(heirs(source('rumoured'))).toEqual(['j']);
	});
});

describe('a begetter link counts for a drawn family (rule 23 item 4)', () => {
	// D dies with no heir of the body; an open branch shows only for a dead person with no child in the tree.
	const source = (child: string) => `titles:
  - id: t
    name: Title
    succession: eldest-child
    year: 1160
    holders:
      - {person: r, from: 1100}
people:
  - {id: r, name: R, sex: m, born: 1070, died: 1130}
  - {id: d, name: D, sex: m, born: 1095, died: 1120, parents: [r]}
${child}`;

	it('a begotten child of D removes the open branch of D, as a rumoured child does; a ward does not', () => {
		const child = (type: string) => `  - {id: c, name: C, sex: m, born: 1115, parents: [{id: d, type: ${type}}]}
`;
		const branches = (people: string) => run(source(people)).openBranches.map((b) => b.id);
		expect(branches('')).toEqual(['d']);
		expect(branches(child('ward'))).toEqual(['d']);
		expect(branches(child('rumoured'))).toEqual([]);
		expect(branches(child('begetter'))).toEqual([]);
		// The begotten child has no claim, so the line is empty.
		expect(run(source(child('begetter'))).heirs).toEqual([]);
	});
});
