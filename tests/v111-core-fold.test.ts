import { describe, expect, it } from 'vitest';
import { foldForMatch, foldLetters } from '../src/core/fold';
import { deriveFamilies } from '../src/core/derive';
import { slugify } from '../src/core/id-gen';
import { parseDynasty } from '../src/core/parse';
import { buildPictureTree, searchRows } from '../src/core/picture-list';
import { computeRelations } from '../src/core/relations';
import { CURLY_APOSTROPHE, CURLY_CLOSE, CURLY_OPEN, quote } from '../src/core/quote';

import { fixture } from './helpers';

// Version 0.2.1, D99 and D100: one fold for matching, one helper for quote marks.

describe('foldForMatch (D100)', () => {
	it('treats the straight and the curly apostrophe as the same mark', () => {
		expect(foldForMatch('d\'España')).toBe(foldForMatch('d’España'));
		expect(foldForMatch('d’España')).toBe('d\'espana');
	});

	it('folds every single quote look-alike to the straight apostrophe', () => {
		for (const mark of ['‘', '’', 'ʼ', '′', '`', '´']) expect(foldForMatch(`o${mark}neil`), mark).toBe('o\'neil');
	});

	it('folds every double quote look-alike to the straight double quote', () => {
		for (const mark of ['“', '”', '„', '″', '«', '»']) expect(foldForMatch(`${mark}x${mark}`), mark).toBe('"x"');
	});

	it('ignores accents and case', () => {
		expect(foldForMatch('espana')).toBe(foldForMatch('España'));
		expect(foldForMatch('ESPAÑA')).toBe('espana');
		expect(foldForMatch('Éloïse Müller')).toBe('eloise muller');
	});

	it('maps the letters that have no accent form like the id slug does', () => {
		expect(foldForMatch('Þórr')).toBe('thorr');
		expect(foldForMatch('Æthelred')).toBe('aethelred');
		expect(foldForMatch('Øystein')).toBe('oystein');
		expect(foldForMatch('Straße')).toBe('strasse');
		expect(foldForMatch('Łukasz')).toBe('lukasz');
		expect(foldForMatch('Đorđe')).toBe('dorde');
		expect(foldForMatch('Œuvre')).toBe('oeuvre');
		expect(foldForMatch('Ħamrun')).toBe('hamrun');
		expect(foldForMatch('ıstanbul')).toBe('istanbul');
	});

	it('returns the empty string for the empty string', () => {
		expect(foldForMatch('')).toBe('');
	});

	it('folds the acute sign as a quote before the accent step can turn it into a space', () => {
		expect(foldForMatch('d´España')).toBe('d\'espana');
	});

	it('is idempotent', () => {
		for (const s of ['d’España', 'Þórr Æ Ø ß Ł Đ Œ Ħ ı', '“Quoted” ‘text’ `x` ´y´', 'plain ascii 42', '', 'ǅ ﬁ ① İ', 'é']) {
			expect(foldForMatch(foldForMatch(s)), s).toBe(foldForMatch(s));
		}
	});

	it('keeps the fast path for plain ASCII equal to the full path', () => {
		expect(foldForMatch('Folder 12/Picture 7 FINAL.png')).toBe('folder 12/picture 7 final.png');
		expect(foldForMatch('back`tick')).toBe('back\'tick');
	});
});

describe('slugify is unchanged by the shared letter map', () => {
	it('gives the slugs it gave before', () => {
		expect(slugify('Aldric Valmont')).toBe('aldric-valmont');
		expect(slugify('Þórr')).toBe('thorr');
		expect(slugify('Æthelred Ø Straße Łukasz Đorđe Œuvre Ħamrun ıstanbul')).toBe('aethelred-o-strasse-lukasz-dorde-oeuvre-hamrun-istanbul');
		expect(slugify('Éloïse d’España')).toBe('eloise-d-espana');
		expect(slugify('')).toBe('person');
		expect(slugify('42')).toBe('p-42');
	});

	it('foldLetters keeps case and leaves accents for NFKD', () => {
		expect(foldLetters('Þórr Æ')).toBe('thórr ae');
		expect(foldLetters('ÞÆ')).toBe('thae');
	});
});

