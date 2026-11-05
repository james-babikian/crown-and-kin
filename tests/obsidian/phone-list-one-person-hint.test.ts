import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { ONE_PERSON_HINT } from '../../src/render/ui-text';
import { clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, phone } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * A tree of one person: the phone list shows one quiet line that says what to do next, and shows nothing when a second person exists. Made-up people only.
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

async function list(src: string) {
	phone();
	const { el } = await embed(src, { host: fakeHost(), handle: fakeHandle('n.md', src) });
	return el.querySelector('.dynasty-list')!;
}

describe('the hint of a tree of one person in the phone list', () => {
	it('is one line of the plugin text, after the rows, in no button', async () => {
		const hint = (await list(ONE)).querySelectorAll('.dynasty-list-hint');
		expect(hint).toHaveLength(1);
		expect(hint[0].getText()).toBe(ONE_PERSON_HINT.phoneList);
		expect(hint[0].closest('button')).toBeNull();
	});

	it('stands last in the list, under the person section', async () => {
		const l = await list(ONE);
		expect(l.children.map((c) => [...c.classes][0])).toEqual(['dynasty-list-section', 'dynasty-list-hint']);
	});

	it('is gone when a second person exists', async () => {
		expect((await list(TWO)).querySelector('.dynasty-list-hint')).toBeNull();
	});

	it('the look is muted, small and hidden in a read-only tree', async () => {
		const css = (await import('node:fs')).readFileSync('styles/31-phone-list.css', 'utf8');
		expect(css).toMatch(/\.dynasty-list-hint \{[^}]*color: var\(--dynasty-muted, var\(--text-muted\)\)[^}]*font-size: var\(--dynasty-type-small\)/);
		expect(css).toMatch(/\.dynasty-list\.is-read-only \.dynasty-list-hint/);
	});
});
