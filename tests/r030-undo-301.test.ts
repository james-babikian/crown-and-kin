import { describe, expect, it } from 'vitest';
import { applyOp } from '../src/core/yaml-edit';
import { PARENT_LIMIT } from '../src/core/types';

/*
 * The deep X4 (4) run of `r028-adv-edits` failed at "callout in a list item", seed 301, step 10: the test's
 * reference model refused a third rumoured parent, but the product rule (D200 P1) allows 8. The plugin was right;
 * the oracle in `r028-advb-edits-support.ts` now uses 8 for rumoured parents and 2 for the other types.
 * This file pins the boundary that the oracle follows: the 8th rumoured parent is written, the 9th is refused.
 */
function withRumoured(n: number): string {
	return [
		'people:',
		'  - id: c',
		'    name: C',
		'    parents:',
		...Array.from({ length: n }, (_, i) => `      - { id: r${i}, type: rumoured }`),
		...Array.from({ length: 9 }, (_, i) => `  - id: r${i}\n    name: R${i}`),
		'',
	].join('\n');
}

describe('a child takes up to 8 rumoured parents (D200 P1)', () => {
	it('the limit in the code is 8 for rumoured and 2 for the other types', () => {
		expect(PARENT_LIMIT).toEqual({ birth: 2, adoptive: 2, ward: 2, rumoured: 8 });
	});

	it('the 3rd and the 8th rumoured parent are written', () => {
		for (const n of [2, 7]) {
			const out = applyOp(withRumoured(n), { kind: 'add-parent', child: 'c', parent: 'r8', type: 'rumoured' });
			expect(out.ok, `with ${n} rumoured parents`).toBe(true);
		}
	});

	it('the 9th rumoured parent is refused with the limit code', () => {
		const out = applyOp(withRumoured(8), { kind: 'add-parent', child: 'c', parent: 'r8', type: 'rumoured' });
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.code).toBe('limit');
	});
});
