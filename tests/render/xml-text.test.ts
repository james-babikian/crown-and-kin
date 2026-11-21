import { describe, expect, it } from 'vitest';
import { xmlText } from '../../src/render/saved-picture';

const ch = (c: number) => String.fromCharCode(c);

describe('xmlText', () => {
	it('removes the characters XML 1.0 forbids', () => {
		for (const c of [0, 1, 8, 0x0b, 0x0c, 0x0e, 0x1f, 0xfffe, 0xffff]) expect(xmlText(`a${ch(c)}b`)).toBe('ab');
	});
	it('keeps tab, line feed and carriage return', () => {
		for (const c of [9, 10, 13]) expect(xmlText(`a${ch(c)}b`)).toBe(`a${ch(c)}b`);
	});
	it('keeps U+0020, U+007F, U+0080, U+FFFD, U+FFFD neighbours and a surrogate pair', () => {
		for (const c of [0x20, 0x7f, 0x80, 0xfffd]) expect(xmlText(`a${ch(c)}b`)).toBe(`a${ch(c)}b`);
		expect(xmlText('a\u{1F600}b')).toBe('a\u{1F600}b');
	});
});
