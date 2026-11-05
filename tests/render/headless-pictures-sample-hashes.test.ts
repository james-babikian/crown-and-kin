import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sampleSources, svgHash } from '../acceptance/picture-list-support';

/*
 * WP 11.0 (spec §13.15 Acceptance: "the spike pictures of sample trees 1 to 15 and the saved pictures do not
 * change (byte-identical)"): the headless picture (light and dark palette) of every sample tree is compared
 * with a sha256 recorded from the head of `milestone-11` before the build (`tests/acceptance/headless-sample-hashes.json`).
 * Unlike the other golden files this one is a recorded regression value: the speed work must not change the
 * headless drawing at all. This test passes now and must keep passing after every M11 package.
 * 0.5.2 (D330 O-01, O-03, TR-05): all 20 hashes were recorded again, once (one card edge, no foot hairline, the new line widths and dashes); the layout is as before.
 * 0.3 (D231, WP-Q): the hashes of 15 of the 17 trees were recorded again, once, because the added step of the placement moves cards (the trees 04 and 10 are as before).
 * 0.4 (the release plan T10): the sample trees 17 (same-sex couples), 18 (names in many scripts) and 19 (right-to-left names) are new; their hashes were recorded once, from the build at the start of 0.4 (the headless approximate measure, so a CJK or Thai name is drawn too narrow there; the real measure is in tests/obsidian/saved-picture-narrow-script-names.test.ts). 0.4 (fault RTL-1): the hash of tree 19 was recorded again, because an Arabic or Hebrew name line now has a bidi isolate (U+2068 and U+2069) round it; trees 01 to 18 are as before.
 * 0.5.2 (D322): the hash of tree 19 was recorded again, once, because a card name in the right-to-left scripts is now written with an embedding (U+202A to U+202C) instead of an isolate: WebKit honours the embedding in an SVG text. Trees 01 to 18 are as before.
 * Run: npx vitest run tests/render/headless-pictures-sample-hashes.test.ts
 */

const RECORDED = JSON.parse(readFileSync('tests/acceptance/headless-sample-hashes.json', 'utf8')) as Record<string, string>;
const SAMPLES = sampleSources();

describe('the headless pictures of the sample trees are byte-identical to the recorded build', () => {
	it('every sample tree 01 to 19 and 07b has a recorded hash', () => {
		// Tree 16 (version 0.2.7) has the hash of the 0.2.6 build: the succession keys draw nothing.
		expect(SAMPLES.map((s) => s.id).sort()).toEqual(['01', '02', '03', '04', '05', '06', '07', '07b', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19']);
		expect(Object.keys(RECORDED).sort()).toEqual(SAMPLES.map((s) => s.id).sort());
	});

	it.each(SAMPLES.map((s) => [s.id, s.source] as const))('sample tree %s', (id, source) => {
		expect(svgHash(source)).toBe(RECORDED[id]);
	});
});
