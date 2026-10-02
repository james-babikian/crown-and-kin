import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Obsidian's own matcher is replaced by a plain one: every word of the query must be inside the text, in
// lower case only. It does not fold anything, so a match here comes from the plugin's fold (D100).
vi.mock('obsidian', async () => ({
	...(await import('./acceptance/fake-obsidian')),
	prepareFuzzySearch: (query: string) => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return (text: string) => {
			const lower = text.toLowerCase();
			return words.every((w) => lower.includes(w)) ? { score: -text.length, matches: [] } : null;
		};
	},
}));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { build } from './helpers';
import { matchPictures, pickPicture } from '../src/obsidian/picture-picker';
import { pickPerson } from '../src/obsidian/person-picker';
import { FEl, device, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';

/*
 * 1.1.1 WP3, D100 (spec §13.6): Find, the person pickers and the picture search ignore case, accents and the
 * look of quote marks on both sides of the match. Only the match changes; the rows show the stored text.
 * Run: npx vitest run tests/v111-obsidian-search.test.ts
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	device.coarse = false;
});

afterEach(() => vi.restoreAllMocks());

// ---------- the person pickers ----------

interface PickerLike {
	getSuggestions(q: string): { kind: string; person?: { id: string; name: string } }[];
	renderSuggestion(item: unknown, el: FEl): void;
	close(): void;
}

const NAMES = [
	['curly', 'Juan d’España'],
	['straight', "Marta d'Aragon"],
	['plain', 'Pedro Espana'],
	['accent', 'Éloïse Müller'],
	['ae', 'Æthelred'],
	['oe', 'Ørsted'],
	['other', 'Aldric Valmont'],
] as const;

const tree = () => build(`people:\n${NAMES.map(([id, name]) => `  - {id: ${id}, name: "${name}"}`).join('\n')}\n`).g;

function openPicker(): PickerLike {
	void pickPerson({} as never, tree(), new Set(), 'Type', 'Find', false);
	return openModals[openModals.length - 1] as unknown as PickerLike;
}

/** The ids that the picker offers for a typed text. */
const found = (p: PickerLike, typed: string) => p.getSuggestions(typed).filter((i) => i.kind === 'person').map((i) => i.person!.id);

describe('D100: the person picker folds both sides', () => {
	it('"d\'España" finds "d’España", and the reverse', () => {
		const p = openPicker();
		expect(found(p, "d'España")).toEqual(['curly']);
		expect(found(p, 'd’España')).toEqual(['curly']);
		expect(found(p, "d’Aragon")).toEqual(['straight']);
		expect(found(p, 'd‘Aragon')).toEqual(['straight']);
		expect(found(p, "d'Aragon")).toEqual(['straight']);
	});

	it('"espana" finds "España" and "Espana"; "ESPAÑA" too', () => {
		const p = openPicker();
		expect(found(p, 'espana').sort()).toEqual(['curly', 'plain']);
		expect(found(p, 'ESPAÑA').sort()).toEqual(['curly', 'plain']);
		expect(found(p, 'eloise muller')).toEqual(['accent']);
	});

	it('letters that have no accent form: "Aethelred" finds "Æthelred", "Orsted" and "Ørsted" find "Ørsted"', () => {
		const p = openPicker();
		expect(found(p, 'aethelred')).toEqual(['ae']);
		expect(found(p, 'Æthelred')).toEqual(['ae']);
		expect(found(p, 'Orsted')).toEqual(['oe']);
		expect(found(p, 'Ørsted')).toEqual(['oe']);
		expect(found(p, 'ørsted')).toEqual(['oe']);
	});

	it('the rows show the stored text, not the folded text', () => {
		const p = openPicker();
		const shown = p.getSuggestions("d'espana").map((i) => {
			const el = new FEl('div');
			p.renderSuggestion(i, el);
			return el.querySelector('.dynasty-picker-name')!.getText();
		});
		expect(shown).toEqual(['Juan d’España']);
		for (const [id, name] of NAMES) {
			const item = p.getSuggestions('').find((i) => i.person?.id === id)!;
			const el = new FEl('div');
			p.renderSuggestion(item, el);
			expect(el.querySelector('.dynasty-picker-name')!.getText()).toBe(name);
		}
	});

	it('a typed text that folds to nothing offers every person, and a text with no match offers none', () => {
		const p = openPicker();
		expect(found(p, '́')).toHaveLength(NAMES.length);
		expect(found(p, 'zzz')).toEqual([]);
	});
});

// ---------- the picture search ----------

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

const PICTURES = ['Arms/d’España.png', "Arms/d'Aragon.png", 'Arms/España.png', 'Arms/Æthelred.svg', 'Portraits/Ørsted.jpg', 'Portraits/plain.jpg'].map(file);

describe('D100: the picture search folds both sides', () => {
	it('matchPictures: "d\'España" finds "d’España" and the reverse', () => {
		expect(matchPictures(PICTURES, "d'España").map((f) => f.path)).toEqual(['Arms/d’España.png']);
		expect(matchPictures(PICTURES, 'd’Aragon').map((f) => f.path)).toEqual(["Arms/d'Aragon.png"]);
	});

	it('matchPictures: "espana" finds "España"; "aethelred" finds "Æthelred"; "orsted" finds "Ørsted"; a path word works', () => {
		expect(matchPictures(PICTURES, 'espana').map((f) => f.path)).toEqual(['Arms/d’España.png', 'Arms/España.png']);
		expect(matchPictures(PICTURES, 'aethelred').map((f) => f.path)).toEqual(['Arms/Æthelred.svg']);
		expect(matchPictures(PICTURES, 'orsted portraits').map((f) => f.path)).toEqual(['Portraits/Ørsted.jpg']);
		expect(matchPictures(PICTURES, '  ').length).toBe(PICTURES.length);
	});

	it('the picture list: the same words find the same pictures, and the rows show the stored names', () => {
		const app = {
			metadataCache: { getFirstLinkpathDest: () => null },
			vault: { getAbstractFileByPath: () => null, getFiles: () => PICTURES },
			fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
			loadLocalStorage: () => null,
			saveLocalStorage: () => {},
		};
		void pickPicture(app as never, { sourcePath: 'Tree.md', title: 'Select' });
		const m = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		const search = m.contentEl.querySelector('.dynasty-picture-search')!;
		const names = () => m.contentEl.querySelectorAll('[data-path]').map((r) => r.querySelector('.dynasty-picture-name')!.getText());
		for (const [typed, want] of [
			["d'España", ['d’España.png']],
			['d’Aragon', ["d'Aragon.png"]],
			['espana', ['d’España.png', 'España.png']],
			['AETHELRED', ['Æthelred.svg']],
			['Ørsted', ['Ørsted.jpg']],
			['orsted', ['Ørsted.jpg']],
		] as const) {
			search.value = typed;
			dispatch(search, 'input');
			expect(names(), typed).toEqual(want);
		}
	});
});
