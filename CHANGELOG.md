# Changelog

All notable changes for users. The newest version is first.

## 0.5.4

### Examples and help

- **All example names in the windows and in the help are new.** For example, the new person window shows "For example: Rosamund de Clifford", and the sobriquet hint shows "the Conqueror". The Houses window shows "For example: House Plantagenet". Before, the example for a house name never showed. The examples for titles, calendars and years are new too.
- **Some empty fields now show a grey example.** The field "Name of the new house" in the person window, the field "Name of the holder" and the text box for eras have one. The Cycle field shows a grey "1", the same as the Year field. An empty Cycle still means 1.
- **The rule for the ID of a house or a title now says "small letters".** Before, it said "letters", but the plugin refuses capital letters. The rule is "Use only small letters, digits and hyphens (-)."

### Calendars

- **You now write the eras of an era calendar in one text box.** Write one era on each text line: the name, a comma and the first year, for example "Reign of Aldric, 1100". For an end, write "to" and the last year, for example "Reign of Aldric, 1100 to 1139". There is no "Add era" button and no "Remove" link now. To add an era, write a text line. To remove an era, delete its text line.
- **A list under the box shows how the plugin reads each text line.** For example, "Reign of Aldric 1 = year 1100" (year 1 of the era is the plain year 1100), and at the right "to 1139" or "no end".
- **The list under the box now stands a little apart from the help text.** Before, its first row looked like one more line of the help.
- **An error names the text line.** For example, "Text line 3: write the name, a comma and the first year." The plugin shows an error for a first year that it cannot read, a last year before the first year, and the same era name twice.
- **The two errors for a wrong format now start their example with "For example:".** One of them ends with "For example: “{era} {year}”." Before, it said "An example is".
- **An era with no last year now ends where the next era starts.** Only the last era has no end. If a date is after the end of its era, the plugin shows a warning. The date keeps its year.
- **The warning for a date after the end of its era or cycle now stands in the normal text colour.** The line before it, which shows how the plugin reads the date, stays grey.
- **The start of a calendar that you saved now shows again.** The fields Cycle, Year and "Same year as" show the saved start. Before, the start did not show after Save.
- **A tap on a link in the Calendars window is no longer lost.** Before, a help text under a field hid when you left the field. The links moved during your tap, and the tap was lost. For example, the first tap on "Add era" in the old window could do nothing.

### Tree

- **The curved lines of rumoured, adoptive, ward and begetter children now go between the cards.** Before, such a line could go over a card. In 300 test trees, the number of lines over cards went from 328 to 88. In the sample trees, it went from 4 to 1. This is true in a tree from top to bottom and in a sideways tree.
- **In a sideways tree, the name tag of a partner now has the whole lower edge of the card.** A name tag is the small label under a card that names a partner whose card stands far away. The tag stands in the middle under the card. The tree does not get bigger. The area that you can tap is wider.
- **A name tag now shows the name that the partner's card shows.** For example, "Ermengarde III" instead of the full name. A person with no ruler number keeps the full name. This is the same in a tree from top to bottom and in a sideways tree.
- **On a phone, at the middle zoom level, the text in a name tag is now smaller.** It is two thirds of the size of the name on the card. So more tags show the whole first name. The tag keeps its form, its place and its tap area.
- **On a computer, at the smallest zoom level, heir rings that touch now stand higher.** A ring moves up until it touches no other ring. A thin line joins it to its card. A ring can go up 4 steps of 20 pixels.
- **On a phone, in a sideways tree, the ring of an heir now stands on the left edge of the card.** The ring moves left as far as needed to keep the first letter of the name free. At the edge, the ring could cover another card or touch a fold button. Then it stays at the top left corner, as before.
- **Several begetter lines from one begetter to children in one row now keep a small gap and one dash pattern.** Before, the lines could cross each other again and again, and their dashes did not match.

### Undo and the legend

- **If "Undo last tree edit" cannot undo the change, the message now says what to do.** This happens when the tree changed after your edit. The message ends with "Make the change again by hand."
- **After you undo a rename, the message now names both names.** For example, "The plugin undid the change to Aldric III. The name is Aldric the Elder again."
- **In a saved picture, the legend now shows a house name in the right order.** This is for a name that mixes right-to-left letters and Latin letters. The order is the same as on the cards.
- **The relation finder now shows "You" in the same form as the Find list.** The name is on the first line and "You" with the dates on the second line. Before, the relation finder showed "You: name" on one line.

