/*
 * 0.3 package D (T3): a generator of random notes that knows where the real tree blocks are. Not a test file.
 *
 * The generator builds a note line by line from CommonMark rules (callouts and lists as containers, fences with
 * ``` and ~~~, front matter, decoys) and writes down the position of every real `kin` block while it builds. The
 * tests compare `findBlocks` and `planWrite` with this knowledge. Nothing here calls `findBlocks`.
 *
 * What the generator makes (spec §6.1: fences of any length, fences nested in longer fences, callouts including nested
 * ones, list items):
 * - containers: up to 3 callout levels and up to 3 list levels in any order, bullets and numbers, markers with 1 to 4
 *   spaces after them, tabs or spaces as the indent of a list, the quote mark written with and without a space;
 * - line endings LF, CRLF, mixed, and mixed with a lone CR; a byte order mark; front matter with a fenced example in it;
 * - decoys that are not blocks: other languages, other first words, a fence inside a longer fence, an indented code
 *   block (also inside a list item), a line with inline code, a word "kin" in a plain fence;
 * - one to three real trees; the last one may have no closing fence; an unclosed decoy may swallow the end;
 * - (package J, fix round) a callout opened on a list marker line ("- > q", also "- > - item"), with the tree below it
 *   in the list item; and a lone CR next to an empty line, in notes that mix the line endings.
 *
 * A fence that is real in one reading of CommonMark and not in another is left out on purpose (see the list of
 * questions in the report of the package): a fence inside an HTML comment or a math block, a byte order mark in front
 * of a fence on the first line.
 */

import { baseBody } from './r028-advb-edits-support';
import { pick, rng } from './r028-advb-gen';

/** One real tree block as the generator knows it. The fields have the meaning of `LocatedBlock` in `src/core/block-locate.ts`. */
export interface RealBlock {
	ordinal: number;
	openLine: number;
	closeLine: number | null;
	bodyStart: number;
	bodyEnd: number;
	/** The text written in front of the first non-blank body line. */
	prefix: string;
	/** The body with the prefix removed, lines joined with LF. */
	body: string;
	eol: '\n' | '\r\n';
}

/** A generated note, and what the generator knows about it. */
export interface GenNote {
	seed: number;
	text: string;
	blocks: RealBlock[];
	/** True when no fence in the note is unclosed: a write must then be accepted. */
	clean: boolean;
	/** 'lf', 'crlf', 'mixed', or 'mixed-cr' (a lone CR too). */
	endings: 'lf' | 'crlf' | 'mixed' | 'mixed-cr';
	/** The names of the features the note uses, for the coverage test. */
	features: string[];
}

type Piece =
	| { t: 'q'; style: 'sp' | 'bare' | 'lead' }
	| { t: 'l'; ind: number; marker: string; sibling: string; gap: number };

const spaces = (n: number) => ' '.repeat(n);

/** The width of a list piece: the columns from the container to the content. */
const widthOf = (p: Piece & { t: 'l' }) => p.ind + p.marker.length + p.gap;

/** Writes a chain of containers in front of `text`. `opener`: the marker lines; else the continuation lines. */
function render(chain: readonly Piece[], text: string, opener: boolean): string {
	if (chain.length === 0) return text;
	const [first, ...rest] = chain;
	const inner = render(rest, text, opener);
	if (first.t === 'l') return (opener ? spaces(first.ind) + first.marker + spaces(first.gap) : spaces(widthOf(first))) + inner;
	if (first.style === 'lead') return ` > ${inner}`;
	// The first space after ">" belongs to the mark: a bare mark is right only if the text does not start with a space or a tab.
	if (first.style === 'bare' && !/^[ \t]/.test(inner)) return `>${inner}`;
	return `> ${inner}`;
}

const onlyLists = (chain: readonly Piece[]) => chain.every((p) => p.t === 'l');

/** The tabs-and-spaces form of `n` columns at the start of a line. */
const tabbed = (n: number) => '\t'.repeat(Math.floor(n / 4)) + spaces(n % 4);

