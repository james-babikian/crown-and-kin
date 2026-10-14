# Dynasty Tree

Dynasty Tree is an Obsidian plugin. It shows the family tree of a fictional dynasty in a note. You can edit the tree on the computer and on the phone.

The plugin stores the tree as text in a `dynasty` code block in your note. The plugin draws the tree from that text. When you edit the tree, the plugin changes only the text lines that must change. It keeps your comments and the way you wrote the text.

## Start a tree

1. Open a note.
2. Put the cursor where the tree must go.
3. Open the command list.
4. Select "Insert family tree".
5. In the tree, select "Add first person".

You can also type the code block yourself. See "The tree text" below.

## Use the tree

- **Edit a person.** On the computer, click a card. On a phone, tap the pencil of a row in the list. The person window opens. Change the fields. Then select Save. To close the window, select Cancel or push Esc.
- **Add relatives.** In the person window, open the section Family. At the heading Parents, Partners or Children, select **Add**.
- **Move and zoom.** On the computer, drag the tree. To zoom, hold Ctrl and turn the mouse wheel.
- **Move and zoom on a phone or a tablet.** On a phone, a tree in a note is a list (see "The tree in a note on a phone"). On a tablet, the tree in a note does not move. Tap Expand to open the full-screen view. Move the tree with one finger. Zoom with two fingers.
- **Full-screen view.** Select Expand. Select the X button to close it. You can also push Esc. See "The full-screen view".
- **Find.** Select Find. Type a name. Find ignores capital letters, accents and the look of the apostrophe. Each row shows the name, the relation to you, the years and the title.
- **Focus.** Select Focus. A short list opens. Select Choose a person to focus on a person. If a person has the mark "This is me", the list also has Focus on you. While a focus shows, the list also has Clear focus. The tree shows only the family of the person in focus.
- **The "+" sign.** A "+" sign on a card shows that the person has more relatives outside the view. Select the sign to show the family of that person.
- **Pin.** In the person window, open the section Actions. Select "Pin focus here". The tree then always opens on the family of that person. Select "Remove pin" to stop this. The pin stays in the tree text. Clear focus shows all people until you close the note. It does not remove the pin. When you open the note again, the tree opens on the pin again.
- **Houses.** Select the Houses button (the castle). The Houses window shows a list of the houses. You can search the list and add a house. Select a house to change its name, colour or arms, or to delete it (see "The Houses window"). On a phone, the Houses button is only in the full-screen view.
- **The buttons.** The toolbar of a tree is one row above the tree. On the computer, the buttons are in this order:
  - **Add person** adds a person.
  - **Find** selects a person in the tree.
  - **Focus** shows the family of one person.
  - **Fit** fits the whole tree in the window.
  - **Houses** (the castle) opens the Houses window.
  - **Titles** (the crown) opens the Titles window.
  - **More** (the "⋯" button) opens a list with Show the line styles (the legend), Relation and Save as picture. The last item is "Show the tree text". It opens the note for edits and shows the text of the tree. It shows only if you can edit the note.
  - **Expand** opens the full-screen view. **Close** closes it.
  - A **warning button** shows when the tree has problems. Select it to see the list.

  On a phone, a tree in a note is a list (see "The tree in a note on a phone"). The list has a bar of icon buttons: Add person, Tree text, Find, Back and Expand. The buttons show an icon and no words. A screen reader says the full name of each button. The Tree text button does the same as "Show the tree text". If the tree has problems, the bar also has the warning button. In the full-screen view on a phone, the bar is at the bottom. It has Add person, Houses, Focus, Find, More and Close. The More list there also has Fit the tree in the view and Titles. A tree that you cannot edit shows Open note instead of Add person and Houses. An example is a tree in an embed or on a Canvas card.
- **Commands.** The command list has four commands:
  - **Insert family tree** puts a new tree in the note at the cursor.
  - **Undo last tree edit** reverses the last edit of a tree.
  - **Show the last link update** shows how many links the last rename changed.
  - **Show render timing** shows how long the last tree took to draw.
- **Undo.** After you remove or delete a person, a parent link, a partnership, a title, a holder or a house, the plugin shows a message with Undo. The message also has Undo after you change an ID or make a note. To undo a different tree edit, use the command "Undo last tree edit".
- **Keyboard.** Push Tab to go to the toolbar buttons, the cards, the tags, the fold buttons and the "+ N" signs. Push Enter to open a card. Push Esc to close a list or a window.

## The full-screen view

The full-screen view shows the tree in the whole window. Select Expand to open it. Select the X button, or push Esc, to close it.

- **Tree direction on a phone.** If you hold the phone upright, the tree in the full-screen view turns sideways. The generations go from left to right. Scroll down to see more of the tree.
- **A phone on its side.** A phone on its side, a tablet and a computer always show the tree from top to bottom.
- **The bar on a phone.** The full-screen view has no Fit button and no Titles button in the bar. Select More (the "⋯" button) in the bar. The list has "Fit the tree in the view", "Titles" and "Show the line styles". This keeps the bar in one row, so the Close button is always on the screen.

To change the direction on a phone:

1. Open the settings.
2. In the group Cards, find "Tree direction on a phone held upright".
3. Select "Like the computer".

The generations then go from top to bottom. The setting is the same for all trees. If you change the setting while the full-screen view is open, the tree turns at once.

## The person window

The person window has a header and five sections. The header shows the portrait (a round picture), the name and the house. If the tree has a mark, the header also has a text line with the relation to you (see "This is me and relations"). If the person has personal arms, a small shield shows after the name (see "Coats of arms").

- **The sections.** The sections are Details, Family, Titles, Notes and Actions. A section opens and closes when you select its name. A closed section shows a short summary, for example "2 parents · 1 partner · 1 child". Details is open when the window first opens. The window remembers the sections that you open until you close Obsidian.
- **Open all.** Select **Open all** to open every section. The button then reads **Close all**. A window with one section has no such button. If the person has a linked note, the link **Open linked note** stands left of **Open all**. Select it to open the note.
- **Details.** Details has the name, the sobriquet, the title text, the house, the sex and the dates. It also has the boxes **Illegitimate** and **No children**.
- **Family.** Family lists the parents, the partners and the children of the person. At each heading, select **Add** to add a parent, a partner or a child. A child row opens that person in the same window. To return, select the back button at the top of the window. It shows an arrow and the name of the earlier person. If the person has brothers or sisters, the group **Position among siblings** has the buttons **Move earlier** and **Move later**. They change the place of the person among the children of the same parents.
- **Notes.** Notes has the link to a note and your own text.
- **Actions.** Actions has Focus here, Pin focus here, This is me, Hide descendants, Make a note and Delete person.
- **The portrait menu.** Select the portrait to open a short menu. The menu has Select portrait, Select the part of the portrait, Remove portrait, Select personal arms and Remove personal arms. A person with no portrait has the small link **Add portrait or arms** left of **Open all**. If the person has personal arms, the link reads **Add portrait**. If the person has a portrait, the link is not there. A person with no portrait and no arms shows no empty circle and no empty shield.
- **A new person.** Fill the fields. Then select Save. A new person can have a portrait only after the first Save.

## The tree in a note on a phone

On a phone, a tree in a note is a list. The list shows one person and the family of that person. The list has its own height, and the note scrolls over it. You cannot move or zoom the list.

