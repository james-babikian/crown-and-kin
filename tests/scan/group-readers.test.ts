// Scan test `group-readers` (contract "Three own lines" §4.3, D365 (2)): every `src` file that reads `wardPairs` also reads `parentGroups`. A
// child of three or more parents of one kind stands in no union and no ward pair, so a reader of the children of a person (a union, a one-parent
// family or a ward pair) must name the groups too, or it forgets those children. A file may leave the groups out only when it is in the allow-list
// below with its reason; each allow-listed file in `src/core` that works on seats must import `group-seats`.
import { describe, expect, it } from 'vitest';
import { codeOf, exists, read, tsFiles } from '../support/scan';

/** The files that read `wardPairs` and not `parentGroups`, each with its reason. */
const ALLOWED: Readonly<Record<string, string>> = {
	'src/core/ward-unions.ts': 'builds the private unions of ward pairs only; the groups are seated by group-seats.ts',
	'src/layout/ward-graph.ts': 'lays out the ward pairs only; a tree with groups reaches them through group-graph.ts, which wraps it',
};

/** The files of `files` (path to code) that read `wardPairs` and not `parentGroups` and are not allowed. */
export function unreadGroups(files: Readonly<Record<string, string>>, allowed: Readonly<Record<string, string>> = ALLOWED): string[] {
	return Object.entries(files)
		.filter(([path, code]) => /\bwardPairs\b/.test(code) && !/\bparentGroups\b/.test(code) && !(path in allowed))
		.map(([path]) => path)
		.sort();
}

describe('the scan finds what it should (self-test)', () => {
	it('finds a file that reads wardPairs and not parentGroups', () => {
		expect(unreadGroups({ 'src/core/a.ts': 'for (const w of g.wardPairs) use(w);' })).toEqual(['src/core/a.ts']);
	});

	it('passes a file that names both, a file that names neither, and an allowed file', () => {
		expect(unreadGroups({ 'src/core/a.ts': 'g.wardPairs; g.parentGroups;', 'src/core/b.ts': 'g.unions', 'src/core/ward-unions.ts': 'g.wardPairs' })).toEqual([]);
	});

	it('does not count a word in a comment or a string', () => {
		expect(unreadGroups({ 'src/core/a.ts': codeOf("// wardPairs\nconst s = 'wardPairs';") })).toEqual([]);
	});
});

describe('every reader of the ward pairs also reads the groups', () => {
	const files = Object.fromEntries(tsFiles('src').map((path) => [path, codeOf(read(path))]));

	it('has no file that forgets the groups', () => {
		expect(unreadGroups(files)).toEqual([]);
	});

	it('lists only files that exist and that still read wardPairs', () => {
		for (const path of Object.keys(ALLOWED)) {
			expect(exists(path), path).toBe(true);
			expect(/\bwardPairs\b/.test(files[path]), path).toBe(true);
		}
	});

	it('walk and rows reach the groups through group-seats', () => {
		for (const path of ['src/core/generations.ts', 'src/core/order.ts']) expect(/from '\.\/group-seats'/.test(read(path)), path).toBe(true);
	});

	it('the layout reaches the groups through group-graph once that file exists', () => {
		if (!exists('src/layout/group-graph.ts')) return;
		expect(/from '\.\/group-graph'/.test(read('src/layout/pipeline.ts'))).toBe(true);
	});
});
