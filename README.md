# Dynasty Tree

Dynasty Tree is an Obsidian plugin. It shows the family tree of a fictional dynasty in a note. You can edit the tree on the computer and on the phone.

The plugin stores the tree as text in a `dynasty` code block in your note. The plugin draws the tree from that text. When you edit the tree, the plugin changes only the text lines that must change. It keeps your comments and your formatting.

## Start a tree

1. Open a note.
2. Put the cursor where the tree must go.
3. Open the command list.
4. Select "Insert family tree".
5. In the tree, select "Add first person".

You can also type the code block yourself. See "The tree text" below.

## Use the tree

- **Edit a person.** On the computer, click a card. On a phone, tap a card. The edit sheet opens. Change the fields. Then select Save.
- **Add relatives.** In the edit sheet, use Add parent, Add child or Add partner.
- **Move and zoom.** On the computer, drag the tree. To zoom, hold Ctrl and turn the mouse wheel.
- **Move and zoom on a phone or a tablet.** On a phone, a tree in a note is a list (see "The tree in a note on a phone"). On a tablet, the tree in a note does not move. Tap Expand to open the full-screen view. Move the tree with one finger. Zoom with two fingers.
- **Full-screen view.** Select Expand. Select the X button to close it. You can also push Esc.
- **Find.** In the full-screen view, select Find. Type a name. Find ignores capital letters, accents and the look of the apostrophe.
- **Focus.** Select Focus. Choose a person. The tree shows only the family of that person. While a focus shows, Focus opens a short list with two items. Select Choose a person to focus on another person. Select Clear focus to see the whole tree.
- **The "+" sign.** A "+" sign on a card shows that the person has more relatives outside the view. Select the sign to show the family of that person.
- **Pin.** In the edit sheet, select "Pin focus here". The tree then always opens on the family of that person. Select "Remove pin" to stop this. Clear focus does not remove a pin. The pin applies again when you close the note.
- **Houses.** Select the Houses button (the castle). The Houses window shows a list of the houses. You can search the list and add a house. Select a house to change its name, arms or colour, or to delete it (see "The Houses window"). On a phone, the Houses button is only in the full-screen view.
- **The buttons.** The toolbar of a tree has these buttons:
  - **Add person** adds a person.
  - **Houses** (the castle) opens the Houses window.
  - **Focus** shows the family of one person. While a focus shows, it opens a list with Choose a person and Clear focus.
  - **Find** is in the full-screen view only.
  - **Fit** fits the whole tree in the window.
  - **Legend** shows the line styles and the houses.
  - **More** (the "⋯" button) opens a list with Relation, Titles and Save as picture.
  - **Expand** opens the full-screen view. **Close** closes it.
  - A **warning button** shows when the tree has problems. Select it to see the list.

  On a phone, a tree in a note is a list with a bar of Add person, Find, Back and Expand (see "The tree in a note on a phone"). If the tree has problems, the bar also has the warning button. In the full-screen view on a phone, Fit and Legend are in the More list. A tree that you cannot edit shows Open note instead of Add person and Houses.
- **Commands.** The command list has four commands:
  - **Insert family tree** puts a new tree in the note at the cursor.
  - **Undo last tree edit** reverses the last edit of a tree.
  - **Show the last link update** shows how many links the last rename changed.
  - **Show render timing** shows how long the last tree took to draw.
- **Undo.** After you delete a person, a partnership or a house, the plugin shows a message with Undo. To undo a different tree edit, use the command "Undo last tree edit".
- **Keyboard.** Push Tab to go to the toolbar buttons, the cards, the tags, the fold buttons and the "+ N" signs. Push Enter to open a card. Push Esc to close a list or a window.

If you hold the phone upright, the tree in the full-screen view turns sideways. The generations go from left to right. Scroll down to see more of the tree.

To change this:

1. Open the settings.
2. Select "Tree direction on a phone held upright".
3. Select "Like the computer".

The generations then go from top to bottom. The setting is the same for all trees.