- **What the list shows.** The person is the first row, at the top. Under the person are the sections "Parents", "Partners" and "Children", in the order of the tree. A heading reads "Parent" for one row and "Parents" for more rows. "Partner" and "Child" follow the same rule. The children are in groups. A child of the person and a partner is in the group "With NAME". A child with no partner in the list is in the group "No partner listed". A child with only an adoptive, ward or rumoured link is in the group "Other children". If the person and a partner have that child together, the child is in the group of that partner. A small heading shows the name of each group only when the person has more than one group.
- **The top row.** The top row shows the name in a larger size, the years, the title, and the pencil. It has no frame. If the person has a portrait, it shows at the right of the row. If the person has personal arms, or else a house with arms, the shield shows under the portrait. Only the top row shows arms. The setting "Arms on cards" does not change the list.
- **The other rows.** A row shows the name, a grey text line, the title and the colour bar of the house. If the person has a portrait, it shows small at the right. A person with no portrait has no empty circle. If the tree has a mark and "Show relation names on cards" is on, the grey text line also has the relation to you. The marked person shows "You" in bold.
- **The kind of parent and child.** If a parent or a child has a link that is not an ordinary birth link, the grey text line starts with a word for the link. For a parent, the word is "Adoptive father", "Adoptive mother", "Adoptive parent", "Guardian", "Rumoured father", "Rumoured mother" or "Rumoured parent". For a child, the word is "Adopted son", "Adopted daughter", "Adopted child", "Ward", "Rumoured son", "Rumoured daughter" or "Rumoured child". A birth parent has a word only when the person also has an adoptive parent. The word is "Birth father", "Birth mother" or "Birth parent". These words show also when "Show relation names on cards" is off. If the list is not about you, the relation to you follows the word, for example "Guardian · Adoptive grandfather".
- **Move the list.** Tap a name. The list then shows the family of that person. Tap **Back** to show the person before. Tap **Find** to select any person in the tree. If you move the list, the plugin writes nothing to the note.
- **Edit a person.** Tap the pencil at the right of a row. The person window opens. For the person in the top row, tap the whole row.
- **Where the list starts.** The plugin picks the start person in this order. First is the person that you chose last in this note. Next are the pin, then the marked person, then the person that you edited last. Then comes the oldest person who has children. The last choice is the first person in the tree.
- **The bar.** The bar above the list has icon buttons and no words. The buttons are Add person (a person with a plus), Tree text (code), Find (a magnifier), Back (an arrow, after you move the list), the warning button (if the tree has problems) and Expand (arrows that point out). A screen reader says the full name of each button.
- **Expand.** Tap **Expand** to open the full-screen view. You can move and zoom the tree in the full-screen view.
- **What the full-screen view shows first.** If you pinned a person, the view shows the family of that person. If you moved the list, the view shows the family of the person that the list shows. If you did neither, a tree of 100 people or fewer shows all people. A tree of more than 100 people shows the family of one person. The plugin picks this person in this order: the person that you edited last in this session, the person in the option `start` of the tree text, the marked person ("This is me"), and then the first person in the tree. When the view shows one family, select Focus to see all people. Then select Clear focus.
- **After you save a person.** The list moves only if you have not chosen a person in the list, and the tree has no pin and no mark. In that case the list shows the person that you saved. In all other cases the list does not move. If the saved person is in the list, the row has a thin outline for two seconds. If the person is not in the list, a message tells you to tap Find.
- **A tablet** does not show the list. It shows the tree in the note, and you cannot move or zoom this tree. Tap Expand to move the tree.
- **Settings.** The list follows "Show dates on cards", "Show relation names on cards", "Show portraits on cards" and "Assume an unknown second parent". The height of a tree in a note does not change the list.

"Save as picture" and the full-screen view always show the tree, not the list.

## Change the ID of a house or a title

The ID is a short name. The plugin uses it to find a house or a title. You rarely need to change it.

1. Open the window of the house or the title. For a house, select the Houses button (the castle). For a title, select the Titles button (the crown). On a phone, select More (the "⋯" button), then select Titles.
2. Select the house or the title in the list. The page opens.
3. Open the section "Other actions", at the end of the page. Select **Change ID**. A small window opens.
4. Type the new ID, or select **Make ID from the name**.
5. Select **Use this ID**.
6. Select **Save**. The plugin asks you to confirm the change.
7. Select **Change the ID**. The plugin changes the ID in the text of each person who uses the house. It also changes the text of each person who chose the title with "Show on the card".

To keep the old ID, select **Keep old ID** on the page before you select Save. A new house or title has no Change ID until you save it.

## This is me and relations

You can mark one person in the tree as you. Each card then shows the relation of that person to you.

- **Mark a person as you.** Open the person window of the person. Open the section Actions. Select "This is me". If another person has the mark, the mark moves to this person.
- **The card "You".** The card of the marked person shows "You". It also has a thicker border in the colour of the text. The border does not use the accent colour of your theme.
- **Relation names on the cards.** When the tree has a mark, each card gets a band at the bottom of the card. The band shows the relation to you, for example "Father", "Half-sister" or "Second cousin once removed". All cards get a little taller. A card of a person with no relation to you has no relation name. The text of that card is in the middle of the card. If the tree is very small on the screen, the cards do not show the relation names.
- **The header of the person window.** If the tree has a mark, the header has one text line. It reads, for example, "Your second cousin · 3 more · Show the line". This is the same on a computer and on a phone. A person can have more than one relation to you, for example after a marriage between cousins. Select "3 more" to open a text line that starts with "Also:" and gives the other relations. The text line of the marked person says "This is you." A person with no relation to you has the text "No relation to you in this tree."
- **A relation through a rumour.** A relation name that depends on a rumoured link starts with "Rumoured", for example "Rumoured stepmother" or "Rumoured sister-in-law". A rumoured link never hides a relation that is sure. The sure relation stays in the list "Also".
- **A rumoured parent.** A rumoured parent is a parent whose link has the type "Rumoured parent". The plugin does not count this link as sure. If a person has a rumoured parent and fewer than two other parents, one parent is not known.
- **Half or full, maybe.** The plugin first works out the relation without the rumour. For example, Tom lists Anna as a parent and Carl as a rumoured parent. Sue lists Anna and Carl as parents. Without the rumour, Tom and Sue show as half-siblings. If the rumour is true, they are full siblings. For Sue, the card of Tom says "Half-brother, maybe full". In the other case, a rumoured parent can make two full siblings into half-siblings. Then the card says "Sister, maybe half".
- **The rumour in the person window.** If the rumour can change the relation, the person window has one more text line. It reads "If every rumoured link is true, this person is your …", and the relation name.
- **More than one rumoured parent.** A person has only two true parents, but you can list up to 8 rumoured parents. If a person has two or more rumoured parents, only some of the rumoured links can be true. Then the text line says "If some of the rumoured links are true, this person is your …". The list "Also" can say "Rumoured brother".
- **A long relation name.** If a relation name with "maybe" is too long for the card, the card cuts the name. The card shows " ?" at the end. The person window shows the whole name.
- **One listed parent.** If you list only one parent for a person, the second parent is not known. By default, two people who list only the same parent show as half-siblings. The card says "Half-sister, maybe full". The person window then says what must be true. Two forms are possible. If both people list the same one parent, the text line reads "If the parent that the note does not name is the same person for both, this person is your …". If one person lists both parents and the other lists one of them, it reads "If this person’s other parent is also your parent, this person is your …". The same rule applies to a half first cousin and to other half relations. If you list only fathers, turn off the setting "Assume an unknown second parent" (group Cards). Then two people who list only the same parent show as full siblings.
- **Show the line.** In the header of the person window, select "Show the line". The relation finder opens with the line from you to the person (see "Relation finder").
- **Remove the mark.** Open the person window of the marked person. Open the section Actions. Select Remove "This is me".
- **Hide the relation names.** In the settings, turn off "Show relation names on cards". The cards are then shorter, and the marked person has a small "You" tab on the card. The person window, Find and the lists of people still show the relation.
- **The small label.** A small label can show the relation of a person. It shows only if the tree has a mark and "Show relation names on cards" is off. On a computer, rest the pointer on a card for a short time. You can also push Tab to go to the card. The label then shows the relation of that person. The marked person has no label. A pointer on a linked name shows no label. A phone shows no label.
- **Undo.** The command "Undo last tree edit" undoes "This is me" and Remove "This is me". If the note is open in Live Preview, Ctrl+Z (Cmd+Z on a Mac) also undoes them.

The mark is in the tree text. All your devices show the same mark.

On a phone, the list in a note starts on the marked person. If the tree has a pin, or if you chose another person in the list, the list starts there. If you edit another person, the list stays on the marked person. The list stays on the marked person until you choose another person, or until you move or remove the mark. Your choice of another person holds until you close the note.

## Relation finder

The relation finder shows the relation between two people in the tree. It does not change the note.

To find a relation from the toolbar:

1. In the toolbar, select More (the "⋯" button).
2. Select Relation.
3. Select the first person. If the tree has a mark, the first row of the list is "You".
4. Select the second person.

To find a relation from the person window:

1. Open the person window of a person.
2. Open the section Actions. Select "Show the relation to…".
3. Select the other person. If the tree has a mark, the first row of the list is "You".

On a phone or a tablet, the tree in a note has no More button. First tap Expand to open the full-screen view. In the tree in a note, "Show the line" and "Show the relation to…" open the full-screen view with the result. The tree in the note does not change.

The result:

