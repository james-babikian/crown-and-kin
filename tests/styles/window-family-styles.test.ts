import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * D330 (the 0.5.2 audit), the windows of the person, the partnership, the choice steps and the ID window. The rules are read from the chunks of `styles/`.
 * The fake DOM has no layout, so each rule is pinned by what it says: the pixel value that the review measured is the one in the rule.
 */

const chunk = (name: string): string => readFileSync(`styles/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = chunk('10-edit-sheet.css');

/** The declarations of the first rule with exactly this selector text (an exact match of the text before the brace). */
function rule(css: string, selector: string): string {
	const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`));
	if (at < 0) throw new Error(`no rule: ${selector}`);
	const open = css.indexOf('{', at);
	return css.slice(open + 1, css.indexOf('}', open));
}

describe('the buttons and the fields end on one right edge (W-01, P3-02, P3-03, D326)', () => {
	it('a computer body keeps the room of the scroll bar all the time, so nothing moves when the scroll bar comes', () => {
		const body = rule(sheet, '.dynasty-sheet:not(.is-phone) .dynasty-sheet-body');
		expect(body).toContain('scrollbar-gutter: stable');
		expect(body).toContain('--dynasty-gutter: var(--scrollbar-width, 12px)');
		// The room does not depend on a class that the shell sets after the layout.
		expect(sheet).not.toContain('has-overflow:not');
		expect(sheet).not.toContain('.has-overflow .dynasty-sheet-body');
	});

	it('the body takes the room off its end padding: 24 px with no scroll bar, and 12 px between the content and the scroll bar', () => {
		const at = sheet.indexOf('@media (pointer: fine)');
		expect(at).toBeGreaterThan(-1);
		const media = sheet.slice(at).replace(/\n\t/g, '\n');
		expect(rule(media, '.dynasty-sheet:not(.is-phone) .dynasty-sheet-body')).toContain('padding-inline-end: calc(var(--dynasty-space-5) - var(--dynasty-gutter))');
	});

	it('the footer and the fixed top parts of the list and picture windows keep the plain 24 px of padding and reserve nothing, so the buttons, the search and the fields end on one edge', () => {
		const foot = rule(sheet, '.dynasty-foot');
		expect(foot).toContain('padding: var(--dynasty-space-3) var(--dynasty-space-5) var(--dynasty-space-4)');
		expect(foot).not.toContain('scrollbar-gutter');
		expect(foot).not.toContain('overflow');
		expect(chunk('35-list-windows.css')).toContain('padding: 22px var(--dynasty-space-5) 0');
		expect(chunk('21-houses-pictures.css')).not.toContain('scrollbar-gutter');
	});

	it('no other chunk reserves room for a scroll bar (the Calendars window had 25 px and 37 px)', () => {
		expect(chunk('37-calendars.css')).not.toContain('scrollbar-gutter');
		expect(chunk('35-list-windows.css')).not.toContain('scrollbar-gutter');
	});
});

describe('the Family rhythm on a touch screen (W-03)', () => {
	it('the "+ Add" link keeps its 44 px tap box and gives 9 px back above and below, on a phone and on any touch screen', () => {
		expect(rule(sheet, '.dynasty-sheet.is-phone button.dynasty-add-link')).toMatch(/min-height: 44px[\s\S]*margin-block: -9px/);
		const coarse = sheet.slice(sheet.indexOf('@media (pointer: coarse)'));
		expect(coarse).toMatch(/\.dynasty-sheet button\.dynasty-add-link \{[^}]*margin-block: -9px/);
		expect(coarse).toMatch(/\.dynasty-sheet-actions button,[\s\S]*\.dynasty-sheet button\.dynasty-add-link,[\s\S]*min-height: 44px/);
	});

	it('the group heading has one rhythm on a computer and a phone: 4 px above, 4 px under it to the rows', () => {
		expect(rule(sheet, '.dynasty-sheet-body .dynasty-sub-row')).toContain('margin: var(--dynasty-space-1) 0 calc(-1 * var(--dynasty-space-2))');
		expect(sheet).not.toContain('.dynasty-sheet.is-phone .dynasty-sub-row');
	});
});

