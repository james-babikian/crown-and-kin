// 0.5.2 (D330): the final words of the UI audit are in the text tables, so the waves only wire them. Each test pins one text of
// An internal study and checks the STE limits that the owner's rules set for it.
import { describe, expect, it } from 'vitest';
import { CHANGE_UI, addedAsChild, addedAsParent } from '../../src/render/change-text';
import { CALENDAR_WINDOW_UI, DATE_READOUT_UI } from '../../src/render/calendar-text';
import { LEGEND_DEAD_DOUBT_LABEL, LEGEND_DEAD_LABEL, LEGEND_GROUP_DEAD, LEGEND_GROUP_LINES, LEGEND_LINES_LABEL } from '../../src/render/legend-text';
import { CROP_UI, PICTURES_UI, SAVE_UI } from '../../src/render/picture-text';
import { SETTINGS_UI } from '../../src/render/settings-text';
import { FLOW, NEW_SHEET, REMOVE, SHEET, UNION_EDIT, endedByText, partnerDetail } from '../../src/render/sheet-text';
import { SUCCESSION_UI } from '../../src/render/succession-text';
import { ONE_PERSON_HINT, PHONE_LIST_UI, PROBLEMS_HINT, PROBLEMS_OPEN, UI } from '../../src/render/view-text';
import { HOUSES, TITLES_UI, WIN_LIST_UI, WINDOW_UI, WRITE_TEXT } from '../../src/render/window-text';

