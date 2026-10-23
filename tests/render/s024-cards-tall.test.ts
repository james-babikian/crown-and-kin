import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { foldFamilies, foldHidden } from '../../src/core/folds';
import { parseDynasty } from '../../src/core/parse';
import type { CardLabel } from '../../src/core/titles';
import { geometryFor } from '../../src/layout/geometry';
import { couldBeSigned, illegitimateSigns } from '../../src/layout/illegitimate-sign';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { parseBreakList } from '../../src/render/break-words';
import { sameTall, tallCardsFor } from '../../src/render/dom/tall-cards';
import { sampleSources } from '../acceptance/m11-support';
import { build } from '../support/helpers';

// 0.2.4 (contract 4.1, 4.3, 8.3): `tallCardsFor` with the name room, the name slots and the `couldBeSigned` rule. 0.2.6 (D179): rule B (the lift) and the D129 slot are gone.

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
/** Every character is 0.5 em wide in every font, so the widths are plain arithmetic: 6.8 px at 13.6 px. */
const measure = (s: string, font: string) => [...s].length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const label = (name: string, extra: Partial<CardLabel> = {}): CardLabel => ({ holdings: [], selected: false, name, ...extra }) as CardLabel;
const tree = (src: string): FamilyGraph => build(src).g;
const WHOLE = geometryFor(16);
const EMPTY = { tall: [], long: [] };

/** A tree of one person `a` (and more, if `extra`), whose name text is set after parsing (a name with spaces needs no quoting). */
function one(name: string, extra = ''): FamilyGraph {
	const g = tree(`people:\n  - {id: a, name: Placeholder${extra}}\n`);
	(g.byId.get('a') as { name: string }).name = name;
	return g;
}

describe('tallCardsFor: the name room and the slots', () => {
	it('the sobriquet is one part: it takes a text line of its own when the name fills the first', () => {
		const g = tree('people:\n  - {id: a, name: Aldric}\n');
		// 23 characters (156.4 px) fit the 158 px line; the sobriquet (10 characters more) goes to a second text line.
		expect(tallCardsFor(g, WHOLE, FONTS, measure, undefined, new Map([['a', label('Aldrimonalot Fitzgerald', { sobriquet: 'the Wise' })]]))?.tall).toEqual(['a']);
		expect(tallCardsFor(g, WHOLE, FONTS, measure, undefined, new Map([['a', label('Aldrimonalot Fitzgerald')]]))).toEqual(EMPTY);
		// A sobriquet in `Person.sobriquet` counts the same when the label has none.
		const g2 = tree('people:\n  - {id: a, name: Aldric}\n');
		(g2.byId.get('a') as { name: string; sobriquet?: string }).name = 'Aldrimonalot Fitzgerald';
		(g2.byId.get('a') as { sobriquet?: string }).sobriquet = 'the Wise';
		expect(tallCardsFor(g2, WHOLE, FONTS, measure)?.tall).toEqual(['a']);
	});

	it('a name of three text lines drops the sobriquet completely: it adds no text line (D127)', () => {
		const g = tree('people:\n  - {id: a, name: Aldric}\n');
		const name = 'Alexandrovichs Bartholomewson Cadwalladerson';
		const without = tallCardsFor(g, WHOLE, FONTS, measure, undefined, new Map([['a', label(name)]]))!;
		const withSob = tallCardsFor(g, WHOLE, FONTS, measure, undefined, new Map([['a', label(name, { sobriquet: 'the Wise and Mighty' })]]))!;
		expect(without.long).toEqual(['a']);
		expect(withSob.long).toEqual(['a']);
	});

	it('a person with a sobriquet and no name text is skipped: no name, no sobriquet (D122)', () => {
		const g = one('');
		const labels = new Map([['a', label('', { sobriquet: 'the Wise and Mighty One of the North' })]]);
		expect(tallCardsFor(g, WHOLE, FONTS, measure, undefined, labels)).toEqual(EMPTY);
	});

	it('the owner list changes the answer, and with it the layout key (D118, contract 5.3)', () => {
		// 38 letters, 258.4 px: the simple rule breaks "Alexandrovichsmarino-vichalexandrovichs" in two text lines; the list "Alexandrov-ic-hsmarinovichalexandro-vichs" needs three.
		const g = one('Alexandrovichsmarinovichalexandrovichs');
		const plain = tallCardsFor(g, WHOLE, FONTS, measure)!;
		const listed = tallCardsFor(g, WHOLE, FONTS, measure, undefined, undefined, undefined, { breaks: parseBreakList('Alexandrov-ic-hsmarinovichalexandro-vichs') })!;
		expect([plain.tall, plain.long]).toEqual([['a'], []]);
		expect([listed.tall, listed.long]).toEqual([['a'], ['a']]);
		expect(sameTall(plain.long, listed.long)).toBe(false);
		const key = (r: typeof plain) => layoutKey(g, WHOLE, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: r.tall, longNames: r.long } as LayoutSettings, 'x');
		expect(key(plain)).not.toBe(key(listed));
		// A list that does not hold the word changes nothing.
		expect(tallCardsFor(g, WHOLE, FONTS, measure, undefined, undefined, undefined, { breaks: parseBreakList('Ald-ric') })).toEqual(plain);
	});

	it('people in `skip` are left out; sameTall compares the answers', () => {
		const g = tree('people:\n  - {id: a, name: Placeholder}\n  - {id: b, name: Placeholder}\n');
		for (const id of ['a', 'b']) (g.byId.get(id) as { name: string }).name = 'Aldrimonalot Fitzgerald Bartholomewson';
		expect(tallCardsFor(g, WHOLE, FONTS, measure, undefined, undefined, new Set(['a']))?.tall).toEqual(['b']);
		expect(sameTall(['a'], ['a'])).toBe(true);
		expect(sameTall(['a'], [])).toBe(false);
		expect(sameTall(undefined, [])).toBe(true);
	});
});