- A bar at the top of the tree shows one sentence, for example “Wren is Roderick’s half-sister.” The sentence gives the relation of the second person to the first person. On a phone, the bar is one row with the sentence, the link **Options** and the X button. **Options** opens a short list with Show the steps, Other relation and Show in the whole tree.
- The tree shows only the people on the line between the two people. The line is thicker and in the accent colour of your theme. On a phone, this small tree goes from top to bottom, so that it fills the screen.
- Select **Show the steps** to see the steps of the line as short sentences. At most 8 steps show. Then a text line says, for example, "and 4 more steps". Select **Hide the steps** to hide them.
- If the two people have more than one relation, select **Other relation** to see the next relation.
- Select **Show in the whole tree** to see the line in the whole tree. The other cards become pale. Select **Show only the line** to see only the line again.
- Select **Close**, or push Esc, to close the result. The tree then shows what it showed before.
- Some relations have no name. Then the bar tells how many other people are on the line between the two people. Select Show the steps to see each step.
- If two people have no relation in the tree, the bar tells you. The tree does not change.

The result stays until you select Close or close the note. If you edit the tree, the plugin finds the relation again.

## Titles and reigns

A title (for example "Duchy of Valmont") has a list of holders. The list starts with the first holder and ends with the newest holder. A holder can have a number (for example "II") and a reign (the years of the holder).

- **The card.** The card of a holder shows the title with the reign, for example "Duke of Valmont (r. 1175–1207)". If the text is too long for one text line, it continues on a second text line. Then only that card is taller. If the holder has a number or a ruler name that you wrote, the card shows the ruler name instead of the name. A number follows it, for example "Aldric II". The person window and the list of holders show the full name.
- **Two or more titles.** The card shows the first title of the person in the list of titles. To show another title, open the person window. Open the section Titles. Select "Show on the card" at that title. The title that the card shows says "On the card".
- **Your own title text.** If a holder has your text in the field Title text on the card, the card shows that text. The reign of the first title follows it. If you select "Show on the card" at a title, the card shows that title instead of your text.
- **The section Titles.** The section Titles of the person window shows each title of the person with the number and the reign. Select **Edit** to change the number, the ruler name, From or Until. A text line under the fields shows the result, for example "Ser Darian Harrow shows as: Darian II". Select **Add title** to add the person as the newest holder of a title, or of a new title.
- **Remove.** In the section Titles, each reign of a title has its own **Remove**. **Remove** removes only that reign from the holders. If the person has other reigns of that title, they stay.
- **The Titles window.** In the toolbar, select the Titles button (the crown). On a phone, select More (the "⋯" button), then select Titles. The window shows a list of the titles of the tree. Each row shows the name of the title, the number of holders and the newest holder. Select a row to open the page of that title.
- **Search and Add.** Type in the search field to find a title. A title matches by its names, its ID or the name of a holder. Select Add title, beside the search field, to add a title. The page of the new title opens.
- **The page of a title.** The page has these sections: Names, Holders, Line of succession, Rules of succession and Other actions. A closed section shows a short summary. Select **Open all** to open every section. In Other actions are **Change ID** and **Delete**. You can change the ID of a saved title (see "Change the ID of a house or a title"). If you delete a title that you saved, the plugin asks you first.
- **Names.** The name of a title is the name of the place that it rules, for example "Duchy of Valmont". The section Names has the fields "Name of the title", "Name for a man" and "Name for a woman". In "Name for a man", type the name of the title for a man, for example "Duke of Valmont". In "Name for a woman", type the name for a woman, for example "Duchess of Valmont". The card and the person window of a man show the name for a man. The card and the person window of a woman show the name for a woman. If this name is empty, they show the name of the title. The card of a holder whose sex is not male or female shows the name of the title too.
- **The list of holders.** The list of holders and the note with the table use the name of the title. If your tree text has the key `plural`, they use that name. The window does not show or change `plural`. It keeps the key when you save.
- **Holders.** Each holder has a menu button (three dots). The menu has Edit, Move earlier, Move later and Remove. Select **Add holder** to add a holder. Select the name of a holder who is in the tree to see the card in the tree. The window then closes. If you did not save your changes, the plugin asks you first.
- **A holder who holds the title through the spouse.** In the menu of a holder, select **Edit**. Tick the box "Holds the title through the spouse". The line of succession then follows the relatives of the spouse. It works as if the spouse held the title (see "A holder who holds the title through the spouse"). The box is not available for a holder who is not in the tree.
- **A holder who is not in the tree.** A holder who is not in the tree shows in pale text. To add such a holder, select Add holder. Then select "A holder who is not in the tree".
- **Save and Cancel.** The Titles window changes nothing until you select Save. Save makes one change, which one Undo reverses. Cancel discards your changes. The back button at the top of a title page shows an arrow and the word "Titles". It opens the list of titles and keeps your changes in the window.
- **A note with the list.** On the page of a title that you saved, select "Make a note with this table", under the holders. The plugin makes a new note with a table of the holders. The note has the name of the list (see "The list of holders"), for example "Duchy of Normandy". The note is in the folder that Obsidian uses for new notes. The note does not change when the tree changes.
- **Find.** Find and the other person lists also find a holder by the ruler name and number, for example "Aldric II".
- **Dates.** If you turn off "Show dates on cards", the cards also do not show the reigns.

On a phone or a tablet, the tree in a note has no Titles button. First tap Expand to open the full-screen view.

## Succession

A title can have a line of succession. The line is the list of people who come after the ruler of the title, in order. You choose the rule in the Titles window. The plugin works out the line of succession from the tree.

1. In the toolbar, select the Titles button (the crown). On a phone, select More (the "⋯" button), then Titles.
2. Select a title that you saved.
3. Open the section **Rules of succession**.
4. Select a rule. The section **Line of succession** shows the line of succession at once.
5. Select **Save** to keep your choices. Select **Cancel** to discard them.

The page of a title that you did not save yet has only the sections Names, Holders and Other actions. At the end of the page, it shows "Save the title first. Then you can set a succession rule." Save the title. After that, the page has the sections **Line of succession** and **Rules of succession**.

The section **Rules of succession** has these choices.

