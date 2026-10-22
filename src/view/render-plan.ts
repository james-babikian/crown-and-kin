/*
 * The decisions of one render of a `kin` block, with no DOM and no Obsidian (architecture review F1 part b, 0.3.2). `planRender` takes
 * the parse result and the facts of the view and the block (settings, device, session memory) and returns what to draw (`RenderPlan`)
 * and what the view must change in its session memory (`StateChanges`). It changes none of its inputs, so a test runs it on plain
 * data and a second call with the same inputs gives an equal result. `TreeView.render` applies the changes, then builds the DOM
 * from the plan. A new kind of view is a new branch here, not a new concern of the view class. The relation lookup and the layout
 * stay in the view: the plan only says that and how they run.
 */

import type { DateReader } from '../core/dates';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import { focusGenerationsFor, focusSubgraph, type FocusSubgraphResult } from '../core/focus-subgraph';
import { pruneFolds, unfoldFor, type FoldSet } from '../core/folds';
import { findRelation, lineSubgraph, type FinderResult, type RelationLine } from '../core/relations';
import { cardLabels, needsLabels, type CardLabel } from '../core/titles';
import type { HardError } from '../core/messages';
import type { ParseResult, Tree } from '../core/types';
import { cardForm, geometryFor } from '../layout/geometry';
import { DEFAULT_FAR_RULE, NEVER_FAR_RULE } from '../layout/index';
import type { Geometry, LayoutSettings, Orientation } from '../layout/model';
import type { FontState } from '../render/fonts';
import { startPerson } from '../render/tree-info';
import { focusKey, type BlockState, type FinderState } from './block-state';
import { PHONE_FOCUS_MIN_PEOPLE, chooseFocus } from './focus-mode';
import { autoFoldPatch, planFolds, stillAuto, withFolds, type AutoFocus, type FoldPlan } from './fold-view';
import { drawnBar, largeBar, peopleCount, type LargeBar } from './large-tree';
import { validMe } from './relation-cache';
import type { DynastySettings } from './settings';
import { startFolds, wholeFactsOf } from './start-folds';
import { linePeople, successionDrawn, type SuccessionDrawn } from './succession-view';

/** The relation finder's result as one view draws it (spec §13.2). */
export interface FinderDrawn {
	/** The block's own finder state (the same object, never a copy): the buttons of the result bar change it. */
	state: FinderState;
	result: FinderResult;
	/** The line of the relation that shows, or of the chain; null when the two people have no relation. */
	line: RelationLine | null;
}

/** What `planRender` knows of the full-screen view; null for an embed in a note. */
export interface FullFacts {
	/** D21: this view's own focus (`id: null` is all people), or null. */
	focus: { id: string | null } | null;
	/** A person to centre and show when the view opens. */
	target: string | null;
}

/** Everything `planRender` reads. Nothing in it is changed. */
export interface RenderInputs {
	parsed: ParseResult;
	settings: DynastySettings;
	/** The block's session memory, read only. A block with none yet passes a fresh `newBlockState()`. */
	state: BlockState;
	/** A coarse pointer (a touch screen). */
	coarse: boolean;
	/** The device is a phone (`isPhoneDevice`). */
	phone: boolean;
	full: FullFacts | null;
	orientation: Orientation;
	/** A person that a flow asked this view to show (Find outside the focus family). */
	pendingTarget: readonly string[] | null;
	/** The focus rules have run once in this view (F5). */
	stopChecked: boolean;
	/** A draw of this block text with this many people took too long before (spec §7.7). */
	stopped(count: number): boolean;
	/** The fonts of the block; called once, and only when a tree is to be drawn (it reads the page). */
	fonts(): FontState;
	/** The clock of the render timing, read once, right after the derive (spec §7.7). */
	clock(): number;
	/** Spec §14 rule 9: the date reader of this tree (its calendars); absent: plain years, as before. */
	dates?: DateReader;
}

/** The changes to the block state `st` that a render makes. A key that is absent means no change. */
export type BlockPatch = Partial<Pick<BlockState, 'focus' | 'autoFocus' | 'autoMark' | 'shown' | 'finder' | 'succession' | 'folds' | 'autoFolds' | 'autoFor'>>;

