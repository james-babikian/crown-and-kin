// Types for esbuild.config.mjs, so scripts can import the bundle options under strict TypeScript.
import type { BuildOptions } from 'esbuild';
export function bundleOptions(prod: boolean): BuildOptions;
