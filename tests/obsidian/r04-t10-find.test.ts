import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Obsidian's own matcher is replaced by a plain one: every word of the query must be inside the text, in lower case. The plugin folds both sides
// first (foldForMatch), so these tests prove the folding of the plugin and not the matcher of Obsidian. The real matcher is a matter for the harness.
vi.mock('obsidian', async () => ({
	...(await import('../acceptance/fake-obsidian')),
	prepareFuzzySearch: (query: string) => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return (text: string) => {
			const lower = text.toLowerCase();
			return words.every((w) => lower.includes(w)) ? { score: -text.length, matches: [] } : null;
		};
	},
}));

import { foldForMatch } from '../../src/core/fold';
import { pickPerson } from '../../src/obsidian/person-picker';
import { buildPhoneList, type PhoneListSpec } from '../../src/render/dom/phone-list-dom';
import { listData } from '../../src/view/phone-list';
import { matchesAll, queryWords } from '../../src/view/list-search';
import { build } from '../support/helpers';
import { FEl, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian, setIcon } from '../acceptance/fake-obsidian';
import { T10, bodyOf } from '../support/r04-t10';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The release plan T10, version 0.4: Find (the person list of the full screen, the edit sheet and the phone list use one list: `pickPerson`) and the search of the
 * Houses window match a name in another script. Spec §13.5 and decision D100: the search ignores case, accents and quote look-alikes on both sides, and
 * never changes the text that it shows. NFKD (the form of `foldForMatch`) also joins the composed and the decomposed form of a name, and full-width forms
 * with the plain ones. "Case folding where it exists": Greek, Cyrillic and Georgian have two cases; Chinese, Japanese, Korean, Devanagari, Thai, Arabic
 * and Hebrew have none. Expected results are written by hand from the sample trees. Run: npx vitest run tests/obsidian/r04-t10-find.test.ts
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

interface PickerLike {
	getSuggestions(q: string): { kind: string; person?: { id: string; name: string } }[];
}

const pickerFor = (index: 0 | 1 | 2): PickerLike => {
	void pickPerson({} as never, build(bodyOf(T10[index])).g, new Set(), 'Type', 'Find', false, null);
	return openModals[openModals.length - 1] as unknown as PickerLike;
};

/** The ids that a query finds, in the order of the list. */
const found = (p: PickerLike, q: string): string[] => p.getSuggestions(q).flatMap((i) => (i.person ? [i.person.id] : []));
const sorted = (a: string[]): string[] => [...a].sort();

