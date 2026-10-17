import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import type { RewriteLinksOp } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { nameForms, renameKind } from '../src/obsidian/rename-links';
import { resetObsidian } from './acceptance/fake-obsidian';
import { rng, pick } from './r028-advb-gen';
import { expectedKind, freshName, genVault, isPictureName, parseParts, PICTURE_EXTENSIONS, scalarText, treeBody, type Vault, type VLine } from './r030-d-vault-gen';
import { runVaultAsync, session } from './r030-d-vault-run';

/*
 * 0.3 package D, T4 (the 0.3 contract D.2; the release plan worst case W3): random vaults and random renames.
 *
 * Spec §6.9: after a rename of a note, the plugin rewrites the matching tree link values (`link`, and by §13.0 item 3
 * `portrait` and `arms`), keeping an alias and a heading; a picture link keeps its extension; the setting turns it off.
 * The checks, in the order of the contract:
 *
 * (1) a note without a tree never changes;
 * (2) in a note with a tree only tree link values change: every other text line is the same, also the comments, the
 *     other keys (a `notes` text with a link in it too), the fence lines, the text outside the tree;
 * (3) every tree link value that points to the renamed file is updated, or still names the file; no link names another
 *     file after the update; a value that points to another file is not touched;
 * (4) a changed value keeps its form (the marks, the "!", the alias, the heading, the extension);
 * (5) a tree with a YAML fault, a rename to an extension that is no note and no picture, and the setting off: no write.
 *
 * Three layers: the pure functions (`renameKind`, `nameForms`, the `rewrite-links` edit with an exact expected text),
 * and `LinkUpdater` with the real handles on a fake vault. Seeded. 120 vaults at the default; R028_DEEP=1: 600.
 * R030_BASE and R030_COUNT change the seeds for a search.
 */

const DEEP = process.env.R028_DEEP === '1';
vi.setConfig({ testTimeout: DEEP ? 600_000 : 120_000 });
const COUNT = Number(process.env.R030_COUNT ?? (DEEP ? 600 : 120));
// A vault costs about 0.4 s (the updater gives the interface a turn after each note it reads), so fewer of them.
const VAULTS = Number(process.env.R030_VAULTS ?? (DEEP ? 300 : 50));
const BASE = Number(process.env.R030_BASE ?? 500);
const SEEDS = Array.from({ length: COUNT }, (_, i) => BASE + i);
const VAULT_SEEDS = Array.from({ length: VAULTS }, (_, i) => BASE + i);
const MAX_SHOWN = Number(process.env.R030_MAX ?? 3);

// ---------------------------------------------------------------------------------------------------------
// Pure: renameKind

describe('T4 renameKind: a note to a note, a picture to a picture, else nothing (spec §6.9, §13.0 item 3)', () => {
	it('random path pairs agree with the words of the spec', () => {
		const rand = rng(31);
		const exts = ['md', 'md', 'md', 'png', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'txt', 'pdf', 'heic', 'canvas', '', 'md.txt', 'png.md'];
		const folders = ['', 'A/', 'A/B/', 'Folder with space/'];
		let notes = 0;
		let pictures = 0;
		for (let i = 0; i < 1500; i++) {
			const name = (e: string) => `${pick(rand, folders)}${pick(rand, ['Old', 'x.y', 'Dr. Who', 'café', 'a'])}${e ? `.${e}` : ''}`;
			const from = name(pick(rand, exts));
			const to = name(pick(rand, exts));
			const want = expectedKind(from, to);
			if (want === 'note') notes++;
			if (want === 'picture') pictures++;
			expect(renameKind(from, to), `${from} -> ${to}`).toBe(want);
		}
		expect(notes).toBeGreaterThan(30);
		expect(pictures).toBeGreaterThan(30);
	});
});

// ---------------------------------------------------------------------------------------------------------
// Pure: nameForms

