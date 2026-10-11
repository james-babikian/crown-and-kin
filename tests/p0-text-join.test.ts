import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leadItems, nb } from '../src/render/text-join';
import { FEl, installDom, resetDom } from './acceptance/fake-dom';

// 0.2.8 contract G.2: `nb`, the pure rule `leadItems` and the element builder `joined`.

describe('nb', () => {
	it('keeps a reign on one text line: no-break spaces inside the brackets and no break after the dash', () => {
		expect(nb('King (r. 1160–1207)')).toBe('King (r.\u00a01160–\u20601207)');
	});

	it('does not change text without brackets, and changes every bracket pair', () => {
		expect(nb('Aldric the Bold')).toBe('Aldric the Bold');
		expect(nb('A (r. 1–2) and B (r. 3–4)')).toBe('A (r.\u00a01–\u20602) and B (r.\u00a03–\u20604)');
		expect(nb('')).toBe('');
	});
});

describe('leadItems', () => {
	const box = (top: number, height = 20) => ({ top, height });

	it('finds the items that start a new text line, never the first', () => {
		expect(leadItems([box(0), box(0), box(24), box(24), box(48)])).toEqual([2, 4]);
		expect(leadItems([box(0), box(0), box(0)])).toEqual([]);
		expect(leadItems([box(100)])).toEqual([]);
		expect(leadItems([])).toEqual([]);
	});

	it('ignores an item that is not shown and an item that is a little lower than the one before', () => {
		expect(leadItems([box(0), box(0, 0), box(24)])).toEqual([2]);
		expect(leadItems([box(0), box(5)])).toEqual([]);
		expect(leadItems([box(0), box(11)])).toEqual([1]);
	});
});

describe('joined', () => {
	type Callback = (entries: { target: unknown }[]) => void;
	let callback: Callback = () => undefined;
	let watched: unknown[] = [];
	let joined: typeof import('../src/render/text-join').joined;

	beforeEach(async () => {
		installDom();
		resetDom();
		watched = [];
		(globalThis as Record<string, unknown>).ResizeObserver = class {
			constructor(cb: Callback) {
				callback = cb;
			}
			observe(t: unknown) {
				watched.push(t);
			}
			unobserve(t: unknown) {
				watched = watched.filter((w) => w !== t);
			}
			disconnect() {}
		};
		vi.resetModules();
		({ joined } = await import('../src/render/text-join'));
	});

	const items = (box: FEl) => box.children.filter((c) => c.hasClass('dynasty-jitem'));

	it('puts a "·" before every item except the first, and leaves empty parts out', () => {
		const parent = new FEl('div');
		const box = joined(parent as never, 'dynasty-test', ['A', '', null, 'B', false, undefined, 'C']) as unknown as FEl;
		expect(box.hasClass('dynasty-joined')).toBe(true);
		expect(box.hasClass('dynasty-test')).toBe(true);
		const kids = items(box);
		expect(kids.map((k) => k.children.filter((c) => c.hasClass('dynasty-jmark')).length)).toEqual([0, 1, 1]);
		expect(kids.map((k) => k.text)).toEqual(['A', 'B', 'C']);
		expect(box.children.find((c) => c.hasClass('dynasty-jmark'))).toBeUndefined();
		expect(kids[1].children[0].text).toBe('·');
		expect(kids[1].children[0].attrs.get('aria-hidden')).toBe('true');
		expect(parent.children).toEqual([box]);
	});

	it('uses a span when asked, and takes an element as a part', () => {
		const parent = new FEl('div');
		const part = new FEl('b');
		const box = joined(parent as never, 'x', [part as never, 'Z'], 'span') as unknown as FEl;
		expect(box.tag).toBe('span');
		expect(items(box)[0].children).toContain(part);
	});

	it('hides the "·" of an item that starts a wrapped text line, and puts a line break before it', () => {
		const parent = new FEl('div');
		const box = joined(parent as never, 'x', ['A', 'B', 'C']) as unknown as FEl;
		const kids = items(box);
		const tops = [0, 0, 24];
		kids.forEach((k, i) => (k.getBoundingClientRect = () => ({ top: tops[i], height: 20 }) as never));
		expect(watched).toEqual([box]);
		callback([{ target: box }]);
		expect(kids.map((k) => k.hasClass('is-lead'))).toEqual([false, false, true]);
		const breaks = box.children.filter((c) => c.hasClass('dynasty-jbreak'));
		expect(breaks).toHaveLength(1);
		expect(box.children.indexOf(breaks[0])).toBe(box.children.indexOf(kids[2]) - 1);
		// A new size where nothing wraps takes the break and the hidden mark away again.
		tops[2] = 0;
		callback([{ target: box }]);
		expect(kids.some((k) => k.hasClass('is-lead'))).toBe(false);
		expect(box.children.some((c) => c.hasClass('dynasty-jbreak'))).toBe(false);
	});

	it('stops watching a box that left the page', () => {
		const box = joined(new FEl('div') as never, 'x', ['A', 'B']) as unknown as FEl;
		box.isConnected = false;
		callback([{ target: box }]);
		expect(watched).toEqual([]);
	});
});
