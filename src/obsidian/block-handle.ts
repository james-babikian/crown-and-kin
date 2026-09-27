import { MarkdownView, TFile, type App, type MarkdownSectionInformation } from 'obsidian';
import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { LocatedBlock, UndoStack, WritePlan } from '../core/block';
import { findBlocks, ordinalForSection } from '../core/block-locate';
import { relocateAll, sameBody, smallestChange, undoBlock } from '../core/block-match';
import { UNDO_LIMIT, createUndoStack, planWrite } from '../core/block-write';
import type { EditResult, Op } from '../core/edit';
import type { Orientation, SidewaysCards } from '../layout/model';
import { applyOp } from '../core/yaml-edit';
import type { View } from '../render/view-math';
import type { SessionFocus } from './focus-mode';
import type { BlockHandle, BlockKey, UndoOutcome, WriteOutcome } from './handle-contract';

/*
 * BlockHandle (spec §6.1): the one way the plugin writes a `dynasty` block. The pure steps (locate,
 * stale check, new body, undo rules, finding a block again) live in src/core; this file adds file
 * I/O, the queue, the choice between an editor transaction and `vault.process`, and the events.
 */

export { normBody, sameBody, smallestChange } from '../core/block-match';

/** Plugin memory for one block for the session (spec §5.5): kept on the handle, so it follows a rename. */
export interface BlockState {
	/** The view to restore after a re-render; set once the user moved the view, and before each write. */
	view: View | null;
	/** The person most recently edited in this block: the start person (spec §5.5). */
	lastEdited: string | null;
	/** A person to highlight and show once, in every view that renders before `until`. */
	highlight: { id: string; until: number } | null;
	/**
	 * The focus key (`focusKey`) of the tree that `view` belongs to: a view of one focus family
	 * means nothing in another, so it is used only while the same family is drawn.
	 */
	viewFor: string;
	/**
	 * The last stored view of each orientation (D24), with its `viewFor`: a turn of the phone keeps
	 * the other orientation's view. `view`/`viewFor` above are the most recent of these.
	 */
	views: Partial<Record<Orientation, { view: View; viewFor: string }>>;
	/** The session focus (spec §5.6, D18): until the note closes. */
	focus: SessionFocus | null;
	/** The focus the phone rule chose (the decision notes M5), kept so that an edit does not move it; until the note closes. */
	autoFocus: string | null;
	/**
	 * A person just saved, to show once (§5.5): the first view of `place` (the kind of view whose
	 * sheet or toolbar wrote) that renders after the write takes it, and shows all people if its
	 * family does not draw the person. A focus the user chooses clears it.
	 */
	shown: { id: string; place: ViewKind } | null;
}

/** An embed in a note, or the full-screen view. */
export type ViewKind = 'embed' | 'full';

export const newBlockState = (): BlockState => ({ view: null, lastEdited: null, highlight: null, viewFor: '', views: {}, focus: null, autoFocus: null, shown: null });

/**
 * The key of a drawn tree for `BlockState.viewFor`: the focus person and the generations, or '' for
 * the whole tree; `sideways` trees (D24) have their own keys, by card kind too (the note preview's narrow
 * cards, the full-screen view's normal cards), so a view never moves to another layout of the family.
 */
export const focusKey = (id: string | null, n = 0, orientation: Orientation = 'down', cards: SidewaysCards = 'normal') =>
	(orientation === 'sideways' ? (cards === 'narrow' ? 'sideways-narrow|' : 'sideways|') : '') + (id === null ? '' : `focus:${id}:${n}`);

/** The note closed: the session focus ends (spec §5.6, the decision notes M5). The rest of the view state stays for the session (§5.5). */
export function endSessionFocus(st: BlockState): void {
	st.focus = null;
	st.autoFocus = null;
	st.shown = null;
}

/**
 * One change as an editor transaction, so Ctrl/Cmd+Z undoes it (spec §6.1). Obsidian's
 * `Editor.transaction` always scrolls the cursor into view, which moves a long note away from the
 * tree; the editor's own CodeMirror view takes the same change without that scroll.
 */
