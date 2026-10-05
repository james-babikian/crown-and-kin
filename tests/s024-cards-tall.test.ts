import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { foldFamilies, foldHidden } from '../src/core/folds';
import { parseDynasty } from '../src/core/parse';
import type { CardLabel } from '../src/core/titles';
import { boxesShown, geometryFor, namesOnlyGeometry, tallExtra, withRelationLine } from '../src/layout/geometry';
import { couldBeSigned, illegitimateSigns } from '../src/layout/illegitimate-sign';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { parseBreakList } from '../src/render/break-words';
import { sameLifted, sameTall, tallCardsFor } from '../src/render/dom/tall-cards';
import { approxMeasure } from '../src/render/svg-string';
import { sampleSources } from './acceptance/m11-support';
import { build } from './helpers';

// 0.2.4 (contract 4.1, 4.3, 8.3): `tallCardsFor` with the name room, the name slots, the lift of rule B and the `couldBeSigned` rule.

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
/** Every character is 0.5 em wide in every font, so the widths are plain arithmetic: 6.8 px at 13.6 px. */
const measure = (s: string, font: string) => [...s].length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const label = (name: string, extra: Partial<CardLabel> = {}): CardLabel => ({ holdings: [], selected: false, name, ...extra }) as CardLabel;
const tree = (src: string): FamilyGraph => build(src).g;
const WHOLE = geometryFor(16, 'normal');
const ONLY = namesOnlyGeometry(WHOLE);
const REL = withRelationLine(WHOLE, { relationLine: true } as never);
const EMPTY = { tall: [], long: [], slots: new Map(), lifted: new Set() };

/** A tree of one person `a` (and more, if `extra`), whose name text is set after parsing (a name with spaces needs no quoting). */
function one(name: string, extra = ''): FamilyGraph {
	const g = tree(`people:\n  - {id: a, name: Placeholder${extra}}\n`);
	(g.byId.get('a') as { name: string }).name = name;
	return g;
}

describe('tallCardsFor: the name room and the slots', () => {
	it('a whole card: the arms box and the portrait never make a name taller (D125 a)', () => {
		const g = one('Aldrimonalotte Fitzgerald Bartholomewson', ', house: v');
		const plain = tallCardsFor(g, WHOLE, FONTS, measure);
		const boxed = tallCardsFor(g, WHOLE, FONTS, measure, undefined, undefined, new Set(['a']), undefined, { portraits: new Set(['a']) });
		expect(boxed?.tall).toEqual(plain?.tall);
		expect(boxed?.long).toEqual(plain?.long);
	});

	it('a names-only card: a name of 19 characters (129.2 px) fits one line with the arms (133.2 px) and needs a second with both boxes (104.4 px); no line ends with "…"', () => {
		const g = one('Aaaaaa Bbbbbbbbbbbb');
		const only = (arms: boolean, portrait: boolean) => tallCardsFor(g, ONLY, FONTS, measure, undefined, undefined, arms ? new Set(['a']) : undefined, undefined, portrait ? { portraits: new Set(['a']) } : undefined)!;
		expect(only(false, false)).toEqual(EMPTY);
		expect(only(true, false)).toEqual(EMPTY);
		// The portrait alone leaves 130 px: 129.2 px still fits.
		expect(only(false, true)).toEqual(EMPTY);
		const both = only(true, true);
		expect(both.tall).toEqual(['a']);
		expect(both.long).toEqual([]);
		expect(both.slots.get('a')).toBe(2);
	});

	it('a bigger name that needs two and then three text lines grows with the boxes, never shrinks; `last` is the room of the last text line only', () => {
		const words = ['Bartholomewson', 'Alexandrovichs', 'Wolfgangsenal', 'Cadwalladerson', 'Mariannemarie', 'Ottaviano', 'Fitzgerald', 'Anne', 'Louis', 'Montgomerie'];
		let seed = 3;
		const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
		let grew = 0;
		for (let k = 0; k < 300; k++) {
			const name = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => words[Math.floor(rand() * words.length)]).join(' ');
			const g = one(name);
			const free = tallCardsFor(g, ONLY, FONTS, measure)!;
			const boxed = tallCardsFor(g, ONLY, FONTS, measure, undefined, undefined, new Set(['a']), undefined, { portraits: new Set(['a']) })!;
			const a = free.slots.get('a') ?? 1;
			const b = boxed.slots.get('a') ?? 1;
			expect(b, name).toBeGreaterThanOrEqual(a);
			expect(b - a, name).toBeLessThanOrEqual(1);
			if (b > a) grew++;
		}
		expect(grew).toBeGreaterThan(5);
	});

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
		expect(withSob.slots.get('a')).toBe(3);
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
		const listed = tallCardsFor(g, WHOLE, FONTS, measure, undefined, undefined, undefined, undefined, { breaks: parseBreakList('Alexandrov-ic-hsmarinovichalexandro-vichs') })!;
		expect([plain.tall, plain.long]).toEqual([['a'], []]);
		expect([listed.tall, listed.long]).toEqual([['a'], ['a']]);
		expect(sameTall(plain.long, listed.long)).toBe(false);
		const key = (r: typeof plain) => layoutKey(g, WHOLE, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: r.tall, longNames: r.long } as LayoutSettings, 'x');
		expect(key(plain)).not.toBe(key(listed));
		// A list that does not hold the word changes nothing.
		expect(tallCardsFor(g, WHOLE, FONTS, measure, undefined, undefined, undefined, undefined, { breaks: parseBreakList('Ald-ric') })).toEqual(plain);
	});

	it('people in `skip` are left out; sameTall and sameLifted compare the answers', () => {
		const g = tree('people:\n  - {id: a, name: Placeholder}\n  - {id: b, name: Placeholder}\n');
		for (const id of ['a', 'b']) (g.byId.get(id) as { name: string }).name = 'Aldrimonalot Fitzgerald Bartholomewson';
		expect(tallCardsFor(g, WHOLE, FONTS, measure, undefined, undefined, undefined, new Set(['a']))?.tall).toEqual(['b']);
		expect(sameLifted(new Set(['a']), new Set(['a']))).toBe(true);
		expect(sameLifted(new Set(['a']), new Set())).toBe(false);
		expect(sameLifted(undefined, new Set())).toBe(true);
	});
});

