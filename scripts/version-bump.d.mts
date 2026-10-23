// Types for scripts/version-bump.mjs, so the test can import it under strict TypeScript.
export interface VersionFiles {
	manifest: string;
	pkg: string;
	lock: string;
	versions: string;
}
export function parseVersion(text: string): [number, number, number] | null;
export function isHigher(a: string, b: string): boolean;
export function bumpVersion(files: VersionFiles, next: string): VersionFiles;
export function bumpInFolder(dir: string, next: string): void;