describe('a check box is a square in every theme (W-08)', () => {
	it('the radius is the theme radius with a cap of 5 px', () => {
		expect(rule(sheet, ".dynasty-sheet .dynasty-check input[type='checkbox']")).toContain('border-radius: min(var(--checkbox-radius, 4px), 5px)');
	});

	it('its edge is the edge of a field, and its focus ring is the one recipe', () => {
		expect(rule(sheet, ".dynasty-sheet .dynasty-check input[type='checkbox']")).toContain('border: var(--dynasty-field-edge)');
		expect(rule(sheet, ".dynasty-sheet .dynasty-check input[type='checkbox']:focus-visible")).toContain('outline: var(--dynasty-focus-outline)');
	});
});

describe('a right-to-left name keeps its quotes and the row keeps its left edge (W-09)', () => {
	it('the names, the text lines and the summary take the direction of their first strong letter', () => {
		const at = sheet.indexOf('.dynasty-head-name > span:first-child,\n.dynasty-head-meta,');
		expect(at).toBeGreaterThan(-1);
		const body = sheet.slice(sheet.indexOf('{', at), sheet.indexOf('}', at));
		expect(body).toContain('unicode-bidi: plaintext');
		expect(body).toContain('text-align: left');
		expect(sheet.slice(at, sheet.indexOf('{', at))).toMatch(/\.dynasty-row-title,\s*\.dynasty-row-sub,\s*\.dynasty-section-sum/);
	});
});

describe('the house in the head grows with a long name (D336 F1)', () => {
	it('the house span has no fixed height, so a second text line has room; the mark stays in a one-line box', () => {
		const house = rule(sheet, '.dynasty-head-meta .dynasty-house');
		expect(house).not.toMatch(/(^|[\s;])height:/);
		expect(house).toContain('min-height: 1.45em');
		expect(house).toContain('align-items: flex-start');
		expect(rule(sheet, '.dynasty-head-meta .dynasty-house-armsmark')).toContain('height: 1.45em');
		expect(rule(sheet, '.dynasty-head-meta .dynasty-house-dot')).toContain('margin-top: calc((1.45em - 9px) / 2)');
	});
});

describe('W-10 and CX-08: the grid is on the spacing scale', () => {
	it('label to field 4 px, row to row 12 px, the section body 4 px above and 24 px below', () => {
		expect(rule(sheet, '.dynasty-sheet-field')).toContain('gap: var(--dynasty-space-1)');
		expect(rule(sheet, '.dynasty-grid')).toContain('gap: var(--dynasty-space-3) var(--dynasty-space-4)');
		expect(rule(sheet, '.dynasty-stack')).toContain('gap: var(--dynasty-space-3)');
		const body = rule(sheet, '.dynasty-section-body');
		expect(body).toContain('gap: var(--dynasty-space-3)');
		expect(body).toContain('padding: var(--dynasty-space-1) 0 var(--dynasty-space-5)');
	});

	it('the heading of a section stands 12 px under its line, open or closed, and the chevron stands on the heading line', () => {
		const head = rule(sheet, '.dynasty-sheet button.dynasty-section-head');
		expect(head).toContain('padding: var(--dynasty-space-3) 0');
		expect(head).toContain('align-content: start');
		const chevron = rule(sheet, '.dynasty-section-chevron');
		expect(chevron).toContain('grid-row: 1');
		expect(chevron).toContain('align-self: start');
		expect(rule(sheet, '.dynasty-sheet.is-phone button.dynasty-section-head')).toContain('min-height: 48px');
	});

	it('a text field has the edge and the radius of the tokens; a text area keeps its own smaller radius (D320)', () => {
		const field = rule(sheet, '.dynasty-sheet .dynasty-input,\n.dynasty-sheet input.dynasty-sheet-input,\n.dynasty-sheet select.dynasty-sheet-input,\n.dynasty-sheet textarea.dynasty-sheet-input');
		expect(field).toContain('border: var(--dynasty-field-edge)');
		expect(field).toContain('border-radius: var(--dynasty-radius-field)');
		expect(sheet.match(/\.dynasty-sheet textarea\.dynasty-sheet-input \{\s*height: auto;[^}]*\}/)![0]).toContain('border-radius: var(--dynasty-radius-area)');
	});
});

