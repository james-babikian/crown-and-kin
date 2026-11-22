import { THEME_VARS, type MixedRole, type ThemeRole } from '../../src/render/styles';

/**
 * The values that styles.css must give a property for `role`, in order, worked out from `THEME_VARS`: a plain role is one `var()`; a mixed
 * role is the `color-mix()` alone (no plain value before it: a declaration with a `var()` overrides an earlier one on every engine, D382). The tests use it to hold styles.css to the table.
 */
export function roleCss(role: ThemeRole): string[] {
	const v = THEME_VARS[role];
	if (typeof v === 'string') return [`var(${v})`];
	const [a, p, b] = (v as MixedRole).mix;
	const plain = (r: typeof a) => THEME_VARS[r] as string;
	return [`color-mix(in srgb, var(${plain(a)}) ${p}%, var(${plain(b)}))`];
}
