import { describe, expect, it } from 'vitest';
import type { EditResult, Op } from '../src/core/edit';
import { checkNewId, makeIdFromName, slugify, uniqueId } from '../src/core/id-gen';
import { findBlocks } from '../src/core/block-locate';
import { linkTargets } from '../src/core/link-rewrite';
import { parseDynasty } from '../src/core/parse';
import { REFUSAL_TEXT } from '../src/core/refusal-text';
import { applyOp } from '../src/core/yaml-edit';

// Version 0.2.8, package P3: the exact text of the edits that the proof tests of the search round
// (`review-r028-core.test.ts`) only check as accepted, the write side of personal arms and of the
// holder tick box, the keep-plural rule, the parent limits, and the ids of other writing systems.

function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
const edit = (src: string, op: Op) => body(applyOp(src, op));
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};

const PEOPLE = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C}\n';

describe('F-CORE-01: a commented multi-line flow list loses an item and keeps every comment', () => {
	const parents = `${PEOPLE}  - id: d\n    name: D\n    parents: [a, # dad\n      b] # both\n`;
	const holders = `titles:\n  - id: duke\n    name: Duke\n    holders: [{person: a}, # first\n      {person: b}, # second\n      {person: c}] # third\n${PEOPLE}`;
	const heirs = `titles:\n  - id: duke\n    name: Duke\n    heir: [a, # first\n      b]\n${PEOPLE}`;

	it('remove-parent of the first parent keeps both comments', () => {
		expect(edit(parents, { kind: 'remove-parent', child: 'd', parent: 'a', type: 'birth' })).toBe(parents.replace('[a, # dad', '[ # dad'));
	});
	it('remove-parent of the last parent keeps both comments', () => {
		expect(edit(parents, { kind: 'remove-parent', child: 'd', parent: 'b', type: 'birth' })).toBe(parents.replace('[a, # dad\n      b]', '[a # dad\n      ]'));
	});
	it('delete-person of the first parent keeps both comments', () => {
		const out = edit(parents, { kind: 'delete-person', id: 'a' });
		expect(out).toContain('parents: [ # dad\n      b] # both');
		expect(out).not.toContain('id: a,');
	});
	it('remove-holder of the first and of the last holder keeps all comments', () => {
		const first = edit(holders, { kind: 'remove-holder', holder: { title: 'duke', index: 0, person: 'a' } });
		expect(first).toContain('holders: [ # first\n      {person: b}, # second\n      {person: c}] # third');
		const last = edit(holders, { kind: 'remove-holder', holder: { title: 'duke', index: 2, person: 'c' } });
		expect(last).toContain('holders: [{person: a}, # first\n      {person: b} # second\n      ] # third');
	});
	it('delete-person of a holder keeps all comments', () => {
		const out = edit(holders, { kind: 'delete-person', id: 'c' });
		expect(out).toContain('{person: b} # second\n      ] # third');
	});
	it('edit-title heirs: taking out the first or the last person keeps the comments', () => {
		expect(edit(heirs, { kind: 'edit-title', id: 'duke', heirs: ['b'] })).toContain('heir: [ # first\n      b]');
		expect(edit(heirs, { kind: 'edit-title', id: 'duke', heirs: ['a'] })).toContain('heir: [a # first\n      ]');
	});
	it('a comment inside the removed item itself is still refused, so none is lost', () => {
		const inside = `${PEOPLE}  - id: d\n    name: D\n    parents: [{id: a, # dad\n      type: birth}, b]\n`;
		const r = applyOp(inside, { kind: 'remove-parent', child: 'd', parent: 'a', type: 'birth' });
		expect(!r.ok && r.detail).toBe(REFUSAL_TEXT.commentWouldChange);
	});
});

