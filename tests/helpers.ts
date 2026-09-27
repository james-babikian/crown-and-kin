import { readFileSync, readdirSync } from 'node:fs';
import { deriveFamilies } from '../src/core/derive';
import { computeGenerations } from '../src/core/generations';
import { computeModelOrder } from '../src/core/order';
import { parseDynasty } from '../src/core/parse';

export function fixture(prefix: string): string {
	const file = readdirSync('fixtures').find((f) => f.startsWith(prefix))!;
	const md = readFileSync(`fixtures/${file}`, 'utf8');
	return md.match(/^```dynasty\r?\n([\s\S]*?)^```/m)![1];
}

export function build(source: string) {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.detail ?? ''}`);
	const g = deriveFamilies(parsed.tree);
	const gen = computeGenerations(g);
	const order = computeModelOrder(g, gen);
	return { tree: parsed.tree, g, gen, order };
}
