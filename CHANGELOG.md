# Changelog

All notable changes for users. The newest version is first.

## 0.5.1

### Repairs

- **The phone list stays at the person after Save.** On an iPhone, after you saved a change in the person window, the list could go back to the first person of the tree. Now it stays at the person that you edited. The tree also keeps its folded branches.
- **Close no longer covers buttons in a narrow iPad window.** In Split View or Slide Over, the buttons of the full-screen view now move to two rows. Close stays at the end.
- **The × that removes a partnership in the person window is now easier to tap on an iPad.**
- **Your first click no longer misses.** When you left a field, a grey line under a date field or the hint of the Marker field could appear or hide. This moved the buttons, so the first click or tap missed. Now the buttons stay in place until the click ends.
- **The line of succession names the ruler as the holder list does.** For example, it says "After Konrad VI in 1464", not "After Konrad in 1464".

### Pictures

- **Arms and portraits show sooner when Obsidian starts.** The plugin now keeps a small copy of each picture on the device, in Obsidian's own storage, not in your vault. Copies are not synced, so each device keeps its own. From the second start, a picture that has a copy shows at the same time as the tree. If you change a picture file, the plugin makes a new copy.

### Dates

- **Dates with right-to-left words or digits keep their order in nearly every place.** This includes the cards, the saved picture, the person window, Find, the Houses and Titles windows and the line of succession. Before, a date such as "1108–1170" after an Arabic word could show as "1170–1108". One case remains. See Known limits.

### Windows

- **The partnership window shows the two names as its title**, on the computer and on the phone.
- **The Titles window: the first row of the holder list shows the name that you typed.** For example, it shows `A holder who is not in the tree: “Isolde”`. If the person is in the tree, choose the row of the person.
- **The Calendars window: a line under the link "Remove this calendar" says what changes** if you remove the calendar.
- **The line of succession says when the plugin cannot read a year in a birth date.** It also says what to change.
- **The hint of the Marker field is shorter.** It says: "Write one short word in curly brackets, for example {planet}."
- **"Remove this list" stands at the end of each list of year names**, under its last field, so a tap on a field cannot remove the list.
- **Windows open with no active field**, so the keyboard does not open by itself on a phone or an iPad. Find and the lists of people keep the cursor in their search field.

### Install

- **The README now shows how to install the plugin with BRAT.** BRAT is a community plugin that installs plugins from GitHub and keeps them up to date.

### Known limits

- A curved line for a rumoured link, or for a parent who is drawn elsewhere, can pass over a card. A better route for these lines comes later.
- A lover at the end of a group of partners can still have a long line that crosses other lines.
- A name tag with a long name can show only part of the name.
- A date after an Arabic house name in the same text line can still show in the wrong order.
- A name by marriage that differs from another name only by "adoptive" or "rumoured" does not show. For example, "Wife's adoptive half-nephew" does not show.
- A divorce gives the word "Former" only if you choose "Ended by", or if the end year is before the death years of both partners and all three years are exact. Otherwise no word changes.
- If a child is born in the year after the father died, the card of the father's wife says "Father's wife", not "Stepmother". The plugin cannot know that the child was conceived before the death.
- If a CSS snippet loads the font of your notes, a saved picture uses a standard font. A long name can then be wider than its card.
- If you replace a picture file with another file of the same size and the same time of the last change, the plugin can show the old picture until you change the file again.

## 0.5.0

### Before you update: relation words and years

- **Relation words now read years.** The plugin reads the years in `born`, `died`, `start` and `end`. If your tree has such years, some cards show a new word. The text of your notes does not change.
- **Step words follow the years of the marriage.** If the marriage ended before the child was born, or began after the child died, the card says "Father's wife" in place of "Stepmother". A marriage ends at its end year or at the death of a partner. If the marriage and the life of the child overlap, the card says "Stepmother" as before.
- **A divorce gives the word "Former".** A card says "Former husband", "Former wife", "Former stepmother" or "Former sister-in-law" when a marriage ended by a divorce or an annulment. The plugin knows this in two ways. You choose "Ended by" in the partnership window. Or the end year is before the death years of both partners.
- **Only exact years count.** A year such as 1130 or "12 May 1130" counts. A text such as "c. 1130", "after 1130" or "1130s" does not. For such a text, the card keeps the old word.
- **A date in your own calendar counts only if the tree names a calendar note.** See "Before you update: calendars" in version 0.4.0.
- **Two devices with different versions show different words** until both have 0.5.0. An older version keeps the new key `ended-by` and ignores it.

### Relation words

- **The relation finder uses the same words.** The sentence and the steps say, for example, "Ola is Ned's former wife."
- **A death never adds a word.** There is no "Late wife" and no "Widow". If the sister of your former wife died before the divorce, her card says "Sister-in-law", not "Former sister-in-law".
- **Names by marriage no longer depend on the order of the people in the note.** A name such as "Wife's half-nephew" now shows in every order. The list "Also" can show more names than before. The first word of a card does not change.
- **A name with an adoptive link no longer depends on the order.** If a person is related through a birth link and through an adoptive link at the same distance, the card gives the birth word.

### Partnership window

