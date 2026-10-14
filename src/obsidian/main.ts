/*
 * The plugin's Obsidian entry point. It registers the `dynasty` code block processor, the editor
 * extension that keeps tall blocks parsed in Live Preview, the commands and the settings tab, and
 * it owns the state that outlives any one `TreeView`: the block handles, the settings, the loose
 * (read-only) block states and the render timings the test harness reads. It implements `TreeHost`
 * and `SettingsHost` so that `TreeView` and the settings tab can call back into it. It also owns the
 * one picture store of all trees (spec §13.0 item 3) and tells it when a picture file changes.
 */

import { Notice, Plugin, TFile, debounce, type TAbstractFile } from 'obsidian';
import { createParseCache } from '../core/parse-cache';
import { INSERT_UI, RENAME_UI, TIMING_UI, UI, WRITE_TEXT } from '../render/ui-text';
import { clearLayoutCache } from '../layout/index';
import { clearMeasureCache } from '../render/dom/measure';
import { contrastChoices, onAccentChoice } from '../render/dom/theme-read';
import { buildCallout } from '../render/dom/widgets';
import { timingText, type RenderTiming } from '../render/tree-info';
import { HandleRegistry } from './block-handle';
import { endSessionFocus, type BlockState } from './block-state';
import { FullScreenModal } from './full-screen';
import { insertTree } from './insert-tree';
import { closePluginModals } from './plugin-modals';
import { tallBlockParser } from './live-preview';
import { clearRelationCache } from './relation-cache';
import { createPictureStore, isPictureExtension } from './picture-store';
import { LinkUpdater, RENAME_TIMING, extensionOf } from './rename-links';
import { DEFAULT_SETTINGS, NO_EXTRAS, buildStoredData, clearInvalid, normaliseSettings, readPending, readStoredSettings, settingsChanges, type DynastySettings, type StoredExtras } from './settings';
import { DynastySettingTab, type SettingsHost } from './settings-tab';
import { renameHeights } from './block-height';
import { HOVER_SOURCE, START_LIMIT_MS, STYLES_LIMIT_MS, THEME_RECHECK_MS, TreeView, type OpenTime, type TreeHost } from './tree-view';

/** B16: vault events for picture files are grouped for this long, in ms, before the views refresh. */
export const PICTURE_EVENT_MS = 250;

