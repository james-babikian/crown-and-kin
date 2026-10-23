import { describe, expect, it } from 'vitest';
import type { EditResult, Op } from '../../src/core/edit';
import { linkTargets, matchKey } from '../../src/core/link-rewrite';
import { parseLink, parsePictureLink } from '../../src/core/picture-link';
import { parseDynasty } from '../../src/core/parse';
import { pictureTarget } from '../../src/core/pictures';
import { noteName } from '../../src/core/titles';
import { applyOp } from '../../src/core/yaml-edit';
import { sameValue } from '../../src/core/yaml-patch';

// Unit tests for the M9 core fix round: note and picture keys in `rewrite-links` (C1), link values
// compared with their source text (C2), a bare "!" before a picture path (C3), and control
// characters in `noteName`.

const body = (src: string, op: Op) => {
	const r: EditResult = applyOp(src, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const rewrite = (src: string, map: Record<string, string>) => body(src, { kind: 'rewrite-links', map });
const read = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};

describe('matchKey (C1)', () => {
	it('names the file: a shown picture extension as written, any other target with ".md"', () => {
		expect(matchKey('Pictures\\X.PNG')).toBe('pictures/x.png');
		expect(matchKey('x.png.md')).toBe('x.png.md');
		expect(matchKey('X.PNG.MD')).toBe('x.png.md');
		expect(matchKey('x.png.md.md')).toBe('x.png.md.md');
		expect(matchKey('Old')).toBe('old.md');
		expect(matchKey('Old.md')).toBe('old.md');
		expect(matchKey('Folder/Old.MD')).toBe('folder/old.md');
		// Not a shown picture: a note link, as in `extensionAgrees`.
		expect(matchKey('x.heic')).toBe('x.heic.md');
		expect(matchKey('.png')).toBe('.png.md');
	});

	it('is empty for a value that is not text', () => {
		expect(matchKey(null as unknown as string)).toBe('');
	});
});

describe('rewrite-links keeps notes and pictures with the same stem apart (C1)', () => {
	const TREE = 'people:\n  - id: a\n    name: A\n    link: "[[x.png.md]]"\n    portrait: "[[x.png]]"\n  - id: b\n    name: B\n    link: "[[X.PNG.md]]"\n    portrait: "![[Pics/X.png|B]]"\n';

	it('a note map key changes only the note links', () => {
		const out = rewrite(TREE, { 'X.png.md': 'y' });
		expect(out).toContain('link: "[[y.md]]"');
		expect(out).toContain('portrait: "[[x.png]]"');
		expect(out).toContain('portrait: "![[Pics/X.png|B]]"');
	});

	it('a picture map key changes only the picture links', () => {
		const out = rewrite(TREE, { 'x.png': 'z.png', 'pics/x.png': 'Pics/w.png' });
		expect(out).toContain('portrait: "[[z.png]]"');
		expect(out).toContain('portrait: "![[Pics/w.png|B]]"');
		expect(out).toContain('link: "[[x.png.md]]"');
		expect(out).toContain('link: "[[X.PNG.md]]"');
	});

	it('the undo map (new name back to old) also keeps them apart', () => {
		const after = 'people:\n  - id: a\n    name: A\n    link: "[[z.png.md]]"\n    portrait: "[[z.png]]"\n';
		expect(rewrite(after, { 'z.png': 'x.png' })).toBe(after.replace('portrait: "[[z.png]]"', 'portrait: "[[x.png]]"'));
		expect(rewrite(after, { 'z.png.md': 'x.png' })).toBe(after.replace('link: "[[z.png.md]]"', 'link: "[[x.png.md]]"'));
	});

	it('a note written with and without ".md" still matches either map key', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: "[[Old.md]]"\n  - id: b\n    name: B\n    link: "[[Old]]"\n';
		expect(rewrite(src, { old: 'New' })).toBe(src.replace('[[Old.md]]', '[[New.md]]').replace('[[Old]]', '[[New]]'));
		expect(rewrite(src, { 'Old.md': 'New' })).toBe(src.replace('[[Old.md]]', '[[New.md]]').replace('[[Old]]', '[[New]]'));
	});

	it('the note "x.png.md.md" and the note "x.png.md" do not share a key', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: "[[x.png.md.md]]"\n  - id: b\n    name: B\n    link: "[[x.png.md]]"\n';
		expect(rewrite(src, { 'x.png.md': 'y' })).toBe(src.replace('link: "[[x.png.md]]"', 'link: "[[y.md]]"'));
	});
});

