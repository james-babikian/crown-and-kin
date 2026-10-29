// Right-to-left dates in the windows: the Houses window rows, the Find row, the picture viewer line, the rows of the line of succession and the Titles window,
// the top and the family rows of the person window, and the phone list. A date with an Arabic or Hebrew word is a first-strong isolate of its own, so a range keeps
// the order in which it is written. The proof is the reference bidi algorithm of the tests. All people are made up.
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
import { parseDynasty } from '../../src/core/parse';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { pickPerson } from '../../src/obsidian/person-picker';
import { personPictures } from '../../src/obsidian/viewer-sources';
import { buildPhoneList, type PhoneListSpec } from '../../src/render/dom/phone-list-dom';
import { listData, listWord } from '../../src/view/phone-list';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, device, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian, setIcon } from '../acceptance/fake-obsidian';
import { visual, withoutControls } from '../render/bidi-reference';
import { openPage } from '../support/lw-support';
import { openWin, page } from '../support/r027-window-support';
import { stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

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
const ARABIC = 'حوالي 1108';
const ISOLATED = FSI + ARABIC + PDI;
/** What the reference algorithm shows for the Arabic date, from left to right on the screen. */
const SEEN = `1108 ${[...'حوالي'].reverse().join('')}`;
/** `nb` puts no-break spaces and a word joiner in a reign; the tests compare it with plain spaces and no joiner. */
const JOINT = new RegExp(String.fromCharCode(0xa0), 'g');
const WORD_JOINER = new RegExp(String.fromCharCode(0x2060), 'g');
const reader: DateReader = compileCalendars([], true);
const dates = () => reader;
const graphOf = (body: string) => deriveFamilies((parseDynasty(body) as { ok: true; tree: never }).tree, { dates: reader });

const BODY = [
	'houses:', '  - {id: orsini, name: House Orsini}',
	'titles:', '  - id: crown', '    name: Crown', '    succession: eldest-child', '    holders:', `      - {person: aldric, number: II, from: "${ARABIC}", to: 1170}`,
	'people:',
	`  - {id: aldric, name: Aldric Orsini, house: orsini, born: "${ARABIC}", died: 1170, sex: m}`,
	`  - {id: bran, name: Bran Orsini, house: orsini, born: 1135, sex: m, parents: [aldric]}`,
	`  - {id: cora, name: Cora Orsini, house: orsini, born: 1137, died: "${ARABIC}", sex: f, parents: [aldric]}`,
	'',
].join('\n');

describe('the Houses window rows', () => {
	it('show the range of each person with the right-to-left date isolated', () => {
		const handle = writingHandle(BODY);
		const app = {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
		const win = HousesWindow.create(app as never, { handle: handle as never, sourcePath: 'n.md', onClosed: () => undefined, people: { show: () => undefined, openNote: () => undefined }, dates })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		const subs = openPage(content, 'orsini').querySelector('[data-section="people"]')!.querySelectorAll('.dynasty-hp-row').map((r) => r.querySelector('.dynasty-row-sub')!.getText());
		expect(subs[0]).toContain(`${ISOLATED}–1170`);
		expect(visual(subs[0].replace('Generation 1 · ', ''), 0)).toBe(`${SEEN}–1170`);
		expect(subs[2]).toContain(`1137–${ISOLATED}`);
	});
});

describe('the Find row', () => {
	it('shows the dates with the right-to-left date isolated, and keeps the spoken text and the search text plain', () => {
		void pickPerson({} as never, graphOf(BODY), new Set(), 'Type', 'Find', false, null);
		const p = openModals[openModals.length - 1] as unknown as { getSuggestions(q: string): { person?: { id: string } }[]; renderSuggestion(item: unknown, el: FEl): void };
		const el = new FEl('div');
		p.renderSuggestion(p.getSuggestions('').find((i) => i.person?.id === 'aldric'), el);
		expect(el.querySelector('.dynasty-picker-text')!.getText()).toContain(`${ISOLATED}–1170`);
		expect(el.querySelector('.dynasty-sr-only')!.getText()).not.toContain(FSI);
	});
});

describe('the picture viewer line', () => {
	it('has the dates with the right-to-left date isolated', () => {
		const g = graphOf(BODY);
		const kit = { app: {} as never, pictures: undefined, sourcePath: 'n.md', g, person: g.byId.get('aldric')!, draft: { name: 'Aldric Orsini', portrait: '[[a.png]]', arms: '', house: 'orsini', title: '', born: ARABIC, died: '1170' } };
		expect(personPictures(kit)[0].line).toContain(`${ISOLATED}–1170`);
	});
});

describe('the Titles window and the line of succession', () => {
	it('the holder row shows the reign with the right-to-left date isolated, and the succession row shows the dates', () => {
		const o = openWin(BODY, { dates });
		const p = page(o, 'crown');
		const sub = p.querySelectorAll('.dynasty-holder-row .dynasty-row-sub').map((s) => s.getText()).join('|');
		expect(sub).toContain(`${ISOLATED}–1170`);
		expect(p.querySelectorAll('.dynasty-succ-item .dynasty-row-sub').map((s) => s.getText()).join('|')).not.toContain(FSI);
	});

	it('the summary line of the closed Holders section keeps plain text for a reign with no right-to-left date', () => {
		const o = openWin(BODY.replace(ARABIC, '1100'), { dates });
		const p = page(o, 'crown');
		expect(p.querySelectorAll('.dynasty-holder-row .dynasty-row-sub').map((s) => s.getText()).join('|')).not.toContain(FSI);
	});
});

describe('the person window', () => {
	function openSheet(id: string) {
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md', dates } as never)!;
		s.open();
		return (s as unknown as { modalEl: FEl }).modalEl;
	}

	it('the top shows the dates and the reign with the right-to-left date isolated', () => {
		// `nb` puts no-break spaces and a word joiner in a reign; a plain space and no joiner are compared here.
		const meta = openSheet('aldric').querySelector('.dynasty-head-meta')!.getText().replace(JOINT, ' ').replace(WORD_JOINER, '');
		expect(meta).toContain(`${ISOLATED}–1170`);
		expect(meta).toContain(`(r. ${ISOLATED}–1170)`);
		expect(withoutControls(meta)).toContain(`${ARABIC}–1170`);
	});

	it('the family rows show the dates of the children with the right-to-left date isolated', () => {
		const modal = openSheet('bran');
		const text = modal.getText();
		expect(text).toContain(`${ISOLATED}–1170`);
	});
});

describe('the phone list', () => {
	it('the title of the top row shows its reign with the right-to-left date isolated', () => {
		const g = graphOf(BODY);
		const parent = new FEl('div', { cls: 'dynasty-viewport' });
		const spec: PhoneListSpec = {
			g, data: listData(g, 'aldric'), me: null, showDates: true, editable: true,
			word: (id) => listWord(id, { me: null, showRelations: false, cards: new Map() }),
			icon: setIcon as unknown as PhoneListSpec['icon'], onGo: () => undefined, onEdit: () => undefined,
		};
		const list = buildPhoneList(parent as unknown as HTMLElement, spec).list as unknown as FEl;
		const title = list.querySelector('.dynasty-hero-title')!.getText().replace(JOINT, ' ').replace(WORD_JOINER, '');
		expect(title).toContain(`(r. ${ISOLATED}–1170)`);
	});
});

// The kinds of date that need an isolate: a word of a right-to-left script, and Arabic-Indic digits (class AN).
const KINDS: [string, string][] = [['an Arabic word', ARABIC], ['Arabic-Indic digits', '١١٣٣']];
const bodyWith = (date: string) => BODY.split(ARABIC).join(date);
const isolated = (date: string) => FSI + date + PDI;
const everyElement = (el: FEl): FEl[] => [el, ...el.children.flatMap(everyElement)];
/** Every attribute that a screen reader or a tooltip shows as text, with the isolate controls found in it. */
const spokenWithControls = (root: FEl) =>
	everyElement(root).flatMap((e) => ['aria-label', 'title'].map((k) => e.getAttribute(k) ?? '').filter((v) => v.includes(FSI) || v.includes(PDI)));

describe.each(KINDS)('the windows with a date of %s', (_kind, date) => {
	const body = bodyWith(date);
	const text = isolated(date);
	const openSheetOf = (id: string) => {
		const s = EditSheet.create({} as never, { handle: writingHandle(body) as never, personId: id, sourcePath: 'n.md', dates } as never)!;
		s.open();
		return (s as unknown as { modalEl: FEl }).modalEl;
	};

	it('the child row of the person window shows the date isolated and says it with no controls', () => {
		const modal = openSheetOf('aldric');
		const row = modal.querySelectorAll('[data-child]').find((r) => r.getAttribute('data-child') === 'cora')!;
		const label = row.getAttribute('aria-label') ?? '';
		expect(row.getText()).toContain(`1137–${text}`);
		expect(label).toContain(`1137–${date}`);
		expect(label.startsWith('Cora Orsini')).toBe(true);
		expect(spokenWithControls(modal)).toEqual([]);
	});

	it('the closed Details section says the dates with the date isolated', () => {
		const modal = openSheetOf('cora');
		const sum = modal.querySelector('[data-section="details"] .dynasty-section-sum')!.getText();
		expect(sum).toContain(`1137–${text}`);
		expect(visual(sum.split(' · ').pop()!, 0)).toBe(`1137–${visual(text, 0)}`);
	});

	it('the closed Titles section says the reign with the date isolated', () => {
		const modal = openSheetOf('aldric');
		const sum = modal.querySelector('[data-section="titles"] .dynasty-section-sum')!.getText().replace(JOINT, ' ').replace(WORD_JOINER, '');
		expect(sum).toContain(`r. ${text}–1170`);
		expect(visual(sum, 0)).toContain(`r. ${visual(text, 0)}–1170`);
	});

	it('the line of succession shows the dates of an heir with the date isolated', () => {
		const p = page(openWin(body.replace('born: 1135', `born: "${date}"`), { dates }), 'crown');
		const row = p.querySelectorAll('.dynasty-succ-item').find((r) => r.getAttribute('data-person') === 'bran');
		expect(row, 'bran is in the line').toBeTruthy();
		const sub = row!.querySelector('.dynasty-row-sub')!.getText();
		expect(sub).toBe(`b. ${text}`);
		expect(visual(sub, 0)).toBe(`b. ${visual(text, 0)}`);
	});

	it('the open-branch row shows the death date isolated and says it with no controls', () => {
		const p = page(openWin(body, { dates }), 'crown');
		const row = p.querySelectorAll('.dynasty-succ-branch').find((r) => r.getAttribute('data-person') === 'cora')!;
		expect(row.querySelector('.dynasty-holder-label')!.getText()).toBe(`Open branch of Cora Orsini (died ${text}): no children in the tree`);
		expect(row.getAttribute('aria-label')).toBe(`Open branch of Cora Orsini (died ${date}): no children in the tree: show the card in the tree`);
		expect(spokenWithControls(p)).toEqual([]);
	});

	it('the head of a title page says the newest holder with the reign date isolated', () => {
		const meta = page(openWin(body, { dates }), 'crown').querySelector('.dynasty-lw-pagemeta')!.getText().replace(JOINT, ' ').replace(WORD_JOINER, '');
		expect(meta).toContain(`(r. ${text}–1170)`);
	});
});
