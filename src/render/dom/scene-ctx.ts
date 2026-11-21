/*
 * The context that the layer files of the scene share (see `scene.ts`): the inputs of one `buildScene` call, its geometry, and the
 * working state that cards, tags and lines all use: the text fits, the delayed items of a lazy scene and the late lines. One context is
 * made for each scene, so a layer file keeps no state of its own.
 */

import type { FamilyGraph } from '../../core/derive';
import { cardText, isRoundel, type CardText } from '../../layout/geometry';
import type { LaidOut, Rect, TreeLayout } from '../../layout/model';
import { fitCardText } from '../date-fit';
import { lineLook, type LineLook } from '../line-highlight';
import { truncate } from '../view-math';
import type { Delayed, LateLine } from './scene-fill';
import { COMPACT_STEPS, compactNameStep } from './scene-parts';
import type { SceneOptions } from './scene-types';

/** The box of a line or sign that has none we can read: near every view. */
const EVERYWHERE: Rect = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 };

/** What every layer of one scene reads and writes. */
export interface SceneCtx {
	parent: SVGGElement;
	g: FamilyGraph;
	laid: LaidOut;
	opts: SceneOptions;
	layout: TreeLayout;
	edges: LaidOut['edges'];
	geo: TreeLayout['geometry'];
	/** The text geometry of a card. */
	t: CardText;
	/** The note font size in px. */
	f: number;
	roundel: boolean;
	lazy: boolean;
	/** D47: the relation finder's line; without one every part is drawn as usual. */
	look: LineLook;
	textFont: (size: number, weight?: string) => string;
	/** The cut of fitCardText, which closes an isolate that the cut leaves open. */
	fit: (text: string, maxW: number, font: string) => string;
	/** The text fits that have run; a refit runs them again. */
	fitters: (() => void)[];
	delayed: Set<Delayed>;
	byPerson: Map<string, Delayed[]>;
	lateLines: Set<LateLine>;
	/** Cards that wait for their content. */
	cardsLeft: number;
	/**
	 * The text fits of the card (or far-couple tag) that is being built in a lazy scene. They run when its content is attached (`fitsOnAttach`): nobody can see the
	 * text before, and the first view attaches about thirty of 400 cards. An eager scene has no such list and fits at once.
	 */
	pendingFits: (() => void)[] | null;
	/** Where the content of a shell is built: the shell itself when eager, else a holder that is not in the document. */
	holderFor: (shell: SVGGElement) => SVGGElement;
	delay: (person: string, box: Rect, card: boolean, attach: () => void) => void;
	lateLine: (box: Rect | null, put: () => void) => void;
	putLine: (l: LateLine) => number;
	attachItem: (d: Delayed) => number;
	attachChildren: (holder: SVGElement, shell: SVGElement) => void;
	addFit: (run: () => void) => void;
	/** Takes the fits collected since `pendingFits` was set; the returned step runs them once, and from then on a refit runs them too. */
	fitsOnAttach: () => () => void;
	/** D377 step 8: runs `step` when `level` first shows (at once if it already did). The hidden tag pills make their text this way. */
	whenShown: (level: string, step: () => void) => void;
	/** `Scene.showLevel`: marks `level` shown and runs the steps that waited for it. */
	showLevel: (level: string) => void;
	/** Sets `el` to `text` truncated to `maxW`, now and on every refit. A relation text (D268) tries the short forms first, by this renderer's own measure. */
	fitted: (el: SVGTextElement, text: string, maxW: number, font: string, relation?: boolean, plain?: string) => void;
	/**
	 * D203: the Compact name is as large as the room allows, from 1.5 em down to 1.05 em in steps of 0.05 em, and is cut with "…" only when even the smallest size does
	 * not fit. The size goes to the text as the custom property `--dynasty-compact-em` (the style turns it into the font size). Runs again on every refit.
	 */
	fittedShrinking: (el: SVGTextElement, text: string, maxW: number) => void;
}

/** The members of the context that fit text. */
type FitKeys = 'addFit' | 'fitsOnAttach' | 'fitted' | 'fittedShrinking';

/** The members of the context that wait for a level of detail to show. */
type LevelKeys = 'whenShown' | 'showLevel';

