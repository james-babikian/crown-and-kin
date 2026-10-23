# Format 1: the tree text

This file is generated. Do not edit it by hand. Change `scripts/format/keys.ts` and run `npm run format-doc`.

Format 1 is the form of the tree text in plugin version 0.3 and in every plugin version 1.x. Format 1 has 66 keys, 3 of them reserved. The plugin reads the other 63. The README has a short example of a tree.

## The rules of Format 1

1. A new plugin version 1.x can add a key. It never changes what an old key means.
2. If the plugin does not know a key, it does not remove the key when you change the tree in a window. It keeps your comments too. A comment is a text line that starts with #.
3. A tree that works in plugin version 1.0 works in every later plugin version 1.x.
4. A change that breaks these rules needs plugin version 2.0. The key `format` in `options` is reserved for that. You do not need to write it. Plugin version 1.x never writes it.

## How the plugin reads a tree

- The tree is YAML in a code block with the language `kin`. If the YAML is not valid, or the top level is not a map, the plugin shows an error box and no tree.
- Every value is read as text, exactly as you wrote it. `born: 1102` is the text "1102". The plugin reads a date only to find its year (see "The calendar note"). It never changes the text of a date.
- If two people have the same `id`, or two partnerships have the same `id`, the plugin shows the tree but does not let you edit it.
- Every other fault is a warning. The tree still shows, with a warning button and a list.
- A key that the plugin does not know gives no warning. It stays in the note at every level.

## How the plugin writes a tree

- The plugin changes only the text lines that must change. Comments, the order of keys, quotes and the flow style of the lines that it does not change stay as they are.
- A new key goes after the nearest earlier key in the write order of its section. The write order is below each table.
- A value is written plain if plain YAML reads it back as the same text. If not, it is written in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it.
- A list that the plugin writes is a flow list, for example `[aldric, hugo]`. A block list that you typed keeps its form.

## The keys

The column "Since" is the plugin version that added the key. "0.1" is the original format. For a reserved key, it is the version that reserved it.

### Top level

The keys at the left edge of the code block. The top level must be a map. If it is not, the plugin shows an error box and no tree.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `options` | The settings of this tree: where it opens, the focus, the "This is me" mark and the height. | A map. Any other shape gives a warning and the plugin ignores it. | Made by the plugin when it must write an option. It goes first. The plugin removes it when it has no key left. | 0.1 |
| `houses` | The list of the houses. | A list of maps. Nothing written is an empty list. Any other shape gives a warning and the plugin ignores the section. An item that is not a map gives a warning and the plugin skips it. | A block list. The plugin makes it when you add the first house. | 0.1 |
| `titles` | The list of the titles and their holders. | A list of maps. Nothing written is an empty list. Any other shape gives a warning and the plugin ignores the section. An item that is not a map gives a warning and the plugin skips it. | A block list. When the plugin makes it, it goes directly after `houses`. With no `houses`, it goes directly before `people`. Otherwise it goes at the end. | 0.2 |
| `people` | The list of the people. | A list of maps. Nothing written is an empty list. Any other shape gives a warning and the plugin ignores the section. An item that is not a map gives a warning and the plugin skips it. A person with no `id` is still drawn, with a warning. | A block list. The plugin adds a person at the end, or beside the person it belongs to. | 0.1 |
| `unions` | The list of the partnerships. | A list of maps. Nothing written is an empty list. Any other shape gives a warning and the plugin ignores the section. An item that is not a map gives a warning and the plugin skips it. | A block list. The plugin adds a partnership at the end. | 0.1 |

Write order: `options`, `houses`, `titles`, `people`, `unions`.

### options

