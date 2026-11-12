// Spec §0 D322 (0.5.2): a person's name that starts right to left and holds Latin letters ("كريم Mansour") reads in the same order everywhere as on the cards.
// In every HTML place that writes a name, the name (with its sobriquet) is one bidi run whose direction its first strong letter sets: a span with dir="auto"
// and the isolate rule of the CSS, or FSI and PDI around the name inside a text. A name with no right-to-left letter comes back as it was. The proof is the
// reference algorithm of UAX #9 (tests/render/bidi-reference.ts); the real engines are in an internal test. All people are made up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async () => ({
	...(await import('../acceptance/fake-obsidian')),
	prepareFuzzySearch: (query: string) => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return (text: string) => {
			const lower = text.toLowerCase();
			return words.every((w) => lower.includes(w)) ? { score: -text.length, matches: [] } : null;
		};
	},
}));

import { compileCalendars, type DateReader } from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { codedIssue, issueText } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { pickPerson } from '../../src/obsidian/person-picker';
import { openUnionEditor } from '../../src/obsidian/union-edit';
import { personPictures } from '../../src/obsidian/viewer-sources';
import { buildFocusBar } from '../../src/render/dom/focus-bar';
import { buildPhoneList, type PhoneListSpec } from '../../src/render/dom/phone-list-dom';
import { CHANGE_UI } from '../../src/render/change-text';
import { drawProblems } from '../../src/obsidian/problems-list';
import { finderSentence, stepSentences } from '../../src/render/tree-info';
import { FLOW, FOCUS_UI, NEW_SHEET, PHONE_LIST_UI, PROBLEMS_OPEN, REMOVE, SUCCESSION_UI, TITLES_UI, WIN_LIST_UI, WINDOW_UI } from '../../src/render/ui-text';
import { listData, listWord } from '../../src/view/phone-list';
import { closePluginModals } from '../../src/view/plugin-modals';
import { undoneText } from '../../src/obsidian/undo-text';
import { FEl, clock, device, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian, setIcon } from '../acceptance/fake-obsidian';
import { visual } from '../render/bidi-reference';
import { openPage } from '../support/lw-support';
import { useFakeDom } from '../support/fake-dom-setup';
import { openWin, page } from '../support/titles-window-support';
import { stripNotDisabled, writingHandle } from '../support/windows-sheets-support';
import { HousesWindow } from '../../src/obsidian/houses-window';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const CONTROLS = new RegExp(`[${FSI}${PDI}${String.fromCharCode(0x200e)}${String.fromCharCode(0x200f)}${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202c)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2067)}]`);
const MIXED = 'كريم Mansour';
const MIXED_HEBREW = 'דוד David';
const MIXED_BRACKET = 'ليلى Haddad (Layla) 1131';
const LATIN = 'Aldric Valmont';
const ARABIC_ONLY = 'محمد الحداد';
const isolated = (name: string) => FSI + name + PDI;
const reader: DateReader = compileCalendars([], true);
const dates = () => reader;
const graphOf = (body: string) => deriveFamilies((parseDynasty(body) as { ok: true; tree: never }).tree, { dates: reader });
const everyElement = (el: FEl): FEl[] => [el, ...el.children.flatMap(everyElement)];
const runs = (root: FEl) => everyElement(root).filter((e) => e.classes.has('dynasty-name-run'));
/** The words of a text from left to right on the screen, by the reference of UAX #9 (each right-to-left word is read back to its written form). */
function seenWords(text: string, words: readonly string[]): string[] {
	const back = (t: string) => words.find((w) => w === t || [...w].reverse().join('') === t) ?? t;
	return visual(text, 0).split(' ').map(back);
}

const BODY = [
	'houses:', `  - {id: orsini, name: "${MIXED_HEBREW}"}`,
	'titles:', '  - id: crown', `    name: "Crown of ${ARABIC_ONLY}"`, '    succession: eldest-child', '    holders:', `      - {person: layla, number: II, from: 1100, to: 1170}`,
	'people:',
	`  - {id: kareem, name: "${MIXED}", sobriquet: "الشجاع", house: orsini, born: 1100, died: 1170, sex: m}`,
	`  - {id: layla, name: "ليلى Layla", born: 1105, sex: f}`,
	`  - {id: aldric, name: ${LATIN}, born: 1102, sex: m}`,
	`  - {id: bran, name: "${MIXED_BRACKET}", born: 1131, sex: m, parents: [kareem, layla]}`,
	`  - {id: cora, name: "${ARABIC_ONLY}", born: 1133, sex: f, parents: [kareem, layla]}`,
	'unions:', '  - {partners: [kareem, layla], type: marriage}', '',
].join('\n');

