import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LaidOut } from '../src/layout/model';
import { buildScene, type Scene, type SceneOptions } from '../src/render/dom/scene';
import type { LineMarks } from '../src/render/line-highlight';
import { boxNearView, pathBox } from '../src/render/view-math';
import { FEl, installDom } from './acceptance/fake-dom';
import { fixtureSource } from './acceptance/load';
import { serial, type Rect } from './acceptance/m11-support';

/*
 * 1.1.1 WP4 (spec §13.15 rule 4): lines and partnership signs of a lazy scene are built when they come near the
 * view. The eager scene and a lazy scene after `fillAll` must be the same bytes, in any order of fills; a line that is
 * partly near is whole; nothing a person can tap is missing (lines and signs have no tap area).
 * Run: npx vitest run tests/v111-cull-scene.test.ts
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

const GEO = geometryFor(16, 'normal');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55);

function graph(id: string): FamilyGraph {
	const r = parseDynasty(fixtureSource(id));
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

interface Built {
	g: FamilyGraph;
	laid: LaidOut;
	root: FEl;
	s: Scene;
}

function build(id: string, lazy: boolean, o: { sideways?: boolean; line?: LineMarks } = {}): Built {
	const g = graph(id);
	clearLayoutCache();
	const settings = { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), ...(o.sideways ? { orientation: 'sideways' as const } : {}) };
	const laid = layoutTree(g, GEO, settings, 'test');
	const root = new FEl('g');
	const options: SceneOptions = {
		fonts: FONTS,
		measure,
		link: () => null,
		...(o.line ? { line: o.line } : {}),
		...(lazy ? { lazyCards: true } : {}),
	};
	return { g, laid, root, s: buildScene(root as unknown as SVGGElement, g, laid, options) };
}

const layer = (b: Built, cls: string) => b.root.children.find((c) => c.hasClass(cls))!;
const lineDs = (b: Built) => layer(b, 'dynasty-lines').children.map((c) => c.getAttribute('d')!);

/** A relation finder's line over one couple and one child of sample tree 6, with the rest faded. */
function marks(g: FamilyGraph): LineMarks {
	const u = g.unions.find((x) => x.children.length > 0)!;
	const child = u.children[0]!;
	return {
		people: new Set([...u.partners, child]),
		unions: new Set([u.key]),
		links: new Set(u.partners.map((p) => `${p}\0${child}`)),
		fade: true,
	};
}

describe('pathBox', () => {
	it('boxes the runs a layout writes, with the pad on every side', () => {
		expect(pathBox('M10 20H50', 2)).toEqual({ x: 8, y: 18, w: 44, h: 4 });
		expect(pathBox('M10 20V80')).toEqual({ x: 10, y: 20, w: 0, h: 60 });
		expect(pathBox('M10 20V50M5 50H95', 0)).toEqual({ x: 5, y: 20, w: 90, h: 30 });
	});

	it('boxes a curve by its control points, so the curve lies inside', () => {
		expect(pathBox('M100 40V60C100 90 20 90 20 120', 0)).toEqual({ x: 20, y: 40, w: 80, h: 80 });
	});

	it('boxes the small shapes of the partnership signs (L and Z)', () => {
		expect(pathBox('M5 0L10 5L5 10L0 5Z')).toEqual({ x: 0, y: 0, w: 10, h: 10 });
	});

	it('reads negative and decimal numbers', () => {
		expect(pathBox('M-5.5 -2H3.25')).toEqual({ x: -5.5, y: -2, w: 8.75, h: 0 });
	});

	it('gives null for what it cannot box: relative commands, arcs, no point, a number before a command', () => {
		expect(pathBox('m10 20h50')).toBeNull();
		expect(pathBox('M0 0A5 5 0 0 1 10 10')).toBeNull();
		expect(pathBox('')).toBeNull();
		expect(pathBox('M')).toBeNull();
		expect(pathBox('10 20')).toBeNull();
		expect(pathBox('H10')).toBeNull();
	});

	it('every path of sample trees 6, 7 and 12 has a box', () => {
		for (const id of ['06', '07', '12']) {
			const b = build(id, false);
			for (const p of b.laid.edges.paths) expect(pathBox(p.d)).not.toBeNull();
		}
	});
});

