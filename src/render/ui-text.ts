/*
 * Fixed text of the windows, the edit sheet, the settings and the Notices, in one place for old imports. The tables are in
 * `view-text.ts` (the tree view), `succession-text.ts` (the line of succession), `window-text.ts` (the windows and the Notices about writes),
 * `sheet-text.ts` (the edit sheet and its flows), `settings-text.ts` (the settings and the link update) and `picture-text.ts` (arms and pictures).
 * This file only re-exports their names. Problem sentences themselves come from `src/core/messages.ts`.
 */

export { ADD_UI, BLOCK_UI, FINDER_UI, FOCUS_UI, FOLD_UI, FULL_UI, HINT_UI, LARGE_UI, PHONE_LIST_UI, PROBLEMS_HINT, PROBLEMS_OPEN, PROBLEMS_POPUP_BUTTON, ONE_PERSON_HINT, UI, groupCount, problemsLabel, problemsPopupLine, problemsTitle } from './view-text';
export { SUCCESSION_UI } from './succession-text';
export { FAMILY, FLOW, ME_UI, NEW_SHEET, NOTE_UI, REMOVE, SHEET, UNION_EDIT, UNION_TYPE_TEXT, deleteText, endedByText, parentTypeText, partnerDetail, unionDates, unionTypeText } from './sheet-text';
export { HOUSES, HOUSE_COLOUR_NAMES, HOUSE_PAGE_UI, ID_UI, TITLES_UI, WINDOW_UI, WIN_LIST_UI, WRITE_TEXT } from './window-text';
export { INSERT_UI, RENAME_UI, SETTINGS_UI, TIMING_UI, renamedKind, renamedText } from './settings-text';
export type { LinkReportText } from './settings-text';
export { CROP_UI, PICKER_UI, PICTURES_UI, SAVE_UI, deviceNotice } from './picture-text';
export { isolateName } from './name-bidi';
