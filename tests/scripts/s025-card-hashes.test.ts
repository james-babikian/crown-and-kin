/*
 * 0.2.5 WP-B6 (CONTRACT B.5 test 8): golden hashes of the new card drawings. The headless saved picture (`renderSvg`, the same steps as the
 * saved picture) of sample trees 07, 07b, 12 and 15 is hashed (sha256) for four variants and two palettes, 32 keys of the form
 * `<sample>|<variant>|<theme>`:
 *   down-on   top to bottom, the Roundel with the plate and the relation words
 *   down-off  top to bottom, the Roundel, no plate, the "You" tab on the marked person
 *   side-on   sideways, the text card with the plate
 *   side-off  sideways, the text card, no plate, the tab
 * The mark is the first person in document order who has a parent; the font is 16 px, Normal card size, and no picture file is embedded.
 *
 * Why this file is new: the old golden files (`m11-spike-hashes.json` and the other hash tests) draw the classic card and did not change, so B
 * does not touch them. The values here were recorded ONCE, from the merged code, after the rows and the crossing fix of section A and the
 * work packages B1 to B5 had merged, so a failure here is a change of the Roundel or text card drawing. The test name carries the key. If a change is meant, look at
 * the pictures (`npm run spike`, `out/s025-cards/`), then run `npx tsx scripts/s025-record-hashes.ts` and commit the new JSON with the reason.
 * Run: npx vitest run tests/scripts/s025-card-hashes.test.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_HASH_FILE, HASH_SAMPLES, cardHash, cardHashKeys } from '../../scripts/s025-card-hash';

const RECORDED = JSON.parse(readFileSync(CARD_HASH_FILE, 'utf8')) as Record<string, string>;

describe('the headless pictures of the Roundel and the sideways text card are as recorded', () => {
	it('there are 32 keys: 4 sample trees, 4 variants, light and dark', () => {
		expect(HASH_SAMPLES).toEqual(['07', '07b', '12', '15']);
		expect(Object.keys(RECORDED).sort()).toEqual(cardHashKeys().sort());
		expect(cardHashKeys()).toHaveLength(32);
	});

	it.each(cardHashKeys())('picture %s', (key) => {
		expect(cardHash(key), `the picture ${key} changed`).toBe(RECORDED[key]);
	});
});