A map under `options:`.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `start` | The person that the tree centres on when it opens. If you edited a person in this session, the tree centres on that person instead. The phone list does not use it. | A person ID. A number is read as text. A pair of curly quote marks around the ID is ignored. If no person has this ID, the plugin shows a warning. | Typed by hand. No window of the plugin writes it. | 0.1 |
| `focus` | The person that the tree shows in focus mode when it opens. "Pin focus here" writes it. | A person ID. A number is read as text. A pair of curly quote marks around the ID is ignored. If no person has this ID, the plugin shows a warning. | Plain text. "Pin focus here" writes it. "Remove pin" removes it. | 0.1 |
| `me` | The person with the mark "This is me". The relation names start from this person. | A person ID. A number is read as text. A pair of curly quote marks around the ID is ignored. A list or a map gives a warning. If no person has this ID, the plugin shows a warning. | Plain text. "This is me" writes it. "Remove This is me" removes it. | 0.2 |
| `generations` | How many generations up and down the tree shows in focus mode. | A whole number, 0 or more. Any other text is ignored. With no key, the setting of the plugin counts. | Typed by hand. No window of the plugin writes it. | 0.1 |
| `height` | The height in pixels of the tree in a note, on a computer. | A whole number from 100 to 5000. Any other text or number is ignored and the usual height counts. A phone list does not use it. | A plain number. The resize handle of the tree writes it. | 0.1 |
| `calendar` | The calendar note that this tree uses to read dates. With no key, the tree reads plain years only (no calendar). | A link to a note: [[x]], [Alias](x.md) or a plain path. A link in [[ ]] without quotes is accepted. A note that does not exist, or has no calendar, gives a warning and the tree reads dates with no calendar. | In double quotes. The item "Calendar note" in the More list writes it. "No calendar" removes it. The Calendars window also writes it when you save calendars in a tree that has no key. The plugin keeps the link up to date when you rename the note. | 0.3.2 |
| `format` (reserved) | Reserved for Format 2. The plugin ignores it today, keeps it and never writes it. | Any value. The plugin ignores it and keeps it. | Never written. A key that is in the note stays as it is. | 0.3 |

Write order: `start`, `focus`, `me`, `generations`, `height`, `calendar`.

### houses

A list of maps under `houses:`. One item for each house.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `id` | The short name that people use in their `house` key. | Text. A number is read as text. A pair of curly quote marks around the ID is ignored. A house with no ID is skipped, with a warning. If two houses have the same ID, the first one counts and the plugin warns. | Plain text. The plugin makes the ID of a new house from its name. The ID does not change when you rename the house. | 0.1 |
| `name` | The name of the house on cards, in the legend and in the Houses window. | Text. With no name, the ID is the name. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |
| `color` | The colour of the strip on the cards of the house, for example `"#8c2041"`. Write it in quotes. Without quotes, the plugin shows a warning. | A hex colour: #rrggbb or #rgb, for example #8b1e3f. Write it in quotes. Without quotes, YAML reads the "#" as the start of a comment, and the plugin shows a warning. Other CSS colours draw on screen today. Format 1 does not promise them; saved pictures use only hex, rgb(), hsl() and named colours. | In double quotes, as #rrggbb. | 0.1 |
| `arms` | A link to the picture of the coat of arms of the house. | A link to a picture in the vault: [[x.png]], [Alias](x.png) or a plain path, each with or without a leading "!". A link in [[ ]] without quotes is accepted. A web address gives a warning and shows no picture. | In double quotes. The plugin writes the link that Obsidian makes, so it follows your link settings. | 0.2 |

Write order: `id`, `name`, `color`, `arms`.

### titles

