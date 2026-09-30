import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import { computeRelations } from '../../src/core/relations';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, illegitimateSigns, layoutTree } from '../../src/layout/index';
import type { LaidOut, LayoutSettings, StrokeKind } from '../../src/layout/model';
import type { PictureSlot } from '../../src/render/dom/pictures';
import type { LegendHouse } from '../../src/render/legend';
import type { PictureMap, SavedParts } from '../../src/render/saved-picture';
import { buildScene, type Scene } from '../../src/render/dom/scene';
import { DEFAULT_DARK, DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg, type SvgOptions } from '../../src/render/svg-string';
import { FEl, installDom } from './fake-dom';
import { allFixtures } from './load';
import { block14, graphOf, layoutPictures, savedModule, treeOf, type PictureHouse, type PictureSettings } from './m9-support';

/*
 * Spec §13.8 "Save the tree as a picture" (D70–D74) and the M9 obsidian contract P1–P6 with B3,
 * B5, B9 and G4: the saved legend, the element list of the saved SVG against the drawn scene
 * (parity), the white ground and the light colours, the heading and the legend, the size, the
 * pictures as data URIs, the scale and the small-names flag, and the file name. Without `saved`,
 * `renderSvg` draws exactly as in M8. These tests wait for WP 9.2.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const FONT = 'test';
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string) => [...s].length * 8;
const GEO = geometryFor(16, 'normal');
const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

// ---------- A small XML reader for the saved SVG ----------

interface Node {
	tag: string;
	attrs: Record<string, string>;
	children: Node[];
	text: string;
	parent?: Node;
}

function parseSvg(svg: string): Node {
	const root: Node = { tag: '#root', attrs: {}, children: [], text: '' };
	let at = root;
	const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
	for (const m of svg.matchAll(re)) {
		if (m[5] !== undefined) {
			at.text += m[5];
			continue;
		}
		if (m[1]) {
			at = at.parent ?? root;
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const a of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
		const node: Node = { tag: m[2], attrs, children: [], text: '', parent: at };
		at.children.push(node);
		if (!m[4]) at = node;
	}
	return root;
}
const nodes = (n: Node): Node[] => [n, ...n.children.flatMap(nodes)];
const textIn = (n: Node): string => n.text + n.children.map(textIn).join('');
const items = (svg: string) => nodes(parseSvg(svg)).flatMap((n) => (n.attrs['data-item'] ? [n.attrs['data-item']] : []));
const byItem = (svg: string, item: string) => nodes(parseSvg(svg)).find((n) => n.attrs['data-item'] === item);
/** The opacity of a node: its own and its ancestors' `opacity` multiplied. */
function opacityOf(n: Node): number {
	let o = 1;
	for (let at: Node | undefined = n; at; at = at.parent) if (at.attrs.opacity !== undefined) o *= Number(at.attrs.opacity);
	return o;
}
const isDashed = (n: Node) => !!n.attrs['stroke-dasharray'] && n.attrs['stroke-dasharray'] !== 'none';

// ---------- Sample tree 14, as the tree view draws it ----------

interface Drawn {
	g: FamilyGraph;
	laid: LaidOut;
	relations: Map<string, { text: string; lower: string }>;
	scene: Scene & { pictures: PictureSlot[] };
	root: FEl;
	pictures: PictureMap;
	legend: SavedParts['legend'];
}

async function drawn14(): Promise<Drawn> {
	const { pictureSets } = await layoutPictures();
	clearLayoutCache();
	const g = graphOf(block14(0));
	const sets = pictureSets(g, true);
	const laid = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true, ...sets } as PictureSettings, FONT);
	const relations = new Map([...computeRelations(g, 'roderick')].map(([id, rels]) => [id, { text: rels[0].text, lower: rels[0].lower }]));
	const root = new FEl('g');
	const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, relations, me: 'roderick' }) as Scene & { pictures: PictureSlot[] };
	// Harrow's arms and Darian's portrait have a problem; Oswin's portrait file is missing; Hugo's has no entry.
	const pictures = new Map<string, string | 'missing' | null>();
	for (const id of sets.arms) pictures.set(`arms:${id}`, id === 'harrow' || id === 'drakemoor' ? null : PNG_URI);
	for (const id of sets.portraits) if (id !== 'hugo') pictures.set(`portrait:${id}`, id === 'oswin' ? 'missing' : id === 'darian' ? null : PNG_URI);
	const kinds = [...new Set(laid.edges.paths.map((p) => p.kind))] as StrokeKind[];
	const drawnHouses = new Set(g.people.map((p) => p.house).filter((h): h is string => !!h && g.houses.has(h)));
	const houses: LegendHouse[] = [...g.houses.values()].filter((h) => drawnHouses.has(h.id)).map((h) => ({ id: h.id, name: h.name, color: h.color, arms: (h as PictureHouse).arms !== undefined }));
	return { g, laid, relations, scene, root, pictures, legend: { kinds, sign: illegitimateSigns(g, laid.edges).size > 0, houses } };
}

