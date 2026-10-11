/*
 * The collapsible sections of the window family (0.2.8 contract C, G.13). A section has a title, a one-line summary that shows while it is closed, and a
 * chevron; the whole title row is the button. "Open all" and "Close all" stand right-aligned above the first section and are
 * hidden when a window has one section. Which sections the user opened or closed is kept for each kind of window while Obsidian
 * runs, so a window that draws again (after a write) keeps them as the user left them. Only the user's own taps are kept: the
 * default of a page never becomes the default of another page. A new page keeps its state in its own window only. The bodies are built when the section is
 * drawn, so a window can find a field in a closed section (a test, or a focus that goes back to it).
 */

import { setIcon } from 'obsidian';
import { WINDOW_UI } from '../render/ui-text';

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
}

/** What a window does with the sections it drew. */
export interface SectionsView {
	/** The summary line of a section changes (for example the line of succession after a rule changed). */
	setSummary(key: string, text: string): void;
	/** Opens or closes one section. */
	setOpen(key: string, open: boolean): void;
	isOpen(key: string): boolean;
	/** The element of a section (for a focus that must find a control in it). */
	el(key: string): HTMLElement | null;
	/** The row of "Open all" (null when the window has one section): a window may add quiet links at its left (the person window: "Add portrait or arms", "Open linked note"). */
	openAllRow: HTMLElement | null;
}

/** Which sections are open, by kind of window, for this session. It is never written to a file. */
const OPEN: Record<string, Record<string, boolean>> = {};
/** The same, for new pages (a new person, title or house): it lives and dies with the window that drew the page. */
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
		return (parent.ownerDocument.defaultView ?? window).matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
	} catch {
		return false;
	}
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
	interface Drawn {
		spec: SectionSpec;
		el: HTMLElement;
		head: HTMLButtonElement;
		sum: HTMLElement;
	}
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
	// `user`: a tap of the user; only that is stored.
	const setOpen = (d: Drawn, open: boolean, user = false) => {
		d.el.toggleClass('is-open', open);
		d.head.setAttribute('aria-expanded', String(open));
		if (user) state[d.spec.key] = open;
	};
	if (specs.length > 1) {
		const row = parent.createDiv({ cls: 'dynasty-openall' });
		allRow = row;
		allBtn = row.createEl('button', { cls: 'dynasty-openall-button', attr: { type: 'button', 'data-focus': 'open-all' } });
	}
	for (const spec of specs) {
		const id = `dynasty-section-${++counter}`;
		const el = parent.createEl('section', { cls: 'dynasty-section', attr: { 'data-section': spec.key } });
		const head = el.createEl('button', { cls: 'dynasty-section-head', attr: { type: 'button', 'aria-controls': id, 'aria-expanded': 'false', 'data-focus': `section:${spec.key}` } });
		head.createSpan({ cls: 'dynasty-section-title', text: spec.title });
		const sum = head.createSpan({ cls: 'dynasty-section-sum', text: spec.summary });
		setIcon(head.createSpan({ cls: 'dynasty-section-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		const wrap = el.createDiv({ cls: 'dynasty-section-wrap', attr: { id } });
		const inner = wrap.createDiv({ cls: 'dynasty-section-inner' });
		spec.build(inner.createDiv({ cls: 'dynasty-section-body' }));
		const d: Drawn = { spec, el, head, sum };
		drawn.push(d);
		setOpen(d, state[spec.key] ?? spec.open);
		head.addEventListener('click', () => {
			setOpen(d, !el.hasClass('is-open'), true);
			paintAll();
			onToggle?.();
		});
	}
	allBtn?.addEventListener('click', () => {
		const all = drawn.every((d) => d.el.hasClass('is-open'));
		for (const d of drawn) setOpen(d, !all, true);
		paintAll();
		onToggle?.();
	});
	paintAll();
	const find = (key: string) => drawn.find((d) => d.spec.key === key);
	return {
		setSummary(key, text) {
			const d = find(key);
			if (d && d.sum.getText() !== text) d.sum.setText(text);
		},
		setOpen(key, open) {
			const d = find(key);
			if (!d) return;
			setOpen(d, open);
			paintAll();
		},
		isOpen: (key) => find(key)?.el.hasClass('is-open') ?? false,
		el: (key) => find(key)?.el ?? null,
		openAllRow: allRow,
	};
}
