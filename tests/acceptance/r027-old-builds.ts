/*
 * Loads `src/core` of an older release (a git tag) into `out/r027-old/<tag>/`, so a test can run the edit code
 * of that release on a note that has the 0.2.7 keys (contract A.4). `out/` is not committed. When git or the
 * tag is missing (for example in a copy of the project without the history), `oldBuild` gives null and the
 * test that needs it is skipped.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The `applyOp` of an old release: the same call as today's, but the ops it knows depend on the release. */
export type OldApplyOp = (body: string, op: Record<string, unknown>) => { ok: true; body: string } | { ok: false; code: string; detail?: string };

/** The folder of the exported release, or null when it cannot be exported. */
export function oldBuild(tag: string): string | null {
	const dir = join(ROOT, 'out', 'r027-old', tag);
	try {
		if (!existsSync(join(dir, 'src', 'core', 'yaml-edit.ts'))) {
			const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
			const files = git(['ls-tree', '-r', '--name-only', tag, 'src/core']).split('\n').filter((f) => f.endsWith('.ts'));
			if (files.length === 0) return null;
			for (const f of files) {
				const to = join(dir, f);
				mkdirSync(dirname(to), { recursive: true });
				writeFileSync(to, git(['show', `${tag}:${f}`]));
			}
		}
		return dir;
	} catch {
		return null;
	}
}

/** `applyOp` of a release exported by `oldBuild`. */
export async function oldApplyOp(dir: string): Promise<OldApplyOp> {
	const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'src', 'core', 'yaml-edit.ts')).href)) as { applyOp: OldApplyOp };
	return mod.applyOp;
}
