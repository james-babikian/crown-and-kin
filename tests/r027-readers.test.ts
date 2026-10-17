// Contract 0.2.7 (WP2): the other readers of dates and "died": the house page cell (K.7) and the phone list year (K.5).
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { housePage, houseTableNote } from '../src/core/house-page';
import { parseDynasty } from '../src/core/parse';
import { oldestParent } from '../src/obsidian/phone-list';
import { yearOf } from '../src/core/succession-keys';
import { readdirSync, readFileSync } from 'node:fs';

const graph = (text: string) => {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
};

describe('the house page (K.7)', () => {
	const text = `houses:
  - {id: h, name: House H}
people:
  - {id: a, name: A, house: h, born: 1100, died: 1160}
  - {id: b, name: B, house: h, born: 1130, died: alive, parents: [a]}
  - {id: c, name: C, house: h, born: 1131, died: "?", parents: [a]}
  - {id: d, name: D, house: h, born: 1132, died: No, parents: [a]}
`;
	it('shows an empty cell for an alive word and the text for every other died text', () => {
		const rows = housePage(graph(text), 'h')!.rows;
		expect(Object.fromEntries(rows.map((r) => [r.id, r.died]))).toEqual({ a: '1160', b: '', c: '?', d: '' });
	});
	it('writes the same cells into the table note', () => {
		const note = houseTableNote(housePage(graph(text), 'h')!);
		expect(note).toContain('| B | ');
		expect(note).not.toContain('alive');
	});
});

describe('the phone list oldest person uses yearOf (K.5)', () => {
	it('reads a BC year as earlier than an AD year, and keeps the three or four digit reading', () => {
		const g = graph(`people:
  - {id: a, name: A, born: 50 AD}
  - {id: b, name: B, born: 200 BC}
  - {id: ac, name: Ac, parents: [a]}
  - {id: bc, name: Bc, parents: [b]}
`);
		expect(oldestParent(g)).toBe('b');
		const plain = graph(`people:
  - {id: a, name: A, born: c. 1203}
  - {id: b, name: B, born: 12 May 1199}
  - {id: ac, name: Ac, parents: [a]}
  - {id: bc, name: Bc, parents: [b]}
`);
		expect(oldestParent(plain)).toBe('b');
	});
});

describe('yearOf agrees with the old phone list reader on the sample trees (K.5)', () => {
	it('gives the same year for every born, died, from and to text of sample trees 1 to 15', () => {
		const old = (text: string) => {
			const m = /(?<!\d)\d{3,4}(?!\d)/.exec(text);
			return m ? Number(m[0]) : undefined;
		};
		let texts = 0;
		for (const file of readdirSync('fixtures').filter((f) => f.endsWith('.md'))) {
			const md = readFileSync(`fixtures/${file}`, 'utf8');
			const body = /^```kin\r?\n([\s\S]*?)^```/m.exec(md)?.[1];
			if (body === undefined) continue;
			const parsed = parseDynasty(body);
			if (!parsed.ok) continue;
			const all: string[] = [];
			for (const p of parsed.tree.people) all.push(...[p.born, p.died].filter((x): x is string => x !== undefined));
			for (const t of parsed.tree.titles ?? []) for (const h of t.holders) all.push(...[h.from, h.to].filter((x): x is string => x !== undefined));
			for (const text of all) {
				texts++;
				expect(yearOf(text), `${file}: ${text}`).toBe(old(text));
			}
		}
		expect(texts).toBeGreaterThan(1000);
	});
});
