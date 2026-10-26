// G2 of 1a-B (probe), focus 4: a date-only or ended-by-only edit must change the relation word that the view layer hands to the cards.
import { describe, expect, it } from 'vitest';
import { parseDynasty } from '../../src/core/parse';
import { newBlockState } from '../../src/view/block-state';
import { clearRelationCache, relationsFor } from '../../src/view/relation-cache';
import { planRender, type RenderInputs, type TreePlan } from '../../src/view/render-plan';
import { DEFAULT_SETTINGS } from '../../src/view/settings';

const FONTS = { px: 16, text: 'sans-serif', ui: 'sans-serif', bold: '600' };
const text = (born: string, end: string, by: string, ola = '1102') => `options:
  me: pip
people:
  - {id: ned, name: Ned, sex: m, born: '1100', died: '1170'}
  - {id: ola, name: Ola, sex: f, born: '${ola}', died: '1175'}
  - {id: pip, name: Pip, sex: m, born: '${born}', parents: [ned]}
unions:
  - {partners: [ned, ola], start: '1140', end: '${end}'${by ? `, ended-by: ${by}` : ''}}
`;
const plan = (src: string, state = newBlockState()): TreePlan => {
	const inp: RenderInputs = { parsed: parseDynasty(src), settings: DEFAULT_SETTINGS, state, coarse: false, phone: false, full: null, orientation: 'down', pendingTarget: null, stopChecked: false, stopped: () => false, fonts: () => FONTS, clock: () => 0 };
	const { plan: p } = planRender(inp);
	expect(p.kind).toBe('tree');
	return p as TreePlan;
};
const card = (p: TreePlan) => {
	expect(p.relationsFor).toBe('pip');
	return relationsFor(p.whole, p.relationsFor!, undefined, 'note.md\u0000b0').cards.get('ola')?.text;
};

describe('G2 1a-B focus 4: the view layer follows a date-only or ended-by-only edit', () => {
	it('ended-by only', () => {
		clearRelationCache();
		const b = card(plan(text('1130', '1150', 'divorce')));
		const c = card(plan(text('1130', '1150', 'death')));
		expect(new Set([b, c]).size).toBe(2);
	});
	it('a date only (the end year moves past the born year of Pip: step word goes)', () => {
		clearRelationCache();
		const a = card(plan(text('1145', '1150', 'divorce')));
		const b = card(plan(text('1155', '1150', 'divorce')));
		expect(a).not.toBe(b);
	});
	it('a death date only (the fallback)', () => {
		clearRelationCache();
		const a = card(plan(text('1130', '1150', '', '1102')));
		const b = card(plan(text('1130', '1150', '', '1102').replace("died: '1175'", "died: '1145'")));
		expect(a).not.toBe(b);
	});
});
