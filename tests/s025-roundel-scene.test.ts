// 0.2.5 WP-B3 (CONTRACT B.3.2 to B.3.7, B.5 test 5): what the live scene draws for the Roundel card, the sideways text card and the
// "You" tab: the plate, the tab, the medallion slots, the crown tap area, the centred text, the Compact name, and what the scene
// leaves out (data-relation, tooltip, pictures in a text card). The fake DOM stands in for a browser, as in `s024-cards-scene.test.ts`.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import type { CardLabel } from '../src/core/titles';
import { cardForm, cardText, centredWithoutWord, geometryFor, nameRoom, roundelAxis, roundelPics, youTabRect } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../src/layout/model';
import { cardNameLines } from '../src/render/name-lines';
import { COMPACT_NAME_EM, buildScene, type Scene, type SceneOptions } from '../src/render/dom/scene';
import { tallCardsFor } from '../src/render/dom/tall-cards';
import { ME_RING_INNER } from '../src/render/styles';
import { cardLabel } from '../src/render/tree-info';
import { FEl, installDom } from './acceptance/fake-dom';
import { serial } from './acceptance/m11-support';
import { build } from './helpers';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

// a: pictures (arms of house v and a portrait); b: signed, arms only; c: marked, portrait only; d: no picture, no house.
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'  - {id: w, name: W, color: "#1e5a8b"}',
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100, died: 1160, title: Duke, portrait: "[[a.png]]"}',
	'  - {id: b, name: Bertram, house: v, illegitimate: true}',
	'  - {id: c, name: Cedric, house: w, born: 1130, parents: [a], portrait: "[[c.png]]"}',
	'  - {id: d, name: Dora, parents: [a]}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;

const ROUNDEL = cardForm(geometryFor(12), 'down');
const TEXT = cardForm(geometryFor(12), 'sideways');

function lay(geo: Geometry, over: Partial<LayoutSettings> = {}, graph: FamilyGraph = g): LaidOut {
	clearLayoutCache();
	const sideways = geo.form === 'text';
	return layoutTree(graph, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(graph, true), ...over } as LayoutSettings, 'test');
}
function scene(laid: LaidOut, extra: Partial<SceneOptions> = {}, graph: FamilyGraph = g): { root: FEl; scene: Scene } {
	const root = new FEl('g');
	return { root, scene: buildScene(root as unknown as SVGGElement, graph, laid, { fonts: FONTS, measure, link: () => null, ...extra }) };
}
const card = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
const withClass = (el: FEl, cls: string) => all(el).filter((e) => e.hasClass(cls));
const num = (el: FEl, k: string) => Number(el.getAttribute(k));
const RELATIONS = new Map([['b', { text: 'Half-brother', lower: 'half-brother' }], ['c', { text: 'You', lower: 'you' }], ['d', { text: 'Half-sister', lower: 'half-sister' }]]);

