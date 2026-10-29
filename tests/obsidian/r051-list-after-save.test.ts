import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findBlocks } from '../../src/core/block-locate';
import { BlockBinding } from '../../src/obsidian/block-binding';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import { applyOp } from '../../src/core/yaml-edit';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { MarkdownView, TFile, openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHost, phone, sheets, type Host } from '../acceptance/tree-view-fakes';
import { stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * r051 cause A (iPhone test 9c of 0.5.0): the phone list tapped on Roderick, his window opened, Died changed, Save: the list went back to Aldric.
 *
 * Cause: Obsidian builds a NEW tree view for the changed block as soon as the note file changes. If that view is built in the gap between the file
 * write (`vault.process`) and the line that gives the handle its new body, the handle still has the OLD body. `BlockBinding` then dropped it as
 * `peeked`, the new view drew from a fresh block state (no session choice, no last saved person), and the list started on the oldest parent.
 * Fix: while a write of the handle runs, `peekFor` accepts that handle for the view STATE only, and only for a view of the text that the write puts in the file
 * (`pendingBody`). A view of any other text (a block that an outside change moved to that place) takes no state.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const PEOPLE = `people:
  - {id: aldric, name: Aldric, sex: m, born: 1102, died: 1161}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: roderick, name: Roderick, sex: m, born: 1131, parents: [aldric, isolde]}
  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick]}
unions:
  - {partners: [aldric, isolde], type: marriage}
`;

const centre = (el: FEl) => el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-focus');

const redraw = async () => {
	await settle();
	await settle();
	resizeAll();
	flushFrames();
};

/**
 * `gap`: the new view of the changed block is built while the handle still has its old body (the file has changed, the handle has not been told).
 * Without `gap` the handle already has the new body when the new view is built (the order in the desktop harness).
 */
async function run(gap: boolean) {
	phone();
	const host: Host = fakeHost();
	const handle = writingHandle(PEOPLE);
	let second: Awaited<ReturnType<typeof embed>> | null = null;
	handle.write.mockImplementation((async (op: never) => {
		const r = applyOp(handle.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		if (gap) {
			// Obsidian renders the changed section again at the `modify` event; the handle gets its new body only afterwards.
			handle.writeRuns++;
			handle.pendingBody = r.body;
			second = await embed(r.body, { host, handle });
			handle.writeRuns--;
			handle.pendingBody = null;
			handle.body = r.body;
			handle.change(r.body);
		} else {
			handle.body = r.body;
			handle.change(r.body);
			second = await embed(r.body, { host, handle });
		}
		return { ok: true, body: r.body, created: r.created, effects: r.effects ?? [] };
	}) as never);
	const first = await embed(PEOPLE, { host, handle });
	expect(centre(first.el)).toBe('aldric');
	// Test 9 steps 4 to 8: tap the child, tap the large row, type the year, Save.
	dispatch(first.el.querySelector('.dynasty-list-row[data-person="roderick"] .dynasty-list-go')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await redraw();
	expect(centre(first.el)).toBe('roderick');
	dispatch(first.el.querySelector('.dynasty-list-row[data-person="roderick"] .dynasty-list-edit')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	expect(sheets()).toHaveLength(1);
	const modal = (sheets()[0] as unknown as { modalEl: FEl }).modalEl;
	const died = modal.querySelector('[data-field="died"] input')!;
	died.value = '1190';
	dispatch(died, 'input');
	dispatch(modal.querySelector('.dynasty-sheet-save')!, 'click');
	await redraw();
	await redraw();
	expect(handle.body).toContain('1190');
	expect(second).not.toBeNull();
	return { first, second: second! };
}

describe('r051 cause A: the list after a Save in a person window', () => {
	it('control: the new view is built after the handle has its new body: the list stays on Roderick', async () => {
		const { first, second } = await run(false);
		expect(centre(second.el)).toBe('roderick');
		expect(centre(first.el)).toBe('roderick');
	});

	it('the new view is built before the handle has its new body: the list must stay on Roderick', async () => {
		const { second } = await run(true);
		expect(centre(second.el)).toBe('roderick');
	});
});

describe('r051 cause A: the same gap in the canvas view', () => {
	it('the new view is built before the handle has its new body: the session focus (Roderick) must stay', async () => {
		desktop();
		const host: Host = fakeHost();
		const handle = writingHandle(PEOPLE);
		const first = await embed(PEOPLE, { host, handle });
		TreeView.focusState(host as never, handle.state, 'roderick');
		await redraw();
		expect(first.el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-focus')).toBe('roderick');
		// A write by any window (here a field of Aldric): the new view of the block is built in the gap.
		const next = applyOp(handle.body, { kind: 'set-person-fields', id: 'aldric', fields: { died: '1162' } } as never);
		expect(next.ok).toBe(true);
		const body = (next as { body: string }).body;
		handle.writeRuns = 1;
		handle.pendingBody = body;
		const second = await embed(body, { host, handle });
		expect(second.el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-focus')).toBe('roderick');
	});
});

/*
 * The same gap with the real registry and the real binding: the view's state comes from the handle of the block at its place while a write runs,
 * and a view still writes only through a handle whose body is what it rendered.
 */
const fence = (body: string) => ['```kin', body, '```'].join('\n');
const X = 'people:\n  - id: a\n    name: Alys';
const X2 = 'people:\n  - id: a\n    name: Alys\n    title: Queen';
const Y = 'people:\n  - id: y\n    name: Yara';
const NOTE = [fence(X), '', fence(Y), ''].join('\n');
const NOTE2 = [fence(X2), '', fence(Y), ''].join('\n');
const NEW = 'people:\n  - id: n\n    name: Nora';
const queen = { kind: 'set-person-fields', id: 'a', fields: { title: 'Queen' } } as const;

/** A vault with one note; `inGap` runs after the new text is in the file and before `process` returns, which is the gap. With `failAfter` the write then fails. */
function world(inGap: (text: string) => Promise<void> | void, failAfter = false) {
	let text = NOTE;
	const file = new TFile('n.md', 'md');
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (p === 'n.md' ? file : null),
			read: async () => text,
			process: async (_f: unknown, fn: (t: string) => string) => {
				const old = text;
				text = fn(text);
				await inGap(text);
				if (failAfter) {
					// The new text never lands on disk: the view was built for text that is not in the file.
					text = old;
					throw new Error('disk full');
				}
				return text;
			},
		},
		workspace: { getLeavesOfType: () => [] },
	};
	return { reg: new HandleRegistry(app as never), get: () => text };
}

/** The same note open in Live Preview: the write is one editor change, and `inGap` runs inside it, before the handle has its new body. */
function editorWorld(inGap: (text: string) => void) {
	let text = NOTE;
	const file = new TFile('n.md', 'md');
	const view = Object.assign(new MarkdownView(), {
		file,
		getMode: () => 'source',
		editor: {
			getValue: () => text,
			offsetToPos: (o: number) => o,
			transaction: () => undefined,
			cm: {
				get state() {
					return { doc: { length: text.length } };
				},
				dispatch: (t: { changes: { from: number; to: number; insert: string } }) => {
					text = text.slice(0, t.changes.from) + t.changes.insert + text.slice(t.changes.to);
					inGap(text);
				},
			},
		},
	});
	const app = {
		vault: { getAbstractFileByPath: (p: string) => (p === 'n.md' ? file : null), read: async () => text, process: async () => text },
		workspace: { getLeavesOfType: () => [{ view }] },
	};
	return { reg: new HandleRegistry(app as never), get: () => text };
}

async function handleOf(reg: HandleRegistry, text: string, ordinal: number) {
	const b = findBlocks(text)[ordinal];
	return (await reg.resolve('n.md', { text, lineStart: b.openLine, lineEnd: b.openLine + b.body.split('\n').length + 1 } as never, b.body))!;
}

/** The binding of a new view of block `ordinal` of `text`, as Obsidian builds it. */
function bindingOf(reg: HandleRegistry, text: string, ordinal: number) {
	const b = findBlocks(text)[ordinal];
	const source = b.body;
	const info = { text, lineStart: b.openLine, lineEnd: b.openLine + source.split('\n').length + 1 };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => info };
	const owner = { source: () => source, unloaded: () => false, guard: (fn: () => void) => fn(), updateEditUi() {}, render() {}, showPlaceholder() {}, changed() {} };
	return new BlockBinding({ handles: reg, looseStates: new Map() }, { win: window } as never, { kind: 'embed', ctx } as never, owner as never);
}

describe('r051 cause A: the binding with the real registry', () => {
	it('a view built while the write runs takes the state of the block, and writes through the handle once it has the new body', async () => {
		let during: BlockBinding | null = null;
		const w = world((text) => {
			during = bindingOf(w.reg, text, 0);
		});
		const h = await handleOf(w.reg, NOTE, 0);
		h.state.lastEdited = 'a';
		expect(await h.write(queen)).toMatchObject({ ok: true });
		expect(w.get()).toBe(NOTE2);
		expect(during!.peeked).toBe(h);
		expect(during!.peeked!.state.lastEdited).toBe('a');
		const ready = await during!.ready;
		expect(ready).toBe(h);
		during!.attach(ready);
		expect(await during!.validHandle()).toBe(h);
	});

	it('a write that fails in the gap: the view keeps the state, but it does not write through the handle with the old body', async () => {
		let during: BlockBinding | null = null;
		const w = world((text) => {
			during = bindingOf(w.reg, text, 0);
		}, true);
		const h = await handleOf(w.reg, NOTE, 0);
		h.state.lastEdited = 'a';
		expect(await h.write(queen)).toMatchObject({ ok: false });
		expect(during!.peeked).toBe(h);
		expect(h.body).toBe(X);
		// The view rendered the new body; the handle still has the old one, so the view has no handle to write through.
		expect(await during!.validHandle()).toBeNull();
		expect(h.writeRuns).toBe(0);
	});

	it('the view of the other block in the note takes its own handle, not the one that is written', async () => {
		let other: BlockBinding | null = null;
		let same: BlockBinding | null = null;
		const w = world((text) => {
			other = bindingOf(w.reg, text, 1);
			same = bindingOf(w.reg, text, 0);
		});
		const h0 = await handleOf(w.reg, NOTE, 0);
		const h1 = await handleOf(w.reg, NOTE, 1);
		h0.state.lastEdited = 'a';
		h1.state.lastEdited = 'y';
		await h0.write(queen);
		expect(other!.peeked).toBe(h1);
		expect(other!.peeked!.state.lastEdited).toBe('y');
		expect(same!.peeked).toBe(h0);
	});

	it('a write runs on block 1: a view of block 2 whose handle body differs takes no state', async () => {
		let other: BlockBinding | null = null;
		const w = world((text) => {
			// Block 2 changed outside the plugin and the registry has not read it: its handle is stale, not "one step behind".
			other = bindingOf(w.reg, text.replace('Yara', 'Yvonne'), 1);
		});
		const h0 = await handleOf(w.reg, NOTE, 0);
		const h1 = await handleOf(w.reg, NOTE, 1);
		h1.state.lastEdited = 'y';
		await h0.write(queen);
		expect(h1.writeRuns).toBe(0);
		expect(other!.peeked).toBeNull();
	});

	it('a view built after the write has ended: the same handle by body, and no state for a body that differs', async () => {
		const w = world(() => {});
		const h = await handleOf(w.reg, NOTE, 0);
		await h.write(queen);
		expect(h.writeRuns).toBe(0);
		expect(bindingOf(w.reg, NOTE2, 0).peeked).toBe(h);
		// F-VIEW-03: with no write running, a handle whose body differs belongs to another block.
		expect(bindingOf(w.reg, NOTE, 0).peeked).toBeNull();
	});

	it('a second pane of the same note built in the gap takes the state too', async () => {
		let first: BlockBinding | null = null;
		let second: BlockBinding | null = null;
		const w = world((text) => {
			first = bindingOf(w.reg, text, 0);
			second = bindingOf(w.reg, text, 0);
		});
		const h = await handleOf(w.reg, NOTE, 0);
		h.state.lastEdited = 'a';
		await h.write(queen);
		expect(first!.peeked).toBe(h);
		expect(second!.peeked).toBe(h);
	});

	it('the editor path: a view built during the editor write takes the state, and the write leaves nothing pending', async () => {
		let during: BlockBinding | null = null;
		let pending: string | null = null;
		const ref: { h?: Awaited<ReturnType<typeof handleOf>> } = {};
		const w = editorWorld((text) => {
			pending = ref.h!.pendingBody;
			during = bindingOf(w.reg, text, 0);
		});
		const h = (ref.h = await handleOf(w.reg, NOTE, 0));
		h.state.lastEdited = 'a';
		expect(await h.write(queen)).toMatchObject({ ok: true });
		expect(h.lastWritePath).toBe('transaction');
		expect(w.get()).toBe(NOTE2);
		expect(pending).not.toBeNull();
		expect(during!.peeked).toBe(h);
		expect(h.writeRuns).toBe(0);
		expect(h.pendingBody).toBeNull();
	});

	it('the editor path: a block that an outside change put at the place takes no state', async () => {
		let inserted: BlockBinding | null = null;
		const w = editorWorld((text) => {
			inserted = bindingOf(w.reg, [fence(NEW), '', text].join('\n'), 0);
		});
		const h = await handleOf(w.reg, NOTE, 0);
		h.state.lastEdited = 'a';
		await h.write(queen);
		expect(inserted!.peeked).toBeNull();
	});

	it('pendingBody is set during the file write and cleared after a write, a failed write and a refused edit', async () => {
		let seen: string | null = null;
		const w = world(() => {
			seen = h.pendingBody;
		});
		const h = await handleOf(w.reg, NOTE, 0);
		await h.write(queen);
		expect(seen).toBe(X2);
		expect(h.pendingBody).toBeNull();
		const f = world(() => {}, true);
		const hf = await handleOf(f.reg, NOTE, 0);
		await hf.write(queen);
		expect(hf.pendingBody).toBeNull();
		const r = world(() => {});
		const hr = await handleOf(r.reg, NOTE, 0);
		await hr.write({ kind: 'set-person-fields', id: 'nobody', fields: { title: 'x' } } as never);
		expect(hr.pendingBody).toBeNull();
		expect(hr.writeRuns).toBe(0);
	});

	it('a block that a hand edit inserted before the written block during the write takes no state of the written handle', async () => {
		let inserted: BlockBinding | null = null;
		const w = world((text) => {
			// Sync delivers a note with a new first block while the write runs: its view is built at ordinal 0.
			inserted = bindingOf(w.reg, [fence(NEW), '', text].join('\n'), 0);
		});
		const h = await handleOf(w.reg, NOTE, 0);
		h.state.lastEdited = 'a';
		await h.write(queen);
		expect(h.writeRuns).toBe(0);
		expect(inserted!.peeked).toBeNull();
	});

	it('a block that a hand edit removed before block 1 during the write: block 1 at ordinal 0 takes no state of block 0', async () => {
		let moved: BlockBinding | null = null;
		const w = world(() => {
			moved = bindingOf(w.reg, fence(Y) + '\n', 0);
		});
		const h = await handleOf(w.reg, NOTE, 0);
		h.state.lastEdited = 'a';
		await h.write(queen);
		expect(moved!.peeked).toBeNull();
	});
});
