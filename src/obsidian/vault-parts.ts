/*
 * What the two vault adaptors share (`calendar-vault.ts`, `fence-vault.ts`): the test for a Markdown note, one cached read, the
 * vault events limited to notes, and the wait for the metadata cache that follows the start-up gate of D183. Each adaptor adds
 * only the shape of what it hands to its index.
 */

import { TFile, type App, type EventRef } from 'obsidian';

/** What an adaptor needs of the start-up gate (`TreeHost.startedUp`, D183). */
export interface CacheGate {
	/** True once the metadata cache has finished, or the start limit has passed. */
	seen(): boolean;
	/** How long to wait for the cache at most, in ms. */
	limitMs: number;
}

/** The vault events that an adaptor passes on. `cache` is the metadata cache event `changed`. */
export type VaultEventName = 'cache' | 'create' | 'modify' | 'rename' | 'delete';

/** True for a Markdown note. */
export const markdown = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'md';

/** The Markdown note at `path`, or null. */
export function fileAt(app: App, path: string): TFile | null {
	const f = app.vault.getAbstractFileByPath(path);
	return markdown(f) ? f : null;
}

/** The text of the note at `path`, from the cache of the vault. Rejects if the path is not a note. */
export async function readNote(app: App, path: string): Promise<string> {
	const f = fileAt(app, path);
	if (!f) throw new Error('not a note');
	return app.vault.cachedRead(f);
}

/**
 * Listens for one vault event and calls `deliver` for notes only: with the note, its text (`cache` only) and its old path
 * (`rename` only). Gives a function that stops the listening.
 */
export function onVaultEvent(
	app: App,
	event: VaultEventName,
	deliver: (file: TFile, text: string | undefined, oldPath: string | undefined) => void,
): () => void {
	let ref: EventRef;
	if (event === 'cache') {
		ref = app.metadataCache.on('changed', (file, data) => markdown(file) && deliver(file, data, undefined));
		return () => app.metadataCache.offref(ref);
	}
	if (event === 'rename') ref = app.vault.on('rename', (file, old) => markdown(file) && deliver(file, undefined, old));
	else if (event === 'delete') ref = app.vault.on('delete', (file) => markdown(file) && deliver(file, undefined, undefined));
	else if (event === 'create') ref = app.vault.on('create', (file) => markdown(file) && deliver(file, undefined, undefined));
	else ref = app.vault.on('modify', (file) => markdown(file) && deliver(file, undefined, undefined));
	return () => app.vault.offref(ref);
}

/** Settles when the metadata cache has finished its first pass, or after the start limit; at once if the gate has seen it. */
export function cacheReadyOf(app: App, gate: CacheGate): Promise<void> {
	if (gate.seen()) return Promise.resolve();
	return new Promise<void>((resolve) => {
		let ref: EventRef | null = null;
		let timer: number | null = null;
		const done = () => {
			if (ref) app.metadataCache.offref(ref);
			if (timer !== null) window.clearTimeout(timer);
			resolve();
		};
		ref = app.metadataCache.on('resolved', done);
		timer = window.setTimeout(done, gate.limitMs);
	});
}
