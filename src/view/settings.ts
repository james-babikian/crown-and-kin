/*
 * Reads the stored settings (spec §9). Pure and free of `obsidian`, so it has unit tests: stored data
 * can come from an older version, a sync conflict or a hand edit of `data.json`.
 */

/** D150: the direction of the full-screen tree on a phone held upright. */
export type PhoneDirection = 'sideways' | 'down';
/** The values of `PhoneDirection`. */
export const PHONE_DIRECTIONS: readonly PhoneDirection[] = ['sideways', 'down'];

/** The choices of "Reduce movement" (D126). */
export type ReduceMotion = 'system' | 'on' | 'off';
/** The values of `ReduceMotion`. */
export const REDUCE_MOTIONS: readonly ReduceMotion[] = ['system', 'on', 'off'];

/** D204: which cards show the arms of their house. */
export type ArmsOnCards = 'few' | 'all';
/** The values of `ArmsOnCards`. */
export const ARMS_ON_CARDS: readonly ArmsOnCards[] = ['few', 'all'];

/** The most characters of `breakWords` that this version accepts. A longer stored text is invalid. */
export const BREAK_WORDS_MAX = 20000;

/** The plugin settings (spec §9, D33), stored with `Plugin.saveData`. The settings tab and every reader use this shape. */
export interface DynastySettings {
	/** Height of a tree in a note on a computer or tablet, in px (spec §7.5), 100–5000. Default 500. `options.height` wins. */
	embedHeightDesktop: number;
	/** Dates on cards, and the reigns in the title text line (spec §13.3). Born and died do not change the card height; a reign can make the title two text lines, so the card can get taller (D61). */
	showDates: boolean;
	/** D40, D145 (spec §13.1): relation names on cards. Off removes the word and its plate, so the cards are shorter and the marked person gets the You tab; the screen-reader label keeps the relation. The list in a note on a phone follows it. */
	showRelations: boolean;
	/** D174 (spec §9, §13.1): a person with one listed birth parent has a second parent who is not known, so two such people are at most half-siblings. One setting for every tree in the vault. Default on. */
	oneParentUnknown: boolean;
	/** Spec §13.7: portraits on cards. Off: no card shows a portrait or its room; a change lays the trees out again. */
	showPortraits: boolean;
	/** Focus mode default generations (§5.6, §9), a whole number 0–10. Default 3; `options.generations` wins. */
	focusGenerations: number;
	/** D113 item 4: the house page shows the generation of each person. Off: only the dates (and no Generation column). Read when the page opens. */
	showHouseGeneration: boolean;
	/** Update tree links when a note or a picture is renamed (§6.9, D6, §13.0 item 3). Default on. */
	updateLinks: boolean;
	/** D118: the user's own break places for long names, as typed: one word on each text line, hyphen-marked ("Long-na-munda"). Default ''. */
	breakWords: string;
	/** D124 item 5, D126: reduce movement. 'system' follows the device. Default 'system'. */
	reduceMotion: ReduceMotion;
	/** D150: the direction of the full-screen tree on a phone held upright. Default 'sideways' (D24 as before). */
	phoneDirection: PhoneDirection;
	/** The number of people in the line of succession, a whole number 1–20. Default 5. */
	successionLength: number;
	/** The line warns about a person older than this many years with no death date, 0–1000; 0 gives no warning. Default 110. */
	oldAge: number;
	/** A person who died younger than this age opens no branch in the line, 0–1000; 0 shows every open branch. Default 0. */
	youngDeathAge: number;
	/** D204: `'few'` shows house arms on the first person of a house, a married-in spouse of another house and a holder; `'all'` shows them on every card. Default 'few'. */
	armsOnCards: ArmsOnCards;
	/** D188 item 10: warn about more than 2 birth, adoptive or ward parents. Off stops the warning `too-many-parents` for those types. Default on. */
	warnManyParents: boolean;
}

/** The settings a fresh install starts with. */
export const DEFAULT_SETTINGS: DynastySettings = {
	embedHeightDesktop: 500,
	showDates: true,
	showRelations: true,
	oneParentUnknown: true,
	showPortraits: true,
	showHouseGeneration: true,
	focusGenerations: 3,
	updateLinks: true,
	breakWords: '',
	reduceMotion: 'system',
	phoneDirection: 'sideways',
	successionLength: 5,
	oldAge: 110,
	youngDeathAge: 0,
	armsOnCards: 'few',
	warnManyParents: true,
};