/** The box by a plain regular expression, written apart from `pathBox` as its check. */
function boxByRegExp(d: string): { x: number; y: number; w: number; h: number } | null {
	const xs: number[] = [];
	const ys: number[] = [];
	let cmd = '';
	let held: number | null = null;
	for (const m of d.matchAll(/([A-Za-z])|(-?(?:\d+\.?\d*|\.\d+))/g)) {
		if (m[1] !== undefined) {
			cmd = m[1];
			held = null;
			continue;
		}
		const v = Number(m[2]);
		if (cmd === 'H') xs.push(v);
		else if (cmd === 'V') ys.push(v);
		else if (held === null) held = v;
		else {
			xs.push(held);
			ys.push(v);
			held = null;
		}
	}
	return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

describe('pathBox on the real lines', () => {
	it('gives the same box as a regular expression for every line of the sample trees 1 to 15', () => {
		let count = 0;
		for (const id of ['01', '02', '03', '04', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15']) {
			let b: Built;
			try {
				b = build(id, false);
			} catch {
				continue;
			}
			for (const p of b.laid.edges.paths) {
				expect(pathBox(p.d)).toEqual(boxByRegExp(p.d));
				count++;
			}
		}
		expect(count).toBeGreaterThan(900);
	});
});

describe('a lazy scene builds no line before a fill', () => {
	it('the lines and markers layers exist and are empty; pendingLines counts what the eager scene draws', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		expect(layer(lazy, 'dynasty-lines').children).toHaveLength(0);
		expect(layer(lazy, 'dynasty-markers').children).toHaveLength(0);
		expect(lazy.root.children.map((c) => [...c.classes][0])).toEqual(eager.root.children.map((c) => [...c.classes][0]));
		expect(lazy.s.fill.pendingLines).toBe(layer(eager, 'dynasty-lines').children.length + layer(eager, 'dynasty-markers').children.length);
		expect(lazy.s.fill.pendingLines).toBeGreaterThan(500);
	});

	it('an eager scene has nothing pending', () => {
		expect(build('06', false).s.fill.pendingLines).toBe(0);
	});

	it('the tag hit layer is still built at once (the tap areas are never delayed)', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		expect(serial(layer(lazy, 'dynasty-tag-hits'))).toBe(serial(layer(eager, 'dynasty-tag-hits')));
		expect(layer(lazy, 'dynasty-tag-hits').children.length).toBeGreaterThan(0);
	});
});

