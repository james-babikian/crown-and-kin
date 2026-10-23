/*
 * Guards for the start of the plugin. A step that Obsidian can refuse (a code block name that another plugin already uses, or a
 * call that a later Obsidian version changed) must not stop the rest of the plugin from starting. The step is run inside a `try`;
 * a failure goes to the console, and the user gets one Notice for the whole start, however many steps fail.
 */

import { Notice } from 'obsidian';
import { UI } from '../render/view-text';

/** How long the Notice stays, in ms. A failed start is not a small message. */
const NOTICE_MS = 15_000;

let told = false;

/** Called at the start of `onload`: the next failure shows the Notice again. */
export function beginStart(): void {
	told = false;
}

/** Runs `step`. Returns false and tells the user (once) if it throws. */
export function guardStart(name: string, step: () => void): boolean {
	try {
		step();
		return true;
	} catch (e) {
		console.error(`Crown and Kin: cannot start ${name}`, e);
		if (!told) {
			told = true;
			try {
				new Notice(UI.startFailed, NOTICE_MS);
			} catch {
				// The console has the error.
			}
		}
		return false;
	}
}
