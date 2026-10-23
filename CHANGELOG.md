# Changelog

All notable changes for users. The newest version is first.

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