describe('the name helper', () => {
	it('puts one first-strong isolate around a name that holds a right-to-left letter, and leaves every other name as it is', async () => {
		const { isolateName } = await import('../../src/render/name-bidi');
		expect(isolateName(MIXED)).toBe(isolated(MIXED));
		expect(isolateName(MIXED_HEBREW)).toBe(isolated(MIXED_HEBREW));
		expect(isolateName(ARABIC_ONLY)).toBe(isolated(ARABIC_ONLY));
		expect(isolateName(LATIN)).toBe(LATIN);
		expect(isolateName('')).toBe('');
		expect(isolateName('Zoë Müller-Çelik 1131')).toBe('Zoë Müller-Çelik 1131');
	});

	it('does not wrap a text twice', async () => {
		const { isolateName } = await import('../../src/render/name-bidi');
		expect(isolateName(isolateName(MIXED))).toBe(isolated(MIXED));
		const two = `${isolated(MIXED)} and ${isolated(MIXED_HEBREW)}`;
		expect(isolateName(two)).toBe(two);
	});

	it('gives the order of the card: the Latin word stands at the left of the Arabic or Hebrew word', () => {
		expect(seenWords(isolated(MIXED), ['كريم', 'Mansour'])).toEqual(['Mansour', 'كريم']);
		expect(seenWords(isolated(MIXED_HEBREW), ['דוד', 'David'])).toEqual(['David', 'דוד']);
		// A name in the plain left-to-right paragraph is the fault: the Arabic word stands at the left.
		expect(seenWords(MIXED, ['كريم', 'Mansour'])).toEqual(['كريم', 'Mansour']);
	});

	it('keeps a sentence in its own order: the words around the name stay at their place', () => {
		const sentence = FOCUS_UI.bar(MIXED);
		expect(sentence).toBe(`Focus on ${isolated(MIXED)}`);
		expect(seenWords(sentence, ['Focus', 'on', 'كريم', 'Mansour'])).toEqual(['Focus', 'on', 'Mansour', 'كريم']);
		expect(FOCUS_UI.bar(LATIN)).toBe(`Focus on ${LATIN}`);
		expect(seenWords(FOCUS_UI.bar(ARABIC_ONLY), ['Focus', 'on', 'محمد', 'الحداد'])).toEqual(['Focus', 'on', 'الحداد', 'محمد']);
	});
});

