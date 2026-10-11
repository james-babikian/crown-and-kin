/*
 * A small stand-in for the browser DOM and Obsidian's element helpers (createEl, createDiv,
 * createSvg, addClass, setText, ...): enough to drive the real PanZoom, TreeView,
 * FullScreenModal and EditSheet in Node. Events travel as in a browser: capture listeners from
 * the root down to the target, then bubble listeners from the target up. Time, animation frames,
 * timers and resize observers are fake: they move on only when a test says so.
 *
 * Used with `vi.mock('obsidian', () => import('./fake-obsidian'))`.
 */

export interface FakeEvent {
	type: string;
	target: FEl;
	currentTarget: FEl | typeof fakeWin | null;
	bubbles: boolean;
	defaultPrevented: boolean;
	preventDefault(): void;
	stopPropagation(): void;
	stopImmediatePropagation(): void;
	[k: string]: unknown;
}

type Handler = (e: FakeEvent) => void;
type Listener = { fn: Handler; capture: boolean };
type AttrValue = string | number | boolean | null | undefined;
export interface ElOptions {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, AttrValue>;
}

/** Fake time for performance.now(), animation frames and timers, in ms. */
export const clock = { now: 10_000 };
/**
 * What the fake window reports: `(pointer: coarse)`, its width and its height, and the screen's
 * size (`window.screen`; 0 = the same as the window, as on a phone with no keyboard open).
 */
/** `reduceMotion` is the answer of `(prefers-reduced-motion: reduce)` (D126). */
export const device = { coarse: false, width: 1280, height: 800, screenWidth: 0, screenHeight: 0, reduceMotion: false };
const FRAME_MS = 16;

/** Listeners on the window: the top of every event path (capture first, bubble last). */
const winListeners = new Map<string, Listener[]>();

/** Number of listeners on the fake window, of every type. */
export function windowListenerCount(): number {
	return [...winListeners.values()].reduce((n, ls) => n + ls.length, 0);
}

/** Change listeners of the media queries the code asked for (see fakeMedia). */
const mediaListeners = new Set<{ query: string; fn: (e: unknown) => void }>();

/**
 * A live MediaQueryList for `(pointer: coarse)` / `(any-pointer: coarse)` and `(orientation:
 * portrait|landscape)` (portrait: height greater than width); other queries never match.
 */
function fakeMedia(query: string) {
	const matches = (): boolean => {
		if (query.includes('prefers-reduced-motion')) return device.reduceMotion;
		if (query.includes('coarse')) return device.coarse;
		if (query.includes('orientation: portrait')) return device.height > device.width;
		if (query.includes('orientation: landscape')) return device.height <= device.width;
		return false;
	};
	const add = (fn: (e: unknown) => void) => void mediaListeners.add({ query, fn });
	const remove = (fn: (e: unknown) => void) => {
		for (const l of mediaListeners) if (l.query === query && l.fn === fn) mediaListeners.delete(l);
	};
	return {
		media: query,
		get matches(): boolean {
			return matches();
		},
		addEventListener: (_type: string, fn: (e: unknown) => void) => add(fn),
		removeEventListener: (_type: string, fn: (e: unknown) => void) => remove(fn),
		addListener: add,
		removeListener: remove,
		onchange: null,
	};
}

/** Every media query listener hears a `change` (after a test changed `device`). */
export function fireMediaChange(): void {
	for (const l of [...mediaListeners]) l.fn({ media: l.query, matches: fakeMedia(l.query).matches });
}

const frames = new Map<number, () => void>();
let frameId = 0;
const timers = new Map<number, { fn: () => void; at: number }>();
let timerId = 0;

export const fakeWin = {
	get innerWidth(): number {
		return device.width;
	},
	get innerHeight(): number {
		return device.height;
	},
	get screen(): { width: number; height: number } {
		return { width: device.screenWidth || device.width, height: device.screenHeight || device.height };
	},
	requestAnimationFrame(cb: () => void): number {
		frames.set(++frameId, cb);
		return frameId;
	},
	cancelAnimationFrame(id: number): void {
		frames.delete(id);
	},
	setTimeout(fn: () => void, ms = 0): number {
		timers.set(++timerId, { fn, at: clock.now + ms });
		return timerId;
	},
	clearTimeout(id: number): void {
		timers.delete(id);
	},
	matchMedia: (query: string) => fakeMedia(query),
	addEventListener(type: string, fn: Handler, opts?: boolean | { capture?: boolean }): void {
		const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
		winListeners.set(type, [...(winListeners.get(type) ?? []), { fn, capture }]);
	},
	removeEventListener(type: string, fn: Handler, opts?: boolean | { capture?: boolean }): void {
		const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
		winListeners.set(
			type,
			(winListeners.get(type) ?? []).filter((l) => l.fn !== fn || l.capture !== capture),
		);
	},
};

