// Test round of 0.2.8, target X3 (an internal note section 3): strange YAML. Each sample tree and some generated trees are written in equal forms (block and flow lists and maps,
// quote styles, comments at every place, blank lines, CRLF, a BOM, document markers, trailing spaces, block scalars, a shuffled order of keys) and must read as the same model (a metamorphic oracle,
// spec §3, §4). Then the hand-typed forms of §8 and §13.4, the failsafe texts of §3, broken forms (§8: issues, never a throw) and edits that keep unknown keys (§4).
// The model leaves out the `text` fields (the source text of a union or holder differs with the form on purpose) and compares the issue codes, not their wording.
// Seeds are fixed. R028_DEEP=1 runs more mutations.
import { Scalar, parseDocument, visit, type Document } from 'yaml';
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { hardErrorText, issueText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { allFixtures } from './acceptance/load';
import { genModel, rng, shuffled, toText } from './r028-gen';

const DEEP = process.env.R028_DEEP === '1';

function strip(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(strip);
	if (v && typeof v === 'object') {
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>)
				.filter(([k]) => k !== 'text')
				.map(([k, x]) => [k, strip(x)]),
		);
	}
	return v;
}

/** The model of a text for comparison: everything the reader makes, without the source texts; or the hard error code. */
function modelOf(text: string): string {
	const r = parseDynasty(text);
	if (!r.ok) return `HARD ${r.error.code}`;
	const t = r.tree;
	const issues = t.issues.map((i) => `${i.code}:${JSON.stringify(i.ids ?? '')}`).sort();
	return JSON.stringify(strip({ options: t.options, houses: t.houses, people: t.people, unions: t.unions, titles: t.titles, issues }));
}

/** What differs between two models, as short text. */
function whatDiffers(a: string, b: string): string {
	if (a.startsWith('HARD') || b.startsWith('HARD')) return b.startsWith('HARD') ? b : 'the plain form is a hard error';
	const x = JSON.parse(a) as Record<string, unknown>;
	const y = JSON.parse(b) as Record<string, unknown>;
	return Object.keys(x)
		.filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]))
		.map((k) => `${k}: ${JSON.stringify(x[k]).slice(0, 120)} against ${JSON.stringify(y[k]).slice(0, 120)}`)
		.join(' | ');
}

function viaDoc(src: string, change: (doc: Document) => void, options: Parameters<Document['toString']>[0] = {}): string {
	const doc = parseDocument(src, { schema: 'failsafe' });
	change(doc);
	return doc.toString(options);
}
const quoteAll = (type: Scalar.Type, keysToo = false) => (doc: Document) =>
	visit(doc, {
		Scalar(key, node) {
			if (typeof node.value === 'string' && (keysToo || key !== 'key')) node.type = type;
		},
	});
const flow = (on: boolean) => (doc: Document) =>
	visit(doc, {
		Map(_, n) {
			n.flow = on;
		},
		Seq(_, n) {
			n.flow = on;
		},
	});

interface Form {
	name: string;
	/** Needs a valid YAML text that the library can write again (not the broken fixtures). */
	viaLibrary: boolean;
	apply: (src: string) => string;
}

