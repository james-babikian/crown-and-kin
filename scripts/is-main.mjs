// Tells a script whether node started it as the main file, so that importing it (a test, the size report) does not run it.
// Node gives `import.meta.url` of the main file with symlinks and junctions resolved, but `process.argv[1]` as typed.
// So both sides go through realpath; a plain path comparison does nothing, without an error, when the folder is reached through a link.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when `moduleUrl` (the `import.meta.url` of the caller) is the file that node started. */
export function isMain(moduleUrl) {
	const started = process.argv[1];
	if (!started) return false;
	try {
		return fs.realpathSync(started) === fs.realpathSync(fileURLToPath(moduleUrl));
	} catch {
		// A start path that does not exist (for example `node -e`) is not this module.
		return false;
	}
}
