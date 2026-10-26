import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { EditSheetBase } from '../../src/obsidian/edit-sheet-base';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearLayoutCache } from '../../src/layout/index';
import { clearStops, FIRST_LIMIT, PHONE_WHOLE_LIMIT } from '../../src/view/large-tree';
import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, flushFrames, installDom, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, openFullScreen, phone } from '../acceptance/tree-view-fakes';
import { BODY_16 } from '../support/r027-window-support';
import { toolbarIn } from '../../src/obsidian/tree-view-toolbar';
import { useFakeDom } from '../support/fake-dom-setup';

// 0.3.3 WP-1 (steward notes T1, T2 and E1): three helpers replace repeated code.
//   toolbarIn   the four builders of a toolbar. The first block writes down the exact bars of the six places that make one, as the code made
//               them before the helper (the expected text was recorded from the code before the change); the second block tests the helper alone.
//   watchLate   the four observers that wait for the section of a block in a callout.
//   press       the click guard of the edit window.

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearLayoutCache();
	clearStops();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

/** An element and its children as text: tag, classes, attributes in order, the text, and the position in the parent. */
function dump(el: FEl, depth = 0): string {
	const attrs = [...el.attrs].map(([k, v]) => `${k}=${v}`).join(' ');
	const head = `${'  '.repeat(depth)}${el.tag}.${[...el.classes].join('.')}${attrs ? ` [${attrs}]` : ''}${el.text ? ` "${el.text}"` : ''}`;
	return [head, ...el.children.map((c) => dump(c, depth + 1))].join('\n');
}

/** Every bar of a tree view with its place among the children of its parent. */
function bars(root: FEl): string {
	return root
		.querySelectorAll('.dynasty-toolbar')
		.map((b) => `parent ${[...b.parentElement!.classes].join('.')}, child ${b.parentElement!.children.indexOf(b)} of ${b.parentElement!.children.length}\n${dump(b)}`)
		.join('\n--\n');
}

const BROKEN = 'people: [' + String.fromCharCode(10);
const EMPTY = 'people: []' + String.fromCharCode(10);
const flat = (n: number): string => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;

