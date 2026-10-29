/*
 * The concepts of the card-and-line system, as types. Everything the system places or draws is one of these:
 * an item in a row (a card or a passage), a port on an item's edge, a family that hangs from a hang point, a couple with its legs,
 * and (in the route stage) verticals and nets in the gaps between rows. The plan, place and route stages share these types.
 * Two views of one tree: the `Skeleton` (what the graph and the order fix: items, couples, legs, families, without ports) and the
 * `Plan` (the skeleton with its ports, hang points, slot widths and minimum gaps, which `derive` in plan.ts builds from it). A field
 * that a stage sets later is never `undefined as unknown as T`: a leg has a port only in the plan, a family a hang only in the plan.
 */
import type { FoldControl } from '../core/folds';
import { soloKey } from '../core/order';
import type { PersonBox } from './model';

export { soloKey };

/** What a passage reserves room for: the line of a couple on two rows that passes this row, or the hang point of a family whose card's edge is full. */
type Carried = { kind: 'pass'; union: string } | { kind: 'hang'; family: string };

/** An item of a row layer: a person's card, or a passage (a narrow place that a line of another row, or a hang point, takes). */
export interface Item {
	id: string;
	kind: 'card' | 'passage';
	row: number;
	/** Extent along the row (x) and across it (y), in the frame the layout works in (the turned frame sideways). */
	w: number;
	h: number;
	/** Left edge along the row; set by the placement. */
	x: number;
	/** The block (rigid run of items) this item belongs to, and its index in its row (`reindex` keeps it current). */
	block: number;
	at: number;
	/** A passage: what it carries, and the x of its line inside its slot (set by the route stage; a hang passage's line is its middle). */
	carries?: Carried;
	line?: number;
	/** A card: the box flags of the person (tall name, pictures), as `PersonBox` carries them. */
	flags?: Partial<Pick<PersonBox, 'tallName' | 'longName' | 'tallTitle' | 'arms' | 'portrait'>>;
}

/** Where a line leaves or enters an item: a place on its bottom edge. */
export interface Port {
	item: Item;
	/** Distance from the item's left edge; set by the port packing of the plan. */
	offset: number;
	/**
	 * `hang`: a family's trunk starts here (the dot of a couple that is not side by side, or a single parent's trunk);
	 * `leg`: a line to a hang point elsewhere; `side`: a side link from one parent.
	 */
	kind: 'hang' | 'leg' | 'side';
	/** The family or line the port serves (a family key, or `side:<child>|<parent>`), for names only: never parsed. */
	key: string;
	/** Which side of the card the line goes to, for the order of the ports along the edge. */
	dir: 'left' | 'centre' | 'right';
	/** The item a leg or side line goes to (the first passage of a leg, else the partner or the hang passage; the child of a side link). */
	target?: Item;
	/** How far other verticals keep from this port: a dot radius plus 2 px, or more for a port whose stem carries a fold sign or button. */
	half: number;
	/** Half the width, along the edge, of the tap area of the fold control on this port's stem (spec §13.10: two tap areas never meet); absent without a control. */
	tap?: number;
	/** The legs that share this port (D228: one line, then a fork); the first is the port's own key. */
	shared: string[];
}

/** The absolute x of a port. */
export const portX = (p: Port): number => p.item.x + p.offset;

/** Where a family's trunk starts: a port of a card or a hang passage, or the dot on the bar between two side-by-side partners. */
export type Hang = { kind: 'port'; port: Port } | { kind: 'bar'; left: Item; right: Item; slot: number; count: number };

/** The row of a hang point: the row of its card or passage, or of the cards the bar joins; a dot or a trunk lies in the gap below it. */
export const hangRow = (h: Hang): number => (h.kind === 'port' ? h.port.item.row : h.left.row);

/** The family a fold control belongs to. */
export const familyKeyOf = (c: FoldControl): string => (c.union !== undefined ? c.union : soloKey(c.parents[0]));

