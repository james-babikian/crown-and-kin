/*
 * The two small marks of the windows' text lines: a warning triangle (a quiet warning in a hint, the wrong name in the grey line of a date) and an alert circle (the one
 * red line after a Save with errors). Plain SVG made with `createSvg`; the style sheet sets the size and the stroke (`currentColor`), so the mark follows the text colour of its line
 * and no colour is written here (spec §5.8). `render/dom` may not import `obsidian`, so the two shapes are drawn here (the same shapes as the Lucide icons that Obsidian has).
 */

type Shape = readonly (readonly [string, Record<string, string>])[];

const SHAPES: Record<'warning' | 'alert', Shape> = {
	warning: [
		['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
		['path', { d: 'M12 9v4' }],
		['path', { d: 'M12 17h.01' }],
	],
	alert: [
		['circle', { cx: '12', cy: '12', r: '10' }],
		['path', { d: 'M12 8v4' }],
		['path', { d: 'M12 16h.01' }],
	],
};

/** Draws the mark `kind` as the first child of `parent`; the screen reader skips it (the text line says it all). */
export function drawMark(parent: HTMLElement, kind: 'warning' | 'alert'): SVGElement {
	const svg = parent.createSvg('svg', { cls: ['dynasty-mark', `is-${kind}`], attr: { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' } });
	for (const [tag, attr] of SHAPES[kind]) svg.createSvg(tag as 'path', { attr });
	parent.insertBefore(svg, parent.firstChild);
	return svg;
}

/** A text line with a mark: the mark, then the text in its own span (so the text wraps beside the mark, not under it). */
export function markedLine(parent: HTMLElement, kind: 'warning' | 'alert', text: string, cls: string | string[] = []): HTMLElement {
	const line = parent.createDiv({ cls: ['dynasty-marked', ...(Array.isArray(cls) ? cls : [cls])] });
	drawMark(line, kind);
	line.createSpan({ text });
	return line;
}
