// The sample trees of the 1a case table (an internal study §7), made by small builders. Not a test file: vitest does not run it.
// A tree is a list of people and a list of unions; the tests build it in document order and in the reverse order.
import { compileCalendars, type Calendar, type DateReader } from '../../src/core/dates';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type Relation, type RelationOptions } from '../../src/core/relations';

export interface Who {
	id: string;
	sex?: 'm' | 'f';
	born?: string;
	died?: string;
	/** "id", or "id:type". */
	parents?: string[];
}

export interface Wed {
	partners: [string, string];
	type?: string;
	start?: string;
	end?: string;
	endedBy?: string;
}

export interface Tree {
	people: Who[];
	unions: Wed[];
}

/** A person: `p('ned', 'm', '1100', '1170', ['nf', 'nm'])`. */
export const p = (id: string, sex?: 'm' | 'f', born?: string, died?: string, parents: string[] = []): Who => ({ id, sex, born, died, parents });
/** A union: `w('ned', 'ola', { start: '1140', end: '1150', endedBy: 'divorce' })`. */
export const w = (a: string, b: string, more: Omit<Wed, 'partners'> = {}): Wed => ({ partners: [a, b], ...more });

const q = (s: string) => `'${s}'`;

function yaml(t: Tree, people: Who[] = t.people, unions: Wed[] = t.unions): string {
	const out = ['people:'];
	for (const x of people) {
		const parts = [`id: ${x.id}`, `name: ${x.id}`];
		if (x.sex) parts.push(`sex: ${x.sex}`);
		if (x.born !== undefined) parts.push(`born: ${q(x.born)}`);
		if (x.died !== undefined) parts.push(`died: ${q(x.died)}`);
		if (x.parents?.length) {
			parts.push(`parents: [${x.parents.map((s) => { const [id, type] = s.split(':'); return type ? `{id: ${id}, type: ${type}}` : id; }).join(', ')}]`);
		}
		out.push(`  - {${parts.join(', ')}}`);
	}
	if (unions.length) {
		out.push('unions:');
		for (const u of unions) {
			const parts = [`partners: [${u.partners.join(', ')}]`];
			if (u.type) parts.push(`type: ${u.type}`);
			if (u.start !== undefined) parts.push(`start: ${q(u.start)}`);
			if (u.end !== undefined) parts.push(`end: ${q(u.end)}`);
			if (u.endedBy !== undefined) parts.push(`ended-by: ${q(u.endedBy)}`);
			out.push(`  - {${parts.join(', ')}}`);
		}
	}
	return `${out.join('\n')}\n`;
}

/** The graph of a tree; `reader` is the date reader (the plain reader if none). */
export function graphOf(t: Tree, reader?: DateReader, people?: Who[], unions?: Wed[]): FamilyGraph {
	const r = parseDynasty(yaml(t, people, unions));
	if (!r.ok) throw new Error(`${r.error.code}\n${yaml(t, people, unions)}`);
	return deriveFamilies(r.tree, reader ? { dates: reader } : {});
}

/** The same tree with the people in reverse order (the unions keep their order: it can decide a word) and with every `parents` list reversed. */
export function reversed(t: Tree): { people: Who[]; unions: Wed[] } {
	return { people: [...t.people].reverse().map((x) => ({ ...x, parents: [...(x.parents ?? [])].reverse() })), unions: t.unions };
}

export const cardText = (list: readonly Relation[] | undefined) => (list ?? []).map((r) => r.text + (r.maybe ? `, maybe ${r.maybe.effect}` : '')).join(' | ');

/** The card texts of `to` for `from`, for one graph and one setting. */
export const wordsOf = (g: FamilyGraph, from: string, to: string, options?: RelationOptions): string => cardText(computeRelations(g, from, options).get(to));

/** The finder's steps from `from` to `to`, as "person is of's word" (the relation `at`, 0 for the first). */
export function stepsOf(g: FamilyGraph, from: string, to: string, at = 0): string[] {
	const r = findRelation(g, from, to);
	const steps = r.kind === 'named' ? r.relations[at].steps : r.kind === 'chain' ? r.steps : [];
	return steps.map((s) => `${s.person} is ${s.of}’s ${s.word}`);
}

/** A calendar of 28-year cycles that starts at 1100, so "Year 3 of Cycle 2" is 1130. */
export const CYCLES: Calendar = { id: 'C.md#0#0', name: 'C', note: 'C.md', formats: ['Year {year} of Cycle {cycle}'], kind: { type: 'cycles', length: 28, start: 1100 } };
export const readerWith = (ready: boolean): DateReader => compileCalendars([CYCLES], ready);

// ---------------------------------------------------------------------------------------------
// The trees of §7

const divorce = { start: '1140', end: '1150', endedBy: 'divorce' };

