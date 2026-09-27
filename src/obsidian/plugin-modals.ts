/*
 * The modals the plugin has open (sheets, choices, pickers, the partnership editor). When the
 * plugin unloads they close, so that none of them can write to a note after that (spec §8).
 */

const open = new Map<object, () => void>();

/** Records an open modal and how to close it without questions; returns the function that forgets it. */
export function trackModal(modal: object, close: () => void): () => void {
	open.set(modal, close);
	return () => open.delete(modal);
}

/** Is a modal of the plugin open? */
export function pluginModalOpen(): boolean {
	return open.size > 0;
}

/** Closes every recorded modal, the newest first. */
export function closePluginModals(): void {
	for (const [modal, close] of [...open].reverse()) {
		open.delete(modal);
		try {
			close();
		} catch (e) {
			console.error('Dynasty Tree: cannot close a window of the plugin', e);
		}
	}
}
