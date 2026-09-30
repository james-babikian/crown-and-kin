import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { deriveFamilies } from '../src/core/derive';
import type { EditResult, HolderRef } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';

// M8 core review (code-reviewer, scratch/review-m8-core). Each test proves one finding.

const show = (r: EditResult) => (r.ok ? r.body : `REFUSED ${r.code}: ${r.detail ?? ''}`);
function graph(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}
function ref(src: string, title: string, index: number): HolderRef {
	const h = graph(src).writtenTitles.find((x) => x.id === title)!.holders.find((x) => x.index === index)!;
	const out: HolderRef = { title, index };
	if (h.person !== undefined) out.person = h.person;
	if (h.text !== undefined) out.text = h.text;
	return out;
}
const P = 'people:\n  - {id: a, name: Aldric Valmont}\n  - {id: b, name: Bera}\n';

describe('finding 1: emptying a flow holder list is refused (title-ops.ts emptyList)', () => {
	// D57 (§13.4): deleting a person removes all their holder entries; the title keeps `holders: []`.
	it('D57: delete-person is refused when the person fills a multi-line flow list with a comment', () => {
		const src = `titles:\n  - id: t\n    holders: [\n      a,   # restored\n      {person: a, number: II}\n    ]\n${P}`;
		const r = applyOp(src, { kind: 'delete-person', id: 'a' });
		expect(show(r)).not.toMatch(/^REFUSED/);
		const g = graph(show(r));
		expect(g.writtenTitles[0].holders).toEqual([]);
		expect(g.byId.has('a')).toBe(false);
	});

	it('remove-holder of the only holder of `[a, ]` (valid YAML, trailing comma) is refused', () => {
		const src = `titles:\n  - id: t\n    holders: [a, ]\n${P}`;
		expect(show(applyOp(src, { kind: 'remove-holder', holder: ref(src, 't', 0) }))).toBe(src.replace('[a, ]', '[]'));
	});

	it('remove-holder of the only holder of a multi-line flow list with a trailing comma is refused', () => {
		const src = `titles:\n  - id: t\n    holders: [\n      a,\n    ]\n${P}`;
		const r = applyOp(src, { kind: 'remove-holder', holder: ref(src, 't', 0) });
		expect(show(r)).not.toMatch(/^REFUSED/);
		expect(graph(show(r)).writtenTitles[0].holders).toEqual([]);
	});

	it('Titles window Save (set-holders with no items) is refused for a multi-line flow list with a comment', () => {
		const src = `titles:\n  - id: t\n    holders: [\n      a,   # first\n      b\n    ]\n${P}`;
		const r = applyOp(src, { kind: 'set-holders', title: 't', items: [] });
		expect(show(r)).not.toMatch(/^REFUSED/);
		expect(graph(show(r)).writtenTitles[0].holders).toEqual([]);
	});
});

describe('finding 2 (note): an edited plain-string holder keeps its scalar tag on the new flow map', () => {
	// title-ops.ts fieldSteps replaces only item.range; the node's props (tag, anchor) stay in front.
	it('`- !!str a` + number II gives `- !!str {person: a, number: II}`, a map with a string tag (YAML warning)', () => {
		const src = `titles:\n  - id: t\n    holders:\n      - !!str a\n${P}`;
		const r = applyOp(src, { kind: 'edit-holder', holder: ref(src, 't', 0), fields: { number: 'II' } });
		const out = show(r);
		expect(parseDocument(out, { schema: 'failsafe' }).warnings.map((w) => w.message.split('\n')[0])).toEqual([]);
	});
});