/** The Dynasty Tree plugin: Obsidian loads one instance and calls `onload`/`onunload` on it. */
export default class DynastyTreePlugin extends Plugin implements TreeHost, SettingsHost {
	/** Spec §9; the defaults until the stored settings are read. */
	override settings: DynastySettings = { ...DEFAULT_SETTINGS };
	readonly handles = new HandleRegistry(this.app);
	/** Spec §6.9 (D6, D35): tree links follow a renamed note, if the setting is on. */
	readonly links = new LinkUpdater(this.app, this.handles, () => this.settings.updateLinks, RENAME_TIMING, {
		save: () => this.store(),
		known: () => [...this.views].map((v) => v.notePath),
	});
	/** One `saveData` at a time: the settings and the pending renames share `data.json`. */
	private saving: Promise<void> = Promise.resolve();
	/** W7: what the last load kept of `data.json` (version, unknown keys, invalid values); a save writes it back. */
	private extras: StoredExtras = NO_EXTRAS;
	/** The read at start failed: the settings in memory are defaults until the first save reads again. */
	private startupReadFailed = false;
	private recovery: Promise<void> | null = null;
	readonly looseStates = new Map<string, BlockState>();
	readonly views = new Set<TreeView>();
	/** Most recent render first; read by the timing command and the test harness. */
	lastTiming: RenderTiming | null = null;
	readonly timings = new Map<string, RenderTiming>();
	/** First render of each note in this session, before any cache is warm. */
	readonly firstTimings = new Map<string, RenderTiming>();
	/** Spec §7.7 (render timing): the opens of blocks that have shown no tree yet; the views of one block add their renders to one open. */
	readonly opens = new Map<string, OpenTime>();
	/** Number of tree renders in this session; the harness checks that a tree settles. */
	renderCount = 0;
	/** M9 contract O3: one picture store for all trees (`TreeHost.pictures`). */
	readonly pictures = createPictureStore(this.app);
	/**
	 * M11: the one parse cache of the tree views. The harness build freezes the cached trees, so that a
	 * reader which changes one (layout, relations, fold planning) throws in the harness and not in a note.
	 */
	readonly parseCache = createParseCache({ freeze: typeof __DYNASTY_HARNESS__ !== 'undefined' && __DYNASTY_HARNESS__ === true });
	/**
	 * 0.2.8 contract B.5 (D183): the cold start. A tree draws a box of its last known height until the plugin styles (a probe element with the
	 * variable `--dynasty-css-ready` of the style sheet), the stored settings and its block place are in, and it counts no missing picture until the
	 * metadata cache has finished once. The settings and the cache end at the latest `START_LIMIT_MS` after the plugin starts, the styles at `STYLES_LIMIT_MS`.
	 */
	readonly startedUp = {
		ready: (el: HTMLElement) => this.startReady(el),
		cache: () => this.cacheSeen || performance.now() - this.startedAt >= START_LIMIT_MS,
	};
	private readonly startedAt = performance.now();
	private settingsIn = false;
	private cacheSeen = false;
	private cssSeen = false;
	private cssProbe: HTMLElement | null = null;
	/** The waiting redraws of trees that are off screen; they stop when the plugin unloads. */
	private readonly redrawTimers = new Set<ReturnType<typeof setTimeout>>();
	/** O9, B16: picture files that changed, told to the store's listeners together after a short wait. */
	private changedPictures = new Set<string>();
	private readonly tellPictures = debounce(
		() => {
			const paths = [...this.changedPictures];
			this.changedPictures = new Set();
			if (paths.length) this.pictures.changed(paths);
		},
		PICTURE_EVENT_MS,
		false,
	);

