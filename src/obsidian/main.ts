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
import { themeChanged } from '../render/dom/theme-read';
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
import { DEFAULT_SETTINGS, PENDING_KEY, normaliseSettings, readPending, settingsChanges, type DynastySettings } from './settings';
import { DynastySettingTab, type SettingsHost } from './settings-tab';
import { HOVER_SOURCE, THEME_RECHECK_MS, TreeView, type TreeHost } from './tree-view';

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
	readonly looseStates = new Map<string, BlockState>();
	readonly views = new Set<TreeView>();
	/** Most recent render first; read by the timing command and the test harness. */
	lastTiming: RenderTiming | null = null;
	readonly timings = new Map<string, RenderTiming>();
	/** First render of each note in this session, before any cache is warm. */
	readonly firstTimings = new Map<string, RenderTiming>();
	/** Number of tree renders in this session; the harness checks that a tree settles. */
	renderCount = 0;
	/** M9 contract O3: one picture store for all trees (`TreeHost.pictures`). */
	readonly pictures = createPictureStore(this.app);
	/**
	 * M11: the one parse cache of the tree views. The harness build freezes the cached trees, so that a
	 * reader which changes one (layout, relations, fold planning) throws in the harness and not in a note.
	 */
	readonly parseCache = createParseCache({ freeze: typeof __DYNASTY_HARNESS__ !== 'undefined' && __DYNASTY_HARNESS__ === true });
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
		// One later check for all trees: a theme can change its colours a frame later (its style sheet still loads).
		const recheck = debounce(
			() => {
				themeChanged();
				for (const v of this.views) v.recheckTheme();
			},
			THEME_RECHECK_MS,
			true,
		);
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				themeChanged();
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
		// Spec §6.9: a link update that an earlier session did not complete (a phone closed the app) continues.
		this.links.restore(readPending(stored));
		// Only now: before, a rename would use the default "Update tree links" and store the default settings.
		// Registered after the handler above, so the handles follow the rename first.
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.links.renamed(file, oldPath)));
		try {
			this.app.workspace.onLayoutReady(() => {
				this.links.resume();
				// Obsidian sends `create` for every file while the vault loads: only later ones count.
				this.registerEvent(this.app.vault.on('create', (file) => this.pictureChanged(file)));
			});
		} catch (e) {
			console.error('Dynasty Tree: cannot continue the link update of an earlier rename', e);
		}
	}

	/** Reads `data.json` and applies its settings; returns the stored data. */
	private async loadSettings(): Promise<unknown> {
		let stored: unknown = null;
		try {
			stored = await this.loadData();
		} catch (e) {
			console.error('Dynasty Tree: cannot read the settings; the plugin uses the defaults', e);
		}
		const prev = this.settings;
		this.settings = normaliseSettings(stored);
		if (settingsChanges(prev, this.settings).length) for (const v of this.views) v.onSettingsChange(prev);
		return stored;
	}

	/**
	 * Writes `data.json`: the settings, and the renames that wait for a link update under their own key
	 * (only while there are some, so the file keeps the shape of earlier versions).
	 */
	private store(): Promise<void> {
		const write = async () => {
			const pending = this.links.pendingList();
			await this.saveData(pending.length ? { ...this.settings, [PENDING_KEY]: pending } : { ...this.settings });
		};
		const next = this.saving.then(write, write);
		this.saving = next.catch(() => undefined);
		return next;
	}

	/** Sync or another program changed the stored settings (Obsidian 1.5.7 and later). */
	override async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
	}

	/** Stores a change of the settings tab and draws every open tree again (spec §9). */
	async changeSettings(change: Partial<DynastySettings>): Promise<void> {
		const prev = this.settings;
		const next = normaliseSettings({ ...prev, ...change });
		if (!settingsChanges(prev, next).length) return;
		this.settings = next;
		for (const v of [...this.views]) v.onSettingsChange(prev);
		try {
			await this.store();
		} catch (e) {
			console.error('Dynasty Tree: cannot save the settings', e);
		}
	}

	override onunload(): void {
		this.links.stop();
		// Every blob URL of the pictures goes; the queue stops.
		this.pictures.clear();
		this.parseCache.clear();
		// Modals live outside every note: close them (sheets first, then full-screen views with their
		// vault listeners), so that nothing of the plugin stays on screen or writes after it is turned off.
		closePluginModals();
		FullScreenModal.closeAll();
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
