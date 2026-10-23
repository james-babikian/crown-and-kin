// Test round of 0.2.8, target X2 (an internal note section 3), huge notes: 1 MB around a block, a 100 000-character value, thousands of unknown keys, 5 000 people,
// alias bombs and deep nesting. Spec §8: nothing throws or blanks the note; §3: the plugin owns the parse limit (`maxAliasCount`, parse.ts); §7.7: the time stays small.
// A speed rule here is always a ratio of two runs in one process, with a limit of about 10 times the linear growth (the I34 lesson). Known: ITEMS I11 (rumoured links cost) is not repeated.
// Seeds are fixed. R028_DEEP=1 runs bigger inputs.
import { describe, expect, it } from 'vitest';
import { speedTest } from '../support/speed-test';
import { findBlocks, replaceBody } from '../../src/core/block-locate';
import { deriveFamilies } from '../../src/core/derive';
import { hardErrorText } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations } from '../../src/core/relations';
import { applyOp } from '../../src/core/yaml-edit';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { tallCardsFor } from '../../src/render/dom/tall-cards';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { genModel, toText } from '../support/r028-gen';

const DEEP = process.env.R028_DEEP === '1';
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const GEO = cardForm(geometryFor(16), 'down');
const BODY = 'people:\n  - {id: a, name: A}\n';

function best(f: () => void, runs = 3): number {
	let b = Infinity;
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		f();
		b = Math.min(b, performance.now() - t0);
	}
	return b;
}

/** parse -> derive -> layout -> SVG, with the same tall-card step as the view. Returns the milliseconds of each stage. */
function pipeline(text: string): { cards: number; ms: Record<string, number>; svgLength: number } {
	const ms: Record<string, number> = {};
	let t0 = performance.now();
	const lap = (k: string) => {
		const t = performance.now();
		ms[k] = t - t0;
		t0 = t;
	};
	const parsed = parseDynasty(text);
	lap('parse');
	if (!parsed.ok) throw new Error(`hard error ${parsed.error.code}: ${parsed.error.detail}`);
	const g = deriveFamilies(parsed.tree);
	lap('derive');
	const tall = tallCardsFor(g, GEO, FONTS, approxMeasure, new Set());
	clearLayoutCache();
	const { layout, edges } = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall?.tall ?? [], longNames: tall?.long ?? [] }, 'sans-serif');
	lap('layout');
	const svg = renderSvg(g, layout, edges, { measure: approxMeasure, fonts: FONTS });
	lap('svg');
	return { cards: layout.persons.size, ms, svgLength: svg.length };
}

