import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../src/core/block-locate';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import type { EditRefusal, Op, ParentKind, UnionKind } from '../src/core/edit';
import { familyOf, pickerExclusions } from '../src/core/family-query';
import { parseDynasty } from '../src/core/parse';
import { commentsOf } from '../src/core/yaml-patch';
import { applyOp, newPersonId } from '../src/core/yaml-edit';

// Property (spec §6.2–§6.7, §8): random sequences of relationship ops on every sample tree never
// throw, never create a cycle, never lose a comment unless the op removes something, and always
// leave a body that parses with editing still on. Ops that the pickers allow must succeed; the
// others must be refused with the code the contract names.

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const PARENT_KINDS: ParentKind[] = ['birth', 'adoptive', 'ward', 'rumoured'];
const UNION_KINDS: UnionKind[] = ['marriage', 'betrothal', 'concubinage', 'affair'];
const NAMES = ['Ada', 'Ünïcødé Þórr', '1234', 'a: b', 'Aldric Valmont', '', '#x', 'Wat'];

function bodies(): { label: string; body: string }[] {
	const out: { label: string; body: string }[] = [];
	for (const f of readdirSync('fixtures').filter((f) => f.endsWith('.md')).sort()) {
		const text = readFileSync(`fixtures/${f}`, 'utf8');
		findBlocks(text).forEach((b, n) => out.push({ label: `${f} #${n}`, body: b.body }));
	}
	return out;
}

function graph(body: string): FamilyGraph | null {
	const parsed = parseDynasty(body);
	return parsed.ok ? deriveFamilies(parsed.tree) : null;
}

const cycles = (g: FamilyGraph) => g.issues.filter((i) => i.code === 'cycle').length;
/** Warnings a relationship op must not leave behind (the decision notes "Relationship-op details"). */
const staleCount = (g: FamilyGraph) => g.issues.filter((i) => ['placement-without-parents', 'union-not-of-parents', 'missing-union'].includes(i.code)).length;
const blocked = (g: FamilyGraph) => g.issues.some((i) => i.level === 'blocking');

/** A random op and the refusal it must get, or null if it must succeed. */
function randomOp(body: string, g: FamilyGraph, random: () => number): { op: Op; expect: EditRefusal | null; removes: boolean } | null {
	const pick = <T>(xs: T[]): T => xs[Math.floor(random() * xs.length)];
	const written = g.people.filter((p) => !p.id.startsWith('~'));
	if (!written.length) return null;
	const listed = g.unions.filter((u) => !u.implicit);
	const kind = pick(['add-person', 'add-parent', 'add-parent', 'add-union', 'edit-union', 'remove-union', 'set-parent-type', 'remove-parent', 'move-sibling', 'move-sibling', 'delete-person']);
	switch (kind) {
		case 'add-person': {
			const name = pick(NAMES) || 'Nameless';
			const parents = [...new Set([pick(written).id, pick(written).id])].slice(0, Math.floor(random() * 3));
			const at = pick([undefined, 'siblings', 'before', 'after'] as const);
			const op: Op = {
				kind: 'add-person',
				id: newPersonId(body, name),
				fields: { name, sex: pick(['m', 'f', null]), born: pick(['1102', '0042', null]) },
				parents: parents.map((id) => ({ id, type: 'birth' as const })),
				at: at === undefined ? undefined : at === 'siblings' ? (parents.length ? { kind: 'after-siblings', parents } : undefined) : { kind: at, id: pick(written).id },
			};
			return { op, expect: null, removes: false };
		}
		case 'add-parent': {
			const child = pick(g.people).id;
			const parent = pick(written).id;
			const type = pick(PARENT_KINDS);
			const fam = familyOf(g, child)!;
			let expect: EditRefusal | null = null;
			if (parent === child || pickerExclusions(g, child, 'add-parent', 'birth').has(parent) && !fam.parents.some((r) => r.id === parent)) expect = 'cycle';
			else if (fam.parents.some((r) => r.id === parent && r.type === type)) expect = 'bad-value';
			else if (fam.fullTypes.includes(type)) expect = 'limit';
			return { op: { kind: 'add-parent', child, parent, type }, expect, removes: false };
		}
		case 'add-union': {
			const a = pick(written).id;
			const b = pick(written).id;
			return { op: { kind: 'add-union', partners: [a, b], type: pick(UNION_KINDS), start: pick([undefined, '1130', '']) }, expect: a === b ? 'bad-value' : null, removes: false };
		}
		case 'edit-union': {
			if (!listed.length) return null;
			const u = pick(listed);
			const fields = { type: pick([null, ...UNION_KINDS]), start: pick([undefined, null, '1140', 'Spring, 1140']), end: pick([undefined, '']) };
			return { op: { kind: 'edit-union', union: { index: u.unionIndex!, partners: [u.partners[1], u.partners[0]] }, fields }, expect: null, removes: false };
		}
		case 'remove-union': {
			if (!listed.length) return null;
			const u = pick(listed);
			return { op: { kind: 'remove-union', union: { index: u.unionIndex!, partners: u.partners } }, expect: null, removes: true };
		}
		case 'set-parent-type': {
			const withParents = g.people.filter((p) => familyOf(g, p.id)!.parents.length);
			if (!withParents.length) return null;
			const child = pick(withParents).id;
			const fam = familyOf(g, child)!;
			const link = pick(fam.parents);
			const to = pick(PARENT_KINDS);
			let expect: EditRefusal | null = null;
			if (to !== link.type && fam.parents.some((r) => r.id === link.id && r.type === to)) expect = 'bad-value';
			else if (to !== link.type && fam.fullTypes.includes(to)) expect = 'limit';
			return { op: { kind: 'set-parent-type', child, parent: link.id, from: link.type, to }, expect, removes: false };
		}
		case 'remove-parent': {
			const withParents = g.people.filter((p) => familyOf(g, p.id)!.parents.length);
			if (!withParents.length) return null;
			const child = pick(withParents).id;
			const link = pick(familyOf(g, child)!.parents);
			return { op: { kind: 'remove-parent', child, parent: link.id, type: link.type }, expect: null, removes: true };
		}
		case 'move-sibling': {
			const id = pick(g.people).id;
			const direction = pick(['earlier', 'later'] as const);
			const s = familyOf(g, id)!.siblings;
			const can = s !== null && (direction === 'earlier' ? s.canMoveEarlier : s.canMoveLater);
			return { op: { kind: 'move-sibling', id, direction }, expect: can ? null : 'no-sibling', removes: false };
		}
		default:
			return { op: { kind: 'delete-person', id: pick(g.people).id }, expect: null, removes: true };
	}
}

