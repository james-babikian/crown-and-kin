import { describe, expect, it } from 'vitest';
import { titleLines } from '../src/render/name-lines';

// Review of M8 area 2 (layout and render). Spec §13.3: "Text that does not fit in two text lines
// ends with '…'" and the acceptance "text beyond two text lines ends with '…'". `titleLines` breaks
// before the reign whenever the title alone fits, even when the reign then does not fit on line 2,
// so a title text line that fits in two text lines (with the §13.3 "last space that fits" break)
// still loses the end of its reign.

const len = (s: string) => Array.from(s).length;
const fitsTwo = (lines: string[], width: number, measure: (s: string) => number) => lines.length <= 2 && lines.every((l) => measure(l) <= width);

describe('review M8 render: titleLines keeps a title text line that fits in two text lines whole', () => {
	it('"Duke of Valmont (r. 1150–1158, from 1163)" at 21 characters: no "…" (it fits as "Duke of Valmont (r." / "1150–1158, from 1163)")', () => {
		const lines = titleLines('Duke of Valmont', '(r. 1150–1158, from 1163)', 21, len);
		expect(fitsTwo(lines, 21, len)).toBe(true);
		expect(lines.join(' ')).toBe('Duke of Valmont (r. 1150–1158, from 1163)');
	});

	it('a short title with three reigns: every year stays on the card', () => {
		const lines = titleLines('Count', '(r. 1131–1140, 1145–1160, 1170–1180)', 22, len);
		expect(lines.join(' ')).toBe('Count (r. 1131–1140, 1145–1160, 1170–1180)');
	});
});
