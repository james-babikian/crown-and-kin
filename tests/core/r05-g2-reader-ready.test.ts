// G2 of 1a-B (probe), focus 3: the relation cache after the calendar reader becomes ready (no stale hit).
import { describe, expect, it } from 'vitest';
import { clearRelationCache, relationsFor } from '../../src/view/relation-cache';
import { graphOf, p, w, readerWith, type Tree } from './r05-marriage-years-trees';

const t: Tree = {
	people: [p('fa', 'm', '1100', '1170'), p('fb', 'f', '1102', '1175'), p('fx', 'f'), p('fd', 'f', '1135', undefined, ['fa', 'fx'])],
	unions: [w('fa', 'fb', { start: 'Year 1 of Cycle 2', end: 'Year 3 of Cycle 2', endedBy: 'divorce' })],
};
describe('G2 1a-B focus 3: pending then ready reader through the relation cache', () => {
	it('the word changes once, and the pending answer never comes back', () => {
		clearRelationCache();
		const text = (g: ReturnType<typeof graphOf>) => relationsFor(g, 'fd', undefined, 'n.md\u0000b').cards.get('fb')?.text;
		const pending = text(graphOf(t, readerWith(false)));
		const ready = text(graphOf(t, readerWith(true)));
		const pendingAgain = text(graphOf(t, readerWith(false)));
		const readyAgain = text(graphOf(t, readerWith(true)));
		expect(ready).not.toBe(pending);
		expect(pendingAgain).toBe(pending);
		expect(readyAgain).toBe(ready);
	});
});
