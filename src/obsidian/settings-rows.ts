/*
 * The one list of the plugin settings (spec §9, D33): the groups, the order, the keys and the texts of the settings page.
 * The old page (Obsidian 1.11 and 1.12, `display()`) and the declarative page (Obsidian 1.13 and later, `getSettingDefinitions()`)
 * are both drawn from this list in `settings-tab.ts`, so they cannot differ. The file holds data only and needs no Obsidian code.
 */

import { SETTINGS_UI } from '../render/ui-text';
import { ARMS_ON_CARDS, DEFAULT_SETTINGS, GENERATIONS, OLD_AGE, PHONE_DIRECTIONS, REDUCE_MOTIONS, SUCCESSION_LENGTH, YOUNG_DEATH_AGE, type DynastySettings } from '../view/settings';

type Keys<V> = { [K in keyof DynastySettings]: DynastySettings[K] extends V ? K : never }[keyof DynastySettings];

/** The text of a setting; every row has both. */
interface RowText {
	name: string;
	desc: string;
}

/** An on/off switch for a Boolean setting. */
export interface ToggleRow extends RowText {
	kind: 'toggle';
	key: Keys<boolean>;
}

/** A drop-down list. `change` turns the chosen value into the stored change; a value that is not in the list gives the default. */
export interface DropdownRow extends RowText {
	kind: 'dropdown';
	key: 'phoneDirection' | 'reduceMotion' | 'armsOnCards' | 'focusGenerations';
	/** The value and the text of each choice, in the order shown. */
	options: readonly (readonly [string, string])[];
	change: (value: string) => Partial<DynastySettings>;
}

/** The text field of the height on a computer or tablet. It has its own typing rules (stored when the typing stops). */
export interface HeightRow extends RowText {
	kind: 'height';
	key: 'embedHeightDesktop';
}

/** A text field for a whole number in a range. */
export interface NumberRow extends RowText {
	kind: 'number';
	key: 'successionLength' | 'oldAge' | 'youngDeathAge';
	/** The class on the field. */
	cls: string;
	range: { min: number; max: number };
}

/** The text area of the break list. */
export interface AreaRow extends RowText {
	kind: 'area';
	key: 'breakWords';
}

/** A button that runs an action and has no stored value. */
export interface ButtonRow extends RowText {
	kind: 'button';
	label: string;
	notice: string;
}

/** One row of the settings table. */
export type SettingRow = ToggleRow | DropdownRow | HeightRow | NumberRow | AreaRow | ButtonRow;

/** One group under a heading (D33). */
export interface SettingGroupSpec {
	heading: string;
	rows: readonly SettingRow[];
}

/** One stored change for one key. */
export const patch = <K extends keyof DynastySettings>(key: K, value: DynastySettings[K]): Partial<DynastySettings> => ({ [key]: value });

const t = SETTINGS_UI;

const toggle = (key: ToggleRow['key'], name: string, desc: string): ToggleRow => ({ kind: 'toggle', key, name, desc });

/** A drop-down of the values of a list type; the text of each value comes from `labels`. */
function choice<K extends 'phoneDirection' | 'reduceMotion' | 'armsOnCards'>(key: K, name: string, desc: string, values: readonly DynastySettings[K][], labels: Record<DynastySettings[K] & string, string>): DropdownRow {
	return {
		kind: 'dropdown',
		key,
		name,
		desc,
		options: values.map((v) => [v, labels[v]] as const),
		change: (value) => patch(key, values.find((x) => x === value) ?? DEFAULT_SETTINGS[key]),
	};
}

const whole = (key: NumberRow['key'], cls: string, name: string, desc: string, range: NumberRow['range']): NumberRow => ({ kind: 'number', key, cls, name, desc, range });

const generations: DropdownRow = {
	kind: 'dropdown',
	key: 'focusGenerations',
	name: t.generations,
	desc: t.generationsDesc,
	options: Array.from({ length: GENERATIONS.max - GENERATIONS.min + 1 }, (_, i) => [String(GENERATIONS.min + i), String(GENERATIONS.min + i)] as const),
	change: (value) => patch('focusGenerations', Number(value)),
};

/** All settings, in the order of the page. */
export const SETTING_GROUPS: readonly SettingGroupSpec[] = [
	{
		heading: t.groups.view,
		rows: [
			{ kind: 'height', key: 'embedHeightDesktop', name: t.heightDesktop, desc: t.heightDesktopDesc },
			choice('phoneDirection', t.phoneDirection, t.phoneDirectionDesc, PHONE_DIRECTIONS, { sideways: t.directionSideways, down: t.directionDown }),
			choice('reduceMotion', t.reduceMotion, t.reduceMotionDesc, REDUCE_MOTIONS, { system: t.reduceFollow, on: t.reduceOn, off: t.reduceOff }),
		],
	},
	{
		heading: t.groups.cards,
		rows: [
			// Which cards show the arms of a house.
			choice('armsOnCards', t.armsOnCards, t.armsOnCardsDesc, ARMS_ON_CARDS, { few: t.armsFew, all: t.armsAll }),
			{ kind: 'area', key: 'breakWords', name: t.breakWords, desc: t.breakWordsDesc },
			toggle('showDates', t.dates, t.datesDesc),
			toggle('showRelations', t.relations, t.relationsDesc),
			toggle('showPortraits', t.portraits, t.portraitsDesc),
		],
	},
	// F10a, D246: the two settings about relations and warnings are not card settings.
	{
		heading: t.groups.relations,
		rows: [toggle('oneParentUnknown', t.oneParentUnknown, t.oneParentUnknownDesc), toggle('warnManyParents', t.manyParents, t.manyParentsDesc)],
	},
	// F10a: the three settings of the line of succession are not card settings.
	{
		heading: t.groups.succession,
		rows: [
			whole('successionLength', 'dynasty-setting-succession-length', t.successionLength, t.successionLengthDesc, SUCCESSION_LENGTH),
			whole('oldAge', 'dynasty-setting-old-age', t.oldAge, t.oldAgeDesc, OLD_AGE),
			whole('youngDeathAge', 'dynasty-setting-young-death-age', t.youngDeathAge, t.youngDeathAgeDesc, YOUNG_DEATH_AGE),
		],
	},
	{ heading: t.groups.housePage, rows: [toggle('showHouseGeneration', t.houseGeneration, t.houseGenerationDesc)] },
	{ heading: t.groups.focus, rows: [generations] },
	{ heading: t.groups.links, rows: [toggle('updateLinks', t.links, t.linksDesc)] },
	{ heading: t.groups.repair, rows: [{ kind: 'button', name: t.cache, desc: t.cacheDesc, label: t.cacheButton, notice: t.cacheDone }] },
];
