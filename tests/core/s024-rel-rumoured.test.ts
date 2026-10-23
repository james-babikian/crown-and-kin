import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations } from '../../src/core/relations';

// S024 (D123): relation words of a person E (the marked person) with a known mother M and a rumoured
// father R, towards G (child of R and M), A (child of M and another father F) and S (a sister of E).
// All names are made up. Spec §13.1: "A rumoured link counts like a birth link and adds the word rumoured."

/** Compact lines "id sex parent[:type]…" (made-up ids). */
function tree(people: string[]): FamilyGraph {
	const out = ['people:'];
	for (const line of people) {
		const [id, sex, ...parents] = line.split(' ');
		out.push(`  - id: ${id}`, `    name: ${id}`, `    sex: ${sex}`);
		if (parents.length) {
			const refs = parents.map((p) => {
				const [pid, type] = p.split(':');
				return type ? `{id: ${pid}, type: ${type}}` : pid;
			});
			out.push(`    parents: [${refs.join(', ')}]`);
		}
	}
	const r = parseDynasty(out.join('\n') + '\n');
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** All names of `id` for `me`, best first (the first one is the card text). */
const names = (g: FamilyGraph, id: string) => (computeRelations(g, 'E').get(id) ?? []).map((r) => r.text);

const base = ['M f', 'R m', 'F m', 'E m M R:rumoured', 'G m R M', 'A m F M'];
const a = tree([...base, 'S f M R:rumoured']); // (a) S also has R as rumoured father
const b = tree([...base, 'S f M']); // (b) S has no father listed
const c = tree([...base, 'S f M R']); // (c) S has R as birth father
const c2 = tree(['M f', 'R m', 'F m', 'E m F M', 'G m R M', 'A m F M', 'S f F M']); // (c') E and S share a known father F, no rumour
const d = tree([...base, 'Q m', 'S f M Q:rumoured']); // (d) S has a different rumoured father

describe('texts the plugin shows (the sure names are as in 0.2.3; the rumoured names follow D123)', () => {
	it('a: G, A, S', () => {
		expect(names(a, 'G')).toEqual(['Half-brother', 'Rumoured brother']);
		expect(names(a, 'A')).toEqual(['Half-brother']);
		// D174: E and S both list only M and a rumoured parent, so both are incomplete: half, maybe full.
		expect(names(a, 'S')).toEqual(['Half-sister', 'Rumoured sister']);
	});
	// D174: E has a rumoured parent and one birth parent, so E is incomplete: half (the maybe is "unlisted", no extra name).
	it('b: S', () => expect(names(b, 'S')).toEqual(['Half-sister']));
	it('c: S', () => expect(names(c, 'S')).toEqual(['Half-sister', 'Rumoured sister']));
	it("c': no rumour, A is full, G is half", () => {
		expect(names(c2, 'A')).toEqual(['Brother']);
		expect(names(c2, 'G')).toEqual(['Half-brother']);
		expect(names(c2, 'S')).toEqual(['Sister']);
	});
	// D174: both are incomplete (half), and two different rumoured fathers change nothing.
	it('d: S', () => expect(names(d, 'S')).toEqual(['Half-sister']));
});

describe('S024 defects (failed before D123)', () => {
	it('a: if the rumoured father R is true, E and G are full brothers; the list must say so (rumoured counts like birth)', () => {
		expect(names(a, 'G').map((t) => t.toLowerCase())).toContain('rumoured brother');
	});
	it('c: E (rumoured R) and S (birth R) are full sisters if the rumour is true; "Rumoured half-sister" is the wrong word', () => {
		expect(names(c, 'S').map((t) => t.toLowerCase())).toContain('rumoured sister');
		expect(names(c, 'S').map((t) => t.toLowerCase())).not.toContain('rumoured half-sister');
	});
	it('a: the rumoured line to G is never worded "half" when the rumour would make the pair full', () => {
		expect(names(a, 'G')).not.toContain('Rumoured half-brother');
	});
	it('d: E (rumoured R) and S (rumoured Q) are half-sisters, not "Sister" (D174: the sure name is half; the rumours change nothing)', () => {
		expect(names(d, 'S')).toEqual(['Half-sister']);
	});
});
