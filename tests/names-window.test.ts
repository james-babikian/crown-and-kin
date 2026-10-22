import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { CALENDAR_WINDOW_UI as T } from '../src/render/calendar-text';
import { FEl, device, dispatch, fakeDoc, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { addKind as addKindWith, calField, control, isOpen, openWindow, press, saveWindow, summaryOf, typeInto } from './support/calendar-window-app';
import { cycleNote, eraNote } from './support/calendar-vault';

/*
 * Spec §14 rule 16 (WP-6 step 3): the Calendars window with folding sections, the list editor, the plain years, and the refusals that open their section. The real window on a fake
 * vault. The look (44 px targets, light and dark) is checked in the harness, not here.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const addKind = (c: FEl, kind: 'cycles' | 'eras') => addKindWith(c, kind, { cycles: T.kindCycles, eras: T.kindEras });

const NAMES = `        names:
          - {name: Saturn, short: Sa}
          - {name: Jupiter, short: Ju}
          - {name: Mars, short: Ma}
          - {name: Sun, short: Su}
          - {name: Venus, short: Ve}
          - {name: Mercury, short: Me}
          - {name: Moon, short: Mo}
`;

/** The Long Count with a list of planets, and plain years with a list: Cycle 22, Year 13 is year 1273. Comments and an unknown key stay. */
const LISTED = `# Calendars

\`\`\`kin-calendar
# the calendars of the Far Land
calendars:
  - name: The Long Count
    kind: cycles
    length: 60
    start: 1 # Cycle 1, Year 1
    colour: red
    formats: ["{cycle}.{year} {planet}", "{year} Year of the {cycle} Cycle"]
    lists:
      - name: Planets # the seven planets
        marker: planet
${NAMES}        known: {year: 1273, index: 0}
        show: short
plain:
  lists:
    - name: Planets
      names:
        - {name: Saturn, short: Sa}
        - {name: Jupiter, short: Ju}
      known: {year: 1273, index: 0}
      show: full
\`\`\`
`;

/** Two calendars: the cycle calendar of `LISTED` and the era calendar of the samples. */
const TWO = `${LISTED}\n${eraNote()}`;

const sections = (c: FEl): string[] => c.querySelectorAll('.dynasty-section').map((s) => s.getAttribute('data-section') ?? '');

describe('the sections of the Calendars window (§14 rule 16)', () => {
	it('with one calendar, the calendar opens and "Plain years" is closed; the summary is a line with the kind, the length, the formats and the lists', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const keys = sections(c);
		expect(keys).toHaveLength(2);
		expect(isOpen(c, keys[0])).toBe(true);
		expect(isOpen(c, 'plain')).toBe(false);
		expect(summaryOf(c, keys[0])).toBe('Cycle calendar · 60 years in a cycle · 2 formats · Name list: Planets');
		expect(summaryOf(c, 'plain')).toBe('Name list: Planets');
		expect(c.querySelector(`[data-section="${keys[0]}"] .dynasty-section-title`)?.getText()).toBe('The Long Count');
	});

	it('with two calendars, all sections are closed, and the top row has "Add calendar" and "Open all"', async () => {
		const o = await open2();
		const c = o.win.contentEl;
		for (const key of sections(c)) expect(isOpen(c, key)).toBe(false);
		const row = c.querySelector('.dynasty-openall')!;
		expect(row.querySelector('.dynasty-add-calendar')?.getText()).toBe(T.addCalendar);
		expect(row.children[0].hasClass('dynasty-add-calendar')).toBe(true);
		const all = row.querySelector('.dynasty-openall-button')!;
		expect(all.getText()).toBe('Open all');
		dispatch(all, 'click');
		for (const key of sections(c)) expect(isOpen(c, key)).toBe(true);
		expect(row.querySelector('.dynasty-openall-button')!.getText()).toBe('Close all');
		// The era calendar's summary lists its eras, with no format count.
		const era = sections(c)[1];
		expect(summaryOf(c, era)).toBe('Era calendar · Qinglong Emperor · No name list');
	});

	it('"Open all" reads "Open all" again when one section is closed', async () => {
		const o = await open2();
		const c = o.win.contentEl;
		const row = c.querySelector('.dynasty-openall')!;
		dispatch(row.querySelector('.dynasty-openall-button')!, 'click');
		dispatch(c.querySelector(`[data-section="plain"] .dynasty-section-head`)!, 'click');
		expect(isOpen(c, 'plain')).toBe(false);
		expect(row.querySelector('.dynasty-openall-button')!.getText()).toBe('Open all');
	});

	it('the open state of one window does not reach the next window', async () => {
		const o = await open2();
		dispatch(o.win.contentEl.querySelector(`[data-section="plain"] .dynasty-section-head`)!, 'click');
		expect(isOpen(o.win.contentEl, 'plain')).toBe(true);
		const next = await open2();
		expect(isOpen(next.win.contentEl, 'plain')).toBe(false);
	});

	it('the title and the summary follow what the user types', async () => {
		const o = await open2();
		const c = o.win.contentEl;
		const key = sections(c)[0];
		typeInto(c, `${key}-name`, 'The Count');
		typeInto(c, `${key}-length`, '1');
		expect(c.querySelector(`[data-section="${key}"] .dynasty-section-title`)?.getText()).toBe('The Count');
		expect(summaryOf(c, key)).toBe('Cycle calendar · 1 year in a cycle · 2 formats · Name list: Planets');
		typeInto(c, `${key}-name`, '');
		expect(c.querySelector(`[data-section="${key}"] .dynasty-section-title`)?.getText()).toBe(T.kindCycles);
	});
});

