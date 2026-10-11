import { THEME_VARS, type MixedRole, type ThemeRole } from '../src/render/styles';

/**
 * The values that styles.css must give a property for `role`, in order, worked out from `THEME_VARS`: a plain role is one `var()`; a mixed
 * role is the fallback `var()` followed by the `color-mix()`. The tests use it to hold styles.css to the table.
 */
export function roleCss(role: ThemeRole): string[] {
	const v = THEME_VARS[role];
	if (typeof v === 'string') return [`var(${v})`];
	const [a, p, b] = (v as MixedRole).mix;
	const plain = (r: typeof a) => THEME_VARS[r] as string;
	return [`var(${plain(a)})`, `color-mix(in srgb, var(${plain(a)}) ${p}%, var(${plain(b)}))`];
}
