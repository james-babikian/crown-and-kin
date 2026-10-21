/*
 * The reader of a link value, split around its target. A leaf of the core: `pictures.ts` (the picture lookup) and `link-rewrite.ts` (a rename of notes
 * and pictures) both read a link through it, so they agree on the target, and neither has to import the other (that import was a cycle through
 * `parse.ts` and `portrait-crop.ts`). A link is read in the forms the renderer opens (`linkTarget` in `src/render/tree-info.ts`): `[[Note#Heading|Alias]]`,
 * `[Alias](Note.md#Heading)`, `[Alias](<Note.md>)` and a bare `Note#Heading`, each with an optional `!`.
 */

import { closesBalanced } from './link-text';

/** A link's text split around its target: `head + written target + tail` is the whole text. */
export interface LinkParts {
	head: string;
	/** The target as Obsidian resolves it: trimmed, and percent-decoded in a Markdown link. */
	target: string;
	tail: string;
	kind: 'wiki' | 'md' | 'md-angle' | 'bare';
}

function decode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** The target is the text up to the first of `cut`; whitespace around it goes to head and tail. */
function split(head: string, text: string, tail: string, cut: RegExp, kind: LinkParts['kind']): LinkParts | null {
	const at = text.search(cut);
	const path = at < 0 ? text : text.slice(0, at);
	const rest = at < 0 ? '' : text.slice(at);
	const lead = /^\s*/.exec(path)![0];
	const core = path.trim();
	const target = kind === 'md' ? decode(core).trim() : core;
	if (target === '') return null;
	return { head: head + lead, target, tail: path.slice(lead.length + core.length) + rest + tail, kind };
}

/**
 * Splits a link value into its parts, or null when it names no target (for example `[[]]` or
 * `#heading`). A text that matches no link form is a bare target. A Markdown destination runs to
 * the last `)` if its parentheses are balanced; the angle form runs to the last `>` before it.
 */
export function parseLink(v: string): LinkParts | null {
	const wiki = /^(\s*!?\[\[)([^\]]*)(\]\]\s*)$/.exec(v);
	if (wiki) return split(wiki[1], wiki[2], wiki[3], /[|#]/, 'wiki');
	const md = /^(\s*!?\[[^\]]*\]\()([\s\S]*)(\)\s*)$/.exec(v);
	if (md) {
		const angle = /^(\s*<)([\s\S]*)(>\s*)$/.exec(md[2]);
		if (angle) return split(md[1] + angle[1], angle[2], angle[3] + md[3], /#/, 'md-angle');
		if (closesBalanced(md[2])) return split(md[1], md[2], md[3], /#/, 'md');
	}
	return split('', v, '', /#/, 'bare');
}

/**
 * `parseLink` for a picture value (`portrait`, `arms`; contract rule 4): a bare value may also start
 * with "!", which goes to the head, so `!Pictures/x.png` names `Pictures/x.png`. A bare `link` keeps
 * its "!", as the renderer opens it.
 */
export function parsePictureLink(v: string): LinkParts | null {
	const parts = parseLink(v);
	const bang = parts?.kind === 'bare' ? /^(\s*!)([\s\S]*)$/.exec(v) : null;
	return bang ? split(bang[1], bang[2], '', /#/, 'bare') : parts;
}
