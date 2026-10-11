/*
 * "Save as picture" (spec §13.8, D70–D74; M9 contract O11, P1–P6, B4, B5, B8, B13). The tree view's
 * More list opens `SaveWindow`, where the owner selects PNG or SVG. `savePicture` then lays the drawn
 * tree out again with the card form of the view, the plate setting and the "You" tab (0.2.5, D148) at the Full level
 * (`measured-layout.ts`, with the canvas text measure), asks the picture store for each arms and portrait picture at the size of the file, one at
 * a time (`exportCopy`), draws one standalone SVG with fixed light colours (`renderSvg` with `saved`),
 * for a PNG draws that SVG on a canvas, and writes the file once into the attachment folder of the
 * tree's note. Notices tell the owner what happens. The tree text never changes, the view stays in use
 * while the picture is made, and nothing here throws.
 */

import { Modal, Notice, type App, type TFile } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import type { FoldKey } from '../core/folds';
import { folderOf, numberedFreePath } from '../core/link-text';
import { portraitCropOf, type CropFraction } from '../core/portrait-crop';
import type { CardLabel } from '../core/titles';
import { PICTURE_EM, isRoundel, pictureSize, roundelPics } from '../layout/geometry';
import { DEFAULT_FAR_RULE, NEVER_FAR_RULE } from '../layout/index';
import type { Geometry, LaidOut, LayoutSettings, Orientation } from '../layout/model';
import type { BreakList } from '../render/break-words';
import { measureText } from '../render/dom/measure';
import type { SceneFonts } from '../render/dom/scene';
import type { LineMarks } from '../render/line-highlight';
import type { ArmsOutline } from '../layout/arms-outline';
import { savedExtent, savedFileName, savedFrame, savedLegend, savedScale, type PictureMap } from '../render/saved-picture';
import { DEFAULT_LIGHT } from '../render/styles';
import { renderSvg } from '../render/svg-string';
import { SAVE_UI } from '../render/ui-text';
import { measuredLayout } from './measured-layout';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import type { PictureStore } from './picture-store';
import { trackModal } from './plugin-modals';
import { nameDialog } from './sheet-parts';
import { buildShell, type Shell } from './window-shell';

/** What the tree view gives the save (P1): the drawn graph and the view's settings. */
export interface SaveSource {
	/** The drawn graph: the whole tree, the focus family, or the relation finder's small tree. */
	g: FamilyGraph;
	labels?: ReadonlyMap<string, CardLabel>;
	/** The relation names of the cards; absent when the view has none or "Show relation names on cards" is off. */
	relations?: ReadonlyMap<string, { text: string; lower: string }>;
	me?: string;
	/** The relation finder's line; `fade` for "Show in the whole tree". */
	line?: LineMarks;
	orientation: Orientation;
	/** `cardForm(geometryFor(fontPx), orientation)`: the saved picture has the card form of the view, with all its text (D148 2A). The save adds the relation line. */
	geo: Geometry;
	/** The tree has a mark and "Show relation names on cards" is on: every card has the plate with the relation word (D40, D145). */
	relationLine: boolean;
	/** D148: the person who gets the "You" tab; set when there is a mark and `relationLine` is false (`LayoutSettings.youTab`). */
	youTab?: string;
	fonts: SceneFonts;
	showDates: boolean;
	showPortraits: boolean;
	/** "Arms on cards" (0.2.8, D206): the saved picture follows the cards (supervisor default, open to veto). */
	armsOnCards?: 'few' | 'all';
	/** The user's break places for names (D118). */
	breaks?: BreakList;
	sourcePath: string;
	/** The note's name without ".md" (the heading and the file name). */
	note: string;
	/** Focus mode only: the focus person's name (P6). */
	focusName?: string;
	/** M10 (F14): the view's folds, when a family is folded: the hidden people and the folded families, both sorted. */
	folds?: { hidden: readonly string[]; folded: readonly FoldKey[] };
	/**
	 * 0.2.7 F.5: the Show view of a line of succession is open. The picture has the ordinal tabs (`ordinalCards`, with the texts in `ordinals`), the
	 * outline of each heir and the bar sentence as a second text line under the heading, all in the fixed colours.
	 */
	succession?: { ordinalCards: readonly string[]; heirs: readonly string[]; ordinals: ReadonlyMap<string, string>; sentence: string };
}

