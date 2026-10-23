// A fake vault for the calendar index tests (WP-4 step 4.3; 0.4 WP-3a): notes in a map, events by hand, a metadata cache that is ready when the test says so.
// Since D289 the vault has no list of notes and no section state: the host gives the list of calendar notes (`IndexOptions.notes`), and the event 'cache' brings the text.
import type { CalendarVault } from '../../src/view/calendar-index';

type Event = Parameters<CalendarVault['on']>[0];

export interface FakeVault extends CalendarVault {
	notes: Map<string, string>;
	links: Map<string, string>;
	reads: string[];
	/** Settles `cacheReady()`. */
	cacheDone(): void;
	emit(event: Event, path: string, second?: string): void;
	/** Writes a note and sends the events of Obsidian: `create` (a new note), then `cache` with the text. */
	write(path: string, text: string): void;
}

export function fakeVault(initial: Record<string, string> = {}, cacheReady = true): FakeVault {
	const handlers = new Map<Event, Set<(path: string, second?: string) => void>>();
	let open: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => (open = resolve));
	if (cacheReady) open();
	const v: FakeVault = {
		notes: new Map(Object.entries(initial)),
		links: new Map(),
		reads: [],
		async read(path) {
			v.reads.push(path);
			const t = v.notes.get(path);
			if (t === undefined) throw new Error('no such note');
			return t;
		},
		resolve: (link, from) => v.links.get(`${from}|${link}`) ?? v.links.get(link) ?? null,
		on(event, cb) {
			const set = handlers.get(event) ?? new Set();
			handlers.set(event, set);
			set.add(cb);
			return () => set.delete(cb);
		},
		cacheReady: () => gate,
		cacheDone() {
			open();
		},
		emit(event, path, second) {
			for (const cb of [...(handlers.get(event) ?? [])]) cb(path, second);
		},
		write(path, text) {
			const had = v.notes.has(path);
			v.notes.set(path, text);
			if (!had) v.emit('create', path);
			v.emit('cache', path, text);
		},
	};
	return v;
}

/** A calendar note with one cycle calendar. */
export const cycleNote = (name = 'The Long Count', format = '{year} Year of the {cycle} Cycle', start = 1): string =>
	['# Calendars', '', '```kin-calendar', 'calendars:', `  - name: ${name}`, '    kind: cycles', '    length: 60', `    start: ${start}`, `    formats: ["${format}"]`, '```', ''].join('\n');

/** A calendar note with one era calendar. */
export const eraNote = (name = 'Reign names', era = 'Qinglong Emperor', start = 130): string =>
	['```kin-calendar', 'calendars:', `  - name: ${name}`, '    kind: eras', '    formats: ["{era} {year}"]', '    eras:', `      - {name: ${era}, start: ${start}, length: 11}`, '```', ''].join('\n');

/** Lets pending promises and zero timers run (the index reads notes one at a time). */
export const settle = async (turns = 12): Promise<void> => {
	for (let i = 0; i < turns; i++) await Promise.resolve();
};