describe('the bars of a tree view keep their DOM (steward T1)', () => {
	it('the desktop toolbar of a tree in a note', async () => {
		desktop();
		const { el } = await embed(BODY_16, { handle: fakeHandle('n.md', BODY_16) });
		expect(bars(el)).toMatchInlineSnapshot(`
			"parent dynasty-viewport.is-flow, child 0 of 2
			div.dynasty-toolbar [role=toolbar aria-label=Tools for this tree]
			  button.clickable-icon.dynasty-tool.dynasty-add-person.dynasty-tool-main [aria-label=Add person: add a person to the tree type=button]
			    span.dynasty-tool-icon
			    span.dynasty-tool-text "Add person"
			  button.clickable-icon.dynasty-tool.dynasty-find [aria-label=Find a person in the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-focus [aria-label=Focus on a person in the tree type=button aria-haspopup=true aria-expanded=false]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-fit [aria-label=Fit the tree in the view type=button]
			    span.dynasty-tool-icon
			  span.dynasty-sep.dynasty-sep-a [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-houses-button [aria-label=Houses: edit the houses of the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-titles-button [aria-label=Titles: edit the titles of the tree type=button]
			    span.dynasty-tool-icon
			  span.dynasty-sep.dynasty-sep-b [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-more [aria-label=Show more actions type=button aria-haspopup=true]
			    span.dynasty-tool-icon
			  span.dynasty-grow [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-expand [aria-label=Show the tree in a full-screen view type=button]
			    span.dynasty-tool-icon"
		`);
	});

	it('the toolbar of the phone full-screen view', async () => {
		phone();
		const { root } = await openFullScreen(BODY_16);
		expect(bars(root)).toMatchInlineSnapshot(`
			"parent dynasty-viewport, child 0 of 4
			div.dynasty-toolbar [role=toolbar aria-label=Tools for this tree]
			  button.clickable-icon.dynasty-tool.dynasty-add-person [aria-label=Add person: add a person to the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-houses-button [aria-label=Houses: edit the houses of the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-focus [aria-label=Focus on a person in the tree type=button aria-haspopup=true aria-expanded=false]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-find [aria-label=Find a person in the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-more [aria-label=Show more actions type=button aria-haspopup=true]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-close [aria-label=Close the full-screen view type=button]
			    span.dynasty-tool-icon"
		`);
	});

	it('the bar above the list on a phone', async () => {
		phone();
		const { el } = await embed(BODY_16, { handle: fakeHandle('n.md', BODY_16) });
		expect(bars(el)).toMatchInlineSnapshot(`
			"parent dynasty-viewport.dynasty-list-viewport, child 0 of 2
			div.dynasty-toolbar [role=toolbar aria-label=Tools for this tree]
			  button.clickable-icon.dynasty-tool.dynasty-add-person [aria-label=Add person: add a person to the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-show-text [aria-label=Show the tree text: open the note and show the text of this tree type=button]
			    span.dynasty-tool-icon
			  span.dynasty-grow [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-list-find [aria-label=Find: find a person in the tree to show the family of that person type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-expand [aria-label=Expand: show the tree in a full-screen view type=button]
			    span.dynasty-tool-icon"
		`);
	});

	it('the bar of an empty tree in the phone full-screen view', async () => {
		phone();
		const { root } = await openFullScreen('people: []\n');
		expect(bars(root)).toMatchInlineSnapshot(`
			"parent dynasty-root.dynasty-empty-root.dynasty-full, child 1 of 2
			div.dynasty-toolbar [role=toolbar aria-label=Tools for this tree]
			  span.dynasty-grow [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-close [aria-label=Close the full-screen view type=button]
			    span.dynasty-tool-icon"
		`);
	});

	it('the bar of a very large tree in the phone full-screen view', async () => {
		phone();
		const { root } = await openFullScreen(flat(PHONE_WHOLE_LIMIT + 1), { host: fakeHost() });
		expect(bars(root)).toMatchInlineSnapshot(`
			"parent dynasty-viewport, child 0 of 5
			div.dynasty-toolbar [role=toolbar aria-label=Tools for this tree]
			  button.clickable-icon.dynasty-tool.dynasty-add-person [aria-label=Add person: add a person to the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-houses-button [aria-label=Houses: edit the houses of the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-focus.is-active [aria-label=Focus is on. Select this button to clear the focus and show all people. type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-find [aria-label=Find a person in the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-more [aria-label=Show more actions type=button aria-haspopup=true]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-close [aria-label=Close the full-screen view type=button]
			    span.dynasty-tool-icon"
		`);
	});

	it('the bar of a very large tree in the desktop full-screen view', async () => {
		desktop();
		const { root } = await openFullScreen(flat(FIRST_LIMIT + 1), { host: fakeHost() });
		expect(bars(root)).toMatchInlineSnapshot(`
			"parent dynasty-viewport, child 0 of 2
			div.dynasty-toolbar [role=toolbar aria-label=Tools for this tree]
			  button.clickable-icon.dynasty-tool.dynasty-add-person.dynasty-tool-main [aria-label=Add person: add a person to the tree type=button]
			    span.dynasty-tool-icon
			    span.dynasty-tool-text "Add person"
			  button.clickable-icon.dynasty-tool.dynasty-find [aria-label=Find a person in the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-focus [aria-label=Focus on a person in the tree type=button aria-haspopup=true aria-expanded=false]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-fit [aria-label=Fit the tree in the view type=button]
			    span.dynasty-tool-icon
			  span.dynasty-sep.dynasty-sep-a [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-houses-button [aria-label=Houses: edit the houses of the tree type=button]
			    span.dynasty-tool-icon
			  button.clickable-icon.dynasty-tool.dynasty-titles-button [aria-label=Titles: edit the titles of the tree type=button]
			    span.dynasty-tool-icon
			  span.dynasty-sep.dynasty-sep-b [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-more [aria-label=Show more actions type=button aria-haspopup=true]
			    span.dynasty-tool-icon
			  span.dynasty-grow [aria-hidden=true]
			  button.clickable-icon.dynasty-tool.dynasty-close [aria-label=Close the full-screen view type=button]
			    span.dynasty-tool-icon"
		`);
	});
});

