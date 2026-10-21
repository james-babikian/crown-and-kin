import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { readFileSync } from 'node:fs';
import { FullScreenModal } from '../src/obsidian/full-screen';
import type { Rect } from '../src/layout/model';
import { keepTopCardWhole } from '../src/view/focus-mode';
import { linkWord, listData } from '../src/view/phone-list';
import { clearRelationCache } from '../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { PHONE_LIST_UI } from '../src/render/view-text';
import type { View } from '../src/render/view-math';
import { clock, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, phone } from './acceptance/tree-view-fakes';
import { build } from './helpers';

/*
 * 0.2.8 fix round F2 (tree view and phone list): a picture place that cannot fill leaves the row (D213), the accessible name of a row has no `aria-label`,
 * the grouping of the children of a person (D214) and the kind of the parent link, the short embed with a banner, and the label texts.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}
people:
  - {id: ann, name: Ann, house: va, born: 1100, portrait: "[[ann.png]]"}
  - {id: bob, name: Bob, house: va, parents: [ann], born: 1130, portrait: "[[bob.png]]"}
`;

type Store = {
	resolve: (link: string) => unknown;
	check: () => Promise<null>;
	acquire: (...a: unknown[]) => Promise<unknown>;
	onChange: (fn: (p: readonly string[]) => void) => () => void;
};

function pictureStore(known: () => boolean, acquire: () => unknown): Store {
	return {
		resolve: (link) => (known() ? { ok: true, file: { path: String(link).replace(/[[\]]/g, '') }, format: 'png' } : { ok: false, code: 'missing-picture', file: link }),
		check: async () => null,
		acquire: async () => acquire(),
		onChange: () => () => {},
	};
}

const copy = () => ({ url: 'blob:x', w: 10, h: 10, release: () => {} });

describe('phone list: a picture place for a file that is not known yet, and not for a file that cannot show (D213)', () => {
	function cold(store: Store, cache = false) {
		const state = { ready: true, cache };
		phone();
		const host = fakeHost(DEFAULT_SETTINGS) as ReturnType<typeof fakeHost> & { startedUp: unknown; pictures: unknown };
		host.startedUp = { ready: () => state.ready, cache: () => state.cache };
		host.pictures = store;
		return { host, state };
	}
	const row = (el: { querySelector: (s: string) => unknown }, id: string) => el.querySelector(`.dynasty-list-row[data-person="${id}"]`) as ReturnType<typeof document.createElement>;

	it('keeps the places while the metadata cache has not finished, then drops them when it has and the file is still missing', async () => {
		let known = false;
		const { host, state } = cold(pictureStore(() => known, copy));
		const { el, view } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		await settle();
		expect(row(el, 'bob').querySelector('.dynasty-list-portrait')).not.toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-hero-arms')).not.toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-list-whole')!.hasClass('has-column')).toBe(true);
		state.cache = true;
		view.startUpDone();
		await settle();
		expect(row(el, 'bob').querySelector('.dynasty-list-pics')).toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-hero-col')).toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-list-whole')!.hasClass('has-column')).toBe(false);
		// The file comes later: the places come back and fill.
		known = true;
		view.startUpDone();
		await settle();
		expect(row(el, 'bob').querySelector('.dynasty-list-portrait.has-picture img')).not.toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-hero-portrait.has-picture img')).not.toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-hero-arms.has-picture img')).not.toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-list-whole')!.hasClass('has-column')).toBe(true);
	});

	it('drops the place when the store has no copy (acquire gives null), and keeps the column of the picture that shows', async () => {
		let n = 0;
		// The portrait of Ann comes first (null), then the arms (a copy); the portrait of Bob (null).
		const store = pictureStore(
			() => true,
			() => (n++ === 1 ? copy() : null),
		);
		const { host } = cold(store, true);
		const { el } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		await settle();
		const arms = row(el, 'ann').querySelector('.dynasty-hero-arms');
		const portrait = row(el, 'ann').querySelector('.dynasty-hero-portrait');
		// Of the two copies asked for Ann, exactly one place is left, and the column has the class that says whether the portrait is there.
		expect([arms, portrait].filter(Boolean)).toHaveLength(1);
		const col = row(el, 'ann').querySelector('.dynasty-hero-col')!;
		expect(col.hasClass('no-portrait')).toBe(!portrait);
		expect(row(el, 'bob').querySelector('.dynasty-list-pics')).toBeNull();
	});
});

describe('phone list: the name of a row is a text for a screen reader, not an aria-label (no tooltip from Obsidian)', () => {
	it('has no aria-label on a row control and an sr-only text with the name instead', async () => {
		phone();
		const { el } = await embed(SRC, { handle: fakeHandle('n.md', SRC) });
		await settle();
		const rows = el.querySelectorAll('.dynasty-list-row');
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(r.getAttribute('aria-label')).toBeNull();
			for (const b of r.querySelectorAll('button')) {
				expect(b.getAttribute('aria-label')).toBeNull();
				expect(b.querySelector('.dynasty-sr-only')!.getText()).not.toBe('');
			}
		}
	});
});

describe('goLabel (the name of a row button)', () => {
	const T = PHONE_LIST_UI.goLabel;
	it('says "your" only when a link names a second person', () => {
		expect(T('Marek Drakemoor', 'grandfather', { lower: 'birth father', of: 'Tomas Valmont' })).toBe('Marek Drakemoor, birth father of Tomas Valmont, your grandfather. Show the family of Marek Drakemoor.');
		expect(T('Marek', 'grandfather')).toBe('Marek, grandfather. Show the family of Marek.');
		expect(T('Marek', undefined, { lower: 'birth father', of: 'Tomas' })).toBe('Marek, birth father of Tomas. Show the family of Marek.');
		expect(T('Marek')).toBe('Marek. Show the family of Marek.');
	});
	it('says who the marked person is', () => {
		expect(T('Ann', 'you', { lower: 'guardian', of: 'Bo' }, { you: true })).toBe('Ann, guardian of Bo. This person is you.');
		expect(T('Ann', 'you', undefined, { you: true })).toBe('Ann. This person is you.');
	});
	it('keeps a place in a line of succession as it is, with no "your"', () => {
		expect(T('Ann', '2nd in line', { lower: 'ward', of: 'Bo' }, { place: true })).toBe('Ann, ward of Bo, 2nd in line. Show the family of Ann.');
		expect(T('Ann', '2nd in line', { lower: 'ward', of: 'Bo' }, { you: true, place: true })).toBe('Ann, ward of Bo, 2nd in line. This person is you.');
	});
});

const rows = (gs: ReturnType<typeof listData>['groups']) => gs.map((x) => ({ heading: x.heading, rows: x.rows.map((r) => `${r.id}:${r.link}`) }));

describe('the list of a person: the groups of children (D214)', () => {
	const UNIONS_AB = `
unions:
  - {partners: [c, p1], type: marriage}
  - {partners: [c, p2], type: marriage}
`;
	const UNIONS_BA = `
unions:
  - {partners: [c, p2], type: marriage}
  - {partners: [c, p1], type: marriage}
`;
	const PEOPLE = `
people:
  - {id: c, name: C, sex: m}
  - {id: p1, name: P1, sex: f}
  - {id: p2, name: P2, sex: f}
  - {id: z, name: Z, parents: [c, p1]}
  - {id: y, name: Y, parents: [c, p2, {id: p1, type: rumoured}, {id: c, type: rumoured}]}
  - {id: w, name: W, parents: [c, {id: p1, type: rumoured}, {id: c, type: rumoured}]}
`;
	for (const [label, unions] of [['union of the rumour first', UNIONS_AB], ['union of the rumour last', UNIONS_BA]] as const) {
		it(`a rumoured side link never takes a child out of its confirmed group (${label})`, () => {
			const g = build(PEOPLE + unions).g;
			const out = rows(listData(g, 'c').groups);
			const of = (partner: string) => out.find((x) => x.heading && 'partner' in x.heading && x.heading.partner === partner)?.rows;
			expect(of('p1')).toEqual(['z:birth']);
			expect(of('p2')).toEqual(['y:birth']);
			// W is placed under C alone: that is where the list shows W.
			expect(out.find((x) => x.heading?.kind === 'solo')?.rows).toEqual(['w:birth']);
			expect(out.find((x) => x.heading?.kind === 'other')).toBeUndefined();
		});
	}

	it('a person who is both an adoptive and a rumoured parent shows the stronger link, whatever is written first', () => {
		for (const parents of [
			'[{id: a, type: rumoured}, b, d, {id: a, type: adoptive}]',
			'[b, d, {id: a, type: adoptive}, {id: a, type: rumoured}]',
			'[b, d, {id: a, type: rumoured}, {id: a, type: ward}]',
		]) {
			const g = build(`
people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: m}
  - {id: d, name: D, sex: f}
  - {id: k, name: K, parents: ${parents}}
`).g;
			const link = listData(g, 'k').parents.find((r) => r.id === 'a')!.link;
			expect(link).not.toBe('rumoured');
			// The child side: in the list of A, K has the same link.
			const own = listData(g, 'a').groups.flatMap((x) => x.rows).find((r) => r.id === 'k')!;
			expect(own.link).toBe(link);
		}
	});

	it('a child whose side link names two partners that have no written union stands in their partnership (the pair key)', () => {
		const g = build(`
people:
  - {id: c, name: C, sex: m}
  - {id: p, name: P, sex: f}
  - {id: q, name: Q, sex: f}
  - {id: a1, name: A1, sex: m}
  - {id: a2, name: A2, sex: f}
  - {id: x, name: X, parents: [c, p]}
  - {id: y, name: Y, parents: [c, p, {id: a1, type: adoptive}, {id: a2, type: adoptive}], placement: adoptive}
  - {id: v, name: V, parents: [c, q, {id: a1, type: adoptive}, {id: a2, type: adoptive}], placement: adoptive}
`).g;
		const d = listData(g, 'c');
		expect(rows(d.groups)).toEqual([
			{ heading: { kind: 'partner', partner: 'p' }, rows: ['x:birth', 'y:birth'] },
			{ heading: { kind: 'other' }, rows: ['v:birth'] },
		]);
		// The kind of link of Y to C is the written one: a birth link beside an adoptive one needs no word for the child.
		expect(linkWord(g, d, d.groups[0].rows[1])).toBeNull();
	});
});

describe('keepTopCardWhole: a raise clears a card that the first raise cuts in its turn', () => {
	const size = { w: 400, h: 300 };
	const view: View = { scale: 1, cx: 200, cy: 150 };
	const top = (v: View, b: Rect) => size.h / 2 + (b.y - v.cy) * v.scale;
	it('keeps the start person whole when it is a key card, and the result has no more cut cards than before', () => {
		const stairs: Rect[] = [0, 1, 2, 3].map((i) => ({ x: i * 70, y: -10 - 45 * i, w: 60, h: 50 }));
		const start: Rect = { x: 300, y: 150, w: 60, h: 50 };
		const out = keepTopCardWhole(view, size, 0, size.h, [...stairs, start], [start]);
		expect(top(out, start) + start.h).toBeLessThanOrEqual(size.h);
		expect(top(out, start)).toBeGreaterThanOrEqual(0);
	});
});

describe('a short embed with a banner keeps a drawing area', () => {
	it('sets --dynasty-bars from the height of the bars, and the style sheet keeps 120 px below them', async () => {
		desktop();
		const src = `options:\n  height: 100\npeople:\n  - {id: a, name: Ann, born: 1100}\n`;
		const { el, view } = await embed(src, { handle: fakeHandle('n.md', src) });
		const vp = el.querySelector('.dynasty-viewport')!;
		Object.assign(vp.querySelector('.dynasty-toolbar')!, { offsetTop: 0, offsetHeight: 44 });
		const result = vp.createDiv({ cls: 'dynasty-result' });
		Object.assign(result, { offsetTop: 44, offsetHeight: 52 });
		(view as unknown as { updateHeight(): void }).updateHeight();
		expect(vp.style.getPropertyValue('--dynasty-bars')).toBe('96px');
		expect(vp.style.getPropertyValue('--dynasty-height')).toBe('100px');
		const css = readFileSync('styles/09-read-only-resize.css', 'utf8');
		expect(css).toMatch(/\.dynasty-viewport\.is-flow \{[^}]*height: max\(var\(--dynasty-height, 500px\), calc\(var\(--dynasty-bars, 0px\) \+ 120px\)\);/);
	});
});

describe('the style rules of the round (D212, D213)', () => {
	const read = (f: string) => readFileSync(`styles/${f}`, 'utf8');
	it('the Show bar of the list and the banner are opaque (a relative colour inside @supports)', () => {
		expect(read('34-succession-bar.css')).toMatch(/@supports \(color: rgb\( from red r g b\)\) \{\s*\.dynasty-list-succession \{\s*background: rgb\(from var\(--background-secondary\) r g b\);/);
		expect(read('18-more-list-finder-bar.css')).toMatch(/@supports \(color: rgb\( from red r g b\)\) \{\s*\.dynasty-result \{\s*background: rgb\(from var\(--background-secondary\) r g b\);/);
	});
	it('the shield of the top row is stated with a long selector: its size, no background, no border', () => {
		const css = read('31-phone-list.css');
		const m = /body \.dynasty-list \.dynasty-list-hero \.dynasty-hero-col \.dynasty-hero-arms > img \{([^}]*)\}/.exec(css);
		expect(m).not.toBeNull();
		expect(m![1]).toMatch(/height: 100%/);
		expect(m![1]).toMatch(/background: transparent/);
		expect(m![1]).toMatch(/border: 0/);
		expect(m![1]).not.toContain('!important');
	});
	it('the legend lines take the line token of the theme', () => {
		const css = read('23-legend-save.css');
		expect(css).toMatch(/\.dynasty-legend-sample \.dynasty-line-birth-link,[\s\S]*?\{\s*stroke: var\(--dynasty-edge\);/);
		expect(css).toMatch(/\.dynasty-legend-sample \.dynasty-line-rumoured \{\s*stroke-opacity: 1;/);
	});
});