describe('tallCardsFor: the D14 sign and the `couldBeSigned` rule', () => {
	const SRC = `people:
  - {id: p, name: Pa}
  - {id: a, name: Aldric, illegitimate: true}
  - {id: b, name: Bertram, illegitimate: true, parents: [p]}
  - {id: c, name: Cedric, parents: [p]}
`;

	it('couldBeSigned: illegitimate with no birth-type placement parent (or only adoptive or ward ones)', () => {
		const g = tree(`people:
  - {id: p, name: Pa}
  - {id: a, name: A, illegitimate: true}
  - {id: b, name: B, illegitimate: true, parents: [p]}
  - {id: c, name: C, illegitimate: true, parents: [{id: p, type: adoptive}]}
  - {id: d, name: D, illegitimate: true, parents: [{id: p, type: ward}]}
  - {id: e, name: E, parents: [p]}
`);
		expect(g.people.filter((p) => couldBeSigned(g, p)).map((p) => p.id)).toEqual(['a', 'c', 'd']);
	});

	it('without the signs the answer is `undefined` only because of a person who could be signed', () => {
		// A whole card: the sign changes no slot of a short name, so no second pass.
		expect(tallCardsFor(tree(SRC), WHOLE, FONTS, measure)).toEqual(EMPTY);
		// `b` has birth parents and is never signed: counted unsigned, no second pass, also with a long name.
		const onlyB = tree('people:\n  - {id: p, name: Pa}\n  - {id: b, name: Bertram, illegitimate: true, parents: [p]}\n  - {id: c, name: Cedric, parents: [p]}\n');
		expect(tallCardsFor(onlyB, WHOLE, FONTS, measure)).toEqual(EMPTY);
	});

	it('the D14 sign still narrows the name of a whole card (the two-pass rule of 0.2.3): 23 characters fit 158 px and not 132 px', () => {
		const g = tree('people:\n  - {id: a, name: Placeholder, illegitimate: true}\n  - {id: b, name: Bo}\n');
		(g.byId.get('a') as { name: string }).name = 'Aldrimonalot Fitzgerald';
		expect(tallCardsFor(g, WHOLE, FONTS, measure)).toBeUndefined();
		expect(tallCardsFor(g, WHOLE, FONTS, measure, new Set())?.tall).toEqual([]);
		expect(tallCardsFor(g, WHOLE, FONTS, measure, new Set(['a']))?.tall).toEqual(['a']);
	});

	it('couldBeSigned is a superset of illegitimateSigns on every sample tree, down and sideways, with and without folds', () => {
		const bad: string[] = [];
		for (const s of sampleSources()) {
			const parsed = parseDynasty(s.source);
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const keys = foldFamilies(g).map((f) => f.key);
			const folds = new Set(keys.filter((_, i) => i % 2 === 0));
			const hidden = foldHidden(g, folds);
			const variants: LayoutSettings[] = [
				{ ...DEFAULT_LAYOUT_SETTINGS },
				{ ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' },
				...(hidden.size ? [{ ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [...hidden].sort(), foldedFamilies: [...folds].sort(), foldControls: true as const }] : []),
			];
			for (const v of variants) {
				clearLayoutCache();
				const laid = layoutTree(g, WHOLE, v, 'font');
				for (const id of illegitimateSigns(g, laid.edges)) {
					if (v.foldHidden?.includes(id)) continue;
					if (!couldBeSigned(g, g.byId.get(id)!)) bad.push(`${s.id} ${v.orientation ?? 'down'}: ${id}`);
				}
			}
		}
		expect(bad.slice(0, 8), `${bad.length} violations`).toEqual([]);
	}, 60000);

	it('couldBeSigned is a superset on 400 random trees with cycles, unknown ids, three parents and a placement key', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 400; seed++) {
			const parsed = parseDynasty(randomSource(seed));
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			clearLayoutCache();
			const laid = layoutTree(g, WHOLE, { ...DEFAULT_LAYOUT_SETTINGS }, 'font');
			for (const id of illegitimateSigns(g, laid.edges)) if (!couldBeSigned(g, g.byId.get(id)!)) bad.push(`seed ${seed}: ${id}`);
		}
		expect(bad.slice(0, 8), `${bad.length} violations`).toEqual([]);
	}, 60000);

	it('the cost rule: couldBeSigned flags far fewer people than `illegitimate` in the sample trees, and never fewer than the signed ones', () => {
		let illegitimate = 0;
		let could = 0;
		let signed = 0;
		for (const s of sampleSources()) {
			const parsed = parseDynasty(s.source);
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			illegitimate += g.people.filter((p) => p.illegitimate).length;
			could += g.people.filter((p) => couldBeSigned(g, p)).length;
			clearLayoutCache();
			signed += illegitimateSigns(g, layoutTree(g, WHOLE, { ...DEFAULT_LAYOUT_SETTINGS }, 'font').edges).size;
		}
		expect(could).toBeLessThanOrEqual(illegitimate);
		expect(could).toBeGreaterThanOrEqual(signed);
	}, 60000);
});