/** An event at the window itself (for example `resize` or `orientationchange`): only window listeners hear it. */
export function dispatchWindow(type: string): void {
	const e = { type, target: fakeWin, currentTarget: fakeWin, bubbles: false, defaultPrevented: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
	for (const l of [...(winListeners.get(type) ?? [])]) l.fn.call(fakeWin, e as unknown as FakeEvent);
}

/** Runs the animation frames queued now, as one frame 16 ms later. */
export function runFrame(): void {
	const due = [...frames.values()];
	frames.clear();
	clock.now += FRAME_MS;
	for (const cb of due) cb();
}

/** Runs frames until none is queued (an animation runs to its end). */
export function flushFrames(): void {
	for (let i = 0; frames.size && i < 1000; i++) runFrame();
	if (frames.size) throw new Error('fake DOM: animation frames never stop');
}

/** Moves the clock on by `ms` and runs the timers that are due, in time order. */
export function runTimers(ms = 10_000): void {
	const end = clock.now + ms;
	for (let i = 0; i < 1000; i++) {
		const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
		if (!next) break;
		timers.delete(next[0]);
		clock.now = Math.max(clock.now, next[1].at);
		next[1].fn();
	}
	clock.now = end;
}

/** Lets pending promises (for example an awaited handle) finish. */
export async function settle(): Promise<void> {
	for (let i = 0; i < 3; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

const observers = new Set<FakeResizeObserver>();

class FakeResizeObserver {
	constructor(private readonly cb: (entries: unknown[], o: unknown) => void) {}
	observe(): void {
		observers.add(this);
	}
	unobserve(): void {}
	disconnect(): void {
		observers.delete(this);
	}
	fire(): void {
		this.cb([], this);
	}
}

/** Every observed element reports a size change (the first layout of a view, or a rotation). */
export function resizeAll(): void {
	for (const o of [...observers]) o.fire();
}

function parseSimple(sel: string): (el: FEl) => boolean {
	const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/.exec(sel);
	if (!m) throw new Error(`fake DOM: unsupported selector "${sel}"`);
	const tag = m[1]?.toLowerCase();
	const classes = m[2] ? m[2].slice(1).split('.') : [];
	const attrs = [...(m[3] ?? '').matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((a) => ({ name: a[1], value: a[2] }));
	return (el) =>
		(!tag || el.tag === tag) &&
		classes.every((c) => el.classes.has(c)) &&
		attrs.every((a) => el.attrs.has(a.name) && (a.value === undefined || el.attrs.get(a.name) === a.value));
}

/** `a b` (descendant) and `:scope > a` (child of `scope`) are the only combinators. */
function matchesOne(el: FEl, sel: string, scope: FEl | null): boolean {
	let s = sel.trim();
	let childOf: FEl | null = null;
	if (s.startsWith(':scope')) {
		s = s.replace(/^:scope\s*>\s*/, '');
		childOf = scope;
		if (!childOf) throw new Error(`fake DOM: ":scope" outside querySelector in "${sel}"`);
	}
	const parts = s.split(/\s+/).map(parseSimple);
	if (!parts[parts.length - 1](el)) return false;
	if (childOf && el.parentElement !== childOf) return false;
	let i = parts.length - 2;
	for (let a = el.parentElement; a && i >= 0; a = a.parentElement) if (parts[i](a)) i--;
	return i < 0;
}

function matchesList(el: FEl, sel: string, scope: FEl | null): boolean {
	return sel.split(',').some((s) => matchesOne(el, s, scope));
}

export class FEl {
	readonly tag: string;
	children: FEl[] = [];
	parentElement: FEl | null = null;
	readonly classes = new Set<string>();
	readonly attrs = new Map<string, string>();
	readonly listeners = new Map<string, Listener[]>();
	readonly captured = new Set<number>();
	readonly styleProps = new Map<string, string>();
	readonly style = {
		setProperty: (k: string, v: string) => void this.styleProps.set(k, v),
		removeProperty: (k: string) => void this.styleProps.delete(k),
		getPropertyValue: (k: string) => this.styleProps.get(k) ?? '',
	};
	text = '';
	hidden = false;
	isConnected = true;
	clientWidth = 800;
	clientHeight = 600;
	offsetTop = 0;
	offsetHeight = 0;
	offsetWidth = 0;
	scrollTop = 0;
	scrollLeft = 0;
	scrollHeight = 0;
	scrollWidth = 0;
	// Form control state, set by the edit sheet.
	value = '';
	checked = false;
	disabled = false;
	readOnly = false;

	constructor(tag = 'div', o: ElOptions = {}) {
		this.tag = tag.toLowerCase();
		const cls = o.cls === undefined ? [] : Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/);
		for (const c of cls) if (c) this.classes.add(c);
		if (o.text !== undefined) this.text = o.text;
		for (const [k, v] of Object.entries(o.attr ?? {})) if (v !== null && v !== undefined && v !== false) this.attrs.set(k, String(v));
	}

	get win(): typeof fakeWin {
		return fakeWin;
	}

	get doc(): typeof fakeDoc {
		return fakeDoc;
	}

	createEl(tag: string, o: ElOptions | string = {}): FEl {
		const c = new FEl(tag, typeof o === 'string' ? { cls: o } : o);
		c.parentElement = this;
		this.children.push(c);
		return c;
	}

	createDiv(o?: ElOptions | string): FEl {
		return this.createEl('div', o);
	}

	createSpan(o?: ElOptions | string): FEl {
		return this.createEl('span', o);
	}

	createSvg(tag: string, o?: ElOptions | string): FEl {
		return this.createEl(tag, o);
	}

	addClass(...c: string[]): void {
		c.forEach((x) => this.classes.add(x));
	}

	removeClass(...c: string[]): void {
		c.forEach((x) => this.classes.delete(x));
	}

	hasClass(c: string): boolean {
		return this.classes.has(c);
	}

	toggleClass(c: string, on: boolean): void {
		if (on) this.classes.add(c);
		else this.classes.delete(c);
	}

	setText(t: string): void {
		this.text = t;
		this.children = [];
	}

	/** Obsidian's `appendText`: adds a text node after the existing content. The fake keeps it in `text`. */
	appendText(t: string): void {
		this.text += t;
	}

	getText(): string {
		return this.text + this.children.map((c) => c.getText()).join('');
	}

	/** The DOM `textContent`: the own text plus the text of every child (a name `<text>` holds `<tspan>`s). */
	get textContent(): string {
		return this.getText();
	}

	set textContent(t: string) {
		this.setText(t);
	}

	show(): void {
		this.hidden = false;
	}

	hide(): void {
		this.hidden = true;
	}

	toggle(show: boolean): void {
		this.hidden = !show;
	}

	setAttribute(k: string, v: AttrValue): void {
		this.attrs.set(k, String(v));
	}

	getAttribute(k: string): string | null {
		return this.attrs.get(k) ?? null;
	}

	removeAttribute(k: string): void {
		this.attrs.delete(k);
	}

	empty(): void {
		for (const c of this.children) c.parentElement = null;
		this.children = [];
		this.text = '';
	}

	remove(): void {
		const p = this.parentElement;
		if (p) p.children = p.children.filter((c) => c !== this);
		this.parentElement = null;
	}

	prepend(c: FEl): void {
		c.remove();
		c.parentElement = this;
		this.children.unshift(c);
	}

	insertBefore(c: FEl, ref: FEl | null): FEl {
		c.remove();
		c.parentElement = this;
		const i = ref ? this.children.indexOf(ref) : -1;
		if (i < 0) this.children.push(c);
		else this.children.splice(i, 0, c);
		return c;
	}

	appendChild(c: FEl): FEl {
		c.remove();
		c.parentElement = this;
		this.children.push(c);
		return c;
	}

	get childElementCount(): number {
		return this.children.length;
	}

	contains(other: FEl | null): boolean {
		for (let e = other; e; e = e.parentElement) if (e === this) return true;
		return false;
	}

	matches(sel: string): boolean {
		return matchesList(this, sel, null);
	}

	closest(sel: string): FEl | null {
		return this.matches(sel) ? this : (this.parentElement?.closest(sel) ?? null);
	}

	/** This element and all its descendants, in document order. */
	all(): FEl[] {
		return [this, ...this.children.flatMap((c) => c.all())];
	}

	querySelectorAll(sel: string): FEl[] {
		return this.all().filter((e) => e !== this && matchesList(e, sel, this));
	}

	querySelector(sel: string): FEl | null {
		return this.querySelectorAll(sel)[0] ?? null;
	}

	addEventListener(type: string, fn: Handler, opts?: boolean | { capture?: boolean }): void {
		const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, capture }]);
	}

	removeEventListener(type: string, fn: Handler, opts?: boolean | { capture?: boolean }): void {
		const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
		this.listeners.set(
			type,
			(this.listeners.get(type) ?? []).filter((l) => l.fn !== fn || l.capture !== capture),
		);
	}

	getBoundingClientRect() {
		return { left: 0, top: 0, x: 0, y: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight };
	}

	setPointerCapture(id: number): void {
		this.captured.add(id);
	}

	hasPointerCapture(id: number): boolean {
		return this.captured.has(id);
	}

	releasePointerCapture(id: number): void {
		this.captured.delete(id);
	}

	focus(): void {
		fakeDoc.activeElement = this;
	}

	blur(): void {
		if (fakeDoc.activeElement === this) fakeDoc.activeElement = null;
	}

	scrollIntoView(): void {}
}

