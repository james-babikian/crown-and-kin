import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionSpec } from '../../src/core/succession';
import { fixtureNote, topLevelBlocks } from './load';

/*
 * Version 0.2.7, WP2: sample tree 16 (spec §10, §13.21; fixtures/16-succession.md). The note gives the expected
 * line of each of its four titles in comments (`# ruler:`, `# year:`, `# line:`, `# more:`, `# named:`, `# old:`),
 * worked out by hand from the rules of the contract. These tests read the comments and compare them with
 * `successionLine` at the default settings (length 5, warning age 110), then change one key at a time and
 * compare with lines that are also worked out by hand (see the comment above each test).
 * These tests wait for WP 2 (`src/core/succession.ts`).
 * Run: npx vitest run tests/acceptance/r027-sample-16.test.ts
 */

const NOTE = fixtureNote('16');
const BODY = topLevelBlocks(NOTE)[0];

const KEYS = ['ruler', 'year', 'line', 'more', 'named', 'old'] as const;
type Key = (typeof KEYS)[number];

/** The expected comments of each title, by title id (the `# key: value` lines under `  - id:`). */
function expectedComments(): { byTitle: Map<string, Partial<Record<Key, string>>>; errors: string[] } {
	const byTitle = new Map<string, Partial<Record<Key, string>>>();
	const errors: string[] = [];
	let section = '';
	let current: Partial<Record<Key, string>> | null = null;
	for (const line of BODY.split('\n')) {
		const top = /^([a-z-]+):/.exec(line);
		if (top) section = top[1];
		if (section !== 'titles') continue;
		const id = /^ {2}- id: (\S+)\s*$/.exec(line);
		if (id) {
			current = {};
			byTitle.set(id[1], current);
			continue;
		}
		const c = /^ {4}# ([a-z]+): (.+)$/.exec(line);
		if (!c) continue;
		const key = c[1] as Key;
		if (!current || !KEYS.includes(key) || current[key] !== undefined) errors.push(line);
		else current[key] = c[2];
	}
	return { byTitle, errors };
}

const list = (v: string) => (v === 'none' ? [] : v.split(', '));

function graph() {
	const r = parseDynasty(BODY);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return deriveFamilies(r.tree);
}
const lineOf = (id: string, change: Partial<SuccessionSpec> = {}, limit = 5, oldAge = 110, dropKeys: (keyof SuccessionSpec)[] = []) => {
	const g = graph();
	const title = g.titles.find((t) => t.id === id)!;
	const spec = { ...specOf(title), ...change };
	for (const k of dropKeys) delete spec[k];
	return successionLine(g, title, spec, limit, oldAge);
};

describe('sample tree 16: the note and its comments', () => {
	it('four titles, each with all six comments', () => {
		const { byTitle, errors } = expectedComments();
		expect(errors).toEqual([]);
		expect([...byTitle.keys()]).toEqual(['duke-of-carrowmere', 'countess-of-harrowfen', 'margrave-of-the-salt-coast', 'lord-of-wetherby']);
		for (const [id, c] of byTitle) expect(Object.keys(c).sort(), id).toEqual([...KEYS].sort());
	});

	it('the tree has no warning, and the four titles use four different rules', () => {
		const g = graph();
		expect(g.issues).toEqual([]);
		expect(g.titles.map((t) => specOf(t).rule)).toEqual(['eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative']);
		expect(g.titles.map((t) => specOf(t).inherit)).toEqual(['men-only', 'women-first', 'men-first-in-house', 'men-only']);
	});
});

