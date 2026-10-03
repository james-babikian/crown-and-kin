import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { ApplyOp, EditRefusal, NewPersonId, Op, ParentKind, UnionKind, UnionRef } from '../../src/core/edit';
import type { IssueCode } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import type { Tree } from '../../src/core/types';
import * as edit from '../../src/core/yaml-edit';
import { fixtureNote, fixtureSource, topLevelBlocks } from './load';

/*
 * Property (spec §8 "nothing may throw", §6.6 no cycles, §6.1 the stored body is always valid):
 * random sequences of 20 relationship ops on fixtures 1, 2, 8, 11, fixture 9's main block and
 * fixture 11 with `options.start`/`focus`, each op on the body the previous one wrote. applyOp
 * never throws; an accepted op leaves a body that parses, has no cycle, no broken reference and
 * no stale key it created, keeps the order of the people it did not move, reports `auto-union`
 * exactly when it added a union, and did what the op says; a refused op names a refusal the op
 * can have, and the body stays as it was (the next op starts from it).
 *
 * Deterministic: each sequence has its own seed, printed on failure.
 */

const applyOp: ApplyOp = edit.applyOp;
const newPersonId: NewPersonId = edit.newPersonId;

const STARTS: { label: string; body: string }[] = [
	...['01', '02', '08', '11'].map((f) => ({ label: `fixture ${f}`, body: fixtureSource(f).replace(/\n$/, '') })),
	{ label: 'fixture 9 main', body: topLevelBlocks(fixtureNote('09'))[0].replace(/\n$/, '') },
	{ label: 'fixture 11 with options', body: 'options:\n  start: corwin\n  focus: alys\n\n' + fixtureSource('11').replace(/\n$/, '') },
];
const SEQUENCES = 10;
const STEPS = 20;
const TYPES: ParentKind[] = ['birth', 'adoptive', 'ward', 'rumoured'];
const UNION_KINDS: UnionKind[] = ['marriage', 'betrothal', 'concubinage', 'affair'];
const NAMES = ['Aldric', 'Wynn', 'Maud Harrow', 'Þórr', 'Ysolde', '0042', 'Ser Gareth', 'Joan: the Elder', "O'Neill"];

/**
 * Issues a relationship op must never leave behind (§8). remove-union and delete-person also
 * remove `union:` keys naming a removed union (the decision notes "Relationship-op details"), so
 * `missing-union` is listed. Stale `placement:` and `union:` keys are checked by STALE.
 */
const NEVER: IssueCode[] = [
	'cycle',
	'self-parent',
	'duplicate-person-id',
	'duplicate-union-id',
	'missing-parent',
	'missing-union',
	'missing-partner',
	'missing-start',
	'missing-focus',
	'too-many-parents',
	'union-partner-count',
	'union-same-partner',
	'entry-not-map',
	'missing-id',
	'section-wrong-shape',
];

/** Keys an op must remove when it makes them stale (the decision notes "Relationship-op details"): an op may not create these. */
const STALE: IssueCode[] = ['placement-without-parents', 'union-not-of-parents'];

/** Refusals each op can give. `bad-value` is the WP2.3 guard against a change it cannot make safely. */
const MAY_REFUSE: Record<Exclude<Op['kind'], 'set-person-fields' | 'set-option' | 'add-house' | 'edit-house' | 'delete-house' | 'rewrite-links' | 'add-title' | 'edit-title' | 'delete-title' | 'add-holder' | 'edit-holder' | 'remove-holder' | 'set-holders' | 'set-house-id' | 'set-title-id'>, EditRefusal[]> = {
	'add-person': ['id-taken', 'unknown-person', 'limit', 'bad-value'],
	'add-parent': ['limit', 'cycle', 'unknown-person', 'bad-value'],
	'add-union': ['unknown-person', 'bad-value'],
	'edit-union': ['unknown-union', 'bad-value'],
	'remove-union': ['unknown-union', 'bad-value'],
	'set-parent-type': ['limit', 'unknown-person', 'bad-value'],
	'remove-parent': ['unknown-person', 'bad-value'],
	'move-sibling': ['no-sibling', 'unknown-person', 'bad-value'],
	'delete-person': ['unknown-person', 'bad-value'],
	batch: ['id-taken', 'unknown-person', 'limit', 'cycle', 'bad-value', 'unknown-union'],
};