const open2 = () => openWindow({ 'Calendars.md': TWO });

describe('the empty window', () => {
	it('a vault with no calendar shows the long text and two buttons, and the section "Plain years" only', async () => {
		const o = await openWindow({ 'other.md': 'text' });
		const c = o.win.contentEl;
		expect(c.querySelector('.dynasty-cal-intro')?.getText()).toBe(T.intro);
		expect(c.querySelector('.dynasty-cal-add-cycles')?.getText()).toBe(T.addCycles);
		expect(c.querySelector('.dynasty-cal-add-eras')?.getText()).toBe(T.addEras);
		expect(sections(c)).toEqual(['plain']);
		expect(c.querySelector('.dynasty-openall')).toBeNull();
		expect(c.querySelector('.dynasty-cal-add')?.hidden).toBe(false);
	});

	it('the first calendar replaces the buttons by the top row, opens, and takes the focus in Name', async () => {
		const o = await openWindow({ 'other.md': 'text' });
		const c = o.win.contentEl;
		await press(c, '.dynasty-cal-add-cycles');
		const keys = sections(c);
		expect(keys).toHaveLength(2);
		expect(isOpen(c, keys[0])).toBe(true);
		expect(fakeDoc.activeElement).toBe(calField(c, `${keys[0]}-name`));
		expect(c.querySelector('.dynasty-cal-intro')?.getText()).toBe(T.introShort);
		expect(c.querySelector('.dynasty-cal-add')?.hidden).toBe(true);
		expect(c.querySelector('.dynasty-add-calendar')).not.toBeNull();
		// The title of a calendar with no name is its kind, and a new calendar shows its help.
		expect(c.querySelector(`[data-section="${keys[0]}"] .dynasty-section-title`)?.getText()).toBe(T.kindCycles);
		expect(c.querySelector(`[data-section="${keys[0]}"] .is-new`)).not.toBeNull();
		// A calendar that was just added shows no red text for its empty fields; the first Save shows them.
		expect(c.querySelector('[data-refusal]')).toBeNull();
		await saveWindow(c);
		expect(c.querySelector(`[data-section="${keys[0]}"] [data-refusal]`)).not.toBeNull();
		expect(calField(c, `${keys[0]}-name`).getAttribute('aria-invalid')).toBe('true');
	});
});

