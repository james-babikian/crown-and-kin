/*
 * Helpers for the tests of the Succession section of the Titles window (contract 0.2.7 E). Not a test file.
 * The real window runs on the fake DOM with sample tree 16; `answers` scripts the person picker (the test file mocks it).
 */
import { TitlesWindow, type TitlesOptions } from '../src/obsidian/titles-window';
import { FEl, dispatch } from './acceptance/fake-dom';
import { fixtureNote, topLevelBlocks } from './acceptance/load';
import { fakeHost } from './acceptance/tree-view-fakes';
import { openPage } from './lw-support';
import { click, writingHandle, type Writing } from './s113-c-support';

export const BODY_16 = topLevelBlocks(fixtureNote('16'))[0];

export interface Opened {
	win: TitlesWindow;
	handle: Writing;
	content: FEl;
	modal: FEl;
	shown: string[];
	lines: string[];
	closed: { n: number };
}

/** Opens the Titles window on `body`; `shown` collects the ids of Show person, `lines` the ids of Show line. */
export function openWin(body = BODY_16, extra: Partial<TitlesOptions> = {}): Opened {
	const handle = writingHandle(body);
	const host = fakeHost();
	const shown: string[] = [];
	const lines: string[] = [];
	const closed = { n: 0 };
	const win = TitlesWindow.create(host.app as never, {
		handle: handle as never,
		sourcePath: 'n.md',
		show: (id) => void shown.push(id),
		showLine: (id) => void lines.push(id),
		onClosed: () => void closed.n++,
		...extra,
	})!;
	win.open();
	const w = win as unknown as { contentEl: FEl; modalEl: FEl };
	return { win, handle, content: w.contentEl, modal: w.modalEl, shown, lines, closed };
}

/** The edit page of a saved title. */
export const page = (o: Opened, id: string): FEl => openPage(o.content, id);

/**
 * The succession sections on the page. 0.2.8 has two of them, "Line of succession" and "Rules of succession", so the page itself
 * stands for them: the controls (`data-succ`), the line (`dynasty-succ-line`) and the notes are found inside it. It throws when the
 * title has no succession sections (a title that is not saved yet).
 */
export function section(p: FEl): FEl {
	if (!p.querySelector('[data-section="line"]') || !p.querySelector('[data-section="rules"]')) throw new Error('no Succession section');
	return p;
}

/** The field or group with `data-succ="key"` (a label with a dropdown, a switch, a list of people). */
export const ctl = (p: FEl, key: string): FEl | null => p.querySelector(`[data-succ="${key}"]`);

/** Chooses `value` in the dropdown of a field (a computer and a phone alike). */
export function choose(p: FEl, key: string, value: string): void {
	const sel = ctl(p, key)?.querySelector('select');
	if (!sel) throw new Error(`no dropdown for ${key}`);
	sel.value = value;
	dispatch(sel, 'change');
}

/** The text of the line block of the section, one text line for each child, joined with " | ". */
export function lineTexts(p: FEl): string[] {
	const line = p.querySelector('.dynasty-succ-line');
	// The head of the line is the heading and the button Show; only the heading is the text of the line.
	return line ? line.children.map((c) => (c.hasClass('dynasty-line-head') ? (c.querySelector('.dynasty-succ-heading')?.getText() ?? c.getText()) : c.getText())) : [];
}

/** The rows of the line: "1stFenwick Carrow" (the ordinal and the name; the lead and the dates of a row are not in it). */
export function lineRows(p: FEl): string[] {
	return p.querySelectorAll('.dynasty-succ-item').map((r) => `${r.querySelector('.dynasty-ord')?.getText() ?? ''}${r.querySelector('.dynasty-holder-label')?.getText() ?? ''}`);
}

/** The text of the notes (`data-note`) under the line. */
export function notes(p: FEl, kind: string): string[] {
	return p.querySelectorAll('.dynasty-succ-line [data-note]').filter((n) => n.getAttribute('data-note') === kind).map((n) => n.getText());
}

export const save = async (o: Opened) => click(o.content.querySelector('button[data-focus="save"]'));

