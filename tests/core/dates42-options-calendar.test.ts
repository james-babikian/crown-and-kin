// Step 4.2 of WP-4 (the architecture notes §5.7): the option `calendar` (the link to the calendar note of a tree, spec §14 rule 7) end to end in the core:
// the reader, the curly pair, `set-option`, the write order, and both sides of link maintenance (`linkTargets` and `rewrite-links`).
import { describe, expect, it } from 'vitest';
import { linkTargets } from '../../src/core/link-rewrite';
import { parseBody, parseDynasty } from '../../src/core/parse';
import { OPTION_ORDER } from '../../src/core/yaml-patch';
import { applyOp } from '../../src/core/yaml-edit';

const PEOPLE = 'people:\n  - id: a\n    name: A\n';
const optionOf = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree.options;
};
const set = (src: string, value: string | null) => {
	const r = applyOp(src, { kind: 'set-option', key: 'calendar', value });
	if (!r.ok) throw new Error(`${r.code}: ${r.detail ?? ''}`);
	return r.body;
};

describe('options.calendar: reading', () => {
	it('is the link as written, whatever the form', () => {
		expect(optionOf(`options:\n  calendar: "[[Calendars of the Far Land]]"\n${PEOPLE}`).calendar).toBe('[[Calendars of the Far Land]]');
		expect(optionOf(`options:\n  calendar: [[Calendars]]\n${PEOPLE}`).calendar).toBe('[[Calendars]]');
		expect(optionOf(`options:\n  calendar: Calendars\n${PEOPLE}`).calendar).toBe('Calendars');
		expect(optionOf(`options:\n  calendar: "[Far Land](Far%20Land.md)"\n${PEOPLE}`).calendar).toBe('[Far Land](Far%20Land.md)');
	});

	it('loses one pair of curly quote marks (D103), like the other references', () => {
		expect(optionOf(`options:\n  calendar: “[[Calendars]]”\n${PEOPLE}`).calendar).toBe('[[Calendars]]');
	});

	it('is absent when it is not written, and a tree without it reads as before (no key in the options)', () => {
		expect(optionOf(PEOPLE)).toEqual({});
		expect('calendar' in optionOf(`options:\n  start: a\n${PEOPLE}`)).toBe(false);
		expect(optionOf(`options:\n  calendar:\n${PEOPLE}`).calendar).toBeUndefined();
	});
});

describe('options.calendar: set-option', () => {
	it('writes the link in double quotes, so [[ ]] reads back as text', () => {
		const body = set(PEOPLE, '[[Calendars of the Far Land]]');
		expect(body).toBe(`options:\n  calendar: "[[Calendars of the Far Land]]"\n\n${PEOPLE}`);
		expect(optionOf(body).calendar).toBe('[[Calendars of the Far Land]]');
	});

	it('goes after the other options (OPTION_ORDER) and keeps their comments', () => {
		expect(OPTION_ORDER.slice(-1)).toEqual(['calendar']);
		const src = `options:\n  start: a # the start\n  height: 400\n${PEOPLE}`;
		expect(set(src, '[[Calendars]]').startsWith('options:\n  start: a # the start\n  height: 400\n  calendar: "[[Calendars]]"\n')).toBe(true);
	});

	it('changes the link in place and removes the key with null (the last key takes `options` with it)', () => {
		const src = `options:\n  calendar: "[[Old]]" # which calendar\n${PEOPLE}`;
		expect(set(src, '[[New]]')).toBe(`options:\n  calendar: "[[New]]" # which calendar\n${PEOPLE}`);
		expect(set(src, null)).toBe(PEOPLE);
		expect(set(`options:\n  me: a\n  calendar: x\n${PEOPLE}`, null)).toBe(`options:\n  me: a\n${PEOPLE}`);
	});

	it('writes nothing when the link is the one written, and is a no-op without the key', () => {
		const src = `options:\n  calendar: "[[Calendars]]"\n${PEOPLE}`;
		expect(set(src, '[[Calendars]]')).toBe(src);
		expect(set(PEOPLE, null)).toBe(PEOPLE);
	});
});

describe('options.calendar: link maintenance (spec §6.9)', () => {
	const src = (link: string) => `options:\n  start: a\n  calendar: ${link}\n${PEOPLE}  - {id: b, name: B, link: "[[B note]]"}\n`;

	it('linkTargets lists the calendar link in text order, in every written form', () => {
		expect(linkTargets(src('"[[Far Land/Calendars|the calendars]]"'))).toEqual(['Far Land/Calendars', 'B note']);
		expect(linkTargets(src('[[Calendars]]'))).toEqual(['Calendars', 'B note']);
		expect(linkTargets(src('"[Cal](Calendars.md)"'))).toEqual(['Calendars.md', 'B note']);
		expect(linkTargets(src('Calendars'))).toEqual(['Calendars', 'B note']);
		expect(linkTargets(`options:\n  start: a\n${PEOPLE}`)).toEqual([]);
	});

	it('rewrite-links changes the calendar link and counts it', () => {
		const r = applyOp(src('"[[Calendars]]"'), { kind: 'rewrite-links', map: { calendars: 'Moved/Calendars' } });
		expect(r).toMatchObject({ ok: true, changed: 1 });
		if (r.ok) expect(r.body).toBe(src('"[[Moved/Calendars]]"'));
	});

	it('keeps the alias, the heading, the style and the comments, and rewrites the link of a person in the same write', () => {
		const text = `options:\n  calendar: "[[Calendars#Eras|eras]]" # note\n${PEOPLE}  - {id: b, name: B, link: "[[Calendars]]"}\n`;
		const r = applyOp(text, { kind: 'rewrite-links', map: { calendars: 'Calendars of the Far Land' } });
		expect(r).toMatchObject({ ok: true, changed: 2 });
		if (r.ok) expect(r.body).toBe(`options:\n  calendar: "[[Calendars of the Far Land#Eras|eras]]" # note\n${PEOPLE}  - {id: b, name: B, link: "[[Calendars of the Far Land]]"}\n`);
	});

	it('writes the unquoted nested form back in the nested form, and a Markdown link with its extension', () => {
		const nested = applyOp(`options:\n  calendar: [[Calendars]]\n${PEOPLE}`, { kind: 'rewrite-links', map: { calendars: 'Other' } });
		if (!nested.ok) throw new Error('refused');
		expect(nested.body).toContain('calendar: [[Other]]');
		expect(optionOf(nested.body).calendar).toBe('[[Other]]');
		const md = applyOp(src('"[Cal](Calendars.md)"'), { kind: 'rewrite-links', map: { 'calendars.md': 'My Calendars.md' } });
		if (!md.ok) throw new Error('refused');
		expect(md.body).toContain('calendar: "[Cal](My%20Calendars.md)"');
	});

	it('a link that does not move changes nothing', () => {
		const text = src('"[[Calendars]]"');
		expect(applyOp(text, { kind: 'rewrite-links', map: { other: 'Else' } })).toMatchObject({ ok: true, body: text, changed: 0 });
	});

	it('the body still reads after the rewrite (the data check passes)', () => {
		const r = applyOp(src('"[[Calendars]]"'), { kind: 'rewrite-links', map: { calendars: 'X' } });
		if (!r.ok) throw new Error('refused');
		expect(parseBody(r.body).ok).toBe(true);
	});
});