describe('Add and Remove keep the place and the open state', () => {
	it('a new calendar opens with the focus in Name; the others keep their state', async () => {
		const o = await open2();
		const c = o.win.contentEl;
		const first = sections(c)[0];
		dispatch(c.querySelector(`[data-section="${first}"] .dynasty-section-head`)!, 'click');
		await addKind(c, 'eras');
		const keys = sections(c);
		expect(keys).toHaveLength(4);
		expect(isOpen(c, first)).toBe(true);
		expect(isOpen(c, keys[1])).toBe(false);
		expect(isOpen(c, keys[2])).toBe(true);
		expect(keys[3]).toBe('plain');
		expect(fakeDoc.activeElement).toBe(calField(c, `${keys[2]}-name`));
	});

	it('"Add era" and "Add name list" put the focus in the new name field, and the scroll place stays', async () => {
		const o = await openWindow({ 'Calendars.md': eraNote() });
		const c = o.win.contentEl;
		const body = c.querySelector('.dynasty-sheet-body')!;
		body.scrollTop = 240;
		await press(c, '.dynasty-cal-add-era');
		expect(body.scrollTop).toBe(240);
		const eras = c.querySelectorAll('.dynasty-cal-era');
		expect(eras).toHaveLength(2);
		const field = fakeDoc.activeElement!;
		expect(field.getAttribute('data-focus')).toMatch(/^cal:era-\d+-name$/);
		expect(eras[1].contains(field)).toBe(true);
		await press(c, '.dynasty-cal-add-list');
		expect(body.scrollTop).toBe(240);
		expect(fakeDoc.activeElement!.getAttribute('data-focus')).toMatch(/^cal:list-\d+-name$/);
		expect(isOpen(c, sections(c)[0])).toBe(true);
	});

	it('Remove this calendar stands last in the section, removes the calendar and keeps the other sections as they stood', async () => {
		const o = await open2();
		const c = o.win.contentEl;
		const [first, second] = sections(c);
		dispatch(c.querySelector(`[data-section="${second}"] .dynasty-section-head`)!, 'click');
		const body = c.querySelector(`[data-section="${first}"] .dynasty-section-body`)!;
		const last = body.children[body.children.length - 1];
		expect(last.getText()).toBe(T.removeThisCalendar);
		expect(last.hasClass('dynasty-link')).toBe(true);
		await press(c, `[data-focus="cal:remove:${first}"]`);
		expect(sections(c)).toEqual([second, 'plain']);
		expect(isOpen(c, second)).toBe(true);
		await saveWindow(c);
		expect(o.index.calendarsOf('Calendars.md').map((k) => k.name)).toEqual(['Reign names']);
	});

	it('Remove of a list stands in the first row of the list (the style sheet puts it at the right end) and removes only that list', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const remove = c.querySelector('.dynasty-cal-list .dynasty-cal-remove-list')!;
		expect(remove.getText()).toBe(T.remove);
		// After the fields, so the Tab key reaches it last; the name of the list is the first field of the row.
		const siblings = remove.parentElement!.children;
		expect(siblings[siblings.length - 1]).toBe(remove);
		expect(remove.parentElement?.children[0].querySelector('label')?.getText()).toBe(T.listName);
		dispatch(remove, 'click');
		expect(c.querySelectorAll('.dynasty-cal-list')).toHaveLength(1);
		expect(summaryOf(c, sections(c)[0])).toContain(T.summaryNoLists);
	});
});

