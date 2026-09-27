import { describe, expect, it } from 'vitest';
import { dedent, normBody, relocate, relocateAll, sameBody, smallestChange, undoBlock } from '../src/core/block-match';

describe('normBody and sameBody', () => {
	it('ignores line endings, trailing spaces and trailing blank lines', () => {
		expect(normBody('a: 1  \r\nb: 2\r\n\r\n')).toBe('a: 1\nb: 2');
		expect(sameBody('a: 1\r\nb: 2\n', 'a: 1\nb: 2')).toBe(true);
	});

	it('ignores an indentation that every line shares (a list item in Live Preview)', () => {
		expect(sameBody('  people:\n    - id: a\n\n  unions: []', 'people:\n  - id: a\n\nunions: []')).toBe(true);
	});

	it('does not ignore a different indentation inside the body', () => {
		expect(sameBody('a:\n  b: 1', 'a:\nb: 1')).toBe(false);
		expect(sameBody('name: A', 'name: B')).toBe(false);
	});

	it('dedent keeps blank lines and a body with no shared indentation', () => {
		expect(dedent('  a\n\n    b')).toBe('a\n\n  b');
		expect(dedent('a\n  b')).toBe('a\n  b');
		expect(dedent('\ta\n\tb')).toBe('a\nb');
	});
});

describe('smallestChange', () => {
	it('replaces only the span that differs', () => {
		expect(smallestChange('born: 1158\n', 'born: 1159\n')).toEqual({ from: 9, to: 10, text: '9' });
		expect(smallestChange('abc', 'abc')).toEqual({ from: 3, to: 3, text: '' });
		expect(smallestChange('', 'x')).toEqual({ from: 0, to: 0, text: 'x' });
	});

	it('never splits a surrogate pair', () => {
		const c = smallestChange('a😀b', 'a😁b');
		expect(c.text).toBe('😁');
		expect('a😀b'.slice(0, c.from) + c.text + 'a😀b'.slice(c.to)).toBe('a😁b');
	});

	it('always turns a into b', () => {
		const alphabet = ['a', 'b', '\r\n', '\n', '😀', '😁', ' '];
		let seed = 11;
		const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
		const str = () => Array.from({ length: Math.floor(rnd() * 8) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
		for (let i = 0; i < 5000; i++) {
			const a = str();
			const b = str();
			const c = smallestChange(a, b);
			expect(a.slice(0, c.from) + c.text + a.slice(c.to)).toBe(b);
		}
	});
});

describe('relocate: finding a handle\'s block after the note changed', () => {
	const A = 'A';
	const B = 'B';

	it('same number of blocks: the ordinal stays, even if the text changed', () => {
		expect(relocate(['X', B], 2, 0, A)).toEqual({ kind: 'keep', ordinal: 0 });
	});

	it('same number of blocks, the block unchanged: it stays', () => {
		expect(relocate([A, A], 2, 1, A)).toEqual({ kind: 'keep', ordinal: 1 });
	});

	it('same number of blocks, swapped: each handle follows its own block', () => {
		expect(relocateAll([B, A], [
			{ count: 2, ordinal: 0, body: A },
			{ count: 2, ordinal: 1, body: B },
		])).toEqual([
			{ kind: 'moved', ordinal: 1 },
			{ kind: 'moved', ordinal: 0 },
		]);
	});

	it('same number of blocks, edited in place and its old text now in two other blocks: the ordinal stays', () => {
		expect(relocate(['X', A, A], 3, 0, A)).toEqual({ kind: 'keep', ordinal: 0 });
	});

	it('a block inserted above: the unique equal body is the block', () => {
		expect(relocate([B, A], 1, 0, A)).toEqual({ kind: 'moved', ordinal: 1 });
	});

	it('a block deleted above: the unique equal body is the block', () => {
		expect(relocate([A], 2, 1, A)).toEqual({ kind: 'moved', ordinal: 0 });
	});

	it('a copy pasted (two equal bodies): detached', () => {
		expect(relocate([A, A], 1, 0, A)).toEqual({ kind: 'detached' });
	});

	it('the count changed and the body is gone: detached', () => {
		expect(relocate([B], 2, 0, A)).toEqual({ kind: 'detached' });
	});

	it('the same count but the ordinal is past the end cannot happen; the note has no blocks: detached', () => {
		expect(relocate([], 0, 0, A)).toEqual({ kind: 'detached' });
	});

	it('two handles that land on one block are both detached', () => {
		const rel = relocateAll([A, B], [
			{ count: 3, ordinal: 0, body: A },
			{ count: 3, ordinal: 2, body: A },
			{ count: 3, ordinal: 1, body: B },
		]);
		expect(rel).toEqual([{ kind: 'detached' }, { kind: 'detached' }, { kind: 'keep', ordinal: 1 }]);
	});
});

describe('undoBlock', () => {
	const last = (b: string) => b === 'W';
	it('exactly one block equals the last write: that block', () => {
		expect(undoBlock(['X', 'W'], last)).toBe(1);
	});
	it('none or several: null (undo refuses)', () => {
		expect(undoBlock(['X'], last)).toBeNull();
		expect(undoBlock(['W', 'W'], last)).toBeNull();
	});
});
