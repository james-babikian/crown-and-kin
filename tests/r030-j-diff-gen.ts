/*
 * 0.3 package J (fix round): random line combinations for the differential test of `findBlocks` against the code of
 * release 0.2.8 (`old-block-locate.ts`). Not a test file. The lines are the shapes that decide the container of a fence:
 * list markers, quote markers, markers that open a quote on a marker line, fences at several indents, margin lines.
 */

import { pick, rng } from './r028-advb-gen';

const LEAD = ['', '', '', ' ', '  ', '   ', '    ', '\t', '  \t'];
const QUOTE = ['', '', '> ', '>', '  > ', '> > ', '>  ', ' > > '];
const MARKER = ['-', '-', '*', '+', '1.', '2)', '10.'];
const GAP = [' ', ' ', ' ', '  ', '   ', '    ', '     ', '       ', '\t'];

/** Which of the two old-fault shapes a note may hold: a quote on a marker line ("- > q") and a spaced thematic break ("- - -"). */
export type Shapes = 'none' | 'quote' | 'break' | 'both';

/** One random line. */
function line(rand: () => number, shapes: Shapes): string {
	const lead = pick(rand, LEAD);
	const q = pick(rand, QUOTE);
	const marker = pick(rand, MARKER);
	const gap = pick(rand, GAP);
	const fence = pick(rand, ['```kin', '```kin', '```', '~~~kin', '````kin', '```js', '~~~']);
	const close = pick(rand, ['```', '```', '~~~', '````', '~~~~']);
	const r = rand();
	if (r < 0.14) return q + lead + marker + gap + 'item';
	if (r < 0.2) return q + lead + marker;
	if (r < 0.34) return q + lead + fence;
	if (r < 0.44) return q + lead + close;
	if (r < 0.5) return q + lead + 'people: []';
	if (r < 0.56) return q + lead + 'text';
	if (r < 0.6) return pick(rand, ['', '', ' ', '>', '> ', '  ']);
	if (r < 0.64) return q + lead + marker + gap + marker + gap + 'item';
	if (r < 0.67) return '---';
	if (r < 0.7) return q + lead + '    code';
	const quote = shapes === 'quote' || shapes === 'both';
	const rule = shapes === 'break' || shapes === 'both';
	if (!quote && !rule) return q + lead + 'text ' + marker;
	if (!quote && r < 0.9) return q + lead + 'text ' + marker;
	if (!rule && r >= 0.9) return q + lead + 'text ' + marker;
	if (r < 0.8) return q + lead + marker + gap + '> ' + pick(rand, ['q', 'Source', '[!note] A tree', '- item', '1. item', '> deeper', '']);
	if (r < 0.84) return q + lead + marker + gap + pick(rand, ['', ' ', '    ', '   ']) + '> ' + pick(rand, ['x', '- x', '> y']);
	if (r < 0.88) return q + lead + marker + gap + '> ' + marker + gap + pick(rand, ['item', '> z']);
	if (r < 0.9) return q + lead + marker + gap + '> ' + fence;
	if (r < 0.94) return q + lead + pick(rand, ['- - -', '* * *', '_ _ _', '- - - -', '-  -  -', '* * * *']);
	if (r < 0.97) return q + lead + marker + gap + pick(rand, ['- - -', '* * *', '---', '***']);
	return q + lead + pick(rand, ['- - -', '*  *  *']) + ' ';
}

/** A note of 2 to 9 random lines for `seed`, joined by LF, with front or tail margin lines now and then. */
export function randomLines(seed: number, shapes: Shapes): string {
	const rand = rng(seed * 2246822519 + 3266489917);
	const n = 2 + Math.floor(rand() * 8);
	const lines: string[] = [];
	for (let i = 0; i < n; i++) lines.push(line(rand, shapes));
	return lines.join('\n') + (rand() < 0.5 ? '\n' : '');
}

/** A list marker that opens a quote on its own line: the shape of the old fault F1 (and its fix). */
export const MARKER_QUOTE = /^[ \t>]*(?:[-+*]|\d{1,9}[.)])[ \t]+>/m;
