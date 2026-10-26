/*
 * The one table behind "Format 1" (spec §4.4, the release plan Part 2 §3): every key of the tree text that the plugin
 * reads or keeps (3 are reserved: kept, never read), with its section, its meaning, the forms it accepts, the form it writes and the version that added it. `render.ts` turns
 * the table into `docs/format.md`, so the document cannot drift from the table. The README shows only a short example and
 * links to the document. `tests/core/format-table.test.ts` checks the table against the code: the write-order lists, the keys
 * that the reader asks for and the words that the readers accept. Meanings are one plain sentence each; users read them.
 */

import { HOUSE_ORDER } from '../../src/core/house-ops';
import { UNION_ORDER } from '../../src/core/relationship-ops';
import { HOLDER_ORDER, TITLE_ORDER } from '../../src/core/title-ops';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES } from '../../src/core/succession-keys';
import { ENDED_BY, PARENT_TYPES, PLACEMENT_TYPES, UNION_TYPES } from '../../src/core/types';
import { OPTION_ORDER, PERSON_ORDER, TOP_ORDER } from '../../src/core/yaml-patch';

/** The parts of a tree text that have keys. `parents` is the map form of one parent entry. */
export type SectionId = 'top' | 'options' | 'houses' | 'titles' | 'holders' | 'people' | 'parents' | 'unions';

/** One key of the table. */
export interface FormatKey {
	section: SectionId;
	key: string;
	/** What the key means, in one plain sentence. */
	meaning: string;
	/** The forms the plugin reads, including the hand-typed forms it accepts without a warning. */
	accepts: string;
	/** The form the plugin writes. */
	written: string;
	/** The plugin version that added the key. "0.1" is the original format. */
	since: string;
	/** Reserved: the plugin keeps the key and never reads it (and never writes it, unless the note has it). */
	reserved?: true;
	/** False when no write-order list of the code names the key (the reader asks for it, the plugin never adds it in a place of its own). */
	listed?: false;
}

/** A part of the tree text: its heading, how it looks in the note and the write-order list of the code. */
export interface FormatSection {
	id: SectionId;
	heading: string;
	where: string;
	order: readonly string[] | undefined;
}

export const SECTIONS: readonly FormatSection[] = [
	{ id: 'top', heading: 'Top level', where: 'The keys at the left edge of the code block. The top level must be a map. If it is not, the plugin shows an error box and no tree.', order: TOP_ORDER },
	{ id: 'options', heading: 'options', where: 'A map under `options:`.', order: OPTION_ORDER },
	{ id: 'houses', heading: 'houses', where: 'A list of maps under `houses:`. One item for each house.', order: HOUSE_ORDER },
	{ id: 'titles', heading: 'titles', where: 'A list of maps under `titles:`. One item for each title.', order: TITLE_ORDER },
	{ id: 'holders', heading: 'holders of a title', where: 'A list under `holders:` in a title. One item for each reign. The first holder is first and the newest holder is last.', order: HOLDER_ORDER },
	{ id: 'people', heading: 'people', where: 'A list of maps under `people:`. One item for each person. The order of the list is the order of brothers and sisters.', order: PERSON_ORDER },
	{ id: 'parents', heading: 'a parent entry', where: 'An item of the list under `parents:` in a person, when it is a map and not a plain ID.', order: undefined },
	{ id: 'unions', heading: 'unions', where: 'A list of maps under `unions:`. One item for each partnership.', order: UNION_ORDER },
];

