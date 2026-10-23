// 0.3.3 B6 (D268): the short forms of the relation text on a drawn card. The rules R1 to R3, the proof over all 4 837 card texts of the case table
// (no collision, never wider, reverse mapping, words that never change), the cut inside a word (S2), the drawn card (saved picture and live scene,
// each with its own measure, also after a refit), and the proof that the sheet, the screen-reader label and the lists keep the whole text.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations } from '../../src/core/relations';
import { cardLabels } from '../../src/core/titles';
import { cardForm, cardText, geometryFor, withRelationLine } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { fitRelation, relationForms, shortenDegree, shortenGreats, shortenRemoval } from '../../src/render/relation-fit';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg, textWidth } from '../../src/render/svg-string';
import { MAYBE_TEXT, cardRelationText, spokenRelation, splitMaybe } from '../../src/render/tree-info';
import { truncate, truncateWithMaybe } from '../../src/render/view-math';
import { fixtureSource } from '../acceptance/load';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { relationUniverse } from '../support/r033-relation-universe';
import { useFakeDom } from '../support/fake-dom-setup';

const TEXTS: string[] = JSON.parse(readFileSync(fileURLToPath(new URL('../acceptance/r033-relation-texts.json', import.meta.url)), 'utf8'));
const SMALL_PX = 13.6;
const measure = (s: string) => textWidth(s, SMALL_PX, false);
// The width of the relation line of a Roundel at the 16 px note font: the number of the case table (166 px).
const REL_W = cardText(cardForm(withRelationLine(geometryFor(16), { relationLine: true } as LayoutSettings), 'down'), 1).relationW!;
const last = (forms: string[]) => forms[forms.length - 1];
const shortest = (word: string) => last(relationForms(word));

describe('the rules, one by one', () => {
	it('R1: a cousin degree from first to tenth becomes a numeral', () => {
		expect(shortenDegree('First cousin')).toBe('1st cousin');
		expect(shortenDegree('Second cousin once removed')).toBe('2nd cousin once removed');
		expect(shortenDegree('Half seventh cousin 3 times removed')).toBe('Half 7th cousin 3 times removed');
		expect(shortenDegree('Wife’s tenth cousin')).toBe('Wife’s 10th cousin');
		expect(shortenDegree('11th cousin')).toBe('11th cousin');
		expect(shortenDegree('Great-nephew')).toBe('Great-nephew');
	});
	it('R2: a removal becomes a number and keeps the word "removed"', () => {
		expect(shortenRemoval('First cousin once removed')).toBe('First cousin 1× removed');
		expect(shortenRemoval('First cousin twice removed')).toBe('First cousin 2× removed');
		expect(shortenRemoval('Fourth cousin 3 times removed')).toBe('Fourth cousin 3× removed');
		expect(shortenRemoval('Fourth cousin 12 times removed by marriage')).toBe('Fourth cousin 12× removed by marriage');
	});
	it('R3: "great-great-" becomes "2nd great-", a single "great-" stays', () => {
		expect(shortenGreats('Great-great-grandfather')).toBe('2nd great-grandfather');
		expect(shortenGreats('Half-great-great-uncle')).toBe('Half 2nd great-uncle');
		expect(shortenGreats('Wife’s half-great-great-aunt')).toBe('Wife’s half 2nd great-aunt');
		expect(shortenGreats('Great-great-grandparent’s half-sibling')).toBe('2nd great-grandparent’s half-sibling');
		expect(shortenGreats('Great-grandson')).toBe('Great-grandson');
		expect(shortenGreats('Half-great-uncle')).toBe('Half-great-uncle');
		expect(shortenGreats('3rd great-grandfather')).toBe('3rd great-grandfather');
	});
	it('the forms come in the order R1, R2, R3 and a form that does not change is left out', () => {
		expect(relationForms('Half first cousin once removed')).toEqual(['Half first cousin once removed', 'Half 1st cousin once removed', 'Half 1st cousin 1× removed']);
		expect(relationForms('Great-great-grandfather')).toEqual(['Great-great-grandfather', '2nd great-grandfather']);
		expect(relationForms('Sister')).toEqual(['Sister']);
	});
});

