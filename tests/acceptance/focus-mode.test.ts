import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../../src/layout/model';
import { chooseFocus, focusView, isPhoneWindow, type FocusFacts } from '../../src/view/focus-mode';

/*
 * The pure rules of focus mode (WP5.2, src/view/focus-mode.ts), from spec §5.5, §5.6, §7,
 * D18, D20 and the decision notes "M5 — Focus mode and scale":
 * - which focus a view shows: the session focus of the block (Show all people = none), then the
 *   pin, then on a phone the start person's family of a large tree, else the whole tree; a
 *   reference to a person who is not in the tree counts as absent;
 * - a phone is a coarse pointer and a window whose shorter side is under 600 px;
 * - the first view of a focus tree: fit if names are then at least 11 px; else 14 px names with
 *   the focus person centred, so parents show above and children below.
 * The module has no `obsidian` import, so no fake is needed.
 */

// ---------- chooseFocus ----------

const PEOPLE = ['a', 'b', 'c', 's'];

/** Facts for chooseFocus; `large` and `start` are spies, so a test can see if the phone rule ran. */
function facts(o: Partial<Omit<FocusFacts, 'has' | 'large' | 'start'>> & { large?: boolean; start?: string | null; people?: string[] } = {}) {
	const people = new Set(o.people ?? PEOPLE);
	const large = vi.fn(() => o.large ?? false);
	const start = vi.fn(() => (o.start === undefined ? 's' : o.start));
	const f: FocusFacts = {
		session: o.session ?? null,
		pin: o.pin,
		phone: o.phone ?? false,
		auto: o.auto ?? null,
		has: (id) => people.has(id),
		large,
		start,
	};
	return { f, large, start };
}

describe('chooseFocus: session focus > pin > phone rule > whole tree (the decision notes M5, D18, D20)', () => {
	it('a session focus wins over the pin and the phone rule', () => {
		const { f, large, start } = facts({ session: { id: 'a' }, pin: 'b', phone: true, large: true });
		expect(chooseFocus(f)).toMatchObject({ id: 'a', from: 'session', dropSession: false });
		expect(large).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();
	});

	it('Show all people (session id null) wins over the pin: the whole tree', () => {
		const { f } = facts({ session: { id: null }, pin: 'b' });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'session', dropSession: false });
	});

	it('Show all people wins over the phone rule too', () => {
		const { f, large } = facts({ session: { id: null }, phone: true, large: true });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'session' });
		expect(large).not.toHaveBeenCalled();
	});

	it('the pin wins over the phone rule', () => {
		const { f, large } = facts({ pin: 'b', phone: true, large: true });
		expect(chooseFocus(f)).toMatchObject({ id: 'b', from: 'pin', dropSession: false });
		expect(large).not.toHaveBeenCalled();
	});

	it('the pin applies on every device (D18)', () => {
		expect(chooseFocus(facts({ pin: 'b', phone: false }).f)).toMatchObject({ id: 'b', from: 'pin' });
	});

	it('a session focus on a person who is gone falls through to the pin, and is dropped', () => {
		const { f } = facts({ session: { id: 'gone' }, pin: 'b' });
		expect(chooseFocus(f)).toMatchObject({ id: 'b', from: 'pin', dropSession: true });
	});

	it('a session focus on a person who is gone, no pin, desktop: the whole tree, and the session focus is dropped', () => {
		const { f } = facts({ session: { id: 'gone' } });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'none', dropSession: true });
	});

	it('a pin on a person who is gone falls through: the whole tree on a desktop', () => {
		const { f } = facts({ pin: 'gone' });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'none' });
	});

	it('a pin on a person who is gone falls through to the phone rule on a phone', () => {
		const { f } = facts({ pin: 'gone', phone: true, large: true, start: 's' });
		expect(chooseFocus(f)).toMatchObject({ id: 's', from: 'phone', auto: 's' });
	});

	it('phone, large tree, no session and no pin: the start person\'s family, remembered as the automatic focus', () => {
		const { f, start } = facts({ phone: true, large: true, start: 's' });
		expect(chooseFocus(f)).toMatchObject({ id: 's', from: 'phone', auto: 's', dropSession: false });
		expect(start).toHaveBeenCalled();
	});

	it('phone, a tree that is not large (D20: 100 people or fewer): the whole tree', () => {
		const { f } = facts({ phone: true, large: false });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'none', auto: null });
	});

	it('not a phone (tablet, desktop): the whole tree, and the phone rule does not run', () => {
		const { f, large, start } = facts({ phone: false, large: true });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'none' });
		expect(large).not.toHaveBeenCalled();
		expect(start).not.toHaveBeenCalled();
	});

	it('phone: an automatic focus chosen earlier stays, so an edit does not move it', () => {
		const { f, start } = facts({ phone: true, large: true, auto: 'b', start: 's' });
		expect(chooseFocus(f)).toMatchObject({ id: 'b', from: 'phone', auto: 'b' });
		expect(start).not.toHaveBeenCalled();
	});

	it('phone: an automatic focus on a person who is gone is chosen again from the start person', () => {
		const { f } = facts({ phone: true, large: true, auto: 'gone', start: 's' });
		expect(chooseFocus(f)).toMatchObject({ id: 's', from: 'phone', auto: 's' });
	});

	it('phone, large tree, but the start person is not in the tree (or there is none): the whole tree', () => {
		expect(chooseFocus(facts({ phone: true, large: true, start: 'gone' }).f)).toMatchObject({ id: null, from: 'none' });
		expect(chooseFocus(facts({ phone: true, large: true, start: null }).f)).toMatchObject({ id: null, from: 'none' });
	});

	it('when the session focus or the pin decides, the remembered automatic focus is returned unchanged', () => {
		expect(chooseFocus(facts({ pin: 'b', auto: 'c', phone: true }).f).auto).toBe('c');
		expect(chooseFocus(facts({ session: { id: 'a' }, auto: 'c', phone: true }).f).auto).toBe('c');
	});
});

