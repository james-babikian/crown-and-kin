import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { foldForMatch, foldLetters } from '../src/core/fold';
import { slugify } from '../src/core/id-gen';
import { buildPictureTree, searchRows } from '../src/core/picture-list';

/** The slug function of version 0.2.0 (before `foldLetters` was shared), kept as the reference. */
function slugifyOld(name: string): string {
	const slug = name
		.replace(/[Þþ]/g, 'th')
		.replace(/[Ææ]/g, 'ae')
		.replace(/[Øø]/g, 'o')
		.replace(/ß/g, 'ss')
		.replace(/[Łł]/g, 'l')
		.replace(/[Đđ]/g, 'd')
		.replace(/[Œœ]/g, 'oe')
		.replace(/[Ħħ]/g, 'h')
		.replace(/ı/g, 'i')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (slug === '') return 'person';
	return /^\d+$/.test(slug) ? `p-${slug}` : slug;
}

// Fix round of 0.2.1, review A (D100, spec 13.16 rule 5). The proofs F1 to F4 come from the code-reviewer.

describe('review A: foldForMatch', () => {
	// F1: a letter from the map that also carries an accent was not mapped, because the map ran before NFKD.
	it('F1: an accented map letter folds like the plain map letter (Ǣ, Ǽ, Ǿ, ǿ)', () => {
		expect(foldForMatch('Ǣlfred')).toBe(foldForMatch('Ælfred'));
		expect(foldForMatch('ǽlfred')).toBe(foldForMatch('ælfred'));
		expect(foldForMatch('ǿstein')).toBe(foldForMatch('østein'));
		expect(foldForMatch('Ǣlfred')).toBe('aelfred');
		expect(foldForMatch('ǿstein')).toBe('ostein');
	});

	// F2: the doc comment says that folding twice changes nothing.
	it('F2: is idempotent for capital sharp s, AE with acute and n with a leading apostrophe', () => {
		for (const s of ['ẞ', 'ǽ', 'ǿ', 'ŉ', 'Ǣ']) {
			expect(foldForMatch(foldForMatch(s)), s.codePointAt(0)!.toString(16)).toBe(foldForMatch(s));
		}
		expect(foldForMatch('ŉ')).toBe('\'n');
	});

	it('F3: capital sharp s folds like ss (the lower-case letter already does)', () => {
		expect(foldForMatch('STRAẞE')).toBe(foldForMatch('Straße'));
		expect(foldForMatch('STRAẞE')).toBe('strasse');
	});

	it('is idempotent for every character of the Basic Multilingual Plane and for some pairs', () => {
		const bad: string[] = [];
		for (let c = 0; c < 0x10000; c++) {
			if (c >= 0xd800 && c <= 0xdfff) continue;
			const s = String.fromCharCode(c);
			const once = foldForMatch(s);
			if (foldForMatch(once) !== once) bad.push(c.toString(16));
			const pair = `${s}${String.fromCharCode(0x2019)}Ǣ${s}`;
			const pairOnce = foldForMatch(pair);
			if (foldForMatch(pairOnce) !== pairOnce) bad.push(`pair ${c.toString(16)}`);
		}
		expect(bad).toEqual([]);
	});

	it('finds the same text as before for text the old fold already handled', () => {
		expect(foldForMatch('Éloïse Müller')).toBe('eloise muller');
		expect(foldForMatch('d’España')).toBe('d\'espana');
		expect(foldForMatch('İstanbul')).toBe('istanbul');
		expect(foldForMatch('Þórr Øystein Łukasz')).toBe('thorr oystein lukasz');
		expect(foldForMatch('日本語 Москва')).toBe('日本語 москва');
	});

	it('does not change foldLetters or slugify', () => {
		expect(foldLetters('Ǣ Ǽ ǿ ẞ ŉ')).toBe('Ǣ Ǽ ǿ ẞ ŉ');
		expect(foldLetters('Þórr Ææ Øø ß Łł Đđ Œœ Ħħ ı')).toBe('thórr aeae oo ss ll dd oeoe hh i');
	});
});

describe('review A: slugify is the same as in 0.2.0', () => {
	it('gives the same id for 20 000 random strings', () => {
		let seed = 12345;
		const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
		const pool = [...'abcXYZ019 -\'’`´.ÀÉéÑñüÇçÞþÆæØøßẞŁłĐđŒœĦħıǢǣǼǽǾǿŉİﬁ№Ⅻ日本Москва\u0301\u0308'];
		for (let i = 0; i < 20000; i++) {
			let text = '';
			const n = 1 + (next() % 12);
			for (let k = 0; k < n; k++) text += next() % 10 === 0 ? String.fromCharCode(next() % 0x2fff) : pool[next() % pool.length];
			expect(slugify(text), JSON.stringify(text)).toBe(slugifyOld(text));
		}
	});

	it('gives the same id for every name in the sample trees', () => {
		for (const file of readdirSync('fixtures').filter((f) => f.endsWith('.md'))) {
			const names = [...readFileSync(`fixtures/${file}`, 'utf8').matchAll(/name:\s*(.+)/g)].map((m) => m[1].replace(/^["']|["']$/g, ''));
			for (const name of names) expect(slugify(name), `${file}: ${name}`).toBe(slugifyOld(name));
		}
	});
});

describe('review A: searchRows with a query that folds to nothing', () => {
	const files = [
		{ path: 'Art/lion.png', name: 'lion.png', extension: 'png' },
		{ path: 'Art/rose.png', name: 'rose.png', extension: 'png' },
	];
	const tree = buildPictureTree(files, () => true);
	const pictures = (query: string) => searchRows(tree, query, null).rows.filter((r) => r.kind !== 'device');

	// F4: a query that folds to nothing is not an empty query; 0.2.0 found no picture.
	it('F4: a query of one combining mark does not match every picture', () => {
		expect(pictures('\u0301')).toHaveLength(0);
	});

	it('a query of a spacing accent finds no picture, and does not report more', () => {
		expect(pictures('\u00a8 \u0308')).toHaveLength(0);
		expect(searchRows(tree, '\u0300', null).more).toBe(false);
	});

	it('an empty or blank query still lists every picture (the caller decides what to show)', () => {
		expect(pictures('')).toHaveLength(2);
		expect(pictures('   ')).toHaveLength(2);
	});

	it('a normal word still filters', () => {
		expect(pictures('LION')).toHaveLength(1);
	});
});
