import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { closePluginModals } from '../src/view/plugin-modals';
import { FEl, clock, device, dispatch, fakeDoc, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * Re-check of the WP-3 fix round of r032 (the parent-type and partnership selects update the page in place).
 * Each test compares the page after the in-place update with the page of a full build().
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = true;
	device.width = 390;
	device.height = 844;
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

function snap(el: FEl, depth = 0): string {
	const attrs = [...el.attrs.entries()].filter(([k]) => !['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].includes(k)).sort().map(([k, v]) => `${k}=${v}`).join(' ');
	const form = el.tag === 'select' || el.tag === 'input' || el.tag === 'option' ? ` value=${el.value} checked=${el.checked} disabled=${el.disabled}` : '';
	const head = `${'  '.repeat(depth)}<${el.tag} .${[...el.classes].sort().join('.')} ${attrs}${form}${el.hidden ? ' hidden' : ''}> ${el.text}`;
	return [head, ...el.children.map((c) => snap(c, depth + 1))].join('\n');
}

const build = (s: EditSheet) => (s as unknown as { build(): void }).build();
const modalOf = (s: EditSheet) => (s as unknown as { modalEl: FEl }).modalEl;

function open(body: string, personId: string) {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
	s.open();
	return { h, s, modal: modalOf(s) };
}

const BODY = [
	'people:',
	'  - id: a',
	'    name: Aldric',
	'  - id: b',
	'    name: Bran',
	'    parents: [a]',
	'',
].join('\n');

describe('the error line after a successful in-place change', () => {
	it('a refusal or stale message from an earlier try is gone after the next change works (as after a build)', async () => {
		const { h, s, modal } = open(BODY, 'b');
		const sel = modal.querySelector('[data-parent="a"] select')!;
		// Another view changes the note; the next write of this window is refused as out of date, and the window loads the note again.
		h.body = h.body.replace('name: Aldric', 'name: Aldric the Old');
		const sel0 = modal.querySelector('[data-parent="a"] select')!;
		sel0.value = 'adoptive';
		dispatch(sel0, 'change');
		await settle();
		await settle();
		const err = () => modal.querySelector('.dynasty-sheet-error')!;
		expect(err().hidden, 'the stale message is shown after the refused write').toBe(false);
		// The window is fresh now; the user picks a type again and it works.
		const sel1 = modal.querySelector('[data-parent="a"] select')!;
		sel1.focus();
		sel1.value = 'ward';
		dispatch(sel1, 'change');
		await settle();
		await settle();
		expect(h.ops.length, 'the second change was written').toBe(1);
		expect(modal.querySelector('[data-parent="a"]')!.getAttribute('data-type')).toBe('ward');
		const inPlace = err().hidden;
		build(s);
		expect(err().hidden, 'a build hides the old message').toBe(true);
		expect(inPlace, 'the old stale message is still on the page after a successful change').toBe(true);
		void sel;
	});
});

describe('a person with no written id (the id of the parent changes with the write)', () => {
	it('the page equals the page of a build', async () => {
		const body = ['people:', '  - id: a', '    name: Aldric', '  - name: Cora', '  - name: Bran', '    parents: [a, { id: a2, type: adoptive }]', '  - id: a2', '    name: Dag', ''].join('\n');
		const { s, modal } = open(body, '~3');
		const row = modal.querySelector('.dynasty-family-row[data-parent]')!;
		const sel = row.querySelector('select')!;
		sel.focus();
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		await settle();
		expect(modal.querySelector('.dynasty-family-row[data-parent] select')).toBe(sel);
		const inPlace = snap(modal);
		build(s);
		expect(snap(modal)).toBe(inPlace);
	});
});

// ---------- a seeded differential check: in place against a build ----------

function rng(seed: number) {
	let x = seed >>> 0 || 1;
	return () => {
		x ^= x << 13;
		x >>>= 0;
		x ^= x >>> 17;
		x ^= x << 5;
		x >>>= 0;
		return x / 0x100000000;
	};
}
const TYPES = ['birth', 'adoptive', 'ward', 'rumoured'] as const;
const LIMIT: Record<string, number> = { birth: 2, adoptive: 2, ward: 2, rumoured: 8 };

function makeTree(seed: number) {
	const r = rng(seed);
	const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	const n = 6 + Math.floor(r() * 3);
	const ids = Array.from({ length: n }, (_, i) => `p${i}`);
	const lines: string[] = [];
	const out: string[] = [];
	out.push('people:');
	const targets: { child: string; parent: string; type: string; to: string }[] = [];
	ids.forEach((id, i) => {
		lines.length = 0;
		out.push(`  - id: ${id}`, `    name: Person ${i}`);
		if (r() < 0.5) out.push(`    sex: ${pick(['m', 'f'])}`);
		if (r() < 0.4) out.push(`    born: ${1000 + i * 20}`);
		if (i >= 2) {
			const k = Math.floor(r() * 4);
			const count: Record<string, number> = {};
			const entries: string[] = [];
			const used = new Set<string>();
			const types: string[] = [];
			for (let j = 0; j < k; j++) {
				const p = ids[Math.floor(r() * i)];
				if (used.has(p)) continue;
				const t = pick(TYPES);
				if ((count[t] ?? 0) >= LIMIT[t]) continue;
				count[t] = (count[t] ?? 0) + 1;
				used.add(p);
				types.push(t);
				entries.push(t === 'birth' ? p : `{ id: ${p}, type: ${t} }`);
				const to = pick(TYPES.filter((x) => x !== t));
				targets.push({ child: id, parent: p, type: t, to });
			}
			if (entries.length) {
				out.push(`    parents: [${entries.join(', ')}]`);
				const placeable = types.filter((t) => t === 'birth' || t === 'adoptive');
				if (placeable.length > 1 && r() < 0.5) out.push(`    placement: ${pick(placeable)}`);
			}
		}
	});
	const kid = targets.length ? targets[Math.floor(r() * targets.length)].child : ids[0];
	const me = r() < 0.7 ? (r() < 0.6 ? kid : pick(ids)) : null;
	const held = r() < 0.6 ? kid : pick(ids);
	const top: string[] = [];
	if (me) top.push('options:', `  me: ${me}`);
	top.push('titles:', '  - id: duke', '    name: Duke of Vale', `    holders: [{person: ${held}, from: 1100}, {person: ${pick(ids)}, from: 1130}]`);
	const un: string[] = [];
	for (let j = 0; j < 2; j++) {
		const a = pick(ids);
		const b = pick(ids);
		if (a !== b) un.push(`  - partners: [${a}, ${b}]`);
	}
	if (un.length) out.push('unions:', ...un);
	out.push('');
	return { body: [...top, ...out].join('\n'), targets };
}

describe('seeded trees: the page after the in-place change equals the page of a build', () => {
	const failures: string[] = [];
	it('about 130 random changes (relation words, titles, siblings, "Shown under")', async () => {
		let done = 0;
		for (let seed = 1; seed <= 80 && done < 130; seed++) {
			const { body, targets } = makeTree(seed * 7919);
			for (const t of targets.slice(0, 3)) {
				resetDom();
				resetObsidian();
				closePluginModals();
				device.coarse = true;
				device.width = 390;
				device.height = 844;
				const { h, s, modal } = open(body, t.child);
				const row = modal.querySelector(`[data-parent="${t.parent}"]`);
				const sel = row?.querySelector('select');
				if (!sel) continue;
				const opt = sel.children.find((o) => o.getAttribute('value') === t.to);
				if (!opt || opt.disabled) continue;
				sel.focus();
				sel.value = t.to;
				dispatch(sel, 'change');
				await settle();
				await settle();
				if (h.ops.length !== 1) {
					failures.push(`seed ${seed} ${t.child}/${t.parent}->${t.to}: ${h.ops.length} writes`);
					for (const m of [...openModals]) m.close();
					continue;
				}
				done++;
				const inPlace = snap(modal);
				const same = modal.querySelector(`[data-parent="${t.parent}"] select`) === sel;
				build(s);
				const full = snap(modal);
				if (inPlace !== full) {
					const a = inPlace.split('\n');
					const b = full.split('\n');
					const i = a.findIndex((l, k) => l !== b[k]);
					failures.push(`seed ${seed} ${t.child}/${t.parent} ${t.type}->${t.to} (same select: ${same}) line ${i}:\n  in place: ${a[i]}\n  build:    ${b[i]}`);
				}
				for (const m of [...openModals]) m.close();
			}
		}
		expect(done, 'enough cases ran').toBeGreaterThan(60);
		expect(failures).toEqual([]);
		void fakeDoc;
	}, 240000);
});

// ---------- the partnership select of a new child ----------

const TWO_UNIONS = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bella', 'unions:', '  - partners: [a, b]', '    start: 1100', '  - partners: [a, b]', '    start: 1110', ''].join('\n');
const ONE_UNION = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bella', 'unions:', '  - partners: [a, b]', '    start: 1100', ''].join('\n');

function openChild(body: string, union?: object) {
	const h = writingHandle(body);
	const parent = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
	parent.open();
	const child = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', parentSheet: parent, newPerson: { kind: 'child', parent: 'a', other: 'b', ...(union ? { union } : {}) } } as never)!;
	child.open();
	return { h, child, modal: modalOf(child) };
}

describe('the partnership select of a new child', () => {
	it('the user chooses twice and Save writes the second choice, with the same select', async () => {
		const { h, modal } = openChild(TWO_UNIONS);
		const field = modal.querySelector('.dynasty-sheet-relation select')!;
		const name = modal.querySelector('[data-field="name"] input')!;
		name.value = 'Cade';
		dispatch(name, 'input');
		field.focus();
		field.value = '1';
		dispatch(field, 'change');
		field.value = '0';
		dispatch(field, 'change');
		expect(modal.querySelector('.dynasty-sheet-relation select')).toBe(field);
		expect(fakeDoc.activeElement).toBe(field);
		const { click } = await import('./s113-c-support');
		await click(modal.querySelector('.dynasty-sheet-save'));
		await settle();
		expect(h.ops).toHaveLength(1);
		const text = JSON.stringify(h.ops);
		// The first partnership (start 1100) is the one chosen last.
		expect(text).toContain('1100');
		expect(text).not.toContain('1110');
	});

	// Supervisor ruling (the decision notes, WP-3 re-check): a build would remove the field with one partnership left; the in-place path keeps it
	// with the one option, so nothing disappears under the finger. Accepted; the test asserts the kept select.
	it('a lost partnership with one partnership left: after the choice the select stays with the chosen value', async () => {
		const { modal } = openChild(ONE_UNION, { index: 7, partners: ['a', 'b'], text: 'gone' });
		const field = modal.querySelector('.dynasty-sheet-relation select')!;
		expect(field, 'the child must choose the one partnership that is left').not.toBeNull();
		field.focus();
		field.value = '0';
		dispatch(field, 'change');
		const after = modal.querySelector('.dynasty-sheet-relation select');
		expect(after).toBe(field);
		expect(after!.value).toBe('0');
	});
});