const LIST_SHAPE = 'A list of maps. Nothing written is an empty list. Any other shape gives a warning and the plugin ignores the section. An item that is not a map gives a warning and the plugin skips it.';
const ID_NOTE = 'A number is read as text. A pair of curly quote marks around the ID is ignored.';
const ID_FORMS = `Text. ${ID_NOTE}`;
// `titles.id` and `people.card-title` are not in `unwrapCurlyKeys` (src/core/tolerate.ts), so the marks stay in the ID.
const NO_CURLY_NOTE = 'A number is read as text. Curly quote marks around the ID are not removed: they stay part of the ID.';
const LINK_FORMS = 'A link to a picture in the vault: [[x.png]], [Alias](x.png) or a plain path, each with or without a leading "!". A link in [[ ]] without quotes is accepted. A web address gives a warning and shows no picture.';
const LINK_WRITTEN = 'In double quotes. The plugin writes the link that Obsidian makes, so it follows your link settings.';
const BOOLEAN_FORMS = '"true" or "yes" in any case is on. Any other text, or no key, is off.';
const BOOLEAN_WRITTEN = '`true`. To turn it off, the plugin removes the key. A text that already means on stays as written.';
const TEXT_WRITTEN = 'Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it.';
const FREE_TEXT = 'Free text. The plugin never reads it as a date.';
// Relation names (D306, D304) read a year in born, died, start and end, but only when the text is one exact year or date.
const YEAR_FORMS = 'Free text. The plugin reads a year in it. Relation names use the year only if the text is one exact year or date, for example 1135 or 12 May 1135. A text such as c. 1135 or before 1135 has no effect on them.';
const RULE_WRITTEN = 'Plain text, one of the current names. The Titles window writes only the keys that you changed. A key that you wrote by hand stays as written.';
const NOT_WRITTEN = 'Typed by hand. No window of the plugin writes it.';

const k = (section: SectionId, key: string, since: string, meaning: string, accepts: string, written: string, extra?: Pick<FormatKey, 'reserved' | 'listed'>): FormatKey => ({
	section,
	key,
	meaning,
	accepts,
	written,
	since,
	...extra,
});