describe('quote (D99)', () => {
	it('puts curly double quote marks around the text', () => {
		expect(quote('people:')).toBe('“people:”');
		expect(quote('')).toBe('“”');
	});

	it('exports the marks it uses', () => {
		expect(CURLY_OPEN).toBe('“');
		expect(CURLY_CLOSE).toBe('”');
		expect(CURLY_APOSTROPHE).toBe('’');
		expect(quote('x')).toBe(`${CURLY_OPEN}x${CURLY_CLOSE}`);
	});

	it('does not change the text inside', () => {
		expect(quote('a "b" \'c\'')).toBe('“a "b" \'c\'”');
	});
});

describe('picture search folds both sides (D100)', () => {
	const tree = buildPictureTree(
		[
			{ path: 'Heraldry/d’España.png', name: 'd’España.png', extension: 'png' },
			{ path: 'Heraldry/d\'Aubigné.png', name: 'd\'Aubigné.png', extension: 'png' },
			{ path: 'Heraldry/España.png', name: 'España.png', extension: 'png' },
			{ path: 'Misc/plain.png', name: 'plain.png', extension: 'png' },
		],
		() => true,
	);
	const found = (query: string) => searchRows(tree, query, null).rows.flatMap((r) => (r.kind === 'picture' ? [r.entry.file.name] : []));

	it('a straight apostrophe in the query finds a curly one in the path', () => {
		expect(found('d\'España')).toEqual(['d’España.png']);
	});

	it('a curly apostrophe in the query finds a straight one in the path', () => {
		expect(found('d’Aubigne')).toEqual(['d\'Aubigné.png']);
	});

	it('an unaccented query finds an accented path and the reverse', () => {
		expect(found('espana').sort()).toEqual(['España.png', 'd’España.png']);
		expect(found('ESPAÑA').sort()).toEqual(['España.png', 'd’España.png']);
	});

	it('every word of the query must match', () => {
		expect(found('heraldry d\'espana')).toEqual(['d’España.png']);
		expect(found('misc d\'espana')).toEqual([]);
	});

	it('changes only the match, not the stored or shown path', () => {
		const row = searchRows(tree, 'd\'España', null).rows[1];
		expect(row.kind === 'picture' && row.entry.file.path).toBe('Heraldry/d’España.png');
	});

	it('still stops at limit + 1 and sets more', () => {
		expect(searchRows(tree, 'png', null, 3).more).toBe(true);
		expect(searchRows(tree, 'png', null, 4).more).toBe(false);
		expect(searchRows(tree, 'png', null, 3).rows).toHaveLength(4);
	});

	it('folds each path once: a search of 10 000 pictures, with accents, stays fast', () => {
		const files = Array.from({ length: 10000 }, (_, i) => {
			const name = `Retrato ${(i * 7919) % 10000} d’España ñ.png`;
			return { path: `Carpeta ${i % 200}/${name}`, name, extension: 'png' };
		});
		const big = buildPictureTree(files, () => true);
		searchRows(big, 'warm', null);
		const t = performance.now();
		for (let k = 0; k < 20; k++) searchRows(big, 'd\'espana 7', null);
		expect((performance.now() - t) / 20).toBeLessThan(15);
	});
});

describe('relation words use the curly apostrophe (D99)', () => {
	const parsed = parseDynasty(fixture('12'));
	if (!parsed.ok) throw new Error('fixture 12 does not parse');
	const g = deriveFamilies(parsed.tree);

	it('no relation text of sample tree 12 has a straight apostrophe, and the possessive forms are curly', () => {
		const all: string[] = [];
		for (const marked of ['gwen', 'alan', 'leo']) {
			for (const list of computeRelations(g, marked).values()) for (const r of list) all.push(r.text, r.lower);
		}
		expect(all.some((t) => t.includes('\'')), 'a straight apostrophe').toBe(false);
		expect(all).toContain('Wife’s first cousin');
		expect(all.filter((t) => t.includes(CURLY_APOSTROPHE)).length).toBeGreaterThan(10);
	});
});
