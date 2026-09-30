import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import { parseDynasty } from '../../src/core/parse';
import { lineSubgraph, findRelation } from '../../src/core/relations';
import { replaceOnce } from './golden';
import { allFixtures } from './load';
import { applyPictureOp, block14, bodyOf, graphOf, houseOf, personOf, treeOf, type PictureHouse, type PicturePerson } from './m9-support';

/*
 * Spec §13.0 items 1 and 3, §13.6 and §13.7 "Tree text", and the M9 core contract rules 1–3 with
 * amendment A3: reading `arms` (houses) and `portrait` (people) in every written form, the key
 * order, the double quotes, removal, and "an equal value writes nothing". The expected bodies are
 * written by hand as the smallest change to the text of sample tree 14 (spec §6.2). These tests
 * wait for WP 9.1.
 */

const B1 = block14(0);

/** One person item in a small tree, for the key-order and quoting cases. */
const tree = (person: string, rest = '') => `houses:\n  - id: h\n    name: House H\n\npeople:\n${person}${rest}`;

describe('reading `arms` and `portrait` (spec §13.6, §13.7 "Tree text"; rule 1)', () => {
	it('sample tree 14: every house and person value, as written; an unquoted [[…]] reads like `link`', () => {
		const t = treeOf(B1);
		const arms = Object.fromEntries((t.houses as PictureHouse[]).map((h) => [h.id, h.arms]));
		expect(arms).toEqual({
			valmont: '[[valmont-arms.png]]',
			orsini: '![[orsini-arms.svg]]',
			castellane: '[Castellane arms](pictures/castellane-arms-lineart.png)',
			harrow: '[[harrow-arms.png]]',
			drakemoor: 'https://example.com/drakemoor-arms.png',
			veyle: '[[veyle-arms.heic]]',
			ashby: '[[ashby-charter.pdf]]',
			greymane: '[[huge-banner.png]]',
			thorne: undefined,
		});
		const portraits = Object.fromEntries((t.people as PicturePerson[]).filter((p) => p.portrait !== undefined).map((p) => [p.id, p.portrait]));
		expect(portraits).toEqual({
			aldric: '[[aldric.jpg]]',
			isolde: '[[isolde.png]]',
			roderick: '![[roderick-tall.jpg]]',
			beatrice: '[[beatrice.jpg]]',
			wren: '[[wren-photo.jpg]]',
			edmund: '[[edmund-rotated.jpg]]',
			oswin: '[[oswin.jpg]]',
			matteo: '[[matteo.png]]',
			giselle: '[Giselle](pictures/giselle.png)',
			tomas: '[[tomas.svg]]',
			lisette: '[[lisette.png]]',
			darian: 'https://example.com/darian.jpg',
			felicia: '[[felicia.heic]]',
			cedric: '[[ashby-charter.pdf]]',
			adela: '[[huge-banner.png]]',
			hugo: '[[photo-4000.jpg]]',
			piers: '[[piers.png|Piers at twenty]]',
		});
		// The field exists only when written: a house with no arms and a person with no portrait have no key.
		expect('arms' in houseOf(t, 'thorne')!).toBe(false);
		expect('portrait' in personOf(t, 'bastien')!).toBe(false);
	});

	it('the other written forms: single quotes, plain text, a comma inside an unquoted [[…]]', () => {
		const t = treeOf(
			[
				'houses:',
				"  - {id: a, name: A, arms: '[[a.png]]'}",
				'  - id: b',
				'    name: B',
				'    arms: Pictures/b.svg',
				'people:',
				'  - id: p',
				'    name: P',
				'    portrait: [[Smith, John.png]]',
				'  - {id: q, name: Q, portrait: [[q.png]]}',
				'  - id: r',
				'    name: R',
				'    portrait: "[Portrait](<Pictures/My R.png>)"   # a comment',
			].join('\n'),
		);
		expect(houseOf(t, 'a')!.arms).toBe('[[a.png]]');
		expect(houseOf(t, 'b')!.arms).toBe('Pictures/b.svg');
		expect(personOf(t, 'p')!.portrait).toBe('[[Smith, John.png]]');
		expect(personOf(t, 'q')!.portrait).toBe('[[q.png]]');
		expect(personOf(t, 'r')!.portrait).toBe('[Portrait](<Pictures/My R.png>)');
	});

	it('empty, null, a list or a map read as absent, with no warning (as for `link`)', () => {
		const values = ['""', "''", '', '~', 'null', '[]', '{}', '[a, b]', '{x: y}', '[[a], [b]]'];
		for (const v of values) {
			const t = treeOf(`houses:\n  - id: h\n    name: H\n    arms: ${v}\npeople:\n  - id: p\n    name: P\n    portrait: ${v}\n`);
			expect('arms' in houseOf(t, 'h')!, `arms: ${v}`).toBe(false);
			expect('portrait' in personOf(t, 'p')!, `portrait: ${v}`).toBe(false);
			expect(t.issues, v).toEqual([]);
			expect(deriveFamilies(t).issues, v).toEqual([]);
		}
	});

	it('A3: an unquoted ![[…]] (a pasted embed) in `arms`, `portrait` and `link` reads like the quoted form, not as a hard error', () => {
		const r = parseDynasty(['houses:', '  - id: h', '    name: H', '    arms: ![[h arms.png]]', 'people:', '  - id: p', '    name: P', '    link: ![[P note]]', '    portrait: ![[p.jpg|P]]', '    born: 1100'].join('\n'));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect((r.tree.houses[0] as PictureHouse).arms).toBe('![[h arms.png]]');
		expect(r.tree.people[0].link).toBe('![[P note]]');
		expect((r.tree.people[0] as PicturePerson).portrait).toBe('![[p.jpg|P]]');
		// The keys after it still read.
		expect(r.tree.people[0].born).toBe('1100');
		expect(r.tree.issues).toEqual([]);
	});

	it('A3: sample tree 14 block 2 (an unquoted ![[…]] portrait) shows', () => {
		const t = treeOf(block14(1));
		expect(personOf(t, 'roderick')!.portrait).toBe('![[roderick-tall.jpg]]');
		expect(deriveFamilies(t).issues).toEqual([]);
	});

	it('A3: other unquoted values keep their 1.0 reading (an unquoted ![[…]] in `notes` is still a YAML error)', () => {
		expect(parseDynasty('people:\n  - id: p\n    name: P\n    notes: ![[x.png]]\n').ok).toBe(false);
	});

	it('a tree without pictures reads exactly as before: no `arms` or `portrait` keys anywhere', () => {
		for (const f of allFixtures().filter((x) => x.id !== '14' && x.id !== '07b')) {
			const r = parseDynasty(f.source);
			if (!r.ok) continue;
			for (const h of r.tree.houses) expect('arms' in h, `${f.id} ${h.id}`).toBe(false);
			for (const p of r.tree.people) expect('portrait' in p, `${f.id} ${p.id}`).toBe(false);
		}
	});

	it('the core makes no picture checks: sample tree 14 has no issues (rule 1; the warnings come from the vault checks)', () => {
		expect(graphOf(B1).issues).toEqual([]);
		expect(graphOf(block14(1)).issues).toEqual([]);
		expect(graphOf(allFixtures().find((f) => f.id === '07b')!.source).issues).toEqual([]);
	});

	it('the family graph, the focus family and the relation finder line keep the fields (rule 1)', () => {
		const t = treeOf(B1);
		const g = deriveFamilies(t);
		expect((g.houses.get('valmont') as PictureHouse).arms).toBe('[[valmont-arms.png]]');
		expect((g.byId.get('aldric') as PicturePerson).portrait).toBe('[[aldric.jpg]]');
		const focus = focusSubgraph(t, 'roderick', 1)!.tree;
		expect((focus.houses.find((h) => h.id === 'castellane') as PictureHouse).arms).toBe('[Castellane arms](pictures/castellane-arms-lineart.png)');
		expect((focus.people.find((p) => p.id === 'edmund') as PicturePerson).portrait).toBe('[[edmund-rotated.jpg]]');
		const f = findRelation(g, 'edmund', 'isolde');
		expect(f.kind).toBe('named');
		if (f.kind !== 'named') return;
		const lg = lineSubgraph(g, f.relations[0].relation.line);
		expect((lg.byId.get('isolde') as PicturePerson).portrait).toBe('[[isolde.png]]');
		expect((lg.houses.get('orsini') as PictureHouse).arms).toBe('![[orsini-arms.svg]]');
	});
});

