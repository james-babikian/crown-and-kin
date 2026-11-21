// The calls between the views of one block: which views a call finds, in which order they draw, and that a view that leaves the host is never held.
import { describe, expect, it } from 'vitest';
import { BlockViews, type ViewPort } from '../../src/obsidian/block-views';
import { newBlockState, type BlockState } from '../../src/view/block-state';

interface Fake {
	port: ViewPort;
	calls: string[];
	own: boolean | undefined;
}

/** A view with the face that `BlockViews` reads; `log` receives one entry for each draw, in call order. */
function fake(st: BlockState | null, log: string[], name: string, o: { full?: boolean; coarse?: boolean; phone?: boolean; seen?: boolean; unloaded?: boolean } = {}): Fake {
	const f = { calls: [] as string[], own: undefined as boolean | undefined } as Fake;
	const port = {
		view: f as never,
		unloaded: !!o.unloaded,
		full: o.full ? { focus: { id: 'own' } } : null,
		coarse: !!o.coarse,
		seen: !!o.seen,
		phone: !!o.phone,
		foreign: false,
		state: st,
		viewport: null,
		focusDue: null as string | null,
		pendingTarget: 'stale' as string[] | string | null,
		syncFocus(own?: boolean) {
			f.own = own;
			log.push(`${name}:${String(port.pendingTarget)}`);
		},
		guard: (fn: () => void) => fn(),
		showFound: (id: string) => log.push(`${name}:found:${id}`),
		openSheet: (id: string) => log.push(`${name}:sheet:${id}`),
		openFull: (due: string) => log.push(`${name}:openFull:${due}`),
		foldsChanged: () => log.push(`${name}:folds`),
	};
	f.port = port as unknown as ViewPort;
	return f;
}

const host = (...views: Fake[]) => ({ views: new Set(views) }) as never;

describe('BlockViews finds the views of one block', () => {
	it('keeps the views of two blocks apart, full and note', () => {
		const a = newBlockState();
		const b = newBlockState();
		const log: string[] = [];
		const noteA = fake(a, log, 'noteA');
		const fullA = fake(a, log, 'fullA', { full: true });
		const noteB = fake(b, log, 'noteB');
		const h = host(noteA, fullA, noteB);
		expect(BlockViews.of(h, a).views()).toEqual([noteA, fullA]);
		expect(BlockViews.of(h, b).views()).toEqual([noteB]);
		expect(BlockViews.of(h, a).viewOf(true)).toBe(fullA);
		expect(BlockViews.of(h, a).viewOf(false)).toBe(noteA);
		expect(BlockViews.of(h, b).viewOf(true)).toBeUndefined();
	});

	it('prefers a view that has drawn its first view, and skips an unloaded one', () => {
		const a = newBlockState();
		const log: string[] = [];
		const gone = fake(a, log, 'gone', { seen: true, unloaded: true });
		const first = fake(a, log, 'first');
		const second = fake(a, log, 'second', { seen: true });
		const h = host(gone, first, second);
		expect(BlockViews.of(h, a).viewOf(false)).toBe(second);
		expect(BlockViews.of(h, a).views()).toEqual([first, second]);
		BlockViews.of(h, a).showFound(false, 'x');
		expect(log).toEqual(['second:found:x']);
	});

	it('holds no view: a view that leaves the host is gone from the next call', () => {
		const a = newBlockState();
		const log: string[] = [];
		const one = fake(a, log, 'one');
		const two = fake(a, log, 'two');
		const set = new Set([one, two]);
		const h = { views: set } as never;
		const objectOfBlock = BlockViews.of(h, a);
		set.delete(one);
		expect(objectOfBlock.views()).toEqual([two]);
		set.delete(two);
		expect(objectOfBlock.views()).toEqual([]);
		objectOfBlock.redrawState();
		expect(log).toEqual([]);
	});
});

