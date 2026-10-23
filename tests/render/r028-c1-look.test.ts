/*
 * 0.2.8 package C1 (D212 proposals, D213 and D214 amendments): the look of cards and lines. One test group for each proposal that this package builds:
 * the gap round the arms (D219: it follows the outline of the picture), the "You" tab at the distance of the ordinal tab, the 2 px "You" border, the single accent outline of an heir, the edge of the
 * far-couple tag in the line colour, the text block centred under the ribbon or the portrait, and the grey of card text from the plugin's own token.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { ORDINAL_EM, ROUNDEL_EM, cardForm, cardText, centredWithoutWord, drawnGeometry, geometryFor, ordinalTabRect, relationExtra, ribbonWidth, roundelAxis, roundelPics, youTabRect } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../../src/layout/model';
import { armsGap } from '../../src/layout/arms-outline';
import { buildScene } from '../../src/render/dom/scene';
import { ARMS_GAP_CLASS, setArmsGap, setPicture } from '../../src/render/dom/pictures';
import { DEFAULT_LIGHT, HEIR_LOOK, ME_LOOK } from '../../src/render/styles';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const css = readFileSync('styles.css', 'utf8');
const rule = (sel: string): string => {
	const i = css.indexOf(`\n${sel} {`);
	expect(i, sel).toBeGreaterThanOrEqual(0);
	return css.slice(i, css.indexOf('}', i));
};

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100, portrait: "[[a.png]]"}',
	'  - {id: b, name: Bertram, parents: [a], born: 1130}',
	'  - {id: c, name: Cedric, parents: [a], born: 1131, portrait: "[[c.png]]"}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;
const ROUNDEL = cardForm(geometryFor(16), 'down');

function lay(over: Partial<LayoutSettings> = {}): LaidOut {
	clearLayoutCache();
	return layoutTree(g, ROUNDEL, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
}
const sceneOf = (laid: LaidOut, extra: object = {}) => {
	const root = new FEl('g');
	const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...extra });
	return { root, scene };
};
const card = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
const num = (el: FEl, k: string) => Number(el.getAttribute(k));

const roundel = (f: number, o: Partial<LayoutSettings> = {}): Geometry => drawnGeometry(cardForm(geometryFor(f), 'down'), { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 }, ...o });
const SIZES = [8, 10, 12, 14, 16, 20, 24, 36, 48];

describe('D219: the gap round the arms follows the outline of the picture', () => {
	const OUTLINE = { w: 100, h: 120, d: 'M0 0L100 0L100 60L50 120L0 60Z' };

	it('the scene makes no patch and no gap until the picture and its outline are in the slot; the slot knows the gap width (0.2 em)', () => {
		const laid = lay({ armsOnCards: 'all' });
		const { root, scene } = sceneOf(laid);
		const slot = scene.pictures.find((s) => s.kind === 'arms' && s.person === 'a' && s.lod === 'full')!;
		expect(slot.gap).toBeCloseTo(ROUNDEL_EM.halo * 16, 9);
		const group = all(card(root, 'a')).find((e) => e.hasClass('dynasty-arms'))!;
		expect(group.children).toHaveLength(0);
		expect(css).not.toContain('dynasty-arms-patch');
	});

	it('setArmsGap puts one path under the picture, placed by a transform; again it only changes; with null or without the picture it is gone', () => {
		const laid = lay({ armsOnCards: 'all' });
		const { root, scene } = sceneOf(laid);
		const slot = scene.pictures.find((s) => s.kind === 'arms' && s.person === 'a' && s.lod === 'full')!;
		const group = all(card(root, 'a')).find((e) => e.hasClass('dynasty-arms'))!;
		setPicture(slot, 'blob:x');
		setArmsGap(slot, OUTLINE);
		expect(group.children.map((c) => c.tag)).toEqual(['path', 'image']);
		const gap = group.children[0]!;
		expect(gap.hasClass(ARMS_GAP_CLASS)).toBe(true);
		const want = armsGap(OUTLINE, slot.rect, slot.gap!);
		expect(gap.getAttribute('d')).toBe(want.d);
		expect(gap.getAttribute('transform')).toBeNull();
		expect(Number(gap.getAttribute('stroke-width'))).toBeCloseTo(want.strokeWidth, 9);
		const other = { ...OUTLINE, d: 'M0 0L9 0L9 9Z' };
		setArmsGap(slot, other);
		expect(group.children).toHaveLength(2);
		expect(gap.getAttribute('d')).toBe(armsGap(other, slot.rect, slot.gap!).d);
		setArmsGap(slot, null);
		expect(group.children.map((c) => c.tag)).toEqual(['image']);
		setArmsGap(slot, OUTLINE);
		setPicture(slot, null);
		expect(group.children).toHaveLength(0);
	});

	it('a portrait slot never gets a gap path (its gap is the halo circle)', () => {
		const laid = lay({ armsOnCards: 'all' });
		const { scene } = sceneOf(laid);
		const slot = scene.pictures.find((s) => s.kind === 'portrait' && s.person === 'a')!;
		setArmsGap(slot, OUTLINE);
		expect((slot.el as unknown as FEl).children.some((e) => e.hasClass(ARMS_GAP_CLASS))).toBe(false);
	});

	it('the style fills and strokes the gap in the colour of the page, with round joins and the even-odd rule; the width comes from the attribute', () => {
		const r = rule('.dynasty-arms-gap');
		expect(r).toContain('fill: var(--background-primary);');
		expect(r).toContain('stroke: var(--background-primary);');
		expect(r).toContain('stroke-linejoin: round;');
		expect(r).toContain('fill-rule: evenodd;');
		expect(r).not.toContain('stroke-width');
	});

	it('the saved picture draws the same path with the same stroke before the picture; with no outline it draws no gap', () => {
		const laid = lay({ armsOnCards: 'all' });
		const saved = { heading: 'T', legend: { kinds: [], sign: false, houses: [] }, pictures: new Map([['arms:v', PNG_URI]]), scale: 1 };
		const box = laid.layout.persons.get('a')!;
		const rp = roundelPics(laid.layout.geometry, { arms: true, portrait: true });
		const rect = { x: box.x + rp.arms!.x, y: box.y + rp.arms!.y, w: rp.arms!.w, h: rp.arms!.h };
		const want = armsGap(OUTLINE, rect, ROUNDEL_EM.halo * 16);
		const withGap = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS, saved, outlines: new Map([['arms:v', OUTLINE]]) });
		const path = `<path d="${want.d}" fill="${DEFAULT_LIGHT.background}" stroke="${DEFAULT_LIGHT.background}" stroke-width="${want.strokeWidth}" stroke-linejoin="round" fill-rule="evenodd"/>`;
		expect(withGap).toContain(path);
		expect(withGap.indexOf(path)).toBeLessThan(withGap.indexOf(`<image href="${PNG_URI}" x="${rect.x}"`));
		const without = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS, saved });
		expect(without).not.toContain('fill-rule="evenodd"');
		// An outline for arms whose picture did not come draws nothing either.
		const noPicture = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS, saved: { ...saved, pictures: new Map() }, outlines: new Map([['arms:v', OUTLINE]]) });
		expect(noPicture).not.toContain('fill-rule="evenodd"');
	});
});

describe('d213-you-tab: the "You" tab keeps the distance of the ordinal tab from the picture', () => {
	it('its right edge is the right edge of the ordinal tab for each picture kind (1.9 em portrait, 1.75 em arms alone, 0.4 em none), at every font', () => {
		for (const f of SIZES) {
			const g1 = roundel(f, { portraits: ['p'], arms: ['h'], youTab: 'me' });
			for (const [portrait, arms, em] of [
				[true, false, ORDINAL_EM.rightPortrait],
				[true, true, ORDINAL_EM.rightPortrait],
				[false, true, ORDINAL_EM.rightArms],
				[false, false, ORDINAL_EM.rightNone],
			] as const) {
				const you = youTabRect(g1, portrait, arms);
				const ord = ordinalTabRect(g1, portrait, arms, 3);
				expect(you.x + you.w, `f${f} ${portrait}/${arms}`).toBeCloseTo(roundelAxis(g1) - em * f, 9);
				// The "You" tab is as wide as a 3-character ordinal tab, so the two tabs are one shape at one place.
				expect(you).toEqual({ x: ord.x, y: ord.y, w: ord.w, h: ord.h });
			}
		}
	});

	it('the gap to the halo of the portrait is 0.55 em (it was 0.1 em)', () => {
		for (const f of SIZES) {
			const g1 = roundel(f, { portraits: ['p'], youTab: 'me' });
			const rp = roundelPics(g1, { arms: false, portrait: true });
			const you = youTabRect(g1, true);
			expect(rp.cx - rp.haloR - (you.x + you.w), `f${f}`).toBeCloseTo(0.55 * f, 9);
		}
	});

	it('the narrowest card: the left end of the tab stays on the straight part of the top edge, whose corner radius is at most 1.5 em (portrait, arms alone, no picture)', () => {
		for (const f of SIZES) {
			const g1 = roundel(f, { portraits: ['p'], youTab: 'me' });
			for (const [portrait, arms] of [[true, false], [false, true], [false, false]] as const) {
				const you = youTabRect(g1, portrait, arms);
				// 0.2.8: the axis moved 0.25 em to the middle, so the left end is 1.425 em from the edge. A corner of the largest radius (1.5 em) is 0.0019 em off the straight edge there.
				expect(you.x, `f${f} ${portrait}/${arms}`).toBeGreaterThanOrEqual(1.4 * f);
				expect(you.x + you.w, 'not right of the middle of the card').toBeLessThanOrEqual(g1.cardW / 2);
			}
		}
	});

	it('the scene draws the tab and its tap area at the new place', () => {
		const laid = lay({ youTab: 'c', armsOnCards: 'all' });
		const { root } = sceneOf(laid, { me: 'c' });
		const c = card(root, 'c');
		const box = laid.layout.persons.get('c')!;
		const want = youTabRect(laid.layout.geometry, true, true);
		const tab = all(c).find((e) => e.hasClass('dynasty-r1-tab'))!;
		expect([num(tab, 'x'), num(tab, 'y'), num(tab, 'width')]).toEqual([box.x + want.x, box.y + want.y, want.w]);
		// A portrait with arms is a portrait: the tab stands left of the halo, and the tap area reaches its left end.
		const hit = all(c).find((e) => e.hasClass('dynasty-card-crown-hit'))!;
		expect(num(hit, 'x')).toBeLessThanOrEqual(box.x + want.x);
	});
});

describe('you-border: the marked card has a 2 px border in the text colour', () => {
	it('ME_LOOK, the CSS rule and the focus rule say 2; the Overview level keeps its 3 px non-scaling border so the card stays findable', () => {
		expect(ME_LOOK.border).toBe(2);
		expect(rule('.dynasty-card-me .dynasty-card-bg')).toContain('stroke-width: 2;');
		expect(rule('.dynasty-card-me:focus-visible .dynasty-card-bg')).toContain('stroke-width: 2;');
		expect(rule('.dynasty-lod-overview .dynasty-card-me .dynasty-card-bg')).toContain('stroke-width: 3;');
	});

	it('the inner ring of the mark (the inset of the ribbon and the foot line) is 1 px', () => {
		const laid = lay({ youTab: 'c' });
		const { root } = sceneOf(laid, { me: 'c' });
		const box = laid.layout.persons.get('c')!;
		const foot = all(card(root, 'c')).find((e) => e.hasClass('dynasty-card-foot-line'));
		// No relation words in this scene, so no foot line: the check is on the ribbon, which starts 1 px inside the card (half of the 2 px border).
		expect(foot).toBeUndefined();
		const ribbon = all(card(root, 'c')).find((e) => e.hasClass('dynasty-card-ribbon'))!;
		expect(Number(/^M[\d.]+ ([\d.]+)/.exec(ribbon.getAttribute('d')!)![1])).toBe(box.y + 1);
	});
});

describe('heir-outline: one accent outline, no second ring', () => {
	it('the scene makes no ring rect for an heir; the style gives the heir bg a 2 px accent border', () => {
		const laid = lay({ ordinalCards: ['b'] });
		const { root } = sceneOf(laid, { heirs: ['b'], ordinals: new Map([['b', '1st']]) });
		expect(all(root).filter((e) => e.hasClass('dynasty-heir-ring'))).toHaveLength(0);
		expect(card(root, 'b').hasClass('dynasty-heir')).toBe(true);
		expect(HEIR_LOOK.border).toBe(2);
		expect(rule('.dynasty-card.dynasty-heir .dynasty-card-bg')).toContain('stroke-width: 2;');
	});
});

describe('tag-edge: the far-couple tag edge is in the line colour', () => {
	it('the CSS pill edge is the plugin line token, with the theme grey as its fallback; hover and the finder line keep the accent', () => {
		expect(rule('.dynasty-tag-pill')).toContain('stroke: var(--dynasty-edge, var(--text-muted));');
		expect(rule('.dynasty-tag.dynasty-on-line .dynasty-tag-pill')).toContain('var(--interactive-accent)');
	});

	it('the saved picture draws the pill edge in the line colour of the palette, not the card border', () => {
		// The partnership of two children of one couple is far from their parents, so it gets a tag (as in the 0.2.2 tag test).
		const far = build(
			[
				'people:',
				'  - {id: a, name: A}',
				'  - {id: b, name: B}',
				'  - {id: x, name: Xavier, parents: [a, b]}',
				'  - {id: y, name: Y, parents: [a, b]}',
				'  - {id: z, name: Zelda, parents: [a, b]}',
				'unions:',
				'  - partners: [a, b]',
				'  - {partners: [x, z], type: marriage}',
				'',
			].join('\n'),
		).g;
		clearLayoutCache();
		const laid = layoutTree(far, geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS, far: { maxCardWidths: 1.5, maxGenerations: 1 } }, 'far');
		const svg = renderSvg(far, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
		expect(laid.layout.farTags.size).toBeGreaterThan(0);
		const pill = /<rect [^>]*rx="[\d.]+" fill="#fafafa" stroke="([^"]+)" stroke-width="1"\/>\n<text [^>]*>⚭/.exec(svg);
		expect(pill?.[1]).toBe(DEFAULT_LIGHT.line);
		expect(DEFAULT_LIGHT.line).not.toBe(DEFAULT_LIGHT.cardBorder);
	});
});

describe('card-text-centre: the text block is centred between the ribbon (or the portrait) and the foot line', () => {
	/** The gap between the top of the room and the first text line, and between the last text line and the bottom of the room (line boxes). */
	function gaps(geo: Geometry, lead: number, plate: boolean, word: boolean) {
		let t = cardText(geo, 1, false, { title: false, dates: true });
		if (plate && !word) t = centredWithoutWord(geo, t);
		const first = t.nameBaseline - 0.35 * t.nameSize - (1.2 * t.nameSize) / 2;
		const last = t.datesBaseline - 0.35 * t.smallSize + 0.6 * t.smallSize;
		const bottom = plate && word ? geo.cardH - relationExtra(geo) - 0.25 * geo.fontPx : geo.cardH;
		return { above: first - lead, below: bottom - last };
	}

	it("the owner's case: no portrait, no relation word, no house, in a tree with relation words: equal gaps from the ribbon to the card's bottom edge", () => {
		for (const f of SIZES) {
			const geo = roundel(f, { relationLine: true });
			const { above, below } = gaps(geo, ribbonWidth(geometryFor(f)), true, false);
			expect(above, `f${f}`).toBeCloseTo(below, 6);
			expect(above).toBeGreaterThan(0);
		}
	});

	it('a card with a relation word: equal gaps from the ribbon to the foot line (no pictures) and from the halo to the foot line (portraits)', () => {
		for (const f of SIZES) {
			const none = gaps(roundel(f, { relationLine: true }), ribbonWidth(geometryFor(f)), true, true);
			expect(none.above, `f${f} none`).toBeCloseTo(none.below, 6);
			const withPortrait = roundel(f, { relationLine: true, portraits: ['p'] });
			const p = gaps(withPortrait, withPortrait.textTop!, true, true);
			expect(p.above, `f${f} portrait`).toBeCloseTo(p.below, 6);
			expect(withPortrait.textTop, `f${f}`).toBe(Math.round(1.1 * f));
		}
	});

	it('the scene puts the first name line where cardText says, so the live card and the saved picture agree', () => {
		const laid = lay({ relationLine: true });
		const { root } = sceneOf(laid, { relations: new Map([['b', { text: 'Half-brother', lower: 'half-brother' }]]) });
		const geo = laid.layout.geometry;
		const b = laid.layout.persons.get('b')!;
		const name = all(card(root, 'b')).find((e) => e.hasClass('dynasty-card-name'))!;
		const t = cardText(geo, 1, false, { title: false, dates: true });
		expect(num(name, 'y')).toBeCloseTo(b.y + t.nameBaseline, 6);
		expect(geo.textTop).toBe(Math.round(1.1 * 16));
	});

	it('the text card (sideways) keeps its centring: the ribbon is at the left edge, so nothing moves', () => {
		const geo = drawnGeometry(cardForm(geometryFor(16), 'sideways'), { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 }, orientation: 'sideways', relationLine: true, portraits: ['p'] });
		expect(geo.textTop).toBeUndefined();
		const t = cardText(geo, 1, false, { title: false, dates: true });
		const first = t.nameBaseline - 0.35 * t.nameSize - (1.2 * t.nameSize) / 2;
		const last = t.datesBaseline - 0.35 * t.smallSize + 0.6 * t.smallSize;
		expect(first).toBeCloseTo(geo.cardH - relationExtra(geo) - 0.25 * 16 - last, 6);
	});
});

describe('contrast-tokens (cards): grey card text uses the plugin grey', () => {
	it('title, dates and the name of a dead person use --dynasty-muted, with the theme grey as the fallback', () => {
		const want = 'fill: var(--dynasty-muted, var(--text-muted));';
		expect(rule('.dynasty-card-title')).toContain(want);
		expect(rule('.dynasty-card-dates')).toContain(want);
		expect(rule('.dynasty-deceased .dynasty-card-name,\n.dynasty-deceased .dynasty-card-compact')).toContain(want);
		expect(rule('.dynasty-card-relation')).toContain(want);
		expect(rule('.dynasty-tag-text')).toContain(want);
	});
});