- **New choice "Ended by".** The choices are Not known, Divorce, Annulment and Death. The choice shows for a marriage and for a partnership with a type that you wrote yourself. It does not show for a betrothal, a concubinage or an affair. "Death" gives no "Former" word. The plugin writes the key `ended-by` in the tree text.

### Phone list

- **A colour bar at the top.** The person at the top of the list has the same house colour bar as the other rows. The bar also shows when the house has arms. A person with no house gets a grey bar. The name starts a little to the right, so a long name can wrap sooner.
- **Dates with right-to-left words keep their order.** Before, a date such as "1108–1170" after an Arabic word could show as "1170–1108".

### Tree

- **Small tags in place of some long lines.** Take a couple on two rows, where the lower partner stands between two of her or his partners. The tree now shows a small tag with the partner's name under each of the two cards. Tap the tag to go to the partner. Before, a long line went around the tree and crossed other lines.

### Repairs

- **Settings stay safe during a sync.** A sync program can write the settings file of the plugin in two parts. Before, a setting change at that moment set all settings back to their default values. Now the plugin keeps your settings.
- **Screen readers.** The spoken name of the button "Add person" now starts with "Add person", so voice control finds it. A child row in the person window now also says the year and the sobriquet, as the row shows them.

### Calendars

- **The hint of the Marker field is clearer.** The field now tells you to write one short word, for example "planet". Then you write the same word in curly brackets in a format. The field still accepts a word with curly brackets.

### Known limits

- A curved line for a rumoured link, or for a parent who is drawn elsewhere, can pass over a card. A better route for these lines comes later.
- A lover at the end of a group of partners can still have a long line that crosses other lines.
- A name tag with a long name can show only part of the name.
- The cards and the person window do not yet keep the order of a date with right-to-left words.
- A name by marriage that differs from another name only by "adoptive" or "rumoured" does not show. For example, "Wife's adoptive half-nephew" does not show.
- A divorce gives the word "Former" only if you choose "Ended by", or if the end year is before the death years of both partners and all three years are exact. Otherwise no word changes.
- If a child is born in the year after the father died, the card of the father's wife says "Father's wife", not "Stepmother". The plugin cannot know that the child was conceived before the death.
- If a CSS snippet loads the font of your notes, a saved picture uses a standard font. A long name can then be wider than its card.

## 0.4.0

### Before you update: calendars

- **A tree now uses a calendar note only if it names one.** In earlier versions every calendar note applied to every tree. From 0.4.0 a tree with no calendar note reads its dates as plain years. A date in your own calendar then shows as you wrote it, and the line of succession does not use its year.
- **To keep your calendars:** open the tree, select More, then **Calendar note**, and select your note. This writes the key `calendar` in the options of the tree. You can also open More, then **Calendars**, and select Save: Save writes the key too. Do this once for each tree that uses calendar dates.
- **"Every calendar note" is now "No calendar".** It is the first item in the list of calendar notes. It removes the key.
- **The Calendars window opens on a note even if the tree names none.** It shows the first calendar note of the vault by name. You can select another note. If the vault has no calendar note, the window starts a new one.
- **Two devices with different versions can read the same tree differently** until both have 0.4.0. Update the plugin on all your devices.
- **Warnings:** the warning that a calendar name is used in two notes is gone. The warning "calendar note missing" shows only for a tree that names a calendar note, when the plugin cannot read a calendar in that note.

### Faster, and safer on many devices

- **Faster start and faster rename in a big vault.** The plugin now keeps a small index of the notes that hold a tree or a calendar. It no longer reads every note when Obsidian starts or when you rename a note. The index is kept on each device.
- **Link updates that wait for a sync are kept on each device.** If a rename happens while another device is not synced, wait for the sync before you open the vault on that device. "Show the last link update" shows only the updates of this device.
- **A large tree moves more smoothly on a phone** when you pan and zoom.
- **A large tree uses less memory** for relation names.

### Windows

- **"Undo last tree edit" now names the note.** If the last edit was in a note that is not open, the plugin asks before it undoes the edit.
- **Titles window: a new hint for a younger son.** If the first holder of a title is a younger son, the line of succession can hold his elder brother or the children of that brother. Then the window names the first such person and says which box removes them from the line.
- **Two rule names are clearer.** "Siblings before children" is now "Oldest generation first (lateral succession)". "Men first in the whole house" and "Women first in the whole house" now say "dynasty" in place of "house".
- **Settings** use the new settings page of Obsidian 1.13. Older versions keep the old page.
- **The plugin starts even if one part fails.** You see one message, and the rest of the plugin works.

### Relation words

- **Children of a couple through an adoption are no longer "half".** If a child has a birth parent and an adoptive parent who are partners, the child has two parents. A brother or sister with the same two parents is now "Brother" or "Adoptive brother", not "half". A brother or sister with only one of the two parents is "half".

### Other

- The lowest Obsidian version is now 1.11.0.
- The plugin has a licence: GNU General Public License 3.0 only.
- Release tags are now the bare version (for example `0.4.0`), with no "v".

### Known limits

- On an iPhone, Obsidian can write its local storage late. If the app is closed by the system, the plugin can lose the last saves of its note index or of waiting link updates. The next start checks the notes again.
- A vault of more than about 45 000 notes cannot save the index. Each start then checks the notes again when Obsidian is idle.
- The pinch that ends on a whole tree of more than 500 people can still take seconds on a phone.
