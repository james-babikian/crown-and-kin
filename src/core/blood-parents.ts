/*
 * The parents by blood of a person (spec §0 D332): birth parents and begetters together. `validate.ts` calls the three warnings and the
 * rule that a begetter who is also a birth parent of the same child is not drawn twice, and the same rule and its warning for a rumoured
 * parent who is also a written birth parent (D371 (4)); the edits (`relationship-ops.ts`, `family-query.ts`)
 * read `bloodProblem` and `bloodRefusal`; the relation search (`relation-kin-base.ts`) reads the blood set of a child through `bloodSet`. Pure; nothing here
 * reads the rest of the tree.
 */

import type { IssueCode, IssueParams } from './messages';
import { BLOOD_LIMIT, isBloodType, PARENT_LIMIT, type ParentType } from './parent-types';
import { REFUSAL_TEXT } from './refusal-text';
import { isUnionType, type ParentRef, type Person, type Union } from './types';
import { refuse, type Refusal } from './yaml-patch';

/** One cleaned parent link of a person: the parent id and a known type. */
type Link = { id: string; type: ParentType };

/** How a warning reaches the caller's list: the code, its parameters (names) and the ids it is about. */
type Warn = (code: IssueCode, params: IssueParams, ids: string[]) => void;

/**
 * The warnings of one person about its parents by blood (D332), on the cleaned links: a person with a begetter link and more
 * than `BLOOD_LIMIT` distinct parents by blood (only where no `too-many-parents` for birth or begetter shows, and only with
 * the setting on, as for birth), and a person who has one id as a birth parent and as a begetter.
 */
export function bloodWarnings(p: Person, valid: readonly Link[], name: (id: string) => string, warnMany: boolean, warn: Warn): void {
	if (!valid.some((r) => r.type === 'begetter')) return;
	const birth = valid.filter((r) => r.type === 'birth').map((r) => r.id);
	const begetters = valid.filter((r) => r.type === 'begetter').map((r) => r.id);
	const births = new Set(birth);
	const blood = new Set([...birth, ...begetters]);
	const typeOver = birth.length > PARENT_LIMIT.birth || begetters.length > PARENT_LIMIT.begetter;
	if (warnMany && !typeOver && blood.size > BLOOD_LIMIT) warn('too-many-blood-parents', { person: p.name, count: blood.size, limit: BLOOD_LIMIT }, [p.id]);
	for (const id of begetters) if (births.has(id)) warn('begetter-is-birth-parent', { person: p.name, parent: name(id) }, [p.id, id]);
}

/**
 * The links that the tree draws for a person (D332, D371 (4)): the begetter entry of an id that is also a birth parent of the person is
 * left out, and so is the rumoured entry of an id that the note writes as a birth parent (`rumouredBirthParents`), so the birth link wins
 * in every reader of the drawn links. The note keeps both entries. `written` is the person's parent list as parsed; `valid` is never changed.
 */
export function drawnLinks<T extends Link>(written: readonly { id: string; type: string }[], valid: T[]): T[] {
	const links = withoutDoubledBegetter(valid);
	const doubled = [...rumouredBirthParents(written, links), ...rumouredBegetters(written, links)];
	if (!doubled.length) return links;
	const drop = new Set(doubled);
	return links.filter((r) => r.type !== 'rumoured' || !drop.has(r.id));
}

/** The cleaned links without the begetter entry of an id that is also a birth parent (D332). The input is never changed. */
function withoutDoubledBegetter<T extends Link>(valid: T[]): T[] {
	if (!valid.some((r) => r.type === 'begetter')) return valid;
	const birth = new Set(valid.filter((r) => r.type === 'birth').map((r) => r.id));
	return valid.some((r) => r.type === 'begetter' && birth.has(r.id)) ? valid.filter((r) => r.type !== 'begetter' || !birth.has(r.id)) : valid;
}

/**
 * D371 (4): the ids that the note of a person writes with the type word `birth` (or as a bare id) and also as a rumoured parent, in the
 * order of the cleaned links. An id whose birth reading comes only from a type word the plugin does not know is not one of them: that
 * entry already warns as `unknown-parent-type`, and both of its links stay drawn.
 */
function rumouredBirthParents(written: readonly { id: string; type: string }[], valid: readonly Link[]): string[] {
	if (!valid.some((r) => r.type === 'rumoured')) return [];
	const birth = new Set<string>();
	for (const r of written) if (r.type === 'birth') birth.add(r.id);
	return valid.filter((r) => r.type === 'rumoured' && birth.has(r.id)).map((r) => r.id);
}

/**
 * D375 (4): the ids of the cleaned links that are a rumoured parent and a kept begetter (the known word `begetter`) of the person, and not
 * also written as `birth`: the birth case has its own rules and warnings, and the begetter entry of a birth id is already gone from `valid`.
 */
