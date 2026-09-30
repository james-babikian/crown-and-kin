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
- **Move and zoom.** On the computer, drag the tree. To zoom, hold Ctrl and turn the mouse wheel. On a phone, the tree in a note does not move. Tap Expand to open the full-screen view. Move the tree with one finger. Zoom with two fingers.
- **Full-screen view.** Select Expand. Select the X button to close it. You can also push Esc.
- **Find.** In the full-screen view, select Find. Type a name.
- **Focus.** Select Focus. Choose a person. The tree shows only the family of that person. A "+" sign on a card shows that the person has more relatives outside the view. Select Show all people to see the whole tree.
- **Pin.** In the edit sheet, select "Pin focus here". The tree then always opens on the family of that person. Select "Remove pin" to stop this.
- **Houses.** Select the Houses button (the castle) to add, rename, recolour or delete a house. On a phone, the Houses button is only in the full-screen view.
- **Undo.** After you delete a person, a relationship or a house, the plugin shows a message with Undo. To undo a different tree edit, use the command "Undo last tree edit".
- **Keyboard.** Push Tab to go to the toolbar buttons, the cards, the tags, the fold buttons and the "+ N" signs. Push Enter to open a card. Push Esc to close a list or a window.

If you hold the phone upright, the tree turns sideways. The generations go from left to right. You scroll down to see more of the tree.

On a phone, the full-screen view has no Fit button and no Legend button. Select More (the "⋯" button) in the toolbar. The list has "Fit the tree in the view" and "Show the line styles". This keeps the toolbar in one row, so the Close button is always on the screen.

## This is me and relations

You can mark one person in the tree as you. Each card then shows the relation of that person to you.

- **Mark a person as you.** Open the edit sheet of the person. In Actions, select "This is me". If another person has the mark, the mark moves to this person.
- **The card "You".** The card of the marked person shows "You". It also has a thicker border in the accent colour of your theme.
- **Relation names on the cards.** When the tree has a mark, each card gets one more small text line at the bottom. This text line shows the relation to you, for example "Father", "Half-sister" or "Second cousin once removed". All cards get a little taller. A card of a person with no relation to you has no relation name. If the tree is very small on the screen, the cards do not show the relation names.
- **The edit sheet.** The Family section starts with "Relation to you:" and the relation name. A person can have more than one relation to you, for example after a marriage between cousins. Then the next text line starts with "Also:" and gives the other relations.
- **Show the line.** In the edit sheet, select "Show the line". The relation finder opens with the line from you to the person (see "Relation finder").
- **Remove the mark.** Open the edit sheet of the marked person. Select Remove "This is me".
- **Hide the relation names.** In the settings, turn off "Show relation names on cards". The cards keep their size. The edit sheet still shows the relation.
- **Undo.** The command "Undo last tree edit" undoes "This is me" and Remove "This is me". If the note is open in Live Preview, Ctrl+Z (Cmd+Z on a Mac) also undoes them.

The mark is in the tree text. All your devices show the same mark.

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

- A bar at the top of the tree shows one sentence, for example "Wren is Roderick's half-sister." The sentence gives the relation of the second person to the first person.
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

