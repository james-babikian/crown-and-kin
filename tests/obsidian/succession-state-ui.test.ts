import { describe, expect, it, vi } from 'vitest';
import { change, changeInPlace, stopTimer, type Redraw, type SectionState } from '../../src/obsidian/succession-state-ui';

/*
 * The seam of the split of the succession sections: a part asks for a redraw only through `st.redraw`, and a change of the draft
 * reaches the window (`edited`) before the redraw. The parts themselves run in titles-window-succession-section.test.ts.
 */

function stub(): { st: SectionState; calls: string[]; redraws: Redraw[]; cleared: number[] } {
	const calls: string[] = [];
	const redraws: Redraw[] = [];
	const cleared: number[] = [];
	const st = {
		host: {
			guard: (fn: () => void) => fn(),
			edited: () => calls.push('edited'),
			win: () => ({ setTimeout: () => 1, clearTimeout: (id: number) => void cleared.push(id) }),
		},
		timer: null as number | null,
		redraw: (how: Redraw) => {
			calls.push('redraw');
			redraws.push(how);
		},
	} as unknown as SectionState;
	return { st, calls, redraws, cleared };
}

describe('succession-state-ui', () => {
	it('change edits, tells the window, then redraws everything with the focus', () => {
		const { st, calls, redraws } = stub();
		change(st, () => calls.push('draft'), 'succ-body');
		expect(calls).toEqual(['draft', 'edited', 'redraw']);
		expect(redraws).toEqual([{ kind: 'all', focus: 'succ-body' }]);
	});

	it('change with no focus asks for no focus', () => {
		const { st, redraws } = stub();
		change(st, () => undefined);
		expect(redraws).toEqual([{ kind: 'all' }]);
	});

	it('changeInPlace redraws in place, so no dropdown is made again', () => {
		const { st, calls, redraws } = stub();
		changeInPlace(st, () => calls.push('draft'));
		expect(calls).toEqual(['draft', 'edited', 'redraw']);
		expect(redraws).toEqual([{ kind: 'in-place' }]);
	});

	it('a step that throws inside the guard is not run twice and the redraw is skipped by the guard', () => {
		const { st, redraws } = stub();
		st.host.guard = vi.fn((fn: () => void) => {
			try {
				fn();
			} catch {
				/* the real guard logs */
			}
		});
		changeInPlace(st, () => {
			throw new Error('x');
		});
		expect(redraws).toEqual([]);
	});

	it('stopTimer clears a running timer once and leaves none', () => {
		const { st, cleared } = stub();
		st.timer = 7;
		stopTimer(st);
		stopTimer(st);
		expect(cleared).toEqual([7]);
		expect(st.timer).toBeNull();
	});
});
