import { readFileSync, readdirSync } from 'node:fs';
import { parseDocument, type Node } from 'yaml';
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../src/core/block-locate';
import { deriveFamilies } from '../src/core/derive';
import type { FieldValue, PersonField } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { str } from '../src/core/tolerate';
import type { Person, Tree } from '../src/core/types';
import { applyOp } from '../src/core/yaml-edit';

// Property: a random field edit on any sample tree re-reads as the old model with only that
// field changed, and changes only the lines of that person (spec §6.2).

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const TEXTS: FieldValue[] = [
	'Plain Name',
	'true',
	'null',
	'~',
	'1e3',
	'0042',
	'1102-03-04',
	'a: b',
	'#8b1e3f',
	'x # y',
	' leading space',
	"it's",
	'say "hi"',
	'[[Wren of the Marches]]',
	'- dash',
	'{curly}',
	'Ünïcødé Þórr 🐉',
	'two\nlines',
	'tab\there',
	'bell\x07',
	'x]y, z',
	'*alias',
	'&anchor',
	'!tag',
	'%percent',
	'@at',
	'`tick',
	'line\r\nbreak',
	'trailing\n',
	'x'.repeat(500),
	'',
	null,
];
const FIELDS: PersonField[] = ['name', 'title', 'house', 'sex', 'born', 'died', 'illegitimate', 'link', 'notes', 'placement'];

/** The model value a field reads as after writing `v`. */
function readAs(field: PersonField, v: FieldValue): unknown {
	if (field === 'illegitimate') return v === true;
	return typeof v === 'string' ? str(v) : undefined;
}

const withoutIssues = (t: Tree) => ({ ...t, issues: [] });

function bodies(): { label: string; body: string }[] {
	const out: { label: string; body: string }[] = [];
	for (const f of readdirSync('fixtures').filter((f) => f.endsWith('.md')).sort()) {
		const text = readFileSync(`fixtures/${f}`, 'utf8');
		findBlocks(text).forEach((b, n) => out.push({ label: `${f} #${n}`, body: b.body }));
	}
	return out;
}

/** 0-based line span of a person's item in the body. */
function personLines(body: string, index: number): [number, number] {
	const doc = parseDocument(body, { schema: 'failsafe' });
	const item = (doc.get('people', true) as { items: Node[] }).items[index];
	const line = (pos: number) => body.slice(0, pos).split('\n').length - 1;
	return [line(item.range![0]), line(Math.max(item.range![0], item.range![1] - 1))];
}

describe('random field edits on every sample tree', () => {
	for (const { label, body } of bodies()) {
		const parsed = parseDynasty(body);
		if (!parsed.ok) continue;
		if (deriveFamilies(parsed.tree).issues.some((i) => i.level === 'blocking')) continue;
		const people = parsed.tree.people.filter((p) => !p.id.startsWith('~'));
		if (people.length === 0) continue;
		it(label, () => {
			const random = rng(label.length * 7919 + body.length);
			const rounds = Math.min(40, people.length * 6);
			for (let n = 0; n < rounds; n++) {
				const person = people[Math.floor(random() * people.length)];
				const field = FIELDS[Math.floor(random() * FIELDS.length)];
				let value: FieldValue = field === 'illegitimate' ? [true, false, null][Math.floor(random() * 3)] : TEXTS[Math.floor(random() * TEXTS.length)];
				if (field === 'name' && (value === null || value === '')) value = 'Renamed';
				const r = applyOp(body, { kind: 'set-person-fields', id: person.id, fields: { [field]: value } });
				const what = `${person.id}.${field} = ${JSON.stringify(value)}`;
				if (!r.ok) throw new Error(`${what}: refused ${r.code} ${r.detail ?? ''}`);
				const again = parseDynasty(r.body);
				if (!again.ok) throw new Error(`${what}: new body does not parse`);
				const expected = withoutIssues(parsed.tree);
				expected.people = expected.people.map((p): Person => (p.id === person.id ? { ...p, [field]: readAs(field, value) } : p));
				expect(JSON.parse(JSON.stringify(withoutIssues(again.tree))), what).toEqual(JSON.parse(JSON.stringify(expected)));

				// Only this person's lines change: the lines before and after the item are the same.
				const oldLines = body.split('\n');
				const newLines = r.body.split('\n');
				let head = 0;
				while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
				let tail = 0;
				while (tail < oldLines.length - head && tail < newLines.length - head && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
				if (head === oldLines.length && head === newLines.length) continue;
				const [first, last] = personLines(body, person.index);
				expect(head, what).toBeGreaterThanOrEqual(first);
				expect(oldLines.length - tail - 1, what).toBeLessThanOrEqual(last);
			}
			// Sample tree 7: 40 edits of about 150 ms each, near the 5 s default under a full parallel run.
		}, 30000);
	}
});
