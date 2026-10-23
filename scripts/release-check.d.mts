// Types for release-check.mjs.
export function releaseProblems(
	tag: string,
	manifest: { version: string; minAppVersion: string },
	pkg: { version: string },
	versions: Record<string, string>,
	lock: { version?: string; packages?: Record<string, { version?: string }> },
): string[];