function applyToEditor(view: MarkdownView, c: { from: number; to: number; text: string }, history = true): void {
	const ed = view.editor;
	const cm = (ed as unknown as { cm?: Pick<EditorView, 'dispatch' | 'state'> }).cm;
	if (cm && typeof cm.dispatch === 'function' && cm.state?.doc?.length === ed.getValue().length) {
		// A link update after a rename (spec §6.9) is not the user's edit: Ctrl/Cmd+Z must not bring the old link back.
		cm.dispatch({ changes: { from: c.from, to: c.to, insert: c.text }, userEvent: 'input.dynasty-tree', ...(history ? {} : { annotations: Transaction.addToHistory.of(false) }) });
		return;
	}
	ed.transaction({ changes: [{ from: ed.offsetToPos(c.from), to: ed.offsetToPos(c.to), text: c.text }] }, 'dynasty-tree');
}

const keyString = (path: string, ordinal: number) => `${path}\u0000#${ordinal}`;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The plugin undo stack of a handle (core `UndoStack`), with a copy of its entries, so that a link
 * update after a rename (spec §6.9) can rewrite every entry (the decision notes "WP6.4 fix round").
 */
class UndoLog {
	private stack = createUndoStack();
	private log: { before: string; after: string }[] = [];

	push(before: string, after: string): void {
		this.stack.push(before, after);
		this.log.push({ before, after });
		if (this.log.length > UNDO_LIMIT) this.log.splice(0, this.log.length - UNDO_LIMIT);
	}

	canUndo(body: string): boolean {
		return this.stack.canUndo(body);
	}

	undo(body: string): ReturnType<UndoStack['undo']> {
		const r = this.stack.undo(body);
		if (r.ok) this.log.pop();
		return r;
	}

	get size(): number {
		return this.stack.size;
	}

	/** Every entry through `fn`. */
	map(fn: (body: string) => string): void {
		const old = this.log;
		this.stack = createUndoStack();
		this.log = [];
		for (const e of old) this.push(fn(e.before), fn(e.after));
	}
}

/** Most maintenance steps a handle remembers for `followed` (the delete Notice's Undo, spec §6.1). */
const MAINTAINED_MAX = 20;

type Listener = (body: string) => void;

/**
 * A successful write also names its side effects (M3: `auto-union`, spec §6.4), for the Notice, and
 * for `rewrite-links` the number of links changed (M6, spec §6.9).
 */
export type Written = Extract<WriteOutcome, { ok: true }> & { effects: 'auto-union'[]; changed?: number };

/**
 * How a write is kept. `user`: the user's edit, on the plugin undo stack and in the editor's history.
 * `maintenance`: a link update after a rename (spec §6.9, the decision notes "M6 design gate"): on neither,
 * and it does not become the target of "Undo last tree edit"; the undo entries are carried over it.
 */
export type WriteKind = 'user' | 'maintenance';
export type HandleWriteOutcome = Exclude<WriteOutcome, { ok: true }> | Written;

export class Handle implements BlockHandle {
	/** `expectedBody` (§6.1): only ever our own write, or an unambiguous re-read of this block. */
	body: string;
	/** Number of `dynasty` blocks in the note when `body` was taken; tells whether blocks moved. */
	count: number;
	/**
	 * The plugin cannot tell which block this handle meant any more (blocks were added or removed
	 * and the body is not unique). It keeps its body and undo entries but refuses writes.
	 */
	detached = false;
	readonly state: BlockState = newBlockState();
	/** How the last write reached the note (read by the test harness, spec §12 question 1). */
	lastWritePath: 'transaction' | 'process' | null = null;
	private readonly undoStack = new UndoLog();
	/** Bodies that a maintenance write (spec §6.9) replaced, with what it wrote: `followed` reads them. */
	private readonly maintained = new Map<string, string>();
	private tail: Promise<unknown> = Promise.resolve();
	private readonly listeners = new Set<Listener>();

	constructor(
		private readonly reg: HandleRegistry,
		public key: BlockKey,
		body: string,
		count: number,
	) {
		this.body = body;
		this.count = count;
	}