describe('a bare picture value with a leading "!" (C3)', () => {
	it('parsePictureLink puts the "!" in the head; parseLink keeps it in the target', () => {
		expect(parsePictureLink('!Pictures/x.png')).toEqual({ head: '!', target: 'Pictures/x.png', tail: '', kind: 'bare' });
		expect(parsePictureLink('  ! x.png#a ')).toEqual({ head: '  ! ', target: 'x.png', tail: '#a ', kind: 'bare' });
		expect(parsePictureLink('!')).toBeNull();
		expect(parsePictureLink('!#a')).toBeNull();
		expect(parsePictureLink('![[x.png]]')).toEqual(parseLink('![[x.png]]'));
		expect(parseLink('!Pictures/x.png')?.target).toBe('!Pictures/x.png');
	});

	it('pictureTarget reads the path after the "!", and a web address after it', () => {
		expect(pictureTarget(' !x.PNG')).toEqual({ kind: 'vault', path: 'x.PNG', ext: 'png' });
		expect(pictureTarget('!https://example.com/x.png')).toEqual({ kind: 'web' });
		expect(pictureTarget('!//cdn.example.com/x.png')).toEqual({ kind: 'web' });
		expect(pictureTarget('!www.example.com/x.png')).toEqual({ kind: 'web' });
		expect(pictureTarget('!')).toBeNull();
	});

	it('linkTargets and rewrite-links read a picture "!p" as p, and a note link "!p" as written', () => {
		const src = 'houses:\n  - id: v\n    name: V\n    arms: "!Arms/v.png"\npeople:\n  - id: a\n    name: A\n    link: "!Note"\n    portrait: "!Pics/a.png"\n';
		expect(linkTargets(src)).toEqual(['Arms/v.png', '!Note', 'Pics/a.png']);
		const out = rewrite(src, { 'arms/v.png': 'Arms/w.png', 'pics/a.png': 'Pics/b.png', '!note': 'Other' });
		const tree = read(out);
		expect(tree.houses[0].arms).toBe('!Arms/w.png');
		expect(tree.people[0].portrait).toBe('!Pics/b.png');
		expect(tree.people[0].link).toBe('Other');
	});
});

describe('link values compared with their source text (C2)', () => {
	it('sameValue reads an unquoted [[x,y]] as written when the source text is given', () => {
		const raw = [['x', 'y.png']];
		expect(sameValue('portrait', raw, '[[x,y.png]]', () => '[[x,y.png]]')).toBe(true);
		expect(sameValue('portrait', raw, '[[x, y.png]]', () => '[[x,y.png]]')).toBe(false);
		// Without the source text the items are joined with ", " (as before).
		expect(sameValue('link', raw, '[[x, y.png]]')).toBe(true);
		expect(sameValue('link', raw, '[[x,y.png]]')).toBe(false);
	});

	it('set-person-fields link: the value as read writes nothing; a different spacing is written', () => {
		const src = 'people:\n  - id: a\n    name: A\n    link: [[Smith,John]]   # the note\n';
		const link = read(src).people[0].link!;
		expect(link).toBe('[[Smith,John]]');
		expect(body(src, { kind: 'set-person-fields', id: 'a', fields: { link } })).toBe(src);
		const out = body(src, { kind: 'set-person-fields', id: 'a', fields: { link: '[[Smith, John]]' } });
		expect(read(out).people[0].link).toBe('[[Smith, John]]');
	});

	it('edit-house arms: a different spacing from the read value is written', () => {
		const src = 'houses:\n  - id: v\n    name: V\n    arms: [[x,y.png]]\n';
		const out = body(src, { kind: 'edit-house', id: 'v', arms: '[[x, y.png]]' });
		expect(out).toBe('houses:\n  - id: v\n    name: V\n    arms: "[[x, y.png]]"\n');
	});
});

describe('noteName removes control characters', () => {
	it('drops the control characters, and tabs and text line breaks still become spaces', () => {
		expect(noteName('Kings\u0001 of\u0000 the\u001F North\u007F', 'king')).toBe('Kings of the North');
		expect(noteName('A\u0007B', 'x')).toBe('AB');
		expect(noteName('Lords\tof\r\nthe\u000BIsles\u000C', 'x')).toBe('Lords of the Isles');
		expect(noteName('\u0001\u0002', 'duke')).toBe('duke');
	});
});
