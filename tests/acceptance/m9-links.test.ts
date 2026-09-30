import { describe, expect, it } from 'vitest';
import { linkTargets } from '../../src/core/link-rewrite';
import { replaceOnce } from './golden';
import { allFixtures } from './load';
import { applyPictureOp, block14, bodyOf } from './m9-support';

/*
 * Spec §13.0 item 3 "Renames", §6.9, D35, and the M9 core contract rule 11 with amendment A2:
 * `linkTargets` lists the targets of every person `link`, person `portrait` and house `arms` in
 * text order; `rewrite-links` rewrites all three by the rules for `link`, and `EditResult.changed`
 * counts values. These tests wait for WP 9.1.
 */

const B1 = block14(0);
const rewrite = (body: string, map: Record<string, string>) => applyPictureOp(body, { kind: 'rewrite-links', map });
const changed = (body: string, map: Record<string, string>) => {
	const r = rewrite(body, map);
	if (!r.ok) throw new Error(`refused: ${r.code}`);
	return r.changed;
};

describe('linkTargets: links, portraits and arms, in text order (rule 11)', () => {
	it('sample tree 14: every arms and portrait target, with the one `link`', () => {
		expect(linkTargets(B1)).toEqual([
			'valmont-arms.png',
			'orsini-arms.svg',
			'pictures/castellane-arms-lineart.png',
			'harrow-arms.png',
			'https://example.com/drakemoor-arms.png',
			'veyle-arms.heic',
			'ashby-charter.pdf',
			'huge-banner.png',
			'Aldric Valmont',
			'aldric.jpg',
			'isolde.png',
			'roderick-tall.jpg',
			'beatrice.jpg',
			'wren-photo.jpg',
			'edmund-rotated.jpg',
			'oswin.jpg',
			'matteo.png',
			'pictures/giselle.png',
			'tomas.svg',
			'lisette.png',
			'https://example.com/darian.jpg',
			'felicia.heic',
			'ashby-charter.pdf',
			'huge-banner.png',
			'photo-4000.jpg',
			'piers.png',
		]);
	});

	it('sample tree 14 block 2: the unquoted ![[…]] counts too (A3)', () => {
		expect(linkTargets(block14(1))).toEqual(['valmont-arms.png', 'orsini-arms.svg', 'aldric.jpg', 'isolde.png', 'roderick-tall.jpg']);
	});

	it('sample tree 07b: the 6 arms, then the 50 portraits', () => {
		const t = linkTargets(allFixtures().find((f) => f.id === '07b')!.source);
		expect(t.length).toBe(56);
		expect(t.slice(0, 6)).toEqual(['07b-valmont-arms.png', '07b-orsini-arms.png', '07b-harrow-arms.png', '07b-castellane-arms.png', '07b-drakemoor-arms.png', '07b-veyle-arms.png']);
		for (const x of t.slice(6)) expect(x).toMatch(/^07b-[a-z0-9-]+\.(jpg|png|svg)$/);
	});

	it('text order, also when `people` comes before `houses`; notes and unknown keys do not count', () => {
		const body = [
			'people:',
			'  - id: a',
			'    name: A',
			'    portrait: "[[a.png]]"',
			'    notes: "[[not-a-link.png]]"',
			'    link: "[[A note]]"',
			'houses:',
			'  - id: h',
			'    name: H',
			'    motto: "[[motto.png]]"',
			'    arms: "![[h.png|H]]"',
		].join('\n');
		expect(linkTargets(body)).toEqual(['a.png', 'A note', 'h.png']);
	});

	it('A2: balanced parentheses in a Markdown link, for `link` too', () => {
		const body = 'people:\n  - id: a\n    name: A\n    link: "[Hall](Notes/Old%20Hall%20(west).md)"\n    portrait: "[](Pictures/Arms%20(old).png)"\n';
		expect(linkTargets(body)).toEqual(['Notes/Old Hall (west).md', 'Pictures/Arms (old).png']);
	});
});

