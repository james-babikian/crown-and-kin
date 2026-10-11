// Contract 0.2.7 L.9 (the WP2 fix round): one test or more for each fix. The proofs of the code review are in review-r027-wp2.test.ts.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { successionLine, type SuccessionResult, type SuccessionSpec } from '../src/core/succession';
import { yearOf } from '../src/core/succession-keys';
import { applyOp } from '../src/core/yaml-edit';

const holdersBlock = (h: string[]) => `\ntitles:\n  - id: t\n    name: T\n    holders:\n${h.map((x) => '      - ' + x).join('\n')}\n`;
function run(source: string, spec: Partial<SuccessionSpec> = {}, oldAge = 110): SuccessionResult {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	return successionLine(g, g.titles[0], { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false, ...spec }, 99, oldAge);
}
const PEOPLE = `people:
  - {id: a, name: A, sex: m, born: 1100, died: 1150}
  - {id: b, name: B, sex: m, born: 1125, parents: [a]}
  - {id: c, name: C, sex: m, born: 1150, parents: [b]}
  - {id: d, name: D, sex: m, born: 1175, parents: [c]}
`;

describe('noYear reports only the texts that could change the ruler (L.9)', () => {
	it('a `from` text on an entry before R, and on the entry that did not start, is reported', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: long ago, to: 1150}', '{person: b, from: 1150, to: 1200}', '{person: c, from: soon}']);
		const r = run(src, { year: '1160' });
		expect(r.ruler).toBe('b');
		expect(r.noYear).toEqual([{ id: 'a', what: 'reign', entry: 0 }, { id: 'c', what: 'reign', entry: 2 }]);
	});
	it('a text on an entry beyond the one that did not start is not reported', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: 1100, to: 1200}', '{person: b, from: 1250}', '{person: c, from: soon}']);
		expect(run(src, { year: '1160' }).noYear).toEqual([]);
	});
	it('the entry that did not start is reported when its `from` has no year (it could change R)', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: 1100, to: 1200}', '{person: b, from: soon}']);
		const r = run(src, { year: '1160' });
		expect(r.ruler).toBe('a');
		expect(r.noYear).toEqual([{ id: 'b', what: 'reign', entry: 1 }]);
	});
	it('R\'s own `to` is not reported when the title names the year; the `to` of an earlier entry is', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: 1100, to: unknown}', '{person: b, from: 1150, to: "at his death"}', '{person: c, from: 1250}']);
		expect(run(src, { year: '1160' }).noYear).toEqual([{ id: 'a', what: 'reign', entry: 0 }]);
	});
	it('with a year in the title, a text on the last entry is not reported', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: 1100, to: 1150}', '{person: b, from: 1150, to: "at his death"}']);
		expect(run(src, { year: '1160' }).noYear).toEqual([]);
	});
	it('with no year in the title, an unreadable `to` of the last entry is reported (the line is for "now")', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: 1100, to: 1150}', '{person: b, from: 1150, to: "at his death"}']);
		expect(run(src).noYear).toEqual([{ id: 'b', what: 'reign', entry: 1 }]);
	});
	it.each(['present', 'now', 'current', 'ongoing', 'living', 'alive', 'reigning', ' Present ', 'ALIVE'])('the `to` word "%s" is an open end and is never reported', (word) => {
		const src = PEOPLE + holdersBlock(['{person: a, from: 1100, to: 1150}', `{person: b, from: 1150, to: "${word}"}`]);
		expect(run(src).noYear).toEqual([]);
		expect(run(src, { year: '1160' }).noYear).toEqual([]);
	});
	it('an open-end word in `from` is still reported (only `to` has open ends)', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: present, to: 1150}', '{person: b, from: 1150}']);
		// A Year field: with "now" every entry has started, so no `from` text is read (supervisor ruling at the merge).
		expect(run(src, { year: '1160' }).noYear).toEqual([{ id: 'a', what: 'reign', entry: 0 }]);
	});
	it('one entry is reported once even if both of its texts have no year', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: early, to: late}', '{person: b, from: 1150}']);
		expect(run(src, { year: '1160' }).noYear.filter((n) => n.entry === 0)).toHaveLength(1);
	});
});