/*
 * How views get the settings: `TreeHost` has `readonly settings: DynastySettings`; when a setting
 * changes, the plugin calls `onSettingsChange()` on every view (as for `css-change`), and the view
 * draws again. Embed height rule (D30, D144): `options.height`, else
 * `${embedHeightDesktop}px`; a tree in a note on a phone is a list with its natural height and has no height setting.
 */

/** Valid range for `embedHeightDesktop`, in px. */
export const DESKTOP_HEIGHT = { min: 100, max: 5000 } as const;
/** Valid range for `focusGenerations`. */
export const GENERATIONS = { min: 0, max: 10 } as const;
/** Valid range for `successionLength`. */
export const SUCCESSION_LENGTH = { min: 1, max: 20 } as const;
/** Valid range for `oldAge`; 0 stops the warning. */
export const OLD_AGE = { min: 0, max: 1000 } as const;
/** Valid range for `youngDeathAge`; 0 shows every open branch. */
export const YOUNG_DEATH_AGE = { min: 0, max: 1000 } as const;

const wholeIn = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max;

/*
 * One reader for each setting. It returns the value, or `undefined` when the stored value is not valid for
 * this version. Both `normaliseSettings` (invalid becomes the default) and `readStoredSettings` (invalid is
 * also kept as stored, spec §9) use it, so the two can never disagree on what is valid.
 */
const boolOf = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const choice = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);
const whole =
	(r: { min: number; max: number }) =>
	(v: unknown): number | undefined =>
		wholeIn(v, r) ? v : undefined;
// A height typed as 480.5 is still a height: round it, then check the range.
const height = (v: unknown): number | undefined => {
	const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
	return wholeIn(n, DESKTOP_HEIGHT) ? n : undefined;
};

const READERS: { [K in keyof DynastySettings]: (v: unknown) => DynastySettings[K] | undefined } = {
	embedHeightDesktop: height,
	showDates: boolOf,
	showRelations: boolOf,
	oneParentUnknown: boolOf,
	showPortraits: boolOf,
	showHouseGeneration: boolOf,
	focusGenerations: whole(GENERATIONS),
	updateLinks: boolOf,
	// Too long is invalid, not cut: a newer version may allow more, and the raw text is then kept and written back unchanged.
	breakWords: (v) => (typeof v === 'string' && v.length <= BREAK_WORDS_MAX ? v : undefined),
	reduceMotion: (v) => choice(REDUCE_MOTIONS, v),
	phoneDirection: (v) => choice(PHONE_DIRECTIONS, v),
	successionLength: whole(SUCCESSION_LENGTH),
	oldAge: whole(OLD_AGE),
	youngDeathAge: whole(YOUNG_DEATH_AGE),
	armsOnCards: (v) => choice(ARMS_ON_CARDS, v),
	warnManyParents: boolOf,
};

const KNOWN_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof DynastySettings)[];

const asRecord = (raw: unknown): Record<string, unknown> => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});

/** Reads stored data: every missing, wrong-type or out-of-range value becomes its default. Pure. */
export const normaliseSettings = (raw: unknown): DynastySettings => {
	const s = asRecord(raw);
	const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
	for (const k of KNOWN_KEYS) out[k] = READERS[k](s[k]) ?? DEFAULT_SETTINGS[k];
	return out as unknown as DynastySettings;
};

/** The key of the settings version in `data.json`. It is not a setting: it is not in `DynastySettings`, and `settingsChanges` never reports it. */
export const VERSION_KEY = 'settingsVersion';
/** The settings version that this release writes. A higher stored version is kept as stored. */
export const SETTINGS_VERSION = 1;

/**
 * Every key that an earlier release stored as a setting and this release does not (from the git history of
 * this file). A load drops them and a save does not write them again (spec §9, D144, D179).
 */
export const REMOVED_KEYS: readonly string[] = ['cardSize', 'embedHeightPhone', 'phoneCardStyle'];

/**
 * What a load keeps of `data.json` besides the settings, so that a save does not lose it: the version,
 * the keys that no release knows, and the raw value of a known key that is not valid here (for example a
 * choice that a newer version added). The settings in memory hold the default for such a key.
 */
export interface StoredExtras {
	version: number;
	unknown: Readonly<Record<string, unknown>>;
	invalid: Readonly<Record<string, unknown>>;
	/**
	 * The renames that wait, as `data.json` holds them. A save writes them back until the
	 * migration to the local storage has cleared them, so a save before the migration cannot wipe the list.
	 */
	pending: readonly PendingRename[];
}

/** No extras: a fresh install, and the state before the first load. */
export const NO_EXTRAS: StoredExtras = { version: SETTINGS_VERSION, unknown: {}, invalid: {}, pending: [] };

/** A stored version that is not a positive whole number counts as absent. */
const readVersion = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : SETTINGS_VERSION);

