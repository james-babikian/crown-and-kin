// 0.2.5 WP-B6: writes `tests/acceptance/s025-card-hashes.json`, the golden hashes of the Roundel and the sideways text card
// (see `tests/scripts/s025-card-hashes.test.ts`). Run it only when a change of the card drawing is meant:
// `npx tsx scripts/s025-record-hashes.ts`, then look at the new pictures with `npm run spike` before you commit the file.
import { writeFileSync } from 'node:fs';
import { CARD_HASH_FILE, cardHash, cardHashKeys } from './s025-card-hash';

const out: Record<string, string> = {};
for (const key of cardHashKeys()) out[key] = cardHash(key);
writeFileSync(CARD_HASH_FILE, JSON.stringify(out, null, '\t') + '\n');
console.log(`${Object.keys(out).length} hashes written to ${CARD_HASH_FILE}`);
