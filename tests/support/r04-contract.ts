// The frozen contract of the note index (an internal study/the index contract, 0.4 WP-3a), as the T0 tests see it: local copies of the types, and loaders that import a module by a path held in a
// variable. Both are there so that this file and the tests that use it compile and lint before the modules exist (T0 writes tests first; the build of each package comes later).
// A builder who takes a package may replace a loader with a plain `import`; the types here must then agree with the real ones.
import type { FenceStoreLike, FenceVaultLike } from './fake-fence-vault';

/** The index contract 1.2: the options of the fence index. */
export interface FenceOptions {
	readsPerSlice?: number;
	sliceMs?: number;
	safetyMs?: number;
	saveWaitMs?: number;
}

/** The index contract 1.2: the fence index. */
export interface FenceIndex {
	start(): Promise<void>;
	dispose(): void;
	flush(): void;
	readonly complete: boolean;
	has(path: string, kind: 'kin' | 'cal'): boolean;
	notes(kind: 'kin' | 'cal'): string[];
	unsure(): ReadonlySet<string>;
	onChange(cb: () => void): () => void;
}

/** The exports of `src/view/fence-index.ts` that the tests use. */
export interface FenceIndexModule {
	createFenceIndex(vault: FenceVaultLike, store: FenceStoreLike, o?: FenceOptions): FenceIndex;
	fenceFlags(text: string): { kin: boolean; cal: boolean };
}

// A path in a variable: the type checker does not look for the module, and Vite finds it at run time.
const FENCE_INDEX_PATH = '../../src/view/fence-index';

/** Loads `src/view/fence-index.ts` (package F). */
export const loadFenceIndex = (): Promise<FenceIndexModule> => import(/* @vite-ignore */ FENCE_INDEX_PATH) as Promise<FenceIndexModule>;