	get canUndo(): boolean {
		return !this.detached && this.undoStack.canUndo(this.body);
	}

	get undoSize(): number {
		return this.undoStack.size;
	}

	/**
	 * `body` as maintenance writes (link updates after a rename) changed it since: an Undo button that
	 * remembers the body its action wrote still acts after a link update (the decision notes "WP6.4 fix round").
	 */
	followed(body: string): string {
		let at = body;
		for (let i = 0; i < MAINTAINED_MAX && this.maintained.has(at); i++) at = this.maintained.get(at)!;
		return at;
	}

	/**
	 * Rewrites every undo entry with `fn` (spec §6.9): after a rename, an undo never brings back a link
	 * to the old name, also in a tree that the rename did not write.
	 */
	mapUndo(fn: (body: string) => string): void {
		this.undoStack.map((b) => {
			try {
				return fn(b);
			} catch {
				return b;
			}
		});
	}

	onChanged(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Tells every view of this block that its body, its place or its state changed. */
	notify(): void {
		const body = this.body;
		for (const l of [...this.listeners]) {
			try {
				l(body);
			} catch (e) {
				console.error('Dynasty Tree: a tree view failed to update', e);
			}
		}
	}

	/** Runs `fn` after every earlier queued task: writes on one handle never overlap. */
	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.tail.then(fn, fn);
		this.tail = run.catch(() => undefined);
		return run;
	}

	/** Reads the note again and updates every handle of it (see `HandleRegistry.sync`). */
	refresh(): Promise<void> {
		return this.reg.sync(this.key.path);
	}

	/** A view rendered `source`: if the handle holds another body, the note changed. Never takes `source` as the body. */
	seen(source: string): void {
		if (!sameBody(source, this.body)) void this.refresh();
	}

	write(op: Op, kind: WriteKind = 'user'): Promise<HandleWriteOutcome> {
		return this.enqueue(async (): Promise<HandleWriteOutcome> => {
			if (this.detached) return { ok: false, code: 'missing' };
			let result: EditResult | null = null;
			let out: Awaited<ReturnType<Handle['apply']>>;
			const edit = (body: string) => {
				result = applyOp(body, op);
				return result.ok ? { ok: true as const, body: result.body } : { ok: false as const, reason: result.code };
			};
			const mode = kind === 'maintenance' ? ({ kind: 'maintenance', op } as const) : ('user' as const);
			try {
				const expected = this.body;
				out = await this.apply(expected, edit, mode);
				// The block only moved (a block was added or removed elsewhere) and its text is what the
				// user saw: the edit still means this block, so write it at its new place.
				if (out === 'stale' && !this.detached && this.body === expected) out = await this.apply(expected, edit, mode);
			} catch (e) {
				// §8: a failed file write is an outcome for the caller, never an unhandled rejection.
				console.error('Dynasty Tree: cannot write the note', e);
				return { ok: false, code: 'refused', refusal: { ok: false, code: 'bad-value', detail: e instanceof Error ? e.message : String(e) } };
			}
			if (out === 'written') {
				const r = result as EditResult | null;
				return { ok: true, body: this.body, created: r?.ok ? r.created : [], effects: r?.ok ? (r.effects ?? []) : [], ...(r?.ok && r.changed !== undefined ? { changed: r.changed } : {}) };
			}
			if (out === 'rejected') {
				const r = result as EditResult | null;
				const refusal = r && !r.ok ? r : { ok: false as const, code: 'bad-value' as const };
				return { ok: false, code: 'refused', refusal };
			}
			return { ok: false, code: out };
		});
	}

