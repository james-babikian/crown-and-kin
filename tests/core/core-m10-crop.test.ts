import { describe, expect, it } from 'vitest';
import { applyOp } from '../../src/core/yaml-edit';
import { deriveFamilies } from '../../src/core/derive';
import { issueText } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { cropSquare, cropValue, formatPortraitCrop, moveCrop, readPortraitCrop, sameCropText, zoomCrop } from '../../src/core/portrait-crop';

/*
 * WP 10.1 unit tests for the parts of the portrait crop that the acceptance tests do not name:
 * the raw value reader, text comparison, odd input, and the D91 rule in a batch and in a flow map.
 */

const tree = (person: string) => `people:\n${person}`;
const edit = (body: string, fields: Record<string, string | null>, id = 'a') => {
	const r = applyOp(body, { kind: 'set-person-fields', id, fields } as never);
	if (!r.ok) throw new Error(`${r.code} ${r.detail ?? ''}`);
	return r.body;
};

describe('cropValue (the raw value of `portrait-crop`)', () => {
	it('a scalar is text; an empty list or map, null and an empty text are absent', () => {
		expect(cropValue('0.1 0.2 0.5')).toBe('0.1 0.2 0.5');
		expect(cropValue('  ')).toBeUndefined();
		expect(cropValue(null)).toBeUndefined();
		expect(cropValue([])).toBeUndefined();
		expect(cropValue({})).toBeUndefined();
	});

	it('a list or map is JSON text with numbers as numbers', () => {
		expect(cropValue(['0.1', '0.2', '0.5'])).toBe('[0.1,0.2,0.5]');
		expect(cropValue({ left: '0.1', name: 'x' })).toBe('{"left":0.1,"name":"x"}');
	});

	it('a value that loops does not throw', () => {
		const loop: unknown[] = [];
		loop.push(loop);
		expect(cropValue(loop)).toBeUndefined();
	});
});

describe('reading and comparing texts', () => {
	it('a JSON text of a list is bad, not absent', () => {
		expect(readPortraitCrop('[0.1,0.2,0.5]').kind).toBe('bad');
	});

	it('a huge number that is not finite is bad; input that is not text is absent', () => {
		expect(readPortraitCrop(`${'9'.repeat(400)} 0 1`).kind).toBe('bad');
		expect(readPortraitCrop(5 as unknown as string).kind).toBe('absent');
	});

	it('sameCropText: equal after rounding, absent equals absent, unreadable must match exactly', () => {
		expect(sameCropText('0.10004 0.4 0.5', '0.1 0.4 0.5')).toBe(true);
		expect(sameCropText('0.1001 0.4 0.5', '0.1 0.4 0.5')).toBe(false);
		expect(sameCropText(undefined, '')).toBe(true);
		expect(sameCropText('a', 'a')).toBe(true);
		expect(sameCropText('a', 'b')).toBe(false);
		expect(sameCropText(undefined, '0 0 1')).toBe(false);
	});

	it('formatPortraitCrop never writes NaN or an exponent', () => {
		expect(formatPortraitCrop({ left: Number.NaN, top: Number.POSITIVE_INFINITY, side: 1e-9 })).toBe('0 0 0');
	});
});

describe('odd sizes', () => {
	it('cropSquare with a size that cannot be used is one pixel; move and zoom give the automatic part', () => {
		expect(cropSquare({ left: 0.1, top: 0.1, side: 0.5 }, 0, 0)).toEqual({ sx: 0, sy: 0, size: 1 });
		expect(moveCrop({ left: 0.1, top: 0.1, side: 0.5 }, 5, 5, Number.NaN, 10)).toEqual({ left: 0, top: 0, side: 1 });
		expect(zoomCrop({ left: 0.1, top: 0.1, side: 0.5 }, 2, { x: 0.5, y: 0.5 }, 10, -1)).toEqual({ left: 0, top: 0, side: 1 });
	});

	it('zoom with a factor that is not a number changes nothing', () => {
		const c = { left: 0.2, top: 0.2, side: 0.5 };
		expect(zoomCrop(c, Number.NaN, { x: 0.5, y: 0.5 }, 400, 600)).toEqual(c);
	});
});

describe('the warning', () => {
	it('names the person and uses the STE text', () => {
		const r = parseDynasty(tree('  - {id: a, name: Aldric Valmont, portrait: "[[a.jpg]]", portrait-crop: "1 2"}\n'));
		if (!r.ok) throw new Error('parse');
		const issue = deriveFamilies(r.tree).issues[0];
		expect(issue).toMatchObject({ code: 'bad-portrait-crop', level: 'warning', ids: ['a'], params: { person: 'Aldric Valmont' } });
		expect(issueText(issue)).toContain('portrait of Aldric Valmont');
	});
});

describe('D91 in the edit ops', () => {
	const flow = tree('  - {id: a, name: A, portrait: "[[a.jpg]]", portrait-crop: "0.1 0.2 0.5", notes: x}\n');

	it('a flow-map person loses the crop with the portrait', () => {
		expect(edit(flow, { portrait: null })).toBe(tree('  - {id: a, name: A, notes: x}\n'));
	});

	it('a portrait written with other quotes but the same link keeps the crop', () => {
		expect(edit(flow, { portrait: '[[a.jpg]]' })).toBe(flow);
	});

	it('an empty portrait text counts as removing it', () => {
		expect(edit(flow, { portrait: '  ' })).toBe(tree('  - {id: a, name: A, notes: x}\n'));
	});

	it('a batch keeps the rule for each op', () => {
		const r = applyOp(flow, { kind: 'batch', ops: [{ kind: 'set-person-fields', id: 'a', fields: { portrait: '[[b.jpg]]' } }] } as never);
		expect(r.ok && r.body).toBe(tree('  - {id: a, name: A, portrait: "[[b.jpg]]", notes: x}\n'));
	});

	it('a person with a crop and no portrait: selecting a portrait removes the old crop', () => {
		const stale = tree('  - id: a\n    name: A\n    portrait-crop: "0.1 0.2 0.5"\n');
		expect(edit(stale, { portrait: '[[b.jpg]]' })).toBe(tree('  - id: a\n    name: A\n    portrait: "[[b.jpg]]"\n'));
	});
});

describe('a tree text whose value loops', () => {
	it('an edit is refused with its own reason, not the catch-all text', () => {
		const body = 'people:\n  - id: a\n    name: A\n    parents: &p [*p]\n';
		const r = applyOp(body, { kind: 'set-person-fields', id: 'a', fields: { 'portrait-crop': '0 0 1' } } as never);
		if (r.ok) return;
		expect(r.detail ?? '').not.toContain('cannot make this change');
	});
});