A list of maps under `titles:`. One item for each title.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `id` | The short name that `card-title` uses to select this title. | Text. A number is read as text. Curly quote marks around the ID are not removed: they stay part of the ID. A title with no ID is skipped, with a warning. If two titles have the same ID, the first one counts and the plugin warns. | Plain text. The plugin makes the ID of a new title from its name. | 0.2 |
| `name` | The name of the title: the place that the title rules, for example "Duchy of Normandy". | Text. With no name, the ID is the name. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `male-name` | The name of the title for a holder with `sex: m`, for example "Duke of Normandy". | Text. Optional. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `female-name` | The name of the title for a holder with `sex: f`, for example "Duchess of Normandy". | Text. Optional. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `plural` | The name of the list of holders and of the note with the table, for example "Dukes of Valmont". | Text. With no key, the name of the title is used. | The Titles window does not show it and does not write it. A key that is in the note stays. | 0.2 |
| `numbering` (reserved) | Reserved. The plugin keeps the key and never reads it. The plugin does not count the numbers of the holders. | Any value. The plugin ignores it and keeps it. | The plugin never writes it. | 0.2 |
| `count-with` (reserved) | Reserved. The plugin keeps the key and never reads it. | Any value. The plugin ignores it and keeps it. | The plugin never writes it. | 0.2 |
| `succession` | The rule that puts the heirs in order. See "Succession". | One of the rule names (see Values), in any case. The old names are also accepted. Another text gives a warning and the title has no line of succession. With no key and no `heir`, the title has no line of succession and the plugin gives no warning. The other succession keys then do nothing. | Plain text, one of the current names. The Titles window writes only the keys that you changed. A key that you wrote by hand stays as written. | 0.2.7 |
| `inherit` | Who can inherit: men, women, or both with a preference. See "Succession". | One of the rule names (see Values), in any case. The old names are also accepted. With no key, `no-preference` counts, but only for a title that has a line of succession. Another text gives a warning and the title has no line of succession. | Plain text, one of the current names. The Titles window writes only the keys that you changed. A key that you wrote by hand stays as written. | 0.2.7 |
| `inherit-through` | Through whom a claim passes: men, women or anyone. See "Succession". | One of `men`, `women` and `anyone`, in any case. The old names `male`, `female` and `any` are also accepted. Another text gives a warning and the title has no line of succession. | Plain text, one of the current names. The Titles window writes only the keys that you changed. A key that you wrote by hand stays as written. | 0.2.7 |
| `inherit-illegitimate` | Whether children marked as illegitimate can inherit. See "Succession" for the values. | `no`, `after` or `equal`, in any case. `true` and `yes` mean `after`. `false` means `no`. No key means `no`. Another text gives a warning and the title has no line of succession. | Plain text. `no` removes the key. A text that already means the chosen value stays as written. | 0.2.7 |
| `inherit-adopted` | Whether adopted children can inherit. | "true" or "yes" in any case is on. Any other text, or no key, is off. | `true`. To turn it off, the plugin removes the key. A text that already means on stays as written. | 0.2.7 |
| `heirs-of-body` | Whether only the descendants of the first holder can inherit. | "true" or "yes" in any case is on. Any other text, or no key, is off. | `true`. To turn it off, the plugin removes the key. A text that already means on stays as written. | 0.2.7 |
| `year` | The year that the line of succession is for. | Text with a year in it, for example 1210, "c. 1210" or "200 BC". With no key, or no year in it, the line is for the end of the last reign, else for now. A text with no year gives a warning only for a title with `succession` or `heir`. | Plain text, as typed. | 0.2.7 |
| `heir` | The named heirs. They come first in the line of succession, in the order of the list. | One person ID, or a list of IDs. A number is read as text. A pair of curly quote marks around the ID is ignored. An ID that no person has gives a warning and is ignored. | One ID is written as a single value. Several IDs are written as a flow list on one line. | 0.2.7 |
| `exclude` | The people who are not in the line of succession. | One person ID, or a list of IDs. A number is read as text. A pair of curly quote marks around the ID is ignored. An ID that no person has gives a warning and is ignored. | One ID is written as a single value. Several IDs are written as a flow list on one line. | 0.2.7 |
| `holders` | The list of the holders of the title, in the order in which they held it: the first holder first, the newest holder last. | A list of holder maps. A holder can be a plain person ID. `holders: aldric` is one holder. A map instead of a list gives a warning and the plugin ignores it. | A block list. A new holder is a map on one line. | 0.2 |

Write order: `id`, `name`, `male-name`, `female-name`, `plural`, `numbering`, `count-with`, `succession`, `inherit`, `inherit-through`, `inherit-illegitimate`, `inherit-adopted`, `heirs-of-body`, `year`, `heir`, `exclude`, `holders`.

### holders of a title

