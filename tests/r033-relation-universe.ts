// Builds the card relation texts the plugin can show, from small made-up trees and the real `computeRelations` (0.3.3 B6, the case table of the design gate).
// Not a test file: vitest does not run it. `relationUniverse(n)` lists every distinct card text for generations 0 to `n` up to the common ancestor.
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, type Relation, type RelationOptions } from '../src/core/relations';
import { cardRelationText } from '../src/render/tree-info';

export type Sex = 'm' | 'f' | '-';
export interface Pp { id: string; sex: Sex; parents: string[] } // parents as "id" or "id:type"
export class T {
	people = new Map<string, Pp>();
	unions: string[][] = [];
	add(id: string, sex: Sex, parents: string[] = []) {
		this.people.set(id, { id, sex, parents });
		return id;
	}
	union(a: string, b: string, type?: string) { this.unions.push(type ? [a, b, type] : [a, b]); }
	graph(): FamilyGraph {
		const out = ['people:'];
		for (const p of this.people.values()) {
			out.push(`  - id: ${p.id}`, `    name: ${p.id}`);
			if (p.sex !== '-') out.push(`    sex: ${p.sex}`);
			if (p.parents.length) out.push(`    parents: [${p.parents.map((s) => { const [i, t] = s.split(':'); return t ? `{id: ${i}, type: ${t}}` : i; }).join(', ')}]`);
		}
		if (this.unions.length) {
			out.push('unions:');
			for (const u of this.unions) out.push(u[2] ? `  - {partners: [${u[0]}, ${u[1]}], type: ${u[2]}}` : `  - partners: [${u[0]}, ${u[1]}]`);
		}
		const r = parseDynasty(out.join('\n') + '\n');
		if (!r.ok) throw new Error(r.error.code + '\n' + out.join('\n'));
		return deriveFamilies(r.tree);
	}
}

export type Variant = 'full' | 'half' | 'half?full' | 'half?full-r' | 'full?half' | 'adopt' | 'adopt-half' | 'rum' | 'rum-half' | 'double' | 'rum-double' | 'adopt-double';

/** Builds ME (a up to X) and P (b up to X). Returns false when the variant does not fit (a,b). */
export function blood(t: T, v: Variant, a: number, b: number, sexP: Sex, me = 'ME', p = 'P', pfx = ''): boolean {
	const id = (s: string) => pfx + s;
	const isDouble = v === 'double' || v === 'rum-double' || v === 'adopt-double';
	if (isDouble && (a < 2 || b < 2)) return false;
	if (!isDouble && v !== 'full' && (a === 0 || b === 0) && !['adopt', 'rum'].includes(v)) {
		return false; // direct lines are never half; only the link type varies
	}
	const type = v.startsWith('adopt') ? ':adoptive' : v.startsWith('rum') ? ':rumoured' : '';
	if (a === 0 && b === 0) return false;
	const X = id('X'), Y = id('Y'), Z = id('Z'), W = id('W');
	if (!isDouble) {
		if (a === 0 || b === 0) {
			// direct: chain from the lower person up to the upper one; the type sits on the top link
			const [low, up, n] = a === 0 ? [p, me, b] : [me, p, a];
			t.add(up, up === p ? sexP : 'm');
			let prev = up;
			const top = n;
			for (let i = top - 1; i >= 1; i--) { const nid = id('c' + i); t.add(nid, '-', [(i === top - 1 ? prev + type : prev)]); prev = nid; }
			t.add(low, low === p ? sexP : 'm', [top === 1 ? prev + type : prev]);
			return true;
		}
		t.add(X, 'm'); t.add(Y, 'f'); t.add(Z, 'f'); t.add(W, 'm');
		let c1: string[], c2: string[];
		switch (v) {
			case 'full': c1 = [X, Y]; c2 = [X, Y]; break;
			case 'half': c1 = [X, Y]; c2 = [X, Z]; break;
			case 'half?full': c1 = [X, Y]; c2 = [X]; break;
			case 'half?full-r': c1 = [X, Y]; c2 = [X, Y + ':rumoured']; break;
			case 'full?half': c1 = [X, Y]; c2 = [X, Y, W + ':rumoured']; break;
			case 'adopt': c1 = [X, Y]; c2 = [X + ':adoptive', Y + ':adoptive']; break;
			case 'adopt-half': c1 = [X, Y]; c2 = [X + ':adoptive']; break;
			case 'rum': c1 = [X, Y]; c2 = [X + ':rumoured', Y + ':rumoured']; break;
			case 'rum-half': c1 = [X, Y]; c2 = [X + ':rumoured', Z]; break;
			default: return false;
		}
		const chain = (first: string, n: number, sex: Sex, parents: string[]) => {
			// first is the lowest; n links up to X; the top node (n-1 levels above first) takes `parents`
			const ids: string[] = [first];
			for (let i = 1; i < n; i++) ids.push(id(first + '_' + i));
			ids.forEach((cid, i) => t.add(cid, i === 0 ? sex : '-', i === n - 1 ? parents : [ids[i + 1]]));
		};
		chain(me, a, 'm', c1);
		chain(p, b, sexP, c2);
		return true;
	}
	// double: two couples
	const [X1, Y1, X2, Y2] = [id('X1'), id('Y1'), id('X2'), id('Y2')];
	t.add(X1, 'm'); t.add(Y1, 'f'); t.add(X2, 'm'); t.add(Y2, 'f');
	const ty = v === 'rum-double' ? ':rumoured' : v === 'adopt-double' ? ':adoptive' : '';
	const line = (first: string, n: number, sex: Sex, top: string[], tag: string) => {
		const ids: string[] = [first];
		for (let i = 1; i < n; i++) ids.push(id(tag + i));
		ids.forEach((cid, i) => t.add(cid, i === 0 ? sex : '-', i === n - 1 ? top : [ids[i + 1]]));
		return ids;
	};
	const withT = (xs: string[], useType: boolean) => xs.map((x) => x + (useType ? ty : ''));
	// ME's two parents f1, g1 start two chains of a-1 nodes; P's two parents q1, r1 start chains of b-1 nodes.
	const f = line(id('f1'), a - 1, '-', [X1, Y1], 'f');
	const g = line(id('g1'), a - 1, '-', [X2, Y2], 'g');
	t.add(me, 'm', [f[0], g[0]]);
	const q = line(id('q1'), b - 1, '-', withT([X1, Y1], true), 'q');
	const r = line(id('r1'), b - 1, '-', withT([X2, Y2], true), 'r');
	t.add(p, sexP, [q[0], r[0]]);
	return true;
}

