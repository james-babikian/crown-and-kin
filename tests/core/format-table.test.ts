/*
 * "Format 1" (the 0.3 contract WP-E, T16): the key table in `scripts/format/keys.ts` against the code, and the generated file
 * `docs/format.md` against the generator. The README is short (owner, 0.4): it has one example and a link to the document,
 * and no generated table.
 *
 * - Every key of a write-order list of the code (person, option, top-level, house, title, holder and union keys, which
 *   include the succession keys) is in the table, in the same order. A key that no list names is marked `listed: false`.
 * - The reader asks for the keys of the table and for no other key: a recording wrapper around the parsed data notes every key
 *   that `readTree` and `referencedIds` ask for. A reserved key is never asked for. A key that is not reserved is asked for.
 * - The words that the table lists as old names are read as the value the table says.
 * - The files are the output of the generator. To update them run `npm run format-doc`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOLDER_ORDER, TITLE_ORDER } from '../../src/core/title-ops';
import { HOUSE_ORDER } from '../../src/core/house-ops';
import { UNION_ORDER } from '../../src/core/relationship-ops';
import { OPTION_ORDER, PERSON_ORDER, TOP_ORDER } from '../../src/core/yaml-patch';
import { parseBody, parseDynasty, readTree, readUnionType, referencedIds } from '../../src/core/parse';
import { validateTree } from '../../src/core/validate';
import { applyOp } from '../../src/core/yaml-edit';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES, readIllegitimate, readInherit, readRule, readThrough } from '../../src/core/succession-keys';
import { ENDED_BY, PARENT_TYPES, PLACEMENT_TYPES, readEndedBy, UNION_TYPES } from '../../src/core/types';
import { KEYS, OLD_ILLEGITIMATE, OLD_INHERIT, OLD_RULES, OLD_THROUGH, OLD_ENDED_BY, OLD_UNION_TYPES, SECTIONS, VALUE_LISTS, keysOf, type SectionId } from '../../scripts/format/keys';
import { formatDoc } from '../../scripts/format/render';

const ORDERS: Record<SectionId, readonly string[] | undefined> = {
	top: TOP_ORDER,
	options: OPTION_ORDER,
	houses: HOUSE_ORDER,
	titles: TITLE_ORDER,
	holders: HOLDER_ORDER,
	people: PERSON_ORDER,
	parents: undefined,
	unions: UNION_ORDER,
};

describe('the key table and the write-order lists of the code', () => {
	it('names every section once, with the list of the code', () => {
		expect(SECTIONS.map((s) => s.id)).toEqual(Object.keys(ORDERS));
		for (const s of SECTIONS) expect(s.order).toBe(ORDERS[s.id]);
	});

	it('has no key twice', () => {
		const seen = new Set<string>();
		for (const x of KEYS) {
			const id = `${x.section}.${x.key}`;
			expect(seen.has(id), id).toBe(false);
			seen.add(id);
		}
	});

	for (const [section, order] of Object.entries(ORDERS) as [SectionId, readonly string[] | undefined][]) {
		if (!order) continue;
		it(`lists every key of the write order of "${section}", in the same order`, () => {
			const listed = keysOf(section).filter((x) => x.listed !== false).map((x) => x.key);
			expect(listed).toEqual([...order]);
		});
		it(`marks a key of "${section}" that no write-order list names with listed: false`, () => {
			for (const x of keysOf(section).filter((y) => y.listed === false)) expect(order, x.key).not.toContain(x.key);
		});
	}

	it('has the succession keys of a title between count-with and holders (spec §13.0 item 1)', () => {
		const keys = keysOf('titles').map((x) => x.key);
		const from = keys.indexOf('count-with');
		expect(keys.slice(from + 1)).toEqual(['succession', 'inherit', 'inherit-through', 'inherit-illegitimate', 'inherit-adopted', 'heirs-of-body', 'year', 'heir', 'exclude', 'holders']);
	});

	it('gives every key a meaning, the forms it accepts, the form it writes and a version', () => {
		for (const x of KEYS) {
			expect(x.meaning.trim(), `${x.section}.${x.key} meaning`).not.toBe('');
			expect(x.accepts.trim(), `${x.section}.${x.key} accepts`).not.toBe('');
			expect(x.written.trim(), `${x.section}.${x.key} written`).not.toBe('');
			expect(x.since, `${x.section}.${x.key} since`).toMatch(/^0\.\d+(\.\d+)?$/);
			expect([x.meaning, x.accepts, x.written].join(' ')).not.toMatch(/[\r\n]/);
		}
	});

	it('reserves exactly options.format, numbering and count-with (E.2)', () => {
		expect(KEYS.filter((x) => x.reserved).map((x) => `${x.section}.${x.key}`)).toEqual(['options.format', 'titles.numbering', 'titles.count-with']);
	});
});

// A tree with every key of the table, each with a value that the reader accepts.
const FULL = [
	'options:',
	'  start: aldric',
	'  focus: aldric',
	'  me: aldric',
	'  generations: 2',
	'  height: 400',
	'  calendar: "[[Calendars]]"',
	'  format: 2',
	'houses:',
	'  - id: valmont',
	'    name: House Valmont',
	'    color: "#8b1e3f"',
	'    arms: "[[arms.png]]"',
	'titles:',
	'  - id: duchy',
	'    name: Duchy of Valmont',
	'    male-name: Duke of Valmont',
	'    female-name: Duchess of Valmont',
	'    plural: Dukes of Valmont',
	'    numbering: roman',
	'    count-with: duchy',
	'    succession: eldest-child',
	'    inherit: no-preference',
	'    inherit-through: anyone',
	'    inherit-illegitimate: after',
	'    inherit-adopted: true',
	'    heirs-of-body: true',
	'    year: 1200',
	'    heir: [roderick]',
	'    exclude: [wren]',
	'    holders:',
	'      - {person: aldric, name: Aldric, as: Aldric, number: I, from: 1100, to: 1160, through-spouse: true}',
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'    sobriquet: the Wise',
	'    title: Duke',
	'    card-title: duchy',
	'    house: valmont',
	'    sex: m',
	'    born: 1102',
	'    died: 1161',
	'    parents: [isolde]',
	'    placement: birth',
	'    illegitimate: true',
	'    childless: true',
	'    union: u1',
	'    link: "[[Aldric]]"',
	'    portrait: "[[aldric.jpg]]"',
	'    portrait-crop: "0.1 0.1 0.5"',
	'    arms: "[[aldric-arms.png]]"',
	'    notes: A note.',
	'  - id: isolde',
	'    name: Isolde',
	'  - id: roderick',
	'    name: Roderick',
	'    parents: [aldric, {id: isolde, type: adoptive}]',
	'  - id: wren',
	'    name: Wren',
	'unions:',
	'  - id: u1',
	'    partners: [aldric, isolde]',
	'    type: marriage',
	'    start: 1129',
	'    end: 1160',
	'    ended-by: divorce',
	'',
].join('\n');

const CHILD: Partial<Record<SectionId, Record<string, SectionId>>> = {
	top: { options: 'options', houses: 'houses', titles: 'titles', people: 'people', unions: 'unions' },
	titles: { holders: 'holders' },
	people: { parents: 'parents' },
};

/** Wraps parsed data so that every key asked for is noted, by section. Keys of `Object.prototype` are not keys of the data. */
function recording(data: unknown, seen: Map<SectionId, Set<string>>): unknown {
	const note = (section: SectionId, key: string) => {
		if (key in Object.prototype) return;
		if (!seen.has(section)) seen.set(section, new Set());
		seen.get(section)!.add(key);
	};
	const wrap = (value: unknown, section: SectionId): unknown => {
		if (typeof value !== 'object' || value === null) return value;
		if (Array.isArray(value)) {
			return new Proxy(value, { get: (t, p, r) => (typeof p === 'string' && /^\d+$/.test(p) ? wrap(Reflect.get(t, p, r), section) : Reflect.get(t, p, r)) });
		}
		return new Proxy(value as object, {
			get: (t, p, r) => {
				if (typeof p !== 'string') return Reflect.get(t, p, r);
				note(section, p);
				const child = CHILD[section]?.[p];
				return child ? wrap(Reflect.get(t, p, r), child) : Reflect.get(t, p, r);
			},
			has: (t, p) => {
				if (typeof p === 'string') note(section, p);
				return Reflect.has(t, p);
			},
			getOwnPropertyDescriptor: (t, p) => {
				if (typeof p === 'string') note(section, p);
				return Reflect.getOwnPropertyDescriptor(t, p);
			},
		});
	};
	return wrap(data, 'top');
}

