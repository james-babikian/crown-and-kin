/*
 * 0.2.8 P4 fix round: the rule of "Arms on cards" (contract A.4 and G.16, D206): `armsCardIds` reads only the graph. The first of a house, every holder of a
 * title and the personal arms show; a partnership has no effect. Also the use of the rule by the layout.
 */
import { describe, expect, it } from 'vitest';
import { armsCardIds } from '../../src/core/arms-rule';
import { drawnParents } from '../../src/core/derive';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { build, fixture } from '../support/helpers';

const SRC = `houses:
  - {id: valmont, name: Valmont, arms: "[[v.png]]"}
  - {id: orsini, name: Orsini, arms: "[[o.png]]"}
  - {id: calvera, name: Calvera, arms: "[[c.png]]"}
people:
  - {id: aldric, name: Aldric, sex: m, house: valmont}
  - {id: isolde, name: Isolde, sex: f, house: orsini}
  - {id: roderick, name: Roderick, sex: m, house: valmont, parents: [aldric, isolde]}
  - {id: mira, name: Mira, sex: f, house: orsini, parents: [aldric, isolde]}
  - {id: hugo, name: Hugo, sex: m, house: calvera, parents: [roderick]}
  - {id: tomas, name: Tomas, sex: m, house: valmont, parents: [{id: roderick, type: adoptive}]}
  - {id: wren, name: Wren, sex: f, house: valmont, parents: [{id: roderick, type: rumoured}]}
  - {id: ward, name: Ward, sex: m, house: valmont, parents: [{id: roderick, type: ward}]}
  - {id: ghost, name: Ghost, sex: m, house: valmont, parents: [nobody]}
  - {id: ottavio, name: Ottavio, sex: m, house: orsini}
  - {id: lena, name: Lena, sex: f, house: orsini, parents: [ottavio]}
  - {id: karl, name: Karl, sex: m, house: valmont, parents: [aldric]}
  - {id: noble, name: Noble, sex: m}
  - {id: plain, name: Plain, sex: m}
  - {id: styled, name: Styled, sex: m, house: valmont, title: Duke of Valmont, parents: [aldric]}
  - {id: held, name: Held, sex: m, house: valmont, parents: [aldric]}
  - {id: isolde-lone, name: Isolde Lone, sex: f, house: orsini}
  - {id: isolde-kin, name: Isolde Kin, sex: f, house: orsini, parents: [ottavio]}
unions:
  - {partners: [aldric, isolde]}
  - {partners: [karl, lena]}
  - {partners: [aldric, isolde-lone]}
  - {partners: [karl, isolde-kin]}
titles:
  - id: duke
    name: Duke of Valmont
    holders:
      - {person: hugo}
      - {person: held}
`;

const ids = (s: Set<string>) => [...s].sort();

/** The graph of `src`, with personal arms set on Noble by hand: the parser reads the key `arms` of a person only after P2 (contract A.1). */
function graphWithPersonal(src: string) {
	const built = build(src);
	built.g.byId.get('noble')!.arms = '[[n.png]]';
	return built;
}