describe('a named heir who is not born yet (L.9)', () => {
	const src = PEOPLE + holdersBlock(['{person: b, from: 1150}']);
	it('has the state not-born; a dead one is still not-alive', () => {
		const r = run(src, { year: '1160', heirs: ['d', 'a', 'c'] });
		expect(r.namedHeirs).toEqual([
			{ id: 'd', state: 'not-born' },
			{ id: 'a', state: 'not-alive' },
			{ id: 'c', state: 'first' },
		]);
		expect(r.heirs[0]).toBe('c');
	});
	it('is not-born only when a year is set and the born text has a year', () => {
		expect(run(src, { heirs: ['d'] }).namedHeirs).toEqual([{ id: 'd', state: 'first' }]);
		const nobirth = src.replace('born: 1175', 'born: soon');
		expect(run(nobirth, { year: '1160', heirs: ['d'] }).namedHeirs[0].state).toBe('first');
	});
	it('is checked after the ruler, the excluded and the missing ones', () => {
		const r = run(src, { year: '1160', heirs: ['b', 'zz', 'd', 'd'], exclude: ['d'] });
		expect(r.namedHeirs).toEqual([
			{ id: 'b', state: 'is-ruler' },
			{ id: 'zz', state: 'not-in-tree' },
			{ id: 'd', state: 'excluded' },
		]);
	});
});

describe('a named heir that is repeated is listed once (L.9)', () => {
	it('keeps the first place and one entry', () => {
		const src = PEOPLE + holdersBlock(['{person: a, from: 1100}']);
		const r = run(src, { heirs: ['c', 'd', 'c', 'd', 'c'] });
		expect(r.namedHeirs.map((n) => n.id)).toEqual(['c', 'd']);
		expect(r.heirs.slice(0, 2)).toEqual(['c', 'd']);
	});
});

describe('leftOutNoSex does not count a person that is in the line (L.9)', () => {
	const src = `people:
  - {id: r, name: R, sex: m, born: 1000}
  - {id: x, name: X, born: 1031, parents: [r]}
  - {id: s, name: S, sex: m, born: 1030, parents: [r]}
${holdersBlock(['{person: r}'])}`;
	it('counts the person that men-only leaves out', () => {
		const r = run(src, { inherit: 'men-only' });
		expect(r.heirs).toEqual(['s']);
		expect(r.leftOutNoSex).toBe(1);
	});
	it('does not count it when the second pass of a house form puts it in the line', () => {
		const r = run(src, { inherit: 'men-first-in-house' });
		expect(r.heirs).toEqual(['s', 'x']);
		expect(r.leftOutNoSex).toBe(0);
	});
	it('does not count it when the person is a named heir', () => {
		const r = run(src, { inherit: 'men-only', heirs: ['x'] });
		expect(r.heirs).toEqual(['x', 's']);
		expect(r.leftOutNoSex).toBe(0);
	});
});

describe('the "old" check (L.9)', () => {
	const src = `people:
  - {id: r, name: R, sex: m, born: 1000}
  - {id: o, name: O, sex: m, born: 1010, parents: [r]}
  - {id: y, name: Y, sex: m, born: 1100, parents: [r]}
  - {id: z, name: Z, sex: m, born: 1200, died: 1300}
${holdersBlock(['{person: r}'])}`;
	it('with "now", the reference year is the latest year in the tree (1300), read once', () => {
		expect(run(src).old).toEqual(['o', 'y']);
		expect(run(src, {}, 250).old).toEqual(['o']);
	});
	it('with a year, the reference year is that year; with oldAge 0 there is no check', () => {
		expect(run(src, { year: '1100' }, 80).old).toEqual(['o']);
		expect(run(src, {}, 0).old).toEqual([]);
	});
	it('an heir with a death date is never old', () => {
		expect(run(src.replace('born: 1010,', 'born: 1010, died: 1050,')).old).toEqual(['y']);
	});
});

