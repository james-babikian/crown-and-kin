/*
 * Reads the target text of a `link` value. Both the note maker (`note-make.ts`) and the tree view
 * (`linkTarget` in `render/tree-info.ts`) use it, and `link-rewrite.ts` uses the parenthesis rule,
 * so every reader of a Markdown link treats a destination such as `Note%20(2).md` the same way.
 */

/** True if every `)` in a Markdown destination closes an earlier `(` (for example `Arms%20(old).png`). */
export function closesBalanced(dest: string): boolean {
	let depth = 0;
	for (const ch of dest) {
		if (ch === '(') depth++;
		else if (ch === ')' && --depth < 0) return false;
	}
	return true;
}

/**
 * The target of a link value as Obsidian link text, with any `#heading` and no alias: the part of
 * `[[Note|Alias]]` before the bar, the destination of `[Alias](Note.md)` or `[Alias](<Note (2).md>)`
 * with percent-codes read, or the text itself. A Markdown destination runs to the last `)` when its
 * parentheses are balanced; an unbalanced one is read as a bare text, as `parseLink` does.
 */
export function linkText(link: string): string {
	let s = link.trim();
	const wiki = /^!?\[\[([^\]]*)\]\]$/.exec(s);
	const md = wiki ? null : /^!?\[[^\]]*\]\(([\s\S]*)\)$/.exec(s);
	if (wiki) s = wiki[1].split('|')[0];
	else if (md) {
		const angle = /^\s*<([\s\S]*)>\s*$/.exec(md[1]);
		if (angle || closesBalanced(md[1])) {
			s = (angle ? angle[1] : md[1]).trim();
			try {
				s = decodeURIComponent(s);
			} catch {
				// Keep the text as written if it is not valid percent-encoding.
			}
		}
	}
	return s.trim();
}

/** The folder part of a vault path ('' for a file at the top of the vault). */
export function folderOf(path: string): string {
	return path.split('/').slice(0, -1).join('/');
}
