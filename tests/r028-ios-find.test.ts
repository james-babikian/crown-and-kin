import { readdirSync, readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/*
 * 0.2.8, first iPhone findings: the Find window on an iPhone.
 * 1. The hidden names of the rows (`.dynasty-sr-only`, position: absolute) took the prompt (absolute, overflow: hidden) as their box, escaped the clip
 *    of the list and gave the prompt a scroll area of 22 000 px; iOS scrolled it to show the field. Cure: the parent of such a name is positioned.
 * 2. The top inset made the grey pill 105 px high, and Obsidian centred the clear button on that pill. Cure: the inset is on the prompt.
 * A small cascade (specificity and source order over the real style chunks, as in r028-g3-fix.test.ts) stands in for a browser; the real check is the
 * harness step `r028 ios find`.
 */

interface El {
	tag: string;
	classes: string[];
	parent: El | null;
	children: El[];
}

const el = (tag: string, classes: string[], parent: El | null = null): El => {
	const e: El = { tag, classes, parent, children: [] };
	parent?.children.push(e);
	return e;
};

type Spec = [number, number, number];
type Tester = { test: (e: El) => boolean; spec: Spec };

/** One compound selector, such as `button.mod-warning:not(.x)`. Null when it uses a part this helper cannot judge. */
function compound(text: string): Tester | null {
	let rest = text;
	const tests: ((e: El) => boolean)[] = [];
	const spec: Spec = [0, 0, 0];
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
		// The rule for a parent of a hidden name: `:where(:has(> .cls))` has no specificity.
		const has = /^:where\(:has\(> ?\.([\w-]+)\)\)/.exec(rest);
		if (has) {
			const c = has[1];
			tests.push((e) => e.children.some((k) => k.classes.includes(c)));
			rest = rest.slice(has[0].length);
			continue;
		}
		const fn = /^:(is|not)\(([^()]*)\)/.exec(rest);
		if (fn) {
			const parts = fn[2].split(',').map((p) => compound(p.trim()));
			if (parts.some((p) => p === null)) return null;
			const list = parts as Tester[];
			if (fn[1] === 'is') tests.push((e) => list.some((p) => p.test(e)));
			else tests.push((e) => !list.some((p) => p.test(e)));
			const top = list.reduce((a, p) => (p.spec[1] > a[1] || (p.spec[1] === a[1] && p.spec[2] > a[2]) ? p.spec : a), [0, 0, 0] as Spec);
			for (let i = 0; i < 3; i++) spec[i] += top[i];
			rest = rest.slice(fn[0].length);
			continue;
		}
		return null;
	}
	return { test: (e) => tests.every((t) => t(e)), spec };
}

/** A selector of compounds joined by a space or `>`. Null for a state, an attribute, a pseudo-element or a sibling combinator. */
function selector(text: string): Tester | null {
	const whole = text.trim();
	// The `:has(> ...)` part holds a space and a `>`, so this rule is read as one compound.
	if (whole.startsWith(':where(:has(')) return compound(whole);
	const tokens = whole.replace(/\s*>\s*/g, ' > ').split(/\s+/);
	const parts: { c: Tester; direct: boolean }[] = [];
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
	const spec: Spec = [0, 0, 0];
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
	spec: Spec;
	order: number;
}