describe('the plate (B.3.4)', () => {
	it('a plate group exists on a Roundel card iff the layout has `relationLine` and the person has a relation word (B7: none for `a`)', () => {
		const on = scene(lay(ROUNDEL, { relationLine: true }), { relations: RELATIONS, me: 'c' });
		const off = scene(lay(ROUNDEL), { relations: RELATIONS, me: 'c' });
		for (const id of ['a', 'b', 'c', 'd']) {
			expect(withClass(card(on.root, id), 'dynasty-r1-plate'), id).toHaveLength(id === 'a' ? 0 : 1);
			expect(withClass(card(off.root, id), 'dynasty-r1-plate'), id).toHaveLength(0);
		}
	});

	it('the plate lies from the strip to the card edge, bottom-right corner rounded; on the marked card it stays inside the ring', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		const geo = laid.layout.geometry;
		for (const id of ['b', 'c']) {
			const box = laid.layout.persons.get(id)!;
			const t = cardText(geo, 1);
			const ins = id === 'c' ? ME_RING_INNER : 1;
			const x0 = box.x + t.stripW;
			const x1 = box.x + box.w - ins;
			const y0 = box.y + box.h - t.r1!.plate!.h;
			const y1 = box.y + box.h - ins;
			const [path] = withClass(card(root, id), 'dynasty-r1-plate');
			expect(path.getAttribute('d'), id).toBe(`M${x0} ${y0}H${x1}V${y1 - 3}Q${x1} ${y1} ${x1 - 3} ${y1}H${x0}Z`);
			const [line] = withClass(card(root, id), 'dynasty-r1-plate-line');
			expect([num(line, 'x1'), num(line, 'y1'), num(line, 'x2'), num(line, 'y2')]).toEqual([x0, y0, x1, y0]);
		}
	});

	it('the relation word is centred on the axis at the raised baseline', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		const box = laid.layout.persons.get('d')!;
		const [word] = withClass(card(root, 'd'), 'dynasty-card-relation');
		const t = cardText(laid.layout.geometry, 1, false, { title: false, dates: false });
		expect(word.getText()).toBe('Half-sister');
		expect(num(word, 'x')).toBeCloseTo(box.x + roundelAxis(laid.layout.geometry), 9);
		expect(num(word, 'y')).toBeCloseTo(box.y + t.relationBaseline!, 9);
	});
});

describe('the "You" tab (B.3.4): one condition, the id in `TreeLayout.youTab`', () => {
	it('exactly one tab, on the card whose id equals `layout.youTab`, whatever the mark, `relations` and `relationLine` say', () => {
		// The mark is `c`; the tab belongs to `b`; relations are given; the plate is off.
		const laid = lay(ROUNDEL, { youTab: 'b' });
		expect(laid.layout.youTab).toBe('b');
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		expect(withClass(root, 'dynasty-r1-tab-group')).toHaveLength(1);
		expect(withClass(card(root, 'b'), 'dynasty-r1-tab-group')).toHaveLength(1);
		expect(withClass(card(root, 'c'), 'dynasty-r1-tab-group')).toHaveLength(0);
	});

	it('no `youTab` in the layout: no tab, though a card is marked and `relationLine` is off', () => {
		const { root } = scene(lay(ROUNDEL), { relations: RELATIONS, me: 'c' });
		expect(withClass(root, 'dynasty-r1-tab-group')).toHaveLength(0);
		expect(withClass(root, 'dynasty-r1-tab')).toHaveLength(0);
	});

	it('the tab rect is `youTabRect`, its word "You", left of the medallion when the card has a picture', () => {
		const laid = lay(ROUNDEL, { youTab: 'c' });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		const box = laid.layout.persons.get('c')!;
		const r = youTabRect(laid.layout.geometry, true);
		const [tab] = withClass(card(root, 'c'), 'dynasty-r1-tab');
		expect([num(tab, 'x'), num(tab, 'y'), num(tab, 'width'), num(tab, 'height')]).toEqual([box.x + r.x, box.y + r.y, r.w, r.h]);
		const [word] = withClass(card(root, 'c'), 'dynasty-r1-tab-text');
		expect(word.getText()).toBe('You');
		expect(num(word, 'x')).toBeCloseTo(box.x + r.x + r.w / 2, 9);
	});

	it('a card with no picture takes the tab nearer the axis (no medallion to clear)', () => {
		const laid = lay(ROUNDEL, { youTab: 'd' });
		const { root } = scene(laid, {});
		const box = laid.layout.persons.get('d')!;
		const r = youTabRect(laid.layout.geometry, false);
		const [tab] = withClass(card(root, 'd'), 'dynasty-r1-tab');
		expect(num(tab, 'x')).toBe(box.x + r.x);
	});

	it('the tab belongs to the Full group, so the Compact and Overview levels hide it with the text', () => {
		const laid = lay(ROUNDEL, { youTab: 'c' });
		const { root } = scene(laid, { me: 'c' });
		const [group] = withClass(card(root, 'c'), 'dynasty-r1-tab-group');
		expect(group.parentElement!.hasClass('dynasty-card-full')).toBe(true);
	});
});

