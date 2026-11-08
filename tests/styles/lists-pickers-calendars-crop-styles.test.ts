import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * P5 fix round, package C (D330): the Titles and Houses pages, the pickers, the picture list, the Calendars window and the crop tool.
 * The fake DOM has no layout, so each rule is pinned by what it says; the pixel values are the ones the design checks measured.
 */

const chunk = (name: string): string => readFileSync(`styles/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const picker = chunk('13-person-picker.css');
const pictures = chunk('21-houses-pictures.css');
const crop = chunk('24-crop-tool.css');
const lists = chunk('35-list-windows.css');
const calendars = chunk('37-calendars.css');

/** The declarations of every rule whose selector list ends with exactly this selector text, joined in file order. */
function rule(css: string, selector: string): string {
	const found = [...css.matchAll(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'g'))];
	if (!found.length) throw new Error(`no rule: ${selector}`);
	return found.map((m) => css.slice(css.indexOf('{', m.index) + 1, css.indexOf('}', m.index))).join('\n');
}

describe('Titles and Houses (P3-01, P3-11)', () => {
	it('the name of a page wraps as far as it needs and is never cut', () => {
		const name = rule(lists, '.dynasty-lw .dynasty-lw-back-name');
		expect(name).toContain('overflow-wrap: anywhere');
		expect(name).not.toContain('line-clamp');
		expect(name).not.toContain('overflow: hidden');
		expect(lists).not.toContain('-webkit-line-clamp');
	});

	it('the count under a tool title is in the interface font', () => {
		expect(rule(lists, '.dynasty-lw .dynasty-lw-meta-count')).toContain('font-family: var(--dynasty-font-tool)');
	});
});

describe('the pickers (P3-04, P3-05, P3-06, F07)', () => {
	it('the hint of the relation finder and its title start on the edge of the names: 8 px in from the window padding', () => {
		const head = rule(picker, '.dynasty-picker.is-phone.has-phone-title .dynasty-picker-head');
		expect(head).toMatch(/padding: [^;]*calc\(max\(var\(--dynasty-space-4\), var\(--dynasty-safe-left\)\) \+ var\(--dynasty-space-2\)\)/);
	});

	it('the quiet plus keeps a 20 px column on the phone too', () => {
		const plus = rule(picker, '.dynasty-picker.is-phone .dynasty-picker-swatch.is-new');
		expect(plus).toContain('width: 20px');
		expect(plus).toContain('height: auto');
	});

	it('the Create text is regular', () => {
		expect(rule(picker, '.dynasty-picker-new .dynasty-picker-name')).toContain('font-weight: var(--dynasty-weight-normal)');
	});
});

describe('the picture list (P3-07, P3-08, P3-09)', () => {
	it('the action rows start on the edge of a folder row at depth 0', () => {
		const sel = '.modal.dynasty-picture-picker .dynasty-picture-row.dynasty-picture-device,\n.modal.dynasty-picture-picker .dynasty-picture-row.dynasty-picture-remove';
		expect(picker).toContain(sel + ' {\n\tpadding-left: var(--dynasty-space-2);');
		expect(rule(picker, '.modal.dynasty-picture-picker .dynasty-picture-row.dynasty-picture-folder-row')).toContain('padding-left: calc(var(--dynasty-space-2)');
	});

	it('the header and the search bar have no colour of their own, so the dark phone list has one surface', () => {
		expect(rule(pictures, '.dynasty-picture-top')).toContain('background: none');
		expect(rule(pictures, '.dynasty-picture-searchbar')).toContain('background: none');
	});

	it('the empty sentence is the Text role on the edge of the row texts, and nothing later makes it Small again', () => {
		const none = rule(picker, '.modal.dynasty-picture-picker .dynasty-picture-none');
		expect(none).toContain('padding-left: calc(var(--dynasty-space-2) + var(--dynasty-picture-lead))');
		expect(none).toContain('--dynasty-picture-lead: 26px');
		expect(none).toContain('font-size: var(--dynasty-type-text)');
		expect(picker).not.toMatch(/\.dynasty-picture-none \{[^}]*font-size: var\(--dynasty-type-small\)/);
	});
});

describe('the Calendars window (K-01, K-02, K-04, K-11)', () => {
	it('the number columns of the era and cycle rows are as wide as their fields, so Length ends on the shared edge', () => {
		expect(rule(calendars, '.dynasty-cal-start-row')).toContain('grid-template-columns: max-content max-content auto minmax(0, 1fr)');
		expect(rule(calendars, '.dynasty-cal-start-row.is-era')).toContain('grid-template-columns: max-content auto minmax(0, 1fr) max-content');
	});

	it('the tap area of Remove on a phone grows upward only, clear of the Era name field', () => {
		expect(rule(calendars, '.dynasty-sheet.is-phone .dynasty-cal-labelrow')).toContain('align-items: flex-end');
		const remove = rule(calendars, '.dynasty-sheet.is-phone .dynasty-cal-labelrow .dynasty-cal-remove');
		expect(remove).toContain('margin-block: -27px 0');
		expect(remove).toContain('align-items: flex-end');
	});

	it('the refusal under a field takes its size and weight from the shared error rule (semibold)', () => {
		expect(calendars).not.toMatch(/\.dynasty-cal-field-error \{/);
		expect(calendars).not.toContain('is-long');
	});
});

describe('the crop tool (K-12)', () => {
	it('the name under the title is in the text font', () => {
		expect(rule(crop, '.dynasty-crop-name')).toContain('font-family: var(--font-text)');
	});
});