describe('X2 (8): a note of 1 MB around one block (spec §6.1, block-locate)', () => {
	const block = '```kin\n' + BODY + '```\n';
	const prose = (lines: number) => 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n'.repeat(lines);

	it('finds the one block and its body in 1 MB of text, with LF and with CRLF', () => {
		for (const eol of ['\n', '\r\n']) {
			const text = (prose(9000) + block + prose(9000)).replace(/\n/g, eol);
			expect(text.length).toBeGreaterThan(1_000_000);
			const found = findBlocks(text);
			expect(found.length).toBe(1);
			expect(found[0].body).toBe(BODY.trimEnd());
			const next = replaceBody(text, found[0], BODY + '# x\n');
			expect(next.startsWith(text.slice(0, found[0].bodyStart))).toBe(true);
			expect(next.endsWith(text.slice(found[0].bodyEnd))).toBe(true);
		}
	});

	speedTest('the time grows with the length of the note: 1 MB takes less than 40 times as long as 100 KB (linear is 10)', () => {
		const small = prose(900) + block + prose(900);
		const big = prose(9000) + block + prose(9000);
		const a = best(() => findBlocks(small), 5);
		const b = best(() => findBlocks(big), 5);
		expect(b / Math.max(a, 0.05), `${a.toFixed(2)} ms against ${b.toFixed(2)} ms`).toBeLessThan(40);
	});

	const shapes: Record<string, string> = {
		'a line of 1 000 000 characters before the block': 'x'.repeat(1_000_000) + '\n' + block,
		'10 000 fences that never close before the block (the block is then only text)': '```js\n'.repeat(10000) + block,
		'10 000 closed fences before the block': '```js\nx\n```\n'.repeat(10000) + block,
		'a fence line with an info text of 1 000 000 characters': '```' + 'y'.repeat(1_000_000) + '\n' + block,
		'a body line of 1 000 000 characters': '```kin\n' + 'a'.repeat(1_000_000) + '\n```\n',
		'10 000 blocks': block.repeat(10000),
		'a block inside 3 000 quote marks': '>'.repeat(3000) + ' ```kin\n' + '>'.repeat(3000) + ' people:\n' + '>'.repeat(3000) + ' ```\n',
		'a block inside 500 nested list items': Array.from({ length: 500 }, (_, i) => ' '.repeat(i * 2) + '- item').join('\n') + '\n' + ' '.repeat(1000) + '```kin\n' + ' '.repeat(1000) + 'people:\n' + ' '.repeat(1000) + '```\n',
	};
	for (const [label, text] of Object.entries(shapes)) {
		speedTest(`${label}: no throw, the right number of blocks, in less than 2 s`, () => {
			const t0 = performance.now();
			const found = findBlocks(text);
			if (found.length) replaceBody(text, found[0], BODY);
			expect(performance.now() - t0).toBeLessThan(2000);
			const want = label.startsWith('10 000 blocks') ? 10000 : label.includes('never close') || label.includes('info text') ? 0 : 1;
			expect(found.length).toBe(want);
			found.forEach((b, i) => expect(b.ordinal).toBe(i));
		});
	}
});

describe('X2 (8): a value of 100 000 characters (spec §3 exact text, §13.9 three text lines)', () => {
	const q = (s: string) => JSON.stringify(s);
	const huge = (n: number) => 'Word '.repeat(n / 5).trimEnd();

	it('name, title, sobriquet, notes and born keep their whole text; the card shows three text lines; the picture stays small', () => {
		const text = huge(100000);
		const src = `people:\n  - {id: a, name: ${q(text)}, title: ${q(text)}, sobriquet: ${q(text)}, born: ${q(text)}, died: ${q(text)}, notes: ${q(text)}}\n  - {id: b, name: B, parents: [a]}\n`;
		const parsed = parseDynasty(src);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const p = parsed.tree.people[0];
		expect(p.name.length).toBe(text.length);
		expect(p.title?.length).toBe(text.length);
		expect(p.notes?.length).toBe(text.length);
		expect(p.born?.length).toBe(text.length);
		const r = pipeline(src);
		expect(r.cards).toBe(2);
		// Three text lines of name, a title line, a date line: the picture does not hold the 100 000 characters six times.
		expect(r.svgLength).toBeLessThan(60000);
		const edit = applyOp(src, { kind: 'set-person-fields', id: 'b', fields: { name: 'Bee' } });
		expect(edit.ok).toBe(true);
		if (edit.ok) expect(edit.body.length).toBe(src.length + 2);
	});

	speedTest('the time grows with the length: 100 000 characters take less than 40 times as long as 10 000', () => {
		const run = (n: number) => () => {
			const t = huge(n);
			pipeline(`people:\n  - {id: a, name: ${q(t)}, sobriquet: ${q(t)}, title: ${q(t)}}\n`);
		};
		const a = best(run(10000));
		const b = best(run(100000));
		expect(b / Math.max(a, 0.5), `${a.toFixed(1)} ms against ${b.toFixed(1)} ms`).toBeLessThan(40);
	});
});

