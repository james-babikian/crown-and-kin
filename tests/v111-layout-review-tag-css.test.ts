import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './acceptance/m11-support';

// Review of 0.2.1 area C, rule 6: the hole of an open sign (ring, open triangle) inside a tag pill must have the pill's fill.
// The headless drawing uses `cardFill` for both; the live tree takes the fill from the near-couple rule.

const css = readFileSync('styles.css', 'utf8');
const rules = cssRules(css);
const fillOf = (selector: string, within?: string) => {
	const r = rules.filter((x) => x.selectors.includes(selector) && (within === undefined || x.body.includes(within)));
	const m = r.map((x) => /fill:\s*([^;]+);/.exec(x.body)?.[1]).filter(Boolean);
	return m[m.length - 1];
};

describe('the open sign inside a far-couple tag (live tree)', () => {
	it('the hole of a ring has the fill of the tag pill, not the page fill', () => {
		const pill = fillOf('.dynasty-tag-pill');
		const ring = fillOf('.dynasty-tag-mark.dynasty-union-ring') ?? fillOf('.dynasty-union-ring');
		expect(pill).toBe('var(--background-primary-alt)');
		expect(ring).toBe(pill);
	});
});
