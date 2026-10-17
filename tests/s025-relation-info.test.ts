import { describe, expect, it } from 'vitest';
import type { Relation } from '../src/core/relations';
import { RELINFO, relationInfo, relationSummary } from '../src/render/tree-info';

// 0.2.5 (D146, D147), contract E.2: the pure data of the relation infobox (computer) and strip (phone).
// All names in this file are made up.

const line = { people: [], links: [], unions: [] };
const rel = (text: string, maybe?: Relation['maybe']): Relation => ({ text, lower: text.toLowerCase(), kind: 'blood', distance: 2, line, ...(maybe ? { maybe } : {}) });

const SECOND = rel('Second cousin');
const OTHERS = ['Brother-in-law', 'Third cousin', 'Uncle', 'Aunt', 'Nephew', 'Niece', 'Cousin'].map((t) => rel(t));

describe('relationInfo (E.2)', () => {
	it('nothing or an empty list: kind none', () => {
		for (const rels of [undefined, []]) {
			expect(relationInfo(rels, false)).toEqual({ kind: 'none', value: 'No relation to you in this tree.', others: 0 });
		}
	});

	it('the marked person: kind me, no title, no count', () => {
		expect(relationInfo(undefined, true)).toEqual({ kind: 'me', value: 'This is you.', others: 0 });
		expect(relationInfo([SECOND, ...OTHERS], true).others).toBe(0);
	});

	it('one relation: value without a full stop, no also, no others', () => {
		expect(relationInfo([SECOND], false)).toEqual({ kind: 'relation', value: 'Second cousin', others: 0 });
	});

	it('a relation with Also names three of the others', () => {
		const info = relationInfo([SECOND, OTHERS[0], OTHERS[1], OTHERS[2]], false);
		expect(info.also).toBe('Also: brother-in-law, third cousin, uncle.');
		expect(info.others).toBe(3);
	});

	it('8 relations: 7 others, and Also ends "and 4 more."', () => {
		const info = relationInfo([SECOND, ...OTHERS], false);
		expect(info.others).toBe(7);
		expect(info.also?.endsWith(', and 4 more.')).toBe(true);
	});

	it('a relation with maybe carries the D123 paragraph, from the first relation only', () => {
		const first = rel('Half-brother', { effect: 'half', text: 'Half-brother', lower: 'half-brother', cause: 'rumoured' });
		const info = relationInfo([first, rel('Rumoured brother')], false);
		expect(info.maybe).toBe('If every rumoured link is true, this person is your half-brother.');
		expect(relationInfo([rel('Brother'), first], false).maybe).toBeUndefined();
	});

	it('also and maybe equal relationSummary for every case; value has no full stop for a relation', () => {
		const maybe = rel('Brother', { effect: 'full', text: 'Brother', lower: 'brother', cause: 'rumoured' });
		const cases: [readonly Relation[] | undefined, boolean][] = [
			[undefined, false],
			[[], false],
			[undefined, true],
			[[SECOND], false],
			[[SECOND, ...OTHERS.slice(0, 3)], false],
			[[SECOND, ...OTHERS], false],
			[[maybe, SECOND], false],
		];
		for (const [rels, isMe] of cases) {
			const sum = relationSummary(rels, isMe);
			const info = relationInfo(rels, isMe);
			expect(info.also).toBe(sum.also);
			expect(info.maybe).toBe(sum.maybe);
			if (info.kind === 'relation') expect(info.value.endsWith('.')).toBe(false);
		}
	});

	it('relationSummary keeps its text with the one source RELINFO.title', () => {
		expect(relationSummary([SECOND], false).main).toBe(`${RELINFO.title}: Second cousin.`);
		expect(RELINFO.title).toBe('Relation to you');
	});
});

describe('RELINFO texts', () => {
	it('more gives "7 more" and "1 more"', () => {
		expect(RELINFO.more(7)).toBe('7 more');
		expect(RELINFO.more(1)).toBe('1 more');
	});

	it('the texts follow the STE rules and have no straight quote marks', () => {
		const all = [RELINFO.title, RELINFO.more(7), ...['x'].map(() => relationInfo(undefined, true).value), relationInfo(undefined, false).value];
		for (const t of all) {
			expect(t).not.toMatch(/["']/);
			expect(t.split(/\s+/).length).toBeLessThanOrEqual(20);
			// No "-ing" word and no contraction.
			expect(t).not.toMatch(/\b\w+ing\b/i);
			expect(t).not.toMatch(/n’t\b/i);
		}
	});
});