A list under `holders:` in a title. One item for each reign. The first holder is first and the newest holder is last.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `person` | The ID of the person who holds the title. If a holder has both `person` and `name`, the plugin uses `person`. | Text. A number is read as text. A pair of curly quote marks around the ID is ignored. If no person has this ID, the plugin shows a warning. With a `name`, the holder then shows as a holder who is not in the tree. | Plain text. A holder that is a plain ID becomes a map when the plugin changes it. | 0.2 |
| `name` | The name of a holder who is not in the tree. | Text. If `person` and `name` are both written, `person` counts and `name` stays in the note. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `as` | The ruler name, when it is not the first word of the name of the person. | Text. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `number` | The number of the holder, for example "II". The plugin does not count it. | Free text. The plugin never reads it as a date. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `from` | When the reign started. | Free text. The plugin never reads it as a date. The line of succession reads a year in it. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `to` | When the reign ended. | Free text. The plugin never reads it as a date. The line of succession reads a year in it. The words present, now, current, ongoing, living, alive and reigning mean an open end. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.2 |
| `through-spouse` | The holder holds the title through a spouse. See "A holder who holds the title through the spouse". | "true" or "yes" in any case: the plugin finds the spouse. A person ID, with or without curly quote marks: that partner. "false" or "no" is off. | `true` from the box in the Titles window. An ID that you wrote by hand stays as written. | 0.2.8 |

Write order: `person`, `name`, `as`, `number`, `from`, `to`, `through-spouse`.

### people

A list of maps under `people:`. One item for each person. The order of the list is the order of brothers and sisters.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `id` | The short name that other keys use to point to this person. | Text. A number is read as text. A pair of curly quote marks around the ID is ignored. If two people have the same ID, the plugin shows the tree but does not let you edit it. | Plain text. A new person gets an ID such as p12. The ID does not change when you rename the person. | 0.1 |
| `name` | The name on the card. | Text. With no name, the ID is the name. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |
| `sobriquet` | A short extra name, for example "the Wise". The card shows it after the name. | Text. One pair of double quote marks around the whole text is ignored. The plugin adds the curly marks on the card. | Plain text, directly after `name`. | 0.2.4 |
| `title` | The text under the name on the card. A person who holds a title also shows the reign after it. | Free text. A `card-title` replaces it on the card. The text stays in the note and in the person window. With no text and a title held, the card shows the name of the title. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |
| `card-title` | The ID of the title that the card shows, with its reign. It replaces a written `title`. It picks one title when the person holds several. | A title ID. A number is read as text. Curly quote marks around the ID are not removed: they stay part of the ID. If the person does not hold the title, the plugin shows a warning. | Plain text. "Show on the card" writes it. The plugin removes it when the person loses the last holder entry of that title. | 0.2 |
| `house` | The ID of the house of the person. | A house ID. A number is read as text. A pair of curly quote marks around the ID is ignored. If no house has this ID, the plugin shows a warning. | Plain text. | 0.1 |
| `sex` | Write `m` for a man or `f` for a woman. It sets the look of the card, the order of partners, the relation names and the line of succession. A word such as `male` gives a warning. | Any text. Only `m` and `f` (lower case) mean a man and a woman. Any other text is a value of its own, with a neutral card. A spelling such as `male` or `Female` gives a warning, and the plugin does not read it as `m` or `f`. | Plain text. | 0.1 |
| `born` | When the person was born. You can write any text. The line of succession and the phone list read a year in it. | Free text. The plugin never reads it as a date. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |
| `died` | When the person died. You can write any text. The line of succession and the phone list read a year in it. | Free text. The plugin never reads it as a date. The words false, no, alive, living and never mean that the person is alive. A doubtful word such as "?" or unknown counts as dead, with a warning. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |
| `parents` | The parents of the person. Write an ID, or write the keys `id` and `type` for a parent. | A list. One entry that is not in a list is accepted. A plain ID is a birth parent. At most 2 parents of one type, and 8 rumoured parents. More gives a warning. The setting "Warn about more than 2 parents of a type" turns off the warning for birth, adoptive and ward parents. | A flow list on one line. A block list that you typed keeps its form, and the plugin adds an entry to it. A birth parent is a plain ID. Any other type is a map: `{id: aldric, type: adoptive}`. | 0.1 |
| `placement` | Which parents decide where the card stands: the birth parents, the adoptive parents or the ward parents. | `birth`, `adoptive` or `ward`, in lower case. Another text gives a warning. A type that the person has no parents of gives a warning, and the plugin chooses itself. | Plain text. | 0.1 |
| `illegitimate` | The person was born outside a marriage. Write `illegitimate: true`. The sign is on the line to the birth parents. | "true" or "yes" in any case is on. Any other text, or no key, is off. | `true`. To turn it off, the plugin removes the key. A text that already means on stays as written. | 0.1 |
| `childless` | The person had no children. Write `childless: true`. The line of succession then shows no open branch for the person. | "true" or "yes" in any case is on. Any other text, or no key, is off. | `true`. To turn it off, the plugin removes the key. A text that already means on stays as written. | 0.2.7 |
| `union` | The ID of the partnership that the person was born in. It is needed only when the parents have more than one partnership. | A partnership ID. A number is read as text. A pair of curly quote marks around the ID is ignored. If it is not a partnership between the parents, the plugin shows a warning. | Plain text. The plugin writes it when it must name one of several partnerships. | 0.1 |
| `link` | A link to the note of the person. On a computer, a click on the name opens the note. | A link to a note: [[Note]], [[Note\|Alias]], [Alias](Note.md) or a plain note name. A link in [[ ]] without quotes is accepted. | In double quotes if plain text would not be read back as the same text. A link in [[ ]] is always in quotes. | 0.1 |
| `portrait` | A link to the portrait picture of the person. | A link to a picture in the vault: [[x.png]], [Alias](x.png) or a plain path, each with or without a leading "!". A link in [[ ]] without quotes is accepted. A web address gives a warning and shows no picture. | In double quotes. The plugin writes the link that Obsidian makes, so it follows your link settings. | 0.2 |
| `portrait-crop` | The part of the portrait that the card shows. | Three numbers with spaces between them: left, top and side, as fractions of the picture. Anything else gives a warning. The key does nothing without a `portrait`. | In double quotes, with 4 decimals at most, for example "0.12 0.05 0.6". The plugin removes it when the portrait changes. | 0.2 |
| `arms` | A link to the picture of the coat of arms of the person. | A link to a picture in the vault: [[x.png]], [Alias](x.png) or a plain path, each with or without a leading "!". A link in [[ ]] without quotes is accepted. A web address gives a warning and shows no picture. | In double quotes. The plugin writes the link that Obsidian makes, so it follows your link settings. | 0.2.8 |
| `notes` | Free text about the person. Only the person window shows it. | Free text, also on several lines. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |

Write order: `id`, `name`, `sobriquet`, `title`, `card-title`, `house`, `sex`, `born`, `died`, `parents`, `placement`, `illegitimate`, `childless`, `union`, `link`, `portrait`, `portrait-crop`, `arms`, `notes`.

### a parent entry

An item of the list under `parents:` in a person, when it is a map and not a plain ID.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `id` | The ID of the parent. | Text. A number is read as text. A pair of curly quote marks around the ID is ignored. An entry with no ID gives a warning and the plugin skips it. If no person has this ID, the plugin shows a warning. | Plain text. | 0.1 |
| `type` | The kind of the parent: birth, adoptive, ward or rumoured. | `birth`, `adoptive`, `ward` or `rumoured`, in any case. No type is `birth`. Another text counts as `birth`, with a warning. | Not written for a birth parent. For the other types, plain text in a map on one line. | 0.1 |

### unions

A list of maps under `unions:`. One item for each partnership.

| Key | Meaning | Accepted forms | Written form | Since |
|---|---|---|---|---|
| `id` | The short name of the partnership. It is needed only when two partnerships have the same two partners, or when a person uses `union`. | Text. A number is read as text. A pair of curly quote marks around the ID is ignored. If two partnerships have the same ID, the plugin shows the tree but does not let you edit it. | Plain text. The plugin adds it only when it must name a partnership. | 0.1 |
| `partners` | The two people of the partnership. | A list of exactly 2 person IDs. One ID that is not in a list is read as a list of one ID. A partnership needs 2, so any other count, one ID too, gives a warning and the plugin skips the partnership. For three people, write one partnership for each pair. | A flow list on one line. | 0.1 |
| `type` | The kind of partnership: marriage, betrothal, concubinage or affair. | The four names, in any case. Also `engaged` (betrothal), `mistress`, `lover` and `liaison` (affair) and `concubine` (concubinage). No type is a marriage. Any other word is drawn as a marriage, with a warning only if it is close to a known type. | Plain text. The plugin writes `type` for every kind except a marriage. It writes `type: marriage` only for the partnership that it makes when you add a second parent. | 0.1 |
| `start` | When the partnership started. | Free text. The plugin never reads it as a date. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |
| `end` | When the partnership ended. | Free text. The plugin never reads it as a date. | Plain text if plain YAML reads it back as the same text. If not, in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it. | 0.1 |

