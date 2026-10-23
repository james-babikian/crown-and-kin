// Types for minify-styles.mjs.
export function minifyStyles(css: string): Promise<string>;
export function declarationList(css: string): Promise<string[]>;
export function firstDifference(source: string[], copy: string[]): string | null;