/** What the view applies before it draws, so that the render is the one place where state changes. */
export interface StateChanges {
	block: BlockPatch;
	/** The result shown is now this one (an edit left fewer relations), on `block state.finder`. */
	finderIndex?: number;
	/** The result shows in the whole tree, so that a person outside its line can be centred. */
	finderWhole?: true;
	/** A full-screen view drew all people: its own focus is `{ id: null }`. */
	fullFocus?: { id: null };
	/** The view shows this person in its next first view. */
	pendingTarget?: string[];
	/** The focus rules ran: `stopChecked` becomes true. */
	stopChecked?: true;
	/** The session focus changed, so every other view of the block draws again. */
	sessionChanged: boolean;
}

/** What follows a parse that read: the tree, the derived graph and the clock after the derive. */
interface Derived {
	tree: Tree;
	/** The people of the parsed tree, counted before the derive (spec §7.7). */
	count: number;
	whole: FamilyGraph;
	t1: number;
}

/** The decisions of a render that drew a tree (not a list, a bar, an error or an empty block). */
export interface TreePlan extends Derived {
	kind: 'tree';
	fonts: FontState;
	geo: Geometry;
	/** The graph that is drawn: the whole tree, the focus family or the small tree of the line. */
	g: FamilyGraph;
	/** The focus family, when one is drawn (its `hidden` counts give the `+` badges). */
	sub: FocusSubgraphResult | null;
	/** The focus person that was asked; the focus family is drawn only when `sub` is set. */
	focus: string | null;
	finder: FinderDrawn | null;
	succession: SuccessionDrawn | null;
	/** The marked person (spec §13.1), or null. */
	me: string | null;
	/** The marked person whose relation lookup of the whole tree the cards need; null for none and for the small tree of the line. */
	relationsFor: string | null;
	canFold: boolean;
	foldPlan: FoldPlan;
	labels: ReadonlyMap<string, CardLabel> | undefined;
	laidBase: LayoutSettings;
	/** The small tree of the line drawn top to bottom as well, for an upright phone (D51). */
	alt: { geo: Geometry; base: LayoutSettings } | null;
	/** The whole tree is drawn: the draw has a time budget (spec §7.7). */
	budget: boolean;
	/** The bar to show when the budget stops the layout. */
	onStop: LargeBar;
	/** The key of the saved view (`BlockState.viewFor`), with and without the direction. */
	familyKey: string;
	drawnKey: string;
	focusId: string | null;
}

/** What to draw. */
export type RenderPlan =
	| { kind: 'invalid-full' }
	| { kind: 'error'; error: HardError }
	| ({ kind: 'empty' } & Derived)
	| ({ kind: 'list' } & Derived)
	| ({ kind: 'bar'; bar: LargeBar; barCount: number } & Derived)
	| TreePlan;

/** The changes while a render is planned. */
interface Draft {
	block: BlockPatch;
	finderIndex?: number;
	finderWhole?: true;
	fullFocus?: { id: null };
	pendingTarget?: string[];
	stopChecked?: true;
	sessionChanged: boolean;
}

const draftOf = (): Draft => ({ block: {}, sessionChanged: false });

const changesOf = (d: Draft): StateChanges => ({ ...d });

/** The facts of the focus step: the focus person, the generations and the family. */
interface FocusStep {
	focus: string | null;
	n: number;
	sub: FocusSubgraphResult | null;
	small: RelationLine | null;
	finder: FinderDrawn | null;
	succession: SuccessionDrawn | null;
}

/**
 * Plans one render. A parse that failed gives `error` (`invalid-full` in the full-screen view, which closes). A block with no people gives `empty`; a tree
 * in a note on a phone gives `list`. Otherwise the focus, the folds, the finder, the Show view and the size gates are decided: `bar` when a bar takes the
 * place of the tree, else `tree` with what the view needs to lay it out.
 */