- **The card.** The card of a holder shows the title with the reign, for example "Duke of Valmont (r. 1175–1207)". If the text is too long for one text line, it continues on a second text line. Then only that card is taller. If the holder has a number, the name text line shows the ruler name and number, for example "Aldric II". The edit sheet and the list of holders show the full name.
- **Two or more titles.** The card shows the first title of the person in the list of titles. To show another title, open the edit sheet. In Titles, select "Show on the card" at that title. The title that the card shows says "On the card".
- **Your own title text.** If a holder has your text in the Title field, the card shows that text. The reign of the first title follows it. If you select "Show on the card" at a title, the card shows that title instead of your text.
- **The edit sheet.** The Titles section is between the fields and Family. It shows each title of the person with the number and the reign. Select **Edit** to change the number, the ruler name, From or Until. A text line under the fields shows the result, for example "Ser Darian Harrow shows as: Darian II". Select **Add title** to add the person as the newest holder of a title, or of a new title.
- **Remove.** In the edit sheet, each reign of a title has its own **Remove**. **Remove** removes only that reign from the holders. If the person has other reigns of that title, they stay.
- **The Titles window.** In the toolbar, select More (the "⋯" button). Then select Titles. The window lists the titles of the tree. Select **Show holders** to see the holders of a title. In this window, you can rename or delete a title. In "Name for a man", you can type the name for a man, for example "King of the Isles". In "Name for a woman", you can type the name for a woman, for example "Duchess of Valmont". The card and the edit sheet of a man show the name for a man. The card and the edit sheet of a woman show the name for a woman. If this name is empty, the card and the edit sheet show the title name. The card of a holder whose sex is not male or female also shows the title name. In "Name of the list", you can type a name for the list of holders, for example "Dukes of Valmont". You can also add, edit, move or remove a holder.
- **A holder who is not in the tree.** A holder who is not in the tree shows in pale text. To add such a holder, select Add holder. Then select "A holder who is not in the tree". Select a holder's name to see the card in the tree.
- **Save and Cancel.** The Titles window changes nothing until you select Save. Save makes one change, which one Undo reverses. Cancel discards your changes.
- **A note with the list.** At the end of the holders of a title, select "Make a note with this table". The plugin makes a new note with a table of the holders. The note has the name of the list, for example "Dukes of Valmont". The note is in the folder that Obsidian uses for new notes. The note does not change when the tree changes.
- **Find.** Find and the other person lists also find a holder by the ruler name and number, for example "Aldric II".
- **Dates.** If you turn off "Show dates on cards", the cards also do not show the reigns.

On a phone, the tree in a note has no More button. First tap Expand to open the full-screen view.

## Coats of arms

A house can have arms (a coat of arms). The arms are a picture in your vault. They show on the cards of the people of the house, in the Houses window and in the legend.

To give a house its arms:

1. Select the Houses button (the castle).
2. Select the box before the name of the house. If the house has no arms, the box is empty and has a dashed border.
3. In the picture list, select a picture. To see the pictures, open a folder or type a part of the name.
4. Select the same picture again, or select **Select**.
5. Select **Save**.

You can also select the colour of the house in the Houses window. The colour choice has **Select arms** and **Remove arms**.

- **The picture list.** The list shows the folders of your vault that hold pictures. Each folder shows the number of pictures in it. Tap or click a folder to open or close it. Each picture has a small preview before its name. The folder of the current picture is open when the list opens, and the current picture has the mark "In use". The list always starts at the top.
- **Search.** Type a part of the name in the search field. The list then shows all pictures that match, with the folder below each name. On a phone, the keyboard opens only when you tap the search field.
- **Keyboard.** The arrow keys move through the rows. On a folder, the right arrow opens it and the left arrow closes it. On a picture, press the Enter key to choose it and close the list.
- **Add a picture from this device.** This is the first row of the picture list. It opens the file choice of your device. On an iPhone, you can select a photo in Photos or a file in Files. The plugin copies the picture into the attachment folder (the folder that Obsidian uses for new attachments) and selects it. The plugin copies the picture at once. If you then select Cancel, the picture stays in the vault.
- **Colours from the arms.** If a house has arms, the colour choice starts with "Colours from the arms". These are the main colours of the picture, at most 5. Select one of them to make it the house colour. The label "House colours" and the 12 house colours come after them. The plugin never changes the colour of a house by itself. If the plugin cannot read the colours of a picture, the window tells you, and you select one of the house colours.
- **Save and Cancel.** The Houses window changes nothing until you select Save. Save makes one change, which one Undo reverses. Cancel discards your changes.
- **The card.** The arms show in the top right corner of the card. The name text line is a little shorter for them. The arms keep the shape of the picture. The plugin does not cut the picture and does not add a border or a background. On the card of a person who is dead, the arms are a little pale, like the house colour. If the tree is very small on the screen, the cards do not show the arms.
- **Arms in the dark theme.** The plugin shows the arms as they are, in the light theme and in the dark theme. Black parts of arms are difficult to see on a dark card. Give such arms a light border in the picture itself. Use a picture with a transparent background, for example a PNG picture.

On a phone, the tree in a note has no Houses button. First tap Expand to open the full-screen view.

## Portraits

A person can have a portrait (a picture). The portrait shows in a small circle in the lower right corner of the card.

To give a person a portrait:

1. Open the edit sheet of the person.
2. At the top of the sheet, select **Select portrait**.
3. In the picture list, select a picture. To see the pictures, open a folder or type a part of the name.
4. Select the same picture again, or select **Select**.
5. Select **Save**.