describe('the list editor (§14 rule 16)', () => {
	it('has Name of the list, Marker with its braces, the names as text lines, the known year with its read-back, and "Show on cards"', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const l = c.querySelector('.dynasty-cal-list')!;
		const key = l.getAttribute('data-list');
		expect(calField(l, `list-${key}-name`).value).toBe('Planets');
		expect(calField(l, `list-${key}-marker`).value).toBe('{planet}');
		expect(calField(l, `list-${key}-names`).value.split('\n')[0]).toBe('Saturn, Sa');
		expect(calField(l, `list-${key}-known`).value).toBe('22.13');
		expect(calField(l, `list-${key}-knownname`).value).toBe('Saturn');
		expect(l.querySelector(`[data-readback="list-${key}"]`)?.getText()).toBe('22.13 = year 1273. The name of this year is Saturn. The names repeat every 7 years.');
		const show = calField(l, `list-${key}-show`);
		expect(show.value).toBe('short');
		expect(show.querySelectorAll('option').map((x) => x.getText())).toEqual([T.showShort, T.showFull, T.showNone]);
	});

	it('the plain years have a list with no marker', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const plain = o.win.contentEl.querySelector('[data-section="plain"]')!;
		expect(plain.querySelector('.dynasty-cal-list')).not.toBeNull();
		expect(plain.querySelectorAll('input').map((i) => i.getAttribute('data-focus')).filter((f) => f?.endsWith('-marker'))).toEqual([]);
		expect(plain.querySelector('[data-readback]')?.getText()).toBe('The name of year 1273 is Saturn. The names repeat every 2 years.');
	});

	it('the help text of a field is a child of its row with the class is-on-focus, so the style sheet shows it only while the cursor is in the field', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const l = c.querySelector('.dynasty-cal-list')!;
		const names = calField(l, `list-${l.getAttribute('data-list')}-names`).parentElement!;
		expect(names.hasClass('dynasty-sheet-field')).toBe(true);
		const help = names.querySelector('.dynasty-sheet-hint.is-on-focus')!;
		expect(help.getText()).toBe(T.namesHint);
		expect(help.parentElement).toBe(names);
		expect(calField(l, `list-${l.getAttribute('data-list')}-names`).getAttribute('aria-describedby')).toContain(help.getAttribute('id'));
		// The known year is a group: its help is a child of the group, which the style sheet shows while any field of the group has the cursor.
		const known = l.querySelector('.dynasty-cal-start')!;
		expect(known.querySelector('.dynasty-sheet-hint.is-on-focus')?.getText()).toBe(T.knownHint);
	});

	it('writes the known year as a date and the read-back follows; a wrong date or name says so', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const key = c.querySelector('.dynasty-cal-list')!.getAttribute('data-list');
		const back = () => c.querySelector(`[data-readback="list-${key}"]`)!.getText();
		typeInto(c, `list-${key}-known`, '22.14');
		typeInto(c, `list-${key}-knownname`, 'jupiter');
		expect(back()).toBe('22.14 = year 1274. The name of this year is Jupiter. The names repeat every 7 years.');
		typeInto(c, `list-${key}-known`, 'at dawn');
		expect(back()).toBe(T.knownDateBad);
		typeInto(c, `list-${key}-known`, '22.14');
		typeInto(c, `list-${key}-knownname`, 'Pluto');
		expect(back()).toBe(T.knownNameBad);
	});

	it('keeps the name on the date after a change of Start, and saves the new internal year', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const key = sections(c)[0];
		typeInto(c, `${key}-same`, '1000');
		typeInto(c, `${key}-cycle`, '1');
		typeInto(c, `${key}-year`, '1');
		const back = c.querySelector('.dynasty-cal-list [data-readback]')!.getText();
		expect(back).toContain('22.13 = year 2272.');
		await saveWindow(c);
		const list = o.index.calendarsOf('Calendars.md')[0].lists![0];
		expect(list.known).toEqual({ year: 2272, index: 0 });
		expect(o.notes.get('Calendars.md')).toContain('start: 1000');
	});
});

