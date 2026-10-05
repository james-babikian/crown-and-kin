import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { PICTURE_EM, cardText, geometryFor, roomAt } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LaidOut } from '../src/layout/model';
import { buildScene } from '../src/render/dom/scene';
import { DEFAULT_LIGHT, ME_LOOK, ME_RING_INNER } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { FEl, installDom } from './acceptance/fake-dom';

// Review of 0.2.1 area C (proof adopted from the code-reviewer), D96: the arms box on the marked card at note
// font sizes 8 to 48 px. Hard rule: the arms box never overlaps the portrait and never covers the mark's border.
// Soft rule: 1.5 px to the ring, which gives way when both cannot hold. The title text lines the box reaches end before it.
// 0.2.4 (D117): the arms box sits left of the portrait at the lower right, so "never overlaps" is a horizontal gap, not a stack.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string) => [...s].length * 8;
const URI = 'data:image/png;base64,AAAA';
const SOURCE = `houses:
  - {id: v, name: House V, color: "#8b1e3f", arms: "[[v.png]]"}
people:
  - {id: m, name: Me Valmont, house: v, title: Duke of Somewhere, portrait: "[[m.png]]"}
  - {id: o, name: Other Valmont, house: v, title: Duke of Somewhere, portrait: "[[o.png]]"}
  - {id: n, name: No Portrait, house: v, title: Duke of Somewhere}
`;

function graph(): FamilyGraph {
	const r = parseDynasty(SOURCE);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

function lay(g: FamilyGraph, font: number, size: 'normal' | 'compact', relationLine: boolean): LaidOut {
	clearLayoutCache();
	return layoutTree(g, geometryFor(font, size), { ...DEFAULT_LAYOUT_SETTINGS, relationLine, ...pictureSets(g, true) }, 'test');
}

interface Rel {
	y: number;
	h: number;
}
interface Parts {
	arms: Rel & { x: number; w: number };
	portrait: (Rel & { x: number; w: number }) | undefined;
	boxH: number;
	/** Where the drawn title text ends, card-relative (the 8 px per character measure). */
	titleEnd: number | undefined;
}

function scene(g: FamilyGraph, laid: LaidOut, id: string, me: string | undefined): Parts {
	const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...(me ? { me } : {}) });
	const box = laid.layout.persons.get(id)!;
	const mine = s.pictures.filter((p) => p.person === id && p.lod === 'full');
	const rel = (kind: string) => {
		const r = mine.find((p) => p.kind === kind)!.rect;
		return { x: r.x - box.x, y: r.y - box.y, w: r.w, h: r.h };
	};
	const has = (kind: string) => mine.some((p) => p.kind === kind);
	const title = (s.cards.get(id) as unknown as FEl).all().find((e) => e.hasClass('dynasty-card-title'));
	const x = title ? Number(title.getAttribute('x')) - box.x : 0;
	return { arms: rel('arms'), portrait: has('portrait') ? rel('portrait') : undefined, boxH: box.h, titleEnd: title ? x + measure(title.getText()) : undefined };
}

