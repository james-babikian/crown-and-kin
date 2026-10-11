import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache, relationsFor } from '../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';
import { clearMeasureCache } from '../src/render/dom/measure';
import { wireCardTips, type CardTips } from '../src/render/dom/card-tip';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, pointer, resetDom, runTimers, wheel } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards, phone } from './acceptance/tree-view-fakes';
import { build } from './helpers';

/*
 * WP-C4 of 0.2.5 (D145, CONTRACT C.3.4): the plugin's own tooltip on a card. Part 1 tests the module with a small fake host;
 * part 2 tests the tree view that wires it (the setting, the marked card, a phone, the listeners).
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	clearMeasureCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

interface Rig {
	host: FEl;
	cards: Map<string, { g: FEl; bg: FEl; link: FEl }>;
	state: { enabled: boolean; busy: boolean };
	tips: CardTips;
}

/** A viewport 800 x 600 at the page origin, cards of 150 x 60 at given places, a tip of 100 x 24 once it exists. */
function rig(places: Record<string, [number, number]> = { a: [100, 100], b: [400, 100] }, texts: Record<string, string> = { a: 'Father', b: 'Aunt by marriage' }): Rig {
	const host = new FEl('div', { cls: 'dynasty-viewport' });
	host.clientWidth = 800;
	host.clientHeight = 600;
	const cards = new Map<string, { g: FEl; bg: FEl; link: FEl }>();
	const canvas = host.createDiv({ cls: 'dynasty-canvas' });
	for (const [id, [left, top]] of Object.entries(places)) {
		const g = canvas.createDiv({ cls: 'dynasty-card', attr: { 'data-person': id, tabindex: '0' } });
		g.getBoundingClientRect = () => ({ left, top, x: left, y: top, width: 150, height: 60, right: left + 150, bottom: top + 60 });
		cards.set(id, { g, bg: g.createEl('rect', { cls: 'dynasty-card-bg' }), link: g.createEl('text', { cls: 'dynasty-card-name dynasty-name-link' }) });
	}
	const make = host.createDiv.bind(host);
	host.createDiv = (o) => {
		const d = make(o);
		d.offsetWidth = 100;
		d.offsetHeight = 24;
		return d;
	};
	const state = { enabled: true, busy: false };
	const tips = wireCardTips({ host: host as unknown as HTMLElement, text: (id) => texts[id], enabled: () => state.enabled, busy: () => state.busy });
	return { host, cards, state, tips };
}

const tipOf = (r: Rig) => r.host.querySelector('.dynasty-tip');
const move = (el: FEl, type: 'mouse' | 'touch' | 'pen' = 'mouse') => dispatch(el, 'pointermove', pointer(type, 1, 150, 120));

describe('shows after the pointer rests (C.3.4)', () => {
	it('after 400 ms on a card, with the relation text only', () => {
		const r = rig();
		move(r.cards.get('a')!.bg);
		runTimers(399);
		expect(tipOf(r)).toBeNull();
		runTimers(1);
		const tip = tipOf(r)!;
		expect(tip.getText()).toBe('Father');
		expect(tip.children).toHaveLength(0);
		expect(tip.getAttribute('data-person')).toBe('a');
		expect(tip.getAttribute('aria-hidden')).toBe('true');
		expect(tip.getAttribute('role')).toBeNull();
		expect(tip.parentElement).toBe(r.host);
	});

	it('a move inside the card restarts the wait; once shown it stays while the pointer stays in the card', () => {
		const r = rig();
		const bg = r.cards.get('a')!.bg;
		move(bg);
		runTimers(300);
		move(bg);
		runTimers(300);
		expect(tipOf(r)).toBeNull();
		runTimers(100);
		const tip = tipOf(r)!;
		move(bg);
		move(r.cards.get('a')!.g);
		expect(tipOf(r)).toBe(tip);
		runTimers(2000);
		expect(tipOf(r)).toBe(tip);
	});

	it('moves to the next card: the first tip goes, the second comes after its own wait', () => {
		const r = rig();
		move(r.cards.get('a')!.bg);
		runTimers(400);
		move(r.cards.get('b')!.bg);
		expect(tipOf(r)).toBeNull();
		runTimers(400);
		expect(tipOf(r)!.getText()).toBe('Aunt by marriage');
		expect(r.host.querySelectorAll('.dynasty-tip')).toHaveLength(1);
	});

	it('the delay can be given', () => {
		const host = new FEl('div');
		const g = host.createDiv({ cls: 'dynasty-card', attr: { 'data-person': 'a' } });
		wireCardTips({ host: host as unknown as HTMLElement, text: () => 'Son', enabled: () => true, busy: () => false, delayMs: 50 });
		move(g);
		runTimers(50);
		expect(host.querySelector('.dynasty-tip')).not.toBeNull();
	});
});

