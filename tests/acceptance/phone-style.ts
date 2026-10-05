// Test helper (contract 8.4): the settings of a phone test that needs whole cards, because the default phone style is names-only.
import { DEFAULT_SETTINGS, type DynastySettings } from '../../src/obsidian/settings';

/** `DEFAULT_SETTINGS` with the phone card style 'whole', plus any overrides. */
export function wholeCardSettings(overrides: Partial<DynastySettings> = {}): DynastySettings {
	return { ...DEFAULT_SETTINGS, phoneCardStyle: 'whole', ...overrides };
}
