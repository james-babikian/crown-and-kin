import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { familyOf } from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import { fillPartnerList } from '../../src/obsidian/tag-partner-list';
import { partnerLinkDetail } from '../../src/obsidian/union-edit';
import { isolateName } from '../../src/render/name-bidi';
import { tagPartnerKind } from '../../src/render/tag-partner-kind';
import { FEl } from '../acceptance/fake-dom';
import { allFixtures } from '../acceptance/load';
import { useFakeDom } from '../support/fake-dom-setup';

// D355: under each name of the partner list of a several-partner tag stands the kind of the partnership, in the words of the person window.

useFakeDom();

const person = (n: string, extra = '') => `  - {id: ${n}, name: ${n.toUpperCase()}${extra}}\n`;
const u = (p: string, t?: string) => `  - partners: [a, ${p}]\n${t ? `    type: ${t}\n` : ''}`;
const tree = (unions: string) => `people:\n${person('a')}${person('b')}${person('c')}${person('d')}unions:\n${unions}`;

function graph(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

function list(shown: FamilyGraph, whole: FamilyGraph, ids: string[]): FEl {
	const el = new FEl('div');
	fillPartnerList(el as unknown as HTMLElement, shown, whole, 'a', ids, () => undefined);
	return el;
}

/** The rows of the list of a: [name, kind]. */
function rows(g: FamilyGraph, ids: string[]): string[][] {
	return list(g, g, ids).children.map((b) => b.children.map((c) => c.textContent));
}

describe('D355 the kind under each name', () => {
	it('two marriages, B and C', () => {
		expect(rows(graph(tree(u('b', 'marriage') + u('c', 'marriage'))), ['b', 'c'])).toEqual([['B', 'Marriage'], ['C', 'Marriage']]);
	});
	it('marriage B, affair C', () => {
		expect(rows(graph(tree(u('b', 'marriage') + u('c', 'affair'))), ['b', 'c'])).toEqual([['B', 'Marriage'], ['C', 'Affair']]);
	});
	it('betrothal then marriage to B keeps the note order', () => {
		expect(rows(graph(tree(u('b', 'betrothal') + u('b', 'marriage') + u('c', 'concubinage'))), ['b', 'c'])).toEqual([['B', 'Betrothal, Marriage'], ['C', 'Concubinage']]);
	});
	it('marriage then betrothal reads the other way', () => {
		expect(rows(graph(tree(u('b', 'marriage') + u('b', 'betrothal') + u('c'))), ['b', 'c'])[0][1]).toBe('Marriage, Betrothal');
	});
	it('two marriages to one person are not merged', () => {
		expect(rows(graph(tree(u('b', 'marriage') + u('b', 'marriage') + u('c', 'marriage'))), ['b', 'c'])[0]).toEqual(['B', 'Marriage, Marriage']);
	});
	it('no type written is a marriage', () => {
		expect(rows(graph(tree(u('b') + u('c'))), ['b', 'c'])).toEqual([['B', 'Marriage'], ['C', 'Marriage']]);
	});
	it('an unknown type word', () => {
		expect(rows(graph(tree(u('b', 'morganatic') + u('c'))), ['b', 'c'])[0][1]).toBe('Other (morganatic)');
	});
	it('an implicit union only', () => {
		const g = graph(`people:\n${person('a')}${person('b')}${person('c')}${person('k', ', parents: [a, b]')}${person('l', ', parents: [a, c]')}`);
		expect(rows(g, ['b', 'c'])).toEqual([['B', 'No recorded partnership'], ['C', 'No recorded partnership']]);
	});
	it('D356 6 A: an ended marriage shows the cause and no years', () => {
		const g = graph(tree(`  - partners: [a, b]
    start: '1100'
    end: '1110'
    ended-by: divorce
${u('c')}`));
		expect(rows(g, ['b', 'c'])[0]).toEqual(['B', 'Marriage, ended by divorce']);
	});
	it('D356 6 A: death, and an alias, in the words of the person window', () => {
		const e = (v: string) => `  - partners: [a, b]
    ended-by: ${v}
${u('c')}`;
		expect(rows(graph(tree(e('death'))), ['b', 'c'])[0][1]).toBe('Marriage, ended by death');
		expect(rows(graph(tree(e('divorced'))), ['b', 'c'])[0][1]).toBe('Marriage, ended by divorce');
		expect(rows(graph(tree(e('annulment'))), ['b', 'c'])[0][1]).toBe('Marriage, ended by annulment');
	});
	it('D356 6 A: no written cause, an unknown cause or a betrothal show the kind only', () => {
		expect(rows(graph(tree(`  - partners: [a, b]
    end: '1110'
${u('c')}`)), ['b', 'c'])[0][1]).toBe('Marriage');
		expect(rows(graph(tree(`  - partners: [a, b]
    ended-by: nonsense
${u('c')}`)), ['b', 'c'])[0][1]).toBe('Marriage');
		expect(rows(graph(tree(`  - partners: [a, b]
    type: betrothal
    ended-by: divorce
${u('c')}`)), ['b', 'c'])[0][1]).toBe('Betrothal');
	});
	it('D356 6 A: several unions to one partner, in note order', () => {
		const g = graph(tree(`  - partners: [a, b]
    ended-by: divorce
  - partners: [a, b]
${u('c')}`));
		expect(rows(g, ['b', 'c'])[0][1]).toBe('Marriage, ended by divorce, Marriage');
		expect(list(g, g, ['b', 'c']).children[0].getAttribute('aria-label')).toBe('B, Marriage, ended by divorce, Marriage');
	});
	it('D356 6 A: the list and the person window agree', () => {
		const g = graph(tree(`  - partners: [a, b]
    start: '1100'
    end: '1110'
    ended-by: death
${u('c')}`));
		const link = familyOf(g, 'a')!.partners[0];
		expect(partnerLinkDetail(link).replace(', 1100–1110', '')).toBe(rows(g, ['b', 'c'])[0][1]);
	});
	it('three partners are one row each', () => {
		expect(rows(graph(tree(u('b', 'marriage') + u('c', 'affair') + u('d', 'betrothal'))), ['b', 'c', 'd']).map((r) => r[1])).toEqual(['Marriage', 'Affair', 'Betrothal']);
	});
	it('a rumoured parent link adds no kind, and the union keeps its own', () => {
		const g = graph(`people:\n${person('a')}${person('b')}${person('c')}${person('k', ', parents: [{id: a, type: rumoured}]')}unions:\n${u('b', 'betrothal')}${u('c', 'marriage')}`);
		expect(rows(g, ['b', 'c'])).toEqual([['B', 'Betrothal'], ['C', 'Marriage']]);
	});
	it('a partner who is also a rumoured parent shows the union kind', () => {
		const g = graph(`people:\n${person('a')}${person('b')}${person('c')}${person('k', ', parents: [{id: b, type: rumoured}]')}unions:\n${u('b', 'affair')}${u('c')}`);
		expect(rows(g, ['b', 'c'])[0]).toEqual(['B', 'Affair']);
	});
	it('a begetter link adds no kind', () => {
		const g = graph(`people:\n${person('a')}${person('b')}${person('c')}${person('k', ', parents: [{id: a, type: begetter}, {id: c, type: birth}]')}unions:\n${u('b', 'marriage')}`);
		expect(tagPartnerKind(g, 'a', 'c')).toBe('');
		expect(tagPartnerKind(g, 'a', 'b')).toBe('Marriage');
	});
	it('a ward link adds no kind', () => {
		const g = graph(`people:\n${person('a')}${person('c')}${person('w', ', parents: [{id: a, type: ward}, {id: c, type: ward}]')}`);
		expect(tagPartnerKind(g, 'a', 'c')).toBe('');
	});
	it('a partner that a fold hides reads like any other: name and kind come from the whole graph', () => {
		const g = graph(tree(u('b', 'marriage') + u('c', 'affair')));
		const shown = { ...g, byId: new Map([...g.byId].filter(([k]) => k !== 'c')) } as FamilyGraph;
		expect(list(shown, g, ['b', 'c']).children.map((b) => b.getAttribute('aria-label'))).toEqual(['B, Marriage', 'C, Affair']);
	});
});

describe('D355 the button', () => {
	it('the accessible name is "name, kind"; the name and the kind are two text lines', () => {
		const g = graph(tree(u('b', 'betrothal') + u('b', 'marriage') + u('c', 'affair')));
		const b = list(g, g, ['b', 'c']).children[0];
		expect(b.getAttribute('aria-label')).toBe('B, Betrothal, Marriage');
		expect(b.children.map((c) => [...c.classes])).toEqual([['dynasty-tag-partner-name'], ['dynasty-tag-partner-kind']]);
	});
	it('a right-to-left name is isolated, and the kind stays a plain text of its own', () => {
		const name = 'يوسف';
		const g = graph(`people:\n${person('a')}  - {id: b, name: ${name}}\n${person('c')}unions:\n${u('b', 'marriage')}${u('c')}`);
		const b = list(g, g, ['b', 'c']).children[0];
		expect(b.getAttribute('aria-label')).toBe(`${isolateName(name)}, Marriage`);
		expect(b.children[1].textContent).toBe('Marriage');
	});
});

describe('D355 the list word is the type part of the person window, in every sample tree', () => {
	it('for every pair of partners', () => {
		let pairs = 0;
		for (const f of allFixtures()) {
			const r = parseDynasty(f.source);
			if (!r.ok) continue;
			const g = deriveFamilies(r.tree);
			for (const p of g.people) {
				const view = familyOf(g, p.id);
				if (!view) continue;
				for (const l of view.partners) {
					// The list joins the kinds of all unions of the pair; the type part of each window row is the text before its first comma.
					const mine = view.partners.filter((x) => x.partner === l.partner).map((x) => partnerLinkDetail(x).split(', ')[0]);
					expect(tagPartnerKind(g, p.id, l.partner)).toBe(mine.join(', '));
					pairs += 1;
				}
			}
		}
		expect(pairs).toBeGreaterThan(20);
	});
});
