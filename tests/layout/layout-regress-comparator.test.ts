// The architecture notes §4.2.7 (the code-reviewer's gate test gate-r031-comparator on scratch/r031-gate). The research lane packer sorted its nets
// with a comparator that had a tolerance (not transitive), so the lane of a net depended on the order the nets were given in. WP-3 wrote `netOrder` of
// lanes.ts as a total order (the starts chained by `TIE`, then the key), so the item was already cured when WP-5a began; this file keeps the proof as
// the pointer, and adds a test with many nets and many input orders. The stage test A13 in an internal test has the same claim for the packer.
import { describe, expect, it } from 'vitest';
import { TIE } from '../../src/layout/geometry';
import { net, netOrder, orderNets, type Net } from '../../src/layout/lanes';

const mk = (key: string, lo: number, hi = lo + 100, topVerts: number[] = [], downVerts: number[] = []): Net => net({ gap: 0, lo, hi, key, kind: 'bar', topVerts, downVerts });

/** A small deterministic shuffle (the tests must not depend on Math.random). */
function shuffled<T>(list: readonly T[], seed: number): T[] {
	const out = [...list];
	let a = seed >>> 0;
	for (let i = out.length - 1; i > 0; i--) {
		a = (Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
		const j = a % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

describe('3.5 rule 5: the lane order does not depend on the order the nets are given in', () => {
	it('the gate case: three nets within 2 TIE, all six input orders give the same lanes', () => {
		const lanesFor = (perm: number[]): string => {
			// lo order c < b < a, key order a < b < c: each neighbouring pair is a tie settled by the key, the first and the last by lo.
			const base = [mk('c', 0 * 0.9 * TIE), mk('b', 1 * 0.9 * TIE), mk('a', 2 * 0.9 * TIE)];
			orderNets(perm.map((i) => base[i]), 4, 7, 'down', 12, 10, []);
			return base.map((n) => `${n.key}:${n.lane}`).join(' ');
		};
		const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
		expect(new Set(perms.map(lanesFor)).size).toBe(1);
	});

	it('netOrder is the same list for 40 input orders of 12 nets whose starts chain within TIE and cluster at a few places', () => {
		// Starts at 0, 0.9 TIE, 1.8 TIE, 2.7 TIE (one place by the chain), at 50 and 50 + 0.5 TIE, and at 100 + k * 0.9 TIE.
		const los = [0, 0.9 * TIE, 1.8 * TIE, 2.7 * TIE, 50, 50 + 0.5 * TIE, 100, 100 + 0.9 * TIE, 100 + 1.8 * TIE, 200, 200 + 0.9 * TIE, 300];
		const nets = los.map((lo, i) => mk(`k${String.fromCharCode(97 + ((i * 7) % 12))}`, lo));
		const want = netOrder(nets).map((n) => n.key);
		for (let seed = 1; seed <= 40; seed++) expect(netOrder(shuffled(nets, seed)).map((n) => n.key)).toEqual(want);
	});

	it('the lanes of 12 nets with verticals are the same for 40 input orders', () => {
		const los = [0, 0.9 * TIE, 1.8 * TIE, 30, 30 + 0.9 * TIE, 60, 80, 80 + 0.9 * TIE, 120, 150, 150 + 0.9 * TIE, 180];
		const make = () => los.map((lo, i) => mk(`n${String(i).padStart(2, '0')}`, lo, lo + 90, [lo + 10], [lo + 40, lo + 80]));
		const lanes = (order: (nets: Net[]) => Net[]) => {
			const nets = make();
			orderNets(order(nets), 9, 7, 'down', 10, 22, []);
			return nets.map((n) => `${n.key}:${n.lane}`).join(' ');
		};
		const want = lanes((x) => x);
		for (let seed = 1; seed <= 40; seed++) expect(lanes((x) => shuffled(x, seed))).toBe(want);
	});
});
