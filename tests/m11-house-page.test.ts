import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { openHousePage } from '../src/obsidian/house-page-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { HOUSE_PAGE_UI } from '../src/render/ui-text';
import { FEl, device, dispatch, dispatchWindow, fakeDoc, fakeWin, installDom, resetDom, runTimers } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';

/*
 * WP 11.0 (spec §13.12 and D94; `house-page-window.ts` header): the house page has one
 * close control, its own **Close** button, on every device; Esc closes the window; the keyboard focus starts on
 * **Close**, with no refocus timer. H1 is also proved by a string test on `styles.css` (the harness check H3
 * proves it again with a computed style in Obsidian). Fails until WP 11.3.
 * Run: npx vitest run tests/m11-house-page.test.ts
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const BODY = `houses:
  - {id: valmont, name: House Valmont, color: "#8b1a1a"}
people:
  - {id: aldric, name: Aldric Valmont, house: valmont, born: "1200"}
  - {id: bran, name: Bran Valmont, house: valmont, parents: [aldric]}
`;

function open() {
	const parsed = parseDynasty(BODY);
	if (!parsed.ok) throw new Error('bad body');
	const win = openHousePage({} as never, { app: {} as never, houseId: 'valmont', whole: deriveFamilies(parsed.tree), sourcePath: 'Tree.md', show: () => {}, openNote: () => {} })!;
	const el = win as unknown as { modalEl: FEl; contentEl: FEl };
	return { win, modalEl: el.modalEl, close: el.contentEl.querySelector('.dynasty-sheet-cancel')! };
}

describe('H2: the keyboard focus of the house page', () => {
	it('at open the focus is on the Close button, and it is still there after 250 ms with no key pressed', () => {
		const p = open();
		expect(p.close.getText()).toBe(HOUSE_PAGE_UI.close);
		expect(fakeDoc.activeElement).toBe(p.close);
		runTimers(250);
		expect(fakeDoc.activeElement).toBe(p.close);
		runTimers(2000);
		expect(fakeDoc.activeElement).toBe(p.close);
	});

	it('the focus call does not scroll: focus({ preventScroll: true }) on the Close button', () => {
		const spy = vi.spyOn(FEl.prototype, 'focus');
		const p = open();
		const at = spy.mock.contexts.findIndex((c) => c === p.close);
		expect(at).toBeGreaterThanOrEqual(0);
		expect((spy.mock.calls[at] as unknown[])[0]).toEqual({ preventScroll: true });
	});

	it('no timer moves the focus: when the focus moves away after open, nothing takes it back', () => {
		const p = open();
		const elsewhere = new FEl('div');
		elsewhere.focus();
		runTimers(1000);
		expect(fakeDoc.activeElement).toBe(elsewhere);
		expect(fakeDoc.activeElement).not.toBe(p.close);
	});

	it('the window has exactly one close control of its own, on every width', () => {
		for (const width of [1280, 390]) {
			resetObsidian();
			device.width = width;
			const p = open();
			expect(p.modalEl.querySelectorAll('.dynasty-sheet-cancel')).toHaveLength(1);
		}
	});

	it('Esc closes the window (Obsidian\'s modal scope calls the tracked close)', () => {
		open();
		expect(openModals).toHaveLength(1);
		closePluginModals();
		expect(openModals).toHaveLength(0);
	});

	it('a tap on Close closes the window', () => {
		const p = open();
		dispatch(p.close, 'click');
		expect(openModals).toHaveLength(0);
	});

	it('a rebuild after a phone / computer change gives the focus to the new Close button when the focus was inside the window', () => {
		device.width = 1280;
		const p = open();
		expect(fakeDoc.activeElement).toBe(p.close);
		device.width = 390;
		dispatchWindow('resize');
		const now = p.modalEl.querySelector('.dynasty-sheet-cancel')!;
		expect(now).not.toBe(p.close);
		expect(fakeDoc.activeElement).toBe(now);
	});

	it('a rebuild leaves the focus alone when it was outside the window', () => {
		device.width = 1280;
		const p = open();
		const elsewhere = new FEl('div');
		elsewhere.focus();
		device.width = 390;
		dispatchWindow('resize');
		expect(p.modalEl.querySelector('.dynasty-sheet-cancel')).not.toBe(p.close);
		expect(fakeDoc.activeElement).toBe(elsewhere);
	});
});

// ---------- H1: the CSS rule ----------

interface Rule {
	selectors: string[];
	body: string;
	at: number;
}

/** The rules of a style sheet by simple text scanning (the file has no nested rules except `@media`). */
function rules(css: string): Rule[] {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const out: Rule[] = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const sel = m[1].replace(/@media[^{]*$/, '').trim();
		if (!sel || sel.startsWith('@')) continue;
		out.push({ selectors: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: m[2], at: m.index });
	}
	return out;
}

const css = readFileSync('styles.css', 'utf8');
const RULES = rules(css);
const hides = (r: Rule) => /(^|;|\s)display\s*:\s*none\b/.test(r.body);

describe('H1: Obsidian\'s own close control is hidden in the house page on every device', () => {
	it('a rule hides `.dynasty-house-page .modal-close-button` and `.dynasty-house-page > .modal-header-button` with display: none', () => {
		const rule = RULES.find((r) => r.selectors.includes('.dynasty-house-page .modal-close-button') && r.selectors.includes('.dynasty-house-page > .modal-header-button'));
		expect(rule, 'the H1 rule').toBeDefined();
		expect(hides(rule!)).toBe(true);
	});

	it('the rule comes after every other rule for the sheet\'s close control that sets `display`, so it wins at equal specificity', () => {
		const h1 = RULES.find((r) => r.selectors.includes('.dynasty-house-page .modal-close-button'))!;
		const others = RULES.filter((r) => r !== h1 && r.selectors.some((s) => /^\.dynasty-sheet( |\.is-phone )/.test(s) && /modal-close-button/.test(s)) && /display\s*:/.test(r.body));
		for (const o of others) expect(o.at, o.selectors.join(', ')).toBeLessThan(h1.at);
	});

	it('the rule is not limited to the phone or to a media query: its selectors have no `is-phone`', () => {
		const h1 = RULES.find((r) => r.selectors.includes('.dynasty-house-page .modal-close-button'))!;
		expect(h1.selectors.some((s) => s.includes('is-phone'))).toBe(false);
		const before = css.slice(0, css.indexOf('.dynasty-house-page .modal-close-button'));
		const opens = (before.match(/@media[^{]*\{/g) ?? []).length;
		// Every @media block that opened before the rule has closed again: the rule sits at the top level.
		const depth = [...before.replace(/\/\*[\s\S]*?\*\//g, '')].reduce((d, c) => d + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
		expect(depth).toBe(0);
		expect(opens).toBeGreaterThanOrEqual(0);
	});

	it('the Houses window and the other sheets keep their X on the computer: no other rule hides it without the phone class or the full screen', () => {
		for (const r of RULES.filter((x) => x.selectors.some((s) => /modal-close-button|modal-header-button/.test(s)) && hides(x))) {
			const ok = r.selectors.every((s) => s.includes('is-phone') || s.includes('dynasty-fullscreen') || s.includes('dynasty-house-page'));
			expect(ok, r.selectors.join(', ')).toBe(true);
		}
	});
});
