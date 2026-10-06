// 0.2.5 WP-B6: the keys and the hash function of the golden pictures of the Roundel and the sideways text card. The test
// `tests/s025-card-hashes.test.ts` and the recorder `scripts/s025-record-hashes.ts` both use it, so a key means one picture everywhere.
import { createHash } from 'node:crypto';
import { allFixtures } from '../tests/acceptance/load';
import { CARD_THEMES, CARD_VARIANTS, drawCard, type CardTheme, type CardVariant } from './s025-card-draw';

/** The samples that have golden pictures: the large trees, the relations tree and the long-names tree. */
export const HASH_SAMPLES = ['07', '07b', '12', '15'] as const;

/** Where the recorded hashes live. */
export const CARD_HASH_FILE = 'tests/acceptance/s025-card-hashes.json';

/** All 32 keys, `<sample>|<variant>|<theme>`, in a fixed order. */
export function cardHashKeys(): string[] {
	return HASH_SAMPLES.flatMap((s) => CARD_VARIANTS.flatMap((v) => CARD_THEMES.map((t) => `${s}|${v}|${t}`)));
}

/** The sha256 of the headless saved picture named by `key` (16 px, Normal size, no embedded picture file). */
export function cardHash(key: string): string {
	const [sample, variant, theme] = key.split('|');
	const source = allFixtures().find((f) => f.id === sample)?.source;
	if (source === undefined) throw new Error(`no sample tree ${sample} (key ${key})`);
	const drawn = drawCard(source, { variant: variant as CardVariant, theme: theme as CardTheme });
	if (!drawn) throw new Error(`sample tree ${sample} does not parse (key ${key})`);
	return createHash('sha256').update(drawn.svg).digest('hex');
}
