/*
 * The modals the plugin has open (sheets, choices, pickers, the partnership editor). When the
 * plugin unloads they close, so that none of them can write to a note after that (spec §8).
 */

const open = new Map<object, () => void>();
// The Undo Notices among them: they close at unload like a window, but they do not hold the keyboard focus.
const notices = new Set<object>();

/** Records an open modal and how to close it without questions; returns the function that forgets it. `notice` marks an Undo Notice. */
export function trackModal(modal: object, close: () => void, notice = false): () => void {
	open.set(modal, close);
	if (notice) notices.add(modal);
	return () => {
		notices.delete(modal);
		return open.delete(modal);
	};
}

/** Is a modal of the plugin open? */
export function pluginModalOpen(): boolean {
	return open.size > 0;
}

/** Is a window of the plugin open (a modal that is not an Undo Notice)? */
export function pluginWindowOpen(): boolean {
	return open.size > notices.size;
}

/** Closes every recorded modal, the newest first. */
export function closePluginModals(): void {
	for (const [modal, close] of [...open].reverse()) {
		open.delete(modal);
		notices.delete(modal);
		try {
			close();
		} catch (e) {
			console.error('Crown and Kin: cannot close a window of the plugin', e);
		}
	}
}