/** N: Ned and Ola, divorced in 1150, and their relatives. */
export function treeN(more: { tessDied?: string } = {}): Tree {
	return {
		people: [
			p('ned', 'm', '1100', '1170', ['nf', 'nm']),
			p('ola', 'f', '1102', '1175', ['op', 'om']),
			p('pip', 'm', '1130', undefined, ['ned']),
			p('olf', 'm'),
			p('quin', 'f', '1132', undefined, ['olf', 'ola']),
			p('tess', 'f', '1110', more.tessDied, ['op', 'om']),
			p('tn', 'm', '1140', undefined, ['tess']),
			p('op', 'm', undefined, undefined, ['opp', 'opw']),
			p('om', 'f'),
			p('hbm', 'f'),
			p('hb', 'm', undefined, undefined, ['op', 'hbm']),
			p('hn', 'm', '1135', undefined, ['hb']),
			p('ohf', 'm'),
			p('ohs', 'f', undefined, undefined, ['ohf', 'om']),
			p('osx', undefined, undefined, undefined, ['op', 'om']),
			p('opp', 'm'),
			p('opw', 'f'),
			p('oa', 'f', undefined, undefined, ['opp', 'opw']),
			p('oc', 'f', undefined, undefined, ['oa']),
			p('qc', 'm', '1155', undefined, ['quin']),
			p('qcc', 'm', '1180', undefined, ['qc']),
			p('pc', 'f', '1155', undefined, ['pip']),
			p('jan', 'f'),
			p('kit', 'f', '1155', undefined, ['ned', 'jan']),
			p('rk', 'm', '1135', undefined, ['ned:rumoured']),
			p('rk2', 'm', '1156', undefined, ['ned:rumoured']),
			p('ad', 'm', '1138', undefined, ['ned:adoptive']),
			p('ad2', 'm', '1157', undefined, ['ned:adoptive']),
			p('ns', 'f', undefined, undefined, ['nf', 'nm']),
			p('nsn', 'm', '1135', undefined, ['ns']),
			p('nm', 'f'),
			p('nf', 'm'),
		],
		unions: [w('ned', 'ola', divorce), w('ola', 'olf', { start: '1131', end: '1139' }), w('ned', 'jan', { start: '1152' })],
	};
}

/** V: two women, divorced in 1140, and an annulled marriage of a person with no `sex`. */
export function treeV(): Tree {
	return {
		people: [
			p('vic', 'f', '1100', '1170', ['vf', 'vm']),
			p('wyn', 'f', '1102', '1175'),
			p('vk', 'm', '1125', undefined, ['vic']),
			p('vs', 'f', undefined, undefined, ['vf', 'vm']),
			p('nx'),
			p('vf', 'm'),
			p('vm', 'f'),
		],
		unions: [w('vic', 'wyn', { start: '1130', end: '1140', endedBy: 'divorce' }), w('vs', 'nx', { start: '1125', end: '1135', endedBy: 'annulment' })],
	};
}

/** R, R2 and Rsw: Ra and Rb marry in 1120 (divorced in 1130) and again in 1140. `second` ends it: R2. `swap` lists the unions the other way: Rsw. */
export function treeR(second: { end?: string; endedBy?: string } = {}, swap = false): Tree {
	const first = w('ra', 'rb', { start: '1120', end: '1130', endedBy: 'divorce' });
	const again = w('ra', 'rb', { start: '1140', ...second });
	return {
		people: [
			p('ra', 'm', '1100', '1170'),
			p('rb', 'f', '1102', '1175', ['rf', 'rm']),
			p('rd', 'f'),
			p('rc', 'm', '1135', undefined, ['ra', 'rd']),
			p('re', 'm', '1132', '1138', ['ra', 'rd']),
			p('rs', 'f', undefined, undefined, ['rf', 'rsm']),
			p('rf', 'm'),
			p('rm', 'f'),
			p('rsm', 'f'),
		],
		unions: swap ? [again, first] : [first, again],
	};
}
export const treeR2 = (swap = false): Tree => treeR({ end: '1150', endedBy: 'divorce' }, swap);

/** F: Fa and Fb with the union of the row; Fc (1125) and Fd (1135) are children of Fa and Fx. `fbDied` is Fb's death (null: none). */
export function treeF(union: Omit<Wed, 'partners'>, fbDied: string | null = '1175', fdBorn = '1135'): Tree {
	return {
		people: [p('fa', 'm', '1100', '1170'), p('fb', 'f', '1102', fbDied ?? undefined), p('fx', 'f'), p('fc', 'f', '1125', undefined, ['fa', 'fx']), p('fd', 'f', fdBorn, undefined, ['fa', 'fx'])],
		unions: [w('fa', 'fb', union)],
	};
}

/** X: Me and his brothers B1 and B2; Ola marries B1 (1125–1130, divorced) and then B2 (1135). */
export function treeX(): Tree {
	return {
		people: [
			p('me', 'm', undefined, undefined, ['xf', 'xm']),
			p('b1', 'm', undefined, undefined, ['xf', 'xm']),
			p('b2', 'm', undefined, undefined, ['xf', 'xm']),
			p('ola', 'f'),
			p('xf', 'm'),
			p('xm', 'f'),
		],
		unions: [w('b1', 'ola', { start: '1125', end: '1130', endedBy: 'divorce' }), w('b2', 'ola', { start: '1135' })],
	};
}

/** C: two first cousins, married 1120 to 1130 and divorced. */
export function treeC(): Tree {
	return {
		people: [p('gf', 'm'), p('gm', 'f'), p('cp1', 'm', undefined, undefined, ['gf', 'gm']), p('cp2', 'f', undefined, undefined, ['gf', 'gm']), p('cm', 'm', undefined, undefined, ['cp1']), p('cw', 'f', undefined, undefined, ['cp2'])],
		unions: [w('cm', 'cw', { start: '1120', end: '1130', endedBy: 'divorce' })],
	};
}
