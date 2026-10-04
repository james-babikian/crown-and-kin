/*
 * Reads the stored settings (spec §9). Pure and free of `obsidian`, so it has unit tests: stored data
 * can come from an older version, a sync conflict or a hand edit of `data.json`.
 */

/** The plugin settings (spec §9, D33), stored with `Plugin.saveData`. The settings tab and every reader use this shape. */
export interface DynastySettings {
	/** Height of a tree in a note on a computer or tablet, in px (spec §7.5), 100–5000. Default 500. `options.height` wins. */
	embedHeightDesktop: number;
	/** Height of a tree in a note on a phone, in % of the screen height, 40–80. Default 60 (D30: also on its side). */
	embedHeightPhone: number;
	cardSize: 'normal' | 'compact';
	/** Dates on cards, and the reigns in the title text line (spec §13.3). Born and died do not change the card height; a reign can make the title two text lines, so the card can get taller (D61). */
	showDates: boolean;
	/** D40 (spec §13.1): relation names on cards. Off keeps the card height and the screen-reader label; only a class changes. */
	showRelations: boolean;
	/** Spec §13.7 (M9 contract O10): portraits on cards. Off: no card shows a portrait or its room; a change lays the trees out again. */
	showPortraits: boolean;
	/** Focus mode default generations (§5.6, §9), a whole number 0–10. Default 3; `options.generations` wins; D23 (n = 1 in the static phone preview) wins over both. */
	focusGenerations: number;
	/** D113 item 4: the house page shows the generation of each person. Off: only the dates (and no Generation column). Read when the page opens. */
	showHouseGeneration: boolean;
	/** Update tree links when a note or a picture is renamed (§6.9, D6, §13.0 item 3). Default on. */
	updateLinks: boolean;
}

/** The settings a fresh install starts with. */
export const DEFAULT_SETTINGS: DynastySettings = {
	embedHeightDesktop: 500,
	embedHeightPhone: 60,
	cardSize: 'normal',
	showDates: true,
	showRelations: true,
	showPortraits: true,
	showHouseGeneration: true,
	focusGenerations: 3,
	updateLinks: true,
};

/*
 * How views get the settings: `TreeHost` has `readonly settings: DynastySettings`; when a setting
 * changes, the plugin calls `onSettingsChange()` on every view (as for `css-change`), and the view
 * draws again (a card-size change drops the carried view). Embed height rule (D30): on a phone
 * (`TreeView.isPhone`: `isPhoneWindow` of the screen size, not the window size, because an
 * on-screen keyboard makes the window lower; portrait or on its side) the height is
 * `${embedHeightPhone}vh` and `options.height` is ignored; otherwise `options.height`, else
 * `${embedHeightDesktop}px`.
 */

/** The phone heights the settings tab offers, in % of the screen height (D30). */
export const PHONE_HEIGHTS = [40, 50, 60, 70, 80] as const;
/** Valid range for `embedHeightDesktop`, in px. */
export const DESKTOP_HEIGHT = { min: 100, max: 5000 } as const;
/** Valid range for `embedHeightPhone`, in % of the screen height. */
export const PHONE_HEIGHT = { min: 40, max: 80 } as const;
/** Valid range for `focusGenerations`. */
export const GENERATIONS = { min: 0, max: 10 } as const;

const wholeIn = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max;

/** Reads stored data: every missing, wrong-type or out-of-range value becomes its default. Pure. */
export const normaliseSettings = (raw: unknown): DynastySettings => {
	const s = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const d = DEFAULT_SETTINGS;
	// A height typed as 480.5 is still a height: round it, then check the range.
	const desktop = typeof s.embedHeightDesktop === 'number' && Number.isFinite(s.embedHeightDesktop) ? Math.round(s.embedHeightDesktop) : NaN;
	const phone = typeof s.embedHeightPhone === 'number' && Number.isFinite(s.embedHeightPhone) ? Math.round(s.embedHeightPhone) : NaN;
	return {
		embedHeightDesktop: wholeIn(desktop, DESKTOP_HEIGHT) ? desktop : d.embedHeightDesktop,
		embedHeightPhone: wholeIn(phone, PHONE_HEIGHT) ? phone : d.embedHeightPhone,
		cardSize: s.cardSize === 'compact' || s.cardSize === 'normal' ? s.cardSize : d.cardSize,
		showDates: typeof s.showDates === 'boolean' ? s.showDates : d.showDates,
		showRelations: typeof s.showRelations === 'boolean' ? s.showRelations : d.showRelations,
		showPortraits: typeof s.showPortraits === 'boolean' ? s.showPortraits : d.showPortraits,
		showHouseGeneration: typeof s.showHouseGeneration === 'boolean' ? s.showHouseGeneration : d.showHouseGeneration,
		focusGenerations: wholeIn(s.focusGenerations, GENERATIONS) ? s.focusGenerations : d.focusGenerations,
		updateLinks: typeof s.updateLinks === 'boolean' ? s.updateLinks : d.updateLinks,
	};
};

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
