import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { readInherit, readRule } from '../src/core/succession-keys';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { houseOps, loadHouses, rowsOf } from '../src/obsidian/houses-window';
import { closePluginModals } from '../src/view/plugin-modals';
import { SUCCESSION_FIELDS, titlesDraftChanged, titleRows, windowOps, type SuccessionDraft } from '../src/view/titles-draft';
import { clock, dispatch, fakeWin, installDom, resetDom, settle, type FEl } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { genPeople, peopleYaml, pick, rng, titleYaml } from './r028-advb-gen';
import { choose, openWin, page, save } from './r027-window-support';
import { writingHandle } from './s113-c-support';

/*
 * 0.2.8 adversarial round, target X4 (an internal note section 3), the windows: the drafts of the Titles window, the
 * Houses window and the edit sheet, on the fake Obsidian. Written from spec §13.0 item 6 (a window is a draft: Save
 * writes only what the user changed, Cancel writes nothing), §6.2, §6.3 and §13.21 rule 3 and rule 28.
 *
 * (7a) a draft with no change writes nothing;
 * (7b) a saved change shows again after the window is opened again;
 * (7c) a value that the plugin cannot read stays as it is unless the user changes it;
 * and the edit changes only the lines of the changed key.
 *
 * Seeds are fixed; every failure message prints the seed. Deep mode: R028_DEEP=1.
 */

const DEEP = process.env.R028_DEEP === '1';
// A test takes at most 30 s, also in deep mode (an internal note section 2); the normal run takes a few seconds.
vi.setConfig({ testTimeout: 30_000 });
const N = DEEP ? 4 : 1;

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------
// Bodies

/** A body with people and one title with random keys, an unknown key and comments on the title. */
function titleBody(seed: number): string {
	const rand = rng(seed);
	const people = genPeople(rand, { n: 6 + Math.floor(rand() * 12), oddParents: false, dates: true, twoParents: 0.5 });
	const ids = people.map((p) => p.id);
	let titles = titleYaml(rand, ids, { id: 'crown' });
	titles = titles.replace('    name: Throne\n', '    name: Throne # c-name\n    x-title: keep # c-x\n    # a comment between keys\n');
	return peopleYaml(people) + titles;
}

const lines = (s: string) => s.split('\n');
/** The lines of `before` that `after` does not have (a multiset difference). */
function removed(before: string, after: string): string[] {
	const have = new Map<string, number>();
	for (const l of lines(after)) have.set(l, (have.get(l) ?? 0) + 1);
	return lines(before).filter((l) => {
		const c = have.get(l) ?? 0;
		if (c > 0) have.set(l, c - 1);
		return c === 0;
	});
}

const applyAll = (body: string, ops: Op[]): string => {
	const r = applyOp(body, { kind: 'batch', ops });
	if (!r.ok) throw new Error(`refused ${r.code} ${r.detail ?? ''}\n${body}`);
	return r.body;
};

// ---------------------------------------------------------------------------------------------------------
// The Titles window draft

