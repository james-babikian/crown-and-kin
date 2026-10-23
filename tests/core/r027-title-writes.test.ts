// Contract 0.2.7 (WP2): writing the succession keys of a title (A.3, K.3, K.4), deleting a person who is a named heir, the summary of that delete.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { EditResult, Op } from '../../src/core/edit';
import { describeDelete } from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';

const PEOPLE = ['people:', '  - {id: aldric, name: Aldric}', '  - {id: hugo, name: Hugo}', '  - {id: wren, name: Wren}', '  - {id: cy, name: Cy}'];
const src = (title: string[], extra: string[] = []) => [...title, ...PEOPLE, ...extra].join('\n') + '\n';
const BASE = ['titles:', '  - id: duke', '    name: Duke', '    holders: [aldric]'];

function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
const edit = (text: string, op: Op) => body(applyOp(text, op));
const refuse = (text: string, op: Op) => {
	const r = applyOp(text, op);
	return r.ok ? 'ok' : r.code;
};
const title = (fields: Omit<Extract<Op, { kind: 'edit-title' }>, 'kind' | 'id'>): Op => ({ kind: 'edit-title', id: 'duke', ...fields });
const read = (text: string) => {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error('parse');
	return r.tree.titles![0];
};

describe('edit-title: the succession keys', () => {
	it('writes the keys in the order of the contract, before holders', () => {
		const out = edit(
			src(BASE),
			title({ succession: 'eldest-child', inherit: 'men-first', inheritThrough: 'women', inheritIllegitimate: 'after', inheritAdopted: true, year: '1210', heirs: ['hugo'], exclude: ['wren', 'cy'] }),
		);
		expect(out).toBe(
			src([
				'titles:',
				'  - id: duke',
				'    name: Duke',
				'    succession: eldest-child',
				'    inherit: men-first',
				'    inherit-through: women',
				'    inherit-illegitimate: after',
				'    inherit-adopted: true',
				'    year: 1210',
				'    heir: hugo',
				'    exclude: [wren, cy]',
				'    holders: [aldric]',
			]),
		);
		expect(read(out)).toMatchObject({ succession: 'eldest-child', inherit: 'men-first', inheritThrough: 'women', inheritIllegitimate: 'after', inheritAdopted: true, year: '1210', heirs: ['hugo'], exclude: ['wren', 'cy'] });
	});
	it('puts a new key before the first known key that comes later in the order; an unknown key never decides the place', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    plural: Dukes', '    note: keep me', '    holders: [aldric]']);
		const out = edit(text, title({ succession: 'youngest-child' }));
		expect(out).toContain('    plural: Dukes\n    note: keep me\n    succession: youngest-child\n    holders');
	});
	it('writes year and the switch plain, never quoted', () => {
		const out = edit(src(BASE), title({ year: '1210', inheritAdopted: true }));
		expect(out).toContain('    inherit-adopted: true\n    year: 1210\n');
		expect(edit(src(BASE), title({ year: 'c. 1203' }))).toContain('    year: c. 1203\n');
	});
	it('removes a key with null or empty text and leaves the other keys', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    succession: eldest-child  # the rule', '    inherit: men-only', '    year: 1210', '    holders: [aldric]']);
		const out = edit(text, title({ succession: null, year: '' }));
		expect(out).toBe(src(['titles:', '  - id: duke', '    name: Duke', '    inherit: men-only', '    holders: [aldric]']));
	});
	it('keeps a written text that already reads as the new rule (old names, true for after, yes for the switch)', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    succession: primogeniture', '    inherit: semi-salic', '    inherit-illegitimate: true', '    inherit-adopted: yes', '    holders: [aldric]']);
		expect(edit(text, title({ succession: 'eldest-child', inherit: 'men-first-in-house', inheritIllegitimate: 'after', inheritAdopted: true }))).toBe(text);
		expect(edit(text, title({ inheritIllegitimate: 'equal' }))).toContain('    inherit-illegitimate: equal\n');
		expect(edit(text, title({ succession: 'youngest-child' }))).toContain('    succession: youngest-child\n');
	});
	it('removes inherit-illegitimate for no, and inherit-adopted for false, only when present', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    inherit-illegitimate: equal', '    inherit-adopted: true', '    holders: [aldric]']);
		expect(edit(text, title({ inheritIllegitimate: 'no', inheritAdopted: false }))).toBe(src(BASE));
		expect(edit(src(BASE), title({ inheritIllegitimate: 'no', inheritAdopted: false }))).toBe(src(BASE));
	});
	it('writes the switch true over a written false', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    inherit-adopted: no', '    holders: [aldric]']);
		expect(edit(text, title({ inheritAdopted: true }))).toContain('    inherit-adopted: true\n');
	});
	it('refuses a value that is not canonical (bad-value) and an id that names nobody (unknown-person)', () => {
		expect(refuse(src(BASE), title({ succession: 'salic' as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ succession: 'primogeniture' as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ inherit: 'men' as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ inheritThrough: 'male' as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ inheritIllegitimate: 'maybe' as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ inheritAdopted: 'yes' as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ year: 1210 as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ heirs: ['ghost'] }))).toBe('unknown-person');
		expect(refuse(src(BASE), title({ exclude: ['hugo', 'ghost'] }))).toBe('unknown-person');
		expect(refuse(src(BASE), title({ heirs: 'hugo' as never }))).toBe('bad-value');
		expect(refuse(src(BASE), title({ heirs: [''] }))).toBe('bad-value');
		expect(refuse(src(BASE), { kind: 'edit-title', id: 'nobody', succession: 'eldest-child' })).toBe('unknown-title');
	});
	it('does not write anything when a refusal comes after a valid field', () => {
		expect(refuse(src(BASE), title({ succession: 'eldest-child', inherit: 'bad' as never }))).toBe('bad-value');
	});
	it('does not change a title that has no succession fields in the op', () => {
		expect(edit(src(BASE), title({ name: 'Duke' }))).toBe(src(BASE));
	});
});

