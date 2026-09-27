import { FEl } from './fake-dom';

/*
 * The parts of the `obsidian` module that the tree view, the full-screen view and the edit sheet
 * use, on the fake DOM of fake-dom.ts. Use it with `vi.mock('obsidian', () => import('./fake-obsidian'))`.
 * `events` records modal closes and link opens in order, so a test can check which came first.
 */

/** "close <ModalClass>" and "open-link <linktext>", in the order they happened. */
export const events: string[] = [];
export const openModals: Modal[] = [];
export const notices: string[] = [];
/** The Notices themselves, in order: a test can press a button in one (Undo, spec §6.1). */
export const noticeList: Notice[] = [];

export function resetObsidian(): void {
	events.length = 0;
	openModals.length = 0;
	notices.length = 0;
	noticeList.length = 0;
	settingRows.length = 0;
	settingGroups.length = 0;
}

export class Modal {
	readonly containerEl: FEl;
	readonly modalEl: FEl;
	readonly titleEl: FEl;
	readonly contentEl: FEl;

	constructor(public app: unknown) {
		this.containerEl = new FEl('div', { cls: 'modal-container' });
		this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
		this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
		this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
	}

	open(): void {
		if (openModals.includes(this)) return;
		openModals.push(this);
		this.onOpen();
	}

	close(): void {
		const i = openModals.indexOf(this);
		if (i < 0) return;
		openModals.splice(i, 1);
		events.push(`close ${this.constructor.name}`);
		this.onClose();
	}

	setTitle(t: string): this {
		this.titleEl.setText(t);
		return this;
	}

	onOpen(): void {}
	onClose(): void {}
}

export class SuggestModal<T> extends Modal {
	inputEl = new FEl('input');
	resultContainerEl = new FEl('div');
	limit = 100;
	emptyStateText = '';
	setPlaceholder(): void {}
	setInstructions(): void {}
	getSuggestions(): T[] {
		return [];
	}
}

export class Notice {
	readonly noticeEl = new FEl('div', { cls: 'notice' });
	readonly messageEl = this.noticeEl;
	hidden = false;
	constructor(message: unknown) {
		// A fragment (createFragment) is shown as its text.
		notices.push(message instanceof FEl ? message.getText() : String(message));
		noticeList.push(this);
	}
	setMessage(): this {
		return this;
	}
	hide(): void {
		this.hidden = true;
	}
}

export class MarkdownRenderChild {
	private readonly cleanups: (() => void)[] = [];
	constructor(public containerEl: FEl) {}
	registerDomEvent(el: FEl, type: string, fn: (e: never) => void, opts?: boolean | { capture?: boolean }): void {
		el.addEventListener(type, fn as never, opts);
		this.cleanups.push(() => el.removeEventListener(type, fn as never, opts));
	}
	register(fn: () => void): void {
		this.cleanups.push(fn);
	}
	load(): void {
		this.onload();
	}
	unload(): void {
		for (const c of this.cleanups.splice(0)) c();
		this.onunload();
	}
	onload(): void {}
	onunload(): void {}
}

export class MarkdownView {}
export class TFile {
	constructor(
		public path = '',
		public extension = 'md',
	) {}
}
/** A command the plugin added, as `addCommand` got it. */
export interface FakeCommand {
	id: string;
	name: string;
	callback?: () => unknown;
	editorCallback?: (editor: unknown, view: unknown) => unknown;
}

/** Enough of Obsidian's Plugin for main.ts to load and unload. `stored` is what `loadData` returns; `saved` what `saveData` got. */
export class Plugin {
	readonly codeBlockProcessors = new Map<string, (source: string, el: unknown, ctx: unknown) => void>();
	readonly commands: FakeCommand[] = [];
	readonly settingTabs: PluginSettingTab[] = [];
	stored: unknown = null;
	saved: unknown[] = [];
	private readonly cleanups: (() => void)[] = [];
	constructor(
		public app: unknown,
		public manifest: unknown,
	) {}
	registerMarkdownCodeBlockProcessor(lang: string, fn: (source: string, el: unknown, ctx: unknown) => void): void {
		this.codeBlockProcessors.set(lang, fn);
	}
	registerHoverLinkSource(): void {}
	registerEditorExtension(): void {}
	registerEvent(): void {}
	addCommand(c: FakeCommand): void {
		this.commands.push(c);
	}
	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}
	async loadData(): Promise<unknown> {
		return this.stored;
	}
	async saveData(data: unknown): Promise<void> {
		this.saved.push(JSON.parse(JSON.stringify(data)));
	}
	register(fn: () => void): void {
		this.cleanups.push(fn);
	}
	async load(): Promise<void> {
		await this.onload();
	}
	unload(): void {
		for (const c of this.cleanups.splice(0)) c();
		this.onunload();
	}
	async onload(): Promise<void> {}
	onunload(): void {}
}

export const Keymap = { isModEvent: () => false };
export const getLinkpath = (s: string) => s;
export const setIcon = () => {};
export const prepareFuzzySearch = () => () => null;
export const debounce = <F>(f: F) => f;

// ---------- Settings (spec §9): Setting, SettingGroup and PluginSettingTab on the fake DOM ----------

