/*
 * Guards. `guarded` runs one step so that a failure goes to the console and not into Obsidian. The start guard builds on it: a step
 * that Obsidian can refuse (a code block name that another plugin already uses, or a call that a later Obsidian version changed)
 * must not stop the rest of the plugin from starting. A failure goes to the console, and the user gets one Notice for the whole
 * start, however many steps fail.
 */

import { Notice } from 'obsidian';
import { UI } from '../render/view-text';

/** How long the Notice stays, in ms. A failed start is not a small message. */
const NOTICE_MS = 15_000;

let told = false;

/**
 * Runs `fn` so that a throw never reaches Obsidian (spec §8): the error goes to the console with `label` after the plugin name, and
 * the result is `fallback` (undefined if none is given).
 */
export function guarded<T>(label: string, fn: () => T, fallback: T): T;
export function guarded<T>(label: string, fn: () => T): T | undefined;
export function guarded<T>(label: string, fn: () => T, fallback?: T): T | undefined {
	try {
		return fn();
	} catch (e) {
		console.error(`Crown and Kin: ${label}`, e);
		return fallback;
	}
}

/** Called at the start of `onload`: the next failure shows the Notice again. */
export function beginStart(): void {
	told = false;
}

/** Runs `step`. Returns false and tells the user (once) if it throws. */
export function guardStart(name: string, step: () => void): boolean {
	const ok = guarded(
		`cannot start ${name}`,
		() => {
			step();
			return true;
		},
		false,
	);
	if (!ok && !told) {
		told = true;
		try {
			new Notice(UI.startFailed, NOTICE_MS);
		} catch {
			// The console has the error.
		}
	}
	return ok;
}
