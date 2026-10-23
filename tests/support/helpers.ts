import { readFileSync, readdirSync } from 'node:fs';
import { deriveFamilies } from '../../src/core/derive';
import { computeGenerations } from '../../src/core/generations';
import { computeModelOrder } from '../../src/core/order';
import { nextPersonId } from '../../src/core/id-gen';
import { parseBody, parseDynasty, referencedIds } from '../../src/core/parse';
import { isMap as isRawMap } from '../../src/core/tolerate';

export function fixture(prefix: string): string {
	const file = readdirSync('fixtures').find((f) => f.startsWith(prefix + '-'))!;
	const md = readFileSync(`fixtures/${file}`, 'utf8');
	return md.match(/^```kin\r?\n([\s\S]*?)^```/m)![1];
}

export function build(source: string) {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.detail ?? ''}`);
	const g = deriveFamilies(parsed.tree);
	const gen = computeGenerations(g);
	const order = computeModelOrder(g, gen);
	return { tree: parsed.tree, g, gen, order };
}

/** The id the next new person gets (D104, §13.17 rule 1): `nextPersonId` over every id and every reference to a person in the block. */
export function nextIdFor(body: string): string {
	const parsed = parseBody(body);
	return nextPersonId(parsed.ok && isRawMap(parsed.data) ? referencedIds(parsed.data) : new Set<string>());
}