function multiset(xs: string[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
	return m;
}

describe('random relationship ops on every sample tree', () => {
	for (const { label, body: start } of bodies()) {
		const g0 = graph(start);
		if (!g0 || blocked(g0)) continue;
		it(label, () => {
			const random = rng(label.length * 104729 + start.length + Number(process.env.SEED ?? 0));
			let body = start;
			const rounds = start.length > 20000 ? 12 : Number(process.env.ROUNDS ?? 0) || 40;
			for (let n = 0; n < rounds; n++) {
				const g = graph(body)!;
				const next = randomOp(body, g, random);
				if (!next) continue;
				const what = `step ${n}: ${JSON.stringify(next.op)}`;
				const r = applyOp(body, next.op);
				if (next.expect !== null) {
					expect(r.ok ? 'ok' : r.code, what).toBe(next.expect);
					continue;
				}
				if (!r.ok) throw new Error(`${what}: refused ${r.code} ${r.detail ?? ''}\n${body}`);
				const after = graph(r.body);
				expect(after, what).not.toBeNull();
				expect(blocked(after!), what).toBe(false);
				expect(cycles(after!), what).toBeLessThanOrEqual(cycles(g));
				if (['add-parent', 'remove-parent', 'set-parent-type', 'delete-person', 'remove-union'].includes(next.op.kind)) expect(staleCount(after!), `${what}: stale key`).toBeLessThanOrEqual(staleCount(g));
				const before = multiset(commentsOf(body).map((c) => c.text));
				const now = multiset(commentsOf(r.body).map((c) => c.text));
				for (const [text, count] of now) expect(count, `${what}: comment ${text}`).toBeLessThanOrEqual(before.get(text) ?? 0);
				if (!next.removes) expect(now, what).toEqual(before);
				body = r.body;
			}
		}, 30000);
	}
});

describe('crlf bodies', () => {
	it('keep CRLF line endings through every op kind', () => {
		for (const { body: start } of bodies().slice(0, 4)) {
			const random = rng(start.length);
			let body = start.replace(/\n/g, '\r\n');
			for (let n = 0; n < 25; n++) {
				const g = graph(body);
				if (!g || blocked(g)) break;
				const next = randomOp(body, g, random);
				if (!next || next.expect !== null) continue;
				const r = applyOp(body, next.op);
				if (!r.ok) throw new Error(`${JSON.stringify(next.op)}: refused ${r.code} ${r.detail ?? ''}`);
				expect(r.body.replace(/\r\n/g, ''), JSON.stringify(next.op)).not.toContain('\n');
				body = r.body;
			}
		}
	});
});
