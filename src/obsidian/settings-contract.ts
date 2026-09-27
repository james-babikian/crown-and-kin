/**
 * Milestone 6 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Plugin settings (spec §9, D33). The settings tab and every reader use this shape; values are
 * stored with `Plugin.saveData`. Missing or invalid stored values fall back to the defaults.
 */
export interface DynastySettings {
	/** Height of a tree in a note on a computer or tablet, in px (spec §7.5), 100–5000. Default 500. `options.height` wins. */
	embedHeightDesktop: number;
	/** Height of a tree in a note on a phone, in % of the screen height, 40–80. Default 60 (D30: also on its side). */
	embedHeightPhone: number;
	cardSize: 'normal' | 'compact';
	/** Dates on cards. Changing it does not change the card height (geometry and layout key stay). */
	showDates: boolean;
	/** Focus mode default generations (§5.6, §9), a whole number 0–10. Default 3; `options.generations` wins; D23 (n = 1 in the static phone preview) wins over both. */
	focusGenerations: number;
	/** Update tree links when a note is renamed (§6.9, D6). Default on. */
	updateLinks: boolean;
}

export const DEFAULT_SETTINGS: DynastySettings = {
	embedHeightDesktop: 500,
	embedHeightPhone: 60,
	cardSize: 'normal',
	showDates: true,
	focusGenerations: 3,
	updateLinks: true,
};

/** Reads stored data: every missing, wrong-type or out-of-range value becomes its default. Pure. */
export type NormaliseSettings = (raw: unknown) => DynastySettings;

/*
 * How views get the settings (WP6.3): `TreeHost` gains `readonly settings: DynastySettings`; when a
 * setting changes, the plugin calls `onSettingsChange()` on every view (as for `css-change`), and
 * the view draws again (a card-size change drops the carried view). Embed height rule (D30): on a
 * phone (`isPhoneWindow(coarse, innerWidth, innerHeight)`, portrait or on its side) the height is
 * `${embedHeightPhone}vh` and `options.height` is ignored; otherwise `options.height`, else
 * `${embedHeightDesktop}px`.
 */
