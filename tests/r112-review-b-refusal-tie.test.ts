import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { applyOp } from '../src/core/yaml-edit';
import { idRefusalText } from '../src/view/id-draft';
import { ID_UI } from '../src/render/ui-text';

/*
 * Review round 0.2.2, area B. `idRefusalText` chooses the window text from the words of the core's
 * `detail` (`/anchor|alias/` and, since 0.2.8, the constants `REFUSAL_TEXT.idCharacters` and `idNotText`). Nothing ties the two together: the
 * existing tests feed the function copies of the core texts. This guard test feeds it the REAL refusals
 * of `set-house-id` and `set-title-id`. It passes today; it fails the day a core message changes.
 */
const HOUSES = `houses:
  - &h {id: valmont, name: V}
  - id: orsini
    name: O
  - id: orsini
    name: O again
people:
  - {id: a, name: A, house: valmont}
`;
const TITLES = `x: &t duke
titles:
  - id: duke
    name: Duke
people:
  - {id: a, name: A, card-title: *t}
`;

describe('the refusal text follows the real core refusal', () => {
	const texts = (body: string, op: { kind: 'set-house-id' | 'set-title-id'; id: string; newId: string }) => {
		const r = applyOp(body, op);
		if (r.ok) throw new Error('accepted');
		return idRefusalText(r.code, r.detail);
	};
	it('an anchor on the item, a character that is not allowed, an id in use', () => {
		expect(texts(HOUSES, { kind: 'set-house-id', id: 'valmont', newId: 'crown' })).toBe(ID_UI.anchor);
		expect(texts(HOUSES, { kind: 'set-house-id', id: 'valmont', newId: 'Crown' })).toBe(ID_UI.notAllowed);
		expect(texts(HOUSES, { kind: 'set-house-id', id: 'valmont', newId: 'orsini' })).toBe(ID_UI.inUse);
		expect(texts(TITLES, { kind: 'set-title-id', id: 'duke', newId: 'king' })).toBe(ID_UI.anchor);
	});
});
