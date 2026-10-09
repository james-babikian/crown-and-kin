// 0.2.5 WP-B9 (D153): the marked ("This is me") card, the marked row of the phone list and the saved picture use no theme accent colour.
// The mark is one border in the text colour; the plate and the "You" tab take the house colour like every other plate; the relation
// finder's line keeps the accent. The tests scan the CSS rules and the SVG text, so a new rule or a new element that brings the accent
// back fails here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { cardLabels } from '../src/core/titles';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../src/layout/model';
import { contrastRatio } from '../src/render/dom/theme-read';
import { buildScene } from '../src/render/dom/scene';
import { DEFAULT_DARK, DEFAULT_LIGHT, HOUSE_PALETTE, ME_LOOK, ME_RING_INNER, ROUNDEL_LOOK, mixHex, stripColour, type Palette } from '../src/render/styles';
import { renderSvg } from '../src/render/svg-string';
import { FEl, installDom } from './acceptance/fake-dom';
import { build } from './helpers';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const SENTINEL = '#ff00ff';
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
const rule = (selector: string) => rules.find((r) => r.selector.replace(/,\s/g, ',') === selector.replace(/,\s/g, ','));
const decl = (selector: string): Record<string, string> => {
	const r = rule(selector);
	if (!r) return {};
	return Object.fromEntries(r.body.split(';').map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]).filter(([k]) => k));
};

const srcOf = (house: string | undefined, me = 'c') =>
	[
		'houses:',
		`  - {id: v, name: V, color: "#8b1e3f"}`,
		`  - {id: w, name: W, color: "${house ?? '#1e5a8b'}"}`,
		'options:',
		`  me: ${me}`,
		'people:',
		'  - {id: a, name: Aldric, house: v, born: 1100, died: 1160, title: Duke}',
		'  - {id: b, name: Bertram, house: v, illegitimate: true}',
		`  - {id: c, name: Cedric, ${house === 'none' ? '' : 'house: w, '}born: 1130, parents: [a]}`,
		'  - {id: d, name: Dora, parents: [a]}',
		'',
	].join('\n');
const parse = (src: string): { g: FamilyGraph; labels: ReturnType<typeof cardLabels> } => {
	const g = build(src).g;
	return { g, labels: cardLabels(g) };
};
const RELATIONS = new Map([['b', { text: 'Half-brother', lower: 'half-brother' }], ['c', { text: 'You', lower: 'you' }], ['d', { text: 'Half-sister', lower: 'half-sister' }]]);

function lay(g: FamilyGraph, geo: Geometry, over: Partial<LayoutSettings> = {}): LaidOut {
	clearLayoutCache();
	const sideways = geo.form === 'text';
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
}
interface Look {
	name: string;
	geo: Geometry;
	over: Partial<LayoutSettings>;
}
const LOOKS: Look[] = [
	{ name: 'Roundel, plate on', geo: cardForm(geometryFor(12), 'down'), over: { relationLine: true } },
	{ name: 'Roundel, You tab', geo: cardForm(geometryFor(12), 'down'), over: { youTab: 'c' } },
	{ name: 'text card, plate on', geo: cardForm(geometryFor(12), 'sideways'), over: { relationLine: true } },
	{ name: 'text card, You tab', geo: cardForm(geometryFor(12), 'sideways'), over: { youTab: 'c' } },
];
function svgOf(src: string, look: Look, o: { dark?: boolean; saved?: boolean; accent?: string; line?: boolean; me?: string } = {}): string {
	const { g, labels } = parse(src);
	const laid = lay(g, look.geo, look.over);
	const dark = o.dark === true;
	const palette: Palette = { ...(dark ? DEFAULT_DARK : DEFAULT_LIGHT), ...(o.accent ? { accent: o.accent } : {}) };
	return renderSvg(g, laid.layout, laid.edges, {
		palette,
		dark,
		measure,
		fonts: FONTS,
		labels,
		me: o.me ?? 'c',
		...(look.over.relationLine ? { relations: RELATIONS } : {}),
		...(o.line ? { line: { people: new Set(['a', 'c']), unions: new Set<string>(), links: new Set(['a\0c']), fade: false } } : {}),
		...(o.saved === false ? {} : { saved: { heading: 'Test', legend: { kinds: [], sign: false, houses: [] }, pictures: new Map(), scale: 1 } }),
	});
}