const FORMS: Form[] = [
	{ name: 'written again by the library', viaLibrary: true, apply: (s) => viaDoc(s, () => {}) },
	{ name: 'every list and map in flow form', viaLibrary: true, apply: (s) => viaDoc(s, flow(true), { lineWidth: 0 }) },
	{ name: 'every list and map in block form', viaLibrary: true, apply: (s) => viaDoc(s, flow(false)) },
	{ name: 'all values in double quotes', viaLibrary: true, apply: (s) => viaDoc(s, quoteAll(Scalar.QUOTE_DOUBLE)) },
	{ name: 'all values in single quotes', viaLibrary: true, apply: (s) => viaDoc(s, quoteAll(Scalar.QUOTE_SINGLE)) },
	{ name: 'keys and values in double quotes', viaLibrary: true, apply: (s) => viaDoc(s, quoteAll(Scalar.QUOTE_DOUBLE, true)) },
	{ name: 'all values as block scalars |-', viaLibrary: true, apply: (s) => viaDoc(s, (d) => (flow(false)(d), quoteAll(Scalar.BLOCK_LITERAL)(d))) },
	{ name: 'all values as block scalars >-', viaLibrary: true, apply: (s) => viaDoc(s, (d) => (flow(false)(d), quoteAll(Scalar.BLOCK_FOLDED)(d))) },
	{ name: 'indent of 4', viaLibrary: true, apply: (s) => viaDoc(s, flow(false), { indent: 4 }) },
	{ name: 'lists not indented under their key', viaLibrary: true, apply: (s) => viaDoc(s, flow(false), { indentSeq: false }) },
	{ name: 'long text folded over lines (width 12)', viaLibrary: true, apply: (s) => viaDoc(s, () => {}, { lineWidth: 12, minContentWidth: 0 }) },
	{ name: 'flow form folded over lines (width 16)', viaLibrary: true, apply: (s) => viaDoc(s, flow(true), { lineWidth: 16, minContentWidth: 0 }) },
	{ name: 'keys in another order (seeded)', viaLibrary: true, apply: (s) => viaDoc(s, (d) => visit(d, { Map(_, n) { const idx = shuffled(n.items.map((_, i) => i), 77 + n.items.length); n.items = idx.map((i) => n.items[i]); } })) },
	{ name: 'CRLF', viaLibrary: false, apply: (s) => s.replace(/\n/g, '\r\n') },
	{ name: 'a BOM', viaLibrary: false, apply: (s) => `\uFEFF${s}` },
	{ name: 'BOM and CRLF', viaLibrary: false, apply: (s) => `\uFEFF${s.replace(/\n/g, '\r\n')}` },
	{ name: 'trailing spaces', viaLibrary: false, apply: (s) => s.replace(/\n/g, '   \n') },
	{ name: 'a blank line after every line', viaLibrary: false, apply: (s) => s.replace(/\n/g, '\n\n') },
	{ name: 'a comment line before every line', viaLibrary: false, apply: (s) => s.split('\n').map((l) => `# a comment: [ { "\n${l}`).join('\n') },
	{ name: 'a comment at the end of every line that has none', viaLibrary: false, apply: (s) => s.split('\n').map((l) => (l.trim() && !l.includes('#') ? `${l}   # note: a, b` : l)).join('\n') },
	{ name: '--- and ... markers', viaLibrary: false, apply: (s) => `---\n${s}...\n` },
	{ name: '--- and a comment after it', viaLibrary: false, apply: (s) => `--- # start\n${s}` },
	{ name: 'a tab after each colon', viaLibrary: false, apply: (s) => s.replace(/^(\s*[\w-]+:) /gm, '$1\t') },
	{ name: 'no newline at the end', viaLibrary: false, apply: (s) => s.replace(/\n+$/, '') },
	{ name: 'several blank lines at the end', viaLibrary: false, apply: (s) => `${s}\n\n\n` },
];
/** Sample trees that are broken on purpose, or hand-typed in forms that the library would write another way. */
const TEXT_ONLY = new Set(['05', '10']);

