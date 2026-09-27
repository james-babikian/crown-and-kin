/*
 * Link maintenance (spec §6.9, D6, D35). After a Markdown note is renamed, every tree link that
 * pointed to it gets the new link text, one `rewrite-links` write per tree, through the tree's
 * handle (also in closed notes and in trees with blocking problems). The writes are not the user's edits: they are on neither undo stack. Nothing
 * here throws into Obsidian.
 */

import { Notice, TFile, type App, type CachedMetadata, type EventRef, type TAbstractFile } from 'obsidian';
import { findBlocks } from '../core/block-locate';
import { encode, linkTargets, normaliseTarget } from '../core/link-rewrite';
import { applyOp } from '../core/yaml-edit';
import { RENAME_UI, renamedText, type LinkReportText } from '../render/ui-text';
import type { Handle } from './block-handle';
import type { PendingRename } from './settings';

/** What the updater needs from the handle registry (`HandleRegistry.forBlock`). */
export interface BlockSource {
	/** The handle of block `ordinal` of the note at `path`, or null if the note or the block is gone. */
	forBlock(path: string, ordinal: number): Promise<Pick<Handle, 'body' | 'write'> | null>;
	/** Every handle: their undo entries follow the rename too. */
	all(): Iterable<Pick<Handle, 'key' | 'mapUndo'>>;
}

/** What the plugin gives the updater besides the handles. */
export interface LinkHooks {
	/** Stores `pendingList()` in `data.json` (with the settings). */
	save?(): Promise<void>;
	/** Notes that show a tree now: the updater reads them first. */
	known?(): Iterable<string>;
}

/** How long the updater waits, in ms (tests make them short). */
export interface RenameTiming {
	/** Longest wait for the metadata cache's `resolved` event after a rename. */
	resolved: number;
	/** Then: no metadata change for this long. */
	quiet: number;
	/** Upper limit of the quiet wait. */
	cap: number;
	/** The progress Notice comes if the update runs longer than this after the rename. */
	progress?: number;
}

/** The default timing `LinkUpdater` uses outside tests. */
export const RENAME_TIMING: RenameTiming = { resolved: 2000, quiet: 300, cap: 5000, progress: 2000 };

interface Renamed {
	file: TFile;
	oldPath: string;
	/**
	 * The notes that the old link text could open at the rename, other than the renamed note. Only a
	 * link that opens one of these stays as it is: a note made later (for example by a tap on the old
	 * link, which makes Obsidian create an empty note of that name) never stops the update.
	 */
	others: Set<TFile>;
}

/** A tree whose links the plugin could not change: the note, one old link and its new text. */
interface Failure {
	path: string;
	old: string;
	next: string;
}

/** A link that named a renamed note but now opens one of its `others`. */
interface Kept {
	link: string;
	other: string;
}

/** One tree after its update: links changed and kept, a failure, no more trees in the note (`gone`), or no link to a renamed note (null). */
type TreeResult = { changed: number; kept: Kept[] } | { failed: Failure } | 'gone' | null;

/** What the scan of the notes found, for the Notices at the end. */
interface ScanResult {
	/** Trees with a changed link. */
	trees: number;
	failures: Failure[];
	/** The first kept link of each tree that has kept links and no changed link. */
	kept: (Kept & { path: string })[];
}

/** Where one update is: the progress Notice comes only while it can still lead to a change. */
interface Progress {
	found: boolean;
	scanned: boolean;
	shown: Notice | null;
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The last part of a path, without `.md`, lower case: the "old basename" of spec §6.9. */
const baseName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '').toLowerCase();
const shownPath = (path: string) => path.replace(/\.md$/i, '');

/** The report of an update that starts now, for the renames of `batch`. */
function newReport(batch: Renamed[]): LinkReportText {
	return {
		renames: batch.map((r) => ({ from: shownPath(r.oldPath), to: shownPath(r.file.path) })),
		state: 'running',
		ms: 0,
		notes: 0,
		read: 0,
		unread: 0,
		trees: 0,
		links: 0,
		changedTrees: 0,
		skipped: [],
		failed: [],
	};
}