describe('what the scene leaves to others (R-tooltip) and what the label keeps', () => {
	it('no `data-relation` attribute and no tooltip element or class anywhere, plate on or off', () => {
		for (const over of [{ relationLine: true }, { youTab: 'c' }] as Partial<LayoutSettings>[]) {
			const { root } = scene(lay(ROUNDEL, over), { relations: RELATIONS, me: 'c' });
			for (const e of all(root)) {
				expect([...e.attrs.keys()].filter((k) => k.startsWith('data-relation')), e.tag).toEqual([]);
				expect([...e.classes].filter((c) => /tip/.test(c)), e.tag).toEqual([]);
			}
		}
	});

	it('the label has the relation and no sobriquet; with the plate off it still says "Half-brother"', () => {
		const cl = new Map<string, CardLabel>([['b', { holdings: [], selected: false, name: 'Bertram', sobriquet: 'the Bold' } as CardLabel]]);
		for (const over of [{ relationLine: true }, {}] as Partial<LayoutSettings>[]) {
			const { root } = scene(lay(ROUNDEL, over), { relations: RELATIONS, me: 'c', labels: cl });
			const label = card(root, 'b').getAttribute('aria-label')!;
			expect(label).toContain('half-brother');
			expect(label).not.toContain('Bold');
			expect(label).toContain(cardLabel(g.byId.get('b')!, 'half-brother', cl.get('b')));
			expect(card(root, 'c').getAttribute('aria-label')).toContain('you');
		}
	});
});

describe('picture slots (B.3.3, B.3.10)', () => {
	it('Roundel: a Full and a Compact slot for each arms box and portrait, in card order', () => {
		const { scene: s } = scene(lay(ROUNDEL, { relationLine: true }));
		const of = (id: string) => s.pictures.filter((p) => p.person === id).map((p) => `${p.kind}:${p.lod}`);
		expect(of('a')).toEqual(['arms:full', 'portrait:full', 'arms:compact', 'portrait:compact']);
		expect(of('b')).toEqual(['arms:full', 'arms:compact']);
		expect(of('c')).toEqual(['portrait:full', 'portrait:compact']);
		expect(of('d')).toEqual([]);
	});

	it('the slots are the places of `roundelPics`, card-relative to absolute', () => {
		const laid = lay(ROUNDEL);
		const { scene: s } = scene(laid);
		const box = laid.layout.persons.get('a')!;
		const rp = roundelPics(laid.layout.geometry, { arms: true, portrait: true });
		const portrait = s.pictures.find((p) => p.person === 'a' && p.kind === 'portrait' && p.lod === 'full')!;
		expect(portrait.rect).toEqual({ x: box.x + rp.portrait!.x, y: box.y + rp.portrait!.y, w: rp.portrait!.w, h: rp.portrait!.h });
		const arms = s.pictures.find((p) => p.person === 'a' && p.kind === 'arms' && p.lod === 'compact')!;
		expect(arms.rect).toEqual({ x: box.x + rp.arms!.x, y: box.y + rp.arms!.y, w: rp.arms!.w, h: rp.arms!.h });
		// The frame circle is the ring: its centre on the medallion, its radius the middle of the ring's width.
		expect(num(portrait.frame as unknown as FEl, 'r')).toBeCloseTo(rp.ringR - 0.075 * 12 * 1, 9);
		expect(num(portrait.frame as unknown as FEl, 'cx')).toBeCloseTo(box.x + rp.cx, 9);
	});

	it('the Compact slots are the elements of the Full slots, in the Full group, which the Compact level shows (WP-B8)', () => {
		const { root, scene: s } = scene(lay(ROUNDEL));
		const compact = s.pictures.find((p) => p.lod === 'compact')!;
		const full = s.pictures.find((p) => p.lod === 'full' && p.person === compact.person && p.kind === compact.kind)!;
		expect(compact.el).toBe(full.el);
		expect((full.el as unknown as FEl).parentElement!.hasClass('dynasty-card-full')).toBe(true);
		expect(withClass(root, 'dynasty-r1-compact-pics')).toHaveLength(0);
	});

	it('the text card makes no slot at all, even for a person whose box says it has arms and a portrait', () => {
		// Same layout as the Roundel, with the form changed to the text card: the scene must not read the flags.
		const laid = lay(ROUNDEL);
		expect(laid.layout.persons.get('a')!.arms).toBe(true);
		const asText: LaidOut = { ...laid, layout: { ...laid.layout, geometry: { ...laid.layout.geometry, form: 'text' } } };
		const { scene: s, root } = scene(asText);
		expect(s.pictures).toHaveLength(0);
		expect(withClass(root, 'dynasty-portrait')).toHaveLength(0);
		expect(withClass(root, 'dynasty-arms')).toHaveLength(0);
		expect(withClass(root, 'dynasty-r1-halo')).toHaveLength(0);
	});

	it('a real sideways layout gives the text card scene no slots either', () => {
		expect(scene(lay(TEXT, { relationLine: true })).scene.pictures).toHaveLength(0);
	});
});

