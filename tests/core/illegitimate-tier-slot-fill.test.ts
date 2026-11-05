/*
 * 0.2.8 work package P2, extra repair: with `inherit-illegitimate: after` the illegitimacy tier is its own group for the
 * slot-fill of birth years (D193) and for the D202 notes, like the sex test. A legitimate child never moves an illegitimate one.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionResult } from '../../src/core/succession';

function lineOf(kids: string[], rule: string, ill = 'after'): SuccessionResult {
	const src = `people:\n  - {id: r, name: R, sex: m, born: 1100}\n${kids.map((k) => '  - ' + k).join('\n')}\ntitles:\n  - id: t\n    name: T\n    succession: ${rule}\n    inherit-illegitimate: ${ill}\n    holders:\n      - {person: r, from: 1140}\n`;
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	const g = deriveFamilies(r.tree);
	return successionLine(g, g.titles[0], specOf(g.titles[0]), 99, 0);
}

const kid = (id: string, born?: string, ill = false) => `{id: ${id}, name: ${id}, sex: m${born ? ', born: ' + born : ''}, parents: [r]${ill ? ', illegitimate: true' : ''}}`;
const named = (res: SuccessionResult) => JSON.stringify(res.notes);

describe('inherit-illegitimate: after: the illegitimacy tier is its own slot-fill group', () => {
	it('eldest-child: P (ill 1160), Q (ill, no year), L (1145) rank L P Q and no note names L', () => {
		const res = lineOf([kid('P', '1160', true), kid('Q', undefined, true), kid('L', '1145')], 'eldest-child');
		expect(res.heirs).toEqual(['L', 'P', 'Q']);
		expect(res.notes).toEqual([]);
		expect(named(res)).not.toContain('"L"');
	});

	it('youngest-child: the illegitimate children are reversed inside their tier and still follow the legitimate one', () => {
		const kids = [kid('P', '1160', true), kid('Q', undefined, true), kid('E', '1150', true), kid('L', '1145')];
		expect(lineOf(kids, 'youngest-child').heirs).toEqual(['L', 'P', 'Q', 'E']);
		expect(lineOf(kids, 'eldest-child').heirs).toEqual(['L', 'E', 'Q', 'P']);
	});

	it('two children with no year in the tier keep their places; the dated ones fill the other places', () => {
		const kids = [kid('P', '1160', true), kid('U1', undefined, true), kid('E', '1150', true), kid('U2', undefined, true), kid('L', '1145')];
		const res = lineOf(kids, 'eldest-child');
		expect(res.heirs).toEqual(['L', 'E', 'U1', 'P', 'U2']);
		// The break of the years and the note names only the tier, never L or U2.
		const loops = res.notes.filter((n) => n.kind === 'order-contradiction').map((n) => (n.params.people as string[]).join(' '));
		expect(loops).toEqual(['P U1 E']);
		expect(named(res)).not.toContain('"L"');
		expect(named(res)).not.toContain('"U2"');
	});

	it('a legitimate child with a year is still ranked among the legitimate children by year', () => {
		const res = lineOf([kid('A', '1160'), kid('B', '1150', true), kid('C', '1155')], 'eldest-child');
		expect(res.heirs).toEqual(['C', 'A', 'B']);
	});

	it('equal: no tier, all children are one group', () => {
		const res = lineOf([kid('P', '1160', true), kid('Q', undefined, true), kid('L', '1145')], 'eldest-child', 'equal');
		expect(res.heirs).toEqual(['L', 'Q', 'P']);
	});
});