/** What stands in front of a continuation line with `extra` columns of indent before `text`. */
function lead(chain: readonly Piece[], extra: number, text: string, tabs: boolean): string {
	if (tabs) {
		let n = extra;
		for (const p of chain) if (p.t === 'l') n += widthOf(p);
		return tabbed(n);
	}
	const s = render(chain, spaces(extra) + text, false);
	return s.slice(0, s.length - text.length);
}

const WORDS = ['alpha', 'river', 'house', 'stone', 'crown', 'north', 'the', 'old', 'keep', 'grain', 'kin', 'of', 'Valmont', 'tower', 'lord', 'ash'];
const sentence = (rand: () => number, n = 3 + Math.floor(rand() * 4)) => Array.from({ length: n }, () => pick(rand, WORDS)).join(' ');

/** A random chain of containers: up to 3 callouts and up to 3 lists, at most 4 in all. */
function randomChain(rand: () => number): Piece[] {
	if (rand() < 0.3) return [];
	const total = 1 + Math.floor(rand() * (rand() < 0.5 ? 2 : 4));
	const chain: Piece[] = [];
	let quotes = 0;
	let lists = 0;
	for (let i = 0; i < total; i++) {
		const wantList = rand() < 0.5;
		if (wantList && lists < 3) {
			lists++;
			const ordered = rand() < 0.4;
			const closer = rand() < 0.5 ? '.' : ')';
			// An ordered list that starts a list inside a paragraph must start with 1.
			const marker = ordered ? `1${closer}` : pick(rand, ['-', '*', '+']);
			chain.push({ t: 'l', ind: pick(rand, [0, 0, 0, 1, 2, 3]), marker, sibling: ordered ? `2${closer}` : marker, gap: pick(rand, [1, 1, 1, 2, 3, 4]) });
		} else if (quotes < 3) {
			quotes++;
			chain.push({ t: 'q', style: pick(rand, ['sp', 'sp', 'bare', 'lead'] as const) });
		} else if (lists < 3) {
			lists++;
			chain.push({ t: 'l', ind: 0, marker: '-', sibling: '-', gap: 1 });
		}
	}
	// A callout written with a space before its mark (" > ") after a list marker with 4 spaces would be 5 spaces behind the
	// marker: that is indented code, not a callout (CommonMark). The callout then takes the plain form.
	chain.forEach((p, i) => {
		const before = chain[i - 1];
		if (p.t === 'q' && p.style === 'lead' && before?.t === 'l' && before.gap >= 4) p.style = 'sp';
	});
	return chain;
}

/** What one fenced block looks like. */
interface FenceSpec {
	char: '`' | '~';
	openLen: number;
	info: string;
	/** The closing fence length; null for no closing fence. */
	closeLen: number | null;
	extra: number;
	closeExtra: number;
	closeTail: string;
	body: string[];
	/** The fence stands on the marker line of the innermost list item. */
	onMarkerLine: boolean;
	/** The innermost list item starts with a callout ("- > Source") and the fence stands below it, in the item. */
	quoteLine: boolean;
	tabs: boolean;
	/** Text after the unclosed block that ends its container: none, a line of text, a sibling list item. */
	end: 'none' | 'text' | 'sibling';
}

/** One built fence: the line numbers and the body as written. */
interface Emitted {
	openLine: number;
	closeLine: number | null;
	firstBody: number;
	lastBody: number;
	prefix: string;
	body: string[];
}

class Builder {
	lines: string[] = [];
	/** True when a callout stood on the marker line of a list item ("- > - item") in some chain. */
	sharedQuote = false;
	constructor(readonly rand: () => number) {}

	push(s: string): number {
		this.lines.push(s);
		return this.lines.length - 1;
	}