### Known limits

- **At the middle zoom level, a name tag can still be cut.** In the sample trees, 90 of 292 tags are cut at that level. Each keeps the whole first name, with one exception. In one test tree from top to bottom, one tag shows "Ermengard…".
- **A curve can still cross a card where no gap is free.** The curves also cross more straight lines than before. In a sideways tree, a curve can run for a long way beside a straight line.
- **A curved line that goes across more than 12 rows stays as before.** The plugin does not move it between the cards.
- **A begetter with 16 or more children in one row loses the small gap between the lines.** The line still ends at the child.
- **If you write a comma instead of "to" in an era, the plugin reads it as part of the name.** For example, "Reign of Aldric, 1100, 1139". The reading list under the box shows this, so you can see the mistake.
- **On a phone with a screen only 320 points wide, name tags are not yet repaired.** The text of a name tag is about 8.5 pixels there.
- **A tag for two far partners shows "2 partners".** A tag that shows both names is for a later version.

## 0.5.3

### Repairs

- **"Save as picture" (PNG) now uses the font of your notes.** Before, a font from a CSS snippet showed in the tree. The PNG showed a standard font, and a long name could be wider than its card. If the plugin cannot read the font file, the PNG uses a standard font, and the cards are wide enough for that font.
- **On Android, the bars of the windows no longer go behind the status bar of the phone.** Before, Cancel, Save and the search field of a person list were behind the clock. On an iPhone, nothing changes.
- **Esc now also closes the legend when you opened it with the mouse.**
- **The hint above the problem list now says "Select Open next to a problem to correct it."** Before, it named an "Open button", but the problem row shows a link.
- **In the window of a new person, the hint in the Name field now shows in full.** Before, on a phone, the plugin cut the hint "For example: Edmund Vane". Now Name and Sobriquet have a row each.
- **On a phone, a long house name at the top of the person window now uses two text lines.** The title and the years move down below the house name. Before, the house name ran over the title.
- **In the phone list, the pictures in the row of the person marked "This is me" now line up with the pictures in the other rows.** Before, they stood 8 pixels further to the right.
- **When you open a menu from a bar, no small hint text (a tooltip) stays over the menu.** Before, a tooltip could cover the first item of the More menu.

### Tree

- **On a phone, the relation view now shows both people that you chose.** The first view zooms out until both cards are on the screen. For this, the card text can be smaller than the 12-pixel minimum of 0.5.2. If very many people stand between the two people, the plugin does not zoom out so far. Then the second person can be off the screen. Before, one of the two cards could be outside the screen.
- **When you show a line of succession, the heirs keep their numbers when you zoom out.** At a middle zoom level, each heir card has a small ring with its number, for example "1". On a computer and on a tablet, the ring also shows at the smallest zoom level. A phone shows no ring at that level. At the largest zoom level, the card keeps its label, for example "1st". Before, the numbers showed only at the largest zoom level.
- **In the legend, the row "Illegitimate child (no dashed line)" now stands directly under "Illegitimate child".** So the two rows about illegitimate children are together. The legend of a saved picture uses the same order. Before, the row stood last in the group "Lines".
- **A screen reader now says "born" and "died" for the years of a card.** For example, "Roderick Valmont, born 1131, died 1161". The card still shows "b." and "d.".
- **When you add the first person to an empty tree, the plugin now removes its own help comment.** This is the text line `# To add the first person, select "Add first person" in Reading view or Live Preview.` The plugin removes only this exact text line. Your own comments stay.

### Begetter: a new type of parent

