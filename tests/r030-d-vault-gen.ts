/*
 * 0.3 package D (T4): a generator of random vaults, and the checks of a link update. Not a test file.
 *
 * A vault has 20 to 60 notes (some with trees, some without) and some pictures, in folders. A note is a list of
 * lines. A line is either `exact` (text outside any tree link value: it must never change) or `templated` (a tree
 * line with one link value in it: text before, the value as written, text after). The generator knows for every link
 * value which file it points to, by a file id that does not change when the file is renamed. Nothing here calls the
 * plugin. Spec §6.9 (link maintenance), §13.0 item 3 (pictures), §4.1 (the keys `link`, `portrait`, `arms`).
 *
 * The rules the checks come from:
 * - a note without a tree never changes; in a note with a tree only the link values change; the text outside the
 *   tree, the fence lines, the comments, the other keys (a `notes` text with a link in it too) stay as they were;
 * - after the update every link value points to the file it pointed to before (the target is found by the rules of
 *   Obsidian's link search, written down in `resolveLink`); a value that points to another file is not touched;
 * - a changed value keeps its form: the `[[ ]]` marks, the `!`, the alias, the heading, the Markdown brackets; a note
 *   link that had ".md" keeps it, a picture link keeps its extension.
 */

import { pick, rng } from './r028-advb-gen';

// ---------------------------------------------------------------------------------------------------------
// Files and names

export type FileKind = 'note' | 'picture' | 'other';

/** A file of the vault. `id` does not change when the file is renamed or moved. */
export interface VFile {
	id: number;
	path: string;
	kind: FileKind;
}

export const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];

export const extOf = (path: string): string => {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};
export const isPictureName = (path: string): boolean => PICTURE_EXTENSIONS.includes(extOf(path));
export const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const stripMd = (s: string) => s.replace(/\.md$/i, '');

const NAME_PARTS = ['Aldric', 'Valmont', 'Keep', 'Éowyn', 'Château', 'Smith, John', 'A & B', 'Ann+Bob', '100% sure', 'Dr. Who', 'café', 'Zoë', "O'Neil", 'old (north)', 'Hall', 'tower', 'Rose', 'Ünal', 'x=y', 'a@b', 'Mac $', 'Ørsted', 'house of Stone'];

/** A note name that is not in `used` (compared without case), with a number when needed. */
export function freshName(rand: () => number, used: Set<string>, parts = NAME_PARTS): string {
	for (let i = 0; ; i++) {
		const base = `${pick(rand, parts)}${rand() < 0.5 ? ` ${pick(rand, parts)}` : ''}`;
		const name = i < 6 ? base : `${base} ${i}`;
		if (!used.has(name.toLowerCase())) {
			used.add(name.toLowerCase());
			return name;
		}
	}
}

// ---------------------------------------------------------------------------------------------------------
// Link values

export interface LinkVal {
	key: 'link' | 'portrait' | 'arms';
	/** The file this value points to, or null (a web address, a note that is not there). */
	fileId: number | null;
	/** The value as written in the YAML text (with its quote marks). */
	written: string;
}

/** The parts of a link text: `head + target + tail` is the whole text. `target` is decoded for a Markdown link. */
export interface Parts {
	head: string;
	target: string;
	tail: string;
	kind: 'wiki' | 'md' | 'angle' | 'bare';
}

const decode = (s: string) => {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
};

