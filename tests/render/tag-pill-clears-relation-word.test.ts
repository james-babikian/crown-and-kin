import { describe, expect, it } from 'vitest';
import { cardForm, cardText, drawnGeometry, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS } from '../../src/layout/index';
import { fullTagPill } from '../../src/render/styles';

// The relation word sits on the plate at the card's foot, raised by 0.15 em "so a descender of the word stays above the pill of a far-couple tag
// that hangs into the plate" (`formText`, layout/geometry.ts; `tests/layout/roundel-card-geometry.test.ts` checks it against the layout's tag band).
// D353 2 A: the drawn Full pill with its larger text must keep that, so it is the layout band itself; a pill 1.25 em high that grew up into the
// card covered the descender by 1.3 to 1.8 px at every font.

describe('the drawn Full tag pill stays below the descenders of the relation word', () => {
	for (const dir of ['down', 'sideways'] as const) {
		it(`${dir}: at every note font from 10 to 48 px, a descender (0.25 of the small text) ends above the pill's top`, () => {
			const over: string[] = [];
			for (let note = 10; note <= 48; note++) {
				const geo = drawnGeometry(cardForm(geometryFor(note), dir), { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true, orientation: dir });
				const t = cardText(geo, 1);
				const descender = t.relationBaseline! + 0.25 * t.smallSize;
				const top = fullTagPill(geo, geo.cardH).top;
				if (descender > top) over.push(`${note} px: descender ${descender.toFixed(2)}, pill top ${top}`);
			}
			expect(over).toEqual([]);
		});
	}
});