describe('when it never shows', () => {
	it('never for a touch or a pen pointer', () => {
		const r = rig();
		for (const type of ['touch', 'pen'] as const) {
			move(r.cards.get('a')!.bg, type);
			runTimers(2000);
			expect(tipOf(r)).toBeNull();
		}
	});

	it('a touch move cancels the wait of an earlier mouse move', () => {
		const r = rig();
		move(r.cards.get('a')!.bg);
		move(r.cards.get('a')!.bg, 'touch');
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
	});

	it('never over a linked name (the page preview opens there), and it goes when the pointer reaches the name', () => {
		const r = rig();
		move(r.cards.get('a')!.link);
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
		move(r.cards.get('a')!.bg);
		runTimers(400);
		expect(tipOf(r)).not.toBeNull();
		move(r.cards.get('a')!.link);
		expect(tipOf(r)).toBeNull();
	});

	it('never when the person has no text, or when the tip is not enabled', () => {
		const r = rig({ a: [100, 100], c: [400, 100] }, { a: 'Father' });
		move(r.cards.get('c')!.bg);
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
		r.state.enabled = false;
		move(r.cards.get('a')!.bg);
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
	});

	it('a tip that shows goes when the tip is no longer enabled and the pointer moves', () => {
		const r = rig();
		move(r.cards.get('a')!.bg);
		runTimers(400);
		r.state.enabled = false;
		move(r.cards.get('a')!.bg);
		expect(tipOf(r)).toBeNull();
	});

	it('not while the view moves (a pan, a pinch, an animation)', () => {
		const r = rig();
		r.state.busy = true;
		move(r.cards.get('a')!.bg);
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
	});

	it('not on something that is not a card', () => {
		const r = rig();
		move(r.host);
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
	});
});

describe('hides', () => {
	function shownTip(): Rig {
		const r = rig();
		move(r.cards.get('a')!.bg);
		runTimers(400);
		expect(tipOf(r)).not.toBeNull();
		return r;
	}

	it('when the pointer leaves the card (onto empty space) or the viewport', () => {
		const r = shownTip();
		move(r.host.querySelector('.dynasty-canvas')!);
		expect(tipOf(r)).toBeNull();
		const r2 = shownTip();
		dispatch(r2.host, 'pointerleave', { ...pointer('mouse', 1, 0, 0), bubbles: false });
		expect(tipOf(r2)).toBeNull();
	});

	it('on a press, a wheel turn and the pan or zoom that ends (shown after settled)', () => {
		const r = shownTip();
		dispatch(r.cards.get('a')!.bg, 'pointerdown', pointer('mouse', 1, 150, 120));
		expect(tipOf(r)).toBeNull();
		const r2 = shownTip();
		dispatch(r2.host, 'wheel', wheel(0, 100));
		expect(tipOf(r2)).toBeNull();
		const r3 = shownTip();
		r3.tips.hide();
		expect(tipOf(r3)).toBeNull();
	});

	it('a press stops a wait that has not ended, and the card stays quiet until the pointer leaves it', () => {
		const r = rig();
		const bg = r.cards.get('a')!.bg;
		move(bg);
		dispatch(bg, 'pointerdown', pointer('mouse', 1, 150, 120));
		move(bg);
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
		move(r.cards.get('b')!.bg);
		runTimers(400);
		expect(tipOf(r)).not.toBeNull();
	});

	it('on Escape, and the key event goes on', () => {
		const r = shownTip();
		const seen: string[] = [];
		r.host.parentElement ??= new FEl('div');
		const outer = r.host.parentElement!;
		outer.addEventListener('keydown', (e) => void seen.push(String(e.key)));
		const e = dispatch(r.host, 'keydown', { key: 'Escape' });
		expect(tipOf(r)).toBeNull();
		expect(e.defaultPrevented).toBe(false);
		expect(seen).toEqual(['Escape']);
	});

	it('another key does not hide it', () => {
		const r = shownTip();
		dispatch(r.host, 'keydown', { key: 'a' });
		expect(tipOf(r)).not.toBeNull();
	});
});

