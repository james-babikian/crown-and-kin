import { readdirSync, readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { CONTRAST_TOKENS, contrastChoices, contrastRatio, mixRgb, pullToward } from '../src/render/dom/theme-read';

/*
 * 0.2.8 G3 fix round. Two faults of the typography build:
 * 1. The links of the row under the window header ("Add portrait or arms", "Add arms", "Open linked note") had the size of the window text, not the Control
 *    role of "Open all": `.dynasty-sheet .dynasty-link` (0,2,0) outranked `.dynasty-openall button` (0,1,1).
 * 2. "Delete person" failed 4.5:1 on a phone: Obsidian's `.is-mobile button.mod-warning` (0,2,1) paints the row with --interactive-normal, a surface that the
 *    run-time pick of --dynasty-error did not check.
 * A small cascade (specificity and source order over the real style chunks) stands in for a browser here; the real Obsidian check is the harness (G3 again).
 */

interface El {
	tag: string;
	classes: string[];
	parent: El | null;
}

const el = (tag: string, classes: string[], parent: El | null = null): El => ({ tag, classes, parent });

/** One compound selector, such as `button.mod-warning:not(.x)`, as a tester and a specificity [ids, classes, tags]. Null when it uses a part this helper cannot judge. */
function compound(text: string): { test: (e: El) => boolean; spec: [number, number, number] } | null {
	let rest = text;
	const tests: ((e: El) => boolean)[] = [];
	const spec: [number, number, number] = [0, 0, 0];
	const tag = /^[a-z][a-z0-9-]*/i.exec(rest);
	if (tag) {
		const t = tag[0];
		tests.push((e) => e.tag === t);
		spec[2]++;
		rest = rest.slice(t.length);
	}
	while (rest) {
		const cls = /^\.([\w-]+)/.exec(rest);
		if (cls) {
			const c = cls[1];
			tests.push((e) => e.classes.includes(c));
			spec[1]++;
			rest = rest.slice(cls[0].length);
			continue;
		}
		const fn = /^:(is|not)\(([^()]*)\)/.exec(rest);
		if (fn) {
			const parts = fn[2].split(',').map((p) => compound(p.trim()));
			if (parts.some((p) => p === null)) return null;
			const list = parts as { test: (e: El) => boolean; spec: [number, number, number] }[];
			if (fn[1] === 'is') tests.push((e) => list.some((p) => p.test(e)));
			else tests.push((e) => !list.some((p) => p.test(e)));
			const top = list.reduce((a, p) => (p.spec[1] > a[1] || (p.spec[1] === a[1] && p.spec[2] > a[2]) ? p.spec : a), [0, 0, 0] as [number, number, number]);
			spec[0] += top[0];
			spec[1] += top[1];
			spec[2] += top[2];
			rest = rest.slice(fn[0].length);
			continue;
		}
		return null;
	}
	return { test: (e) => tests.every((t) => t(e)), spec };
}

/** A selector of compounds joined by a space or `>`. Null for a state (`:hover`), an attribute, a pseudo-element or a sibling combinator. */
function selector(text: string): { test: (e: El) => boolean; spec: [number, number, number] } | null {
	const tokens = text.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
	const parts: { c: NonNullable<ReturnType<typeof compound>>; direct: boolean }[] = [];
	let direct = false;
	for (const t of tokens) {
		if (t === '>') {
			direct = true;
			continue;
		}
		const c = compound(t);
		if (!c) return null;
		parts.push({ c, direct });
		direct = false;
	}
	const spec: [number, number, number] = [0, 0, 0];
	for (const p of parts) for (let i = 0; i < 3; i++) spec[i] += p.c.spec[i];
	const match = (e: El | null, i: number): boolean => {
		if (!e || !parts[i].c.test(e)) return false;
		if (i === 0) return true;
		if (parts[i].direct) return match(e.parent, i - 1);
		for (let a = e.parent; a; a = a.parent) if (match(a, i - 1)) return true;
		return false;
	};
	return { test: (e) => match(e, parts.length - 1), spec };
}

interface Decl {
	prop: string;
	value: string;
	spec: [number, number, number];
	order: number;
}

function declarations(css: string, media: string[]): { test: (e: El) => boolean; decl: Decl }[] {
	const out: { test: (e: El) => boolean; decl: Decl }[] = [];
	let order = 0;
	postcss.parse(css).walkRules((rule) => {
		for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
			if (p.type !== 'atrule') continue;
			const at = p as postcss.AtRule;
			if (at.name !== 'media' || !media.includes(at.params)) return;
		}
		for (const sel of rule.selectors) {
			const s = selector(sel);
			if (!s) continue;
			rule.walkDecls((d) => {
				out.push({ test: s.test, decl: { prop: d.prop, value: d.value, spec: s.spec, order: ++order } });
			});
		}
	});
	return out;
}

const bigger = (a: Decl, b: Decl): boolean => {
	for (let i = 0; i < 3; i++) if (a.spec[i] !== b.spec[i]) return a.spec[i] > b.spec[i];
	return a.order > b.order;
};

