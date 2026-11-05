import { beforeAll, describe, expect, it } from 'vitest';
import { hasMarks, markedSpan, noticeText, setNameText, splitMarks, watchMarks } from '../../src/render/dom/name-marks';
import { FEl, installDom, resetDom } from '../acceptance/fake-dom';

/*
 * Spec §0 D322 (0.5.2): the text tables write a name that holds a right-to-left letter between FSI and PDI; the DOM edge turns each pair into an isolate span, because WebKit does
 * not honour the two characters in an HTML text (an internal test proves it in the real engine, and proves the real `watchMarks` there). Here: the
 * splitting is pure, and `setNameText` runs on the fake DOM.
 */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const NAME = 'كريم Mansour';

beforeAll(() => {
	installDom();
});

describe('splitMarks', () => {
	it('a text with no mark is one plain piece', () => {
		expect(splitMarks('Focus on Aldric')).toEqual([{ text: 'Focus on Aldric', run: false }]);
		expect(splitMarks('')).toEqual([]);
		expect(hasMarks('Focus on Aldric')).toBe(false);
	});

	it('a pair of marks is a run with the text between them, and the words around it stay plain', () => {
		expect(splitMarks(`Focus on ${FSI}${NAME}${PDI}!`)).toEqual([
			{ text: 'Focus on ', run: false },
			{ text: NAME, run: true },
			{ text: '!', run: false },
		]);
		expect(hasMarks(`a ${FSI}b${PDI}`)).toBe(true);
	});

	it('several pairs make several runs, in order', () => {
		const parts = splitMarks(`${FSI}${NAME}${PDI} and ${FSI}דוד David${PDI}`);
		expect(parts.map((p) => [p.run, p.text])).toEqual([
			[true, NAME],
			[false, ' and '],
			[true, 'דוד David'],
		]);
	});

	it('a pair inside a pair is a run inside the run, and the text of the outer run holds both', () => {
		const [outer] = splitMarks(`${FSI}a ${FSI}b${PDI} c${PDI}`);
		expect(outer.run).toBe(true);
		expect(outer.text).toBe('a b c');
		expect(outer.parts?.map((p) => [p.run, p.text])).toEqual([
			[false, 'a '],
			[true, 'b'],
			[false, ' c'],
		]);
	});

	it('a mark with no partner loses no text', () => {
		expect(splitMarks(`a ${FSI}b`).map((p) => p.text).join('')).toBe(`a ${FSI}b`);
		expect(splitMarks(`a${PDI} b`).map((p) => p.text).join('')).toBe(`a${PDI} b`);
	});
});

describe('setNameText', () => {
	it('sets a text with no mark as it is', () => {
		const el = new FEl('div');
		setNameText(el as unknown as HTMLElement, 'Focus on Aldric');
		expect(el.children).toHaveLength(0);
		expect(el.getText()).toBe('Focus on Aldric');
	});

	it('writes the plain text, and each run as an isolate span with dir="auto", with no control character left', () => {
		const el = new FEl('div');
		setNameText(el as unknown as HTMLElement, `Focus on ${FSI}${NAME}${PDI}`);
		expect(el.getText()).toBe(`Focus on ${NAME}`);
		expect(el.children.map((c) => [c.tag, c.getAttribute('dir'), [...c.classes], c.getText()])).toEqual([['span', 'auto', ['dynasty-name-run'], NAME]]);
	});

	it('replaces what the element held', () => {
		const el = new FEl('div', { text: 'old' });
		el.createSpan({ text: 'child' });
		setNameText(el as unknown as HTMLElement, `x ${FSI}${NAME}${PDI}`);
		expect(el.getText()).toBe(`x ${NAME}`);
		expect(el.children).toHaveLength(1);
	});

	it('markedSpan makes a span of the class', () => {
		const el = markedSpan('dynasty-list-title', `${FSI}${NAME}${PDI}`) as unknown as FEl;
		expect(el.tag).toBe('span');
		expect(el.classes.has('dynasty-list-title')).toBe(true);
		expect(el.children).toHaveLength(1);
	});

	it('a Notice text with no mark stays a string', () => {
		expect(noticeText('The plugin saved Aldric.')).toBe('The plugin saved Aldric.');
	});
});

describe('watchMarks', () => {
	it('does nothing where the document has no observer (the fake DOM)', () => {
		resetDom();
		const el = new FEl('div', { text: `${FSI}${NAME}${PDI}` });
		expect(() => watchMarks(el as unknown as HTMLElement)).not.toThrow();
		expect(el.getText()).toBe(`${FSI}${NAME}${PDI}`);
	});
});