describe('D153: no accent colour in the mark (CSS)', () => {
	// Every rule that styles the marked card, its plate or tab, or the marked row of the phone list. The flash outline of a saved row is another thing.
	const MARK = /dynasty-card-me|dynasty-r1-plate|dynasty-r1-tab|dynasty-list-me/;

	it('no marked-card, plate, tab or marked-row rule names the accent or the text-on-accent colour', () => {
		// 0.2.7: the ring of a marked heir takes the accent (the Show view's heir outline, not the mark), so the heir rules are another thing.
		const found = rules.filter((r) => MARK.test(r.selector) && !/dynasty-heir/.test(r.selector));
		// The scan sees the rules it is meant to see.
		for (const s of ['.dynasty-card-me .dynasty-card-bg', '.dynasty-r1-plate', '.dynasty-r1-plate-line', '.dynasty-r1-tab', '.dynasty-r1-tab-text', '.dynasty-list-me']) expect(found.map((r) => r.selector), s).toContain(s);
		const bad = found.filter((r) => /interactive-accent|text-on-accent|accent/.test(r.body)).map((r) => r.selector);
		expect(bad).toEqual([]);
	});

	it('the accent stays for the finder\'s line, the focus rings and the flash outline of the phone list', () => {
		expect(decl('.dynasty-line.dynasty-on-line').stroke).toBe('var(--interactive-accent)');
		expect(decl('.dynasty-list-flash').outline).toBe('2px solid var(--interactive-accent)');
		expect(decl('.dynasty-card:focus-visible .dynasty-card-bg').stroke).toBe('var(--interactive-accent)');
		expect(decl('.dynasty-card.dynasty-highlight .dynasty-card-bg').stroke).toBe('var(--interactive-accent)');
	});

	it('the mark is one border in the text colour, as wide as ME_LOOK says, and no second ring is styled', () => {
		expect(decl('.dynasty-card-me .dynasty-card-bg')).toEqual({ stroke: 'var(--text-normal)', 'stroke-width': String(ME_LOOK.border) });
		expect(decl('.dynasty-card-me:focus-visible .dynasty-card-bg')['stroke-width']).toBe(String(ME_LOOK.border));
		expect(rule('.dynasty-card-me-ring')).toBeUndefined();
		expect(ME_LOOK).toEqual({ border: ME_LOOK.border });
		// The old inner ring was 1.5 px; the one border is at least as heavy, and wide enough to stand out.
		expect(ME_LOOK.border).toBeGreaterThanOrEqual(2);
		expect(ME_RING_INNER).toBe(ME_LOOK.border / 2);
	});

	it('the plate of the marked card has no rule of its own: it follows the house colour like every plate', () => {
		for (const r of rules) {
			if (/dynasty-card-me/.test(r.selector)) expect(r.selector, 'a marked-card rule for the plate').not.toMatch(/r1-plate/);
		}
		expect(ROUNDEL_LOOK.plate).toEqual({ light: 0.17, dark: 0.26 });
	});

	it('the tab takes the house colour like the plate, with the text colour for its word', () => {
		const tab = decl('.dynasty-r1-tab');
		expect(tab.fill).toBe('var(--dynasty-house-color, var(--background-modifier-border))');
		expect(Number(tab['fill-opacity'])).toBe(ROUNDEL_LOOK.plate.light);
		expect(decl('.theme-dark .dynasty-r1-tab')['fill-opacity']).toBe(String(ROUNDEL_LOOK.plate.dark));
		expect(decl('.theme-dark .dynasty-has-house .dynasty-r1-tab').fill).toContain('color-mix(in srgb, var(--dynasty-house-color) 70%, var(--text-normal))');
		expect(decl('.dynasty-r1-tab-text').fill).toBe('var(--text-normal)');
		expect(decl('.dynasty-r1-tab-base').fill).toBe('var(--background-primary-alt)');
	});

	it('the marked row of the phone list has a 2 px border in the text colour and no inset ring', () => {
		const row = decl('.dynasty-list-me');
		expect(row.border).toBe('2px solid var(--text-normal)');
		expect(row['box-shadow']).toBeUndefined();
	});
});