describe('tallCardsFor: the D14 sign, the name slots of a signed names-only card (D126 3) and the `couldBeSigned` rule', () => {
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

	it('a signed names-only card with a one-line name has two slots: the card is one small text line higher; unsigned, one', () => {
		const g = tree(SRC);
		clearLayoutCache();
		const first = layoutTree(g, ONLY, DEFAULT_LAYOUT_SETTINGS, 'x');
		const signed = illegitimateSigns(g, first.edges);
		expect([...signed]).toEqual(['a']);
		const r = tallCardsFor(g, ONLY, FONTS, measure, signed)!;
		expect(r.tall).toEqual(['a']);
		expect(r.slots.get('a')).toBe(2);
		const laid = layoutTree(g, ONLY, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: r.tall } as LayoutSettings, 'x');
		expect(laid.layout.persons.get('a')!.h).toBe(ONLY.cardH + tallExtra(ONLY));
		expect(laid.layout.persons.get('b')!.h).toBe(ONLY.cardH);
		expect(ONLY.cardH + tallExtra(ONLY)).toBe(67);
		// A whole card keeps its height: the sign changes no slot count there.
		expect(tallCardsFor(g, WHOLE, FONTS, measure, signed)?.tall).toEqual([]);
	});

	it('D129: the Compact card of the marked person who has the sign has two slots and is one small text line higher; every other Compact card, and the Normal card, is as before', () => {
		const COMPACT = geometryFor(16, 'compact');
		const g = tree(SRC);
		clearLayoutCache();
		const signed = illegitimateSigns(g, layoutTree(g, COMPACT, DEFAULT_LAYOUT_SETTINGS, 'x').edges);
		expect([...signed]).toEqual(['a']);
		const marked = tallCardsFor(g, COMPACT, FONTS, measure, signed, undefined, undefined, undefined, { marked: 'a' })!;
		expect(marked.tall).toEqual(['a']);
		expect(marked.long).toEqual([]);
		expect(marked.slots.get('a')).toBe(2);
		const laid = layoutTree(g, COMPACT, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: marked.tall } as LayoutSettings, 'x');
		expect(laid.layout.persons.get('a')!.h).toBe(COMPACT.cardH + tallExtra(COMPACT));
		expect(laid.layout.persons.get('b')!.h).toBe(COMPACT.cardH);
		// The same person, signed but not marked, and the marked person who has no sign: no extra line.
		expect(tallCardsFor(g, COMPACT, FONTS, measure, signed)).toEqual(EMPTY);
		expect(tallCardsFor(g, COMPACT, FONTS, measure, signed, undefined, undefined, undefined, { marked: 'c' })).toEqual(EMPTY);
		// The Normal card keeps its height (and, below 11 px, hides its boxes instead).
		expect(tallCardsFor(g, WHOLE, FONTS, measure, signed, undefined, undefined, undefined, { marked: 'a' })).toEqual(EMPTY);
		// The layout key follows the tall set, so a cached layout of the plain card is never reused for the taller card.
		expect(layoutKey(g, COMPACT, DEFAULT_LAYOUT_SETTINGS, 'x')).not.toBe(layoutKey(g, COMPACT, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: marked.tall } as LayoutSettings, 'x'));
		// Without the signs the answer is `undefined` for a marked person who could be signed: a second layout pass.
		expect(tallCardsFor(g, COMPACT, FONTS, measure, undefined, undefined, undefined, undefined, { marked: 'a' })).toBeUndefined();
		expect(tallCardsFor(g, COMPACT, FONTS, measure, undefined, undefined, undefined, undefined, { marked: 'c' })).toEqual(EMPTY);
	});

	it('D129: the marked, signed Compact card shows its arms box and portrait at every note font (no hiding below 16 px)', () => {
		for (const f of [8, 9, 10, 11, 12, 14, 15, 16]) {
			const geo = geometryFor(f, 'compact');
			expect(boxesShown(geo, true, true), `compact ${f}`).toBe(true);
			expect(boxesShown(geometryFor(f, 'normal'), true, true), `normal ${f}`).toBe(f >= 11);
		}
	});

	it('without the signs the answer is `undefined` only because of a person who could be signed', () => {
		// Names-only: `a` could be signed (no parents): its slots are 1 unsigned and 2 signed.
		expect(tallCardsFor(tree(SRC), ONLY, FONTS, measure)).toBeUndefined();
		// `b` has birth parents and is never signed: counted unsigned, no second pass.
		const onlyB = tree('people:\n  - {id: p, name: Pa}\n  - {id: b, name: Bertram, illegitimate: true, parents: [p]}\n  - {id: c, name: Cedric, parents: [p]}\n');
		expect(tallCardsFor(onlyB, ONLY, FONTS, measure)).toEqual(EMPTY);
		// A whole card: the sign changes no slot of a short name, so no second pass either.
		expect(tallCardsFor(tree(SRC), WHOLE, FONTS, measure)).toEqual(EMPTY);
	});

	it('the D14 sign still narrows the name of a whole card (the two-pass rule of 0.2.3): 23 characters fit 158 px and not 132 px', () => {
		const g = tree('people:\n  - {id: a, name: Placeholder, illegitimate: true}\n  - {id: b, name: Bo}\n');
		(g.byId.get('a') as { name: string }).name = 'Aldrimonalot Fitzgerald';
		expect(tallCardsFor(g, WHOLE, FONTS, measure)).toBeUndefined();
		expect(tallCardsFor(g, WHOLE, FONTS, measure, new Set())?.tall).toEqual([]);
		expect(tallCardsFor(g, WHOLE, FONTS, measure, new Set(['a']))?.tall).toEqual(['a']);
	});

	it('an illegitimate person who is signed in a names-only layout counts with the narrower room of the two-slot card', () => {
		const g = tree('people:\n  - {id: a, name: Placeholder, illegitimate: true}\n');
		// 20 characters = 136 px: fits 158 (unsigned, one slot) and the 132 px of nameWithSignW only on two lines.
		(g.byId.get('a') as { name: string }).name = 'Aaaaaa Bbbbbbbbbbbbbb';
		const unsigned = tallCardsFor(g, ONLY, FONTS, measure, new Set())!;
		const signed = tallCardsFor(g, ONLY, FONTS, measure, new Set(['a']))!;
		expect(unsigned.tall).toEqual([]);
		expect(signed.tall).toEqual(['a']);
		expect(signed.slots.get('a')).toBe(2);
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
				{ ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: 'normal' },
				{ ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: 'narrow' },
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

describe('tallCardsFor: rule B, the lift of the arms box and the portrait (D126 4)', () => {
	const g = () => tree(`houses:\n  - {id: v, name: V, arms: "[[v.png]]"}\npeople:\n  - {id: a, name: Aldric, house: v, portrait: "[[a.png]]", born: 1100, died: 1160, title: Duke}\n  - {id: b, name: Bertram, house: v, portrait: "[[b.png]]"}\n`);
	// 0.45 em per character: "Half-brother, maybe full" is 24 characters = 146.9 px (fits 158, not the 104 px beside the boxes); "Second cousin once removed" 26 = 159.1 px.
	const m = (s: string, font: string) => [...s].length * 0.45 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
	const ARMS = new Set(['a', 'b']);
	const PICS = { portraits: new Set(['a', 'b']) };
	const rel = (text: string) => new Map([['a', { text }], ['b', { text }]]);
	const HALF = 'Half-brother, maybe full';

	it('the acceptance texts with the headless measure: "Half-brother, maybe full" fits the text width (142.5 px of 158), "Second cousin once removed" does not (174.6 px)', () => {
		const font = 'italic 400 13.6px sans-serif';
		expect(approxMeasure(HALF, font)).toBeLessThanOrEqual(158);
		expect(approxMeasure('Second cousin once removed', font)).toBeGreaterThan(158);
	});

	it('"Half-brother, maybe full" is wider than the room beside the boxes and fits the text width: the boxes lift (the card with a title and dates)', () => {
		const r = tallCardsFor(g(), REL, FONTS, m, undefined, undefined, ARMS, undefined, { ...PICS, relations: rel(HALF) })!;
		// Bertram has no title and no dates: his relation text is on the first small text line, above the boxes, so he needs no lift.
		expect([...r.lifted]).toEqual(['a']);
	});

	it('"Second cousin once removed" is wider than the text width: no lift, the word is cut at the room as today', () => {
		const r = tallCardsFor(g(), REL, FONTS, m, undefined, undefined, ARMS, undefined, { ...PICS, relations: rel('Second cousin once removed') })!;
		expect(r.lifted.size).toBe(0);
	});

	it('a text that fits beside the boxes does not lift', () => {
		expect(tallCardsFor(g(), REL, FONTS, m, undefined, undefined, ARMS, undefined, { ...PICS, relations: rel('Brother') })!.lifted.size).toBe(0);
	});

	it('with the relation words hidden (no `relations`), nothing lifts', () => {
		expect(tallCardsFor(g(), REL, FONTS, m, undefined, undefined, ARMS, undefined, PICS)!.lifted.size).toBe(0);
	});

	it('a card with no box does not lift; one box lifts alone (the arms leave 133.2 px, the portrait 130 px: the 146.9 px text is wider)', () => {
		expect(tallCardsFor(g(), REL, FONTS, m, undefined, undefined, undefined, undefined, { relations: rel(HALF) })!.lifted.size).toBe(0);
		expect([...tallCardsFor(g(), REL, FONTS, m, undefined, undefined, undefined, undefined, { ...PICS, relations: rel(HALF) })!.lifted]).toEqual(['a']);
		expect([...tallCardsFor(g(), REL, FONTS, m, undefined, undefined, ARMS, undefined, { relations: rel(HALF) })!.lifted]).toEqual(['a']);
	});

	it('a names-only card never lifts (it has no relation line)', () => {
		expect(tallCardsFor(g(), ONLY, FONTS, m, undefined, undefined, ARMS, undefined, { ...PICS, relations: rel(HALF) })!.lifted.size).toBe(0);
	});

	it('"Show dates" off with a label that has only a reign: the title line goes, the relation text moves up a line and the boxes no longer lift', () => {
		const labels = new Map([['a', label('Aldric', { reign: '1131–1160' })]]);
		const gs = tree(['houses:', '  - {id: v, name: V, arms: "[[v.png]]"}', 'people:', '  - {id: a, name: Aldric, house: v, portrait: "[[a.png]]", born: 1100}', ''].join(String.fromCharCode(10)));
		const opts = { ...PICS, relations: new Map([['a', { text: HALF }]]) };
		// Dates on: the reign line, the years line, then the relation text on the last line beside the boxes: lift.
		expect([...tallCardsFor(gs, REL, FONTS, m, undefined, labels, new Set(['a']), undefined, opts)!.lifted]).toEqual(['a']);
		// Dates off: no reign line; the years line then holds the first small line and the relation text the second, which a lift of one line does not clear: no lift.
		expect(tallCardsFor(gs, REL, FONTS, m, undefined, labels, new Set(['a']), undefined, { ...opts, showDates: false })!.lifted.size).toBe(0);
	});

	it('the lift is made only where the boxes are drawn: never on a marked, signed card below the limit of E4, always from it (every font 8 to 48)', () => {
		const gs = tree('houses:\n  - {id: v, name: V, arms: "[[v.png]]"}\npeople:\n  - {id: a, name: Aldric, house: v, portrait: "[[a.png]]", born: 1100, title: Duke, illegitimate: true}\n');
		for (const size of ['normal', 'compact'] as const)
			for (let f = 8; f <= 48; f++) {
				const geo = withRelationLine(geometryFor(f, size), { relationLine: true } as never);
				const opts = { portraits: new Set(['a']), marked: 'a', relations: new Map([['a', { text: HALF }]]) };
				const r = tallCardsFor(gs, geo, FONTS, m, new Set(['a']), undefined, new Set(['a']), undefined, opts)!;
				const wide = m(HALF, `italic 400 ${0.85 * f}px serif`) > 0; // always true: the text is wider than the room at every font (same em widths)
				expect(wide).toBe(true);
				// No box, no lift: the marked, signed card shows no boxes below the limit.
				if (!boxesShown(geo, true, true)) expect(r.lifted.size, `${size} ${f}`).toBe(0);
			}
	});

	it('the answer for a card whose sign is not yet known: a person who could be signed and whose lift differs asks for the second pass (undefined)', () => {
		const gs = tree('houses:\n  - {id: v, name: V, arms: "[[v.png]]"}\npeople:\n  - {id: a, name: Aldric, house: v, portrait: "[[a.png]]", born: 1100, title: Duke, illegitimate: true}\n');
		// Marked, 10 px: the signed card has no boxes (nothing to lift), the unsigned one lifts.
		const small = withRelationLine(geometryFor(10, 'normal'), { relationLine: true } as never);
		const opts = { portraits: new Set(['a']), marked: 'a', relations: new Map([['a', { text: HALF }]]) };
		const unsigned = tallCardsFor(gs, small, FONTS, m, new Set(), undefined, new Set(['a']), undefined, opts)!;
		const signed = tallCardsFor(gs, small, FONTS, m, new Set(['a']), undefined, new Set(['a']), undefined, opts)!;
		expect(unsigned.lifted.size).toBe(1);
		expect(signed.lifted.size).toBe(0);
		expect(tallCardsFor(gs, small, FONTS, m, undefined, undefined, new Set(['a']), undefined, opts)).toBeUndefined();
	});

	it('the marked, signed card at 10 px has no boxes: its name has the full width (boxes that are not drawn leave no room to the name)', () => {
		const gs = one('Aaaaaa Bbbbbbbbbbbb', ', house: v, illegitimate: true');
		const small = namesOnlyGeometry(geometryFor(10, 'normal'));
		const boxed = tallCardsFor(gs, small, FONTS, measure, new Set(['a']), undefined, new Set(['a']), undefined, { portraits: new Set(['a']) })!;
		const marked = tallCardsFor(gs, small, FONTS, measure, new Set(['a']), undefined, new Set(['a']), undefined, { portraits: new Set(['a']), marked: 'a' })!;
		expect(marked.slots.get('a') ?? 1).toBeLessThanOrEqual(boxed.slots.get('a') ?? 1);
	});

	it('recheckTall: with the fallback measure and then a wider measure the lifted set changes, so the view draws again', () => {
		const narrow = tallCardsFor(g(), REL, FONTS, (s, f) => m(s, f) * 0.5, undefined, undefined, ARMS, undefined, { ...PICS, relations: rel(HALF) })!;
		const wide = tallCardsFor(g(), REL, FONTS, m, undefined, undefined, ARMS, undefined, { ...PICS, relations: rel(HALF) })!;
		expect(narrow.lifted.size).toBe(0);
		expect([...wide.lifted]).toEqual(['a']);
		expect(sameLifted(narrow.lifted, wide.lifted)).toBe(false);
	});
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