/** The winning value of `prop` for `e`. `background` and `background-color` count as one property; a `background` of `none` is `transparent`. */
function computed(sheet: ReturnType<typeof declarations>, e: El, prop: string): string | undefined {
	const names = prop === 'background-color' ? ['background', 'background-color'] : [prop];
	let win: Decl | undefined;
	for (const { test, decl } of sheet) if (names.includes(decl.prop) && test(e) && (!win || bigger(decl, win))) win = decl;
	if (!win) return undefined;
	return prop === 'background-color' && win.value === 'none' ? 'transparent' : win.value;
}

const CHUNKS = readdirSync(new URL('../styles/', import.meta.url))
	.filter((f) => /^\d\d-.*\.css$/.test(f))
	.sort();
const PLUGIN = CHUNKS.map((f) => readFileSync(new URL(`../styles/${f}`, import.meta.url), 'utf8')).join('\n');

/** The rules of Obsidian that the plugin has to outrank (app.css of 1.14), written before the plugin sheet, as the page loads them. */
const OBSIDIAN = `
button { background-color: var(--interactive-normal); }
button:not(.clickable-icon) { font-size: var(--font-ui-small); }
button.mod-warning { background-color: var(--background-modifier-error); }
.is-mobile button.mod-warning { background-color: var(--interactive-normal); font-weight: bold; color: var(--text-error); }
`;

const sheet = (media: string[] = []) => declarations(`${OBSIDIAN}\n${PLUGIN}`, media);

const windowOf = (phone: boolean): El => {
	const body = el('body', phone ? ['is-mobile'] : []);
	return el('div', phone ? ['modal', 'dynasty-sheet', 'is-phone'] : ['modal', 'dynasty-sheet'], body);
};

describe('G3 fix 1: the links of the row under the header take the Control role', () => {
	for (const phone of [false, true]) {
		const win = windowOf(phone);
		const row = el('div', ['dynasty-openall'], win);
		const closeAll = el('button', ['dynasty-openall-button'], row);
		const links: [string, string[]][] = [
			['Add portrait or arms', ['dynasty-link', 'dynasty-add-portrait']],
			['Add arms (Houses window)', ['dynasty-link', 'dynasty-add-portrait', 'dynasty-add-arms']],
			['Open linked note', ['dynasty-link', 'dynasty-open-note', 'dynasty-sheet-open-link']],
		];
		for (const [name, classes] of links) {
			it(`${name} has the size of "Open all" (${phone ? 'phone' : 'computer'})`, () => {
				const css = sheet();
				const link = el('button', classes, row);
				expect(computed(css, closeAll, 'font-size')).toBe('var(--dynasty-type-control)');
				expect(computed(css, link, 'font-size')).toBe('var(--dynasty-type-control)');
				expect(computed(css, link, 'font-weight')).toBe('var(--font-normal)');
				expect(computed(css, link, 'color')).toBe('var(--dynasty-link)');
			});

			it(`${name} keeps its hit area (${phone ? 'phone: 44 px high' : 'computer: the height of "Open all"; a touch screen: 44 px'})`, () => {
				const link = el('button', classes, row);
				const css = sheet();
				if (phone) expect(computed(css, link, 'height')).toBe('44px');
				else expect(computed(css, link, 'height')).toBe(computed(css, closeAll, 'height'));
				const touch = sheet(['(pointer: coarse)']);
				expect(computed(touch, link, 'min-height')).toBe('44px');
				expect(computed(touch, link, 'min-width')).toBe('44px');
			});
		}
	}

	it('the link look of D218 stays: no box, regular, the link colour', () => {
		const link = el('button', ['dynasty-link', 'dynasty-add-portrait'], el('div', ['dynasty-openall'], windowOf(false)));
		const css = sheet();
		expect(computed(css, link, 'border')).toBe('0');
		expect(computed(css, link, 'background-color')).toBe('transparent');
		expect(computed(css, link, 'text-decoration')).toBe('none');
	});

	it('a link outside the row keeps the size of the window text', () => {
		const link = el('button', ['dynasty-link'], el('div', ['dynasty-head-rel'], windowOf(false)));
		expect(computed(sheet(), link, 'font-size')).toBe('inherit');
	});
});

