import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dates from '../../src/core/dates';
import { PLAIN_READER } from '../../src/core/dates';
import { CALENDAR_REFUSAL_TEXT, ISSUE_CODES } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { calVault, cycleNote, eraNote, makeIndex, type CalIndexLike, type CalIndexOptions, type FakeCalVault } from '../support/r04-calendar-fakes';
import { turns } from '../support/fake-fence-vault';

/*
 * 0.4 WP-3a, step T0, package C: the readers of the calendar index (the index contract 4.1, 4.4, 4.5; D289; test list 8 and 11). A tree reads a calendar only when `options.calendar` names a note.
 * No key gives `PLAIN_READER` with no scan, no read and no wait. A key is requested; the first call starts one load and answers the one `pending` reader (plain years, no warning)
 * until the load ends; then the index tells its listeners (300 ms burst) and the views draw again. The target of a requested key follows `cache`, `create`, `rename` and `delete`
 * events. A tree uses at most one note, so the cross-note duplicate check is gone. The vault is a fake of the contract (no `list`, no `sectionState`; 'cache' passes the text).
 * Written from the contract before the code existed; package C built the code and turned the tests on.
 */

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const CAL = '[[Cal]]';

async function make(files: Record<string, string>, links: Record<string, string> = {}, o: CalIndexOptions = {}, cacheReady = true): Promise<{ vault: FakeCalVault; index: CalIndexLike }> {
	const vault = calVault(files, links, cacheReady);
	const index = await makeIndex(vault, o);
	return { vault, index };
}

/** Lets the loads end and the 300 ms burst pass. */
const later = async (ms = 1000): Promise<void> => {
	await turns();
	await vi.advanceTimersByTimeAsync(ms);
	await turns();
};

/** The date a reader reads from a text (the fields the tests look at). */
const readOf = (r: { read(text: string | undefined): unknown }, text: string) => r.read(text) as { source: string; calendar?: string; year?: number } | undefined;

/** A calendar note with a `plain` key only: one name list for plain years. */
const plainNote = (title: string): string => ['```kin-calendar', 'plain:', '  lists:', '    - {name: Moons, names: [Aa, Bb], known: {year: 1000, index: 0}}', '```', `# ${title}`, ''].join('\n');

const problemKeys = (r: { problems: { key: string }[] }) => r.problems.map((p) => p.key);

describe('a tree with no key reads plain years (D289; the index contract 4.1)', () => {
	it('no link, an empty link and a link of white space give PLAIN_READER, ready, with no problem and no list', async () => {
		const { index } = await make({ 'A.md': cycleNote(), 'B.md': eraNote() }, {}, { notes: () => ['A.md', 'B.md'] });
		for (const link of [undefined, '', '   ', '\t\n']) {
			const r = index.readerFor('t.md', link);
			expect(r).toBe(PLAIN_READER);
			expect(r.key).toBe('plain');
			expect(r.ready).toBe(true);
			expect(r.problems).toEqual([]);
			expect(r.hasLists).toBe(false);
		}
	});

	it('five calendar notes in the vault and no key: zero reads, also after start(), and no change is told', async () => {
		const notes = ['Cal1.md', 'Cal2.md', 'Cal3.md', 'Cal4.md', 'Cal5.md'];
		const { vault, index } = await make(Object.fromEntries(notes.map((n) => [n, cycleNote(n)])), {}, { notes: () => notes });
		const heard = vi.fn();
		index.onChange(heard);
		index.readerFor('t.md');
		index.readerFor('u.md', undefined);
		await index.start();
		await later(3000);
		expect(vault.reads).toEqual([]);
		expect(heard).not.toHaveBeenCalled();
		expect(index.notes()).toEqual(notes);
	});

	it('start() only subscribes to events: it reads nothing and waits for nothing', async () => {
		const { vault, index } = await make({ 'A.md': cycleNote() }, {}, { notes: () => ['A.md'] }, false);
		expect(index.ready).toBe(false);
		await index.start();
		expect(index.ready).toBe(true);
		expect(vault.reads).toEqual([]);
		expect(vault.listenerCount('cache')).toBeGreaterThan(0);
		index.dispose();
		expect(vault.listenerCount('cache')).toBe(0);
	});

	it('usedNotes is empty for a tree with no key', async () => {
		const { index } = await make({ 'A.md': cycleNote() }, {}, { notes: () => ['A.md'] });
		expect(index.usedNotes('t.md')).toEqual([]);
		expect(index.usedNotes('t.md', '  ')).toEqual([]);
	});

	it('a tree with a key and a calendar date that no reader knows reads plain years: the plain reader gives no year for a calendar date and does not throw', async () => {
		const { index } = await make({ 'A.md': cycleNote() }, {}, { notes: () => ['A.md'] });
		const r = index.readerFor('t.md');
		expect(() => r.read('10 Year of the 3 Cycle')).not.toThrow();
		expect(readOf(r, '10 Year of the 3 Cycle')).toMatchObject({ source: 'none' });
		expect(readOf(r, '1200')).toMatchObject({ source: 'plain', year: 1200 });
	});
});