/** A small random source in the style of the gate proofs: many illegitimate people, forward references, three parents, unknown ids, a placement key. */
function randomSource(seed: number): string {
	let a = seed >>> 0;
	const rand = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const n = 4 + Math.floor(rand() * 22);
	const people: string[] = [];
	const unions: string[] = [];
	for (let i = 0; i < n; i++) {
		const parents: string[] = [];
		const k = rand() < 0.25 ? 0 : 1 + Math.floor(rand() * 3);
		for (let j = 0; j < k; j++) {
			const p = rand() < 0.1 ? `p${Math.floor(rand() * n)}` : rand() < 0.03 ? 'ghost' : `p${Math.floor(rand() * Math.max(i, 1))}`;
			const r = rand();
			parents.push(r < 0.6 ? p : r < 0.78 ? `{id: ${p}, type: adoptive}` : r < 0.9 ? `{id: ${p}, type: ward}` : `{id: ${p}, type: birth}`);
		}
		const placement = rand() < 0.15 ? `, placement: ${pick(['birth', 'adoptive', 'ward'])}` : '';
		people.push(`  - {id: p${i}, name: P${i}, sex: ${rand() < 0.5 ? 'm' : 'f'}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}${rand() < 0.5 ? ', illegitimate: true' : ''}${placement}}`);
		if (i > 0 && rand() < 0.3) unions.push(`  - {partners: [p${i}, p${Math.floor(rand() * i)}]}`);
	}
	return `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}
