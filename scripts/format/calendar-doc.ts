/*
 * The text of the section "The calendar note" of `docs/format.md` (spec §14 rule 2): the `kin-calendar` block. The keys of this block are not keys of the tree text, so they
 * are not in the key table of `keys.ts`; `render.ts` puts these lines in the document. The keys of the block are listed here and checked against the code by
 * `tests/dates43-format-doc.test.ts`.
 */

/** The keys of the block, in the write order of `core/calendar-block.ts`. */
export const CALENDAR_KEYS: readonly { scope: string; key: string; meaning: string; accepts: string; written: string }[] = [
	{ scope: 'block', key: 'calendars', meaning: 'The list of calendars of this block.', accepts: 'A list of maps. Any other shape gives a warning and the plugin ignores the block.', written: 'A block list.' },
	{ scope: 'block', key: 'plain', meaning: 'The name lists of the plain years, in a map with the key `lists`. A block with only this key is a calendar note.', accepts: 'A map. A list that the plugin cannot use gives a warning, and the plugin ignores it.', written: 'A block map.' },
	{ scope: 'calendar', key: 'name', meaning: 'The name of the calendar. The grey line and the test line show it.', accepts: 'Text. A calendar with no name is not used.', written: 'Plain text, in double quotes if plain YAML would read it as another value.' },
	{ scope: 'calendar', key: 'kind', meaning: 'The kind of the calendar.', accepts: '`cycles` or `eras`, in any case. Any other word: the plugin ignores the calendar and gives a warning.', written: 'Plain text.' },
	{ scope: 'calendar', key: 'length', meaning: 'Cycle calendar: the number of years in one cycle.', accepts: 'A whole number, 1 or more.', written: 'Plain number.' },
	{ scope: 'calendar', key: 'start', meaning: 'Cycle calendar: the plugin year of Year 1 of Cycle 1. The Calendars window works this number out from "Same year as". With no number, the start is 1.', accepts: 'A whole number, also below 1.', written: 'Plain number.' },
	{ scope: 'calendar', key: 'formats', meaning: 'The ways in which a date of this calendar is written. A cycle format needs `{year}` and `{cycle}` one time each. An era format needs `{year}` and `{era}` one time each.', accepts: 'A list of texts, or one text. Case and extra spaces do not matter. A format can be part of a longer text.', written: 'A flow list on one line, each format in double quotes.' },
	{ scope: 'calendar', key: 'eras', meaning: 'Era calendar: the eras, each with its own start.', accepts: 'A list of maps.', written: 'A block list. Each era is a map on one line.' },
	{ scope: 'calendar', key: 'lists', meaning: 'The name lists of this calendar, at most 4. A name list gives each year a name that repeats, for example a planet. A format can show the name with the marker of the list.', accepts: 'A list of maps. A list that the plugin cannot use gives a warning, and the plugin ignores it.', written: 'A block list of maps.' },
	{ scope: 'era', key: 'name', meaning: 'The name of the era. The same name in two eras is not allowed.', accepts: 'Text.', written: 'Plain text.' },
	{ scope: 'era', key: 'start', meaning: 'The plugin year of Year 1 of this era.', accepts: 'A whole number, also below 1.', written: 'Plain number.' },
	{ scope: 'era', key: 'length', meaning: 'The number of years of the era. A date after the last year gives a warning. With no length, the era has no end.', accepts: 'A whole number, 1 or more.', written: 'Plain number.' },
	{ scope: 'list', key: 'name', meaning: 'The name of the list. A list name can be the same in two calendars. The grey line shows it.', accepts: 'Text. A list with no name is not used.', written: 'Plain text.' },
	{ scope: 'list', key: 'marker', meaning: 'The place name that a format uses for this list, for example `planet` for `{planet}`. It has 1 to 24 letters, digits or hyphens and starts with a letter. It is not `year`, `cycle` or `era`. The plain years have no marker.', accepts: 'Text. The plugin accepts curly brackets around it.', written: 'Plain text, with no curly brackets.' },
	{ scope: 'list', key: 'names', meaning: 'The names, in order. Each name has an optional short form. The names repeat, one for each year.', accepts: 'A list of 1 to 60 maps with `name` and `short`, or a list of texts. A name and a short form have 1 to 40 characters.', written: 'A block list. Each name is a map on one line.' },
	{ scope: 'list', key: 'known', meaning: 'One year with its name: the plugin year and the place of its name in `names`, counted from 0.', accepts: 'A map with `year` (a whole number) and `index` (a whole number below the number of names).', written: 'A map on one line.' },
	{ scope: 'list', key: 'show', meaning: 'What a card shows after a date: the short form, the full name or nothing.', accepts: '`short`, `full` or `none`. Any other value, or no value, is `short`.', written: 'Plain text.' },
];