describe('writing `portrait` (spec §13.7; contract rules 2 and 3)', () => {
	const set = (body: string, id: string, portrait: string | null) => applyPictureOp(body, { kind: 'set-person-fields', id, fields: { portrait } });

	it('a new portrait goes after the nearest earlier key (Bastien: after `illegitimate`), in double quotes', () => {
		expect(bodyOf(set(B1, 'bastien', '[[bastien.png]]'))).toBe(replaceOnce(B1, '    born: 1136\n    illegitimate: true\n', '    born: 1136\n    illegitimate: true\n    portrait: "[[bastien.png]]"\n'));
		expect(bodyOf(set(B1, 'clarice', '[[clarice.png]]'))).toBe(
			replaceOnce(B1, '    born: 1160\n    parents: [roderick, beatrice]\n', '    born: 1160\n    parents: [roderick, beatrice]\n    portrait: "[[clarice.png]]"\n'),
		);
	});

	it('key order: after `link` and `union`, before `notes`', () => {
		const withNotes = tree('  - id: a\n    name: A\n    house: h\n    notes: Some notes.\n');
		expect(bodyOf(set(withNotes, 'a', '[[a.png]]'))).toBe(replaceOnce(withNotes, '    house: h\n', '    house: h\n    portrait: "[[a.png]]"\n'));
		const withLink = tree('  - id: a\n    name: A\n    link: "[[A]]"\n    notes: Some notes.\n');
		expect(bodyOf(set(withLink, 'a', '[[a.png]]'))).toBe(replaceOnce(withLink, '    link: "[[A]]"\n', '    link: "[[A]]"\n    portrait: "[[a.png]]"\n'));
		const withUnion = tree('  - id: a\n    name: A\n    union: u1\n    notes: Some notes.\n');
		expect(bodyOf(set(withUnion, 'a', '[[a.png]]'))).toBe(replaceOnce(withUnion, '    union: u1\n', '    union: u1\n    portrait: "[[a.png]]"\n'));
	});

	it('a flow-map person gets the key in the same place', () => {
		const flow = tree('  - {id: a, name: A, link: "[[A]]", notes: x}\n');
		expect(bodyOf(set(flow, 'a', '[[a.png]]'))).toBe(replaceOnce(flow, '"[[A]]", notes', '"[[A]]", portrait: "[[a.png]]", notes'));
	});

	it('a changed portrait replaces only the value; the written style becomes double quotes', () => {
		expect(bodyOf(set(B1, 'aldric', '[[aldric-old.jpg]]'))).toBe(replaceOnce(B1, '    portrait: "[[aldric.jpg]]"\n', '    portrait: "[[aldric-old.jpg]]"\n'));
		// Matteo's unquoted [[…]] keeps the comment above it.
		expect(bodyOf(set(B1, 'matteo', '[[matteo-2.png]]'))).toBe(replaceOnce(B1, '    portrait: [[matteo.png]]\n', '    portrait: "[[matteo-2.png]]"\n'));
		const single = tree("  - id: a\n    name: A\n    portrait: '[[old.png]]'   # kept comment\n");
		expect(bodyOf(set(single, 'a', '[[new.png]]'))).toBe(replaceOnce(single, "'[[old.png]]'", '"[[new.png]]"'));
	});

	it('always in double quotes, whatever the text is', () => {
		const a = tree('  - id: a\n    name: A\n');
		const cases: [string, string][] = [
			['plain.png', '"plain.png"'],
			['[[x #1: y.png]]', '"[[x #1: y.png]]"'],
			['[P](<Pictures/My P.png>)', '"[P](<Pictures/My P.png>)"'],
			['[[a "b".png]]', '"[[a \\"b\\".png]]"'],
			['Pictures\\a.png', '"Pictures\\\\a.png"'],
		];
		for (const [value, written] of cases) {
			expect(bodyOf(set(a, 'a', value)), value).toBe(`${a}    portrait: ${written}\n`);
			expect((treeOf(bodyOf(set(a, 'a', value))).people[0] as PicturePerson).portrait, value).toBe(value);
		}
	});

	it('a value equal to the read value (compared through `linkValue`) writes nothing', () => {
		for (const [id, value] of [
			['aldric', '[[aldric.jpg]]'],
			['matteo', '[[matteo.png]]'],
			['roderick', '![[roderick-tall.jpg]]'],
		] as const) {
			const r = set(B1, id, value);
			expect(r.ok, id).toBe(true);
			expect(bodyOf(r), id).toBe(B1);
		}
		const single = tree("  - id: a\n    name: A\n    portrait: '[[a.png]]'\n");
		expect(bodyOf(set(single, 'a', '[[a.png]]'))).toBe(single);
	});

	it('null or empty text removes the key and only its lines', () => {
		const removed = replaceOnce(B1, '    link: "[[Aldric Valmont]]"\n    portrait: "[[aldric.jpg]]"\n', '    link: "[[Aldric Valmont]]"\n');
		expect(bodyOf(set(B1, 'aldric', null))).toBe(removed);
		expect(bodyOf(set(B1, 'aldric', ''))).toBe(removed);
		expect(bodyOf(set(B1, 'aldric', '   '))).toBe(removed);
		// Nothing to remove: nothing changes.
		expect(bodyOf(set(B1, 'bastien', null))).toBe(B1);
	});

	it('the portrait goes in the same write as the other sheet fields (§6.3)', () => {
		const r = applyPictureOp(B1, { kind: 'set-person-fields', id: 'bastien', fields: { born: '1135', portrait: '[[bastien.png]]' } });
		expect(bodyOf(r)).toBe(replaceOnce(B1, '    born: 1136\n    illegitimate: true\n', '    born: 1135\n    illegitimate: true\n    portrait: "[[bastien.png]]"\n'));
	});

	it('add-person: a new person with a portrait, keys in order', () => {
		const r = applyPictureOp(B1, { kind: 'add-person', id: 'ysolde', fields: { name: 'Ysolde Valmont', portrait: '[[ysolde.png]]', house: 'valmont' } });
		expect(bodyOf(r)).toBe(
			replaceOnce(
				B1,
				'    portrait: "[[piers.png|Piers at twenty]]"\n',
				'    portrait: "[[piers.png|Piers at twenty]]"\n  - id: ysolde\n    name: Ysolde Valmont\n    house: valmont\n    portrait: "[[ysolde.png]]"\n',
			),
		);
	});
});