	/**
	 * Plugin undo (D8). The block to restore is the one block of the note whose body is exactly what
	 * the plugin last wrote for this handle; with none or several (a copy was pasted), undo refuses.
	 */
	undo(): Promise<UndoOutcome> {
		return this.enqueue(async () => {
			if (this.undoStack.size === 0) return { ok: false, code: 'empty' };
			const text = await this.reg.readText(this.key.path);
			if (text === null) return { ok: false, code: 'missing' };
			const blocks = findBlocks(text);
			const at = undoBlock(
				blocks.map((b) => b.body),
				(b) => this.undoStack.canUndo(b),
			);
			if (at === null) return { ok: false, code: 'changed' };
			if (at !== this.key.ordinal || this.detached) this.reg.rekey(this, at, blocks.length);
			this.body = blocks[at].body;
			this.count = blocks.length;
			const step = this.undoStack.undo(this.body);
			if (!step.ok) return step;
			let out: Awaited<ReturnType<Handle['apply']>>;
			try {
				out = await this.apply(this.body, () => ({ ok: true, body: step.body }), 'undo');
			} catch (e) {
				console.error('Dynasty Tree: cannot write the note', e);
				out = 'rejected';
			}
			if (out === 'written') return { ok: true, body: this.body };
			// The entry was taken but not written: put it back so a later try can still undo.
			this.undoStack.push(step.body, blocks[at].body);
			return { ok: false, code: out === 'missing' ? 'missing' : 'changed' };
		});
	}

	/**
	 * Steps 1–6 of spec §6.1. With the note open in an editor, the change goes through an editor
	 * transaction (Ctrl/Cmd+Z undoes it); otherwise through `vault.process`, all steps inside it.
	 */
	private async apply(
		expected: string,
		edit: (body: string) => { ok: true; body: string } | { ok: false; reason: string },
		mode: 'user' | 'undo' | { kind: 'maintenance'; op: Op },
	): Promise<'written' | 'stale' | 'missing' | 'rejected'> {
		const maintenance = typeof mode === 'object';
		const path = this.key.path;
		const file = this.reg.file(path);
		if (!file) return 'missing';
		let plan: WritePlan = { ok: false, code: 'missing' };
		let seen: string | null = null;
		// The count follows the handle: the note can be renamed while the write runs.
		const done = this.reg.beginWrite(() => this.key.path);
		try {
			const view = this.reg.editorView(path);
			if (view) {
				const text = view.editor.getValue();
				seen = text;
				plan = planWrite(text, this.key.ordinal, expected, edit);
				if (plan.ok) {
					applyToEditor(view, smallestChange(text, plan.newText), !maintenance);
					this.lastWritePath = 'transaction';
				}
			} else {
				await this.reg.app.vault.process(file, (text) => {
					seen = text;
					plan = planWrite(text, this.key.ordinal, expected, edit);
					return plan.ok ? plan.newText : text;
				});
				if (plan.ok) this.lastWritePath = 'process';
			}
		} finally {
			done();
		}
		if (!plan.ok) {
			// Spec §6.1: abort and re-read. The re-read follows the identity rules, so the handle
			// never takes another block's body; every view and an open sheet refresh from `changed`.
			if ((plan.code === 'stale' || plan.code === 'missing') && seen !== null) this.reg.applyText(this.key.path, seen);
			return plan.code;
		}
		if (mode === 'user') this.undoStack.push(plan.oldBody, plan.newBody);
		else if (maintenance) this.carryUndo(plan.oldBody, plan.newBody, mode.op);
		this.body = plan.newBody;
		this.count = findBlocks(plan.newText).length;
		if (!maintenance) this.reg.noteWrite(this);
		this.notify();
		return 'written';
	}

	/**
	 * A link update changed the block under the user's own edits: the same op is applied to every undo
	 * entry, so "Undo last tree edit" still undoes the user's edit and keeps the new links. An entry the
	 * op cannot change stays as it was (a later undo then refuses safely).
	 */
	private carryUndo(before: string, after: string, op: Op): void {
		this.mapUndo((body) => {
			const r = applyOp(body, op);
			return r.ok ? r.body.replace(/\r\n?/g, '\n') : body;
		});
		this.maintained.set(before, after);
		while (this.maintained.size > MAINTAINED_MAX) this.maintained.delete(this.maintained.keys().next().value!);
	}
}

/** One handle per block of a note, shared by every view of that block (spec §6.1). */
export class HandleRegistry {
	private readonly handles = new Map<string, Handle>();
	private writeOrder: Handle[] = [];
	/** Writes in progress per note, and a count of finished ones: a read that overlaps a write is not used. */
	private readonly writing = new Map<string, number>();
	private readonly written = new Map<string, number>();

