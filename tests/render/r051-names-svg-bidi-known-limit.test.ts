import { describe, expect, it } from 'vitest';
import { cardNameLines, isolateLines, runsText } from '../../src/render/name-lines';
import { visual } from './bidi-reference';

/*
 * Known limit, pinned (spec §0 D322, planned for 0.5.2): a card name in SVG text is wrapped in FSI and PDI, and WebKit ignores
 * them there. A name that starts right-to-left and holds Latin letters then reads in the other order on an iPhone. These tests
 * pin the exact current result. When 0.5.2 fixes it, the two orders become equal and this test must change on purpose.
 */
const ISO = /[⁦-⁩]/g;
const measure = (s: string) => [...s.replace(/[‎⁦-⁩]/g, '')].length * 8;

describe('known limit D322: a name with a right-to-left start in SVG text', () => {
	it.each([
		['ليلى', 'Layla'],
		['نور الدين', 'Zengi'],
		['דוד', 'David'],
	])('%s %s: the order with isolates differs from the order without them', (rtl, latin) => {
		const lines = isolateLines(cardNameLines(`${rtl} ${latin}`, undefined, 1000, measure, 3, undefined)).map(runsText);
		expect(lines).toHaveLength(1);
		// What a browser with isolate support shows: the Latin word at the left of the right-to-left words.
		expect(visual(lines[0], 0)).toBe(`${latin} ${visual(rtl, 0)}`);
		// What WebKit shows when it ignores the isolates.
		expect(visual(lines[0].replace(ISO, ''), 0)).toBe(`${visual(rtl, 0)} ${latin}`);
	});
});
