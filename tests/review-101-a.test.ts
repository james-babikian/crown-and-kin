import { describe, expect, it } from 'vitest';
import { findBlocks, replaceBody } from '../src/core/block-locate';
import { planWrite } from '../src/core/block-write';
import { deriveFamilies } from '../src/core/derive';
import { describeDelete } from '../src/core/family-query';
import { computeGenerations } from '../src/core/generations';
import { slugify } from '../src/core/id-gen';
import { computeModelOrder } from '../src/core/order';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';

/*
 * Review of version 1.0.1, area A (core read side). Each test states the correct behaviour and
 * fails on release-1.0.1 at d23ba64.
 */

function tree(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree;
}

describe('A1: a callout written with ">" and no space', () => {
	// CommonMark (and Obsidian) read ">" plus one optional space as the marker, so `>  - id: a`
	// holds " - id: a". replaceBody writes a changed line as prefix + line = ">" + " - id: a",
	// which reads back as "- id: a": one space is lost on every indented line.
	const NOTE = '>```dynasty\n>people:\n>  - id: a\n>    name: A\n>```\n';

	it('replaceBody: a changed indented line reads back as written', () => {
		const b = findBlocks(NOTE)[0];
		expect(b.body).toBe('people:\n - id: a\n   name: A');
		const next = 'people:\n - id: a\n   name: B';
		expect(findBlocks(replaceBody(NOTE, b, next))[0].body).toBe(next);
	});

	it('planWrite: renaming a person in such a callout is written, not refused', () => {
		const b = findBlocks(NOTE)[0];
		const plan = planWrite(NOTE, 0, b.body, (body) => {
			const r = applyOp(body, { kind: 'set-person-fields', id: 'a', fields: { name: 'B' } });
			return r.ok ? { ok: true, body: r.body } : { ok: false, reason: r.code };
		});
		expect(plan.ok ? 'ok' : plan).toBe('ok');
	});

	it('planWrite: the first person in an empty tree in such a callout is written, not refused', () => {
		const text = '>```dynasty\n>```\n';
		const plan = planWrite(text, 0, '', (body) => {
			const r = applyOp(body, { kind: 'add-person', id: 'a', fields: { name: 'A' } });
			return r.ok ? { ok: true, body: r.body } : { ok: false, reason: r.code };
		});
		expect(plan.ok ? 'ok' : plan).toBe('ok');
	});
});

describe('A2: an unquoted [[link]] whose note name has a comma', () => {
	// Spec §8 tolerates an unquoted [[link]]. With a comma, YAML reads [["Smith", "John"]], and
	// linkValue flattens only a one-item list: the link is dropped with no warning.
	it('link: [[Smith, John]] is read as "[[Smith, John]]"', () => {
		expect(tree('people:\n  - id: a\n    link: [[Smith, John]]\n').people[0].link).toBe('[[Smith, John]]');
	});
});

describe('A3: more than 100 uses of one YAML alias', () => {
	// The yaml package limits alias expansion to 100 by default (maxAliasCount). A tree that uses
	// `house: *valmont` for 101 people becomes a hard error: "Excessive alias count indicates a
	// resource exhaustion attack", with no line. The tree is not drawn and cannot be edited.
	it('101 people with house: *h still parse', () => {
		const lines = ['houses:', '  - {id: &h valmont, name: House Valmont}', 'people:'];
		for (let i = 0; i < 101; i++) lines.push(`  - {id: p${i}, house: *h}`);
		const r = parseDynasty(lines.join('\n'));
		expect(r.ok ? 'ok' : r.error).toBe('ok');
	});

	it('101 children with parents: *p still parse', () => {
		const lines = ['people:', '  - {id: a}', '  - {id: b}', '  - {id: c0, parents: &p [a, b]}'];
		for (let i = 1; i < 101; i++) lines.push(`  - {id: c${i}, parents: *p}`);
		const r = parseDynasty(lines.join('\n'));
		expect(r.ok ? 'ok' : r.error).toBe('ok');
	});
});

describe('A4: the delete confirmation counts every partnership that the delete removes', () => {
	// describeDelete counts only drawable unions (g.unions), but deletePerson removes every union
	// item that lists the person, drawable or not. The confirmation (§6.7) then says nothing
	// about partnerships that the write removes.
	it('a union with a misspelled partner is counted', () => {
		const src = 'people:\n  - id: a\n  - id: b\nunions:\n  - partners: [a, bb]\n';
		const g = deriveFamilies(tree(src));
		const removed = applyOp(src, { kind: 'delete-person', id: 'a' });
		expect(removed.ok && tree(removed.body).unions.length).toBe(0);
		expect(describeDelete(g, 'a', {}).unions).toBe(1);
	});
});

describe('A5 (note): a very long line of descent', () => {
	// computeModelOrder visits children recursively; about 4000 generations overflow the stack.
	// tree-view catches it and shows the internal-error box; spec §8 asks that nothing throws.
	it('computeModelOrder does not throw on a 4000-generation chain', () => {
		const lines = ['people:'];
		for (let i = 0; i < 4000; i++) lines.push(`  - {id: p${i}${i ? `, parents: [p${i - 1}]` : ''}}`);
		const g = deriveFamilies(tree(lines.join('\n')));
		const gen = computeGenerations(g);
		expect(() => computeModelOrder(g, gen)).not.toThrow();
	});
});

describe('A6 (note): slugs strip every Latin diacritic (spec §6.8)', () => {
	// Þ, Æ, Ø and ß are mapped by hand, but letters with a stroke or other marks that NFKD does not
	// split are dropped: "Władysław" becomes "w-adys-aw".
	it('Władysław, Đorđe, Œdipe, Ħal', () => {
		expect(slugify('Władysław')).toBe('wladyslaw');
		expect(slugify('Đorđe')).toBe('dorde');
		expect(slugify('Œdipe')).toBe('oedipe');
		expect(slugify('Ħal')).toBe('hal');
	});
});

describe('A7 (note): a fence on a list-marker line with tab-indented body lines', () => {
	// CommonMark: in "- ```dynasty" the content column is 2; a body line "\tpeople:" has 4
	// columns of indentation, so the list item keeps it and the code line is "  people:" (the tab
	// counts as 2 spaces after 2 columns are removed). stripColumns keeps the whole tab instead,
	// so the located body starts with a tab, which YAML rejects: the edit path cannot parse it.
	it('the located body has no leading tab', () => {
		const b = findBlocks('- ```dynasty\n\tpeople:\n\t  - id: a\n  ```\n')[0];
		expect(b.body.startsWith('\t')).toBe(false);
	});
});