- **Rule.** The rule gives the order of the people. "None" means that the title has no rule.
- **Eldest child first (primogeniture)** (`eldest-child`). The eldest child of the ruler comes first. If that child is dead, the children of that child come before the next child.
- **Youngest child first (ultimogeniture)** (`youngest-child`). This is the same rule, but the youngest child comes first.
- **Siblings before children (seniority)** (`siblings-first`). The oldest generation of the house comes first: aunts and uncles, then brothers, sisters and cousins, then children.
- **Nearest relative first (proximity of blood)** (`nearest-relative`). Nearness is the number of steps through the family. A child is 1, a brother or sister is 2, an aunt, uncle, niece or nephew is 3, and a cousin is 4.
- **Born during the reign first (porphyrogeniture)** (`born-in-reign`). A child that was born while a parent held the title comes before the other children. The holder entry of the parent needs a start year in the field From. If it has none, the rule works like "Eldest child first" for the children of that parent. The window then tells you.
- **Who can inherit.** The choices are "Men only (agnatic)", "Men first in the whole house (semi-Salic)", "Men first (male preference)", "No preference (equal)", "Women first (female preference)", "Women first in the whole house (reverse semi-Salic)" and "Women only (enatic)".
- **The whole house.** With "Men first in the whole house", every man of the male line of the house comes before every woman. This is true for all generations and degrees. A man whose claim comes through a woman is in this group only if "The right to inherit comes from" is "Anyone (cognatic)". "Women first in the whole house" does the opposite.
- **The right to inherit comes from.** This choice says through whom a claim passes. The choices are "The same as Who can inherit", "Men (patrilineal)", "Women (matrilineal)" and "Anyone (cognatic)". The first choice writes nothing. "Eldest child first (primogeniture)" with "Men only (agnatic)" and "Men (patrilineal)" is the Salic law. The window then says so.
- **Year.** The line of succession is for this year. If you leave the field empty, it is for the end of the last reign. If the last reign has no end, it is for now. A child born after this year is not in the line of succession.
- **Children marked as illegitimate.** A child counts here if the box **Illegitimate** is ticked in Details of the person window. The box belongs to the person. It is not the type of a partnership. It applies to both birth parents. The window has three choices: "They cannot inherit", "They inherit after all people who are not marked" and "They have the same right to inherit as the other children". The second choice puts these children after every other person, of any degree.
- **Adopted children can inherit.** If this switch is off, an adopted child has no claim in the adoptive family. The adopted child keeps the claim in the birth family. Wards and rumoured children never inherit.
- **Only descendants of the first holder can inherit.** If the switch is on, the line of succession has only the descendants of the first holder in the tree. The descendants are the children, the grandchildren and so on. The search for relatives stops at the first holder. Named heirs stay in the line of succession. If the ruler is not a descendant of the first holder, only named heirs can inherit. The window says so. For a title that goes to a new house, make a new title with a new first holder. If the first holder entry has only a name, the first holder is the next entry with a person in the tree. The window says so.
- **Named heirs.** A named heir comes before the people that the rule gives. You can name more than one heir, and you can move them. A named heir who is dead, who is not born yet or who rules now is not in the line of succession. The window tells you why.
- **Excluded people.** An excluded person is never in the line of succession. The children of an excluded person stay in it. To exclude a branch, add each person of the branch.
- **Co-rulers.** If two holders rule in the same year, the line of succession is after the last holder that started. The other holders are not in it, unless they are named heirs. The window tells you.
- **The rows.** The section **Line of succession** shows "After" the ruler and the year. Each row has a place, for example "1st", and a name. Select a name to see the card in the tree. A row can have a note. An example is a person who is older than the age in the setting "Warn about people older than" and has no death year. The setting "Length of the line of succession" gives the number of people. A BC year shows as "225 BC".
- **Grey rows.** A grey row is an open branch. An open branch is a person who died and has no children in the tree. The person may have children that are not in the tree yet. The row stands in the place of the children of the person.
- **What an open branch is not.** An open branch is not an heir. It does not use a place in the line of succession. A former holder is never an open branch. A person who is alive in the year of the line of succession is never an open branch. A person who is not born yet in that year is never an open branch.
- **What closes an open branch.** Any child in the tree closes an open branch. This includes an adopted child, a rumoured child and a child with the box Illegitimate. A ward of the person does not close it. A partnership does not close it. The box **No children** closes it too.
- **No children.** If the person had no children, open the person window of the person. In Details, tick **No children**.
- **Age for open branches.** The setting "Age for open branches" hides the open branch of a person who died younger than this age. The notes must show a birth year and a death year. If a year is not in the note, the branch stays.
- **Show.** The button **Show** is in the section **Line of succession**. It is for a title that has a line of succession. If you did not save your changes, the plugin asks you first. Then the plugin shows the whole tree with the line of succession. The first view shows the ruler and the heirs. A bar above the tree says "Line of succession", the title and the year.
- **Outlines and tabs.** Each heir has an outline and a small tab with the place, for example "2nd". An open branch has a tab with "?". The tabs show when the cards are large enough to read. The outline shows at every size.
- **Close.** To leave the line of succession, select **Close** or push Esc. If you choose a person in focus mode, or you use the relation finder, the line of succession also closes.
- **On a phone.** The list in the note shows the same bar, with an X button to close it. The row of each heir says "2nd in line" in place of the relation word. The row of an open branch says "Open branch". After you select **Close**, the list is as it was before, with the relation words.
- **Save as picture.** While the line of succession shows, the picture has the outlines, the tabs and the text of the bar.

### The order of brothers and sisters

The plugin puts the children of one person in this order. First it applies the choice in "Who can inherit" (the rule of sex) and, for "Born during the reign first", the rule of the reign. Then the birth year decides: a child with an earlier birth year comes before a child with a later birth year. This is the same for the children of different partners, and for adopted children who can inherit. "Youngest child first" reverses the order of the birth years.

- **A child with no birth year.** A child with no birth year keeps its place in the order of the `people` list. The children with a birth year take the other places in the order of their years. For example, the `people` list has Anna (1500), Bert (no year) and Cleo (1490). The line of succession is Cleo, Bert, Anna.
- **The same year.** Children with the same birth year keep the order of the `people` list.
- **The note.** If the order of two children next to each other comes only from the `people` list, the section **Line of succession** says so under them. You can add a birth year to change the order. If the birth years and the `people` list do not agree for some children, a second note says so.
- **The cards.** The cards keep the order of the `people` list. The tree groups the children by partnership. So the cards can stand in another order than the line of succession.
- **Change the order of the list.** Open the person window of a child. In the section Family, find the group **Position among siblings**. Select **Move earlier** or **Move later**.

### A holder who holds the title through the spouse

Some holders hold a title in the right of the spouse. To use this, tick the box "Holds the title through the spouse" at the holder (see "Titles and reigns"). The plugin then works out the line of succession from the spouse, as if the spouse held the title.

- **Which spouse.** A partner is a person with a written partnership with the holder, of any type. A person with a shared child also counts. The plugin does not choose a partner whose partnership is a betrothal, a concubinage or an affair. If the holder has one other partner, that partner is the spouse.
- **More than one partner.** The plugin takes the partner who is linked to another holder of the title. A partner is linked to a holder if the partner is that holder, a descendant of that holder or an ancestor of that holder. Only birth links and adoptive links count. The plugin does not look at sex or at the box Illegitimate. If no partner or more than one partner is linked, the plugin shows a warning and ignores the box.
- **A hand-written person ID.** In the tree text, you can write the ID of the spouse after `through-spouse:`. The box then shows as ticked. The ID can name any partner. Untick the box to remove the key.
- **The line of succession.** The relatives of the spouse are in the line of succession. The children of the holder by another partner are not in it, unless the tree links them to the family of the spouse. The spouse is not in it. The next holder follows the spouse too.
- **The window.** The window keeps the holder as the ruler. A note says: "The holder holds the title through the spouse. The line of succession is for the spouse."
- **Warnings.** The plugin warns about the key only for a title with a rule or a named heir. It warns when the holder has no partner, has no marriage, or has several partners and the plugin cannot choose. It also warns when the ID names nobody, names the holder, or names a person who is not a partner.

The tree text keys are `succession`, `inherit`, `inherit-through`, `inherit-illegitimate`, `inherit-adopted`, `heirs-of-body`, `year`, `heir` and `exclude`. A holder can also have `through-spouse`. The window writes only the keys that you changed. A key that you wrote by hand stays as you wrote it.

The person key `childless: true` closes the open branch of a person who died with no children. The person window writes it when you tick **No children**.

````markdown
```dynasty
titles:
  - id: duchy-of-valmont
    name: Duchy of Valmont
    male-name: Duke of Valmont
    succession: eldest-child
    inherit: men-only
    inherit-through: men
    year: 1210
    heir: hugo
    exclude: [osric]
    holders:
      - {person: aldric, from: 1175}

people:
  - id: aldric
    name: Aldric Valmont
    sex: m
    born: 1150
  - id: hugo
    name: Hugo Valmont
    sex: m
    born: 1180
    parents: [aldric]
  - id: osric
    name: Osric Valmont
    sex: m
    born: 1185
    parents: [aldric]
```
````

Some limits of the line of succession:

- **The search for relatives goes to the top of the tree.** The plugin looks at the relatives of the ruler, up to the oldest person in the tree. To stop at the first holder, use the switch "Only descendants of the first holder can inherit".
- **Two parents.** If you choose "No preference", the order of `parents` in the note gives the order of the two sides of the family. Half relatives and full relatives have the same rank.
- **Only the year of a date counts.** If a date is only a number, the plugin reads it as the year, for example "12" or "1203". A number can have groups of three digits, for example "1,250" or "12 000". The plugin then reads the whole number. If a number has BC, BCE, AD or CE beside it, the plugin reads that year, for example "200 BC" or "BC 200". The plugin does not read a part of a grouped number as a year. In other dates, the plugin reads the first number with three or four digits, for example "c. 1203". If a date has no year, the window shows a note.
- **Old versions.** A phone with plugin version 0.2.6 or 0.1.x keeps these keys in the tree text. It does not show the line of succession. An older plugin keeps the key `through-spouse`, but it ignores it.

## The Houses window

A house has a name and a colour. It can also have arms. The colour of a house shows on the cards of the people of that house.

- **The list.** Select the Houses button (the castle). The window shows a list of the houses. Each row shows the arms and the name. A second text line shows a small dot in the colour of the house, and the number of people. Select a row to open the page of that house.
- **Search and Add.** Type in the search field to find a house. A house matches by its name, its ID or the name of a person of the house. Select Add house, beside the search field, to add a house. The page of the new house opens.
- **The page of a house.** The page has these sections: Details, People and Other actions. Details has the field "Name of the house" and the colour. The link **Add arms** is on the page (see "Coats of arms"). People shows the people of the house (see "House page"). In Other actions are **Change ID** and **Delete**. A house that you did not save has no People and no Change ID.
- **The colour.** Select one of the 12 house colours. Select "Other colour" to use the colour window of your device. If the house has arms, the colours from the arms show under a thin line (see "Coats of arms").
- **Delete a house.** If people have the house, the plugin asks you. You can remove the house from these people, or keep the house for them. If you keep the house, the tree shows a warning for each of these people. After you select Save, a message with Undo shows.
- **Save and Cancel.** The Houses window changes nothing until you select Save. Save makes one change, which one Undo reverses. Cancel discards your changes. The back button at the top of a house page shows an arrow and the word "Houses". It opens the list of houses and keeps your changes in the window.