describe('T4 nameForms: every way a link can write a note name is found by the first look (spec §6.9 step 1)', () => {
	it('the name as typed, with %20, percent-encoded by Obsidian or by the plugin: all in lower case', () => {
		const rand = rng(77);
		const used = new Set<string>();
		for (let i = 0; i < 300; i++) {
			const name = freshName(rand, used);
			const forms = nameForms(name);
			const written = [
				name,
				name.replace(/ /g, '%20'),
				encodeURI(name),
				encodeURIComponent(name),
				name.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29'),
				// Obsidian can write an accent as %c3%a9 (lower case hex) too.
				encodeURI(name).toLowerCase(),
			];
			for (const w of written) expect(forms, `a link may write ${JSON.stringify(name)} as ${JSON.stringify(w)}`).toContain(w.toLowerCase());
			for (const f of forms) expect(f, `form ${JSON.stringify(f)} of ${JSON.stringify(name)} is lower case`).toBe(f.toLowerCase());
		}
	});

	it('a name with a bad escape or a lone surrogate does not throw', () => {
		for (const n of ['50% off', '%E0%A4%A', '\ud800 x', 'a%zz']) expect(() => nameForms(n)).not.toThrow();
		expect(nameForms('50% off')).toContain('50% off');
	});

	it("F5 fix: a name with an apostrophe has the single-quoted YAML form (the apostrophe twice) and keeps the plain form", () => {
		const forms = nameForms("O'Neil");
		expect(forms).toContain("o''neil");
		expect(forms).toContain("o'neil");
		expect(nameForms('Plain')).toEqual(['plain']);
	});
});

// ---------------------------------------------------------------------------------------------------------
// Pure: the rewrite-links edit, exact text

const matchKey = (target: string): string => {
	const p = target.replace(/\\/g, '/').toLowerCase();
	return isPictureName(p) ? p : p.endsWith('.md') ? p : `${p}.md`;
};