	override async onload(): Promise<void> {
		this.registerHoverLinkSource(HOVER_SOURCE, { display: 'Dynasty Tree', defaultMod: false });
		this.registerMarkdownCodeBlockProcessor('dynasty', (source, el, ctx) => {
			try {
				ctx.addChild(new TreeView(this, el, source, { kind: 'embed', ctx }));
			} catch (e) {
				// Nothing may throw into Obsidian or blank the note (spec §8).
				console.error('Dynasty Tree: cannot show the tree', e);
				try {
					el.empty();
					buildCallout(el, 'error', UI.errorTitle, 'dynasty-error').content.createDiv({ text: UI.internalError });
				} catch {
					// The rest of the note still renders.
				}
			}
		});
		this.registerEditorExtension(tallBlockParser);
		// D183: the metadata cache has finished once: a picture that it did not know is looked for again.
		const mc = this.app.metadataCache;
		if (typeof mc?.on === 'function') {
			this.registerEvent(
				mc.on('resolved', () => {
					if (this.cacheSeen) return;
					this.cacheSeen = true;
					this.startUpDone();
				}),
			);
		}
		// The limit passes: every tree that still waits draws as it is, and the pictures are counted.
		const limit = setTimeout(() => this.startUpDone(), START_LIMIT_MS + 50);
		this.register(() => clearTimeout(limit));
		this.register(() => this.cssProbe?.remove());
		// The text colour set on the page body must not outlive the plugin (G.12).
		this.register(() => document.body?.style.removeProperty('--dynasty-on-accent'));
		// The same for the run-time grey, link, edge and error colours (D212, contrast-tokens).
		this.register(() => this.clearContrast());
		// One later check for all trees: a theme can change its colours a frame later (its style sheet still loads).
		const recheck = debounce(
			() => {
				this.paintOnAccent();
				this.paintContrast();
				for (const v of this.views) v.recheckTheme();
			},
			THEME_RECHECK_MS,
			true,
		);
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.paintOnAccent();
				this.paintContrast();
				for (const v of this.views) v.onCssChange();
				recheck();
			}),
		);
		this.register(() => recheck.cancel?.());
		this.watchWebFonts();
		// The session focus lasts until the note closes (spec §5.6).
		this.registerEvent(this.app.workspace.on('layout-change', () => this.endClosedSessions()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.endClosedSessions()));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.renamed(oldPath, file.path)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.handles.deleted(file.path)));
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') this.handles.modified(file.path);
			}),
		);
		// O9: a picture file that changes, goes or comes makes the trees show their pictures again (no new layout).
		this.registerEvent(this.app.vault.on('modify', (file) => this.pictureChanged(file)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.pictureChanged(file)));
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				this.pictureChanged(file, oldPath);
				this.pictureChanged(file);
			}),
		);
		this.register(() => this.tellPictures.cancel?.());
		this.addCommand({
			id: 'undo-last-tree-edit',
			name: WRITE_TEXT.undoCommand,
			callback: () => void this.undoLastEdit(),
		});
		this.addCommand({
			id: 'show-last-link-update',
			name: RENAME_UI.command,
			callback: () => {
				const text = RENAME_UI.report(this.links.last, this.settings.updateLinks);
				new Notice(createFragment((f) => text.split('\n\n').forEach((p) => f.createEl('p', { text: p }))), 20_000);
			},
		});
		this.addCommand({
			id: 'show-render-timing',
			name: TIMING_UI.command,
			callback: () => new Notice(timingText(this.lastTiming), 15_000),
		});
		// Spec §5.9, D34: an empty tree with a help comment at the cursor.
		this.addCommand({
			id: 'insert-family-tree',
			name: INSERT_UI.command,
			editorCallback: (editor) => {
				try {
					insertTree(editor);
				} catch (e) {
					console.error('Dynasty Tree: cannot insert a tree', e);
				}
			},
		});
		this.addSettingTab(new DynastySettingTab(this.app, this));
		// The trees above are drawn with the defaults if they render first; they draw again if the stored settings differ.
		const stored = await this.loadSettings();
		this.settingsIn = true;
		this.startUpDone();
		// Spec §6.9: a link update that an earlier session did not complete (a phone closed the app) continues.
		this.links.restore(readPending(stored));
		// Only now: before, a rename would use the default "Update tree links" and store the default settings.
		// Registered after the handler above, so the handles follow the rename first.
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.links.renamed(file, oldPath)));
		try {
			this.app.workspace.onLayoutReady(() => {
				this.paintOnAccent();
				this.paintContrast();
				this.links.resume();
				// Obsidian sends `create` for every file while the vault loads: only later ones count.
				this.registerEvent(this.app.vault.on('create', (file) => this.pictureChanged(file)));
			});
		} catch (e) {
			console.error('Dynasty Tree: cannot continue the link update of an earlier rename', e);
		}
	}

	/**
	 * I40 (0.2.8, contract G.12): the text on the accent (`--dynasty-on-accent`, on the page body, so the windows have it too) is black or white by
	 * measured contrast where the theme's own pair is under 4.5:1; else the base token of the style sheet (the theme's pair) stays.
	 */
	private paintOnAccent(): void {
		try {
			const body = document.body;
			if (!body?.isConnected) return;
			const pick = onAccentChoice(body);
			if (pick) body.style.setProperty('--dynasty-on-accent', pick);
			else body.style.removeProperty('--dynasty-on-accent');
		} catch (e) {
			console.error('Dynasty Tree: cannot read the colour of the text on the accent', e);
		}
	}

	/** Takes the run-time contrast tokens off the page body, so the static values of the style sheet show (also when the plugin unloads). */
	private clearContrast(): void {
		document.body?.style.removeProperty('--dynasty-muted');
		document.body?.style.removeProperty('--dynasty-link');
		document.body?.style.removeProperty('--dynasty-edge');
		document.body?.style.removeProperty('--dynasty-error');
	}

	/**
	 * D212 (contrast-tokens): the grey of the second text lines, the link colour, the colour of lines and controls and the error colour (`--dynasty-muted`,
	 * `--dynasty-link`, `--dynasty-edge`, `--dynasty-error`, on the page body, so the windows have them too) are pulled toward the text colour of the theme until text
	 * reaches 4.5:1 and a line 3:1 on the page, card and window colours. A token that is strong enough already keeps the static value of the style sheet.
	 */
	private paintContrast(): void {
		try {
			const body = document.body;
			if (!body?.isConnected) return;
			// The static value is the start, so the overrides must be off while it is read.
			this.clearContrast();
			const cs = getComputedStyle(body);
			const picks = contrastChoices((name) => cs.getPropertyValue(name));
			// One call for each property with its name written out: the lint rule on custom properties reads the name.
			const muted = picks['--dynasty-muted'];
			const link = picks['--dynasty-link'];
			const edge = picks['--dynasty-edge'];
			const error = picks['--dynasty-error'];
			if (muted) body.style.setProperty('--dynasty-muted', muted);
			if (link) body.style.setProperty('--dynasty-link', link);
			if (edge) body.style.setProperty('--dynasty-edge', edge);
			if (error) body.style.setProperty('--dynasty-error', error);
		} catch (e) {
			console.error('Dynasty Tree: cannot read the colours of the theme for the grey text', e);
		}
	}

	/**
	 * D183: the styles and the stored settings are in. The settings give up waiting after `START_LIMIT_MS`; the styles only after `STYLES_LIMIT_MS`,
	 * because Obsidian reads styles.css after `onload` and a tree drawn before it has no style at all.
	 */
	private startReady(el: HTMLElement): boolean {
		const age = performance.now() - this.startedAt;
		// Ask the probe on every call: it is the one signal that the styles are applied.
		const styles = this.stylesIn(el) || age >= STYLES_LIMIT_MS;
		return styles && (this.settingsIn || age >= START_LIMIT_MS);
	}

	/** The style sheet of the plugin is applied when a probe element in the page has its custom property. Once seen, always true. */
	private stylesIn(el: HTMLElement): boolean {
		if (this.cssSeen) return true;
		try {
			this.cssProbe ??= (el.doc ?? document).body.createDiv({ cls: 'dynasty-css-probe', attr: { 'aria-hidden': 'true' } });
			if (getComputedStyle(this.cssProbe).getPropertyValue('--dynasty-css-ready').trim() === '1') this.cssSeen = true;
		} catch {
			// A page that cannot tell: the limit decides.
		}
		return this.cssSeen;
	}

	/** Tells every tree that a start condition came. */
	private startUpDone(): void {
		for (const v of [...this.views]) v.startUpDone();
	}

	/** Reads `data.json`. `ok` is false when the file cannot be read (a sync tool may be half way through a write): the caller decides what that means. */
	private async readData(): Promise<{ ok: true; data: unknown } | { ok: false }> {
		try {
			return { ok: true, data: await this.loadData() };
		} catch (e) {
			console.error('Dynasty Tree: cannot read the settings', e);
			return { ok: false };
		}
	}

	/** Applies stored data: the settings, and the extras that a save writes back (W7). */
	private applyStored(stored: unknown): void {
		const prev = this.settings;
		const { settings, extras } = readStoredSettings(stored);
		this.settings = settings;
		this.extras = extras;
		if (settingsChanges(prev, this.settings).length) this.redrawViews(prev);
	}

	/** Reads `data.json` and applies its settings; returns the stored data. A file that cannot be read counts as empty, and the first save reads it once more. */
	private async loadSettings(): Promise<unknown> {
		const r = await this.readData();
		this.startupReadFailed = !r.ok;
		const stored = r.ok ? r.data : null;
		this.applyStored(stored);
		return stored;
	}

	/**
	 * After a failed read at start, the settings in memory are defaults, and a save would wipe the unknown keys, the raw
	 * values and the version of the file. So the first save reads the file once more. If that read fails too, the save goes on as before.
	 */
	private recoverStartupRead(): Promise<void> {
		if (!this.startupReadFailed) return Promise.resolve();
		this.recovery ??= (async () => {
			const r = await this.readData();
			this.startupReadFailed = false;
			if (r.ok) this.applyStored(r.data);
		})();
		return this.recovery;
	}

	/**
	 * Writes `data.json`: the settings, the version, the keys that this version does not know, and the renames
	 * that wait for a link update (see `buildStoredData`).
	 */
	private store(): Promise<void> {
		const write = async () => {
			await this.recoverStartupRead();
			await this.saveData(buildStoredData(this.settings, this.extras, this.links.pendingList()));
		};
		const next = this.saving.then(write, write);
		this.saving = next.catch(() => undefined);
		return next;
	}

	/**
	 * Sync or another program changed the stored settings (Obsidian 1.5.7 and later). A running save finishes first: the
	 * read cannot then overwrite a change of the user. A save that starts during the read makes that read old, so it is read again.
	 */
	override async onExternalSettingsChange(): Promise<void> {
		for (;;) {
			let running: Promise<void>;
			do {
				running = this.saving;
				await running;
			} while (running !== this.saving);
			const r = await this.readData();
			if (running !== this.saving) continue;
			// A file that cannot be read is not an empty file: the settings and the extras stay as they are.
			if (r.ok) this.applyStored(r.data);
			return;
		}
	}

	/**
	 * A setting changed: every tree draws again (spec §9). Each draw is a whole layout, so trees that nobody sees (another tab,
	 * a closed fold) wait one timer turn each, behind the trees on screen (G3 wave 2: the open tree took 3 s with many trees open).
	 */
	private redrawViews(prev: DynastySettings): void {
		const hidden = [...this.views].filter((v) => v.offScreen);
		for (const v of [...this.views]) if (!hidden.includes(v)) v.onSettingsChange(prev);
		hidden.forEach((v, i) => {
			const t = setTimeout(() => {
				this.redrawTimers.delete(t);
				v.onSettingsChange(prev);
			}, i);
			this.redrawTimers.add(t);
		});
	}

	/** Stores a change of the settings tab and draws every open tree again (spec §9). */
	async changeSettings(change: Partial<DynastySettings>): Promise<void> {
		// Only when needed: an await here would delay the change by one turn.
		if (this.startupReadFailed) await this.recoverStartupRead();
		const prev = this.settings;
		const next = normaliseSettings({ ...prev, ...change });
		// A kept raw value (spec §9, the settings file) goes only when its setting really changes: a blur on a field with the same value keeps it.
		const changed = settingsChanges(prev, next);
		if (!changed.length) return;
		const extras = clearInvalid(this.extras, changed);
		this.settings = next;
		this.extras = extras;
		this.redrawViews(prev);
		try {
			await this.store();
		} catch (e) {
			console.error('Dynasty Tree: cannot save the settings', e);
		}
	}

	override onunload(): void {
		this.links.stop();
		for (const t of this.redrawTimers) clearTimeout(t);
		this.redrawTimers.clear();
		// Every blob URL of the pictures goes; the queue stops.
		this.pictures.clear();
		this.parseCache.clear();
		// Modals live outside every note: close them (sheets first, then full-screen views with their
		// vault listeners), so that nothing of the plugin stays on screen or writes after it is turned off.
		closePluginModals();
		FullScreenModal.closeAll();
		// A tree in a note is a child of the note, not of the plugin: Obsidian does not unload it when the
		// plugin goes. Unload it here (its listeners and observers go, and it refuses edits and writes).
		for (const v of [...this.views]) {
			try {
				v.retire();
			} catch (e) {
				console.error('Dynasty Tree: cannot close a tree view', e);
			}
		}
		this.views.clear();
	}

	/**
	 * A web font can finish loading after a tree was measured with a fallback font. Collect the
	 * loaded families for a moment, then let each tree re-measure if one of its fonts loaded.
	 */
	private watchWebFonts(): void {
		const fonts = document.fonts;
		if (!fonts || typeof fonts.addEventListener !== 'function') return;
		let loaded: string[] = [];
		const flush = debounce(
			() => {
				const families = loaded;
				loaded = [];
				clearMeasureCache();
				for (const v of this.views) v.onFontsLoaded(families);
			},
			300,
			true,
		);
		const onDone = (e: Event) => {
			try {
				for (const face of (e as FontFaceSetLoadEvent).fontfaces ?? []) loaded.push(face.family);
				if (loaded.length) flush();
			} catch (err) {
				console.error('Dynasty Tree: cannot handle a loaded font', err);
			}
		};
		fonts.addEventListener('loadingdone', onDone);
		this.register(() => fonts.removeEventListener('loadingdone', onDone));
	}

	/**
	 * Ends the session focus of every block whose note is closed: no note tab shows the note (a tab
	 * that is not loaded yet still counts) and no tree of it is on screen (a page preview, a Canvas card).
	 * Only note tabs count: a deferred sidebar tab (Outline, Outgoing links) keeps the note it named
	 * when Obsidian last saved it, so it would keep a closed note's session alive (D22).
	 */
	private endClosedSessions(): void {
		try {
			const open = new Set<string>();
			this.app.workspace.iterateAllLeaves((leaf) => {
				const vs = leaf.getViewState();
				if (vs?.type !== 'markdown') return;
				const file = (vs.state as { file?: unknown } | undefined)?.file;
				if (typeof file === 'string') open.add(file);
			});
			for (const v of this.views) if (v.containerEl.isConnected) open.add(v.notePath);
			for (const h of this.handles.all()) if (!open.has(h.key.path)) endSessionFocus(h.state);
			for (const [k, st] of this.looseStates) if (!open.has(k.slice(0, k.indexOf('\u0000')))) endSessionFocus(st);
		} catch (e) {
			console.error('Dynasty Tree: cannot end the focus of closed notes', e);
		}
	}

	/** A renamed note keeps its handles, its views' paths and the view state of its read-only blocks. */
	private renamed(oldPath: string, newPath: string): void {
		try {
			this.handles.renamed(oldPath, newPath);
			renameHeights(oldPath, newPath);
			for (const v of this.views) v.renamed(oldPath, newPath);
			const prefix = `${oldPath}\u0000`;
			for (const [k, st] of [...this.looseStates]) {
				if (!k.startsWith(prefix)) continue;
				this.looseStates.delete(k);
				this.looseStates.set(newPath + k.slice(oldPath.length), st);
			}
		} catch (e) {
			console.error('Dynasty Tree: cannot follow the renamed note', e);
		}
	}

	/**
	 * O8, O9: a picture file (a known picture extension, shown or not) was made, changed, deleted or
	 * renamed (`path` then is the old path). The store forgets it at once; the views hear of it after
	 * `PICTURE_EVENT_MS`, once for all the events of that time (a folder rename sends many).
	 */
	private pictureChanged(file: TAbstractFile, path = file.path): void {
		try {
			if (!(file instanceof TFile) || !isPictureExtension(extensionOf(path))) return;
			this.pictures.invalidate(path);
			this.changedPictures.add(path);
			this.tellPictures();
		} catch (e) {
			console.error('Dynasty Tree: cannot follow the changed picture', e);
		}
	}

	/** Plugin undo (spec §6.1, D8): the last tree edit in the active note, else the last one anywhere. */
	private async undoLastEdit(): Promise<void> {
		try {
			const h = this.handles.undoTarget(this.app.workspace.getActiveFile()?.path ?? null);
			if (!h) {
				new Notice(WRITE_TEXT.undoEmpty);
				return;
			}
			const out = await h.undo();
			if (out.ok) new Notice(WRITE_TEXT.undoDone);
			else new Notice(out.code === 'empty' ? WRITE_TEXT.undoEmpty : out.code === 'missing' ? WRITE_TEXT.undoMissing : WRITE_TEXT.undoChanged);
		} catch (e) {
			console.error('Dynasty Tree: cannot undo', e);
			new Notice(WRITE_TEXT.undoChanged);
		}
	}

	/**
	 * Empties the layout, text-width and relation-name caches, so the next render is a cold one: the
	 * settings button of spec §9, and the test harness to time first renders.
	 */
	clearCaches(): void {
		clearLayoutCache();
		clearMeasureCache();
		clearRelationCache();
	}

	/** Records a tree's render time for the timing command and the test harness. */
	recordTiming(t: RenderTiming): void {
		this.renderCount++;
		this.lastTiming = t;
		this.timings.set(t.path, t);
		if (!this.firstTimings.has(t.path)) this.firstTimings.set(t.path, t);
	}
}