export const KEYS: readonly FormatKey[] = [
	// ---------- Top level ----------
	k('top', 'options', '0.1', 'The settings of this tree: where it opens, the focus, the "This is me" mark and the height.', 'A map. Any other shape gives a warning and the plugin ignores it.', 'Made by the plugin when it must write an option. It goes first. The plugin removes it when it has no key left.'),
	k('top', 'houses', '0.1', 'The list of the houses.', LIST_SHAPE, 'A block list. The plugin makes it when you add the first house.'),
	k('top', 'titles', '0.2', 'The list of the titles and their holders.', LIST_SHAPE, 'A block list. When the plugin makes it, it goes directly after `houses`. With no `houses`, it goes directly before `people`. Otherwise it goes at the end.'),
	k('top', 'people', '0.1', 'The list of the people.', LIST_SHAPE + ' A person with no `id` is still drawn, with a warning.', 'A block list. The plugin adds a person at the end, or beside the person it belongs to.'),
	k('top', 'unions', '0.1', 'The list of the partnerships.', LIST_SHAPE, 'A block list. The plugin adds a partnership at the end.'),

	// ---------- options ----------
	k('options', 'start', '0.1', 'The person that the tree centres on when it opens. If you edited a person in this session, the tree centres on that person instead. The phone list does not use it.', `A person ID. ${ID_NOTE} If no person has this ID, the plugin shows a warning.`, NOT_WRITTEN),
	k('options', 'focus', '0.1', 'The person that the tree shows in focus mode when it opens. "Pin focus here" writes it.', `A person ID. ${ID_NOTE} If no person has this ID, the plugin shows a warning.`, 'Plain text. "Pin focus here" writes it. "Remove pin" removes it.'),
	k('options', 'me', '0.2', 'The person with the mark "This is me". The relation names start from this person.', `A person ID. ${ID_NOTE} A list or a map gives a warning. If no person has this ID, the plugin shows a warning.`, 'Plain text. "This is me" writes it. "Remove This is me" removes it.'),
	k('options', 'generations', '0.1', 'How many generations up and down the tree shows in focus mode.', 'A whole number, 0 or more. Any other text is ignored. With no key, the setting of the plugin counts.', NOT_WRITTEN),
	k('options', 'height', '0.1', 'The height in pixels of the tree in a note, on a computer.', 'A whole number from 100 to 5000. Any other text or number is ignored and the usual height counts. A phone list does not use it.', 'A plain number. The resize handle of the tree writes it.'),
	k('options', 'calendar', '0.3.2', 'The calendar note that this tree uses to read dates. With no key, the tree reads plain years only (no calendar).', 'A link to a note: [[x]], [Alias](x.md) or a plain path. A link in [[ ]] without quotes is accepted. A note that does not exist, or has no calendar, gives a warning and the tree reads dates with no calendar.', 'In double quotes. The item "Calendar note" in the More list writes it. "No calendar" removes it. The Calendars window also writes it when you save calendars in a tree that has no key. The plugin keeps the link up to date when you rename the note.'),
	k('options', 'format', '0.3', 'Reserved for Format 2. The plugin ignores it today, keeps it and never writes it.', 'Any value. The plugin ignores it and keeps it.', 'Never written. A key that is in the note stays as it is.', { reserved: true, listed: false }),

	// ---------- houses ----------
	k('houses', 'id', '0.1', 'The short name that people use in their `house` key.', `${ID_FORMS} A house with no ID is skipped, with a warning. If two houses have the same ID, the first one counts and the plugin warns.`, 'Plain text. The plugin makes the ID of a new house from its name. The ID does not change when you rename the house.'),
	k('houses', 'name', '0.1', 'The name of the house on cards, in the legend and in the Houses window.', 'Text. With no name, the ID is the name.', TEXT_WRITTEN),
	k('houses', 'color', '0.1', 'The colour of the strip on the cards of the house, for example `"#8c2041"`. Write it in quotes. Without quotes, the plugin shows a warning.', 'A hex colour: #rrggbb or #rgb, for example #8b1e3f. Write it in quotes. Without quotes, YAML reads the "#" as the start of a comment, and the plugin shows a warning. Other CSS colours draw on screen today. Format 1 does not promise them; saved pictures use only hex, rgb(), hsl() and named colours.', 'In double quotes, as #rrggbb.'),
	k('houses', 'arms', '0.2', 'A link to the picture of the coat of arms of the house.', LINK_FORMS, LINK_WRITTEN),

	// ---------- titles ----------
	k('titles', 'id', '0.2', 'The short name that `card-title` uses to select this title.', `Text. ${NO_CURLY_NOTE} A title with no ID is skipped, with a warning. If two titles have the same ID, the first one counts and the plugin warns.`, 'Plain text. The plugin makes the ID of a new title from its name.'),
	k('titles', 'name', '0.2', 'The name of the title: the place that the title rules, for example "Duchy of Normandy".', 'Text. With no name, the ID is the name.', TEXT_WRITTEN),
	k('titles', 'male-name', '0.2', 'The name of the title for a holder with `sex: m`, for example "Duke of Normandy".', 'Text. Optional.', TEXT_WRITTEN),
	k('titles', 'female-name', '0.2', 'The name of the title for a holder with `sex: f`, for example "Duchess of Normandy".', 'Text. Optional.', TEXT_WRITTEN),
	k('titles', 'plural', '0.2', 'The name of the list of holders and of the note with the table, for example "Dukes of Valmont".', 'Text. With no key, the name of the title is used.', 'The Titles window does not show it and does not write it. A key that is in the note stays.'),
	k('titles', 'numbering', '0.2', 'Reserved. The plugin keeps the key and never reads it. The plugin does not count the numbers of the holders.', 'Any value. The plugin ignores it and keeps it.', 'The plugin never writes it.', { reserved: true }),
	k('titles', 'count-with', '0.2', 'Reserved. The plugin keeps the key and never reads it.', 'Any value. The plugin ignores it and keeps it.', 'The plugin never writes it.', { reserved: true }),
	k('titles', 'succession', '0.2.7', 'The rule that puts the heirs in order. See "Succession".', 'One of the rule names (see Values), in any case. The old names are also accepted. Another text gives a warning and the title has no line of succession. With no key and no `heir`, the title has no line of succession and the plugin gives no warning. The other succession keys then do nothing.', RULE_WRITTEN),
	k('titles', 'inherit', '0.2.7', 'Who can inherit: men, women, or both with a preference. See "Succession".', 'One of the rule names (see Values), in any case. The old names are also accepted. With no key, `no-preference` counts, but only for a title that has a line of succession. Another text gives a warning and the title has no line of succession.', RULE_WRITTEN),
	k('titles', 'inherit-through', '0.2.7', 'Through whom a claim passes: men, women or anyone. See "Succession".', 'One of `men`, `women` and `anyone`, in any case. The old names `male`, `female` and `any` are also accepted. Another text gives a warning and the title has no line of succession.', RULE_WRITTEN),
	k('titles', 'inherit-illegitimate', '0.2.7', 'Whether children marked as illegitimate can inherit. See "Succession" for the values.', '`no`, `after` or `equal`, in any case. `true` and `yes` mean `after`. `false` means `no`. No key means `no`. Another text gives a warning and the title has no line of succession.', 'Plain text. `no` removes the key. A text that already means the chosen value stays as written.'),
	k('titles', 'inherit-adopted', '0.2.7', 'Whether adopted children can inherit.', BOOLEAN_FORMS, BOOLEAN_WRITTEN),
	k('titles', 'heirs-of-body', '0.2.7', 'Whether only the descendants of the first holder can inherit.', BOOLEAN_FORMS, BOOLEAN_WRITTEN),
	k('titles', 'year', '0.2.7', 'The year that the line of succession is for.', 'Text with a year in it, for example 1210, "c. 1210" or "200 BC". With no key, or no year in it, the line is for the end of the last reign, else for now. A text with no year gives a warning only for a title with `succession` or `heir`.', 'Plain text, as typed.'),
	k('titles', 'heir', '0.2.7', 'The named heirs. They come first in the line of succession, in the order of the list.', `One person ID, or a list of IDs. ${ID_NOTE} An ID that no person has gives a warning and is ignored.`, 'One ID is written as a single value. Several IDs are written as a flow list on one line.'),
	k('titles', 'exclude', '0.2.7', 'The people who are not in the line of succession.', `One person ID, or a list of IDs. ${ID_NOTE} An ID that no person has gives a warning and is ignored.`, 'One ID is written as a single value. Several IDs are written as a flow list on one line.'),
	k('titles', 'holders', '0.2', 'The list of the holders of the title, in the order in which they held it: the first holder first, the newest holder last.', 'A list of holder maps. A holder can be a plain person ID. `holders: aldric` is one holder. A map instead of a list gives a warning and the plugin ignores it.', 'A block list. A new holder is a map on one line.'),

	// ---------- holders ----------
	k('holders', 'person', '0.2', 'The ID of the person who holds the title. If a holder has both `person` and `name`, the plugin uses `person`.', `${ID_FORMS} If no person has this ID, the plugin shows a warning. With a \`name\`, the holder then shows as a holder who is not in the tree.`, 'Plain text. A holder that is a plain ID becomes a map when the plugin changes it.'),
	k('holders', 'name', '0.2', 'The name of a holder who is not in the tree.', 'Text. If `person` and `name` are both written, `person` counts and `name` stays in the note.', TEXT_WRITTEN),
	k('holders', 'as', '0.2', 'The ruler name, when it is not the first word of the name of the person.', 'Text.', TEXT_WRITTEN),
	k('holders', 'number', '0.2', 'The number of the holder, for example "II". The plugin does not count it.', FREE_TEXT, TEXT_WRITTEN),
	k('holders', 'from', '0.2', 'When the reign started.', FREE_TEXT + ' The line of succession reads a year in it.', TEXT_WRITTEN),
	k('holders', 'to', '0.2', 'When the reign ended.', FREE_TEXT + ' The line of succession reads a year in it. The words present, now, current, ongoing, living, alive and reigning mean an open end.', TEXT_WRITTEN),
	k('holders', 'through-spouse', '0.2.8', 'The holder holds the title through a spouse. See "A holder who holds the title through the spouse".', '"true" or "yes" in any case: the plugin finds the spouse. A person ID, with or without curly quote marks: that partner. "false" or "no" is off.', '`true` from the box in the Titles window. An ID that you wrote by hand stays as written.'),

	// ---------- people ----------
	k('people', 'id', '0.1', 'The short name that other keys use to point to this person.', `${ID_FORMS} If two people have the same ID, the plugin shows the tree but does not let you edit it.`, 'Plain text. A new person gets an ID such as p12. The ID does not change when you rename the person.'),
	k('people', 'name', '0.1', 'The name on the card.', 'Text. With no name, the ID is the name.', TEXT_WRITTEN),
	k('people', 'sobriquet', '0.2.4', 'A short extra name, for example "the Wise". The card shows it after the name.', 'Text. One pair of double quote marks around the whole text is ignored. The plugin adds the curly marks on the card.', 'Plain text, directly after `name`.'),
	k('people', 'title', '0.1', 'The text under the name on the card. A person who holds a title also shows the reign after it.', 'Free text. A `card-title` replaces it on the card. The text stays in the note and in the person window. With no text and a title held, the card shows the name of the title.', TEXT_WRITTEN),
	k('people', 'card-title', '0.2', 'The ID of the title that the card shows, with its reign. It replaces a written `title`. It picks one title when the person holds several.', `A title ID. ${NO_CURLY_NOTE} If the person does not hold the title, the plugin shows a warning.`, 'Plain text. "Show on the card" writes it. The plugin removes it when the person loses the last holder entry of that title.'),
	k('people', 'house', '0.1', 'The ID of the house of the person.', `A house ID. ${ID_NOTE} If no house has this ID, the plugin shows a warning.`, 'Plain text.'),
	k('people', 'sex', '0.1', 'Write `m` for a man or `f` for a woman. It sets the look of the card, the order of partners, the relation names and the line of succession. A word such as `male` gives a warning.', 'Any text. Only `m` and `f` (lower case) mean a man and a woman. Any other text is a value of its own, with a neutral card. A spelling such as `male` or `Female` gives a warning, and the plugin does not read it as `m` or `f`.', 'Plain text.'),
	k('people', 'born', '0.1', 'When the person was born. You can write any text. The line of succession, the phone list and the relation names read a year in it.', YEAR_FORMS, TEXT_WRITTEN),
	k('people', 'died', '0.1', 'When the person died. You can write any text. The line of succession, the phone list and the relation names read a year in it.', YEAR_FORMS + ' The words false, no, alive, living and never mean that the person is alive. A doubtful word such as "?" or unknown counts as dead, with a warning.', TEXT_WRITTEN),
	k('people', 'parents', '0.1', 'The parents of the person. Write an ID, or write the keys `id` and `type` for a parent.', 'A list. One entry that is not in a list is accepted. A plain ID is a birth parent. At most 2 parents of one type, and 8 rumoured parents. More gives a warning. The setting "Warn about more than 2 parents of a type" turns off the warning for birth, adoptive and ward parents.', 'A flow list on one line. A block list that you typed keeps its form, and the plugin adds an entry to it. A birth parent is a plain ID. Any other type is a map: `{id: aldric, type: adoptive}`.'),
	k('people', 'placement', '0.1', 'Which parents decide where the card stands: the birth parents, the adoptive parents or the ward parents.', '`birth`, `adoptive` or `ward`, in lower case. Another text gives a warning. A type that the person has no parents of gives a warning, and the plugin chooses itself.', 'Plain text.'),
	k('people', 'illegitimate', '0.1', 'The person was born outside a marriage. Write `illegitimate: true`. The sign is on the line to the birth parents.', BOOLEAN_FORMS, BOOLEAN_WRITTEN),
	k('people', 'childless', '0.2.7', 'The person had no children. Write `childless: true`. The line of succession then shows no open branch for the person.', BOOLEAN_FORMS, BOOLEAN_WRITTEN),
	k('people', 'union', '0.1', 'The ID of the partnership that the person was born in. It is needed only when the parents have more than one partnership.', `A partnership ID. ${ID_NOTE} If it is not a partnership between the parents, the plugin shows a warning.`, 'Plain text. The plugin writes it when it must name one of several partnerships.'),
	k('people', 'link', '0.1', 'A link to the note of the person. On a computer, a click on the name opens the note.', 'A link to a note: [[Note]], [[Note|Alias]], [Alias](Note.md) or a plain note name. A link in [[ ]] without quotes is accepted.', 'In double quotes if plain text would not be read back as the same text. A link in [[ ]] is always in quotes.'),
	k('people', 'portrait', '0.2', 'A link to the portrait picture of the person.', LINK_FORMS, LINK_WRITTEN),
	k('people', 'portrait-crop', '0.2', 'The part of the portrait that the card shows.', 'Three numbers with spaces between them: left, top and side, as fractions of the picture. Anything else gives a warning. The key does nothing without a `portrait`.', 'In double quotes, with 4 decimals at most, for example "0.12 0.05 0.6". The plugin removes it when the portrait changes.'),
	k('people', 'arms', '0.2.8', 'A link to the picture of the coat of arms of the person.', LINK_FORMS, LINK_WRITTEN),
	k('people', 'notes', '0.1', 'Free text about the person. Only the person window shows it.', 'Free text, also on several lines.', TEXT_WRITTEN),

	// ---------- parent entries ----------
	k('parents', 'id', '0.1', 'The ID of the parent.', `${ID_FORMS} An entry with no ID gives a warning and the plugin skips it. If no person has this ID, the plugin shows a warning.`, 'Plain text.', { listed: false }),
	k('parents', 'type', '0.1', 'The kind of the parent: birth, adoptive, ward or rumoured.', '`birth`, `adoptive`, `ward` or `rumoured`, in any case. No type is `birth`. Another text counts as `birth`, with a warning.', 'Not written for a birth parent. For the other types, plain text in a map on one line.', { listed: false }),

	// ---------- unions ----------
	k('unions', 'id', '0.1', 'The short name of the partnership. It is needed only when two partnerships have the same two partners, or when a person uses `union`.', `${ID_FORMS} If two partnerships have the same ID, the plugin shows the tree but does not let you edit it.`, 'Plain text. The plugin adds it only when it must name a partnership.'),
	k('unions', 'partners', '0.1', 'The two people of the partnership.', 'A list of exactly 2 person IDs. One ID that is not in a list is read as a list of one ID. A partnership needs 2, so any other count, one ID too, gives a warning and the plugin skips the partnership. For three people, write one partnership for each pair.', 'A flow list on one line.'),
	k('unions', 'type', '0.1', 'The kind of partnership: marriage, betrothal, concubinage or affair.', 'The four names, in any case. Also `engaged` (betrothal), `mistress`, `lover` and `liaison` (affair) and `concubine` (concubinage). No type is a marriage. Any other word is drawn as a marriage, with a warning only if it is close to a known type.', 'Plain text. The plugin writes `type` for every kind except a marriage. It writes `type: marriage` only for the partnership that it makes when you add a second parent.'),
	k('unions', 'start', '0.1', 'When the partnership started. You can write any text. The relation names read a year in it.', YEAR_FORMS, TEXT_WRITTEN),
	k('unions', 'end', '0.1', 'When the partnership ended. You can write any text. The relation names read a year in it.', YEAR_FORMS, TEXT_WRITTEN),
	k('unions', 'ended-by', '0.5', 'Why a marriage ended: divorce, annulment or death. After a divorce or an annulment, the relation names of the partner and the relatives by marriage have the word "former".', 'One of the values (see Values), in any case. Also `divorced` (divorce) and `annulled` (annulment). Any other text, a list or a map has no effect, and the plugin gives no warning. Only a marriage, or a partnership with its own type word, uses it. With the value `death`, the end year does not make the marriage "former".', 'Plain text, one of the three values. "Not known" removes the key. A text that you wrote by hand and that means the same value stays as written.'),
];