If you change the setting while the full-screen view is open, the tree turns at once. A phone on its side, a tablet and a computer always show the tree from top to bottom.

On a phone, the full-screen view has no Fit button and no Legend button. Select More (the "⋯" button) in the toolbar. The list has "Fit the tree in the view" and "Show the line styles". This keeps the toolbar in one row, so the Close button is always on the screen.

## The tree in a note on a phone

On a phone, a tree in a note is a list. The list shows one person and the family of that person. The list has its own height, and the note scrolls over it. You cannot move or zoom the list.

- **What the list shows.** The section "Parents" shows the parents of the person. The next section shows the person and each partner. The section "Children" shows the children, one group for each partner. A child with no partner in the list is under "No partner listed". A child that has only an adoptive, ward or rumoured link is under "Other children".
- **A row.** A row shows the name, the years, the title and the colour bar of the house. If the house has arms or the person has a portrait, the row shows them small. If the tree has a mark, a row also shows how the person is related to you. This needs "Show relation names on cards" to be on. The marked person shows "You".
- **Move the list.** Tap a name. The list then shows the family of that person. Tap **Back** to show the person before. Tap **Find** to select any person in the tree. If you move the list, the plugin writes nothing to the note.
- **Edit a person.** Tap the pencil at the right of a row. The edit sheet opens. For the person in the middle, tap the whole row.
- **Where the list starts.** The plugin picks the start person in this order. First is the person that you chose last in this note. Next are the pin, then the marked person, then the person that you edited last. Then comes the oldest person who has children. The last choice is the first person in the tree.
- **The bar.** Above the list are **Add person**, **Find**, **Back** (after you move the list), the warning button (if the tree has problems) and **Expand**.
- **Expand.** Tap **Expand** to open the full-screen view. It shows the family of the person that the list shows. You can move the tree there. To see all people, select Focus. Then select Clear focus.
- **After you save a person.** The list does not move. If the person is in the list, the row has a thin outline for two seconds. If the person is not in the list, a message tells you to tap Find.
- **A tablet** does not show the list. It shows the tree in the note, and you cannot move or zoom this tree. Tap Expand to move the tree.
- **Settings.** The list follows "Show dates on cards", "Show relation names on cards" and "Show portraits on cards". The card size and the height of a tree in a note do not change the list.

"Save as picture" and the full-screen view always show the tree, not the list.

## Change the ID of a house or a title

The ID is a short name. The plugin uses it to find a house or a title. You rarely need to change it.

1. Open the window of the house or the title. For a house, select the Houses button (the castle). For a title, select More (the "⋯" button), then select Titles.
2. Select the house or the title in the list. The edit page opens.
3. At the end of the page, under "Other actions", select **Change ID**. A small window opens.
4. Type the new ID, or select **Make ID from the name**.
5. Select **Use this ID**.
6. Select **Save**. The plugin asks you to confirm the change.
7. Select **Change the ID**. The plugin changes the ID in the text of each person who uses the house. It also changes the text of each person who chose the title with "Show on the card".

To keep the old ID, select **Keep old ID** on the edit page before you select Save. A new house or title has no Change ID until you save it.

## This is me and relations

You can mark one person in the tree as you. Each card then shows the relation of that person to you.

