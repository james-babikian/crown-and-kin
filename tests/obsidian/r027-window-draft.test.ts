import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const answers: unknown[] = [];
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { deriveFamilies } from '../../src/core/derive';
import type { Op } from '../../src/core/edit';
import { parseBody, readTree } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { closePluginModals } from '../../src/view/plugin-modals';
import { titlesDraftChanged, draftSpec, draftTitle, rebase, successionChanges, successionOf, titleRows, windowOps, withHolderIds, type SuccessionDraft, type TitleRow } from '../../src/view/titles-draft';
import { TITLES_UI } from '../../src/render/ui-text';
import { clock, device, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { backToList } from '../support/lw-support';
import { choose, ctl, openWin, page } from '../support/r027-window-support';
import { click, type } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Version 0.2.7, WP3 (contract E.2, E.3, K.3): the succession keys in the draft of the Titles window. The pure draft
 * (`titles-draft.ts`) is tested on rows read from made-up trees; the window is tested with its real Save.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

/** A made-up tree with one title, written the way an owner would write it by hand. */
const BODY = [
	'titles:',
	'  - id: crown',
	'    name: Crown',
	'    succession: primogeniture',
	'    inherit: semi-salic',
	'    inherit-illegitimate: true',
	'    inherit-adopted: yes',
	'    year: 1120 # the year of the line',
	'    heir: [kid, miss]',
	'    exclude: late',
	'    holders:',
	'      - {person: rex, from: 1100}',
	'people:',
	'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
	'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
	'  - {id: miss, name: Miss Ardent, sex: f, born: 1102, parents: [rex]}',
	'  - {id: late, name: Late Ardent, sex: m, born: 1150, parents: [rex]}',
	'',
].join('\n');

const load = (body: string) => {
	const p = parseBody(body);
	if (!p.ok) throw new Error('the sample does not parse');
	const g = deriveFamilies(readTree(p.doc, p.data, body));
	let n = 0;
	return { g, raw: p.data, rows: titleRows(g, () => `k${n++}`) };
};

const newId = () => 'new-title';

describe('the draft row', () => {
	it('reads the keys as the tree text says, old names as the current ones', () => {
		const { rows } = load(BODY);
		expect(rows[0].succ).toEqual({ rule: 'eldest-child', inherit: 'men-first-in-house', through: '', illegitimate: 'after', adopted: true, body: false, year: '1120', heirs: ['kid', 'miss'], exclude: ['late'] });
		expect(rows[0].baseSucc).toEqual(rows[0].succ);
		expect(rows[0].baseSucc).not.toBe(rows[0].succ);
	});

	it('has no change and no op while nothing is touched, so a Save never touches a hand-written key', () => {
		const { rows } = load(BODY);
		expect(successionChanges(rows[0])).toEqual([]);
		expect(titlesDraftChanged(rows)).toBe(false);
		expect(windowOps(rows, newId)).toEqual([]);
	});

	it('an unrelated change (the name) writes one edit-title with the name only', () => {
		const { rows } = load(BODY);
		rows[0].name = 'The Crown';
		expect(windowOps(rows, newId)).toEqual([{ kind: 'edit-title', id: 'crown', name: 'The Crown' }]);
	});

	const cases: [string, (s: SuccessionDraft) => void, Record<string, unknown>][] = [
		['rule', (s) => (s.rule = 'youngest-child'), { succession: 'youngest-child' }],
		['rule None', (s) => ((s.rule = ''), (s.inherit = '')), { succession: null, inherit: null }],
		['inherit', (s) => (s.inherit = 'women-only'), { inherit: 'women-only' }],
		['through', (s) => (s.through = 'women'), { inheritThrough: 'women' }],
		['through back to the same', (s) => (s.through = ''), {}],
		['illegitimate', (s) => (s.illegitimate = 'equal'), { inheritIllegitimate: 'equal' }],
		['illegitimate no', (s) => (s.illegitimate = 'no'), { inheritIllegitimate: 'no' }],
		['adopted off', (s) => (s.adopted = false), { inheritAdopted: false }],
		['body on', (s) => (s.body = true), { heirsOfBody: true }],
		['year', (s) => (s.year = ' 1130 '), { year: '1130' }],
		['year empty', (s) => (s.year = '  '), { year: null }],
		['heirs', (s) => (s.heirs = ['miss', 'kid']), { heirs: ['miss', 'kid'] }],
		['heirs empty', (s) => (s.heirs = []), { heirs: null }],
		['exclude', (s) => s.exclude.push('kid'), { exclude: ['late', 'kid'] }],
		['exclude empty', (s) => (s.exclude = []), { exclude: null }],
	];
	for (const [name, change, expected] of cases) {
		it(`${name}: one edit-title with only the changed field`, () => {
			const { rows } = load(BODY);
			change(rows[0].succ!);
			const ops = windowOps(rows, newId);
			if (!Object.keys(expected).length) {
				expect(ops).toEqual([]);
				expect(titlesDraftChanged(rows)).toBe(false);
				return;
			}
			expect(ops).toEqual([{ kind: 'edit-title', id: 'crown', ...expected }]);
			expect(titlesDraftChanged(rows)).toBe(true);
		});
	}

	it('unrelated keys survive a change of one key, in the written text', () => {
		const { rows } = load(BODY);
		rows[0].succ!.year = '1130';
		const r = applyOp(BODY, { kind: 'batch', ops: windowOps(rows, newId) });
		if (!r.ok) throw new Error(r.code);
		expect(r.body).toContain('succession: primogeniture');
		expect(r.body).toContain('inherit: semi-salic');
		expect(r.body).toContain('inherit-illegitimate: true');
		expect(r.body).toContain('inherit-adopted: yes');
		expect(r.body).toContain('year: 1130');
		expect(r.body).toContain('heir: [kid, miss]');
	});

	it('None removes succession and inherit only; the year, the heirs, the exclusions and the switches stay (E.3)', () => {
		const { rows } = load(BODY);
		rows[0].succ!.rule = '';
		rows[0].succ!.inherit = '';
		const r = applyOp(BODY, { kind: 'batch', ops: windowOps(rows, newId) });
		if (!r.ok) throw new Error(r.code);
		expect(r.body).not.toContain('succession:');
		expect(r.body).not.toContain('inherit: ');
		for (const keep of ['inherit-illegitimate: true', 'inherit-adopted: yes', 'year: 1120', 'heir: [kid, miss]', 'exclude: late']) expect(r.body).toContain(keep);
	});

	it('"No preference" for a key that is not written is no change (E.3)', () => {
		const body = BODY.replace('    inherit: semi-salic\n', '');
		const { rows } = load(body);
		expect(rows[0].succ!.inherit).toBe('');
		rows[0].succ!.inherit = 'no-preference';
		expect(successionChanges(rows[0])).toEqual([]);
		rows[0].succ!.inherit = 'men-only';
		expect(successionChanges(rows[0])).toEqual(['inherit']);
	});

	it('a value the plugin cannot read stays until the owner chooses another; None removes it', () => {
		const body = BODY.replace('succession: primogeniture', 'succession: salic');
		const { rows } = load(body);
		expect(rows[0].succ!.rule).toBe('?');
		expect(draftSpec(rows[0].succ!).bad).toBe('succession');
		expect(windowOps(rows, newId)).toEqual([]);
		rows[0].succ!.rule = '';
		expect(windowOps(rows, newId)).toEqual([{ kind: 'edit-title', id: 'crown', succession: null, inherit: null }]);
	});

	it('a title that is new in the draft has no succession keys and writes none', () => {
		const { rows } = load(BODY);
		rows.push({ key: 'n', id: null, name: 'Baron', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		expect(successionChanges(rows[1])).toEqual([]);
		expect(windowOps(rows, newId)).toEqual([{ kind: 'add-title', id: 'new-title', name: 'Baron' }]);
	});

	it('the draft title has the draft holders, and the spec has the draft keys', () => {
		const { g, rows } = load(BODY);
		rows[0].holders.push({ key: 'x', ref: null, base: null, values: { person: 'kid', from: '1120' } });
		rows[0].holders.push({ key: 'y', ref: null, base: null, values: { person: 'nobody-here' } });
		rows[0].holders.push({ key: 'z', ref: null, base: null, values: {} });
		const t = draftTitle(g, rows[0])!;
		expect(t.holders.map((h) => `${h.index}:${h.person}`)).toEqual(['0:rex', '1:kid']);
		const spec = draftSpec(successionOf(g.titles[0]));
		expect(spec).toMatchObject({ rule: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'after', adopted: true, year: '1120', heirs: ['kid', 'miss'], exclude: ['late'] });
		expect(draftTitle(g, { ...rows[0], id: null })).toBeNull();
	});
});

describe('rebase keeps the owner\'s succession edits when the tree changes under the window', () => {
	it('keeps a field the owner changed and takes the new text of the others', () => {
		const { rows } = load(BODY);
		rows[0].succ!.rule = 'youngest-child';
		rows[0].succ!.heirs = ['miss'];
		const fresh = load(BODY.replace('year: 1120 # the year of the line', 'year: 1140').replace('inherit-adopted: yes', 'inherit-adopted: false')).rows;
		const [out] = rebase(rows, fresh);
		expect(out.succ).toMatchObject({ rule: 'youngest-child', heirs: ['miss'], year: '1140', adopted: false });
		expect(out.baseSucc).toMatchObject({ rule: 'eldest-child', heirs: ['kid', 'miss'], year: '1140', adopted: false });
		expect(successionChanges(out)).toEqual(['rule', 'heirs']);
	});

	it('keeps the edits when the holders changed too', () => {
		const { rows } = load(BODY);
		rows[0].succ!.exclude = [];
		rows[0].holders.push({ key: 'x', ref: null, base: null, values: { person: 'kid' } });
		const [out] = rebase(rows, load(BODY).rows);
		expect(out.succ!.exclude).toEqual([]);
		expect(out.holders).toHaveLength(2);
	});

	it('a field that the owner did not change follows the tree', () => {
		const { rows } = load(BODY);
		const [out] = rebase(rows, load(BODY.replace('year: 1120 # the year of the line', 'year: 1180')).rows);
		expect(out.succ!.year).toBe('1180');
		expect(titlesDraftChanged([out])).toBe(false);
	});
});

describe('ids for new named heirs and excluded people', () => {
	const NOID = ['titles:', '  - id: crown', '    name: Crown', '    holders:', '      - {person: rex}', 'people:', '  - {id: rex, name: Rex}', '  - name: Bran', '  - name: Wren', ''].join('\n');

	it('gives each person with no written id one id first, and writes the heir and the exclusion by it', () => {
		const { g, raw, rows } = load(NOID);
		const ids = g.people.filter((p) => p.id.startsWith('~')).map((p) => p.id);
		expect(ids).toHaveLength(2);
		rows[0].succ!.heirs = [ids[0], 'rex'];
		rows[0].succ!.exclude = [ids[1]];
		const out = withHolderIds(windowOps(rows, newId), g, raw);
		expect(out.map((o) => o.kind)).toEqual(['set-person-fields', 'set-person-fields', 'edit-title']);
		expect(out[2]).toMatchObject({ kind: 'edit-title', id: 'crown', heirs: ['p1', 'rex'], exclude: ['p2'] });
		const r = applyOp(NOID, { kind: 'batch', ops: out });
		if (!r.ok) throw new Error(r.code);
		expect(r.body).toContain('heir: [p1, rex]');
		expect(r.body).toContain('exclude: p2');
	});

	it('a person who is both a holder and a named heir gets one id', () => {
		const { g, raw, rows } = load(NOID);
		const id = g.people.find((p) => p.id.startsWith('~'))!.id;
		rows[0].holders.push({ key: 'h', ref: null, base: null, values: { person: id } });
		rows[0].succ!.heirs = [id];
		const out = withHolderIds(windowOps(rows, newId), g, raw);
		expect(out.filter((o) => o.kind === 'set-person-fields')).toHaveLength(1);
		const r = applyOp(NOID, { kind: 'batch', ops: out });
		if (!r.ok) throw new Error(r.code);
		expect(r.body).toContain('heir: p1');
		expect(r.body).toContain('person: p1');
	});

	it('changes nothing when every id is written', () => {
		const { g, raw, rows } = load(BODY);
		rows[0].succ!.heirs = ['late'];
		const ops = windowOps(rows, newId);
		expect(withHolderIds(ops, g, raw)).toEqual(ops);
	});
});

describe('Save in the window', () => {
	const rowsOf = (o: ReturnType<typeof openWin>) => (o.win as unknown as { rows: TitleRow[] }).rows;

	it('writes one batch with only the changed fields, and the other keys stay as written', async () => {
		const o = openWin(BODY);
		const p = page(o, 'crown');
		choose(p, 'rule', 'youngest-child');
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1130');
		await click(o.content.querySelector('button[data-focus="save"]'));
		expect(o.handle.ops).toHaveLength(1);
		const op = o.handle.ops[0] as Extract<Op, { kind: 'batch' }>;
		expect(op.kind).toBe('batch');
		expect(op.ops).toEqual([{ kind: 'edit-title', id: 'crown', succession: 'youngest-child', year: '1130' }]);
		expect(o.handle.body).toContain('succession: youngest-child');
		expect(o.handle.body).toContain('inherit: semi-salic');
		expect(o.handle.body).toContain('inherit-illegitimate: true');
		expect(openModals).not.toContain(o.win);
	});

	it('Save with no change to the succession writes nothing about it', async () => {
		const o = openWin(BODY);
		const p = page(o, 'crown');
		// A change of the Year field and back is no change.
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1130');
		type(year, '1120');
		expect(o.win.isDirty()).toBe(false);
		await click(o.content.querySelector('button[data-focus="save"]'));
		expect(o.handle.ops).toHaveLength(0);
	});

	it('Cancel writes nothing, and the draft is gone', async () => {
		const o = openWin(BODY);
		const p = page(o, 'crown');
		choose(p, 'rule', 'youngest-child');
		expect(o.win.isDirty()).toBe(true);
		backToList(o.content);
		o.win.close();
		// The discard question; Discard changes closes the window.
		await click(o.modal.querySelector('.dynasty-sheet-discard'));
		expect(o.handle.ops).toHaveLength(0);
		expect(openModals).not.toContain(o.win);
	});

	it('closing with a succession change asks first, like any other change', () => {
		const o = openWin(BODY);
		const p = page(o, 'crown');
		choose(p, 'rule', 'youngest-child');
		backToList(o.content);
		o.win.close();
		expect(o.modal.querySelector('.dynasty-sheet-confirm')).not.toBeNull();
	});

	it('a named heir without a written id gets an id in the same write', async () => {
		const noId = ['titles:', '  - id: crown', '    name: Crown', '    succession: eldest-child', '    holders:', '      - {person: rex, from: 1100}', 'people:', '  - {id: rex, name: Rex Ardent, sex: m}', '  - {name: Bran Ardent, sex: m, parents: [rex]}', ''].join('\n');
		const o = openWin(noId);
		const p = page(o, 'crown');
		const bran = (o.win as unknown as { data: { g: { people: { id: string; name: string }[] } } }).data.g.people.find((x) => x.name === 'Bran Ardent')!.id;
		answers.push({ kind: 'person', id: bran });
		await click(ctl(p, 'heirs')!.querySelector('button.dynasty-succ-add'));
		await click(o.content.querySelector('button[data-focus="save"]'));
		expect(o.handle.ops).toHaveLength(1);
		expect(o.handle.body).toMatch(/- \{id: p1, name: Bran Ardent/);
		expect(o.handle.body).toContain('heir: p1');
	});

	it('a tree that changed under the window gives the stale message and keeps the owner\'s succession edits', async () => {
		const o = openWin(BODY);
		const p = page(o, 'crown');
		choose(p, 'rule', 'youngest-child');
		// Somebody else changes the note: the year.
		o.handle.body = BODY.replace('year: 1120 # the year of the line', 'year: 1190');
		await click(o.content.querySelector('button[data-focus="save"]'));
		expect(o.handle.ops).toHaveLength(0);
		expect(o.content.querySelector('.dynasty-sheet-error')!.getText()).toBe(TITLES_UI.stale);
		const row = rowsOf(o)[0];
		expect(row.succ!.rule).toBe('youngest-child');
		expect(row.succ!.year).toBe('1190');
		expect(row.baseSucc!.rule).toBe('eldest-child');
		// The next Save writes the rule only.
		await click(o.content.querySelector('button[data-focus="save"]'));
		const op = o.handle.ops[0] as Extract<Op, { kind: 'batch' }>;
		expect(op.ops).toEqual([{ kind: 'edit-title', id: 'crown', succession: 'youngest-child' }]);
	});
});