Write order: `id`, `partners`, `type`, `start`, `end`.

## Values

Some keys take one of a fixed list of values. The plugin compares the values after it trims the text and makes it lower case. An old name stays as you wrote it.

| Section | Key | Values | Old names, read as the value on the right |
|---|---|---|---|
| titles | `succession` | `eldest-child`, `youngest-child`, `siblings-first`, `nearest-relative`, `born-in-reign` | `primogeniture` = `eldest-child`, `ultimogeniture` = `youngest-child`, `brothers-first` = `siblings-first`, `seniority` = `siblings-first`, `agnatic-seniority` = `siblings-first`, `proximity` = `nearest-relative`, `proximity-of-blood` = `nearest-relative`, `porphyrogeniture` = `born-in-reign` |
| titles | `inherit` | `men-only`, `men-first-in-house`, `men-first`, `no-preference`, `women-first`, `women-first-in-house`, `women-only` | `male-only` = `men-only`, `semi-salic` = `men-first-in-house`, `reverse-semi-salic` = `women-first-in-house`, `male-first` = `men-first`, `male-preference` = `men-first`, `none` = `no-preference`, `any` = `no-preference`, `female-first` = `women-first`, `female-preference` = `women-first`, `female-only` = `women-only` |
| titles | `inherit-through` | `men`, `women`, `anyone` | `male` = `men`, `female` = `women`, `any` = `anyone` |
| titles | `inherit-illegitimate` | `no`, `after`, `equal` | `true` = `after`, `yes` = `after`, `false` = `no` |
| people | `placement` | `birth`, `adoptive`, `ward` | None |
| a parent entry | `type` | `birth`, `adoptive`, `ward`, `rumoured` | None |
| unions | `type` | `marriage`, `betrothal`, `concubinage`, `affair` | `engaged` = `betrothal`, `mistress` = `affair`, `lover` = `affair`, `liaison` = `affair`, `concubine` = `concubinage` |

## Forms that the plugin accepts without a warning

- A number where an ID is expected (`id: 7`) is read as the text "7".
- A pair of curly quote marks around the value is ignored for these keys. A phone keyboard makes these marks. In `options`: `start`, `focus` and `me`. In a house: `id`, `color` and `arms`. In a person: `id`, `house`, `placement`, `union`, `link`, `portrait`, `arms` and the IDs in `parents`. In a partnership: `id` and the IDs in `partners`. In a title: the IDs in `holders`, `heir` and `exclude`. In a holder: `person` and `through-spouse`. Not for `titles.id` and `card-title`.
- One value where a list is expected is read as a list of one item: `parents: aldric`, `holders: aldric`, `heir: hugo`. A partnership with one ID gives a warning.
- A holder written as a plain ID (`- aldric`) is the same as `{person: aldric}`.
- A link in [[ ]] without quotes is read as the text of the link. An unquoted ![[x.png]] in `link`, `portrait` or `arms` is accepted too.
- A plain `null`, `~` or an empty value is read as "nothing written". The same words in quotes are text.
- `true` and `yes` in any case are on for `illegitimate`, `childless`, `inherit-adopted` and `heirs-of-body`.
- The old names of the succession values (see Values) are read as the current value and stay as written.
- A partnership type in any case, and the words `engaged`, `mistress`, `lover`, `liaison` and `concubine`, are read as a known type (see Values).
- A parent type in any case (`Adoptive`) is read as the known type.
- A `through-spouse` value in any case, and an ID after it with curly quote marks.
- The words false, no, alive, living and never in `died` mean that the person is alive.
- A YAML anchor or alias is read as usual. The plugin does not change an item that is an alias.