const saveOf = (d: Drawn, scale = 1.75, heading = 'Pictures'): SavedParts => ({ heading, legend: d.legend, pictures: d.pictures, scale });
const savedSvg = (d: Drawn, saved: SavedParts, more: Partial<SvgOptions> = {}) =>
	renderSvg(d.g, d.laid.layout, d.laid.edges, { palette: DEFAULT_LIGHT, dark: false, relations: d.relations, me: 'roderick', ...more, ...({ saved, measure: (s: string) => measure(s), fonts: FONTS } as object) } as SvgOptions);

/** The element list that the drawn scene gives (P4, B3): cards, lines, signs, tags, relation texts and pictures. */
function sceneItems(d: Drawn, saved: SavedParts): string[] {
	const out: string[] = [];
	const els = all(d.root);
	const isUri = (v: string | null | undefined) => typeof v === 'string' && v.startsWith('data:');
	for (const e of els) {
		if (e.hasClass('dynasty-card')) {
			const id = e.getAttribute('data-person')!;
			out.push(`card:${id}`);
			if (e.hasClass('dynasty-signed')) out.push(`sign:${id}`);
			if (all(e).some((x) => x.hasClass('dynasty-card-relation'))) out.push(`relation:${id}`);
		}
		if (e.hasClass('dynasty-line') && e.parentElement?.hasClass('dynasty-lines')) out.push(`line:${[...e.classes].find((c) => c.startsWith('dynasty-line-'))!.slice('dynasty-line-'.length)}`);
		if (e.hasClass('dynasty-union-dot')) out.push(`union:${[...e.classes].find((c) => c.startsWith('dynasty-union-') && c !== 'dynasty-union-dot')?.slice('dynasty-union-'.length) ?? 'dot'}`);
		if (e.hasClass('dynasty-rumour-marker')) out.push('rumour');
		if (e.hasClass('dynasty-tag')) out.push(`tag:${e.getAttribute('data-person')}`);
	}
	for (const s of d.scene.pictures.filter((x) => x.lod === 'full')) {
		if (s.kind === 'arms' && isUri(saved.pictures.get(`arms:${s.house}`))) out.push(`arms:${s.person}`);
		if (s.kind === 'portrait') {
			out.push(`frame:${s.person}`);
			if (isUri(saved.pictures.get(`portrait:${s.person}`))) out.push(`portrait:${s.person}`);
		}
	}
	out.push('heading');
	for (const k of saved.legend.kinds) out.push(`legend-line:${k}`);
	if (saved.legend.sign) out.push('legend-sign');
	for (const h of saved.legend.houses) {
		out.push(`legend-house:${h.id}`);
		if (h.arms && isUri(saved.pictures.get(`arms:${h.id}`))) out.push(`legend-arms:${h.id}`);
	}
	return out.sort();
}

describe('P4, B3: the saved SVG has the elements of the drawn scene (spec §13.8 acceptance)', () => {
	it('sample tree 14 with a mark: cards, lines, union signs, signs, tags, relation texts, pictures, heading and legend', async () => {
		const d = await drawn14();
		const saved = saveOf(d);
		const got = items(savedSvg(d, saved)).sort();
		expect(got).toEqual(sceneItems(d, saved));
		// The sample has every kind of item the list names.
		for (const prefix of ['card:', 'line:', 'union:', 'sign:', 'relation:', 'arms:', 'portrait:', 'frame:', 'legend-line:', 'legend-house:', 'legend-arms:']) expect(got.some((x) => x.startsWith(prefix)), prefix).toBe(true);
	});

	it('pictures only as data URIs, one <image> for each arms or portrait item; never a blob URL', async () => {
		const d = await drawn14();
		const svg = savedSvg(d, saveOf(d));
		const images = nodes(parseSvg(svg)).filter((n) => n.tag === 'image');
		const pictureItems = items(svg).filter((x) => /^(arms|portrait|legend-arms):/.test(x));
		expect(images.length).toBe(pictureItems.length);
		for (const img of images) expect(img.attrs.href ?? img.attrs['xlink:href']).toMatch(/^data:image\/png;base64,/);
		expect(svg).not.toContain('blob:');
	});

	it('B1: only a missing file gives a dashed frame; another problem and no entry give a solid frame and no picture', async () => {
		const d = await drawn14();
		const svg = savedSvg(d, saveOf(d));
		expect(isDashed(byItem(svg, 'frame:oswin')!)).toBe(true);
		for (const id of ['darian', 'hugo', 'aldric']) expect(isDashed(byItem(svg, `frame:${id}`)!), id).toBe(false);
		for (const x of ['portrait:oswin', 'portrait:darian', 'portrait:hugo', 'arms:giselle', 'arms:darian']) expect(byItem(svg, x), x).toBeUndefined();
	});

	it('G4: the arms and portrait of a deceased person are at 0.8 opacity; a living person\'s are not muted', async () => {
		const d = await drawn14();
		const svg = savedSvg(d, saveOf(d));
		for (const x of ['arms:aldric', 'portrait:aldric', 'arms:oswin', 'portrait:isolde']) expect(opacityOf(byItem(svg, x)!), x).toBeCloseTo(0.8, 6);
		for (const x of ['arms:roderick', 'portrait:roderick', 'portrait:edmund']) expect(opacityOf(byItem(svg, x)!), x).toBeCloseTo(1, 6);
	});
});

