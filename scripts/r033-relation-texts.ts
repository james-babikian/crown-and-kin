// 0.3.3 B6: writes `tests/acceptance/r033-relation-texts.json`, the card relation texts for generations 0 to 12 (8 296 texts since 0.5: with "former" and the possessive forms that the years leave, from the real
// `computeRelations`). The test `tests/obsidian/r033-relation-fit.test.ts` checks the short forms over this list, and checks that a smaller universe,
// made again from the code, is part of it. Run it only if `src/core/relations.ts` changes a name: `npx tsx scripts/r033-relation-texts.ts`.
import { writeFileSync } from 'node:fs';
import { relationUniverse } from '../tests/support/r033-relation-universe';

const FILE = 'tests/acceptance/r033-relation-texts.json';
const texts = relationUniverse(12).sort();
writeFileSync(FILE, '[\n' + texts.map((t) => '\t' + JSON.stringify(t)).join(',\n') + '\n]\n');
console.log(`${texts.length} texts written to ${FILE}`);
