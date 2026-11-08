/*
 * The parents by blood of a person (spec §0 D332): birth parents and begetters together. `validate.ts` calls the three warnings and the
 * rule that a begetter who is also a birth parent of the same child is not drawn twice; the edits (`relationship-ops.ts`, `family-query.ts`)
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
 * The links that the tree draws for a person: the begetter entry of an id that is also a birth parent of the person is left out,
 * so the birth link wins in every reader of the drawn links (D332). The note keeps both entries. The input is never changed.
 */
export function withoutDoubledBegetter<T extends Link>(valid: T[]): T[] {
	if (!valid.some((r) => r.type === 'begetter')) return valid;
	const birth = new Set(valid.filter((r) => r.type === 'birth').map((r) => r.id));
	return valid.some((r) => r.type === 'begetter' && birth.has(r.id)) ? valid.filter((r) => r.type !== 'begetter' || !birth.has(r.id)) : valid;
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
 * `BLOOD_LIMIT`. A link of another type passes. So a change between birth and begetter on one link never meets the limit by blood.
 */
export function bloodProblem(others: readonly { id: string; type: string }[], id: string, type: string): 'clash' | 'limit' | undefined {
	if (!isBloodType(type)) return undefined;
	const blood = others.filter((r) => isBloodType(r.type));
	if (blood.some((r) => r.id === id && r.type !== type)) return 'clash';
	return new Set([...blood.map((r) => r.id), id]).size > BLOOD_LIMIT ? 'limit' : undefined;
}

/** `bloodProblem` as the refusal of an edit: `limit`, or `bad-value` with `REFUSAL_TEXT.alreadyBloodParent`. */
export function bloodRefusal(others: readonly { id: string; type: string }[], id: string, type: string): Refusal | undefined {
	const why = bloodProblem(others, id, type);
	return why === 'limit' ? refuse('limit') : why ? refuse('bad-value', REFUSAL_TEXT.alreadyBloodParent) : undefined;
}

/** The distinct parents by blood (birth and begetter links) of `links`, in their order: the blood set of a child (D332). */
export function bloodSet(links: readonly { p: number; type: ParentType }[]): number[] {
	const seen = new Set<number>();
	for (const l of links) if (isBloodType(l.type)) seen.add(l.p);
	return [...seen];
}