function rumouredBegetters(written: readonly { id: string; type: string }[], valid: readonly Link[]): string[] {
	if (!valid.some((r) => r.type === 'rumoured') || !valid.some((r) => r.type === 'begetter')) return [];
	const begetters = new Set(valid.filter((r) => r.type === 'begetter').map((r) => r.id));
	const birth = new Set(written.filter((r) => r.type === 'birth').map((r) => r.id));
	return [...new Set(valid.filter((r) => r.type === 'rumoured' && begetters.has(r.id) && !birth.has(r.id)).map((r) => r.id))];
}

/** D371 (4): one `rumoured-is-birth-parent` warning for each id that `p` writes as a birth parent and as a rumoured parent, with the ids of the person and the parent. */
export function rumourWarnings(p: Person, valid: readonly Link[], name: (id: string) => string, warn: Warn): void {
	for (const id of rumouredBirthParents(p.parents, valid)) warn('rumoured-is-birth-parent', { person: p.name, parent: name(id) }, [p.id, id]);
	// D375 (4): the same for a begetter who is not also a birth parent.
	// The links cleaned as `drawnLinks` cleans them: a begetter dropped by D332 (also when a misspelt word reads as birth) never warns here.
	for (const id of rumouredBegetters(p.parents, withoutDoubledBegetter([...valid]))) warn('rumoured-is-begetter', { person: p.name, parent: name(id) }, [p.id, id]);
}

/**
 * D332: a begetter who shares a listed marriage (a union of type marriage or of a type the plugin does not know) with a birth parent
 * of the person. A betrothal, a concubinage, an affair and an implicit union never warn: a child of an affair raised by the
 * mother's husband is a valid case. One warning per person, begetter and birth parent, in the order of the people and their links.
 */
export function begetterMarriageWarnings(people: readonly Person[], refs: ReadonlyMap<string, readonly ParentRef[]>, unions: readonly Union[], name: (id: string) => string, warn: Warn): void {
	const married = new Set<string>();
	for (const u of unions) if (u.type === 'marriage' || !isUnionType(u.type)) married.add(JSON.stringify([...u.partners].sort()));
	if (!married.size) return;
	for (const p of people) {
		const links = refs.get(p.id) ?? [];
		const birth = links.filter((r) => r.type === 'birth').map((r) => r.id);
		for (const b of links) {
			if (b.type !== 'begetter') continue;
			for (const q of birth) if (q !== b.id && married.has(JSON.stringify([b.id, q].sort()))) warn('begetter-married-to-parent', { person: p.name, parent: name(b.id), partner: name(q) }, [p.id, b.id, q]);
		}
	}
}

/**
 * D332, the rule of an edit for a parent link of `id` with `type`, beside the other links of the child (`others`, the changed link left
 * out): 'clash' if `id` would be a birth parent and a begetter of the child, 'limit' if the distinct parents by blood would be more than
 * `BLOOD_LIMIT`; D375 (3): 'rumoured-exists' (a birth link for an id that is a rumoured parent already) and 'birth-exists' (the reverse). A link of another type passes. So a change between birth and begetter on one link never meets the limit by blood.
 */
export function bloodProblem(others: readonly { id: string; type: string }[], id: string, type: string): 'clash' | 'limit' | 'rumoured-exists' | 'birth-exists' | undefined {
	// D375 (3): an id is never both a birth parent and a rumoured parent of one child through a window; every other pair stays allowed.
	if (type === 'birth' && others.some((r) => r.id === id && r.type === 'rumoured')) return 'rumoured-exists';
	if (type === 'rumoured' && others.some((r) => r.id === id && r.type === 'birth')) return 'birth-exists';
	if (!isBloodType(type)) return undefined;
	const blood = others.filter((r) => isBloodType(r.type));
	if (blood.some((r) => r.id === id && r.type !== type)) return 'clash';
	return new Set([...blood.map((r) => r.id), id]).size > BLOOD_LIMIT ? 'limit' : undefined;
}

/** `bloodProblem` as the refusal of an edit: `limit`, or `bad-value` with the text of the clash (`alreadyBloodParent`, `alreadyRumouredParent`, `alreadyBirthParent`). */
export function bloodRefusal(others: readonly { id: string; type: string }[], id: string, type: string): Refusal | undefined {
	const why = bloodProblem(others, id, type);
	if (why === 'limit') return refuse('limit');
	if (why === 'rumoured-exists') return refuse('bad-value', REFUSAL_TEXT.alreadyRumouredParent);
	if (why === 'birth-exists') return refuse('bad-value', REFUSAL_TEXT.alreadyBirthParent);
	return why ? refuse('bad-value', REFUSAL_TEXT.alreadyBloodParent) : undefined;
}

/** The distinct parents by blood (birth and begetter links) of `links`, in their order: the blood set of a child (D332). */
export function bloodSet(links: readonly { p: number; type: ParentType }[]): number[] {
	const seen = new Set<number>();
	for (const l of links) if (isBloodType(l.type)) seen.add(l.p);
	return [...seen];
}