/** The name part of a link as the metadata cache stores it (`Folder/Name#Heading`). */
function linkBase(link: string): string {
	let t = link.split('#')[0].split('|')[0];
	try {
		t = decodeURI(t);
	} catch {
		// A bad escape: the text as it is.
	}
	return baseName(t.replace(/\\/g, '/'));
}

/**
 * The forms an old basename can take in note text: as typed, percent-encoded in a Markdown link (also
 * as the plugin itself writes one), and fully percent-decoded.
 */
export function nameForms(name: string): string[] {
	const forms = [name, name.replace(/ /g, '%20'), encode(name).toLowerCase()];
	try {
		forms.push(encodeURIComponent(name).toLowerCase());
	} catch {
		// A lone surrogate: the other forms are enough.
	}
	try {
		forms.push(decodeURIComponent(name).toLowerCase());
	} catch {
		// A bad escape: the name has no decoded form.
	}
	return [...new Set(forms)];
}

const isRelative = (target: string) => /^\.\.?\//.test(target);

/** The folder of a vault path ('' at the top). */
const folderOf = (path: string) => path.split('/').slice(0, -1).join('/');

/** A `./` or `../` target from the folder `from`, as a vault path (null if it leaves the vault). */
function resolveRelative(target: string, from: string): string | null {
	const parts = from ? from.split('/') : [];
	for (const seg of target.split('/')) {
		if (seg === '..') {
			if (!parts.length) return null;
			parts.pop();
		} else if (seg !== '.' && seg !== '') parts.push(seg);
	}
	return parts.join('/');
}

/** A relative link from the folder `from` to `path` (without `.md`), in the `./` / `../` style. */
function relativeTo(path: string, from: string): string {
	const a = from ? from.split('/') : [];
	const b = path.split('/');
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	const up = a.length - i;
	return (up ? '../'.repeat(up) : './') + b.slice(i).join('/');
}

/** Most failure (and "not changed") Notices after one rename; the rest are counted in one more Notice. */
const MAX_FAILURE_NOTICES = 3;
/** Sections of the metadata cache that can hold a tree: a fence, or a callout, quote or list item around one. */
const TREE_SECTIONS = new Set(['code', 'callout', 'blockquote', 'list']);
/** The scan gives the interface a turn after this long (a read from Obsidian's text cache does not wait). */
const SLICE_MS = 16;
const KEPT_NOTICE_MS = 15_000;

/** Queues renamed notes and rewrites the tree links that pointed to them, one update at a time. */
export class LinkUpdater {
	private readonly queue: Renamed[] = [];
	/** Every rename that is not handled yet: queued, or in the running update. */
	private readonly open = new Set<Renamed>();
	/** Renames from `data.json`, until `resume()` queues them. */
	private stored: PendingRename[] = [];
	private running: Promise<void> | null = null;
	private stopped = false;
	private saving: Promise<void> = Promise.resolve();
	private saveQueued = false;
	/** One index of note names for all the events of a folder rename, which come together. */
	private names: Map<string, TFile[]> | null = null;
	/** The last update, for the command "Show the last link update". */
	last: LinkReportText | null = null;

	constructor(
		private readonly app: App,
		private readonly blocks: BlockSource,
		/** The setting of spec §9 (D6), read at each rename. */
		private readonly enabled: () => boolean,
		private readonly timing: RenameTiming = RENAME_TIMING,
		private readonly hooks: LinkHooks = {},
	) {}

	/** `vault.on('rename')`. A folder rename sends one event per note; they are handled together. */
	renamed(file: TAbstractFile, oldPath: string): void {
		try {
			let moved = false;
			for (const p of this.stored) {
				if (p.newPath !== oldPath) continue;
				p.newPath = file.path;
				moved = true;
			}
			if (this.stopped || !this.enabled() || !(file instanceof TFile) || file.extension !== 'md') {
				if (moved) this.persist();
				return;
			}
			const r: Renamed = { file, oldPath, others: this.sameName(oldPath, file) };
			this.queue.push(r);
			this.open.add(r);
			this.persist();
			this.start();
		} catch (e) {
			console.error('Dynasty Tree: cannot update the links after a rename', e);
		}
	}

