import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { NEW_HOUSE } from '../../src/view/sheet-draft';
import { createPictureStore, type PictureCopy, type PictureStore } from '../../src/obsidian/picture-store';
import { FEl, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';
import { vaultFile as file } from '../support/rename-vault';

/*
 * Typing in a field of the person window leaves the header steady (D326): a header element whose content did not change keeps its
 * node, and a picture whose source did not change is not asked for again. A real change of the house still changes the arms.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8b1a1a"
    arms: "[[valmont-arms.png]]"
  - id: ardent
    name: House Ardent
    color: "#1a3a8b"
    arms: "[[ardent-arms.png]]"
  - id: plain
    name: House Plain
    color: "#1a8b3a"
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
    title: Duke of Nowhere
    born: 1100
    portrait: "[[aldric.jpg]]"
`;

interface Counts {
	acquire: number;
	transient: number;
	/** Copies given back to the store. */
	released: number;
	/** When set, a request for a kept copy waits for this promise. */
	gate: Promise<void> | null;
	/** Paths of files whose copy cannot be made. */
	failing: Set<string>;
	/** Kept copies that the store has given out and not taken back. */
	held: number;
}

/** A store like the real one for these two calls: a kept copy (acquire) has one URL per file and size; a transient copy has a new URL each time. */
function makeStore(files: VaultFile[]): { store: PictureStore; counts: Counts; app: unknown } {
	const app = {
		metadataCache: { getFirstLinkpathDest: (p: string) => files.find((f) => f.path === p || f.path.endsWith(`/${p}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null, getFiles: () => files },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => undefined,
	};
	const counts: Counts = { acquire: 0, transient: 0, released: 0, gate: null, failing: new Set(), held: 0 };
	let n = 0;
	const store: PictureStore = {
		...createPictureStore(app as never, undefined as never),
		acquire: async (f) => {
			counts.acquire++;
			if (counts.gate) await counts.gate;
			if (counts.failing.has(f.path)) return null;
			counts.held++;
			return { url: `blob:kept-${f.path}`, w: 30, h: 30, release: () => void (counts.released++, counts.held--) } as PictureCopy;
		},
		transient: async () => {
			counts.transient++;
			return { url: `blob:transient-${n++}`, w: 64, h: 64, release: () => undefined } as PictureCopy;
		},
	};
	return { store, counts, app };
}

const typed = (el: FEl, add: string) => {
	el.value = el.value + add;
	dispatch(el, 'input');
};

async function openSheet(body = BODY, failing: string[] = []) {
	const { store, counts, app } = makeStore([
		file('Pictures/aldric.jpg'),
		file('Pictures/valmont-arms.png'),
		file('Pictures/ardent-arms.png'),
		file('Pictures/broken-arms.png'),
		file('Pictures/personal.png'),
	]);
	failing.forEach((f) => counts.failing.add(f));
	const sheet = EditSheet.create(app as never, { handle: fakeHandle('Tree.md', body) as never, personId: 'aldric', sourcePath: 'Tree.md', pictures: store })!;
	sheet.open();
	const content = (sheet as unknown as { contentEl: FEl }).contentEl;
	await settle();
	const q = (sel: string) => content.querySelector(sel)!;
	const field = (key: string) => q(`[data-focus="field:${key}"]`);
	const inPage = (el: FEl | null | undefined): boolean => {
		for (let e = el ?? null; e; e = e.parentElement) if (e === content) return true;
		return false;
	};
	/** The header elements by role, as nodes. */
	const nodes = () => ({
		head: q('.dynasty-person-head'),
		text: q('.dynasty-head-text'),
		nameLine: q('.dynasty-head-name'),
		metaHost: q('.dynasty-head-metahost'),
		meta: q('.dynasty-head-meta'),
		house: q('.dynasty-house'),
		armsSlot: q('.dynasty-house-armsmark'),
		armsImg: q('.dynasty-house-armsmark img'),
		pic: q('.dynasty-pic'),
		picImg: q('.dynasty-pic-img'),
	});
	return { sheet, content, counts, q, field, nodes, inPage, store };
}

/** The sample tree with two more houses (one whose arms file is not in the vault, one whose arms picture cannot be made) and personal arms. */
const BODY_ARMS = BODY.replace(
	'people:',
	`  - id: ghost
    name: House Ghost
    color: "#1a3a8b"
    arms: "[[missing-arms.png]]"
  - id: broken
    name: House Broken
    color: "#1a8b3a"
    arms: "[[broken-arms.png]]"
people:`,
).replace('    portrait: "[[aldric.jpg]]"', '    portrait: "[[aldric.jpg]]"\n    arms: "[[personal.png]]"');

const KEYS = ['name', 'sobriquet', 'title', 'born', 'died', 'link', 'notes'] as const;

describe('the house arms picture of the detail line is not made again by a key', () => {
	it.each(KEYS)('a key in the field "%s" keeps the same arms img node and asks the store for no new arms copy', async (key) => {
		const s = await openSheet();
		const before = s.nodes();
		const askedBefore = s.counts.acquire;
		typed(s.field(key), 'x');
		await settle();
		const after = s.nodes();
		expect(s.inPage(before.armsImg), 'the old arms img is still in the page').toBe(true);
		expect(after.armsImg === before.armsImg, 'the arms img is the same node').toBe(true);
		expect(s.counts.acquire, 'new requests for the arms copy').toBe(askedBefore);
	});

	it('a change of the sex (a select) does the same: the arms img stays', async () => {
		const s = await openSheet();
		const before = s.nodes();
		const sex = s.field('sex');
		sex.value = 'm';
		dispatch(sex, 'change');
		await settle();
		expect(s.nodes().armsImg === before.armsImg).toBe(true);
	});
});

describe('the parts of the detail line that did not change keep their node', () => {
	it.each(['sobriquet', 'born', 'died', 'link', 'notes'] as const)('a key in "%s" does not change the house text, so the house span and the line keep their nodes', async (key) => {
		const s = await openSheet();
		const before = s.nodes();
		typed(s.field(key), 'x');
		await settle();
		const after = s.nodes();
		// born, died: the dates part changes, but the house part must not be made again.
		expect(after.house === before.house, 'house span node').toBe(true);
		if (key !== 'born' && key !== 'died') expect(after.meta === before.meta, 'the joined detail line node (its text did not change)').toBe(true);
	});
});

describe('the portrait picture is not replaced by a key in the name field', () => {
	it('a key in the name field keeps the portrait img node (the portrait key holds the name)', async () => {
		const s = await openSheet();
		const before = s.nodes();
		typed(s.field('name'), 'x');
		await settle();
		expect(s.inPage(before.picImg), 'the old portrait img is still in the page').toBe(true);
		expect(s.nodes().picImg === before.picImg, 'the portrait img is the same node').toBe(true);
	});

	it('the label of the portrait button still follows the name (the repair must keep this)', async () => {
		const s = await openSheet();
		typed(s.field('name'), 'x');
		await settle();
		expect(s.nodes().pic.getAttribute('aria-label')).toContain('Aldric Valmontx');
	});
});

const microtasks = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Installs an IntersectionObserver whose callback runs in a macrotask, as Chromium delivers it (after the frame that was just drawn). */
function withTaskObserver(): () => void {
	class FakeObserver {
		constructor(private readonly cb: (seen: { isIntersecting: boolean; target: FEl }[]) => void) {}
		observe(t: FEl) {
			setTimeout(() => this.cb([{ isIntersecting: true, target: t }]), 0);
		}
		unobserve() {}
		disconnect() {}
	}
	const doc = { defaultView: { IntersectionObserver: FakeObserver, getComputedStyle: () => ({ overflowY: 'visible' }) } };
	Object.defineProperty(FEl.prototype, 'ownerDocument', { configurable: true, get: () => doc });
	return () => void delete (FEl.prototype as unknown as Record<string, unknown>).ownerDocument;
}

describe('in a browser the arms mark is never missing in a painted frame after a key', () => {
	// Chromium reports an IntersectionObserver in a task after the frame. A slot that waits for it is empty (width 0) in the frame drawn
	// right after the key, and the house name stands about 20 px further left.
	it('after a key and all microtasks (the work before the browser can draw), the arms slot holds its picture', async () => {
		const s = await openSheet();
		const stop = withTaskObserver();
		try {
			typed(s.field('name'), 'x');
			await microtasks();
			expect(s.q('.dynasty-house-armsmark').querySelector('img'), 'the arms slot is empty when the frame is drawn').not.toBeNull();
		} finally {
			stop();
			await settle();
		}
	});
});

describe('parts of the header that a key never replaces', () => {
	it('with no observer the arms picture stands after the microtasks', async () => {
		const s = await openSheet();
		typed(s.field('name'), 'x');
		await microtasks();
		expect(s.q('.dynasty-house-armsmark').querySelector('img')).not.toBeNull();
	});

	it.each(['title', 'born', 'died', 'sobriquet', 'link', 'notes'] as const)('a key in "%s" keeps the portrait img node (the portrait key holds the name only)', async (key) => {
		const s = await openSheet();
		const before = s.nodes();
		typed(s.field(key), 'x');
		await settle();
		expect(s.nodes().picImg === before.picImg).toBe(true);
		expect(s.counts.transient).toBe(1);
	});

	it.each(KEYS)('a key in "%s" keeps the head, the text column, the name line, the detail host and the portrait button', async (key) => {
		const s = await openSheet();
		const before = s.nodes();
		typed(s.field(key), 'x');
		await settle();
		const after = s.nodes();
		expect(after.head === before.head && after.text === before.text && after.nameLine === before.nameLine && after.metaHost === before.metaHost && after.pic === before.pic).toBe(true);
	});

	it('typing in a date field does not touch the date readout line (it changes on blur only)', async () => {
		const s = await openSheet();
		const line = s.field('born').parentElement!.querySelector('.dynasty-date-line')!;
		const kids = [...line.children];
		typed(s.field('born'), '5');
		expect(line.children.length === kids.length && line.children.every((c, i) => c === kids[i])).toBe(true);
	});
});

const pick = (el: FEl, value: string) => {
	el.value = value;
	dispatch(el, 'change');
};

describe('a real change of the house still changes the header', () => {
	it('another house with arms swaps the arms picture, the house name and the colour', async () => {
		const s = await openSheet();
		pick(s.field('house'), 'ardent');
		await settle();
		const n = s.nodes();
		expect(n.armsImg.getAttribute('src')).toBe('blob:kept-Pictures/ardent-arms.png');
		expect(n.house.getText()).toContain('House Ardent');
		expect(s.q('.dynasty-person-head').style.getPropertyValue('--dynasty-house-color')).toBe('#1a3a8b');
	});

	it('the old arms picture stays in the slot until the new one has arrived, then goes back to the store', async () => {
		const s = await openSheet();
		const slot = s.q('.dynasty-house-armsmark');
		const img = s.nodes().armsImg;
		let open!: () => void;
		s.counts.gate = new Promise<void>((r) => (open = r));
		const releasedBefore = s.counts.released;
		pick(s.field('house'), 'ardent');
		await settle();
		expect(s.q('.dynasty-house-armsmark') === slot, 'the same slot').toBe(true);
		expect(slot.querySelector('img') === img && img.getAttribute('src') === 'blob:kept-Pictures/valmont-arms.png', 'the old picture stands').toBe(true);
		expect(s.counts.released).toBe(releasedBefore);
		open();
		await settle();
		expect(slot.querySelector('img')!.getAttribute('src')).toBe('blob:kept-Pictures/ardent-arms.png');
		expect(s.counts.released).toBe(releasedBefore + 1);
	});

	it('a house with no arms shows the dot, and the arms come back with the house that has them', async () => {
		const s = await openSheet();
		pick(s.field('house'), 'plain');
		await settle();
		expect(s.content.querySelector('.dynasty-house-armsmark')).toBeNull();
		expect(s.content.querySelector('.dynasty-house-dot')).not.toBeNull();
		pick(s.field('house'), 'valmont');
		await settle();
		expect(s.content.querySelector('.dynasty-house-dot')).toBeNull();
		expect(s.q('.dynasty-house-armsmark img').getAttribute('src')).toBe('blob:kept-Pictures/valmont-arms.png');
	});

	it('no house removes the house span, and the head loses its house mark', async () => {
		const s = await openSheet();
		pick(s.field('house'), '');
		await settle();
		expect(s.content.querySelector('.dynasty-house')).toBeNull();
		expect(s.q('.dynasty-person-head').hasClass('has-house')).toBe(false);
	});

	it('the name of a new house follows the keys in the text of the same house span', async () => {
		const s = await openSheet();
		pick(s.field('house'), NEW_HOUSE);
		const input = s.q('.dynasty-sheet-subform input');
		typed(input, 'N');
		await settle();
		const span = s.q('.dynasty-house');
		typed(input, 'ova');
		await settle();
		expect(s.q('.dynasty-house') === span).toBe(true);
		expect(span.getText()).toBe('Nova');
	});
});

describe('keys do not pile up pictures in the store', () => {
	it('twenty keys in the name and the title keep one kept copy of the arms and give none back', async () => {
		const s = await openSheet();
		for (let i = 0; i < 10; i++) {
			typed(s.field('name'), 'x');
			typed(s.field('title'), 'y');
			await settle();
		}
		expect(s.counts.acquire).toBe(1);
		expect(s.counts.released).toBe(0);
		expect(s.counts.transient).toBe(1);
	});

	it('a house change twenty times holds one copy at the end', async () => {
		const s = await openSheet();
		for (let i = 0; i < 10; i++) {
			pick(s.field('house'), 'ardent');
			await settle();
			pick(s.field('house'), 'valmont');
			await settle();
		}
		expect(s.counts.acquire - s.counts.released).toBe(1);
	});
});

describe('a part of the detail line that comes or goes', () => {
	it('a title that is cleared and typed again keeps the house span and its arms picture', async () => {
		const s = await openSheet();
		const before = s.nodes();
		const title = s.field('title');
		title.value = '';
		dispatch(title, 'input');
		await settle();
		expect(s.nodes().armsImg === before.armsImg && s.nodes().house === before.house).toBe(true);
		expect(s.q('.dynasty-head-meta').getText()).not.toContain('Duke');
		typed(title, 'Duke');
		await settle();
		expect(s.nodes().armsImg === before.armsImg).toBe(true);
		expect(s.q('.dynasty-head-meta').getText()).toContain('Duke');
	});

	it('a key in the name field changes the name line and the label of the portrait button', async () => {
		const s = await openSheet();
		typed(s.field('name'), 'x');
		expect(s.q('.dynasty-head-name').getText()).toContain('Aldric Valmontx');
		expect(s.nodes().pic.getAttribute('aria-label')).toContain('Aldric Valmontx');
	});
});

describe('the house arms slot never shows the arms of the house before', () => {
	it('a house whose arms file is not in the vault leaves the slot with no picture', async () => {
		const s = await openSheet(BODY_ARMS);
		expect(s.q('.dynasty-house-armsmark img').getAttribute('src')).toContain('valmont-arms');
		pick(s.field('house'), 'ghost');
		await settle();
		expect(s.q('.dynasty-house').getText()).toContain('House Ghost');
		expect(s.q('.dynasty-house-armsmark').querySelector('img'), 'the slot of House Ghost shows an img').toBeNull();
		expect(s.q('.dynasty-house-armsmark').hasClass('has-picture')).toBe(false);
	});

	it('a house whose arms picture cannot be made leaves the slot with no picture', async () => {
		const s = await openSheet(BODY_ARMS, ['Pictures/broken-arms.png']);
		pick(s.field('house'), 'broken');
		await settle();
		const slot = s.q('.dynasty-house-armsmark');
		expect(slot.querySelector('img'), 'a picture of the old house stands in the slot').toBeNull();
		expect(slot.hasClass('has-picture')).toBe(false);
	});

	it('the arms come back with the next house that has a picture, and one house copy is held', async () => {
		const s = await openSheet(BODY_ARMS, ['Pictures/broken-arms.png']);
		pick(s.field('house'), 'broken');
		await settle();
		pick(s.field('house'), 'ardent');
		await settle();
		expect(s.q('.dynasty-house-armsmark img').getAttribute('src')).toBe('blob:kept-Pictures/ardent-arms.png');
		// The house arms and the personal arms.
		expect(s.counts.held).toBe(2);
	});
});

describe('holds on kept copies', () => {
	const cycle = async (steps: string[], closeEarly: boolean) => {
		const s = await openSheet(BODY_ARMS);
		let open!: () => void;
		s.counts.gate = new Promise<void>((r) => (open = r));
		for (const h of steps) pick(s.field('house'), h);
		await settle();
		if (closeEarly) (s.sheet as unknown as { onClose(): void }).onClose();
		open();
		s.counts.gate = null;
		await settle();
		return s;
	};

	it('houses that change while copies are pending leave one house copy and the personal copy held', async () => {
		const s = await cycle(['', 'valmont', '', 'ardent', 'valmont'], false);
		expect(s.counts.held).toBe(2);
	});

	it('a window that closes while copies are pending holds no copy', async () => {
		const s = await cycle(['ardent', 'valmont', 'ardent'], true);
		expect(s.counts.held).toBe(0);
	});

	it('a window that closes with settled copies holds no copy', async () => {
		const s = await openSheet(BODY_ARMS);
		pick(s.field('house'), 'ardent');
		await settle();
		(s.sheet as unknown as { onClose(): void }).onClose();
		await settle();
		expect(s.counts.held).toBe(0);
	});
});

describe('the personal arms button', () => {
	it('its label follows the name while the user types', async () => {
		const s = await openSheet(BODY_ARMS);
		const button = s.q('.dynasty-arms-mark');
		expect(button.getAttribute('aria-label')).toContain('Aldric Valmont');
		const name = s.field('name');
		name.value = 'Berengar';
		dispatch(name, 'input');
		await settle();
		expect(s.q('.dynasty-arms-mark') === button, 'the button keeps its node').toBe(true);
		expect(button.getAttribute('aria-label')).toContain('Berengar');
	});

	it('a removed personal arms picture is given back to the store', async () => {
		const s = await openSheet(BODY_ARMS);
		expect(s.counts.held).toBe(2);
		const inner = s.sheet as unknown as { draft: { arms: string }; head: { arms(): void } };
		inner.draft.arms = '';
		inner.head.arms();
		await settle();
		expect(s.content.querySelector('.dynasty-arms-mark')).toBeNull();
		expect(s.counts.held, 'only the house copy stays').toBe(1);
	});
});

describe('the joined detail line after the house name changes', () => {
	it('a new house name that moves the wrap point takes the old break marks away', async () => {
		const s = await openSheet();
		pick(s.field('house'), NEW_HOUSE);
		const input = s.q('.dynasty-sheet-subform input');
		typed(input, 'Nova');
		await settle();
		const box = s.q('.dynasty-head-meta');
		const items = box.children.filter((c) => c.hasClass('dynasty-jitem'));
		expect(items.length).toBeGreaterThan(1);
		// While the house name is long, the second item wraps. After the next key it fits again, with the same height of the box.
		let wrapped = true;
		items.forEach((it, i) => (it.getBoundingClientRect = () => ({ top: i === 1 && wrapped ? 24 : 0, height: 20 }) as never));
		typed(input, 'x');
		await settle();
		expect(s.q('.dynasty-head-meta') === box, 'the box is kept').toBe(true);
		expect(items[1].hasClass('is-lead'), 'the second item starts the wrapped line').toBe(true);
		wrapped = false;
		typed(input, 'y');
		await settle();
		expect(items[1].hasClass('is-lead'), 'the mark of the old wrap point stays').toBe(false);
		expect(box.children.some((c) => c.hasClass('dynasty-jbreak')), 'a line break of the old wrap point stays').toBe(false);
	});
});