- **A parent can now have the type "Begetter".** A begetter is a parent by blood who does not raise the child as a parent in the family. For example, two women are married and have a child. A man is the father of the child by blood. He is the begetter. The same type is for a woman who is the mother by blood of a child of a couple of two men.
- **To add a begetter, choose "Begetter" as the type of parent.** Add parent and Add child show it with the other types. In the Family section, you can also change "Type of parent" next to a parent. In the tree text, write `{id: oswin, type: begetter}`. Here "oswin" is the ID of the begetter.
- **An older version of the plugin reads "begetter" as a birth parent, with a warning.** It draws the begetter as a normal birth parent and names the begetter "Father".
- **The tree draws a begetter with a thin orange line of long and short dashes.** The line goes in a curve from the begetter to the child. It has no marriage dot and no line to the mother of the child. The line uses the orange of your theme, in light mode and in dark mode. The legend shows it as "Begetter: a parent by blood, not a parent in the family".
- **The relation names follow the blood relation.** The child sees the begetter as "Begetter". The begetter sees the child as "Begotten son", "Begotten daughter" or "Begotten child". The parents of the begetter are grandparents of the child.
- **The other children of the begetter are brothers and sisters, or half-brothers and half-sisters.** A child of the begetter who has the same other parent by blood is a brother or a sister. A child of the begetter with other parents is a half-brother or a half-sister.
- **The wife or the husband of a begetter is "Begetter's wife" or "Begetter's husband", not "Stepmother" or "Stepfather".** The phone list uses the same words.
- **The titles of a begetter do not pass to the child.** The child is not in the line of succession of the begetter. The child still inherits through a birth parent. The child also inherits through an adoptive parent, if the title lets adopted children inherit. The hint in the rules of a title now says "No claim passes through a guardian, a rumoured parent or a begetter."
- **A person can have at most 2 parents by blood. Birth parents and begetters count together.** The windows do not let you add a third. If the setting "Warn about more than 2 parents" is on, a tree text with more parents by blood gives a warning. Before, the name of this setting was "Warn about more than 2 parents of a type".

### Relation names

These repairs change names mostly in trees with rumoured parents. The first repair also changes names in a tree where a child lists three birth or adoptive parents. The last repair is different. It changes the steps in the relation view. This happens in two cases. One case is a tree with adopted children. The other case is a tree where the same two people have a marriage and also an affair or concubinage. You do not need to do anything. The tree text in your notes does not change. The plugin corrects the names and the steps by itself.

- **The order of three parents in the tree text no longer changes the names of other people.** Before, the order of the three parents could decide whether two of them counted as partners. Now the order never decides. For example, two women each have a child, and each woman adopts the child of the other. A third child lists these two women and one more parent. Before, the first child could see the second child as "Adoptive brother". Now the name is "Adoptive half-brother", because nothing in the tree says that the two women are partners.
- **A rumour no longer removes a sure relation by marriage.** For example, a person who is a rumoured father and a rumoured half-uncle now also keeps "Uncle by marriage".
- **A rumour no longer adds a false "half" to a name.** For example, a mother has a son, and her husband adopts him. The son is a brother of their other children. For the son, the rumoured grandchild of one of those other children is now a "Rumoured great-nephew", not a "Rumoured half-great-nephew".
- **A rumoured mother who is the wife of the father is no longer also a "Stepmother".** The person window now names her "Rumoured mother" and "Father's wife". From her side, it says, for example, "Rumoured son" and "Husband's son".
- **A former sister-in-law now has one name.** For example, the person window shows "Former sister-in-law" only, not also "Rumoured former sister-in-law".
- **A husband no longer has a rumoured name that his wife does not have.** For example, the person window of the husband shows "Wife's rumoured half-great-nephew" only if the person window of the wife shows "Rumoured half-great-nephew".
- **The steps in the relation view now agree with the relation name.** If a marriage makes the relation, the steps name the marriage, not an affair of the same two people. If the name has no "adoptive", the steps go through the birth parent, not the adoptive parent.

### Titles, Houses and lists

- **After Save in the Titles window or the Houses window, a message with Undo now shows.** For example, "The plugin saved the title Lord of Testmark." Before, the window closed with no message.
- **A new title now has the button "Save and show" in its Line section.** It is a small button at the right of the sentence "Save the title first. Then you can show the line of succession.", like the button Show of a saved title. It saves the title and shows its line of succession on the tree.
- **When you add a title or a house, the new page now opens with no cursor in a field.** On a phone, the keyboard does not open until you tap a field.
- **On a phone, the ID window now shows the full name of the title or the house above the field.** The name is the label of the field, and a long name uses more text lines. The bar says only "ID". Before, the bar said "ID of" and the name, and the plugin cut a long name, for example "ID of House Valmont of the ce…".
- **The row "A holder who is not in the tree" now stays under the list of people.** It is always on the screen. Before, it stood at the end of a long list.
- **The bar of a line of succession now also names the rule.** For example, "Line of succession: Lord of Testmark, 1203 · Eldest child first (primogeniture)". The rule is in grey text, so the title and the year are easier to see. On a phone, the bar shows the full text on up to 3 text lines.
- **If the first heir is not a child of the ruler, a short text line above the heirs now says why.** The text line shows only when the plugin is sure of the reason. For example, "Konrad VI has no child in the tree. So the first place in the line goes to Jadwiga, the sister of Konrad VI."