/** The headless drawing of the same card: arms and portrait pictures, and the title text line. */
function headless(g: FamilyGraph, laid: LaidOut, id: string, me: string | undefined): Parts {
	const pictures = new Map<string, string | 'missing' | null>([['arms:v', URI], ['portrait:m', URI], ['portrait:o', URI]]);
	const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure: approxMeasure, fonts: FONTS, pictures, ...(me ? { me } : {}) });
	const box = laid.layout.persons.get(id)!;
	const at = [...laid.layout.persons.keys()].indexOf(id);
	const num = (tag: string, name: string) => Number(new RegExp(` ${name}="([^"]+)"`).exec(tag)![1]);
	const images = [...svg.matchAll(/<image [^>]*>/g)].map((m) => m[0]);
	const rect = (tag: string) => ({ x: num(tag, 'x') - box.x, y: num(tag, 'y') - box.y, w: num(tag, 'width'), h: num(tag, 'height') });
	const t = cardText(laid.layout.geometry, 1);
	const titles = [...svg.matchAll(/<text [^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter((m) => Number(m[1]) === t.smallSize && m[0].includes(DEFAULT_LIGHT.textMuted));
	const first = titles[at];
	const text = first?.[2].replace(/&#?\w+;/g, '…');
	return {
		arms: rect(images.filter((i) => i.includes('meet'))[at]),
		portrait: id === 'n' ? undefined : rect(images.filter((i) => i.includes('slice'))[[...laid.layout.persons.keys()].filter((k) => k !== 'n').indexOf(id)]),
		boxH: box.h,
		titleEnd: first ? t.padX + approxMeasure(text!, `400 ${t.smallSize}px serif`) : undefined,
	};
}

const FONT_SIZES = Array.from({ length: 41 }, (_, i) => 8 + i);
const SIZES = ['normal', 'compact'] as const;
const EPS = 1e-9;

describe.each([['live tree', scene], ['headless picture', headless]] as const)('D96 at small note font sizes (%s)', (_name, draw) => {
	const g = graph();

	it.each(SIZES)('%s card: on the marked card the arms box never overlaps the portrait', (size) => {
		const bad: string[] = [];
		for (const relationLine of [false, true]) {
			for (const font of FONT_SIZES) {
				const laid = lay(g, font, size, relationLine);
				const mine = draw(g, laid, 'm', 'm');
				const gap = mine.portrait!.x - (mine.arms.x + mine.arms.w);
				if (gap < PICTURE_EM.armsGap * font - 1e-6) bad.push(`${font} px${relationLine ? ' relation' : ''}: arms right ${(mine.arms.x + mine.arms.w).toFixed(2)}, portrait left ${mine.portrait!.x.toFixed(2)}`);
				if (Math.abs(mine.arms.y + mine.arms.h - (mine.portrait!.y + mine.portrait!.h)) > EPS) bad.push(`${font} px: the two boxes end at different heights`);
			}
		}
		expect(bad).toEqual([]);
	});

	it.each(SIZES)('%s card: both boxes stay inside the card edge and below the border, and the arms keep 1.5 px to the ring where there is room', (size) => {
		const bad: string[] = [];
		for (const relationLine of [false, true]) {
			for (const font of FONT_SIZES) {
				const m = draw(g, lay(g, font, size, relationLine), 'm', 'm');
				const label = `${font} px${relationLine ? ' relation' : ''}`;
				if (m.arms.y < ME_LOOK.border / 2 - EPS) bad.push(`${label}: arms cover the border`);
				if (m.portrait!.y + m.portrait!.h > m.boxH - ME_LOOK.border / 2 + EPS) bad.push(`${label}: portrait covers the border`);
				// The ring gap holds where there is plenty of room (Normal from 12 px, Compact from 16 px).
				if (font >= (size === 'normal' ? 12 : 16) && m.arms.y - ME_RING_INNER < 1.5 - EPS) bad.push(`${label}: arms gap to the ring ${(m.arms.y - ME_RING_INNER).toFixed(2)}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it.each(SIZES.flatMap((size) => [[size, 'm'], [size, 'n']] as const))('%s card, marked person %s: the title text ends before the arms box when the box reaches its capitals (0.7 em)', (size, id) => {
		const bad: string[] = [];
		let checked = 0;
		for (const font of FONT_SIZES) {
			const laid = lay(g, font, size, false);
			const t = cardText(laid.layout.geometry, 1);
			const capTop = t.titleBaseline - 0.7 * t.smallSize;
			const mine = draw(g, laid, id, id);
			if (mine.arms.y + mine.arms.h <= capTop + EPS) continue;
			checked++;
			if (mine.titleEnd === undefined) bad.push(`${font} px: no title text`);
			else if (mine.titleEnd > mine.arms.x - 0.3 * font + 1e-6) bad.push(`${font} px: title ends at ${mine.titleEnd.toFixed(2)}, arms start at ${mine.arms.x.toFixed(2)}`);
		}
		expect(bad).toEqual([]);
		expect(checked).toBeGreaterThan(size === 'compact' ? 15 : 0);
	});

	it.each(SIZES)('%s card: a card that is not marked is drawn as when no card is marked', (size) => {
		for (const font of [8, 12, 16, 20, 28]) {
			const laid = lay(g, font, size, false);
			expect(draw(g, laid, 'o', 'm')).toEqual(draw(g, laid, 'o', undefined));
		}
	});
});

describe('D96 the text narrowing rule (roomAt)', () => {
	it('with no box nothing narrows a text line', () => {
		const geo = geometryFor(16, 'normal');
		const t = cardText(geo);
		expect(roomAt(geo, t, t.titleBaseline, t.smallSize, [])).toBe(t.textW);
	});

	it('the Compact card at 16 px: the lower-right arms box narrows the title and the dates line that it reaches by the box and 0.3 em, and not the name', () => {
		const laid = lay(graph(), 16, 'compact', false);
		const geo = laid.layout.geometry;
		const t = cardText(geo);
		const m = scene(graph(), laid, 'm', 'm');
		const box = { r: { x: m.arms.x, y: m.arms.y, w: 1, h: m.arms.h }, gap: 0.3 * 16 };
		const w = roomAt(geo, t, t.datesBaseline, t.smallSize, [box]);
		expect(w).toBeCloseTo(m.arms.x - 0.3 * 16 - t.padX, 9);
		expect(w).toBeLessThan(t.textW);
		expect(roomAt(geo, t, t.nameBaseline, t.nameSize, [box])).toBe(t.textW);
	});
});