describe('W-11 and W-12: a narrow phone and a window with no header', () => {
	it('under 360 px the House and Sex lists take a row each', () => {
		const at = sheet.indexOf('@media (max-width: 359px)');
		expect(at).toBeGreaterThan(-1);
		const body = sheet.slice(at, sheet.indexOf('}\n}', at));
		expect(body).toMatch(/\[data-field='house'\], \[data-field='sex'\]/);
		expect(body).toContain('grid-column: 1 / -1');
	});

	it('the partnership window, the ID window and a choice have 16 px under the phone bar', () => {
		expect(rule(sheet, '.dynasty-sheet.is-phone:is(.dynasty-union-edit, .dynasty-id-window, .dynasty-choice) .dynasty-sheet-body')).toContain('padding-top: var(--dynasty-space-4)');
	});
});

describe('L-04, CAL-20 and the Save keys', () => {
	it('the heir number stands on the first text line of the name', () => {
		const ord = rule(sheet, '.dynasty-row .dynasty-ord');
		expect(ord).toContain('align-self: flex-start');
		expect(ord).toContain('line-height: calc(1.3 * var(--dynasty-type-heading))');
	});

	it('a long section title wraps and never runs under the chevron', () => {
		const title = rule(sheet, '.dynasty-section-title');
		expect(title).toContain('white-space: normal');
		expect(title).toContain('overflow-wrap: anywhere');
	});

	it('the keys beside Save are small, regular and have a margin at the start', () => {
		const keys = rule(sheet, '.dynasty-save-keys');
		expect(keys).toContain('margin-inline-start: var(--dynasty-space-2)');
		expect(keys).toContain('font-size: var(--dynasty-type-small)');
		expect(keys).toContain('font-weight: var(--dynasty-weight-normal)');
	});

	it('the visible title of a computer window has the room of the body, and the body under it has less on top', () => {
		expect(rule(sheet, '.dynasty-sheet-title.dynasty-title')).toContain('padding: var(--dynasty-space-5) var(--dynasty-space-5) 0');
		expect(rule(sheet, '.dynasty-sheet-title.dynasty-title + .dynasty-sheet-body')).toContain('padding-top: var(--dynasty-space-3)');
	});
});

describe('the focus recipe and the error rule (CX-10)', () => {
	it('a button and a tab stop of a window take the recipe of the tokens; a control that fills its row takes the inset pair', () => {
		const ring = rule(sheet, '.dynasty-sheet button:focus-visible,\n.dynasty-sheet [tabindex]:focus-visible');
		expect(ring).toContain('outline: var(--dynasty-focus-outline)');
		expect(ring).toContain('outline-offset: var(--dynasty-focus-offset)');
		expect(ring).toContain('box-shadow: var(--dynasty-focus-shadow)');
		const inset = rule(sheet, '.dynasty-sheet button.dynasty-section-head:focus-visible,\n.dynasty-sheet button.dynasty-row.is-tap:focus-visible');
		expect(inset).toContain('outline-offset: var(--dynasty-focus-inset-offset)');
		expect(inset).toContain('box-shadow: var(--dynasty-focus-inset-shadow)');
		expect(sheet).not.toContain('--background-modifier-border-focus');
	});

	it('an error under a field is in Small size; the edge of the field is the error edge of 01-base.css', () => {
		expect(rule(sheet, '.dynasty-sheet-error.dynasty-field-error')).toContain('font-size: var(--dynasty-type-small)');
		expect(chunk('01-base.css')).toContain("input[aria-invalid='true']");
	});
});

describe('W-05 and CX-18: the partnership window', () => {
	it('the names stand where the name of the person window stands; its phone bar title wraps through the hook and no other bar title does', () => {
		expect(rule(sheet, '.dynasty-union-edit .dynasty-union-title')).toContain('padding-top: 2px');
		const wrapping = rule(sheet, '.dynasty-bar .dynasty-bar-title.is-wrapping');
		expect(wrapping).toContain('-webkit-line-clamp: 3');
		expect(wrapping).toContain('white-space: normal');
		const line = rule(sheet, '.dynasty-bar .dynasty-bar-title');
		expect(line).toContain('white-space: nowrap');
		expect(line).toContain('text-overflow: ellipsis');
	});
});