describe('the texts of the text tables isolate the name and only the name', () => {
	const ALL: [string, (n: string) => string][] = [
		['the focus bar', (n) => FOCUS_UI.bar(n)],
		['the group of children with a partner', (n) => PHONE_LIST_UI.withPartner(n)],
		['the Notice for a person who has no row', (n) => PHONE_LIST_UI.savedElsewhereName(n)],
		['the change line after Add child', (n) => CHANGE_UI.addedChild(n, 'Aldric', 'birth')],
		['the change line after Add parent', (n) => CHANGE_UI.addedParent(n, 'Aldric', 'birth')],
		['the change line after Add partner', (n) => CHANGE_UI.addedPartner(n, 'Aldric')],
		['the change line after This is me', (n) => CHANGE_UI.markedMe(n)],
		['the change line after Remove This is me', (n) => CHANGE_UI.unmarkedMe(n)],
		['the change line after a partnership change', (n) => CHANGE_UI.changedPartnership(n, 'Aldric')],
		['the line after Undo of Add child', (n) => CHANGE_UI.undoneAddedChild(n, 'Aldric', 'birth')],
		['the line after Undo of This is me', (n) => CHANGE_UI.undoneMarkedMe(n)],
		['the delete question', (n) => REMOVE.deleteTitle(n)],
		['the Notice after a delete', (n) => REMOVE.deleted(n)],
		['the Notice after Remove as parent', (n) => REMOVE.removedParent(n, 'Aldric')],
		['the Notice after Remove partnership', (n) => REMOVE.removedPartnership(n, 'Aldric')],
		['the question of Remove partnership', (n) => REMOVE.partnershipText('Marriage', n, 'Aldric')],
		['the step Select the type of parent', (n) => FLOW.parentTypeText(n)],
		['the step New or existing person', (n) => FLOW.newOrExisting(n, 'child')],
		['the step Other parent', (n) => FLOW.otherParentText(n)],
		['the detail of No other parent', (n) => FLOW.noOtherParentDetail(n)],
		['the step Type of partnership', (n) => FLOW.unionTypeText(n, 'Aldric')],
		['the Create row', (n) => FLOW.createNew(n)],
		['the detail of a new person', (n) => NEW_SHEET.partnerOf(n)],
		['the status after Save and add another child', (n) => NEW_SHEET.savedAnother(n)],
		['the Add title step', (n) => TITLES_UI.addTitleText(n)],
		['the Notice after Remove holder', (n) => TITLES_UI.removed(n, 'Crown')],
		['the row of a holder who is not in the tree', (n) => TITLES_UI.notInTreeRow(n)],
		['the reason line of the search', (n) => WIN_LIST_UI.holder(n)],
		['the title of the picture picker', (n) => WINDOW_UI.pickArms(n)],
		['the heir state', (n) => SUCCESSION_UI.heirIsRuler(n)],
		['the heading of the line of succession', (n) => SUCCESSION_UI.lineAfter(n, null)],
		['the open branch', (n) => SUCCESSION_UI.branchRow(n, '')],
		['the button of a problem', (n) => PROBLEMS_OPEN.button(n)],
	];

	it.each(ALL)('%s: the name is one isolate, and a left-to-right name is not changed', (_what, text) => {
		const mixed = text(MIXED);
		expect(mixed).toContain(isolated(MIXED));
		// Only the name is isolated: the words of the sentence stay outside, and every isolate is closed.
		expect(mixed.split(FSI).length).toBe(mixed.split(PDI).length);
		expect(mixed.split(isolated(MIXED)).join('NAME')).not.toMatch(CONTROLS);
		expect(text(LATIN)).not.toMatch(CONTROLS);
		expect(text(LATIN)).toBe(mixed.split(isolated(MIXED)).join(LATIN));
	});

	it('the names of a list are isolated one by one', () => {
		const t = SUCCESSION_UI.orderContradiction([MIXED, MIXED_HEBREW, LATIN]);
		expect(t).toContain(`${isolated(MIXED)}, ${isolated(MIXED_HEBREW)} and ${LATIN}`);
		expect(FLOW.newOrExistingChild([MIXED, LATIN])).toContain(`${isolated(MIXED)} and ${LATIN}`);
	});
});

describe('the sentences of the relation finder', () => {
	const g = graphOf(BODY);
	const bran = g.byId.get('bran')!;
	const result = { kind: 'chain', first: 'kareem', second: bran.id, line: { people: ['kareem', 'bran'] }, steps: [] } as never;

	it('the sentence names both people as one run each', () => {
		expect(finderSentence(g, result, 0)).toBe(`${isolated(MIXED)} and ${isolated(MIXED_BRACKET)} have a relation.`);
		expect(visual(finderSentence(g, result, 0), 0).startsWith('Mansour')).toBe(true);
	});

	it('the steps name the people as one run each, and the possessive follows the name', () => {
		const steps = stepSentences(g, [{ person: 'bran', of: 'kareem', word: 'son', line: [] }] as never);
		expect(steps.shown).toEqual([`${isolated(MIXED_BRACKET)} is ${isolated(MIXED)}’s son.`]);
	});

	it('a left-to-right name has no control character', () => {
		const sentence = finderSentence(g, { kind: 'chain', first: 'aldric', second: 'layla', line: { people: ['aldric', 'layla'] }, steps: [] } as never, 0);
		expect(sentence).toBe(`${LATIN} and ${isolated('ليلى Layla')} have a relation.`);
	});
});