- **Mark a person as you.** Open the edit sheet of the person. In Actions, select "This is me". If another person has the mark, the mark moves to this person.
- **The card "You".** The card of the marked person shows "You". It also has a thicker border in the colour of the text. The border does not use the accent colour of your theme.
- **Relation names on the cards.** When the tree has a mark, each card gets a band at the bottom of the card. The band shows the relation to you, for example "Father", "Half-sister" or "Second cousin once removed". On a card of the size Compact, there is no band. The relation is one more small text line at the bottom. All cards get a little taller. A card of a person with no relation to you has no relation name. If the tree is very small on the screen, the cards do not show the relation names.
- **The edit sheet.** On a computer, a box at the top of the sheet shows "Relation to you" and the relation name. A person can have more than one relation to you, for example after a marriage between cousins. Then the next text line starts with "Also:" and gives the other relations. The box of the marked person says "This is you." If the tree has no mark, the sheet shows no box.
- **The strip on a phone.** On a phone, a strip under the header of the sheet shows the relation name. If the person has other relations, the strip also shows how many, for example "7 more". Tap the strip to open it. The open strip shows the "Also:" text line and the button Show the line. The strip stays open or closed until you close Obsidian. The strip of the marked person says "This is you." and does not open.
- **A rumoured parent.** A rumoured parent is a parent link that you mark as a rumour. If the rumour is true, two people can be full brothers or sisters. Then the card can say "Half-brother, maybe full". The box or the strip then has one more paragraph: "If every rumoured link is true, this person is your …", and the relation name. The list "Also" can say "Rumoured brother".
- **Show the line.** In the edit sheet, select the button "Show the line" in the box, or in the open strip. The relation finder opens with the line from you to the person (see "Relation finder").
- **Remove the mark.** Open the edit sheet of the marked person. Select Remove "This is me".
- **Hide the relation names.** In the settings, turn off "Show relation names on cards". The cards are then shorter, and the marked person has a small "You" tab on the card. The edit sheet still shows the relation.
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

To find a relation from the edit sheet:

1. Open the edit sheet of a person.
2. In Actions, select "Show the relation to…".
3. Select the other person. If the tree has a mark, the first row of the list is "You".

On a phone, the tree in a note has no More button. First tap Expand to open the full-screen view. In the tree in a note, "Show the line" and "Show the relation to…" open the full-screen view with the result. The tree in the note does not change.

The result:

- A bar at the top of the tree shows one sentence, for example “Wren is Roderick’s half-sister.” The sentence gives the relation of the second person to the first person.
- The tree shows only the people on the line between the two people. The line is thicker and in the accent colour of your theme.
- Select **Show the steps** to see each step of the line as a short sentence. Select **Hide the steps** to hide them.
- If the two people have more than one relation, select **Other relation** to see the next relation.
- Select **Show in the whole tree** to see the line in the whole tree. The other cards become pale. Select **Show only the line** to see only the line again.
- Select **Close**, or push Esc, to close the result. The tree then shows what it showed before.
- Some relations have no name. Then the bar tells how many other people are on the line between the two people. Select Show the steps to see each step.
- If two people have no relation in the tree, the bar tells you. The tree does not change.

The result stays until you select Close or close the note. If you edit the tree, the plugin finds the relation again.

## Titles and reigns

A title (for example "Duke of Valmont") has a list of holders. The list starts with the first holder and ends with the newest holder. A holder can have a number (for example "II") and a reign (the years of the holder).