describe('X3 (1): the sample trees in equal forms give the same model (spec §3, §4)', () => {
	const fixtures = allFixtures();
	/** The models of the plain forms, made once. */
	const plainModels = new Map(fixtures.map((f) => [f.id, modelOf(f.source)]));
	/** The two big samples (400 people) go through a few forms only, to keep the file fast. */
	const BIG = new Set(['07', '07b']);
	const BIG_FORMS = new Set(['written again by the library', 'CRLF', 'a BOM', 'a comment at the end of every line that has none', 'keys in another order (seeded)']);
	for (const form of FORMS) {
		it(`${form.name}`, () => {
			const problems: string[] = [];
			for (const f of fixtures) {
				if (form.viaLibrary && TEXT_ONLY.has(f.id)) continue;
				if (BIG.has(f.id) && !BIG_FORMS.has(form.name)) continue;
				const plain = plainModels.get(f.id)!;
				let text: string;
				try {
					text = form.apply(f.source);
				} catch (e) {
					problems.push(`sample ${f.id}: the test could not write the form: ${(e as Error).message}`);
					continue;
				}
				const got = modelOf(text);
				if (got !== plain) problems.push(`sample ${f.id}: ${whatDiffers(plain, got)}`);
			}
			expect(problems).toEqual([]);
		});
	}

	it('generated trees (with all four parent types, unions and houses) in every form', () => {
		const problems: string[] = [];
		const count = DEEP ? 24 : 3;
		for (let seed = 1; seed <= count; seed++) {
			const src = toText(genModel(seed, { n: 40, adoptive: 0.1, ward: 0.05, rumoured: 0.1, illegitimate: 0.1, unionP: 0.4, sex: 'mixed', houses: 3, dates: true, cycles: seed % 3 === 0 ? 2 : 0 }));
			const plain = modelOf(src);
			for (const form of FORMS) {
				const got = modelOf(form.apply(src));
				if (got !== plain) problems.push(`seed ${seed} / ${form.name}: ${whatDiffers(plain, got)}`);
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it('the models are not empty: the comparison has something to compare', () => {
		const sizes = fixtures.filter((f) => !['05'].includes(f.id)).map((f) => JSON.parse(modelOf(f.source)).people.length as number);
		expect(Math.min(...sizes)).toBeGreaterThan(0);
		expect(fixtures.length).toBeGreaterThanOrEqual(17);
	});
});

describe('X3 (1): comments at every place (spec §4: comments are kept; they are not data)', () => {
	const PLAIN = ['people:', '  - id: a', '    name: A', '    parents: [b, c]', '  - id: b', '    name: B', '    born: 1100', '  - id: c', '    name: C', 'unions:', '  - partners: [b, c]', ''].join('\n');
	const COMMENTED = [
		'# before everything',
		'people: # after a key',
		'  # between the key and the first item',
		'  - # after a dash',
		'    id: a # after a value',
		'    name: A',
		'    # between keys',
		'    parents: # after a key with a list below',
		'      # inside the list',
		'      - b # after an item',
		'      - c',
		'      # end of the list',
		'  - {id: b, # inside a flow map',
		'     name: B, # a second one',
		'     born: 1100 # before the closing brace',
		'    } # after the closing brace',
		'  - id: c # c',
		'    name: C',
		'',
		'unions: # unions',
		'  - partners: [b, # in a flow list',
		'      c] # end',
		'# the end',
		'',
	].join('\n');
	it('a tree with a comment at 17 places has the model of the tree without comments', () => {
		const withComments = parseDynasty(COMMENTED);
		expect(withComments.ok).toBe(true);
		expect(modelOf(COMMENTED)).toBe(modelOf(PLAIN));
	});

	it('an edit of one person keeps every comment', () => {
		const r = applyOp(COMMENTED, { kind: 'set-person-fields', id: 'b', fields: { name: 'Bee', died: '1160' } });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		for (const c of ['# before everything', '# after a key', '# between the key and the first item', '# after a dash', '# after a value', '# between keys', '# inside the list', '# after an item', '# end of the list', '# a second one', '# after the closing brace', '# unions', '# in a flow list', '# the end']) {
			expect(r.body.includes(c), `the comment "${c}" is gone`).toBe(true);
		}
	});
});

describe('X3 (2): block scalars where a value is written (spec §3: the text as written; the reader cuts outer white space)', () => {
	const HEADERS = ['|', '|-', '|+', '>', '>-', '>+'];
	for (const header of HEADERS) {
		it(`${header} for the name, title, dates, notes, and for the ids that other entries refer to`, () => {
			const src = `people:\n  - id: ${header}\n      aldric\n    name: ${header}\n      Aldric Valmont\n    title: ${header}\n      Duke of Valmont\n    born: ${header}\n      1102\n    died: ${header}\n      1161\n    notes: ${header}\n      line one\n      line two\n\n  - id: b\n    name: B\n    parents: [aldric]\n`;
			const r = parseDynasty(src);
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const p = r.tree.people[0];
			expect([p.id, p.name, p.title, p.born, p.died]).toEqual(['aldric', 'Aldric Valmont', 'Duke of Valmont', '1102', '1161']);
			expect(p.notes?.replace(/\s+/g, ' ')).toBe('line one line two');
			expect(deriveFamilies(r.tree).issues.map((i) => i.code)).toEqual([]);
			expect(r.tree.people[1].parents.map((x) => x.id)).toEqual(['aldric']);
		});
	}
});

describe('X3 (2): the hand-typed forms of spec §8 and §13.4 read as written there', () => {
	const people = (extra: string) => `people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n${extra}`;
	it('a link without quotes, [[Foo Bar]], is flattened to the link text (§5.2)', () => {
		const r = parseDynasty('people:\n  - id: a\n    name: A\n    link: [[Foo Bar]]\n  - id: b\n    name: B\n    link: [[Foo|Alias]]\n');
		expect(r.ok && r.tree.people.map((p) => p.link)).toEqual(['[[Foo Bar]]', '[[Foo|Alias]]']);
	});
	it('an embed without quotes, portrait: ![[face.png]], is not an error (§13.0 item 3)', () => {
		const r = parseDynasty('people:\n  - id: a\n    name: A\n    portrait: ![[face.png]]\nhouses:\n  - id: h\n    name: H\n    arms: ![[arms.png]]\n');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.tree.people[0].portrait).toBe('![[face.png]]');
			expect(r.tree.houses[0].arms).toBe('![[arms.png]]');
		}
	});
	it('numeric ids are text; 0042 and 42 are two ids; options.start 42 names the person 42 (§8 "numeric ids (stringified)")', () => {
		const r = parseDynasty('options:\n  start: 42\npeople:\n  - {id: 42, name: A}\n  - {id: 0042, name: B, parents: [42]}\n');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.tree.people.map((p) => p.id)).toEqual(['42', '0042']);
		expect(r.tree.options.start).toBe('42');
		const g = deriveFamilies(r.tree);
		expect(g.issues).toEqual([]);
		expect(g.placementParents.get('0042')).toEqual(['42']);
	});
	it('a single string where a list is expected: parents, partners, holders, heir, exclude (§8 "a single string where a list was expected", §13.4)', () => {
		const r = parseDynasty(`${people('')}unions:\n  - partners: [a, b]\ntitles:\n  - {id: t, name: T, holders: a, heir: b, exclude: a}\n`);
		const c = parseDynasty('people:\n  - {id: a, name: A}\n  - {id: b, name: B, parents: a}\n');
		expect(r.ok && r.tree.titles?.[0].holders.map((h) => h.person)).toEqual(['a']);
		expect(r.ok && r.tree.titles?.[0].heirs).toEqual(['b']);
		expect(r.ok && r.tree.titles?.[0].exclude).toEqual(['a']);
		expect(c.ok && c.tree.people[1].parents.map((x) => x.id)).toEqual(['a']);
	});
	it('a holder written as a plain string is the same as {person: id} (§13.4 "Tolerated silently")', () => {
		const r = parseDynasty(`${people('')}titles:\n  - id: t\n    name: T\n    holders:\n      - a\n      - {person: b}\n      - "a"\n`);
		expect(r.ok && r.tree.titles?.[0].holders.map((h) => h.person)).toEqual(['a', 'b', 'a']);
	});
	it('the old names of the succession values are read as the new value and kept as written; inherit-illegitimate yes and false (§8 "From 0.2.7 also")', () => {
		const r = parseDynasty(`${people('')}titles:\n  - {id: t, name: T, succession: primogeniture, inherit: male-only, inherit-illegitimate: yes}\n  - {id: u, name: U, succession: brothers-first, inherit-illegitimate: false}\n`);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const [t, u] = r.tree.titles!;
		expect([t.succession, t.inherit, t.inheritIllegitimate]).toEqual(['primogeniture', 'male-only', 'after']);
		expect([u.succession, u.inheritIllegitimate]).toEqual(['brothers-first', undefined]);
		expect(deriveFamilies(r.tree).issues.map((i) => i.code).filter((c) => c.startsWith('unknown-'))).toEqual([]);
	});
	it('curly marks around an id in heir and exclude, and around a colour, house, link and union reference, are taken off (§8, D103)', () => {
		const r = parseDynasty('houses:\n  - {id: h, name: H, color: “#8b1e3f”}\npeople:\n  - {id: a, name: A, house: “h”}\n  - {id: b, name: B, parents: [“a”, {id: “a”, type: ward}]}\ntitles:\n  - {id: t, name: T, heir: “b”, exclude: [“a”, ‘b’]}\n');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.tree.houses[0].color).toBe('#8b1e3f');
		expect(r.tree.people[0].house).toBe('h');
		expect(r.tree.people[1].parents.map((x) => x.id)).toEqual(['a', 'a']);
		expect(r.tree.titles?.[0].heirs).toEqual(['b']);
		expect(r.tree.titles?.[0].exclude).toEqual(['a', 'b']);
	});
	it('an unquoted house colour is a comment: the colour is missing and the warning house-color-null suggests quotes (§8)', () => {
		const r = parseDynasty('houses:\n  - id: h\n    name: H\n    color: #8b1e3f\npeople:\n  - {id: a, name: A, house: h}\n');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.tree.houses[0].color).toBeUndefined();
		expect(r.tree.issues.map((i) => i.code)).toContain('house-color-null');
	});
	it('a sex that is a spelling of m or f keeps its meaning and gives sex-spelling (§8, D188 item 4)', () => {
		const r = parseDynasty('people:\n  - {id: a, name: A, sex: Male}\n  - {id: b, name: B, sex: F}\n  - {id: c, name: C, sex: x}\n');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const g = deriveFamilies(r.tree);
		expect(g.issues.filter((i) => i.code === 'sex-spelling').map((i) => i.ids)).toEqual([['a'], ['b']]);
	});
});