describe('the crown tap area (B.3.6)', () => {
	it('is a transparent rect in the SHELL of a lazy card, above the card top, over the halo, the arms and the tab', () => {
		const laid = lay(ROUNDEL, { youTab: 'c' });
		const { root } = scene(laid, { lazyCards: true, me: 'c' });
		const geo = laid.layout.geometry;
		const reach = geo.reach!;
		for (const id of ['a', 'b', 'c']) {
			const shell = card(root, id);
			expect(shell.children.map((c) => c.classes.has('dynasty-card-bg') || c.classes.has('dynasty-card-crown-hit')), id).toEqual([true, true]);
			const [hit] = withClass(shell, 'dynasty-card-crown-hit');
			const box = laid.layout.persons.get(id)!;
			expect([num(hit, 'y'), num(hit, 'height')], id).toEqual([box.y - reach, reach]);
			const rp = roundelPics(geo, { arms: id !== 'c', portrait: id !== 'b' });
			const xs = [box.x + rp.cx - (rp.portrait ? rp.haloR : 0), box.x + rp.cx + (rp.portrait ? rp.haloR : 0)];
			if (rp.arms) xs.push(box.x + rp.arms.x, box.x + rp.arms.x + rp.arms.w);
			if (id === 'c') {
				const r = youTabRect(geo, true);
				xs.push(box.x + r.x, box.x + r.x + r.w);
			}
			expect(num(hit, 'x'), id).toBeCloseTo(Math.min(...xs), 9);
			expect(num(hit, 'x') + num(hit, 'width'), id).toBeCloseTo(Math.max(...xs), 9);
		}
	});

	it('a Roundel card with no picture and no tab has none', () => {
		const { root } = scene(lay(ROUNDEL, { youTab: 'c' }), { lazyCards: true });
		expect(withClass(card(root, 'd'), 'dynasty-card-crown-hit')).toHaveLength(0);
	});

	it('it never sits in the Full group, so a lazy card has it before its content is filled', () => {
		const laid = lay(ROUNDEL);
		const { root, scene: s } = scene(laid, { lazyCards: true });
		expect(s.fill.pending).toBeGreaterThan(0);
		for (const hit of withClass(root, 'dynasty-card-crown-hit')) expect(hit.parentElement!.hasClass('dynasty-card')).toBe(true);
	});
});

describe('lazy and eager scenes agree', () => {
	it('after fillAll the serialised lazy Roundel scene is the eager one (plate on, tab off and plate off, tab on)', () => {
		for (const over of [{ relationLine: true }, { youTab: 'c' }] as Partial<LayoutSettings>[]) {
			const laid = lay(ROUNDEL, over);
			const eager = scene(laid, { relations: RELATIONS, me: 'c' });
			const lazy = scene(laid, { relations: RELATIONS, me: 'c', lazyCards: true });
			lazy.scene.fill.fillAll();
			expect(serial(lazy.root)).toBe(serial(eager.root));
		}
	});

	it('the same for the text card', () => {
		const laid = lay(TEXT, { relationLine: true });
		const eager = scene(laid, { relations: RELATIONS, me: 'c' });
		const lazy = scene(laid, { relations: RELATIONS, me: 'c', lazyCards: true });
		lazy.scene.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});
});

