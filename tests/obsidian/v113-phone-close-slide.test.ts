// Version 0.2.3, work package "phone" (search round finding P1): a window that closes while the keyboard goes down must
// not pop. Obsidian slides a closing window down by the height it has when `close()` starts; if the window then grows
// with the visible area, the slide ends with the lower half still on the screen.
import { describe, expect, it } from 'vitest';
import type { Modal } from 'obsidian';
import { phoneLayout } from '../../src/obsidian/modal-layout';

type Listener = () => void;

function setup(height: number, closes = true) {
	const winListeners = new Map<string, Set<Listener>>();
	const vvListeners = new Map<string, Set<Listener>>();
	const add = (m: Map<string, Set<Listener>>) => (t: string, f: Listener) => void (m.get(t) ?? m.set(t, new Set()).get(t)!).add(f);
	const remove = (m: Map<string, Set<Listener>>) => (t: string, f: Listener) => void m.get(t)?.delete(f);
	const fire = (m: Map<string, Set<Listener>>, t: string) => m.get(t)?.forEach((f) => f());
	const vv = { height, offsetTop: 0, addEventListener: add(vvListeners), removeEventListener: remove(vvListeners) };
	// The iPhone model: Obsidian sets --keyboard-height on the root element and the viewport does not change.
	const root = { vars: new Map<string, string>(), observers: [] as Listener[] };
	const timers: Listener[] = [];
	const win = {
		innerWidth: 390,
		innerHeight: 900,
		visualViewport: vv,
		addEventListener: add(winListeners),
		removeEventListener: remove(winListeners),
		document: { documentElement: root },
		getComputedStyle: () => ({ getPropertyValue: (k: string) => root.vars.get(k) ?? '' }),
		MutationObserver: class {
			constructor(private cb: Listener) {}
			observe() {
				root.observers.push(this.cb);
			}
			disconnect() {
				root.observers.splice(root.observers.indexOf(this.cb), 1);
			}
		},
		setTimeout: (f: Listener) => timers.push(f),
		clearTimeout: () => undefined,
	};
	const style = new Map<string, string>();
	const classes = new Set<string>();
	const el = {
		win,
		style: { setProperty: (k: string, v: string) => void style.set(k, v), removeProperty: (k: string) => void style.delete(k) },
		toggleClass: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)),
		hasClass: (c: string) => classes.has(c),
		addClass: (c: string) => void classes.add(c),
		removeClass: (c: string) => void classes.delete(c),
	};
	const closed: string[] = [];
	const modal = {
		modalEl: el,
		win: win as unknown,
		close() {
			closed.push(`close at ${style.get('--dynasty-sheet-height')} + ${style.get('--dynasty-sheet-extra') ?? '0'}${classes.has('is-holding') ? ' holding' : ''}`);
			// What Obsidian does first.
			if (closes) this.win = null;
		},
	};
	const clean = phoneLayout(modal as unknown as Modal);
	const keyboard = (h: number) => {
		vv.height = h;
		fire(vvListeners, 'resize');
	};
	const keyboardVar = (h: number | null) => {
		if (h === null) root.vars.delete('--keyboard-height');
		else root.vars.set('--keyboard-height', `${h}px`);
		[...root.observers].forEach((f) => f());
	};
	return { modal, style, classes, closed, clean, keyboard, keyboardVar, observers: root.observers };
}

describe('the window box while it closes (P1)', () => {
	it('follows the visible area before a close', () => {
		const t = setup(844);
		t.keyboard(420);
		expect(t.style.get('--dynasty-sheet-height')).toBe('420px');
		t.keyboard(844);
		expect(t.style.get('--dynasty-sheet-height')).toBe('844px');
	});

	it('at close the box is as tall as the tallest visible area, with the extra room as padding, and no longer follows', () => {
		const t = setup(844);
		t.keyboard(420);
		t.modal.close();
		// Obsidian reads the box height here: 420 + 424 = 844.
		expect(t.closed).toEqual(['close at 844px + 424px holding']);
		// The keyboard goes down during the slide: nothing changes.
		t.keyboard(844);
		expect(t.style.get('--dynasty-sheet-height')).toBe('844px');
		expect(t.style.get('--dynasty-sheet-extra')).toBe('424px');
		t.keyboard(420);
		expect(t.style.get('--dynasty-sheet-height')).toBe('844px');
	});

	it('with no keyboard the box does not change at close', () => {
		const t = setup(844);
		t.modal.close();
		expect(t.closed).toEqual(['close at 844px + 0']);
		expect(t.style.has('--dynasty-sheet-extra')).toBe(false);
		expect(t.classes.has('is-holding')).toBe(false);
	});

	it('a close that only asks a question (the window stays open) gives the box back to the visible area', () => {
		const t = setup(844, false);
		t.keyboard(420);
		t.modal.close();
		t.keyboard(700);
		expect(t.style.get('--dynasty-sheet-height')).toBe('700px');
		expect(t.style.has('--dynasty-sheet-extra')).toBe(false);
		expect(t.classes.has('is-holding')).toBe(false);
	});

	it('the clean-up removes the wrapper', () => {
		const t = setup(844);
		t.clean();
		expect(Object.prototype.hasOwnProperty.call(t.modal, 'close')).toBe(false);
	});
});

describe('the keyboard height of Obsidian (--keyboard-height, the iPhone: the viewport does not change)', () => {
	it('makes the box shorter, and gives the room back when the keyboard goes down', () => {
		const t = setup(844);
		expect(t.style.get('--dynasty-sheet-height')).toBe('844px');
		t.keyboardVar(301);
		expect(t.style.get('--dynasty-sheet-height')).toBe('543px');
		t.keyboardVar(null);
		expect(t.style.get('--dynasty-sheet-height')).toBe('844px');
	});

	it('at close the box keeps the tallest height and does not follow the keyboard down', () => {
		const t = setup(844);
		t.keyboardVar(301);
		t.modal.close();
		expect(t.closed).toEqual(['close at 844px + 301px holding']);
		t.keyboardVar(null);
		expect(t.style.get('--dynasty-sheet-height')).toBe('844px');
		expect(t.style.get('--dynasty-sheet-extra')).toBe('301px');
	});

	it('does not count the keyboard twice when the viewport shrinks too', () => {
		const t = setup(844);
		t.keyboardVar(301);
		t.keyboard(543);
		expect(t.style.get('--dynasty-sheet-height')).toBe('543px');
	});

	it('stops watching in the clean-up', () => {
		const t = setup(844);
		expect(t.observers.length).toBe(1);
		t.clean();
		expect(t.observers.length).toBe(0);
	});
});