describe('armsCardIds, setting "few" (D206 cases)', () => {
	const { g } = graphWithPersonal(SRC);
	const few = armsCardIds(g, 'few');

	it('Aldric, the first of House Valmont with no parents, shows', () => expect(few.has('aldric')).toBe(true));
	it('Isolde, of another house with no parents, shows (her partner is Aldric Valmont)', () => expect(few.has('isolde')).toBe(true));
	it('Isolde Kin, married to Karl Valmont, with a parent of her own house in the tree, is hidden', () => expect(few.has('isolde-kin')).toBe(false));
	it('Isolde Lone, married to Aldric Valmont, with no parents, shows', () => expect(few.has('isolde-lone')).toBe(true));
	it('Roderick (parents of his own house, Aldric) is hidden', () => expect(few.has('roderick')).toBe(false));
	it('Mira (a parent of her own house, Isolde) is hidden', () => expect(few.has('mira')).toBe(false));
	it('Lena (a parent of her own house) is hidden, though she is married to a Valmont', () => expect(few.has('lena')).toBe(false));
	it('Hugo (Valmont parent, house Calvera: a cadet founder) shows', () => expect(few.has('hugo')).toBe(true));
	it('Tomas (an adoptive parent of the same house) is hidden', () => expect(few.has('tomas')).toBe(false));
	it('Wren (only a rumoured parent) shows', () => expect(few.has('wren')).toBe(true));
	it('a person with only a ward parent of the same house shows (a ward parent does not count)', () => expect(few.has('ward')).toBe(true));
	it('a person whose parent id names nobody shows', () => expect(few.has('ghost')).toBe(true));
	it('a holder in the list of a title shows, though a parent has the same house', () => expect(few.has('held')).toBe(true));
	it('a person with only a free `title` text and a parent of the same house is hidden', () => {
		expect(g.byId.get('styled')!.title).toBe('Duke of Valmont');
		expect(few.has('styled')).toBe(false);
	});
	it('a person with no house and personal arms shows (the personal arms)', () => expect(few.has('noble')).toBe(true));
	it('a person with no house and no arms is not in the set', () => expect(few.has('plain')).toBe(false));
	it('a partnership has no effect: the set is the same without the unions', () => {
		const alone = graphWithPersonal(SRC.replace(/unions:[\s\S]*?titles:/, 'titles:')).g;
		expect(ids(armsCardIds(alone, 'few'))).toEqual(ids(few));
	});
	it('personal arms show whatever the mode says, and "all" adds every person with a house', () => {
		expect(armsCardIds(g, 'all').has('noble')).toBe(true);
		expect(armsCardIds(g, 'all').has('roderick')).toBe(true);
		expect(armsCardIds(g, 'all').has('plain')).toBe(false);
	});
});

describe('armsCardIds on sample tree 07b', () => {
	const { g } = build(fixture('07b'));
	const few = armsCardIds(g, 'few');
	const holders = g.titles.flatMap((t) => t.holders.map((h) => h.person)).filter((id): id is string => id !== undefined);

	it('Wendel Castellane (a parent of his house) and Viviane Drakemoor (a parent of her house) are hidden', () => {
		expect(few.has('wendel-castellane')).toBe(false);
		expect(few.has('viviane-drakemoor')).toBe(false);
	});
	it('Godric Castellane, the first of his house, shows; his daughter Perrine has a parent of the same house and holds no title in this tree: hidden', () => {
		expect(few.has('godric-castellane')).toBe(true);
		expect(holders).not.toContain('perrine-castellane');
		expect(few.has('perrine-castellane')).toBe(false);
	});
	it('every holder of a title shows, also a holder with a parent of the same house', () => {
		expect(holders.length).toBeGreaterThan(10);
		for (const id of holders) expect(few.has(id), id).toBe(true);
		const withKin = holders.filter((id) => drawnParents(g, id).some((q) => q.type === 'birth' && g.byId.get(q.id)?.house === g.byId.get(id)?.house));
		expect(withKin.length).toBeGreaterThan(0);
	});
});

describe('the layout flags the cards by the rule', () => {
	const { g } = graphWithPersonal(SRC);
	const geo = cardForm(geometryFor(16), 'down');
	const flagged = (extra: object) => {
		clearLayoutCache();
		const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['valmont', 'orsini', 'calvera'], personalArms: ['noble'], ...extra }, 'test');
		return [...laid.layout.persons.values()].filter((b) => b.arms).map((b) => b.id).sort();
	};

	it('"few": the people of the rule, with arms to show', () => {
		const rule = armsCardIds(g, 'few');
		expect(flagged({ armsOnCards: 'few' })).toEqual(ids(new Set([...rule].filter((id) => id !== 'plain'))));
	});

	it('"all": every person with a house, and the personal arms', () => {
		expect(flagged({ armsOnCards: 'all' })).toEqual(ids(new Set(g.people.filter((p) => p.house !== undefined || p.id === 'noble').map((p) => p.id))));
	});

	it('with no setting the 0.2.7 rule stands (every person of a house in `arms`), plus the personal arms', () => {
		expect(flagged({})).toEqual(ids(new Set(g.people.filter((p) => p.house !== undefined || p.id === 'noble').map((p) => p.id))));
	});

	it('the setting and the personal arms are part of the cache key; a change of holder is too', () => {
		clearLayoutCache();
		const a = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['valmont'], armsOnCards: 'few' }, 'test');
		const b = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['valmont'], armsOnCards: 'all' }, 'test');
		expect(a).not.toBe(b);
		const other = build(SRC.replace('{person: hugo}', '{person: tomas}')).g;
		expect(layoutTree(other, geo, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['valmont'], armsOnCards: 'few' }, 'test')).not.toBe(a);
	});
});