describe('co-rulers (L.9: the years are read once; the answer is the same as the plain loop)', () => {
	// The plain version of K.6, as written before the fix round.
	function plain(entries: { person: string; from?: string; to?: string }[], R: string, Y: number | null): string[] {
		let maxTo = -Infinity;
		const started = entries.map((h) => {
			const from = yearOf(h.from);
			const s = Y === null ? true : from !== undefined ? from <= Y : !(maxTo > Y);
			const to = yearOf(h.to);
			if (to !== undefined) maxTo = Math.max(maxTo, to);
			return s;
		});
		const out: string[] = [];
		entries.forEach((e, i) => {
			if (e.person === R || out.includes(e.person)) return;
			const from = yearOf(e.from);
			if (from === undefined || (Y !== null && from > Y)) return;
			const to = yearOf(e.to);
			let ended = to !== undefined && (Y === null || to <= Y);
			if (to === undefined) {
				for (let j = i + 1; j < entries.length && !ended; j++) {
					const next = yearOf(entries[j].from);
					if (started[j] && (next === undefined || next > from)) ended = true;
				}
			}
			if (!ended) out.push(e.person);
		});
		return out;
	}
	it('William and Mary rule together; a handover is no co-rule', () => {
		const people = ['people:', ...['w', 'm', 'j'].map((id) => `  - {id: ${id}, name: ${id.toUpperCase()}}`)].join('\n');
		const together = people + holdersBlock(['{person: j, from: 1685, to: 1688}', '{person: w, from: 1689}', '{person: m, from: 1689}']);
		expect(run(together).coRulers).toEqual(['w']);
		const handover = people + holdersBlock(['{person: j, from: 1685, to: 1688}', '{person: w, from: 1688}']);
		expect(run(handover).coRulers).toEqual([]);
	});
	it('gives the same answer as the plain loop on 300 random lists', () => {
		let seed = 99;
		const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
		for (let t = 0; t < 300; t++) {
			const n = 2 + Math.floor(rnd() * 6);
			const entries = Array.from({ length: n }, () => {
				const from = rnd() < 0.2 ? undefined : String(1000 + Math.floor(rnd() * 8) * 10);
				const to = rnd() < 0.4 ? undefined : String(1000 + Math.floor(rnd() * 10) * 10);
				return { person: `p${Math.floor(rnd() * 4)}`, ...(from ? { from } : {}), ...(to ? { to } : {}) };
			});
			const people = ['people:', ...[0, 1, 2, 3].map((i) => `  - {id: p${i}, name: P${i}}`)].join('\n');
			const text = (e: (typeof entries)[number]) => `{person: ${e.person}${e.from ? `, from: ${e.from}` : ''}${e.to ? `, to: ${e.to}` : ''}}`;
			const src = people + holdersBlock(entries.map(text));
			const year = rnd() < 0.5 ? undefined : String(1000 + Math.floor(rnd() * 10) * 10);
			const r = run(src, year ? { year } : {});
			if (r.kind !== 'line') continue;
			expect(r.coRulers, `${src} year ${year}`).toEqual(plain(entries, r.ruler!, r.year));
		}
	});
});

describe('a comment on a curly-quoted list item stays when the list is changed (L.9)', () => {
	const text = (items: string[]) =>
		['titles:', '  - id: duke', '    name: Duke', '    exclude:', ...items, '    holders: [aldric]', 'people:', '  - {id: aldric, name: Aldric}', '  - {id: hugo, name: Hugo}', '  - {id: wren, name: Wren}', ''].join('\n');
	it('keeps the comment and the written item when another id is added', () => {
		const t = text(['      - “hugo” # first', '      - wren']);
		const r = applyOp(t, { kind: 'edit-title', id: 'duke', exclude: ['wren', 'hugo', 'aldric'] });
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.body).toContain('# first');
			expect(r.body).toContain('“hugo”');
		}
	});
	it('keeps the comment when the item is removed from another place in the list', () => {
		const t = text(['      - “hugo” # first', '      - wren # second']);
		const r = applyOp(t, { kind: 'edit-title', id: 'duke', exclude: ['hugo'] });
		expect(r.ok && r.body).toContain('# first');
	});
});

describe('the refusal text for the illegitimate value (J.10, L.9)', () => {
	it('names the box “Illegitimate”', () => {
		const t = ['titles:', '  - id: duke', '    name: Duke', '    holders: []', ''].join('\n');
		const r = applyOp(t, { kind: 'edit-title', id: 'duke', inheritIllegitimate: 'maybe' as never });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.detail).toContain('with the box “Illegitimate” ticked');
			expect(r.detail).not.toMatch(/outside a marriage/);
		}
	});
});