const cell = (text: string) => text.replace(/\|/g, '\\|');

/** The lines of the section. */
export function calendarDoc(): string[] {
	return [
		'## The calendar note',
		'',
		'The calendars of your own world are not in the tree text. They are in a normal note, in a code block with the language `kin-calendar` (the block of a tree has the language `kin`). The Calendars window writes this note. You can also edit it by hand. The plugin changes only the text lines that must change, and it keeps your comments and the keys that it does not know, as in a tree.',
		'',
		'```kin-calendar',
		'calendars:',
		'  - name: The Long Count',
		'    kind: cycles',
		'    length: 60',
		'    start: 1',
		'    formats: ["{cycle}.{year} {planet}", "{year} Year of the {cycle} Cycle"]',
		'    lists:',
		'      - name: Planets',
		'        marker: planet',
		'        names:',
		'          - {name: Saturn, short: Sa}',
		'          - {name: Jupiter, short: Ju}',
		'          - {name: Mars, short: Ma}',
		'        known: {year: 1273, index: 0}',
		'        show: short',
		'  - name: Reign names',
		'    kind: eras',
		'    formats: ["{year} Year of the {era}", "{era} {year}"]',
		'    eras:',
		'      - {name: Qinglong Emperor, start: 130, length: 11}',
		'      - {name: Jianwen Emperor, start: 141}',
		'plain:',
		'  lists:',
		'    - name: Planets',
		'      names:',
		'        - {name: Saturn, short: Sa}',
		'        - {name: Jupiter, short: Ju}',
		'        - {name: Mars, short: Ma}',
		'      known: {year: 1273, index: 0}',
		'      show: short',
		'```',
		'',
		'- A note can hold several blocks, and a block can hold several calendars. The plugin makes the note `Calendars` at the root of the vault the first time you save in the Calendars window.',
		'- The plugin counts every year on one scale of whole years (the plain years). A plain year 1210 is year 1210. The number `start` gives the plain year of Year 1 of a calendar. The window works it out from an example: "Year 21 of Cycle 3 is the same year as 1203". So a calendar never depends on another calendar.',
		'- A tree uses every calendar note of the vault. If the tree has the key `calendar` in `options`, it uses only that note. The item "Calendar note" in the More list writes this key.',
		'- A date that fits a format gets the year of the calendar. A date that fits no format is read as a plain year, as before. A date that fits two calendars with different years gets no year.',
		'- A name list gives each year a name that repeats. The plugin shows the name after a short date, for example "22.13 Sa". It never writes the name into your note. If a date holds a name that is wrong for its year, the plugin keeps the year of the date and gives a warning. A format can hold the marker of a list, for example `{planet}`. The part of the format with the marker is optional: the date still reads with no name.',
		'- The plugin never changes the text of a date. It reads the text to find a year, and it shows the date as you wrote it.',
		'- A plugin version before 0.3.2 shows the block as plain code. It reads a date in a calendar as a plain year: a date with no run of three or four digits has no year, and a date such as "Third Age 3019" gives the wrong year 3019, with no note. A device whose calendar note has not synced yet reads dates in the same way. If you delete the calendar note, such dates have no year until you add the calendars again.',
		'- A plugin version before 0.3.3 does not know name lists. It keeps the calendar and its other formats, and it ignores a format that holds a marker, with no warning. A calendar whose only format holds a marker reads no date there. Its Calendars window refuses to save the note until you remove the marker format. To let old devices read your dates, use formats with no marker, for example `{cycle}.{year}` (a marker format next to its own form with no marker is refused as the same format). The names still show in 0.3.3 with such formats, but a name written in such a date is not read or checked.',
		'',
		'| Level | Key | Meaning | Accepted forms | Written form |',
		'|---|---|---|---|---|',
		...CALENDAR_KEYS.map((k) => `| ${k.scope} | \`${k.key}\` | ${cell(k.meaning)} | ${cell(k.accepts)} | ${cell(k.written)} |`),
		'',
		'Write order of a calendar: `name`, `kind`, `length`, `start`, `formats`, `eras`, `lists`. Write order of an era: `name`, `start`, `length`. Write order of a name list: `name`, `marker`, `names`, `known`, `show`.',
		'',
	];
}
