/*
 * G2 review of 0.5 step 1a-A (scratch branch, never merged). `readEndedBy` looks the word up in a plain object
 * literal, so a word that names a member of Object.prototype is found there. `readUnionType` uses Object.create(null)
 * (parse.ts UNION_WORDS) for exactly this reason.
 */
import { describe, expect, it } from 'vitest';
import { readEndedBy } from '../../src/core/types';

describe('readEndedBy with words that are Object.prototype members', () => {
	for (const word of ['constructor', 'Constructor', '__proto__']) {
		it(`gives null for "${word}"`, () => {
			expect(readEndedBy(word)).toBeNull();
		});
	}
});