describe('sample tree 16: every title gives the line of its comments (settings at their defaults)', () => {
	const { byTitle } = expectedComments();
	for (const [id, c] of byTitle) {
		it(id, () => {
			const r = lineOf(id);
			expect(r.kind).toBe('line');
			expect(r.ruler).toBe(c.ruler);
			const year = /^(now|(\d+) \((field|reign end)\))$/.exec(c.year!)!;
			expect([r.year, r.yearFrom]).toEqual(year[1] === 'now' ? [null, 'now'] : [Number(year[2]), year[3] === 'field' ? 'field' : 'reign-end']);
			expect(r.heirs).toEqual(list(c.line!));
			expect(r.more).toBe(c.more === 'yes');
			expect(r.namedHeirs.map((n) => `${n.id} ${n.state}`)).toEqual(list(c.named!));
			expect(r.old).toEqual(list(c.old!));
		});
	}
});

describe('sample tree 16: one key changed at a time (lines worked out by hand)', () => {
	// Duke: with no gender rule and no `inherit-through`, a daughter and her son are in the line, in written order:
	// Edwin (dead) gives Fenwick and Gwen, then Harriet and her son Ivo, then Jasper, then the duke's brother and his son.
	it('Duke of Carrowmere with no preference: the daughter line comes in', () => {
		const r = lineOf('duke-of-carrowmere', { inherit: 'no-preference' }, 20, 110, ['inheritThrough']);
		expect(r.heirs).toEqual(['fenwick-carrow', 'gwen-carrow', 'harriet-carrow', 'ivo-marsh', 'jasper-carrow', 'cedric-carrow', 'dunstan-carrow']);
	});

	// Countess: the limit 20 shows the sixth person, Bede (illegitimate, after all the others).
	it('Countess of Harrowfen: the whole line, with the sixth person', () => {
		const r = lineOf('countess-of-harrowfen', {}, 20);
		expect(r.heirs).toEqual(['clara-harrow', 'agnes-harrow', 'dagmar-harrow', 'sunniva-harrow', 'tilde-harrow', 'bede-harrow']);
		expect(r.more).toBe(false);
	});

	// "no": Bede has no claim. "equal": Bede ranks with his sisters and brother; youngest first, the women first: Edda is not born in 1215,
	// so Clara, Agnes, then the men Dagmar and Bede (youngest first), then the countess's sister Sunniva and her daughter Tilde.
	it('Countess of Harrowfen: the children marked illegitimate cannot inherit, or have the same right', () => {
		expect(lineOf('countess-of-harrowfen', { illegitimate: 'no' }, 20).heirs).toEqual(['clara-harrow', 'agnes-harrow', 'dagmar-harrow', 'sunniva-harrow', 'tilde-harrow']);
		expect(lineOf('countess-of-harrowfen', { illegitimate: 'equal' }, 20).heirs).toEqual(['clara-harrow', 'agnes-harrow', 'dagmar-harrow', 'bede-harrow', 'sunniva-harrow', 'tilde-harrow']);
	});

	// No Year field: the line is for the end of the last reign (1230), so Edda (born 1216) is the first woman of the line
	// (youngest first, women first): Edda, Clara, Agnes, Dagmar, Sunniva, Tilde, then Bede.
	it('Countess of Harrowfen with no Year field: the end of the last reign, 1230, and Edda is in the line', () => {
		const r = lineOf('countess-of-harrowfen', {}, 20, 110, ['year']);
		expect([r.year, r.yearFrom, r.ruler]).toEqual([1230, 'reign-end', 'matilda-harrow']);
		expect(r.heirs).toEqual(['edda-harrow', 'clara-harrow', 'agnes-harrow', 'dagmar-harrow', 'sunniva-harrow', 'tilde-harrow', 'bede-harrow']);
	});

	// Margrave: the limit 20 shows the whole line; without the switch Hale has no claim.
	// D193: Bram's children are written Finn 1215, Greta 1217, Hale 1214. Siblings-first levels: Dorian -1, Leif 0, Finn/Hale +1 (Elowen -1, Isolde 0, Greta +1
	// in the second pass). Inside level +1 the walk place decides, and Hale 1214 comes before Finn 1215. So: Dorian, Leif, Hale, Finn, then the women Elowen, Isolde, Greta.
	it('Margrave of the Salt Coast: the whole line, and the line without the adopted son', () => {
		const whole = lineOf('margrave-of-the-salt-coast', {}, 20);
		expect(whole.heirs).toEqual(['dorian-saltmarsh', 'leif-saltmarsh', 'hale-saltmarsh', 'finn-saltmarsh', 'elowen-saltmarsh', 'isolde-saltmarsh', 'greta-saltmarsh']);
		expect(whole.more).toBe(false);
		expect(lineOf('margrave-of-the-salt-coast', { adopted: false }, 20).heirs).toEqual(['dorian-saltmarsh', 'leif-saltmarsh', 'finn-saltmarsh', 'elowen-saltmarsh', 'isolde-saltmarsh', 'greta-saltmarsh']);
	});

	// Margrave with the rule "Eldest child first" instead. D193: Bram's children go by birth year, Hale 1214 before Finn 1215.
	// Pass 1 (men only): the walk from Bram gives Hale and Finn (Greta is a woman),
	// the walk from Corvin gives Dorian and his son Leif. Pass 2 (men first): Hale, Finn, Greta, then Isolde, then Dorian, Leif, Elowen.
	// The line is pass 1, then the people that only pass 2 has, in its order: Greta, Isolde, Elowen.
	it('Margrave of the Salt Coast with the rule "Eldest child first": all men first, then the women', () => {
		const r = lineOf('margrave-of-the-salt-coast', { rule: 'eldest-child' }, 20);
		expect(r.heirs).toEqual(['hale-saltmarsh', 'finn-saltmarsh', 'dorian-saltmarsh', 'leif-saltmarsh', 'greta-saltmarsh', 'isolde-saltmarsh', 'elowen-saltmarsh']);
	});

	// Lord: without the exclusion Osric is in the line, before Quill (nearest first: 3 steps each, written order).
	it('Lord of Wetherby with nobody excluded: Osric is in the line, and the line is longer than five', () => {
		const r = lineOf('lord-of-wetherby', {}, 5, 110, ['exclude']);
		expect(r.heirs).toEqual(['sam-wether', 'cass-wether', 'bertie-wether', 'osric-penn', 'quill-penn']);
		expect(r.more).toBe(true);
		expect(lineOf('lord-of-wetherby', {}, 20, 110, ['exclude']).heirs).toEqual(['sam-wether', 'cass-wether', 'bertie-wether', 'osric-penn', 'quill-penn', 'ronan-penn']);
	});

	// Lord: an excluded person still passes the claim; excluding Petra (who cannot inherit as a woman) does not touch Ronan.
	it('Lord of Wetherby: excluding a woman who passes the claim leaves her son in the line', () => {
		const r = lineOf('lord-of-wetherby', { exclude: ['osric-penn', 'petra-penn'] }, 20);
		expect(r.heirs).toEqual(['sam-wether', 'cass-wether', 'bertie-wether', 'quill-penn', 'ronan-penn']);
	});

	// Lord with no `inherit-through`: the men-only rule alone (C.3). A woman passes no claim, so the climb does not go up through
	// the lord's mother Maud: the lord is the founder, and only his own line is walked. His son Sam is in the line (the lord is not
	// tested); Bertie, Cass and the sons of Edith are not reached. The named heirs are Sam and Cass, so the line is Sam, Cass.
	it('Lord of Wetherby with no `inherit-through`: the claim does not go up through the mother', () => {
		const r = lineOf('lord-of-wetherby', {}, 20, 110, ['inheritThrough']);
		expect(r.heirs).toEqual(['sam-wether', 'cass-wether']);
		expect(r.more).toBe(false);
	});

	// A named heir who is not in the line by the rule comes first, and is not shown twice.
	it('Lord of Wetherby with a named heir who is also in the line: shown once, first', () => {
		const r = lineOf('lord-of-wetherby', { heirs: ['quill-penn'] }, 20);
		expect(r.heirs).toEqual(['quill-penn', 'bertie-wether', 'ronan-penn']);
		expect(r.namedHeirs).toEqual([{ id: 'quill-penn', state: 'first' }]);
	});
});