	/** The renames that `data.json` keeps until they are handled. */
	pendingList(): PendingRename[] {
		const open = [...this.open].map((r) => ({ oldPath: r.oldPath, newPath: r.file.path, others: [...r.others].map((f) => f.path) }));
		return [...this.stored.map((p) => ({ ...p, others: [...p.others] })), ...open];
	}

	/** At load: the renames that an earlier session did not complete. `resume()` starts them. */
	restore(list: PendingRename[]): void {
		this.stored = list.map((p) => ({ ...p, others: [...p.others] }));
	}

	/** After `onLayoutReady` (the vault's notes are known): continue the stored renames. */
	resume(): void {
		try {
			const list = this.stored.splice(0);
			if (!list.length || this.stopped) {
				this.stored = list;
				return;
			}
			if (this.enabled()) {
				const vault = this.app.vault;
				for (const p of list) {
					const file = vault.getAbstractFileByPath(p.newPath);
					if (!(file instanceof TFile) || file.extension !== 'md') continue;
					const others = new Set<TFile>();
					for (const o of p.others) {
						const f = vault.getAbstractFileByPath(o);
						if (f instanceof TFile) others.add(f);
					}
					const r: Renamed = { file, oldPath: p.oldPath, others };
					this.queue.push(r);
					this.open.add(r);
				}
			}
			this.persist();
			if (this.queue.length) this.start();
		} catch (e) {
			console.error('Dynasty Tree: cannot continue the link update of an earlier rename', e);
		}
	}

	/** Resolves when every queued rename is handled (tests and the harness wait for it). */
	async idle(): Promise<void> {
		while (this.running) await this.running;
		await this.saving;
	}

	/** Plugin unload: no further writes. The stored renames stay for the next start. */
	stop(): void {
		this.stopped = true;
		this.queue.length = 0;
	}

	/** Unload, or the user turned "Update tree links" off: the running update writes nothing more. */
	private halted(): boolean {
		return this.stopped || !this.enabled();
	}

	private start(): void {
		this.running ??= this.run().finally(() => (this.running = null));
	}

	/** One save at a time; the events of a folder rename make one save. */
	private persist(): void {
		const save = this.hooks.save;
		if (!save || this.saveQueued) return;
		this.saveQueued = true;
		this.saving = this.saving
			.then(() => {
				this.saveQueued = false;
				return save();
			})
			.catch((e) => console.error('Dynasty Tree: cannot store the renames that wait for a link update', e));
	}

	/** The notes with the name of `oldPath` now, other than `file`. */
	private sameName(oldPath: string, file: TFile): Set<TFile> {
		if (!this.names) {
			const m = new Map<string, TFile[]>();
			for (const f of this.app.vault.getMarkdownFiles()) {
				const k = baseName(f.path);
				const l = m.get(k);
				if (l) l.push(f);
				else m.set(k, [f]);
			}
			this.names = m;
			setTimeout(() => (this.names = null), 0);
		}
		return new Set((this.names.get(baseName(oldPath)) ?? []).filter((f) => f !== file));
	}

	private async run(): Promise<void> {
		while (this.queue.length && !this.stopped) {
			const started = Date.now();
			// The wait starts at the rename: the metadata cache's events can come before the batch is complete.
			const obsidian = this.obsidianDone();
			const st: Progress = { found: false, scanned: false, shown: null };
			const timer = setTimeout(() => {
				try {
					if (!this.halted() && (!st.scanned || st.found)) st.shown = new Notice(RENAME_UI.progress, 0);
				} catch (e) {
					console.error('Dynasty Tree: cannot show the link update Notice', e);
				}
			}, this.timing.progress ?? RENAME_TIMING.progress);
			let batch: Renamed[] = [];
			let report: LinkReportText | null = null;
			try {
				// A folder rename sends one event per note, one after the other: they form one batch.
				await pause(0);
				batch = this.queue.splice(0);
				if (this.stopped || !this.enabled() || !batch.length) continue;
				report = newReport(batch);
				this.last = report;
				await this.update(batch, obsidian.done, st, report);
				report.state = this.halted() ? 'stopped' : 'done';
			} catch (e) {
				console.error('Dynasty Tree: cannot update the links after a rename', e);
				if (report) report.state = 'failed';
				if (!this.stopped && batch.length) new Notice(RENAME_UI.stopped(renamedText(batch.map((r) => ({ from: shownPath(r.oldPath) })))), 0);
			} finally {
				clearTimeout(timer);
				obsidian.end();
				st.shown?.hide();
				if (report) report.ms = Date.now() - started;
				// Handled, also after an error: a rename that fails at each start must not come back for ever.
				// A stopped update stays stored: the next start continues it if the setting is on then.
				if (!this.stopped && report?.state !== 'stopped') {
					for (const r of batch) this.open.delete(r);
					this.persist();
				}
			}
		}
	}