export const fakeDoc = {
	body: new FEl('body'),
	activeElement: null as FEl | null,
	addEventListener(): void {},
	removeEventListener(): void {},
};

/**
 * Dispatches an event at `target` as a browser does: capture listeners from the window and the
 * root down, the target's own listeners, then bubble listeners from its parent up to the window.
 */
export function dispatch(target: FEl, type: string, init: Record<string, unknown> = {}): FakeEvent {
	let stopped = false;
	let stoppedNow = false;
	const e: FakeEvent = {
		bubbles: true,
		...init,
		type,
		target,
		currentTarget: null,
		defaultPrevented: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {
			stopped = true;
		},
		stopImmediatePropagation() {
			stopped = true;
			stoppedNow = true;
		},
	};
	const path: FEl[] = [];
	for (let n: FEl | null = target; n; n = n.parentElement) path.push(n);
	const run = (node: FEl | typeof fakeWin, phase: 'capture' | 'target' | 'bubble') => {
		e.currentTarget = node;
		const ls = [...((node === fakeWin ? winListeners : (node as FEl).listeners).get(type) ?? [])];
		const ordered = phase === 'target' ? [...ls.filter((l) => l.capture), ...ls.filter((l) => !l.capture)] : ls.filter((l) => l.capture === (phase === 'capture'));
		for (const l of ordered) {
			l.fn.call(node, e);
			if (stoppedNow) return;
		}
	};
	run(fakeWin, 'capture');
	for (let i = path.length - 1; i > 0 && !stopped; i--) run(path[i], 'capture');
	if (!stopped) run(target, 'target');
	for (let i = 1; i < path.length && !stopped && e.bubbles; i++) run(path[i], 'bubble');
	if (!stopped && e.bubbles) run(fakeWin, 'bubble');
	e.currentTarget = null;
	return e;
}

