/*
 * Writes a tree of the fake DOM (tests/acceptance/fake-dom.ts) as an HTML text, so a real browser can lay out what the plugin built. Not a test file.
 * The own text and the text added by `appendText` stand in their order among the children, as `getText` has them. Classes, attributes and the custom properties of
 * the style (the house colour) are kept; listeners are not.
 */
import type { FEl } from '../acceptance/fake-dom';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const VOID = new Set(['img', 'input', 'br', 'hr']);

/** The text pieces and the children of `el` in their order. */
function content(el: FEl): (string | FEl)[] {
	const appended = (el as unknown as { appended: { at: number; t: string }[] }).appended;
	if (!appended.length) return [el.text, ...el.children];
	const own = el.text.slice(0, el.text.length - appended.reduce((n, a) => n + a.t.length, 0));
	const out: (string | FEl)[] = [own];
	for (let i = 0; i <= el.children.length; i++) {
		for (const a of appended) if (Math.min(a.at, el.children.length) === i) out.push(a.t);
		if (i < el.children.length) out.push(el.children[i]);
	}
	return out;
}

/** The HTML of `el` and everything below it. */
export function toHtml(el: FEl): string {
	const attrs = [...el.attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
	const cls = el.classes.size ? ` class="${esc([...el.classes].join(' '))}"` : '';
	const style = el.styleProps.size ? ` style="${esc([...el.styleProps].map(([k, v]) => `${k}:${v}`).join(';'))}"` : '';
	if (VOID.has(el.tag)) return `<${el.tag}${cls}${attrs}${style}>`;
	return `<${el.tag}${cls}${attrs}${style}>${content(el).map((c) => (typeof c === 'string' ? esc(c) : toHtml(c))).join('')}</${el.tag}>`;
}
