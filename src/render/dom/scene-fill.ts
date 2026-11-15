/*
 * The fill of a lazy scene (spec §13.15 rule 1, S3 and S4; see the header of `scene.ts`) and its relation words that come late (spec §13.1,
 * D352 item 1). `buildScene` keeps the delayed items, the late lines and the late cards; this file decides which of them a fill attaches and
 * in what order, and asks the words of the late cards first.
 *
 * Late words. In a big whole tree the tree view does not ask the words of every card before the first frame: a card whose word is not
 * worked out when the scene is built is a late card (`LateCard`). Its shell carries the label without the relation, and its content is drawn
 * only when a fill attaches it. Every fill except one during a gesture asks the words of the late cards it attaches in one request, then
 * writes them (label and content) before the content is attached. A fill during a pinch or a wheel zoom (`fillNear` with `words` false)
 * never works a word out ("Names never compute during pan or zoom"): such a card gets its content with an empty word line, not the centred
 * form of a card with no word (D177 (10)), and the next fill near it or the idle queue (`SceneWords`) writes the word. A `fillNear` asks at
 * most `FillStore.most` words (spec §7.7, one group of the time budget); the other late cards it attaches get the same empty word line.
 * The scene keeps what it has written, not what the lookup knows: a word that another reader (Find, the saved picture, a window) already
 * worked out is still written to the card.
 */

import type { Rect } from '../../layout/model';
import { boxNearView } from '../view-math';

/** A lazy item that has not got its content yet: where it lies, its person, and the step that attaches it. */
export interface Delayed {
	box: Rect;
	person: string;
	card: boolean;
	attach: () => void;
}

/** A line or sign that is not built yet: where it lies and the step that builds it into its layer. */
export interface LateLine {
	box: Rect;
	put: () => void;
}

/** A card whose relation word was not written when the scene was built. */
export interface LateCard {
	box: Rect;
	/** True when its content was drawn with an empty word line (a fill during a gesture). */
	drawn: boolean;
	/** Writes the word, which the lookup has now: the label, and the content if it is drawn. The card then stops being late. */
	write(): void;
}

/** The late words of a lazy scene, for the idle queue of the tree view. */
export interface SceneWords {
	/** Cards whose word is not written yet; 0 in an eager scene and when every word was known at build. */
	readonly pending: number;
	/** Up to `max` cards that wait for their word: those with an empty word line first, then the nearest to `view`. */
	due(view: Rect | null, max: number): string[];
	/** Asks the words of `ids` in one request and writes them. */
	write(ids: readonly string[]): void;
}

/**
 * Attaches the delayed content of a lazy scene. Every call is safe to repeat; each returns how many cards, tags and
 * badges it attached. The same calls build the lines and partnership signs that wait, but those are counted by
 * `pendingLines` and never in a return value.
 */
export interface SceneFill {
	/** The cards, tags and badges near `view` (`boxNearView`), and the lines and signs near it. `words` false: a fill during a gesture, which works no word out. */
	fillNear(view: Rect, words?: boolean): number;
	/** The card of `id`, its badge and its tags, and the lines that touch the card. False if the id is unknown. */
	fillPerson(id: string): boolean;
	/** Everything that is left. */
	fillAll(): number;
	/**
	 * Up to `max` cards, the nearest to `view` first, with the tags and badges that lie before the next card. The lines and signs
	 * that wait come in the same chunks, the nearest first, so that they end with the last card.
	 */
	fillChunk(view: Rect, max: number): number;
	/** Cards, tags and badges whose content is not attached yet; 0 in an eager scene. */
	readonly pending: number;
	/** Lines and partnership signs that are not built yet; 0 in an eager scene. */
	readonly pendingLines: number;
}

/** What `lazyFill` works on: the stores of `buildScene`. */
export interface FillStore {
	delayed: Set<Delayed>;
	byPerson: Map<string, Delayed[]>;
	lateLines: Set<LateLine>;
	late: Map<string, LateCard>;
	persons: ReadonlyMap<string, Rect>;
	has(id: string): boolean;
	/** B8 3: the step that makes the focus ring of a lazy card, by person. */
	rings: Map<string, () => void>;
	/** Asks the lookup for the words of `ids` in one request. */
	ask(ids: readonly string[]): void;
	/** The most late cards whose words one `fillNear` asks (spec §7.7: one group of the time budget); the rest get an empty word line. Absent: all. */
	most?: number;
	attachItem(d: Delayed): number;
	putLine(l: LateLine): number;
	cardsLeft(): number;
}