const words = (t: string): number => t.split(/\s+/).length;
const sentences = (t: string): string[] => t.split(/(?<=[.!?])\s+(?=[A-Z“{])/);

describe('D330 O-05: the legend', () => {
	it('has the words of the title, the More item and the two group headings', () => {
		expect(UI.legendTitle).toBe('Legend');
		expect(UI.legend).toBe('Show the legend');
		expect(LEGEND_GROUP_LINES).toBe('Lines');
		expect(LEGEND_GROUP_DEAD).toBe('Death labels');
	});

	it('keeps "Line styles" as the heading of the saved picture (D74)', () => {
		expect(LEGEND_LINES_LABEL).toBe('Line styles');
	});

	it('has the two dead rows with no final full stop', () => {
		expect(LEGEND_DEAD_LABEL).toBe('Dead: the year of death is not known');
		expect(LEGEND_DEAD_DOUBT_LABEL).toBe('Counted as dead: the Died text in the note is not clear');
	});
});

describe('D330 TR-13, O-09a, UX-20: tree hints and the phone list', () => {
	it('has the three one-person hints', () => {
		expect(ONE_PERSON_HINT.computer).toBe('Select the card to add a partner, a parent or a child.');
		expect(ONE_PERSON_HINT.phoneList).toBe('Tap the pencil to add a partner, a parent or a child.');
		expect(ONE_PERSON_HINT.tabletNote).toBe('Select Expand. Then select the card to add a partner, a parent or a child.');
	});

	it('names the saved person in the Notice of the phone list', () => {
		expect(PHONE_LIST_UI.savedElsewhereName('Wulf Stranger')).toBe('The plugin saved Wulf Stranger. Tap Find to see this person.');
	});

	it('has the Open button of a problem and its hint', () => {
		expect(PROBLEMS_OPEN.button('House Harrow')).toBe('Open House Harrow');
		expect(PROBLEMS_OPEN.label('Oswin Valmont')).toBe('Open Oswin Valmont: open the window where you can correct this problem');
		expect(PROBLEMS_HINT).toBe('Select a problem to show the people it is about. Select Open next to a problem to correct it.');
	});
});

describe('D330 O-15, O-17, O-19, O-06: buttons, bars and labels', () => {
	it('has the Save key texts', () => {
		expect(SHEET.saveKeysCtrl).toBe('Ctrl+Enter');
		expect(SHEET.saveKeysCmd).toBe('Cmd+Enter');
	});

	it('has the bar words of the title page and the house page', () => {
		expect(WIN_LIST_UI.barTitle).toBe('Title');
		expect(WIN_LIST_UI.barHouse).toBe('House');
	});

	it('has the visible label From the arms and keeps the screen-reader name', () => {
		expect(PICTURES_UI.fromArms).toBe('From the arms');
		expect(PICTURES_UI.coloursFromArms).toBe('Colours from the arms');
	});

	it('names the window of Save as picture like the More item', () => {
		expect(SAVE_UI.title).toBe('Save as picture');
		expect(SAVE_UI.more).toBe(SAVE_UI.title);
	});

	it('has the note on a title that is not saved yet', () => {
		expect(SUCCESSION_UI.newTitleLine).toBe('Save the title first. Then you can show the line of succession.');
	});

	it('has the question of Cancel in the Calendars window in the form of every window', () => {
		expect(CALENDAR_WINDOW_UI.discardText).toBe('You did not save the changes to the calendars.');
	});
});

describe('D330 O-34: four word changes', () => {
	it('has the Details field and its hint', () => {
		expect(SHEET.title).toBe('Title shown under the name');
		expect(SHEET.titleHint).toBe('Write any text, for example “Keeper of the Swans”. For a title with a number and dates, use the Titles section below.');
	});

	it('has "Kind" in the partnership window only', () => {
		expect(UNION_EDIT.type).toBe('Kind');
		expect(UNION_EDIT.typeLabel).toBe('Kind of partnership');
		expect(NEW_SHEET.unionType).toBe('Type of partnership');
		expect(FLOW.unionTypeTitle).toBe('Type of partnership');
	});

	it('has the title of the crop tool and the name line', () => {
		expect(CROP_UI.title).toBe('Crop the portrait');
		expect(CROP_UI.nameLine('Edric Valmont')).toBe('Edric Valmont');
	});

	it('has the two short settings help texts', () => {
		expect(SETTINGS_UI.armsOnCardsDesc).toBe(
			'Choose which cards show the arms of a house. For example, with “Founders and holders”, the founder of House Plantagenet shows the arms. A person who married into a house also shows them. A child of the founder shows them only if the child holds a title. A card always shows personal arms.',
		);
		expect(SETTINGS_UI.phoneDirectionDesc).toBe(
			'This sets the direction of the tree in the full-screen view on a phone that you hold upright. “Sideways” puts the parents at the left. “Like the computer” puts them at the top.',
		);
	});
});

describe('D330 O-23 to O-26, UX-10, UX-11: the Calendars window', () => {
	const T = CALENDAR_WINDOW_UI;

	it('has the one purpose line in place of the short line', () => {
		expect(T.intro).toBe('A calendar lets the plugin find the year in dates, for example “the 3rd Year of the 92nd Olympiad” or “Qinglong Emperor 3”.');
		expect(T.introShort).toBe(T.intro);
	});

	it('has a reading line with no "Example:"', () => {
		expect(T.exampleBack('Qinglong Emperor 1', 130)).toBe('Qinglong Emperor 1 = year 130');
		expect(T.exampleBack('Cycle 3, Year 21', 1203)).toBe('Cycle 3, Year 21 = year 1203');
		expect(T.yearPlaceholder).toBe('1');
	});

	it('has the field hints and the group heading', () => {
		expect(T.cycleHint).toBe('Write a cycle number of this calendar, for example 92.');
		expect(T.yearHintCycles).toBe('Write a year number in that cycle, for example 3.');
		expect(T.sameAsHint).toBe('Write the same year in another calendar, or as a plain year, for example 867.');
		expect(T.noteGroup).toBe('Note for the calendars');
	});

	it('has the Plain years texts', () => {
		expect(T.plainHint).toBe('A plain year is a number, for example 1178. A name list gives each plain year a name from a list that repeats, for example the names of planets.');
		expect(T.noLists).toBe('No name list.');
	});

	it('has the line about the line of succession for a date with no year', () => {
		expect(DATE_READOUT_UI.noYearSuccession).toBe('The line of succession does not use this date.');
	});
});

describe('D330 UX-03, UX-08, UX-17, UX-19, UX-21, UX-22: repairs', () => {
	it('adds the "ended by" part only for a value that the caller passes', () => {
		expect(partnerDetail('marriage', '1126', '1131', 'divorce')).toBe('Marriage, 1126–1131, ended by divorce');
		expect(partnerDetail('marriage', '1126', '1131', 'annulment')).toBe('Marriage, 1126–1131, ended by annulment');
		expect(partnerDetail('marriage', undefined, undefined, 'death')).toBe('Marriage, ended by death');
		expect(partnerDetail('marriage', '1126', '1131')).toBe('Marriage, 1126–1131');
		expect(partnerDetail('marriage', '1126', '1131', null)).toBe('Marriage, 1126–1131');
		expect(endedByText('unknown value')).toBe('');
	});

	it('has the change line of a partnership', () => {
		expect(CHANGE_UI.changedPartnership('Edmund Vane', 'Agnes Thorne')).toBe('The plugin changed the partnership of Edmund Vane and Agnes Thorne.');
	});

	it('has the undo lines', () => {
		expect(WRITE_TEXT.undoDoneChange('Edric Valmont', '01-three-generations')).toBe('The plugin undid the change to Edric Valmont in “01-three-generations”.');
		expect(CHANGE_UI.undoneAddedPartner('Rina Vane', 'Edmund Vane')).toBe('The plugin undid the addition of Rina Vane as a partner of Edmund Vane.');
		expect(REMOVE.undoneDelete('Edric Valmont')).toBe('The plugin undid the deletion of Edric Valmont.');
		expect(CHANGE_UI.undoneAddedParentAndMarriage('Rina Vane', 'Oswin Valmont', 'birth', 'Edmund Vane')).toBe(
			'The plugin undid the addition of Rina Vane as a parent of Oswin Valmont. It also removed the marriage of Rina Vane and Edmund Vane.',
		);
		expect(CHANGE_UI.undoneAddedParent('Rina Vane', 'Oswin Valmont', 'adoptive')).toBe('The plugin undid the addition of Rina Vane as an adoptive parent of Oswin Valmont.');
		expect(CHANGE_UI.undoneAddedChild('Ida Vane', 'Edmund Vane and Rina Vane', 'ward')).toBe('The plugin undid the addition of Ida Vane as a ward of Edmund Vane and Rina Vane.');
		expect(CHANGE_UI.undoneMarkedMe('Edric Valmont')).toBe('The plugin undid the mark “This is me” on Edric Valmont.');
		expect(CHANGE_UI.undoneUnmarkedMe('Edric Valmont')).toBe('The plugin undid the removal of the mark “This is me” from Edric Valmont.');
	});

	it('has the context text of Add child and Add parent', () => {
		expect(FLOW.newOrExistingChild(['Edmund Vane', 'Rina Vane'])).toBe('Add a child of Edmund Vane and Rina Vane. Select a new person or a person who is in the tree.');
		expect(FLOW.newOrExistingChild(['Edmund Vane'])).toBe('Add a child of Edmund Vane. Select a new person or a person who is in the tree.');
		expect(FLOW.newOrExistingParent('adoptive', 'Oswin Valmont')).toBe('Add an adoptive parent to Oswin Valmont. Select a new person or a person who is in the tree.');
		expect(FLOW.newOrExistingParent('ward', 'Oswin Valmont')).toBe('Add a guardian to Oswin Valmont. Select a new person or a person who is in the tree.');
		expect(FLOW.newOrExistingParent('rumoured', 'Oswin Valmont')).toBe('Add a rumoured parent to Oswin Valmont. Select a new person or a person who is in the tree.');
		expect(addedAsParent('other')).toBe('a parent');
		expect(addedAsChild('other')).toBe('a child');
	});

	it('has the portrait link, the number placeholder and the new-item placeholders', () => {
		expect(WINDOW_UI.addPortrait).toBe('Add portrait or arms');
		expect(WINDOW_UI.portraitAndArms).toBe('Portrait and arms');
		expect(TITLES_UI.numberPlaceholder).toBe('For example: II');
		expect(NEW_SHEET.namePlaceholder).toBe('For example: Rosamund de Clifford');
		expect(HOUSES.namePlaceholder).toBe('For example: House Plantagenet');
		expect(WIN_LIST_UI.searchTitles).toBe('Search titles');
		expect(WIN_LIST_UI.searchHouses).toBe('Search houses');
	});
});

describe('D330: STE limits of the new texts', () => {
	const texts: string[] = [
		ONE_PERSON_HINT.computer,
		ONE_PERSON_HINT.phoneList,
		ONE_PERSON_HINT.tabletNote,
		PROBLEMS_HINT,
		PROBLEMS_OPEN.label('House Harrow'),
		SHEET.titleHint,
		SETTINGS_UI.armsOnCardsDesc,
		SETTINGS_UI.phoneDirectionDesc,
		CALENDAR_WINDOW_UI.plainHint,
		CALENDAR_WINDOW_UI.sameAsHint,
		CHANGE_UI.undoneAddedParentAndMarriage('Rina Vane', 'Oswin Valmont', 'birth', 'Edmund Vane'),
		FLOW.newOrExistingChild(['Edmund Vane', 'Rina Vane']),
		SUCCESSION_UI.newTitleLine,
	];

	it('has no sentence of more than 20 words', () => {
		for (const t of texts) for (const s of sentences(t)) expect(words(s), s).toBeLessThanOrEqual(20);
	});

	it('has no -ing word and no contraction', () => {
		for (const t of texts) {
			expect(t, t).not.toMatch(/\b[A-Za-z]{3,}ing\b/);
			expect(t, t).not.toMatch(/\b\w+n['’]t\b/i);
		}
	});
});
