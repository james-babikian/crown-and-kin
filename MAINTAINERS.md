# Notes for maintainers

This file is for a programmer who takes over Crown and Kin. It says where things are, how to check a change, and how to make a release. `README.md` is the short start guide for users; the windows of the plugin explain the rest. `docs/format.md` describes the tree text.

## What the plugin is

Crown and Kin is an Obsidian plugin (id `crown-and-kin`, GPL-3.0). A family tree is plain text in a `kin` code block (YAML) in a note. The plugin reads the text, works out the relations, lays the people out as cards and lines, and draws them as SVG. The user edits the tree in windows. Each edit goes back into the same code block as a small text change. On a phone, a tree in a note is a list, and the full-screen view shows the real tree.

The note is the only place where the tree is stored. Keep it that way.

## The layers

```
src/core        model, parsing, relations, dates, succession, edit operations. No DOM. No Obsidian.
src/layout      numbers only: card positions, line routes. Reads core.
src/render      headless helpers: texts, maths, SVG strings. (src/render/dom builds DOM and SVG.)
src/view        headless view logic: the rules and state of the views. No Obsidian, no DOM.
src/obsidian    the plugin shell: entry, views, windows, files, settings.
```

Imports go one way: `obsidian` -> `view` -> `render/dom` -> `render` -> `layout` -> `core`. A layer never imports a layer to its right. Only `src/obsidian` imports the `obsidian` package; it passes what a lower layer needs (for example `setIcon`) as an argument. Two things enforce this: lint rules (`eslint.config.mjs`) and `tests/scan/import-graph.test.ts`, which also fails on an import cycle. Put new code in the lowest layer that can hold it, so that tests can run it without Obsidian.

Other rules that lint enforces: no `innerHTML` and no HTML parsers (user text never becomes HTML), no `Platform` and no `emulateMobile` in `src` (behaviour follows pointer type and window size), and no colours set from code (colours and fonts come from classes in `styles/`). Text that users read is in text tables (`src/core/messages.ts`, `src/core/refusal-text.ts`, `src/render/*-text.ts`, `src/render/ui-text.ts`, `src/render/tree-info.ts`), not in the middle of the code.

## Build and check

Use Node 22. Run `npm ci` once.