describe('toolbarIn', () => {
	it('makes a bar with its role and label, first in the parent; a button has an icon span, the class `dynasty-tool` and an aria-label', () => {
		installDom();
		const parent = new FEl('div');
		parent.createDiv('before');
		const { bar, button } = toolbarIn(parent as never);
		expect(parent.children[0]).toBe(bar);
		expect(dump(bar as never)).toBe('div.dynasty-toolbar [role=toolbar aria-label=Tools for this tree]');
		const b = button('search', 'Find', 'dynasty-find') as unknown as FEl;
		expect(b.parentElement).toBe(bar);
		expect(dump(b)).toContain('button.clickable-icon.dynasty-tool.dynasty-find [aria-label=Find type=button]');
		expect(b.children.map((c) => [...c.classes].join('.'))).toEqual(['dynasty-tool-icon']);
	});

	it('with `first` false, the bar stays where it was made (the end of the parent)', () => {
		const parent = new FEl('div');
		parent.createDiv('before');
		const { bar } = toolbarIn(parent as never, false);
		expect(parent.children[1]).toBe(bar);
	});
});

describe('watchLate: the observer that waits for the section of a block in a callout (steward T2)', () => {
	type Spied = { lateResolve: () => void; updateEditUi: () => void; readThemeSoon: (v: unknown) => void; keepHeight: () => void };
	const proto = TreeView.prototype as unknown as Spied;

	/** A tree in a note with no viewport to size (an error, an empty tree or a bar), as the plugin's code-block processor makes it. */
	async function mount(source: string): Promise<void> {
		const host = fakeHost();
		const handle = fakeHandle('n.md', source);
		Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
		const el = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 3, text: '' }), addChild: () => {} };
		new TreeView(host as never, el as never, source, { kind: 'embed', ctx } as never).load();
		await settle();
	}

	/** Resizes everything that is watched and counts what the observer ran. */
	function afterResize(mount: () => Promise<unknown>) {
		return async () => {
			await mount();
			const late = vi.spyOn(proto, 'lateResolve');
			const edit = vi.spyOn(proto, 'updateEditUi');
			const theme = vi.spyOn(proto, 'readThemeSoon');
			const height = vi.spyOn(proto, 'keepHeight');
			resizeAll();
			flushFrames();
			return { late: late.mock.calls.length, edit: edit.mock.calls.length, theme: theme.mock.calls.length, height: height.mock.calls.length };
		};
	}

	it('the error box asks for the section and refreshes the edit controls', async () => {
		desktop();
		const ran = await afterResize(() => mount(BROKEN))();
		expect(ran.late).toBeGreaterThan(0);
		expect(ran.edit).toBeGreaterThan(0);
	});

	it('the empty tree asks for the section and refreshes the edit controls', async () => {
		desktop();
		const ran = await afterResize(() => mount(EMPTY))();
		expect(ran.late).toBeGreaterThan(0);
		expect(ran.edit).toBeGreaterThan(0);
	});

	it('the phone list asks for the section, refreshes the edit controls, reads the theme and keeps the height', async () => {
		phone();
		const ran = await afterResize(() => embed(BODY_16, { handle: fakeHandle('n.md', BODY_16) }))();
		expect(ran.late).toBeGreaterThan(0);
		expect(ran.edit).toBeGreaterThan(0);
		expect(ran.theme).toBeGreaterThan(0);
		expect(ran.height).toBeGreaterThan(0);
	});

	it('the bar of a very large tree in a note asks for the section and does nothing more', async () => {
		desktop();
		const ran = await afterResize(() => mount(flat(FIRST_LIMIT + 1)))();
		expect(ran.late).toBeGreaterThan(0);
		expect(ran.edit).toBe(0);
		expect(ran.theme).toBe(0);
	});
});

describe('press: the one click guard of the edit window (steward E1)', () => {
	type Presser = { saving: boolean };
	const press = (self: Presser, run: () => void): void => (EditSheetBase.prototype as unknown as { press(this: Presser, run: () => void): void }).press.call(self, run);

	it('runs the action when no write runs', () => {
		const run = vi.fn();
		press({ saving: false }, run);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('does nothing while a write runs', () => {
		const run = vi.fn();
		press({ saving: true }, run);
		expect(run).not.toHaveBeenCalled();
	});

	it('a failing action leaves no exception and is written to the console once', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const boom = new Error('boom');
		expect(() => press({ saving: false }, () => { throw boom; })).not.toThrow();
		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith('Crown and Kin: the sheet action failed', boom);
	});

	it('the buttons, the links and the rows of the sheet all use it (no copy of the guard is left)', () => {
		for (const f of ['edit-sheet-family', 'edit-sheet-portrait']) {
			const text = readFileSync(`src/obsidian/${f}.ts`, 'utf8');
			expect(text, f).not.toContain('the sheet action failed');
			expect(text, f).toContain('this.press(');
		}
	});
});