describe('the phone list', () => {
	function build(centre: string, me: string | null = null) {
		const g = graphOf(BODY);
		const parent = new FEl('div', { cls: 'dynasty-viewport' });
		const spec: PhoneListSpec = {
			g, data: listData(g, centre), me, showDates: true, editable: true,
			word: (id) => listWord(id, { me, showRelations: false, cards: new Map() }),
			icon: setIcon as unknown as PhoneListSpec['icon'], onGo: () => undefined, onEdit: () => undefined,
		};
		return buildPhoneList(parent as unknown as HTMLElement, spec).list as unknown as FEl;
	}
	const nameOf = (list: FEl, id: string) => list.querySelector(`.dynasty-list-row[data-person="${id}"] .dynasty-list-name`)!;

	it('the name of the top row and the name of every row are one run with dir="auto" when they hold a right-to-left letter', () => {
		const list = build('kareem');
		const top = nameOf(list, 'kareem');
		const run = runs(top as FEl);
		expect(run).toHaveLength(1);
		expect(run[0].getAttribute('dir')).toBe('auto');
		expect(run[0].getText()).toBe(`${MIXED} “الشجاع”`);
		// The sobriquet is inside the run, after a space that stands outside its span.
		expect(run[0].children.map((c) => c.classes.has('dynasty-list-sob'))).toEqual([true]);
		expect(top.getText()).toBe(`${MIXED} “الشجاع”`);
		for (const id of ['layla', 'bran', 'cora']) expect(runs(nameOf(list, id) as FEl), id).toHaveLength(1);
	});

	it('the order that the run gives is the order of the card', () => {
		const list = build('kareem');
		const run = runs(nameOf(list, 'kareem') as FEl)[0];
		// The browser makes the run an isolate (the CSS rule and dir="auto"); the reference shows the same text isolated.
		expect(seenWords(isolated(run.getText().replace(' “الشجاع”', '')), ['كريم', 'Mansour'])).toEqual(['Mansour', 'كريم']);
	});

	it('a left-to-right name has no extra element and a text that is the name', () => {
		const list = build('aldric');
		const top = nameOf(list, 'aldric');
		expect(runs(top as FEl)).toHaveLength(0);
		expect(top.children).toHaveLength(0);
		expect(top.getText()).toBe(LATIN);
	});

	it('the title of the top row and of the other rows is one run when it holds a right-to-left letter, and the reign keeps its date isolates', () => {
		const title = `Crown of ${ARABIC_ONLY}`;
		const hero = build('layla').querySelector('.dynasty-hero-title')!;
		expect(runs(hero as FEl).map((x) => x.getText())).toEqual([title]);
		expect(hero.getText().replace(new RegExp(String.fromCharCode(0xa0), 'g'), ' ').replace(new RegExp(String.fromCharCode(0x2060), 'g'), '')).toBe(`${title} (r. 1100–1170)`);
		const row = build('kareem').querySelectorAll('.dynasty-list-title').find((t) => t.getText().includes('Crown'))!;
		expect(runs(row as FEl).map((x) => x.getText())).toEqual([title]);
	});

	it('the date spans keep their own isolates', () => {
		const list = build('kareem');
		const dateSpans = everyElement(list).filter((e) => e.classes.has('dynasty-list-date'));
		expect(dateSpans.length).toBeGreaterThan(0);
		for (const d of dateSpans) expect(d.getAttribute('dir')).toBe('auto');
	});

	it('the heading of a group of children isolates the partner name', () => {
		const g = graphOf(BODY.replace('unions:', '  - {id: edric, name: Edric, born: 1140, sex: m, parents: [kareem, aldric]}\nunions:\n  - {partners: [kareem, aldric], type: marriage}'));
		const parent = new FEl('div');
		const spec: PhoneListSpec = {
			g, data: listData(g, 'kareem'), me: null, showDates: true, editable: true,
			word: (id) => listWord(id, { me: null, showRelations: false, cards: new Map() }),
			icon: setIcon as unknown as PhoneListSpec['icon'], onGo: () => undefined, onEdit: () => undefined,
		};
		const list = buildPhoneList(parent as unknown as HTMLElement, spec).list as unknown as FEl;
		const heads = list.querySelectorAll('.dynasty-list-sub').map((h) => h.getText());
		// The heading is written as text and an isolate span (the marks are elements at the DOM edge).
		expect(heads).toContain('With ليلى Layla');
		expect(heads).toContain(`With ${LATIN}`);
		const sub = list.querySelectorAll('.dynasty-list-sub').find((h) => h.getText() === 'With ليلى Layla')!;
		expect(runs(sub).map((x) => x.getAttribute('dir'))).toEqual(['auto']);
		expect(list.querySelectorAll('.dynasty-list-sub').find((h) => h.getText() === `With ${LATIN}`)!.children).toHaveLength(0);
	});

	it('the spoken names keep no control character', () => {
		const list = build('kareem');
		for (const e of everyElement(list)) for (const k of ['aria-label', 'title']) expect(e.getAttribute(k) ?? '', `${e.tag} ${k}`).not.toMatch(CONTROLS);
		for (const e of everyElement(list).filter((x) => x.classes.has('dynasty-sr-only'))) expect(e.getText()).not.toMatch(CONTROLS);
	});
});