- **The card.** The card of a holder shows the title with the reign, for example "Duke of Valmont (r. 1175–1207)". If the text is too long for one text line, it continues on a second text line. Then only that card is taller. If the holder has a number or a ruler name that you wrote, the card shows the ruler name instead of the name. A number follows it, for example "Aldric II". The edit sheet and the list of holders show the full name.
- **Two or more titles.** The card shows the first title of the person in the list of titles. To show another title, open the edit sheet. In Titles, select "Show on the card" at that title. The title that the card shows says "On the card".
- **Your own title text.** If a holder has your text in the field Title text on the card, the card shows that text. The reign of the first title follows it. If you select "Show on the card" at a title, the card shows that title instead of your text.
- **The edit sheet.** The Titles section is between the fields and Family. It shows each title of the person with the number and the reign. Select **Edit** to change the number, the ruler name, From or Until. A text line under the fields shows the result, for example "Ser Darian Harrow shows as: Darian II". Select **Add title** to add the person as the newest holder of a title, or of a new title.
- **Remove.** In the edit sheet, each reign of a title has its own **Remove**. **Remove** removes only that reign from the holders. If the person has other reigns of that title, they stay.
- **The Titles window.** In the toolbar, select More (the "⋯" button). Then select Titles. The window shows a list of the titles of the tree. Each row shows the name of the title, the number of holders and the newest holder. Select a row to open the edit page of that title.
- **Search and Add.** Type in the search field to find a title. A title matches by its names, its ID or the name of a holder. Select Add title, beside the search field, to add a title. The edit page of the new title opens.
- **The edit page of a title.** The page has four name fields. They are "Name of the title", "Name for a man", "Name for a woman" and "Name of the list". Under them is the list of holders. At the end of the page, under "Other actions", are **Change ID** and **Delete**. You can change the ID of a saved title (see "Change the ID of a house or a title"). If you delete a title that you saved, the plugin asks you first.
- **Names for a man and a woman.** In "Name for a man", you can type the name for a man, for example "King of the Isles". In "Name for a woman", you can type the name for a woman, for example "Duchess of Valmont". The card and the edit sheet of a man show the name for a man. The card and the edit sheet of a woman show the name for a woman. If this name is empty, the card and the edit sheet show the title name. The card of a holder whose sex is not male or female also shows the title name.
- **Name of the list.** In "Name of the list", you can type a name for the list of holders, for example "Dukes of Valmont". The list of holders on the edit page has this name.
- **Holders.** Each holder has the buttons Move earlier, Move later, Edit and Remove. Select **Add holder** to add a holder. Select the name of a holder who is in the tree to see the card in the tree. The window then closes. If you did not save your changes, the plugin asks you first.
- **A holder who is not in the tree.** A holder who is not in the tree shows in pale text. To add such a holder, select Add holder. Then select "A holder who is not in the tree".
- **Save and Cancel.** The Titles window changes nothing until you select Save. Save makes one change, which one Undo reverses. Cancel discards your changes. Back, to the list of titles, keeps your changes in the window.
- **A note with the list.** On the edit page of a title that you saved, select "Make a note with this table", under the holders. The plugin makes a new note with a table of the holders. The note has the name of the list, for example "Dukes of Valmont". The note is in the folder that Obsidian uses for new notes. The note does not change when the tree changes.
- **Find.** Find and the other person lists also find a holder by the ruler name and number, for example "Aldric II".
- **Dates.** If you turn off "Show dates on cards", the cards also do not show the reigns.

On a phone, the tree in a note has no More button. First tap Expand to open the full-screen view.

## The Houses window

A house has a name and a colour. It can also have arms. The colour of a house shows on the cards of the people of that house.

- **The list.** Select the Houses button (the castle). The window shows a list of the houses. Each row shows the colour, the arms, the name and the number of people. Select a row to open the page of that house.
- **Search and Add.** Type in the search field to find a house. A house matches by its name, its ID or the name of a person of the house. Select Add house, beside the search field, to add a house. The page of the new house opens.
- **The page of a house.** The page has the field "Name of the house" and the number of people. It has the button **People** (see "House page"), the arms and the colours. At the end, under "Other actions", are **Change ID** and **Delete**. A house that you did not save has no People and no Change ID.
- **The colour.** Select one of the 12 house colours. Select "Other colour" to use the colour window of your device. If the house has arms, the colours start with "Colours from the arms" (see "Coats of arms").
- **Delete a house.** If people have the house, the plugin asks you. You can remove the house from these people, or keep the house for them. If you keep the house, the tree shows a warning for each of these people. After you select Save, a message with Undo shows.
- **Save and Cancel.** The Houses window changes nothing until you select Save. Save makes one change, which one Undo reverses. Cancel discards your changes. Back, to the list of houses, keeps your changes in the window.

## Coats of arms

A house can have arms (a coat of arms). The arms are a picture in your vault. They show on the cards of the people of the house, in the Houses window, in the legend and in the list on a phone.

To give a house its arms:

1. Select the Houses button (the castle).
2. Select the house in the list. The page of the house opens.
3. Under "Arms", select the arms picture. If the house has no arms, the picture is an empty frame with a dashed border.
4. In the picture list, select a picture. To see the pictures, open a folder or type a part of the name.
5. Select the same picture again, or select **Select**.
6. Select **Save**.