describe('T4 the rewrite-links edit on random trees (spec §6.9: only link values, alias and heading kept)', () => {
	it(`${COUNT} random trees: the changed values are exactly the matching ones, every other text line is the same`, () => {
		const problems: string[] = [];
		let changedTotal = 0;
		let trees = 0;
		for (const seed of SEEDS) {
			const rand = rng(seed + 4001);
			const v = genVault(seed);
			const state = { broken: false };
			const lines = treeBody(rand, v, '', state);
			if (state.broken) continue;
			trees++;
			const linked = lines.flatMap((l) => ('val' in l && l.val.fileId !== null ? [l] : []));
			if (linked.length === 0) continue;
			// A map from the targets of some links, as written (or in another case), to new targets.
			const map: Record<string, string> = {};
			const newOf = new Map<string, string>();
			for (const l of linked) {
				if (rand() < 0.5) continue;
				const parts = parseParts(scalarText(l.val.written));
				if (!parts) continue;
				const key = rand() < 0.2 ? parts.target.toUpperCase() : parts.target;
				if (matchKey(key) in Object.fromEntries(Object.keys(map).map((k) => [matchKey(k), 1]))) continue;
				const pic = isPictureName(parts.target);
				const fresh = freshName(rand, new Set()).replace(/[#|\]]/g, '');
				const value = pic ? `${rand() < 0.5 ? 'Art/' : ''}${fresh}.${pick(rand, PICTURE_EXTENSIONS)}` : `${rand() < 0.4 ? 'Archive/' : ''}${fresh}`;
				map[key] = value;
				newOf.set(matchKey(key), value);
			}
			const body = lines.map((l) => ('exact' in l ? l.exact : l.pre + l.val.written + l.post)).join('\n');
			const op: RewriteLinksOp = { kind: 'rewrite-links', map };
			const r = applyOp(body, op);
			const where = `seed ${seed}`;
			if (!r.ok) {
				problems.push(`${where}: refused (${r.code}) ${JSON.stringify(map)}`);
				continue;
			}
			const got = r.body.split('\n');
			if (got.length !== lines.length) {
				problems.push(`${where}: ${got.length} lines, there were ${lines.length}`);
				continue;
			}
			let expectedChanges = 0;
			lines.forEach((l, i) => {
				if ('exact' in l) {
					if (got[i] !== l.exact) problems.push(`${where}: line ${i + 1} is no link value and changed: ${JSON.stringify(l.exact)} -> ${JSON.stringify(got[i])}`);
					return;
				}
				if (!got[i].startsWith(l.pre) || !got[i].endsWith(l.post)) {
					problems.push(`${where}: line ${i + 1}: the text around the value changed: ${JSON.stringify(got[i])}`);
					return;
				}
				const text = scalarText(got[i].slice(l.pre.length, got[i].length - l.post.length));
				const old = scalarText(l.val.written);
				const parts = parseParts(old);
				const to = parts ? newOf.get(matchKey(parts.target)) : undefined;
				if (!parts || to === undefined) {
					// For a key that matches, `to` is the new target; any other value stays as it was.
					if (text !== old) problems.push(`${where}: line ${i + 1}: a value without a map entry changed: ${JSON.stringify(old)} -> ${JSON.stringify(text)}`);
					return;
				}
				// "Old.md" stays "New.md": the old text named the extension.
				const target = /\.md$/i.test(parts.target) && !/\.md$/i.test(to) ? `${to}.md` : to;
				// A map entry that gives a link the target it has already changes nothing, and the edit does not count it.
				if (target !== parts.target) expectedChanges++;
				const now = parseParts(text);
				if (!now || now.head !== parts.head || now.tail !== parts.tail || now.kind !== parts.kind || now.target !== target) {
					problems.push(`${where}: line ${i + 1}: ${JSON.stringify(old)} should become the same link to ${JSON.stringify(target)}, it is ${JSON.stringify(text)}`);
				}
			});
			changedTotal += expectedChanges;
			if (r.changed !== expectedChanges) problems.push(`${where}: the edit says it changed ${r.changed} values, the map matches ${expectedChanges}`);
		}
		expect(trees).toBeGreaterThan(COUNT / 2);
		expect(changedTotal, 'the generator must reach changes').toBeGreaterThan(COUNT / 2);
		expect(problems.length, `${problems.length} problems. First:\n${problems.slice(0, MAX_SHOWN).join('\n')}`).toBe(0);
	});
});

// ---------------------------------------------------------------------------------------------------------
describe('T4 LinkUpdater on random vaults (spec §6.9; W3: after a rename only tree link values differ)', () => {
	it(`${VAULTS} random vaults, 1 to 3 renames each: notes without a tree never change, only tree link values change, every link keeps its file`, async () => {
		resetObsidian();
		const stats = { kinds: new Map<string, number>(), changedValues: 0, features: new Map<string, number>() };
		const problems: string[] = [];
		let steps = 0;
		let written = 0;
		for (const seed of VAULT_SEEDS) {
			const r = await runVaultAsync(seed, stats);
			problems.push(...r.problems);
			steps += r.steps;
			written += r.written;
		}
		// A test that reaches nothing proves nothing.
		expect(steps, 'renames made').toBeGreaterThan(VAULTS);
		expect(written, 'notes the plugin wrote').toBeGreaterThan(COUNT / 4);
		expect(stats.changedValues, 'notes with changed links').toBeGreaterThan(COUNT / 4);
		for (const k of ['note', 'picture', 'none']) expect(stats.kinds.get(k) ?? 0, `renames of kind ${k}`).toBeGreaterThan(DEEP ? 10 : 3);
		for (const k of ['folder', 'move', 'absolute links', 'setting off']) expect(stats.features.get(k) ?? 0, `feature ${k}`).toBeGreaterThan(DEEP ? 5 : 1);
		expect(problems.length, `${problems.length} problems. First:\n${problems.slice(0, MAX_SHOWN).join('\n')}`).toBe(0);
	});

	it('the vaults have 20 to 60 notes, some with trees and some without, and the links of every written form', () => {
		let withTree = 0;
		let without = 0;
		const forms = new Set<string>();
		for (const seed of SEEDS.slice(0, 40)) {
			const v = genVault(seed);
			const notes = v.files.filter((f) => f.kind === 'note');
			expect(notes.length).toBeGreaterThanOrEqual(20);
			expect(notes.length).toBeLessThanOrEqual(60);
			for (const n of v.notes.values()) {
				if (n.hasTree) withTree++;
				else without++;
				for (const l of n.lines) {
					if ('exact' in l) continue;
					const p = parseParts(scalarText(l.val.written));
					if (p) forms.add(`${p.kind}${/^!/.test(p.head) ? '!' : ''}${l.val.key}`);
				}
			}
		}
		expect(withTree).toBeGreaterThan(100);
		expect(without).toBeGreaterThan(100);
		for (const f of ['wikilink', 'wikiportrait', 'wikiarms', 'mdlink', 'angleportrait', 'barelink', 'wiki!portrait']) expect(forms.has(f), `form ${f} in ${[...forms].join(' ')}`).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------------------
// Findings of package D (T4). `it.fails` passes while the fault is there and turns red when it is fixed; the builder
// then removes `.fails`. The random vaults above write a link value with a single quote mark inside a single-quoted
// YAML text in the other forms only (see `yamlScalar` in `r030-d-vault-gen.ts`: it does so too, 20 percent of the
// time; the seeds of the finding are 3068, 3069, 3155 and 3248 with R030_BASE=3000 R030_COUNT=400 R030_VAULTS=250).

function miniVault(treeLinkWritten: string): Vault {
	const lines = (xs: VLine[]) => xs;
	const tree = lines([
		{ exact: '```kin' },
		{ exact: 'people:' },
		{ exact: '  - id: a' },
		{ exact: '    name: A' },
		{ pre: '    link: ', val: { key: 'link', fileId: 2, written: treeLinkWritten }, post: '' },
		{ exact: '```' },
		{ exact: '' },
	]);
	return {
		files: [
			{ id: 1, path: 'Trees.md', kind: 'note' },
			{ id: 2, path: "O'Neil.md", kind: 'note' },
		],
		notes: new Map([
			[1, { fileId: 1, lines: tree, eol: '\n', hasTree: true, broken: false, sections: ['code'] }],
			[2, { fileId: 2, lines: [{ exact: 'The house.' }], eol: '\n', hasTree: false, broken: false, sections: ['paragraph'] }],
		]),
		absolute: false,
		nextId: 3,
		used: new Set(),
	};
}

describe('T4 findings (known faults, minimal vaults)', () => {
	const rename = async (written: string) => {
		resetObsidian();
		const v = miniVault(written);
		const s = session(v);
		const r = await s.rename([{ id: 2, from: "O'Neil.md", to: 'New.md' }], 'mini');
		return { problems: r.problems, text: s.fake.texts.get('Trees.md') };
	};

	it("F5 a link in single-quoted YAML to a note with an apostrophe in its name ('O''Neil') is not updated: the first look for the old name does not find O''Neil", async () => {
		// YAML writes the apostrophe twice inside single quotes, so the text of the note does not contain "o'neil".
		const r = await rename("'O''Neil'");
		expect(r.problems, r.text).toEqual([]);
	});

	it('the same link in double quotes, and a name without an apostrophe in single quotes, are updated (the apostrophe is the only cause)', async () => {
		const a = await rename('"O\'Neil"');
		expect(a.problems, a.text).toEqual([]);
		expect(a.text).toContain('link: "New"');
	});

	it("F5 fix: a single-quoted link is found and the new name keeps valid single-quoted YAML, with the apostrophe written twice", async () => {
		resetObsidian();
		const v = miniVault("'O''Neil'");
		const s = session(v);
		const r = await s.rename([{ id: 2, from: "O'Neil.md", to: "D'Arcy.md" }], 'mini');
		expect(r.problems, s.fake.texts.get('Trees.md')).toEqual([]);
		expect(s.fake.texts.get('Trees.md')).toContain("link: 'D''Arcy'");
	});
});