describe('the text is centred on the axis (B.3.2) and the lines that exist are centred in the body', () => {
	it('Roundel: every Full text line is anchored at the axis; the card has the class that styles.css centres', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		for (const id of ['a', 'd']) {
			const box = laid.layout.persons.get(id)!;
			const el = card(root, id);
			expect(el.hasClass('dynasty-card-r1')).toBe(true);
			for (const cls of ['dynasty-card-name', 'dynasty-card-title', 'dynasty-card-dates', 'dynasty-card-relation', 'dynasty-card-compact']) {
				for (const e of withClass(el, cls)) expect(num(e, 'x'), `${id} ${cls}`).toBeCloseTo(box.x + roundelAxis(laid.layout.geometry), 9);
			}
		}
	});

	it('the baselines come from `cardText` with the lines the person has (a card with no title and no dates centres its name)', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const { root } = scene(laid, { relations: RELATIONS });
		const geo = laid.layout.geometry;
		const dBox = laid.layout.persons.get('d')!;
		const [dName] = withClass(card(root, 'd'), 'dynasty-card-name');
		expect(num(dName, 'y')).toBeCloseTo(dBox.y + cardText(geo, 1, false, { title: false, dates: false }).nameBaseline, 9);
		const aBox = laid.layout.persons.get('a')!;
		const [aName] = withClass(card(root, 'a'), 'dynasty-card-name');
		// `a` has no relation word, so its text is centred in the whole card (D177 item 10).
		expect(num(aName, 'y')).toBeCloseTo(aBox.y + centredWithoutWord(geo, cardText(geo, 1, false, { title: true, dates: true })).nameBaseline, 9);
		// The title and dates lines of `a` sit one small line apart.
		const [title] = withClass(card(root, 'a'), 'dynasty-card-title');
		const [dates] = withClass(card(root, 'a'), 'dynasty-card-dates');
		expect(num(title, 'y')).toBeCloseTo(aBox.y + centredWithoutWord(geo, cardText(geo, 1, false, { title: true, dates: true })).titleBaseline, 9);
		expect(num(dates, 'y')).toBeCloseTo(aBox.y + centredWithoutWord(geo, cardText(geo, 1, false, { title: true, dates: true })).datesBaseline, 9);
	});

	it('the text card keeps its text at the left (padX) and has no centring class', () => {
		const laid = lay(TEXT, { relationLine: true });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		const box = laid.layout.persons.get('a')!;
		const el = card(root, 'a');
		expect(el.hasClass('dynasty-card-r1')).toBe(false);
		expect(el.hasClass('dynasty-card-tc')).toBe(true);
		const [name] = withClass(el, 'dynasty-card-name');
		expect(num(name, 'x')).toBe(box.x + 0.875 * 12);
		const [word] = withClass(card(root, 'b'), 'dynasty-card-relation');
		expect(num(word, 'x')).toBe(laid.layout.persons.get('b')!.x + 0.875 * 12);
	});

	it('the styles centre the Roundel text and keep the text card left-aligned', () => {
		const css = readFileSync('styles.css', 'utf8');
		const block = css.slice(css.indexOf('/* roundel: card */'), css.indexOf('/* C: phone list */'));
		expect(block).toMatch(/\.dynasty-card-r1 \.dynasty-card-name[^{]*\{[^}]*text-anchor: middle/);
		expect(block).not.toMatch(/\.dynasty-card-tc[^{]*\{[^}]*text-anchor: middle/);
		expect(block).not.toMatch(/data-relation|dynasty-tip/);
	});
});

