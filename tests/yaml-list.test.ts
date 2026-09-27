import { describe, expect, it } from 'vitest';
import { itemEnd, itemStart, removeFromSection, section } from '../src/core/yaml-list';
import { isRefusal, parse } from '../src/core/yaml-patch';

function parsed(text: string) {
	const p = parse(text);
	if (isRefusal(p)) throw new Error('parse');
	return p;
}

describe('yaml-list: the lines a list item owns', () => {
	const text = ['people:', '  # above a', '  - id: a', '    # below a', '  # above b', '  - id: b', ''].join('\n');

	it('an item ends after the deeper comments below it, and starts at the comments directly above it', () => {
		const p = parsed(text);
		const s = section(p, 'people')!;
		expect(text.slice(itemStart(p.src, s.seq, 0), itemEnd(p.src, s.seq, 0))).toBe('  # above a\n  - id: a\n    # below a');
		expect(text.slice(itemStart(p.src, s.seq, 1), itemEnd(p.src, s.seq, 1))).toBe('  # above b\n  - id: b');
	});

	it('section finds only a list, and removing every item removes the key', () => {
		const p = parsed('people:\n  - id: a\nunions: x\n');
		expect(section(p, 'unions')).toBeNull();
		expect(removeFromSection(p, 'people', new Set([0]))).toHaveLength(1);
		expect(removeFromSection(p, 'unions', new Set([0]))).toEqual([]);
	});
});