describe('F-CORE-02: an unquoted link with a comma is rewritten after a rename', () => {
	it('[[Smith, John]] becomes a quoted link when the new name has a comma', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: [[Smith, John]]\n';
		const r = applyOp(src, { kind: 'rewrite-links', map: { 'smith, john.md': 'Jones, Jan' } });
		expect(r.ok && r.changed).toBe(1);
		expect(body(r)).toBe(src.replace('[[Smith, John]]', '"[[Jones, Jan]]"'));
	});
	it('[[Smith, John]] stays an unquoted link when the new name has no comma', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: [[Smith, John]]\n';
		expect(edit(src, { kind: 'rewrite-links', map: { 'smith, john.md': 'Jones' } })).toBe(src.replace('[[Smith, John]]', '[[Jones]]'));
	});
	it('keeps the heading and the alias of [[Old|Alias, X]]', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: [[Old|Alias, X]]\n';
		expect(edit(src, { kind: 'rewrite-links', map: { 'old.md': 'New' } })).toBe(src.replace('[[Old|Alias, X]]', '"[[New|Alias, X]]"'));
	});
	it('a flow-map person with a comma link is rewritten too', () => {
		const src = 'people:\n  - {id: a, name: A, link: "[[Smith, John]]"}\n';
		expect(edit(src, { kind: 'rewrite-links', map: { 'smith, john.md': 'Jones' } })).toBe(src.replace('Smith, John', 'Jones'));
	});
});

describe('F-CORE-03: a person added after a flow item that has a comment keeps the comment where it was', () => {
	it('add-person goes on its own line after the comment of the last item', () => {
		const src = 'people: [\n  {id: a, name: A},\n  {id: b,\n   name: B}  # bee\n]\n';
		expect(edit(src, { kind: 'add-person', id: 'c', fields: { name: 'C' } })).toBe('people: [\n  {id: a, name: A},\n  {id: b,\n   name: B},  # bee\n  {id: c, name: C}\n]\n');
	});
	it('add-parent into a commented flow list keeps the comment of the last parent', () => {
		const src = 'people:\n  - {id: a, name: A}\n  - {id: d, name: D, parents: [a, # dad\n      b, # mum\n      ]}\n  - {id: b, name: B}\n  - {id: c, name: C}\n';
		const out = edit(src, { kind: 'add-parent', child: 'd', parent: 'c', type: 'rumoured' });
		expect(out).toContain('b, # mum\n      {id: c, type: rumoured}\n      ]}');
	});
	it('add-holder into a commented flow list keeps the comment of the last holder', () => {
		const src = `titles:\n  - id: duke\n    name: Duke\n    holders: [{person: a}, # first\n      {person: b}] # second\n${PEOPLE}`;
		const out = edit(src, { kind: 'add-holder', title: 'duke', fields: { person: 'c' } });
		expect(out).toContain('holders: [{person: a}, # first\n      {person: b}, {person: c}] # second');
	});
	it('add-holder after a holder that has a comment on its line puts the new holder on its own line', () => {
		const src = `titles:\n  - id: duke\n    name: Duke\n    holders: [{person: a}, # first\n      {person: b}]\n${PEOPLE}`;
		const out = edit(src, { kind: 'set-holders', title: 'duke', items: [{ ref: { title: 'duke', index: 0, person: 'a' } }, { add: { person: 'c' } }, { ref: { title: 'duke', index: 1, person: 'b' } }] });
		expect(out).toContain('holders: [{person: a}, # first\n      {person: c},\n      {person: b}]');
	});
	it('a flow item without a comment still takes the new item on its own line', () => {
		const src = 'people: [{id: a, name: A}, {id: b, name: B}]\n';
		expect(edit(src, { kind: 'add-person', id: 'c', fields: { name: 'C' } })).toBe('people: [{id: a, name: A}, {id: b, name: B}, {id: c, name: C}]\n');
	});
});

