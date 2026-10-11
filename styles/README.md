# Style chunks

`styles.css` in the project root is generated. It is the plain join of the files in this folder, in the order of their numbers, with nothing added between them (`styles/concat.mjs`).

- `npm run build` and `npm run dev` write `styles.css` from the chunks (`esbuild.config.mjs`). The dev command also joins again when a chunk changes.
- `tests/styles-drift.test.ts` fails if the committed `styles.css` is not the join of the chunks.
- A new rule goes into the chunk of the package that owns it. A new chunk takes the next free number, or a number between two chunks; the order of the chunks is the order of the cascade.
- The base tokens (`--dynasty-` custom properties for edges, muted text, links and errors) are in `01-base.css`.

| Chunk | Lines in the old `styles.css` |
|---|---|
| `01-base.css` | 1–109 |
| `02-cards.css` | 110–259 |
| `03-detail-levels.css` | 260–305 |
| `04-lines.css` | 306–423 |
| `05-far-couple-tags.css` | 424–478 |
| `06-relation-text.css` | 479–575 |
| `07-focus-mode.css` | 576–653 |
| `08-toolbar.css` | 654–828 |
| `09-read-only-resize.css` | 829–925 |
| `10-edit-sheet.css` | 926–1241 |
| `11-sheet-family.css` | 1242–1374 |
| `12-choice-steps.css` | 1375–1427 |
| `13-person-picker.css` | 1428–1547 |
| `14-undo-notice.css` | 1548–1561 |
| `15-empty-block.css` | 1562–1591 |
| `16-full-screen.css` | 1592–1773 |
| `17-windows.css` | 1774–1887 |
| `18-more-list-finder-bar.css` | 1888–2016 |
| `19-sheet-relation.css` | 2017–2158 |
| `20-titles-holders.css` | 2159–2589 |
| `21-houses-pictures.css` | 2590–2889 |
| `22-card-pictures.css` | 2890–2922 |
| `23-legend-save.css` | 2923–3023 |
| `24-crop-tool.css` | 3024–3155 |
| `25-make-note-house-page.css` | 3156–3420 |
| `26-folds.css` | 3421–3500 |
| `27-id-window-picker.css` | 3501–3651 |
| `28-view-motion.css` | 3652–3659 |
| `29-settings-break-list.css` | 3660–3673 |
| `30-roundel-cards.css` | 3674–3808 |
| `31-phone-list.css` | 3809–4112 |
| `32-focus-list-tip.css` | 4113–4164 |
| `33-heir-cards-ordinal.css` | 4165–4238 |
| `34-succession-bar.css` | 4239–4305 |
| `35-list-windows.css` | 4306–4637 |
