/*
 * D343 1 C: a side-link curve routed between the cards (`src/layout/side-route.ts`) reaches every drawing as the layout wrote it: the saved picture and the
 * headless picture write its path, the scene draws it, the finder's line look keeps it whole and turns it and its "?" on, and a sideways tree carries the
 * same route turned. Sample tree 12: Harold's rumoured line to Wynn and the ward lines of Alan to Pim and of Leo to Cai are routed.
 */
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { buildScene } from '../../src/render/dom/scene';
import { lineLook } from '../../src/render/line-highlight';
import { DEFAULT_DARK } from '../../src/render/styles';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { allFixtures } from '../acceptance/load';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const parsed = parseDynasty(allFixtures().find((x) => x.id === '12')!.source);
if (!parsed.ok) throw new Error('sample 12 does not parse');
const g = deriveFamilies(parsed.tree);
const idOf = (name: string) => [...g.byId.values()].find((p) => p.name === name)!.id;
const laidOut = (dir: 'down' | 'sideways', far = DEFAULT_LAYOUT_SETTINGS.far) => {
	clearLayoutCache();
	return layoutTree(g, cardForm(geometryFor(16), dir), { ...DEFAULT_LAYOUT_SETTINGS, far }, 'font');
};
const laid = laidOut('down');
/** A routed path has more than one curve command. */
const routed = laid.edges.paths.filter((p) => p.child !== undefined && (p.d.match(/C/g) ?? []).length > 1);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('a side link routed between the cards, drawn', () => {
	// D343 1 C: the test of a plain curve for cards reads the whole curve (flat chords), not 41 points of it: Leo's ward line to Cai cuts a corner of
	// Bryn's card between two of those points, so it is routed too.
	it('sample tree 12 has three routed side links: the rumoured line to Wynn and the ward lines to Pim and Cai', () => {
		expect(routed.map((p) => [p.kind, g.byId.get(p.child!)!.name]).sort()).toEqual([
			['rumoured', 'Wynn'],
			['ward', 'Cai'],
			['ward', 'Pim'],
		]);
	});

	it('the saved picture writes each routed path as the layout wrote it, in both palettes', () => {
		for (const palette of [undefined, DEFAULT_DARK]) {
			const svg = renderSvg(g, laid.layout, laid.edges, { measure: approxMeasure, fonts: FONTS, ...(palette ? { palette } : {}) });
			for (const p of routed) expect(svg).toContain(`d="${p.d}"`);
		}
	});

	it('the scene draws each routed path', () => {
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure: (t: string) => t.length * 7, link: () => null });
		const ds = all(root).map((e) => e.getAttribute('d'));
		for (const p of routed) expect(ds).toContain(p.d);
	});

	it('the finder\'s line look keeps a routed line whole and turns it and its "?" on', () => {
		const harold = idOf('Harold');
		const wynn = idOf('Wynn');
		const look = lineLook(g, laid.layout, laid.edges, { people: new Set([harold, wynn]), unions: new Set(), links: new Set([`${harold}\0${wynn}`]) });
		const rumour = routed.find((p) => p.kind === 'rumoured')!;
		expect(look.paths.filter((p) => p.d === rumour.d).map((p) => p.state)).toEqual(['on']);
		const marks = laid.edges.markers.map((m, i) => [m.kind, look.markers[i]]).filter(([k]) => k === 'rumour');
		expect(marks).toEqual([['rumour', 'on']]);
	});

	it('the sideways tree and the finder\'s small tree (never far) route the same links', () => {
		for (const t of [laidOut('sideways'), laidOut('down', NEVER_FAR_RULE)]) {
			const kids = t.edges.paths.filter((p) => p.child !== undefined && (p.d.match(/C/g) ?? []).length > 1).map((p) => g.byId.get(p.child!)!.name);
			expect(kids).toEqual(expect.arrayContaining(['Wynn', 'Pim']));
		}
	});
});
