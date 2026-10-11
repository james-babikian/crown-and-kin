import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Op } from '../src/core/edit';
import { deriveFamilies } from '../src/core/derive';
import { parseBody, readTree } from '../src/core/parse';
import { newTitleId } from '../src/core/title-ops';
import { applyOp } from '../src/core/yaml-edit';
import { houseOps, loadHouses, rowsOf, type HouseRow } from '../src/obsidian/houses-window';
import { idProblems } from '../src/obsidian/id-draft';
import { titleIdRow, titleRows, windowOps, withHolderIds } from '../src/obsidian/titles-draft';

/*
 * Review D: when the windows' own check (`idProblems`) finds no refused id, the one batch of Save must
 * never be refused by the core. A random draft of renames, id changes, deletes ('clear' and 'keep')
 * and new rows is checked with the window's logic, then written with the real `applyOp`.
 */

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

const IDS = ['a', 'b', 'c', 'd', 'x', 'house-a', 'ghost', 'p1', 'crown', 'b-2', 'a-2', 'the-crown'];
const NAMES = ['A', 'B', 'House A', 'Crown', 'The Crown', 'a', 'X', 'Ghost', '  B  ', 'C'];

function houseBody(r: () => number): string {
	const ids = [...IDS].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 4));
	const lines = ['houses:'];
	ids.forEach((id, i) => lines.push(`  - id: ${id}`, `    name: ${NAMES[i % NAMES.length].trim()}`));
	lines.push('people:');
	let n = 0;
	for (const id of [...ids, ...(r() < 0.5 ? ['ghost'] : [])]) {
		if (r() < 0.8) lines.push(`  - id: p${++n}`, `    name: P${n}`, `    house: ${id}`);
	}
	lines.push(`  - id: p${++n}`, `    name: Lone`);
	return lines.join('\n') + '\n';
}

describe('review D: a draft that the Houses window accepts is never refused by the write', () => {
	it('houses', { timeout: 60000 }, () => {
		let tried = 0;
		for (let seed = 1; seed <= 1500; seed++) {
			const r = rng(seed);
			const body = houseBody(r);
			const l = loadHouses(body);
			if (l.kind !== 'ok') continue;
			const rows: HouseRow[] = rowsOf(l.data);
			let k = 100;
			for (const row of rows) {
				if (r() < 0.5) row.idDraft = IDS[Math.floor(r() * IDS.length)] + (r() < 0.1 ? ' ' : '');
				if (r() < 0.3) row.name = NAMES[Math.floor(r() * NAMES.length)];
				if (r() < 0.2) row.deleted = r() < 0.5 ? 'clear' : 'keep';
			}
			for (let i = Math.floor(r() * 3); i > 0; i--) rows.push({ key: `n${k++}`, id: null, name: NAMES[Math.floor(r() * NAMES.length)], colour: null, arms: null, base: null, deleted: null });
			if (rows.some((x) => !x.deleted && x.name.trim() === '')) continue;
			const problems = idProblems('house', rows.map((x) => ({ key: x.key, id: x.id, idDraft: x.idDraft, name: x.name, deleted: x.deleted !== null })), l.data.dangling);
			if (problems.size > 0) continue;
			const ops = houseOps(rows);
			if (!ops.length) continue;
			tried++;
			const out = applyOp(body, { kind: 'batch', ops });
			if (!out.ok) throw new Error(`seed ${seed}: refused ${out.code} ${out.detail ?? ''}\n${body}\nops ${JSON.stringify(ops)}`);
		}
		expect(tried).toBeGreaterThan(100);
	});

	it('titles', { timeout: 60000 }, () => {
		let tried = 0;
		for (let seed = 1; seed <= 1500; seed++) {
			const r = rng(seed * 7);
			const ids = [...IDS].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 3));
			const lines = ['titles:'];
			ids.forEach((id, i) => lines.push(`  - id: ${id}`, `    name: ${NAMES[i % NAMES.length].trim()}`));
			lines.push('people:');
			let n = 0;
			for (const id of [...ids, ...(r() < 0.5 ? ['ghost'] : [])]) if (r() < 0.8) lines.push(`  - id: p${++n}`, `    name: P${n}`, `    card-title: ${id}`);
			const body = lines.join('\n') + '\n';
			const parsed = parseBody(body);
			if (!parsed.ok) continue;
			const g = deriveFamilies(readTree(parsed.doc, parsed.data, body));
			let key = 0;
			const rows = titleRows(g, () => `t${key++}`);
			for (const row of rows) {
				if (r() < 0.5) row.idDraft = IDS[Math.floor(r() * IDS.length)];
				if (r() < 0.3) row.name = NAMES[Math.floor(r() * NAMES.length)];
				if (r() < 0.2) row.deleted = true;
			}
			for (let i = Math.floor(r() * 3); i > 0; i--) rows.push({ key: `n${key++}`, id: null, name: NAMES[Math.floor(r() * NAMES.length)], baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
			if (rows.some((x) => !x.deleted && x.name.trim() === '')) continue;
			const raw = parsed.data as { people?: { 'card-title'?: string }[] };
			const have = new Set(rows.filter((x) => x.id !== null).map((x) => x.id));
			const dang = [...new Set((raw.people ?? []).flatMap((p) => (p['card-title'] && !have.has(p['card-title']) ? [p['card-title']] : [])))];
			const problems = idProblems('title', rows.map(titleIdRow), dang);
			if (problems.size > 0) continue;
			const ops: Op[] = withHolderIds(windowOps(rows, (name, taken) => newTitleId(body, name, taken)), g, parsed.data);
			if (!ops.length) continue;
			tried++;
			const out = applyOp(body, { kind: 'batch', ops });
			if (!out.ok) throw new Error(`seed ${seed}: refused ${out.code} ${out.detail ?? ''}\n${body}\nops ${JSON.stringify(ops)}`);
		}
		expect(tried).toBeGreaterThan(100);
	});
});
