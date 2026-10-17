import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import type { Tree } from '../src/core/types';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LaidOut } from '../src/layout/model';
import type { SceneFill } from '../src/render/dom/scene';
import { buildScene, type Scene, type SceneOptions } from '../src/render/dom/scene';
import { livePictureSlots } from '../src/render/view-math';
import { FEl, installDom } from './acceptance/fake-dom';
import { fixtureSource } from './acceptance/load';
import { boxNearViewOf, serial, visibleRectOf, type Rect } from './acceptance/m11-support';

/*
 * WP 11.0 (spec §13.15 rule 1; `scene.ts` header): the virtualised card
 * content of `buildScene` with `lazyCards`, and `boxNearView`, `visibleRect`. `SceneOptions.lazyCards` and
 * `Scene.fill` are added by WP 11.2, so the tests reach them through casts: until then the lazy tests fail
 * (the shell has all its children, `fill` is missing) and the eager tests pass. The fake DOM stands in for
 * a browser (there is no jsdom in this project). The scene is built on the sixty-person sample tree with
 * arms, portraits, illegitimate signs, a marked person, focus badges and far-couple tags.
 * Run: npx vitest run tests/m11-scene-lazy.test.ts
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	// Obsidian's global `createSvg`, for code that makes the detached holder of the card content.
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

// 0.2.6 (D179): the classic card with the pictures at the lower right is gone. The pictures stand on the Roundel (`ROUNDEL`); a plain geometry draws the text card, which has none.
const GEO = geometryFor(16);
const ROUNDEL = cardForm(geometryFor(16), 'down');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };

/** The measure of a test: one factor for every text, so a test can make every name wider and refit. */
const width = { factor: 0.55 };
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * width.factor);

/** Sample tree 6 with arms on every house, a portrait and an illegitimate mark on some people. */
function graph(): FamilyGraph {
	const r = parseDynasty(fixtureSource('06'));
	if (!r.ok) throw new Error('parse');
	const tree: Tree = {
		...r.tree,
		houses: r.tree.houses.map((h) => ({ ...h, arms: `[[${h.id}.png]]` })),
		people: r.tree.people.map((p, i) => ({
			...p,
			...(i % 5 === 0 ? { portrait: `[[${p.id}.png]]` } : {}),
			// The D14 sign shows on an illegitimate person with no parents listed.
			...(i % 3 === 1 && !p.parents.length ? { illegitimate: true } : {}),
		})),
	};
	return deriveFamilies(tree);
}

function lay(g: FamilyGraph, geo = GEO): LaidOut {
	clearLayoutCache();
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) }, 'test');
}

interface Built {
	g: FamilyGraph;
	laid: LaidOut;
	root: FEl;
	s: Scene;
	/** `Scene.fill`; reading it throws until WP 11.2 adds it. */
	readonly fill: SceneFill;
	tagPeople: string[];
	badgePeople: string[];
}

/** Builds a scene, eager or lazy, on the same graph and layout. */
function build(lazy: boolean, o: { relations?: boolean; pictures?: boolean } = {}): Built {
	const g = graph();
	const laid = lay(g, o.pictures ? ROUNDEL : GEO);
	const ids = [...laid.layout.persons.keys()];
	const tagPeople = [...laid.layout.farTags.values()].map((t) => t.person);
	const badgePeople = [...new Set([...ids.slice(0, 3), ...tagPeople.slice(0, 2), ids[Math.floor(ids.length / 2)], ids[ids.length - 1]])];
	const root = new FEl('g');
	const options: SceneOptions & { lazyCards?: boolean } = {
		fonts: FONTS,
		measure,
		link: (p) => (p.id === ids[1] ? { linktext: 'A note', resolved: true } : null),
		badges: { hidden: new Map(badgePeople.map((id, i) => [id, i + 1])), label: (p, n) => `${p.name}: ${n} more` },
		me: ids[2],
		relations: o.relations === false ? new Map() : new Map(ids.slice(0, 6).map((id) => [id, { text: 'Cousin', lower: 'cousin' }])),
		...(lazy ? { lazyCards: true } : {}),
	};
	const s = buildScene(root as unknown as SVGGElement, g, laid, options);
	return {
		g,
		laid,
		root,
		s,
		get fill(): SceneFill {
			const f = (s as unknown as { fill?: SceneFill }).fill;
			if (!f) throw new Error('Scene.fill does not exist yet (WP 11.2)');
			return f;
		},
		tagPeople,
		badgePeople,
	};
}