describe('the reader and the key table', () => {
	const parsed = parseBody(FULL);
	if (!parsed.ok) throw new Error('the full tree does not parse');
	const seen = new Map<SectionId, Set<string>>();
	const wrapped = recording(parsed.data, seen);
	const tree = readTree(parsed.doc, wrapped, FULL);
	referencedIds(wrapped as Record<string, unknown>);

	it('the full tree has every key of the table, and reads without a warning', () => {
		const present = new Map<SectionId, Set<string>>();
		const doc = parsed.data as Record<string, unknown>;
		const add = (section: SectionId, v: unknown) => {
			if (typeof v !== 'object' || v === null || Array.isArray(v)) return;
			if (!present.has(section)) present.set(section, new Set());
			for (const key of Object.keys(v)) present.get(section)!.add(key);
		};
		add('top', doc);
		add('options', doc.options);
		for (const h of doc.houses as unknown[]) add('houses', h);
		for (const t of doc.titles as Record<string, unknown>[]) {
			add('titles', t);
			for (const h of t.holders as unknown[]) add('holders', h);
		}
		for (const p of doc.people as Record<string, unknown>[]) {
			add('people', p);
			for (const r of (p.parents as unknown[] | undefined) ?? []) add('parents', r);
		}
		for (const u of doc.unions as unknown[]) add('unions', u);
		for (const x of KEYS) expect(present.get(x.section)?.has(x.key), `${x.section}.${x.key} is in the full tree`).toBe(true);
		for (const [section, keys] of present) for (const key of keys) expect(keysOf(section).some((x) => x.key === key), `${section}.${key} is in the table`).toBe(true);
		expect(tree.issues).toEqual([]);
	});

	it('asks only for keys that are in the table', () => {
		// The recording must see the keys at all, or the two tests below would pass for nothing.
		expect(seen.get('people')!.size).toBeGreaterThan(15);
		expect(seen.get('holders')!.size).toBe(7);
		for (const [section, keys] of seen) {
			for (const key of keys) expect(keysOf(section).some((x) => x.key === key), `the reader asks for ${section}.${key}`).toBe(true);
		}
	});

	it('asks for every key that is not reserved', () => {
		for (const x of KEYS.filter((y) => !y.reserved)) expect(seen.get(x.section)?.has(x.key), `the reader never asks for ${x.section}.${x.key}`).toBe(true);
	});

	it('never asks for a reserved key (kept, never read)', () => {
		for (const x of KEYS.filter((y) => y.reserved)) expect(seen.get(x.section)?.has(x.key) ?? false, `${x.section}.${x.key}`).toBe(false);
	});
});