// ---------- isPhoneWindow ----------

describe('isPhoneWindow: a coarse pointer and a window whose shorter side is under 600 px (§7, the decision notes M5)', () => {
	it('phone in portrait and in landscape', () => {
		expect(isPhoneWindow(true, 390, 844)).toBe(true);
		expect(isPhoneWindow(true, 844, 390)).toBe(true);
	});

	it('tablet in portrait and in landscape: not a phone', () => {
		expect(isPhoneWindow(true, 768, 1024)).toBe(false);
		expect(isPhoneWindow(true, 1024, 768)).toBe(false);
		expect(isPhoneWindow(true, 1180, 820)).toBe(false);
	});

	it('desktop (fine pointer), also in a narrow window: not a phone', () => {
		expect(isPhoneWindow(false, 1280, 800)).toBe(false);
		expect(isPhoneWindow(false, 390, 844)).toBe(false);
	});

	it('the boundary: 599 is a phone, 600 is not', () => {
		expect(isPhoneWindow(true, 599, 900)).toBe(true);
		expect(isPhoneWindow(true, 600, 900)).toBe(false);
		expect(isPhoneWindow(true, 900, 599)).toBe(true);
	});
});

// ---------- focusView ----------

const PHONE = { w: 390, h: 844 };
const card = (x: number, y: number): Rect => ({ x, y, w: 180, h: 64 });
const on = (v: { scale: number; cx: number; cy: number }, size: { w: number; h: number }) => ({
	x: (x: number) => size.w / 2 + (x - v.cx) * v.scale,
	y: (y: number) => size.h / 2 + (y - v.cy) * v.scale,
});
/** A card lies wholly on screen. */
function whole(v: { scale: number; cx: number; cy: number }, size: { w: number; h: number }, r: Rect, top = 0): boolean {
	const s = on(v, size);
	return s.x(r.x) >= -1e-6 && s.x(r.x + r.w) <= size.w + 1e-6 && s.y(r.y) >= top - 1e-6 && s.y(r.y + r.h) <= size.h + 1e-6;
}