const el = (x: unknown) => x as FEl;
const classesOf = (e: FEl) => e.children.map((c) => [...c.classes][0] ?? c.tag);
/** R026 fit: a card's bar, Full group, Compact name, sign and arms are children of its body group; this lists the card's children with the body's children in its place. */
const flatClassesOf = (e: FEl) => e.children.flatMap((c) => (c.hasClass('dynasty-card-body') ? classesOf(c) : [[...c.classes][0] ?? c.tag]));

/** The card elements in card order. */
const cardsOf = (b: Built) => [...b.s.cards.values()].map(el);

describe('the sample scene has every kind of item (precondition of the tests below)', () => {
	it('cards with a house colour, a sign, the marked person, arms and portraits; badges; far-couple tags', () => {
		const b = build(false, { pictures: true });
		const cards = cardsOf(b);
		expect(cards.length).toBeGreaterThan(50);
		expect(cards.some((c) => c.hasClass('dynasty-has-house'))).toBe(true);
		expect(cards.some((c) => c.hasClass('dynasty-signed'))).toBe(true);
		expect(cards.some((c) => c.hasClass('dynasty-card-me'))).toBe(true);
		expect(cards.some((c) => c.hasClass('dynasty-deceased'))).toBe(true);
		expect(b.s.pictures.some((p) => p.kind === 'arms')).toBe(true);
		expect(b.s.pictures.some((p) => p.kind === 'portrait')).toBe(true);
		expect(b.s.badges.length).toBeGreaterThan(2);
		expect(b.s.tags.length).toBeGreaterThan(0);
	});
});

describe('an eager scene is the M10 scene (S1, S4)', () => {
	it('a card has its children in the M10 order: ring, bg, strip, full, compact, [compact-sign], [compact-arms]', () => {
		const b = build(false);
		for (const c of cardsOf(b)) {
			const names = flatClassesOf(c);
			expect(c.children.filter((k) => k.hasClass('dynasty-card-body'))).toHaveLength(1);
			expect(c.children[c.children.length - 1].hasClass('dynasty-card-body')).toBe(true);
			const expected = ['dynasty-card-ring', 'dynasty-card-bg', 'dynasty-card-ribbon', 'dynasty-card-full', 'dynasty-card-compact'];
			const crown = names.filter((n) => n === 'dynasty-card-crown-hit').length;
			expect(names.filter((n) => n !== 'dynasty-card-crown-hit').slice(0, expected.length)).toEqual(expected);
			expect(crown).toBeLessThanOrEqual(1);
			const rest = names.filter((n) => n !== 'dynasty-card-crown-hit').slice(expected.length);
			expect(rest.every((n) => n === 'dynasty-card-compact-sign' || n === 'dynasty-card-compact-arms')).toBe(true);
			expect(rest.filter((n) => n === 'dynasty-card-compact-sign').length).toBe(c.hasClass('dynasty-signed') ? 1 : 0);
		}
	});

	it('the scene has a `fill` that does nothing: pending 0 and every call returns 0 or false', () => {
		const b = build(false);
		expect(b.fill.pending).toBe(0);
		const before = serial(b.root);
		expect(b.fill.fillNear({ x: 0, y: 0, w: 100, h: 100 })).toBe(0);
		expect(b.fill.fillAll()).toBe(0);
		expect(b.fill.fillChunk({ x: 0, y: 0, w: 100, h: 100 }, 10)).toBe(0);
		expect(serial(b.root)).toBe(before);
	});

	it('`lazyCards: false` gives the same tree as no option', () => {
		const a = build(false);
		const g = graph();
		const laid = lay(g);
		const ids = [...laid.layout.persons.keys()];
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, {
			fonts: FONTS,
			measure,
			link: (p) => (p.id === ids[1] ? { linktext: 'A note', resolved: true } : null),
			badges: { hidden: new Map(a.badgePeople.map((id, i) => [id, i + 1])), label: (p, n) => `${p.name}: ${n} more` },
			me: ids[2],
			relations: new Map(ids.slice(0, 6).map((id) => [id, { text: 'Cousin', lower: 'cousin' }])),
			lazyCards: false,
		} as SceneOptions);
		expect(serial(root)).toBe(serial(a.root));
	});
});

