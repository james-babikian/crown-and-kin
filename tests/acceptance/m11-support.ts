/*
 * Shared helpers for the M11 tests (spec §13.14 picture list, §13.15 speed). The modules that the builders add
 * (`core/picture-list.ts`, `core/parse-cache.ts`) are loaded by a variable path, so the test files still
 * compile before work packages 11.1 to 11.4 exist: a missing module or export fails the test that needs it,
 * with a message that names the work package. No expected value is computed by code of `src/`.
 */
import { createHash } from 'node:crypto';
import { deriveFamilies } from '../../src/core/derive';
import type * as PictureList from '../../src/core/picture-list';
import type { PictureFileLike } from '../../src/core/picture-list';
import type { createParseCache } from '../../src/core/parse-cache';
import { parseDynasty } from '../../src/core/parse';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { DEFAULT_DARK } from '../../src/render/styles';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { FEl, dispatch as fakeDispatch } from './fake-dom';
import { allFixtures } from './load';

// ---------- Loading modules that do not exist yet ----------

async function load<T>(path: string, file: string, wp: string, names: readonly string[]): Promise<T> {
	let mod: Record<string, unknown>;
	try {
		mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
	} catch (e) {
		throw new Error(`${file} does not exist yet (${wp}): ${String(e)}`);
	}
	for (const name of names) {
		if (mod[name] === undefined) throw new Error(`${file} does not export ${name} yet (${wp})`);
	}
	return mod as T;
}

/** `src/core/picture-list.ts` (work package 11.1). */
export interface PictureListModule {
	buildPictureTree: typeof PictureList.buildPictureTree;
	comparePictureNames: typeof PictureList.comparePictureNames;
	openSetFor: typeof PictureList.openSetFor;
	pickerRows: typeof PictureList.pickerRows;
	searchRows: typeof PictureList.searchRows;
	rowKey: typeof PictureList.rowKey;
	pickerKey: typeof PictureList.pickerKey;
	pickerTap: typeof PictureList.pickerTap;
	pickerSwitch: typeof PictureList.pickerSwitch;
	toggleFolder: typeof PictureList.toggleFolder;
	previewNear: typeof PictureList.previewNear;
	previewOrder: typeof PictureList.previewOrder;
}
const LIST_NAMES = ['buildPictureTree', 'comparePictureNames', 'openSetFor', 'pickerRows', 'searchRows', 'rowKey', 'pickerKey', 'pickerTap', 'pickerSwitch', 'toggleFolder', 'previewNear', 'previewOrder'] as const;
export const pictureListModule = () => load<PictureListModule>('../../src/core/picture-list', 'src/core/picture-list.ts', 'WP 11.1', LIST_NAMES);

/** `src/core/parse-cache.ts` (work package 11.1). */
export const parseCacheModule = () => load<{ createParseCache: typeof createParseCache }>('../../src/core/parse-cache', 'src/core/parse-cache.ts', 'WP 11.1', ['createParseCache']);

/** `boxNearView` of `src/render/view-math.ts` (work package 11.2). */
export const boxNearViewOf = async () =>
	(await load<{ boxNearView: (box: Rect, view: Rect) => boolean }>('../../src/render/view-math', 'src/render/view-math.ts', 'WP 11.2', ['boxNearView'])).boxNearView;

/** `visibleRect` of `src/render/dom/pan-zoom.ts` (work package 11.2). */
export const visibleRectOf = async () =>
	(await load<{ visibleRect: (view: { scale: number; cx: number; cy: number }, size: { w: number; h: number }) => Rect | null }>('../../src/render/dom/pan-zoom', 'src/render/dom/pan-zoom.ts', 'WP 11.2', ['visibleRect'])).visibleRect;

/** `PICKER_UI` of `src/render/ui-text.ts` (work package 11.3). */
export const pickerUiOf = async () =>
	(await load<{ PICKER_UI: Record<string, unknown> }>('../../src/render/ui-text', 'src/render/ui-text.ts', 'WP 11.3', ['PICKER_UI'])).PICKER_UI;

/** The picker module with its M11 exports (work package 11.3). */
export const pickerModule = () =>
	load<Record<string, unknown>>('../../src/obsidian/picture-picker', 'src/obsidian/picture-picker.ts', 'WP 11.3', ['pickPicture', 'createRowPreviews', 'currentPictureOf', 'isTouchFirst']);

