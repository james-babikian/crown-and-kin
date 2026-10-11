import { describe, expect, it } from 'vitest';
import { DEFAULT_RELATION_OPTIONS, relationsKey, type Relation, type RelationMaybe } from '../src/core/relations';
import { clearRelationCache, relationStats, relationsFor } from '../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS, normaliseSettings, settingsChanges } from '../src/obsidian/settings';
import { MAYBE_TEXT, cardRelationText, relationSummary, spokenRelation } from '../src/render/tree-info';
import { SETTINGS_UI } from '../src/render/ui-text';
import { build } from './helpers';

// D174 (spec §9, §13.1): the setting "Assume an unknown second parent" and the texts of a "maybe". The relations here are made by hand,
// so these tests do not depend on the half and full rule of the core. All names are made up.

const rel = (text: string, maybe?: Omit<RelationMaybe, 'text'>): Relation => ({
	text,
	lower: text.toLowerCase(),
	kind: 'blood',
	distance: 2,
	line: { people: [], links: [], unions: [] },
	...(maybe ? { maybe: { ...maybe, text: maybe.lower[0].toUpperCase() + maybe.lower.slice(1) } } : {}),
});

describe('D174: the setting', () => {
	it('is on by default; a stored boolean stays; any other value gives the default', () => {
		expect(DEFAULT_SETTINGS.oneParentUnknown).toBe(true);
		expect(normaliseSettings({}).oneParentUnknown).toBe(true);
		expect(normaliseSettings({ oneParentUnknown: false }).oneParentUnknown).toBe(false);
		expect(normaliseSettings({ oneParentUnknown: true }).oneParentUnknown).toBe(true);
		for (const bad of ['no', 0, 1, null, [], {}]) expect(normaliseSettings({ oneParentUnknown: bad }).oneParentUnknown).toBe(true);
	});

	it('a change shows in settingsChanges', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, oneParentUnknown: false })).toEqual(['oneParentUnknown']);
	});

	it('the name and the description are the spec §9 texts', () => {
		expect(SETTINGS_UI.oneParentUnknown).toBe('Assume an unknown second parent');
		expect(SETTINGS_UI.oneParentUnknownDesc).toBe(
			'If this setting is on, a person with one listed parent has a second parent who is not known. Two people with the same listed parent show as half-siblings. If this setting is off, two people who list only the same parent show as full siblings. If a person lists fewer than two other parents, a rumoured parent shows that a parent is not known.',
		);
	});

	it('the description has no sentence longer than 20 words and no contraction', () => {
		for (const s of SETTINGS_UI.oneParentUnknownDesc.split(/(?<=\.)\s+/)) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
		expect(SETTINGS_UI.oneParentUnknownDesc).not.toMatch(/n't|'s\b/);
	});
});

describe('D174: the card text, the screen-reader words and the sheet paragraph', () => {
	const fullRumoured = rel('Half-sister', { effect: 'full', lower: 'sister', cause: 'rumoured' });
	const fullUnlisted = rel('Half-sister', { effect: 'full', lower: 'sister', cause: 'unlisted' });
	const halfRumoured = rel('Sister', { effect: 'half', lower: 'half-sister', cause: 'rumoured' });
	const plain = rel('Half-sister');

	it('the card: ", maybe full" for the effect full, ", maybe half" for the effect half (rule 4), nothing with no maybe', () => {
		expect(cardRelationText(fullRumoured)).toBe('Half-sister, maybe full');
		expect(cardRelationText(fullUnlisted)).toBe('Half-sister, maybe full');
		expect(cardRelationText(halfRumoured)).toBe('Sister, maybe half');
		expect(cardRelationText(plain)).toBe('Half-sister');
		expect(MAYBE_TEXT.cardHalf).toBe(', maybe half');
	});

	it('the screen-reader words follow the cause', () => {
		expect(spokenRelation(fullRumoured)).toBe('half-sister, or sister if the rumoured links are true');
		expect(spokenRelation(fullUnlisted)).toBe('half-sister, or sister if the parent that the note does not name is the same person for both');
		expect(spokenRelation(rel('Half-sister', { effect: 'full', lower: 'sister', cause: 'unlisted', unlistedForm: 'other-parent' }))).toBe('half-sister, or sister if this person’s other parent is also your parent');
		expect(spokenRelation(halfRumoured)).toBe('sister, or half-sister if the rumoured links are true');
		expect(spokenRelation(plain)).toBe('half-sister');
	});

	it('the sheet paragraph follows the cause of the first relation', () => {
		expect(relationSummary([fullRumoured], false).maybe).toBe('If every rumoured link is true, this person is your sister.');
		expect(relationSummary([fullUnlisted], false).maybe).toBe('If the parent that the note does not name is the same person for both, this person is your sister.');
		expect(relationSummary([rel('Half-sister', { effect: 'full', lower: 'sister', cause: 'unlisted', unlistedForm: 'other-parent' })], false).maybe).toBe('If this person’s other parent is also your parent, this person is your sister.');
		expect(relationSummary([halfRumoured], false).maybe).toBe('If every rumoured link is true, this person is your half-sister.');
		expect(relationSummary([plain], false).maybe).toBeUndefined();
		expect(relationSummary([plain, fullUnlisted], false).maybe).toBeUndefined();
		expect(relationSummary([fullUnlisted], true).maybe).toBeUndefined();
	});
});

describe('D174: the relation cache keeps the names of each setting apart', () => {
	const g = build(['options:', '  me: helen', 'people:', '  - {id: mary, name: Mary, sex: f}', '  - {id: helen, name: Helen, sex: f, parents: [mary]}', '  - {id: ingrid, name: Ingrid, sex: f, parents: [mary]}', ''].join('\n')).g;

	it('the key has the setting in it; no options means the defaults (on)', () => {
		expect(relationsKey(g, 'helen', { oneParentUnknown: true })).not.toBe(relationsKey(g, 'helen', { oneParentUnknown: false }));
		expect(relationsKey(g, 'helen')).toBe(relationsKey(g, 'helen', DEFAULT_RELATION_OPTIONS));
	});

	it('a change of the setting gives a new key and computes again; each setting then comes from the cache', () => {
		clearRelationCache();
		const before = relationStats.computed;
		const on = relationsFor(g, 'helen', { oneParentUnknown: true });
		const off = relationsFor(g, 'helen', { oneParentUnknown: false });
		expect(relationStats.computed - before).toBe(2);
		expect(off).not.toBe(on);
		expect(relationsFor(g, 'helen', { oneParentUnknown: true })).toBe(on);
		expect(relationsFor(g, 'helen', { oneParentUnknown: false })).toBe(off);
		// An equal object, not the same object, gives the same entry.
		expect(relationsFor(g, 'helen', { ...DEFAULT_RELATION_OPTIONS })).toBe(on);
		expect(relationsFor(g, 'helen')).toBe(on);
		expect(relationStats.computed - before).toBe(2);
		clearRelationCache();
	});
});
