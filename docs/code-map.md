# How Crown and Kin is built

This page is the code map (`docs/code-map.md`): where each part of the plugin is in the code, and how the parts work together. It does not repeat the other pages. [`README.md`](../README.md) says what the plugin does for a user; [`MAINTAINERS.md`](../MAINTAINERS.md) lists every command and the release steps; [`CONTRIBUTING.md`](../CONTRIBUTING.md) says how to send a change; [`docs/format.md`](format.md) describes the tree text.

## The layers

The source is in `src/`, in five layers (`core`, `layout`, `render`, `view`, `obsidian`), and imports go one way, down to `src/core`. [`MAINTAINERS.md`, "The layers"](../MAINTAINERS.md#the-layers) gives the table, the rule and the checks. In code and in these pages, "layer" means one of these five source folders. The reason is practical: the lower layers run in plain Node, so most tests need neither Obsidian nor a browser.

## The one write path into the note

Every edit of a tree goes through one object for each `kin` block, the block handle (`src/obsidian/block-handle.ts`). Every view of that block shares it.

1. A window describes the change as data, an "op" such as "add a parent" (`add-parent`, `src/core/edit.ts`).
2. The handle queues the write, so two writes to one block never overlap.
3. It reads the note, finds the block and checks that the block still holds the text the window started from (`planWrite`, `src/core/block-write.ts`). If the note changed meanwhile, the write is refused.
4. `applyOp` (`src/core/yaml-edit.ts`) makes the change as small text patches. The YAML document is never printed again as a whole, because that would change the user's formatting and drop comments.
5. The new text is parsed again and compared with the old data plus the intended change. If anything else changed, the write is refused (`finish`, `src/core/yaml-patch.ts`).
6. If the note is open in an editor, the change goes in as an editor transaction, so Ctrl/Cmd+Z undoes it. Otherwise it goes through Obsidian's `vault.process`.
7. The handle keeps the last 20 versions of the block text for the plugin's own Undo (`UNDO_LIMIT`, `src/core/block-write.ts`), and every view of the block draws again.

[`MAINTAINERS.md`, "Data safety"](../MAINTAINERS.md#data-safety-do-not-break-these) lists the rules that this path keeps. Only a few other places write files: the calendar note (a note that holds the calendars a tree uses to read dates; see "The calendar note" in `docs/format.md`), a new tree inserted at the cursor, and the notes and pictures that the user makes with a button. Keep it that way.

## How a tree is drawn

1. **Parse** (`src/core/parse.ts`): block text to a `Tree` and a list of problems. A small cache keeps the last four results.
2. **Plan** (`src/view/render-plan.ts`): `planRender` builds the `FamilyGraph` (`src/core/derive.ts`) and decides, with no DOM, what to draw: a tree, a list, an empty box, an error box, or a bar for a very large tree. That bar stands in place of the tree (`src/view/large-tree.ts`). Above 1,500 people it offers "Draw the tree". Above 5,000 people (3,000 for a whole tree in the full-screen view on a phone), or after a draw that took too long, it offers only "Choose a person", which draws the family of one person.
3. **Layout** (`layoutTree`, `src/layout/index.ts`): positions and line routes, behind a cache keyed on everything that can move a card.
4. **Scene** (`buildScene`, `src/render/dom/scene.ts` and the `scene-*.ts` files beside it): the SVG elements.

Focus mode shows one person and their relatives: the plan builds a smaller `FamilyGraph` for that family before layout (`src/core/focus-subgraph.ts`). A fold hides part of a tree: the plan gives the layout the list of hidden people, and the layout arranges the graph without them. In both cases the layout places only what is shown.

Each card holds all three levels of detail (`full`, `compact`, `overview`). A class on the `<svg>` picks one, so a zoom that changes the level rebuilds nothing.

**The lazy scene.** A large tree has many thousands of elements, so the tree view builds them lazily. This applies to each card, to each far-couple tag (a small tag beside a card that names a partner drawn far away) and to each `+` badge (the mark on a card whose relatives a focus view hides). At first, each of these is only a shell: its group element, screen-reader label, Tab stop and hit area. The content is built detached and attached later:

- near the view, at the first draw and after each pan or zoom settles;
- for one person, before that card gets the keyboard focus, a highlight or a window;
- for the rest, in small chunks in idle time, nearest to the view first.

Lines and partnership signs are also built only when they are attached. Text is cut to fit only when it is attached. A filled shell has exactly the children of an eagerly built card, and tests check that both scenes give the same bytes. The headers of `scene.ts`, `scene-fill.ts` and `src/obsidian/tree-view-scene.ts` give the full rules.

"Save as picture" and the picture tests use a second path, `src/render/svg-string.ts`. It draws the same layout as one SVG string, with fixed colours from a palette, and it builds every element at once. The reason is that a saved picture has no Obsidian theme and no CSS, so every colour must be in the SVG itself.

## The tree view

`TreeView` (`src/obsidian/tree-view.ts`) draws and runs one `kin` block, in a note or in the full-screen view. Its code is a chain of classes, one file for each concern. Each class extends the one before it. The order is base, lifecycle, placement, scene, toolbar, actions and list, and `TreeView` itself adds the render pipeline on top. The header of `tree-view.ts` lists the chain. If a class in the chain needs a method that a later class defines, it declares that method as `abstract` in the base class and calls it from there.

The view owns or uses these parts. The first two are separate objects, not links in the chain. Each of them sees the view only through a small interface that the view gives it (a "port"), so they do not import the view.

- `ViewPictures` (`view-pictures.ts`, held as `pictures`): the pictures of the view. It resolves the arms and portrait links, runs the live pictures, checks the picture files, and adds the picture problems to the problem badge of the view. The live pictures (`live-pictures.ts`) fill the arms and portraits near the view from one shared picture store.
- `FinderBars` (`finder-bars.ts`, held as `finder`): the bar of the relation finder and the bar of the Show view of a line of succession. The list class creates it.
- `BlockBinding` (`block-binding.ts`) finds the block's handle and follows the block when the note changes or is renamed.
- The block handle writes the note and keeps the Undo versions. It also keeps the block's memory for the session: the last view in each direction, the last edited person, the session focus, the folds, the relation finder's result, the Show view, the Back list of the phone list and the "Draw the tree" choice (`BlockState`, `src/view/block-state.ts`).
- `BlockViews` (`block-views.ts`) acts on every view of a block at once, for focus and folds.
- `PanZoom` (`src/render/dom/pan-zoom.ts`) does pan and zoom.

Every entry point of the view runs through `guard` (`src/obsidian/tree-view-lifecycle.ts`), for example `onSettingsChange`, which draws the tree again after a setting changes. If an error occurs, `guard` writes it to the console and shows an error box in place of the tree; the full-screen view closes. The error never blanks the note.

## How the tests are organised

The tests are in `tests/`, with one folder per layer and folders for acceptance tests, recorded results (`golden`), import scans (`scan`) and styles. Helpers are in `tests/support/`. Tests run under Vitest in Node; a fake `obsidian` package (`tests/acceptance/fake-obsidian.ts`) lets the shell code run too.

The tests are in three groups. The fast tests run on every change. The slow tests check values on large and random trees. The timing tests check speed limits. [`MAINTAINERS.md`, "Build and check"](../MAINTAINERS.md#build-and-check) gives the command for each group. The slow and timing files are listed in `vitest.config.ts` (`SLOW_FILES`, `TIMING_FILES`).

A few tests start Chrome or Edge to check the real styles in a real browser (`BROWSER_FILES` in `vitest.config.ts`). They look for the browser only in the standard Windows install paths and skip when they find none, so on other systems and in CI ([`MAINTAINERS.md`, "Continuous integration"](../MAINTAINERS.md#continuous-integration)) they do not run. The sample trees in `fixtures/` are real `kin` notes, from a few people to about four hundred.

The maintainer also runs a private test harness that starts a real Obsidian and checks windows, touch, the phone layout and themes. It is not in this repository.

## Where to start reading

1. `docs/format.md`, for the tree text.
2. `src/core/types.ts`, for the model.
3. `src/obsidian/main.ts`, where the plugin starts and registers the `kin` code block.
4. `src/obsidian/tree-view.ts`, for the render pipeline.
5. `src/obsidian/block-handle.ts` and `src/core/block-write.ts`, for the write path.

Every file starts with a short header that says what it does. Read it before the code. Some comments cite numbered design decisions ("D123") or sections of a specification ("spec §1.2"). Those documents are private; the comment beside the mark states the rule, so you do not need them.