describe('O-10 and W-04: each Family group keeps only the room that its controls need', () => {
	const family = chunk('11-sheet-family.css');

	it('a child row 24 px (44 px on a phone), a partner row 76 px (92 px), a parent row as before', () => {
		expect(rule(family, ".dynasty-family-group[data-family='children']")).toContain('--dynasty-family-end: 24px');
		expect(rule(family, ".dynasty-family-group[data-family='partners']")).toContain('--dynasty-family-end: 76px');
		expect(rule(family, ".dynasty-sheet.is-phone .dynasty-family-group[data-family='children']")).toContain('--dynasty-family-end: 44px');
		expect(rule(family, ".dynasty-sheet.is-phone .dynasty-family-group[data-family='partners']")).toContain('--dynasty-family-end: 92px');
		expect(rule(family, '.dynasty-family-group')).toContain('--dynasty-family-end: 120px');
		expect(rule(family, '.dynasty-sheet.is-phone .dynasty-family-group')).toContain('--dynasty-family-end: 152px');
	});

	it('the width of a group applies to its child rows and to the controls of its parent and partner rows', () => {
		expect(rule(family, ".dynasty-family-row[data-child] > .dynasty-row-chev")).toContain('width: var(--dynasty-family-end)');
		expect(rule(family, '.dynasty-family-row:is([data-parent], [data-partner]) > .dynasty-family-controls')).toContain('min-width: var(--dynasty-family-end)');
	});
});

describe('O-12 and O-33: the choice step', () => {
	const choice = chunk('12-choice-steps.css');

	it('has no main-button rule: every option has the same plain look', () => {
		expect(choice).not.toContain('mod-cta');
		expect(rule(choice, '.dynasty-sheet .dynasty-choice-option')).toContain('border: var(--dynasty-button-edge)');
	});

	it('a phone option has the phone radius of the tokens, and the second line is regular', () => {
		expect(rule(choice, '.dynasty-sheet.is-phone .dynasty-choice-option')).toContain('border-radius: var(--dynasty-radius-button-phone)');
		expect(rule(choice, '.dynasty-choice-detail')).toContain('font-weight: var(--dynasty-weight-normal)');
	});

	it('the phone buttons of the family use the same token, not a literal', () => {
		for (const sel of ['.dynasty-sheet.is-phone .dynasty-btn', '.dynasty-sheet.is-phone .dynasty-icon-btn', '.dynasty-sheet .dynasty-bar button.dynasty-bar-extra']) {
			expect(rule(sheet, sel), sel).toContain('border-radius: var(--dynasty-radius-button-phone)');
		}
	});
});

describe('F01 and F04: the link "Make ID from the name"', () => {
	const id = chunk('27-id-window-picker.css');
	const link = '.dynasty-id-row .dynasty-id-make';
	/** The numbers of a touch rule: tap box height, text line height, and the margin below. */
	const box = (body: string) => ({
		height: Number(/min-height: (\d+)px/.exec(body)![1]),
		line: Number(/line-height: (\d+)px/.exec(body)![1]),
		below: Number(/margin-block: 0 (-?\d+)px/.exec(body)![1]),
	});

	it('on a touch screen and on a phone the text stands at the top of a 44 px box, and the extra height is below it: the box never reaches into the field', () => {
		// The rule inside the media query is indented; the helper reads rules from the start of a line.
		const coarse = id.slice(id.indexOf('@media (pointer: coarse)')).replace(/\n\t/g, '\n');
		for (const body of [rule(coarse, `.dynasty-sheet ${link}`), rule(id, `.dynasty-sheet.is-phone ${link}`)]) {
			const b = box(body);
			expect(b.height).toBeGreaterThanOrEqual(44);
			// No margin above and a top-aligned text: the top of the box is the top of the text, which stands the gap of the row (4 px) under the field.
			expect(body).not.toMatch(/margin-block: -/);
			expect(body).toContain('align-items: flex-start');
			expect(body).toContain('display: flex');
			// The margin box is the text line, so the space below the link does not grow: 44 - 22 = 22 of box below the text, taken back by the margin.
			expect(b.height + b.below).toBe(b.line);
			// The box keeps above the help text that it overlaps.
			expect(body).toContain('position: relative');
		}
	});

	it('the link has the control size and the ring of "Add portrait or arms": 6 px inside the ring, taken back at the start', () => {
		const body = rule(id, `.dynasty-sheet ${link}`);
		expect(body).toContain('font-size: var(--dynasty-type-control)');
		expect(body).toContain('padding: 0 6px');
		expect(body).toContain('margin-inline-start: -6px');
		expect(rule(sheet, '.dynasty-sheet .dynasty-openall button.dynasty-link')).toContain('padding: 0 6px');
	});
});

