import { describe, expect, it } from 'vitest';
import { findBlocks, replaceBody } from '../../src/core/block-locate';
import { pick, rng } from '../support/r028-advb-gen';

/*
 * 0.3 package J, fix round (fault F3): `replaceBody` over random mixes of LF, CRLF and lone CR. A lone CR before an
 * empty line that ends with LF reads as one CRLF, so a line would be lost. For every random body and edit, the text
 * written must read back as the new body, and no byte outside the body may change. Seeds are fixed. Deep run: R030_DEEP=1.
 */

const DEEP = process.env.R030_DEEP === '1';
const COUNT = DEEP ? 400_000 : 30_000;
const BREAKS = ['\n', '\r', '\r\n'];
const LINES = ['a: 1', '', 'b: 2', '', 'c:', '  d: 3', ''];

describe('F3 (fix round): replaceBody keeps every line when the breaks are mixed', () => {
	it('a kept lone CR next to the empty line that is left at the end is changed to a form that holds (R3)', () => {
		const text = '```kin\na: 1\r\rb: 2\n```\n';
		const b = findBlocks(text)[0];
		const out = replaceBody(text, b, 'a: 1\n');
		expect(findBlocks(out)[0].body).toBe('a: 1\n');
		// Only a break inside the body changed.
		expect(out.startsWith('```kin\na: 1')).toBe(true);
		expect(out.endsWith('\n```\n')).toBe(true);
	});

	it('random bodies with random breaks and random edits read back as the new body; nothing outside the body changes', () => {
		let checked = 0;
		const bad: string[] = [];
		for (let seed = 0; seed < COUNT && bad.length < 3; seed++) {
			const rand = rng(seed + 7);
			const n = 1 + Math.floor(rand() * 6);
			let text = '```kin' + pick(rand, BREAKS);
			for (let i = 0; i < n; i++) text += pick(rand, LINES) + (i < n - 1 ? pick(rand, BREAKS) : '');
			text += pick(rand, BREAKS);
			if (rand() < 0.8) text += '```' + (rand() < 0.5 ? pick(rand, BREAKS) : '');
			const blocks = findBlocks(text);
			if (blocks.length !== 1) continue;
			const b = blocks[0];
			const next = b.body.split('\n');
			for (let e = 0; e < 1 + Math.floor(rand() * 2); e++) {
				const r = rand();
				const at = Math.floor(rand() * (next.length + 1));
				if (r < 0.35) next.splice(at, 0, pick(rand, ['x: 1', '', 'y:']));
				else if (r < 0.7 && next.length > 0) next.splice(Math.min(at, next.length - 1), 1);
				else if (next.length > 0) next[Math.min(at, next.length - 1)] = pick(rand, ['z: 9', '']);
			}
			if (next.length === 0) next.push('');
			const wanted = next.join('\n');
			const out = replaceBody(text, b, wanted);
			checked++;
			const outside = out.startsWith(text.slice(0, b.bodyStart)) && out.endsWith(text.slice(b.bodyEnd));
			const got = findBlocks(out)[0];
			if (!outside || !got || got.body !== wanted) bad.push(JSON.stringify({ seed, text, wanted, out, got: got?.body }));
		}
		expect(bad).toEqual([]);
		expect(checked).toBeGreaterThan(COUNT / 4);
	}, DEEP ? 300_000 : 20_000);
});