describe('a tree with a key: pending, then the ready reader after one read (the index contract 4.1)', () => {
	it('the first call answers the pending reader; one read later the reader is ready and the listeners hear of it once', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		const heard = vi.fn();
		index.onChange(heard);
		const first = index.readerFor('t.md', CAL);
		expect(first.key).toBe('pending');
		expect(first.ready).toBe(false);
		expect(first.problems).toEqual([]);
		await later();
		expect(vault.reads).toEqual(['Cal.md']);
		const second = index.readerFor('t.md', CAL);
		expect(second.ready).toBe(true);
		expect(second.key).not.toBe('pending');
		expect(second.key).not.toBe('plain');
		expect(second.problems).toEqual([]);
		expect(second.hasLists).toBe(false);
		expect(index.calendarsOf('Cal.md').map((c) => c.name)).toEqual(['The Long Count']);
		expect(heard).toHaveBeenCalledTimes(1);
		// The same reader again: no new read, no new change.
		expect(index.readerFor('t.md', CAL)).toBe(second);
		await later();
		expect(vault.reads).toEqual(['Cal.md']);
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it('the pending reader is the one reader for every key while it is pending', async () => {
		const { index } = await make({ 'Cal.md': cycleNote(), 'Other.md': eraNote() }, { [CAL]: 'Cal.md', '[[Other]]': 'Other.md' });
		expect(index.readerFor('a.md', CAL)).toBe(index.readerFor('b.md', '[[Other]]'));
	});

	it('the load finishes although start() never runs (ensure never waits for start())', async () => {
		const { index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		expect(index.ready).toBe(false);
		index.readerFor('t.md', CAL);
		await later();
		expect(index.readerFor('t.md', CAL).ready).toBe(true);
		expect(index.ready).toBe(false);
	});

	it('two trees that name one note cost one read', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		index.readerFor('a.md', CAL);
		index.readerFor('b.md', CAL);
		await later();
		expect(vault.reads).toEqual(['Cal.md']);
		expect(index.readerFor('a.md', CAL).ready).toBe(true);
		expect(index.readerFor('b.md', CAL).ready).toBe(true);
	});

	it('a tree reads only the note it names, not the other calendar notes of the vault', async () => {
		const { vault, index } = await make({ 'A.md': cycleNote('Alpha', '{year} Year of the {cycle} Cycle'), 'B.md': cycleNote('Beta', '{year} Annum of the {cycle} Era') }, { '[[B]]': 'B.md' }, { notes: () => ['A.md', 'B.md'] });
		index.readerFor('t.md', '[[B]]');
		await later();
		expect(vault.reads).toEqual(['B.md']);
		const r = index.readerFor('t.md', '[[B]]');
		expect(readOf(r, '3 Annum of the 2 Era')).toMatchObject({ source: 'calendar', calendar: 'Beta' });
		expect(readOf(r, '3 Year of the 2 Cycle')?.source).not.toBe('calendar');
		expect(index.usedNotes('t.md', '[[B]]')).toEqual(['B.md']);
	});

	it('a tree uses at most one note: two notes with the same format give no duplicate problem, and the function of D254 item 2 is gone', async () => {
		const { index } = await make({ 'A.md': cycleNote('Same'), 'B.md': cycleNote('Same') }, { '[[A]]': 'A.md', '[[B]]': 'B.md' }, { notes: () => ['A.md', 'B.md'] });
		index.readerFor('t.md', '[[A]]');
		await later();
		expect(problemKeys(index.readerFor('t.md', '[[A]]'))).toEqual([]);
		expect('findCrossNoteDuplicates' in dates).toBe(false);
	});
});

describe('the warning "calendar-note-missing" (the index contract 4.4)', () => {
	it('a draw before the metadata cache is ready shows no calendar warning, after it shows them', async () => {
		const { index, vault } = await make({}, {}, {}, false);
		const early = index.readerFor('t.md', '[[Nowhere]]');
		await later(200);
		expect(early.key).toBe('pending');
		expect(problemKeys(index.readerFor('t.md', '[[Nowhere]]'))).toEqual([]);
		vault.cacheDone();
		await later();
		const r = index.readerFor('t.md', '[[Nowhere]]');
		expect(r.ready).toBe(true);
		expect(problemKeys(r)).toEqual(['calendar-note-missing']);
	});

	it('a note that names a note which is not there gives the warning; a tree with no key never does', async () => {
		const { index } = await make({ 'Lore.md': '# Lore\n' }, { '[[Lore]]': 'Lore.md' }, { notes: () => [] });
		index.readerFor('t.md', '[[Gone]]');
		index.readerFor('t.md', '[[Lore]]');
		await later();
		expect(problemKeys(index.readerFor('t.md', '[[Gone]]'))).toEqual(['calendar-note-missing']);
		// A note with no calendar and no `plain` key is also "missing" (as in 0.3.3).
		expect(problemKeys(index.readerFor('t.md', '[[Lore]]'))).toEqual(['calendar-note-missing']);
		expect(problemKeys(index.readerFor('t.md'))).toEqual([]);
	});

	it('a note with only a `plain` key is a calendar note: no warning', async () => {
		const plainOnly = plainNote('Moons only');
		const { index } = await make({ 'P.md': plainOnly }, { '[[P]]': 'P.md' });
		index.readerFor('t.md', '[[P]]');
		await later();
		expect(problemKeys(index.readerFor('t.md', '[[P]]')).includes('calendar-note-missing')).toBe(false);
	});
});

describe('the target of a key follows the vault (the index contract 4.1, "Kept up to date"; test 8)', () => {
	it('a "changed" event with the text updates the calendars with no read; the listeners hear of it once', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		index.readerFor('t.md', CAL);
		await later();
		const before = index.readerFor('t.md', CAL).key;
		const heard = vi.fn();
		index.onChange(heard);
		vault.edit('Cal.md', cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 100));
		await later();
		expect(vault.reads).toEqual(['Cal.md']);
		expect(index.readerFor('t.md', CAL).key).not.toBe(before);
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it('a block added to a named note that had none is picked up (the note was "missing" before)', async () => {
		const { vault, index } = await make({ 'Lore.md': '# Lore\nNothing yet.\n' }, { '[[Lore]]': 'Lore.md' });
		index.readerFor('t.md', '[[Lore]]');
		await later();
		expect(problemKeys(index.readerFor('t.md', '[[Lore]]'))).toEqual(['calendar-note-missing']);
		const reads = vault.reads.length;
		vault.edit('Lore.md', `# Lore\n\n${cycleNote()}`);
		await later();
		const r = index.readerFor('t.md', '[[Lore]]');
		expect(problemKeys(r)).toEqual([]);
		expect(index.calendarsOf('Lore.md').map((c) => c.name)).toEqual(['The Long Count']);
		expect(vault.reads.length).toBe(reads);
		expect(readOf(r, '3 Year of the 2 Cycle')).toMatchObject({ source: 'calendar' });
	});

	it('removing the block from the named note makes it missing again', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		index.readerFor('t.md', CAL);
		await later();
		vault.edit('Cal.md', '# No more calendars\n');
		await later();
		expect(problemKeys(index.readerFor('t.md', CAL))).toEqual(['calendar-note-missing']);
	});

	it('a rename moves the entry with no read; the key follows the link to the new path', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		index.readerFor('t.md', CAL);
		await later();
		vault.links.set(CAL, 'Worlds/Cal.md');
		vault.rename('Cal.md', 'Worlds/Cal.md');
		await later();
		expect(vault.reads.filter((p) => p === 'Worlds/Cal.md')).toEqual([]);
		expect(index.usedNotes('t.md', CAL)).toEqual(['Worlds/Cal.md']);
		expect(index.calendarsOf('Worlds/Cal.md').map((c) => c.name)).toEqual(['The Long Count']);
		expect(index.calendarsOf('Cal.md')).toEqual([]);
		expect(problemKeys(index.readerFor('t.md', CAL))).toEqual([]);
	});

	it('a deleted note gives the warning', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		index.readerFor('t.md', CAL);
		await later();
		vault.remove('Cal.md');
		await later();
		expect(index.usedNotes('t.md', CAL)).toEqual([]);
		expect(problemKeys(index.readerFor('t.md', CAL))).toEqual(['calendar-note-missing']);
	});

	it('a note created later is found: the key names a note that did not exist', async () => {
		const { vault, index } = await make({}, {});
		index.readerFor('t.md', '[[New]]');
		await later();
		expect(problemKeys(index.readerFor('t.md', '[[New]]'))).toEqual(['calendar-note-missing']);
		vault.links.set('[[New]]', 'New.md');
		vault.add('New.md', cycleNote('Fresh'));
		await later();
		expect(problemKeys(index.readerFor('t.md', '[[New]]'))).toEqual([]);
		expect(index.calendarsOf('New.md').map((c) => c.name)).toEqual(['Fresh']);
	});

	it('a "changed" event for a note that no key names is ignored: no entry, no read', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote(), 'Other.md': eraNote() }, { [CAL]: 'Cal.md' });
		index.readerFor('t.md', CAL);
		await later();
		vault.edit('Other.md', eraNote('Changed'));
		await later();
		expect(index.calendarsOf('Other.md')).toEqual([]);
		expect(vault.reads).toEqual(['Cal.md']);
	});

	it('a late read does not overwrite a newer "changed" event (the seq rule of M2)', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote('Old') }, { [CAL]: 'Cal.md' });
		const hold = vault.hold('Cal.md');
		index.readerFor('t.md', CAL);
		await later(10);
		expect(hold.started).toBe(true);
		vault.edit('Cal.md', cycleNote('Newer'));
		hold.release(cycleNote('Old'));
		await later();
		expect(index.calendarsOf('Cal.md').map((c) => c.name)).toEqual(['Newer']);
	});

	it('a read that fails gives the warning, and the next event of the target tries again', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		vault.failing.add('Cal.md');
		index.readerFor('t.md', CAL);
		await later();
		const failed = index.readerFor('t.md', CAL);
		expect(failed.ready).toBe(true);
		expect(problemKeys(failed)).toEqual(['calendar-note-missing']);
		vault.failing.delete('Cal.md');
		vault.emit('create', 'Cal.md');
		await later();
		expect(vault.reads).toEqual(['Cal.md', 'Cal.md']);
		expect(problemKeys(index.readerFor('t.md', CAL))).toEqual([]);
		expect(index.calendarsOf('Cal.md')).toHaveLength(1);
	});

	it('a read that fails is also tried again at a "changed" event, which brings the text with no read', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote() }, { [CAL]: 'Cal.md' });
		vault.failing.add('Cal.md');
		index.readerFor('t.md', CAL);
		await later();
		vault.failing.delete('Cal.md');
		vault.edit('Cal.md', cycleNote());
		await later();
		expect(problemKeys(index.readerFor('t.md', CAL))).toEqual([]);
		expect(vault.reads).toEqual(['Cal.md']);
	});

	it('a flood of 1 000 renames of other notes is one re-resolve of the keys in a burst', async () => {
		const files: Record<string, string> = { 'A.md': cycleNote('A'), 'B.md': cycleNote('B'), 'C.md': cycleNote('C') };
		const { vault, index } = await make(files, { '[[A]]': 'A.md', '[[B]]': 'B.md', '[[C]]': 'C.md' });
		for (const k of ['[[A]]', '[[B]]', '[[C]]']) index.readerFor('t.md', k);
		await later();
		const base = vault.resolveCalls;
		for (let i = 0; i < 1000; i++) vault.emit('rename', `m${i}.md`, `n${i}.md`);
		await later(2000);
		const delta = vault.resolveCalls - base;
		expect(delta).toBeGreaterThanOrEqual(1);
		// One re-resolve of each of the three requested keys, not one for each event.
		expect(delta).toBeLessThanOrEqual(3);
		expect(vault.reads).toEqual(['A.md', 'B.md', 'C.md']);
	});

	it('create and delete events of other notes also re-resolve once for the burst', async () => {
		const { vault, index } = await make({ 'A.md': cycleNote('A') }, { '[[A]]': 'A.md' });
		index.readerFor('t.md', '[[A]]');
		await later();
		const base = vault.resolveCalls;
		for (let i = 0; i < 300; i++) {
			vault.emit('create', `n${i}.md`);
			vault.emit('delete', `n${i}.md`);
		}
		await later(2000);
		expect(vault.resolveCalls - base).toBeLessThanOrEqual(1);
	});
});