function rng(seed: number) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (n: number) => Math.floor(next() * n),
		pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
		chance: (p: number) => next() < p,
	};
}
type Rng = ReturnType<typeof rng>;

function read(body: string): Tree {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error(`body does not parse: ${r.error.code} ${r.error.detail ?? ''}\n${body}`);
	return r.tree;
}

const ids = (t: Tree) => t.people.map((p) => p.id);
const kind = (type: string): ParentKind => ((TYPES as string[]).includes(type) ? (type as ParentKind) : 'birth');

/** Everyone below `id` through any parent type, worked out here from the tree (§6.6). */
function descendants(t: Tree, id: string): Set<string> {
	const out = new Set<string>();
	const todo = [id];
	while (todo.length) {
		const cur = todo.pop()!;
		for (const p of t.people) {
			if (!out.has(p.id) && p.parents.some((r) => r.id === cur)) {
				out.add(p.id);
				todo.push(p.id);
			}
		}
	}
	return out;
}

function unionRef(t: Tree, r: Rng): UnionRef | null {
	const u = t.unions.filter((x) => x.partners.length === 2);
	if (!u.length) return null;
	const pick = r.pick(u);
	const partners: [string, string] = r.chance(0.5) ? [pick.partners[0], pick.partners[1]] : [pick.partners[1], pick.partners[0]];
	// Now and then a stale ref: the right index, the wrong people.
	if (r.chance(0.1)) partners[0] = r.pick(ids(t));
	return { index: pick.index, partners };
}

function newPerson(body: string, t: Tree, r: Rng): Extract<Op, { kind: 'add-person' }> {
	const name = r.pick(NAMES);
	const id = r.chance(0.05) ? r.pick(ids(t)) : newPersonId(body, name);
	const parents: { id: string; type: ParentKind }[] = [];
	const n = r.int(3);
	for (let i = 0; i < n; i++) {
		const p = r.pick(ids(t));
		if (!parents.some((x) => x.id === p)) parents.push({ id: p, type: r.chance(0.6) ? 'birth' : r.pick(TYPES) });
	}
	const op: Extract<Op, { kind: 'add-person' }> = { kind: 'add-person', id, fields: { name }, parents };
	const where = r.int(4);
	if (where === 1 && parents.length) op.at = { kind: 'after-siblings', parents: parents.map((p) => p.id) };
	if (where === 2) op.at = { kind: 'before', id: r.pick(ids(t)) };
	if (where === 3) op.at = { kind: 'after', id: r.pick(ids(t)) };
	return op;
}

function randomOp(body: string, t: Tree, r: Rng): Op {
	const people = ids(t);
	const any = () => r.pick(people);
	const withParents = t.people.filter((p) => p.parents.length);
	for (;;) {
		switch (r.int(11)) {
			case 0:
				return newPerson(body, t, r);
			case 1:
			case 2: {
				// A parent of another type is allowed; the same type again is refused with bad-value.
				const child = r.pick(t.people);
				const parent = any();
				const type = r.pick(TYPES);
				return { kind: 'add-parent', child: child.id, parent, type, autoUnion: r.chance(0.8) };
			}
			case 3: {
				// The same person twice now and then: refused with bad-value.
				const a = any();
				const b = r.chance(0.05) ? a : any();
				return { kind: 'add-union', partners: [a, b], type: r.chance(0.5) ? r.pick(UNION_KINDS) : undefined, start: r.chance(0.3) ? '1150' : undefined };
			}
			case 4: {
				const u = unionRef(t, r);
				if (!u) continue;
				return { kind: 'edit-union', union: u, fields: { type: r.chance(0.5) ? r.pick(UNION_KINDS) : null, end: r.chance(0.5) ? '1160' : null } };
			}
			case 5: {
				const u = unionRef(t, r);
				if (!u) continue;
				return { kind: 'remove-union', union: u };
			}
			case 6: {
				if (!withParents.length) continue;
				const p = r.pick(withParents);
				const link = r.pick(p.parents);
				const to = r.pick(TYPES);
				if (to === kind(link.type)) continue;
				return { kind: 'set-parent-type', child: p.id, parent: link.id, from: kind(link.type), to };
			}
			case 7: {
				if (!withParents.length) continue;
				const p = r.pick(withParents);
				const link = r.pick(p.parents);
				return { kind: 'remove-parent', child: p.id, parent: link.id, type: kind(link.type) };
			}
			case 8:
				return { kind: 'move-sibling', id: any(), direction: r.chance(0.5) ? 'earlier' : 'later' };
			case 9:
				if (people.length < 4 || !r.chance(0.4)) continue;
				return { kind: 'delete-person', id: any() };
			default: {
				const person = newPerson(body, t, r);
				// The new person as a spouse, or as a parent (§6.3 "New people are drafts").
				const second: Op = r.chance(0.5)
					? { kind: 'add-union', partners: [any(), person.id] }
					: { kind: 'add-parent', child: any(), parent: person.id, type: r.pick(TYPES) };
				return { kind: 'batch', ops: [person, second] };
			}
		}
	}
}

