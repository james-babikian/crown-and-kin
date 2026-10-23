import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';
import { loadFenceIndex } from '../support/r04-contract';
import { genNote } from '../support/r030-d-note-gen';

/*
 * 0.4 WP-3a, step T0, package F: `fenceFlags` (the index contract 1.1, test list 7.1). The flags say, for a note text, whether it holds a `kin` fence and whether it holds a
 * `kin-calendar` fence. The truth is the fence rule of the locating code (spec §6.1): the first word of the fence info equals the language, in callouts, quotes and list items,
 * and not inside a longer fence. The expected answers below are written by hand from that rule; the last tests compare with `findBlocks` itself.
 * Written from the contract, before the code existed; package F is built and the tests run.
 */

describe('fenceFlags (the index contract 1.1)', () => {
	const flags = async (text: string) => (await loadFenceIndex()).fenceFlags(text);

	const CASES: [string, string, { kin: boolean; cal: boolean }][] = [
		['a kin fence', '```kin\npeople:\n  - id: a\n    name: A\n```\n', { kin: true, cal: false }],
		['a tilde fence', '~~~kin\npeople:\n  - id: a\n~~~\n', { kin: true, cal: false }],
		['a longer fence of backticks', '````kin\npeople:\n````\n', { kin: true, cal: false }],
		['a kin-calendar fence is not a kin fence', '```kin-calendar\ncalendars: []\n```\n', { kin: false, cal: true }],
		['both languages in one note', '```kin\npeople:\n```\n\n```kin-calendar\ncalendars: []\n```\n', { kin: true, cal: true }],
		['a callout', '> [!note]\n> ```kin\n> people:\n> ```\n', { kin: true, cal: false }],
		['a quote', '> ```kin\n> people:\n> ```\n', { kin: true, cal: false }],
		['a list item, fence on the next line', '- item\n  ```kin\n  people:\n  ```\n', { kin: true, cal: false }],
		['a list item, fence on the marker line', '- ```kin\n  people:\n  ```\n', { kin: true, cal: false }],
		['a calendar fence in a callout', '> [!info]\n> ```kin-calendar\n> calendars: []\n> ```\n', { kin: false, cal: true }],
		['a kin fence inside a longer fence is content', '````md\n```kin\npeople:\n```\n````\n', { kin: false, cal: false }],
		['a kin-calendar fence inside a longer fence is content', '````\n```kin-calendar\nx\n```\n````\n', { kin: false, cal: false }],
		['a capital letter is another language', '```Kin\npeople:\n```\n', { kin: false, cal: false }],
		['kinx is another language', '```kinx\npeople:\n```\n', { kin: false, cal: false }],
		['more words after the language', '```kin extra\npeople:\n```\n', { kin: true, cal: false }],
		['a space before the language', '``` kin\npeople:\n```\n', { kin: true, cal: false }],
		['a tab before the language', '```\tkin\npeople:\n```\n', { kin: true, cal: false }],
		['a no-break space before the language', '``` kin\npeople:\n```\n', { kin: true, cal: false }],
		['a form feed before the language', '```\fkin\npeople:\n```\n', { kin: true, cal: false }],
		['an ideographic space before the language', '```　kin\npeople:\n```\n', { kin: true, cal: false }],
		['CRLF line ends', '```kin\r\npeople:\r\n```\r\n', { kin: true, cal: false }],
		['front matter first', '---\ntitle: x\n---\n```kin\npeople:\n```\n', { kin: true, cal: false }],
		['a fence that is never closed', '```kin\npeople:\n', { kin: true, cal: false }],
		['the word in running text', 'The kin of the king.\n', { kin: false, cal: false }],
		['a code span with the word', 'Use `kin` and ```kin inline```.\n', { kin: false, cal: false }],
		['four spaces make a code block, not a fence', '    ```kin\n    people:\n    ```\n', { kin: false, cal: false }],
		['another language', '```js\nlet kin = 1;\n```\n', { kin: false, cal: false }],
		['an empty note', '', { kin: false, cal: false }],
	];

	it.each(CASES)('%s', async (_name, text, want) => {
		expect(await flags(text)).toEqual(want);
	});

	it('answers only with the two flags, as booleans', async () => {
		const got = await flags('```kin\n```\n');
		expect(Object.keys(got).sort()).toEqual(['cal', 'kin']);
		expect(typeof got.kin).toBe('boolean');
		expect(typeof got.cal).toBe('boolean');
	});

	it('a note with no "kin" in it at all has no fence of either language', async () => {
		// The cheap pre-test of the contract: no hit for "kin" gives false for both flags.
		for (const text of ['', 'plain\n', '```js\nx\n```\n', '```\nsomething\n```\n', '# Heading\n\n- a list\n']) expect(await flags(text)).toEqual({ kin: false, cal: false });
	});

	it('the pre-test never hides a fence that has white space of any kind before the language (gate proof fc8da241)', async () => {
		// A regex on the fence marker followed by `[ \t]*kin` misses these; the pre-test must be the plain text test "kin".
		for (const gap of [' ', '\t', ' ', '\f', '　', ' ', '  \t ']) {
			expect(await flags(`\`\`\`${gap}kin\npeople:\n\`\`\`\n`)).toEqual({ kin: findBlocks(`\`\`\`${gap}kin\npeople:\n\`\`\`\n`, 'kin').length > 0, cal: false });
		}
	});
});