## Coats of arms

A house can have arms (a coat of arms). A person can also have personal arms. The arms are a picture in your vault. House arms show on cards (see "Arms on cards" below), in the Houses window and in the top row of the list on a phone. The legend that you open with "Show the line styles" shows the line styles and the signs for a dead person. It has no houses and no arms.

To give a house its arms:

1. Select the Houses button (the castle).
2. Select the house in the list. The page of the house opens.
3. On the page, select **Add arms**. If the house has arms, select the arms picture, then **Select arms**.
4. In the picture list, select a picture. The first press marks the picture. To see the pictures, open a folder or type a part of the name.
5. To choose the marked picture, select the same picture again, or select the button **Select**.
6. Select **Save**.

If the house has arms, the menu of the arms picture also has **Remove arms**. The picture list also starts with **Remove arms**. Select it to clear the arms in the window. Then select Save. A house with no arms shows no empty frame.

To give a person personal arms:

1. Open the person window of the person.
2. Select the portrait, or the link in the header. The link reads **Add portrait or arms**. If the person has personal arms, it reads **Add portrait**. A short menu opens.
3. Select **Select personal arms**.
4. In the picture list, select a picture. The first press marks the picture. To see the pictures, open a folder or type a part of the name.
5. To choose the marked picture, select the same picture again, or select the button **Select**.
6. Select **Save**.

The menu has **Remove personal arms** if the person has personal arms. Personal arms are for a branch, or for a person who has arms of their own. The card shows the personal arms in the place of the house arms. The key in the tree text is `arms`. It takes the same forms of link as the key `link`, for example `"[[arms.png]]"`, `"[[arms.png|alias]]"`, `"[alias](arms.png)"` or `arms.png`. The plugin finds the file as Obsidian finds a picture in a note. The plugin updates the link when you rename the picture. The problem list names the person in these cases: the picture is not in the vault, the picture is a web address, the plugin cannot show the format, or the picture is too large.

- **Arms on cards.** The setting "Arms on cards" (group Cards) has two values. "Founders, married-in people and holders" shows the arms of a house on two kinds of card. The first kind is a person who has no parent in the same house. An example is a founder or a person who married into the tree. A person whose parents are all in another house is also in this kind. The second kind is a person who holds a title in the Titles window.
- **Every card.** "Every card" shows the arms on each person who has a house. With both values, a card with personal arms shows them in the place of the house arms. A sideways tree and a very small tree show no arms (see "The card" below). The setting does not change the list on a phone.

- **The picture list.** The list shows the folders of your vault that hold pictures. Each folder shows the number of pictures in it. Tap or click a folder to open or close it. The pictures stand in a grid. Each picture has a small preview above its name.
- **The current picture.** When the list opens, the folder of the current picture is open. The current picture has the label "In use". The list always starts at the top.
- **Search.** Type a part of the name in the search field. The list then shows all pictures that match, with the folder below each name. The search ignores capital letters, accents and the look of the apostrophe. On a phone, the keyboard opens only when you tap the search field.
- **Keyboard.** The arrow keys move through the rows. On a folder, the right arrow opens it and the left arrow closes it. On a picture, push Enter to select it. The list then closes.
- **Add a picture from this device.** This is the first row of the picture list. If the list starts with a Remove row, this is the second row. It opens the file choice of your device. On an iPhone, you can select a photo in Photos or a file in Files. The plugin copies the picture into the attachment folder (the folder that Obsidian uses for new attachments) and selects it.
- **The copy.** The plugin copies the picture at once. If you then select Cancel, the picture stays in the vault.
- **Colours from the arms.** If a house has arms, the colour choice has the main colours of the picture, at most 5. They stand under a thin line, after the 12 house colours, and each has a small dot. They show only after the plugin has read the picture. Select one of them to make it the house colour. The plugin never changes the colour of a house by itself.
- **If the colours cannot be read.** If the plugin cannot read the colours of a picture, the window tells you. Then select one of the house colours.
- **The card.** In a tree from top to bottom, the arms show beside the round portrait on the top edge of the card. If the person has no portrait, the arms stand alone there. The arms do not make the text shorter. A sideways tree shows no arms on the cards. If the tree is very small on the screen, the cards do not show the arms. The saved picture follows the same rule.
- **The look of the arms.** The arms keep the shape of the picture. The plugin does not cut the picture and does not add a border or a background. On the card of a person who is dead, the arms are a little pale, like the house colour.
- **Arms in the dark theme.** The plugin shows the arms as they are, in the light theme and in the dark theme. Black parts of arms are difficult to see on a dark card. Give the arms a thin light border in the picture itself. Keep the area outside the border transparent, for example in a PNG picture. The light border then keeps the black parts easy to see.

On a phone or a tablet, the tree in a note has no Houses button. First tap Expand to open the full-screen view.

## Portraits

A person can have a portrait (a picture). In a tree from top to bottom, the portrait is a round picture on the top edge of the card. A sideways tree shows no portrait on the cards.

To give a person a portrait:

1. Open the person window of the person.
2. If the person has a portrait, select the portrait. If not, select the link in the header. The link reads **Add portrait or arms**. If the person has personal arms, it reads **Add portrait**.
3. In the menu, select **Select portrait**.
4. In the picture list, select a picture. The first press marks the picture. To see the pictures, open a folder or type a part of the name.
5. To choose the marked picture, select the same picture again, or select the button **Select**.
6. The tool for the part of the picture opens at once. Move the picture. Then select **Save**. If you close the tool, the plugin keeps the part that it chose by itself.
7. In the person window, select **Save**.

To remove the portrait, select the portrait. In the menu, select **Remove portrait**. You can also select **Remove portrait** at the top of the picture list. Then select Save.

- **The part of the picture.** The round picture shows a square part of the picture. For a tall picture, this part is at the top and has the full width of the picture. For a wide picture, it is the middle part. A portrait photo usually has the face in its upper part. To show a different part, see "Select the part of a portrait".
- **The card.** The portrait does not make the card larger. In a tree from top to bottom, the portrait is on the edge of the card, and the text does not become shorter. On the card of a person who is dead, the portrait is a little pale. If you zoom out, the cards show less text. If you zoom far out, the cards show no portraits.
- **The person window.** The header of the person window shows the portrait as a round picture. The menu items "Select portrait" and "Remove portrait" change the window only. Save writes them into the tree text, with the other fields.
- **Select the part of a portrait.** To change the part later, select the portrait. In the menu, select **Select the part of the portrait**. This menu item shows only when the plugin can show the portrait. The tool shows the whole picture with a round frame. The area outside the frame is darker. Move the picture under the frame.
- **Move and zoom the picture.** On a phone, move the picture with one finger. Zoom with two fingers. On the computer, drag the picture to move it. Zoom with the mouse wheel. The zoom slider and the zoom buttons work on every device. With the keyboard, use the arrow keys to move the picture. Use "+" and "−" to zoom.
- **Keep or discard the part.** Select **Save** to keep the part. Select **Cancel** to discard it. Select **Reset** to return to the automatic part. Then select Save in the person window. On a phone, the tool fills the screen. If you select a new picture, the portrait starts again with the automatic part.
- **Hide the portraits.** In the settings, turn off "Show portraits on cards". The cards then show no portraits. The person window still shows the portrait.

## Pictures in the tree

- **When the pictures show.** The tree shows first. The arms and the portraits come a moment later. Only the cards in the view, or near it, get their pictures. When you move the tree, the pictures of the new cards come after the tree stops.
- **Formats.** The plugin can show PNG, JPEG, WebP, GIF, BMP and SVG pictures. It cannot show other formats, for example HEIC or AVIF.
- **Only pictures from the vault.** The plugin never gets pictures from the internet.
- **Rename a picture.** If you rename a picture in Obsidian, the plugin updates the links to it in all trees. You can turn this off in the settings.

If the plugin cannot show a picture, the problem list of the tree shows a warning. (To see the problem list, select the warning button in the toolbar.) The warning names the house or the person. The tree still shows. These are the warnings:

- **The vault has no file with this name.** Correct the link, or select another picture. For a person, the card shows an empty portrait circle with a dashed border. For a house, the card shows no arms.
- **The picture is a web address.** Put the picture in your vault. Then select it.
- **The plugin cannot show this format.** Save the picture as PNG or JPEG. Then select it again.
- **The file is not a picture.** Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.
- **The picture is too large.** A picture with more than 40 million pixels can make a phone stop. Use a picture with 40 million pixels or less.

An empty circle with a normal border has one of two causes. The portrait did not come yet, or the plugin cannot show it.

## Save the tree as a picture

You can save the tree as a picture, for example to send it to a friend or to print it.

1. In the toolbar, select More (the "⋯" button).
2. Select **Save as picture**. The window "Save as a picture" opens.
3. Select **Save**.

- **PNG or SVG.** The window has **PNG** chosen already. If you want an SVG picture, select **SVG** before you select **Save**. PNG is a picture that most apps and devices can open. SVG is a picture that stays sharp at every size.
- **What the picture shows.** The picture shows the people that the tree shows now: the whole tree, or the family in focus mode. Each card shows all of its text lines, and its arms and portrait if it has them. If the relation finder shows a result, the picture has its line too. The picture does not show the toolbar or the buttons.
- **Direction and relation names.** The picture has the same direction as the tree on the screen. If the tree is sideways, the cards show no portraits and no arms. The picture follows the setting "Show relation names on cards". If you turn it off, the picture has no relation names.
- **Note name and legend.** The name of the note is at the top of the picture. The legend is at the bottom. It has the line styles and the houses of the people in the picture. The legend on the screen has no houses, but the picture keeps them.
- **Colours.** The picture always has light colours on a white background, also if you use a dark theme.
- **Where the picture goes.** The plugin saves the picture in the attachment folder of the note. A message tells you the name of the picture and its folder. The name is the name of the note and "tree", for example "Valmont tree.png". In focus mode, the name also tells the family, for example "Valmont tree, family of Roderick Valmont.png". If a picture with this name exists, the plugin adds a number to the name.
- **Share.** If your device can share the picture (for example an iPhone), the message has a **Share** button. Select Share to send the picture to another app. The message stays until you close it.
- **A large tree.** A large tree can take some time. After one second, a message tells you that the plugin makes the picture. You can use the tree during this time.
- **Small names.** A PNG picture has a maximum size. If the tree is very large, the names in a PNG picture are small, and the message tells you. If you want sharp names, save the tree as SVG.
- **Fonts on an iPhone.** On an iPhone, a PNG picture can show a plain font. The tree on the screen can show a different font, for example the font of your notes.
- **The note does not change.** Save as picture does not change the tree text.

On a phone or a tablet, the tree in a note has no More button. First tap Expand to open the full-screen view.

## Long names

A name that does not fit on one text line uses two or three text lines. Only that card is taller. If a name does not fit on three text lines, the third text line ends with "…". The person window shows the full name. This is the same on the computer, in the full-screen view and on a phone.

The plugin breaks a name at a space first. If one word is too long, the plugin breaks the word with a hyphen. It uses one of these places, in this order:

1. A hyphen that is already in the name. The plugin uses the last one that fits.
2. A place that you wrote in your list of break places.
3. A place that the plugin finds with a simple rule for vowels and consonants.

- **Your list.** Open the settings. Find "Break places in long names". Write one word on each text line. Put a hyphen at each place where the word can break, for example `Long-na-munda`.
- **How the list works.** The plugin breaks a word from the list only at your places. The list is for all the trees in your vault. The plugin ignores capital letters in the words.
- **A name with a hyphen.** If a name has a hyphen, write each part of the name on its own text line of the list.
- **A text line with a mistake.** The plugin skips a text line with two hyphens in a row. It also skips a text line with a hyphen at the start or at the end. It gives no message.
- **How many words.** The list can have 2000 words and 20 000 letters.
- **Other alphabets.** The plugin finds no break places in names in Cyrillic, Greek or Chinese letters. Use your list for these names. A word that is too long and has no break place ends with "…".

## Sobriquet

A sobriquet is a short extra name, for example "the Wise". Write it in the `sobriquet` text line of a person. Write the words only. The plugin adds the curly quote marks. If you write one pair of double quote marks, the plugin removes that pair and adds its own.

- **On the card.** The card shows the sobriquet after the name and the number, for example "Aldric II “the Wise”". The sobriquet is not bold. It stays in one part: if it does not fit, it moves to the next text line.
- **Three text lines.** If the name already needs three text lines, the sobriquet may not fit. Then the card shows "…" after the last whole word of the name, if there is room. If there is no room, the card shows nothing more. The person window shows the whole sobriquet.
- **Where it shows.** The sobriquet shows on a card that shows all of its text. It shows in Find and in the lists of people. It shows in the lists of title holders, on the house page and in the saved picture.
- **Where it does not show.** A card that shows less text, for example in a tree that you zoom far out, shows the name only. A screen reader (an aid that reads the screen aloud) does not read the sobriquet.
- **Edit it.** The person window has the field "Sobriquet". An empty field removes the text line.
- **No name.** A person with a sobriquet and no name shows neither on the card. The person window still holds both.

## Fold a branch

To fold a branch means to hide the children of a partnership and all the people below them.

- **Fold.** Below each partnership with children, the line down to the children has a small round button with "−". Select it. The children and all the people below them disappear. The line then ends in a sign such as "+ 12". The number tells you how many people are hidden.
- **Open.** Select the "+ N" sign. The people show again. A fold inside the branch stays folded.
- **One button for each partnership.** A person with two partnerships has two buttons. Each button folds only the children of its own partnership. Children with only one parent have their own button below the card of the parent.
- **The person window.** The section Actions of the person window has **Hide descendants** if the children of a partnership of the person show. It has **Show descendants** if a partnership of the person is folded. They fold or open all the partnerships of the person.
- **Find a hidden person.** These open the folds that hide a person: Find, Focus, the relation finder, the Show view of a line of succession, a partner tag, the problem list and the people of a house. Then the tree shows the person.
- **How long a fold stays.** A fold stays until you close the note. The plugin does not write it in the tree text. When you open the note again, the tree shows all people.
- **Zoom out.** If you zoom far out, the "−" buttons do not show, but the "+ N" signs stay.
- **On a phone.** The tree in a note has no fold buttons. Tap Expand to fold in the full-screen view. If you select **Hide descendants** in the note, the full-screen view opens with the branch folded. A fold in the full-screen view does not change the tree in the note.
- **Save as a picture.** The saved picture shows the "+ N" signs, but not the "−" buttons.

## Make a note for a person

In the section Actions of the person window, select **Make a note**. The plugin makes a new note with the name of the person, in the folder that Obsidian uses for new notes. The note has one text line with a link back to the note with the tree. The plugin writes the link to the new note into the person's `link` text line. The full-screen view closes first. Then the new note opens. On the computer, it opens in a new tab. On a phone, Back returns to the tree.

- **A note with the same name.** If the folder already has a note with that name, the plugin asks you. You can link to that note, make a new note with a number after the name, or cancel.
- **Make the linked note.** If the person has a link to a note that does not exist, the button is **Make the linked note**. The plugin makes that note. The tree text does not change.
- **Undo.** Undo removes the link from the tree text, and the other changes that you saved with it. The note stays in the vault.
- The person window of a new person has no **Make a note** button. The button shows after the first Save.

## House page

The page of a house has the section People. It shows the people of one house. Generation 1 is the oldest generation with a person of the house. The section lists all the people of the house, even in focus mode and with folds.

- **Open it.** In the Houses window, select the house in the list. On the page of the house, open the section **People**. A house that you did not save has no People.
- **The rows.** The section shows the first eight people. A row has the name in bold, the title with the reign, and a second text line. The second text line has the generation and the years. If you turn off "Show generation on the house page", it has the years only. If the house has more people, a text line says "and 12 more".
- **Show a person.** Select a row. The window closes, and the tree shows the card of the person.
- **Make a note with this table.** Select the button under the rows. The plugin makes a new note with the table of all the people of the house: generation, name, title, born and died. The note does not change when the tree changes.
- **Close it.** Select **Close** or **Cancel**, or push Esc. If you changed something, the plugin asks first.
- **A phone.** On a phone, the house page is only in the full-screen view.

## Settings

Open Settings. Select Dynasty Tree. The settings are in six groups. Each setting has the name that the settings page shows.

- **Group "Height in a note".**
  - "Height on a computer or tablet" is the height of a tree in a note, in pixels. It is 500 at first.