export function relsOf(t: T, me: string, p: string, options?: RelationOptions): readonly Relation[] {
	const g = t.graph();
	return computeRelations(g, me, options).get(p) ?? [];
}

/** Every distinct card relation text for generations 0 to `N` up to the common ancestor: blood, adoptive, rumoured, double, by marriage (both rules), partners, guardian, ward, step-sibling and "You". */
export function relationUniverse(N: number): string[] {
	const rows = new Set<string>();
	// The first relation of the person is the one the card shows.
	const note = (rels: readonly Relation[]) => {
		if (rels[0]) rows.add(cardRelationText(rels[0]));
	};
	const sexes: Sex[] = ['m', 'f', '-'];
	const variants: Variant[] = ['full', 'half', 'half?full', 'half?full-r', 'full?half', 'adopt', 'adopt-half', 'rum', 'rum-half', 'double', 'rum-double', 'adopt-double'];
	for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) for (const v of variants) for (const sx of sexes) {
		const t = new T();
		if (!blood(t, v, a, b, sx)) continue;
		note(relsOf(t, 'ME', 'P'));
	}
	// rule 1: P is the spouse of R, R a blood relative of ME
	const v1: Variant[] = ['full', 'half', 'adopt', 'rum', 'double', 'rum-half'];
	for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) for (const v of v1) for (const sxR of ['m', 'f'] as Sex[]) for (const sxP of sexes) {
		const t = new T();
		if (!blood(t, v, a, b, sxR, 'ME', 'R')) continue;
		t.add('P', sxP); t.union('R', 'P');
		note(relsOf(t, 'ME', 'P'));
	}
	// rule 2: P is a blood relative of ME's spouse S
	for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) for (const v of v1) for (const sxS of sexes) for (const sxP of sexes) {
		const t = new T();
		if (!blood(t, v, a, b, sxP, 'S', 'P')) continue;
		t.people.get('S')!.sex = sxS;
		t.add('ME', '-'); t.union('ME', 'S');
		note(relsOf(t, 'ME', 'P'));
	}
	// partners, wards, step-sibling, you
	for (const sx of sexes) for (const type of ['marriage', 'betrothal', 'concubinage', 'affair', 'partnership', 'x']) {
		const t = new T(); t.add('ME', '-'); t.add('P', sx); t.union('ME', 'P', type);
		note(relsOf(t, 'ME', 'P'));
	}
	for (const sx of sexes) {
		const t = new T(); t.add('ME', '-'); t.add('P', sx); t.add('C', '-', ['ME', 'P']);
		note(relsOf(t, 'ME', 'P'));
		const g1 = new T(); g1.add('ME', '-', ['P:ward']); g1.add('P', sx);
		note(relsOf(g1, 'ME', 'P'));
		const g2 = new T(); g2.add('P', sx, ['ME:ward']); g2.add('ME', '-');
		note(relsOf(g2, 'ME', 'P'));
		const s = new T(); s.add('N', 'm'); s.add('Q', 'f'); s.union('N', 'Q'); s.add('ME', '-', ['N']); s.add('P', sx, ['Q']);
		note(relsOf(s, 'ME', 'P'));
	}
	rows.add('You');
	return [...rows];
}