describe('the focus bar', () => {
	it('says "Focus on" and the name as one run', () => {
		const viewport = new FEl('div');
		const canvas = viewport.createDiv();
		const bar = buildFocusBar(viewport as unknown as HTMLElement, canvas as unknown as HTMLElement, { sentence: FOCUS_UI.bar(MIXED), clear: 'Clear', clearLabel: 'Clear', phone: false, onClear: () => undefined }) as unknown as FEl;
		const text = bar.querySelector('.dynasty-focus-bar-text')!;
		// The sentence of the table has the marks; the bar writes the name as an isolate span, with no control character left.
		expect(text.getText()).toBe(`Focus on ${MIXED}`);
		expect(runs(text).map((x) => [x.getAttribute('dir'), x.getText()])).toEqual([['auto', MIXED]]);
		expect(text.text).toBe('Focus on ');
	});
});

describe('Find and the person pickers', () => {
	const g = graphOf(BODY);
	function rowOf(id: string, you: string | null = null, query = ''): FEl {
		void pickPerson({} as never, g, new Set(), 'Type', 'Find', false, you);
		const p = openModals[openModals.length - 1] as unknown as { getSuggestions(q: string): { person?: { id: string } }[]; renderSuggestion(item: unknown, el: FEl): void };
		const el = new FEl('div');
		p.renderSuggestion(p.getSuggestions(query).find((i) => i.person?.id === id), el);
		return el;
	}

	it('the name, and the sobriquet after it, are one run', () => {
		const row = rowOf('kareem');
		const name = row.querySelector('.dynasty-picker-name')!;
		expect(runs(name)).toHaveLength(1);
		expect(runs(name)[0].getAttribute('dir')).toBe('auto');
		expect(name.getText()).toBe(`${MIXED} “الشجاع”`);
		expect(name.querySelector('.dynasty-picker-sob')).toBeTruthy();
	});

	it('the row of the marked person has the name alone on its name line, as in the Find list (D346 item 4)', () => {
		const name = rowOf('kareem', 'kareem').querySelector('.dynasty-picker-name')!;
		expect(name.getText()).toBe(`${MIXED} “الشجاع”`);
		expect(runs(name)).toHaveLength(1);
	});

	it('a left-to-right name has no run', () => {
		const name = rowOf('aldric').querySelector('.dynasty-picker-name')!;
		expect(runs(name)).toHaveLength(0);
		expect(name.getText()).toBe(LATIN);
	});

	it('the spoken text keeps no control character', () => {
		const row = rowOf('kareem');
		expect(row.querySelector('.dynasty-sr-only')!.getText()).not.toMatch(CONTROLS);
	});

	it('the Create row shows the typed text in its curly marks as one run', () => {
		const picker = (void pickPerson({} as never, g, new Set(), 'Type', 'Find', true, null), openModals[openModals.length - 1] as unknown as { renderSuggestion(item: unknown, el: FEl): void });
		const el = new FEl('div');
		picker.renderSuggestion({ kind: 'new', text: MIXED_HEBREW }, el);
		expect(el.querySelector('.dynasty-picker-name')!.getText()).toBe(`Create a new person “${isolated(MIXED_HEBREW)}”`);
		const latin = new FEl('div');
		picker.renderSuggestion({ kind: 'new', text: 'Edric' }, latin);
		expect(latin.querySelector('.dynasty-picker-name')!.getText()).toBe('Create a new person “Edric”');
	});
});

