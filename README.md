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
- **Keyboard.** Push Tab to go to the toolbar buttons, the cards and the tags. Push Enter to open a card. Push Esc to close a list or a window.

If you hold the phone upright, the tree turns sideways. The generations go from left to right. You scroll down to see more of the tree.

## Settings

Open Settings. Select Dynasty Tree. You can set:

- the height of a tree in a note, on a computer or tablet;
- the height of a tree in a note, on a phone;
- the card size (Normal or Compact);
- dates on the cards (on or off);
- the number of generations in focus mode;
- the update of tree links when you rename a note.

If a tree looks wrong, select Arrange again. The plugin will arrange the tree again.

## The tree text

A tree is a `dynasty` code block with three lists: `houses`, `people` and `unions`, and an optional `options` map.

````markdown
```dynasty
houses:
  - id: valmont
    name: House Valmont
    color: "#8c2041"

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
- `link` connects a person to a note. On the computer, a click on the name opens that note. On a phone, the edit sheet has "Open linked note".

If the text has an error, the plugin shows a warning above the tree. The warning tells you what to correct.

## Limits

- **Obsidian Publish.** Plugins do not work on Obsidian Publish. A published note shows the tree text, not the tree.
- **Backlinks and the graph view.** Obsidian does not read links inside code blocks. The links of a tree do not show in backlinks or in the graph view. When you rename a note, the plugin updates the links in the trees. You can turn this off in the settings.
- **No import or export.** The plugin does not read or write GEDCOM files (a common file type for family history data). It does not print the tree.
- **One tree in one code block.** A tree cannot use people from other notes.
- **Positions are automatic.** You cannot drag cards to a new position. You can change the order of brothers and sisters in the edit sheet.
- **Tested devices.** The developer tested the plugin on Windows and on an iPhone. The developer did not test it on an Android phone.
