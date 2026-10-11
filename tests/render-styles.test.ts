import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cardText, geometryFor } from '../src/layout/geometry';
import { COMPACT_NAME_EM, RUMOUR_FONT_EM, TAG_COMPACT_FONT_EM, TAG_FONT_EM } from '../src/render/dom/scene';
import { DEAD_STRIP_OPACITY, HOUSE_DARK_LIFT, STROKES, UNION_MARKS } from '../src/render/styles';
import { roleCss } from './role-css';

// styles.css draws the lines in Obsidian; STROKES draws them in the headless pictures and the
// legend. The two must not drift apart.
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function body(selector: string): string | null {
	const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
	return re.exec(css)?.[2] ?? null;
}

const decls = (text: string) =>
	text
		.split(';')
		.map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as const)
		.filter(([k]) => k);

/** The last value of each property (what a browser with `color-mix()` uses). */
function rule(selector: string): Record<string, string> | null {
	const b = body(selector);
	return b === null ? null : Object.fromEntries(decls(b));
}

/** Every value given to `prop`, in order (a fallback first). */
function values(selector: string, prop: string): string[] {
	return decls(body(selector) ?? '').filter(([k]) => k === prop).map(([, v]) => v);
}

describe('styles.css matches STROKES', () => {
	it.each(Object.entries(STROKES))('.dynasty-line-%s', (kind, s) => {
		const r = rule(`.dynasty-line-${kind}`);
		expect(r, `no rule for .dynasty-line-${kind}`).not.toBeNull();
		expect(values(`.dynasty-line-${kind}`, 'stroke')).toEqual(roleCss(s.role));
		expect(Number(r!['stroke-width'])).toBe(s.width);
		expect(r!['stroke-dasharray']).toBe(s.dash);
		expect(r!['stroke-linecap']).toBe(s.cap);
		expect(r!['stroke-opacity'] === undefined ? undefined : Number(r!['stroke-opacity'])).toBe(s.opacity);
	});

	it('every color-mix() follows a plain var() of its first colour for the same property (iOS before 16.2)', () => {
		const blocks = [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => decls(m[1]));
		let mixes = 0;
		for (const list of blocks) {
			list.forEach(([k, v], i) => {
				if (!v.includes('color-mix(')) return;
				// A custom property takes any text, so a second declaration is no fallback: the next test checks the tokens.
				if (k.startsWith('--')) return;
				mixes++;
				const first = /color-mix\(in srgb, (var\([^)]*\)*\))/.exec(v)?.[1];
				expect(first, v).toBeDefined();
				const before = list.slice(0, i).filter(([k2]) => k2 === k);
				expect(before.length, `${k}: ${v}`).toBe(1);
				expect(before[0][1], `${k}: ${v}`).toBe(first);
			});
		}
		// D38 removed the small ring (one mix): six are left.
		expect(mixes).toBeGreaterThanOrEqual(6);
	});

	it('a token (custom property) with color-mix() has a plain value first and is set again only inside @supports', () => {
		const head = '@supports (color: color-mix(';
		const start = css.indexOf(head);
		expect(start).toBeGreaterThan(-1);
		let depth = 0;
		let end = -1;
		for (let i = css.indexOf('{', start); i < css.length; i++) {
			if (css[i] === '{') depth++;
			else if (css[i] === '}' && --depth === 0) {
				end = i;
				break;
			}
		}
		const inside = css.slice(css.indexOf('{', start) + 1, end);
		const outside = css.slice(0, start) + css.slice(end + 1);
		const mixed = [...inside.matchAll(/(--dynasty-[\w-]+):\s*color-mix\(/g)].map((m) => m[1]);
		expect(mixed.length).toBeGreaterThan(0);
		for (const name of mixed) expect(outside, name).toMatch(new RegExp(`${name}:\\s*var\\(`));
		// Outside the @supports block no token holds a color-mix().
		expect(outside).not.toMatch(/--dynasty-[\w-]+:\s*color-mix\(/);
	});

	it('has no colour literals', () => {
		// rgba(var(--callout-color), …) is Obsidian's own callout colour, so it is allowed.
		expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(\s*[\d.]|hsla?\(/i);
	});
});

describe('styles.css cards and union signs (D26, D27)', () => {
	it('dates use the plugin grey, with the dates role (the theme grey) as the fallback (D212, contrast-tokens)', () => {
		expect(roleCss('dates')).toEqual(['var(--text-muted)']);
		expect(values('.dynasty-card-dates', 'fill')).toEqual(['var(--dynasty-muted, var(--text-muted))']);
		expect(values('.dynasty-card-title', 'fill')).toEqual(['var(--dynasty-muted, var(--text-muted))']);
	});

	it('house ribbons: lifted in the dark theme, less faded when dead', () => {
		expect(values('.theme-dark .dynasty-has-house .dynasty-card-ribbon', 'fill')).toEqual([
			'var(--dynasty-house-color)',
			`color-mix(in srgb, var(--dynasty-house-color) ${Math.round((1 - HOUSE_DARK_LIFT) * 100)}%, var(--text-normal))`, // 60 % since 0.2.8
		]);
		expect(Number(rule('.dynasty-deceased .dynasty-card-ribbon')?.opacity)).toBe(DEAD_STRIP_OPACITY);
	});

	it('union signs have the outline widths the headless renderer draws', () => {
		expect(Number(rule('.dynasty-union-ring')?.['stroke-width'])).toBe(UNION_MARKS.ring.stroke);
		expect(Number(rule('.dynasty-union-open-triangle')?.['stroke-width'])).toBe(UNION_MARKS['open-triangle'].stroke);
		expect(rule('.dynasty-union-open-triangle')?.['stroke-linejoin']).toBe('round');
		for (const open of ['.dynasty-union-ring', '.dynasty-union-open-triangle']) {
			expect(values(open, 'fill'), open).toEqual(['var(--background-primary)']);
			expect(values(open, 'stroke'), open).toEqual(roleCss(STROKES.marriage.role));
		}
	});

	it('D38: no rule is left for the signs that are gone (open diamond, small ring)', () => {
		expect(rule('.dynasty-union-open-diamond')).toBeNull();
		expect(rule('.dynasty-union-dot-implicit')).toBeNull();
	});
});

// Text sizes live in styles.css (spec §5.8); truncation measures with the constants in code.
describe('styles.css text sizes match what the renderer measures', () => {
	const times = (k: number) => (k === 1 ? 'var(--dynasty-font-size)' : `calc(var(--dynasty-font-size) * ${k})`);
	const t = cardText(geometryFor(16));

	it.each([
		['.dynasty-card-name', t.nameSize / 16],
		['.dynasty-card-title', t.smallSize / 16],
		['.dynasty-card-dates', t.smallSize / 16],
		['.dynasty-rumour-marker text', RUMOUR_FONT_EM],
		['.dynasty-tag-full .dynasty-tag-text', TAG_FONT_EM],
	])('%s', (selector, k) => {
		expect(rule(selector)?.['font-size']).toBe(times(k));
	});

	it('.dynasty-card-compact: the Compact size of the note font, or the shrunk size the scene sets for a long name (D203)', () => {
		expect(rule('.dynasty-card-compact')?.['font-size']).toBe(`calc(var(--dynasty-font-size) * var(--dynasty-compact-em, ${COMPACT_NAME_EM}))`);
	});

	it('Compact and Overview tags', () => {
		const group = /\.dynasty-tag-compact \.dynasty-tag-text,\s*\.dynasty-tag-sign \.dynasty-tag-text\s*\{\s*font-size: ([^;]+);/.exec(css);
		expect(group?.[1]).toBe(times(TAG_COMPACT_FONT_EM));
	});

	it('no text size is written into the SVG by the renderer', () => {
		for (const f of ['src/render/dom/scene.ts', 'src/obsidian/tree-view.ts']) {
			expect(readFileSync(join(__dirname, '..', f), 'utf8')).not.toMatch(/'font-size'/);
		}
	});
});