	/**
	 * Resolves when Obsidian has most likely finished its own link update: after the metadata cache's
	 * `resolved` event (at most `timing.resolved`), then a quiet moment. `end` stops the wait.
	 */
	private obsidianDone(): { done: Promise<void>; end: () => void } {
		const mc = this.app.metadataCache;
		let end = () => {};
		const done = new Promise<void>((resolve) => {
			const refs: EventRef[] = [];
			let quiet: ReturnType<typeof setTimeout> | null = null;
			let ended = false;
			end = () => {
				if (ended) return;
				ended = true;
				clearTimeout(first);
				clearTimeout(cap);
				if (quiet) clearTimeout(quiet);
				for (const r of refs) mc.offref(r);
				resolve();
			};
			const calm = () => {
				if (quiet) clearTimeout(quiet);
				quiet = setTimeout(end, this.timing.quiet);
			};
			const first = setTimeout(calm, this.timing.resolved);
			const cap = setTimeout(end, this.timing.resolved + this.timing.cap);
			try {
				refs.push(mc.on('resolved', () => {
					clearTimeout(first);
					calm();
				}));
				refs.push(mc.on('changed', () => {
					if (quiet) calm();
				}));
			} catch {
				end();
			}
		});
		return { done, end: () => end() };
	}

	/**
	 * Obsidian changes the normal links of a note that links to the renamed note, by position; a write
	 * of ours before that could move the text it replaces. A note with no such link (the metadata cache
	 * knows) can be written at once; any other note waits until its cache no longer shows an old name,
	 * or until Obsidian's whole update is over.
	 */
	private async obsidianFinished(file: TFile, olds: Set<string>, obsidian: Promise<void>): Promise<void> {
		if (!this.obsidianMayEdit(file, olds)) return;
		const mc = this.app.metadataCache;
		let ref: EventRef | null = null;
		const changed = new Promise<void>((done) => {
			try {
				ref = mc.on('changed', (f: TFile) => {
					if (f === file && !this.obsidianMayEdit(file, olds)) done();
				});
			} catch {
				// The whole wait is enough.
			}
		});
		try {
			await Promise.race([obsidian, changed]);
		} finally {
			if (ref) mc.offref(ref);
		}
	}

	private obsidianMayEdit(file: TFile, olds: Set<string>): boolean {
		const c = this.cacheOf(file);
		if (!c) return true;
		for (const l of [...(c.links ?? []), ...(c.embeds ?? []), ...(c.frontmatterLinks ?? [])]) if (olds.has(linkBase(l.link))) return true;
		return false;
	}

	private cacheOf(file: TFile): CachedMetadata | null {
		try {
			return this.app.metadataCache.getFileCache(file);
		} catch {
			return null;
		}
	}