describe('fillAll gives the eager layers byte for byte', () => {
	for (const id of ['06', '07', '04', '12']) {
		it(`sample tree ${id}, down`, () => {
			const eager = build(id, false);
			const lazy = build(id, true);
			lazy.s.fill.fillAll();
			expect(lazy.s.fill.pendingLines).toBe(0);
			expect(serial(lazy.root)).toBe(serial(eager.root));
		});
	}

	it('sample tree 7 sideways', () => {
		const eager = build('07', false, { sideways: true });
		const lazy = build('07', true, { sideways: true });
		lazy.s.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('with the relation finder line and fade (on-line and faded classes, the split pieces)', () => {
		const g = graph('06');
		const line = marks(g);
		const eager = build('06', false, { line });
		const lazy = build('06', true, { line });
		expect(layer(eager, 'dynasty-lines').children.some((c) => c.hasClass('dynasty-on-line'))).toBe(true);
		expect(layer(eager, 'dynasty-lines').children.some((c) => c.hasClass('dynasty-faded'))).toBe(true);
		lazy.s.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('a second fillAll changes nothing', () => {
		const lazy = build('06', true);
		lazy.s.fill.fillAll();
		const before = serial(lazy.root);
		lazy.s.fill.fillAll();
		expect(serial(lazy.root)).toBe(before);
	});
});

describe('fillNear builds the lines and signs near the view', () => {
	const view: Rect = { x: 5000, y: 100, w: 600, h: 250 };

	it('exactly the paths whose box meets the grown view, each whole, in the eager order', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		const expected = eager.laid.edges.paths.map((p) => p.d).filter((d) => boxNearView(pathBox(d, 4)!, view));
		expect(expected.length).toBeGreaterThan(0);
		expect(expected.length).toBeLessThan(eager.laid.edges.paths.length);
		lazy.s.fill.fillNear(view);
		expect(lineDs(lazy)).toEqual(expected);
		// the same d strings as the eager scene: a line that is partly near is complete
		const all = new Set(lineDs(eager));
		for (const d of lineDs(lazy)) expect(all.has(d)).toBe(true);
	});

	it('a line that starts outside the grown view and ends inside it is built whole', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		const edge = { x: 5200, y: 100, w: 20, h: 20 };
		const spanning = eager.laid.edges.paths.map((p) => p.d).filter((d) => {
			const b = pathBox(d, 4)!;
			return boxNearView(b, edge) && (b.x < edge.x - edge.w || b.x + b.w > edge.x + 2 * edge.w);
		});
		expect(spanning.length).toBeGreaterThan(0);
		lazy.s.fill.fillNear(edge);
		for (const d of spanning) expect(lineDs(lazy)).toContain(d);
	});

	it('the signs near the view are built, the others are not', () => {
		const lazy = build('07', true);
		lazy.s.fill.fillNear(view);
		const markers = layer(lazy, 'dynasty-markers').children;
		expect(markers.length).toBeGreaterThan(0);
		expect(markers.length).toBeLessThan(lazy.laid.edges.markers.length);
		expect(lazy.s.fill.pendingLines).toBeGreaterThan(0);
	});

	it('the return value counts cards, tags and badges only', () => {
		const a = build('07', true);
		const b = build('07', true);
		const n = a.s.fill.fillNear(view);
		expect(n).toBe(a.s.cards.size + a.s.tags.length + a.s.badges.length - a.s.fill.pending);
		expect(b.s.fill.pending).toBe(b.s.cards.size + b.s.tags.length + b.s.badges.length);
	});

	it('a repeat call builds nothing and moves nothing', () => {
		const lazy = build('07', true);
		lazy.s.fill.fillNear(view);
		const before = serial(lazy.root);
		const pending = lazy.s.fill.pendingLines;
		lazy.s.fill.fillNear(view);
		expect(serial(lazy.root)).toBe(before);
		expect(lazy.s.fill.pendingLines).toBe(pending);
	});

	it('fills in any order end in the eager bytes: a far view first, then the near one, then the rest', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		lazy.s.fill.fillNear({ x: 8000, y: 300, w: 400, h: 200 });
		lazy.s.fill.fillNear({ x: 0, y: 0, w: 300, h: 100 });
		lazy.s.fill.fillNear({ x: 4000, y: 100, w: 500, h: 300 });
		lazy.s.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('the drawing order inside a layer stays the eager order after partial fills', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		lazy.s.fill.fillNear({ x: 6000, y: 0, w: 300, h: 200 });
		lazy.s.fill.fillNear({ x: 2000, y: 0, w: 300, h: 200 });
		const order = lineDs(eager);
		const got = lineDs(lazy).map((d) => order.indexOf(d));
		expect(got.length).toBeGreaterThan(0);
		expect(got).toEqual([...got].sort((x, y) => x - y));
	});
});

describe('fillPerson builds the lines that touch the card', () => {
	it('every eager path whose box meets the card is built', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		const id = [...lazy.s.cards.keys()][150]!;
		const box = lazy.laid.layout.persons.get(id)!;
		const touching = eager.laid.edges.paths.map((p) => p.d).filter((d) => {
			const b = pathBox(d, 4)!;
			return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
		});
		expect(touching.length).toBeGreaterThan(0);
		lazy.s.fill.fillPerson(id);
		for (const d of touching) expect(lineDs(lazy)).toContain(d);
		expect(lineDs(lazy).length).toBeLessThan(eager.laid.edges.paths.length / 4);
	});

	it('an unknown id builds nothing and gives false', () => {
		const lazy = build('07', true);
		const n = lazy.s.fill.pendingLines;
		expect(lazy.s.fill.fillPerson('nobody-here')).toBe(false);
		expect(lazy.s.fill.pendingLines).toBe(n);
	});
});

describe('fillChunk builds the lines nearest the view with the cards, and they end together', () => {
	it('chunks of 25 reach pending 0 and pendingLines 0 in the same call, and the result is the eager scene', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		const view: Rect = { x: 300, y: 100, w: 400, h: 200 };
		let calls = 0;
		let linesEarly = false;
		while (lazy.s.fill.pending > 0 && calls < 200) {
			lazy.s.fill.fillChunk(view, 25);
			calls++;
			if (lazy.s.fill.pending === 0 && lazy.s.fill.pendingLines > 0) linesEarly = true;
		}
		expect(lazy.s.fill.pending).toBe(0);
		expect(linesEarly).toBe(false);
		expect(lazy.s.fill.pendingLines).toBe(0);
		expect(calls).toBeGreaterThan(10);
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('the lines come in steps, not all at once', () => {
		const lazy = build('07', true);
		const total = lazy.s.fill.pendingLines;
		lazy.s.fill.fillChunk({ x: 300, y: 100, w: 400, h: 200 }, 25);
		const left = lazy.s.fill.pendingLines;
		expect(left).toBeLessThan(total);
		expect(left).toBeGreaterThan(total / 2);
	});

	it('the first chunk builds the line nearest the view centre', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		const at = { x: 6000, y: 120, w: 2, h: 2 };
		lazy.s.fill.fillChunk(at, 1);
		const cx = at.x + at.w / 2;
		const cy = at.y + at.h / 2;
		const dist = (d: string) => {
			const b = pathBox(d, 4)!;
			return (b.x + b.w / 2 - cx) ** 2 + (b.y + b.h / 2 - cy) ** 2;
		};
		const nearest = [...lineDs(eager)].sort((a, b) => dist(a) - dist(b))[0]!;
		expect(lineDs(lazy)).toContain(nearest);
	});

	it('with no card left, a chunk still builds lines and they finish', () => {
		const eager = build('07', false);
		const lazy = build('07', true);
		for (const id of lazy.s.cards.keys()) lazy.s.fill.fillPerson(id);
		expect(lazy.s.fill.pending).toBe(0);
		const start = lazy.s.fill.pendingLines;
		expect(start).toBeGreaterThan(0);
		lazy.s.fill.fillChunk({ x: 0, y: 0, w: 100, h: 100 }, 10);
		expect(lazy.s.fill.pendingLines).toBeLessThan(start);
		let calls = 0;
		while (lazy.s.fill.pendingLines > 0 && calls < 100) {
			lazy.s.fill.fillChunk({ x: 0, y: 0, w: 100, h: 100 }, 10);
			calls++;
		}
		expect(lazy.s.fill.pendingLines).toBe(0);
		lazy.s.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});
});