| Command | What it does |
|---|---|
| `npm run build` | Builds `main.js` (not committed) and joins `styles.css` from the chunks in `styles/` (committed). |
| `npm run dev` | The same, and again after each change. |
| `npm run typecheck` | TypeScript, strict mode. |
| `npm run lint` | Project rules: the layer rules above and the DOM and colour rules. It checks `src`, `scripts` and `tests`. |
| `npm test` | The fast tests (Vitest project `fast`). |
| `npm run test:perf` | The slow tests (project `perf`): speed limits, large random trees, fuzz runs. The list is `PERF_FILES` in `vitest.config.ts`. A test that becomes slow goes into that list. |
| `npm run test:all` | Both. |
| `npm run size -- --check` | The size gate: fails if a layer of `main.js` is over its budget in `scripts/size-budget.json`. Run `npm run size` to see the table. Raise a budget only on purpose (`-- --write-budget` sets each to today's size plus 5 %). |
| `npm run format-doc -- --check` | Fails if `docs/format.md` differs from `scripts/format/keys.ts`. Run without `--check` to write it. The README has no generated part. |

The checks to run after every change are: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run size -- --check`.

Some tests have a wall-clock limit (tag `timing`). They can fail on a busy machine. Run such a test alone before you decide it is broken. CI skips them (`npm test -- --tags-filter '!timing'`).

### Official Obsidian lint

The Obsidian review team uses `eslint-plugin-obsidianmd`. It is not in `package.json`. `scripts/obsidian-lint/README.md` has the install and run commands for Git Bash and PowerShell (about 20 seconds per run). A clean run has 0 errors and 4 warnings (the `keyCode === 229` checks; Safari has no replacement). Any error fails the CI job `obsidian-lint`. Run it before a release and after you upgrade `obsidian`.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request. Job `check`: typecheck, lint, build, size gate, fast tests without the `timing` tag. Job `obsidian-lint`: the official lint over `src`. CI checks out the full git history, because a few tests read old releases from git tags; with a shallow copy they skip.

### Pictures and golden files

Some tests compare against recorded results. A failing one means that output changed.
- `tests/golden/*.yaml` are expected outputs of edits; `tests/golden/layout-down/*.txt` are the layout of each sample tree.
- Picture hashes (sha256 of the SVG): `tests/acceptance/m11-spike-hashes.json`, `tests/acceptance/s025-card-hashes.json` and a few values inside tests. Re-record only when the change is meant: look at the difference, then record the new values (`npx tsx scripts/s025-record-hashes.ts` for the card hashes) and say why in the commit.
- `tests/styles/styles-drift.test.ts` fails if `styles.css` is not the join of `styles/*.css`. Run `npm run build` and commit the result.

## Make a release

1. Work on a branch. Make sure all checks above pass, plus the official Obsidian lint.
2. Write the entry for the new version in `CHANGELOG.md`.
3. Run `npm run version-bump -- x.y.z`. It sets the version in `manifest.json`, `package.json`, `package-lock.json` (two places) and `versions.json` (a row `x.y.z` -> the `minAppVersion` of `manifest.json`). It refuses a version that is not higher, or when the files disagree. Commit.
4. Merge to `main`.
5. Make the tag. **The tag is the bare version, equal to the one in `manifest.json`, with no `v`** (for example `0.4.0`). Releases up to 0.3.3 used `v0.3.3`; Obsidian needs the plain form. Push it: `git push origin main 0.4.0`.
6. The workflow `.github/workflows/release.yml` runs on a tag of the form `x.y.z`. It checks that the tag equals the version in all files (`scripts/release-check.mjs`), runs `npm ci`, builds, and collects `main.js`, `manifest.json` and a minified `styles.css` (`scripts/minify-styles.mjs`; it stops if a second CSS engine finds any difference in the styling). It signs a build record for the three files (GitHub artifact attestation; in a private repository this step may fail without stopping the release) and creates a **draft** release with the three files attached.
7. Open the draft on GitHub. Check that it has the three files and the right tag. Replace the short notes with the `CHANGELOG.md` entry. Optionally check a file: `gh attestation verify main.js --repo <owner>/<repo>`. Then press **Publish release**. Nothing is public until you do.

How users get the plugin: the Obsidian plugin directory reads `manifest.json` in the repository to see the newest version, then downloads `main.js`, `manifest.json` and `styles.css` from the release whose tag equals that version. `versions.json` tells older Obsidian versions which plugin version they can use. So `manifest.json` on `main` must never name a version that has no published release. If you want no gap, push the tag first, publish the draft, and then push `main`.

`minAppVersion` is 1.11.0. To raise it, change `manifest.json` first; `version-bump` copies it into `versions.json`. The code has no fallbacks for older Obsidian versions.

## After an Obsidian update: a window or the phone layout looks wrong

Obsidian's own modal, prompt and settings markup changes between versions, and the plugin's windows sit on top of it.

1. Update Obsidian, then open a note with a tree, the person window, the Titles window and the phone layout by hand.
2. Use `window.app` in the developer console of Obsidian to read the new class names of the window that looks wrong.
3. Fix the CSS in `styles/`, not in `styles.css`. `styles.css` is the plain join of the chunks in the order of their numbers (`styles/README.md` has the table); `npm run build` rewrites it. Where things are:
   - The person window: `10-edit-sheet.css`, `11-sheet-family.css`. It hides Obsidian's own close button (`.modal-close-button` before 1.13, `.modal-header-button` from 1.13).
   - Choice steps, the person picker, ID window: `12-choice-steps.css`, `13-person-picker.css`, `27-id-window-picker.css`.
   - The full-screen view: `16-full-screen.css`. Houses and Titles windows: `17-windows.css`, `20-titles-holders.css`, `21-houses-pictures.css`, `35-list-windows.css`. The Calendars window: `37-calendars.css`. The picture viewer: `38-picture-viewer.css`.
   - The phone list: `31-phone-list.css`.
4. The phone layout of the windows (a window narrower than 600 px fills the visible area and follows it when the keyboard opens) is decided in code, in `src/obsidian/modal-layout.ts`, not only in CSS. The small-screen rules in the CSS use the class `is-phone` that this code sets.
5. The settings tab uses Obsidian 1.13's settings definitions when they exist and the old tab on 1.11 and 1.12 (`src/obsidian/settings-rows.ts`, `settings-tab.ts`). Test both when you change a setting.

## Data safety: do not break these

Users keep their family history in these notes. A bug here loses data silently.

- **Minimal edits.** The YAML is never printed again as a whole. An edit is a text patch at the position the `yaml` package reports (`src/core/yaml-patch.ts`, `yaml-list.ts`, `yaml-edit.ts`). Comments, the order of keys, quotes, and keys the plugin does not know stay as the user wrote them. Do not use `YAML.stringify` on a user's block.
- **Prove the change.** After a patch, the code parses the new text and compares it with "old data plus the intended change". If anything else differs, it refuses the write (`src/core/block-write.ts`). Keep that step for every new operation.
- **The stale check.** A window is drawn from one version of the block. Before it writes, the code checks that the block in the note still has that text (`src/core/block-match.ts`). If the user, a sync, or another window changed it, the write is refused with a message. Never skip the check to "make a write work".
- **One writer.** All writes go through the block handle (`src/obsidian/block-handle.ts`): one write at a time for each block, through the editor (so Ctrl/Cmd+Z works) when the note is open, and `vault.process` when it is closed. Link updates after a rename (`src/obsidian/rename-links.ts`) use the same path. Do not write note text from anywhere else.
- **Dates are text.** The plugin reads a date to find its year and never rewrites the text of a date.
- **Old trees keep working.** A new version may add a key. It may not change what an old key means or drop an unknown key (`docs/format.md`). `tests/old-trees/` reads trees from released tags; keep the tags. A block with the language `dynasty` (from version 0.3.0 and earlier) is not read.
- **Golden and fuzz tests are the net.** `tests/layout/fuzz.test.ts` and `tests/core/fuzz-hostile.test.ts` change sample trees at random and demand that nothing throws and that nothing is lost. Do not weaken them or delete a golden file to make a change pass. Read the difference first.
- **Waiting renames are per device.** The list of renames that wait for a sync is kept in the device's local storage, not in `data.json`, so that a synced settings file cannot run an update twice. Do not move it back.
- **Do not make the plugin slow.** Large trees and large vaults are a design limit, not a detail: the plugin must not read every note at start-up (it keeps an index of which notes hold a `kin` or `kin-calendar` block), and a tree of thousands of people must still pan. After a change near start-up, rename, layout or drawing, run `npm run test:perf`.