export function planRender(inputs: RenderInputs): { plan: RenderPlan; stateChanges: StateChanges } {
	const none = (plan: RenderPlan) => ({ plan, stateChanges: changesOf(draftOf()) });
	const { parsed } = inputs;
	if (!parsed.ok) return none(inputs.full ? { kind: 'invalid-full' } : { kind: 'error', error: parsed.error });
	// 0.3 (spec §7.7, size limits): the people are counted right after the parse, before the derive, the relations and the layout.
	const count = peopleCount(parsed.tree);
	// A.5: "Warn about more than 2 parents of a type". The derive is not cached (`parse-cache.ts`), so the setting needs no cache key.
	const whole = deriveFamilies(parsed.tree, { warnManyParents: inputs.settings.warnManyParents, ...(inputs.dates ? { dates: inputs.dates } : {}) });
	const derived: Derived = { tree: parsed.tree, count, whole, t1: inputs.clock() };
	if (!whole.people.length && !whole.issues.some((i) => i.level === 'blocking')) return none({ kind: 'empty', ...derived });
	// D144: a tree in a note on a phone is a list. No fonts, no layout, no scene.
	if (!inputs.full && inputs.coarse && inputs.phone) return none({ kind: 'list', ...derived });
	const d = draftOf();
	const plan = planTreePart(inputs, derived, d);
	return { plan, stateChanges: changesOf(d) };
}

/** The tree part of the plan, once the block is known to draw something. */
function planTreePart(inputs: RenderInputs, derived: Derived, d: Draft): RenderPlan {
	const { tree, whole, count } = derived;
	const fonts = inputs.fonts();
	const f = focusStep(inputs, tree, whole, d);
	const bar = sizeGate(inputs, f, count);
	if (bar) return { kind: 'bar', ...derived, bar: bar.bar, barCount: bar.count };
	return layoutPlan(inputs, derived, f, fonts, d);
}

/** Folds that no family has any more end with the parse (F9); the rest of the block's folds stay. */
function pruneBlockFolds(whole: FamilyGraph, st: BlockState, d: Draft): void {
	const kept = pruneFolds(whole, st.folds);
	if (kept !== st.folds) d.block.folds = new Set(kept);
}

/**
 * The focus, the finder's result, the Show view and the focus family (spec §5.6, §13.2, contract 0.2.7 F.1). The result of the finder and the Show view
 * are computed again from the new text at each render; with a line they replace the focus family (the search uses the whole tree).
 */
function focusStep(inputs: RenderInputs, tree: Tree, whole: FamilyGraph, d: Draft): FocusStep {
	const st = inputs.state;
	const focus = focusPerson(inputs, tree, whole, d);
	pruneBlockFolds(whole, st, d);
	const succession = successionFor(inputs, whole, d);
	const finder = succession ? null : finderFor(inputs, whole, d);
	// A tag or a problem in the static preview opened this view on a person (D17). If the small tree of the line does not draw them,
	// the result shows in the whole tree, so the person can be centred.
	const target = inputs.full?.target;
	if (finder?.line && !finder.state.whole && target && whole.byId.has(target) && !finder.line.people.includes(target)) d.finderWhole = true;
	const small = finder?.line && !(finder.state.whole || d.finderWhole) ? finder.line : null;
	const n = focusGenerationsFor(tree.options, inputs.settings.focusGenerations);
	const sub = focusFamily(inputs, tree, whole, { focus, n, finder, succession }, d);
	return { focus, n, sub, small, finder, succession };
}

/** The focus family to draw, or null. A person that this view must show but its family does not draw makes it show all people. */
function focusFamily(inputs: RenderInputs, tree: Tree, whole: FamilyGraph, f: Pick<FocusStep, 'focus' | 'n' | 'finder' | 'succession'>, d: Draft): FocusSubgraphResult | null {
	const st = inputs.state;
	const target = inputs.full?.target;
	let sub = f.focus !== null && !f.finder?.line && !f.succession ? focusSubgraph(tree, f.focus, f.n) : null;
	// A tag or a problem in the static preview opened this view on a person its family does not draw:
	// this view shows all people (D21: its own focus), so the person can be centred.
	if (inputs.full && sub && target && whole.byId.has(target) && !sub.tree.people.some((p) => p.id === target)) {
		d.fullFocus = { id: null };
		sub = null;
	}
	// §5.5: a person just saved is shown once, by the first view of the kind that saved them.
	// If its family does not draw them, it shows all people, like Find.
	const saved = st.shown;
	if (saved && saved.place === (inputs.full ? 'full' : 'embed')) {
		d.block.shown = null;
		if (sub && whole.byId.has(saved.id) && !sub.tree.people.some((p) => p.id === saved.id)) {
			// A D21 full-screen view changes only its own focus; otherwise the session changes.
			if (inputs.full?.focus) d.fullFocus = { id: null };
			else {
				d.block.focus = { id: null };
				d.sessionChanged = true;
			}
			d.pendingTarget = [saved.id];
			sub = null;
		}
	}
	return sub;
}