	/**
	 * The notes to read, in order: notes that show a tree now, notes whose metadata cache has a section
	 * that can hold a tree, then notes with no cache yet. Every other note has no tree: it is not read
	 * (on a phone, each read of a note is a slow call, one at a time).
	 */
	private candidates(files: TFile[]): TFile[] {
		const known = new Set<string>();
		try {
			for (const h of this.blocks.all()) known.add(h.key.path);
			for (const p of this.hooks.known?.() ?? []) known.add(p);
		} catch (e) {
			console.error('Dynasty Tree: cannot list the notes that show a tree', e);
		}
		const first: TFile[] = [];
		const cached: TFile[] = [];
		const unknown: TFile[] = [];
		for (const f of files) {
			if (known.has(f.path)) {
				first.push(f);
				continue;
			}
			const c = this.cacheOf(f);
			if (!c) unknown.push(f);
			else if (c.sections?.some((s) => TREE_SECTIONS.has(s.type))) cached.push(f);
		}
		return [...first, ...cached, ...unknown];
	}

	private async update(batch: Renamed[], obsidian: Promise<void>, st: Progress, report: LinkReportText): Promise<void> {
		const found = await this.scan(batch, obsidian, st, report);
		if (!found) return;
		st.scanned = true;
		if (this.halted()) return;
		report.changedTrees = found.trees;
		this.carryUndo(batch);
		this.showResult(report, st, found);
	}

	/**
	 * Reads the candidate notes and updates the links of their trees, one note at a time. Null if the
	 * batch has no name to look for, or the update halted during the scan.
	 */
	private async scan(batch: Renamed[], obsidian: Promise<void>, st: Progress, report: LinkReportText): Promise<ScanResult | null> {
		const names = [...new Set(batch.flatMap((r) => nameForms(baseName(r.oldPath))))].filter(Boolean);
		if (!names.length) return null;
		const olds = new Set(batch.map((r) => baseName(r.oldPath)));
		const files = this.app.vault.getMarkdownFiles();
		report.notes = files.length;
		let trees = 0;
		const failures: Failure[] = [];
		const kept: (Kept & { path: string })[] = [];
		let slice = Date.now();
		for (const file of this.candidates(files)) {
			if (this.halted()) return null;
			if (Date.now() - slice > SLICE_MS) {
				await pause(0);
				slice = Date.now();
			}
			let text: string;
			report.read++;
			try {
				text = await this.app.vault.cachedRead(file);
			} catch {
				report.unread++;
				continue;
			}
			// Spec §6.9 step 1: only notes that name a tree and the old note.
			const low = text.toLowerCase();
			if (!low.includes('dynasty') || !names.some((n) => low.includes(n))) continue;
			const count = findBlocks(text).length;
			if (!count) continue;
			st.found = true;
			await this.obsidianFinished(file, olds, obsidian);
			for (let ordinal = 0; ordinal < count && !this.halted(); ordinal++) {
				const path = file.path;
				const r = await this.tree(path, ordinal, batch);
				if (r === 'gone') break;
				if (r === null) continue;
				report.trees++;
				if ('failed' in r) {
					failures.push(r.failed);
					report.failed.push(shownPath(path));
					continue;
				}
				for (const k of r.kept) report.skipped.push({ note: shownPath(path), link: k.link, other: shownPath(k.other) });
				if (r.changed > 0) {
					report.links += r.changed;
					trees++;
				} else if (r.kept.length) kept.push({ ...r.kept[0], path });
			}
			// One note at a time, so a vault with many trees never holds up the interface (spec §6.9).
			await pause(0);
		}
		return { trees, failures, kept };
	}

	/** The Notices at the end of an update. */
	private showResult(report: LinkReportText, st: Progress, { trees, failures, kept }: ScanResult): void {
		// D35: the numbers only.
		if (report.links > 0) new Notice(RENAME_UI.updated(report.links, trees));
		else if (st.shown && !kept.length && !failures.length) new Notice(RENAME_UI.noLinks);
		for (const k of kept.slice(0, MAX_FAILURE_NOTICES)) new Notice(RENAME_UI.kept(k.link, shownPath(k.path), shownPath(k.other)), KEPT_NOTICE_MS);
		if (kept.length > MAX_FAILURE_NOTICES) new Notice(RENAME_UI.moreKept(kept.length - MAX_FAILURE_NOTICES), KEPT_NOTICE_MS);
		for (const f of failures.slice(0, MAX_FAILURE_NOTICES)) new Notice(RENAME_UI.failed(shownPath(f.path), f.old, f.next), 0);
		if (failures.length > MAX_FAILURE_NOTICES) new Notice(RENAME_UI.moreFailed(failures.length - MAX_FAILURE_NOTICES), 0);
	}