/** The kinds of file a save can make (D72). */
export type SaveKind = 'png' | 'svg';

/** A save waits this long before it shows the progress Notice (spec §13.8). */
export const PROGRESS_MS = 1000;
/** Loading the drawn SVG into a picture for the canvas may take this long, in ms. */
const LOAD_LIMIT_MS = 60_000;

/** The window "Save as a picture": PNG (default) or SVG, with Save and Cancel (D72). */
export class SaveWindow extends Modal {
	private kind: SaveKind = 'png';
	private readonly cleanup: (() => void)[] = [];
	private shell: Shell | null = null;

	constructor(
		app: App,
		private readonly o: { save: (kind: SaveKind) => void; onClosed?: () => void },
	) {
		super(app);
	}

	override onOpen(): void {
		const m = this.modalEl;
		m.addClass('dynasty-sheet');
		m.addClass('dynasty-save-window');
		this.cleanup.push(phoneLayout(this), ignoreGhostClick(this), trackModal(this, () => this.close()));
		// The window family (contract C): the frame comes from the shell, as for the other small windows.
		const shell = buildShell({
			modalEl: this.modalEl,
			contentEl: this.contentEl,
			title: SAVE_UI.title,
			titled: true,
			cancelLabel: SAVE_UI.cancel,
			saveLabel: SAVE_UI.save,
			onCancel: () => this.close(),
			onSave: () => this.chosen(),
			buttons: { save: { cls: ['dynasty-save-button'] } },
		});
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		const cancel = shell.cancel;
		const save = shell.save;
		const body = shell.body;
		const group = body.createDiv({ cls: ['dynasty-choice-options', 'dynasty-save-kinds'], attr: { role: 'radiogroup', 'aria-label': SAVE_UI.kindLabel } });
		const options: [SaveKind, string, string][] = [
			['png', SAVE_UI.png, SAVE_UI.pngDetail],
			['svg', SAVE_UI.svg, SAVE_UI.svgDetail],
		];
		const buttons: HTMLButtonElement[] = [];
		const select = (kind: SaveKind, focus: boolean) => {
			this.kind = kind;
			buttons.forEach((b, i) => {
				const on = options[i][0] === kind;
				b.toggleClass('is-selected', on);
				b.setAttribute('aria-checked', String(on));
				b.setAttribute('tabindex', on ? '0' : '-1');
				if (on && focus) b.focus();
			});
		};
		options.forEach(([kind, label, detail], i) => {
			const b = group.createEl('button', { cls: ['dynasty-choice-option', 'dynasty-save-kind'], attr: { type: 'button', role: 'radio', 'data-kind': kind } });
			b.createSpan({ cls: 'dynasty-choice-label', text: label });
			b.createSpan({ cls: 'dynasty-choice-detail', text: detail });
			b.addEventListener('click', () => select(kind, false));
			// A radio group moves with the arrow keys (one Tab stop for the group).
			b.addEventListener('keydown', (e) => {
				if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
				e.preventDefault();
				select(options[(i + 1) % options.length][0], true);
			});
			buttons.push(b);
		});
		select('png', false);
		this.scope.register([], 'Enter', (e) => {
			// Enter on Cancel stays Cancel; elsewhere it saves.
			if (e.target === cancel) return;
			e.preventDefault();
			this.chosen();
		});
		save?.focus();
	}

	private chosen(): void {
		const kind = this.kind;
		this.close();
		this.o.save(kind);
	}

	override onClose(): void {
		for (const c of this.cleanup.splice(0)) c();
		this.shell?.dispose();
		this.shell = null;
		this.contentEl.empty();
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot give the focus back', e);
		}
	}
}

