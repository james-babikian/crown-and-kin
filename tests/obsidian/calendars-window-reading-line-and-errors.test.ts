import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BIDI_FSI, BIDI_PDI } from '../../src/render/bidi-controls';
import { CALENDAR_WINDOW_UI as T } from '../../src/render/calendar-text';
import { checkDraft, draftOf, startReadback } from '../../src/view/calendar-draft';
import { parseCalendarBlock } from '../../src/core/calendar-block';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { calField, openWindow, saveWindow, typeInto } from '../support/calendar-window-app';
import { cycleNote, eraNote } from '../support/calendar-vault';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 (0.5.2 audit) in the Calendars window: the reading line of an era keeps the digit after an Arabic era name (CAL-19), the head and the new note (CAL-15, UX-11),
 * the one error rule (CX-11), Cancel that asks (O-14) and the narrow block (CAL-16). The look is in the style sheet; the sizes are checked in the harness.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const css = readFileSync('styles/37-calendars.css', 'utf8');
const win = () => (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-sheet-confirm');

const ARABIC = 'عهد الإمبراطور العظيم';

describe('the reading line (O-23, CAL-19)', () => {
	function eraLine(name: string, same: string): string {
		const text = `\`\`\`kin-calendar\ncalendars:\n  - name: Reigns\n    kind: eras\n    formats: ["{era} {year}"]\n    eras:\n      - {name: ${name}, start: 130}\n\`\`\`\n`;
		const { calendars } = parseCalendarBlock(text.split('\n').slice(1, -2).join('\n'), 'n.md', 0);
		const drafts = draftOf(calendars, (() => { let n = 0; return () => n++; })());
		drafts[0].eras[0].start.same = same;
		const checked = checkDraft(drafts, 'Calendars.md');
		return startReadback(checked.starts.get(`e${drafts[0].eras[0].key}`), checked.calendars[0], null);
	}

	it('is only the example, with no "Example:" and no instruction', () => {
		expect(eraLine('Qinglong Emperor', '130')).toBe('Qinglong Emperor 1 = year 130');
	});

	it('isolates an Arabic era name, so the digit stays after the name', () => {
		expect(eraLine(ARABIC, '130')).toBe(`${BIDI_FSI}${ARABIC} 1${BIDI_PDI} = year 130`);
	});
});

describe('the head and the new note', () => {
	it('keeps the dot before "New calendar note" in its own span, so a phone can drop it (CAL-15)', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		const meta = o.win.contentEl.querySelector('.dynasty-cal-top .dynasty-head-meta')!;
		expect(meta.querySelector('.dynasty-cal-meta-text')!.getText()).not.toMatch(/·\s*$/);
		expect(meta.querySelector('.dynasty-cal-meta-dot')!.getText()).toBe(' · ');
		expect(css).toMatch(/\.dynasty-sheet\.is-phone \.dynasty-cal-meta-dot\s*\{\s*display:\s*none/);
	});

	it('puts the name and the folder of a new note under the heading "Note for the calendars" (UX-11)', async () => {
		const o = await openWindow({});
		const box = o.win.contentEl.querySelector('.dynasty-cal-note')!;
		const heading = box.querySelector('.dynasty-cal-subhead')!;
		expect(heading.getText()).toBe(T.noteGroup);
		expect(heading.getAttribute('role')).toBe('heading');
		expect(box.children.indexOf(heading)).toBeLessThan(box.children.indexOf(box.querySelector('.dynasty-grid')!));
	});

	it('says the one purpose line in every state (O-25)', async () => {
		const empty = await openWindow({});
		expect(empty.win.contentEl.querySelector('.dynasty-cal-intro')!.getText()).toBe(T.intro);
		const full = await openWindow({ 'Calendars.md': cycleNote() });
		expect(full.win.contentEl.querySelector('.dynasty-cal-intro')!.getText()).toBe(T.introShort);
		expect(T.intro).toBe(T.introShort);
	});
});

describe('errors and Cancel (CX-11, O-14)', () => {
	it('an error about one field stands under it and gives it the error edge; it goes when the field is corrected', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		typeInto(c, '0-length', '0');
		await saveWindow(c);
		const length = calField(c, '0-length');
		expect(length.getAttribute('aria-invalid')).toBe('true');
		expect(length.parentElement!.querySelector('.dynasty-field-error[data-refusal]')).not.toBeNull();
		typeInto(c, '0-length', '60');
		expect(length.getAttribute('aria-invalid')).toBeNull();
		expect(length.parentElement!.querySelector('.dynasty-field-error')).toBeNull();
	});

	it('the summary of a Save with errors stands under the head, before the note box', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		typeInto(c, '0-length', '0');
		await saveWindow(c);
		const body = c.querySelector('.dynasty-sheet-body')!;
		const kids = body.children;
		const error = body.querySelector('.dynasty-window-error')!;
		expect(kids.indexOf(error)).toBe(kids.indexOf(body.querySelector('.dynasty-head')!) + 1);
		expect(error.getText()).toBe(T.refusalSummary(1));
	});

	it('Cancel with a typed change asks "Discard changes?", and "Discard changes" closes the window', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		typeInto(c, '0-name', 'Another name');
		dispatch(c.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(openModals).toHaveLength(1);
		const question = win()!;
		expect(question.getText()).toContain(T.discardText);
		dispatch(question.querySelector('.dynasty-sheet-discard')!, 'click');
		expect(openModals).toHaveLength(0);
	});

	it('Cancel with no change closes at once', async () => {
		const o = await openWindow({ 'Calendars.md': eraNote() });
		dispatch(o.win.contentEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(openModals).toHaveLength(0);
	});
});

describe('the narrow block (CAL-16)', () => {
	it('has a container rule that drops the dot and puts the kind under the name', () => {
		expect(css).toMatch(/\.dynasty-cal-view\s*\{\s*container-type:\s*inline-size/);
		expect(css).toMatch(/@container \(max-width: 400px\)\s*\{\s*\.dynasty-cal-block-dot\s*\{\s*display:\s*none;\s*\}\s*\.dynasty-cal-block-kind\s*\{\s*display:\s*block/);
	});

	it('ends a placeholder that is too long with an ellipsis, in the window and in the block', () => {
		expect(css).toMatch(/\.dynasty-calendars input\.dynasty-sheet-input::placeholder,[^{]*\{\s*text-overflow:\s*ellipsis/);
	});
});
