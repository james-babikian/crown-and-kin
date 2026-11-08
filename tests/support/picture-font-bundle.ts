// Bundles the browser half of the saved-picture font tests (picture-font-page.ts) for a real Chromium. Obsidian is a stub: the saved-picture path never calls
// it, but the files import names from it, so each name becomes an empty class. Also finds a Chromium and the sample notes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, type Plugin } from 'esbuild';

const ROOT = resolve(__dirname, '..', '..');

/** The path of a Chromium or Chrome on this computer (set CHROMIUM_PATH), or undefined: the browser tests then skip. */
export const CHROMIUM = [
	process.env['CHROMIUM_PATH'],
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => !!p && existsSync(p));

function obsidianStub(): Plugin {
	const names = new Set<string>();
	const walk = (dir: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/import\s+(?!type)\{([^}]*)\}\s+from\s+'obsidian'/g)) for (const n of m[1]!.split(',')) if (n.trim() && !n.trim().startsWith('type ')) names.add(n.trim().split(/\s+as\s+/)[0]!);
		}
	};
	walk(join(ROOT, 'src'));
	return {
		name: 'obsidian-stub',
		setup(b) {
			b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
			b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: [...names].map((n) => `export class ${n} {}`).join('\n'), loader: 'js' }));
		},
	};
}

/** The page script as one string for `page.evaluate`. */
export async function bundlePictureFontPage(): Promise<string> {
	const r = await build({
		entryPoints: [join(ROOT, 'tests', 'support', 'picture-font-page.ts')],
		bundle: true,
		write: false,
		format: 'iife',
		platform: 'browser',
		target: 'es2020',
		define: { __DYNASTY_HARNESS__: 'false' },
		plugins: [obsidianStub()],
		logLevel: 'error',
	});
	return r.outputFiles[0]!.text;
}

/** The kin blocks of a sample note in `fixtures/`, by file name. */
export function sampleBlocks(file: string): string[] {
	return [...readFileSync(join(ROOT, 'fixtures', file), 'utf8').matchAll(/^```kin\r?\n([\s\S]*?)^```/gm)].map((m) => m[1]!);
}
