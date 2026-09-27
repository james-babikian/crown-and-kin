import { describe, expect, it } from 'vitest';
import { cardText, geometryFor } from '../src/layout/geometry';
import { illegitimateSigns } from '../src/layout/index';
import { DEFAULT_FAR_RULE, layoutFamilies } from '../src/layout/layout';
import { routeEdges } from '../src/layout/edges';
import { NORMAL_GEOMETRY } from '../src/layout/geometry';
import { renderSvg } from '../src/render/svg-string';
import { build, fixture } from './helpers';

// Spec D14: an illegitimate child whose illegitimacy no dashed line shows gets a sign on the card.

function signs(src: string) {
	const { g, gen, order } = build(src);
	const layout = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE });
	const edges = routeEdges(g, layout, order.anchors);
	return { g, layout, edges, ids: [...illegitimateSigns(g, edges)].sort() };
}

const COUPLE = `people:
  - {id: aldric, name: Aldric, sex: m}
  - {id: isolde, name: Isolde, sex: f}
  - {id: roderick, name: Roderick, sex: m, parents: [aldric, isolde]}
`;
const MARRIAGE = `unions:
  - {partners: [aldric, isolde]}
`;

describe('illegitimateSigns (D14)', () => {
	it('no birth parents listed: sign', () => {
		expect(signs(`${COUPLE}  - {id: wren, name: Wren, illegitimate: true}\n${MARRIAGE}`).ids).toEqual(['wren']);
	});

	it('placed under adoptive parents: sign, with or without birth parents as side links', () => {
		expect(signs(`${COUPLE}  - {id: tomas, name: Tomas, parents: [{id: aldric, type: adoptive}, {id: isolde, type: adoptive}], illegitimate: true}\n${MARRIAGE}`).ids).toEqual(['tomas']);
		const withBirth = `${COUPLE}  - {id: gareth, name: Gareth, sex: m}\n  - {id: tomas, name: Tomas, parents: [gareth, {id: aldric, type: adoptive}, {id: isolde, type: adoptive}], placement: adoptive, illegitimate: true}\n${MARRIAGE}`;
		expect(signs(withBirth).ids).toEqual(['tomas']);
	});

	it('placed under a guardian: sign', () => {
		expect(signs(`${COUPLE}  - {id: piers, name: Piers, parents: [{id: aldric, type: ward}], illegitimate: true}\n${MARRIAGE}`).ids).toEqual(['piers']);
	});

	it('a dashed line from one or two birth parents: no sign', () => {
		expect(signs(`${COUPLE}  - {id: wren, name: Wren, parents: [aldric], illegitimate: true}\n${MARRIAGE}`).ids).toEqual([]);
		expect(signs(`${COUPLE}  - {id: elinor, name: Elinor, sex: f}\n  - {id: wren, name: Wren, parents: [aldric, elinor], illegitimate: true}\n${MARRIAGE}`).ids).toEqual([]);
		// In a family with a legitimate child the shared trunk is plain; the child's own drop is dashed.
		expect(signs(`${COUPLE}  - {id: wren, name: Wren, parents: [aldric, isolde], illegitimate: true}\n${MARRIAGE}`).ids).toEqual([]);
	});

	it("an illegitimate parent is not taken as shown by the dashed trunk of their own children", () => {
		const src = `people:\n  - {id: jon, name: Jon, sex: m, illegitimate: true}\n  - {id: kid, name: Kid, parents: [jon], illegitimate: true}\n  - {id: kid2, name: Kid2, parents: [jon], illegitimate: true}\n`;
		const { ids, edges } = signs(src);
		expect(edges.paths.some((p) => p.kind === 'illegitimate' && p.people[0] === 'jon')).toBe(true);
		expect(ids).toEqual(['jon']);
	});

	it('only people marked illegitimate', () => {
		expect(signs(`${COUPLE}  - {id: wren, name: Wren}\n${MARRIAGE}`).ids).toEqual([]);
	});

	it('the sample trees: fixture 4 draws its illegitimate child with a dashed line; none needs the sign', () => {
		for (const f of ['01', '02', '03', '04', '05', '06', '07', '08', '10', '11']) {
			const { g, ids, edges } = signs(fixture(f));
			for (const id of ids) {
				expect(g.byId.get(id)!.illegitimate).toBe(true);
				expect(edges.paths.some((p) => p.kind === 'illegitimate' && p.people[0] === id)).toBe(false);
			}
		}
		expect(signs(fixture('04')).ids).toEqual([]);
	});

	it('the headless renderer draws one sign per person in the set', () => {
		const { g, layout, edges } = signs(`${COUPLE}  - {id: wren, name: Wren, illegitimate: true}\n  - {id: ned, name: Ned, parents: [aldric], illegitimate: true}\n${MARRIAGE}`);
		expect(renderSvg(g, layout, edges).match(/<line /g)?.length).toBe(1);
	});
});

describe('the sign on the card', () => {
	for (const size of ['normal', 'compact'] as const) {
		for (const f of [8, 12, 16, 24, 48]) {
			it(`${size} ${f} px: inside the card, clear of the strip and of the shortened name`, () => {
				const geo = geometryFor(f, size);
				const t = cardText(geo);
				const s = t.sign;
				for (const x of [s.x1, s.x2]) expect(x).toBeGreaterThan(t.padX + t.nameWithSignW);
				expect(s.x1).toBeLessThan(geo.cardW);
				expect(Math.min(s.y1, s.y2)).toBeGreaterThan(0);
				// Above the second text line's capitals.
				expect(Math.max(s.y1, s.y2)).toBeLessThan(t.titleBaseline - 0.7 * t.smallSize);
				expect(t.nameWithSignW).toBeGreaterThan(0.5 * t.textW);
			});
		}
	}
});
