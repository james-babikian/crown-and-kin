import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { clearRelationCache, relationStats } from '../src/obsidian/relation-cache';
import { relationStrip, renderRelationBox, renderRelationStrip, type RelationView } from '../src/obsidian/sheet-relation';
import { RELINFO, relationInfo } from '../src/render/tree-info';
import { FEl, clock, device, dispatchWindow, fakeWin, fireMediaChange, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { sample12 } from './acceptance/relations-support';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';

/*
 * 0.2.5, WP-E1 (D146, D147; spec §13.1): the relation to the marked person at the top of the edit sheet. On a computer it is
 * a box in the portrait row. On a phone (the sheet has `is-phone`) it is a strip, the first child of the sheet body. The
 * fakes run the real EditSheet on sample tree 12, which is marked on Gwen. All names are made up.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	clearRelationCache();
	relationStrip.open = false;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => vi.restoreAllMocks());

const F12 = sample12().source;
const NO_MARK = F12.replace('options:\n  me: gwen\n', '');

const computer = () => {
	device.width = 1280;
	fireMediaChange();
};
const phone = () => {
	device.width = 390;
	fireMediaChange();
};

function open(personId: string, o: { body?: string; finder?: boolean; portrait?: boolean } = {}) {
	const body = o.body ?? F12;
	const h = writingHandle(body);
	const finder = { show: vi.fn() };
	const sheet = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md', ...(o.finder === false ? {} : { finder }) } as never)!;
	sheet.open();
	const modal = (sheet as unknown as { modalEl: FEl }).modalEl;
	const bodyEl = modal.querySelector('.dynasty-sheet-body')!;
	return { h, sheet, modal, body: bodyEl, finder };
}

const boxes = (modal: FEl) => modal.querySelectorAll('.dynasty-relinfo');
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A view made by hand, so a count of 7 needs no tree with 8 relations. */
function view(others: number, extra: Partial<RelationView> = {}): RelationView {
	return { kind: 'relation', title: RELINFO.title, value: 'Second cousin', sentence: 'Relation to you: Second cousin.', others, ...extra };
}

describe('the computer: the box in the portrait row', () => {
	it('is the last child of the portrait row, is one box only and has the texts of E.3.2', () => {
		computer();
		const { modal } = open('orla');
		const row = modal.querySelector('.dynasty-sheet-portrait-row')!;
		const all = boxes(modal);
		expect(all).toHaveLength(1);
		expect(row.children[row.children.length - 1]).toBe(all[0]);
		expect(row.children[row.children.length - 2]!.hasClass('dynasty-sheet-portrait-buttons')).toBe(true);
		expect(row.hasClass('has-relinfo')).toBe(true);
		expect(all[0]!.hasClass('dynasty-relinfo-box')).toBe(true);
		expect(all[0]!.querySelector('.dynasty-relinfo-title')!.getText()).toBe('Relation to you');
		expect(all[0]!.querySelector('.dynasty-relinfo-value')!.getText()).toBe('Sister-in-law');
		expect(all[0]!.querySelector('.dynasty-relinfo-also')!.getText()).toBe('Also: first cousin by marriage.');
		const line = all[0]!.querySelector('.dynasty-show-line')!;
		expect(line.getText()).toBe('Show the line');
		expect(line.getAttribute('aria-label')).toBe('Show the line from you to Orla');
	});

	it('the old block is gone: no .dynasty-relation-summary, and the Family section starts with the Parents group', () => {
		computer();
		const { modal } = open('orla');
		expect(modal.querySelector('.dynasty-relation-summary')).toBeNull();
		const family = modal.querySelector('.dynasty-family')!;
		expect(family.children[1]!.getAttribute('data-family')).toBe('parents');
	});

	it('is not a field: no dynasty-sheet-field and no data-field on the box', () => {
		computer();
		const { modal } = open('orla');
		const box = boxes(modal)[0]!;
		expect(box.hasClass('dynasty-sheet-field')).toBe(false);
		expect(box.getAttribute('data-field')).toBeNull();
		expect(box.closest('[data-field="portrait"]')).not.toBeNull();
	});

	it('Remove portrait builds the row again, and there is still exactly one box', async () => {
		computer();
		const { modal, sheet } = open('orla');
		const inner = sheet as unknown as { draft: { portrait: string }; build(): void; drawPortrait(): void };
		inner.draft.portrait = '[[x.png]]';
		inner.build();
		expect(boxes(modal)).toHaveLength(1);
		inner.drawPortrait();
		expect(boxes(modal)).toHaveLength(1);
		await click(modal.querySelector('.dynasty-remove-portrait'));
		expect(inner.draft.portrait).toBe('');
		expect(boxes(modal)).toHaveLength(1);
		const kids = modal.querySelector('.dynasty-sheet-portrait-row')!.children;
		expect(kids[kids.length - 1]).toBe(boxes(modal)[0]);
	});

	it('the marked person: only "This is you.", class is-me, no title, no button', () => {
		computer();
		const { modal } = open('gwen');
		const box = boxes(modal)[0]!;
		expect(box.hasClass('is-me')).toBe(true);
		expect(box.querySelector('.dynasty-relinfo-value')!.getText()).toBe('This is you.');
		expect(box.querySelector('.dynasty-relinfo-title')).toBeNull();
		expect(box.querySelector('.dynasty-show-line')).toBeNull();
	});

	it('a person with no relation: the value and the button', () => {
		computer();
		const { modal } = open('quill');
		const box = boxes(modal)[0]!;
		expect(box.hasClass('is-none')).toBe(true);
		expect(box.querySelector('.dynasty-relinfo-value')!.getText()).toBe('No relation to you in this tree.');
		expect(box.querySelector('.dynasty-show-line')).not.toBeNull();
	});

	it('a tree with no mark shows nothing on a computer and on a phone; a new person shows nothing', () => {
		computer();
		expect(boxes(open('alan', { body: NO_MARK }).modal)).toHaveLength(0);
		closePluginModals();
		phone();
		expect(boxes(open('alan', { body: NO_MARK }).modal)).toHaveLength(0);
		closePluginModals();
		computer();
		const h = writingHandle(F12);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		s.open();
		expect(boxes((s as unknown as { modalEl: FEl }).modalEl)).toHaveLength(0);
	});

	it('Show the line calls the finder with the marked person first, once', async () => {
		computer();
		const { modal, finder } = open('tamsin');
		await click(modal.querySelector('.dynasty-show-line'));
		expect(finder.show).toHaveBeenCalledTimes(1);
		expect(finder.show).toHaveBeenCalledWith('gwen', 'tamsin');
	});

	it('no finder: no button', () => {
		computer();
		const { modal } = open('tamsin', { finder: false });
		expect(boxes(modal)).toHaveLength(1);
		expect(modal.querySelector('.dynasty-show-line')).toBeNull();
	});

	it('a read-only sheet with no portrait: the box is a direct child of the body, before the Name field', () => {
		computer();
		const { modal, sheet } = open('orla');
		const inner = sheet as unknown as { data: { blocking: string[] }; build(): void };
		inner.data.blocking.push('A problem in the tree.');
		inner.build();
		const body = modal.querySelector('.dynasty-sheet-body')!;
		expect(modal.hasClass('is-read-only')).toBe(true);
		expect(modal.querySelector('[data-field="portrait"]')).toBeNull();
		const box = boxes(modal)[0]!;
		expect(box.parentElement).toBe(body);
		expect(body.children.indexOf(box)).toBeLessThan(body.children.indexOf(body.querySelector('[data-field="name"]')!));
	});

	it('a read-only sheet with a portrait: the box is in the portrait row, after the frame', () => {
		computer();
		const { modal, sheet } = open('orla');
		const inner = sheet as unknown as { data: { blocking: string[] }; draft: { portrait: string }; build(): void };
		inner.data.blocking.push('A problem in the tree.');
		inner.draft.portrait = '[[x.png]]';
		inner.build();
		const row = modal.querySelector('.dynasty-sheet-portrait-row')!;
		expect(row.children[row.children.length - 1]).toBe(boxes(modal)[0]);
		expect(row.children[0]!.hasClass('dynasty-sheet-portrait-frame')).toBe(true);
	});
});

describe('the phone: the strip', () => {
	it('is the first child of the body, before the portrait; closed; label holds the visible text', () => {
		phone();
		const { modal, body } = open('orla');
		const strip = boxes(modal)[0]!;
		expect(modal.hasClass('is-phone')).toBe(true);
		expect(body.children[0]).toBe(strip);
		expect(body.children.indexOf(strip)).toBeLessThan(body.children.indexOf(body.querySelector('[data-field="portrait"]')!));
		expect(modal.querySelector('.dynasty-relinfo-box')).toBeNull();
		const head = strip.querySelector('.dynasty-relinfo-head')!;
		const more = strip.querySelector('.dynasty-relinfo-more')!;
		expect(head.tag).toBe('button');
		expect(head.getAttribute('type')).toBe('button');
		expect(head.getAttribute('aria-expanded')).toBe('false');
		expect(head.getAttribute('aria-controls')).toBe(more.getAttribute('id'));
		expect(more.getAttribute('id')).toMatch(/^dynasty-relinfo-more-/);
		expect(more.hidden).toBe(true);
		expect(head.getAttribute('data-focus')).toBe('relinfo');
		expect(head.querySelector('.dynasty-relinfo-text')!.getText()).toBe('Relation to you: Sister-in-law.');
		expect(head.querySelector('.dynasty-relinfo-count')!.getText()).toBe('1 more');
		expect(head.querySelector('.dynasty-relinfo-icon')!.getAttribute('aria-hidden')).toBe('true');
		expect(head.getAttribute('aria-label')).toBe('Relation to you: Sister-in-law. 1 more.');
	});

	it('shows no count when the person has one relation', () => {
		phone();
		const { modal } = open('tamsin');
		const head = boxes(modal)[0]!.querySelector('.dynasty-relinfo-head')!;
		expect(head.querySelector('.dynasty-relinfo-count')).toBeNull();
		expect(head.getAttribute('aria-label')).toBe(head.querySelector('.dynasty-relinfo-text')!.getText());
	});

	it('the count is "7 more" for 8 relations; the label holds the visible text for 0, 1 and 7 others (WCAG 2.5.3)', () => {
		for (const n of [0, 1, 7]) {
			const parent = new FEl('div');
			const strip = renderRelationStrip(parent as never, view(n, { also: 'Also: a.', addLineButton: () => undefined }), () => 'x');
			const head = (strip as unknown as FEl).querySelector('.dynasty-relinfo-head')!;
			const visible = head.getText().trim();
			const label = head.getAttribute('aria-label')!;
			expect(` ${norm(label)} `).toContain(` ${norm(visible)} `);
			if (n === 0) expect(head.querySelector('.dynasty-relinfo-count')).toBeNull();
			else expect(head.querySelector('.dynasty-relinfo-count')!.getText()).toBe(`${n} more`);
			expect(label).toBe(RELINFO.stripLabel('Relation to you: Second cousin.', n));
		}
		const eight = relationInfo(
			Array.from({ length: 8 }, (_, i) => ({ text: i === 0 ? 'Second cousin' : `Kin ${i}`, lower: i === 0 ? 'second cousin' : `kin ${i}`, steps: [] })) as never,
			false,
		);
		expect(eight.others).toBe(7);
	});

	it('a tap opens it: also, the paragraph and the button in this order; the head keeps the sentence and the count', async () => {
		phone();
		const { modal } = open('orla');
		const strip = boxes(modal)[0]!;
		const head = strip.querySelector('.dynasty-relinfo-head')!;
		await click(head);
		expect(head.getAttribute('aria-expanded')).toBe('true');
		expect(strip.hasClass('is-open')).toBe(true);
		const more = strip.querySelector('.dynasty-relinfo-more')!;
		expect(more.hidden).toBe(false);
		const kids = more.children.map((c) => (c.hasClass('dynasty-show-line') ? 'line' : c.hasClass('dynasty-relinfo-maybe') ? 'maybe' : 'also'));
		expect(kids).toEqual(['also', 'line']);
		expect(head.querySelector('.dynasty-relinfo-text')!.getText()).toBe('Relation to you: Sister-in-law.');
		expect(head.querySelector('.dynasty-relinfo-count')!.getText()).toBe('1 more');
		await click(head);
		expect(head.getAttribute('aria-expanded')).toBe('false');
		expect(more.hidden).toBe(true);
	});

	it('the open part has the order also, maybe, button when all three exist', async () => {
		const parent = new FEl('div');
		const strip = renderRelationStrip(parent as never, view(2, { also: 'Also: a, b.', maybe: 'Maybe.', addLineButton: (p) => void p.createEl('button', { cls: 'dynasty-show-line' }) }), () => 'x') as unknown as FEl;
		await click(strip.querySelector('.dynasty-relinfo-head'));
		const more = strip.querySelector('.dynasty-relinfo-more')!;
		expect(more.children.map((c) => (c.hasClass('dynasty-show-line') ? 'line' : c.hasClass('dynasty-relinfo-maybe') ? 'maybe' : 'also'))).toEqual(['also', 'maybe', 'line']);
	});

	it('Show the line in the open strip calls the finder once; a dirty draft asks "Discard changes?" first', async () => {
		phone();
		const { modal, finder } = open('tamsin');
		const strip = boxes(modal)[0]!;
		await click(strip.querySelector('.dynasty-relinfo-head'));
		type(modal.querySelector('[data-field="name"] input')!, 'Tamsin Changed');
		await click(strip.querySelector('.dynasty-show-line'));
		expect(finder.show).not.toHaveBeenCalled();
		expect(modal.querySelector('.dynasty-sheet-confirm')).not.toBeNull();
	});

	it('Show the line with a clean draft calls the finder once', async () => {
		phone();
		const { modal, finder } = open('tamsin');
		await click(boxes(modal)[0]!.querySelector('.dynasty-relinfo-head'));
		await click(modal.querySelector('.dynasty-show-line'));
		expect(finder.show).toHaveBeenCalledTimes(1);
		expect(finder.show).toHaveBeenCalledWith('gwen', 'tamsin');
	});

	it('the marked person: a static div, "This is you.", no icon, no aria-expanded, same classes', () => {
		phone();
		const { modal } = open('gwen');
		const strip = boxes(modal)[0]!;
		const head = strip.querySelector('.dynasty-relinfo-head')!;
		expect(strip.hasClass('is-static')).toBe(true);
		expect(head.tag).toBe('div');
		expect(head.getText()).toBe('This is you.');
		expect(head.getAttribute('aria-expanded')).toBeNull();
		expect(head.getAttribute('aria-controls')).toBeNull();
		expect(strip.querySelector('.dynasty-relinfo-icon')).toBeNull();
		expect(strip.querySelector('.dynasty-relinfo-more')).toBeNull();
		expect(strip.querySelector('.dynasty-show-line')).toBeNull();
	});

	it('no relation: a button strip that opens to the line button only', async () => {
		phone();
		const { modal } = open('quill');
		const strip = boxes(modal)[0]!;
		const head = strip.querySelector('.dynasty-relinfo-head')!;
		expect(head.tag).toBe('button');
		expect(head.getText()).toBe('No relation to you in this tree.');
		const more = strip.querySelector('.dynasty-relinfo-more')!;
		expect(more.children.map((c) => c.getAttribute('class') ?? [...c.classes].join(' '))).toHaveLength(1);
		expect(more.querySelector('.dynasty-show-line')).not.toBeNull();
	});

	it('a strip with nothing to open (no finder, no also) is static', () => {
		phone();
		const { modal } = open('tamsin', { finder: false });
		const strip = boxes(modal)[0]!;
		expect(strip.hasClass('is-static')).toBe(true);
		expect(strip.querySelector('.dynasty-relinfo-head')!.tag).toBe('div');
	});

	it('the existing label-in-name scan passes on a phone sheet of a marked tree', async () => {
		phone();
		for (const id of ['orla', 'tamsin', 'quill', 'gwen']) {
			const { modal } = open(id);
			for (const b of modal.querySelectorAll('button')) {
				const visible = b.getText().trim();
				const label = b.getAttribute('aria-label');
				if (!visible || !label) continue;
				expect(` ${norm(label)} `, `${id}: "${visible}" in "${label}"`).toContain(` ${norm(visible)} `);
			}
			closePluginModals();
		}
	});
});

describe('the state of the strip', () => {
	it('stays open after a build and in the next sheet; closed again when reset; nothing is stored', async () => {
		phone();
		const first = open('orla');
		await click(boxes(first.modal)[0]!.querySelector('.dynasty-relinfo-head'));
		expect(relationStrip.open).toBe(true);
		(first.sheet as unknown as { build(): void }).build();
		const head = boxes(first.modal)[0]!.querySelector('.dynasty-relinfo-head')!;
		expect(head.getAttribute('aria-expanded')).toBe('true');
		closePluginModals();
		const next = open('tamsin');
		expect(boxes(next.modal)[0]!.querySelector('.dynasty-relinfo-head')!.getAttribute('aria-expanded')).toBe('true');
		closePluginModals();
		relationStrip.open = false;
		expect(boxes(open('orla').modal)[0]!.querySelector('.dynasty-relinfo-head')!.getAttribute('aria-expanded')).toBe('false');
	});

	it('is never written to disk: the source has no store call', () => {
		const src = readFileSync(fileURLToPath(new URL('../src/obsidian/sheet-relation.ts', import.meta.url)), 'utf8');
		expect(src).not.toMatch(/saveData|loadData|localStorage|sessionStorage|writeFile/);
	});
});

describe('the switch between the box and the strip', () => {
	it('crossing 600 px rebuilds the sheet: box on a wide window, strip on a narrow one; the draft and the focus stay', () => {
		phone();
		const { modal, body } = open('orla');
		expect(body.children[0]!.hasClass('dynasty-relinfo-strip')).toBe(true);
		const input = modal.querySelector('[data-field="name"] input')!;
		type(input, 'Orla Changed');
		input.focus();
		device.width = 844;
		dispatchWindow('resize');
		expect(boxes(modal)).toHaveLength(1);
		expect(boxes(modal)[0]!.hasClass('dynasty-relinfo-box')).toBe(true);
		expect(modal.querySelector('.dynasty-relinfo-strip')).toBeNull();
		const again = modal.querySelector('[data-field="name"] input')!;
		expect(again.value).toBe('Orla Changed');
		device.width = 390;
		dispatchWindow('resize');
		expect(boxes(modal)).toHaveLength(1);
		expect(boxes(modal)[0]!.hasClass('dynasty-relinfo-strip')).toBe(true);
		expect(modal.querySelector('[data-field="name"] input')!.value).toBe('Orla Changed');
	});

	it('a window change inside the same layout does not rebuild the sheet', () => {
		computer();
		const { modal } = open('orla');
		const box = boxes(modal)[0]!;
		device.width = 1100;
		dispatchWindow('resize');
		expect(boxes(modal)[0]).toBe(box);
	});

	it('a tree with no mark does not rebuild when the width crosses 600 px', () => {
		phone();
		const { modal, body } = open('alan', { body: NO_MARK });
		const first = body.children[0];
		device.width = 844;
		dispatchWindow('resize');
		expect(modal.querySelector('.dynasty-sheet-body')!.children[0]).toBe(first);
	});
});

describe('the cost', () => {
	it('building the sheet for one person computes the relation names once', () => {
		computer();
		const before = relationStats.computed;
		open('orla');
		expect(relationStats.computed - before).toBe(1);
	});
});

describe('the box renderer alone', () => {
	it('kind none and kind me have the classes of the DOM contract', () => {
		const parent = new FEl('div');
		const me = renderRelationBox(parent as never, { kind: 'me', title: '', value: 'This is you.', sentence: 'This is you.', others: 0 }) as unknown as FEl;
		expect(me.hasClass('is-me')).toBe(true);
		const none = renderRelationBox(parent as never, { kind: 'none', title: '', value: 'No relation to you in this tree.', sentence: 'No relation to you in this tree.', others: 0 }) as unknown as FEl;
		expect(none.hasClass('is-none')).toBe(true);
	});
});

describe('styles.css', () => {
	const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
	const ruleBodies = (needle: RegExp) => rules.filter((r) => needle.test(r.sel)).map((r) => r.body);

	it('the strip, its head and its text never cut or stick: no text-overflow, no nowrap, no sticky', () => {
		const bodies = ruleBodies(/\.dynasty-relinfo-(strip|head|text)\b/);
		expect(bodies.length).toBeGreaterThan(0);
		for (const b of bodies) expect(b).not.toMatch(/text-overflow|nowrap|sticky/);
	});

	it('the whole relinfo block has no colour value, and the old classes are gone', () => {
		const bodies = ruleBodies(/dynasty-relinfo/);
		expect(bodies.length).toBeGreaterThan(0);
		for (const b of bodies) expect(b).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
		expect(css).not.toContain('.dynasty-relation-summary');
		expect(css).not.toContain('.dynasty-relation-main');
	});

	it('the head has a height of at least 44 px and the standalone box does not shrink', () => {
		expect(ruleBodies(/\.dynasty-relinfo-head\b/).join('\n')).toMatch(/min-height:\s*44px/);
		expect(ruleBodies(/\.dynasty-sheet-body\s*>\s*\.dynasty-relinfo-box/).join('\n')).toMatch(/flex:\s*none/);
	});
});
