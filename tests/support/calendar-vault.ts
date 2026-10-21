// A fake vault for the calendar index tests (WP-4 step 4.3): notes in a map, events by hand, a metadata cache that is ready when the test says so.
import type { CalendarVault } from '../../src/view/calendar-index';

type Event = Parameters<CalendarVault['on']>[0];

export interface FakeVault extends CalendarVault {
	notes: Map<string, string>;
	/** The state the fake cache gives a path; a path with no entry is 'unknown' until `cacheDone`, then it is worked out from the text. */
	sections: Map<string, 'yes' | 'no' | 'unknown'>;
	links: Map<string, string>;
	reads: string[];
	/** Settles `cacheReady()`. */
	cacheDone(): void;
	emit(event: Event, path: string, oldPath?: string): void;
	/** Writes a note and sends the event. */
	write(path: string, text: string): void;
}

export function fakeVault(initial: Record<string, string> = {}, cacheReady = true): FakeVault {
	const handlers = new Map<Event, Set<(path: string, oldPath?: string) => void>>();
	let cache = cacheReady;
	let open: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => (open = resolve));
	if (cacheReady) open();
	const v: FakeVault = {
		notes: new Map(Object.entries(initial)),
		sections: new Map(),
		links: new Map(),
		reads: [],
		list: () => [...v.notes.keys()],
		async read(path) {
			v.reads.push(path);
			const t = v.notes.get(path);
			if (t === undefined) throw new Error('no such note');
			return t;
		},
		sectionState(path) {
			const set = v.sections.get(path);
			if (set) return set;
			if (!cache) return 'unknown';
			return /^\s*(```|~~~)/m.test(v.notes.get(path) ?? '') ? 'yes' : 'no';
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
			cache = true;
			open();
		},
		emit(event, path, oldPath) {
			for (const cb of [...(handlers.get(event) ?? [])]) cb(path, oldPath);
		},
		write(path, text) {
			const had = v.notes.has(path);
			v.notes.set(path, text);
			v.emit(had ? 'modify' : 'create', path);
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
