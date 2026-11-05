/*
 * The text direction of a name in an HTML text (spec §0 D322). A name that starts with a right-to-left letter and also holds Latin letters ("كريم Mansour") reads
 * in one order on the cards: the whole name, with its sobriquet, is one run whose direction its first strong letter sets, so "Mansour" stands at the left. A plain
 * left-to-right paragraph would write the Arabic word at the left instead. The HTML texts give the name the same run: a first-strong isolate around it
 * (`isolateName`, FSI and PDI), so the words that stand beside the name in a sentence keep their place. HTML honours an isolate (WebKit too); an SVG text does
 * not, and the cards use embeddings there (`svgNameLines`). A name with no right-to-left letter comes back unchanged, so a left-to-right name looks and compares as
 * before. The helper itself is in the core (`core/name-bidi.ts`) because the messages of the problem list use it. The DOM version is `render/dom/name-span.ts`.
 */
import { isolateName, needsBidiIsolate } from '../core/name-bidi';

export { isolateName };

/** True when `texts` hold a right-to-left letter, that is, when the name they make needs its own bidi run. */
export function nameNeedsRun(...texts: readonly (string | undefined)[]): boolean {
	return texts.some((t) => t !== undefined && needsBidiIsolate(t));
}
