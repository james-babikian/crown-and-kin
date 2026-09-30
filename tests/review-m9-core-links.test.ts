import { describe, expect, it } from 'vitest';
import { parseDynasty } from '../src/core/parse';
import { pictureTarget } from '../src/core/pictures';
import { applyOp } from '../src/core/yaml-edit';

/*
 * code-reviewer, M9 core (WP 9.1). Failing tests that prove review findings. Not part of the build.
 */

const body = (r: ReturnType<typeof applyOp>) => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};

describe('review M9 core: rewrite-links keeps a note "x.png.md" and a picture "x.png" apart', () => {
	// A person links to the note "x.png.md" (written with .md) and shows the picture "x.png".
	const TREE = 'people:\n  - id: a\n    name: A\n    link: "[[x.png.md]]"\n    portrait: "[[x.png]]"\n';

	it('the rename of the note x.png.md to y.md changes the link, not the portrait', () => {
		// rename-links.ts (linksFor) sends exactly this map for that rename: key = the written target.
		const out = body(applyOp(TREE, { kind: 'rewrite-links', map: { 'x.png.md': 'y' } }));
		expect(out).toContain('    link: "[[y.md]]"');
		expect(out).toContain('    portrait: "[[x.png]]"');
	});

	it('the rename of the picture x.png to z.png changes the portrait, not the link to the note', () => {
		const out = body(applyOp(TREE, { kind: 'rewrite-links', map: { 'x.png': 'z.png' } }));
		expect(out).toContain('    portrait: "[[z.png]]"');
		expect(out).toContain('    link: "[[x.png.md]]"');
	});
});

describe('review M9 core: rule 4, a bare value with a leading "!"', () => {
	it('pictureTarget reads "!p" as the path p, and "!https://…" as a web address', () => {
		expect(pictureTarget('!Pictures/x.png')).toEqual({ kind: 'vault', path: 'Pictures/x.png', ext: 'png' });
		expect(pictureTarget('!https://example.com/x.png')).toEqual({ kind: 'web' });
	});
});

describe('review M9 core: rule 3, a picture link equal to the read value writes nothing', () => {
	it('set-person-fields portrait: the value parse reads for an unquoted [[x,y.png]] writes nothing', () => {
		const tree = 'people:\n  - id: a\n    name: A\n    portrait: [[x,y.png]]\n';
		const r = parseDynasty(tree);
		if (!r.ok) throw new Error(r.error.code);
		const read = r.tree.people[0].portrait!;
		expect(read).toBe('[[x,y.png]]');
		expect(body(applyOp(tree, { kind: 'set-person-fields', id: 'a', fields: { portrait: read } }))).toBe(tree);
	});

	it('edit-house arms: the value parse reads for an unquoted [[x,y.png]] writes nothing', () => {
		const tree = 'houses:\n  - id: v\n    name: V\n    arms: [[x,y.png]]\n';
		const r = parseDynasty(tree);
		if (!r.ok) throw new Error(r.error.code);
		const read = r.tree.houses[0].arms!;
		expect(read).toBe('[[x,y.png]]');
		expect(body(applyOp(tree, { kind: 'edit-house', id: 'v', arms: read }))).toBe(tree);
	});
});
