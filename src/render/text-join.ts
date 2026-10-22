/*
 * Joined text lines (0.2.8 contract G.2).
 * A text line of items with "·" between them never starts a wrapped text line with "·", and a reign such as
 * "(r. 1160–1207)" never breaks. `nb` and `leadItems` are pure; `joined` builds the elements. Shared by the phone
 * list and the windows. The style rules (`dynasty-joined`, `dynasty-jitem`, `dynasty-jmark`, `is-lead`) come with the first caller.
 */

/**
 * Keeps a reign "(r. 1160–1207)" on one text line: no-break spaces inside the brackets, and no break after the dash. The thin spaces around the dash of a range with names
 * (D278) become narrow no-break spaces, which are as thin and which never break.
 */
export function nb(text: string): string {
	return text.replace(/\(([^)]*)\)/g, (m) => m.replace(/ /g, ' ').replace(/\u2009/g, '\u202f').replace(/–/g, '–⁠'));
}

/** Where one item of a joined text line sits on screen. */
export interface ItemBox {
	top: number;
	height: number;
}

/**
 * The indexes of the items that start a wrapped text line, so that their "·" must hide. The first item never does. An item with
 * no height is not shown and never does. An item is on a new text line when its top is lower than the middle of the item before it.
 */
export function leadItems(boxes: readonly ItemBox[]): number[] {
	const out: number[] = [];
	for (let i = 1; i < boxes.length; i++) {
		const prev = boxes[i - 1];
		if (boxes[i].height > 0 && boxes[i].top > prev.top + prev.height / 2) out.push(i);
	}
	return out;
}

/** A part of a joined text line: a text or an element. Empty parts are left out. */
export type JoinKid = Node | string | null | undefined | false;

let observed = new WeakSet<HTMLElement>();
let observer: ResizeObserver | null | undefined;

// Read every place first (all marks shown), then change. The hidden mark leaves a fixed line break, so an item that now
// fits on the line above does not jump back there and then show its mark again.
function fixJoined(box: HTMLElement): void {
	const kids = Array.from(box.children) as HTMLElement[];
	for (const kid of kids) if (kid.hasClass('dynasty-jbreak')) kid.remove();
	const items = kids.filter((kid) => kid.hasClass('dynasty-jitem'));
	for (const item of items) item.removeClass('is-lead');
	const boxes = items.map((item) => {
		const r = item.getBoundingClientRect();
		return { top: r.top, height: r.height };
	});
	for (const i of leadItems(boxes)) {
		items[i].addClass('is-lead');
		box.insertBefore(box.createEl('br', { cls: 'dynasty-jbreak' }), items[i]);
	}
}

/** Stops watching every joined box (the plugin calls it when it is turned off). */
export function stopJoinedWatch(): void {
	observer?.disconnect();
	observer = undefined;
	observed = new WeakSet();
}

function observe(box: HTMLElement): void {
	if (observer === undefined) {
		observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
			for (const e of entries) {
				const target = e.target as HTMLElement;
				// A box that left the page is not watched any more.
				if (!target.isConnected) {
					observer?.unobserve(target);
					observed.delete(target);
				} else fixJoined(target);
			}
		});
	}
	if (!observer || observed.has(box)) return;
	observed.add(box);
	observer.observe(box);
}

/**
 * Builds a text line of `parts` with "·" between them inside `parent`. The "·" belongs to the item after it. The box checks
 * its text lines when it is laid out and each time its size changes.
 */
export function joined(parent: HTMLElement, cls: string, parts: readonly JoinKid[], tag: 'div' | 'span' = 'div'): HTMLElement {
	const box = parent.createEl(tag, { cls: `dynasty-joined ${cls}` });
	parts.filter((part) => part).forEach((part, i) => {
		if (i) box.appendText(' ');
		const item = box.createSpan({ cls: 'dynasty-jitem' });
		if (i) item.createSpan({ cls: 'dynasty-jmark', text: '·', attr: { 'aria-hidden': 'true' } });
		if (typeof part === 'string') item.appendText(part);
		else if (part) item.appendChild(part);
	});
	observe(box);
	return box;
}