describe('writing `arms` (spec §13.6 Houses window; contract rules 2 and 3)', () => {
	const edit = (body: string, id: string, arms: unknown, more: Record<string, unknown> = {}) => applyPictureOp(body, { kind: 'edit-house', id, arms, ...more });

	it('edit-house: a new `arms` goes after `color`, else after `name`, in double quotes', () => {
		expect(bodyOf(edit(B1, 'thorne', '[[thorne.png]]'))).toBe(replaceOnce(B1, '    color: "#7a2e6b"\n', '    color: "#7a2e6b"\n    arms: "[[thorne.png]]"\n'));
		const noColour = 'houses:\n  - id: h\n    name: House H\n  - id: k\n    name: House K\npeople:\n  - id: p\n    name: P\n';
		expect(bodyOf(edit(noColour, 'h', '[[h.png]]'))).toBe(replaceOnce(noColour, '    name: House H\n', '    name: House H\n    arms: "[[h.png]]"\n'));
		const flow = 'houses:\n  - {id: h, name: House H, color: "#123456"}\npeople: []\n';
		expect(bodyOf(edit(flow, 'h', 'h.svg'))).toBe(replaceOnce(flow, '"#123456"}', '"#123456", arms: "h.svg"}'));
	});

	it('edit-house: a changed `arms` replaces only its value; a comment above it stays', () => {
		expect(bodyOf(edit(B1, 'valmont', '[[valmont-2.png]]'))).toBe(replaceOnce(B1, '    arms: "[[valmont-arms.png]]"\n', '    arms: "[[valmont-2.png]]"\n'));
		expect(bodyOf(edit(B1, 'harrow', '[[harrow.png]]'))).toBe(replaceOnce(B1, '    # The file is not in the vault.\n    arms: "[[harrow-arms.png]]"\n', '    # The file is not in the vault.\n    arms: "[[harrow.png]]"\n'));
	});

	it('edit-house: null or empty text removes the key and only its lines; an equal value writes nothing', () => {
		const removed = replaceOnce(B1, '    arms: "![[orsini-arms.svg]]"\n', '');
		expect(bodyOf(edit(B1, 'orsini', null))).toBe(removed);
		expect(bodyOf(edit(B1, 'orsini', ''))).toBe(removed);
		expect(bodyOf(edit(B1, 'orsini', '![[orsini-arms.svg]]'))).toBe(B1);
		expect(bodyOf(edit(B1, 'thorne', null))).toBe(B1);
		// An arms change leaves the name and colour alone.
		expect(bodyOf(edit(B1, 'valmont', '[[v.png]]', { name: 'House Valmont', color: '#8b1e3f' }))).toBe(replaceOnce(B1, '"[[valmont-arms.png]]"', '"[[v.png]]"'));
	});

	it('edit-house and add-house refuse a non-string `arms` (`bad-value`)', () => {
		for (const arms of [42, {}, [], true]) {
			expect(edit(B1, 'valmont', arms), JSON.stringify(arms)).toMatchObject({ ok: false, code: 'bad-value' });
			expect(applyPictureOp(B1, { kind: 'add-house', name: 'House Wexley', arms }), JSON.stringify(arms)).toMatchObject({ ok: false, code: 'bad-value' });
		}
	});

	it('add-house: a new house with a colour and arms, keys in order `id, name, color, arms`', () => {
		const r = applyPictureOp(B1, { kind: 'add-house', name: 'House Wexley', color: '#123456', arms: '[[wexley.png]]' });
		expect(r).toMatchObject({ ok: true, created: ['house-wexley'] });
		expect(bodyOf(r)).toBe(replaceOnce(B1, '    color: "#7a2e6b"\n', '    color: "#7a2e6b"\n  - id: house-wexley\n    name: House Wexley\n    color: "#123456"\n    arms: "[[wexley.png]]"\n'));
		const noColour = applyPictureOp(B1, { kind: 'add-house', name: 'House Wexley', arms: '[[wexley.png]]' });
		expect(bodyOf(noColour)).toBe(replaceOnce(B1, '    color: "#7a2e6b"\n', '    color: "#7a2e6b"\n  - id: house-wexley\n    name: House Wexley\n    arms: "[[wexley.png]]"\n'));
		const empty = applyPictureOp(B1, { kind: 'add-house', name: 'House Wexley', arms: '' });
		expect(bodyOf(empty)).toBe(replaceOnce(B1, '    color: "#7a2e6b"\n', '    color: "#7a2e6b"\n  - id: house-wexley\n    name: House Wexley\n'));
	});

	it('Houses window Save: arms of two houses selected, one removed, one colour from the arms: one write that changes only those lines (spec §13.6 acceptance)', () => {
		const r = applyPictureOp(B1, {
			kind: 'batch',
			ops: [
				{ kind: 'edit-house', id: 'valmont', arms: '[[valmont-2.png]]', color: '#c8102e' },
				{ kind: 'edit-house', id: 'thorne', arms: '[[thorne.png]]' },
				{ kind: 'edit-house', id: 'orsini', arms: null },
			],
		});
		let want = replaceOnce(B1, '    color: "#8b1e3f"\n    arms: "[[valmont-arms.png]]"\n', '    color: "#c8102e"\n    arms: "[[valmont-2.png]]"\n');
		want = replaceOnce(want, '    color: "#7a2e6b"\n', '    color: "#7a2e6b"\n    arms: "[[thorne.png]]"\n');
		want = replaceOnce(want, '    arms: "![[orsini-arms.svg]]"\n', '');
		expect(bodyOf(r)).toBe(want);
	});

	it('no op checks that the file exists (rule 3): a missing file and a web address are written as given', () => {
		expect(bodyOf(edit(B1, 'thorne', 'https://example.com/t.png'))).toBe(replaceOnce(B1, '    color: "#7a2e6b"\n', '    color: "#7a2e6b"\n    arms: "https://example.com/t.png"\n'));
	});
});