/** What an accepted op must have done, checked on the tree read back. */
function checkEffect(before: Tree, after: Tree, op: Op, label: string): void {
	const has = (t: Tree, child: string, parent: string, type: ParentKind) =>
		t.people.find((p) => p.id === child)?.parents.filter((x) => x.id === parent && kind(x.type) === type).length ?? 0;
	// Entries for that parent of every type: the other types must not change.
	const all = (t: Tree, child: string, parent: string) => t.people.find((p) => p.id === child)?.parents.filter((x) => x.id === parent).length ?? 0;
	switch (op.kind) {
		case 'add-person':
			expect(ids(after), label).toContain(op.id);
			expect(after.people.length, label).toBe(before.people.length + 1);
			break;
		case 'add-parent':
			expect(has(before, op.child, op.parent, op.type), `${label}: already a parent of that type`).toBe(0);
			expect(has(after, op.child, op.parent, op.type), label).toBe(1);
			expect(all(after, op.child, op.parent), label).toBe(all(before, op.child, op.parent) + 1);
			// §6.6: never a parent of their own ancestor.
			expect(op.parent === op.child || descendants(before, op.child).has(op.parent), label).toBe(false);
			break;
		case 'remove-parent':
			expect(has(after, op.child, op.parent, op.type), label).toBe(has(before, op.child, op.parent, op.type) - 1);
			expect(all(after, op.child, op.parent), label).toBe(all(before, op.child, op.parent) - 1);
			break;
		case 'add-union':
			expect(op.partners[0], `${label}: the same person twice`).not.toBe(op.partners[1]);
			expect(after.unions.length, label).toBe(before.unions.length + 1);
			break;
		case 'remove-union':
			expect(after.unions.length, label).toBe(before.unions.length - 1);
			break;
		case 'move-sibling':
			expect([...ids(after)].sort(), label).toEqual([...ids(before)].sort());
			expect(ids(after), label).not.toEqual(ids(before));
			break;
		case 'delete-person':
			expect(ids(after), label).not.toContain(op.id);
			expect(after.people.length, label).toBe(before.people.length - 1);
			expect(after.people.some((p) => p.parents.some((x) => x.id === op.id)), label).toBe(false);
			expect(after.unions.some((u) => u.partners.includes(op.id)), label).toBe(false);
			expect([after.options.start, after.options.focus], label).not.toContain(op.id);
			break;
		default:
			break;
	}
}

/** Relative order of the people an op kept: only move-sibling may change it (D2, §6.5). */
function checkOrder(before: Tree, after: Tree, op: Op, label: string): void {
	if (op.kind === 'move-sibling') return;
	const kept = new Set(ids(after));
	const old = new Set(ids(before));
	expect(ids(after).filter((id) => old.has(id)), `${label}: order of existing people`).toEqual(ids(before).filter((id) => kept.has(id)));
}