describe('the values and the old names of the table', () => {
	it('lists the values of the constants of the code', () => {
		const by = (section: SectionId, key: string) => VALUE_LISTS.find((v) => v.section === section && v.key === key)!.values;
		expect(by('titles', 'succession')).toBe(SUCCESSION_RULES);
		expect(by('titles', 'inherit')).toBe(INHERIT_RULES);
		expect(by('titles', 'inherit-through')).toBe(INHERIT_THROUGH);
		expect(by('titles', 'inherit-illegitimate')).toBe(INHERIT_ILLEGITIMATE);
		expect(by('people', 'placement')).toBe(PLACEMENT_TYPES);
		expect(by('parents', 'type')).toBe(PARENT_TYPES);
		expect(by('unions', 'type')).toBe(UNION_TYPES);
		expect(by('unions', 'ended-by')).toBe(ENDED_BY);
		for (const v of VALUE_LISTS) expect(keysOf(v.section).some((x) => x.key === v.key), `${v.section}.${v.key}`).toBe(true);
	});

	it('reads each value, in upper case too, and each old name as the value on its right', () => {
		for (const v of SUCCESSION_RULES) expect(readRule(v.toUpperCase())).toBe(v);
		for (const v of INHERIT_RULES) expect(readInherit(v.toUpperCase())).toBe(v);
		for (const v of INHERIT_THROUGH) expect(readThrough(v.toUpperCase())).toBe(v);
		for (const v of INHERIT_ILLEGITIMATE) expect(readIllegitimate(v.toUpperCase())).toBe(v);
		for (const v of UNION_TYPES) expect(readUnionType(v.toUpperCase())).toBe(v);
		for (const v of ENDED_BY) expect(readEndedBy(v.toUpperCase())).toBe(v);
		for (const [old, now] of Object.entries(OLD_RULES)) expect(readRule(old), old).toBe(now);
		for (const [old, now] of Object.entries(OLD_INHERIT)) expect(readInherit(old), old).toBe(now);
		for (const [old, now] of Object.entries(OLD_THROUGH)) expect(readThrough(old), old).toBe(now);
		for (const [old, now] of Object.entries(OLD_ILLEGITIMATE)) expect(readIllegitimate(old), old).toBe(now);
		for (const [old, now] of Object.entries(OLD_UNION_TYPES)) expect(readUnionType(old), old).toBe(now);
		for (const [old, now] of Object.entries(OLD_ENDED_BY)) expect(readEndedBy(old), old).toBe(now);
	});

	it('reads another word as itself or as nothing (a partnership type of its own, no rule)', () => {
		expect(readUnionType('handfasting')).toBe('handfasting');
		expect(readRule('salic')).toBeUndefined();
		expect(readEndedBy('separation')).toBeNull();
	});
});

