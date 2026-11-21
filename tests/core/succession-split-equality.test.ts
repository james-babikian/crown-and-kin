/*
 * The split of the succession engine (review step 12, lane A) moves code and changes no result. This test runs every sample tree through
 * `successionLine` with every rule, every `inherit` form, every `inherit-through`, every `illegitimate` reading, `adopted` on and off,
 * and the first-holder switch on and off, for a few rulers and three holder lists, and compares a digest of the whole results
 * with the digests recorded from the code before the split (`succession-split-equality.json`).
 * To record again after an owner-approved change of a rule, run with SUCCESSION_EQUALITY_RECORD=1.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { successionLine, type SuccessionSpec } from '../../src/core/succession';
import { INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES } from '../../src/core/succession-keys';
import { hash } from '../../src/core/hash';
import type { Holder, Title } from '../../src/core/types';

vi.setConfig({ testTimeout: 120_000 });

const RECORD = process.env.SUCCESSION_EQUALITY_RECORD === '1';
const FILE = 'tests/core/succession-split-equality.json';
const recorded: Record<string, { calls: number; digest: string }> = RECORD ? {} : JSON.parse(readFileSync(FILE, 'utf8'));

const THROUGH = [undefined, ...INHERIT_THROUGH];
const ILLEGITIMATE = ['no', 'after', 'equal'] as const;

/** The block of a sample note, or null when it does not read. */
function graphOf(file: string) {
	const md = readFileSync(`fixtures/${file}`, 'utf8');
	const body = md.match(/^```kin\r?\n([\s\S]*?)^```/m)?.[1];
	if (body === undefined) return null;
	const r = parseDynasty(body);
	return r.ok ? deriveFamilies(r.tree) : null;
}

const holder = (person: string, index: number, extra: Partial<Holder> = {}): Holder => ({ person, index, ...extra });
const titleOf = (holders: Holder[]): Title => ({ id: 't', name: 'T', plural: 'Ts', holders, index: 0, items: holders.length });

describe('successionLine equals the code before the split', () => {
	const files = readdirSync('fixtures').filter((f) => f.endsWith('.md'));
	for (const file of files) {
		it(file, () => {
			const g = graphOf(file);
			if (!g) return;
			const withParent = g.people.filter((p) => p.parents.some((r) => g.byId.has(r.id)));
			const step = Math.max(1, Math.floor(withParent.length / (g.people.length > 100 ? 2 : 4)));
			const rulers = withParent.filter((_, i) => i % step === 0).slice(0, g.people.length > 100 ? 2 : 4);
			let calls = 0;
			let digest = '';
			for (const r of rulers) {
				const first = r.parents.find((p) => g.byId.has(p.id))!.id;
				const lists: { holders: Holder[]; body: boolean }[] = [
					{ holders: [holder(r.id, 0)], body: false },
					{ holders: [holder(first, 0), holder(r.id, 1)], body: true },
					{ holders: [holder(first, 0, { from: '1000', to: '1100' }), holder(r.id, 1, { from: '1100' })], body: true },
				];
				for (const { holders, body } of lists) {
					const title = titleOf(holders);
					for (const rule of SUCCESSION_RULES)
						for (const inherit of INHERIT_RULES)
							for (const inheritThrough of THROUGH)
								for (const illegitimate of ILLEGITIMATE)
									for (const adopted of [false, true]) {
										const spec: SuccessionSpec = { rule, inherit, illegitimate, adopted, ...(inheritThrough ? { inheritThrough } : {}), ...(body ? { body } : {}) };
										digest = hash(digest + JSON.stringify(successionLine(g, title, spec, 8, 90, 3)));
										calls++;
									}
				}
			}
			if (RECORD) recorded[file] = { calls, digest };
			else expect({ calls, digest }).toEqual(recorded[file]);
		});
	}
	if (RECORD) it('writes the record', () => writeFileSync(FILE, JSON.stringify(recorded, null, '\t') + '\n'));
});
