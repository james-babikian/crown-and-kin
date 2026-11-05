/*
 * The collapsible sections of the window family. A section has a title, a one-line summary that shows while it is closed, and a
 * chevron; the whole title row is the button. "Open all" and "Close all" stand right-aligned above the first section and are
 * hidden when a window has one section. Which sections the user opened or closed is kept for each kind of window while Obsidian
 * runs, so a window that draws again (after a write) keeps them as the user left them. Only the user's own taps are kept: the
 * default of a page never becomes the default of another page. A new page keeps its state in its own window only. The bodies are built when the section is
 * drawn, so a window can find a field in a closed section (a test, or a focus that goes back to it). A section that the user opens scrolls into
 * view when it has opened (UX-01); no other section closes by itself.
 */

import { setIcon } from 'obsidian';
import { mediaMatches } from '../render/dom/page-reads';
import { splitOutsideIsolates } from '../render/bidi-controls';
import { joined } from '../render/text-join';
import { WINDOW_UI } from '../render/ui-text';

const SUM_JOIN = ' · ';

/** One section of a window. */
export interface SectionSpec {
	/** Names the section in the open state and in `data-section`. */
	key: string;
	title: string;
	/** The line under the title while the section is closed. Empty: the section has no line (D218 item 6, the Actions section). The window can change it later (`setSummary`). */
	summary: string;
	/** True when the section is open the first time its kind of window shows. */
	open: boolean;
	/** Draws the fields and rows into the body. */
	build(body: HTMLElement): void;
	/** Called each time the section opens or closes, also once when the page is drawn (a section can use it to work only while it is open). */
	onOpen?(open: boolean): void;
}

/** What a window does with the sections it drew. */
export interface SectionsView {
	/** The summary line of a section changes (for example the line of succession after a rule changed). */
	setSummary(key: string, text: string): void;
	/** True when the section is open (only the tests read it). */
	isOpen(key: string): boolean;
	/** Opens a section (a refusal that stands in it, a calendar that was just added). The window keeps it open, as after a tap of the user. */
	open(key: string): void;
	/** The element of a section (for a focus that must find a control in it). */
	el(key: string): HTMLElement | null;
	/** The row of "Open all" (null when the window has one section): a window may add quiet links at its left (the person window: "Add portrait or arms", "Open linked note"). */
	openAllRow: HTMLElement | null;
}

/** Which sections are open, by kind of window, for this session. It is never written to a file. */
const OPEN: Record<string, Record<string, boolean>> = {};
/** The same, for a window that keeps its own state (a new page of a person, title or house; the Calendars window): it lives and dies with the window that drew the page. */
const OWN = new WeakMap<object, Record<string, Record<string, boolean>>>();

/** Forgets the open state (a test starts clean). */
export function resetOpenSections(): void {
	for (const k of Object.keys(OPEN)) delete OPEN[k];
}

/** The open state of a section of a kind of window, or `undefined` when the user never changed it. */
export function openState(kind: string, key: string): boolean | undefined {
	return OPEN[kind]?.[key];
}

let counter = 0;

/** True when the system asks for less movement; a missing or failing `matchMedia` is false. */
function prefersReducedMotion(parent: HTMLElement): boolean {
	try {
		return mediaMatches(parent.ownerDocument.defaultView ?? window, '(prefers-reduced-motion: reduce)');
	} catch {
		return false;
	}
}

/** How long a section takes to open at most: the CSS change of its height lasts 200 ms. */
const OPEN_WAIT_MS = 320;

/**
 * UX-01: brings an opened section into the visible part of the window body: its bottom comes up as far as the heading allows, and a heading above
 * the top comes down to it. A section that is in view stays. `instant`: reduced motion, so the jump is not animated.
 */
function scrollIntoBody(el: HTMLElement, instant: boolean): void {
	if (!el.isConnected || !el.hasClass('is-open')) return;
	const box = el.closest<HTMLElement>('.dynasty-sheet-body');
	if (!box) {
		el.scrollIntoView({ block: 'nearest', behavior: instant ? 'instant' : 'smooth' });
		return;
	}
	const at = el.getBoundingClientRect();
	const view = box.getBoundingClientRect();
	const hidden = at.bottom - view.bottom;
	const delta = at.top < view.top ? at.top - view.top : hidden > 0 ? Math.min(hidden, at.top - view.top) : 0;
	if (Math.abs(delta) < 1) return;
	if (instant || typeof box.scrollTo !== 'function') box.scrollTop += delta;
	else box.scrollTo({ top: box.scrollTop + delta, behavior: 'smooth' });
}

/** UX-01: scrolls `d` into view when its change of height has ended (a section grows over 200 ms); at once under reduced motion. */
function revealWhenOpen(d: Drawn, instant: boolean): void {
	if (instant) {
		scrollIntoBody(d.el, true);
		return;
	}
	const wrap = d.el.querySelector<HTMLElement>('.dynasty-section-wrap');
	const win = d.el.win;
	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		wrap?.removeEventListener('transitionend', onEnd);
		win.clearTimeout(timer);
		scrollIntoBody(d.el, false);
	};
	const onEnd = (e: Event) => {
		if (e.target === wrap) run();
	};
	wrap?.addEventListener('transitionend', onEnd);
	const timer = win.setTimeout(run, OPEN_WAIT_MS);
}

/** One section as drawn: its spec and its parts. */
interface Drawn {
	spec: SectionSpec;
	el: HTMLElement;
	head: HTMLButtonElement;
	/** Replaced when the summary changes, because a joined text line is built once. */
	sum: HTMLElement;
	/** The text the summary shows now. */
	text: string;
}

