// D371 (4), row R16 of the genealogy vet: a child placed under her adoptive parents, with one more parent written as a birth parent
// and as a rumoured parent. Before 0.5.7 the rumoured entry made him a lone rumoured parent (`loneRumouredRoots`): he stood beside
// the adoptive couple, and a rumoured curve lay on the birth curve. Now the tree draws the birth curve only, he is no lone rumoured
// parent, and the order puts him first in his row. This pins the new drawn result for the picture check.
import { describe, expect, it } from 'vitest';
import { loneRumouredRoots } from '../../src/core/rumoured-roots';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { build } from '../support/helpers';

const tree = (miraParents: string) => `people:
  - {id: oren, name: Oren, sex: m}
  - {id: a1, name: A1, sex: m}
  - {id: a2, name: A2, sex: f}
  - {id: mira, name: Mira, sex: f, parents: [${miraParents}], placement: adoptive}
  - {id: tam, name: Tam, sex: m, parents: [a1, a2]}
unions:
  - {partners: [a1, a2]}
`;
const ADOPTED = '{id: a1, type: adoptive}, {id: a2, type: adoptive}';

function drawn(source: string) {
	const { g, gen, order } = build(source);
	const { layout, edges } = arrangeTree(g, gen, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE });
	return {
		lone: [...loneRumouredRoots(g).keys()],
		blocks: order.blocks,
		rows: Object.fromEntries(gen),
		cards: Object.fromEntries([...layout.persons].map(([id, b]) => [id, [b.x, b.y]])),
		lines: edges.paths.map((p) => `${p.kind} ${p.child ?? '-'}<${(p.parents ?? []).join('+')}`),
	};
}

describe('D371 (4): a birth and rumoured parent of a child placed under adoptive parents', () => {
	it('draws one birth curve from Oren, and Oren stands first in his row', () => {
		const now = drawn(tree(`${ADOPTED}, oren, {id: oren, type: rumoured}`));
		expect(now).toEqual({
			lone: [],
			blocks: [['oren'], ['a1', 'a2'], ['mira'], ['tam']],
			rows: { oren: 0, a1: 0, a2: 0, mira: 1, tam: 1 },
			cards: { oren: [0, 0], a1: [200, 0], a2: [416, 0], mira: [208, 161], tam: [408, 161] },
			lines: ['marriage -<', 'descent -<a1+a2', 'adoptive mira<a1+a2', 'descent tam<a1+a2', 'birth-link mira<oren'],
		});
	});

	it('is the drawing of the note without the rumoured entry, in both orders of the entries', () => {
		const plain = drawn(tree(`${ADOPTED}, oren`));
		expect(drawn(tree(`${ADOPTED}, oren, {id: oren, type: rumoured}`))).toEqual(plain);
		expect(drawn(tree(`${ADOPTED}, {id: oren, type: rumoured}, oren`))).toEqual(plain);
	});

	it('a rumoured parent alone keeps the place beside the adoptive couple', () => {
		const rumoured = drawn(tree(`${ADOPTED}, {id: oren, type: rumoured}`));
		expect(rumoured.lone).toEqual(['oren']);
		expect(rumoured.blocks).toEqual([['a1', 'a2', 'oren'], ['mira'], ['tam']]);
		expect(rumoured.lines).toContain('rumoured mira<oren');
	});
});