type Change<T> = (v: T) => unknown;

/** A text field: `inputEl.value` and `fire(value)` as if the user typed. */
export class TextComponent {
	readonly inputEl: FEl;
	private change: Change<string> | null = null;
	constructor(parent: FEl) {
		this.inputEl = parent.createEl('input', { attr: { type: 'text' } });
	}
	setValue(v: string): this {
		this.inputEl.value = v;
		return this;
	}
	getValue(): string {
		return this.inputEl.value;
	}
	onChange(fn: Change<string>): this {
		this.change = fn;
		return this;
	}
	fire(v: string): void {
		this.inputEl.value = v;
		this.change?.(v);
	}
}

export class DropdownComponent {
	readonly selectEl: FEl;
	readonly options: [string, string][] = [];
	private change: Change<string> | null = null;
	constructor(parent: FEl) {
		this.selectEl = parent.createEl('select', { cls: 'dropdown' });
	}
	addOption(value: string, text: string): this {
		this.options.push([value, text]);
		this.selectEl.createEl('option', { text, attr: { value } });
		return this;
	}
	setValue(v: string): this {
		this.selectEl.value = v;
		return this;
	}
	getValue(): string {
		return this.selectEl.value;
	}
	onChange(fn: Change<string>): this {
		this.change = fn;
		return this;
	}
	fire(v: string): void {
		this.selectEl.value = v;
		this.change?.(v);
	}
}

export class ToggleComponent {
	readonly toggleEl: FEl;
	private change: Change<boolean> | null = null;
	constructor(parent: FEl) {
		this.toggleEl = parent.createDiv({ cls: 'checkbox-container' });
	}
	setValue(v: boolean): this {
		this.toggleEl.checked = v;
		return this;
	}
	getValue(): boolean {
		return this.toggleEl.checked;
	}
	onChange(fn: Change<boolean>): this {
		this.change = fn;
		return this;
	}
	fire(v: boolean): void {
		this.toggleEl.checked = v;
		this.change?.(v);
	}
}

export class ButtonComponent {
	readonly buttonEl: FEl;
	private click: (() => unknown) | null = null;
	constructor(parent: FEl) {
		this.buttonEl = parent.createEl('button');
	}
	setButtonText(t: string): this {
		this.buttonEl.setText(t);
		return this;
	}
	onClick(fn: () => unknown): this {
		this.click = fn;
		return this;
	}
	fire(): void {
		this.click?.();
	}
}

type Component = TextComponent | DropdownComponent | ToggleComponent | ButtonComponent;

/** Every Setting made, with its name and controls, so a test can find a setting by its name. */
export const settingRows: Setting[] = [];

export class Setting {
	readonly settingEl: FEl;
	readonly infoEl: FEl;
	readonly nameEl: FEl;
	readonly descEl: FEl;
	readonly controlEl: FEl;
	readonly components: Component[] = [];
	heading = false;
	constructor(containerEl: FEl) {
		this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
		this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
		this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
		this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
		this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
		settingRows.push(this);
	}
	setName(n: string): this {
		this.nameEl.setText(n);
		return this;
	}
	setDesc(d: string): this {
		this.descEl.setText(d);
		return this;
	}
	setClass(c: string): this {
		this.settingEl.addClass(c);
		return this;
	}
	setHeading(): this {
		this.heading = true;
		this.settingEl.addClass('setting-item-heading');
		return this;
	}
	private add<C extends Component>(c: C, cb: (c: C) => unknown): this {
		this.components.push(c);
		cb(c);
		return this;
	}
	addText(cb: (c: TextComponent) => unknown): this {
		return this.add(new TextComponent(this.controlEl), cb);
	}
	addDropdown(cb: (c: DropdownComponent) => unknown): this {
		return this.add(new DropdownComponent(this.controlEl), cb);
	}
	addToggle(cb: (c: ToggleComponent) => unknown): this {
		return this.add(new ToggleComponent(this.controlEl), cb);
	}
	addButton(cb: (c: ButtonComponent) => unknown): this {
		return this.add(new ButtonComponent(this.controlEl), cb);
	}
}

/** Obsidian 1.11 and later. `groups` lists every group made, with its heading. */
export const settingGroups: SettingGroup[] = [];

export class SettingGroup {
	readonly groupEl: FEl;
	readonly listEl: FEl;
	heading = '';
	constructor(containerEl: FEl) {
		this.groupEl = containerEl.createDiv({ cls: 'setting-group' });
		this.listEl = this.groupEl.createDiv({ cls: 'setting-items' });
		settingGroups.push(this);
	}
	setHeading(t: string): this {
		this.heading = t;
		this.groupEl.prepend(new FEl('div', { cls: ['setting-item', 'setting-item-heading'], text: t }));
		return this;
	}
	addClass(...c: string[]): this {
		this.groupEl.addClass(...c);
		return this;
	}
	addSetting(cb: (s: Setting) => unknown): this {
		cb(new Setting(this.listEl));
		return this;
	}
}

export class PluginSettingTab {
	readonly containerEl = new FEl('div', { cls: 'vertical-tab-content' });
	constructor(
		public app: unknown,
		public plugin: unknown,
	) {}
	display(): void {}
	hide(): void {}
}