describe('D153: no accent colour in the mark (saved picture)', () => {
	for (const look of LOOKS) {
		for (const dark of [false, true]) {
			for (const saved of [true, false]) {
				it(`${look.name}, ${dark ? 'dark' : 'light'}, ${saved ? 'saved file' : 'headless'}: the sentinel accent never appears`, () => {
					for (const house of ['#1e5a8b', 'none']) {
						const svg = svgOf(srcOf(house), look, { dark, saved, accent: SENTINEL });
						expect(svg.toLowerCase(), house).not.toContain(SENTINEL);
					}
					// The control: the finder's line does take the accent, so the sentinel can show up.
					expect(svgOf(srcOf('#1e5a8b'), look, { dark, saved, accent: SENTINEL, line: true }).toLowerCase()).toContain(SENTINEL);
				});
			}
		}
	}

	it('the marked card is one border in the text colour, and its bg rect is the only mark: no second ring rect', () => {
		const roundel = LOOKS[0];
		const marked = svgOf(srcOf('#1e5a8b'), roundel);
		const plain = svgOf(srcOf('#1e5a8b'), roundel, { me: 'zzz' });
		expect(marked).toContain(`stroke="${DEFAULT_LIGHT.text}" stroke-width="${ME_LOOK.border}"`);
		// D176 (1): the house bar of the marked card is a path (inside the border) in place of a rect.
		expect((marked.match(/<rect /g) ?? []).length).toBe((plain.match(/<rect /g) ?? []).length - 1);
	});

	for (const dark of [false, true]) {
		const c = dark ? DEFAULT_DARK : DEFAULT_LIGHT;
		const opacity = dark ? ROUNDEL_LOOK.plate.dark : ROUNDEL_LOOK.plate.light;
		it(`${dark ? 'dark' : 'light'}: the plate of the marked card is the plate of every card, in the house colour; with no house the neutral`, () => {
			const roundel = LOOKS[0];
			const withHouse = svgOf(srcOf('#1e5a8b'), roundel, { dark });
			const plate = /<path d="[^"]*" fill="([^"]+)" fill-opacity="([^"]+)" data-item="plate:c"/.exec(withHouse)!;
			expect(plate[1].toLowerCase()).toBe(dark ? mixHex('#1e5a8b', 0.7, c.text) : '#1e5a8b');
			expect(Number(plate[2])).toBe(opacity);
			const without = /<path d="[^"]*" fill="([^"]+)" fill-opacity="([^"]+)" data-item="plate:c"/.exec(svgOf(srcOf('none'), roundel, { dark }))!;
			expect(without[1].toLowerCase()).toBe(c.noHouse);
			expect(Number(without[2])).toBe(opacity);
		});
	}
});

describe('D153: the "You" tab and its word are readable on every house colour', () => {
	const hexes = [...HOUSE_PALETTE, 'none'];
	const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

	/** The tab of the marked card as the saved picture draws it: [base fill, tab fill, tab opacity, word fill]. */
	function tabOf(house: string, dark: boolean) {
		const svg = svgOf(srcOf(house), LOOKS[1], { dark });
		// The base is the rect before the tab's own rect.
		const at = svg.indexOf('data-item="tab:c"');
		const tabStart = svg.lastIndexOf('<rect ', at);
		const base = /fill="([^"]+)"/.exec(svg.slice(svg.lastIndexOf('<rect ', tabStart - 1), tabStart));
		const tab = /fill="([^"]+)" fill-opacity="([^"]+)"/.exec(svg.slice(tabStart, at + 20))!;
		const word = /<text [^>]*fill="([^"]+)">You<\/text>/.exec(svg.slice(svg.indexOf('data-item="tab:c"')))!;
		return { base: base?.[1], fill: tab[1], opacity: Number(tab[2]), word: word[1] };	}

	for (const dark of [false, true]) {
		it(`${dark ? 'dark' : 'light'}: the tab is a house-colour tint over the card colour and the word is the text colour, at least 4.5:1`, () => {
			const c = dark ? DEFAULT_DARK : DEFAULT_LIGHT;
			for (const house of hexes) {
				const t = tabOf(house, dark);
				expect(t.base?.toLowerCase(), house).toBe(c.cardFill);
				expect(t.word.toLowerCase(), house).toBe(c.text);
				const ink = house === 'none' ? c.noHouse : stripColour(house, c, dark);
				expect(t.fill.toLowerCase(), house).toBe(ink.toLowerCase());
				expect(t.opacity).toBe(dark ? ROUNDEL_LOOK.plate.dark : ROUNDEL_LOOK.plate.light);
				const shown = mixHex(t.fill, t.opacity, t.base!);
				const ratio = contrastRatio(rgb(c.text), rgb(shown));
				expect(ratio, `${house} ${shown}`).toBeGreaterThanOrEqual(4.5);
			}
		});
	}

	it('the scene draws the same three elements for the tab: a card-colour base, the tint and the word', () => {
		const { g, labels } = parse(srcOf('#1e5a8b'));
		const laid = lay(g, LOOKS[1].geo, LOOKS[1].over);
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c' });
		const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
		const group = all(root).find((e) => e.hasClass('dynasty-r1-tab-group'))!;
		expect(group.children.map((e) => [...e.classes].join(' '))).toEqual(['dynasty-r1-tab-base', 'dynasty-r1-tab', 'dynasty-r1-tab-text']);
	});
});