### Windows

- **Name and Sobriquet now have a row each in every person window.** Before, only the window of a new person had this form. In the window of a person in the tree, the two fields shared one row.
- **After you change the type of a parent, the person window now shows a text line with Undo.** For example, "The plugin changed Aldric from a rumoured parent to a birth parent of Edric." Before, no text showed.
- **A message with an Undo button no longer ends with "You can undo this."** For example, this was the case after you removed a parent or a partner. The button already says it.
- **The link "Show the line" in the person window now shows only when there is a line to show.** Before, it also showed for a person with no relation to the person marked "This is me".
- **A screen reader now reads the link that removes an era as "Remove this era:", then the name of the era.** This is the same form as the link that removes a calendar.

### Known limits

- **On a phone, the ring with the number of an heir can cover a small part of the card above the heir.** The name on that card stays readable.
- **In a tree in a note, you must scroll the open legend to see its last row.** The new Begetter row makes the legend a little taller than the space for a tree in a note. The last row is "Counted as dead". In full screen, the whole legend shows.

### Also in 0.5.2

- **Version 0.5.2 also repaired the order of the parts of names that mix Arabic or Hebrew letters with Latin letters.** Before, the parts of such a name could show in the wrong order. This applies to the cards, the lists and the windows, also on an iPhone. The release text of 0.5.2 did not name this repair.

## 0.5.2

### Repairs

- **The top of the person window now stays still when you type.** Before, the name, the line under it with the house, the title and the years, the arms of the house and the portrait flickered with each key. Now only the part that you change shows again.
- **In the window where you choose a portrait or arms, a folder inside a folder now stands further to the right.** Before, it stood at the same left edge as the folder around it. Now each level of folders moves right by the same distance.
- **On a phone, the title of a window now stands level with Cancel and Save.** Before, the title stood a little higher.
- **The phone list stays at the person that you chose.** Before, it could go back to the first person of the tree when Obsidian showed the note again, for example after you turned the phone.
- **In the problem list, each "Open …" link is now large enough to tap with a finger.** Before, the link was hard to tap.
- **On a computer, the fields in the person window now keep their width when a scroll bar shows.** Before, they became narrower.

### Tree

- **Each card has one clear edge, a little darker than before.** The thin line above the relation word is gone.
- **The text on a card is now never smaller than 12 pixels.** If the text of your notes is smaller than that, the card text stays at 12 pixels and the card grows to fit it.
- **The lines for wards and rumoured parents have clearer patterns.** The dots of a ward line have wider gaps. The dashes of a rumoured line are longer. The colours of the lines stay the same.
- **The legend has the title "Legend" and two groups.** The groups are "Lines" and "Death labels". The two death labels are shorter, for example "Dead: the year of death is not known". The saved picture shows the same labels.
- **A tree with one person now shows a hint** that says how to add a partner, a parent or a child.
- **On a phone, with the tree direction "Sideways", the full-screen view now opens with 16 pixels between the first card and the edge of the screen.** Before, it left 8 pixels.
- **With a mouse, the rows of the More list are now less tall.**
- **The window "Save as picture" now shows its title and uses round option buttons.**

### Phone

- **The icons in the bars now have the same size as the icons of Obsidian.** On a computer, the icons do not change.
- **Buttons now have fully round ends**, the same as the buttons of Obsidian on an iPhone. Text fields keep their small round corners.
- **The rows of the phone list now reach the edges of the list.** The bar icons and the pencil icons stand in one column. When you select a row, the whole row gets a light colour.
- **After you add a person from the bar, the list now stays where it is.** A message names the new person and says how to find the person.
- **After you add a partner or a child to a person, the list now stays at that person.**
- **On a phone, a tree in a note now shows its problems in a small pop-up.** For example, the pop-up says "This tree has 2 problems." It has one button, "Show in full screen", which opens the full-screen view with the problem list.

### Windows