describe('fenceFlags agrees with the answers of today (the index contract 1.1, test 7.1)', () => {
	const agrees = async (text: string): Promise<{ kin: boolean; cal: boolean; wantKin: boolean; wantCal: boolean }> => {
		const got = (await loadFenceIndex()).fenceFlags(text);
		return { ...got, wantKin: findBlocks(text, 'kin').length > 0, wantCal: findBlocks(text, 'kin-calendar').length > 0 };
	};

	it('on every sample tree of the fixtures folder', async () => {
		const dir = join(__dirname, '..', '..', 'fixtures');
		const names = readdirSync(dir).filter((n) => n.endsWith('.md'));
		expect(names.length).toBeGreaterThan(10);
		for (const name of names) {
			const r = await agrees(readFileSync(join(dir, name), 'utf8'));
			expect([name, r.kin, r.cal]).toEqual([name, r.wantKin, r.wantCal]);
		}
	});

	it('the sample trees have a kin fence (the comparison above is not empty)', async () => {
		const dir = join(__dirname, '..', '..', 'fixtures');
		const first = readFileSync(join(dir, '01-three-generations.md'), 'utf8');
		expect((await agrees(first)).kin).toBe(true);
	});

	it('on 300 random notes of the generator of the locating tests, with the knowledge of the generator as the oracle', async () => {
		const { fenceFlags } = await loadFenceIndex();
		for (let seed = 7000; seed < 7300; seed++) {
			const n = genNote(seed);
			const got = fenceFlags(n.text);
			// The generator knows where the real `kin` blocks are; it makes no calendar block.
			expect([seed, got.kin]).toEqual([seed, n.blocks.length > 0]);
			expect([seed, got.kin, got.cal]).toEqual([seed, findBlocks(n.text, 'kin').length > 0, findBlocks(n.text, 'kin-calendar').length > 0]);
		}
	});

	it('on every cut of a note with both languages (a fence cut in the middle, a closing fence missing)', async () => {
		const note = '# Notes\n\n> [!note]\n> ```kin\n> people:\n>   - id: a\n> ```\n\n- item\n  ```kin-calendar\n  calendars: []\n  ```\n\n~~~kin\npeople:\n~~~\n';
		for (let cut = 0; cut <= note.length; cut++) {
			const r = await agrees(note.slice(0, cut));
			expect([cut, r.kin, r.cal]).toEqual([cut, r.wantKin, r.wantCal]);
		}
	});
});