/** A rectangle in layout px. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

// ---------- Vault files and pictures ----------

export const SHOWN_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] as const;
/** The test "the plugin can show this file" (spec §13.0 item 3), written here by hand. */
export const isShown = (f: PictureFileLike): boolean => (SHOWN_EXTENSIONS as readonly string[]).includes(f.extension);

/** A vault file with the fields the model needs. */
export function vf(path: string): PictureFileLike {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return { path, name, extension: dot < 0 ? '' : name.slice(dot + 1).toLowerCase() };
}

// ---------- A small serialiser for the fake DOM (byte for byte compares) ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The element and its content as text: tag, classes, attributes and styles in stored order, text, children. */
export function serial(el: FEl): string {
	const attrs = [...el.attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
	const cls = el.classes.size ? ` class="${[...el.classes].join(' ')}"` : '';
	const style = el.styleProps.size ? ` style="${[...el.styleProps].map(([k, v]) => `${k}:${v}`).join(';')}"` : '';
	return `<${el.tag}${cls}${attrs}${style}>${esc(el.text)}${el.children.map(serial).join('')}</${el.tag}>`;
}

// ---------- The headless picture hashes (spike 1 to 15 byte-identical, spec §13.15) ----------

const GEO = geometryFor(16, 'normal');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };

/**
 * The sha256 of the headless picture (light and dark) of a sample tree; 'error' when the block does not
 * parse. The values in `m11-spike-hashes.json` were recorded from the head of `milestone-11` before the build.
 */
export function svgHash(source: string): string {
	const parsed = parseDynasty(source);
	if (!parsed.ok) return 'error';
	const g = deriveFamilies(parsed.tree);
	clearLayoutCache();
	const laid = layoutTree(g, GEO, DEFAULT_LAYOUT_SETTINGS, 'font');
	const opts = { measure: approxMeasure, fonts: FONTS };
	const light = renderSvg(g, laid.layout, laid.edges, opts);
	const dark = renderSvg(g, laid.layout, laid.edges, { ...opts, palette: DEFAULT_DARK });
	return createHash('sha256').update(light).update('\0').update(dark).digest('hex');
}

/** Every sample tree by id ('01' to '15', '07b'). */
export const sampleSources = (): { id: string; source: string }[] => allFixtures().map((f) => ({ id: f.id, source: f.source }));

// ---------- A small reader of a style sheet ----------

/** One rule of a style sheet: its selectors (blanks made single) and its declarations. */
export interface CssRule {
	selectors: string[];
	body: string;
	at: number;
}

/** The rules of a style sheet by text scanning (the plugin's sheet has no nesting except `@media`). */
export function cssRules(css: string): CssRule[] {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const out: CssRule[] = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const sel = m[1].trim();
		if (!sel || sel.startsWith('@')) continue;
		out.push({ selectors: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: m[2], at: m.index });
	}
	return out;
}

// ---------- Finding a picture row in the picker (D92: folders are closed unless they hold the current picture) ----------

/**
 * The row of the picture at `path` in an open picker: it opens the folders that hold it first (a tap on each
 * closed folder row, found by its label "Open the folder PATH"), then finds the picture row by its file name. The
 * rows are found by their ARIA roles, which the contract fixes (V5), not by a class name.
 */
export function pickerRowFor(contentEl: FEl, path: string): FEl {
	const rows = () => contentEl.querySelectorAll('[role="treeitem"], [role="option"]');
	const name = path.slice(path.lastIndexOf('/') + 1);
	const parts = path.split('/').slice(0, -1);
	for (let i = 1; i <= parts.length; i++) {
		const folder = parts.slice(0, i).join('/');
		const closed = rows().find((r) => r.getAttribute('aria-label') === `Open the folder ${folder}`);
		if (closed) fakeDispatch(closed, 'click');
	}
	const row = rows().find((r) => !r.attrs.has('aria-expanded') && (r.querySelector('.dynasty-picture-name')?.getText() ?? r.getText()) === name);
	if (!row) throw new Error(`the picker has no row for ${path}`);
	return row;
}