describe('focusView: the first view of a focus tree (§5.6, D18)', () => {
	it('fits a small family when names are then at least 11 px', () => {
		const bounds = { x: 0, y: 0, w: 400, h: 300 };
		const v = focusView(bounds, { w: 800, h: 600 }, 16, card(110, 118), 0, []);
		expect(v.scale * 16).toBeGreaterThanOrEqual(11);
		expect(v.cx).toBeCloseTo(200, 6);
		expect(v.cy).toBeCloseTo(150, 6);
		expect(whole(v, { w: 800, h: 600 }, bounds)).toBe(true);
	});

	it('the fit never zooms past 1 (§5.5)', () => {
		const v = focusView({ x: 0, y: 0, w: 200, h: 100 }, { w: 800, h: 600 }, 16, card(10, 18), 0, []);
		expect(v.scale).toBeLessThanOrEqual(1);
	});

	it('a large family: 14 px names, the focus person centred, the parent above and the child below on screen', () => {
		const bounds = { x: 0, y: 0, w: 4000, h: 1200 };
		const focus = card(2000, 568);
		const parent = card(2000, 404);
		const child = card(2000, 732);
		const v = focusView(bounds, PHONE, 16, focus, 0, [child]);
		expect(v.scale * 16).toBeCloseTo(14, 6);
		const s = on(v, PHONE);
		expect(s.x(focus.x + focus.w / 2)).toBeCloseTo(PHONE.w / 2, 6);
		expect(s.y(focus.y + focus.h / 2)).toBeCloseTo(PHONE.h / 2, 6);
		expect(whole(v, PHONE, parent)).toBe(true);
		expect(whole(v, PHONE, child)).toBe(true);
		expect(s.y(parent.y + parent.h)).toBeLessThanOrEqual(s.y(focus.y));
		expect(s.y(child.y)).toBeGreaterThanOrEqual(s.y(focus.y + focus.h));
	});

	it('a large family with a toolbar band: the focus person is centred in the area below the band', () => {
		const bounds = { x: 0, y: 0, w: 4000, h: 1200 };
		const focus = card(2000, 568);
		const v = focusView(bounds, PHONE, 16, focus, 60, [card(2000, 732)]);
		const s = on(v, PHONE);
		expect(s.x(focus.x + focus.w / 2)).toBeCloseTo(PHONE.w / 2, 6);
		expect(s.y(focus.y + focus.h / 2)).toBeCloseTo(60 + (PHONE.h - 60) / 2, 6);
	});

	it('the focus person is centred also at the edge of the family (not clamped to the tree)', () => {
		const bounds = { x: 0, y: 0, w: 4000, h: 1200 };
		const focus = card(0, 0);
		const v = focusView(bounds, PHONE, 16, focus, 0, []);
		const s = on(v, PHONE);
		expect(s.x(focus.x + focus.w / 2)).toBeCloseTo(PHONE.w / 2, 6);
		expect(s.y(focus.y + focus.h / 2)).toBeCloseTo(PHONE.h / 2, 6);
	});

	it('children far to one side: the focus card stays whole and a whole child shows beside it (the decision notes WP5.2)', () => {
		const bounds = { x: 0, y: 0, w: 4000, h: 1200 };
		const focus = card(2000, 568);
		// At 14 px names a 390 px phone shows about 445 layout px: the child 200 px right of the focus card fits beside it.
		const child = card(2200, 732);
		const v = focusView(bounds, PHONE, 16, focus, 0, [child]);
		expect(v.scale * 16).toBeCloseTo(14, 6);
		expect(whole(v, PHONE, focus)).toBe(true);
		expect(whole(v, PHONE, child)).toBe(true);
	});

	it('a child too far away to show beside the focus card: the focus card stays whole on screen', () => {
		const bounds = { x: 0, y: 0, w: 4000, h: 1200 };
		const focus = card(2000, 568);
		const v = focusView(bounds, PHONE, 16, focus, 0, [card(3500, 732)]);
		expect(whole(v, PHONE, focus)).toBe(true);
		expect(on(v, PHONE).y(focus.y + focus.h / 2)).toBeCloseTo(PHONE.h / 2, 6);
	});

	it('no focus card: the fitted view', () => {
		const bounds = { x: 0, y: 0, w: 4000, h: 1200 };
		const v = focusView(bounds, PHONE, 16, null, 0, []);
		expect(v.cx).toBeCloseTo(2000, 6);
		expect(v.cy).toBeCloseTo(600, 6);
	});

	it('another font size: still 14 px names on screen', () => {
		const v = focusView({ x: 0, y: 0, w: 4000, h: 1200 }, PHONE, 20, card(2000, 568), 0, []);
		expect(v.scale * 20).toBeCloseTo(14, 6);
	});
});