describe('X3 (3): the failsafe schema keeps these texts as written (spec §3; the decision notes: a plain ~, null or empty value is "nothing written")', () => {
	const WORDS = ['yes', 'no', 'true', 'false', 'on', 'off', 'Y', 'N', '1e3', '0x10', '0o7', '1_000', '.inf', '-.inf', '.nan', '0042', '-0', '+1', '1.0', '12:30', '1102-03-04', '2020-01-01T00:00:00Z', '0.5', '5e-3'];
	it('as the name, the title, the dates, the house, the id and a parent reference', () => {
		for (const w of WORDS) {
			const r = parseDynasty(`houses:\n  - {id: ${w}, name: House}\npeople:\n  - {id: ${w}, name: ${w}, title: ${w}, born: ${w}, died: ${w}, house: ${w}}\n  - {id: kid, name: Kid, parents: [${w}]}\n`);
			expect(r.ok, w).toBe(true);
			if (!r.ok) continue;
			const p = r.tree.people[0];
			expect([p.id, p.name, p.title, p.born, p.died, p.house], w).toEqual([w, w, w, w, w, w]);
			expect(r.tree.people[1].parents.map((x) => x.id), w).toEqual([w]);
			expect(deriveFamilies(r.tree).issues, w).toEqual([]);
		}
	});
	it('a plain ~, null or empty value means nothing written; the same words in quotes are text', () => {
		const r = parseDynasty('people:\n  - {id: a, name: A, born: ~, died: null, title: }\n  - {id: b, name: B, born: "~", died: "null", title: ""}\n');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const [a, b] = r.tree.people;
		expect([a.born, a.died, a.title]).toEqual([undefined, undefined, undefined]);
		expect([b.born, b.died]).toEqual(['~', 'null']);
	});
	it('options.generations and options.height are read as numbers by the plugin; text that is not a number gives no value, not an error', () => {
		const ok = parseDynasty('options:\n  generations: 3\n  height: 400\npeople:\n  - {id: a, name: A}\n');
		expect(ok.ok && [ok.tree.options.generations, ok.tree.options.height]).toEqual([3, 400]);
		const bad = parseDynasty('options:\n  generations: many\n  height: tall\npeople:\n  - {id: a, name: A}\n');
		expect(bad.ok).toBe(true);
	});
});