describe('sample tree 18: Find matches names in many scripts', () => {
	it('Greek: lower case with no accent finds the name, and so do capitals; the ending sigma decides which names', () => {
		const p = pickerFor(1);
		// "Καλλιγέρης" (ending ς) is the name of Nikolaos and Theodoros; Alexandra is "Καλλιγέρη" (no ς).
		expect(sorted(found(p, 'καλλιγερης'))).toEqual(['nikolaos', 'theodoros']);
		expect(sorted(found(p, 'ΚΑΛΛΙΓΕΡΗΣ'))).toEqual(['nikolaos', 'theodoros']);
		expect(sorted(found(p, 'Καλλιγέρη'))).toEqual(['alexandra', 'nikolaos', 'theodoros']);
		expect(found(p, 'αλεξανδρα')).toEqual(['alexandra']);
	});

	it('Greek: the sigma and the final sigma are one letter, so "καλλιγερησ" finds "Καλλιγέρης" (D100, both sides)', () => {
		const p = pickerFor(1);
		expect(sorted(found(p, 'καλλιγερησ'))).toEqual(['nikolaos', 'theodoros']);
		expect(sorted(found(p, 'ΚΑΛΛΙΓΕΡΗΣ'))).toEqual(['nikolaos', 'theodoros']);
		expect(found(p, 'ΣΟΦΟς')).toEqual(['nikolaos']);
	});

	it('Cyrillic: lower case and capitals find the name; the name with "й" is found by its composed and its decomposed form', () => {
		const p = pickerFor(1);
		expect(sorted(found(p, 'зарев'))).toEqual(['dmitri', 'miroslava', 'yaroslav']);
		expect(found(p, 'ДМИТРИЙ')).toEqual(['dmitri']);
		expect(found(p, 'Дмитрий'.normalize('NFD'))).toEqual(['dmitri']);
		expect(found(p, 'Дмитрий'.normalize('NFC'))).toEqual(['dmitri']);
		expect(found(p, 'мирослава заревая')).toEqual(['miroslava']);
	});

	it('Georgian: the letters of the old style and of the capital style are the same letters (case folding)', () => {
		const p = pickerFor(1);
		expect(sorted(found(p, 'ბერიძე'))).toEqual(['giorgi', 'nana']);
		// The capital style (Mtavruli, U+1C90 to U+1CBA) stands 0xBC0 above the old style (Mkhedruli, U+10D0 to U+10FA).
		const capitals = [...'ბერიძე'].map((c) => String.fromCodePoint(c.codePointAt(0)! + 0xbc0)).join('');
		expect(capitals).not.toBe('ბერიძე');
		expect(sorted(found(p, capitals))).toEqual(['giorgi', 'nana']);
	});

	it('Chinese: a part of a name finds it, with no space between the characters', () => {
		const p = pickerFor(1);
		expect(found(p, '明華')).toEqual(['mingxia']);
		expect(sorted(found(p, '沈'))).toEqual(['mingxia', 'ruolan']);
		expect(found(p, '令狐')).toEqual(['ouyang']);
		expect(found(p, '沈 桜')).toEqual([]);
	});

	it('Japanese: kanji, hiragana and katakana each find their own names; half-width katakana and full-width Latin are the plain forms', () => {
		const p = pickerFor(1);
		expect(sorted(found(p, '桜井'))).toEqual(['hinata', 'ken', 'maria']);
		expect(found(p, 'ひなた')).toEqual(['hinata']);
		expect(found(p, 'マリア')).toEqual(['maria']);
		expect(found(p, 'ﾏﾘｱ')).toEqual(['maria']);
		expect(found(p, 'ＺＯＥ')).toEqual(['zoe']);
	});

	it('Korean: the composed and the decomposed form of a syllable are the same', () => {
		const p = pickerFor(1);
		expect(found(p, '윤서연')).toEqual(['seoyeon']);
		expect(found(p, '윤서연'.normalize('NFD'))).toEqual(['seoyeon']);
		expect(found(p, '윤 서연')).toEqual(['seoyeon']);
		expect(sorted(found(p, '윤'))).toEqual(['haneul', 'minjun', 'seoyeon']);
	});

	it('Devanagari and Thai: a word with combining signs finds its names', () => {
		const p = pickerFor(1);
		expect(sorted(found(p, 'वर्धन'))).toEqual(['ananya', 'aryan']);
		expect(found(p, 'अनन्या')).toEqual(['ananya']);
		expect(sorted(found(p, 'สุวรรณ'))).toEqual(['somying', 'thai-long']);
		expect(found(p, 'มงคลชัย')).toEqual(['thai-long']);
	});

	it('Latin with a combining mark: "zoe", "Zoë" (composed) and "ZOË" (decomposed) all find the name stored as "Zoe" and U+0308', () => {
		const p = pickerFor(1);
		for (const q of ['zoe', 'Zoë', 'ZOË', 'Zoe\u0308', 'ZOE\u0308', 'zoë']) expect(found(p, q), JSON.stringify(q)).toEqual(['zoe']);
		expect(sorted(found(p, 'beridze'))).toEqual(['zoe']);
	});

	it('an emoji and a word of a nickname are found (the sobriquet is matched, D122)', () => {
		const p = pickerFor(1);
		expect(found(p, '🦊')).toEqual(['yaroslav']);
		expect(found(p, 'лис')).toEqual(['yaroslav']);
		expect(found(p, 'ο σοφός')).toEqual(['nikolaos']);
		expect(found(p, 'ΣΟΦΟΣ')).toEqual(['nikolaos']);
		expect(found(p, 'farmer')).toEqual(['zoe']);
	});

	it('the text of a row is the stored text: the folding changes only the match', () => {
		const p = pickerFor(1);
		const hit = p.getSuggestions('zoe').find((i) => i.person?.id === 'zoe')!;
		expect(hit.person!.name).toBe('Zoe\u0308 Beridze');
	});

	it('every person is found by the first word of the name and by the whole name', () => {
		const p = pickerFor(1);
		for (const [id, want] of Object.entries(T10[1].people)) {
			expect(found(p, want.name), id).toContain(id);
			expect(found(p, want.name.split(' ')[0]), id).toContain(id);
		}
	});
});

