// With either setting, the names of a child with a birth and an adoptive parent (the legal pair of D293) must not depend on the order in
// which an unrelated person lists three parents. The legal pair needs a union of its two parents; a child with three parents makes an
// implicit union only between the first two it lists, so that union does not count for the legal pair.
import { describe, expect, it } from 'vitest';
import { computeRelations } from '../../src/core/relations';
import { build } from '../support/helpers';

const words = (parents: string, on: boolean) => {
	const note = `people: [{id: p00, sex: m}, {id: p01, sex: f}, {id: p02, sex: f}, {id: p11, sex: f, parents: [{id: p02, type: adoptive}, p00]}, {id: p23, sex: m, parents: [{id: p02, type: rumoured}]}, {id: p10, parents: [${parents}]}]`;
	const { g } = build(note);
	return (computeRelations(g, 'p11', { oneParentUnknown: on }).get('p23') ?? []).map((r) => r.text).join(' | ');
};

describe('names do not depend on the order of an unrelated list of three parents', () => {
	for (const on of [false, true]) {
		it(`setting ${on ? 'on' : 'off'}`, () => {
			const orders = ['p00, p02, p01', 'p02, p00, p01', 'p01, p00, p02'].map((o) => words(o, on));
			expect(new Set(orders).size).toBe(1);
		});
	}
});