describe('the keys that are kept (the index contract 4.1: a least-recently-used list of 200 keys)', () => {
	const many = (n: number) => {
		const files: Record<string, string> = {};
		const links: Record<string, string> = {};
		for (let i = 0; i < n; i++) {
			files[`Cal${i}.md`] = cycleNote(`Count ${i}`);
			links[`[[Cal${i}]]`] = `Cal${i}.md`;
		}
		return { files, links };
	};

	it('200 keys are all kept', async () => {
		const { files, links } = many(200);
		const { index } = await make(files, links);
		for (let i = 0; i < 200; i++) index.readerFor(`t${i}.md`, `[[Cal${i}]]`);
		await later(3000);
		expect(index.calendarsOf('Cal0.md')).toHaveLength(1);
		expect(index.calendarsOf('Cal199.md')).toHaveLength(1);
		expect(index.readerFor('t0.md', '[[Cal0]]').ready).toBe(true);
	});

	it('the 201st key drops the oldest key and the entry that no key targets; a call for the dropped key starts a new load', async () => {
		const { files, links } = many(201);
		const { vault, index } = await make(files, links);
		for (let i = 0; i < 200; i++) index.readerFor(`t${i}.md`, `[[Cal${i}]]`);
		await later(3000);
		expect(index.calendarsOf('Cal0.md')).toHaveLength(1);
		index.readerFor('t200.md', '[[Cal200]]');
		await later(3000);
		expect(index.calendarsOf('Cal0.md')).toEqual([]);
		expect(index.calendarsOf('Cal1.md')).toHaveLength(1);
		expect(index.calendarsOf('Cal200.md')).toHaveLength(1);
		const reads = vault.reads.length;
		const again = index.readerFor('t0.md', '[[Cal0]]');
		expect(again.key).toBe('pending');
		await later(3000);
		expect(vault.reads.length).toBe(reads + 1);
		expect(index.readerFor('t0.md', '[[Cal0]]').ready).toBe(true);
	});

	it('an entry that another key still targets is kept when one key goes', async () => {
		const { files, links } = many(201);
		const { index } = await make(files, links);
		// Key 0 and key 1 name the same note, Cal1.
		index.readerFor('t0.md', '[[Cal1]]');
		for (let i = 1; i < 200; i++) index.readerFor(`t${i}.md`, `[[Cal${i}]]`);
		await later(3000);
		// Key 0 is the oldest of 200 keys; the next key drops it.
		index.readerFor('t200.md', '[[Cal200]]');
		await later(3000);
		expect(index.calendarsOf('Cal1.md')).toHaveLength(1);
	});
});

