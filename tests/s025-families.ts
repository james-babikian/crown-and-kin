// Made-up tree generators for the rows tests (0.2.5, WP-A1): seeded families with generations, remarriages and rumoured
// parents, and the free-form trees and long chains that the design gate used to find faults in the partner step.
// Not a test file: vitest does not run it. Names are made up.

/** A small seeded random number generator (same numbers on every machine). */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
/** Generation-structured random tree: founders, marriages across houses, remarriages, cousin links, rumoured parents. */
export function genTree(seed: number, size = 40): string {
	const rand = rng(seed);
	const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const ppl: { id: string; gen: number; parents: string[] }[] = [];
	const lines: string[] = [];
	const unions: string[] = [];
	const nf = 2 + Math.floor(rand() * 3);
	let n = 0;
	const add = (gen: number, parents: string[], typed?: string[]) => {
		const id = `p${n++}`;
		ppl.push({ id, gen, parents });
		lines.push(`  - {id: ${id}, name: N${id}, sex: ${rand() < 0.5 ? 'm' : 'f'}${(typed ?? parents).length ? `, parents: [${(typed ?? parents).join(', ')}]` : ''}}`);
		return id;
	};
	for (let i = 0; i < nf; i++) add(0, []);
	while (n < size) {
		const r = rand();
		if (r < 0.2) {
			// a new outsider (root), maybe marries a random person
			const o = add(pick(ppl).gen, []);
			if (rand() < 0.6) unions.push(`  - {partners: [${o}, ${pick(ppl.filter((p) => p.id !== o)).id}]}`);
		} else {
			const pool = ppl.filter((p) => p.parents.length || rand() < 0.5); const a = pick(pool.length ? pool : ppl);
			const others = ppl.filter((p) => p.id !== a.id && Math.abs(p.gen - a.gen) <= 1);
			const parents = [a.id];
			if (others.length && rand() < 0.75) parents.push(pick(others).id);
			const typed = parents.map((p, i) => (i === 1 && rand() < 0.07 ? `{id: ${p}, type: rumoured}` : p));
			const gen = Math.max(...parents.map((p) => ppl.find((q) => q.id === p)!.gen)) + 1;
			add(gen, parents, typed);
			if (parents.length === 2 && rand() < 0.7) unions.push(`  - {partners: [${parents[0]}, ${parents[1]}]}`);
		}
		if (rand() < 0.12 && n > 4) {
			const x = pick(ppl), y = pick(ppl);
			if (x.id !== y.id) unions.push(`  - {partners: [${x.id}, ${y.id}]}`);
		}
	}
	return `people:\n${lines.join('\n')}\nunions:\n${unions.join('\n')}\n`;
}


/** Free-form DAG with rumoured links, lone rumoured fathers and many unions. */
export function freeTree(seed: number, n: number): string {
	const rand = rng(seed);
	const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const ids: string[] = [];
	const lines: string[] = [];
	const unions: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = `p${i}`;
		const parents: string[] = [];
		if (i > 1 && rand() < 0.65) {
			const a = pick(ids);
			parents.push(a);
			if (rand() < 0.6) {
				const b = pick(ids.filter((x) => x !== a));
				parents.push(rand() < 0.25 ? `{id: ${b}, type: rumoured}` : b);
			}
		} else if (i > 1 && rand() < 0.1) parents.push(`{id: ${pick(ids)}, type: rumoured}`);
		lines.push(`  - {id: ${id}, name: N${i}, sex: ${rand() < 0.5 ? 'm' : 'f'}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`);
		ids.push(id);
		if (i > 0 && rand() < 0.3) unions.push(`  - {partners: [${id}, p${Math.floor(rand() * i)}]}`);
		if (i > 3 && rand() < 0.1) unions.push(`  - {partners: [p${Math.floor(rand() * i)}, p${Math.floor(rand() * i)}]}`);
	}
	return `people:\n${lines.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}


/** Two long lines of descent a0..an and b0..bn; a_i marries b_(i+1) for odd i and b_(i-1) for even i: half the tries conflict. */
export function chains(n: number): string {
	const lines: string[] = [];
	const unions: string[] = [];
	for (let i = 0; i < n; i++) {
		lines.push(`  - {id: a${i}, name: A${i}${i ? `, parents: [a${i - 1}]` : ''}}`);
		lines.push(`  - {id: b${i}, name: B${i}${i ? `, parents: [b${i - 1}]` : ''}}`);
	}
	for (let i = 1; i < n - 1; i++) unions.push(`  - {partners: [a${i}, b${i % 2 ? i + 1 : i - 1}]}`);
	return `people:\n${lines.join('\n')}\nunions:\n${unions.join('\n')}\n`;
}

/** Free-form DAG: parents from any earlier person, many unions between any two people, rumoured links, no sexes. */
export function freeFormTree(seed: number, n: number): string {
	const rand = rng(seed);
	const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const ppl: string[] = [];
	const lines: string[] = [];
	const unions: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = `p${i}`;
		const parents: string[] = [];
		if (i > 1 && rand() < 0.65) {
			const a = pick(ppl);
			parents.push(a);
			if (rand() < 0.6) {
				const b = pick(ppl.filter((x) => x !== a));
				parents.push(rand() < 0.1 ? `{id: ${b}, type: rumoured}` : b);
			}
		} else if (i > 1 && rand() < 0.1) parents.push(`{id: ${pick(ppl)}, type: rumoured}`);
		lines.push(`  - {id: ${id}, name: N${i}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`);
		ppl.push(id);
		if (i > 0 && rand() < 0.35) unions.push(`  - {partners: [${id}, p${Math.floor(rand() * i)}]}`);
		if (i > 3 && rand() < 0.15) unions.push(`  - {partners: [p${Math.floor(rand() * i)}, p${Math.floor(rand() * i)}]}`);
	}
	return `people:\n${lines.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}