describe('the name breaks in the room of `nameRoom` (B.3.2)', () => {
	it('the scene and `tallCardsFor` give a Roundel name the room that `nameRoom` gives, with the border edge of the mark for the marked card', () => {
		const geo = lay(ROUNDEL, { relationLine: true }).layout.geometry;
		const t2 = cardText(geo, 2);
		const nm = (s: string, sob?: boolean) => measure(s, `${sob ? 400 : 700} ${t2.nameSize}px serif`);
		const lines = (n: string, ring?: number) => cardNameLines(n, undefined, nameRoom(geo, t2, true, ring), nm, 3).length;
		// Since D153 the mark is one 3 px border, so its inner edge is 1.5 px in and the D14 sign stays clear of it: the marked card has the
		// room of the other cards. The test pins that both read the same room (and would show a difference if the border grew again).
		let name = 'Aaaaaaaaaaaa Bbbbbbbbbbbbbbbbb Ccccccccccc';
		for (let a = 8; a <= 16; a++) {
			for (let b = 8; b <= 16; b++) {
				const n = ['A'.repeat(a), 'B'.repeat(b), 'C'.repeat(12)].join(' ');
				if (lines(n, ME_RING_INNER) !== lines(n)) name = n;
			}
		}
		const wide = lines(name);
		const narrow = lines(name, ME_RING_INNER);
		const people = build(`options:
  me: m
people:
  - {id: p, name: "${name}", illegitimate: true}
  - {id: m, name: "${name}", illegitimate: true}
`).g;
		const out = tallCardsFor(people, geo, FONTS, measure, new Set(['p', 'm']), undefined, undefined, { marked: 'm' })!;
		const slotsOf = (id: string) => (out.long.includes(id) ? 3 : out.tall.includes(id) ? 2 : 1);
		expect(slotsOf('p')).toBe(wide);
		expect(slotsOf('m')).toBe(narrow);
	});

	it('pictures never narrow a Roundel name: the same slots with and without pictures', () => {
		const geo = lay(ROUNDEL, { relationLine: true }).layout.geometry;
		const name = 'Aaaaaaaaaaaa Bbbbbbbbbbbbbbbbb Ccccccccccc';
		const people = build(`houses:
  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}
people:
  - {id: p, name: "${name}", house: v, portrait: "[[p.png]]"}
  - {id: q, name: "${name}"}
`).g;
		const out = tallCardsFor(people, geo, FONTS, measure)!;
		expect(out.tall.includes('p')).toBe(out.tall.includes('q'));
		expect(out.long.includes('p')).toBe(out.long.includes('q'));
	});

	it('the text card gives the marked, signed card no second slot (no picture boxes)', () => {
		const people = build(`options:
  me: p
people:
  - {id: q, name: Quentin}
  - {id: p, name: Pip, illegitimate: true}
`).g;
		const text = tallCardsFor(people, cardForm(geometryFor(12), 'sideways'), FONTS, measure, new Set(['p']), undefined, undefined, { marked: 'p' })!;
		expect(text.tall).not.toContain('p');
	});
});

describe('the Compact level (B.3.7)', () => {
	it('the Compact name is centred on the axis; its baseline is centred in the body below the crown', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const { root } = scene(laid, { me: 'c' });
		const geo = laid.layout.geometry;
		const f = geo.fontPx;
		for (const id of ['a', 'd']) {
			const box = laid.layout.persons.get(id)!;
			const crown = geo.crown!;
			const [name] = withClass(card(root, id), 'dynasty-card-compact');
			expect(num(name, 'x'), id).toBeCloseTo(box.x + roundelAxis(geo), 9);
			expect(num(name, 'y'), id).toBeCloseTo(box.y + crown + (box.h - crown) / 2 + 0.35 * COMPACT_NAME_EM * f, 9);
		}
	});

	it('the plate and the tab stand in the Full group, which the Compact level hides but for the pictures', () => {
		const laid = lay(ROUNDEL, { relationLine: true, youTab: 'c' });
		const { root } = scene(laid, { me: 'c' });
		for (const el of [...withClass(root, 'dynasty-r1-plate'), ...withClass(root, 'dynasty-r1-tab-group')]) expect(el.parentElement!.hasClass('dynasty-card-full')).toBe(true);
	});

	it('the D14 sign of a signed Roundel card is the one of the Full text at both levels', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const { root } = scene(laid, {});
		const [full] = withClass(card(root, 'b'), 'dynasty-sign').filter((e) => e.parentElement!.hasClass('dynasty-card-full'));
		const [compact] = withClass(card(root, 'b'), 'dynasty-card-compact-sign').flatMap((e) => e.children);
		expect([compact.getAttribute('x1'), compact.getAttribute('y1')]).toEqual([full.getAttribute('x1'), full.getAttribute('y1')]);
	});
});