describe('X3 (4): broken forms give a hard error with a text, or a tree with issues; never a throw (spec §8)', () => {
	const A = '  - {id: a, name: A}\n';
	const BROKEN: Record<string, string> = {
		'a duplicate key in a person': 'people:\n  - {id: a, name: A, name: B}\n',
		'a duplicate top-level key': `people:\n${A}people:\n  - {id: b, name: B}\n`,
		'a tab as indent': 'people:\n\t- id: a\n\t  name: A\n',
		'a key with no value': 'people:\n  - id:\n    name:\n  - id: b\n    name: B\n',
		'people is a number': 'people: 5\n',
		'people is a map': 'people:\n  a: {name: A}\n',
		'people items are not maps': 'people:\n  - justname\n  - 5\n  - ~\n  - [a]\n',
		'ids are maps and lists': 'people:\n  - {id: {x: 1}, name: A}\n  - {id: [a, b], name: B}\n',
		'houses is a string': `houses: nope\npeople:\n${A}`,
		'unions is a string': `unions: nope\npeople:\n${A}`,
		'titles is a map': `titles:\n  a: 1\npeople:\n${A}`,
		'a title with a list for the name': `titles:\n  - {id: t, name: [a, b], holders: {x: y}, heir: {z: 1}, year: [1], succession: [x], inherit: {a: b}}\npeople:\n${A}`,
		'a union of three, of one, of none, a number, and no partners': `people:\n${A}  - {id: b, name: B}\nunions:\n  - partners: [a, b, a]\n  - partners: a\n  - partners: []\n  - 5\n  - {type: marriage}\n`,
		'an unclosed flow list': 'people:\n  - {id: a, name: A, parents: [b, c}\n',
		'an unclosed quote': 'people:\n  - {id: a, name: "A}\n',
		'a top-level list': '- a\n- b\n',
		'a top-level text': 'hello\n',
		'a second document': `people:\n${A}---\npeople:\n${A}`,
		'a YAML directive': `%YAML 1.2\n---\npeople:\n${A}`,
		'an undefined alias': 'people:\n  - {id: a, name: *nobody}\n',
		'a tag the plugin does not know': 'people:\n  - {id: a, name: !!binary AAAA}\n',
		'a python tag': 'people:\n  - !!python/object:os.system {id: a, name: A}\n',
		'a complex key': 'people:\n  - ? [a, b]\n    : c\n',
		'a null byte': 'people:\n  - {id: a, name: "A\\0B"}\n',
		'a lone surrogate': 'people:\n  - {id: a, name: "A\\uD800B"}\n',
		'only a comment': '# nothing\n',
		'an empty text': '',
		'only white space': '  \n\n\t\n',
		'a key of 10 000 characters': `${'k'.repeat(10000)}: 1\npeople:\n${A}`,
		'a merge key': `base: &b {name: N}\npeople:\n  - {<<: *b, id: a}\n`,
		'a self-containing alias': `a: &x [*x]\npeople:\n${A}`,
		'a flow map with a colon in a key': 'people:\n  - {id: a, name: A, x:y: 1}\n',
		'a text line with only a dash': 'people:\n  -\n  - {id: a, name: A}\n',
		'windows path as a name': 'people:\n  - {id: a, name: C:\\Users\\x}\n',
	};

	for (const [label, text] of Object.entries(BROKEN)) {
		it(`${label}`, () => {
			let r: ReturnType<typeof parseDynasty> | undefined;
			expect(() => (r = parseDynasty(text))).not.toThrow();
			if (!r) return;
			if (!r.ok) {
				expect(['yaml-invalid', 'not-a-map']).toContain(r.error.code);
				expect(hardErrorText(r.error).trim().length).toBeGreaterThan(5);
				return;
			}
			const g = deriveFamilies(r.tree);
			for (const i of g.issues) expect(issueText(i).trim().length, i.code).toBeGreaterThan(5);
			clearLayoutCache();
			const { layout, edges } = layoutTree(g, cardForm(geometryFor(16), 'down'), DEFAULT_LAYOUT_SETTINGS, 'sans-serif');
			expect(layout.persons.size).toBe(g.people.length);
			renderSvg(g, layout, edges, { measure: approxMeasure, fonts: { text: 'serif', ui: 'sans', bold: '700' } });
		});
	}

	it('a damaged sample: 1 to 4 changes of single characters (deleted, inserted YAML signs, cut, a line twice, a line removed) in 400 mutated samples never throw, and every tree that reads is drawn', () => {
		const SIGNS = [':', '-', '[', ']', '{', '}', ',', '#', '&', '*', '!', '|', '>', "'", '"', '%', '@', '`', '\t', '\r', '\n', ' ', '?', '\u0000', '\ufeff', '…', '“', '”', '\\'];
		// The three big samples are left out: a mutated tree of 400 people takes 100 ms to draw.
		const fixtures = allFixtures().filter((f) => !['06', '07', '07b'].includes(f.id));
		const rand = rng(21);
		const problems: string[] = [];
		let hard = 0;
		let read = 0;
		const count = DEEP ? 3000 : 400;
		for (let i = 0; i < count; i++) {
			const f = fixtures[Math.floor(rand() * fixtures.length)];
			let t = f.source;
			for (let k = 0, n = 1 + Math.floor(rand() * 4); k < n; k++) {
				const pos = Math.floor(rand() * t.length);
				const m = Math.floor(rand() * 5);
				if (m === 0) t = t.slice(0, pos) + t.slice(pos + 1 + Math.floor(rand() * 5));
				else if (m === 1) t = t.slice(0, pos) + SIGNS[Math.floor(rand() * SIGNS.length)] + t.slice(pos);
				else if (m === 2) t = t.slice(0, pos);
				else if (m === 3) {
					const a = t.indexOf('\n', pos);
					const b = t.indexOf('\n', a + 1);
					if (a > 0 && b > a) t = t.slice(0, a + 1) + t.slice(a + 1, b + 1).repeat(2) + t.slice(b + 1);
				} else t = t.slice(0, pos) + t.slice(pos).replace(/^[^\n]*\n/, '');
			}
			try {
				const p = parseDynasty(t);
				if (!p.ok) {
					hard++;
					if (!hardErrorText(p.error).trim()) problems.push(`mutation ${i} of sample ${f.id}: an empty error text`);
					continue;
				}
				read++;
				const g = deriveFamilies(p.tree);
				clearLayoutCache();
				const { layout, edges } = layoutTree(g, cardForm(geometryFor(16), 'down'), DEFAULT_LAYOUT_SETTINGS, 'sans-serif');
				renderSvg(g, layout, edges, { measure: approxMeasure, fonts: { text: 'serif', ui: 'sans', bold: '700' } });
				if (layout.persons.size !== g.people.length) problems.push(`mutation ${i} of sample ${f.id}: ${layout.persons.size} cards for ${g.people.length} people`);
				for (const is of g.issues) if (!issueText(is).trim()) problems.push(`mutation ${i} of sample ${f.id}: an empty text for ${is.code}`);
			} catch (e) {
				problems.push(`mutation ${i} of sample ${f.id} (seed 21): THROW ${(e as Error).message}`);
			}
		}
		// A guard: the mutations give both outcomes.
		expect(hard).toBeGreaterThan(count / 10);
		expect(read).toBeGreaterThan(count / 10);
		expect(problems.slice(0, 5)).toEqual([]);
	}, 60000);
});