On the page of the house, the button **Select arms** does the same as the arms picture. The button **Remove arms** shows only if the house has arms.

If the house has arms, the picture list starts with **Remove arms**. Select it to clear the arms in the window. Then select Save.

- **The picture list.** The list shows the folders of your vault that hold pictures. Each folder shows the number of pictures in it. Tap or click a folder to open or close it. Each picture has a small preview before its name.
- **The current picture.** When the list opens, the folder of the current picture is open. The current picture has the mark "In use". The list always starts at the top.
- **Search.** Type a part of the name in the search field. The list then shows all pictures that match, with the folder below each name. The search ignores capital letters, accents and the look of the apostrophe. On a phone, the keyboard opens only when you tap the search field.
- **Keyboard.** The arrow keys move through the rows. On a folder, the right arrow opens it and the left arrow closes it. On a picture, push Enter to select it. The list then closes.
- **Add a picture from this device.** This is the first row of the picture list. If the list starts with a Remove row, this is the second row. It opens the file choice of your device. On an iPhone, you can select a photo in Photos or a file in Files. The plugin copies the picture into the attachment folder (the folder that Obsidian uses for new attachments) and selects it.
- **The copy.** The plugin copies the picture at once. If you then select Cancel, the picture stays in the vault.
- **Colours from the arms.** If a house has arms, the colour choice starts with "Colours from the arms". These are the main colours of the picture, at most 5. Select one of them to make it the house colour. The label "House colours" and the 12 house colours come after them. The plugin never changes the colour of a house by itself.
- **If the colours cannot be read.** If the plugin cannot read the colours of a picture, the window tells you. Then select one of the house colours.
- **The card.** In a tree from top to bottom, the arms show beside the round portrait on the top edge of the card. If the person has no portrait, the arms stand alone there. The arms do not make the text shorter. A sideways tree shows no arms on the cards. If the tree is very small on the screen, the cards do not show the arms.
- **The card size Compact.** On a card of the size Compact, the arms show at the lower right of the card, to the left of the portrait. The name text line does not become shorter there. The other small text lines next to the arms and the portrait are a little shorter.
- **The look of the arms.** The arms keep the shape of the picture. The plugin does not cut the picture and does not add a border or a background. On the card of a person who is dead, the arms are a little pale, like the house colour.
- **Arms in the dark theme.** The plugin shows the arms as they are, in the light theme and in the dark theme. Black parts of arms are difficult to see on a dark card. Give such arms a light border in the picture itself. Use a picture with a transparent background, for example a PNG picture.

On a phone, the tree in a note has no Houses button. First tap Expand to open the full-screen view.

## Portraits

A person can have a portrait (a picture). In a tree from top to bottom, the portrait is a round picture on the top edge of the card. A sideways tree shows no portrait on the cards. On a card of the size Compact, the portrait is a small circle in the lower right corner of the card.

To give a person a portrait:

1. Open the edit sheet of the person.
2. At the top of the sheet, select **Select portrait**.
3. In the picture list, select a picture. To see the pictures, open a folder or type a part of the name.
4. Select the same picture again, or select **Select**.
5. Select **Save**.

To remove the portrait, select **Remove portrait** in the edit sheet, or at the top of the picture list. Then select Save.