## The calendar note

The calendars of your own world are not in the tree text. They are in a normal note, in a code block with the language `kin-calendar` (the block of a tree has the language `kin`). The Calendars window writes this note. You can also edit it by hand. The plugin changes only the text lines that must change, and it keeps your comments and the keys that it does not know, as in a tree.

```kin-calendar
calendars:
  - name: The Long Count
    kind: cycles
    length: 60
    start: 1
    formats: ["{cycle}.{year} {planet}", "{year} Year of the {cycle} Cycle"]
    lists:
      - name: Planets
        marker: planet
        names:
          - {name: Saturn, short: Sa}
          - {name: Jupiter, short: Ju}
          - {name: Mars, short: Ma}
        known: {year: 1273, index: 0}
        show: short
  - name: Reign names
    kind: eras
    formats: ["{year} Year of the {era}", "{era} {year}"]
    eras:
      - {name: Qinglong Emperor, start: 130, length: 11}
      - {name: Jianwen Emperor, start: 141}
plain:
  lists:
    - name: Planets
      names:
        - {name: Saturn, short: Sa}
        - {name: Jupiter, short: Ju}
        - {name: Mars, short: Ma}
      known: {year: 1273, index: 0}
      show: short
```

- A note can hold several blocks, and a block can hold several calendars. The plugin makes the note `Calendars` at the root of the vault the first time you save in the Calendars window.
- The plugin counts every year on one scale of whole years (the plain years). A plain year 1210 is year 1210. The number `start` gives the plain year of Year 1 of a calendar. The window works it out from an example: "Year 21 of Cycle 3 is the same year as 1203". So a calendar never depends on another calendar.
- A tree uses a calendar note only when it has the key `calendar` in `options`. With no key, the tree reads plain years only. The item "Calendar note" in the More list writes the key, and the item "No calendar" removes it. The Calendars window writes the key when you save calendars from a tree that has no key. Before 0.4, a tree with no key used every calendar note.
- A date that fits a format gets the year of the calendar. A date that fits no format is read as a plain year, as before. A date that fits two calendars with different years gets no year.
- A name list gives each year a name that repeats. The plugin shows the name after a short date, for example "22.13 Sa". It never writes the name into your note. If a date holds a name that is wrong for its year, the plugin keeps the year of the date and gives a warning. A format can hold the marker of a list, for example `{planet}`. The part of the format with the marker is optional: the date still reads with no name.
- The plugin never changes the text of a date. It reads the text to find a year, and it shows the date as you wrote it.
- A plugin version before 0.3.2 shows the block as plain code. It reads a date in a calendar as a plain year: a date with no run of three or four digits has no year, and a date such as "Third Age 3019" gives the wrong year 3019, with no note. A device whose calendar note has not synced yet reads dates in the same way. If you delete the calendar note, such dates have no year until you add the calendars again.
- A tree that has no key reads dates in a different way in 0.4 and in an older plugin version. An older version (0.3.3 or before) uses every calendar note for a tree with no key. Version 0.4 uses none. So the same tree can read a date in two ways on two devices that have different versions. A tree that has the key reads the same note in every version. To make the result the same, select the note for the tree with the item "Calendar note".
- A plugin version before 0.3.3 does not know name lists. It keeps the calendar and its other formats, and it ignores a format that holds a marker, with no warning. A calendar whose only format holds a marker reads no date there. Its Calendars window refuses to save the note until you remove the marker format. To let old devices read your dates, use formats with no marker, for example `{cycle}.{year}` (a marker format next to its own form with no marker is refused as the same format). The names still show in 0.3.3 with such formats, but a name written in such a date is not read or checked.