describe('P3, D73, D74: colours, heading and legend of the saved picture', () => {
	it('a white ground and the light palette, also for a dark view (D73)', async () => {
		const d = await drawn14();
		const svg = savedSvg(d, saveOf(d));
		const root = parseSvg(svg).children[0];
		expect(root.tag).toBe('svg');
		const ground = root.children.find((n) => n.tag === 'rect')!;
		expect(ground.attrs.fill.toLowerCase()).toMatch(/^(#fff|#ffffff|white)$/);
		expect(svg.toLowerCase()).not.toContain(DEFAULT_DARK.background);
		expect(svg.toLowerCase()).not.toContain(DEFAULT_DARK.cardFill);
	});

	it('the note name at the top; the headings "Line styles" and "Houses" in the legend at the bottom (D74, B8)', async () => {
		const d = await drawn14();
		const svg = savedSvg(d, saveOf(d, 1.75, 'House of Valmont & Co'));
		const doc = parseSvg(svg);
		const heading = nodes(doc).find((n) => n.attrs['data-item'] === 'heading')!;
		expect(textIn(heading)).toContain('House of Valmont &amp; Co');
		const texts = nodes(doc).map((n) => n.text.trim());
		expect(texts).toContain('Line styles');
		expect(texts).toContain('Houses');
		// The heading is above every card; the legend is below every card (y in the picture's frame).
		const shift = (n: Node) => {
			let dy = 0;
			for (let at = n.parent; at; at = at.parent) {
				const m = /translate\(\s*[-\d.e]+[\s,]+([-\d.e]+)\s*\)/.exec(at.attrs.transform ?? '');
				if (m) dy += Number(m[1]);
			}
			return dy;
		};
		const y = (n: Node) => Number(n.attrs.y ?? n.attrs.cy ?? NaN) + shift(n);
		const headingText = nodes(heading).find((n) => n.tag === 'text' && n.attrs.y !== undefined)!;
		const lineStyles = nodes(doc).find((n) => n.text.trim() === 'Line styles')!;
		const cards = nodes(doc).filter((n) => n.attrs['data-item']?.startsWith('card:'));
		const ys = cards.flatMap((c) => nodes(c).map(y).filter(Number.isFinite));
		expect(y(headingText)).toBeLessThan(Math.min(...ys));
		expect(y(lineStyles)).toBeGreaterThan(Math.max(...ys));
	});

	it('width and height are the layout size × `scale`; the viewBox is in layout px (P3)', async () => {
		const d = await drawn14();
		for (const scale of [1, 1.75, 0.5]) {
			const root = parseSvg(savedSvg(d, saveOf(d, scale))).children[0];
			const [, , vw, vh] = root.attrs.viewBox.split(/[\s,]+/).map(Number);
			expect(Number(root.attrs.width), `scale ${scale}`).toBeCloseTo(vw * scale, -0.5);
			expect(Number(root.attrs.height), `scale ${scale}`).toBeCloseTo(vh * scale, -0.5);
			expect(vw).toBeGreaterThanOrEqual(d.laid.layout.width);
			expect(vh).toBeGreaterThan(d.laid.layout.height);
		}
	});

	it('P2: with `measure`, the text is measured with the font strings the file names', async () => {
		const d = await drawn14();
		const fonts = new Set<string>();
		const spy = (s: string, font?: string) => {
			if (font) fonts.add(font);
			return [...s].length * 8;
		};
		renderSvg(d.g, d.laid.layout, d.laid.edges, { palette: DEFAULT_LIGHT, dark: false, relations: d.relations, me: 'roderick', ...({ saved: saveOf(d), measure: spy, fonts: FONTS } as object) } as SvgOptions);
		expect(fonts.has('700 16px serif')).toBe(true);
		expect([...fonts].some((f) => /^400 13\.6px serif$/.test(f))).toBe(true);
		// A measure that finds every text too wide cuts every name with "…".
		const wide = renderSvg(d.g, d.laid.layout, d.laid.edges, { palette: DEFAULT_LIGHT, dark: false, ...({ saved: saveOf(d), measure: (s: string) => [...s].length * 1000, fonts: FONTS } as object) } as SvgOptions);
		expect(wide).not.toContain('>Roderick Valmont<');
	});
});

describe('savedLegend: the line kinds drawn, the D14 sign, the houses of the drawn people (P3)', () => {
	it('sample tree 14', async () => {
		const { savedLegend } = await savedModule();
		const d = await drawn14();
		const got = savedLegend(d.g, d.laid);
		expect([...got.kinds].sort()).toEqual([...d.legend.kinds].sort());
		expect(got.sign).toBe(true);
		expect(got.houses.map((h) => h.id).sort()).toEqual(d.legend.houses.map((h) => h.id).sort());
		for (const h of got.houses) {
			const want = d.legend.houses.find((x) => x.id === h.id)!;
			expect({ name: h.name, arms: h.arms }, h.id).toEqual({ name: want.name, arms: want.arms });
		}
	});

	it('a focus family: only the houses of the drawn people', async () => {
		const { savedLegend } = await savedModule();
		const g = deriveFamilies(focusSubgraph(treeOf(block14(0)), 'piers', 1)!.tree);
		const laid = layoutTree(g, GEO, DEFAULT_LAYOUT_SETTINGS, FONT);
		expect(savedLegend(g, laid).houses.map((h) => h.id)).toEqual(['thorne']);
		expect(savedLegend(g, laid).sign).toBe(false);
	});
});

describe('P5, B5: savedScale', () => {
	const CSS_SCALE = 14 / 16;

	it('SVG: the CSS scale (names 14 px); pictures at 4 × their CSS size; never small', async () => {
		const { savedScale } = await savedModule();
		for (const extent of [{ w: 1000, h: 800 }, { w: 60000, h: 9000 }]) {
			const s = savedScale(extent, 16, 'svg');
			expect(s.scale).toBeCloseTo(CSS_SCALE, 9);
			expect(s.pictureScale).toBeCloseTo(4 * CSS_SCALE, 9);
			expect(s.small).toBe(false);
		}
		expect(savedScale({ w: 1000, h: 800 }, 20, 'svg').scale).toBeCloseTo(14 / 20, 9);
	});

	it('PNG: 2 × the CSS scale when the picture fits', async () => {
		const { savedScale } = await savedModule();
		const s = savedScale({ w: 1000, h: 800 }, 16, 'png');
		expect(s.scale).toBeCloseTo(2 * CSS_SCALE, 9);
		expect(s.pictureScale).toBeCloseTo(s.scale, 9);
		expect(s.small).toBe(false);
	});

	it('PNG: smaller until at most 16 million pixels and 8192 px on each side; small names when (fontPx × scale) / 2 < 8', async () => {
		const { savedScale } = await savedModule();
		// Names are 16 × scale / 2 CSS px in the picture.
		const cases: { w: number; h: number; small: boolean }[] = [
			{ w: 6000, h: 2000, small: false }, // pixel limit: scale 1.155, names 9.2 px
			{ w: 9000, h: 3000, small: true }, // pixel limit: scale 0.770, names 6.2 px
			{ w: 5000, h: 5000, small: true }, // pixel limit: scale 0.8, names 6.4 px
			{ w: 30000, h: 4000, small: true }, // side limit: scale 0.273
			{ w: 1500, h: 8000, small: false }, // side limit: scale 1.024, names 8.2 px
		];
		for (const c of cases) {
			const s = savedScale({ w: c.w, h: c.h }, 16, 'png');
			const bound = Math.min(2 * CSS_SCALE, 8192 / c.w, 8192 / c.h, Math.sqrt(16_000_000 / (c.w * c.h)));
			expect(s.scale, `${c.w} × ${c.h}`).toBeLessThanOrEqual(bound + 1e-9);
			expect(s.scale, `${c.w} × ${c.h}`).toBeGreaterThan(bound * 0.98);
			expect(c.w * s.scale * c.h * s.scale).toBeLessThanOrEqual(16_000_000 * (1 + 1e-9));
			expect(c.w * s.scale).toBeLessThanOrEqual(8192 + 1e-6);
			expect(c.h * s.scale).toBeLessThanOrEqual(8192 + 1e-6);
			expect(s.small, `${c.w} × ${c.h}`).toBe((16 * s.scale) / 2 < 8);
			expect(s.small, `${c.w} × ${c.h}`).toBe(c.small);
		}
	});
});

describe('P6: savedFileName', () => {
	it('"NOTE NAME tree.png" or ".svg"; in focus mode "NOTE NAME tree, family of NAME"', async () => {
		const { savedFileName } = await savedModule();
		expect(savedFileName('Valmont', 'png')).toBe('Valmont tree.png');
		expect(savedFileName('Valmont', 'svg')).toBe('Valmont tree.svg');
		expect(savedFileName('Valmont', 'png', 'Roderick Valmont')).toBe('Valmont tree, family of Roderick Valmont.png');
	});

	it('names are cleaned like note names; an empty name falls back', async () => {
		const { savedFileName } = await savedModule();
		expect(savedFileName('House: Valmont / Orsini?', 'png')).toBe('House Valmont Orsini tree.png');
		expect(savedFileName('', 'svg')).toBe('Tree tree.svg');
		expect(savedFileName('Valmont', 'png', '[[Roderick]] #1')).toBe('Valmont tree, family of Roderick 1.png');
		expect(savedFileName('Valmont', 'png', ' ')).toBe('Valmont tree, family of Person.png');
	});
});

describe('P4: without `saved` (and without `pictures`), renderSvg draws exactly as in M8', () => {
	// Recorded from the M8 build (milestone-9 at a01649a): the first 16 hex digits of the SHA-256 of
	// renderSvg(g, layout, edges, {}) at 16 px with DEFAULT_LAYOUT_SETTINGS (a relation line for 14
	// and 07b, whose layouts have no picture sets).
	const M8_SVG: Record<string, string> = {
		'01': '31464ce8b62eaba1',
		'02': 'c43f9a54754d6172',
		'03': 'ef71ede678a8ebfb',
		'04': '891ee22b9a49caf1',
		'05': '0f94c507b77a9c41',
		'06': '7009b615657abc7b',
		'07': 'e7729baac3fcb11a',
		'07b': '17a9ab580cb92836',
		'08': 'e678d21ca57ba928',
		'09': 'c868949b88dd240d',
		'10': 'ce29021c87b4421f',
		'11': '3f8ba080b967fc27',
		'12': '2eb63a29a8061074',
		'13': '5e9fd7aaf9fb68bc',
		'14': '94d0fc45f5613b69',
		'15': 'eea22d043fd5e123',
	};
	for (const f of allFixtures()) {
		it(`sample tree ${f.id}`, () => {
			const g = graphOf(f.source);
			const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, relationLine: f.id === '14' || f.id === '07b' };
			const laid = layoutTree(g, GEO, settings, FONT);
			const svg = renderSvg(g, laid.layout, laid.edges, {});
			expect(createHash('sha256').update(svg).digest('hex').slice(0, 16)).toBe(M8_SVG[f.id]);
			expect(svg).not.toContain('data-item');
		});
	}
});

describe('B9: `pictures` without `saved` (the spike): pictures, but no heading, legend or white ground', () => {
	it('sample tree 14 in the dark palette', async () => {
		const d = await drawn14();
		const svg = renderSvg(d.g, d.laid.layout, d.laid.edges, { palette: DEFAULT_DARK, relations: d.relations, me: 'roderick', ...({ pictures: d.pictures } as object) } as SvgOptions);
		const doc = parseSvg(svg);
		const images = nodes(doc).filter((n) => n.tag === 'image');
		const uris = [...d.pictures.entries()].filter(([, v]) => typeof v === 'string' && v.startsWith('data:'));
		// Every card with arms whose house has a URI, and every portrait with a URI, gets one picture.
		const armsCards = d.scene.pictures.filter((s) => s.lod === 'full' && s.kind === 'arms' && typeof d.pictures.get(`arms:${s.house}`) === 'string' && d.pictures.get(`arms:${s.house}`)!.startsWith('data:')).length;
		const portraitCards = uris.filter(([k]) => k.startsWith('portrait:')).length;
		expect(images.length).toBe(armsCards + portraitCards);
		expect(nodes(doc).map((n) => n.text.trim())).not.toContain('Line styles');
		expect(svg).toContain(DEFAULT_DARK.background);
		expect(svg).not.toContain('data-item');
	});
});