- **The part of the picture.** The round picture shows a square part of the picture. For a tall picture, this part is at the top and has the full width of the picture. For a wide picture, it is the middle part. A portrait photo usually has the face in its upper part. To show a different part, see "Select the part of a portrait".
- **The card.** The portrait does not make the card larger. In a tree from top to bottom, the portrait is on the edge of the card, and the text does not become shorter. On the card of a person who is dead, the portrait is a little pale. If you zoom out, the cards show less text. If you zoom far out, the cards show no portraits.
- **The card size Compact.** On a card of the size Compact, the text lines next to the portrait become shorter. If a text is then too long, it ends with "…". This card shows the portrait only when it shows all of its text.
- **The edit sheet.** The edit sheet shows a larger portrait at the top. Select portrait and Remove portrait change the sheet only. Save writes them into the tree text, with the other fields.
- **Select the part of a portrait.** In the edit sheet, select **Select the part** under the portrait. The tool shows the whole picture with a round frame. The area outside the frame is darker. Move the picture under the frame. On a phone, move the picture with one finger. Zoom with two fingers. On the computer, drag the picture to move it. Zoom with the mouse wheel. The zoom slider and the zoom buttons work on every device. With the keyboard, use the arrow keys to move the picture. Use "+" and "−" to zoom. Select **Save** to keep the part. Select **Cancel** to discard it. Select **Reset** to return to the automatic part. Then select Save in the edit sheet. On a phone, the tool fills the screen. The button shows only when the plugin can show the portrait. If you select a new picture, the portrait starts again with the automatic part.
- **Hide the portraits.** In the settings, turn off "Show portraits on cards". The cards then show no portraits. On a card of the size Compact, the text lines have their full width. The edit sheet still shows the portrait.

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
2. Select **Save as picture**.
3. Select **PNG** or **SVG**.
4. Select **Save**.

- **PNG or SVG.** PNG is a picture that most apps and devices can open. SVG is a picture that stays sharp at every size.
- **What the picture shows.** The picture shows the people that the tree shows now: the whole tree, or the family in focus mode. Each card shows all of its text lines, and its arms and portrait if it has them. If the relation finder shows a result, the picture also shows its line. The picture does not show the toolbar or the buttons.
- **Direction and relation names.** The picture has the same direction as the tree on the screen. If the tree is sideways, the cards show no portraits and no arms. The picture follows the setting "Show relation names on cards". If you turn it off, the picture has no relation names.
- **Note name and legend.** The name of the note is at the top of the picture. The legend is at the bottom. It shows the line styles and the houses of the people in the picture.
- **Colours.** The picture always has light colours on a white background, also if you use a dark theme.
- **Where the picture goes.** The plugin saves the picture in the attachment folder of the note. A message tells you the name of the picture and its folder. The name is the name of the note and "tree", for example "Valmont tree.png". In focus mode, the name also tells the family, for example "Valmont tree, family of Roderick Valmont.png". If a picture with this name exists, the plugin adds a number to the name.
- **Share.** If your device can share the picture (for example an iPhone), the message has a **Share** button. Select Share to send the picture to another app. The message stays until you close it.
- **A large tree.** A large tree can take some time. After one second, a message tells you that the plugin makes the picture. You can use the tree during this time.
- **Small names.** A PNG picture has a maximum size. If the tree is very large, the names in a PNG picture are small, and the message tells you. If you want sharp names, save the tree as SVG.
- **Fonts on an iPhone.** On an iPhone, a PNG picture can show a plain font. The tree on the screen can show a different font, for example the font of your notes.
- **The note does not change.** Save as picture does not change the tree text.

On a phone, the tree in a note has no More button. First tap Expand to open the full-screen view.

## Long names

A name that does not fit on one text line uses two or three text lines. Only that card is taller. If a name does not fit on three text lines, the third text line ends with "…". The edit sheet shows the full name. This is the same on the computer, in the full-screen view and on a phone.

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
- **Three text lines.** If the name already needs three text lines, the sobriquet may not fit. Then the card shows "…" after the last whole word of the name, if there is room. If there is no room, the card shows nothing more. The edit sheet shows the whole sobriquet.
- **Where it shows.** The sobriquet shows on a card that shows all of its text. It also shows in Find and in the lists of people. It shows in the lists of title holders, on the house page and in the saved picture.
- **Where it does not show.** A card that shows less text, for example in a tree that you zoom far out, shows the name only. A screen reader (an aid that reads the screen aloud) does not read the sobriquet.
- **Edit it.** The edit sheet has the field "Sobriquet". An empty field removes the text line.
- **No name.** A person with a sobriquet and no name shows neither on the card. The edit sheet still holds both.