describe('the generated files', () => {
	const readme = readFileSync('README.md', 'utf8');

	it('docs/format.md is the output of the generator', () => {
		expect(readFileSync('docs/format.md', 'utf8')).toBe(formatDoc());
	});

	it('README.md has no generated table: one kin example and a link to docs/format.md', () => {
		expect(readme).not.toContain('format:start');
		expect(readme).not.toContain('format:end');
		expect(readme.split('```kin')).toHaveLength(2);
		expect(readme).toContain('[docs/format.md](docs/format.md)');
	});

	it('docs/format.md has a table row for every key', () => {
		const doc = formatDoc();
		for (const x of KEYS) expect(doc).toContain(`| \`${x.key}\``);
		const reserved = KEYS.filter((x) => x.reserved).length;
		expect(KEYS).toHaveLength(67);
		expect(reserved).toBe(3);
		expect(doc).toContain(`has ${KEYS.length} keys, ${reserved} of them reserved`);
	});

	it('says that the relation names read a year in born, died, start and end, and that ended-by is new in 0.5 (D306)', () => {
		for (const [section, key] of [['people', 'born'], ['people', 'died'], ['unions', 'start'], ['unions', 'end']] as const) {
			const x = keysOf(section).find((y) => y.key === key)!;
			expect(x.accepts, `${section}.${key}`).not.toContain('never reads it as a date');
			expect([x.meaning, x.accepts].join(' '), `${section}.${key}`).toContain('relation names');
		}
		const ended = keysOf('unions').find((y) => y.key === 'ended-by')!;
		expect(ended.since).toBe('0.5');
		expect(formatDoc()).toContain('Since version 0.5, the partnership key `ended-by`');
	});

	it('the README has the two sentences of the contract (E.5), as the clarity-editor checked them', () => {
		expect(readme).toContain('Keep an empty text line or a heading above a tree. If a tree is the first thing in a note, Live Preview opens the note with the cursor in the tree. Then you see the text of the tree, not the tree. To see the tree, move the cursor out of the tree.');
		expect(readme).toContain('If you use the same vault on two devices, wait until the sync is complete before you edit a tree on the other device. If you do not wait, the other device changes an old copy of the note, and the sync can lose one of the two edits.');
	});

	it('the meanings in the key table are short sentences without a word that ends in "ing" (STE)', () => {
		const allowed = new Set(['nothing', 'something', 'anything', 'during', 'morning', 'string', 'warning']);
		for (const x of KEYS) {
			for (const sentence of x.meaning.split(/(?<=[.!?])\s+/)) {
				expect(sentence.split(/\s+/).length, `${x.section}.${x.key}: ${sentence}`).toBeLessThanOrEqual(25);
				for (const w of sentence.toLowerCase().match(/[a-z]+ing\b/g) ?? []) expect(allowed.has(w), `${x.section}.${x.key}: "${w}"`).toBe(true);
			}
		}
	});
});

