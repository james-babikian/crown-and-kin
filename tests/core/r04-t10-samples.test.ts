import { describe, expect, it } from 'vitest';
import { planWrite } from '../../src/core/block-write';
import { applyOp } from '../../src/core/yaml-edit';
import { deriveFamilies } from '../../src/core/derive';
import { findBlocks } from '../../src/core/block-locate';
import { parseDynasty } from '../../src/core/parse';
import type { EditResult, Op } from '../../src/core/edit';
import { replaceOnce } from '../acceptance/golden';
import { topLevelBlocks } from '../acceptance/load';
import { T10, bodyOf, noteOf } from '../support/r04-t10';

/*
 * The release plan T10, version 0.4: the sample trees 17 (same-sex couples), 18 (names in many scripts) and 19 (right-to-left names).
 * Spec §4 (the tree text keeps every value as written, §4.1), §6.1 (the write path touches only the body of the block), §6.2
 * (minimal-diff writing: a changed value is written plain if plain YAML reads it back as the same text, else in double quotes;
 * a value written in quotes keeps its quotes), §8 (a note with no problem shows no warning).
 * Every expected value is written by hand in tests/support/r04-t10.ts or in this file. Run: npx vitest run tests/core/r04-t10-samples.test.ts
 */

const ok = (r: EditResult): string => {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const setName = (id: string, name: string): Op => ({ kind: 'set-person-fields', id, fields: { name } });

/** The body as lines, to count how many lines an edit changed. */
const changedLines = (a: string, b: string): number => {
	const x = a.split('\n');
	const y = b.split('\n');
	let n = Math.abs(x.length - y.length);
	for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++;
	return n;
};

describe.each(T10.map((t) => [t.id, t] as const))('sample tree %s: the note and the tree text', (_id, t) => {
	const body = bodyOf(t);
	const parsed = parseDynasty(body);

	it('has one kin block that opens with a comment and a short note above it', () => {
		const note = noteOf(t);
		expect(topLevelBlocks(note)).toHaveLength(1);
		expect(note.startsWith(`# Fixture ${t.id} `)).toBe(true);
		expect(note.indexOf('```kin')).toBeGreaterThan(200);
		expect(note.endsWith('```\n')).toBe(true);
		expect(note).not.toContain('\r');
	});

	it('parses with no error and no warning', () => {
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const g = deriveFamilies(parsed.tree);
		expect(g.issues).toEqual([]);
		expect(parsed.tree.issues).toEqual([]);
	});

	it('keeps every id, in the order of the note, and the houses', () => {
		if (!parsed.ok) throw new Error('does not parse');
		expect(parsed.tree.people.map((p) => p.id)).toEqual(Object.keys(t.people));
		expect(parsed.tree.houses.map((h) => h.id)).toEqual(t.houses);
	});

	it('keeps every name, sobriquet and birth text exactly as written (no change of form or of script)', () => {
		if (!parsed.ok) throw new Error('does not parse');
		for (const p of parsed.tree.people) {
			const want = t.people[p.id];
			expect(p.name, p.id).toBe(want.name);
			expect(p.sobriquet, `${p.id} sobriquet`).toBe(want.sobriquet);
			expect(p.born, `${p.id} born`).toBe(want.born);
		}
	});

	it('every person has a name that is not empty and no person is named by the id alone', () => {
		if (!parsed.ok) throw new Error('does not parse');
		for (const p of parsed.tree.people) {
			expect(p.name.trim().length, p.id).toBeGreaterThan(0);
			expect(p.name, p.id).not.toBe(p.id);
		}
	});

	it('write path: an edit that returns the same body gives the same note, byte for byte, also with CRLF', () => {
		const note = noteOf(t);
		const same = planWrite(note, 0, body.replace(/\n$/, ''), (b) => ({ ok: true, body: b }));
		expect(same).toMatchObject({ ok: true, newText: note });
		const crlf = note.replace(/\n/g, '\r\n');
		const blockCrlf = findBlocks(crlf)[0];
		const again = planWrite(crlf, 0, blockCrlf.body, (b) => ({ ok: true, body: b }));
		expect(again).toMatchObject({ ok: true, newText: crlf });
	});
});

describe('sample tree 17: the shape of the same-sex families (written by hand from the note)', () => {
	const parsed = parseDynasty(bodyOf(T10[0]));
	if (!parsed.ok) throw new Error('does not parse');
	const tree = parsed.tree;
	const sexOf = (id: string) => tree.people.find((p) => p.id === id)!.sex;

	it('has two marriages of two women and two marriages of two men', () => {
		const same = tree.unions.filter((u) => sexOf(u.partners[0]) === sexOf(u.partners[1]));
		const women = same.filter((u) => sexOf(u.partners[0]) === 'f').map((u) => u.partners.join('+'));
		const men = same.filter((u) => sexOf(u.partners[0]) === 'm').map((u) => u.partners.join('+'));
		expect(women).toEqual(['edda+lisbet', 'wren+calla']);
		expect(men).toEqual(['tobias+dario', 'garrick+piers']);
	});

	it('has a child by birth of one parent of a couple, an adoption by both, a remarriage and a couple with no children', () => {
		const p = (id: string) => tree.people.find((x) => x.id === id)!;
		expect(p('wren').parents.map((r) => [r.id, r.type])).toEqual([['edda', 'birth']]);
		expect(p('tobias').parents.map((r) => [r.id, r.type])).toEqual([['edda', 'adoptive'], ['lisbet', 'adoptive']]);
		expect(p('nell').parents.map((r) => [r.id, r.type])).toEqual([['garrick', 'adoptive'], ['piers', 'adoptive']]);
		// Hale is married twice (a remarriage after the death of Ysolt).
		expect(tree.unions.filter((u) => u.partners.includes('hale')).map((u) => u.partners.join('+'))).toEqual(['hale+ysolt', 'hale+brenna']);
		// Nobody names Tobias and Dario, or Hale and Brenna, as a parent pair.
		for (const couple of [['tobias', 'dario'], ['hale', 'brenna']]) expect(tree.people.filter((x) => couple.every((c) => x.parents.some((r) => r.id === c)))).toEqual([]);
	});

	it('passes the title from Edda to Wren to Pia', () => {
		expect(tree.titles).toHaveLength(1);
		expect(tree.titles![0].holders.map((h) => h.person)).toEqual(['edda', 'wren', 'pia']);
	});
});

describe('sample tree 17: edits for a same-sex couple write the same text as for any couple (spec §6.2, §6.4)', () => {
	const body = bodyOf(T10[0]).replace(/\n$/, '');

	it('add-parent: a second birth mother for a child of a couple of women adds nothing else (the marriage is listed)', () => {
		const r = applyOp(body, { kind: 'add-parent', child: 'fenn-rooke', parent: 'wren', type: 'birth' });
		expect(ok(r)).toBe(replaceOnce(body, 'parents: [calla]}', 'parents: [calla, wren]}'));
		expect(r.ok && r.effects).toBeFalsy();
	});

	it('add-parent: a second birth mother with no marriage between the two women adds a marriage and reports auto-union', () => {
		const r = applyOp(body, { kind: 'add-parent', child: 'merrin', parent: 'brenna', type: 'birth' });
		const want = replaceOnce(body, 'parents: [lisbet]}', 'parents: [lisbet, brenna]}') + '\n  - partners: [lisbet, brenna]\n    type: marriage';
		expect(ok(r)).toBe(want);
		expect(r.ok && r.effects).toEqual(['auto-union']);
	});

	it('add-parent: a second birth father with no marriage between the two men adds a marriage, in the same text', () => {
		const men = ['people:', '  - {id: a, name: A, sex: m}', '  - {id: b, name: B, sex: m}', '  - {id: c, name: C, parents: [a]}', '  - {id: d, name: D, sex: f}', '  - {id: e, name: E, sex: m}', 'unions:', '  - partners: [d, e]'].join('\n');
		const r = applyOp(men, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' });
		expect(ok(r)).toBe(replaceOnce(men, 'parents: [a]}', 'parents: [a, b]}') + '\n  - partners: [a, b]\n    type: marriage');
		expect(r.ok && r.effects).toEqual(['auto-union']);
	});

	it('add-union: a marriage between two women, and between two men, is written like any marriage', () => {
		const women = ok(applyOp(body, { kind: 'add-union', partners: ['merrin', 'brenna'], start: '1120' }));
		expect(women).toBe(`${body}\n  - partners: [merrin, brenna]\n    start: 1120`);
		const men = ok(applyOp(body, { kind: 'add-union', partners: ['anselm', 'dario'], type: 'betrothal', start: '1121' }));
		expect(men).toBe(`${body}\n  - partners: [anselm, dario]\n    type: betrothal\n    start: 1121`);
	});

	it('the new marriages parse, and the tree has no warning', () => {
		const text = ok(applyOp(body, { kind: 'add-union', partners: ['merrin', 'brenna'], start: '1120' }));
		const r = parseDynasty(text);
		expect(r.ok).toBe(true);
		if (r.ok) expect(deriveFamilies(r.tree).issues).toEqual([]);
	});
});

describe('samples 18 and 19: a changed value keeps its script and is written as typed (spec §6.2)', () => {
	const body18 = bodyOf(T10[1]).replace(/\n$/, '');
	const body19 = bodyOf(T10[2]).replace(/\n$/, '');

	it('a plain name goes to a plain name in another script: only that text changes, nothing is escaped', () => {
		const r = ok(applyOp(body18, setName('minjun', '윤민수')));
		expect(r).toBe(replaceOnce(body18, 'name: 윤민준,', 'name: 윤민수,'));
		expect(changedLines(body18, r)).toBe(1);
	});

	it('a name that plain YAML cannot hold (": ") goes into double quotes and keeps its letters (no \\u escape)', () => {
		const r = ok(applyOp(body18, setName('somying', 'สมหญิง: สุวรรณ')));
		expect(r).toBe(replaceOnce(body18, 'name: สมหญิง สุวรรณ,', 'name: "สมหญิง: สุวรรณ",'));
		expect(r).not.toMatch(/\\u[0-9a-f]{4}/i);
	});

	it('a sobriquet that the note wrote in double quotes keeps its quotes, with an emoji and a joiner', () => {
		const r = ok(applyOp(body18, { kind: 'set-person-fields', id: 'yaroslav', fields: { sobriquet: '\u{1F43A} Волк' } }));
		expect(r).toBe(replaceOnce(body18, 'sobriquet: "🦊 Лис"', 'sobriquet: "\u{1F43A} Волк"'));
		const joined = ok(applyOp(body18, { kind: 'set-person-fields', id: 'zoe', fields: { sobriquet: '\u{1F9D1}\u{1F3FD}\u200d\u{1F373} the Cook' } }));
		expect(joined).toContain('sobriquet: "\u{1F9D1}\u{1F3FD}\u200d\u{1F373} the Cook"');
	});

	it('a date that the note wrote in double quotes keeps its quotes, also with native digits', () => {
		const r = ok(applyOp(body18, { kind: 'set-person-fields', id: 'ananya', fields: { born: '११६३' } }));
		expect(r).toBe(replaceOnce(body18, 'born: "११६२"}', 'born: "११६३"}'));
	});

	it('the decomposed form of a name is not changed to the composed form when the person is edited elsewhere', () => {
		const r = ok(applyOp(body18, { kind: 'set-person-fields', id: 'zoe', fields: { born: '1183' } }));
		expect(r).toContain('name: Zoe\u0308 Beridze,');
		expect(r).not.toContain('name: Zoë Beridze');
		expect(changedLines(body18, r)).toBe(1);
	});

	it('an Arabic name with vowel marks and a Hebrew name with vowel marks keep every mark when another field changes', () => {
		const a = ok(applyOp(body19, { kind: 'set-person-fields', id: 'muhammad', fields: { born: '1136' } }));
		expect(a).toBe(replaceOnce(body19, 'born: 1135, parents: [yusuf, fatima]}\n  - {id: david', 'born: 1136, parents: [yusuf, fatima]}\n  - {id: david'));
		const h = ok(applyOp(body19, { kind: 'set-person-fields', id: 'sarah', fields: { born: '1111' } }));
		expect(h).toContain('name: שָׁרָה לֵוִי,');
		expect(changedLines(body19, h)).toBe(1);
	});

	it('a name with Latin and Arabic text mixed is written as typed, with the brackets and the Roman number', () => {
		const r = ok(applyOp(body19, setName('nur', 'نور الدين الثالث (Nur al-Din III)')));
		expect(r).toBe(replaceOnce(body19, 'name: نور الدين الثاني (Nur al-Din II),', 'name: نور الدين الثالث (Nur al-Din III),'));
	});

	it('a right-to-left name with a double quote inside it is read back as typed', () => {
		const typed = 'عمر "الحداد"';
		const r = ok(applyOp(body19, setName('omar', typed)));
		const back = parseDynasty(r);
		expect(back.ok && back.tree.people.find((p) => p.id === 'omar')!.name).toBe(typed);
		expect(changedLines(body19, r)).toBe(1);
	});

	it('set a name to another text and back: the body is the same, byte for byte (round trip)', () => {
		for (const [body, ids] of [[body18, Object.keys(T10[1].people)], [body19, Object.keys(T10[2].people)], [bodyOf(T10[0]).replace(/\n$/, ''), Object.keys(T10[0].people)]] as const) {
			for (const id of ids) {
				const parsed = parseDynasty(body);
				if (!parsed.ok) throw new Error('does not parse');
				const name = parsed.tree.people.find((p) => p.id === id)!.name;
				const there = ok(applyOp(body, setName(id, 'Xx Yy')));
				expect(changedLines(body, there), id).toBe(1);
				expect(ok(applyOp(there, setName(id, name))), id).toBe(body);
			}
		}
	});
});
