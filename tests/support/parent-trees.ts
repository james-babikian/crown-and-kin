// Random notes full of children with three or more parents of mixed types, repeated ids, unknown type words, `placement` keys and `union`
// keys, for the sweeps of the group and couple reading (`drawn-parent-map-sweep`, `three-parents-hostile`). One seed gives one note.
import { Rng } from './rng';

const TYPES = ['birth', 'birth', 'birth', 'adoptive', 'adoptive', 'ward', 'rumoured', 'begetter', 'weird'];

/** The note of one seed: people p0 to p(n-1) with parent lists that name earlier and, now and then, later people. */
export function randomParentSource(seed: number): string {
	const r = new Rng(seed);
	const n = 5 + r.int(5);
	const lines: string[] = [];
	for (let i = 0; i < n; i++) {
		const entries: string[] = [];
		const count = i === 0 ? 0 : r.chance(0.3) ? 0 : 1 + r.int(5);
		for (let k = 0; k < count; k++) {
			const id = `p${r.chance(0.9) ? r.int(i) : r.int(n)}`;
			if (id === `p${i}`) continue;
			const type = r.pick(TYPES);
			entries.push(type === 'birth' && r.chance(0.5) ? id : `{id: ${id}, type: ${type}}`);
		}
		const extras = (r.chance(0.12) ? `, placement: ${r.pick(['birth', 'adoptive', 'ward'])}` : '') + (r.chance(0.12) ? `, union: m${r.int(4)}` : '');
		lines.push(`  - {id: p${i}, name: p${i}${entries.length ? `, parents: [${entries.join(', ')}]` : ''}${extras}}`);
	}
	const unions: string[] = [];
	const unionCount = r.int(5);
	for (let k = 0; k < unionCount; k++) {
		const a = r.int(n);
		const b = r.int(n);
		unions.push(`  - {id: m${k}, partners: [p${a}, p${b}]${r.chance(0.3) ? ', type: affair' : ''}}`);
	}
	return `people:\n${lines.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}