| Level | Key | Meaning | Accepted forms | Written form |
|---|---|---|---|---|
| block | `calendars` | The list of calendars of this block. | A list of maps. Any other shape gives a warning and the plugin ignores the block. | A block list. |
| block | `plain` | The name lists of the plain years, in a map with the key `lists`. A block with only this key is a calendar note. | A map. A list that the plugin cannot use gives a warning, and the plugin ignores it. | A block map. |
| calendar | `name` | The name of the calendar. The grey line and the test line show it. | Text. A calendar with no name is not used. | Plain text, in double quotes if plain YAML would read it as another value. |
| calendar | `kind` | The kind of the calendar. | `cycles` or `eras`, in any case. Any other word: the plugin ignores the calendar and gives a warning. | Plain text. |
| calendar | `length` | Cycle calendar: the number of years in one cycle. | A whole number, 1 or more. | Plain number. |
| calendar | `start` | Cycle calendar: the plugin year of Year 1 of Cycle 1. The Calendars window works this number out from "Same year as". With no number, the start is 1. | A whole number, also below 1. | Plain number. |
| calendar | `formats` | The ways in which a date of this calendar is written. A cycle format needs `{year}` and `{cycle}` one time each. An era format needs `{year}` and `{era}` one time each. | A list of texts, or one text. Case and extra spaces do not matter. A format can be part of a longer text. | A flow list on one line, each format in double quotes. |
| calendar | `eras` | Era calendar: the eras, each with its own start. | A list of maps. | A block list. Each era is a map on one line. |
| calendar | `lists` | The name lists of this calendar, at most 4. A name list gives each year a name that repeats, for example a planet. A format can show the name with the marker of the list. | A list of maps. A list that the plugin cannot use gives a warning, and the plugin ignores it. | A block list of maps. |
| era | `name` | The name of the era. The same name in two eras is not allowed. | Text. | Plain text. |
| era | `start` | The plugin year of Year 1 of this era. | A whole number, also below 1. | Plain number. |
| era | `length` | The number of years of the era. A date after the last year gives a warning. With no length, the era has no end. | A whole number, 1 or more. | Plain number. |
| list | `name` | The name of the list. A list name can be the same in two calendars. The grey line shows it. | Text. A list with no name is not used. | Plain text. |
| list | `marker` | The place name that a format uses for this list, for example `planet` for `{planet}`. It has 1 to 24 letters, digits or hyphens and starts with a letter. It is not `year`, `cycle` or `era`. The plain years have no marker. | Text. The plugin accepts curly brackets around it. | Plain text, with no curly brackets. |
| list | `names` | The names, in order. Each name has an optional short form. The names repeat, one for each year. | A list of 1 to 60 maps with `name` and `short`, or a list of texts. A name and a short form have 1 to 40 characters. | A block list. Each name is a map on one line. |
| list | `known` | One year with its name: the plugin year and the place of its name in `names`, counted from 0. | A map with `year` (a whole number) and `index` (a whole number below the number of names). | A map on one line. |
| list | `show` | What a card shows after a date: the short form, the full name or nothing. | `short`, `full` or `none`. Any other value, or no value, is `short`. | Plain text. |

Write order of a calendar: `name`, `kind`, `length`, `start`, `formats`, `eras`, `lists`. Write order of an era: `name`, `start`, `length`. Write order of a name list: `name`, `marker`, `names`, `known`, `show`.

## Reserved keys

The plugin keeps these keys and never reads them. It never writes them.

- `format` in options: Reserved for Format 2. The plugin ignores it today, keeps it and never writes it.
- `numbering` in titles: Reserved. The plugin keeps the key and never reads it. The plugin does not count the numbers of the holders.
- `count-with` in titles: Reserved. The plugin keeps the key and never reads it.

## Older and newer plugin versions

- A newer version reads without error every tree that an older version wrote. The sample trees of the versions 0.1.0 and 0.2.0 are part of the tests.
- The meaning of an old word can change. Since version 0.2.8, the partnership types `engaged`, `mistress`, `lover`, `liaison` and `concubine` mean a known type. Before, the plugin drew them as a marriage.
- An older version keeps the keys that it does not know when it writes the note. It does not show them. Update the plugin on all your devices.
