import { describe, expect, it } from 'vitest';
import { slugify, uniqueId } from '../src/core/id-gen';

describe('ids', () => {
	it('slugifies names', () => {
		expect(slugify('Aldric Valmont')).toBe('aldric-valmont');
		expect(slugify('Þórr Ísólfsson')).toBe('thorr-isolfsson');
		expect(slugify('李')).toBe('person');
		expect(slugify('1102')).toBe('p-1102');
	});
	it('avoids collisions', () => {
		expect(uniqueId('Aldric', new Set(['aldric', 'aldric-2']))).toBe('aldric-3');
	});
});