/** Fields of a PointerEvent. */
export function pointer(pointerType: 'touch' | 'pen' | 'mouse', pointerId: number, clientX: number, clientY: number, isPrimary = true) {
	return { pointerId, pointerType, isPrimary, button: 0, buttons: 1, clientX, clientY };
}

/** Fields of a plain WheelEvent (no Ctrl, Cmd or Shift). */
export function wheel(deltaX: number, deltaY: number, clientX = 400, clientY = 300) {
	return { deltaX, deltaY, deltaZ: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, clientX, clientY };
}

// The plugin style sheet counts as applied (D183): main.ts waits for `--dynasty-css-ready` on a cold start.
const COMPUTED = { fontSize: '16px', fontFamily: 'sans-serif', paddingTop: '0px', getPropertyValue: (name: string) => (name === '--dynasty-css-ready' ? '1' : '') };

/** Puts the fake globals in place (Obsidian's createEl and friends, ResizeObserver, getComputedStyle). */
export function installDom(): void {
	const g = globalThis as Record<string, unknown>;
	g.ResizeObserver = FakeResizeObserver;
	g.createEl = (tag: string, o?: ElOptions | string) => new FEl(tag, typeof o === 'string' ? { cls: o } : o);
	g.createDiv = (o?: ElOptions | string) => new FEl('div', typeof o === 'string' ? { cls: o } : o);
	g.createSpan = (o?: ElOptions | string) => new FEl('span', typeof o === 'string' ? { cls: o } : o);
	// The lazy scene (M11) builds card content in a detached holder made with the global `createSvg`.
	g.createSvg = (tag: string, o?: ElOptions | string) => new FEl(tag, typeof o === 'string' ? { cls: o } : o);
	// Obsidian's createFragment: a fake element stands in for the DocumentFragment (the Notice with Undo).
	g.createFragment = (cb?: (f: FEl) => void) => {
		const f = new FEl('fragment');
		cb?.(f);
		return f;
	};
	g.getComputedStyle = () => COMPUTED;
	g.document = fakeDoc;
}

/** A clean start for each test. */
export function resetDom(): void {
	frames.clear();
	timers.clear();
	observers.clear();
	winListeners.clear();
	mediaListeners.clear();
	clock.now = 10_000;
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
	device.screenWidth = 0;
	device.screenHeight = 0;
	device.reduceMotion = false;
	fakeDoc.activeElement = null;
	fakeDoc.body.empty();
}