function declarations(css: string): { test: (e: El) => boolean; decl: Decl }[] {
	const out: { test: (e: El) => boolean; decl: Decl }[] = [];
	let order = 0;
	postcss.parse(css).walkRules((rule) => {
		// A media or supports block is not judged here.
		for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule') return;
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

function computed(sheet: ReturnType<typeof declarations>, e: El, prop: string): string | undefined {
	let win: Decl | undefined;
	for (const { test, decl } of sheet) if (decl.prop === prop && test(e) && (!win || bigger(decl, win))) win = decl;
	return win?.value;
}

/** The nearest ancestor with a position other than static: the containing block of an absolute box. */
function containingBlock(sheet: ReturnType<typeof declarations>, e: El): El | null {
	for (let a = e.parent; a; a = a.parent) {
		const p = computed(sheet, a, 'position');
		if (p && p !== 'static') return a;
	}
	return null;
}

const CHUNKS = readdirSync(new URL('../styles/', import.meta.url))
	.filter((f) => /^\d\d-.*\.css$/.test(f))
	.sort();
const chunk = (name: string) => readFileSync(new URL(`../styles/${name}`, import.meta.url), 'utf8');
const PLUGIN = CHUNKS.map(chunk).join('\n');

/** The rules of Obsidian that matter here (app.css of 1.14), written before the plugin sheet, as the page loads them. */
const OBSIDIAN = `
.modal { position: relative; }
.prompt { position: absolute; overflow: hidden; }
.prompt-input-container { padding: 12px; margin-bottom: 8px; }
.prompt-input-container .search-input-clear-button { position: absolute; right: 8px; }
`;

const sheet = (plugin = PLUGIN) => declarations(`${OBSIDIAN}\n${plugin}`);

/** The plugin sheet without the two rules that position the row and the parent of a hidden name: the sheet of the fault. */
const BEFORE = PLUGIN.replace(/\.dynasty-picker-row,\n\.dynasty-add-link,[^{]*\{[^}]*\}/, '').replace(/(\.dynasty-picker \.dynasty-picker-row \{[\s\S]*?)\tposition: relative;\n/, '$1');

const phonePicker = () => {
	const body = el('body', ['is-mobile', 'is-ios']);
	const container = el('div', ['modal-container'], body);
	return el('div', ['prompt', 'dynasty-picker', 'is-phone'], container);
};

describe('Find on an iPhone: the hidden names do not grow the scroll area of the prompt', () => {
	it('the sheet of the fault: the hidden name of a picker row takes the prompt as its box (the cause)', () => {
		const prompt = phonePicker();
		const row = el('div', ['suggestion-item', 'dynasty-picker-row'], el('div', ['prompt-results'], prompt));
		const name = el('span', ['dynasty-sr-only'], row);
		expect(BEFORE).not.toBe(PLUGIN);
		expect(containingBlock(sheet(BEFORE), name)).toBe(prompt);
	});

	it('the picker row is positioned, so its hidden name is clipped by the list', () => {
		const prompt = phonePicker();
		const results = el('div', ['prompt-results'], prompt);
		const row = el('div', ['suggestion-item', 'dynasty-picker-row'], results);
		const name = el('span', ['dynasty-sr-only'], row);
		expect(computed(sheet(), row, 'position')).toBe('relative');
		expect(containingBlock(sheet(), name)).toBe(row);
	});

	// Every place that makes a hidden name: its parent must be its containing block, so it can never reach a scroller or a window around it.
	const windowOf = () => el('div', ['modal', 'dynasty-sheet', 'is-phone'], el('div', ['modal-container'], el('body', ['is-mobile'])));
	// The title of a computer window is the first child of the window content: its box is the window itself (Obsidian places `.modal`).
	const places: [string, () => El, ((hidden: El) => El | null)?][] = [
		['picker row (person-picker.ts)', () => el('span', ['dynasty-sr-only'], el('div', ['suggestion-item', 'dynasty-picker-row'], el('div', ['prompt-results'], phonePicker())))],
		['Add link of the Family section (edit-sheet.ts addLink)', () => el('span', ['dynasty-sr-only'], el('button', ['dynasty-link', 'dynasty-add-link'], el('div', ['dynasty-sheet-body'], windowOf())))],
		['parent-type chip (edit-sheet.ts)', () => el('span', ['dynasty-sr-only'], el('span', ['dynasty-chip-select'], el('div', ['dynasty-family-controls'], windowOf())))],
		['title of a computer window (window-shell.ts)', () => el('div', ['dynasty-sheet-title', 'dynasty-sr-only'], el('div', ['modal-content'], windowOf())), (h) => h.parent?.parent ?? null],
		['low bar of a very large tree (large-bar.ts)', () => el('span', ['dynasty-sr-only'], el('div', ['dynasty-large-bar'], el('div', ['dynasty-large-root'], windowOf())))],
		['button of the phone list (phone-list-dom.ts nameBy)', () => el('span', ['dynasty-sr-only'], el('button', ['dynasty-list-go'], el('div', ['dynasty-list-row'], el('div', ['dynasty-list-root'], windowOf()))))],
	];
	for (const [name, make, box] of places) {
		it(`${name}: the parent is the containing block`, () => {
			const hidden = make();
			expect(containingBlock(sheet(), hidden)).toBe(box ? box(hidden) : hidden.parent);
		});
	}

	it('a parent that sets its own place keeps it', () => {
		const head = el('div', ['dynasty-picker-head'], phonePicker());
		el('span', ['dynasty-sr-only'], head);
		expect(computed(sheet(), head, 'position')).toBe('absolute');
		const toolbar = el('div', ['dynasty-toolbar'], windowOf());
		el('span', ['dynasty-sr-only'], toolbar);
		expect(computed(sheet(), toolbar, 'position')).toBe('absolute');
	});

	it('a hidden name stays absolute and clipped, and takes no room', () => {
		const name = el('span', ['dynasty-sr-only'], el('div', []));
		const css = sheet();
		expect(computed(css, name, 'position')).toBe('absolute');
		expect(computed(css, name, 'width')).toBe('1px');
		expect(computed(css, name, 'clip-path')).toBe('inset(50%)');
	});

	it('every place in src that makes a hidden name is in the list above', () => {
		const found: string[] = [];
		const walk = (dir: URL) => {
			for (const f of readdirSync(dir, { withFileTypes: true })) {
				if (f.isDirectory()) walk(new URL(`${f.name}/`, dir));
				else if (f.name.endsWith('.ts') && /cls: (\[[^\]]*)?'dynasty-sr-only'/.test(readFileSync(new URL(f.name, dir), 'utf8'))) found.push(f.name);
			}
		};
		walk(new URL('../src/', import.meta.url));
		expect(found.sort()).toEqual(['edit-sheet.ts', 'large-bar.ts', 'person-picker.ts', 'phone-list-dom.ts', 'window-shell.ts']);
	});
});

describe('Find on an iPhone: the header', () => {
	// tests/r024-phone-b-picker-css.test.ts keeps the other rules of the head (Cancel 44 px, the list 4 px under the field).
	const parts = () => {
		const prompt = phonePicker();
		const container = el('div', ['prompt-input-container'], prompt);
		const clear = el('div', ['search-input-clear-button'], container);
		// 0.3 B.3: Cancel is a child of the prompt, beside the pill, not inside it.
		const cancel = el('button', ['dynasty-picker-cancel'], prompt);
		return { prompt, container, clear, cancel };
	};

	it('the status bar space is the padding of the prompt, not of the grey pill', () => {
		const { prompt, container } = parts();
		const css = sheet();
		expect(computed(css, prompt, 'padding-top')).toBe('env(safe-area-inset-top)');
		const padding = computed(css, container, 'padding')!;
		expect(padding).not.toContain('safe-area-inset-top');
		// 0 at the top and the bottom; the left keeps the safe area, the right is short because the X ends the pill (Cancel is outside).
		expect(padding.replace(/max\(var\(--size-4-3\), env\(safe-area-inset-left\)\)/, 'M')).toBe('0 var(--size-4-2) 0 M');
	});

	it('the clear button is the last item of the pill, 44 px high, and 16 px or more from the Cancel box (the margin beats the Cupertino theme)', () => {
		const { clear, container, prompt } = parts();
		const css = sheet();
		expect(computed(css, clear, 'position')).toBe('static');
		expect(computed(css, clear, 'height')).toBe('44px');
		expect(computed(css, clear, 'width')).toBe('44px');
		expect(computed(css, clear, 'margin')).toBe('0');
		// The right padding of the pill and the column gap of the prompt lie between the X box and the Cancel box; each is Obsidian's 8 px step.
		expect(computed(css, container, 'padding')!.split(/\s+/)[1]).toBe('var(--size-4-2)');
		expect(computed(css, prompt, 'column-gap')).toBe('var(--size-4-2)');
	});

	it('Cancel is outside the grey pill: the prompt is a grid, the pill is column 1 and Cancel column 2 of the same row, the list is the row below', () => {
		const { prompt, container, cancel } = parts();
		const results = el('div', ['prompt-results'], prompt);
		const css = sheet();
		expect(cancel.parent).toBe(prompt);
		expect(computed(css, prompt, 'display')).toBe('grid');
		expect(computed(css, prompt, 'grid-template-columns')).toBe('minmax(0, 1fr) auto');
		expect([computed(css, container, 'grid-row'), computed(css, container, 'grid-column')]).toEqual(['1', '1']);
		expect([computed(css, cancel, 'grid-row'), computed(css, cancel, 'grid-column')]).toEqual(['1', '2']);
		expect([computed(css, results, 'grid-row'), computed(css, results, 'grid-column')]).toEqual(['2', '1 / -1']);
		expect(computed(css, cancel, 'display')).toBe('inline-flex');
		expect(computed(css, cancel, 'min-width')).toBe('44px');
		expect(computed(css, cancel, 'min-height')).toBe('44px');
	});

	it('the pill has no margin below (Obsidian gives it 8 px), so Cancel is centred on the pill; the list has that 8 px as padding', () => {
		const { container, prompt } = parts();
		const results = el('div', ['prompt-results'], prompt);
		const css = sheet();
		expect([computed(css, container, 'margin-top'), computed(css, container, 'margin-bottom')]).toEqual(['0', '0']);
		// The sides are not set here: the inset of Obsidian stays.
		expect(computed(css, container, 'margin-left')).toBeUndefined();
		expect(computed(css, results, 'padding-top')).toBe('calc(var(--size-4-1) + var(--size-4-2))');
		// A computer picker keeps the margin of Obsidian.
		const body = el('body', []);
		const desk = el('div', ['prompt', 'dynasty-picker'], el('div', ['modal-container'], body));
		expect(computed(css, el('div', ['prompt-input-container'], desk), 'margin-bottom')).toBe('8px');
	});

	it('a computer picker keeps Cancel hidden and its prompt is not a grid', () => {
		const body = el('body', []);
		const prompt = el('div', ['prompt', 'dynasty-picker'], el('div', ['modal-container'], body));
		const cancel = el('button', ['dynasty-picker-cancel'], prompt);
		const css = sheet();
		expect(computed(css, cancel, 'display')).toBe('none');
		expect(computed(css, prompt, 'display')).toBeUndefined();
	});

	it('the field draws nothing of its own inside the pill (no oval in the oval), at rest and in every state', () => {
		const { container } = parts();
		const input = el('input', ['prompt-input'], container);
		const css = sheet();
		expect(computed(css, input, 'border')).toBe('0');
		expect(computed(css, input, 'background')).toBe('transparent');
		expect(computed(css, input, 'box-shadow')).toBe('none');
		expect(computed(css, input, 'outline')).toBe('none');
		expect(computed(css, input, 'border-radius')).toBe('0');
		// Obsidian's rules for this field reach (0,4,0) at most (`.is-mobile .prompt-input[type=text]:not(:placeholder-shown)`, padding 96 px).
		const ours = selector('.dynasty-picker.is-phone .prompt-input-container input.prompt-input')!;
		expect(ours.spec[0]).toBe(0);
		expect(ours.spec[1]).toBe(4);
		// Equal in classes to Obsidian's best rule; the tag name `input` is what wins.
		expect(ours.spec[2]).toBe(1);
	});

	it('the field leaves no room for the clear button in its own padding (the button is outside it), and its text starts 8 px in', () => {
		const { container } = parts();
		const input = el('input', ['prompt-input'], container);
		expect(computed(sheet(), input, 'padding')).toBe('0 4px 0 8px');
	});

	it('a focus ring shows only for a fine pointer, and goes round the pill', () => {
		const css = chunk('13-person-picker.css').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(css).toMatch(/@media \(pointer: fine\) \{\s*\.dynasty-picker\.is-phone \.prompt-input-container:has\(> input\.prompt-input:focus-visible\) \{\s*outline: 2px solid/);
	});

	it('a computer picker is not changed', () => {
		const body = el('body', []);
		const prompt = el('div', ['prompt', 'dynasty-picker'], el('div', ['modal-container'], body));
		const container = el('div', ['prompt-input-container'], prompt);
		const clear = el('div', ['search-input-clear-button'], container);
		const css = sheet();
		expect(computed(css, prompt, 'padding-top')).toBeUndefined();
		expect(computed(css, container, 'padding')).toBe('12px');
		expect(computed(css, clear, 'right')).toBe('8px');
	});

	it('no rule gives the container the top inset again', () => {
		const css = chunk('13-person-picker.css').replace(/\/\*[\s\S]*?\*\//g, '');
		expect(css).not.toMatch(/prompt-input-container \{[^}]*safe-area-inset-top/);
	});
});

describe('Find on an iPhone: the margin of the clear button against the Cupertino theme', () => {
	it('beats the selector that Cupertino uses to reset the margin (body:is(.mod-macos, .adaptive-mode-off).is-phone .prompt .prompt-input-container .search-input-clear-button)', () => {
		const ours = selector('.prompt.dynasty-picker.is-phone.is-phone .prompt-input-container .search-input-clear-button')!;
		// Cupertino: 5 classes (:is() counts as its most specific argument) and the tag `body`.
		const theirs: Spec = [0, 5, 1];
		const bigger3 = ours.spec[1] > theirs[1] || (ours.spec[1] === theirs[1] && ours.spec[2] > theirs[2]);
		expect(bigger3).toBe(true);
	});
});
