import { describe, expect, it } from 'vitest';
import { buildPictureTree, comparePictureNames, searchRows } from '../src/core/picture-list';

function make(n: number) {
	const files = Array.from({ length: n }, (_, i) => {
		const name = `Picture ${(i * 7919) % n} final.png`;
		return { path: `Folder ${i % 200}/${name}`, name, extension: 'png' };
	});
	return buildPictureTree(files, () => true);
}

describe('picture search (M11 fix round, A2)', () => {
	it('returns the same rows in the same order as a full sort', () => {
		const tree = make(500);
		const expected = [...tree.entries.values()]
			.filter((e) => e.file.path.toLowerCase().includes('png'))
			.sort((a, b) => comparePictureNames(a.file.name, b.file.name) || (a.file.path < b.file.path ? -1 : 1));
		const { rows, more } = searchRows(tree, 'png', null, 50);
		expect(more).toBe(true);
		expect(rows.slice(1).map((r) => (r.kind === 'picture' ? r.entry.file.path : ''))).toEqual(expected.slice(0, 50).map((e) => e.file.path));
	});

	it('sets more only when a further match exists', () => {
		const tree = make(10);
		expect(searchRows(tree, 'png', null, 10).more).toBe(false);
		expect(searchRows(tree, 'png', null, 9).more).toBe(true);
		expect(searchRows(tree, 'zzz', null, 9).rows).toHaveLength(1);
	});

	it('searches 30 000 pictures in under 150 ms', () => {
		const tree = make(30000);
		const t = performance.now();
		searchRows(tree, 'png', null);
		expect(performance.now() - t).toBeLessThan(150);
	});
});
