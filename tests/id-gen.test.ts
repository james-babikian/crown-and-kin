import { describe, expect, it } from 'vitest';
import { newIdIn, slugify, uniqueId } from '../src/core/id-gen';

describe('ids', () => {
	it('slugifies names', () => {
		expect(slugify('Aldric Valmont')).toBe('aldric-valmont');
		expect(slugify('Þórr Ísólfsson')).toBe('thorr-isolfsson');
		expect(slugify('李')).toBe('person');
		expect(slugify('1102')).toBe('p-1102');
	});
	it('maps Latin letters that NFKD does not split', () => {
		expect(slugify('ŁUKASZ Władysław')).toBe('lukasz-wladyslaw');
		expect(slugify('Đorđe')).toBe('dorde');
		expect(slugify('Œdipe Cœur')).toBe('oedipe-coeur');
		expect(slugify('Ħal Għargħur')).toBe('hal-gharghur');
		expect(slugify('Kırıkkale')).toBe('kirikkale');
	});
	it('avoids collisions', () => {
		expect(uniqueId('Aldric', new Set(['aldric', 'aldric-2']))).toBe('aldric-3');
	});
});

describe('newIdIn', () => {
	it('avoids the ids of the items in the list, whatever else the list holds', () => {
		expect(newIdIn([{ id: 'a' }, { id: 'a-2' }, null, 'a-3', { name: 'x' }], 'A')).toBe('a-3');
		expect(newIdIn([{ id: 7 }], '7')).toBe('p-7');
		expect(newIdIn(undefined, 'Hal Ashford')).toBe('hal-ashford');
		expect(newIdIn({ id: 'hal-ashford' }, 'Hal Ashford')).toBe('hal-ashford');
	});
});