describe('the rest of the person, partnership and small windows', () => {
	it('a radio on a phone (C1-03) is a round mark, not a 44 px capsule', () => {
		const body = rule(sheet, ".dynasty-sheet.is-phone input[type='radio']");
		expect(body).toContain('min-height: 0');
		expect(body).toContain('border-radius: 50%');
	});

	it('the phone bar buttons stay on the first title line', () => {
		expect(rule(sheet, '.dynasty-sheet.is-phone .dynasty-bar')).toContain('align-items: flex-start');
	});

	it('the first text line of a phone bar title stands level with the words of Cancel and Save', () => {
		expect(rule(sheet, '.dynasty-sheet.is-phone .dynasty-bar .dynasty-bar-title')).toContain('padding-top: calc((44px - 1lh) / 2)');
	});

	it('the first group heading of a section starts at the top of the body, and the "+ Add" link gives 5 px back on a computer', () => {
		expect(rule(sheet, '.dynasty-section-body > .dynasty-sub-row:first-child')).toContain('margin-top: 0');
		expect(rule(sheet, '.dynasty-sheet button.dynasty-add-link')).toContain('margin-block: -5px');
		// A touch screen keeps its own rule, which comes later and has the same weight.
		expect(sheet.indexOf('margin-block: -9px')).toBeGreaterThan(sheet.indexOf('margin-block: -5px'));
	});

	it('Move earlier and Move later stand 8 px apart', () => {
		expect(rule(sheet, '.dynasty-row-actions.dynasty-move-actions')).toContain('gap: var(--dynasty-space-2)');
	});

	it('the chip chevron is 12 px again, so the type chip gives back 4 px of its width', () => {
		expect(rule(sheet, '.dynasty-chip-select')).toContain('--dynasty-chip-icon: 12px');
		expect(rule(sheet, '.dynasty-sheet .dynasty-chip-select select.dynasty-family-select')).toContain('padding: 0 calc(var(--dynasty-chip-icon) + var(--dynasty-space-2)) 0 var(--dynasty-space-2)');
		expect(rule(sheet, '.dynasty-chip-chevron .svg-icon')).toContain('width: var(--dynasty-chip-icon)');
	});

	it('there are 16 px under the title of the partnership, ID and choice windows', () => {
		expect(rule(sheet, ':is(.dynasty-union-edit, .dynasty-id-window, .dynasty-choice) .dynasty-sheet-title.dynasty-title + .dynasty-sheet-body')).toContain('padding-top: var(--dynasty-space-4)');
		const union = rule(sheet, '.dynasty-union-edit .dynasty-union-title');
		// The body has a gap of 12 px; 4 px of margin make 16.
		expect(union).toContain('margin-bottom: var(--dynasty-space-1)');
	});

	it('the parts of a summary are inline on a computer (the ellipsis works inside a part) and units on a phone (K-10)', () => {
		expect(rule(sheet, '.dynasty-section-sum .dynasty-jitem')).toContain('display: inline');
		expect(rule(sheet, '.dynasty-sheet.is-phone .dynasty-section-sum .dynasty-jitem')).toContain('display: inline-block');
	});
});

describe('the ID window (O-11)', () => {
	const id = chunk('27-id-window-picker.css');

	it('the link has no box: it is a link under the field; the old side label and the full-width box are gone', () => {
		expect(id).not.toContain('.dynasty-id-field {');
		expect(id).not.toMatch(/\.dynasty-id-make \{[^}]*width: 100%/);
		expect(rule(id, '.dynasty-sheet .dynasty-id-row .dynasty-id-make')).toContain('align-self: flex-start');
	});

	it('the reason is styled by the shared error rule, not by a rule of its own', () => {
		expect(id).not.toContain('.dynasty-id-problem');
		expect(id).not.toContain("[aria-invalid='true']");
	});
});

describe('CX-09 and CX-08: icons and spacing come from the tokens in this chunk', () => {
	it('no icon size is a literal in the window chunk', () => {
		expect(sheet).not.toMatch(/\.svg-icon \{[^}]*(width|height): \d+px/);
	});

	it('a window chunk uses no `--size-4-` variable of Obsidian: the scale is the tokens', () => {
		for (const f of ['10-edit-sheet.css', '11-sheet-family.css', '12-choice-steps.css', '14-undo-notice.css', '19-sheet-relation.css']) expect(chunk(f), f).not.toContain('--size-4-');
	});
});
