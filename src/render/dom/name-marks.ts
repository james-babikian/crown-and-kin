/*
 * Turns the isolate marks of a text into elements (spec §0 D322). The text tables write a name that holds a right-to-left letter between FSI and PDI
 * (`render/name-bidi.ts`), so a text stays one plain string that the tests can read. A browser that honours those characters in an HTML text shows the right
 * order; WebKit does not (proved in an internal test: the characters change nothing there), and it does honour an element with
 * `dir="auto"` and `unicode-bidi: isolate`. So the DOM edge writes each pair as `span.dynasty-name-run[dir=auto]` and drops the two characters. The same holds for
 * the date isolates, which use the same two characters. A text with no mark is written as it is, so a left-to-right text is the text it was.
 * Three ways in: `setNameText` (one element, the fake DOM too), `noticeText` (a Notice) and `watchMarks` (a window: it converts the text that the window writes,
 * whenever it writes it). The splitting itself (`splitMarks`) is pure.
 */
import { BIDI_FSI, BIDI_PDI } from '../bidi-controls';

/** A piece of a text: plain text, or the text between a pair of marks (`run`). A run can hold runs. */
export interface MarkPart {
	text: string;
	run: boolean;
	/** The pieces of a run that holds another pair of marks. */
	parts?: MarkPart[];
}

/** True when `text` has an opening mark. */
export const hasMarks = (text: string): boolean => text.includes(BIDI_FSI);

/**
 * `text` as a list of pieces: the plain text, and each pair of marks as a run with the text between them. A mark with no partner stays in the plain text, so no
 * text is lost. Pairs inside a pair become pieces of the outer run.
 */
export function splitMarks(text: string): MarkPart[] {
	const stack: MarkPart[][] = [[]];
	let at = 0;
	const flush = (to: number) => {
		if (to > at) stack[stack.length - 1].push({ text: text.slice(at, to), run: false });
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === BIDI_FSI) {
			flush(i);
			at = i + 1;
			stack.push([]);
		} else if (ch === BIDI_PDI && stack.length > 1) {
			flush(i);
			at = i + 1;
			const inner = stack.pop()!;
			const plain = inner.map((p) => p.text).join('');
			stack[stack.length - 1].push({ text: plain, run: true, ...(inner.some((p) => p.run) ? { parts: inner } : {}) });
		}
	}
	flush(text.length);
	// A pair that was never closed: its text and its mark go back to the plain text.
	while (stack.length > 1) {
		const inner = stack.pop()!;
		stack[stack.length - 1].push({ text: BIDI_FSI, run: false }, ...inner);
	}
	return stack[0];
}

/** Writes `parts` into `el` with the helpers of Obsidian: plain text as text, a run as an isolate span. */
function writeParts(el: HTMLElement, parts: readonly MarkPart[]): void {
	for (const p of parts) {
		if (!p.run) el.appendText(p.text);
		else if (p.parts) writeParts(el.createSpan({ cls: 'dynasty-name-run', attr: { dir: 'auto' } }), p.parts);
		else el.createSpan({ cls: 'dynasty-name-run', attr: { dir: 'auto' }, text: p.text });
	}
}

/** Sets the text of `el` and returns it. A text with marks becomes plain text and isolate spans; any other text is set as it is. */
export function setNameText<T extends HTMLElement>(el: T, text: string): T {
	if (!hasMarks(text)) {
		el.setText(text);
		return el;
	}
	el.empty();
	writeParts(el, splitMarks(text));
	return el;
}

/** A new span of class `cls` that holds `text` (`setNameText`). */
export function markedSpan(cls: string, text: string): HTMLElement {
	const el = createSpan({ cls });
	setNameText(el, text);
	return el;
}

/** The text of a Notice: the plain string, or a fragment with isolate spans when the text has marks. */
export function noticeText(text: string): string | DocumentFragment {
	if (!hasMarks(text)) return text;
	return createFragment((f) => writeParts(f as unknown as HTMLElement, splitMarks(text)));
}

/** The elements that `watchMarks` watches already. */
const watched = new WeakSet<object>();

/** The text nodes that the converter wrote: they are never converted again, so a chain of observer callbacks always ends. */
const written = new WeakSet<object>();

/** The pieces of `text` when it holds at least one pair of marks; null otherwise (a lone mark stays as the text it is). */
function pairsOf(text: string): MarkPart[] | null {
	if (!hasMarks(text)) return null;
	const parts = splitMarks(text);
	return parts.some((p) => p.run) ? parts : null;
}

/** Text in an SVG is drawn with embeddings by the scene (`svgNameLines`), and an HTML span in an SVG text would hide the name. */
function inSvg(node: Node): boolean {
	const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
	return !!el?.closest('svg');
}

/** Replaces the pairs of marks in one text node of the real DOM by isolate spans. A node with no pair, a node that the converter wrote and a node in an SVG stay as they are. */
function convertNode(node: Text): void {
	if (written.has(node) || inSvg(node)) return;
	const parts = pairsOf(node.data);
	if (!parts) return;
	const fragment = createFragment((f) => writeParts(f as unknown as HTMLElement, parts));
	const walker = node.ownerDocument.createTreeWalker(fragment, 4);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) written.add(n);
	node.replaceWith(fragment);
}

/** Converts every text node with a pair of marks below `root` (and `root` itself when it is one). */
function convertBelow(root: Node): void {
	if (!root.textContent || !hasMarks(root.textContent)) return;
	if (root.nodeType === 3) {
		convertNode(root as Text);
		return;
	}
	const found: Text[] = [];
	const walker = root.ownerDocument!.createTreeWalker(root, 4);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) if (hasMarks((n as Text).data)) found.push(n as Text);
	for (const t of found) convertNode(t);
}

/**
 * Makes the marks of a window into isolate spans: the text that is there now, and every text that the window writes later (a window builds its pages again and
 * changes lines in place). A watcher is made once for an element. Only a pair of marks is converted; a text with a lone mark is left as it is, so the observer
 * settles on any input. Text in an SVG is never touched. Where the browser has no `MutationObserver` (the tests with the fake DOM) nothing happens.
 */
export function watchMarks(root: HTMLElement): void {
	const win = root.ownerDocument?.defaultView;
	if (watched.has(root) || !win || typeof win.MutationObserver === 'undefined' || typeof root.ownerDocument.createTreeWalker !== 'function') return;
	watched.add(root);
	convertBelow(root);
	new win.MutationObserver((records) => {
		for (const r of records) {
			if (r.type === 'characterData') {
				if (r.target.nodeType === 3) convertNode(r.target as Text);
			} else for (const added of Array.from(r.addedNodes)) convertBelow(added);
		}
	}).observe(root, { childList: true, subtree: true, characterData: true });
}