describe('the keyboard focus', () => {
	it('shows at once on a card that gets the focus after a key, and goes on blur', () => {
		const r = rig();
		dispatch(r.host, 'keydown', { key: 'Tab' });
		dispatch(r.cards.get('a')!.g, 'focus', { bubbles: false });
		expect(tipOf(r)).toBeNull();
		runTimers(0);
		expect(tipOf(r)!.getText()).toBe('Father');
		dispatch(r.cards.get('a')!.g, 'blur', { bubbles: false });
		expect(tipOf(r)).toBeNull();
	});

	it('a focus that a mouse press made shows nothing', () => {
		const r = rig();
		const g = r.cards.get('a')!.g;
		dispatch(g, 'pointerdown', pointer('mouse', 1, 150, 120));
		dispatch(g, 'focus', { bubbles: false });
		expect(tipOf(r)).toBeNull();
		// The next key press is a keyboard focus again.
		dispatch(r.host, 'keydown', { key: 'Tab' });
		dispatch(r.cards.get('b')!.g, 'focus', { bubbles: false });
		runTimers(0);
		expect(tipOf(r)!.getText()).toBe('Aunt by marriage');
	});

	it('while the view moves it waits for shown() and then shows', () => {
		const r = rig();
		r.state.busy = true;
		dispatch(r.host, 'keydown', { key: 'Tab' });
		dispatch(r.cards.get('a')!.g, 'focus', { bubbles: false });
		runTimers(0);
		expect(tipOf(r)).toBeNull();
		r.state.busy = false;
		r.tips.hide();
		r.tips.shown();
		expect(tipOf(r)!.getAttribute('data-person')).toBe('a');
	});

	it('shown() shows nothing when no focus waits, after a blur, or after Escape', () => {
		const r = rig();
		r.tips.shown();
		expect(tipOf(r)).toBeNull();
		r.state.busy = true;
		dispatch(r.host, 'keydown', { key: 'Tab' });
		dispatch(r.cards.get('a')!.g, 'focus', { bubbles: false });
		dispatch(r.cards.get('a')!.g, 'blur', { bubbles: false });
		r.state.busy = false;
		r.tips.shown();
		expect(tipOf(r)).toBeNull();
		r.state.busy = true;
		dispatch(r.cards.get('a')!.g, 'focus', { bubbles: false });
		dispatch(r.host, 'keydown', { key: 'Escape' });
		r.state.busy = false;
		r.tips.shown();
		expect(tipOf(r)).toBeNull();
	});

	it('a focus on something that is not a card, or on a card with no text, shows nothing', () => {
		const r = rig({ a: [100, 100], c: [400, 100] }, { a: 'Father' });
		dispatch(r.host, 'keydown', { key: 'Tab' });
		dispatch(r.host.querySelector('.dynasty-canvas')!, 'focus', { bubbles: false });
		dispatch(r.cards.get('c')!.g, 'focus', { bubbles: false });
		expect(tipOf(r)).toBeNull();
	});

	it('a disabled tip does not show on focus either', () => {
		const r = rig();
		r.state.enabled = false;
		dispatch(r.host, 'keydown', { key: 'Tab' });
		dispatch(r.cards.get('a')!.g, 'focus', { bubbles: false });
		expect(tipOf(r)).toBeNull();
	});
});

describe('where it sits', () => {
	const vars = (r: Rig) => {
		const t = tipOf(r)!;
		return { x: parseFloat(t.style.getPropertyValue('--dynasty-tip-x')), y: parseFloat(t.style.getPropertyValue('--dynasty-tip-y')), above: t.hasClass('dynasty-tip-above') };
	};

	it('under the card, centred on it, 8 px below its bottom edge, through custom properties only', () => {
		const r = rig({ a: [100, 100] }, { a: 'Father' });
		move(r.cards.get('a')!.bg);
		runTimers(400);
		expect(vars(r)).toEqual({ x: 175, y: 168, above: false });
		expect(tipOf(r)!.getAttribute('style')).toBeNull();
	});

	it('over the card when it would pass the bottom of the viewport', () => {
		const r = rig({ a: [100, 540] }, { a: 'Father' });
		move(r.cards.get('a')!.bg);
		runTimers(400);
		expect(vars(r)).toEqual({ x: 175, y: 532, above: true });
	});

	it('inside the viewport at the left and the right edge, and the arrow keeps pointing at the card', () => {
		const r = rig({ a: [-60, 100], b: [710, 100] }, { a: 'Father', b: 'Son' });
		move(r.cards.get('a')!.bg);
		runTimers(400);
		const left = vars(r);
		expect(left.x).toBe(54);
		expect(tipOf(r)!.style.getPropertyValue('--dynasty-tip-arrow')).toBe('-39px');
		move(r.cards.get('b')!.bg);
		runTimers(400);
		expect(vars(r).x).toBe(746);
		expect(tipOf(r)!.style.getPropertyValue('--dynasty-tip-arrow')).toBe('39px');
	});

	it('uses the place of the card in the viewport, not in the page', () => {
		const r = rig({ a: [100, 100] }, { a: 'Father' });
		r.host.getBoundingClientRect = () => ({ left: 40, top: 30, x: 40, y: 30, width: 800, height: 600, right: 840, bottom: 630 });
		move(r.cards.get('a')!.bg);
		runTimers(400);
		expect(vars(r)).toEqual({ x: 135, y: 138, above: false });
	});
});