describe('sample tree 19: Find matches Arabic, Hebrew and mixed names', () => {
	it('Arabic: the family name finds the three brothers and sisters, and the mixed names are found by their Latin and by their Arabic part', () => {
		const p = pickerFor(2);
		expect(sorted(found(p, 'الحداد'))).toEqual(['muhammad', 'omar', 'yusuf']);
		expect(sorted(found(p, 'haddad'))).toEqual(['layla', 'rachel']);
		expect(sorted(found(p, 'HADDAD'))).toEqual(['layla', 'rachel']);
		expect(found(p, 'ليلى')).toEqual(['layla']);
		expect(sorted(found(p, 'mansour'))).toEqual(['kareem', 'salma']);
		expect(found(p, 'سلمى')).toEqual(['salma']);
	});

	it('Hebrew: the family name finds the people that write it with no mark; a word with its vowel marks, as typed, finds its person', () => {
		const p = pickerFor(2);
		const ids = found(p, 'לוי');
		for (const id of ['david', 'miriam', 'rachel']) expect(ids, id).toContain(id);
		expect(found(p, 'שָׁרָה')).toEqual(['sarah']);
		expect(found(p, 'מרים')).toEqual(['miriam']);
	});

	it('Hebrew points and Arabic vowel signs are ignored on both sides (D100): the plain word finds the pointed name', () => {
		const p = pickerFor(2);
		expect(found(p, 'שרה')).toEqual(['sarah']);
		expect(found(p, 'לוי')).toContain('sarah');
		expect(found(p, 'محمد')).toEqual(['muhammad']);
		expect(found(p, 'محمد الحداد')).toEqual(['muhammad']);
	});

	it('Arabic vowel marks as typed find the name', () => {
		const p = pickerFor(2);
		expect(found(p, 'مُحَمَّد')).toEqual(['muhammad']);
		expect(found(p, 'مُحَمَّد الحداد')).toEqual(['muhammad']);
	});

	it('a name with Arabic, brackets and a Roman number is found by each part, in either order', () => {
		const p = pickerFor(2);
		expect(found(p, 'nur al-din')).toEqual(['nur']);
		expect(found(p, 'الثاني')).toEqual(['nur']);
		expect(found(p, 'ii nur')).toEqual(['nur']);
		expect(found(p, '(rachel)')).toEqual(['rachel']);
		expect(found(p, 'avi אבי')).toEqual(['avi']);
	});

	it('the nickname and the title are found, and the date written with Arabic-Indic digits is found as written', () => {
		const p = pickerFor(2);
		expect(found(p, 'الحكيم')).toEqual(['yusuf']);
		expect(found(p, 'قاضي')).toEqual(['yusuf']);
		expect(found(p, 'הצעיר')).toEqual(['david']);
		expect(found(p, '١١٣٣')).toEqual(['omar']);
	});

	it('every person is found by the whole name and by the first word of the name', () => {
		const p = pickerFor(2);
		for (const [id, want] of Object.entries(T10[2].people)) {
			expect(found(p, want.name), id).toContain(id);
			expect(found(p, want.name.split(' ')[0]), id).toContain(id);
		}
	});
});