	/**
	 * One tree: its links to a renamed note get the new text, in one write. A tree that changed in
	 * between (stale) is read again and tried once more. `gone`: the note has no more trees. Null:
	 * the tree has no link to a renamed note.
	 */
	private async tree(path: string, ordinal: number, batch: Renamed[]): Promise<TreeResult> {
		let map: Record<string, string> = {};
		for (let attempt = 0; attempt < 2; attempt++) {
			// The plugin or the setting was turned off: no further write, also not a retry.
			if (this.halted()) return null;
			const h = await this.blocks.forBlock(path, ordinal);
			if (!h || this.halted()) return h ? null : 'gone';
			const found = this.linksFor(h.body, path, batch);
			map = found.map;
			if (!Object.keys(map).length) return found.named ? { changed: 0, kept: found.kept } : null;
			const out = await h.write({ kind: 'rewrite-links', map }, 'maintenance');
			if (out.ok) return { changed: out.changed ?? 0, kept: found.kept };
			if ((out.code === 'stale' || out.code === 'missing') && attempt === 0) continue;
			break;
		}
		const [old, next] = Object.entries(map)[0] ?? ['', ''];
		return { failed: { path, old, next } };
	}

	/**
	 * Every handle's undo entries get the same link update: also a tree that
	 * has no link to the old note now, but had one before an edit that "Undo last tree edit" can undo.
	 */
	private carryUndo(batch: Renamed[]): void {
		for (const h of this.blocks.all()) {
			try {
				h.mapUndo((body) => {
					const map = this.linksFor(body, h.key.path, batch).map;
					if (!Object.keys(map).length) return body;
					const r = applyOp(body, { kind: 'rewrite-links', map });
					return r.ok ? r.body.replace(/\r\n?/g, '\n') : body;
				});
			} catch (e) {
				console.error('Dynasty Tree: cannot update the undo steps after a rename', e);
			}
		}
	}

	/**
	 * The links of a tree that pointed to a renamed note, with their new text. A link counts if its
	 * target is the end of the old path (case-insensitive, with or without `.md`). It stays as it is if
	 * it opens a renamed note already, or a note that had the old name at the rename (`others`).
	 * `named`: the tree has a link to a renamed note; `kept`: the links left for `others`.
	 */
	private linksFor(body: string, notePath: string, batch: Renamed[]): { map: Record<string, string>; named: boolean; kept: Kept[] } {
		const mc = this.app.metadataCache;
		const map: Record<string, string> = {};
		const kept: Kept[] = [];
		let named = false;
		const folder = folderOf(notePath);
		for (const target of linkTargets(body)) {
			const t = normaliseTarget(target).replace(/^\/+/, '');
			if (!t) continue;
			// `./` and `../` lead from the folder of the note that holds the link (as Obsidian reads them).
			const rel = isRelative(t) ? resolveRelative(t, folder.toLowerCase()) : null;
			if (isRelative(t) && rel === null) continue;
			const matches = batch.filter((r) => {
				const old = normaliseTarget(r.oldPath);
				return rel !== null ? old === rel : old === t || old.endsWith(`/${t}`);
			});
			const hit = matches[0];
			if (!hit || hit.file.path === hit.oldPath) continue;
			named = true;
			const dest = mc.getFirstLinkpathDest(target, notePath);
			// Only a rename of this target counts: after two notes swap names, the link opens the other renamed note.
			if (dest && matches.some((r) => r.file === dest)) continue;
			if (dest && hit.others.has(dest)) {
				kept.push({ link: target, other: dest.path });
				continue;
			}
			// A relative link stays relative, from the same folder.
			const next = rel !== null ? relativeTo(hit.file.path.replace(/\.md$/i, ''), folder) : mc.fileToLinktext(hit.file, notePath, true);
			if (next && next !== target) map[target] = next;
		}
		return { map, named, kept };
	}
}