describe('F-CORE-04: a new key goes after the nested block and the comment that belongs to it', () => {
	it('set-person-fields adds the key below the deeper comment', () => {
		const src = 'people:\n  - id: a\n    name: A\n    extra:\n      k: v\n      # about extra\n';
		expect(edit(src, { kind: 'set-person-fields', id: 'a', fields: { born: '1' } })).toBe(src + '    born: 1\n');
	});
	it('a comment at the level of the key belongs to what follows and stays below the new key', () => {
		const src = 'people:\n  - id: a\n    name: A\n    extra:\n      k: v\n    # next\n  - id: b\n    name: B\n';
		const out = edit(src, { kind: 'set-person-fields', id: 'a', fields: { born: '1' } });
		expect(out.indexOf('born: 1')).toBeLessThan(out.indexOf('# next'));
		expect(out.indexOf('born: 1')).toBeGreaterThan(out.indexOf('k: v'));
	});
	it('remove-parent of the last parent, then a new key: the key is below the comment of a nested block', () => {
		const src = 'people:\n  - id: a\n    name: A\n  - id: d\n    name: D\n    parents: [a]\n    extra:\n      k: v\n      # tail\n';
		const out = edit(edit(src, { kind: 'remove-parent', child: 'd', parent: 'a', type: 'birth' }), { kind: 'set-person-fields', id: 'd', fields: { born: '2' } });
		expect(out.indexOf('# tail')).toBeLessThan(out.indexOf('born: 2'));
	});
});

describe('T-X4-01: a byte order mark before the front matter', () => {
	it('is read as front matter, so a fenced example inside it is not block 0', () => {
		const tree = 'people:\n  - id: a\n    name: Aldric';
		const matter = '---\ndescription: |\n  ```kin\n  people: []\n  ```\n---\n';
		expect(findBlocks(`﻿${matter}\`\`\`kin\n${tree}\n\`\`\`\n`).map((b) => b.body)).toEqual([tree]);
	});
	it('a note that has a BOM and no front matter still finds its block', () => {
		expect(findBlocks('﻿# T\n```kin\npeople: []\n```\n').map((b) => b.body)).toEqual(['people: []']);
	});
});

describe('I16: ids keep the letters of other writing systems', () => {
	it('slugify keeps letters, digits and marks of other scripts', () => {
		expect(slugify('Иван Грозный')).toBe('иван-грозныи');
		expect(slugify('محمد')).toBe('محمد');
		expect(slugify('李 明')).toBe('李-明');
		expect(slugify('हिन्दी')).toBe('हिन्दी');
		expect(slugify('٣٤')).toBe('٣٤');
	});
	it('slugify still folds Latin accents and the letter map first', () => {
		expect(slugify('Þórr Ísólfsson')).toBe('thorr-isolfsson');
		expect(slugify('Aldric Valmont')).toBe('aldric-valmont');
		expect(slugify('1102')).toBe('p-1102');
		expect(slugify('Ǆ')).toBe('dz');
	});
	it('slugify gives "person" when no letter or digit is left, and drops a mark with nothing to sit on', () => {
		expect(slugify('???')).toBe('person');
		expect(slugify('ि')).toBe('person');
		expect(slugify('x ि')).toBe('x');
	});
	it('a made id is NFC and passes checkNewId', () => {
		const none = new Set<string>();
		for (const name of ['한국', 'Иван', 'محمد', '李', 'हिन्दी', 'Ünal', 'x ि', 'Ǆ', 'ß', '٣']) {
			const id = slugify(name);
			expect(id, name).toBe(id.normalize('NFC'));
			if (id !== 'person') expect(checkNewId(id, none), name).toBeNull();
			for (const kind of ['house', 'title'] as const) expect(checkNewId(makeIdFromName(kind, name, none), none), `${kind} ${name}`).toBeNull();
		}
		expect(uniqueId('Иван', new Set(['иван']))).toBe('иван-2');
	});
	it('checkNewId accepts lower-case and uncased letters of any script and refuses capitals and other signs', () => {
		const none = new Set<string>();
		for (const ok of ['crown', 'иван', '李明', 'محمد', 'a-1', 'á', '7']) expect(checkNewId(ok, none), ok).toBeNull();
		for (const bad of ['Crown', 'Иван', 'a b', 'a_b', 'a.b', '-', '--', 'ि', '1⁄2']) expect(checkNewId(bad, none), bad).toBe('characters');
		expect(checkNewId('иван', new Set(['иван']))).toBe('taken');
	});
	it('add-house writes a house id in the script of the name', () => {
		const r = applyOp('people:\n  - {id: p1, name: First}\n', { kind: 'add-house', name: 'Дом Рюриковичей' });
		expect(r.ok && r.created).toEqual(['дом-рюриковичеи']);
		const parsed = parseDynasty(body(r));
		expect(parsed.ok && parsed.tree.houses[0].id).toBe('дом-рюриковичеи');
	});
	it('set-house-id accepts an id of another script and refuses a capital', () => {
		const src = 'houses:\n  - {id: old, name: O}\npeople:\n  - {id: a, name: A, house: old}\n';
		expect(edit(src, { kind: 'set-house-id', id: 'old', newId: 'дом' })).toBe('houses:\n  - {id: дом, name: O}\npeople:\n  - {id: a, name: A, house: дом}\n');
		expect(code(src, { kind: 'set-house-id', id: 'old', newId: 'Дом' })).toBe('bad-value');
	});
});