describe('what the table says about hand-typed forms (fix round of G2)', () => {
	const read = (text: string) => {
		const r = parseDynasty(text);
		if (!r.ok) throw new Error('does not parse');
		return r;
	};

	it('does not remove curly quote marks from titles.id and people.card-title', () => {
		const r = read('titles:\n  - id: “duchy”\n    name: Duchy\npeople:\n  - id: a\n    name: A\n    card-title: “duchy”\n');
		expect(r.tree.titles![0].id).toBe('“duchy”');
		expect(r.tree.people[0].cardTitle).toBe('“duchy”');
	});

	it('removes them from the keys that the table lists', () => {
		const r = read('options:\n  me: “a”\nhouses:\n  - id: “h”\n    name: H\npeople:\n  - id: “a”\n    name: A\n    house: “h”\n');
		expect(r.tree.options.me).toBe('a');
		expect(r.tree.houses[0].id).toBe('h');
		expect(r.tree.people[0].id).toBe('a');
		expect(r.tree.people[0].house).toBe('h');
	});

	it('warns about a partnership with one ID and skips it', () => {
		const r = read('people:\n  - id: a\n    name: A\nunions:\n  - partners: a\n');
		const v = validateTree(r.tree);
		expect(v.issues.map((i) => i.code)).toContain('union-partner-count');
		expect(v.unions).toEqual([]);
	});

	it('keeps options.format when an option is set or removed (me, focus)', () => {
		const src = 'options:\n  format: 2\npeople:\n  - id: a\n    name: A\n';
		for (const key of ['me', 'focus'] as const) {
			const set = applyOp(src, { kind: 'set-option', key, value: 'a' });
			if (!set.ok) throw new Error(set.code);
			expect(set.body).toContain('format: 2');
			expect(set.body).toContain(`${key}: a`);
			const off = applyOp(set.body, { kind: 'set-option', key, value: null });
			if (!off.ok) throw new Error(off.code);
			expect(off.body).toBe(src);
		}
	});

	it('keeps a hand-typed block list of parents when a parent is added', () => {
		const src = 'people:\n  - id: a\n    name: A\n    parents:\n      - b\n  - id: b\n    name: B\n  - id: c\n    name: C\n';
		const r = applyOp(src, { kind: 'add-parent', child: 'a', parent: 'c', type: 'adoptive', autoUnion: false });
		if (!r.ok) throw new Error(r.code);
		expect(r.body).toContain('    parents:\n      - b\n      - {id: c, type: adoptive}\n');
	});
});