describe('S1: the shells of a lazy scene', () => {
	it('a card shell has the attributes, the classes, the house colour and the bg rect, and no other child', () => {
		const eager = build(false);
		const lazy = build(true);
		const e = cardsOf(eager);
		const l = cardsOf(lazy);
		expect(l).toHaveLength(e.length);
		e.forEach((card, i) => {
			const shell = l[i];
			expect(shell.tag).toBe('g');
			expect(shell.hasClass('dynasty-card')).toBe(true);
			expect([...shell.classes]).toEqual([...card.classes]);
			expect([...shell.attrs]).toEqual([...card.attrs]);
			expect([...shell.styleProps]).toEqual([...card.styleProps]);
			for (const k of ['tabindex', 'role', 'aria-label', 'data-person']) expect(shell.getAttribute(k)).toBe(card.getAttribute(k));
			expect(shell.children).toHaveLength(1);
			expect(shell.children[0].tag).toBe('rect');
			expect(shell.children[0].hasClass('dynasty-card-bg')).toBe(true);
			expect(serial(shell.children[0])).toBe(serial(card.children.find((c) => c.hasClass('dynasty-card-bg'))!));
		});
	});

	it('a far-couple tag shell has its attributes and no pill, only its tap strip (0.3.1 fix3); its tap area is in the hit layer at once', () => {
		const eager = build(false);
		const lazy = build(true);
		expect(lazy.s.tags).toHaveLength(eager.s.tags.length);
		lazy.s.tags.forEach((t, i) => {
			const e = eager.s.tags[i];
			expect(t.el.hasClass('dynasty-tag')).toBe(true);
			expect([...el(t.el).attrs]).toEqual([...el(e.el).attrs]);
			expect([...el(t.el).classes]).toEqual([...el(e.el).classes]);
			expect(el(t.el).children).toHaveLength(1);
			expect(el(t.el).children[0]).toBe(el(t.over));
			expect(serial(el(t.over))).toBe(serial(el(e.over)));
			expect(el(t.hit).parentElement).not.toBeNull();
			expect(serial(el(t.hit))).toBe(serial(el(e.hit)));
		});
	});

	it('a focus badge shell has its attributes and its tap disc, and not the circle and the plus; the tap square is built at once in its own layer', () => {
		const eager = build(false);
		const lazy = build(true);
		expect(lazy.s.badges).toHaveLength(eager.s.badges.length);
		lazy.s.badges.forEach((b, i) => {
			const e = eager.s.badges[i];
			expect([...el(b.el).attrs]).toEqual([...el(e.el).attrs]);
			expect(el(b.el).children).toHaveLength(1);
			expect(el(b.el).children[0]).toBe(el(b.disc));
			expect(serial(el(b.disc))).toBe(serial(el(e.disc)));
			expect(el(b.hit).parentElement?.hasClass('dynasty-badge-hits')).toBe(true);
			expect(serial(el(b.hit))).toBe(serial(el(e.hit)));
			expect(b.mark).toEqual(e.mark);
		});
	});

	it('a lazy scene keeps every item in its lists from the build on: cards, tags, badges, links, pictures', () => {
		const eager = build(false);
		const lazy = build(true);
		expect([...lazy.s.cards.keys()]).toEqual([...eager.s.cards.keys()]);
		expect(lazy.s.tags.map((t) => t.tag.person)).toEqual(eager.s.tags.map((t) => t.tag.person));
		expect(lazy.s.badges.map((b) => b.person)).toEqual(eager.s.badges.map((b) => b.person));
		expect(lazy.s.links.size).toBe(eager.s.links.size);
		expect([...lazy.s.links.values()]).toEqual([...eager.s.links.values()]);
	});

	it('the tag hit layer is built at once, as in an eager scene; the lines and markers wait for a fill (0.2.1 rule 4, tests/v111-cull-scene.test.ts)', () => {
		const eager = build(false);
		const lazy = build(true);
		const layer = (b: Built, cls: string) => serial(b.root.children.find((c) => c.hasClass(cls))!);
		expect(layer(lazy, 'dynasty-tag-hits')).toBe(layer(eager, 'dynasty-tag-hits'));
		for (const cls of ['dynasty-lines', 'dynasty-markers']) expect(layer(lazy, cls)).toBe(`<g class="${cls}"></g>`);
		expect(lazy.root.children.map((c) => [...c.classes][0])).toEqual(eager.root.children.map((c) => [...c.classes][0]));
	});
});