/** What `makePicture` made: the bytes of the file and what the Notice needs. */
interface Made {
	name: string;
	bytes: ArrayBuffer;
	type: string;
	small: boolean;
}

/**
 * O11: makes the saved picture of `src` and writes it once into the attachment folder of the tree's
 * note; shows the progress Notice after 1 s, then the result or the failure Notice. Never throws.
 */
export async function savePicture(app: App, store: PictureStore | undefined, src: SaveSource, kind: SaveKind): Promise<TFile | null> {
	let progress: Notice | null = null;
	const timer = window.setTimeout(() => {
		progress = new Notice(SAVE_UI.progress, 0);
	}, PROGRESS_MS);
	const stop = () => {
		window.clearTimeout(timer);
		(progress as Notice | null)?.hide();
	};
	let made: Made;
	let file: TFile;
	try {
		made = await makePicture(store, src, kind);
		const path = await freePath(app, made.name, src.sourcePath);
		// One write with every byte: a failure leaves no half-written file of ours.
		file = await app.vault.createBinary(path, made.bytes);
	} catch (e) {
		console.error('Dynasty Tree: cannot save the picture', e);
		stop();
		new Notice(SAVE_UI.failed);
		return null;
	}
	stop();
	try {
		resultNotice(file, made);
	} catch (e) {
		console.error('Dynasty Tree: cannot show the result of the save', e);
		new Notice(SAVE_UI.saved(file.name, folderOf(file.path)), 0);
	}
	return file;
}

/** P1–P5: the file's name, bytes and type, and whether the names are small (B5). */
export async function makePicture(store: PictureStore | undefined, src: SaveSource, kind: SaveKind): Promise<Made> {
	const { g } = src;
	const folds = src.folds?.folded.length ? src.folds : undefined;
	const sideways = src.orientation === 'sideways';
	// P1: the view's orientation; the finder's small tree never splits a couple.
	const far = src.line && !src.line.fade ? NEVER_FAR_RULE : DEFAULT_FAR_RULE;
	const base: LayoutSettings = {
		sweeps: 4,
		far,
		...(sideways ? { orientation: 'sideways' as const } : {}),
		...(src.relationLine ? { relationLine: true } : {}),
		...(src.youTab !== undefined ? { youTab: src.youTab } : {}),
		...(src.succession ? { ordinalCards: src.succession.ordinalCards } : {}),
		// The picture shows the view's folds: the same people are hidden, and each folded family has its "+ N" sign (spec §13.8).
		...(folds ? { foldHidden: folds.hidden, foldedFamilies: folds.folded, foldControls: true as const } : {}),
	};
	// P2: the canvas measures every text with the font strings the file names.
	const measure = measureText;
	const { laid } = measuredLayout(g, src.geo, base, {
		fonts: src.fonts,
		measure,
		labels: src.labels,
		showDates: src.showDates,
		showPortraits: src.showPortraits,
		...(src.armsOnCards !== undefined ? { armsOnCards: src.armsOnCards } : {}),
		...(folds?.hidden.length ? { foldHidden: new Set(folds.hidden) } : {}),
		...(src.breaks ? { breaks: src.breaks } : {}),
		...(src.me !== undefined ? { marked: src.me } : {}),
	});
	const fontPx = laid.layout.geometry.fontPx;
	const legend = savedLegend(g, laid);
	const heading = src.note;
	const extent = savedExtent(laid, legend, heading, fontPx, measure, src.fonts, src.succession?.sentence);
	const sc = savedScale(extent, fontPx, kind);
	const { pictures, outlines } = await picturesFor(store, src, laid, sc.pictureScale, savedFrame(laid.layout, legend, heading, fontPx, measure, src.fonts).legend?.arms);
	const svg = renderSvg(g, laid.layout, laid.edges, {
		palette: DEFAULT_LIGHT,
		dark: false,
		fontFamily: src.fonts.text,
		...(src.relations ? { relations: src.relations } : {}),
		...(src.me !== undefined ? { me: src.me } : {}),
		...(src.line ? { line: src.line } : {}),
		...(src.labels ? { labels: src.labels } : {}),
		...(src.breaks ? { breaks: src.breaks } : {}),
		...(src.succession ? { heirs: src.succession.heirs, ordinals: src.succession.ordinals, barSentence: src.succession.sentence } : {}),
		showDates: src.showDates,
		measure,
		fonts: src.fonts,
		outlines,
		saved: { heading, legend, pictures, scale: sc.scale, ...(folds ? { folds: new Set(folds.folded) } : {}) },
	});
	const name = savedFileName(src.note, kind, src.focusName);
	if (kind === 'svg') return { name, bytes: new TextEncoder().encode(svg).buffer as ArrayBuffer, type: 'image/svg+xml', small: sc.small };
	const size = /<svg [^>]*?width="(\d+)" height="(\d+)"/.exec(svg);
	const w = Number(size?.[1] ?? Math.ceil(extent.w * sc.scale));
	const h = Number(size?.[2] ?? Math.ceil(extent.h * sc.scale));
	// B13: the canvas of the whole picture is the largest memory use of a save; no decode runs beside it.
	const bytes = store ? await store.alone(() => pngOf(svg, w, h)) : await pngOf(svg, w, h);
	return { name, bytes, type: 'image/png', small: sc.small };
}