describe('G3 fix 2: the error colour is checked on every surface it sits on', () => {
	const rowOf = (phone: boolean) => el('button', ['dynasty-row', 'is-tap', 'dynasty-action-row', 'dynasty-delete-person', 'is-danger', 'mod-warning'], el('div', [], windowOf(phone)));

	it('the "Delete person" row has no fill on a phone and on a computer, so Obsidian\'s fill of a mod-warning button does not show', () => {
		for (const phone of [true, false]) expect(computed(sheet(), rowOf(phone), 'background-color'), String(phone)).toBe('transparent');
	});

	it('a button with the class mod-warning has the fill that the pick checks, in the error colour', () => {
		for (const phone of [true, false]) {
			const b = el('button', ['mod-warning', 'dynasty-sheet-discard'], el('div', ['dynasty-sheet-confirm-actions'], windowOf(phone)));
			expect(computed(sheet(), b, 'background-color'), String(phone)).toBe('var(--interactive-normal)');
			expect(computed(sheet(), b, 'color'), String(phone)).toBe('var(--dynasty-error)');
		}
	});

	it('the pick covers the fill of a button and the second window colour', () => {
		const error = CONTRAST_TOKENS.find((t) => t.token === '--dynasty-error')!;
		expect(error.on).toEqual(expect.arrayContaining(['--background-primary', '--background-secondary', '--modal-background', '--interactive-normal', '--interactive-hover']));
	});

	it('no style sheet writes the raw theme error role as a text colour', () => {
		const css = PLUGIN.replace(/\/\*[\s\S]*?\*\//g, '');
		const uses = [...css.matchAll(/(?<![-\w])color:\s*var\(--text-error\)/g)];
		expect(uses).toHaveLength(0);
	});

	// The surfaces are the numbers of the G3 pictures; the error roles are the stock values of each theme family.
	const themes: Record<string, Record<string, string>> = {
		'default dark': { text: '#dadada', error: '#fb464c', primary: '#1e1e1e', alt: '#262626', secondary: '#262626', normal: '#343434', hover: '#3f3f3f' },
		'minimal dark': { text: '#d4d4d4', error: '#d16054', primary: '#1f1f1f', alt: '#262626', secondary: '#262626', normal: '#333231', hover: '#3c3b3a' },
		'cupertino dark': { text: '#e6e6e6', error: '#d96d71', primary: '#1c1c1e', alt: '#2c2c2e', secondary: '#2c2c2e', normal: '#3c3c3c', hover: '#484848' },
		'anuppuccin light': { text: '#4c4f69', error: '#be1940', primary: '#eff1f5', alt: '#e6e9ef', secondary: '#e6e9ef', normal: '#ccd0da', hover: '#bcc0cc' },
		'default light': { text: '#222222', error: '#e93147', primary: '#ffffff', alt: '#f6f6f6', secondary: '#f6f6f6', normal: '#f2f3f5', hover: '#e9e9e9' },
	};
	const hex = (css: string): number[] | null => {
		const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css.trim());
		return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
	};
	const rgb = (css: string): number[] => (/^rgb\((\d+), (\d+), (\d+)\)$/.exec(css) ?? []).slice(1).map(Number);

	for (const [name, t] of Object.entries(themes)) {
		it(`${name}: the error colour reaches 4.5:1 on the window, the second window colour and the button fills`, () => {
			const dark = contrastRatio(hex(t.text)!, hex(t.primary)!) > 7 && hex(t.primary)![0] < 128;
			const base = mixRgb(hex(t.error)!, hex(t.text)!, dark ? 0.1 : 0.15);
			const page: Record<string, string> = {
				'--text-normal': t.text,
				'--text-error': t.error,
				'--dynasty-error': `#${base.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
				'--background-primary': t.primary,
				'--background-primary-alt': t.alt,
				'--background-secondary': t.secondary,
				'--modal-background': t.primary,
				'--interactive-normal': t.normal,
				'--interactive-hover': t.hover,
			};
			const pick = contrastChoices((n) => page[n] ?? '', hex)['--dynasty-error'];
			const colour = pick ? rgb(pick) : base;
			for (const key of ['--background-primary', '--background-primary-alt', '--background-secondary', '--modal-background', '--interactive-normal', '--interactive-hover']) {
				expect(contrastRatio(colour, hex(page[key])!), key).toBeGreaterThanOrEqual(4.5);
			}
		});
	}

	it('the old list of surfaces left a phone button fill unchecked (the cause of the G3 numbers): one theme fell under 4.5:1 on it', () => {
		const low = Object.values(themes).filter((t) => {
			const surfaces = [t.primary, t.alt, t.primary].map((c) => hex(c)!);
			const pick = pullToward(mixRgb(hex(t.error)!, hex(t.text)!, 0.1), hex(t.text)!, surfaces, 4.5);
			return contrastRatio(pick, hex(t.normal)!) < 4.5;
		});
		expect(low.length).toBeGreaterThan(0);
	});
});

describe('G5: the dead-sign samples are 12 px and fit their slot (D218: nothing under 12 px)', () => {
	it('the screen class and the saved picture use 12 px', () => {
		expect(PLUGIN).toMatch(/\.dynasty-legend-dagger \{[^}]*font-size: 12px;/);
		expect(readFileSync(new URL('../src/render/svg-string.ts', import.meta.url), 'utf8')).toContain('font-size="12" fill="${c.textMuted}"');
	});

	it('the two samples have a slot that leaves 8 px or more at each side of "b. 1131 †?" (about 55 px at 12 px)', async () => {
		const { legendRows, LEGEND_DEAD_SAMPLE_W } = await import('../src/render/legend');
		const dead = legendRows().filter((r) => r.kind === 'dead' || r.kind === 'dead-doubt');
		expect(dead).toHaveLength(2);
		for (const r of dead) expect(r.w).toBe(LEGEND_DEAD_SAMPLE_W);
		expect((LEGEND_DEAD_SAMPLE_W - 55) / 2).toBeGreaterThanOrEqual(8);
	});
});
