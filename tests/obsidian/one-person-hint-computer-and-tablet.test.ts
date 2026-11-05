import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { ONE_PERSON_HINT } from '../../src/render/ui-text';
import { clearRelationCache } from '../../src/view/relation-cache';
import { clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, openFullScreen, tabletDevice } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 TR-13: a tree of one person in a note says what to do next, in one quiet line. A computer is told to select the card; a touch device
 * with a static preview (D1) is told to select Expand first. A second person takes the line away. Made-up people only.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const ONE = `people:
  - {id: aldric, name: Aldric, sex: m, born: 1102}
`;
const TWO = `${ONE}  - {id: isolde, name: Isolde, sex: f, born: 1110}
`;

async function note(src: string) {
	const { el } = await embed(src, { host: fakeHost(), handle: fakeHandle('n.md', src) });
	return el.querySelectorAll('.dynasty-one-person-hint');
}

describe('the line of a tree of one person in a note', () => {
	it('a computer: the text of the computer, in the viewport, in no button', async () => {
		desktop();
		const hint = await note(ONE);
		expect(hint).toHaveLength(1);
		expect(hint[0].getText()).toBe(ONE_PERSON_HINT.computer);
		expect(hint[0].closest('button')).toBeNull();
		expect(hint[0].parentElement?.hasClass('dynasty-viewport')).toBe(true);
	});

	it('a tablet note (a static preview): the text that sends the user to Expand', async () => {
		tabletDevice();
		const hint = await note(ONE);
		expect(hint).toHaveLength(1);
		expect(hint[0].getText()).toBe(ONE_PERSON_HINT.tabletNote);
	});

	it('is gone when a second person exists', async () => {
		desktop();
		expect(await note(TWO)).toHaveLength(0);
		tabletDevice();
		expect(await note(TWO)).toHaveLength(0);
	});

	it('the full-screen view has none', async () => {
		desktop();
		const { root } = await openFullScreen(ONE);
		expect(root.querySelectorAll('.dynasty-one-person-hint')).toHaveLength(0);
	});

	it('the look: muted colour, the small role, centred, 16 px (the space-4 token) above the hairline; hidden in a read-only tree', () => {
		const css = readFileSync('styles/15-empty-block.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const rule = css.slice(css.indexOf('.dynasty-one-person-hint {'));
		const body = rule.slice(rule.indexOf('{') + 1, rule.indexOf('}'));
		expect(body).toMatch(/color:\s*var\(--dynasty-muted\)/);
		expect(body).toMatch(/font-size:\s*var\(--dynasty-type-small\)/);
		expect(body).toMatch(/text-align:\s*center/);
		expect(body).toMatch(/bottom:\s*var\(--dynasty-space-4\)/);
		expect(body).toMatch(/pointer-events:\s*none/);
		expect(css).toMatch(/\.dynasty-read-only \.dynasty-one-person-hint\s*\{\s*display:\s*none/);
	});
});