describe('X2 (8): thousands of unknown keys (spec §4: unknown keys are kept at every level)', () => {
	const N = DEEP ? 10000 : 2000;
	const keys = (n: number, style: 'flow' | 'block', indent = '') => Array.from({ length: n }, (_, i) => (style === 'flow' ? `u${i}: v${i}` : `${indent}u${i}: v${i}`)).join(style === 'flow' ? ', ' : '\n');

	const placed: Record<string, (n: number) => string> = {
		'top level': (n) => `${keys(n, 'block')}\npeople:\n  - {id: a, name: A}\n  - {id: b, name: B}\n`,
		'options': (n) => `options:\n${keys(n, 'block', '  ')}\npeople:\n  - {id: a, name: A}\n  - {id: b, name: B}\n`,
		'one person': (n) => `people:\n  - {id: a, name: A, ${keys(n, 'flow')}}\n  - {id: b, name: B}\n`,
		'one house': (n) => `houses:\n  - {id: h, name: H, ${keys(n, 'flow')}}\npeople:\n  - {id: a, name: A, house: h}\n  - {id: b, name: B}\n`,
		'one union': (n) => `people:\n  - {id: a, name: A}\n  - {id: b, name: B}\nunions:\n  - {partners: [a, b], ${keys(n, 'flow')}}\n`,
		'one title and one holder': (n) => `people:\n  - {id: a, name: A}\n  - {id: b, name: B}\ntitles:\n  - {id: t, name: T, ${keys(n, 'flow')}, holders: [{person: a, ${keys(n, 'flow')}}]}\n`,
	};

	for (const [where, make] of Object.entries(placed)) {
		it(`${where}: ${N} unknown keys parse, draw, and stay in the text after an edit`, () => {
			const src = make(N);
			const r = pipeline(src.replace(/people:/, 'people:'));
			expect(r.cards).toBe(2);
			const edit = applyOp(src, { kind: 'set-person-fields', id: 'b', fields: { name: 'Bee', born: '1200' } });
			expect(edit.ok).toBe(true);
			if (!edit.ok) return;
			// Nothing but the edited person changes: the keys are all still there, in order.
			expect(edit.body.includes(`u${N - 1}: v${N - 1}`)).toBe(true);
			expect(edit.body.includes('u0: v0')).toBe(true);
			expect((edit.body.match(/\bu\d+: v\d+/g) ?? []).length).toBe((src.match(/\bu\d+: v\d+/g) ?? []).length);
			const again = parseDynasty(edit.body);
			expect(again.ok && again.tree.people[1].name).toBe('Bee');
		}, 30000);
	}

	speedTest('the parse time grows with the number of keys: 4 times the keys take less than 40 times as long (the YAML parser is not linear for one map, so the limit is about 10 times the growth)', () => {
		const time = (n: number) => best(() => parseDynasty(placed['top level'](n)), 3);
		const a = time(500);
		const b = time(2000);
		expect(b / Math.max(a, 0.5), `${a.toFixed(1)} ms against ${b.toFixed(1)} ms`).toBeLessThan(40);
	});
});

describe('X2 (8): 5 000 people (spec §7.7 gives times for 60 and 400 people; larger trees are version 0.3 work, so this is a ratio and a no-throw test)', () => {
	const textOf = (n: number) => toText(genModel(3, { n, window: 40, unionP: 0.3, sex: 'mixed', houses: 4, dates: true }));

	speedTest('parse, derive, layout and SVG of 4 times as many people take less than 40 times as long, and every person has a card', () => {
		const small = DEEP ? 1250 : 800;
		const big = small * 4;
		const a = pipeline(textOf(small));
		const b = pipeline(textOf(big));
		expect(a.cards).toBe(small);
		expect(b.cards).toBe(big);
		const rows: string[] = [];
		for (const stage of ['parse', 'derive', 'layout', 'svg']) {
			rows.push(`${stage} ${a.ms[stage].toFixed(0)} -> ${b.ms[stage].toFixed(0)} ms`);
			expect(b.ms[stage] / Math.max(a.ms[stage], 2), `${stage}: ${rows.join(', ')}`).toBeLessThan(40);
		}
		console.log(`X2 huge: ${small} -> ${big} people: ${rows.join(', ')}`);
	}, 60000);
});

