/*
 * The texts of the picture viewer (spec §0 D256): the menu items, the buttons, the text line under the name and the screen-reader labels. They follow the
 * rules for plugin text (Simplified Technical English, ASD-STE100) (short sentences, active voice, no -ing word). One table, so a later session finds every word in one place.
 */

const PORTRAIT = 'Portrait';

/** The texts of the picture viewer and of the picture menu, by name. */
export const VIEWER_UI = {
	/** The first item of the picture menu of a person, and of the arms menu of a house. */
	viewPortrait: 'View portrait',
	viewArms: 'View arms',
	close: 'Close',
	/** The label of the two small pictures as a group (screen reader). */
	group: 'Pictures',
	/** The two small pictures (screen reader). */
	showPortrait: 'Show the portrait',
	showArms: 'Show the arms',
	/** Shown in the place of the picture while its large copy is on its way, and when it cannot show. */
	loading: 'The plugin loads the picture.',
	problem: 'The plugin cannot show this picture. Close the window and try again.',
	/** The word that starts the text line under the name of a portrait. */
	portrait: PORTRAIT,
	personalArms: 'Personal arms',
	/** The text line of arms that have no owner name. */
	arms: 'Arms',
	/** The name of a person who has none yet. */
	unnamed: 'Unnamed',
	thisPerson: 'this person',
	/** The label of the window and the text of the picture for a screen reader. */
	portraitOf: (name: string) => `Portrait of ${name}`,
	armsOf: (owner: string) => `Arms of ${owner}`,
	/** The text line under the name of a portrait: the word, the title and the dates, with a dot between them. */
	portraitLine: (parts: readonly string[]) => [PORTRAIT, ...parts.filter((p) => p.trim() !== '')].join(' · '),
};
