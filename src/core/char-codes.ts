// Tests on UTF-16 code units, for places that must name control characters. A regex literal with a control character in
// it fails the official lint (no-control-regex), so these sites test the code unit instead. Same results as the regexes.

/** True when every code unit of `s` is at most `max` and none is in `except`. An empty text is true. */
export function allUnitsAtMost(s: string, max: number, except: readonly number[] = []): boolean {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c > max || except.includes(c)) return false;
	}
	return true;
}

/** `s` without the code units for which `drop` is true (a surrogate half is one unit, as in a regex without the u flag). */
export function dropUnits(s: string, drop: (code: number) => boolean): string {
	let out = '';
	for (let i = 0; i < s.length; i++) if (!drop(s.charCodeAt(i))) out += s[i];
	return out;
}