/**
 * The focus person to draw, or null for the whole tree (priority order: session focus, pin, the phone rule of D20, whole tree). It also
 * plans the block state: it drops a session focus that no longer applies and stores the D20 automatic focus.
 */
function focusPerson(inputs: RenderInputs, tree: Tree, whole: FamilyGraph, d: Draft): string | null {
	// D21: a full-screen view opened by a badge tap in a static embed shows that family, until the user chooses another focus there.
	const own = inputs.full?.focus;
	if (own && (own.id === null || whole.byId.has(own.id))) return own.id;
	const st = inputs.state;
	// F5: only the first render of a full-screen view asks. The user chose Clear focus before, and the draw of the whole tree stopped: Expand opens the family, not the stop bar.
	const stopped = !!inputs.full && !inputs.stopChecked && inputs.stopped(peopleCount(tree));
	d.stopChecked = true;
	// D234: the stored automatic focus follows the mark; a mark added, changed or removed since it was chosen chooses again (an edit still does not move it).
	const mark = validMe(whole, tree.options.me) ?? null;
	const auto = st.autoFocus !== null && (st.autoMark ?? null) !== mark ? null : st.autoFocus;
	const choice = chooseFocus({
		session: st.focus,
		pin: tree.options.focus,
		phone: inputs.phone,
		auto,
		has: (id) => whole.byId.has(id),
		large: () => whole.people.length > PHONE_FOCUS_MIN_PEOPLE,
		// Spec §5.5, D234: the person last edited, `options.start`, the marked person, the first root. A mark that names nobody is no mark. Called only on a phone.
		start: () => startPerson(whole, [st.lastEdited, tree.options.start, mark].find((id) => id != null && whole.byId.has(id)) ?? undefined),
		stopped,
	});
	if (choice.dropSession) d.block.focus = null;
	d.block.autoFocus = choice.auto;
	d.block.autoMark = mark;
	return choice.id;
}

/**
 * The finder's result to draw, from the block state and the whole tree: computed again at each render, so it follows every edit. A result whose
 * person left the tree closes (spec §13.2). The static touch preview never draws one (D1): the full-screen view shows it.
 */
function finderFor(inputs: RenderInputs, whole: FamilyGraph, d: Draft): FinderDrawn | null {
	const f = inputs.state.finder;
	if (!f) return null;
	if (f.first === f.second || !whole.byId.has(f.first) || !whole.byId.has(f.second)) {
		d.block.finder = null;
		return null;
	}
	if (!inputs.full && inputs.coarse) return null;
	const result = findRelation(whole, f.first, f.second, { oneParentUnknown: inputs.settings.oneParentUnknown });
	const count = result.kind === 'named' ? result.relations.length : 1;
	// An edit can leave fewer relations than the one that showed.
	let index = f.index;
	if (!(index >= 0 && index < count)) {
		index = 0;
		d.finderIndex = 0;
	}
	const line = result.kind === 'named' ? (result.relations[index]?.relation.line ?? null) : result.kind === 'chain' ? result.line : null;
	return { state: f, result, line };
}

/** What decides whether the Show view draws in a tree: the device and the view. */
export interface ShowDevice {
	full: boolean;
	coarse: boolean;
	phone: boolean;
}

/**
 * The Show view to draw, from the block state and the whole tree: computed again at each render, so it follows every edit (F.7). A title that is gone,
 * or a saved line that is not `kind: 'line'` any more, ends the view (F.1): `ended` is then true and the caller clears `succession` in the block state.
 * The static touch preview never draws the tree view (D1); the list on a phone draws the bar (F.6).
 */
export function showViewOf(st: BlockState, whole: FamilyGraph, set: DynastySettings, device: ShowDevice): { drawn: SuccessionDrawn | null; ended: boolean } {
	const s = st.succession;
	if (!s) return { drawn: null, ended: false };
	const drawn = successionDrawn(whole, s.title, { limit: set.successionLength, oldAge: set.oldAge, youngDeathAge: set.youngDeathAge });
	if (!drawn) return { drawn: null, ended: true };
	return { drawn: !device.full && device.coarse && !device.phone ? null : drawn, ended: false };
}