/** The steps that wait for a level of detail (D377 step 8): the levels that have shown, and the steps of the others. */
function levelHelpers(): Pick<SceneCtx, LevelKeys> {
	const shown = new Set<string>();
	const waiting = new Map<string, (() => void)[]>();
	return {
		whenShown: (level, step) => {
			if (shown.has(level)) step();
			else if (waiting.has(level)) waiting.get(level)!.push(step);
			else waiting.set(level, [step]);
		},
		showLevel: (level) => {
			shown.add(level);
			const steps = waiting.get(level);
			waiting.delete(level);
			for (const step of steps ?? []) step();
		},
	};
}

/** The text fits of a scene. They keep their state in `ctx.pendingFits` and `ctx.fitters`, which the layer files read too. */
function fitHelpers(ctx: Omit<SceneCtx, FitKeys | LevelKeys>): Pick<SceneCtx, FitKeys> {
	const { opts, f, textFont } = ctx;
	const self: Pick<SceneCtx, FitKeys> = {
		addFit: (run) => {
			if (ctx.pendingFits) {
				ctx.pendingFits.push(run);
				return;
			}
			run();
			ctx.fitters.push(run);
		},
		fitsOnAttach: () => {
			const runs = ctx.pendingFits ?? [];
			ctx.pendingFits = null;
			let done = false;
			return () => {
				if (done) return;
				done = true;
				for (const run of runs) {
					run();
					ctx.fitters.push(run);
				}
			};
		},
		fitted: (el, text, maxW, font, relation = false, plain) => {
			const run = () => el.setText(fitCardText(text, plain, maxW, (s) => opts.measure(s, font), relation));
			self.addFit(run);
		},
		fittedShrinking: (el, text, maxW) => {
			/** True while the text carries a size of its own, so a name that fits again clears it and a name that always fits never touches the style. */
			let sized = false;
			const run = () => {
				const k = compactNameStep((i) => opts.measure(text, textFont(COMPACT_STEPS[i] * f, opts.fonts.bold)), maxW);
				const em = COMPACT_STEPS[k];
				// A name that fits at the top size is not cut, so there is nothing to measure again.
				el.setText(k === 0 ? text : truncate(text, maxW, (s) => opts.measure(s, textFont(em * f, opts.fonts.bold))));
				if (k === 0) {
					if (sized) el.style.removeProperty('--dynasty-compact-em');
					sized = false;
				} else {
					el.style.setProperty('--dynasty-compact-em', String(Math.round(em * 100) / 100));
					sized = true;
				}
			};
			self.addFit(run);
		},
	};
	return self;
}

/** Makes the context of one `buildScene` call. */
export function makeCtx(parent: SVGGElement, g: FamilyGraph, laid: LaidOut, opts: SceneOptions): SceneCtx {
	const { layout, edges } = laid;
	const geo = layout.geometry;
	const f = geo.fontPx;
	const lazy = opts.lazyCards === true;
	const textFont = (size: number, weight = '400') => `${weight} ${size}px ${opts.fonts.text}`;
	const ctx: Omit<SceneCtx, FitKeys | LevelKeys> = {
		parent,
		g,
		laid,
		opts,
		layout,
		edges,
		geo,
		t: cardText(geo),
		f,
		roundel: isRoundel(geo),
		lazy,
		look: lineLook(g, layout, edges, opts.line),
		textFont,
		fit: (text, maxW, font) => fitCardText(text, undefined, maxW, (s) => opts.measure(s, font), false),
		fitters: [],
		delayed: new Set<Delayed>(),
		byPerson: new Map<string, Delayed[]>(),
		lateLines: new Set<LateLine>(),
		cardsLeft: 0,
		pendingFits: null,
		holderFor: (shell) => (lazy ? createSvg('g') : shell),
		delay: (person, box, card, attach) => {
			const d: Delayed = { box, person, card, attach };
			ctx.delayed.add(d);
			if (card) ctx.cardsLeft++;
			const list = ctx.byPerson.get(person);
			if (list) list.push(d);
			else ctx.byPerson.set(person, [d]);
		},
		lateLine: (box, put) => ctx.lateLines.add({ box: box ?? EVERYWHERE, put }),
		putLine: (l) => {
			if (!ctx.lateLines.delete(l)) return 0;
			l.put();
			return 1;
		},
		attachItem: (d) => {
			if (!ctx.delayed.delete(d)) return 0;
			if (d.card) ctx.cardsLeft--;
			d.attach();
			return 1;
		},
		attachChildren: (holder, shell) => {
			for (const c of Array.from(holder.children)) shell.appendChild(c);
		},
	};
	return Object.assign(ctx, fitHelpers(ctx), levelHelpers());
}