describe('the person window', () => {
	function openSheet(id: string) {
		const s = EditSheet.create({} as never, { handle: writingHandle(BODY) as never, personId: id, sourcePath: 'n.md', dates } as never)!;
		s.open();
		return (s as unknown as { modalEl: FEl }).modalEl;
	}

	it('the header shows the name and the sobriquet as one run, and the title of the window is isolated', () => {
		const modal = openSheet('kareem');
		const head = modal.querySelector('.dynasty-head-name')!;
		const run = runs(head);
		expect(run).toHaveLength(1);
		expect(run[0].getText()).toBe(`${MIXED} “الشجاع”`);
		expect(modal.querySelector('.dynasty-house-name')!.getText()).toBe(isolated(MIXED_HEBREW));
	});

	it('the Family rows show the parents, the partners and the children as runs', () => {
		const modal = openSheet('bran');
		const parents = modal.querySelectorAll('[data-parent]');
		expect(parents).toHaveLength(2);
		for (const row of parents) expect(runs(row.querySelector('.dynasty-family-name')!), row.getAttribute('data-parent') ?? '').toHaveLength(1);
		const partners = openSheet('kareem').querySelectorAll('[data-partner]');
		expect(runs(partners[0].querySelector('.dynasty-family-name')!)).toHaveLength(1);
		const kids = openSheet('kareem').querySelectorAll('[data-child]');
		expect(kids.map((k) => runs(k.querySelector('.dynasty-family-name')!).length)).toEqual([1, 1]);
		expect(runs(kids[0].querySelector('.dynasty-family-name')!)[0].getText()).toBe(MIXED_BRACKET);
	});

	it('the spoken names of the rows keep no control character', () => {
		const modal = openSheet('kareem');
		for (const e of everyElement(modal)) for (const k of ['aria-label', 'title']) expect(e.getAttribute(k) ?? '', `${e.tag} ${k}`).not.toMatch(CONTROLS);
	});

	it('the Titles section of the person window shows the title name as one run', () => {
		const sum = openSheet('layla').querySelector('[data-section="titles"] .dynasty-section-sum')!.getText();
		expect(sum).toContain(isolated(`Crown of ${ARABIC_ONLY}`));
	});
});

describe('the partnership window', () => {
	it('the two names are the title, each as one run', () => {
		openUnionEditor({} as never, MIXED, MIXED_HEBREW, { type: 'marriage', start: '', end: '', endedBy: '' }, async () => null);
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl; modalEl: FEl };
		expect(modal.modalEl.querySelector('.dynasty-union-title')!.getText()).toBe(`${isolated(MIXED)} and ${isolated(MIXED_HEBREW)}`);
	});

	it('a left-to-right pair has no control character', () => {
		openUnionEditor({} as never, LATIN, 'Edric', { type: 'marriage', start: '', end: '', endedBy: '' }, async () => null);
		const modal = openModals[openModals.length - 1] as unknown as { modalEl: FEl };
		expect(modal.modalEl.querySelector('.dynasty-union-title')!.getText()).toBe(`${LATIN} and Edric`);
	});
});