- **Group "Cards".**
  - "Tree direction on a phone held upright" (Sideways or Like the computer; see "The full-screen view").
  - "Arms on cards" ("Founders, married-in people and holders" or "Every card"; see "Coats of arms").
  - "Break places in long names" (see "Long names").
  - "Reduce movement" (Follow the device, On or Off; see "Reduce movement").
  - "Show dates on cards" (on or off; see "Titles and reigns").
  - "Show relation names on cards" (on or off; see "This is me and relations").
  - "Assume an unknown second parent" (on or off; see "One listed parent" in "This is me and relations").
  - "Show portraits on cards" (on or off; see "Portraits").
  - "Warn about more than 2 parents of a type" (on or off; see "The tree text").
  - "Length of the line of succession" (1 to 20 people, 5 at first; see "Succession").
  - "Warn about people older than" is the age from which the line of succession warns about a person with no death year. It is 110 years at first. Use a number from 0 to 1000. The number 0 stops the warning.
  - "Age for open branches" (0 at first; use a number from 0 to 1000). The line of succession shows no open branch for a person who died younger than this age.
- **Group "House page".**
  - "Show generation on the house page" (on or off).
- **Group "Focus mode".**
  - "Generations in focus mode" is the number of generations above and below the person in focus. It is 3 at first. Use a number from 0 to 10.
- **Group "Links".**
  - "Update tree links when you rename a note or a picture" (on or off).
- **Group "Repair".**
  - "Arrange all trees again" has the button **Arrange again**.

Older versions had two more settings, "Height on a phone" and "Card style in the phone preview". They are gone, because a tree in a note on a phone is a list now. The plugin ignores the old values.

If a tree looks wrong, open the settings. In the group "Repair", select the button **Arrange again**. The plugin arranges each tree again when it shows the tree.

## Reduce movement

The setting "Reduce movement" has three choices. "Follow the device" is the first choice: the plugin uses the setting of your phone or your computer. "On" reduces movement. "Off" keeps the movement.

When the plugin reduces movement, Fit, Find and a double tap change the view at once. The tree does not move slowly. The short highlight of a card is an outline that does not move. The Houses window goes to a person at once.

## The tree text

A tree is a `dynasty` code block with the lists `houses`, `titles`, `people` and `unions`, and an optional `options` map.

Keep an empty text line or a heading above a tree. If a tree is the first thing in a note, Live Preview opens the note with the cursor in the tree. Then you see the text of the tree, not the tree. To see the tree, move the cursor out of the tree.

````markdown
```dynasty
houses:
  - id: valmont
    name: House Valmont
    color: "#8c2041"
    arms: "[[valmont-arms.png]]"

titles:
  - id: duchy-of-valmont
    name: Duchy of Valmont
    male-name: Duke of Valmont
    female-name: Duchess of Valmont
    plural: Dukes of Valmont
    holders:
      - {name: Aldric, number: I, from: 1062, to: 1101}
      - {person: aldric, number: II, from: 1131, to: 1160}
      - {person: roderick, from: 1160}

people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
    born: 1102
  - id: isolde
    name: Isolde Orsini
    born: 1110
  - id: roderick
    name: Roderick Valmont
    house: valmont
    parents: [aldric, isolde]
    portrait: "[[roderick.jpg]]"
  - id: wren
    name: Wren
    parents: [aldric]
    illegitimate: true
    link: "[[Wren of the Marches]]"

unions:
  - partners: [aldric, isolde]
    type: marriage
```
````

The example uses the pictures `valmont-arms.png` and `roderick.jpg`. If your vault has no such pictures, the tree shows two warnings. Remove the `arms` and `portrait` text lines, or use your own pictures.

- Each person has an `id` (a short name that the plugin uses to find the person). When you add a person, the plugin gives an ID such as `p12`. The plugin makes the ID of a new house or title from its name. If you rename a person, a house or a title, the ID stays the same. The section Actions of the person window shows the ID in a small grey text line at the end, for example "ID: p12".
- A parent can be a birth, adoptive, ward or rumoured parent, for example `parents: [{id: aldric, type: adoptive}]`. A person can have 2 parents of each type, and up to 8 rumoured parents. If a person has more, the plugin shows a warning. The setting "Warn about more than 2 parents of a type" (group Cards) is on at first. If you turn it off, the plugin gives no warning for more than 2 birth, adoptive or ward parents. The warning for more than 8 rumoured parents stays. If a parent has another type, for example `type: step`, the plugin counts the parent as a birth parent and shows a warning.
- A partnership (in the `unions` list) can be a marriage, a betrothal, a concubinage or an affair. The plugin also reads some common words: `engaged` is a betrothal. `mistress`, `lover` and `liaison` are an affair. `concubine` is a concubinage. A partnership with any other word is shown as a marriage, with no warning. If the word is close to a known type, for example `mariage`, the plugin shows a warning with the word that it expects. A partnership has exactly 2 people. For three people, write one partnership for each pair.
- A title can also have the keys of the line of succession (see "Succession").
- A title has an `id`, a `name` and `holders`. It can also have `male-name` and `female-name`. These are the names of the title for a man and for a woman. It can also have `plural`, the name of its list. The Titles window keeps `plural`, but does not show it. A holder has `person` (a person ID) or `name` (a holder who is not in the tree). A holder can also have `number`, `from`, `to` and `as`. `as` is the ruler name, if it is not the first word of the name. A holder can also have `through-spouse: true` (see "A holder who holds the title through the spouse").
- `sobriquet: the Wise` on a person is a short extra name. The card shows it after the name (see "Sobriquet").
- `card-title: king-of-the-vale` on a person selects the title that the card shows. "Show on the card" writes this text line.
- `options` can have `me: roderick`. This text line marks Roderick as you (see "This is me and relations"). "This is me" writes this text line. Remove "This is me" removes it.
- `link` connects a person to a note. On the computer, a click on the name opens that note. The person window has the link **Open linked note**, left of **Open all**.
- `portrait-crop` on a person keeps the part of the portrait that you selected, for example `portrait-crop: "0.12 0.05 0.6"`. Save in the person window writes this text line.
- Folds are never written in the tree text.
- `arms` on a house, and `arms` and `portrait` on a person, are links to pictures in the vault. Select arms and Select portrait write these text lines. Remove arms and Remove portrait remove them (see "Coats of arms" and "Portraits").

If the text cannot be read, the plugin shows an error box in place of the tree. The box tells you what to correct. If the tree can be read but has a fault, the plugin shows the tree and a warning button. Select the button to see what to correct. If two people have the same ID, the plugin shows the tree and does not let you edit it until you correct the IDs.

<!-- format:start (generated by "npm run format-doc"; do not edit by hand) -->
### Format 1: every key of the tree text

Your trees still work when you update the plugin. This section lists every key that you can write in a tree. A key is a word with a colon after it, for example `name:`. Format 1 is the name of this set of keys. It is true for plugin version 0.3 and for every plugin version 1.x. These rules are true:

1. A new plugin version 1.x can add a key. It never changes what an old key means.
2. If the plugin does not know a key, it does not remove the key when you change the tree in a window. It keeps your comments too. A comment is a text line that starts with #.
3. A tree that works in plugin version 1.0 works in every later plugin version 1.x.
4. A change that breaks these rules needs plugin version 2.0. The key `format` in `options` is reserved for that. You do not need to write it. Plugin version 1.x never writes it.

The tables list the 65 keys of Format 1. Three of them are reserved: the plugin keeps them and never reads them. "Since" is the plugin version that added the key. For a reserved key, it is the version that reserved it.

The file [docs/format.md](docs/format.md) also shows how you can write each key and how the plugin writes it. In the tables, the group name tells you where the key goes. For example, the keys of **houses** go in one entry of the `houses` list.

**Top level**

| Key | What it does | Since |
|---|---|---|
| `options` | The settings of this tree: where it opens, the focus, the "This is me" mark and the height. | 0.1 |
| `houses` | The list of the houses. | 0.1 |
| `titles` | The list of the titles and their holders. | 0.2 |
| `people` | The list of the people. | 0.1 |
| `unions` | The list of the partnerships. | 0.1 |

**options**

| Key | What it does | Since |
|---|---|---|
| `start` | The person that the tree centres on when it opens. If you edited a person in this session, the tree centres on that person instead. The phone list does not use it. | 0.1 |
| `focus` | The person that the tree shows in focus mode when it opens. "Pin focus here" writes it. | 0.1 |
| `me` | The person with the mark "This is me". The relation names start from this person. | 0.2 |
| `generations` | How many generations up and down the tree shows in focus mode. | 0.1 |
| `height` | The height in pixels of the tree in a note, on a computer. | 0.1 |
| `format` (reserved) | Reserved for Format 2. The plugin ignores it today, keeps it and never writes it. | 0.3 |