	/**
	 * The marker lines of a chain; the innermost one carries `last`. A piece may share a line with the piece before it.
	 * `fence`: `last` is a fence. A fence on the marker line of a list item inside a callout that starts on that line
	 * ("- > - ```kin") stays unread (a known limit of package J), so then the callout ends its line.
	 */
	openers(chain: readonly Piece[], last: string, fence = false): void {
		let done: Piece[] = [];
		let i = 0;
		while (i < chain.length) {
			const group: Piece[] = [chain[i]];
			let k = i + 1;
			// Several pieces on one line: a callout after any piece, or a list with no indent after any piece.
			while (k < chain.length && this.rand() < 0.4) {
				const next = chain[k];
				if (next.t === 'l' && next.ind !== 0) break;
				group.push(next);
				k++;
				if (fence && next.t === 'q' && group.slice(0, -1).some((x) => x.t === 'l')) break;
			}
			if (group.some((x, at) => x.t === 'q' && group.slice(0, at).some((y) => y.t === 'l'))) this.sharedQuote = true;
			// A list item with no text would take another content column; every marker line has text.
			const tail = k === chain.length ? last : sentence(this.rand, 2);
			this.push(render(done, render(group, tail, true), false));
			done = [...done, ...group];
			i = k;
		}
	}

	/** A fenced block inside `chain`, as `spec` says. */
	fenced(chain: readonly Piece[], spec: FenceSpec): Emitted {
		const rand = this.rand;
		const fence = spec.char.repeat(spec.openLen) + spec.info;
		const last = chain[chain.length - 1];
		const marker = spec.onMarkerLine && last?.t === 'l';
		let openLine: number;
		if (chain.length === 0) openLine = this.push(spaces(spec.extra) + fence);
		else if (marker) {
			this.openers(chain, fence, true);
			openLine = this.lines.length - 1;
		} else {
			// A text line inside the innermost container comes first, so the fence has a paragraph above it (it ends the paragraph).
			// A list item may start with a callout ("- > Source"): the callout ends where the fence starts, and the item goes on.
			const quoteLine = spec.quoteLine && last.t === 'l';
			this.openers(chain, last.t === 'q' ? pick(rand, ['[!note] A tree', '[!tip]- Folded tree', 'Notes', sentence(rand, 2)]) : quoteLine ? `> ${sentence(rand, 2)}` : sentence(rand, 2));
			if (quoteLine && rand() < 0.5) this.push(render(chain, `> ${sentence(rand, 3)}`, false));
			openLine = this.push(lead(chain, spec.extra, fence, spec.tabs) + fence);
		}
		const extra = marker ? 0 : spec.extra;
		const body: string[] = [];
		let prefix: string | null = null;
		const firstBody = this.lines.length;
		for (const l of spec.body) {
			if (l === '') {
				const full = render(chain, spaces(extra), false);
				const tabPrefix = spec.tabs ? lead(chain, extra, '', true) : full;
				const pre = spec.tabs ? tabPrefix : full;
				this.push(rand() < 0.5 ? pre.trimEnd() : pre);
			} else {
				const p = lead(chain, extra, l, spec.tabs);
				prefix ??= p;
				this.push(p + l);
			}
			body.push(l);
		}
		const lastBody = this.lines.length - 1;
		let closeLine: number | null = null;
		if (spec.closeLen !== null) {
			const close = spec.char.repeat(spec.closeLen);
			closeLine = this.push(lead(chain, spec.closeExtra, close, spec.tabs && chain.length > 0) + close + spec.closeTail);
		}
		return { openLine, closeLine, firstBody, lastBody, prefix: prefix ?? '', body };
	}
}

/** The text of a tree: a generated body, sometimes with blank lines and a comment with a tab. */
function treeBody(rand: () => number, closed: boolean): string[] {
	const lines = baseBody(rand).body.split('\n');
	const out: string[] = [];
	lines.forEach((l, i) => {
		if (i > 0 && /^[a-z]/.test(l) && rand() < 0.4) out.push('');
		out.push(l);
		if (i === 2 && rand() < 0.3) out.push('# a tab\there');
	});
	if (closed && rand() < 0.08) out.push('');
	return out;
}

const DECOY_INFO = ['python', 'js', 'text', 'yaml', 'markdown', 'kin-tree', 'Kin', 'KIN', 'kinx', 'js kin', 'yaml kin', 'tree kin', '{kin}', '.kin', 'kin2', ''];