/** The Show view of this render, and the change of the block state when it ended. */
function successionFor(inputs: RenderInputs, whole: FamilyGraph, d: Draft): SuccessionDrawn | null {
	const { drawn, ended } = showViewOf(inputs.state, whole, inputs.settings, { full: !!inputs.full, coarse: inputs.coarse, phone: inputs.phone });
	if (ended) d.block.succession = null;
	return drawn;
}

/**
 * Spec §7.7, size limits: a render that would draw the WHOLE tree (no focus family, no short finder line) of a very large tree shows the low bar. D227 item 2: a
 * focus family that passes the top (a pin with a large `generations`) shows the bar like a whole tree; its count is the people it would draw.
 */
function sizeGate(inputs: RenderInputs, f: FocusStep, count: number): { bar: LargeBar; count: number } | null {
	const full = !!inputs.full;
	if (!f.small && !f.sub) {
		const bar = largeBar({ count, whole: true, full, phone: inputs.phone, tapped: inputs.state.largeTapped === true, stopped: inputs.stopped(count) });
		return bar ? { bar, count } : null;
	}
	if (!f.sub) return null;
	const drawn = f.sub.tree.people.length;
	const bar = drawnBar(drawn, full, inputs.phone);
	return bar ? { bar: { ...bar, family: true }, count: drawn } : null;
}

/** The layout settings of a marked tree (D145): the plate with the relation word, else the "You" tab. */
function markedSettings(s: LayoutSettings, relationLine: boolean, me: string | null): LayoutSettings {
	if (relationLine) return { ...s, relationLine: true };
	return me !== null ? { ...s, youTab: me } : s;
}

/** The ids only, never the texts (a cached layout would keep a stale text): the heirs and the open branches get a tab above their cards (0.2.7 F.4). */
function shapedSettings(s: LayoutSettings, relationLine: boolean, me: string | null, succession: SuccessionDrawn | null): LayoutSettings {
	const marked = markedSettings(s, relationLine, me);
	return succession ? { ...marked, ordinalCards: [...succession.ordinals.keys()] } : marked;
}

/** The folds of the drawn graph. A person that a flow asked for (a tag or a problem in the preview, Find outside the focus family) is shown (F11). */
function foldsFor(inputs: RenderInputs, whole: FamilyGraph, g: FamilyGraph, f: FocusStep, d: Draft): { foldPlan: FoldPlan; canFold: boolean } {
	// M10 (F1, F8): the computer and the full-screen view apply the folds; the static phone preview never does.
	const canFold = !!inputs.full || !inputs.coarse;
	let folds: FoldSet = d.block.folds ?? inputs.state.folds;
	const lineIds = f.succession ? linePeople(f.succession) : (f.finder?.line?.people ?? null);
	let foldPlan = planFolds(g, whole, folds, canFold, lineIds);
	if (canFold && foldPlan.hidden.size) {
		const pending = d.pendingTarget ?? inputs.pendingTarget;
		const asked = (inputs.full?.target ? [inputs.full.target] : (pending ?? [])).filter((id) => foldPlan.hidden.has(id));
		if (asked.length) {
			const next = new Set(unfoldFor(g, whole, folds, asked));
			folds = next;
			d.block.folds = next;
			foldPlan = planFolds(g, whole, folds, canFold, lineIds);
		}
	}
	return { foldPlan, canFold };
}

/**
 * What a draw does with the automatic folds (D257): a focus family drawn sideways (the phone held upright, D24) starts with the far families folded, once for each focus;
 * the whole tree ends them; a temporary view (the finder's line, the Show view), a view that cannot fold and a focus drawn top to bottom leaves them as they are while the focus is the same, and ends them when the focus is new.
 */
function autoFocusOf(inputs: RenderInputs, derived: Derived, f: FocusStep, g: FamilyGraph, canFold: boolean): AutoFocus {
	if (!canFold || f.finder?.line || f.succession) return { kind: 'keep' };
	if (!f.sub || f.focus === null) return { kind: 'clear' };
	const key = focusKey(f.focus, f.n);
	// Top to bottom nothing folds by itself, and a new focus must not keep the far families of the old one (they would fold the families of the new focus person). The same focus keeps them, so a turn of the phone changes nothing.
	if (inputs.orientation !== 'sideways') return key === inputs.state.autoFor ? { kind: 'keep' } : { kind: 'clear' };
	const { tree, whole } = derived;
	return { kind: 'enter', key, startKeys: () => startFolds(whole, () => wholeFactsOf(tree, whole), g, f.focus!).map((s) => s.key) };
}