describe('cost and cleanup', () => {
	it('wires no listener on a card, and a few on the host', () => {
		const r = rig();
		for (const { g, bg, link } of r.cards.values()) for (const el of [g, bg, link]) expect(el.listeners.size).toBe(0);
		const types = [...r.host.listeners.keys()].sort();
		expect(types).toEqual(['blur', 'focus', 'keydown', 'pointerdown', 'pointerleave', 'pointermove', 'wheel']);
		expect([...r.host.listeners.values()].flat()).toHaveLength(7);
	});

	it('destroy removes the tip and every listener, and stops a wait that is running', () => {
		const r = rig();
		move(r.cards.get('a')!.bg);
		runTimers(400);
		move(r.cards.get('b')!.bg);
		r.tips.destroy();
		expect(tipOf(r)).toBeNull();
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
		expect([...r.host.listeners.values()].flat()).toHaveLength(0);
		move(r.cards.get('a')!.bg);
		runTimers(2000);
		expect(tipOf(r)).toBeNull();
		r.tips.destroy();
	});

	it('hide() and shown() with nothing to hide do nothing and do not throw', () => {
		const r = rig();
		expect(() => {
			r.tips.hide();
			r.tips.shown();
			r.tips.hide();
		}).not.toThrow();
	});

	it('a text callback that throws never reaches the page: no tip and no error', () => {
		const host = new FEl('div');
		const g = host.createDiv({ cls: 'dynasty-card', attr: { 'data-person': 'a' } });
		wireCardTips({
			host: host as unknown as HTMLElement,
			text: () => {
				throw new Error('boom');
			},
			enabled: () => true,
			busy: () => false,
		});
		move(g);
		expect(() => runTimers(2000)).not.toThrow();
		expect(host.querySelector('.dynasty-tip')).toBeNull();
	});
});

describe('the style block', () => {
	const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
	const block = css.slice(css.indexOf('/* C: focus list and tooltip */'));
	const rules = block.slice(0, block.indexOf('/* =====') > 0 ? block.indexOf('/* =====') : undefined);

	it('has the tip rule with the theme colours, above the tree, and no pointer events', () => {
		const rule = /\.dynasty-tip \{[^}]*\}/.exec(rules)![0];
		expect(rule).toContain('var(--dynasty-tip-x');
		expect(rule).toContain('var(--dynasty-tip-y');
		expect(rule).toContain('z-index: 30');
		expect(rule).toContain('pointer-events: none');
		expect(rule).toContain('var(--text-normal)');
		expect(rule).toContain('var(--background-primary)');
		expect(rule).toContain('var(--dynasty-type-text)');
		expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
	});

	it('puts nothing of the tip outside the marked block (0.2.8: the Focus menu has its rule with the More menu in the toolbar chunk)', () => {
		const before = css.slice(0, css.indexOf('/* C: focus list and tooltip */'));
		expect(before).not.toMatch(/dynasty-tip/);
	});
});

const PEOPLE = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
  - {id: cy, name: Cy Valmont, born: 1160, parents: [bo]}
`;
const MARKED = `options:\n  me: bo\n${PEOPLE}`;

async function drawn(src: string, showRelations: boolean) {
	desktop();
	const host = fakeHost({ ...DEFAULT_SETTINGS, showRelations });
	const e = await embed(src, { host, handle: fakeHandle('n.md', src) });
	fillAllCards(e.el);
	return e;
}

const bgOf = (el: FEl, id: string) => el.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-card-bg`)!;

