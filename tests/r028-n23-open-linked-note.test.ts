import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { FEl, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * N23 (owner note, 0.2.8): "There is no way that I can see to actually navigate to a linked note."
 * Spec 5.2 and 6.3: the edit sheet has an Open linked note control. The proof (scratch/r028-n23) showed that it stood in the Actions section,
 * which is closed in a fresh window. The owner chose 9B (D218 item 9): "Open linked note" stands left of "Open all", in the row under the header.
 * What changed in this file: the proof asked for an open section around the row and for a control in the Notes section. Both ask now that the
 * control is outside every section (so a closed section cannot hide it), next to "Open all", and that the Actions section has no copy.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

const BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8b1a1a"
  - id: orsini
    name: House Orsini
  - id: empty
    name: House Empty
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
    born: "1200"
  - id: bran
    name: Bran Valmont
    house: valmont
    link: "[[Bran Valmont]]"
  - id: cara
    name: Cara Valmont
    house: valmont
    link: "https://example.com/cara"
  - id: dora
    name: Dora Valmont
    house: valmont
    link: "[[People/Dora]]"
  - id: ines
    name: Ines Orsini
    house: orsini
    link: "[[Ines Orsini]]"
unions:
  - partners: [aldric, ines]
parents:
  - child: bran
    parent: aldric
  - child: dora
    parent: aldric
`;
function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('Trees/Tree.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	h.undo.mockImplementation((async () => ({ ok: true, body: body })) as never);
	return h;
}

function openSheet(id: string) {
	const handle = writingHandle(BODY);
	const openLinkText = vi.fn();
	const file = Object.assign(new File('Bran Valmont.md', 'md'), { name: 'Bran Valmont.md', basename: 'Bran Valmont' });
	const app = {
		fileManager: { generateMarkdownLink: () => '[[x]]' },
		vault: { getAbstractFileByPath: () => null, getFiles: () => [] },
		metadataCache: { getFirstLinkpathDest: () => file },
		workspace: { openLinkText, getLeaf: vi.fn() },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
	const sheet = EditSheet.create(app as never, { handle: handle as never, personId: id, sourcePath: 'Trees/Tree.md' })!;
	sheet.open();
	return { content: (sheet as unknown as { contentEl: FEl }).contentEl, openLinkText, sheet };
}

const sectionOf = (el: FEl | null): FEl | null => {
	for (let a = el; a; a = a.parentElement) if (a.hasClass('dynasty-section')) return a;
	return null;
};

describe('N23: the linked note can be opened from the person window', () => {
	it('control: a linked person has an Open linked note control (it is built)', () => {
		expect(openSheet('bran').content.querySelector('.dynasty-sheet-open-link')).not.toBeNull();
	});

	it('on a fresh window the Open linked note control is in no section, so no closed section hides it', () => {
		const btn = openSheet('bran').content.querySelector('.dynasty-sheet-open-link') as FEl;
		expect(sectionOf(btn)).toBeNull();
		expect(btn.getText()).toBe('Open linked note');
	});

	it('it stands in the row of "Open all", directly left of it', () => {
		const content = openSheet('bran').content;
		const row = content.querySelector('.dynasty-openall') as FEl;
		const names = row.children.map((c) => (c.hasClass('dynasty-openall-button') ? 'open-all' : c.hasClass('dynasty-open-note') ? 'open-note' : c.hasClass('dynasty-add-portrait') ? 'add-portrait' : '?'));
		// Bran has no portrait here, so "Add portrait or arms" stands at the far left.
		expect(names).toEqual(['add-portrait', 'open-note', 'open-all']);
	});

	it('the Actions section has no second copy', () => {
		const actions = openSheet('bran').content.querySelector('section[data-section="actions"]') as FEl;
		expect(actions.querySelector('.dynasty-sheet-open-link')).toBeNull();
	});

	it('a tap opens the linked note with the link text of the person', () => {
		const { content, openLinkText } = openSheet('bran');
		dispatch(content.querySelector('.dynasty-sheet-open-link') as FEl, 'click', { detail: 1 });
		expect(openLinkText).toHaveBeenCalledTimes(1);
		expect(openLinkText.mock.calls[0]?.[0]).toBe('Bran Valmont');
	});

	it('a web link opens as a link too, and a person with no link has no control', () => {
		expect(openSheet('cara').content.querySelector('.dynasty-sheet-open-link')).not.toBeNull();
		expect(openSheet('aldric').content.querySelector('.dynasty-sheet-open-link')).toBeNull();
	});
});