/** The keys of one section, in table order. */
export const keysOf = (section: SectionId): FormatKey[] => KEYS.filter((x) => x.section === section);

// ---------- Values ----------

/** A key with a fixed list of values, and the old or short names that the plugin reads as one of them. */
export interface ValueList {
	section: SectionId;
	key: string;
	/** The current values, from the constants of the code. */
	values: readonly string[];
	/** Old or short words, read as the value on the right. They stay as written in the note. */
	old?: Readonly<Record<string, string>>;
}

export const OLD_RULES: Readonly<Record<string, string>> = {
	primogeniture: 'eldest-child',
	ultimogeniture: 'youngest-child',
	'brothers-first': 'siblings-first',
	seniority: 'siblings-first',
	'agnatic-seniority': 'siblings-first',
	proximity: 'nearest-relative',
	'proximity-of-blood': 'nearest-relative',
	porphyrogeniture: 'born-in-reign',
};
export const OLD_INHERIT: Readonly<Record<string, string>> = {
	'male-only': 'men-only',
	'semi-salic': 'men-first-in-house',
	'reverse-semi-salic': 'women-first-in-house',
	'male-first': 'men-first',
	'male-preference': 'men-first',
	none: 'no-preference',
	any: 'no-preference',
	'female-first': 'women-first',
	'female-preference': 'women-first',
	'female-only': 'women-only',
};
export const OLD_THROUGH: Readonly<Record<string, string>> = { male: 'men', female: 'women', any: 'anyone' };
export const OLD_ILLEGITIMATE: Readonly<Record<string, string>> = { true: 'after', yes: 'after', false: 'no' };
export const OLD_UNION_TYPES: Readonly<Record<string, string>> = { engaged: 'betrothal', mistress: 'affair', lover: 'affair', liaison: 'affair', concubine: 'concubinage' };
export const OLD_ENDED_BY: Readonly<Record<string, string>> = { divorced: 'divorce', annulled: 'annulment' };

