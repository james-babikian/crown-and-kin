import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HIT_CLASS, HIT_REACH, SCENE_TAP_GROUPS, SCENE_TAP_TARGETS } from '../../src/render/tap-targets';
import { FEl, clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { embed } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * WP-touch (0.5.7, D375 (1)): one transparent rectangle takes each press on the empty background; the scene takes none; the tap targets take
 * presses again from one list. Frame tests run on the real TreeView; the style and source scans keep the one list true.
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const root = (p: string) => join(__dirname, '..', '..', p);
const BASE_CSS = readFileSync(root('styles/01-base.css'), 'utf8');
const sel = (list: readonly string[]) => list.join(', ');

function all(el: FEl, out: FEl[] = []): FEl[] {
	out.push(el);
	for (const c of el.children) all(c, out);
	return out;
}

const TREE = ['people:', '  - id: a', '    name: Aldous Hale', '  - id: b', '    name: Berta Hale', '    parents: [a]', ''].join('\n');

describe('rule 1: the frame holds one hit rectangle before the scene', () => {
	it('the svg has the rectangle first, then the scene; a redraw keeps exactly one', async () => {
		const m = await embed(TREE);
		const svg = m.el.querySelector('.dynasty-svg')!;
		expect(svg.children[0].hasClass(HIT_CLASS)).toBe(true);
		expect(svg.children[1].hasClass('dynasty-scene')).toBe(true);
		const rect = svg.children[0];
		expect(rect.getAttribute('aria-hidden')).toBe('true');
		expect(rect.getAttribute('tabindex')).toBeNull();
		expect(Number(rect.getAttribute('width'))).toBe(2 * HIT_REACH);
		expect(Number(rect.getAttribute('x'))).toBe(-HIT_REACH);
		const count = () => all(m.el).filter((e) => e.hasClass(HIT_CLASS)).length;
		expect(count()).toBe(1);
		const v = m.view as unknown as { g: unknown; laid: unknown; redraw(g: unknown, l: unknown): void };
		v.redraw(v.g, v.laid);
		expect(count()).toBe(1);
	});

	it('the saved picture has no hit rectangle', async () => {
		const src = readFileSync(root('src/render/svg-string.ts'), 'utf8');
		expect(src).not.toContain(HIT_CLASS);
		expect(src).not.toContain('tap-targets');
	});
});

describe('rules 2 and 3: the style sheet', () => {
	it('the hit rectangle takes presses and the scene takes none', () => {
		expect(BASE_CSS).toMatch(/\.dynasty-hit \{[^}]*pointer-events: all/);
		expect(BASE_CSS).toMatch(/\.dynasty-svg > \.dynasty-scene \{\s*pointer-events: none;/);
	});

	it('the zero-specificity rules list exactly the shared targets and groups', () => {
		expect(BASE_CSS).toContain(`:where(.dynasty-svg) :where(${sel(SCENE_TAP_TARGETS)}) {\n\tpointer-events: all;`);
		expect(BASE_CSS).toContain(`:where(.dynasty-svg) :where(${sel(SCENE_TAP_GROUPS)}) :where(*) {\n\tpointer-events: auto;`);
	});

	it('a press on a card is still on the card background: arms and portrait take no press of their own', () => {
		const scene = readFileSync(root('src/render/dom/scene-cards.ts'), 'utf8');
		expect(scene).toContain("'dynasty-card-bg'");
		expect(BASE_CSS).toContain('.dynasty-card-bg');
	});
});

describe('rule 4: one target list, and a scan for a new interactive class', () => {
	it('the pan code reads the shared list', () => {
		const pan = readFileSync(root('src/render/dom/pan-zoom.ts'), 'utf8');
		expect(pan).toMatch(/const TARGETS = \[[^\]]*SCENE_TAP_GROUPS[^\]]*SCENE_TAP_TARGETS/);
	});

	it('every interactive scene class in the style sheets is in the list', () => {
		// The badge disc is a part of the badge group and keeps its own rule.
		const known = new Set(['dynasty-focus-badge-disc', ...[...SCENE_TAP_TARGETS, ...SCENE_TAP_GROUPS].map((s) => s.slice(1))]);
		const dir = root('styles');
		const found = new Map<string, string>();
		for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
			const css = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
			for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
				const body = m[2];
				const interactive = /cursor:\s*pointer/.test(body) || /pointer-events:\s*(all|auto)/.test(body);
				for (const part of m[1].split(',')) {
					const compound = part.trim().split(/[\s>+~]+/).pop() ?? '';
					if (!compound.includes('.dynasty-') || compound.includes('where')) continue;
					if (!interactive && !compound.includes(':hover')) continue;
					for (const c of compound.matchAll(/\.(dynasty-[\w-]+)/g)) found.set(c[1], f);
				}
			}
		}
		// Only shapes of the scene count: the files that style the scene's own parts.
		const sceneFiles = new Set(['02-cards.css', '05-far-couple-tags.css', '07-focus-mode.css', '26-folds.css', '30-roundel-cards.css']);
		const unknown = [...found].filter(([c, f]) => sceneFiles.has(f) && !known.has(c));
		expect(unknown).toEqual([]);
	});
});

describe('rule 5: no code tests the press target against the svg, the scene or the viewport', () => {
	it('the known sites are the whole list', () => {
		const sites: string[] = [];
		for (const d of ['src/render/dom', 'src/obsidian']) {
			for (const f of readdirSync(root(d)).filter((n) => n.endsWith('.ts'))) {
				const text = readFileSync(join(root(d), f), 'utf8');
				text.split('\n').forEach((l, i) => {
					if (/target\s*===?\s*(this\.)?(svg|sceneEl|scene|viewport|canvas)\b/.test(l) || /\.target\)?\s*\.classList\.contains\('dynasty-(svg|scene)'\)/.test(l)) sites.push(`${d}/${f}:${i + 1}`);
				});
			}
		}
		expect(sites).toEqual([]);
	});
});