describe('the list of notes (the index contract 4.1, "notes()")', () => {
	it('is the list of the fence index, sorted by file name and then by path', async () => {
		const names = ['Worlds/Alpha.md', 'Gamma.md', 'Lore/Alpha.md', 'Beta.md'];
		const { index } = await make({}, {}, { notes: () => names });
		expect(index.notes()).toEqual(['Lore/Alpha.md', 'Worlds/Alpha.md', 'Beta.md', 'Gamma.md']);
	});

	it('is united with the notes that are loaded', async () => {
		const { index } = await make({ 'B.md': cycleNote() }, { '[[B]]': 'B.md' }, { notes: () => ['A.md', 'C.md'] });
		index.readerFor('t.md', '[[B]]');
		await later();
		expect(index.notes()).toEqual(['A.md', 'B.md', 'C.md']);
	});

	it('follows the function of the host at each call (the fence index changes)', async () => {
		let list = ['A.md'];
		const { index } = await make({}, {}, { notes: () => list });
		expect(index.notes()).toEqual(['A.md']);
		list = ['A.md', 'B.md'];
		expect(index.notes()).toEqual(['A.md', 'B.md']);
	});

	it('with no function from the host, only the loaded notes are listed', async () => {
		const { index } = await make({ 'B.md': cycleNote() }, { '[[B]]': 'B.md' });
		expect(index.notes()).toEqual([]);
		index.readerFor('t.md', '[[B]]');
		await later();
		expect(index.notes()).toEqual(['B.md']);
	});

	it('reload(path) reads the note again now (after the window wrote it)', async () => {
		const { vault, index } = await make({ 'Cal.md': cycleNote('One') }, { [CAL]: 'Cal.md' });
		index.readerFor('t.md', CAL);
		await later();
		vault.notes.set('Cal.md', cycleNote('Two'));
		await index.reload('Cal.md');
		expect(index.calendarsOf('Cal.md').map((c) => c.name)).toEqual(['Two']);
	});
});

