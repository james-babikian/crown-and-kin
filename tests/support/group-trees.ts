// Tree generators for the layout tests of "three own lines" (contract C, spec §0 D365 (2)-(4)): a child with three or more parents of one kind and
// no couple among them (a "group"). Data and generators only: nothing here reads the core step that builds the group, so a test can run it on
// any tree. `randomTree` and `denseTree` (an internal script) stay as they are, so every seed named in the build stays valid.
// A group is built so that no two of its parents are a couple: no listed union names the pair, and no other child has exactly those two as its only birth parents.
import { rng } from './rng';

export type GroupKind = 'birth' | 'adoptive';

/** One group child of a generated tree: the child and its parents, in note order. */
export interface GroupSpec {
	child: string;
	kind: GroupKind;
	parents: readonly string[];
}

/** What `groupTreeData` returns: the note text and the groups it holds. */
export interface GroupTreeData {
	source: string;
	groups: readonly GroupSpec[];
}

export interface GroupTreeOptions {
	/** How many group children (default 1). Fewer come back when the base tree has no room for more. */
	groups?: number;
	/** Parents in each group (default 3; 4 is the "n = 4" case). */
	size?: number;
	kind?: GroupKind;
	/** The second group and every later one reuses one parent of the group before it. */
	shared?: boolean;
	/** People of the base tree (default 10 to 23, by seed). */
	people?: number;
}

const pairOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** A made-up tree of `people` people with groups added; the same seed and options give the same text. */
export function groupTreeData(seed: number, options: GroupTreeOptions = {}): GroupTreeData {
	const rand = rng(seed * 6007 + 31);
	const want = options.groups ?? 1;
	const size = options.size ?? 3;
	const kind = options.kind ?? 'adoptive';
	const n = options.people ?? 10 + Math.floor(rand() * 14);
	const lines: string[] = [];
	const unions: string[] = [];
	const couples = new Set<string>();
	for (let i = 0; i < n; i++) {
		const parents: string[] = [];
		if (i > 1 && rand() < 0.7) {
			const first = Math.floor(rand() * i);
			parents.push(`p${first}`);
			if (rand() < 0.7) {
				const second = (first + 1 + Math.floor(rand() * (i - 1))) % i;
				parents.push(`p${second}`);
				couples.add(pairOf(parents[0], parents[1]));
			}
		}
		lines.push(`  - {id: p${i}, name: P${i}, sex: ${rand() < 0.5 ? 'm' : 'f'}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`);
		if (i > 0 && rand() < 0.4) {
			const other = Math.floor(rand() * i);
			unions.push(`  - {partners: [p${i}, p${other}]}`);
			couples.add(pairOf(`p${i}`, `p${other}`));
		}
	}
	const groups: GroupSpec[] = [];
	let carried: string | undefined;
	for (let k = 0; k < want; k++) {
		let chosen: string[] | undefined;
		for (let attempt = 0; attempt < 200 && !chosen; attempt++) {
			const pick: string[] = options.shared && carried !== undefined ? [carried] : [];
			while (pick.length < size) {
				const id = `p${Math.floor(rand() * n)}`;
				if (!pick.includes(id)) pick.push(id);
			}
			let free = true;
			for (let a = 0; a < pick.length; a++) for (let b = a + 1; b < pick.length; b++) if (couples.has(pairOf(pick[a], pick[b]))) free = false;
			if (free) chosen = pick;
		}
		if (!chosen) break;
		const child = `n${k}`;
		carried = chosen[Math.floor(rand() * chosen.length)];
		groups.push({ child, kind, parents: chosen });
		lines.push(`  - {id: ${child}, name: N${k}, sex: ${rand() < 0.5 ? 'm' : 'f'}, parents: [${chosen.map((id) => (kind === 'adoptive' ? `{id: ${id}, type: adoptive}` : id)).join(', ')}]}`);
	}
	return { source: `people:\n${lines.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`, groups };
}

/** The note text of `groupTreeData`. */
export const groupTree = (seed: number, options: GroupTreeOptions = {}): string => groupTreeData(seed, options).source;

/** Several groups in one tree (contract C, risk 9): `count` group children, disjoint where the base tree allows. */
export const severalGroupsTree = (seed: number, count = 3): string => groupTree(seed, { groups: count, people: 14 + 2 * count });

/** Two groups that share a person (contract C, case table row 16). */
export const sharedPersonGroupsTree = (seed: number): string => groupTree(seed, { groups: 2, shared: true, people: 14 });

/** One group of four parents (n = 4: always hung, the ends may touch). */
export const fourParentGroupTree = (seed: number): string => groupTree(seed, { size: 4, people: 14 });

/**
 * The owner's example (D365): child N with adoptive parents B, T, C and no partnership, the parents written in `order`.
 * The three parents stand in one generation with no couple among them.
 */
export function ownerExampleTree(order: readonly ['B' | 'T' | 'C', 'B' | 'T' | 'C', 'B' | 'T' | 'C'] = ['B', 'T', 'C'], kind: GroupKind = 'adoptive'): string {
	const names = { B: 'Bran', T: 'Tilda', C: 'Cara' } as const;
	const sex = { B: 'm', T: 'f', C: 'f' } as const;
	const people = (['B', 'T', 'C'] as const).map((id) => `  - {id: ${id}, name: ${names[id]}, sex: ${sex[id]}}`);
	const parents = order.map((id) => (kind === 'adoptive' ? `{id: ${id}, type: adoptive}` : id)).join(', ');
	return `people:\n${people.join('\n')}\n  - {id: N, name: Nell, sex: f, parents: [${parents}]}\n`;
}

/** The four orders of N's parents that every row of the case table runs in (contract C, section 5). */
export const OWNER_ORDERS = [
	['B', 'T', 'C'],
	['T', 'C', 'B'],
	['C', 'B', 'T'],
	['B', 'C', 'T'],
] as const;