/** When no card waits, a chunk builds this many late lines for each card of its size. */
const LATE_LINES_PER_CARD_SLOT = 4;

/** Squared distance from a point to the centre of a box: nearest first. */
const far2 = (b: Rect, cx: number, cy: number) => (b.x + b.w / 2 - cx) ** 2 + (b.y + b.h / 2 - cy) ** 2;

/** The order of `items` by distance from a point, kept with a cursor while the point does not change. */
interface Chain<T> {
	cx: number;
	cy: number;
	items: T[];
	at: number;
}

function chainAt<T>(old: Chain<T> | null, cx: number, cy: number, all: Iterable<T>, box: (t: T) => Rect): Chain<T> {
	if (old?.cx === cx && old.cy === cy) return old;
	const order = [...all].map((t) => ({ t, k: far2(box(t), cx, cy) }));
	order.sort((a, b) => a.k - b.k);
	return { cx, cy, items: order.map((o) => o.t), at: 0 };
}

/** Writes the words of the late cards among `ids`, asked in one request. */
function giveWords(s: FillStore, ids: Iterable<string>): void {
	const want = [...new Set(ids)].filter((id) => s.late.has(id));
	if (!want.length) return;
	s.ask(want);
	for (const id of want) s.late.get(id)?.write();
}

/** The `max` ids nearest to the centre of `view`, by the boxes of their late cards; with no view, the first `max`. */
function nearestLate(s: FillStore, ids: readonly string[], view: Rect | null, max: number): string[] {
	if (!view) return ids.slice(0, max);
	const cx = view.x + view.w / 2;
	const cy = view.y + view.h / 2;
	const order = ids.map((id) => ({ id, k: far2(s.late.get(id)!.box, cx, cy) }));
	order.sort((a, b) => a.k - b.k);
	return order.slice(0, max).map((o) => o.id);
}

/** The late cards among the items a fill is about to attach. */
const lateOf = (s: FillStore, items: readonly Delayed[]) => items.filter((d) => d.card && s.late.has(d.person)).map((d) => d.person);

const attachAll = (s: FillStore, items: readonly Delayed[]) => items.reduce((n, d) => n + s.attachItem(d), 0);

/** The lines and signs that touch the box of a card come with it; their boxes include the stroke room. */
function linesOfCard(s: FillStore, box: Rect): void {
	for (const l of [...s.lateLines]) {
		const b = l.box;
		if (b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y) s.putLine(l);
	}
}

/** The orders that the idle chunks keep while the view centre does not change. */
interface Chains {
	cards: Chain<Delayed> | null;
	lines: Chain<LateLine> | null;
	words: Chain<string> | null;
}

/** The next items of an idle chunk: up to `max` cards, nearest first, with the tags and badges that lie before the next card. */
function chunkItems(s: FillStore, c: Chains, cx: number, cy: number, max: number): Delayed[] {
	const chain = (c.cards = chainAt(c.cards, cx, cy, s.delayed, (d) => d.box));
	const take: Delayed[] = [];
	let cardsDone = 0;
	while (chain.at < chain.items.length) {
		const d = chain.items[chain.at];
		if (!s.delayed.has(d)) {
			chain.at++;
			continue;
		}
		if (d.card && cardsDone >= max) break;
		if (d.card) cardsDone++;
		chain.at++;
		take.push(d);
	}
	return take;
}

/** Builds up to `count` late lines, the nearest to the point first. */
function chunkLines(s: FillStore, c: Chains, cx: number, cy: number, count: number): void {
	if (count <= 0 || !s.lateLines.size) return;
	const chain = (c.lines = chainAt(c.lines, cx, cy, s.lateLines, (l) => l.box));
	let left = count;
	while (left > 0 && chain.at < chain.items.length) left -= s.putLine(chain.items[chain.at++]);
}