describe('the Titles window and the Houses window', () => {
	it('the holder row shows the ruler name as one run and the full name under it', () => {
		const p = page(openWin(BODY, { dates }), 'crown');
		const label = p.querySelector('.dynasty-holder-row .dynasty-holder-label')!;
		expect(runs(label)).toHaveLength(1);
		expect(label.getText()).toBe('ليلى II');
	});

	it('the line under the title page says the newest holder as one run, with the reign outside it', () => {
		const meta = page(openWin(BODY, { dates }), 'crown').querySelector('.dynasty-lw-pagemeta')!.getText().replace(new RegExp(String.fromCharCode(0xa0), 'g'), ' ').replace(new RegExp(String.fromCharCode(0x2060), 'g'), '');
		expect(meta).toContain(`newest: ${isolated('ليلى Layla')} (r. 1100–1170)`);
	});

	it('the head of a title page and the rows of the list isolate the title name', () => {
		const o = openWin(BODY, { dates });
		const rows = o.content.querySelectorAll('.dynasty-lw-row-name').map((r) => r.getText());
		expect(rows).toContain(isolated(`Crown of ${ARABIC_ONLY}`));
		expect(page(o, 'crown').querySelector('.dynasty-lw-back-name')!.getText()).toBe(isolated(`Crown of ${ARABIC_ONLY}`));
	});

	it('the line of succession shows the heir names as runs', () => {
		const p = page(openWin(BODY, { dates }), 'crown');
		const labels = p.querySelectorAll('.dynasty-succ-item .dynasty-holder-label').map((l) => l.getText());
		expect(labels.length).toBeGreaterThan(0);
		for (const l of labels) expect(l.startsWith(FSI) && l.endsWith(PDI)).toBe(true);
	});

	it('the Houses window shows the house name and the people as isolated names', () => {
		const handle = writingHandle(BODY);
		const app = {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
		const win = HousesWindow.create(app as never, { handle: handle as never, sourcePath: 'n.md', onClosed: () => undefined, people: { show: () => undefined, openNote: () => undefined }, dates })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		expect(content.querySelector('.dynasty-lw-row-name')!.getText()).toBe(isolated(MIXED_HEBREW));
		const names = openPage(content, 'orsini').querySelectorAll('.dynasty-hp-name').map((n) => n.getText());
		expect(names).toEqual([isolated(`${MIXED} “الشجاع”`)]);
	});
});

describe('the problem list', () => {
	it('the sentences isolate the person, the house and the title names', () => {
		expect(issueText(codedIssue('missing-parent', 'warning', { person: MIXED, ref: 'x1' }))).toContain(`${isolated(MIXED)} has a parent`);
		expect(issueText(codedIssue('duplicate-person-id', 'warning', { id: 'p1', name: MIXED }))).toContain(`${isolated(MIXED)} (p1) has the same ID`);
		expect(issueText(codedIssue('missing-house', 'warning', { person: MIXED_HEBREW, ref: 'zz' }))).toContain(`${isolated(MIXED_HEBREW)} has the house`);
		expect(issueText(codedIssue('holder-empty', 'warning', { title: ARABIC_ONLY, index: 2 }))).toContain(isolated(ARABIC_ONLY));
		expect(issueText(codedIssue('self-parent', 'warning', { person: MIXED }))).toBe(`The parents of ${isolated(MIXED)} include ${isolated(MIXED)}. If this is a mistake, remove ${isolated(MIXED)} from these parents.`);
	});

	it('a left-to-right sentence has no control character', () => {
		expect(issueText(codedIssue('self-parent', 'warning', { person: LATIN }))).not.toMatch(CONTROLS);
		expect(issueText(codedIssue('missing-parent', 'warning', { person: LATIN, ref: 'x1' }))).not.toMatch(CONTROLS);
	});

	it('a list of partners is isolated one by one', () => {
		const t = issueText(codedIssue('union-partner-count', 'warning', { partners: [MIXED, LATIN, MIXED_HEBREW], count: 3 }));
		expect(t).toContain(`${isolated(MIXED)}, ${LATIN} and ${isolated(MIXED_HEBREW)}`);
	});

	it('the row of the list is written with isolate spans', () => {
		const el = new FEl('div');
		drawProblems(el as unknown as HTMLElement, {
			issues: [codedIssue('missing-house', 'warning', { person: MIXED, ref: 'zz', owner: 'arms', house: MIXED_HEBREW, id: 'orsini' })],
			whole: graphOf(BODY), sheet: false, icon: setIcon, close: () => undefined, show: () => undefined, open: () => undefined, peopleOf: () => [],
		} as never);
		// The row is written with isolate spans, and no control character is left in it.
		const li = el.querySelectorAll('li')[0];
		expect(runs(li).map((x) => x.getText())).toContain(MIXED);
		expect(li.getText()).not.toMatch(CONTROLS);
	});
});

describe('the lines after a write, and Undo', () => {
	it('the words after an Undo isolate the names of the label', () => {
		expect(undoneText({ kind: 'added-partner', names: [MIXED, LATIN] }, null, 'x')).toBe(`The plugin undid the addition of ${isolated(MIXED)} as a partner of ${LATIN}.`);
		expect(undoneText({ kind: 'deleted', names: [MIXED_HEBREW] }, null, 'x')).toBe(`The plugin undid the deletion of ${isolated(MIXED_HEBREW)}.`);
		expect(undoneText({ kind: 'marked-me', names: [LATIN] }, null, 'x')).toBe(`The plugin undid the mark “This is me” on ${LATIN}.`);
	});
});

describe('the picture viewer', () => {
	it('the heading is the isolated name', () => {
		const g = graphOf(BODY);
		const kit = { app: {} as never, pictures: undefined, sourcePath: 'n.md', g, person: g.byId.get('kareem')!, draft: { name: MIXED, portrait: '[[a.png]]', arms: '', house: 'orsini', title: '', born: '1100', died: '1170' } };
		expect(personPictures(kit)[0].heading).toBe(isolated(MIXED));
		expect(personPictures({ ...kit, draft: { ...kit.draft, name: LATIN } })[0].heading).toBe(LATIN);
	});
});