/**
 * K-10: the summary line, with its parts as items of a joined text line. The "·" belongs to the item after it and hides when that item starts a wrapped
 * text line, so a text line of the summary never ends with a dot (the dot at the end of a line was left behind by a plain text). A summary that has no "·"
 * is one item. The element is the summary line itself, so its rules (one text line, or two on a phone) apply to it.
 */
function summaryLine(head: HTMLElement, text: string): HTMLElement {
	return joined(head, 'dynasty-section-sum', splitOutsideIsolates(text, SUM_JOIN).filter((part) => part !== ''), 'span');
}

/** Draws the summary again: a joined text line is built once, so the new one stands where the old one stood. */
function replaceSummary(d: Drawn, text: string): void {
	const next = summaryLine(d.head, text);
	d.head.insertBefore(next, d.sum);
	d.sum.remove();
	d.sum = next;
	d.text = text;
}

/** The elements of one section: the title row (a button), its body and the animated wrapper; the body is built at once, so a closed section has its fields. */
function drawSection(parent: HTMLElement, spec: SectionSpec): Drawn {
	const id = `dynasty-section-${++counter}`;
	const el = parent.createEl('section', { cls: 'dynasty-section', attr: { 'data-section': spec.key } });
	const head = el.createEl('button', { cls: 'dynasty-section-head', attr: { type: 'button', 'aria-controls': id, 'aria-expanded': 'false', 'data-focus': `section:${spec.key}` } });
	head.createSpan({ cls: 'dynasty-section-title', text: spec.title });
	const sum = summaryLine(head, spec.summary);
	setIcon(head.createSpan({ cls: 'dynasty-section-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
	const wrap = el.createDiv({ cls: 'dynasty-section-wrap', attr: { id } });
	spec.build(wrap.createDiv({ cls: 'dynasty-section-inner' }).createDiv({ cls: 'dynasty-section-body' }));
	return { spec, el, head, sum, text: spec.summary };
}

/** Draws the sections of one window page into `parent`. */
export function renderSections(parent: HTMLElement, kind: string, specs: readonly SectionSpec[], onToggle?: () => void, own?: object): SectionsView {
	// A new page does not read what the user did on saved pages: its first field could be hidden by a tap on another page.
	const store = own ? (OWN.get(own) ?? OWN.set(own, {}).get(own)!) : OPEN;
	const state = (store[kind] ??= {});
	// The sections stand edge to edge, so the parent has no gap between its children.
	parent.addClass('has-sections');
	// The same class as the tree view (D126): the style sheet has no media query for movement, so the section animation stops with this class.
	parent.toggleClass('dynasty-reduce-motion', prefersReducedMotion(parent));
	const drawn: Drawn[] = [];
	let allBtn: HTMLButtonElement | null = null;
	let allRow: HTMLElement | null = null;
	const paintAll = () => {
		if (!allBtn) return;
		const all = drawn.every((d) => d.el.hasClass('is-open'));
		allBtn.empty();
		setIcon(allBtn.createSpan({ cls: 'dynasty-openall-icon', attr: { 'aria-hidden': 'true' } }), all ? 'chevrons-down-up' : 'chevrons-up-down');
		allBtn.createSpan({ text: all ? WINDOW_UI.closeAll : WINDOW_UI.openAll });
		allBtn.setAttribute('aria-label', all ? WINDOW_UI.closeAllLabel : WINDOW_UI.openAllLabel);
	};
	// `user`: a tap of the user; only that is stored. A change of a section also paints the button of all and tells the window.
	const setOpen = (d: Drawn, open: boolean, user = false) => {
		d.el.toggleClass('is-open', open);
		d.head.setAttribute('aria-expanded', String(open));
		if (user) state[d.spec.key] = open;
		d.spec.onOpen?.(open);
	};
	const changed = () => {
		paintAll();
		onToggle?.();
	};
	if (specs.length > 1) {
		const row = parent.createDiv({ cls: 'dynasty-openall' });
		allRow = row;
		allBtn = row.createEl('button', { cls: 'dynasty-openall-button', attr: { type: 'button', 'data-focus': 'open-all' } });
	}
	for (const spec of specs) {
		const d = drawSection(parent, spec);
		drawn.push(d);
		setOpen(d, state[spec.key] ?? spec.open);
		d.head.addEventListener('click', () => {
			const opening = !d.el.hasClass('is-open');
			setOpen(d, opening, true);
			changed();
			if (opening) revealWhenOpen(d, parent.hasClass('dynasty-reduce-motion'));
		});
	}
	allBtn?.addEventListener('click', () => {
		const all = drawn.every((d) => d.el.hasClass('is-open'));
		for (const d of drawn) setOpen(d, !all, true);
		changed();
	});
	paintAll();
	const find = (key: string) => drawn.find((d) => d.spec.key === key);
	return {
		setSummary(key, text) {
			const d = find(key);
			if (d && d.text !== text) replaceSummary(d, text);
		},
		open(key) {
			const d = find(key);
			if (!d || d.el.hasClass('is-open')) return;
			setOpen(d, true, true);
			changed();
			revealWhenOpen(d, parent.hasClass('dynasty-reduce-motion'));
		},
		isOpen: (key) => find(key)?.el.hasClass('is-open') ?? false,
		el: (key) => find(key)?.el ?? null,
		openAllRow: allRow,
	};
}
