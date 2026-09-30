import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleSources, svgHash } from './acceptance/m11-support';

/*
 * WP 11.0 (spec §13.15 Acceptance: "the spike pictures of sample trees 1 to 15 and the saved pictures do not
 * change (byte-identical)"): the headless picture (light and dark palette) of every sample tree is compared
 * with a sha256 recorded from the head of `milestone-11` before the build (`tests/acceptance/m11-spike-hashes.json`).
 * Unlike the other golden files this one is a recorded regression value: the speed work must not change the
 * headless drawing at all. This test passes now and must keep passing after every M11 package.
 * Run: npx vitest run tests/m11-spike-hashes.test.ts
 */

const RECORDED = JSON.parse(readFileSync('tests/acceptance/m11-spike-hashes.json', 'utf8')) as Record<string, string>;
const SAMPLES = sampleSources();

describe('the headless pictures of the sample trees are byte-identical to the M10 build', () => {
	it('every sample tree 01 to 15 and 07b has a recorded hash', () => {
		expect(SAMPLES.map((s) => s.id).sort()).toEqual(['01', '02', '03', '04', '05', '06', '07', '07b', '08', '09', '10', '11', '12', '13', '14', '15']);
		expect(Object.keys(RECORDED).sort()).toEqual(SAMPLES.map((s) => s.id).sort());
	});

	it.each(SAMPLES.map((s) => [s.id, s.source] as const))('sample tree %s', (id, source) => {
		expect(svgHash(source)).toBe(RECORDED[id]);
	});
});