/** Plans the automatic folds of this draw into the block's changes. They go into the folds before the fold plan reads them. */
function autoFoldsStep(inputs: RenderInputs, derived: Derived, f: FocusStep, g: FamilyGraph, d: Draft): void {
	const st = inputs.state;
	const canFold = !!inputs.full || !inputs.coarse;
	const step = autoFocusOf(inputs, derived, f, g, canFold);
	Object.assign(d.block, autoFoldPatch(d.block.folds ?? st.folds, d.block.autoFolds ?? st.autoFolds, 'autoFor' in d.block ? d.block.autoFor : st.autoFor, step));
}

/** A fold that left the folds in this draw (a person asked for was unfolded) is not an automatic fold any more. */
function settleAutoFolds(st: BlockState, d: Draft): void {
	const auto = d.block.autoFolds ?? st.autoFolds;
	const kept = stillAuto(d.block.folds ?? st.folds, auto);
	if (kept !== auto) d.block.autoFolds = kept;
}

/** The graph, the layout settings, the labels and the keys of the tree to draw. */
function layoutPlan(inputs: RenderInputs, derived: Derived, f: FocusStep, fonts: FontState, d: Draft): TreePlan {
	const { tree, whole } = derived;
	const { sub, small, finder, succession, focus, n } = f;
	const orientation = inputs.orientation;
	// D47: the small tree of the line has only its people, and a couple on it is never split.
	const g = small ? lineSubgraph(whole, small) : sub ? deriveFamilies(sub.tree, { dates: whole.dates.reader }) : whole;
	// Spec §13.1: the names come from the whole tree, also in focus mode.
	const me = validMe(whole, tree.options.me);
	autoFoldsStep(inputs, derived, f, g, d);
	const { foldPlan, canFold } = foldsFor(inputs, whole, g, f, d);
	settleAutoFolds(inputs.state, d);
	// D145: the plate with the relation word is part of the card only while the setting shows it, so the setting changes the layout.
	// Without the plate a marked person gets the "You" tab; so does the finder's small tree, which has no relation words.
	const relationsFor = me !== null && !small ? me : null;
	const relationLine = relationsFor !== null && inputs.settings.showRelations;
	const sideways: LayoutSettings = orientation === 'sideways' ? { sweeps: 4, far: DEFAULT_FAR_RULE, orientation } : { sweeps: 4, far: DEFAULT_FAR_RULE };
	const shape = (s: LayoutSettings) => withFolds(shapedSettings(s, relationLine, me, succession), foldPlan, canFold);
	// D51: on an upright phone the small tree is also laid out top to bottom, with the card form of that direction (the Roundel).
	const alt = small && orientation === 'sideways' ? { geo: cardForm(geometryFor(fonts.px), 'down'), base: shape({ sweeps: 4, far: NEVER_FAR_RULE }) } : null;
	// The finder's tree has its own key: its views never replace the saved view of the family.
	const fi = finder?.line ? `finder:${finder.state.first}>${finder.state.second}:${d.finderIndex ?? finder.state.index}:${finder.state.whole || d.finderWhole ? 'whole' : 'line'}|` : '';
	const finderKey = succession ? `succession:${succession.titleId}|` : fi;
	const wholeDraw = !small && !sub;
	return {
		kind: 'tree',
		...derived,
		fonts,
		// D143, D150: the card form of the direction (the Roundel top to bottom, the text card sideways).
		geo: cardForm(geometryFor(fonts.px), orientation),
		g,
		sub,
		focus,
		finder,
		succession,
		me,
		relationsFor,
		canFold,
		foldPlan,
		// Spec §13.3, §13.5: the card labels of the drawn graph. A tree with no titles draws as in M7 (no labels).
		labels: needsLabels(g) ? cardLabels(g) : undefined,
		laidBase: shape(small ? { ...sideways, far: NEVER_FAR_RULE } : sideways),
		alt,
		budget: wholeDraw,
		onStop: { kind: 'slow', limit: 0 },
		// A view of one family means nothing in another: the new family gets its own first view.
		familyKey: finderKey + focusKey(sub ? focus : null, n),
		drawnKey: finderKey + focusKey(sub ? focus : null, n, orientation),
		focusId: sub ? focus : null,
	};
}