export const VALUE_LISTS: readonly ValueList[] = [
	{ section: 'titles', key: 'succession', values: SUCCESSION_RULES, old: OLD_RULES },
	{ section: 'titles', key: 'inherit', values: INHERIT_RULES, old: OLD_INHERIT },
	{ section: 'titles', key: 'inherit-through', values: INHERIT_THROUGH, old: OLD_THROUGH },
	{ section: 'titles', key: 'inherit-illegitimate', values: INHERIT_ILLEGITIMATE, old: OLD_ILLEGITIMATE },
	{ section: 'people', key: 'placement', values: PLACEMENT_TYPES },
	{ section: 'parents', key: 'type', values: PARENT_TYPES },
	{ section: 'unions', key: 'type', values: UNION_TYPES, old: OLD_UNION_TYPES },
	{ section: 'unions', key: 'ended-by', values: ENDED_BY, old: OLD_ENDED_BY },
];

/** Hand-typed forms that the plugin reads without a warning (spec §8 "Tolerated silently", §13.4). Listed in `docs/format.md`. */
export const TOLERATED: readonly string[] = [
	'A number where an ID is expected (`id: 7`) is read as the text "7".',
	'A pair of curly quote marks around the value is ignored for these keys. A phone keyboard makes these marks. In `options`: `start`, `focus` and `me`. In a house: `id`, `color` and `arms`. In a person: `id`, `house`, `placement`, `union`, `link`, `portrait`, `arms` and the IDs in `parents`. In a partnership: `id` and the IDs in `partners`. In a title: the IDs in `holders`, `heir` and `exclude`. In a holder: `person` and `through-spouse`. Not for `titles.id` and `card-title`.',
	'One value where a list is expected is read as a list of one item: `parents: aldric`, `holders: aldric`, `heir: hugo`. A partnership with one ID gives a warning.',
	'A holder written as a plain ID (`- aldric`) is the same as `{person: aldric}`.',
	'A link in [[ ]] without quotes is read as the text of the link. An unquoted ![[x.png]] in `link`, `portrait` or `arms` is accepted too.',
	'A plain `null`, `~` or an empty value is read as "nothing written". The same words in quotes are text.',
	'`true` and `yes` in any case are on for `illegitimate`, `childless`, `inherit-adopted` and `heirs-of-body`.',
	'The old names of the succession values (see Values) are read as the current value and stay as written.',
	'A partnership type in any case, and the words `engaged`, `mistress`, `lover`, `liaison` and `concubine`, are read as a known type (see Values).',
	'A value of `ended-by` in any case, and the words `divorced` and `annulled`, are read as a known value (see Values).',
	'A parent type in any case (`Adoptive`) is read as the known type.',
	'A `through-spouse` value in any case, and an ID after it with curly quote marks.',
	'The words false, no, alive, living and never in `died` mean that the person is alive.',
	'A YAML anchor or alias is read as usual. The plugin does not change an item that is an alias.',
];
