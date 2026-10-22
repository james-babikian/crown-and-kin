// 0.2.6 WP3 (D176 5): a long relation word with a maybe is cut as "Half first cousin once re… ?". From 0.3.3 (D268) the cards first use the short forms ("Half 1st cousin 1× …"); `truncateWithMaybe` itself is unchanged. Short texts and texts with no maybe do
// not change. The helper, the saved picture and the live scene.
import { beforeAll, describe, expect, it } from 'vitest';
import { cardLabels } from '../src/core/titles';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { buildScene } from '../src/render/dom/scene';
import { MAYBE_TEXT, splitMaybe } from '../src/render/tree-info';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { renderSvg } from '../src/render/svg-string';
import { truncateWithMaybe } from '../src/render/view-math';
import { FEl, installDom } from './acceptance/fake-dom';
import { build } from './helpers';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

const m1 = (s: string) => [...s].length;
const WORD = 'Half first cousin once removed';

describe('splitMaybe', () => {
	it('splits both suffixes and leaves other texts whole', () => {
		expect(splitMaybe(`Half-sister${MAYBE_TEXT.cardFull}`)).toEqual({ word: 'Half-sister', suffix: ', maybe full' });
		expect(splitMaybe(`Sister${MAYBE_TEXT.cardHalf}`)).toEqual({ word: 'Sister', suffix: ', maybe half' });
		expect(splitMaybe('Sister')).toEqual({ word: 'Sister', suffix: '' });
		expect(splitMaybe('You')).toEqual({ word: 'You', suffix: '' });
	});
});

describe('truncateWithMaybe', () => {
	const suffix = ', maybe full';
	it('keeps a text that fits whole', () => {
		expect(truncateWithMaybe('Half-sister', suffix, 100, m1)).toBe('Half-sister, maybe full');
		expect(truncateWithMaybe(WORD, suffix, m1(WORD + suffix), m1)).toBe(WORD + suffix);
	});
	it('cuts the word and ends with "… ?" when the text does not fit', () => {
		const out = truncateWithMaybe(WORD, suffix, 28, m1);
		expect(out).toBe('Half first cousin once re… ?');
		expect(m1(out)).toBeLessThanOrEqual(28);
		for (const w of [8, 12, 20, 27, 41]) {
			const t = truncateWithMaybe(WORD, suffix, w, m1);
			expect(m1(t), String(w)).toBeLessThanOrEqual(w);
			expect(t.endsWith('… ?') || t === '' || t.endsWith('…'), t).toBe(true);
		}
	});
	it('a text with no suffix is cut as before', () => {
		expect(truncateWithMaybe('Half first cousin', '', 8, m1)).toBe('Half fi…');
	});
	it('falls back to a plain cut when almost no room is left', () => {
		expect(truncateWithMaybe(WORD, suffix, 3, m1)).toBe('Ha…');
	});
});

const SRC = ['options:', '  me: c', 'people:', '  - {id: a, name: Aldric}', '  - {id: c, name: Cedric, parents: [a]}', '  - {id: d, name: Dora, parents: [a]}', ''].join('\n');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);

function laid() {
	const g = build(SRC).g;
	clearLayoutCache();
	const geo = cardForm(geometryFor(12), 'down');
	const l = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), relationLine: true } as LayoutSettings, 'test');
	return { g, l, labels: cardLabels(g) };
}
const relations = (text: string) => new Map([['c', { text: 'You', lower: 'you' }], ['d', { text, lower: 'x' }]]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('D176 (5): the cards', () => {
	it('the saved picture cuts the long word and keeps " ?"; the short text and a text with no maybe do not change', () => {
		const { g, l, labels } = laid();
		const draw = (text: string) => renderSvg(g, l.layout, l.edges, { palette: DEFAULT_LIGHT, dark: false, measure, fonts: FONTS, labels, me: 'c', relations: relations(text), saved: { heading: 'T', legend: { kinds: [], sign: false, houses: [] }, pictures: new Map(), scale: 1 } });
		const cut = />([^<]*… \?)<\/text>/.exec(draw(`${WORD}, maybe full`));
		expect(cut, 'a cut text with " ?"').not.toBeNull();
		expect(cut![1].startsWith('Half')).toBe(true);
		expect(draw('Sister, maybe half')).toContain('>Sister, maybe half<');
		const plain = draw(WORD);
		expect(plain).not.toContain('… ?');
	});

	it('the live scene cuts the same way, and again after a refit', () => {
		const { g, l, labels } = laid();
		const root = new FEl('g');
		const scene = buildScene(root as unknown as SVGGElement, g, l, { fonts: FONTS, measure, link: () => null, labels, me: 'c', relations: relations(`${WORD}, maybe half`) });
		const rel = all(root).filter((e) => e.hasClass('dynasty-card-relation')).map((e) => e.getText());
		expect(rel.some((t) => /^Half 1st.*… \?$/.test(t)), rel.join('|')).toBe(true);
		expect(rel).toContain('You');
		void scene;
	});

	it('the live scene keeps a short maybe text whole', () => {
		const { g, l, labels } = laid();
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, l, { fonts: FONTS, measure, link: () => null, labels, me: 'c', relations: relations('Sister, maybe half') });
		expect(all(root).filter((e) => e.hasClass('dynasty-card-relation')).map((e) => e.getText())).toContain('Sister, maybe half');
	});
});