describe('the universe of card texts', () => {
	it('the stored list is what the code makes (generations up to 4 are made again, and every one is in the list)', () => {
		const stored = new Set(TEXTS);
		const fresh = relationUniverse(4);
		expect(fresh.length).toBeGreaterThan(900);
		expect(fresh.filter((t) => !stored.has(t))).toEqual([]);
		expect(TEXTS).toHaveLength(4837);
	});

	const SUFFIXES = [MAYBE_TEXT.cardFull, MAYBE_TEXT.cardHalf];
	const back: Record<string, string> = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth', '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth' };
	const expand = (w: string) =>
		w
			.replace(/\b(\d+)× removed\b/, (_m, n: string) => (n === '1' ? 'once removed' : n === '2' ? 'twice removed' : `${n} times removed`))
			.replace(/\b(1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th) cousin\b/, (_m, d: string) => `${back[d]} cousin`)
			.replace(/\bhalf 2nd great-/i, (m) => (m[0] === 'H' ? 'Half-great-great-' : 'half-great-great-'))
			.replace(/\b2nd great-/, 'great-great-');

	it('no two different texts get the same short form, and the maybe suffix is untouched', () => {
		const seen = new Map<string, string>();
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			const short = shortest(word) + suffix;
			if (suffix) expect(SUFFIXES).toContain(suffix);
			expect(short.endsWith(suffix), text).toBe(true);
			expect(seen.get(short) ?? text, `${text} and ${seen.get(short)} both give ${short}`).toBe(text);
			seen.set(short, text);
		}
	});
	it('no form is wider than the text, in three measures', () => {
		const flat = (s: string) => [...s].length * 7.3;
		const sloped = (s: string) => textWidth(s, 17, true);
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			let before = word;
			for (const form of relationForms(word)) {
				for (const m of [measure, flat, sloped]) expect(m(form + suffix), `${text} -> ${form}`).toBeLessThanOrEqual(m(before + suffix) + 1e-9);
				before = form;
			}
		}
	});
	it('the reverse mapping gives back the text for every text', () => {
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			expect((expand(shortest(word)) + suffix).toLowerCase(), text).toBe(text.toLowerCase());
		}
	});
	it('the words that never change are kept as often as they were', () => {
		const NEVER = [
			'half', 'full', 'maybe', 'double', 'step', '-in-law', 'by marriage', 'adoptive', 'adopted', 'rumoured', 'removed', 'cousin', 'sibling',
			'husband’s', 'wife’s', 'spouse’s', 'betrothed', 'concubinage', 'lover', 'co-parent', 'guardian', 'ward', 'grand',
		];
		const count = (s: string, w: string) => s.toLowerCase().split(w).length - 1;
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			const short = shortest(word) + suffix;
			for (const w of NEVER) expect(count(short, w), `${w} in ${text} -> ${short}`).toBe(count(text, w));
			// A single "great-" stays; "great-great-" loses exactly one, and only that.
			const greats = (text.match(/great-/gi) ?? []).length;
			const pairs = (text.match(/great-great-/gi) ?? []).length;
			expect((short.match(/great-/gi) ?? []).length, text).toBe(greats - pairs);
		}
	});
});

