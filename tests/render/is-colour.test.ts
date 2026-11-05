import { afterEach, describe, expect, it, vi } from 'vitest';
import { isColour } from '../../src/render/colour-check';

afterEach(() => vi.unstubAllGlobals());

describe('isColour', () => {
	it('uses CSS.supports when it exists', () => {
		vi.stubGlobal('CSS', { supports: (_p: string, v: string) => v === 'teal' });
		expect(isColour('teal')).toBe(true);
		expect(isColour('#123456')).toBe(false);
		expect(isColour('')).toBe(false);
		expect(isColour(undefined)).toBe(false);
		expect(isColour(null)).toBe(false);
	});

	it('falls back to #rrggbb when CSS.supports throws or is missing', () => {
		vi.stubGlobal('CSS', { supports: () => { throw new Error('no'); } });
		expect(isColour('#a1b2c3')).toBe(true);
		expect(isColour('teal')).toBe(false);
		vi.stubGlobal('CSS', undefined);
		expect(isColour('#A1B2C3')).toBe(true);
		expect(isColour('#abc')).toBe(false);
	});
});
