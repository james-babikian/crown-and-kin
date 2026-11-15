/*
 * The rows of the partner list of a several-partner name tag (D355): the name of each partner and, under it, the kind of the
 * partnership. The tag has no sign, so this list is the only place on the tree that shows the kind.
 */

import type { FamilyGraph } from '../core/derive';
import { setNameText } from '../render/dom/name-marks';
import { isolateName } from '../render/name-bidi';
import { tagPartnerKind } from '../render/tag-partner-kind';

/**
 * Adds one button for each partner to `el`. `shown` gives the names; `whole` gives the kinds, so a partner that a fold hides reads like any other.
 * The name is isolated, so a right-to-left name cannot reorder the kind under it.
 */
export function fillPartnerList(el: HTMLElement, shown: FamilyGraph, whole: FamilyGraph, person: string, spouses: readonly string[], pick: (id: string) => void): void {
	for (const id of spouses) {
		const name = isolateName((shown.byId.get(id) ?? whole.byId.get(id))?.name ?? id);
		const kind = tagPartnerKind(whole, person, id);
		const b = el.createEl('button', { cls: 'dynasty-popover-item dynasty-tag-partner', attr: { 'aria-label': `${name}, ${kind}` } });
		setNameText(b.createSpan({ cls: 'dynasty-tag-partner-name' }), name);
		b.createSpan({ cls: 'dynasty-tag-partner-kind', text: kind });
		b.addEventListener('click', () => pick(id));
	}
}