	constructor(readonly app: App) {}

	file(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile && f.extension === 'md' ? f : null;
	}

	/**
	 * A Markdown view that shows the note, for the editor-transaction write path. A view in Live
	 * Preview or source mode comes first, because Ctrl/Cmd+Z works only there. See the decision notes
	 * (spec §12 question 1) for the Reading view.
	 */
	editorView(path: string): MarkdownView | null {
		let reading: MarkdownView | null = null;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const v = leaf.view;
			if (!(v instanceof MarkdownView) || v.file?.path !== path) continue;
			if (v.getMode() === 'source') return v;
			reading ??= v;
		}
		return READING_VIEW_USES_EDITOR ? reading : null;
	}

	/**
	 * The note text a write starts from: the Live Preview or source editor if one shows the note
	 * (it can be newer than the file), else the file. A view in Reading view can lag behind the file.
	 */
	async readText(path: string): Promise<string | null> {
		const view = this.editorView(path);
		if (view) return view.editor.getValue();
		const file = this.file(path);
		if (!file) return null;
		try {
			return await this.app.vault.read(file);
		} catch (e) {
			console.error('Dynasty Tree: cannot read the note', e);
			return null;
		}
	}

	/** True if `el` is inside a Live Preview or source editor that shows the note `path`. */
	inEditorOf(el: HTMLElement, path: string): boolean {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === path && v.getMode() === 'source' && v.containerEl.contains(el)) return true;
		}
		return false;
	}

	/** The note text from a Live Preview or source editor, or null when none shows the note. Synchronous. */
	textNow(path: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === path && v.getMode() === 'source') return v.editor.getValue();
		}
		return null;
	}

	/** The handle for a key if it exists. */
	peek(path: string, ordinal: number): Handle | null {
		return this.handles.get(keyString(path, ordinal)) ?? null;
	}

	private attached(path: string): Handle[] {
		return [...this.handles.values()].filter((h) => h.key.path === path);
	}

	/**
	 * Counts a write of the note at `path()` until the returned function runs. The path is read again at
	 * the end: `renamed` moves the counts to the new path while a write runs.
	 */
	beginWrite(path: () => string): () => void {
		const start = path();
		this.writing.set(start, (this.writing.get(start) ?? 0) + 1);
		let ended = false;
		return () => {
			if (ended) return;
			ended = true;
			const now = path();
			this.writing.set(now, Math.max(0, (this.writing.get(now) ?? 1) - 1));
			this.written.set(now, (this.written.get(now) ?? 0) + 1);
		};
	}

	/**
	 * Reads the note and updates every handle of it (`applyText`). A read that overlaps a write of
	 * the same note is thrown away and made again, so an old text never replaces a newer body.
	 */
	async sync(path: string): Promise<void> {
		for (let i = 0; i < 20; i++) {
			if ((this.writing.get(path) ?? 0) > 0) {
				await pause(25);
				continue;
			}
			const read = await this.readOnce(path);
			if (!read) return;
			if (!read.fresh) continue;
			this.applyText(path, read.text);
			return;
		}
	}

	/**
	 * One read of the note. `fresh` is false if a write of the same note ran at any time during the
	 * read: then the text can be older than the handles' bodies and must not replace them.
	 */
	private async readOnce(path: string): Promise<{ text: string; fresh: boolean } | null> {
		const busy = (this.writing.get(path) ?? 0) > 0;
		const gen = this.written.get(path) ?? 0;
		const text = await this.readText(path);
		if (text === null) return null;
		const fresh = !busy && (this.writing.get(path) ?? 0) === 0 && (this.written.get(path) ?? 0) === gen;
		return { text, fresh };
	}

	/**
	 * Finds each handle's block again in `text` (rules in `relocate`, src/core/block-match.ts): a
	 * handle keeps or changes its ordinal, and takes the new body of that block; a handle that
	 * cannot be placed safely is detached. Handles whose body or place changed emit `changed`.
	 */
	applyText(path: string, text: string): void {
		const bodies = findBlocks(text).map((b) => b.body);
		const list = this.attached(path);
		const rel = relocateAll(
			bodies,
			list.map((h) => ({ count: h.count, ordinal: h.key.ordinal, body: h.body })),
		);
		for (const h of list) this.handles.delete(keyString(path, h.key.ordinal));
		const changed: Handle[] = [];
		list.forEach((h, i) => {
			const r = rel[i];
			if (r.kind === 'detached') {
				h.detached = true;
				changed.push(h);
				return;
			}
			const moved = r.ordinal !== h.key.ordinal;
			h.key = { path, ordinal: r.ordinal };
			h.count = bodies.length;
			this.handles.set(keyString(path, r.ordinal), h);
			if (moved || bodies[r.ordinal] !== h.body) {
				h.body = bodies[r.ordinal];
				changed.push(h);
			}
		});
		for (const h of changed) h.notify();
	}

	/** Moves a handle to another block (an undo found its block elsewhere). A handle already there is detached. */
	rekey(h: Handle, ordinal: number, count: number): void {
		const path = h.key.path;
		if (this.handles.get(keyString(path, h.key.ordinal)) === h) this.handles.delete(keyString(path, h.key.ordinal));
		const k = keyString(path, ordinal);
		const other = this.handles.get(k);
		h.key = { path, ordinal };
		h.count = count;
		h.detached = false;
		this.handles.set(k, h);
		if (other && other !== h) {
			other.detached = true;
			other.notify();
		}
	}

	private obtain(path: string, ordinal: number, blocks: LocatedBlock[]): Handle {
		const k = keyString(path, ordinal);
		let h = this.handles.get(k);
		if (!h) {
			h = new Handle(this, { path, ordinal }, blocks[ordinal].body, blocks.length);
			this.handles.set(k, h);
		}
		return h;
	}

	/**
	 * Ordinal from the section Obsidian reports, used at once to find the block's view state.
	 * `resolve` checks it against the note text before the view can edit anything.
	 */
	quickOrdinal(info: MarkdownSectionInformation, source: string): number | null {
		return ordinalForSection(info.text, info.lineStart, info.lineEnd, source);
	}

	/**
	 * The handle for a rendered block, or null if the plugin cannot tell safely which block of the
	 * note it is (then the view is read-only). Line numbers count only if the section text is the
	 * note text; otherwise (a nested render, or the note changed since) the body must match one block.
	 * The located body must equal the rendered `source` either way.
	 */
	async resolve(path: string, info: MarkdownSectionInformation, source: string): Promise<Handle | null> {
		if (!this.file(path)) return null;
		const read = await this.readOnce(path);
		if (!read) return null;
		const text = read.text;
		// A read that overlapped a write only finds the ordinal (a write never moves blocks); the
		// handles keep their newer bodies, and a later sync reads again.
		if (read.fresh) this.applyText(path, text);
		else void this.sync(path);
		const blocks = findBlocks(text);
		// ordinalForSection compares bodies strictly; a Live Preview list item needs `sameBody`.
		const inRange = info.text === text ? blocks.filter((b) => b.openLine >= info.lineStart && b.openLine <= info.lineEnd) : [];
		let ordinal: number | null = inRange.length ? ordinalForSection(text, info.lineStart, info.lineEnd, source) : null;
		if (ordinal === null && inRange.length > 1) {
			const same = inRange.filter((b) => sameBody(b.body, source));
			if (same.length === 1) ordinal = same[0].ordinal;
		}
		if (ordinal !== null && !sameBody(blocks[ordinal]?.body ?? '', source)) ordinal = null;
		if (ordinal === null && info.text !== text) {
			// The note changed since the render, or the section is not the note: only a unique body counts.
			const same = blocks.filter((b) => sameBody(b.body, source));
			if (same.length === 1) ordinal = same[0].ordinal;
		}
		return ordinal === null || !blocks[ordinal] ? null : this.obtain(path, ordinal, blocks);
	}

	/**
	 * For a block that Obsidian renders with no section (a callout in Live Preview): the handle of
	 * the one block of the note with this body, or null if no block or several blocks have it.
	 */
	resolveByBody(path: string, source: string): Handle | null {
		if (!this.file(path)) return null;
		const text = this.textNow(path);
		if (text === null) return null;
		this.applyText(path, text);
		const blocks = findBlocks(text);
		const same = blocks.filter((b) => sameBody(b.body, source));
		return same.length === 1 ? this.obtain(path, same[0].ordinal, blocks) : null;
	}

	/**
	 * For a view with no section (the full-screen view): after its handle was detached, the handle
	 * of the one block of the note whose body is `source`, or null if none or several have it.
	 */
	async resolveUnique(path: string, source: string): Promise<Handle | null> {
		if (!this.file(path)) return null;
		await this.sync(path);
		const text = await this.readText(path);
		if (text === null) return null;
		const blocks = findBlocks(text);
		const same = blocks.filter((b) => sameBody(b.body, source));
		if (same.length !== 1) return null;
		const h = this.obtain(path, same[0].ordinal, blocks);
		return sameBody(h.body, source) && !h.detached ? h : null;
	}

	/**
	 * `ForBlock` (M6 contract, spec §6.9): the handle of block `ordinal` of a Markdown note, also of a
	 * block no view has drawn or of a closed note. The note is read as `sync` reads it (never a read that
	 * overlapped a write), every handle of the note finds its block again, and an existing handle of the
	 * block is shared. Null if the note or the block is gone.
	 */
	async forBlock(path: string, ordinal: number): Promise<Handle | null> {
		if (!this.file(path) || !Number.isInteger(ordinal) || ordinal < 0) return null;
		for (let i = 0; i < 20; i++) {
			if ((this.writing.get(path) ?? 0) > 0) {
				await pause(25);
				continue;
			}
			const read = await this.readOnce(path);
			if (!read) return null;
			if (!read.fresh) continue;
			this.applyText(path, read.text);
			const blocks = findBlocks(read.text);
			return blocks[ordinal] ? this.obtain(path, ordinal, blocks) : null;
		}
		return null;
	}

	noteWrite(h: Handle): void {
		this.writeOrder = this.writeOrder.filter((x) => x !== h);
		this.writeOrder.push(h);
	}

	/** The handle the "Undo last tree edit" command acts on: the last one written in `activePath`, else the last one written. */
	undoTarget(activePath: string | null): Handle | null {
		const withUndo = this.writeOrder.filter((h) => h.undoSize > 0);
		const inActive = withUndo.filter((h) => h.key.path === activePath);
		return inActive[inActive.length - 1] ?? withUndo[withUndo.length - 1] ?? null;
	}

	/** Re-keys the handles of a renamed note (spec §6.1), detached ones included. */
	renamed(oldPath: string, newPath: string): void {
		for (const [k, h] of [...this.handles]) {
			if (h.key.path !== oldPath) continue;
			this.handles.delete(k);
			this.handles.set(keyString(newPath, h.key.ordinal), h);
		}
		for (const h of new Set([...this.handles.values(), ...this.writeOrder])) {
			if (h.key.path === oldPath) h.key = { path: newPath, ordinal: h.key.ordinal };
		}
		for (const map of [this.writing, this.written]) {
			const v = map.get(oldPath);
			if (v !== undefined) {
				map.delete(oldPath);
				map.set(newPath, v);
			}
		}
	}

	/** Every handle the registry holds, detached ones included. */
	all(): Handle[] {
		return [...new Set([...this.handles.values(), ...this.writeOrder])];
	}

	deleted(path: string): void {
		for (const [k, h] of [...this.handles]) {
			if (h.key.path === path) this.handles.delete(k);
		}
		this.writeOrder = this.writeOrder.filter((h) => h.key.path !== path);
	}

	/** After an outside change of the note, every handle of it finds its block again. */
	modified(path: string): void {
		void this.sync(path);
	}
}

/**
 * Whether a note that is open only in Reading view is written through its (hidden) editor.
 * See the decision notes, spec §12 question 1.
 */
const READING_VIEW_USES_EDITOR = false;
