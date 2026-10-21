import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { TFile as VaultFile } from 'obsidian';
import { copyPixels, limitBox } from '../src/core/pictures';
import { largeCopySide } from '../src/obsidian/crop-tool';
import { createPictureStore, type PictureCopy, type PictureIO } from '../src/obsidian/picture-store';
import { VIEWER_UI } from '../src/render/viewer-text';
import { fakeWin, installDom } from './acceptance/fake-dom';
import { pngHead } from './acceptance/m9-support';

/*
 * WP-5 (D256): the copy of the picture viewer in the picture store (a raster copy is never larger than the picture; an SVG fills the box; the old copies are the
 * same as before), the style chunk of the viewer (theme tokens, 44 px, the pull of D220) and the texts of the viewer (the rules for plugin text).
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
const file = (path: string): VaultFile => {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1).toLowerCase()), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
};

function storeOf(w: number, h: number, dpr = 1, bytes?: Uint8Array) {
	const outs: { w: number; h: number }[] = [];
	const io: PictureIO = {
		read: async () => {
			const b = bytes ?? pngHead(w, h);
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		decode: async () => ({ width: w, height: h, source: {} as CanvasImageSource, close() {} }),
		encode: async (_s, _c, out) => {
			outs.push({ ...out });
			return new Blob([new Uint8Array(10)], { type: 'image/png' });
		},
		rgba: async (_s, a, b) => new Uint8ClampedArray(a * b * 4),
		coarse: () => false,
		dpr: () => dpr,
	};
	const app = { metadataCache: { getFirstLinkpathDest: () => null }, vault: {}, fileManager: {}, loadLocalStorage: () => null, saveLocalStorage: () => {} };
	return { store: createPictureStore(app as never, io), outs };
}

const isCopy = (x: unknown): x is PictureCopy => !!x && typeof x === 'object' && 'url' in x;

describe('the copy that never enlarges (D256)', () => {
	it('a small raster picture gives a copy of its own size, not one of 2048 px', async () => {
		const { store, outs } = storeOf(128, 192);
		const c = await store.transient(file('a.png'), { w: 2048, h: 2048, fit: 'meet', noEnlarge: true });
		expect(isCopy(c)).toBe(true);
		expect(outs).toEqual([{ w: 128, h: 192 }]);
	});

	it('a large raster picture gives a copy of 2048 px at most, with its own proportions', async () => {
		const { store, outs } = storeOf(6000, 4000);
		await store.transient(file('a.jpg'), { w: 2048, h: 2048, fit: 'meet', noEnlarge: true });
		expect(outs).toEqual([{ w: 2048, h: 1365 }]);
	});

	it('a wide, short picture is cut down by the long side only', async () => {
		const { store, outs } = storeOf(3000, 500);
		await store.transient(file('a.png'), { w: 2048, h: 2048, fit: 'meet', noEnlarge: true });
		expect(outs).toEqual([{ w: 2048, h: 341 }]);
	});

	it('an SVG has no pixels of its own and fills the box', async () => {
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="192"/>');
		const { store, outs } = storeOf(128, 192, 1, svg);
		await store.transient(file('a.svg'), { w: 2048, h: 2048, fit: 'meet', noEnlarge: true });
		expect(outs).toEqual([{ w: 1365, h: 2048 }]);
	});

	it('the pixel ratio makes the box larger, so the copy keeps the sharpness for the screen', async () => {
		const { store, outs } = storeOf(4000, 6000, 2);
		await store.transient(file('a.png'), { w: 1024, h: 1024, fit: 'meet', noEnlarge: true });
		expect(outs).toEqual([{ w: 1365, h: 2048 }]);
	});

	it('a copy without the flag is as before: it fills the box, also from a small picture (the crop tool and the cards)', async () => {
		const { store, outs } = storeOf(128, 192);
		await store.transient(file('a.png'), { w: 2048, h: 2048, fit: 'meet' });
		expect(outs).toEqual([{ w: 1365, h: 2048 }]);
	});

	it('the size record of a copy without the flag has no new property, and a round copy ignores the flag', async () => {
		expect(copyPixels({ w: 40, h: 40 }, 2)).toEqual({ w: 80, h: 80 });
		expect(copyPixels({ w: 40, h: 40, noEnlarge: true }, 2)).toEqual({ w: 80, h: 80, still: true });
		expect(limitBox({ width: 100, height: 100 }, { w: 80, h: 80, still: true }, 'png')).toEqual([80, 80]);
		expect(limitBox({ width: 50, height: 100 }, { w: 80, h: 80, still: true }, 'PNG')).toEqual([50, 80]);
		expect(limitBox({ width: 50, height: 100 }, { w: 80, h: 80, still: true }, 'svg')).toEqual([80, 80]);
		const { store, outs } = storeOf(400, 600);
		await store.transient(file('a.png'), { w: 40, h: 40, fit: 'portrait', noEnlarge: true });
		expect(outs).toEqual([{ w: 40, h: 40 }]);
	});

	it('the viewer and the crop tool use the same box side: 2048 px divided by the pixel ratio (at most 3)', () => {
		const win = (dpr: unknown) => ({ devicePixelRatio: dpr }) as unknown as Window;
		expect(largeCopySide(win(1))).toBe(2048);
		expect(largeCopySide(win(2))).toBe(1024);
		expect(largeCopySide(win(3))).toBe(682);
		expect(largeCopySide(win(5))).toBe(682);
		expect(largeCopySide(win(undefined))).toBe(2048);
	});
});

describe('the style chunk of the viewer', () => {
	const css = readFileSync(new URL('../styles/38-picture-viewer.css', import.meta.url), 'utf8');
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

	it('writes no colour value: only theme tokens and keywords', () => {
		expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(bare).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
		expect(bare).not.toMatch(/\b(black|white|gray|grey|silver|gainsboro)\b/);
	});

	it('every rule for a button has the .dynasty-sheet prefix, so the theme button style cannot outrank it', () => {
		for (const block of bare.split('}')) {
			const head = block.split('{')[0] ?? '';
			for (const sel of head.split(',')) if (/(^|[\s>+~(])button(?![\w-])/.test(sel)) expect(sel.trim(), sel).toContain('.dynasty-sheet');
		}
	});

	it('gives every button at least 44 px each way, and the ring of the shown small picture is 2 px in the text colour', () => {
		expect(bare).toMatch(/button\.dynasty-viewer-thumb \{[^}]*width: 44px;[^}]*height: 44px;/);
		expect(bare).toMatch(/button\.dynasty-viewer-close \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
		expect(bare).toMatch(/button\.dynasty-viewer-thumb\.is-on \{[^}]*0 0 0 2px var\(--text-normal\)/);
	});

	it('is a large window, 48 px from the edges, on a computer; the stage takes every touch; the zoom is one transform', () => {
		expect(bare).toMatch(/\.dynasty-viewer:not\(\.is-phone\) \{[^}]*height: calc\(100vh - 96px\);[^}]*margin-top: 48px;/);
		expect(bare).toMatch(/\.dynasty-viewer-stage \{[^}]*touch-action: none;/);
		expect(bare).toMatch(/\.dynasty-viewer-img \{[^}]*transform: translate\(-50%, -50%\) translate\(var\(--dynasty-vw-x, 0px\), var\(--dynasty-vw-y, 0px\)\) scale\(var\(--dynasty-vw-s, 1\)\)/);
	});

	it('follows the finger of the swipe down through --dynasty-sheet-pull, and stops all motion with reduced movement', () => {
		expect(bare).toMatch(/\.modal\.dynasty-viewer\.is-pulled \{[^}]*translateY\(var\(--dynasty-sheet-pull, 0px\)\)/);
		expect(bare).toMatch(/\.dynasty-viewer\.dynasty-reduce-motion\.is-settling \{[^}]*transition: none/);
		expect(bare).toMatch(/\.dynasty-viewer\.is-zoomed \.dynasty-viewer-thumbs \{[^}]*visibility: hidden/);
	});

	// D262 (after the iPhone test): the opening circle is gone.
	it('the portrait shows at once: no is-opening class, no clip-path circle and no clip-path transition', () => {
		expect(bare).not.toContain('is-opening');
		expect(bare).not.toMatch(/clip-path: circle/);
		expect(bare).not.toMatch(/transition:[^;]*clip-path/);
		expect(bare).not.toMatch(/\.dynasty-viewer-img \{[^}]*transition/);
	});

	it('is in the table of the style chunks and in the joined style sheet', () => {
		expect(readFileSync(new URL('../styles/README.md', import.meta.url), 'utf8')).toContain('38-picture-viewer.css');
		expect(readFileSync(new URL('../styles.css', import.meta.url), 'utf8')).toContain('.dynasty-viewer-stage');
	});
});

describe('the texts of the viewer', () => {
	const sample = (): string[] =>
		Object.values(VIEWER_UI).flatMap((v) => {
			if (typeof v === 'string') return [v];
			if (typeof v !== 'function') return [];
			const out: string[] = [];
			for (const args of [['Aldric'], [['Duke of Valmont', 'b. 1131']], [['', '1100–1165']]] as unknown[][]) {
				try {
					const t = (v as (...a: unknown[]) => unknown)(...args);
					if (typeof t === 'string') out.push(t);
				} catch {
					/* this argument set does not fit */
				}
			}
			return out;
		});

	it('has the words of the brief', () => {
		expect(VIEWER_UI.viewPortrait).toBe('View portrait');
		expect(VIEWER_UI.viewArms).toBe('View arms');
		expect(VIEWER_UI.close).toBe('Close');
		expect(VIEWER_UI.showPortrait).toBe('Show the portrait');
		expect(VIEWER_UI.showArms).toBe('Show the arms');
		expect(VIEWER_UI.problem).toBe('The plugin cannot show this picture. Close the window and try again.');
		expect(VIEWER_UI.portraitOf('Roderick Valmont')).toBe('Portrait of Roderick Valmont');
		expect(VIEWER_UI.armsOf('House Valmont')).toBe('Arms of House Valmont');
		expect(VIEWER_UI.portraitLine(['Duke of Valmont', 'b. 1131'])).toBe('Portrait · Duke of Valmont · b. 1131');
		expect(VIEWER_UI.portraitLine(['', '1100–1165'])).toBe('Portrait · 1100–1165');
		expect(VIEWER_UI.portraitLine(['', ''])).toBe('Portrait');
	});

	it('obeys the rules for plugin text: sentences of 20 words or fewer, no -ing word, no contraction, none of the words the owner forbids', () => {
		const all = sample();
		expect(all.length).toBeGreaterThan(12);
		const banned = /\b(graph|diagram|chart|node|box|tile|union|edge|path|stroke|layer|rank|partition|file|document|commit|fixture|sprint|phase)\b/i;
		for (const t of all) {
			for (const sentence of t.split(/(?<=[.!?])\s+(?=[A-Z])/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
			expect(t, t).not.toMatch(/\b[A-Za-z]{3,}ing\b/);
			expect(t, t).not.toMatch(/\b(don't|can't|isn't|doesn't|won't|it's)\b/i);
			expect(t, t).not.toMatch(banned);
		}
	});
});