/** Reads a link text the way the link forms of the spec are written. Null for a text without a target. */
export function parseParts(v: string): Parts | null {
	const wiki = /^(\s*!?\[\[)([^\]|#]*)([|#][^\]]*)?(\]\]\s*)$/.exec(v);
	if (wiki) return wiki[2].trim() ? { head: wiki[1], target: wiki[2].trim(), tail: (wiki[3] ?? '') + wiki[4], kind: 'wiki' } : null;
	const md = /^(\s*!?\[[^\]]*\]\()(.*)(\)\s*)$/.exec(v);
	if (md) {
		const angle = /^<(.*)>$/.exec(md[2]);
		if (angle) return { head: `${md[1]}<`, target: angle[1].split('#')[0], tail: `${angle[1].includes('#') ? `#${angle[1].split('#').slice(1).join('#')}` : ''}>${md[3]}`, kind: 'angle' };
		const hash = md[2].indexOf('#');
		const path = hash < 0 ? md[2] : md[2].slice(0, hash);
		return { head: md[1], target: decode(path), tail: (hash < 0 ? '' : md[2].slice(hash)) + md[3], kind: 'md' };
	}
	const bang = /^(!?)([^#]*)(#.*)?$/.exec(v);
	return bang && bang[2].trim() ? { head: bang[1], target: bang[2].trim(), tail: bang[3] ?? '', kind: 'bare' } : null;
}

/** The text that a YAML scalar written in a tree line stands for. */
export function scalarText(written: string): string {
	if (written.startsWith('"') && written.endsWith('"') && written.length >= 2) return written.slice(1, -1).replace(/\\(["\\])/g, '$1');
	if (written.startsWith("'") && written.endsWith("'") && written.length >= 2) return written.slice(1, -1).replace(/''/g, "'");
	return written;
}

// ---------------------------------------------------------------------------------------------------------
// Obsidian's link search, as the fake vault does it

/** The vault path of the file that a link target names, or null. A picture target names the file with that extension; any other target names a note. */
export function resolveLink(paths: readonly string[], target: string): string | null {
	const t = target.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
	if (!t) return null;
	const pic = isPictureName(t);
	const hits = paths.filter((p) => {
		const q = p.toLowerCase();
		if (pic) return isPictureName(q) && (q === t || q.endsWith(`/${t}`));
		if (!q.endsWith('.md')) return false;
		const a = stripMd(q);
		const b = stripMd(t);
		return a === b || a.endsWith(`/${b}`);
	});
	if (hits.length === 1) return hits[0];
	if (hits.length === 0) return null;
	const exact = hits.filter((p) => stripMd(p.toLowerCase()) === stripMd(t) || p.toLowerCase() === t);
	return exact.length === 1 ? exact[0] : null;
}

/** The link text Obsidian writes for a file: the shortest path that names it alone, or the whole path. A note has no ".md"; a picture keeps its extension. */
export function linkTextFor(paths: readonly string[], path: string, absolute: boolean): string {
	const note = path.toLowerCase().endsWith('.md');
	const full = note ? stripMd(path) : path;
	if (absolute) return full;
	const segs = full.split('/');
	for (let n = 1; n <= segs.length; n++) {
		const t = segs.slice(segs.length - n).join('/');
		if (resolveLink(paths, t) === path) return t;
	}
	return full;
}

// ---------------------------------------------------------------------------------------------------------
// The vault

/** A line of a note. */
export type VLine = { exact: string } | { pre: string; val: LinkVal; post: string };

export interface VNote {
	fileId: number;
	lines: VLine[];
	eol: '\n' | '\r\n';
	/** True if the note has at least one real `dynasty` block. */
	hasTree: boolean;
	/** True if a tree in the note has a YAML fault that stops every write: its links stay as they are. */
	broken: boolean;
	/** What the metadata cache of the note shows, as section types; null for no cache entry yet. */
	sections: string[] | null;
}

export interface Vault {
	files: VFile[];
	notes: Map<number, VNote>;
	absolute: boolean;
	nextId: number;
	used: Set<string>;
}

export const render = (n: VNote): string => n.lines.map((l) => ('exact' in l ? l.exact : l.pre + l.val.written + l.post)).join(n.eol);

/** The vault's path of a file by id. */
export const pathOf = (v: Vault, id: number): string => v.files.find((f) => f.id === id)!.path;

const quote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** All the ways in which a link to a note or a picture is written, as the generator makes them. `paths` are the vault paths before the update. */
function linkText(rand: () => number, v: Vault, file: VFile, key: LinkVal['key']): { text: string; plain: boolean } | null {
	const paths = v.files.map((f) => f.path);
	const path = file.path;
	const note = file.kind === 'note';
	const full = note ? stripMd(path) : path;
	const segs = full.split('/');
	// Target spellings that the vault resolves to this file.
	const spellings: string[] = [];
	for (let n = 1; n <= segs.length; n++) {
		const t = segs.slice(segs.length - n).join('/');
		if (resolveLink(paths, t) === path) spellings.push(t);
	}
	if (spellings.length === 0) return null;
	let target = pick(rand, spellings);
	if (rand() < 0.15) target = target.toLowerCase();
	if (resolveLink(paths, target) !== path) target = spellings[0];
	if (note && rand() < 0.3) target += '.md';
	if (resolveLink(paths, target) !== path) return null;
	const heading = note && rand() < 0.25 ? '#Part one' : '';
	const alias = rand() < 0.3 ? (note ? '|The hall' : '|50') : '';
	const kind = pick(rand, ['wiki', 'wiki', 'wiki', 'md', 'angle', 'bare'] as const);
	const bang = !note && rand() < 0.4 ? '!' : '';
	if (kind === 'wiki') return { text: `${bang}[[${target}${heading}${alias}]]`, plain: false };
	if (kind === 'md') {
		const enc = target.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
		return { text: `${bang}[${note ? 'The hall' : 'Shield'}](${enc}${heading.replace(' ', '%20')})`, plain: false };
	}
	if (kind === 'angle') return { text: `${bang}[Alias](<${target}${heading}>)`, plain: false };
	// A bare target; a picture may start with "!".
	return { text: `${note || key === 'link' ? '' : bang}${target}${heading}`, plain: true };
}

/** Writes a link text as a YAML scalar: quoted, or plain when the text is safe plain, or the unquoted `[[x]]` the plugin tolerates. */
function yamlScalar(rand: () => number, text: string, plain: boolean): string {
	if (/^!?\[\[[\p{L}\p{N} .\-_/()&+=@$%]*\]\]$/u.test(text) && rand() < 0.3) return text;
	if (plain && /^[\p{L}\p{N}][\p{L}\p{N} ./_()&+=@$%-]*$/u.test(text) && !/ #|: /.test(text) && rand() < 0.5) return text;
	return rand() < 0.2 ? `'${text.replace(/'/g, "''")}'` : quote(text);
}

/** A value for the key of a person or a house, pointing at `file`. */
function linkVal(rand: () => number, v: Vault, file: VFile, key: LinkVal['key']): LinkVal | null {
	const t = linkText(rand, v, file, key);
	if (!t) return null;
	return { key, fileId: file.id, written: yamlScalar(rand, t.text, t.plain) };
}

/** A value that points at no file of the vault, or at a web address. */
function deadVal(rand: () => number, key: LinkVal['key']): LinkVal {
	const text = pick(rand, ['[[Nowhere at all]]', '[[Missing/Place|x]]', 'https://example.com/Hall%20Keep', '[Site](https://example.com/Old)', 'Nothing here', '![[ghost.png]]', '[[ghost.png]]']);
	return { key, fileId: null, written: quote(text) };
}

const TEXT_WORDS = ['Valmont', 'the', 'old', 'keep', 'stone', 'river', 'house', 'crown'];
const sentence = (rand: () => number, n = 6) => Array.from({ length: n }, () => pick(rand, TEXT_WORDS)).join(' ');

/** Text lines for a note, with links, embeds and other marks in plain text: they must not change. */
function proseLines(rand: () => number, v: Vault, n: number): string[] {
	const lines: string[] = [];
	const files = v.files;
	for (let i = 0; i < n; i++) {
		const f = pick(rand, files);
		const name = f.kind === 'note' ? stripMd(baseOf(f.path)) : baseOf(f.path);
		const r = rand();
		if (r < 0.25) lines.push(`${sentence(rand)} [[${name}]] and [[${f.kind === 'note' ? stripMd(f.path) : f.path}|alias]].`);
		else if (r < 0.4) lines.push(`![[${name}]]`);
		else if (r < 0.55) lines.push(`${sentence(rand)} [see](${encodeURI(f.path)}) ${sentence(rand, 2)}`);
		else if (r < 0.65) lines.push(`# ${sentence(rand, 2)}`);
		else if (r < 0.75) lines.push('');
		else if (r < 0.85) lines.push(`The dynasty of [[${name}]] has a tree.`);
		else lines.push(sentence(rand));
	}
	return lines;
}

/** A code fence that is not a tree, with links and the word "dynasty" in it. */
function decoyFence(rand: () => number, v: Vault): string[] {
	const f = pick(rand, v.files);
	const name = f.kind === 'note' ? stripMd(baseOf(f.path)) : baseOf(f.path);
	const lang = pick(rand, ['python', 'dynasty-tree', 'text', 'yaml', 'Dynasty', 'js dynasty', 'dynasty2', '']);
	return [`\`\`\`${lang}`, 'people:', '  - id: x', `    name: dynasty of ${name}`, `    link: "[[${name}]]"`, `    portrait: "${f.kind === 'picture' ? `[[${name}]]` : '[[ghost.png]]'}"`, '```'];
}

/** The body lines of one tree. A link value stands in its own line (`templated`) with the text around it. */
export function treeBody(rand: () => number, v: Vault, pre: string, state: { broken: boolean }): VLine[] {
	const out: VLine[] = [];
	const exact = (s: string) => out.push({ exact: s === '' ? pre.trimEnd() : pre + s });
	const notes = v.files.filter((f) => f.kind === 'note');
	const pics = v.files.filter((f) => f.kind === 'picture');
	const value = (key: LinkVal['key']): LinkVal => {
		for (let i = 0; i < 5; i++) {
			if (rand() < 0.1) return deadVal(rand, key);
			const f = key === 'link' ? (rand() < 0.04 && pics.length ? pick(rand, pics) : pick(rand, notes)) : pics.length ? pick(rand, pics) : null;
			if (!f) return deadVal(rand, key);
			const val = linkVal(rand, v, f, key);
			if (val) return val;
		}
		return deadVal(rand, key);
	};
	const note = () => {
		const f = pick(rand, v.files);
		return f.kind === 'note' ? stripMd(baseOf(f.path)) : baseOf(f.path);
	};
	if (rand() < 0.5) exact('# a comment with [[' + note() + ']]');
	const houses = rand() < 0.6 ? ['h0', 'h1'] : [];
	const sections = rand() < 0.7 ? ['houses', 'people'] : ['people', 'houses'];
	for (const section of sections) {
		if (section === 'houses') {
			if (!houses.length) continue;
			exact('houses:');
			for (const h of houses) {
				exact(`  - id: ${h}`);
				exact(`    name: House ${h}`);
				if (rand() < 0.8) out.push({ pre: pre + '    arms: ', val: value('arms'), post: rand() < 0.2 ? ' # the arms' : '' });
				exact(`    x-extra: "[[${note()}]]"`);
			}
		} else {
			exact('people:');
			const n = 2 + Math.floor(rand() * 5);
			for (let i = 0; i < n; i++) {
				const flow = rand() < 0.25;
				const id = `p${i}`;
				if (flow) {
					const key = pick(rand, ['link', 'portrait'] as const);
					out.push({ pre: `${pre}  - {id: ${id}, name: "Person ${i}", ${key}: `, val: value(key), post: `, house: ${houses[0] ?? 'h0'}}${rand() < 0.3 ? ` # see [[${note()}]]` : ''}` });
					continue;
				}
				exact(`  - id: ${id}`);
				exact(`    name: ${pick(rand, ['Person', 'Ser', 'Lady'])} ${i}`);
				if (rand() < 0.2) exact(`    # the note is [[${note()}]]`);
				for (const key of ['link', 'portrait', 'arms'] as const) {
					if (rand() < (key === 'link' ? 0.8 : 0.5)) {
						out.push({ pre: pre + `    ${key}: `, val: value(key), post: rand() < 0.2 ? ` # ${key} of ${id}` : '' });
					}
				}
				if (rand() < 0.4) exact(`    notes: "Born in [[${note()}]], see ![[${note()}]]."`);
				if (rand() < 0.3) exact(`    x-memo: [[${note()}]]`);
				if (rand() < 0.5) exact(`    house: ${houses[0] ?? 'h0'}`);
			}
		}
	}
	if (rand() < 0.08) {
		// A fault in the YAML: no write is possible, so the links stay.
		state.broken = true;
		exact('  - id: bad');
		exact('    name: [unclosed');
	}
	return out;
}

/** A random vault. */
export function genVault(seed: number): Vault {
	const rand = rng(seed * 7919 + 13);
	const v: Vault = { files: [], notes: new Map(), absolute: rand() < 0.3, nextId: 1, used: new Set() };
	const folders = ['', 'People', 'People/Kings', 'Places', 'Art', 'Art/Arms', 'Notes/Old'];
	const nNotes = 20 + Math.floor(rand() * 41);
	const nPics = 3 + Math.floor(rand() * 8);
	// Names that two notes may share (different folders): links to them use the whole path.
	const twin = freshName(rand, v.used);
	let twinCount = 0;
	for (let i = 0; i < nNotes; i++) {
		const folder = pick(rand, folders.filter((f) => !f.startsWith('Art')));
		let name: string;
		if (twinCount < 2 && rand() < 0.08) {
			name = twin;
			twinCount++;
		} else name = freshName(rand, v.used);
		let path = `${folder ? `${folder}/` : ''}${name}.md`;
		while (v.files.some((f) => f.path.toLowerCase() === path.toLowerCase())) path = `${folder ? `${folder}/` : ''}${name} x.md`;
		v.files.push({ id: v.nextId++, path, kind: 'note' });
	}
	for (let i = 0; i < nPics; i++) {
		const name = freshName(rand, v.used, ['arms', 'portrait', 'shield', 'Éowyn', 'lion (red)', 'crest']);
		const ext = pick(rand, ['png', 'jpg', 'svg', 'webp', 'gif']);
		const folder = pick(rand, ['Art', 'Art/Arms', '', 'Places']);
		v.files.push({ id: v.nextId++, path: `${folder ? `${folder}/` : ''}${name}.${ext}`, kind: 'picture' });
	}
	if (rand() < 0.5) v.files.push({ id: v.nextId++, path: 'Notes/Old/readme.txt', kind: 'other' });

	// The notes: about half have a tree.
	for (const f of v.files.filter((x) => x.kind === 'note')) {
		const eol = rand() < 0.3 ? '\r\n' : '\n';
		const lines: VLine[] = [];
		const ex = (s: string) => lines.push({ exact: s });
		const withTree = rand() < 0.5;
		const state = { broken: false };
		let hasTree = false;
		for (const l of proseLines(rand, v, 1 + Math.floor(rand() * 4))) ex(l);
		const sections: string[] = ['paragraph'];
		if (withTree) {
			const trees = 1 + Math.floor(rand() * 3);
			for (let t = 0; t < trees; t++) {
				const where = pick(rand, ['plain', 'plain', 'callout', 'list'] as const);
				const pre = where === 'callout' ? '> ' : where === 'list' ? '  ' : '';
				ex('');
				if (where === 'callout') ex('> [!note] The tree');
				if (where === 'list') ex('- an item');
				const fence = pick(rand, ['`', '`', '~'] as const).repeat(3);
				lines.push({ exact: `${pre}${fence}dynasty` });
				for (const l of treeBody(rand, v, pre, state)) lines.push(l);
				lines.push({ exact: `${pre}${fence}` });
				hasTree = true;
				sections.push(where === 'callout' ? 'callout' : where === 'list' ? 'list' : 'code');
				if (rand() < 0.4) for (const l of proseLines(rand, v, 1 + Math.floor(rand() * 2))) ex(l);
			}
		}
		if (rand() < 0.35) {
			ex('');
			for (const l of decoyFence(rand, v)) ex(l);
			sections.push('code');
		}
		// A last line with a break or without.
		ex('');
		v.notes.set(f.id, { fileId: f.id, lines, eol, hasTree, broken: state.broken, sections: rand() < 0.25 ? null : sections });
	}
	return v;
}

// ---------------------------------------------------------------------------------------------------------
// Renames

export type RenameStep =
	| { what: 'move'; id: number; to: string }
	| { what: 'folder'; from: string; to: string };

/** A random rename of a note, a picture, or a folder; names are new, so no link becomes ambiguous. */
export function randomRename(rand: () => number, v: Vault): RenameStep {
	const r = rand();
	if (r < 0.2) {
		// A folder: every file in it moves.
		const folders = [...new Set(v.files.flatMap((f) => (folderOf(f.path) ? [folderOf(f.path)] : [])))];
		if (folders.length) {
			const from = pick(rand, folders);
			const parent = folderOf(from);
			const name = freshName(rand, v.used, ['Archive', 'Moved', 'Court', 'Lands']).replace(/[,&+=@$%]/g, '');
			return { what: 'folder', from, to: `${parent ? `${parent}/` : ''}${name}` };
		}
	}
	const pool = r < 0.65 ? v.files.filter((f) => f.kind === 'note') : r < 0.9 ? v.files.filter((f) => f.kind === 'picture') : v.files;
	const f = pick(rand, pool.length ? pool : v.files);
	const ext = extOf(f.path);
	const base = rand() < 0.15 ? baseOf(f.path).replace(/\.[^.]+$/, '') : freshName(rand, v.used);
	const folder = rand() < 0.5 ? folderOf(f.path) : pick(rand, ['', 'People', 'Places', 'Archive', 'Art', 'Notes/Old/Deep']);
	// Sometimes a picture gets another picture extension, and sometimes a file gets an extension that is neither (no update then).
	let newExt = ext;
	if (f.kind === 'picture' && rand() < 0.2) newExt = pick(rand, ['png', 'jpg', 'svg', 'webp']);
	if (rand() < 0.07) newExt = f.kind === 'note' ? 'txt' : 'heic';
	let to = `${folder ? `${folder}/` : ''}${base}.${newExt}`;
	if (to.toLowerCase() === f.path.toLowerCase() || v.files.some((x) => x.path.toLowerCase() === to.toLowerCase())) to = `${folder ? `${folder}/` : ''}${freshName(rand, v.used)}.${newExt}`;
	return { what: 'move', id: f.id, to };
}

/** The moves (id, old path, new path) that a step makes. */
export function movesOf(v: Vault, step: RenameStep): { id: number; from: string; to: string }[] {
	if (step.what === 'move') return [{ id: step.id, from: pathOf(v, step.id), to: step.to }];
	return v.files.filter((f) => f.path.startsWith(`${step.from}/`)).map((f) => ({ id: f.id, from: f.path, to: step.to + f.path.slice(step.from.length) }));
}

/** `renameKind` of the spec (§6.9, §13.0 item 3), written again from the words: a note renamed to a note, or a picture to a picture. */
export function expectedKind(from: string, to: string): 'note' | 'picture' | null {
	const a = extOf(from);
	const b = extOf(to);
	if (a === 'md' && b === 'md') return 'note';
	if (PICTURE_EXTENSIONS.includes(a) && PICTURE_EXTENSIONS.includes(b)) return 'picture';
	return null;
}

// ---------------------------------------------------------------------------------------------------------
// The checks after one step

/**
 * Compares the note texts after an update with what the generator knows. `paths` are the vault paths after the
 * rename. `updated`: the ids of the files whose rename starts an update (renameKind is not null). Returns the
 * problems; the new `written` values are stored in the vault for the next step.
 */
export function checkNotes(v: Vault, texts: Map<string, string>, pathsNow: ReadonlyMap<number, string>, ctx: { updated: Set<number>; setting: boolean; label: string; pathsBefore: ReadonlyMap<number, string> }): string[] {
	const problems: string[] = [];
	const paths = [...pathsNow.values()];
	const pathsBefore = [...ctx.pathsBefore.values()];
	for (const [id, note] of v.notes) {
		const path = pathsNow.get(id)!;
		const text = texts.get(path);
		if (text === undefined) {
			problems.push(`${ctx.label}: the note ${path} is gone`);
			continue;
		}
		const before = render(note);
		const lines = text.split(note.eol);
		if (!note.hasTree || v.files.find((f) => f.id === id)!.kind === 'other') {
			if (text !== before) problems.push(`${ctx.label}: the note ${path} has no tree (or is no note now) and changed`);
			continue;
		}
		if (lines.length !== note.lines.length) {
			problems.push(`${ctx.label}: the note ${path} has ${lines.length} lines, it had ${note.lines.length}`);
			continue;
		}
		const strayBreak = note.eol === '\n' ? text.includes('\r') : /[\r\n]/.test(text.replace(/\r\n/g, ''));
		if (strayBreak) problems.push(`${ctx.label}: the line endings of ${path} changed`);
		const next: VLine[] = [];
		note.lines.forEach((l, i) => {
			const got = lines[i];
			if ('exact' in l) {
				if (got !== l.exact) problems.push(`${ctx.label}: ${path} line ${i + 1} is not a link value and changed: ${JSON.stringify(l.exact)} -> ${JSON.stringify(got)}`);
				next.push(l);
				return;
			}
			if (!got.startsWith(l.pre) || !got.endsWith(l.post) || got.length < l.pre.length + l.post.length) {
				problems.push(`${ctx.label}: ${path} line ${i + 1}: the text around the link value changed: ${JSON.stringify(render({ ...note, lines: [l] }))} -> ${JSON.stringify(got)}`);
				next.push(l);
				return;
			}
			const written = got.slice(l.pre.length, got.length - l.post.length);
			const nowTarget = l.val.fileId === null ? '' : pathsNow.get(l.val.fileId)!;
			const where = `${ctx.label}: ${path} line ${i + 1} (${l.val.key})`;
			const oldText = scalarText(l.val.written);
			const newText = scalarText(written);
			// A tree with a YAML fault: the plugin may leave it as it is (the spec does not say), but if it writes, the value must be right.
			if (note.broken && written === l.val.written) {
				next.push(l);
				return;
			}
			const dead = l.val.fileId === null || v.files.find((f) => f.id === l.val.fileId)!.kind === 'other';
			if (dead) {
				// A link to no file, or to a file that is no longer a note or a picture (renamed to another extension): no update.
				if (written !== l.val.written) problems.push(`${where}: a link to no file of the vault changed: ${oldText} -> ${newText}`);
				next.push(l);
				return;
			}
			const oldParts = parseParts(oldText);
			const newParts = parseParts(newText);
			if (!oldParts || !newParts) {
				problems.push(`${where}: cannot read the link ${JSON.stringify(newText)}`);
				next.push(l);
				return;
			}
			// A value stays as it is, or is written again; either way it names the file it named.
			// A link that did not name its file before the step (an earlier rename that no update followed) is not asked to now.
			const namedBefore = resolveLink(pathsBefore, oldParts.target) === ctx.pathsBefore.get(l.val.fileId!);
			const movedWithoutUpdate = ctx.pathsBefore.get(l.val.fileId!) !== nowTarget && !ctx.updated.has(l.val.fileId!);
			const found = resolveLink(paths, newParts.target);
			// Spec §6.9 (stale-link rule, the decision notes): a link that now opens another note with the old name stays as it is and the Notice reports it.
			const oldBase = baseOf(ctx.pathsBefore.get(l.val.fileId!)!).toLowerCase();
			const keptForOther = found !== null && found.toLowerCase().endsWith('.md') && baseOf(found).toLowerCase() === oldBase && ![...pathsNow].some(([fid, pth]) => pth === found && ctx.updated.has(fid));
			if (found !== nowTarget && namedBefore && !movedWithoutUpdate && !keptForOther) problems.push(`${where}: after the rename the link ${JSON.stringify(newText)} names ${found ?? 'no file'}, not ${nowTarget} (it was ${JSON.stringify(oldText)})`);
			if (written !== l.val.written) {
				// A changed value keeps its form.
				if (newParts.head !== oldParts.head || newParts.tail !== oldParts.tail || newParts.kind !== oldParts.kind) problems.push(`${where}: the form of the link changed: ${JSON.stringify(oldText)} -> ${JSON.stringify(newText)}`);
				if (/\.md$/i.test(oldParts.target) && !/\.md$/i.test(newParts.target)) problems.push(`${where}: the link had ".md" and lost it: ${JSON.stringify(oldText)} -> ${JSON.stringify(newText)}`);
				if (isPictureName(oldParts.target) && extOf(newParts.target) !== extOf(nowTarget)) problems.push(`${where}: a picture link without the extension of the file: ${JSON.stringify(newText)}`);
				if (!ctx.setting) problems.push(`${where}: the setting is off and the link changed`);
				// Only a link to a file that moved may change.
				const movedHere = ctx.updated.has(l.val.fileId!);
				if (!movedHere) problems.push(`${where}: this link points to a file that did not move and it changed: ${JSON.stringify(oldText)} -> ${JSON.stringify(newText)}`);
			}
			next.push({ pre: l.pre, val: { ...l.val, written }, post: l.post });
		});
		note.lines = next;
	}
	return problems;
}