describe('the sideways text card (B.3.10)', () => {
	it('the plate and the word are left-aligned: the word at `padX`, on the plate, at the raised baseline', () => {
		const laid = lay(TEXT, { relationLine: true });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		const geo = laid.layout.geometry;
			for (const id of ['b', 'd']) {
			expect(withClass(card(root, id), 'dynasty-r1-plate'), id).toHaveLength(1);
		}
		expect(withClass(card(root, 'a'), 'dynasty-r1-plate')).toHaveLength(0);
		const box = laid.layout.persons.get('d')!;
		const [word] = withClass(card(root, 'd'), 'dynasty-card-relation');
		const t = cardText(geo, 1, false, { title: false, dates: false });
		expect(num(word, 'x')).toBe(box.x + 0.875 * 12);
		expect(num(word, 'y')).toBeCloseTo(box.y + t.relationBaseline!, 9);
		expect(laid.layout.persons.get('d')!.h).toBe(58);
	});

	it('plate off: no plate and no word; the tab stands at the text left, 0.9 em above the card, and the tap area covers only it', () => {
		const laid = lay(TEXT, { youTab: 'c' });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		const box = laid.layout.persons.get('c')!;
		expect(withClass(root, 'dynasty-r1-plate')).toHaveLength(0);
		const [tab] = withClass(card(root, 'c'), 'dynasty-r1-tab');
		expect([num(tab, 'x'), num(tab, 'y')]).toEqual([box.x + 0.875 * 12, box.y - 0.9 * 12]);
		const hits = withClass(root, 'dynasty-card-crown-hit');
		expect(hits).toHaveLength(1);
		const r = youTabRect(laid.layout.geometry, false);
		expect(num(hits[0], 'x')).toBeCloseTo(box.x + r.x, 9);
		expect(num(hits[0], 'width')).toBeCloseTo(r.w, 9);
		expect([num(hits[0], 'y'), num(hits[0], 'height')]).toEqual([box.y - laid.layout.geometry.reach!, laid.layout.geometry.reach!]);
		expect(laid.layout.persons.get('d')!.h).toBe(46);
	});

	it('its Compact level has the name at the left, centred on the card height', () => {
		const laid = lay(TEXT, { relationLine: true });
		const { root } = scene(laid, {});
		const box = laid.layout.persons.get('a')!;
		const [name] = withClass(card(root, 'a'), 'dynasty-card-compact');
		expect(num(name, 'x')).toBe(box.x + 0.5 * 12 + 0.5 * 12);
		expect(num(name, 'y')).toBeCloseTo(box.y + box.h / 2 + 0.35 * COMPACT_NAME_EM * 12, 9);
	});

	it('the marked card of a text tree keeps its mark (the border alone, D153) and its relation word "You"', () => {
		const laid = lay(TEXT, { relationLine: true });
		const { root } = scene(laid, { relations: RELATIONS, me: 'c' });
		expect(card(root, 'c').hasClass('dynasty-card-me')).toBe(true);
		expect(withClass(card(root, 'c'), 'dynasty-card-me-ring')).toHaveLength(0);
		expect(withClass(card(root, 'c'), 'dynasty-card-relation')[0].getText()).toBe('You');
	});
});

describe('refit (S4)', () => {
	it('refit again with the same measure keeps every number', () => {
		const laid = lay(ROUNDEL, { relationLine: true, youTab: 'c' });
		const { root, scene: s } = scene(laid, { relations: RELATIONS, me: 'c' });
		const before = serial(root);
		s.refit();
		expect(serial(root)).toBe(before);
	});
});