describe('edit-title: heirs and exclude (K.3)', () => {
	it('writes one id as a scalar and several as a flow list', () => {
		expect(edit(src(BASE), title({ heirs: ['hugo'] }))).toContain('    heir: hugo\n');
		expect(edit(src(BASE), title({ heirs: ['hugo', 'wren'] }))).toContain('    heir: [hugo, wren]\n');
	});
	it('is a no-op when the list equals the written ids', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: [hugo, wren]  # note', '    holders: [aldric]']);
		expect(edit(text, title({ heirs: ['hugo', 'wren'] }))).toBe(text);
		const one = src(['titles:', '  - id: duke', '    name: Duke', '    heir: hugo', '    holders: [aldric]']);
		expect(edit(one, title({ heirs: ['hugo'] }))).toBe(one);
	});
	it('needs no person for an id that is already written (a dangling id can be kept or moved), but a new id must be a person', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: [ghost, hugo]', '    holders: [aldric]']);
		expect(edit(text, title({ heirs: ['hugo', 'ghost'] }))).toContain('    heir: [hugo, ghost]\n');
		expect(edit(text, title({ heirs: ['hugo'] }))).toContain('    heir: hugo\n');
		expect(refuse(text, title({ heirs: ['ghost', 'ghost2'] }))).toBe('unknown-person');
	});
	it('moves items in a flow list and keeps the comment after the list', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: [hugo, wren]  # the order matters', '    holders: [aldric]']);
		const out = edit(text, title({ heirs: ['wren', 'hugo'] }));
		expect(out).toContain('    heir: [wren, hugo]  # the order matters\n');
	});
	it('turns a scalar into a list and a list into a scalar', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: hugo  # first', '    holders: [aldric]']);
		expect(edit(text, title({ heirs: ['hugo', 'wren'] }))).toContain('    heir: [hugo, wren]  # first\n');
		const list = src(['titles:', '  - id: duke', '    name: Duke', '    heir: [hugo, wren]', '    holders: [aldric]']);
		expect(edit(list, title({ heirs: ['wren'] }))).toContain('    heir: wren\n');
	});
	it('removes the key with null or an empty list, with its own comment', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: hugo  # first', '    holders: [aldric]']);
		expect(edit(text, title({ heirs: null }))).toBe(src(BASE));
		expect(edit(text, title({ heirs: [] }))).toBe(src(BASE));
		expect(edit(src(BASE), title({ heirs: [] }))).toBe(src(BASE));
	});
	it('keeps the comments of a block list when it changes item by item (the list stays a list)', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir:', '      - hugo  # eldest', '      - wren  # second', '    holders: [aldric]']);
		const removed = edit(text, title({ heirs: ['wren'] }));
		expect(removed).toContain('      - wren  # second\n');
		expect(read(removed).heirs).toEqual(['wren']);
		const added = edit(text, title({ heirs: ['hugo', 'wren', 'cy'] }));
		expect(added).toContain('      - hugo  # eldest\n      - wren  # second\n      - cy\n');
		const moved = edit(text, title({ heirs: ['wren', 'hugo'] }));
		expect(read(moved).heirs).toEqual(['wren', 'hugo']);
		expect(moved).toContain('# eldest');
		expect(moved).toContain('# second');
	});
	it('writes exclude like heir, after heir', () => {
		const out = edit(src(BASE), title({ exclude: ['cy'], heirs: ['hugo'] }));
		expect(out).toContain('    heir: hugo\n    exclude: cy\n    holders');
	});
	it('replaces a written map value with the list, and never throws on odd input', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: {a: b}', '    holders: [aldric]']);
		expect(refuse(text, title({ heirs: ['hugo', 'wren'] }))).toBe('ok');
		expect(() => applyOp(src(BASE), title({ heirs: [null as never] }))).not.toThrow();
		expect(() => applyOp(src(BASE), title({ exclude: {} as never }))).not.toThrow();
	});
	it('quotes an id that plain YAML cannot hold in a list', () => {
		const text = src(BASE, ['  - {id: "a, b", name: AB}', '  - {id: "12", name: Twelve}']);
		const out = edit(text, title({ heirs: ['a, b', '12'] }));
		expect(read(out).heirs).toEqual(['a, b', '12']);
	});
});

