// A file of the fake vault for the picker and window tests: a `TFile` of the fake Obsidian with a name, a base name and a size.
import { TFile as VaultFile } from 'obsidian';

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

/** A vault file at this path, with its name, base name, lower-case extension and a small size and dates. */
export function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}
