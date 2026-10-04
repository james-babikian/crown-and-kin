// Review round 0.2.3, area C: a fake vault and a fake editor for the handle registry.
import { vi } from 'vitest';

export const fence = (body: string) => ['```dynasty', body, '```'].join('\n');

/** Builds the fake `obsidian` module for `vi.mock`. */
export function obsidianMock() {
	class TFile {
		extension = 'md';
		constructor(public path: string) {}
	}
	class MarkdownView {}
	class Modal {}
	class Notice {}
	return { TFile, MarkdownView, Modal, Notice };
}

export type FakeVault = ReturnType<typeof makeVault>;

/** A vault of notes; `editorFor` opens one of them in a fake Live Preview editor (the editor is the text map). */
export async function makeVault(files: Record<string, string>, editorFor?: string) {
	const { MarkdownView, TFile } = (await import('obsidian')) as unknown as {
		MarkdownView: new () => object;
		TFile: new (p: string) => { path: string; extension: string };
	};
	const texts = new Map(Object.entries(files));
	const tfiles = new Map([...texts.keys()].map((p) => [p, new TFile(p)]));
	const leaves: { view: unknown }[] = [];
	if (editorFor) {
		leaves.push({
			view: Object.assign(new MarkdownView(), {
				file: tfiles.get(editorFor),
				getMode: () => 'source',
				editor: {
					getValue: () => texts.get(editorFor)!,
					offsetToPos: (o: number) => o,
					transaction: () => undefined,
					cm: {
						get state() {
							return { doc: { length: texts.get(editorFor)!.length } };
						},
						dispatch: (t: { changes: { from: number; to: number; insert: string } }) => {
							const text = texts.get(editorFor)!;
							texts.set(editorFor, text.slice(0, t.changes.from) + t.changes.insert + text.slice(t.changes.to));
						},
					},
				},
			}),
		});
	}
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
			read: async (f: { path: string }) => texts.get(f.path) ?? '',
			process: async (f: { path: string }, fn: (t: string) => string) => {
				texts.set(f.path, fn(texts.get(f.path) ?? ''));
			},
		},
		workspace: { getLeavesOfType: () => leaves },
	};
	return { app, texts, tfiles, leaves };
}

export const unused = vi;