describe('Save with lists', () => {
	it('writes a changed list and a new plain-year list, and keeps the comments and the unknown key', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const key = c.querySelector('.dynasty-cal-list')!.getAttribute('data-list');
		typeInto(c, `list-${key}-names`, 'Saturn, Sa\nJupiter, Ju\nMars, Ma');
		// The marker is accepted with its curly brackets and written without them.
		typeInto(c, `list-${key}-marker`, '{star}');
		const show = calField(c, `list-${key}-show`);
		show.value = 'none';
		dispatch(show, 'change');
		typeInto(c, `${sections(c)[0]}-formats`, '{cycle}.{year} {star}\n{year} Year of the {cycle} Cycle');
		await press(c, '[data-section="plain"] .dynasty-cal-add-list');
		const added = c.querySelectorAll('[data-section="plain"] .dynasty-cal-list')[1];
		const id = added.getAttribute('data-list');
		typeInto(c, `list-${id}-name`, 'Animals');
		typeInto(c, `list-${id}-names`, 'Rat\nOx');
		typeInto(c, `list-${id}-known`, '1273');
		typeInto(c, `list-${id}-knownname`, 'Rat');
		await saveWindow(c);
		expect(openModals).toHaveLength(0);
		const text = o.notes.get('Calendars.md')!;
		expect(text).toContain('# the calendars of the Far Land');
		expect(text).toContain('# Cycle 1, Year 1');
		expect(text).toContain('# the seven planets');
		expect(text).toContain('colour: red');
		expect(text).toContain('marker: star');
		expect(text).toContain('show: none');
		const cal = o.index.calendarsOf('Calendars.md')[0];
		expect(cal.lists?.[0].names).toHaveLength(3);
		expect(cal.formats[0]).toBe('{cycle}.{year} {star}');
		expect(text).toMatch(/plain:\n {2}lists:\n {4}- name: Planets[\s\S]*- name: Animals/);
	});

	it('Save with no change writes nothing, also with lists that the window shows', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const before = o.notes.get('Calendars.md');
		await saveWindow(o.win.contentEl);
		expect(o.notes.get('Calendars.md')).toBe(before);
	});

	it('a note with a calendar and no key plain gets the key with the first plain list', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		await press(c, '[data-section="plain"] .dynasty-cal-add-list');
		const id = c.querySelector('[data-section="plain"] .dynasty-cal-list')!.getAttribute('data-list');
		typeInto(c, `list-${id}-name`, 'Animals');
		typeInto(c, `list-${id}-names`, 'Rat\nOx');
		typeInto(c, `list-${id}-known`, '1273');
		typeInto(c, `list-${id}-knownname`, 'Ox');
		await saveWindow(c);
		expect(o.notes.get('Calendars.md')).toContain('plain:');
		expect(o.notes.get('Calendars.md')).toContain('# Calendars');
		expect(o.notes.get('Calendars.md')).toMatch(/name: Animals/);
	});
});

describe('a refusal opens the section that holds it (§14 rule 16)', () => {
	it('an era name twice opens the calendar that holds it, and no other section', async () => {
		const o = await open2();
		const c = o.win.contentEl;
		const [, second] = sections(c);
		await press(c, `[data-section="${second}"] .dynasty-cal-add-era`);
		const era = c.querySelectorAll(`[data-section="${second}"] .dynasty-cal-era`)[1].getAttribute('data-era');
		typeInto(c, `era-${era}-name`, 'Qinglong Emperor');
		expect(isOpen(c, second)).toBe(false);
		await saveWindow(c);
		expect(isOpen(c, second)).toBe(true);
		expect(c.querySelector(`[data-section="${second}"] [data-refusal]`)).not.toBeNull();
		expect(isOpen(c, sections(c)[0])).toBe(false);
	});

	it('a cross-calendar duplicate of a cycle format opens the later calendar, and the top line names the other', async () => {
		const o = await openWindow({ 'Calendars.md': `${cycleNote()}\n${cycleNote('Second', '{year} of {cycle}')}` });
		const c = o.win.contentEl;
		const [first, second] = sections(c);
		typeInto(c, `${second}-formats`, '{year} year of the {cycle} cycle');
		expect(isOpen(c, second)).toBe(false);
		await saveWindow(c);
		expect(isOpen(c, second)).toBe(true);
		expect(isOpen(c, first)).toBe(false);
		expect(c.querySelector('.dynasty-sheet-error')?.getText()).toBe(T.refusalSummary(1));
		expect(c.querySelector(`[data-section="${second}"] [data-refusal]`)?.getText()).toContain('“The Long Count”');
	});

	it('a refusal in "Plain years" opens that section', async () => {
		const o = await openWindow({ 'Calendars.md': TWO });
		const c = o.win.contentEl;
		const id = c.querySelector('[data-section="plain"] .dynasty-cal-list')!.getAttribute('data-list');
		typeInto(c, `list-${id}-name`, '');
		expect(isOpen(c, 'plain')).toBe(false);
		await saveWindow(c);
		expect(isOpen(c, 'plain')).toBe(true);
		const row = calField(c, `list-${id}-name`).parentElement!;
		expect(row.querySelector('.dynasty-cal-field-error')?.getText()).toContain('the plain years');
		expect(openModals).toHaveLength(1);
	});

	it('a refusal of a list in a calendar stands under its field, and writes nothing', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		const before = o.notes.get('Calendars.md');
		const key = c.querySelector('.dynasty-cal-list')!.getAttribute('data-list');
		typeInto(c, `list-${key}-marker`, '{year}');
		await saveWindow(c);
		expect(o.notes.get('Calendars.md')).toBe(before);
		const row = calField(c, `list-${key}-marker`).parentElement!;
		expect(row.querySelector('[data-refusal]')).not.toBeNull();
		expect(calField(c, `list-${key}-marker`).getAttribute('aria-invalid')).toBe('true');
	});
});

