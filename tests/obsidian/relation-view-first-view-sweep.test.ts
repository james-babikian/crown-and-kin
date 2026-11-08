import { appendFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NAMED_MIN_NOTE_PX } from '../../src/view/focus-mode';
import { F12, relationView, resetRelationView, scaleOf, setupRelationViewTests, type Kind } from '../acceptance/relation-view-support';

/*
 * D334 Q1 B: every ordered pair of sample tree 12 on the two iPhone sizes shows both named people whole in the first view of the
 * relation view, and the names stay on the cards (Full or Compact level, never Overview). A pair with no line to draw is skipped.
 */

setupRelationViewTests();

const ids = [...F12.slice(F12.indexOf('people:'), F12.indexOf('unions:')).matchAll(/^\s*- (?:\{)?id: ([\w-]+)/gm)].map((m) => m[1]!).filter((id, i, a) => a.indexOf(id) === i);

describe.each(['iphone', 'iphone-small'] as const)('every ordered pair of sample tree 12 on the %s', (kind: Kind) => {
	it('has both named people whole and names on the cards', { timeout: 1_800_000 }, async () => {
		const bad: string[] = [];
		let drawn = 0;
		let smallest = Infinity;
		for (const a of ids) {
			for (const b of ids) {
				if (a === b) continue;
				resetRelationView();
				const r = await relationView(kind, a, b);
				if (!r.hasLine) continue;
				drawn++;
				const note = scaleOf(r.root) * 16;
				smallest = Math.min(smallest, note);
				if (r.where[a] !== 'whole' || r.where[b] !== 'whole') bad.push(`${a}>${b} ${r.msg}`);
				// The Compact level still shows the names (at 1.5 times the size); the Overview level would not.
				if (r.lod === 'dynasty-lod-overview') bad.push(`${a}>${b} level ${r.lod} at ${note.toFixed(1)} px`);
			}
		}
		const sizes = `${kind}: ${drawn} pairs drawn, smallest note font ${smallest.toFixed(2)} px (card text ${(smallest * 0.85).toFixed(2)} px), failures ${bad.length}`;
		// A run that names SWEEP_OUT keeps the numbers (vitest hides the output of a test that passes).
		if (process.env['SWEEP_OUT']) appendFileSync(process.env['SWEEP_OUT'], `${sizes}
`);
		expect(bad, sizes).toEqual([]);
		expect(smallest).toBeGreaterThanOrEqual(NAMED_MIN_NOTE_PX);
		expect(drawn).toBeGreaterThan(2000);
	});
});