describe('X3 (5): an edit keeps the unknown keys, the comments and the form of everything else (spec §4, §6.2)', () => {
	const UNKNOWN = ['archive-shelf: B-12', "motto: 'Root and branch'", 'epithet: the Patient', 'nickname: Ros', 'since: 1140', 'witnessed-by: the Abbot', 'chronicle: Greyfen Rolls'];
	const sample09 = allFixtures().find((f) => f.id === '09')!.source;
	const sample13 = allFixtures().find((f) => f.id === '13')!.source;

	/** The lines that changed between two texts, found from both ends. */
	function changedLines(before: string, after: string): { before: string[]; after: string[] } {
		const a = before.split('\n');
		const b = after.split('\n');
		let pre = 0;
		while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
		let suf = 0;
		while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
		return { before: a.slice(pre, a.length - suf), after: b.slice(pre, b.length - suf) };
	}

	const FORMS_FOR_EDIT = FORMS.filter((f) => !f.viaLibrary || ['written again by the library', 'indent of 4', 'every list and map in block form'].includes(f.name));
	for (const form of FORMS_FOR_EDIT) {
		it(`${form.name}: a rename and a new date change only the lines of that person; every unknown key and comment stays`, () => {
			const text = form.apply(sample09);
			const before = parseDynasty(text);
			expect(before.ok).toBe(true);
			if (!before.ok) return;
			const id = 'rosamund';
			const r = applyOp(text, { kind: 'set-person-fields', id, fields: { name: 'Rosamund of Greyfen', died: '1190' } });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			for (const u of UNKNOWN) {
				const key = u.split(':')[0];
				expect(r.body.includes(`${key}:`), `the unknown key ${key} is gone`).toBe(true);
			}
			const after = parseDynasty(r.body);
			expect(after.ok).toBe(true);
			if (!after.ok) return;
			const changed = changedLines(text, r.body);
			// Only the lines of that person's entry change; the form (the line ends, a BOM) stays.
			expect(changed.before.join('\n')).toMatch(/Rosamund|nickname|sex|born|parents|name|id: rosamund|^\s*$|^\s*-/);
			expect(changed.before.length).toBeLessThanOrEqual(8);
			const eolBefore = (text.match(/\r\n/g) ?? []).length;
			const eolAfter = (r.body.match(/\r\n/g) ?? []).length;
			if (eolBefore) expect((r.body.match(/\n/g) ?? []).length, 'a new line ending without CR').toBe(eolAfter);
			if (text.startsWith('\uFEFF')) expect(r.body.startsWith('\uFEFF')).toBe(true);
			const model = JSON.parse(modelOf(r.body)) as { people: { id: string; name: string; died?: string }[] };
			expect(model.people.find((p) => p.id === id)).toMatchObject({ name: 'Rosamund of Greyfen', died: '1190' });
			const others = JSON.parse(modelOf(text)) as typeof model;
			expect(model.people.filter((p) => p.id !== id)).toEqual(others.people.filter((p) => p.id !== id));
		});
	}

	it('a title section with succession keys keeps its keys, comments and holders through an edit of a person (sample 13 and 16)', () => {
		const sample16 = allFixtures().find((f) => f.id === '16')!.source;
		for (const [label, src] of [['13', sample13], ['16', sample16]] as const) {
			const first = parseDynasty(src);
			expect(first.ok, label).toBe(true);
			if (!first.ok) continue;
			const id = first.tree.people[0].id;
			const r = applyOp(src, { kind: 'set-person-fields', id, fields: { sobriquet: 'the Test' } });
			expect(r.ok, label).toBe(true);
			if (!r.ok) continue;
			const was = JSON.parse(modelOf(src)) as { titles: unknown };
			const now = JSON.parse(modelOf(r.body)) as { titles: unknown };
			expect(now.titles, label).toEqual(was.titles);
			const changed = changedLines(src, r.body);
			expect(changed.before.length, label).toBeLessThanOrEqual(8);
		}
	});
});
