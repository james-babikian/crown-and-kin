import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calVault, makeIndex } from '../support/r04-calendar-fakes';
import { resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { embed, fakeHandle, fakeHost } from './tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G2 probe of part 3: `setLink` counts a tree as "without a key" when the parser reads no link from `options.calendar`. A key whose value is not text (a map, a list of
 * other shape) reads as no link, so the Calendars window opened from such a tree overwrites the key with `set-option`. The contract says Save never writes over an existing key.
 */

useFakeDom({ window: true, css: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const PEOPLE = ['people:', '  - id: a', '    name: A', ''].join('\n');
const SHAPED = ['options:', '  calendar:', '    note: Lore', PEOPLE].join('\n');

describe('a key with a value that is not a link', () => {
	it('setLink does not write over it', async () => {
		const host = fakeHost();
		(host as unknown as { dates: unknown }).dates = await makeIndex(calVault({}));
		const handle = fakeHandle('n.md', SHAPED);
		const m = await embed(SHAPED, { host, handle });
		const write = vi.fn<(op: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
		(handle as unknown as { write: unknown }).write = write;
		const tree = (m.view as unknown as { calendarTree(): { link: string | undefined; setLink: ((l: string) => Promise<string>) | null } }).calendarTree();
		const result = tree.setLink ? await tree.setLink('[[Cal]]') : 'null';
		expect(write).not.toHaveBeenCalled();
		expect(['has-key', 'null']).toContain(result);
	});
});