describe('S2, S4: fillAll gives the eager tree, byte for byte', () => {
	it('after fillAll the serialised scene is the eager scene', () => {
		const eager = build(false);
		const lazy = build(true);
		expect(serial(lazy.root)).not.toBe(serial(eager.root));
		const n = lazy.fill.fillAll();
		expect(n).toBe(lazy.s.cards.size + lazy.s.tags.length + lazy.s.badges.length);
		expect(serial(lazy.root)).toBe(serial(eager.root));
		expect(lazy.fill.pending).toBe(0);
	});

	it('pending counts the cards, tags and badges that have no content yet', () => {
		const lazy = build(true);
		expect(lazy.fill.pending).toBe(lazy.s.cards.size + lazy.s.tags.length + lazy.s.badges.length);
	});

	it('a second fillAll attaches nothing and changes nothing', () => {
		const lazy = build(true);
		lazy.fill.fillAll();
		const before = serial(lazy.root);
		const childrenBefore = cardsOf(lazy).map((c) => [...c.children]);
		expect(lazy.fill.fillAll()).toBe(0);
		expect(serial(lazy.root)).toBe(before);
		cardsOf(lazy).forEach((c, i) => c.children.forEach((child, k) => expect(child).toBe(childrenBefore[i][k])));
	});

	it('with relations off, the tree is the same as the eager one after fillAll (no relation line)', () => {
		const eager = build(false, { relations: false });
		const lazy = build(true, { relations: false });
		lazy.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('the shell keeps its place: filling never moves a card in the cards layer (Tab order, S10)', () => {
		const lazy = build(true);
		const layer = lazy.root.children.find((c) => c.hasClass('dynasty-cards'))!;
		const order = layer.children.map((c) => c.getAttribute('data-person') + c.tag);
		lazy.fill.fillAll();
		expect(layer.children.map((c) => c.getAttribute('data-person') + c.tag)).toEqual(order);
	});
});

/** The near test of spec §13.15 rule 1 written by hand: `box` meets `view` grown by one view size on every side. */
const near = (box: Rect, view: Rect) => box.x < view.x + 2 * view.w && box.x + box.w > view.x - view.w && box.y < view.y + 2 * view.h && box.y + box.h > view.y - view.h;

/** A card is attached when it has more than its bg rect. */
const attached = (c: FEl) => c.children.length > 1;

describe('S3, S4: fillNear', () => {
	const view: Rect = { x: 500, y: 0, w: 700, h: 250 };

	it('attaches exactly the cards, tags and badges near the view, and returns their number', () => {
		const lazy = build(true);
		const boxes = lazy.laid.layout.persons;
		const expectedCards = [...lazy.s.cards.keys()].filter((id) => near(boxes.get(id)!, view));
		const expectedTags = lazy.s.tags.filter((t) => near(t.tag.hit, view));
		const expectedBadges = lazy.s.badges.filter((b) => near(b.mark, view));
		expect(expectedCards.length).toBeGreaterThan(0);
		expect(expectedCards.length).toBeLessThan(lazy.s.cards.size);
		const n = lazy.fill.fillNear(view);
		expect(n).toBe(expectedCards.length + expectedTags.length + expectedBadges.length);
		for (const [id, card] of lazy.s.cards) expect(attached(el(card))).toBe(expectedCards.includes(id));
		lazy.s.tags.forEach((t) => expect(el(t.el).children.length > 1).toBe(expectedTags.includes(t)));
		lazy.s.badges.forEach((b) => expect(el(b.el).children.length > 1).toBe(expectedBadges.includes(b)));
		expect(lazy.fill.pending).toBe(lazy.s.cards.size + lazy.s.tags.length + lazy.s.badges.length - n);
	});

	it('a repeat call attaches nothing and moves nothing', () => {
		const lazy = build(true);
		lazy.fill.fillNear(view);
		const before = serial(lazy.root);
		const kids = cardsOf(lazy).map((c) => [...c.children]);
		expect(lazy.fill.fillNear(view)).toBe(0);
		expect(serial(lazy.root)).toBe(before);
		cardsOf(lazy).forEach((c, i) => c.children.forEach((child, k) => expect(child).toBe(kids[i][k])));
	});

	it('a wider view then attaches only what is new; a near-filled scene finished by fillAll is the eager scene', () => {
		const eager = build(false);
		const lazy = build(true);
		const a = lazy.fill.fillNear(view);
		const b = lazy.fill.fillNear({ x: 0, y: 0, w: 1800, h: 1200 });
		expect(b).toBeGreaterThan(0);
		lazy.fill.fillAll();
		expect(lazy.fill.pending).toBe(0);
		expect(a).toBeGreaterThan(0);
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('the same test serves every level of detail: a card gets all its content, the compact part too', () => {
		const lazy = build(true);
		lazy.fill.fillNear(view);
		const id = [...lazy.s.cards.keys()].find((k) => near(lazy.laid.layout.persons.get(k)!, view))!;
		const names = flatClassesOf(el(lazy.s.cards.get(id)));
		expect(names).toContain('dynasty-card-full');
		expect(names).toContain('dynasty-card-compact');
		// WP-B8 3: `fillNear` makes no ring; `fillPerson` does, before the bg rect.
		expect(names).not.toContain('dynasty-card-ring');
		lazy.fill.fillPerson(id);
		const asked = flatClassesOf(el(lazy.s.cards.get(id)));
		expect(asked.indexOf('dynasty-card-ring')).toBe(0);
		expect(asked.indexOf('dynasty-card-bg')).toBe(1);
	});
});

describe('S4, S5c to S5f: fillPerson', () => {
	it('attaches the card, the badge and the tags of that person, and nothing else', () => {
		const lazy = build(true);
		const id = lazy.tagPeople.find((p) => lazy.badgePeople.includes(p));
		if (!id) throw new Error('the sample needs a person with a tag and a badge');
		expect(lazy.fill.fillPerson(id)).toBe(true);
		for (const [k, card] of lazy.s.cards) expect(attached(el(card))).toBe(k === id);
		lazy.s.tags.forEach((t) => expect(el(t.el).children.length > 1).toBe(t.tag.person === id));
		lazy.s.badges.forEach((b) => expect(el(b.el).children.length > 1).toBe(b.person === id));
	});

	it('a repeat call attaches nothing; an unknown id gives false and changes nothing', () => {
		const lazy = build(true);
		const id = [...lazy.s.cards.keys()][4];
		lazy.fill.fillPerson(id);
		const before = serial(lazy.root);
		const pending = lazy.fill.pending;
		expect(lazy.fill.fillPerson(id)).toBe(true);
		expect(lazy.fill.fillPerson('nobody-here')).toBe(false);
		expect(serial(lazy.root)).toBe(before);
		expect(lazy.fill.pending).toBe(pending);
	});

	it('the card of a person is the eager card after fillPerson', () => {
		const eager = build(false);
		const lazy = build(true);
		const id = [...lazy.s.cards.keys()][7];
		lazy.fill.fillPerson(id);
		expect(serial(el(lazy.s.cards.get(id)))).toBe(serial(el(eager.s.cards.get(id))));
	});
});

describe('S4, S5g: fillChunk', () => {
	it('attaches at most `max` cards, the nearest to the view first; every call is safe to repeat', () => {
		const lazy = build(true);
		const total = lazy.fill.pending;
		const target = [...lazy.s.cards.keys()][30];
		const box = lazy.laid.layout.persons.get(target)!;
		const view: Rect = { x: box.x + box.w / 2 - 1, y: box.y + box.h / 2 - 1, w: 2, h: 2 };
		const first = lazy.fill.fillChunk(view, 1);
		expect(first).toBeGreaterThan(0);
		expect(first).toBeLessThanOrEqual(1 + lazy.s.tags.length + lazy.s.badges.length);
		expect(attached(el(lazy.s.cards.get(target)))).toBe(true);
		expect([...lazy.s.cards.values()].filter((c) => attached(el(c)))).toHaveLength(1);
		const second = lazy.fill.fillChunk(view, 5);
		expect([...lazy.s.cards.values()].filter((c) => attached(el(c))).length).toBeLessThanOrEqual(6);
		expect(lazy.fill.pending).toBe(total - first - second);
	});

	it('chunks of 25 reach pending 0, and the result is the eager scene', () => {
		const eager = build(false);
		const lazy = build(true);
		const view: Rect = { x: 0, y: 0, w: 300, h: 200 };
		let sum = 0;
		for (let i = 0; i < 100 && lazy.fill.pending > 0; i++) {
			const before = lazy.fill.pending;
			const n = lazy.fill.fillChunk(view, 25);
			sum += n;
			expect(lazy.fill.pending).toBe(before - n);
			if (n === 0) break;
		}
		expect(lazy.fill.pending).toBe(0);
		// WP-B8 3: the focus rings are made by `fillPerson` and `fillAll`, so a chunk-filled scene is the eager scene once `fillAll` has made them.
		lazy.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
		expect(sum).toBeGreaterThan(0);
	});

	it('no chunk attaches more than `max` cards', () => {
		const lazy = build(true);
		let seen = 0;
		for (let i = 0; i < 20; i++) {
			lazy.fill.fillChunk({ x: 100, y: 100, w: 200, h: 100 }, 7);
			const now = [...lazy.s.cards.values()].filter((c) => attached(el(c))).length;
			expect(now - seen).toBeLessThanOrEqual(7);
			seen = now;
		}
		expect(seen).toBeGreaterThan(7);
	});
});

describe('S2: refit, picture slots and the detached content', () => {
	it('the text of a lazy card is cut to fit when the card is filled, not at the build (the first view fills a few of many cards)', () => {
		width.factor = 0.55;
		const lazy = build(true);
		const ids = [...lazy.s.cards.keys()];
		const texts = (id: string) => el(lazy.s.cards.get(id)!).all().filter((e) => e.tag === 'text');
		// Before the fill the detached group of a card has its text elements, and they hold no text yet.
		const detached = (id: string) => texts(id).map((e) => e.text);
		const before = detached(ids[0]!).join('');
		lazy.fill.fillPerson(ids[0]!);
		const after = texts(ids[0]!).map((e) => e.text).join('');
		expect(before).toBe('');
		expect(after.length).toBeGreaterThan(0);
		// A card that was not filled stays empty; the eager scene fits every card at the build.
		expect(texts(ids[ids.length - 1]!).map((e) => e.text).join('')).toBe('');
		lazy.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(build(false).root));
	});

	it('a lazy card fits its text when it is filled, with the measures of that moment, so the fill comes before the measures change back', () => {
		width.factor = 0.55;
		const eager = build(false);
		const lazy = build(true);
		const id = [...lazy.s.cards.keys()][0];
		const beforeText = serial(el(eager.s.cards.get(id)));
		width.factor = 1.4;
		eager.s.refit();
		lazy.s.refit();
		expect(serial(el(eager.s.cards.get(id)))).not.toBe(beforeText);
		// 0.2.8 speed repair: a lazy card fits its text when it is filled, with the measures of that moment, so the fill comes before the measures change back.
		lazy.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
		width.factor = 0.55;
	});

	it('the picture slots exist for every card from the build on, in the same order, and their elements are not in the tree until the card is filled', () => {
		const eager = build(false, { pictures: true });
		const lazy = build(true, { pictures: true });
		expect(lazy.s.pictures.length).toBeGreaterThan(0);
		expect(lazy.s.pictures.map((p) => [p.kind, p.lod, p.person, p.rect])).toEqual(eager.s.pictures.map((p) => [p.kind, p.lod, p.person, p.rect]));
		const inTree = new Set(lazy.root.all());
		for (const p of lazy.s.pictures) expect(inTree.has(el(p.el))).toBe(false);
		lazy.fill.fillAll();
		const after = new Set(lazy.root.all());
		for (const p of lazy.s.pictures) {
			expect(after.has(el(p.el))).toBe(true);
			expect(el(lazy.s.cards.get(p.person)).contains(el(p.el))).toBe(true);
		}
	});

	it('a portrait frame set before the fill is in the card after it', () => {
		const lazy = build(true, { pictures: true });
		const slot = lazy.s.pictures.find((p) => p.kind === 'portrait')!;
		el(slot.frame!).addClass('is-problem');
		lazy.fill.fillPerson(slot.person);
		expect(el(lazy.s.cards.get(slot.person)).contains(el(slot.frame!))).toBe(true);
		expect(el(slot.frame!).hasClass('is-problem')).toBe(true);
	});

	it('the near margin (one view) is larger than the live pictures margin (half a view): a card that owns a live slot is attached by fillNear', () => {
		const lazy = build(true, { pictures: true });
		const first = lazy.s.pictures[0].rect;
		const view: Rect = { x: first.x - 200, y: first.y - 100, w: 500, h: 300 };
		const slots = lazy.s.pictures.map((p) => ({ kind: p.kind, lod: p.lod, rect: p.rect }));
		const live = livePictureSlots(slots, view, 'full');
		expect(live.length).toBeGreaterThan(0);
		lazy.fill.fillNear(view);
		for (const i of live) {
			const p = lazy.s.pictures[i];
			expect(el(lazy.s.cards.get(p.person)).contains(el(p.el))).toBe(true);
		}
		// The near range is at least as wide as the live range.
		expect([...lazy.s.cards.values()].filter((c) => attached(el(c))).length).toBeGreaterThanOrEqual(new Set(live.map((i) => lazy.s.pictures[i].person)).size);
	});
});

describe('S3: boxNearView', () => {
	const view: Rect = { x: 100, y: 100, w: 200, h: 100 };

	it('true when the box meets the view grown by the view width left and right and the view height above and below', async () => {
		const boxNearView = await boxNearViewOf();
		// The grown rectangle is x from -100 to 500 and y from 0 to 300.
		expect(boxNearView({ x: 150, y: 120, w: 20, h: 20 }, view)).toBe(true);
		expect(boxNearView({ x: 490, y: 290, w: 20, h: 20 }, view)).toBe(true);
		expect(boxNearView({ x: 510, y: 150, w: 20, h: 20 }, view)).toBe(false);
		expect(boxNearView({ x: -130, y: 150, w: 40, h: 10 }, view)).toBe(true);
		expect(boxNearView({ x: -150, y: 150, w: 40, h: 10 }, view)).toBe(false);
		expect(boxNearView({ x: 200, y: -15, w: 20, h: 20 }, view)).toBe(true);
		expect(boxNearView({ x: 200, y: -30, w: 20, h: 20 }, view)).toBe(false);
		expect(boxNearView({ x: 200, y: 295, w: 20, h: 20 }, view)).toBe(true);
		expect(boxNearView({ x: 200, y: 310, w: 20, h: 20 }, view)).toBe(false);
	});

	it('a box far away in one direction only is not near', async () => {
		const boxNearView = await boxNearViewOf();
		expect(boxNearView({ x: 150, y: 5000, w: 20, h: 20 }, view)).toBe(false);
		expect(boxNearView({ x: 5000, y: 150, w: 20, h: 20 }, view)).toBe(false);
		expect(boxNearView({ x: -5000, y: -5000, w: 20, h: 20 }, view)).toBe(false);
	});

	it('a box that is larger than the view and covers it is near', async () => {
		const boxNearView = await boxNearViewOf();
		expect(boxNearView({ x: -1000, y: -1000, w: 3000, h: 3000 }, view)).toBe(true);
	});
});

describe('S3: visibleRect', () => {
	it('the layout rectangle that a view shows: the centre is the middle, the size is the viewport over the scale', async () => {
		const visibleRect = await visibleRectOf();
		expect(visibleRect({ scale: 2, cx: 100, cy: 50 }, { w: 400, h: 200 })).toEqual({ x: 0, y: 0, w: 200, h: 100 });
		expect(visibleRect({ scale: 1, cx: 0, cy: 0 }, { w: 300, h: 100 })).toEqual({ x: -150, y: -50, w: 300, h: 100 });
		expect(visibleRect({ scale: 0.5, cx: 500, cy: 400 }, { w: 200, h: 100 })).toEqual({ x: 300, y: 300, w: 400, h: 200 });
	});

	it('null when the scale or the size is not positive', async () => {
		const visibleRect = await visibleRectOf();
		expect(visibleRect({ scale: 0, cx: 0, cy: 0 }, { w: 300, h: 100 })).toBeNull();
		expect(visibleRect({ scale: -1, cx: 0, cy: 0 }, { w: 300, h: 100 })).toBeNull();
		expect(visibleRect({ scale: 1, cx: 0, cy: 0 }, { w: 0, h: 100 })).toBeNull();
		expect(visibleRect({ scale: 1, cx: 0, cy: 0 }, { w: 300, h: 0 })).toBeNull();
		expect(visibleRect({ scale: Number.NaN, cx: 0, cy: 0 }, { w: 300, h: 100 })).toBeNull();
	});
});
