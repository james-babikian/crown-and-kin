// 0.2.5 WP-B4 (CONTRACT B.3.11): `makePicture` lays the saved picture out with the card form that the caller gives in `SaveSource.geo`,
// passes `youTab` to the layout, and no longer asks for narrow-card settings. The tree view's own `saveSource()` is WP-C2b's; here the
// source is made by hand, as the tree view will make it.
import { describe, expect, it } from 'vitest';

import type { FamilyGraph } from '../../src/core/derive';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import type { Geometry, Orientation } from '../../src/layout/model';
import { makePicture, type SaveSource } from '../../src/obsidian/save-picture';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom();

const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100, portrait: "[[a.png]]"}',
	'  - {id: c, name: Cedric, house: v, born: 1130, parents: [a], portrait: "[[c.png]]"}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;
const RELATIONS = new Map([['a', { text: 'Father', lower: 'father' }], ['c', { text: 'You', lower: 'you' }]]);

function source(geo: Geometry, orientation: Orientation, o: Partial<SaveSource> = {}): SaveSource {
	return { g, orientation, geo, relationLine: false, fonts: { text: 'serif', ui: 'sans', bold: '700' }, showDates: true, showPortraits: true, sourcePath: 'n.md', note: 'n', me: 'c', ...o };
}
async function svgOf(src: SaveSource): Promise<string> {
	return new TextDecoder().decode((await makePicture(undefined, src, 'svg')).bytes);
}
const heights = (svg: string) => [...svg.matchAll(/<g[^>]*data-item="card:([^"]+)"[^>]*>\s*<rect[^>]*?height="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])] as const);

describe('makePicture follows the card form of the source', () => {
	it('Roundel, plate on: a foot hairline and the word on every card; the crown makes the card 67 px high at 12 px', async () => {
		const svg = await svgOf(source(cardForm(geometryFor(12), 'down'), 'down', { relationLine: true, relations: RELATIONS }));
		expect(svg).toContain('data-item="foot:a"');
		expect(svg).toContain('data-item="foot:c"');
		expect(svg).toMatch(/data-item="relation:c"[^>]*>You</);
		expect(svg).not.toContain('data-item="tab:c"');
		// No picture store: no arms or portrait is embedded, but the rings (missing files) have their room.
		expect(heights(svg).map(([, h]) => h)).toEqual([67, 67]);
	});

	it('Roundel, plate off, `youTab` set: no foot hairline, no word, a tab for the marked person, and the cards are shorter', async () => {
		const svg = await svgOf(source(cardForm(geometryFor(12), 'down'), 'down', { youTab: 'c' }));
		expect(svg).not.toContain('data-item="foot:');
		expect(svg).not.toContain('data-item="relation:');
		expect(svg).toContain('data-item="tab:c"');
		expect(svg).not.toContain('data-item="tab:a"');
		expect(heights(svg).map(([, h]) => h)).toEqual([55, 55]);
	});

	it('a sideways tree with a text card: no picture at all, the hairline on, the tab when it is off, without narrow-card settings', async () => {
		const geo = cardForm(geometryFor(12), 'sideways');
		const on = await svgOf(source(geo, 'sideways', { relationLine: true, relations: RELATIONS }));
		expect(on).toContain('data-item="foot:a"');
		expect(on).not.toMatch(/data-item="(frame|arms|portrait):/);
		expect(on).not.toContain('<circle');
		expect(heights(on).map(([, h]) => h)).toEqual([58, 58]);
		const off = await svgOf(source(geo, 'sideways', { youTab: 'c' }));
		expect(off).toContain('data-item="tab:c"');
		expect(heights(off).map(([, h]) => h)).toEqual([46, 46]);
	});
});

describe('the picture copies of a Roundel tree are made at the size of the medallion and of the arms alone (B.3.3)', () => {
	const exports: string[] = [];
	const store = {
		resolve: (link: string) => ({ ok: true, file: { path: link.replace(/^!?\[\[|\]\]$/g, '') } }),
		exportCopy: async (f: { path: string }, b: { w: number; h: number; fit: string }) => {
			exports.push(`${f.path}|${b.w}|${b.h}|${b.fit}`);
			return 'data:image/png;base64,AAAA';
		},
		alone: <T>(run: () => Promise<T>) => run(),
	};
	const sizes = (path: string) => exports.filter((x) => x.startsWith(`${path}|`)).map((x) => x.split('|').slice(1, 3).map(Number));

	it('a portrait is 2.3 em across (D219: 2 em and the width of the old ring) and the arms are 2 em high in the Roundel', async () => {
		const run = async (geo: Geometry) => {
			exports.length = 0;
			await makePicture(store as never, source(geo, 'down', { relationLine: true, relations: RELATIONS }), 'svg');
			return { portrait: sizes('a.png')[0], arms: sizes('v.png')[0] };
		};
		const scale = (4 * 14) / 12;
		const roundel = await run(cardForm(geometryFor(12), 'down'));
		// 2.3 em at 12 px is 27.6 layout px, 2 em is 24; the copy has `scale` image px for each.
		expect(roundel.portrait[0]).toBeGreaterThanOrEqual(Math.floor(27.6 * scale));
		expect(roundel.portrait[0]).toBeLessThanOrEqual(Math.ceil(27.6 * scale) + 1);
		expect(roundel.arms[1]).toBeGreaterThanOrEqual(Math.floor(24 * scale));
		expect(roundel.arms[0]).toBeGreaterThanOrEqual(Math.floor(20 * scale));
	});

	it('a sideways text card asks for no picture file at all', async () => {
		exports.length = 0;
		await makePicture(store as never, source(cardForm(geometryFor(12), 'sideways'), 'sideways', { relationLine: true, relations: RELATIONS }), 'svg');
		expect(exports).toEqual([]);
	});
});