describe('BlockViews draws the views of a block in the order of the host', () => {
	it('gives the target to the origin only, and skips the except view', () => {
		const a = newBlockState();
		const log: string[] = [];
		const v1 = fake(a, log, 'v1');
		const v2 = fake(a, log, 'v2', { full: true });
		const v3 = fake(a, log, 'v3');
		const other = fake(newBlockState(), log, 'other');
		const h = host(v1, v2, other, v3);
		BlockViews.of(h, a).redrawState({ target: ['p1'], origin: v3 as never, except: v1 as never });
		expect(log).toEqual(['v2:null', 'v3:p1']);
		expect(v2.port.full!.focus).toBeNull();
	});

	it('keeps the own focus of a full-screen view with keepOwn', () => {
		const a = newBlockState();
		const v = fake(a, [], 'v', { full: true });
		BlockViews.of(host(v), a).redrawState({ keepOwn: true });
		expect(v.port.full!.focus).toEqual({ id: 'own' });
	});

	it('draws the finder for every view except a static preview, with the target on the origin', () => {
		const a = newBlockState();
		const log: string[] = [];
		const note = fake(a, log, 'note');
		const preview = fake(a, log, 'preview', { coarse: true });
		const full = fake(a, log, 'full', { full: true, coarse: true });
		BlockViews.of(host(note, preview, full), a).finderRedraw(full as never, ['t']);
		expect(log).toEqual(['note:null', 'full:t']);
	});

	it('draws a phone list for the list redraw, and the Show view for a phone list but not a preview', () => {
		const a = newBlockState();
		const log: string[] = [];
		const list = fake(a, log, 'list', { coarse: true, phone: true });
		const preview = fake(a, log, 'preview', { coarse: true });
		const full = fake(a, log, 'full', { full: true, coarse: true, phone: true });
		const h = host(list, preview, full);
		BlockViews.of(h, a).listRedraw();
		expect(log).toEqual(['list:null']);
		expect(list.own).toBe(true);
		log.length = 0;
		BlockViews.of(h, a).successionRedraw();
		expect(log).toEqual(['list:null', 'full:null']);
	});
});

describe('BlockViews shows the finder and the Show view', () => {
	it('puts the focus sentence on the origin and redraws', () => {
		const a = newBlockState();
		const log: string[] = [];
		const note = fake(a, log, 'note');
		const full = fake(a, log, 'full', { full: true });
		const h = host(note, full);
		BlockViews.of(h, a).showFinder('x', 'y', full as never);
		expect(a.finder).toMatchObject({ first: 'x', second: 'y' });
		expect(full.port.focusDue).toBe('.dynasty-result-text');
		expect(note.port.focusDue).toBeNull();
		expect(log).toEqual(['note:null', 'full:null']);
	});

	it('opens the full-screen view when only a static preview shows the block; the finder draws nothing first, the Show view draws first', () => {
		const a = newBlockState();
		const log: string[] = [];
		const preview = fake(a, log, 'preview', { coarse: true });
		BlockViews.of(host(preview), a).showFinder('x', 'y', null);
		expect(log).toEqual(['preview:openFull:.dynasty-result-text']);
		log.length = 0;
		const b = newBlockState();
		const phone = fake(b, log, 'phone', { coarse: true, phone: true });
		BlockViews.of(host(phone), b).showSuccession('duke', phone as never);
		expect(b.succession).toEqual({ title: 'duke' });
		expect(b.finder).toBeNull();
		expect(log).toEqual(['phone:null', 'phone:openFull:.dynasty-succession-text']);
	});

	it('draws the phone list again when the finder ends a Show view', () => {
		const a = newBlockState();
		a.succession = { title: 'duke' };
		const log: string[] = [];
		const list = fake(a, log, 'list', { coarse: true, phone: true });
		const note = fake(a, log, 'note');
		BlockViews.of(host(list, note), a).showFinder('x', 'y', null);
		expect(a.succession).toBeNull();
		expect(log).toEqual(['list:null', 'note:null']);
	});

	it('gives the focus sentence to the one view of the same kind when the origin is gone', () => {
		const a = newBlockState();
		const log: string[] = [];
		const note = fake(a, log, 'note');
		const full = fake(a, log, 'full', { full: true });
		const gone = fake(a, log, 'gone', { unloaded: true });
		BlockViews.of(host(note, full), a).showSuccession('duke', gone as never);
		expect(note.port.focusDue).toBe('.dynasty-succession-text');
		expect(full.port.focusDue).toBeNull();
	});
});