/** A family before the ports: the children of a union, or of one parent alone, and who anchors them. A folded family (spec §13.10) has no shown child. */
export interface FamilySpec {
	key: string;
	union?: string;
	parents: string[];
	kids: string[];
	/** The person whose block carries the hang point. */
	anchor: string;
	/** The fold control on the family's stem (a "+ N" sign when folded, a "−" button when the view can fold); its mark is kept clear. */
	control?: FoldControl;
}

/** A family with its hang point. */
export interface Family extends FamilySpec {
	hang: Hang;
	/** The line from the single parent's card to a hang passage (none when the hang point is on the card or on a bar). */
	stem?: Leg;
}

/** One line from a person to a hang point that is not on their own card, before the ports. */
export interface LegSpec {
	/** The family the line belongs to (a union key, or a solo key for a single parent's stem to a hang passage). */
	family: string;
	person: string;
	/** The passages the line goes through, one per row between the person's row and the hang point's row (upper partner only). */
	passages: Item[];
}

/** A leg with its port. */
export interface Leg extends LegSpec {
	port: Port;
}

/** A couple (one union) before the ports. `bar`: side by side; `dot`: joined by legs to a dot; `far`: tags only (D10), a dot only when it hangs a family. */
export interface CoupleSpec {
	union: string;
	a: Item;
	b: Item;
	kind: 'bar' | 'dot' | 'far';
	/** The partners' lines to the dot: the non-anchor partner, and the anchor too when the hang point is on a passage. */
	legs: LegSpec[];
}

/** A couple with its hang point and its legs' ports. */
export interface Couple extends Omit<CoupleSpec, 'legs'> {
	/** The hang point the dot sits on; absent for a far couple with nothing to hang. */
	hang?: Hang;
	legs: Leg[];
}

/** A side link (a parent that does not decide the child's place), before the ports. */
interface SideLinkSpec {
	child: string;
	type: string;
	parents: string[];
	union?: string;
}

/** A side link with the ports it is drawn from (none when it is drawn from a union dot). */
export interface SideLink extends SideLinkSpec {
	ports: Port[];
}

/** What the graph, the rows and the order fix about a tree: the items in their rows and blocks, the couples, the families, the side links. */
export interface Skeleton {
	rows: Item[][];
	/** The blocks of items, rigid in shape; `rowBlocks[r]` lists the blocks of row r in order. */
	blocks: Item[][];
	rowBlocks: number[][];
	items: Map<string, Item>;
	/** The walk index of each block: the left-to-right proxy across rows (a passage block takes the index of its lower partner's block). */
	blockIndex: Map<number, number>;
	/** The anchor of each union: the lower partner on two rows, else the walk's emitter (`anchorOf` in plan.ts, the one decision site). */
	anchors: Map<string, string>;
	/** People whose bottom edge carries a far-couple tag (or a tag for a hidden partner). */
	tagged: Set<string>;
	/** The families of each person in the order of their hang points along the row (from the walk); the hang ports keep this order. */
	hangOrder: ReadonlyMap<string, readonly string[]>;
	families: FamilySpec[];
	couples: Map<string, CoupleSpec>;
	sideLinks: SideLinkSpec[];
	/** The hang passage of a family or couple (by key) whose anchor's card has no room for its hang point (`overflowHangs`). */
	hangPassages: Map<string, Item>;
}

/** The skeleton with its ports: what the placement and the route stage share. `derive` builds it; the items are the skeleton's own. */
export interface Plan extends Omit<Skeleton, 'families' | 'couples' | 'sideLinks'> {
	spec: Skeleton;
	families: Family[];
	couples: Map<string, Couple>;
	sideLinks: SideLink[];
	/** The ports of each card's bottom edge, in order along the edge. */
	exits: Map<string, Port[]>;
	/** The smallest distance between two consecutive items of a row (index = the item's `at`; 0 for the first). */
	minGap: number[][];
}
