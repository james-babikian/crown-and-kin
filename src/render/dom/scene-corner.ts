/*
 * The card corner radius of a scene (see `scene.ts`). The ribbon and badge paths need the `rx` that the style sheet gives the card bg,
 * but a scene is built before it is in the document. A new scene starts with the radius the last scene learned, and the first card bg
 * that is in the document is read once; the paths are drawn again only if they differ from it.
 */

/** The corner radius (px) that ribbons use until the real one is read; it is the `rx` of the narrowest theme look (Cupertino). */
const CORNER_FALLBACK = 4;

/** The card corner radius that the last scene learned, so the next scene starts with it and has nothing to draw again (a speed gain; it is checked on the first sync). */
let learnedRadius: number | undefined;

/** Forgets the learned card corner radius (tests; the next scene starts with the fallback). */
export function resetLearnedCornerRadius(): void {
	learnedRadius = undefined;
}

/** Reads the computed corner radius (px) of an SVG rect; `fallback` when the element is detached or the value is unknown. */
export function readCornerRadius(el: Element, fallback: number): number {
	try {
		if (typeof getComputedStyle !== 'function' || !el.isConnected) return fallback;
		const cs = getComputedStyle(el) as CSSStyleDeclaration & { rx?: string };
		const v = parseFloat(cs.rx ?? '');
		return Number.isFinite(v) && v >= 0 ? v : fallback;
	} catch {
		return fallback;
	}
}

/** The radius bookkeeping of one scene: the paths that depend on it (`bars`) and the calls that read, learn and set it. */
export interface CornerTracker {
	/** The redraws of the ribbons and badges; each takes the radius. */
	bars: ((r: number) => void)[];
	/** The radius a path uses now; remembers the first card bg to read the real one from. */
	barRadius: (bg: Element) => number;
	/** `Scene.syncCornerRadius`. */
	sync: (force?: boolean) => void;
	/** `Scene.setCornerRadius`. */
	set: (r: number) => void;
}

/** Starts the radius bookkeeping of a scene with the caller's radius, else the learned one. */
export function cornerTracker(given: number | undefined): CornerTracker {
	// Never read per card, and never read a theme variable: the computed `rx` is the one value that is the card's own.
	let cornerR: number | undefined = given ?? learnedRadius;
	/** True when the radius is known for certain (the caller's, or read from a card bg), not guessed from the last scene. */
	let verified = given !== undefined;
	let firstBg: Element | undefined;
	/** The radius of the first path drawn, and whether a later path used another one. */
	let drawn: number | undefined;
	let mixed = false;
	const bars: ((r: number) => void)[] = [];
	const barRadius = (bg: Element): number => {
		firstBg ??= bg;
		if (cornerR === undefined) {
			const r = readCornerRadius(bg, -1);
			if (r >= 0) {
				cornerR = r;
				verified = true;
				learnedRadius = r;
			}
		}
		const use = cornerR ?? CORNER_FALLBACK;
		if (drawn === undefined) drawn = use;
		else if (use !== drawn) mixed = true;
		return use;
	};
	const sync = (force = false): void => {
		if (!firstBg || (verified && !force)) return;
		const r = readCornerRadius(firstBg, -1);
		if (r < 0) return;
		verified = true;
		learnedRadius = r;
		cornerR = r;
		if (mixed || r !== drawn) {
			bars.forEach((draw) => draw(r));
			drawn = r;
			mixed = false;
		}
	};
	const set = (r: number): void => {
		cornerR = r;
		verified = true;
		learnedRadius = r;
		drawn = r;
		mixed = false;
		bars.forEach((redraw) => redraw(r));
	};
	return { bars, barRadius, sync, set };
}