describe('X4 (7) the Titles window draft', () => {
	let keyN = 0;
	const key = () => `k${keyN++}`;
	const newId = (name: string, taken: ReadonlySet<string>) => {
		let i = 0;
		while (taken.has(`${name}-${i}`)) i++;
		return `${name}-${i}`;
	};

	it('(a) a draft with no change writes nothing, on titles with unknown values, unknown keys and comments', () => {
		let tried = 0;
		for (let seed = 1; seed <= 130 * N; seed++) {
			const body = titleBody(seed);
			const parsed = parseDynasty(body);
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const rows = titleRows(g, key);
			if (!rows.length) continue;
			expect(titlesDraftChanged(rows), `seed ${seed}: the draft of an untouched window has a change\n${body}`).toBe(false);
			expect(windowOps(rows, newId), `seed ${seed}: ops of an untouched window\n${body}`).toEqual([]);
			tried++;
		}
		expect(tried).toBeGreaterThan(60);
	});

	const VALUES: { [K in (typeof SUCCESSION_FIELDS)[number]]: SuccessionDraft[K][] } = {
		rule: ['', 'eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative', 'born-in-reign'],
		inherit: ['', 'men-only', 'men-first-in-house', 'men-first', 'no-preference', 'women-first', 'women-first-in-house', 'women-only'],
		through: ['', 'men', 'women', 'anyone'],
		illegitimate: ['no', 'after', 'equal'],
		adopted: [true, false],
		body: [true, false],
		year: ['', '1150', 'c. 1203', '200 BC'],
		heirs: [[], ['p1'], ['p2', 'p1']],
		exclude: [[], ['p3'], ['p1', 'p2']],
	};
	const KEY_OF: Record<(typeof SUCCESSION_FIELDS)[number], string[]> = {
		rule: ['succession'],
		inherit: ['inherit'],
		through: ['inherit-through'],
		illegitimate: ['inherit-illegitimate'],
		adopted: ['inherit-adopted'],
		body: ['heirs-of-body'],
		year: ['year'],
		heirs: ['heir'],
		exclude: ['exclude'],
	};

	it('(b, c) one changed field: Save changes only the lines of that key, the value shows again when the window opens again, an unreadable value of another key stays', () => {
		let changedCases = 0;
		let unknownKept = 0;
		for (let seed = 1; seed <= 150 * N; seed++) {
			const rand = rng(seed * 13);
			const body = titleBody(seed);
			const parsed = parseDynasty(body);
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const rows = titleRows(g, key);
			if (!rows.length) continue;
			const row = rows[0];
			const field = pick(rand, SUCCESSION_FIELDS);
			const value = pick(rand, VALUES[field] as readonly unknown[]);
			const before = JSON.stringify(row.succ![field]);
			(row.succ as unknown as Record<string, unknown>)[field] = value;
			const ops = windowOps(rows, newId);
			const msg = `seed ${seed}, ${field} -> ${JSON.stringify(value)} (was ${before})\n${body}`;
			if (!ops.length) {
				// A change that is no change (the value the key already reads as): nothing to write.
				// "Not written" and "No preference" for `inherit` are one value (spec §13.21 rule 28, E.3).
				const same = JSON.stringify(value) === before || (field === 'inherit' && before === '""' && value === 'no-preference') || (field === 'inherit' && before === '"no-preference"' && value === '');
				expect(same, `seed ${seed}: no ops for a changed value ${field} -> ${JSON.stringify(value)} (was ${before})\n${body}`).toBe(true);
				continue;
			}
			changedCases++;
			const next = applyAll(body, ops);
			// Only the lines of the changed key (and of `inherit` with `succession`: None removes both, rule 28) are removed.
			const allowed = [...KEY_OF[field], ...(field === 'rule' && value === '' ? ['inherit'] : [])];
			for (const l of removed(body, next)) {
				const ok = allowed.some((k) => l.startsWith(`    ${k}:`) || l.startsWith(`      - `) || l.startsWith(`      ${k}`) || /^\s+(#|[\w-]+\]|\])/.test(l));
				expect(ok, `${msg}\nthe line "${l}" of another key changed\n--- after\n${next}`).toBe(true);
			}
			// The comments and the unknown key of the title stay.
			for (const mark of ['# c-name', 'x-title: keep # c-x', '# a comment between keys']) expect(next.includes(mark), `${msg}\n"${mark}" is gone\n--- after\n${next}`).toBe(true);
			// An unreadable value of another key stays word for word (rule 3 of §13.21: only the changed keys are written).
			for (const l of lines(body)) {
				if (/^ {4}(succession|inherit|inherit-through|inherit-illegitimate|inherit-adopted|heirs-of-body|year): /.test(l)) {
					const k = l.trim().split(':')[0];
					if (!allowed.includes(k)) {
						expect(lines(next), `${msg}\nthe line "${l}" of an unchanged key`).toContain(l);
						unknownKept++;
					}
				}
			}
			// (b) The window opened again shows the saved value.
			const again = parseDynasty(next);
			expect(again.ok, msg).toBe(true);
			if (!again.ok) continue;
			const row2 = titleRows(deriveFamilies(again.tree), key)[0];
			const got = row2.succ![field];
			if (field === 'rule' && value !== '') expect(readRule(String(got)) ?? got, msg).toBe(value);
			else if (field === 'inherit' && value !== '') expect(readInherit(String(got)) ?? got, msg).toBe(value);
			else if (field === 'year') expect(String(got).trim(), msg).toBe(String(value).trim());
			else if (field === 'illegitimate' || field === 'adopted' || field === 'body' || field === 'heirs' || field === 'exclude' || field === 'through') {
				// The named ids must be written even for an id that names nobody (rule 3), in the order given.
				expect(JSON.stringify(got), `seed ${seed}: ${field} after Save\n${next}`).toBe(JSON.stringify(value === '' ? '' : value));
			}
		}
		expect(changedCases).toBeGreaterThan(60);
		expect(unknownKept, 'unreadable or unchanged keys checked').toBeGreaterThan(50);
	});

	it('(c) None removes `succession` and `inherit` only; the other keys stay (rule 28)', () => {
		for (let seed = 1; seed <= 120 * N; seed++) {
			const body = titleBody(seed);
			const parsed = parseDynasty(body);
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const rows = titleRows(g, key);
			const row = rows[0];
			if (!row || row.succ!.rule === '') continue;
			row.succ!.rule = '';
			const next = applyAll(body, windowOps(rows, newId));
			const t = parseDynasty(next);
			expect(t.ok, `seed ${seed}`).toBe(true);
			expect(next, `seed ${seed}: succession is still written\n${next}`).not.toMatch(/^ {4}succession:/m);
			expect(next, `seed ${seed}: inherit is still written\n${next}`).not.toMatch(/^ {4}inherit:/m);
			for (const k of ['inherit-through', 'inherit-illegitimate', 'inherit-adopted', 'heirs-of-body', 'year', 'heir', 'exclude']) {
				const had = new RegExp(`^ {4}${k}:`, 'm').test(body);
				if (had) expect(new RegExp(`^ {4}${k}:`, 'm').test(next), `seed ${seed}: ${k} was removed with None\n${body}\n--- after\n${next}`).toBe(true);
			}
		}
	});
});

// ---------------------------------------------------------------------------------------------------------
// The Titles window itself

describe('X4 (7) the Titles window on the fake Obsidian', () => {
	it('Save with no change writes nothing; one change writes one batch that changes only the title’s lines; the page shows it again', async () => {
		let saved = 0;
		for (let seed = 1; seed <= 7 * N; seed++) {
			const body = titleBody(seed);
			const parsed = parseDynasty(body);
			if (!parsed.ok || !deriveFamilies(parsed.tree).titles?.length) continue;
			const o = openWin(body);
			const p = page(o, 'crown');
			// No change: Save writes nothing.
			await save(o);
			await settle();
			expect(o.handle.ops, `seed ${seed}: a Save with no change wrote\n${body}`).toEqual([]);
			expect(o.handle.body).toBe(body);

			// One change: the rule.
			const o2 = openWin(body);
			const p2 = page(o2, 'crown');
			const select = p2.querySelector('[data-succ="rule"] select');
			if (!select) continue;
			const target = select.value === 'eldest-child' ? 'youngest-child' : 'eldest-child';
			choose(p2, 'rule', target);
			await save(o2);
			await settle();
			expect(o2.handle.ops, `seed ${seed}: one write`).toHaveLength(1);
			const next = o2.handle.body;
			expect(next, `seed ${seed}`).toMatch(new RegExp(`^ {4}succession: ${target}\\s*(#.*)?$`, 'm'));
			for (const l of removed(body, next)) expect(/^ {4}(succession|inherit):/.test(l), `seed ${seed}: the line "${l}" changed\n${body}\n--- after\n${next}`).toBe(true);
			// The window opened again shows the saved rule.
			const o3 = openWin(next);
			const again = (page(o3, 'crown').querySelector('[data-succ="rule"] select') as FEl).value;
			expect(again, `seed ${seed}: the rule after reopening`).toBe(target);
			void p;
			saved++;
		}
		expect(saved).toBeGreaterThan(2);
	});
});

// ---------------------------------------------------------------------------------------------------------
// The Houses window draft

describe('X4 (7) the Houses window draft', () => {
	const HOUSE_BODY = (rand: () => number) => {
		const colours = ['"#aa0000"', 'banana', '"#12345"', 'red', '"#ABCDEF"', '', '#bb0000'];
		const names = ['House One', 'Haus Löwe', '"Quoted"', 'Ann: B', 'x'.repeat(80), '- dash'];
		const hs = Array.from({ length: 2 + Math.floor(rand() * 4) }, (_, i) => {
			const c = pick(rand, colours);
			return `  # --- h${i} ---\n  - id: h${i} # c-h${i}\n    name: ${JSON.stringify(pick(rand, names))}\n${c ? `    color: ${c}\n` : ''}    x-h${i}: keep\n`;
		});
		return `houses:\n${hs.join('')}people:\n  - {id: a, name: Aldric, house: h0}\n  - {id: b, name: Bea, house: h1}\n`;
	};

	it('(a) no change writes nothing; (b) a rename shows again; (c) the colour that the plugin cannot use stays', () => {
		let renamed = 0;
		for (let seed = 1; seed <= 100 * N; seed++) {
			const rand = rng(seed);
			const body = HOUSE_BODY(rand);
			const l = loadHouses(body);
			if (l.kind !== 'ok') continue;
			const rows = rowsOf(l.data);
			expect(houseOps(rows), `seed ${seed}: ops of an untouched window\n${body}`).toEqual([]);
			const i = Math.floor(rand() * rows.length);
			rows[i].name = rows[i].name + ' II';
			const ops = houseOps(rows);
			expect(ops, `seed ${seed}`).toHaveLength(1);
			const r = applyOp(body, { kind: 'batch', ops });
			expect(r.ok, `seed ${seed}`).toBe(true);
			if (!r.ok) continue;
			for (const line of removed(body, r.body)) expect(/^ {4}name:/.test(line), `seed ${seed}: the line "${line}" changed\n${body}\n--- after\n${r.body}`).toBe(true);
			const again = loadHouses(r.body);
			expect(again.kind, `seed ${seed}`).toBe('ok');
			if (again.kind !== 'ok') continue;
			expect(again.data.houses[i].name, `seed ${seed}: the renamed house`).toBe(l.data.houses[i].name + ' II');
			// Every other house and its colour (also "banana") reads as before.
			again.data.houses.forEach((h, j) => {
				if (j !== i) expect({ ...h }, `seed ${seed}: house ${j}`).toEqual({ ...l.data.houses[j] });
				else expect(h.colour, `seed ${seed}: the colour of the renamed house`).toBe(l.data.houses[j].colour);
			});
			for (const k of Array.from({ length: rows.length }, (_, j) => j)) expect(r.body.includes(`x-h${k}: keep`) && r.body.includes(`# c-h${k}`) && r.body.includes(`# --- h${k} ---`), `seed ${seed}: marks of h${k}`).toBe(true);
			renamed++;
		}
		expect(renamed).toBeGreaterThan(50);
	});
});

// ---------------------------------------------------------------------------------------------------------
// The edit sheet

function sheetBody(seed: number): string {
	const rand = rng(seed);
	const n = 4 + Math.floor(rand() * 5);
	const out: string[] = ['# top', 'people:'];
	for (let i = 0; i < n; i++) {
		out.push(`  # --- p${i} ---`);
		out.push(`  - id: p${i} # c-p${i}`);
		out.push(`    name: ${JSON.stringify(pick(rand, ['Ada', 'Bo "B" Chen', 'Ælfric', '李小龍', 'Ann: B', '#hash']))}`);
		if (rand() < 0.7) out.push(`    sex: ${pick(rand, ['m', 'f', 'male', 'x', 'Female'])}`);
		if (rand() < 0.6) out.push(`    born: ${pick(rand, ['1200', 'c. 1200', '12 May 1203', '-200', '?'])}`);
		if (rand() < 0.4) out.push(`    died: ${pick(rand, ['1250', 'alive', 'unknown', 'yes'])}`);
		if (rand() < 0.3) out.push(`    title: ${JSON.stringify('Duke: of X')}`);
		out.push(`    x-p${i}: keep`);
		if (i > 1 && rand() < 0.7) out.push(`    parents: [${pick(rand, ['p0', 'p1'])}${rand() < 0.3 ? ', {id: p1, type: foster}' : ''}]`);
	}
	return out.join('\n');
}

describe('X4 (7) the edit sheet', () => {
	function openSheet(h: ReturnType<typeof writingHandle>, id: string): EditSheet {
		const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
		s.open();
		return s;
	}
	const modalOf = (s: EditSheet) => (s as unknown as { modalEl: FEl }).modalEl;
	const flat = (ops: Op[]): Op[] => ops.flatMap((o) => (o.kind === 'batch' ? flat(o.ops) : [o]));

	it('(a) Save with no change, and a name typed back to what it was, write nothing; (b, c) a changed name writes only the name; unreadable values stay', async () => {
		let named = 0;
		for (let seed = 1; seed <= 8 * N; seed++) {
			const body = sheetBody(seed);
			const parsed = parseDynasty(body);
			if (!parsed.ok) continue;
			const ids = parsed.tree.people.map((p) => p.id);
			const id = ids[seed % ids.length];
			const h = writingHandle(body);
			const s = openSheet(h, id);
			await settle();
			const m = modalOf(s);
			dispatch(m.querySelector('.dynasty-sheet-save')!, 'click');
			await settle();
			expect(h.ops, `seed ${seed}: a Save with no change wrote\n${body}`).toEqual([]);
			expect(h.body).toBe(body);

			const h2 = writingHandle(body);
			const s2 = openSheet(h2, id);
			await settle();
			const m2 = modalOf(s2);
			const input = m2.querySelector('[data-field="name"] input') as FEl;
			const original = input.value;
			input.value = original + 'x';
			dispatch(input, 'input');
			input.value = original;
			dispatch(input, 'input');
			dispatch(m2.querySelector('.dynasty-sheet-save')!, 'click');
			await settle();
			expect(h2.ops, `seed ${seed}: a name typed back wrote\n${body}`).toEqual([]);

			const h3 = writingHandle(body);
			const s3 = openSheet(h3, id);
			await settle();
			const m3 = modalOf(s3);
			const in3 = m3.querySelector('[data-field="name"] input') as FEl;
			in3.value = 'Renamed';
			dispatch(in3, 'input');
			dispatch(m3.querySelector('.dynasty-sheet-save')!, 'click');
			await settle();
			const ops = flat(h3.ops);
			expect(ops.length, `seed ${seed}: one op for one changed field`).toBe(1);
			expect(ops[0], `seed ${seed}`).toEqual({ kind: 'set-person-fields', id, fields: { name: 'Renamed' } });
			for (const l of removed(body, h3.body)) expect(l.startsWith('    name:'), `seed ${seed}: the line "${l}" changed\n${body}\n--- after\n${h3.body}`).toBe(true);
			// The values the sheet cannot read (sex "male", "Female", "x", an unknown parent type) stay as typed.
			for (const l of lines(body)) if (/^ {4}(sex|parents|born|died):/.test(l)) expect(lines(h3.body), `seed ${seed}: "${l}"`).toContain(l);
			named++;
		}
		expect(named).toBeGreaterThan(3);
	});
});