describe('the tree view wires it (C.3.4)', () => {
	it('with the setting off it shows the relation word of the card that rests, from the same cache as the card word', async () => {
		const { el, vp } = await drawn(MARKED, false);
		const words = relationsFor(build(MARKED).g, 'bo').cards;
		move(bgOf(el, 'ann'));
		runTimers(400);
		const tip = vp.querySelector('.dynasty-tip')!;
		expect(tip.getText()).toBe(words.get('ann')!.text);
		expect(tip.getText()).toBe('Parent');
		expect(tip.getText()).not.toMatch(/edit/i);
		move(bgOf(el, 'cy'));
		runTimers(400);
		expect(vp.querySelectorAll('.dynasty-tip')).toHaveLength(1);
		expect(vp.querySelector('.dynasty-tip')!.getText()).toBe('Child');
	});

	it('never on the marked card', async () => {
		const { el, vp } = await drawn(MARKED, false);
		move(bgOf(el, 'bo'));
		runTimers(2000);
		expect(vp.querySelector('.dynasty-tip')).toBeNull();
	});

	it('never with the setting on (the card has its own word)', async () => {
		const { el, vp } = await drawn(MARKED, true);
		move(bgOf(el, 'ann'));
		runTimers(2000);
		expect(vp.querySelector('.dynasty-tip')).toBeNull();
	});

	it('follows a change of the setting without a new render of the tip', async () => {
		const settings = { ...DEFAULT_SETTINGS };
		desktop();
		const host = fakeHost(settings);
		const { el, view } = await embed(MARKED, { host, handle: fakeHandle('n.md', MARKED) });
		fillAllCards(el);
		move(bgOf(el, 'ann'));
		runTimers(2000);
		expect(el.querySelector('.dynasty-tip')).toBeNull();
		const prev = { ...settings };
		settings.showRelations = false;
		view.onSettingsChange(prev);
		fillAllCards(el);
		move(bgOf(el, 'ann'));
		runTimers(400);
		expect(el.querySelector('.dynasty-tip')!.getText()).toBe('Parent');
	});

	it('never with no mark, as no card has a relation', async () => {
		const { el, vp } = await drawn(PEOPLE, false);
		move(bgOf(el, 'ann'));
		runTimers(2000);
		expect(vp.querySelector('.dynasty-tip')).toBeNull();
	});

	it('never for a touch pointer', async () => {
		const { el, vp } = await drawn(MARKED, false);
		move(bgOf(el, 'ann'), 'touch');
		runTimers(2000);
		expect(vp.querySelector('.dynasty-tip')).toBeNull();
	});

	it('puts no listener of its own on a card (its own focus and Enter key listeners stay)', async () => {
		const { el } = await drawn(MARKED, false);
		const cards = el.querySelectorAll('.dynasty-card');
		expect(cards).toHaveLength(3);
		for (const card of cards) {
			for (const type of ['pointermove', 'pointerleave', 'pointerdown', 'blur', 'wheel']) {
				expect(card.listeners.get(type) ?? [], type).toHaveLength(0);
			}
			// The view's own Enter key and reveal-on-focus listeners, as before this work package.
			expect(card.listeners.get('focus') ?? []).toHaveLength(1);
			expect(card.listeners.get('keydown') ?? []).toHaveLength(1);
		}
	});

	it('a keyboard focus on a card shows the tip, and the card label keeps the relation for a screen reader', async () => {
		const { el, vp } = await drawn(MARKED, false);
		const g = el.querySelector('.dynasty-card[data-person="ann"]')!;
		dispatch(vp, 'keydown', { key: 'Tab' });
		dispatch(g, 'focus', { bubbles: false });
		runTimers(0);
		flushFrames();
		runTimers(0);
		expect(vp.querySelector('.dynasty-tip')!.getText()).toBe('Parent');
		expect(vp.querySelector('.dynasty-tip')!.getAttribute('aria-hidden')).toBe('true');
		expect(g.getAttribute('aria-label')).toContain('parent');
	});

	it('the end of a pan or zoom hides it', async () => {
		const { el, vp, view } = await drawn(MARKED, false);
		move(bgOf(el, 'ann'));
		runTimers(400);
		expect(vp.querySelector('.dynasty-tip')).not.toBeNull();
		(view as unknown as { settled(v: unknown, byUser: boolean): void }).settled({ x: 0, y: 0, scale: 1 }, true);
		expect(vp.querySelector('.dynasty-tip')).toBeNull();
	});

	it('goes when the view ends, with its timer', async () => {
		const { el, vp, view } = await drawn(MARKED, false);
		move(bgOf(el, 'ann'));
		(view as unknown as { onunload(): void }).onunload();
		runTimers(2000);
		expect(vp.querySelector('.dynasty-tip')).toBeNull();
	});

	it('a phone has a list: no card, no tip', async () => {
		phone();
		const host = fakeHost({ ...DEFAULT_SETTINGS, showRelations: false });
		const { el, vp } = await embed(MARKED, { host, handle: fakeHandle('n.md', MARKED) });
		expect(el.querySelector('.dynasty-card')).toBeNull();
		expect(vp.querySelector('.dynasty-list')).not.toBeNull();
		expect(vp.querySelector('.dynasty-tip')).toBeNull();
	});
});
