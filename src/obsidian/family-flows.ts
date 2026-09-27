/*
 * Add parent, Add child and Add partner (spec §6.4) as a few small steps: choices, then the picker
 * (spec §6.6) or a new-person sheet. The sheet that starts a flow writes the result together with
 * its own unsaved draft (spec §6.3).
 */

import { Notice, type App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import type { Op, ParentKind, UnionKind, UnionRef } from '../core/edit';
import { PARENT_TYPES, UNION_TYPES, type Person } from '../core/types';
import { FLOW, parentTypeText, partnerDetail, UNION_TYPE_TEXT } from '../render/ui-text';
import type { Written } from './block-handle';
import { choose, type Choice } from './choice-modal';
import { pickerExclusions, type FamilyView } from '../core/family-query';
import { pickPerson } from './person-picker';

/** How a new person joins the tree: alone, as a parent, as a child, or as a partner. */
export type NewRelation =
	| { kind: 'person' }
	| { kind: 'parent'; child: string; type: ParentKind }
	| { kind: 'child'; parent: string; other: string | null; union?: UnionRef }
	| { kind: 'partner'; partner: string };

/** What an Add flow needs from the sheet that starts it. */
export interface FlowHost {
	app: App;
	g: FamilyGraph;
	person: Person;
	fam: FamilyView;
	name(id: string): string;
	/** False, with the reason shown in the sheet, if the sheet's draft cannot be written now. */
	ready(): boolean;
	/** Writes the ops together with the sheet's draft; null if nothing was written. */
	commit(ops: Op[], highlight: string): Promise<Written | null>;
	openNew(rel: NewRelation, name?: string): void;
}

const NONE = '\u0000none';

/** Types with room for `need` more parents, given the parent entries a person has now. */
function roomFor(links: { id: string; type: string }[], t: string, need: number): boolean {
	return links.filter((l) => l.type === t).length + need <= 2;
}

/** The Notice when the write added a marriage by itself (spec §6.4). */
export function autoUnionNotice(out: Written, a: string, b: string | undefined): void {
	if (out.effects.includes('auto-union') && b) new Notice(FLOW.autoUnion(a, b), 10_000);
}

/** First choice of every Add flow: a new person, or one already in the tree. */
async function newOrExisting(host: FlowHost, what: string, exclude: Set<string>): Promise<'new' | 'existing' | null> {
	const any = host.g.people.some((p) => !exclude.has(p.id));
	return choose<'new' | 'existing'>(host.app, {
		name: 'new-or-existing',
		title: what === 'parent' ? FLOW.addParentTitle : what === 'child' ? FLOW.addChildTitle : FLOW.addPartnerTitle,
		text: [FLOW.newOrExisting(host.person.name, what)],
		choices: [
			{ value: 'new', label: FLOW.newPerson, detail: FLOW.newPersonDetail, cta: true },
			{ value: 'existing', label: FLOW.existingPerson, detail: any ? FLOW.existingPersonDetail : FLOW.noneToPick, disabled: !any },
		],
	});
}

/** Add parent (spec §6.4): parent type, then new or existing person, then the write. */
export async function addParent(host: FlowHost): Promise<void> {
	if (!host.ready()) return;
	const p = host.person;
	const type = await choose<ParentKind>(host.app, {
		name: 'parent-type',
		title: FLOW.addParentTitle,
		text: [FLOW.parentTypeText(p.name)],
		choices: (PARENT_TYPES as readonly ParentKind[]).map((t) => {
			const full = host.fam.fullTypes.includes(t);
			return { value: t, label: parentTypeText(t), detail: full ? FLOW.typeFull : undefined, disabled: full, cta: t === 'birth' && !full };
		}),
	});
	if (!type) return;
	const exclude = pickerExclusions(host.g, p.id, 'add-parent', type);
	const how = await newOrExisting(host, 'parent', exclude);
	if (!how) return;
	if (how === 'new') {
		host.openNew({ kind: 'parent', child: p.id, type });
		return;
	}
	const picked = await pickPerson(host.app, host.g, exclude, FLOW.pickerParent, FLOW.addParentTitle);
	if (!picked) return;
	if (picked.kind === 'new') {
		host.openNew({ kind: 'parent', child: p.id, type }, picked.name);
		return;
	}
	const other = host.fam.parents.find((l) => l.type === type)?.id;
	const out = await host.commit([{ kind: 'add-parent', child: p.id, parent: picked.id, type }], p.id);
	if (out) autoUnionNotice(out, host.name(picked.id), other && host.name(other));
}

/** Add child (spec §6.4): other parent, then new or existing person, then, for an existing child who has birth parents, the parent type, then the write. */
export async function addChild(host: FlowHost): Promise<void> {
	if (!host.ready()) return;
	const p = host.person;
	let other: string | null = null;
	let union: UnionRef | undefined;
	// One choice per partnership, in union order, then implicit co-parents (spec §6.4): a pair with
	// two partnerships gets two choices, and the child goes under the one chosen (§4.3).
	const partnerships = host.fam.partners;
	const extra = host.fam.otherParentChoices.filter((id) => !partnerships.some((l) => l.partner === id));
	if (partnerships.length || extra.length) {
		const choices: Choice<string>[] = [
			...partnerships.map((l, i) => ({ value: `p${i}`, label: host.name(l.partner), detail: partnerDetail(l.type, l.start, l.end), cta: i === 0 })),
			...extra.map((id) => ({ value: `x${id}`, label: host.name(id) })),
			{ value: NONE, label: FLOW.noOtherParent, detail: FLOW.noOtherParentDetail(p.name) },
		];
		const pick = await choose(host.app, { name: 'other-parent', title: FLOW.addChildTitle, text: [FLOW.otherParentText(p.name)], choices });
		if (pick === null) return;
		if (pick.startsWith('p')) {
			const l = partnerships[Number(pick.slice(1))];
			other = l.partner;
			union = l.union ?? undefined;
		} else if (pick.startsWith('x')) other = pick.slice(1);
	}
	const exclude = pickerExclusions(host.g, p.id, 'add-child');
	if (other) for (const id of pickerExclusions(host.g, other, 'add-child')) exclude.add(id);
	// People who have this person as a birth parent are this person's children already (the decision notes "Union references").
	for (const q of host.g.people) if (q.parents.some((l) => l.id === p.id && l.type === 'birth')) exclude.add(q.id);
	const how = await newOrExisting(host, 'child', exclude);
	if (!how) return;
	if (how === 'new') {
		host.openNew({ kind: 'child', parent: p.id, other, union });
		return;
	}
	const picked = await pickPerson(host.app, host.g, exclude, FLOW.pickerChild, FLOW.addChildTitle);
	if (!picked) return;
	if (picked.kind === 'new') {
		host.openNew({ kind: 'child', parent: p.id, other, union }, picked.name);
		return;
	}
	const child = host.g.byId.get(picked.id);
	if (!child) return;
	const links = child.parents.filter((l) => host.g.byId.has(l.id));
	const parents = other ? [p.id, other] : [p.id];
	const missing = (t: string) => parents.filter((id) => !links.some((l) => l.id === id && l.type === t));
	let type: ParentKind = 'birth';
	// Spec §6.4: an existing child who has birth parents gets a choice of type.
	if (links.some((l) => l.type === 'birth')) {
		const who = other ? `${host.name(p.id)} and ${host.name(other)}` : host.name(p.id);
		const chosen = await choose<ParentKind>(host.app, {
			name: 'child-type',
			title: FLOW.childTypeTitle,
			text: [other ? FLOW.childTypeText(child.name, who) : FLOW.childTypeTextOne(child.name, who)],
			choices: (PARENT_TYPES as readonly ParentKind[]).map((t) => {
				const need = missing(t).length;
				const ok = need > 0 && roomFor(links, t, need);
				return { value: t, label: parentTypeText(t), detail: ok ? undefined : need === 0 ? FLOW.alreadyChild(child.name, who) : FLOW.childTypeFull, disabled: !ok };
			}),
		});
		if (!chosen) return;
		type = chosen;
	}
	const add = missing(type);
	if (!add.length) {
		new Notice(FLOW.alreadyChild(child.name, host.name(p.id)));
		return;
	}
	// Only the Add parent action adds an automatic marriage (the decision notes). The op that completes
	// the pair carries the chosen partnership, so the child sits under it (§4.3).
	const ops: Op[] = add.map((id, i) => ({ kind: 'add-parent', child: child.id, parent: id, type, autoUnion: false, ...(union && i === add.length - 1 ? { union } : {}) }));
	await host.commit(ops, child.id);
}

/** Add partner (spec §6.4): new or existing person, existing partnerships shown first, then the union type. */
export async function addPartner(host: FlowHost): Promise<void> {
	if (!host.ready()) return;
	const p = host.person;
	const exclude = pickerExclusions(host.g, p.id, 'add-spouse');
	const how = await newOrExisting(host, 'partner', exclude);
	if (!how) return;
	if (how === 'new') {
		host.openNew({ kind: 'partner', partner: p.id });
		return;
	}
	const picked = await pickPerson(host.app, host.g, exclude, FLOW.pickerPartner, FLOW.addPartnerTitle);
	if (!picked) return;
	if (picked.kind === 'new') {
		host.openNew({ kind: 'partner', partner: p.id }, picked.name);
		return;
	}
	const x = picked.id;
	// Spec §6.4: show the pair's partnerships first, so a second one is not added by accident.
	const existing = host.fam.partners.filter((l) => l.partner === x && l.union);
	if (existing.length) {
		const go = await choose<boolean>(host.app, {
			name: 'existing-partnership',
			title: FLOW.existingTitle,
			text: [FLOW.existingText(p.name, host.name(x), existing.length)],
			list: existing.map((l) => partnerDetail(l.type, l.start, l.end)),
			after: [FLOW.existingWarn],
			// The header has the one Cancel control.
			choices: [{ value: true, label: FLOW.addAnother }],
		});
		if (!go) return;
	}
	const type = await chooseUnionType(host.app, p.name, host.name(x));
	if (!type) return;
	await host.commit([unionOp(p.id, x, type)], x);
}

/** Asks which kind of partnership `a` and `b` have; null after Cancel. */
export function chooseUnionType(app: App, a: string, b: string): Promise<UnionKind | null> {
	return choose<UnionKind>(app, {
		name: 'union-type',
		title: FLOW.unionTypeTitle,
		text: [FLOW.unionTypeText(a, b)],
		choices: (UNION_TYPES as readonly UnionKind[]).map((t) => ({ value: t, label: UNION_TYPE_TEXT[t], cta: t === 'marriage' })),
	});
}

/** Marriage is the default type, so it is not written (spec §4.1). */
export function unionOp(a: string, b: string, type: string): Op {
	return type === 'marriage' ? { kind: 'add-union', partners: [a, b] } : { kind: 'add-union', partners: [a, b], type: type as UnionKind };
}
