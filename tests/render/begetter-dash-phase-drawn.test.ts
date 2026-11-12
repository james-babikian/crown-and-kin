/*
 * D338 point 5, D341 (3): the dash offset of a bundled begetter line (`EdgePath.dashOffset`) reaches every drawing: the saved picture and the headless picture write
 * `stroke-dashoffset`, the scene writes the same attribute on the path, and the finder's line look keeps it on a whole line. A line with no offset has no attribute.
 */
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { buildScene } from '../../src/render/dom/scene';
import { lineLook } from '../../src/render/line-highlight';
import { DEFAULT_DARK } from '../../src/render/styles';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { allFixtures } from '../acceptance/load';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const f20 = allFixtures().find((x) => x.id === '20')!;
const parsed = parseDynasty(f20.source);
if (!parsed.ok) throw new Error('sample 20 does not parse');
const g = deriveFamilies(parsed.tree);
clearLayoutCache();
const laid = layoutTree(g, cardForm(geometryFor(16), 'down'), DEFAULT_LAYOUT_SETTINGS, 'font');
const offsets = laid.edges.paths.filter((p) => p.dashOffset !== undefined).map((p) => [p.child, p.dashOffset]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('the dash offset of a begetter line, drawn', () => {
	it('sample tree 20 has an offset on two of the three lines of Oswin and on no other line', () => {
		expect(offsets.map(([c]) => c).sort()).toEqual(['ivo', 'linnet']);
	});

	it('the headless picture writes stroke-dashoffset after the cap on those two lines, in both palettes, and nowhere else', () => {
		for (const palette of [undefined, DEFAULT_DARK]) {
			const svg = renderSvg(g, laid.layout, laid.edges, { measure: approxMeasure, fonts: FONTS, ...(palette ? { palette } : {}) });
			const found = svg.match(/<path [^>]*stroke-dashoffset="[^"]+"[^>]*\/>/g) ?? [];
			expect(found).toHaveLength(2);
			for (const p of found) expect(p).toMatch(/stroke-dasharray="14 3 2 3" stroke-linecap="round" stroke-dashoffset="\d+(\.\d)?"/);
			expect((svg.match(/stroke-dashoffset/g) ?? []).length).toBe(2);
		}
	});

	it('the scene writes the same attribute on the path of the line', () => {
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure: (s: string) => s.length * 7, link: () => null });
		const lines = all(root).filter((e) => e.hasClass('dynasty-line-begetter'));
		expect(lines).toHaveLength(5);
		const want = new Map(offsets.map(([c, o]) => [laid.edges.paths.find((p) => p.child === c && p.kind === 'begetter')!.d, String(o)]));
		expect(lines.filter((e) => e.getAttribute('stroke-dashoffset') !== null)).toHaveLength(2);
		for (const e of lines) expect(e.getAttribute('stroke-dashoffset') ?? undefined).toBe(want.get(e.getAttribute('d')!));
	});

	it('the finder line look keeps the offset on a whole line, on and off the line, and adds none to another line', () => {
		const plain = lineLook(g, laid.layout, laid.edges);
		expect(plain.paths.filter((p) => p.dashOffset !== undefined)).toHaveLength(2);
		const ivo = `oswin\0ivo`;
		const marked = lineLook(g, laid.layout, laid.edges, { people: new Set(['oswin', 'ivo']), unions: new Set(), links: new Set([ivo]), fade: true });
		const withOffset = marked.paths.filter((p) => p.dashOffset !== undefined);
		expect(withOffset).toHaveLength(2);
		expect(withOffset.map((p) => p.state).sort()).toEqual(['faded', 'on']);
		expect(marked.paths.filter((p) => p.kind !== 'begetter' && p.dashOffset !== undefined)).toEqual([]);
	});
});
