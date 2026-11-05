import { describe, expect, it } from 'vitest';
import { declarationList, firstDifference, minifyStyles } from '../../scripts/minify-styles.mjs';

/*
 * The proof of scripts/minify-styles.mjs: esbuild rounds `rgb(0 0 0/50%)` to #0000007f and lightningcss to #00000080.
 * That difference of 1 in the alpha byte is no change of the style. A real change of a colour must still stop the build.
 */

const proof = async (source: string, copy: string) => firstDifference(await declarationList(source), await declarationList(copy));

describe('minify-styles proof', () => {
	it('accepts rgb(0 0 0/50%) although the two engines round the alpha byte in different directions', async () => {
		const source = '.a { color: rgb(0 0 0/50%); }';
		const copy = await minifyStyles(source);
		expect(await proof(source, copy)).toBeNull();
	});

	it('accepts a difference of 1 in the alpha byte of the same colour', () => {
		expect(firstDifference(['.a | color:#0000007f'], ['.a | color:#00000080'])).toBeNull();
	});

	it('stops at a difference of 2 in the alpha byte', () => {
		expect(firstDifference(['.a | color:#0000007e'], ['.a | color:#00000080'])).not.toBeNull();
	});

	it('stops at a real change of the colour', async () => {
		const source = '.a { color: rgb(0 0 0/50%); }';
		expect(await proof(source, '.a{color:rgb(0 0 1/50%)}')).not.toBeNull();
		expect(await proof(source, '.a{color:rgb(0 0 0/60%)}')).not.toBeNull();
	});

	it('stops when the colour is the same but another declaration changes', () => {
		expect(firstDifference(['.a | color:#0000007f;margin:0'], ['.a | color:#00000080;margin:1px'])).not.toBeNull();
	});
});
