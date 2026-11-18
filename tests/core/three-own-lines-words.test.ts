// The relation words, the finder steps and the drawn links of every row of the case table of "Three own lines" (0.5.6, D365 (2)) equal
// the text of 0.5.5, in the four list orders of the parents of N and with the setting "Assume an unknown second parent" on and off
// (contract §5, "Checked in every row"). The golden file `three-own-lines-words.json` was recorded on the code of 0.5.5, before the change.
// Make it again only on purpose: `WRITE_FINGERPRINT=1 npx vitest run tests/core/three-own-lines-words.test.ts`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParentMap } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import { ORDERS, THREE_PARENT_CASES, type ThreeParentCase } from '../support/three-parent-cases';

const GOLDEN = new URL('./three-own-lines-words.json', import.meta.url);
const SETTINGS: [string, RelationOptions][] = [
	['on', { oneParentUnknown: true }],
	['off', { oneParentUnknown: false }],
];

/** The texts of one run: the words of every ordered pair, the finder answer of every ordered pair, and the drawn links of every child. */
function runTexts(source: string, options: RelationOptions): { words: string; finder: string; drawn: string } {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(parsed.error.code);
	const g = deriveFamilies(parsed.tree);
	const ids = g.people.map((p) => p.id);
	const words: string[] = [];
	for (const from of ids) {
		const rels = computeRelations(g, from, options);
		for (const to of ids) {
			if (to === from) continue;
			const list = rels.get(to);
			words.push(`${from}>${to}: ${list ? list.map((r) => r.text + (r.maybe ? `, maybe ${r.maybe.effect}` : '')).join(' | ') : '(none)'}`);
		}
	}
	const finder: string[] = [];
	for (const a of ids) {
		for (const b of ids) {
			if (a === b) continue;
			const f = findRelation(g, a, b, options);
			const steps = f.kind === 'named' ? f.relations.map((x) => x.steps.map((s) => `${s.person}:${s.of}:${s.word}`).join('/')).join(' | ') : f.kind === 'chain' ? f.steps.map((s) => `${s.person}:${s.of}:${s.word}`).join('/') : '';
			finder.push(`${a}>${b}: ${f.kind} ${steps}`);
		}
	}
	const map = drawnParentMap(g);
	const drawn = ids.map((id) => `${id}: ${(map.get(id) ?? []).map((q) => `${q.id}:${q.type}`).join(',')}`);
	return { words: words.join('\n'), finder: finder.join('\n'), drawn: drawn.join('\n') };
}

function record(c: ThreeParentCase, order: readonly string[]): Record<string, string> {
	const out: Record<string, string> = {};
	const source = c.source(order);
	for (const [name, options] of SETTINGS) {
		const t = runTexts(source, options);
		out[`${c.row} ${order.join('')} words ${name}`] = t.words;
		out[`${c.row} ${order.join('')} finder ${name}`] = t.finder;
		if (name === 'on') out[`${c.row} ${order.join('')} drawn`] = t.drawn;
	}
	return out;
}

function everything(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const c of THREE_PARENT_CASES) for (const order of ORDERS) Object.assign(out, record(c, order));
	return out;
}

describe('the words, the finder and the drawn links of the case table equal 0.5.5', () => {
	it('keeps every text of the golden file', () => {
		const now = everything();
		if (process.env.WRITE_FINGERPRINT === '1') {
			writeFileSync(GOLDEN, '{\n' + Object.entries(now).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
			return;
		}
		expect(existsSync(GOLDEN)).toBe(true);
		const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
		expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());
		for (const key of Object.keys(golden)) expect({ key, text: now[key] }).toEqual({ key, text: golden[key] });
	});
});