- **An error message now shows under its field.** For example, "Enter a name." stands under the Name field. The top of the window no longer moves.
- **If a window already saved a change, the left button now says "Close".** Before, it said "Cancel", but the change was already saved.
- **If you typed a change, Cancel now asks "Discard changes?"**, the same as the Esc key.
- **On a computer, Enter now moves the cursor to the next field.** Ctrl+Enter (Cmd+Enter on a Mac) saves. The Save button shows these keys.
- **The partnership window now says "Kind", not "Type of partnership".** Start and End stand side by side.
- **The partnership window shows what you changed.** After Save, a message with Undo names the two people. In the Family section of the person window, a partner row says, for example, "Marriage, 1126–1131, ended by divorce".
- **A window that asks you to choose, for example the other parent of a new child, now shows plain options with no coloured fill.** As before, one tap takes you to the next step. On a computer, the window now shows its title.
- **The ID window is easier to read.** The label stands above the field. "Make ID from the name" is a link. An error message shows under the field.
- **In the Family section of the person window, each group now takes only the space that it needs.** Portraits line up inside a group.
- **When you open a section of a window, the window now scrolls so that you can see the section.**
- **The field "Title text on the card" is now "Title shown under the name".**
- **Check boxes are now square**, so they do not look like option buttons.
- **After you remove a parent or a partner, the result now shows inside the open window**, with Undo. The message no longer covers Cancel and Save.
- **The crop tool is now called "Crop the portrait".** The name of the person stands under the title.
- **Each Undo message now says what the plugin undid.** For example, "The plugin undid the deletion of Edric Valmont."

### Titles, Houses and lists

- **The Titles and Houses lists now have one left edge and no circle with an icon.** A tap on a row opens the title or the house.
- **On a phone, the bar now says "Title" or "House".** The heading with the full name stays.
- **A tap on a holder row now opens the details of the holder.** There you find "Show the card in the tree", Move up, Move down and Remove.
- **On the page of a house, the colours from its arms now have the label "From the arms".**
- **In a list of people, Enter now chooses the first match.** "Create a new person" is the last row if a person matches your text. It is the first row if no person matches.
- **You can now use the Rules section of a new title** before you save the title.

### Calendars

- **The Calendars window now starts with one sentence** that says what a calendar does.
- **An era now takes two rows, and a text line under them shows how the era reads.** For example, "Qinglong Emperor 1 = year 130". All number fields have the same width.
- **The hints in the fields now give an example.** For example, "A cycle number of this calendar. For example: 3."
- **The section "Plain years" now has one short text** that explains plain years and name lists.

### Settings

- **The help texts for "Arms on cards" and "Tree direction" are now shorter.**
- **The choice "Founders and holders" now fits on a phone.**

### Known limits

- On a phone, the name of a parent with a portrait can break onto two text lines in the person window.
- On a phone, the title of the ID window is cut. For example, "ID of House Valmont of the ce…".
- After you remove a parent or a partner, the text in the window ends with "You can undo this." The Undo button stands next to it, so the text says the same thing twice.
- In the phone list, the text of a row is now 8 pixels narrower than in 0.5.1. As a result, about 1 name in 500 needs one more text line.
- If many holders match the name that you type, "A holder who is not in the tree" stands at the end of a long list.
- The grey stripe of a person with no house looks almost the same as the card edge.
- The iPad was not tested for this version.
- On a phone, the relation view of two people can cut off a card at the edge of the screen.
- A curved line for a rumoured link, or for a parent who is drawn elsewhere, can pass over a card. A better route for these lines comes later.
- A lover at the end of a group of partners can still have a long line that crosses other lines.
- A name tag with a long name can show only part of the name.
- A date after an Arabic house name in the same text line can still show in the wrong order.
- A name by marriage that differs from another name only by "adoptive" or "rumoured" does not show. For example, "Wife's adoptive half-nephew" does not show.
- A divorce gives the word "Former" only in two cases. You choose "Ended by", or the end year is before the death years of both partners. In the second case, all three years must be exact. Otherwise no word changes.
- If a child is born in the year after the father died, the card of the father's wife says "Father's wife", not "Stepmother". The plugin cannot know that the child was conceived before the death.
- If a CSS snippet loads the font of your notes, a saved picture uses a standard font. A long name can then be wider than its card.
- If you replace a picture file with another file of the same size and the same time of the last change, the plugin can show the old picture until you change the file again.

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