describe('the refusal sentences of an id change are exported constants', () => {
	const src = 'houses:\n  - {id: old, name: O}\npeople:\n  - {id: a, name: A, house: old}\n';
	it('REFUSAL_TEXT.idCharacters is the detail of a refused character', () => {
		expect(REFUSAL_TEXT.idCharacters).toBe('An ID has only letters, digits and hyphens.');
		const r = applyOp(src, { kind: 'set-house-id', id: 'old', newId: 'Crown' });
		expect(!r.ok && r.detail).toBe(REFUSAL_TEXT.idCharacters);
	});
	it('REFUSAL_TEXT.idNotText is the detail of a new id that is not text', () => {
		expect(REFUSAL_TEXT.idNotText).toBe('The new ID must be a word or a number.');
		const r = applyOp(src, { kind: 'set-house-id', id: 'old', newId: 5 as unknown as string });
		expect(!r.ok && r.detail).toBe(REFUSAL_TEXT.idNotText);
	});
});

describe('A.1: personal arms, the write side (D181)', () => {
	const base = 'people:\n  - id: a\n    name: A\n    portrait: "[[a.png]]"\n    portrait-crop: 0 0 1\n    notes: n\n';
	it('set-person-fields writes arms as a quoted link after portrait-crop and before notes', () => {
		expect(edit(base, { kind: 'set-person-fields', id: 'a', fields: { arms: '[[arms/a.png]]' } })).toBe(base.replace('    notes: n\n', '    arms: "[[arms/a.png]]"\n    notes: n\n'));
	});
	it('a new arms key goes in the key order when the person has no portrait', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: x\n    notes: n\n';
		expect(edit(src, { kind: 'set-person-fields', id: 'a', fields: { arms: '[[x.png]]' } })).toBe(src.replace('    notes: n\n', '    arms: "[[x.png]]"\n    notes: n\n'));
	});
	it('arms: null removes the key and nothing else (the portrait and its crop stay)', () => {
		const src = base.replace('    notes: n\n', '    arms: "[[x.png]]"\n    notes: n\n');
		expect(edit(src, { kind: 'set-person-fields', id: 'a', fields: { arms: null } })).toBe(base);
	});
	it('changing arms does not touch portrait-crop; changing the portrait still does (D91)', () => {
		const src = base.replace('    notes: n\n', '    arms: "[[x.png]]"\n    notes: n\n');
		expect(edit(src, { kind: 'set-person-fields', id: 'a', fields: { arms: '[[y.png]]' } })).toBe(src.replace('x.png', 'y.png'));
		expect(edit(src, { kind: 'set-person-fields', id: 'a', fields: { portrait: '[[b.png]]' } })).not.toContain('portrait-crop');
	});
	it('the same arms text is no change', () => {
		const src = 'people:\n  - id: a\n    name: A\n    arms: [[x.png]]\n';
		expect(edit(src, { kind: 'set-person-fields', id: 'a', fields: { arms: '[[x.png]]' } })).toBe(src);
	});
	it('add-person can carry arms', () => {
		const out = edit('people:\n  - {id: a, name: A}\n', { kind: 'add-person', id: 'b', fields: { name: 'B', arms: '[[x.png]]', notes: 'n' } });
		expect(out).toContain('  - id: b\n    name: B\n    arms: "[[x.png]]"\n    notes: n');
	});
	it('linkTargets lists a person arms link and a rename rewrites it', () => {
		const src = 'houses:\n  - {id: h, name: H, arms: "[[h.png]]"}\npeople:\n  - id: a\n    name: A\n    arms: "[[Old Arms.png]]"\n    link: "[[Aldric]]"\n';
		expect(linkTargets(src)).toEqual(['h.png', 'Old Arms.png', 'Aldric']);
		const r = applyOp(src, { kind: 'rewrite-links', map: { 'old arms.png': 'arms/New.png' } });
		expect(r.ok && r.changed).toBe(1);
		expect(body(r)).toBe(src.replace('[[Old Arms.png]]', '[[arms/New.png]]'));
	});
	it('a person arms written without quotes ([[x.png]]) is rewritten like a portrait', () => {
		const src = 'people:\n  - id: a\n    name: A\n    arms: [[x.png]]\n';
		expect(edit(src, { kind: 'rewrite-links', map: { 'x.png': 'y.png' } })).toBe(src.replace('x.png', 'y.png'));
	});
});