describe('compatibility with 0.3.3 (the index contract 4.5, test 11)', () => {
	const PEOPLE = 'people:\n  - id: a\n    name: A\n    born: 10 Year of the 3 Cycle\n';

	it('a tree text with the key `calendar` reads as before: the link as written, in every form', () => {
		for (const form of ['"[[Calendars]]"', '[[Calendars]]', '"[Cal](Calendars.md)"']) {
			const r = parseDynasty(`options:\n  calendar: ${form}\n${PEOPLE}`);
			expect(r.ok).toBe(true);
			if (r.ok) expect(r.tree.options.calendar).toBe(form.replace(/^"|"$/g, ''));
		}
	});

	it('a tree text with no key has no calendar option', () => {
		const r = parseDynasty(`options:\n  start: a\n${PEOPLE}`);
		expect(r.ok).toBe(true);
		if (r.ok) expect('calendar' in r.tree.options).toBe(false);
	});

	it('a tree with calendar dates and no key reads plain years and does not throw, in a vault with calendar notes', async () => {
		const { index } = await make({ 'Cal.md': cycleNote() }, {}, { notes: () => ['Cal.md'] });
		const r = index.readerFor('t.md');
		expect(() => r.read('10 Year of the 3 Cycle')).not.toThrow();
		// A calendar date shows as written, with no year (the notes of a plain reader, as in 0.3.3 in a vault with no calendar note).
		const d = readOf(r, '10 Year of the 3 Cycle');
		expect(d?.source).toBe('none');
		expect(d?.year).toBeUndefined();
	});

	it('the key survives a rename of the calendar note (the link maintenance of the key `calendar`)', () => {
		const text = `options:\n  calendar: "[[Calendars]]"\n${PEOPLE}`;
		const r = applyOp(text, { kind: 'rewrite-links', map: { calendars: 'Far Calendars' } });
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.body).toContain('calendar: "[[Far Calendars]]"');
			const again = parseDynasty(r.body);
			expect(again.ok && again.tree.options.calendar).toBe('[[Far Calendars]]');
		}
	});

	it('the key is written as 0.3.3 wrote it: set-option calendar, and null removes it', () => {
		const set = applyOp(PEOPLE, { kind: 'set-option', key: 'calendar', value: '[[Calendars]]' });
		expect(set.ok).toBe(true);
		if (set.ok) {
			expect(set.body.startsWith('options:\n  calendar: "[[Calendars]]"\n')).toBe(true);
			const removed = applyOp(set.body, { kind: 'set-option', key: 'calendar', value: null });
			expect(removed.ok && !removed.body.includes('calendar')).toBe(true);
		}
	});
});

