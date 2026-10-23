/*
 * Helpers of the 0.2.8 adversarial tests (agent beta): a seeded random generator, a generator of trees with
 * dates and odd texts, and a generator of titles over the whole key vocabulary of spec §13.21 rule 1.
 * Used by an internal test and `r028-adv-phone-list.test.ts`. Pure text in, text out.
 */

import { rng } from './rng';
export { rng };

/** Picks from a list. */
export const pick = <T>(rand: () => number, a: readonly T[]): T => a[Math.floor(rand() * a.length)];

/** One person of a generated tree, before it is written. */
export interface GenPerson {
	id: string;
	name: string;
	sex?: string;
	born?: string;
	died?: string;
	illegitimate?: boolean;
	childless?: boolean;
	sobriquet?: string;
	/** The `placement` key: the parent type that places the person. */
	placement?: string;
	parents: { id: string; type?: string }[];
}

/** Date texts for `born`: plain numbers dominate, with the odd forms of the brief. */
export function bornText(rand: () => number, year: number): string | undefined {
	const r = rand();
	if (r < 0.62) return String(year);
	if (r < 0.7) return `c. ${year}`;
	if (r < 0.75) return `12 May ${year}`;
	if (r < 0.78) return `${year}-05-12`;
	if (r < 0.8) return year < 0 ? String(year) : `${-year}`;
	if (r < 0.83) return `${Math.abs(year)} BC`;
	if (r < 0.85) return '?';
	if (r < 0.86) return 'yes';
	if (r < 0.88) return String(year * 10 + 12000);
	if (r < 0.9) return 'long ago';
	if (r < 0.93) return `${year} AD`;
	return undefined;
}

/** Date texts for `died`. */
export function diedText(rand: () => number, year: number): string | undefined {
	const r = rand();
	if (r < 0.4) return String(year);
	if (r < 0.5) return `c. ${year}`;
	if (r < 0.54) return 'alive';
	if (r < 0.56) return 'living';
	if (r < 0.58) return 'no';
	if (r < 0.6) return 'false';
	if (r < 0.62) return 'never';
	if (r < 0.65) return 'unknown';
	if (r < 0.67) return '"?"';
	if (r < 0.7) return 'yes';
	if (r < 0.72) return 'dead';
	if (r < 0.74) return 'long ago';
	if (r < 0.76) return `${Math.abs(year)} BC`;
	return undefined;
}

export interface GenOptions {
	/** Number of people. */
	n: number;
	/** Probability that a person has two parents. */
	twoParents?: number;
	/** Parent types: weights of adoptive, ward, rumoured and unknown. Default small. */
	oddParents?: boolean;
	/** Write `born` and `died` texts. */
	dates?: boolean;
	/** Odd `sex` values (`male`, `x`, none). */
	oddSex?: boolean;
	/** Odd names (a sobriquet, curly marks, long). */
	names?: 'plain' | 'odd';
	/** Allow a parent cycle or a self-parent. */
	cycles?: boolean;
}

/** A random tree as people; parents are earlier people, so there is no cycle unless `cycles`. */
export function genPeople(rand: () => number, o: GenOptions): GenPerson[] {
	const people: GenPerson[] = [];
	const base = 1000;
	const gen: number[] = [];
	for (let i = 0; i < o.n; i++) {
		const id = `p${i}`;
		const parents: GenPerson['parents'] = [];
		let g = 0;
		if (i > 0 && rand() < 0.9) {
			const k = rand() < (o.twoParents ?? 0.5) ? 2 : 1;
			for (let j = 0; j < k; j++) {
				// Recent people are more often parents, so the tree is deep, not a bush.
				const back = Math.min(i, 1 + Math.floor(rand() * rand() * 12));
				const pid = `p${i - back}`;
				if (parents.some((p) => p.id === pid)) continue;
				const rr = rand();
				const type = !o.oddParents ? undefined : rr < 0.06 ? 'adoptive' : rr < 0.1 ? 'ward' : rr < 0.15 ? 'rumoured' : rr < 0.17 ? 'foster' : undefined;
				parents.push(type ? { id: pid, type } : { id: pid });
				g = Math.max(g, gen[i - back] + 1);
			}
		}
		if (o.cycles && i > 2 && rand() < 0.04) parents.push({ id: rand() < 0.5 ? id : `p${i + 1}` });
		gen.push(g);
		const year = base + g * 25 + Math.floor(rand() * 14);
		const sr = rand();
		const sex = !o.oddSex ? (sr < 0.5 ? 'm' : 'f') : sr < 0.42 ? 'm' : sr < 0.84 ? 'f' : sr < 0.88 ? 'x' : sr < 0.9 ? 'male' : sr < 0.92 ? 'Female' : undefined;
		const p: GenPerson = { id, name: personName(rand, i, o.names ?? 'plain'), parents };
		if (sex) p.sex = sex;
		if (o.dates) {
			const b = bornText(rand, year);
			if (b !== undefined) p.born = b;
			const d = diedText(rand, year + 20 + Math.floor(rand() * 50));
			if (d !== undefined) p.died = d;
		}
		if (rand() < 0.1) p.illegitimate = true;
		if (rand() < 0.04) p.childless = true;
		if (o.names === 'odd' && rand() < 0.2) p.sobriquet = pick(rand, ['the Bold', 'the Elder', '“the Wise”', 'Lackland']);
		people.push(p);
	}
	return people;
}

