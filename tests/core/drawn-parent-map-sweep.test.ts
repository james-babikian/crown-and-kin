// `drawnParentMap` and `drawnParents` give the same links in the same order as in 0.5.5 on 1 000 random trees that are full of
// children with three or more parents of mixed types, repeated ids, unknown type words, `placement` keys and `union` keys (contract "Three own
// lines" §1.3: the group and couple readings of 0.5.6 change who is placed where, never what is drawn or in which order).
// The golden file was recorded on the code of 0.5.5. Make it again only on purpose:
// `WRITE_FINGERPRINT=1 npx vitest run tests/core/drawn-parent-map-sweep.test.ts`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParentMap, drawnParents } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { THREE_PARENT_CASES, ORDERS } from '../support/three-parent-cases';
import { randomParentSource as sourceOf } from '../support/parent-trees';

const GOLDEN = new URL('./golden-fingerprint/drawn-parent-map-sweep.json', import.meta.url);
const SEEDS = Array.from({ length: 1000 }, (_, i) => i + 1);
/** Every drawn link of one note as one text. */
function drawnText(source: string): string {
	const parsed = parseDynasty(source);
	if (!parsed.ok) return `error ${parsed.error.code}`;
	const g = deriveFamilies(parsed.tree);
	const map = drawnParentMap(g);
	const lines = g.people.map((p) => {
		const fromMap = (map.get(p.id) ?? []).map((q) => `${q.id}:${q.type}`).join(',');
		const fromFn = drawnParents(g, p.id).map((q) => `${q.id}:${q.type}`).join(',');
		return `${p.id} ${fromMap} | ${fromFn}`;
	});
	return lines.join('\n');
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

function allHashes(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const seed of SEEDS) out[`seed ${seed}`] = hashOf(drawnText(sourceOf(seed)));
	// The case table of the contract, in every list order.
	for (const c of THREE_PARENT_CASES) for (const order of ORDERS) out[`row ${c.row} ${order.join('')}`] = hashOf(drawnText(c.source(order)));
	return out;
}

describe('drawnParentMap equals the 0.5.5 drawn links on 1 000 random trees and the case table (contract §1.3)', () => {
	it('keeps every hash of the golden file', () => {
		const now = allHashes();
		if (process.env.WRITE_FINGERPRINT === '1') {
			writeFileSync(GOLDEN, JSON.stringify(now, null, '\t') + '\n');
			return;
		}
		expect(existsSync(GOLDEN)).toBe(true);
		const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
		expect(Object.keys(golden).length).toBeGreaterThanOrEqual(1000);
		const different = Object.keys(golden).filter((k) => golden[k] !== now[k]);
		expect(different.slice(0, 10)).toEqual([]);
	});

	it('has trees with a child of three or more parents of one kind in many seeds', () => {
		let many = 0;
		for (const seed of SEEDS) {
			const parsed = parseDynasty(sourceOf(seed));
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			if ([...g.people].some((p) => (g.placementParents.get(p.id) ?? []).length + g.secondary.filter((s) => s.child === p.id && s.type === g.placementType.get(p.id)).length >= 3)) many++;
		}
		expect(many).toBeGreaterThan(150);
	});
});
