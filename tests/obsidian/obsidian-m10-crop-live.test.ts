import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { portraitCropOf, type CropFraction } from '../../src/core/portrait-crop';
import { createLivePictures } from '../../src/obsidian/live-pictures';
import type { CopyBox, PictureCopy, PictureStore } from '../../src/obsidian/picture-store';
import type { PictureSlot } from '../../src/render/dom/pictures';
import { FEl, flushFrames, resetDom, runTimers } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * WP 10.3a (M10 rules C8, spec §13.13 "Rules"): the live pictures of the cards ask the store for
 * the person's part; the copy key holds the part, so a new part on the same card is a new copy.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
const file = (path: string) => Object.assign(new File(path, 'png'), { name: path, basename: path, stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function drain(): Promise<void> {
	for (let k = 0; k < 10; k++) {
		flushFrames();
		runTimers(16);
		await tick();
	}
}

function slots(n: number, kind: PictureSlot['kind'] = 'portrait'): PictureSlot[] {
	const group = new FEl('g');
	return Array.from({ length: n }, (_, i) => {
		const el = group.createSvg('g') as unknown as SVGGElement;
		return { kind, lod: 'full', person: `p${i}`, rect: { x: i * 30, y: 0, w: 24, h: 24 }, el };
	});
}

function fakeStore() {
	const boxes: CopyBox[] = [];
	let n = 0;
	const store = {
		acquire: async (_f: VaultFile, box: CopyBox) => {
			boxes.push(box);
			await tick();
			return { url: `blob:${n++}`, w: 1, h: 1, release() {} } satisfies PictureCopy;
		},
		peek: () => null,
	} as unknown as PictureStore;
	return { store, boxes };
}

const VIEW = { x: 0, y: 0, w: 300, h: 100 };

describe('live pictures pass the part of a portrait (C8)', () => {
	it('a portrait slot asks for the person\'s part; arms and a person with no part ask for none', async () => {
		const s = [...slots(2), ...slots(1, 'arms')];
		const parts = new Map<string, CropFraction>([['p0', { left: 0.1, top: 0.4, side: 0.5 }]]);
		const { store, boxes } = fakeStore();
		const live = createLivePictures(s, store, (x) => file(`${x.person}.png`), { cropOf: (x) => parts.get(x.person) ?? null });
		live.update(VIEW, 'full');
		await drain();
		expect(boxes.filter((b) => b.crop).map((b) => b.crop)).toEqual([{ left: 0.1, top: 0.4, side: 0.5 }]);
		expect(boxes.filter((b) => b.fit === 'portrait' && !b.crop)).toHaveLength(1);
		expect(boxes.filter((b) => b.fit === 'meet').every((b) => b.crop === undefined)).toBe(true);
		live.destroy();
	});

	it('a new part on the same card asks for a new copy (the copy key holds the part)', async () => {
		const s = slots(1);
		let part: CropFraction | null = { left: 0.1, top: 0.4, side: 0.5 };
		const { store, boxes } = fakeStore();
		const live = createLivePictures(s, store, (x) => file(`${x.person}.png`), { cropOf: () => part });
		live.update(VIEW, 'full');
		await drain();
		live.update(VIEW, 'full');
		await drain();
		expect(boxes).toHaveLength(1);
		part = { left: 0.2, top: 0.4, side: 0.5 };
		live.update(VIEW, 'full');
		await drain();
		expect(boxes).toHaveLength(2);
		expect(boxes[1].crop).toEqual({ left: 0.2, top: 0.4, side: 0.5 });
		live.destroy();
	});

	it('with no cropOf, or a cropOf that throws, the card asks for the automatic part and nothing breaks', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		for (const cropOf of [undefined, () => { throw new Error('bad'); }]) {
			const { store, boxes } = fakeStore();
			const live = createLivePictures(slots(1), store, (x) => file(`${x.person}.png`), cropOf ? { cropOf } : {});
			live.update(VIEW, 'full');
			await drain();
			expect(boxes).toHaveLength(1);
			expect(boxes[0].crop).toBeUndefined();
			live.destroy();
		}
		expect(spy).toHaveBeenCalled();
	});

	it('portraitCropOf(person) is the crop a card passes (a bad text is the automatic part)', () => {
		expect(portraitCropOf({ portrait: '[[a.png]]', portraitCrop: '0.1 0.4 0.5' })).toEqual({ left: 0.1, top: 0.4, side: 0.5 });
		expect(portraitCropOf({ portrait: '[[a.png]]', portraitCrop: '0.1, 0.4, 0.5' })).toBeNull();
	});
});
