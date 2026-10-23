import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { clock, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, phone } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G2 review of the 0.2.8 look round (package C3, D213): "no placeholder ... a row without a picture aligns its text as a complete row".
 * The phone list decides its picture places from the data (`PhoneListSpec.has` is not passed by the tree view), so a person whose portrait link
 * names a file that does not exist keeps an empty place for ever.
 */
useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[gone-arms.png]]"}
people:
  - {id: ann, name: Ann, house: va, born: 1100, portrait: "[[gone-ann.png]]"}
  - {id: bob, name: Bob, house: va, parents: [ann], born: 1130, portrait: "[[gone-bob.png]]"}
`;

describe('phone list: a picture whose file does not exist', () => {
	it('leaves no empty picture place in the row of the person (the file is missing for good)', async () => {
		const store = {
			resolve: (link: string) => ({ ok: false, code: 'missing-picture', file: link }),
			check: async () => null,
			acquire: async () => null,
			onChange: () => () => {},
		};
		phone();
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = store;
		const { el } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		await settle();
		const row = (id: string) => el.querySelector(`.dynasty-list-row[data-person="${id}"]`)!;
		// Bob: a plain row. His portrait is missing, so the row must be a complete row with no place at the right.
		expect(row('bob').querySelector('.dynasty-list-pics, .dynasty-list-portrait')).toBeNull();
		// Ann: the top row. Neither her portrait nor her arms can show, so there is no column.
		expect(row('ann').querySelector('.dynasty-hero-col')).toBeNull();
	});
});
