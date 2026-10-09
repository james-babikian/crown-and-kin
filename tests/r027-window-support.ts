/*
 * Helpers for the tests of the Succession section of the Titles window (contract 0.2.7 E). Not a test file.
 * The real window runs on the fake DOM with sample tree 16; `answers` scripts the person picker (the test file mocks it).
 */
import { expect } from 'vitest';
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

/** The section on the page. */
export function section(p: FEl): FEl {
	const el = p.querySelector('[data-section="succession"]');
	if (!el) throw new Error('no Succession section');
	return el;
}

/** The field or group with `data-succ="key"` (a label with a dropdown, a group of buttons, a switch, a list of people). */
export const ctl = (p: FEl, key: string): FEl | null => p.querySelector(`[data-succ="${key}"]`);

/** Chooses `value` in the dropdown of a field (computer layout). */
export function choose(p: FEl, key: string, value: string): void {
	const sel = ctl(p, key)?.querySelector('select');
	if (!sel) throw new Error(`no dropdown for ${key}`);
	sel.value = value;
	dispatch(sel, 'change');
}

/** Taps the button with `value` in the button list of a field (phone layout). */
export async function tapChoice(p: FEl, key: string, value: string): Promise<void> {
	const b = ctl(p, key)?.querySelectorAll('button').find((x) => x.getAttribute('data-value') === value);
	if (!b) throw new Error(`no button ${value} for ${key}`);
	await click(b);
}

/** The text of the line block of the section, one text line for each child, joined with " | ". */
export function lineTexts(p: FEl): string[] {
	const line = p.querySelector('.dynasty-succ-line');
	return line ? line.children.map((c) => c.getText()) : [];
}

/** The rows of the line: "1st Fenwick Carrow". */
export function lineRows(p: FEl): string[] {
	return p.querySelectorAll('.dynasty-succ-row').map((r) => r.getText());
}

/** The text of the notes (`data-note`) under the line. */
export function notes(p: FEl, kind: string): string[] {
	return p.querySelectorAll('.dynasty-succ-line [data-note]').filter((n) => n.getAttribute('data-note') === kind).map((n) => n.getText());
}

export const save = async (o: Opened) => click(o.content.querySelector('button[data-focus="save"]'));

export function expectDefined<T>(v: T | null | undefined, what: string): T {
	expect(v, what).not.toBeNull();
	expect(v, what).not.toBeUndefined();
	return v as T;
}