/**
 * P3, B1: the pictures of the drawn cards as data URIs at `scale` picture px per layout px, one at a
 * time (the store holds its queue alone for each, O4); 'missing' for a link to no file (the dashed
 * frame), null for another problem. The arms are made once per house at the larger of the card's box
 * and the legend's box.
 */
async function picturesFor(store: PictureStore | undefined, src: SaveSource, laid: LaidOut, scale: number, legendArms: { w: number; h: number } | undefined): Promise<{ pictures: PictureMap; outlines: ReadonlyMap<string, ArmsOutline> }> {
	const out = new Map<string, string | 'missing' | null>();
	// D219: the outline of each arms picture, read while its copy was made; the picture draws the gap round the arms from it.
	const outlines = new Map<string, ArmsOutline>();
	if (!store) return { pictures: out, outlines };
	const { g } = src;
	const geo = laid.layout.geometry;
	// The Roundel's medallion is 2 em across and its arms alone 2 em high (B.3.3): so the copies are made at that size.
	const round = isRoundel(geo) ? { portrait: roundelPics(geo, { arms: false, portrait: true }).portrait!, arms: roundelPics(geo, { arms: true, portrait: false }).arms! } : undefined;
	const d = round ? round.portrait.w : pictureSize(geo);
	const armsW = Math.max(round ? round.arms.w : PICTURE_EM.armsAspect * d, legendArms?.w ?? 0);
	const armsH = Math.max(round ? round.arms.h : d, legendArms?.h ?? 0);
	const wanted: { key: string; link: string; w: number; h: number; fit: 'meet' | 'portrait'; crop?: CropFraction }[] = [];
	const houses = new Set<string>();
	for (const box of laid.layout.persons.values()) {
		const p = g.byId.get(box.id);
		if (!p) continue;
		const house = p.house !== undefined ? g.houses.get(p.house) : undefined;
		// 0.2.8 (I05): the personal arms of a person, else the arms of the house; one copy per person and one per house.
		if (box.arms && p.arms) {
			wanted.push({ key: `person-arms:${p.id}`, link: p.arms, w: armsW, h: armsH, fit: 'meet' });
		} else if (box.arms && house?.arms && !houses.has(house.id)) {
			houses.add(house.id);
			wanted.push({ key: `arms:${house.id}`, link: house.arms, w: armsW, h: armsH, fit: 'meet' });
		}
		if (box.portrait && p.portrait) {
			const crop = portraitCropOf(p);
			wanted.push({ key: `portrait:${p.id}`, link: p.portrait, w: d, h: d, fit: 'portrait', ...(crop ? { crop } : {}) });
		}
	}
	for (const x of wanted) {
		const r = store.resolve(x.link, src.sourcePath);
		if (!r.ok) {
			out.set(x.key, r.code === 'missing-picture' ? 'missing' : null);
			continue;
		}
		const uri = await store.exportCopy(r.file, { w: Math.max(1, Math.ceil(x.w * scale)), h: Math.max(1, Math.ceil(x.h * scale)), fit: x.fit, crop: x.crop });
		out.set(x.key, typeof uri === 'string' ? uri : null);
		const outline = x.fit === 'meet' && typeof uri === 'string' ? (store.outlineOf?.(r.file) ?? null) : null;
		if (outline) outlines.set(x.key, outline);
	}
	return { pictures: out, outlines };
}

