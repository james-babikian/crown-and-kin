import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import { geometryFor, nameCountOf, tallExtra } from '../src/layout/geometry';
import type { LayoutSettings } from '../src/layout/model';
import { nameLines } from '../src/render/name-lines';
import { graphOf } from './acceptance/m10-support';

/*
 * WP 10.2a (spec §13.9, D81): extra checks for the third name text line that the acceptance file
 * does not make: the gap under a three-line card, `longNames` alone, and the box-to-count helper.
 */

const GEO = geometryFor(16);
const source = ['people:', ...['a', 'b', 'c'].flatMap((id) => [`  - id: ${id}`, `    name: Person ${id}`, ...(id === 'a' ? [] : [`    parents: [${id === 'b' ? 'a' : 'b'}]`])]), ''].join('\n');
const graph = () => graphOf(source);

describe('three-line cards in the layout', () => {
	it('the gap below a row starts under its three-line card', () => {
		clearLayoutCache();
		const laid = layoutTree(graph(), GEO, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: ['b'], longNames: ['b'] } as LayoutSettings, 'font');
		const b = laid.layout.persons.get('b')!;
		expect(b.h).toBe(GEO.cardH + 2 * tallExtra(GEO));
		const row = laid.layout.rows.findIndex((r) => r.includes('b'));
		expect(laid.layout.rowGaps[row].top).toBeCloseTo(b.y + b.h, 6);
		expect(laid.layout.persons.get('c')!.y).toBeGreaterThan(b.y + b.h);
	});

	it('a person in longNames is tall even when tallCards does not list them', () => {
		clearLayoutCache();
		const laid = layoutTree(graph(), GEO, { ...DEFAULT_LAYOUT_SETTINGS, longNames: ['b'] } as LayoutSettings, 'font');
		const b = laid.layout.persons.get('b')!;
		expect(b.tallName).toBe(true);
		expect(b.h).toBe(GEO.cardH + 2 * tallExtra(GEO));
	});
});

describe('name text line helpers', () => {
	it('nameCountOf maps the box flags to 1, 2 or 3', () => {
		expect(nameCountOf({})).toBe(1);
		expect(nameCountOf({ tallName: true })).toBe(2);
		expect(nameCountOf({ tallName: true, longName: true })).toBe(3);
	});

	it('an empty name is one empty text line', () => {
		expect(nameLines('   ', 100, (s) => s.length * 10)).toEqual(['']);
	});
});