describe('fitRelation at the width of a card', () => {
	const valid = new Set(TEXTS.flatMap((t) => relationForms(splitMaybe(t).word)));
	const visible = (s: string) => s.replace(/ \?$/, '').replace(/…$/, '').trim();

	it('the card is 166 px wide for the relation text', () => {
		expect(REL_W).toBe(166);
	});
	it('a text that fits is whole; else the first form that fits; else the shortest form, cut', () => {
		let whole = 0;
		let shortFits = 0;
		let cut = 0;
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			const out = fitRelation(word, suffix, REL_W, measure);
			expect(measure(out), text).toBeLessThanOrEqual(REL_W);
			if (measure(text) <= REL_W) {
				expect(out).toBe(text);
				whole++;
				continue;
			}
			const forms = relationForms(word);
			const i = forms.findIndex((f) => measure(f + suffix) <= REL_W);
			if (i >= 0) {
				expect(out, text).toBe(forms[i] + suffix);
				// "Only until it fits": a longer form that fits is never passed over.
				for (const longer of forms.slice(0, i)) expect(measure(longer + suffix)).toBeGreaterThan(REL_W);
				shortFits++;
			} else {
				expect(out.endsWith(suffix ? '… ?' : '…'), `${text} -> ${out}`).toBe(true);
				expect(last(forms).startsWith(visible(out)), out).toBe(true);
				cut++;
			}
		}
		expect({ whole, shortFits, cut }).toEqual({ whole: 842, shortFits: 167, cut: 3828 });
	});
	it('a maybe is never lost: a cut text with a maybe ends with " ?", a fitting one keeps the words', () => {
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			if (!suffix) continue;
			const out = fitRelation(word, suffix, REL_W, measure);
			expect(out.endsWith(suffix) || out.endsWith('… ?'), out).toBe(true);
		}
	});
	it('S2: a cut never ends before a space or an apostrophe, and never leaves a complete, different relation (189 cases today, none now)', () => {
		let today = 0;
		let now = 0;
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			if (measure(text) > REL_W) {
				const old = suffix ? truncateWithMaybe(word, suffix, REL_W, measure) : truncate(word, REL_W, measure);
				if (visible(old) !== word && valid.has(visible(old))) today++;
			}
			const out = fitRelation(word, suffix, REL_W, measure);
			if (!/…( \?)?$/.test(out)) continue;
			const full = shortest(word) + suffix;
			const kept = visible(out).replace(/…$/, '');
			expect(full.startsWith(kept), out).toBe(true);
			// A "N×" stays whole, so a space may follow it (rule 3 below).
			if (!kept.endsWith('×')) expect(full.charAt(kept.length), `${text} -> ${out}`).not.toMatch(/[ '’]/);
			if (visible(out) !== shortest(word) && valid.has(visible(out))) now++;
		}
		expect(today).toBe(189);
		expect(now).toBe(0);
	});
	it('S2 on a few texts the case table names', () => {
		const cut = (text: string) => {
			const { word, suffix } = splitMaybe(text);
			return fitRelation(word, suffix, REL_W, measure);
		};
		expect(cut('Adoptive half first cousin once removed')).toBe('Adoptive half 1st cousin 1…');
		expect(cut('Half first cousin once removed, maybe full')).toBe('Half 1st cousin 1× remo… ?');
		expect(cut('Great-great-grandparent’s half-sibling, maybe full')).toBe('2nd great-grandparen… ?');
		expect(cut('Rumoured great-grandson’s wife')).toBe('Rumoured great-grandso…');
		expect(cut('Second cousin once removed by marriage')).toBe('2nd cousin 1× removed b…');
		expect(cut('Half first cousin, maybe full')).toBe('Half first cousin, maybe full');
		expect(cut('Second cousin twice removed')).toBe('2nd cousin twice removed');
	});
	it('S2 rule 1: a cut never ends in an apostrophe (100 texts at 166 px, 142 at 163 px, none now)', () => {
		const count = (w: number) => {
			let n = 0;
			for (const text of TEXTS) {
				const { word, suffix } = splitMaybe(text);
				const out = fitRelation(word, suffix, w, measure);
				if (/…( \?)?$/.test(out) && /['’]$/.test(visible(out).replace(/…$/, ''))) n++;
			}
			return n;
		};
		expect(count(166)).toBe(0);
		expect(count(163)).toBe(0);
		expect(fitRelation('4th great-granddaughter’s husband', '', 166, measure)).toBe('4th great-granddaughte…');
		expect(fitRelation('Great-great-grandparent’s half-sibling', ', maybe full', 166, measure)).toBe('2nd great-grandparen… ?');
	});
	it('S2 rule 2: a cut inside a number never shows the first digit of it (10th is not 1)', () => {
		expect(fitRelation('Spouse’s rumoured half 10th great-aunt', '', 166, measure)).toBe('Spouse’s rumoured hal…');
		let endsInDigit = 0;
		for (const text of TEXTS) {
			const { word, suffix } = splitMaybe(text);
			const out = fitRelation(word, suffix, REL_W, measure);
			if (!/…( \?)?$/.test(out)) continue;
			const full = shortest(word) + suffix;
			const kept = visible(out).replace(/…$/, '');
			if (/\d$/.test(kept)) {
				endsInDigit++;
				expect(full.charAt(kept.length), `${text} -> ${out}`).not.toMatch(/[a-z0-9]/i);
			}
		}
		// Only the "1" of "1×" is left (the "×" case below); 168 before the rule.
		expect(endsInDigit).toBe(53);
	});
	it('S2 rule 3: a cut keeps "N×" together and does not take the sign off', () => {
		expect(fitRelation('Husband’s second cousin twice removed', '', 163, measure)).toBe('Husband’s 2nd cousin 2×…');
		expect(fitRelation('Husband’s first cousin once removed', '', 163, measure)).toBe('Husband’s 1st cousin 1×…');
	});
	it('S2 at every width from 90 to 260 px: never wider than the box, a maybe is never lost', () => {
		for (let w = 90; w <= 260; w += 7) {
			for (const text of TEXTS.filter((_t, i) => i % 5 === 0)) {
				const { word, suffix } = splitMaybe(text);
				const out = fitRelation(word, suffix, w, measure);
				expect(measure(out), `${text} at ${w}`).toBeLessThanOrEqual(w);
				if (suffix) expect(out.endsWith(suffix) || out.endsWith('… ?'), `${text} at ${w}`).toBe(true);
			}
		}
	});
	it('a text that has no short form is cut as before when no space or apostrophe follows the cut', () => {
		const w = 'Half 3rd great-uncle';
		expect(fitRelation(w, ', maybe full', 120, measure)).toBe(truncateWithMaybe(w, ', maybe full', 120, measure).replace(/ \?$/, ' ?'));
	});
	it('each renderer uses its own measure: a wider font picks a shorter form', () => {
		const word = 'Second cousin twice removed';
		const narrow = (s: string) => [...s].length * 6;
		const wide = (s: string) => [...s].length * 7;
		expect(fitRelation(word, '', 170, narrow)).toBe(word);
		expect(fitRelation(word, '', 170, wide)).toBe('2nd cousin twice removed');
		expect(fitRelation(word, '', 150, wide)).toBe('2nd cousin 2× removed');
	});
});

useFakeDom({ css: true, createSvg: true });

const SRC = ['options:', '  me: c', 'people:', '  - {id: a, name: Aldric}', '  - {id: c, name: Cedric, parents: [a]}', '  - {id: d, name: Dora, parents: [a]}', ''].join('\n');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const LONG = 'Half first cousin once removed, maybe full';
const LONG_LOWER = 'half first cousin once removed, or first cousin once removed if some rumoured links are true';

function laid() {
	const g = build(SRC).g;
	clearLayoutCache();
	const geo = cardForm(geometryFor(12), 'down');
	const l = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), relationLine: true } as LayoutSettings, 'test');
	return { g, l, labels: cardLabels(g) };
}
const relations = (text: string) => new Map([['c', { text: 'You', lower: 'you' }], ['d', { text, lower: LONG_LOWER }]]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const relationTexts = (root: FEl) => all(root).filter((e) => e.hasClass('dynasty-card-relation')).map((e) => e.getText());

describe('the drawn card', () => {
	// 0.55 em a letter: the card of 12 px note font has a relation line of about 125 px, so the long text needs a short form.
	const wideMeasure = (k: number) => (s: string, font: string) => [...s].length * k * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
	const scene = (m: (s: string, font: string) => number, text = LONG) => {
		const { g, l, labels } = laid();
		const root = new FEl('g');
		const s = buildScene(root as unknown as SVGGElement, g, l, { fonts: FONTS, measure: m, link: () => null, labels, me: 'c', relations: relations(text) });
		return { root, s, labels, g, l };
	};

	it('the live scene draws a short form, and the screen-reader label keeps the whole relation', () => {
		const { root } = scene(wideMeasure(0.5), 'Second cousin twice removed');
		const text = relationTexts(root).filter((t) => t !== 'You');
		expect(text, text.join('|')).toEqual(['2nd cousin twice removed']);
		const card = all(root).find((e) => e.getAttribute('data-person') === 'd')!;
		expect(card.getAttribute('aria-label') ?? '').toContain(LONG_LOWER);
	});
	it('the live scene picks the form again after a refit with another measure', () => {
		let k = 0.5;
		const m = (s: string, font: string) => wideMeasure(k)(s, font);
		const { root, s } = scene(m, 'Second cousin twice removed');
		const drawn = () => relationTexts(root).filter((t) => t !== 'You')[0];
		const first = drawn();
		k = 0.58;
		s.refit();
		const second = drawn();
		k = 0.2;
		s.refit();
		expect({ first, second, third: drawn() }).toEqual({ first: '2nd cousin twice removed', second: expect.stringMatching(/^2nd cousin 2× .*…$/), third: 'Second cousin twice removed' });
	});
	it('the live scene cuts after the short forms with " ?" and the cut ends inside a word', () => {
		const { root } = scene(wideMeasure(0.55));
		const t = relationTexts(root).filter((x) => x !== 'You')[0];
		expect(t.startsWith('Half 1st cousin 1'), t).toBe(true);
		expect(t.endsWith('… ?'), t).toBe(true);
	});
	it('the saved picture uses its own measure: the headless one and a measured one pick different forms', () => {
		const { g, l, labels } = laid();
		const draw = (m: ((s: string, font: string) => number) | undefined, text: string) =>
			renderSvg(g, l.layout, l.edges, { palette: DEFAULT_LIGHT, dark: false, measure: m, fonts: FONTS, labels, me: 'c', relations: relations(text), saved: { heading: 'T', legend: { kinds: [], sign: false, houses: [] }, pictures: new Map(), scale: 1 } });
		const svgText = (svg: string) => [...svg.matchAll(/data-item="relation:d">([^<]*)</g)].map((x) => x[1]);
		expect(svgText(draw(wideMeasure(0.5), 'Second cousin twice removed'))).toEqual(['2nd cousin twice removed']);
		expect(svgText(draw(wideMeasure(0.3), 'Second cousin twice removed'))).toEqual(['Second cousin twice removed']);
		const cut = svgText(draw(wideMeasure(0.55), LONG))[0];
		expect(cut.startsWith('Half 1st cousin 1') && cut.endsWith('… ?'), cut).toBe(true);
	});
});

describe('only the drawn card is shortened', () => {
	const src = (dir: string) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.ts')).map((e) => `${e.parentPath}/${e.name}`.replace(/\\/g, '/'));
	it('only the live scene and the saved picture use the short forms', () => {
		const root = fileURLToPath(new URL('../../src', import.meta.url));
		const users = src(root).filter((f) => /relation-fit/.test(readFileSync(f, 'utf8')) && !f.endsWith('/relation-fit.ts')).map((f) => f.slice(root.length + 1));
		// 0.3.3: the live scene reaches the short forms through `date-fit.ts` (its `fitCardText`, which also does the cut of the names of years).
		expect(users.sort()).toEqual(['render/date-fit.ts', 'render/svg-string.ts']);
	});
	it('the text of the relation, the sheet line and the label are the whole text', async () => {
		const rel = { text: 'Half first cousin once removed', lower: 'half first cousin once removed', maybe: { effect: 'full', cause: 'rumoured', lower: 'first cousin once removed', some: true } } as never;
		expect(cardRelationText(rel)).toBe(LONG);
		expect(spokenRelation(rel)).toBe(`half first cousin once removed, ${MAYBE_TEXT.spokenSome('first cousin once removed')}`);
		const { renderRelationLine } = await import('../../src/obsidian/sheet-relation');
		const box = new FEl('div');
		renderRelationLine(box as never, { kind: 'relation', value: LONG, others: 0 });
		expect(box.querySelector('.dynasty-head-rel')!.getText()).toBe(`Your half first cousin once removed, maybe full`);
	});
});

describe('sample tree 07', () => {
	it('with each sampled person marked in turn, 1 690 fewer cards are cut, 15 of them with a maybe', () => {
		const r = parseDynasty(fixtureSource('07'));
		if (!r.ok) throw new Error('sample tree 07 does not parse');
		const g = deriveFamilies(r.tree);
		const n = { cards: 0, cutNow: 0, cutAfter: 0, maybe: 0, maybeCutNow: 0, maybeCutAfter: 0 };
		const step = Math.max(1, Math.floor(g.people.length / 60));
		for (let i = 0; i < g.people.length; i += step) {
			for (const [, rels] of computeRelations(g, g.people[i].id)) {
				const rel = rels[0];
				if (!rel || rel.kind === 'self') continue;
				const text = cardRelationText(rel);
				const { word, suffix } = splitMaybe(text);
				const cutNow = measure(text) > REL_W;
				const out = fitRelation(word, suffix, REL_W, measure);
				const cutAfter = out.endsWith('…') || out.endsWith('… ?');
				n.cards++;
				if (cutNow) n.cutNow++;
				if (cutAfter) n.cutAfter++;
				if (suffix) {
					n.maybe++;
					if (cutNow) n.maybeCutNow++;
					if (cutAfter) n.maybeCutAfter++;
				}
			}
		}
		// The numbers of the case table (6 815 and 312 cut today), and what the short forms save.
		expect(n).toEqual({ cards: 15401, cutNow: 6815, cutAfter: 5125, maybe: 441, maybeCutNow: 312, maybeCutAfter: 297 });
	});
});