/**
 * The PNG of `svg` at `w` × `h` px: the SVG is drawn on a canvas from a blob URL (its pictures are
 * data URIs, which the iPhone draws; M9 iPhone check). The caller holds the picture queue alone for
 * it, and the canvas is emptied after use (B13).
 */
async function pngOf(svg: string, w: number, h: number): Promise<ArrayBuffer> {
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	const canvas = createEl('canvas');
	try {
		const img = await loadImage(url);
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no canvas');
		ctx.drawImage(img, 0, 0, w, h);
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the canvas gave no picture'))), 'image/png');
		});
		return await blob.arrayBuffer();
	} finally {
		canvas.width = 0;
		canvas.height = 0;
		URL.revokeObjectURL(url);
	}
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const img = new Image();
		const timer = window.setTimeout(() => reject(new Error('the picture did not load in time')), LOAD_LIMIT_MS);
		img.onload = () => {
			window.clearTimeout(timer);
			resolve(img);
		};
		img.onerror = () => {
			window.clearTimeout(timer);
			reject(new Error('the picture did not load'));
		};
		img.src = url;
	});
}

/** D70: a free path in Obsidian's attachment folder of the note; before Obsidian 1.5.7, the note's folder with " 1", " 2", …. */
async function freePath(app: App, name: string, sourcePath: string): Promise<string> {
	const fm = app.fileManager as { getAvailablePathForAttachment?: (n: string, s?: string) => Promise<string> };
	if (typeof fm.getAvailablePathForAttachment === 'function') return fm.getAvailablePathForAttachment(name, sourcePath);
	return numberedFreePath(folderOf(sourcePath), name, (p) => !!app.vault.getAbstractFileByPath(p));
}

/** The result Notice (spec §13.8): the file and its folder, the small-names texts, and Share where the device can share the file. It stays until the owner closes it. */
function resultNotice(file: TFile, made: Made): void {
	let share: File | null = null;
	try {
		const f = new File([made.bytes], file.name, { type: made.type });
		const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
		if (typeof nav.canShare === 'function' && nav.canShare({ files: [f] }) === true && typeof nav.share === 'function') share = f;
	} catch {
		// No Share button.
	}
	const frag = createFragment((f) => {
		f.createDiv({ cls: 'dynasty-save-result', text: SAVE_UI.saved(file.name, folderOf(file.path)) });
		if (made.small) {
			f.createDiv({ cls: 'dynasty-save-small', text: SAVE_UI.small });
			if (made.type === 'image/png') f.createDiv({ cls: 'dynasty-save-small', text: SAVE_UI.smallSvg });
		}
		if (share) {
			const shared = share;
			const b = f.createEl('button', { cls: ['mod-cta', 'dynasty-save-share'], text: SAVE_UI.share, attr: { type: 'button', 'aria-label': SAVE_UI.shareLabel(file.name) } });
			b.addEventListener('click', (e) => {
				// The Notice stays: a press on it would close it.
				e.stopPropagation();
				navigator.share({ files: [shared] }).catch((err: unknown) => {
					if ((err as { name?: string })?.name !== 'AbortError') console.error('Dynasty Tree: cannot share the picture', err);
				});
			});
		}
	});
	new Notice(frag, 0);
}