describe('delete person removes the id from heir and exclude (K.3)', () => {
	const del = (text: string, id: string) => edit(text, { kind: 'delete-person', id });
	it('removes a scalar heir with its key', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: hugo', '    holders: [aldric]']);
		expect(del(text, 'hugo')).toBe(src(BASE).replace('  - {id: hugo, name: Hugo}\n', ''));
	});
	it('removes an id from a list in place; a list stays a list, also of one', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: [hugo, wren]  # note', '    exclude: [cy, hugo, wren]', '    holders: [aldric]']);
		const out = del(text, 'hugo');
		expect(out).toContain('    heir: [wren]  # note\n');
		expect(out).toContain('    exclude: [cy, wren]\n');
		expect(read(out).heirs).toEqual(['wren']);
		const tail = del(text, 'wren');
		expect(tail).toContain('    heir: [hugo]  # note\n');
	});
	it('removes the key when the list has no id left', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: [hugo, hugo]', '    exclude:', '      - hugo', '    holders: [aldric]']);
		expect(del(text, 'hugo')).toBe(src(BASE).replace('  - {id: hugo, name: Hugo}\n', ''));
	});
	it('removes it in every title with an id, also one that loses to a duplicate id', () => {
		const text = src(['titles:', '  - {id: duke, name: Duke, heir: hugo, holders: [aldric]}', '  - {id: duke, name: Duke Two, exclude: [hugo, cy], holders: [aldric]}', '  - {id: earl, name: Earl, heir: [wren, hugo]}']);
		const out = del(text, 'hugo');
		const r = parseDynasty(out);
		if (!r.ok) throw new Error('parse');
		const titles = r.tree.titles!;
		expect(titles[0].heirs).toBeUndefined();
		expect(titles[1].exclude).toEqual(['cy']);
		expect(titles[2].heirs).toEqual(['wren']);
	});
	it('does not touch a heir list that does not hold the id', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heir: [wren, cy]', '    holders: [aldric]']);
		expect(del(text, 'hugo')).toBe(text.replace('  - {id: hugo, name: Hugo}\n', ''));
	});
});

describe('describeDelete counts the titles that name the person (K.3)', () => {
	const graph = (text: string) => {
		const r = parseDynasty(text);
		if (!r.ok) throw new Error('parse');
		return deriveFamilies(r.tree);
	};
	it('counts heirs and excluded titles, and leaves them out when 0', () => {
		const text = src(['titles:', '  - {id: a, name: A, heir: [hugo, wren]}', '  - {id: b, name: B, heir: hugo, exclude: hugo}', '  - {id: c, name: C, exclude: [hugo]}', '  - {id: d, name: D, heir: wren}']);
		const g = graph(text);
		expect(describeDelete(g, 'hugo', {})).toMatchObject({ heirs: 2, excluded: 2 });
		const wren = describeDelete(g, 'wren', {});
		expect(wren.heirs).toBe(2);
		expect('excluded' in wren).toBe(false);
		const cy = describeDelete(g, 'cy', {});
		expect('heirs' in cy).toBe(false);
		expect('excluded' in cy).toBe(false);
	});
	it('adds no field for a tree without these keys', () => {
		const s = describeDelete(graph(src(BASE)), 'hugo', {});
		expect(Object.keys(s).sort()).toEqual(['childLinks', 'clearsFocus', 'clearsStart', 'holders', 'unions']);
	});
});

describe('a tree without the new keys is unchanged by reading and by an unrelated edit', () => {
	it('keeps unknown title keys and every other line on an edit of the name', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    succession: eldest-child', '    inherit: men-first  # who', '    year: 1210', '    heir: [hugo, wren]', '    holders: [aldric]']);
		expect(edit(text, title({ name: 'Duke of Valmont' }))).toBe(text.replace('name: Duke\n', 'name: Duke of Valmont\n'));
	});
});