**houses**

| Key | What it does | Since |
|---|---|---|
| `id` | The short name that people use in their `house` key. | 0.1 |
| `name` | The name of the house on cards, in the legend and in the Houses window. | 0.1 |
| `color` | The colour of the strip on the cards of the house, for example `"#8c2041"`. Write it in quotes. Without quotes, the plugin shows a warning. | 0.1 |
| `arms` | A link to the picture of the coat of arms of the house. | 0.2 |

**titles**

| Key | What it does | Since |
|---|---|---|
| `id` | The short name that `card-title` uses to select this title. | 0.2 |
| `name` | The name of the title: the place that the title rules, for example "Duchy of Normandy". | 0.2 |
| `male-name` | The name of the title for a holder with `sex: m`, for example "Duke of Normandy". | 0.2 |
| `female-name` | The name of the title for a holder with `sex: f`, for example "Duchess of Normandy". | 0.2 |
| `plural` | The name of the list of holders and of the note with the table, for example "Dukes of Valmont". | 0.2 |
| `numbering` (reserved) | Reserved. The plugin keeps the key and never reads it. The plugin does not count the numbers of the holders. | 0.2 |
| `count-with` (reserved) | Reserved. The plugin keeps the key and never reads it. | 0.2 |
| `succession` | The rule that puts the heirs in order. See "Succession". | 0.2.7 |
| `inherit` | Who can inherit: men, women, or both with a preference. See "Succession". | 0.2.7 |
| `inherit-through` | Through whom a claim passes: men, women or anyone. See "Succession". | 0.2.7 |
| `inherit-illegitimate` | Whether children marked as illegitimate can inherit. See "Succession" for the values. | 0.2.7 |
| `inherit-adopted` | Whether adopted children can inherit. | 0.2.7 |
| `heirs-of-body` | Whether only the descendants of the first holder can inherit. | 0.2.7 |
| `year` | The year that the line of succession is for. | 0.2.7 |
| `heir` | The named heirs. They come first in the line of succession, in the order of the list. | 0.2.7 |
| `exclude` | The people who are not in the line of succession. | 0.2.7 |
| `holders` | The list of the holders of the title, in the order in which they held it: the first holder first, the newest holder last. | 0.2 |

**holders of a title**

| Key | What it does | Since |
|---|---|---|
| `person` | The ID of the person who holds the title. If a holder has both `person` and `name`, the plugin uses `person`. | 0.2 |
| `name` | The name of a holder who is not in the tree. | 0.2 |
| `as` | The ruler name, when it is not the first word of the name of the person. | 0.2 |
| `number` | The number of the holder, for example "II". The plugin does not count it. | 0.2 |
| `from` | When the reign started. | 0.2 |
| `to` | When the reign ended. | 0.2 |
| `through-spouse` | The holder holds the title through a spouse. See "A holder who holds the title through the spouse". | 0.2.8 |

**people**

| Key | What it does | Since |
|---|---|---|
| `id` | The short name that other keys use to point to this person. | 0.1 |
| `name` | The name on the card. | 0.1 |
| `sobriquet` | A short extra name, for example "the Wise". The card shows it after the name. | 0.2.4 |
| `title` | The text under the name on the card. A person who holds a title also shows the reign after it. | 0.1 |
| `card-title` | The ID of the title that the card shows, with its reign. It replaces a written `title`. It picks one title when the person holds several. | 0.2 |
| `house` | The ID of the house of the person. | 0.1 |
| `sex` | Write `m` for a man or `f` for a woman. It sets the look of the card, the order of partners, the relation names and the line of succession. A word such as `male` gives a warning. | 0.1 |
| `born` | When the person was born. You can write any text. The line of succession and the phone list read a year in it. | 0.1 |
| `died` | When the person died. You can write any text. The line of succession and the phone list read a year in it. | 0.1 |
| `parents` | The parents of the person. Write an ID, or write the keys `id` and `type` for a parent. | 0.1 |
| `placement` | Which parents decide where the card stands: the birth parents, the adoptive parents or the ward parents. | 0.1 |
| `illegitimate` | The person was born outside a marriage. Write `illegitimate: true`. The sign is on the line to the birth parents. | 0.1 |
| `childless` | The person had no children. Write `childless: true`. The line of succession then shows no open branch for the person. | 0.2.7 |
| `union` | The ID of the partnership that the person was born in. It is needed only when the parents have more than one partnership. | 0.1 |
| `link` | A link to the note of the person. On a computer, a click on the name opens the note. | 0.1 |
| `portrait` | A link to the portrait picture of the person. | 0.2 |
| `portrait-crop` | The part of the portrait that the card shows. | 0.2 |
| `arms` | A link to the picture of the coat of arms of the person. | 0.2.8 |
| `notes` | Free text about the person. Only the person window shows it. | 0.1 |

**a parent entry**

| Key | What it does | Since |
|---|---|---|
| `id` | The ID of the parent. | 0.1 |
| `type` | The kind of the parent: birth, adoptive, ward or rumoured. | 0.1 |

**unions**

| Key | What it does | Since |
|---|---|---|
| `id` | The short name of the partnership. It is needed only when two partnerships have the same two partners, or when a person uses `union`. | 0.1 |
| `partners` | The two people of the partnership. | 0.1 |
| `type` | The kind of partnership: marriage, betrothal, concubinage or affair. | 0.1 |
| `start` | When the partnership started. | 0.1 |
| `end` | When the partnership ended. | 0.1 |

<!-- format:end -->

## Limits

- **Obsidian Publish.** Plugins do not work on Obsidian Publish. A published note shows the tree text, not the tree.
- **Backlinks and the graph view.** Obsidian does not read links inside code blocks. The links of a tree do not show in backlinks or in the graph view. When you rename a note or a picture, the plugin updates the links in the trees. You can turn this off in the settings.
- **No import or export.** The plugin does not read or write GEDCOM files (a common file type for family history data). It does not print the tree, and it does not make PDF files. To print the tree, save it as a PNG or SVG picture (see "Save the tree as a picture"). Then print the picture.
- **One tree in one code block.** A tree cannot use people from other notes.
- **No names through two marriages.** A relation through two marriages has no name. For example, the father of your sister-in-law has no relation name. The relation finder shows the steps of that relation.
- **Older plugin versions.** A phone with plugin version 0.1.x keeps the mark and the titles in the tree text. It does not show the mark, the relation names or the titles. If you delete the marked person on that phone, the mark stays in the tree text. If you delete a holder there, the holder stays in the tree text. It then names nobody, and the tree shows a warning.
- **Older plugin versions and pictures.** A phone with version 0.1.x does not show arms or portraits. If you rename a picture there, the links to it in the trees do not change. Update the plugin on all your devices.
- **Numbers are not counted.** The plugin does not count the numbers of the holders. You write each number.
- **Positions are automatic.** You cannot drag cards to a new position. You can change the order of brothers and sisters in the section Family of the person window, in the group "Position among siblings". The line of succession puts brothers and sisters in the order of their birth years (see "The order of brothers and sisters").
- **Very large trees.** If a tree has more than 1,500 people, a note on a computer or a tablet shows a bar in place of the tree. Select **Draw the tree** to draw it. The draw can take several seconds. Obsidian does not answer in that time. The bar shows again each time you open the note. On a phone, the list in a note works at any size. In the full-screen view on a phone, select Clear focus to see the whole tree. The bar then shows **Draw the tree**. If a tree has more than 5,000 people (on a phone: more than 3,000), the plugin does not draw the whole tree. The bar then has **Choose a person** in place of **Draw the tree**. Select it to open a list of people. Select a person, and the tree shows the family of that person. The family of a person draws also in a very large tree. If that family is too large too, the bar says so and has **Choose another person**. If a draw takes more than 15 seconds, the plugin stops it. The bar says so and has **Choose a person**. The plugin does not try again until you change the tree text. To draw the whole tree, make the tree smaller in the note.
- **Two devices.** If you use the same vault on two devices, wait until the sync is complete before you edit a tree on the other device. If you do not wait, the other device changes an old copy of the note, and the sync can lose one of the two edits.
- **Tested devices.** The developer tested the plugin on Windows and on an iPhone. The developer did not test it on an Android phone.