describe('one "Test a date" field (§14 rules 15 and 16)', () => {
	it('stands under all sections, reads with the draft, and names the year with the full names', async () => {
		const o = await openWindow({ 'Calendars.md': LISTED });
		const c = o.win.contentEl;
		expect(c.querySelectorAll('.dynasty-cal-test')).toHaveLength(1);
		const input = control(c, 'test:all');
		const line = () => c.querySelector('.dynasty-cal-testbox [data-readout]')!.children.map((x) => x.getText()).join(' ');
		input.value = '22.13 Sa';
		dispatch(input, 'input');
		expect(line()).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn.');
		input.value = '22.13 Ju';
		dispatch(input, 'input');
		expect(line()).toBe('The Long Count: Cycle 22, Year 13 = year 1273. In the list Planets, this year is Saturn. The date says Jupiter. The plugin uses the year of the date.');
		// A whole plain year has the line of the plain-year list.
		input.value = '1274';
		dispatch(input, 'input');
		expect(line()).toBe('Planets: Jupiter.');
		// A change of the draft shows at once.
		typeInto(c, `list-${c.querySelector('.dynasty-cal-list')!.getAttribute('data-list')}-name`, 'Wanderers');
		input.value = '22.13';
		dispatch(input, 'input');
		expect(line()).toContain('Wanderers: Saturn.');
	});
});

describe('lists that cannot be used', () => {
	it('shows the issue in the window and still opens it', async () => {
		const text = LISTED.replace('known: {year: 1273, index: 0}\n        show: short', 'known: {year: 1273, index: 9}\n        show: short');
		const o = await openWindow({ 'Calendars.md': text });
		expect(openModals).toHaveLength(1);
		expect(o.win.contentEl.querySelector('.dynasty-cal-issues [data-issue]')?.getText()).toContain('cannot be used');
		// The list is not refused while the user does not change it, and Save writes nothing.
		const before = o.notes.get('Calendars.md');
		await saveWindow(o.win.contentEl);
		expect(o.notes.get('Calendars.md')).toBe(before);
	});
});

describe('a format with a marker that no list has', () => {
	it('shows the issue, the base form still reads, and Save refuses and opens the calendar at its formats', async () => {
		const text = `\`\`\`kin-calendar\ncalendars:\n  - name: Count\n    kind: cycles\n    length: 60\n    start: 1\n    formats: ["{cycle}.{year} {planet}", "{year} of {cycle}"]\n\`\`\`\n`;
		const o = await openWindow({ 'Calendars.md': `${text}\n${eraNote()}` });
		const c = o.win.contentEl;
		expect(c.querySelector('.dynasty-cal-issues [data-issue]')?.getText()).toContain('{planet}');
		const [first] = sections(c);
		expect(isOpen(c, first)).toBe(false);
		const before = o.notes.get('Calendars.md');
		await saveWindow(c);
		expect(o.notes.get('Calendars.md')).toBe(before);
		expect(isOpen(c, first)).toBe(true);
		expect(calField(c, `${first}-formats`).parentElement!.querySelector('[data-refusal]')?.getText()).toContain('{cycle}.{year} {planet}');
	});
});

describe('a phone', () => {
	it('draws the same sections with the phone class', async () => {
		device.coarse = true;
		device.width = 390;
		try {
			const o = await open2();
			expect(o.win.modalEl.hasClass('is-phone')).toBe(true);
			expect(sections(o.win.contentEl)).toHaveLength(3);
			expect(o.win.contentEl.querySelector('.dynasty-add-calendar')).not.toBeNull();
		} finally {
			device.coarse = false;
			device.width = 1280;
		}
	});
});