## Fold a branch

To fold a branch means to hide the children of a partnership and all the people below them.

- **Fold.** Below each partnership with children, the line down to the children has a small round button with "−". Select it. The children and all the people below them disappear. The line then ends in a sign such as "+ 12". The number tells you how many people are hidden.
- **Open.** Select the "+ N" sign. The people show again. A fold inside the branch stays folded.
- **One button for each partnership.** A person with two partnerships has two buttons. Each button folds only the children of its own partnership. Children with only one parent have their own button below the card of the parent.
- **The edit sheet.** The edit sheet has **Hide descendants** if the children of a partnership of the person show. It has **Show descendants** if a partnership of the person is folded. They fold or open all the partnerships of the person.
- **Find a hidden person.** Find, Focus, the relation finder, a partner tag, the problem list and the house page open the folds that hide the person. Then the tree shows the person.
- **How long a fold stays.** A fold stays until you close the note. It is not written in the tree text. When you open the note again, the tree shows all people.
- **Zoom out.** If you zoom far out, the "−" buttons do not show, but the "+ N" signs stay.
- **On a phone.** The tree in a note has no fold buttons. Tap Expand to fold in the full-screen view. If you select **Hide descendants** in the note, the full-screen view opens with the branch folded. A fold in the full-screen view does not change the tree in the note.
- **Save as a picture.** The saved picture shows the "+ N" signs, but not the "−" buttons.

## Make a note for a person

In the edit sheet, select **Make a note**. The plugin makes a new note with the name of the person, in the folder that Obsidian uses for new notes. The note has one text line with a link back to the note with the tree. The plugin writes the link to the new note into the person's `link` text line. The full-screen view closes first. Then the new note opens. On the computer, it opens in a new tab. On a phone, Back returns to the tree.

- **A note with the same name.** If the folder already has a note with that name, the plugin asks you. You can link to that note, make a new note with a number after the name, or cancel.
- **Make the linked note.** If the person has a link to a note that does not exist, the button is **Make the linked note**. The plugin makes that note. The tree text does not change.
- **Undo.** Undo removes the link from the tree text, and the other changes that you saved with it. The note stays in the vault.
- The sheet of a new person has no **Make a note** button. It shows after the first Save.

## House page

The house page shows the people of one house in a table: generation, name, title, born and died. Generation 1 is the oldest generation with a person of the house. The table lists all the people of the house, even in focus mode and with folds.

- **Open it.** In the Houses window, select the house in the list. On the page of the house, select **People**. You can also select a house in the legend.
- **Show a person.** Select a row. The window closes, and the tree shows the card of the person.
- **Close it.** Select **Close**, or push Esc.
- **Make a note with this table.** The plugin makes a new note with the table. The note does not change when the tree changes.
- If the window is narrow or the text is large, each row has two text lines. This is usual on a phone. The first text line has the name and the title. The second has the generation and the dates. On a phone, the house page is only in the full-screen view.

## Settings

Open Settings. Select Dynasty Tree. You can set:

- the height of a tree in a note, on a computer or tablet;
- the card size (Normal or Compact);
- the tree direction on a phone held upright (Sideways or Like the computer);
- the break places in long names (see "Long names");
- the setting "Reduce movement" (Follow the device, On or Off; see "Reduce movement");
- dates on the cards and reigns (on or off; see "Titles and reigns");
- relation names on the cards (on or off; see "This is me and relations");
- portraits on the cards (on or off; see "Portraits");
- the generation of each person on the house page (on or off);
- the number of generations in focus mode;
- the update of tree links when you rename a note or a picture.

Older versions had two more settings, "Height on a phone" and "Card style in the phone preview". They are gone, because a tree in a note on a phone is a list now. The plugin ignores the old values.

If a tree looks wrong, select the button **Arrange again**. The plugin will arrange each tree again when it shows the tree.

## Reduce movement

