import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { findRelation, lineSubgraph } from '../src/core/relations';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { build, fixture } from './helpers';
import { randomTree } from './random-trees';

// M7 correction round (render finding 4): the "?" of a rumoured parent keeps the circle the renderers
// draw (0.5 em in the plugin, 8 px in the headless pictures) and 2 px more clear of every card. A drop
// too short for it moves the "?" on to its sibling bar or its trunk stem.

const SIDE: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' };
const ORIENTATIONS = [
	['down', DEFAULT_LAYOUT_SETTINGS],
	['sideways', SIDE],
] as const;

const room = (font: number) => Math.max(8, 0.5 * font) + 2;

function covered(laid: LaidOut, need: number): string[] {
	const out: string[] = [];
	for (const m of laid.edges.markers.filter((x) => x.kind === 'rumour')) {
		for (const b of laid.layout.persons.values()) {
			const d = Math.hypot(Math.max(b.x - m.x, 0, m.x - b.x - b.w), Math.max(b.y - m.y, 0, m.y - b.y - b.h));
			if (d < need - 0.01) out.push(`"?" at ${m.x.toFixed(1)},${m.y.toFixed(1)} is ${d.toFixed(1)} px from ${b.id}`);
		}
	}
	return out;
}

/** True if the point lies on one of the straight or curved pieces of `d` (curves: near one of 2000 samples). */
function onPath(p: { x: number; y: number }, d: string): boolean {
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(' ').map(Number);
		if (cmd === 'M') {
			[x, y] = n;
			continue;
		}
		if (cmd === 'C') {
			for (let i = 0; i <= 2000; i++) {
				const t = i / 2000;
				const u = 1 - t;
				const qx = u * u * u * x + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4];
				const qy = u * u * u * y + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5];
				if (Math.hypot(qx - p.x, qy - p.y) < 2) return true;
			}
			[x, y] = [n[4], n[5]];
			continue;
		}
		const to = cmd === 'H' ? { x: n[0], y } : { x, y: n[0] };
		if (p.x >= Math.min(x, to.x) - 0.5 && p.x <= Math.max(x, to.x) + 0.5 && p.y >= Math.min(y, to.y) - 0.5 && p.y <= Math.max(y, to.y) + 0.5) return true;
		({ x, y } = to);
	}
	return false;
}

/** Every "?" lies on its rumoured line, or on the trunk (stem and sibling bar) that line hangs from. */
function astray(laid: LaidOut): string[] {
	const rumoured = laid.edges.paths.filter((p) => p.kind === 'rumoured' && p.child !== undefined);
	const marks = laid.edges.markers.filter((m) => m.kind === 'rumour');
	expect(marks).toHaveLength(rumoured.length);
	return marks.flatMap((m, i) => {
		const line = rumoured[i];
		const trunk = laid.edges.paths.find((p) => p.child === undefined && p.parents !== undefined && p.parents.join() === line.parents?.join() && p.union === line.union && p.people.includes(line.child!));
		return onPath(m, line.d) || (trunk && !line.d.includes('C') && onPath(m, trunk.d)) ? [] : [`"?" of ${line.child} at ${m.x.toFixed(1)},${m.y.toFixed(1)} is off its line`];
	});
}

describe('the "?" of a rumoured parent in the finder\'s small tree keeps clear of every card', () => {
	const { g } = build(fixture('12'));
	const smalls: [string, FamilyGraph][] = [];
	for (const a of g.people) {
		for (const b of g.people) {
			if (a.id === b.id) continue;
			const r = findRelation(g, a.id, b.id);
			const lines = r.kind === 'named' ? r.relations.map((x) => x.relation.line) : r.kind === 'chain' ? [r.line] : [];
			for (const line of lines) if (line.links.some((l) => l.type === 'rumoured')) smalls.push([`${a.id} > ${b.id}`, lineSubgraph(g, line)]);
		}
	}

	it('sample tree 12 has lines with a rumoured parent', () => {
		expect(smalls.length).toBeGreaterThan(0);
	});

	for (const [name, settings] of ORIENTATIONS) {
		it(`${name}, fonts 12, 16 and 20 px`, () => {
			const found: string[] = [];
			for (const font of [12, 16, 20]) {
				for (const [pair, small] of smalls) {
					clearLayoutCache();
					const laid = layoutTree(small, geometryFor(font, 'normal'), { ...settings, far: NEVER_FAR_RULE }, 'test');
					for (const f of [...covered(laid, room(font)), ...astray(laid)]) found.push(`${font} px, ${pair}: ${f}`);
				}
			}
			expect(found.slice(0, 8)).toEqual([]);
		});
	}

	it('Leo > Wynn sideways: the drop to Wynn is too short, so the "?" sits on the sibling bar between the trunk and the drop', () => {
		const r = findRelation(g, 'leo', 'wynn');
		const line = r.kind === 'named' ? r.relations[0].relation.line : r.kind === 'chain' ? r.line : undefined;
		clearLayoutCache();
		const laid = layoutTree(lineSubgraph(g, line!), geometryFor(16, 'normal'), { ...SIDE, far: NEVER_FAR_RULE }, 'test');
		const drop = laid.edges.paths.find((p) => p.kind === 'rumoured' && p.child === 'wynn')!;
		const trunk = laid.edges.paths.find((p) => p.child === undefined && p.people.includes('wynn'))!;
		const [m] = laid.edges.markers.filter((x) => x.kind === 'rumour');
		expect(onPath(m, drop.d)).toBe(false);
		expect(onPath(m, trunk.d)).toBe(true);
		const wynn = laid.layout.persons.get('wynn')!;
		// Between the trunk's stem and Wynn's drop, along the bar.
		const stemY = Number(/^M[\d.]+ ([\d.]+)/.exec(trunk.d)![1]);
		expect(m.y).toBeGreaterThan(stemY);
		expect(m.y).toBeLessThanOrEqual(wynn.y + wynn.h / 2 + 0.5);
	});
});

describe('the "?" of a rumoured side link keeps clear of every card (random trees)', () => {
	// A side link between two cards of one row crosses only the 20 px gap between them (nodeGap at
	// 16 px): the "?" takes the gap's middle, 10 px from both up to the sampling step.
	for (const [name, settings] of ORIENTATIONS) {
		it(name, () => {
			const found: string[] = [];
			for (let seed = 1; seed <= 80; seed++) {
				clearLayoutCache();
				const laid = layoutTree(build(randomTree(seed)).g, geometryFor(16, 'normal'), settings, 'test');
				for (const f of [...covered(laid, room(16) - 1), ...astray(laid)]) found.push(`random ${seed}: ${f}`);
			}
			expect(found.slice(0, 8)).toEqual([]);
		});
	}
});