describe('A.2: the holder tick box (through-spouse), the write side (D195)', () => {
	const TITLES = [
		'titles:',
		'  - id: duke',
		'    name: Duke',
		'    holders:',
		'      - {person: a, from: 1100, to: 1120}',
		'      - b',
		'      - person: c',
		'        name: Cee',
		'        # note',
		'      - {name: Nobody}',
		PEOPLE.trimEnd(),
		'',
	].join('\n');
	const ref = (index: number, person?: string, name?: string) => ({ title: 'duke', index, ...(person ? { person } : { name }) });

	it('ticking writes `true` after `to`', () => {
		expect(edit(TITLES, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': 'true' } })).toBe(TITLES.replace('to: 1120}', 'to: 1120, through-spouse: true}'));
	});
	it('ticking a block map writes the key after the last known key, before a trailing comment', () => {
		const out = edit(TITLES, { kind: 'edit-holder', holder: ref(2, 'c'), fields: { 'through-spouse': 'true' } });
		expect(out).toContain('        name: Cee\n        through-spouse: true\n        # note\n');
	});
	it('ticking a plain-string holder makes it a map', () => {
		expect(edit(TITLES, { kind: 'edit-holder', holder: ref(1, 'b'), fields: { 'through-spouse': 'true' } })).toBe(TITLES.replace('      - b\n', '      - {person: b, through-spouse: true}\n'));
	});
	it('unticking removes the key', () => {
		const ticked = TITLES.replace('to: 1120}', 'to: 1120, through-spouse: true}');
		expect(edit(ticked, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': null } })).toBe(TITLES);
	});
	it('unticking a plain-string holder changes nothing', () => {
		expect(edit(TITLES, { kind: 'edit-holder', holder: ref(1, 'b'), fields: { 'through-spouse': null } })).toBe(TITLES);
	});
	it('a person id written by hand stays when the box is ticked again, and goes when it is unticked', () => {
		const hand = TITLES.replace('to: 1120}', 'to: 1120, through-spouse: b}');
		expect(edit(hand, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': 'true' } })).toBe(hand);
		expect(edit(hand, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': null } })).toBe(TITLES);
	});
	it('`yes` stays when ticked; `false` and `no` become `true`', () => {
		const yes = TITLES.replace('to: 1120}', 'to: 1120, through-spouse: yes}');
		expect(edit(yes, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': 'true' } })).toBe(yes);
		const off = TITLES.replace('to: 1120}', 'to: 1120, through-spouse: false}');
		expect(edit(off, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': 'true' } })).toBe(TITLES.replace('to: 1120}', 'to: 1120, through-spouse: true}'));
	});
	it('add-holder and set-holders write the key in order, after `to`', () => {
		const added = edit(TITLES, { kind: 'add-holder', title: 'duke', fields: { person: 'c', to: '1200', 'through-spouse': 'true' } });
		expect(added).toContain('{person: c, to: 1200, through-spouse: true}');
		const set = edit(TITLES, { kind: 'set-holders', title: 'duke', items: [{ ref: ref(0, 'a'), fields: { 'through-spouse': 'true' } }, { ref: ref(1, 'b') }, { ref: ref(2, 'c') }, { ref: ref(3, undefined, 'Nobody') }] });
		expect(set).toContain('to: 1120, through-spouse: true}');
	});

	// Older plugins keep unknown keys of a holder through every holder op of 0.2.7 (A.2).
	describe('a holder with an unknown key survives every holder op', () => {
		const forms: [string, string][] = [
			['flow', 'titles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: a, mood: grim, from: 1100}\n      - {person: b, mood: calm}\n      - {person: c}\n'],
			['block', 'titles:\n  - id: duke\n    name: Duke\n    holders:\n      - person: a\n        mood: grim\n        from: 1100\n      - person: b\n        mood: calm\n      - person: c\n'],
			['flow list', 'titles:\n  - id: duke\n    name: Duke\n    holders: [{person: a, mood: grim, from: 1100}, {person: b, mood: calm}, {person: c}]\n'],
		];
		for (const [label, src0] of forms) {
			const withPeople = src0 + PEOPLE;
			const keeps = (out: string, who: string) => expect(out, `${label}: ${who}`).toContain(`mood: ${who}`);
			it(`${label}: edit-holder (other holder), tick, untick`, () => {
				const out = edit(withPeople, { kind: 'edit-holder', holder: ref(2, 'c'), fields: { to: '1200' } });
				keeps(out, 'grim');
				keeps(out, 'calm');
				const ticked = edit(withPeople, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': 'true' } });
				keeps(ticked, 'grim');
				const unticked = edit(ticked, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { 'through-spouse': null } });
				expect(unticked).toBe(withPeople);
				const same = edit(withPeople, { kind: 'edit-holder', holder: ref(0, 'a'), fields: { from: '1101' } });
				keeps(same, 'grim');
			});
			it(`${label}: remove-holder, add-holder, delete-person`, () => {
				const removed = edit(withPeople, { kind: 'remove-holder', holder: ref(2, 'c') });
				keeps(removed, 'grim');
				keeps(removed, 'calm');
				const added = edit(withPeople, { kind: 'add-holder', title: 'duke', fields: { name: 'New' } });
				keeps(added, 'grim');
				keeps(added, 'calm');
				const gone = edit(withPeople, { kind: 'delete-person', id: 'c' });
				keeps(gone, 'grim');
				keeps(gone, 'calm');
			});
			it(`${label}: set-holders with a move and an edit`, () => {
				const out = edit(withPeople, { kind: 'set-holders', title: 'duke', items: [{ ref: ref(1, 'b'), fields: { as: 'Regent' } }, { ref: ref(0, 'a') }, { ref: ref(2, 'c') }] });
				keeps(out, 'grim');
				keeps(out, 'calm');
				const parsed = parseDynasty(out);
				expect(parsed.ok).toBe(true);
			});
		}
	});
});

describe('A.3: a title keeps its `plural` key', () => {
	const TITLES = 'titles:\n  - id: duke\n    name: Duke of Valmont\n    plural: Dukes of Valmont\n    holders: a\n  - id: count\n    name: Count\npeople:\n  - {id: a, name: A}\n';
	it('an edit that does not mention the plural keeps an existing key and writes none to a title without one', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', name: 'Duke of X' })).toBe(TITLES.replace('Duke of Valmont', 'Duke of X'));
		expect(edit(TITLES, { kind: 'edit-title', id: 'count', name: 'Earl', maleName: 'Earl' })).not.toContain('plural: Earl');
		expect(edit(TITLES, { kind: 'edit-title', id: 'count', name: 'Earl' })).toBe(TITLES.replace('name: Count\n', 'name: Earl\n'));
	});
	it('keeps the key when the name, the male name and the succession change in one op', () => {
		const out = edit(TITLES, { kind: 'edit-title', id: 'duke', name: 'Duke', maleName: 'Duke', femaleName: 'Duchess', succession: 'eldest-child' });
		expect(out).toContain('plural: Dukes of Valmont');
	});
	it('a holder edit keeps it too', () => {
		expect(edit(TITLES, { kind: 'add-holder', title: 'duke', fields: { person: 'a', from: '1' } })).toContain('plural: Dukes of Valmont');
	});
});

describe('B.3: PARENT_LIMIT in the parent ops (rumoured parents: 8)', () => {
	const rumours = (n: number) => Array.from({ length: n }, (_, i) => `  - {id: r${i}, name: R${i}}\n`).join('');
	const child = (types: string[]) => `people:\n${rumours(9)}  - id: d\n    name: D\n    parents: [${types.map((t, i) => `{id: r${i}, type: ${t}}`).join(', ')}]\n`;

	it('add-parent: the third birth, adoptive and ward parent is refused', () => {
		for (const type of ['birth', 'adoptive', 'ward'] as const) {
			const src = child([type, type]);
			expect(code(src, { kind: 'add-parent', child: 'd', parent: 'r2', type }), type).toBe('limit');
		}
	});
	it('add-parent: rumoured parents are allowed up to 8; the 9th is refused', () => {
		let src = child(['rumoured', 'rumoured']);
		for (let i = 2; i < 8; i++) src = edit(src, { kind: 'add-parent', child: 'd', parent: `r${i}`, type: 'rumoured' });
		expect(src.match(/rumoured/g)!.length).toBe(8);
		expect(code(src, { kind: 'add-parent', child: 'd', parent: 'r8', type: 'rumoured' })).toBe('limit');
	});
	it('set-parent-type: a link moves to rumoured while it has fewer than 8, and to birth only below 2', () => {
		const seven = child(['rumoured', 'rumoured', 'rumoured', 'rumoured', 'rumoured', 'rumoured', 'rumoured', 'birth']);
		expect(code(seven, { kind: 'set-parent-type', child: 'd', parent: 'r7', from: 'birth', to: 'rumoured' })).toBe('ok');
		const eight = child(['rumoured', 'rumoured', 'rumoured', 'rumoured', 'rumoured', 'rumoured', 'rumoured', 'rumoured', 'birth']);
		expect(code(eight, { kind: 'set-parent-type', child: 'd', parent: 'r8', from: 'birth', to: 'rumoured' })).toBe('limit');
		const two = child(['birth', 'birth', 'rumoured']);
		expect(code(two, { kind: 'set-parent-type', child: 'd', parent: 'r2', from: 'rumoured', to: 'birth' })).toBe('limit');
	});
	it('add-person: up to 8 rumoured parents and 2 of the other types', () => {
		const src = `people:\n${rumours(9)}`;
		const parents = (n: number, type: 'rumoured' | 'birth') => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, type }));
		expect(code(src, { kind: 'add-person', id: 'n', fields: { name: 'N' }, parents: parents(8, 'rumoured') })).toBe('ok');
		expect(code(src, { kind: 'add-person', id: 'n', fields: { name: 'N' }, parents: parents(9, 'rumoured') })).toBe('limit');
		expect(code(src, { kind: 'add-person', id: 'n', fields: { name: 'N' }, parents: parents(3, 'birth') })).toBe('limit');
	});
});