To remove the portrait, select **Remove portrait** in the edit sheet. Then select Save.

- **The part of the picture.** The circle shows a square part of the picture. For a tall picture, this part is at the top and has the full width of the picture. For a wide picture, it is the middle part. A portrait photo usually has the face in its upper part. To show a different part, see "Select the part of a portrait".
- **The card.** The portrait does not make the card larger. The text lines next to the portrait become shorter. If a text is then too long, it ends with "…". On the card of a person who is dead, the portrait is a little pale. The cards show the portraits only when they show all of their text. If you zoom out, the cards show less text and no portraits.
- **The edit sheet.** The edit sheet shows a larger portrait at the top. Select portrait and Remove portrait change the sheet only. Save writes them into the tree text, with the other fields.
- **Select the part of a portrait.** In the edit sheet, select **Select the part** under the portrait. The tool shows the whole picture with a round frame. The area outside the frame is darker. Move the picture under the frame. On a phone, move the picture with one finger. Zoom with two fingers. On the computer, drag the picture to move it. Zoom with the mouse wheel. The zoom slider and the zoom buttons work on every device. With the keyboard, use the arrow keys to move the picture. Use "+" and "−" to zoom. Select **Save** to keep the part. Select **Cancel** to discard it. Select **Reset** to return to the automatic part. Then select Save in the edit sheet. On a phone, the tool fills the screen. The button shows only when the plugin can show the portrait. If you select a new picture, the portrait starts again with the automatic part.
- **Hide the portraits.** In the settings, turn off "Show portraits on cards". The cards then show no portraits, and the text lines have their full width. The edit sheet still shows the portrait.

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
- **What the picture shows.** The picture shows the people that the tree shows now: the whole tree, or the family in focus mode. Each card shows all of its text lines, and its arms and portrait if it has them. As on the screen, a text line next to a portrait can end with "…". If the relation finder shows a result, the picture also shows its line. The picture does not show the toolbar or the buttons.
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

- **Open it.** In the Houses window, select **People** next to a house. You can also select a house in the legend.
- **Show a person.** Select a row. The window closes, and the tree shows the card of the person.
- **Close it.** Select **Close**, or push Esc.
- **Make a note with this table.** The plugin makes a new note with the table. The note does not change when the tree changes.
- On a phone, each row has two text lines. The house page is in the full-screen view, not in the tree in a note.

## Settings

Open Settings. Select Dynasty Tree. You can set:

- the height of a tree in a note, on a computer or tablet;
- the height of a tree in a note, on a phone;
- the card size (Normal or Compact);
- dates on the cards and reigns (on or off; see "Titles and reigns");
- relation names on the cards (on or off; see "This is me and relations");
- portraits on the cards (on or off; see "Portraits");
- the number of generations in focus mode;
- the update of tree links when you rename a note or a picture.

If a tree looks wrong, select Arrange again. The plugin will arrange the tree again.

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

- Each person has an `id`. When you add a person, the plugin makes the id from the name. The id does not change when you rename the person.
- A parent can be a birth, adoptive, ward or rumoured parent, for example `parents: [{id: aldric, type: adoptive}]`.
- A partnership (in the `unions` list) can be a marriage, a betrothal, a concubinage or an affair.
- A title has an `id`, a `name`, a `plural` (the name of its list) and `holders`. A holder has `person` (a person id) or `name` (a holder who is not in the tree), and can have `number`, `from`, `to` and `as` (the ruler name, if it is not the first word of the name).
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
- **Older plugin versions.** A phone with plugin version 1.0.x keeps the mark and the titles in the tree text. It does not show the mark, the relation names or the titles. If you delete the marked person on that phone, the mark stays in the tree text. If you delete a holder there, the holder stays in the tree text. It then names nobody, and the tree shows a warning.
- **Older plugin versions and pictures.** A phone with version 1.0.x does not show arms or portraits. If you rename a picture there, the links to it in the trees do not change. Update the plugin on all your devices.
- **Numbers are not counted.** The plugin does not count the numbers of the holders. You write each number.
- **Positions are automatic.** You cannot drag cards to a new position. You can change the order of brothers and sisters in the edit sheet.
- **Tested devices.** The developer tested the plugin on Windows and on an iPhone. The developer did not test it on an Android phone.