const NAMES = ['Aldric', 'Isolde', 'Roderick', 'Wren', 'Gareth', 'Mira', 'Tomas', 'Beatrice', 'Hugo', 'Edith'];
function personName(rand: () => number, i: number, kind: 'plain' | 'odd'): string {
	if (kind === 'plain') return `${NAMES[i % NAMES.length]} ${i}`;
	const odd = ['Ælfric', 'محمد', 'דוד', '李小龍', 'Ёлка', 'Σωκράτης', 'Zoë 😀', 'Ann: B', '[[Link]]', '#hash', "O'Neil", '"Quoted"', 'a'.repeat(60), 'Very Long Name '.repeat(8)];
	return rand() < 0.5 ? pick(rand, odd) : `${NAMES[i % NAMES.length]} ${i}`;
}

/** Quote a scalar so that plain YAML reads it back as the same text. */
export function q(s: string): string {
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Writes people as flow maps, one in each line of a `people` list. */
export function peopleYaml(people: GenPerson[]): string {
	const lines = people.map((p) => {
		const f: string[] = [`id: ${p.id}`, `name: ${q(p.name)}`];
		if (p.sobriquet) f.push(`sobriquet: ${q(p.sobriquet)}`);
		if (p.sex) f.push(`sex: ${q(p.sex)}`);
		if (p.born !== undefined) f.push(`born: ${p.born.startsWith('"') ? p.born : q(p.born)}`);
		if (p.died !== undefined) f.push(`died: ${p.died.startsWith('"') ? p.died : q(p.died)}`);
		if (p.illegitimate) f.push('illegitimate: true');
		if (p.childless) f.push('childless: true');
		if (p.placement) f.push(`placement: ${p.placement}`);
		if (p.parents.length) f.push(`parents: [${p.parents.map((x) => (x.type ? `{id: ${x.id}, type: ${x.type}}` : x.id)).join(', ')}]`);
		return `  - {${f.join(', ')}}`;
	});
	return `people:\n${lines.join('\n')}\n`;
}

/** The title keys with their random values. `ids` are the person ids a holder or a list can name. */
export function titleYaml(rand: () => number, ids: readonly string[], opts: { id?: string; full?: boolean } = {}): string {
	const out: string[] = [`  - id: ${opts.id ?? 't1'}`, '    name: Throne'];
	const P = () => pick(rand, ids);
	const maybe = (p: number) => opts.full || rand() < p;
	if (maybe(0.85)) out.push(`    succession: ${pick(rand, ['eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative', 'born-in-reign', 'primogeniture', 'ultimogeniture', 'seniority', 'proximity', 'porphyrogeniture', rand() < 0.1 ? 'banana' : 'eldest-child'])}`);
	if (maybe(0.7)) out.push(`    inherit: ${pick(rand, ['men-only', 'men-first-in-house', 'men-first', 'no-preference', 'women-first', 'women-first-in-house', 'women-only', 'male-only', 'semi-salic', 'female-preference', 'none'])}`);
	if (maybe(0.25)) out.push(`    inherit-through: ${pick(rand, ['men', 'women', 'anyone', 'male', 'female', 'any'])}`);
	if (maybe(0.3)) out.push(`    inherit-illegitimate: ${pick(rand, ['no', 'after', 'equal', 'true', 'yes', 'false'])}`);
	if (maybe(0.3)) out.push(`    inherit-adopted: ${pick(rand, ['true', 'false', 'yes', 'maybe'])}`);
	if (maybe(0.2)) out.push(`    heirs-of-body: ${pick(rand, ['true', 'false', 'yes'])}`);
	if (maybe(0.25)) out.push(`    year: ${pick(rand, ['1100', '1150', 'c. 1203', '-200', '200 BC', '12000', 'later', '1,250', 'AD 900', String(1000 + Math.floor(rand() * 300))])}`);
	if (maybe(0.2)) out.push(rand() < 0.5 ? `    heir: ${rand() < 0.1 ? 'nobody' : P()}` : `    heir: [${[P(), P(), rand() < 0.1 ? 'ghost' : P()].join(', ')}]`);
	if (maybe(0.2)) out.push(rand() < 0.5 ? `    exclude: ${P()}` : `    exclude: [${[P(), P()].join(', ')}]`);
	out.push('    holders:');
	const nh = 1 + Math.floor(rand() * 3);
	let y = 1100 + Math.floor(rand() * 60);
	for (let j = 0; j < nh; j++) {
		const f: string[] = [];
		const r = rand();
		if (r < 0.85) f.push(`person: ${P()}`);
		else if (r < 0.95) f.push('name: Old King');
		else f.push('person: nobody');
		if (rand() < 0.85) f.push(`from: ${pick(rand, [String(y), `c. ${y}`, `"${y} BC"`, '?'])}`);
		if (j < nh - 1 ? rand() < 0.9 : rand() < 0.3) f.push(`to: ${pick(rand, [String(y + 15), 'present', `c. ${y + 15}`, 'now'])}`);
		out.push(`      - {${f.join(', ')}}`);
		y += 15 + Math.floor(rand() * 10);
	}
	return `titles:\n${out.join('\n')}\n`;
}
