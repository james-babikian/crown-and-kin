import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { closePluginModals } from '../../src/view/plugin-modals';
import { clearRelationCache, relationStats } from '../../src/view/relation-cache';
import { lowerFirst, renderRelationLine, type RelationView } from '../../src/obsidian/sheet-relation';
import { RELINFO } from '../../src/render/tree-info';
import { ME_UI, SHEET, WINDOW_UI } from '../../src/render/ui-text';
import { FEl, clock, device, dispatch, fireMediaChange, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { sample12 } from '../acceptance/relations-support';
import { click, stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.5, WP-E1 (D146; spec §13.1), changed in 0.2.8 (contract C, D197 Q8 A): the relation to the marked person is one text line in the
 * header of the person window: "Your sister-in-law · 1 more · Show the line". "1 more" opens the "Also: …" text line; the sentence of the
 * "maybe" keeps its own quiet text line. A phone has the same line. The fakes run the real EditSheet on sample tree 12, which is marked on
 * Gwen. All names are made up.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	clearRelationCache();
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

function open(personId: string, o: { body?: string; finder?: boolean } = {}) {
	const body = o.body ?? F12;
	const h = writingHandle(body);
	const finder = { show: vi.fn() };
	const sheet = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md', ...(o.finder === false ? {} : { finder }) } as never)!;
	sheet.open();
	const modal = (sheet as unknown as { modalEl: FEl }).modalEl;
	return { h, sheet, modal, finder };
}

const lines = (modal: FEl) => modal.querySelectorAll('.dynasty-head-rel');

describe('the relation text line of the header', () => {
	it('is one joined text line: "Your sister-in-law", "1 more" and "Show the line", under the detail line', () => {
		computer();
		const { modal } = open('orla');
		const all = lines(modal);
		expect(all).toHaveLength(1);
		const items = all[0]!.querySelectorAll('.dynasty-jitem');
		expect(items.map((i) => i.querySelector('.dynasty-jmark') === null)).toEqual([true, false, false]);
		expect(items[0]!.getText()).toBe(WINDOW_UI.relationYour('sister-in-law'));
		const more = all[0]!.querySelector('.dynasty-more')!;
		expect(more.getText()).toBe(RELINFO.more(1));
		expect(more.getAttribute('aria-label')).toBe(WINDOW_UI.moreLabel(1));
		expect(more.getAttribute('aria-expanded')).toBe('false');
		const line = all[0]!.querySelector('.dynasty-show-line')!;
		expect(line.getText()).toBe(ME_UI.showLine);
		expect(line.getAttribute('aria-label')).toBe(ME_UI.showLineLabel('Orla'));
		// The line stands in the text column of the header, after the name.
		const text = modal.querySelector('.dynasty-head-text')!;
		expect(text.children.indexOf(all[0]!)).toBeGreaterThan(text.children.indexOf(text.querySelector('.dynasty-head-name')!));
	});

	it('"1 more" opens and closes the "Also" text line under the first line', () => {
		computer();
		const { modal } = open('orla');
		const also = modal.querySelector('.dynasty-relation-also')!;
		expect(also.getText()).toBe('Also: first cousin by marriage.');
		expect(also.hidden).toBe(true);
		const more = modal.querySelector('.dynasty-more')!;
		dispatch(more, 'click');
		expect(also.hidden).toBe(false);
		expect(more.getAttribute('aria-expanded')).toBe('true');
		dispatch(more, 'click');
		expect(also.hidden).toBe(true);
		expect(more.getAttribute('aria-expanded')).toBe('false');
	});

	it('the old box, strip and infobox are gone', () => {
		computer();
		const { modal } = open('orla');
		expect(modal.querySelector('.dynasty-relinfo')).toBeNull();
		expect(modal.querySelector('.dynasty-relation-summary')).toBeNull();
	});

	it('the marked person: only "This is you.", no title, no button', () => {
		computer();
		const { modal } = open('gwen');
		const line = lines(modal)[0]!;
		expect(line.hasClass('is-me')).toBe(true);
		expect(line.getText()).toBe('This is you.');
		expect(modal.querySelector('.dynasty-show-line')).toBeNull();
	});

	it('a person with no relation: the text and no "more"; the button stays', () => {
		computer();
		const { modal } = open('quill');
		const line = lines(modal)[0]!;
		expect(line.hasClass('is-none')).toBe(true);
		expect(line.querySelector('.dynasty-jitem')!.getText()).toBe('No relation to you in this tree.');
		expect(line.querySelector('.dynasty-more')).toBeNull();
		expect(line.querySelector('.dynasty-show-line')).not.toBeNull();
	});

	it('a tree with no mark shows nothing on a computer and on a phone; a new person shows nothing', () => {
		computer();
		expect(lines(open('alan', { body: NO_MARK }).modal)).toHaveLength(0);
		closePluginModals();
		phone();
		expect(lines(open('alan', { body: NO_MARK }).modal)).toHaveLength(0);
		closePluginModals();
		computer();
		const h = writingHandle(F12);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		s.open();
		expect(lines((s as unknown as { modalEl: FEl }).modalEl)).toHaveLength(0);
	});

	it('Show the line calls the finder with the marked person first, once', async () => {
		computer();
		const { modal, finder } = open('tamsin');
		await click(modal.querySelector('.dynasty-show-line'));
		expect(finder.show).toHaveBeenCalledTimes(1);
		expect(finder.show).toHaveBeenCalledWith('gwen', 'tamsin');
	});

	it('Show the line with a draft that changed asks "Discard changes?" first', async () => {
		computer();
		const { modal, finder, sheet } = open('tamsin');
		(sheet as unknown as { draft: { name: string } }).draft.name = 'Tamsin Changed';
		await click(modal.querySelector('.dynasty-show-line'));
		expect(finder.show).not.toHaveBeenCalled();
		expect(modal.querySelector('.dynasty-sheet-confirm')!.getText()).toContain(SHEET.discardTitle);
	});

	it('no finder: no button, and the line still shows the relation', () => {
		computer();
		const { modal } = open('tamsin', { finder: false });
		expect(lines(modal)).toHaveLength(1);
		expect(modal.querySelector('.dynasty-show-line')).toBeNull();
		expect(lines(modal)[0]!.getText()).toContain('Your ');
	});

	it('a phone has the same text line, and a read-only window keeps it', () => {
		phone();
		const { modal, sheet } = open('orla');
		expect(modal.hasClass('is-phone')).toBe(true);
		expect(lines(modal)).toHaveLength(1);
		const inner = sheet as unknown as { data: { blocking: string[] }; build(): void };
		inner.data.blocking.push('A problem in the tree.');
		inner.build();
		expect(modal.hasClass('is-read-only')).toBe(true);
		expect(lines(modal)).toHaveLength(1);
	});

	it('crossing 600 px draws the window again (a phone has a bar, a computer a footer) and keeps the draft', () => {
		computer();
		const { modal, sheet } = open('orla');
		(sheet as unknown as { draft: { name: string } }).draft.name = 'Orla Changed';
		expect(modal.querySelector('.dynasty-foot')).not.toBeNull();
		// `phoneLayout` sets the class from the window width (and calls `relLayout`); the test sets the class as it does.
		modal.addClass('is-phone');
		(sheet as unknown as { relLayout(): void }).relLayout();
		expect(modal.querySelector('.dynasty-bar')).not.toBeNull();
		expect(modal.querySelector('.dynasty-foot')).toBeNull();
		expect((sheet as unknown as { draft: { name: string } }).draft.name).toBe('Orla Changed');
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

describe('the renderer alone', () => {
	it('lowers only the first letter, so a relation text keeps its own capitals', () => {
		expect(lowerFirst('Half-sister, maybe full')).toBe('half-sister, maybe full');
		expect(lowerFirst('Rumoured stepmother')).toBe('rumoured stepmother');
	});

	it('draws the kind none and the kind me with their classes, and a "maybe" line of its own', () => {
		const parent = new FEl('div');
		const me = renderRelationLine(parent as never, { kind: 'me', value: 'This is you.', others: 0 }) as unknown as FEl;
		expect(me.hasClass('is-me')).toBe(true);
		const none = renderRelationLine(parent as never, { kind: 'none', value: 'No relation to you in this tree.', others: 0 }) as unknown as FEl;
		expect(none.hasClass('is-none')).toBe(true);
		const v: RelationView = { kind: 'relation', value: 'Half-sister, maybe full', others: 0, maybe: 'If the parent … is the same person, this person is your full sister.' };
		const box = new FEl('div');
		renderRelationLine(box as never, v);
		expect(box.querySelector('.dynasty-head-rel')!.getText()).toBe('Your half-sister, maybe full');
		expect(box.querySelector('.dynasty-relation-maybe')!.getText()).toBe(v.maybe);
	});
});

describe('styles.css', () => {
	const css = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
	const ruleBodies = (needle: RegExp) => rules.filter((r) => needle.test(r.sel)).map((r) => r.body);

	it('the relation line has no colour value, and the old classes are gone', () => {
		const bodies = ruleBodies(/dynasty-head-rel|dynasty-showline|dynasty-more\b/);
		expect(bodies.length).toBeGreaterThan(0);
		for (const b of bodies) expect(b).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
		expect(css).not.toContain('.dynasty-relinfo');
		expect(css).not.toContain('.dynasty-relation-summary');
	});

	it('"Show the line" and "4 more" keep one thin underline at rest (a cue that is not a colour; D218 rule 5)', () => {
		expect(ruleBodies(/\.dynasty-head-rel \.dynasty-showline/).join('\n')).toContain('text-decoration: underline');
		expect(ruleBodies(/\.dynasty-head-rel \.dynasty-more/).join('\n')).toContain('text-decoration: underline');
	});

	it('on a phone the tap area of a link in the line grows to 44 px with no button look', () => {
		const body = ruleBodies(/\.dynasty-sheet\.is-phone \.dynasty-head-rel \.dynasty-link::after/).join('\n');
		expect(body).toMatch(/height:\s*44px/);
	});
});