/** `auto-union` is reported exactly when add-parent added a union, and only for birth or adoptive (§6.4, D15). */
function checkAutoUnion(before: Tree, after: Tree, op: Op, effects: readonly string[], label: string): void {
	const autos = effects.filter((e) => e === 'auto-union').length;
	const inner = op.kind === 'batch' ? op.ops : [op];
	const addParent = inner.find((o): o is Extract<Op, { kind: 'add-parent' }> => o.kind === 'add-parent');
	if (!addParent) {
		expect(autos, `${label}: auto-union without add-parent`).toBe(0);
		return;
	}
	const addUnions = inner.filter((o) => o.kind === 'add-union').length;
	expect(autos, `${label}: effects ${JSON.stringify(effects)}`).toBe(after.unions.length - before.unions.length - addUnions);
	if (autos) {
		expect(['birth', 'adoptive'], label).toContain(addParent.type);
		expect(addParent.autoUnion, label).not.toBe(false);
	}
}

/** Issues of these codes, one key per issue, to find the ones an op added. */
const issueKeys = (t: Tree, codes: IssueCode[]) =>
	new Set(
		deriveFamilies(t)
			.issues.filter((i) => codes.includes(i.code))
			.map((i) => `${i.code} ${JSON.stringify(i.ids ?? i.params)}`),
	);

/** A refusal must fit the op: a `cycle` really closes a loop; the refusals fixed in the decision notes "Relationship-op details" use `bad-value`. */
function checkRefusal(before: Tree, op: Op, code: EditRefusal, label: string): void {
	const listed = (child: string, parent: string, type: ParentKind) =>
		before.people.some((p) => p.id === child && p.parents.some((x) => x.id === parent && kind(x.type) === type));
	if (op.kind === 'add-parent' && listed(op.child, op.parent, op.type) && op.parent !== op.child) {
		// Already a parent of that type; with two of that type the limit may be named instead.
		expect(['bad-value', 'limit'], `${label} → ${code}`).toContain(code);
	}
	if (op.kind === 'add-union' && op.partners[0] === op.partners[1]) expect(code, label).toBe('bad-value');
	if (op.kind === 'add-parent' && code === 'cycle') {
		expect(op.parent === op.child || descendants(before, op.child).has(op.parent), label).toBe(true);
	}
	if (op.kind === 'move-sibling' && code === 'no-sibling') expect(ids(before), label).toContain(op.id);
}

describe('random relationship ops never break a tree (§8, §6.6)', () => {
	STARTS.forEach(({ label: name, body: start }, n) => {
		it(`${name}: ${SEQUENCES} sequences of ${STEPS} ops`, () => {
			let accepted = 0;
			for (let s = 0; s < SEQUENCES; s++) {
				const seed = (0x3e1a7100 + n * 1000 + s) >>> 0;
				const r = rng(seed);
				let body = start;
				for (let step = 0; step < STEPS; step++) {
					const before = read(body);
					const op = randomOp(body, before, r);
					const label = `${name}, seed 0x${seed.toString(16)}, step ${step}: ${JSON.stringify(op)}`;
					const res = applyOp(body, op);
					// Pure: the same op on the same body gives the same answer.
					expect(applyOp(body, op), label).toEqual(res);
					if (!res.ok) {
						expect(MAY_REFUSE[op.kind as keyof typeof MAY_REFUSE], `${label} → ${res.code}`).toContain(res.code);
						checkRefusal(before, op, res.code, label);
						continue;
					}
					const after = read(res.body);
					const codes = deriveFamilies(after).issues.map((i) => i.code);
					expect(codes.filter((c) => NEVER.includes(c)), label).toEqual([]);
					const staleBefore = issueKeys(before, STALE);
					expect([...issueKeys(after, STALE)].filter((k) => !staleBefore.has(k)), `${label}: stale key left`).toEqual([]);
					checkEffect(before, after, op, label);
					checkOrder(before, after, op, label);
					checkAutoUnion(before, after, op, res.effects ?? [], label);
					body = res.body;
					accepted++;
				}
			}
			// The generator must exercise the ops, not only their refusals.
			expect(accepted).toBeGreaterThan(SEQUENCES * STEPS * 0.3);
		});
	});
});