describe('rewrite-links: pictures move like notes; the extension stays (spec §13.0 item 3, §6.9; rule 11)', () => {
	it('arms: only that value changes; `changed` counts it', () => {
		const r = rewrite(B1, { 'valmont-arms.png': 'valmont-arms-new.png' });
		expect(bodyOf(r)).toBe(replaceOnce(B1, '"[[valmont-arms.png]]"', '"[[valmont-arms-new.png]]"'));
		expect(r).toMatchObject({ changed: 1 });
	});

	it('a person with a changed `link` and `portrait` counts 2', () => {
		const r = rewrite(B1, { 'aldric valmont': 'Aldric the Wise', 'aldric.jpg': 'aldric-portrait.jpg' });
		const want = replaceOnce(replaceOnce(B1, '"[[Aldric Valmont]]"', '"[[Aldric the Wise]]"'), '"[[aldric.jpg]]"', '"[[aldric-portrait.jpg]]"');
		expect(bodyOf(r)).toBe(want);
		expect(r).toMatchObject({ changed: 2 });
	});

	it('one file used by a house and a person: both values change, `changed` 2', () => {
		const r = rewrite(B1, { 'huge-banner.png': 'banner.png' });
		expect(bodyOf(r)).toBe(B1.replace(/"\[\[huge-banner\.png\]\]"/g, '"[[banner.png]]"'));
		expect(B1.match(/huge-banner\.png\]\]/g)!.length).toBe(2);
		expect(r).toMatchObject({ changed: 2 });
	});

	it('every written form keeps its form: "!", an alias, a Markdown link (encoded), an unquoted [[…]]', () => {
		expect(bodyOf(rewrite(B1, { 'orsini-arms.svg': 'Heraldry/orsini-arms.svg' }))).toBe(replaceOnce(B1, '"![[orsini-arms.svg]]"', '"![[Heraldry/orsini-arms.svg]]"'));
		expect(bodyOf(rewrite(B1, { 'piers.png': 'Portraits/piers.png' }))).toBe(replaceOnce(B1, '"[[piers.png|Piers at twenty]]"', '"[[Portraits/piers.png|Piers at twenty]]"'));
		expect(bodyOf(rewrite(B1, { 'pictures/castellane-arms-lineart.png': 'Heraldry/castellane arms.png' }))).toBe(
			replaceOnce(B1, '(pictures/castellane-arms-lineart.png)', '(Heraldry/castellane%20arms.png)'),
		);
		expect(bodyOf(rewrite(B1, { 'matteo.png': 'matteo-2.png' }))).toBe(replaceOnce(B1, '    portrait: [[matteo.png]]\n', '    portrait: [[matteo-2.png]]\n'));
	});

	it('A3: an unquoted ![[…]] value is rewritten and reads back', () => {
		const r = rewrite(block14(1), { 'roderick-tall.jpg': 'roderick-2.jpg' });
		expect(r).toMatchObject({ ok: true, changed: 1 });
		expect(linkTargets(bodyOf(r))).toEqual(['valmont-arms.png', 'orsini-arms.svg', 'aldric.jpg', 'isolde.png', 'roderick-2.jpg']);
	});

	it('A2: a Markdown destination with parentheses', () => {
		const body = 'people:\n  - id: a\n    name: A\n    link: "[Hall](Notes/Old%20Hall%20(west).md)"\n    portrait: "[](Pictures/Arms%20(old).png)"\n';
		const r = rewrite(body, { 'notes/old hall (west)': 'Notes/New Hall', 'pictures/arms (old).png': 'Pictures/Arms (new).png' });
		expect(bodyOf(r)).toBe(replaceOnce(replaceOnce(body, '(Notes/Old%20Hall%20(west).md)', '(Notes/New%20Hall.md)'), '(Pictures/Arms%20(old).png)', '(Pictures/Arms%20%28new%29.png)'));
		expect(r).toMatchObject({ changed: 2 });
	});

	it('an aliased person counts once per value; a tree with blocking issues is still rewritten', () => {
		const body = ['people:', '  - &p', '    id: a', '    name: A', '    link: "[[Old]]"', '    portrait: "[[old.png]]"', '  - *p', ''].join('\n');
		const r = rewrite(body, { old: 'New', 'old.png': 'new.png' });
		expect(bodyOf(r)).toBe(replaceOnce(replaceOnce(body, '"[[Old]]"', '"[[New]]"'), '"[[old.png]]"', '"[[new.png]]"'));
		expect(r).toMatchObject({ changed: 2 });
	});

	it('names, notes, unknown keys and web addresses are not rewritten by a file rename', () => {
		const body = 'houses:\n  - id: h\n    name: valmont-arms.png\n    motto: "[[valmont-arms.png]]"\npeople:\n  - id: a\n    name: A\n    notes: "[[valmont-arms.png]]"\n';
		expect(changed(body, { 'valmont-arms.png': 'x.png' })).toBe(0);
		expect(bodyOf(rewrite(body, { 'valmont-arms.png': 'x.png' }))).toBe(body);
		expect(changed(B1, { 'example.com/darian.jpg': 'x.jpg' })).toBe(0);
	});

	it('a tree with only person links counts as before (one per changed link)', () => {
		const body = 'people:\n  - id: a\n    name: A\n    link: "[[Old]]"\n  - id: b\n    name: B\n    link: "[[Old#Part]]"\n  - id: c\n    name: C\n    link: "[[Other]]"\n';
		expect(changed(body, { old: 'New' })).toBe(2);
	});
});