describe('the search of the Houses window and of the Titles window (spec §13.5, D134) matches house names in other scripts', () => {
	it.each([
		['ბერიძეთა სახლი', ['ბერიძე', 'სახლი', 'ბერიძეთა სახლი']],
		['沈家', ['沈']],
		['桜井家', ['桜井', '家']],
		['윤씨 가문', ['윤씨', '가문', '윤 가']],
		['वर्धन घराना', ['वर्धन', 'घराना']],
		['ตระกูลสุวรรณ', ['ตระกูล', 'สุวรรณ']],
		['Οίκος Καλλιγέρη', ['οικος', 'ΚΑΛΛΙΓΕΡΗ', 'καλλιγέρη οίκος']],
		['Дом Заревых', ['дом', 'ЗАРЕВ']],
		['بيت الحداد', ['الحداد', 'بيت']],
		['בית לוי', ['לוי', 'בית']],
		['بيت Mansour', ['MANSOUR', 'بيت', 'mansour بيت']],
	] as const)('the house "%s" is found by its parts', (house, queries) => {
		for (const q of queries) expect(matchesAll(queryWords(q), [house]), q).toBe(true);
		expect(matchesAll(queryWords('qqqq'), [house])).toBe(false);
	});

	it('folds the decomposed and the composed form of one name to one text', () => {
		expect(foldForMatch('Zoe\u0308')).toBe(foldForMatch('Zoë'));
		expect(foldForMatch('윤서연'.normalize('NFD'))).toBe(foldForMatch('윤서연'));
		expect(foldForMatch('Дмитрий'.normalize('NFD'))).toBe(foldForMatch('Дмитрий'));
	});

	it('does not throw on a lone combining mark, a lone joiner or an unpaired surrogate in a query', () => {
		for (const q of ['\u0308', '\u200d', '\ud83e', '\u{1F9D1}\u{1F3FD}\u200d', '\u202e', '\u2067abc\u2069']) {
			expect(() => queryWords(q), JSON.stringify(q)).not.toThrow();
			expect(() => matchesAll(queryWords(q), ['Zoe\u0308 Beridze']), JSON.stringify(q)).not.toThrow();
		}
	});
});

describe('the phone list shows every name of the sample trees as text, with the sobriquet in its own part', () => {
	it.each(T10.map((t, i) => [t.id, i] as const))('sample tree %s: every row has the name of its person, for each person as the person at the top', (_id, index) => {
		const t = T10[index];
		const g = build(bodyOf(t)).g;
		for (const centre of Object.keys(t.people)) {
			const parent = new FEl('div', { cls: 'dynasty-viewport' });
			const spec: PhoneListSpec = {
				g,
				data: listData(g, centre),
				me: null,
				showDates: true,
				editable: true,
				word: () => null,
				icon: setIcon as unknown as PhoneListSpec['icon'],
				onGo: () => undefined,
				onEdit: () => undefined,
			};
			const res = buildPhoneList(parent as unknown as HTMLElement, spec);
			const list = res.list as unknown as FEl;
			const rows = list.querySelectorAll('.dynasty-list-row');
			expect(rows.length, centre).toBeGreaterThan(0);
			for (const row of rows) {
				const id = row.getAttribute('data-person')!;
				const name = row.querySelector('.dynasty-list-name')!;
				// The name is the first text of the part; the sobriquet is a span of its own after a space.
				expect(name.getText().startsWith(t.people[id].name), `${centre}: ${id}`).toBe(true);
				if (t.people[id].sobriquet) expect(name.querySelector('.dynasty-list-sob')!.getText(), `${centre}: ${id}`).toContain(t.people[id].sobriquet!.trim());
			}
		}
	});
});