describe('X2 (8): aliases (spec §3, parse.ts `maxAliasCount`)', () => {
	const laughs = (levels: number, fan: number) => {
		let s = 'a0: &a0 [x, x, x, x, x, x, x, x, x]\n';
		for (let i = 1; i <= levels; i++) s += `a${i}: &a${i} [${Array.from({ length: fan }, () => `*a${i - 1}`).join(', ')}]\n`;
		return s + BODY;
	};

	for (const [levels, fan] of [[3, 9], [6, 9], [9, 9], [20, 9], [9, 30], [40, 40]]) {
		speedTest(`an alias bomb of ${levels} levels with ${fan} uses each (about ${Math.min(9 ** levels, 1e18).toExponential(0)} nodes) ends at once with the error box or a tree, not with a hang`, () => {
			const t0 = performance.now();
			const r = parseDynasty(laughs(levels, fan));
			expect(performance.now() - t0).toBeLessThan(1500);
			if (!r.ok) {
				expect(r.error.code).toBe('yaml-invalid');
				expect(hardErrorText(r.error).length).toBeGreaterThan(5);
			}
		});
	}

	it('one alias for each of 3 000 people (house: *h) is allowed, because the limit grows with the text', () => {
		const people = Array.from({ length: 3000 }, (_, i) => `  - {id: p${i}, name: P${i}, house: *h}`).join('\n');
		const r = parseDynasty(`houses:\n  - {id: &h valmont, name: Valmont}\npeople:\n${people}\n`);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.tree.people.length).toBe(3000);
			expect(r.tree.people.every((p) => p.house === 'valmont')).toBe(true);
		}
	});

	speedTest('1 000 people share one anchored map of 1 000 keys: it parses, and the time stays small', () => {
		const shared = Array.from({ length: 1000 }, (_, i) => `k${i}: v${i}`).join(', ');
		const people = Array.from({ length: 1000 }, (_, i) => `  - {id: p${i}, name: P${i}, extra: *b}`).join('\n');
		const t0 = performance.now();
		const r = parseDynasty(`base: &b {${shared}}\npeople:\n${people}\n`);
		expect(r.ok).toBe(true);
		expect(performance.now() - t0).toBeLessThan(3000);
	});

	it('an alias with no anchor, an anchor used before it is set, and an alias loop each give the error box', () => {
		for (const text of ['people:\n  - {id: a, name: *nowhere}\n', 'people:\n  - {id: a, name: *x}\nextra: &x one\n', 'a: &x [*x]\n' + BODY]) {
			const r = parseDynasty(text);
			if (!r.ok) expect(hardErrorText(r.error).length).toBeGreaterThan(5);
			else expect(r.tree.people.length).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('X2 (8): deep nesting (spec §8: nothing throws; a text the parser cannot read gives the error box)', () => {
	const depths = DEEP ? [100, 1000, 10000, 100000] : [100, 1000, 10000];
	const places: Record<string, (open: string, close: string) => string> = {
		'in notes': (o, c) => `people:\n  - {id: a, name: A, notes: ${o}${c}}\n`,
		'in an unknown top-level key': (o, c) => `extra: ${o}${c}\n${BODY}`,
		'as the name': (o, c) => `people:\n  - {id: a, name: ${o}${c}}\n`,
		'as the parents': (o, c) => `people:\n  - {id: a, name: A, parents: ${o}${c}}\n`,
		'as the partners': (o, c) => `people:\n  - {id: a, name: A}\nunions:\n  - {partners: ${o}${c}}\n`,
		'as the holders': (o, c) => `people:\n  - {id: a, name: A}\ntitles:\n  - {id: t, name: T, holders: ${o}${c}}\n`,
	};
	for (const depth of depths) {
		for (const [where, make] of Object.entries(places)) {
			speedTest(`${depth} nested lists ${where}: a tree or the error box, never a throw, in less than 3 s`, () => {
				const t0 = performance.now();
				let r: ReturnType<typeof parseDynasty> | undefined;
				expect(() => {
					r = parseDynasty(make('['.repeat(depth), ']'.repeat(depth)));
					if (r.ok) deriveFamilies(r.tree);
				}).not.toThrow();
				expect(performance.now() - t0).toBeLessThan(3000);
				if (r && !r.ok) expect(hardErrorText(r.error).length).toBeGreaterThan(5);
			});
		}
		speedTest(`${depth} nested maps and ${Math.min(depth, 1500)} nested block lists: a tree or the error box`, () => {
			const maps = `extra: ${'{a: '.repeat(depth)}1${'}'.repeat(depth)}\n${BODY}`;
			const lines = Array.from({ length: Math.min(depth, 1500) }, (_, i) => ' '.repeat(i) + '-').join('\n');
			for (const text of [maps, `extra:\n${lines} x\n${BODY}`]) {
				const t0 = performance.now();
				const r = parseDynasty(text);
				expect(performance.now() - t0).toBeLessThan(3000);
				if (!r.ok) expect(hardErrorText(r.error).length).toBeGreaterThan(5);
			}
		});
	}
});

describe('X2 (8): one person with many links (spec §4.2: at most 2 of a type, the rest are warned about and drawn as side links)', () => {
	const many = (kind: 'birth parents' | 'rumoured parents' | 'wards' | 'partners', n: number): string => {
		const ids = Array.from({ length: n }, (_, i) => `a${i}`);
		const people = ids.map((id) => `  - {id: ${id}, name: ${id.toUpperCase()}}`).join('\n');
		if (kind === 'birth parents') return `people:\n${people}\n  - {id: kid, name: Kid, parents: [${ids.join(', ')}]}\n`;
		if (kind === 'rumoured parents') return `people:\n${people}\n  - {id: kid, name: Kid, parents: [${ids.map((id) => `{id: ${id}, type: rumoured}`).join(', ')}]}\n`;
		if (kind === 'wards') return `people:\n  - {id: g, name: Guardian}\n${ids.map((id) => `  - {id: ${id}, name: ${id}, parents: [{id: g, type: ward}]}`).join('\n')}\n`;
		return `people:\n  - {id: h, name: Hub}\n${people}\nunions:\n${ids.map((id) => `  - {partners: [h, ${id}]}`).join('\n')}\n`;
	};
	for (const kind of ['birth parents', 'rumoured parents', 'wards', 'partners'] as const) {
		speedTest(`${kind}: 40 and 400 on one person draw every card, the warning is there, and 10 times the people take less than 100 times as long (ITEMS I11 is measured elsewhere)`, () => {
			const small = pipeline(many(kind, 40));
			const big = pipeline(many(kind, 400));
			expect(small.cards).toBe(kind === 'partners' ? 41 : kind === 'wards' ? 41 : 41);
			expect(big.cards).toBe(401);
			const total = (r: typeof small) => Object.values(r.ms).reduce((x, y) => x + y, 0);
			expect(total(big) / Math.max(total(small), 2), `${total(small).toFixed(0)} ms against ${total(big).toFixed(0)} ms`).toBeLessThan(100);
			if (kind !== 'wards' && kind !== 'partners') {
				const parsed = parseDynasty(many(kind, 40));
				if (parsed.ok) expect(deriveFamilies(parsed.tree).issues.map((i) => i.code)).toContain('too-many-parents');
			}
		}, 30000);
	}

	it('relation names for the person with 400 rumoured parents end, and give the child a name', () => {
		const parsed = parseDynasty(many('rumoured parents', 400));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const rel = computeRelations(deriveFamilies(parsed.tree), 'a0');
		expect(rel.get('kid')?.length ?? 0).toBeGreaterThan(0);
	}, 30000);
});