/** Reads `data.json`: the settings, and what a save must write back unchanged. Pure. */
export function readStoredSettings(raw: unknown): { settings: DynastySettings; extras: StoredExtras } {
	const s = asRecord(raw);
	const known = new Set<string>(KNOWN_KEYS);
	const skip = new Set<string>([VERSION_KEY, PENDING_KEY, ...REMOVED_KEYS]);
	// `Object.fromEntries` makes own properties, so a stored key named `__proto__` stays plain data.
	const unknown = Object.fromEntries(Object.entries(s).filter(([k]) => !known.has(k) && !skip.has(k)));
	const invalid = Object.fromEntries(KNOWN_KEYS.filter((k) => k in s && READERS[k](s[k]) === undefined).map((k) => [k, s[k]]));
	return { settings: normaliseSettings(raw), extras: { version: readVersion(s[VERSION_KEY]), unknown, invalid, pending: readPending(s) } };
}

/** The extras after the user changed these settings: the kept raw value of a changed setting goes (spec §9). */
export function clearInvalid(extras: StoredExtras, changed: readonly string[]): StoredExtras {
	if (!changed.some((k) => k in extras.invalid)) return extras;
	return { ...extras, invalid: Object.fromEntries(Object.entries(extras.invalid).filter(([k]) => !changed.includes(k))) };
}

/**
 * The object for `Plugin.saveData`: the kept keys, the settings, the kept raw values, the version, and the
 * renames that wait (only while there are some, so the file keeps the shape of earlier versions). Pure.
 * `pending` is the list of the updater; when it is empty the list that the file held (`extras.pending`) is written back.
 */
export function buildStoredData(settings: DynastySettings, extras: StoredExtras, pending: readonly PendingRename[]): Record<string, unknown> {
	const list = pending.length ? pending : extras.pending;
	return { ...extras.unknown, ...settings, ...extras.invalid, [VERSION_KEY]: extras.version, ...(list.length ? { [PENDING_KEY]: list } : {}) };
}

/** True when movement is reduced (D126). `prefers` is `matchMedia('(prefers-reduced-motion: reduce)').matches` on the view's own window. */
export const reducedMotion = (setting: ReduceMotion, prefers: boolean): boolean => (setting === 'on' ? true : setting === 'off' ? false : prefers);

/**
 * The height a desktop user typed, or null if it is not a whole number of pixels in range. Leading
 * and trailing spaces and a "px" unit are accepted.
 */
export function parseDesktopHeight(text: string): number | null {
	const m = /^\s*(\d{1,5})\s*(?:px)?\s*$/i.exec(text);
	if (!m) return null;
	const n = Number(m[1]);
	return wholeIn(n, DESKTOP_HEIGHT) ? n : null;
}

/** A whole number in `range` from a typed text (spaces around it are fine), or null. Used by the number settings of the line of succession. */
export function parseWhole(text: string, range: { min: number; max: number }): number | null {
	const m = /^\s*(\d{1,5})\s*$/.exec(text);
	if (!m) return null;
	const n = Number(m[1]);
	return wholeIn(n, range) ? n : null;
}

/** What changed between two settings, for the views (a card-size change drops the carried view). */
export function settingsChanges(a: DynastySettings, b: DynastySettings): (keyof DynastySettings)[] {
	return (Object.keys(DEFAULT_SETTINGS) as (keyof DynastySettings)[]).filter((k) => a[k] !== b[k]);
}

/**
 * A rename whose tree links the plugin has not updated yet (spec §6.9). It is stored in `data.json`
 * next to the settings, under its own key: an update that stopped (a phone closed the app) continues
 * at the next start. `others`: the notes with the old name that existed at the rename.
 */
export interface PendingRename {
	oldPath: string;
	newPath: string;
	others: string[];
}

/** The key of the pending renames in `data.json`; `normaliseSettings` ignores it. */
export const PENDING_KEY = 'pendingRenames';

const isPath = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The pending renames of stored data; a bad entry is dropped. Pure. */
export function readPending(raw: unknown): PendingRename[] {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
	const list = (raw as Record<string, unknown>)[PENDING_KEY];
	if (!Array.isArray(list)) return [];
	const out: PendingRename[] = [];
	for (const e of list) {
		if (e === null || typeof e !== 'object' || Array.isArray(e)) continue;
		const r = e as Record<string, unknown>;
		if (!isPath(r.oldPath) || !isPath(r.newPath)) continue;
		out.push({ oldPath: r.oldPath, newPath: r.newPath, others: Array.isArray(r.others) ? r.others.filter(isPath) : [] });
	}
	return out;
}