function fillOf(s: FillStore, c: Chains): SceneFill {
	return {
		fillNear(view, words = true) {
			const near = [...s.delayed].filter((d) => boxNearView(d.box, view));
			if (words) {
				const drawn = [...s.late].filter(([, card]) => card.drawn && boxNearView(card.box, view)).map(([id]) => id);
				const want = [...new Set([...lateOf(s, near), ...drawn])];
				// Spec §7.7: a zoom out can bring a thousand late cards into view; one fill asks one group, the nearest first. The others are attached
				// with an empty word line, as in a gesture, and the idle queue takes them first.
				giveWords(s, s.most !== undefined && want.length > s.most ? nearestLate(s, want, view, s.most) : want);
			}
			const n = attachAll(s, near);
			if (s.lateLines.size) for (const l of [...s.lateLines]) if (boxNearView(l.box, view)) s.putLine(l);
			return n;
		},
		fillPerson(id) {
			const box = s.persons.get(id);
			if (!s.has(id) || !box) return s.has(id);
			giveWords(s, [id]);
			for (const d of s.byPerson.get(id) ?? []) s.attachItem(d);
			s.rings.get(id)?.();
			if (s.lateLines.size) linesOfCard(s, box);
			return true;
		},
		fillAll() {
			giveWords(s, [...s.late.keys()]);
			const n = attachAll(s, [...s.delayed]);
			for (const make of s.rings.values()) make();
			for (const l of [...s.lateLines]) s.putLine(l);
			return n;
		},
		fillChunk(view, max) {
			if (max <= 0) return 0;
			const cx = view.x + view.w / 2;
			const cy = view.y + view.h / 2;
			// The lines are spread over the chunks that the cards still need, so both end together; with no card left they come in chunks of their own.
			const left = s.cardsLeft();
			if (s.lateLines.size) chunkLines(s, c, cx, cy, left > 0 ? Math.ceil(s.lateLines.size / Math.ceil(left / max)) : LATE_LINES_PER_CARD_SLOT * max);
			if (!s.delayed.size) return 0;
			// The order is sorted once per chain: the same view centre keeps the list and a cursor. Items that other fills attached meanwhile are skipped.
			const take = chunkItems(s, c, cx, cy, max);
			giveWords(s, lateOf(s, take));
			return attachAll(s, take);
		},
		get pending() {
			return s.delayed.size;
		},
		get pendingLines() {
			return s.lateLines.size;
		},
	};
}

function wordsOf(s: FillStore, c: Chains): SceneWords {
	return {
		get pending() {
			return s.late.size;
		},
		due(view, max) {
			// The cards drawn with an empty word line go first, the nearest first: they show on the screen without their word.
			const out = nearestLate(s, [...s.late].filter(([, card]) => card.drawn).map(([id]) => id), view, max);
			if (out.length >= max) return out;
			const chain = (c.words = chainAt(c.words, view ? view.x + view.w / 2 : 0, view ? view.y + view.h / 2 : 0, s.late.keys(), (id) => s.late.get(id)!.box));
			while (out.length < max && chain.at < chain.items.length) {
				const id = chain.items[chain.at++];
				if (s.late.has(id) && !out.includes(id)) out.push(id);
			}
			return out;
		},
		write: (ids) => giveWords(s, ids),
	};
}

/** The fill API and the late words of a lazy scene; `reset` forgets the kept order of the cards (after a detail change brings work back). */
export function lazyFill(s: FillStore): { fill: SceneFill; words: SceneWords; reset: () => void } {
	const c: Chains = { cards: null, lines: null, words: null };
	return {
		fill: fillOf(s, c),
		words: wordsOf(s, c),
		reset: () => {
			c.cards = null;
		},
	};
}

/** The fill of an eager scene: everything is there from the build. */
export function eagerFill(has: (id: string) => boolean): { fill: SceneFill; words: SceneWords } {
	return {
		fill: { fillNear: () => 0, fillPerson: has, fillAll: () => 0, fillChunk: () => 0, pending: 0, pendingLines: 0 },
		words: { pending: 0, due: () => [], write: () => undefined },
	};
}