The setting "Reduce movement" has three choices. "Follow the device" is the first choice: the plugin uses the setting of your phone or your computer. "On" reduces movement. "Off" keeps the movement.

When the plugin reduces movement, Fit, Find and a double tap change the view at once. The tree does not move slowly. The short highlight of a card is an outline that does not move. The Houses window goes to a person at once.

## The tree text

A tree is a `dynasty` code block with the lists `houses`, `titles`, `people` and `unions`, and an optional `options` map.

````markdown
```dynasty
houses:
  - id: valmont
    name: House Valmont
    color: "#8c2041"
    arms: "[[valmont-arms.png]]"

titles:
  - id: duke-of-valmont
    name: Duke of Valmont
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

- Each person has an `id` (a short name that the plugin uses to find the person). When you add a person, the plugin gives an ID such as `p12`. The plugin makes the ID of a new house or title from its name. If you rename a person, a house or a title, the ID stays the same. The edit sheet of a person shows the ID in a small grey text line at the end, for example "ID: p12".
- A parent can be a birth, adoptive, ward or rumoured parent, for example `parents: [{id: aldric, type: adoptive}]`.
- A partnership (in the `unions` list) can be a marriage, a betrothal, a concubinage or an affair.
- A title has an `id`, a `name`, a `plural` (the name of its list) and `holders`. A holder has `person` (a person ID) or `name` (a holder who is not in the tree). A holder can also have `number`, `from`, `to` and `as`. `as` is the ruler name, if it is not the first word of the name.
- `sobriquet: the Wise` on a person is a short extra name. The card shows it after the name (see "Sobriquet").
- `card-title: king-of-the-vale` on a person selects the title that the card shows. "Show on the card" writes this text line.
- `options` can have `me: roderick`. This text line marks Roderick as you (see "This is me and relations"). "This is me" writes this text line. Remove "This is me" removes it.
- `link` connects a person to a note. On the computer, a click on the name opens that note. On a phone, the edit sheet has "Open linked note".
- `portrait-crop` on a person keeps the part of the portrait that you selected, for example `portrait-crop: "0.12 0.05 0.6"`. Save in the edit sheet writes this text line.
- Folds are never written in the tree text.
- `arms` on a house and `portrait` on a person are links to pictures in the vault. Select arms and Select portrait write these text lines. Remove arms and Remove portrait remove them (see "Coats of arms" and "Portraits").

If the text has an error, the plugin shows a warning above the tree. The warning tells you what to correct.

## Limits

- **Obsidian Publish.** Plugins do not work on Obsidian Publish. A published note shows the tree text, not the tree.
- **Backlinks and the graph view.** Obsidian does not read links inside code blocks. The links of a tree do not show in backlinks or in the graph view. When you rename a note or a picture, the plugin updates the links in the trees. You can turn this off in the settings.
- **No import or export.** The plugin does not read or write GEDCOM files (a common file type for family history data). It does not print the tree, and it does not make PDF files. To print the tree, save it as a PNG or SVG picture (see "Save the tree as a picture"). Then print the picture.
- **One tree in one code block.** A tree cannot use people from other notes.
- **No names through two marriages.** A relation through two marriages has no name. For example, the father of your sister-in-law has no relation name. The relation finder shows the steps of that relation.
- **Older plugin versions.** A phone with plugin version 0.1.x keeps the mark and the titles in the tree text. It does not show the mark, the relation names or the titles. If you delete the marked person on that phone, the mark stays in the tree text. If you delete a holder there, the holder stays in the tree text. It then names nobody, and the tree shows a warning.
- **Older plugin versions and pictures.** A phone with version 0.1.x does not show arms or portraits. If you rename a picture there, the links to it in the trees do not change. Update the plugin on all your devices.
- **Numbers are not counted.** The plugin does not count the numbers of the holders. You write each number.
- **Positions are automatic.** You cannot drag cards to a new position. You can change the order of brothers and sisters in the edit sheet.
- **Tested devices.** The developer tested the plugin on Windows and on an iPhone. The developer did not test it on an Android phone.