/** Lines inside a decoy fence of `char` and `len`: none can close it, some look like fences, some name the word kin. */
function decoyLines(rand: () => number, char: '`' | '~', len: number): string[] {
	const n = 1 + Math.floor(rand() * 5);
	const other = char === '`' ? '~' : '`';
	const pool = [
		'people:',
		'# kin',
		'kin: yes',
		'the kin fell',
		`${other.repeat(3 + Math.floor(rand() * 3))}kin`,
		`${other.repeat(len)}`,
		`${other.repeat(len + 1)} x`,
		char.repeat(Math.max(1, len - 1)),
		`${char.repeat(len)} x`,
		`${char.repeat(len)}kin`,
		'  name: A',
		'- item',
		'> quote',
		'',
		'\tindented with a tab',
	];
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(pick(rand, pool));
	// A fence of the same char that is shorter has no effect either; a closer of the right size is not in the pool.
	return out.map((l) => (l.startsWith(char.repeat(len)) && !/^\S+\s+\S|kin/.test(l) ? `${l} x` : l));
}

/** Makes the note of `seed`. */
export function genNote(seed: number): GenNote {
	const rand = rng(seed * 2654435761 + 12345);
	const b = new Builder(rand);
	const features = new Set<string>();
	const real: { e: Emitted; closed: boolean }[] = [];
	let clean = true;
	const bom = rand() < 0.25;
	const front = rand() < 0.35;
	if (bom) features.add('bom');
	if (front) {
		features.add('front matter');
		b.push('---');
		b.push('title: A note');
		b.push('tags: [a, b]');
		if (rand() < 0.6) {
			features.add('fence in front matter');
			b.push('description: |');
			b.push('  Example:');
			b.push('  ```kin');
			b.push('  people: []');
			b.push('  ```');
		}
		b.push('---');
	}
	// Line 1 is never a fence, so that a byte order mark never stands in front of one.
	if (!front || rand() < 0.5) {
		b.push(rand() < 0.5 ? '# A note' : sentence(rand));
		b.push('');
	}

	const trees = 1 + Math.floor(rand() * 3);
	const tail = rand() < 0.25 ? (rand() < 0.5 ? 'real' : 'decoy') : null;
	const closedTrees = tail === 'real' ? trees - 1 : trees;
	const segments = closedTrees + 1 + Math.floor(rand() * 5);
	const kinds: string[] = [];
	for (let i = 0; i < closedTrees; i++) kinds.push('tree');
	for (let i = kinds.length; i < segments; i++) kinds.push(pick(rand, ['para', 'para', 'heading', 'list', 'callout', 'decoy', 'decoy', 'decoy', 'indented', 'rule', 'inline'] as const));
	// Shuffle (the generator's own order, seeded).
	for (let i = kinds.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[kinds[i], kinds[j]] = [kinds[j], kinds[i]];
	}

	const realSpec = (chain: readonly Piece[], closed: boolean): FenceSpec => {
		const char = rand() < 0.75 ? '`' : '~';
		const openLen = rand() < 0.7 ? 3 : 3 + Math.floor(rand() * 4);
		const tabs = onlyLists(chain) && chain.length > 0 && rand() < 0.4;
		const lastPiece = chain[chain.length - 1];
		return {
			char,
			openLen,
			info: pick(rand, ['kin', 'kin', 'kin', 'kin', ' kin', 'kin some words', '  kin']),
			closeLen: closed ? openLen + (rand() < 0.2 ? 1 + Math.floor(rand() * 2) : 0) : null,
			extra: chain.length === 0 ? (rand() < 0.15 ? 1 + Math.floor(rand() * 3) : 0) : rand() < 0.2 ? 1 + Math.floor(rand() * 3) : 0,
			closeExtra: rand() < 0.2 ? Math.floor(rand() * 4) : 0,
			closeTail: rand() < 0.15 ? pick(rand, [' ', '  ', '\t']) : '',
			body: treeBody(rand, closed),
			onMarkerLine: lastPiece?.t === 'l' && rand() < 0.25,
			quoteLine: lastPiece?.t === 'l' && rand() < 0.25,
			tabs,
			end: !closed && chain.length > 0 ? pick(rand, ['none', 'text', 'sibling'] as const) : 'none',
		};
	};

	const sepBlank = () => b.push('');

	// A list that is still open: the next lines may belong to it (CommonMark), so an indented fence needs a paragraph first.
	let listOpen = false;
	const addTree = (closed: boolean): void => {
		const chain = randomChain(rand);
		const spec = realSpec(chain, closed);
		if (spec.onMarkerLine) spec.extra = 0;
		if (chain.length === 0 && spec.extra > 0 && listOpen) {
			b.push(sentence(rand, 3));
			b.push('');
		}
		listOpen = chain.some((x) => x.t === 'l');
		const e = b.fenced(chain, spec);
		real.push({ e, closed });
		const depthQ = chain.filter((p) => p.t === 'q').length;
		const depthL = chain.filter((p) => p.t === 'l').length;
		if (depthQ) features.add(`callouts ${depthQ}`);
		if (depthL) features.add(`lists ${depthL}`);
		if (chain.some((p) => p.t === 'l' && /^\d/.test(p.marker))) features.add('numbered list');
		if (chain.some((p) => p.t === 'l' && !/^\d/.test(p.marker))) features.add('bullet list');
		if (chain.some((p) => p.t === 'q' && p.style === 'bare')) features.add('bare quote mark');
		if (chain.length === 0) features.add('top level');
		if (spec.tabs) features.add('tab indent');
		if (spec.onMarkerLine) features.add('fence on the marker line');
		if (spec.quoteLine && !spec.onMarkerLine && chain[chain.length - 1]?.t === 'l') features.add('callout on a marker line');
		if (spec.extra) features.add('indented fence');
		if (spec.char === '~') features.add('tilde fence');
		if (spec.openLen > 3) features.add('long fence');
		if (spec.info !== 'kin') features.add('info string variant');
		if (!closed) {
			features.add('unclosed tree');
			clean = false;
		}
		if (closed) {
			const lastPiece = chain[chain.length - 1];
			// An optional following sibling or quote line, so the container goes on after the fence.
			if (lastPiece?.t === 'l' && rand() < 0.4) b.push(render(chain.slice(0, -1), spaces(lastPiece.ind) + lastPiece.sibling + spaces(lastPiece.gap) + sentence(rand, 2), false));
			else if (lastPiece?.t === 'q' && rand() < 0.4) b.push(render(chain, sentence(rand, 3), false));
		} else {
			const lastPiece = chain[chain.length - 1];
			if (spec.end === 'text') b.push(sentence(rand, 3));
			else if (spec.end === 'sibling' && lastPiece?.t === 'l') b.push(render(chain.slice(0, -1), spaces(lastPiece.ind) + lastPiece.sibling + spaces(lastPiece.gap) + sentence(rand, 2), false));
		}
	};

	for (const kind of kinds) {
		// A line of text at column 0 ends a list.
		if (kind !== 'tree' && kind !== 'list' && kind !== 'decoy') listOpen = false;
		if (kind === 'tree') addTree(true);
		else if (kind === 'para') b.push(sentence(rand, 6) + ' with `inline code` and [[a link]].');
		else if (kind === 'heading') b.push(pick(rand, ['## ', '### ', '# ']) + sentence(rand, 2));
		else if (kind === 'rule') b.push(// Not "- - -": findBlocks reads it as nested list items (finding F4, written by hand in the test file).
			pick(rand, ['---', '***', '___']));
		else if (kind === 'inline') b.push('```kin``` is how the block starts (inline).');
		else if (kind === 'list') {
			listOpen = true;
			const n = 2 + Math.floor(rand() * 3);
			const ordered = rand() < 0.4;
			for (let i = 0; i < n; i++) b.push(`${ordered ? `${i + 1}.` : '-'} ${sentence(rand, 2)}`);
		} else if (kind === 'callout') {
			b.push('> [!note] ' + sentence(rand, 2));
			b.push('> ' + sentence(rand, 4));
			if (rand() < 0.5) b.push('> > ' + sentence(rand, 3));
		} else if (kind === 'indented') {
			features.add('indented code block');
			b.push(sentence(rand, 3));
			b.push('');
			const ind = rand() < 0.5 ? '    ' : '\t';
			b.push(`${ind}\`\`\`kin`);
			b.push(`${ind}people:`);
			b.push(`${ind}  - id: z`);
			if (rand() < 0.5) b.push(`${ind}\`\`\``);
		} else {
			// A decoy fence, alone or inside a container; sometimes it holds a whole tree in a longer fence.
			const chain = randomChain(rand);
			listOpen = chain.some((x) => x.t === 'l');
			const char: '`' | '~' = rand() < 0.5 ? '`' : '~';
			const nested = rand() < 0.4;
			const openLen = nested ? 4 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 3);
			const info = pick(rand, nested ? ['', 'markdown', 'text'] : DECOY_INFO);
			let body: string[];
			if (nested) {
				features.add('fence in a fence');
				const innerChar: '`' | '~' = rand() < 0.5 ? char : char === '`' ? '~' : '`';
				const innerLen = innerChar === char ? 3 : 3 + Math.floor(rand() * 2);
				body = [`${innerChar.repeat(innerLen)}kin`, ...treeBody(rand, true), innerChar.repeat(innerLen)];
			} else body = decoyLines(rand, char, openLen);
			if (info !== '') features.add(`decoy info ${info === 'markdown' || info === 'text' ? 'plain' : 'word'}`);
			features.add('decoy fence');
			if (chain.length) features.add('decoy in a container');
			b.fenced(chain, {
				char,
				openLen,
				info,
				closeLen: openLen + (rand() < 0.2 ? 1 : 0),
				extra: 0,
				closeExtra: 0,
				closeTail: '',
				body,
				onMarkerLine: false,
				quoteLine: false,
				tabs: false,
				end: 'none',
			});
		}
		sepBlank();
	}

	if (tail === 'real') addTree(false);
	else if (tail === 'decoy') {
		features.add('unclosed decoy');
		clean = false;
		b.push(`~~~${pick(rand, ['python', 'text'])}`);
		b.push('some text');
		b.push('```kin');
		for (const l of treeBody(rand, false)) b.push(l);
		b.push('```');
		b.push('more text');
	}

	// Line endings.
	const endings = pick(rand, ['lf', 'lf', 'crlf', 'crlf', 'mixed', 'mixed-cr'] as const);
	features.add(`endings ${endings}`);
	let afterCr = false;
	const breaks = b.lines.map((line) => {
		if (endings === 'lf') return '\n';
		if (endings === 'crlf') return '\r\n';
		if (endings === 'mixed') return rand() < 0.5 ? '\n' : '\r\n';
		// A lone CR before an empty line that ends with LF would be one CRLF: the line count would change. So the break
		// after an empty line that follows a lone CR is a lone CR too (the shape of the old fault F3, package J).
		const r = rand();
		const br = afterCr && line === '' ? '\r' : r < 0.15 ? '\r' : r < 0.55 ? '\n' : '\r\n';
		afterCr = br === '\r';
		return br;
	});
	if (b.sharedQuote) features.add('callout and list on one marker line');
	if (breaks.some((br, i) => br === '\r' && b.lines[i + 1] === '')) features.add('lone CR before an empty line');
	// The note ends with a break, except sometimes when the last line is not part of a block that needs its break.
	const endsWithBreak = rand() < 0.75;
	const lines = b.lines.slice();
	if (bom) lines[0] = String.fromCharCode(0xfeff) + lines[0];
	const starts: number[] = [];
	let text = '';
	lines.forEach((l, i) => {
		starts.push(text.length);
		text += l;
		if (i < lines.length - 1 || endsWithBreak) text += breaks[i];
	});

	// The first line break of kind LF or CRLF gives the note's ending (a lone CR is not counted).
	let eol: '\n' | '\r\n' = '\n';
	for (let i = 0; i < lines.length; i++) {
		if (i === lines.length - 1 && !endsWithBreak) break;
		if (breaks[i] === '\n' || breaks[i] === '\r\n') {
			eol = breaks[i] as '\n' | '\r\n';
			break;
		}
	}

	const blocks: RealBlock[] = real.map(({ e }, ordinal) => ({
		ordinal,
		openLine: e.openLine,
		closeLine: e.closeLine,
		bodyStart: starts[e.firstBody],
		bodyEnd: starts[e.lastBody] + lines[e.lastBody].length,
		prefix: e.prefix,
		body: e.body.join('\n'),
		eol,
	}));
	return { seed, text, blocks, clean, endings, features: [...features] };
}