describe('the cross-note duplicate case is removed (the index contract 4.1, "usedNotes", D289 ruling)', () => {
	it('core/dates has no findCrossNoteDuplicates, and the issue code calendar-duplicate has no message', () => {
		expect('findCrossNoteDuplicates' in dates).toBe(false);
		expect(ISSUE_CODES).not.toContain('calendar-duplicate');
		expect(ISSUE_CODES).toContain('calendar-note-missing');
	});

	it('a duplicate inside one note stays: the refusal of the window for the same format twice', () => {
		expect(Object.keys(CALENDAR_REFUSAL_TEXT)).toContain('calendar-format-duplicate');
		expect(Object.keys(CALENDAR_REFUSAL_TEXT)).toContain('calendar-era-duplicate');
	});

	it('two notes that hold the same calendar give no problem to a tree that names one of them, and none to a tree that names the other', async () => {
		const { index } = await make({ 'A.md': cycleNote('Same'), 'B.md': cycleNote('Same') }, { '[[A]]': 'A.md', '[[B]]': 'B.md' }, { notes: () => ['A.md', 'B.md'] });
		index.readerFor('a.md', '[[A]]');
		index.readerFor('b.md', '[[B]]');
		await later();
		expect(problemKeys(index.readerFor('a.md', '[[A]]'))).toEqual([]);
		expect(problemKeys(index.readerFor('b.md', '[[B]]'))).toEqual([]);
	});

	it('two notes that both hold a name list of plain years with one name: the tree that names one uses that list, with no problem', async () => {
		const list = plainNote;
		const { index } = await make({ 'A.md': list('A'), 'B.md': list('B') }, { '[[A]]': 'A.md', '[[B]]': 'B.md' }, { notes: () => ['A.md', 'B.md'] });
		index.readerFor('t.md', '[[B]]');
		await later();
		expect(problemKeys(index.readerFor('t.md', '[[B]]'))).toEqual([]);
		expect(index.plainListsOf('B.md')).toHaveLength(1);
		expect(index.plainListsOf('A.md')).toEqual([]);
	});
});
