import { describe, expect } from 'vitest';
import { speedTest } from '../support/speed-test';
import { readPictureHeader } from '../../src/core/pictures';

// Proof of review s113-a: the attribute regex in `svgHeader` is quadratic on a long start tag with
// no `=`, or with an attribute whose quote never closes. A 64 KB scan window (SVG_SCAN) is the
// worst case, so one such file freezes the plugin for seconds when a picture is chosen or shown.

const enc = (s: string) => new TextEncoder().encode(s);

function ms(f: () => void): number {
	const t = performance.now();
	f();
	return performance.now() - t;
}

describe('svg header scan time', () => {
	speedTest('a 60 KB token inside <svg …> is read in under 400 ms', () => {
		expect(ms(() => readPictureHeader(enc(`<svg ${'a'.repeat(60000)}>`)))).toBeLessThan(400);
	});
	speedTest('an attribute whose quote never closes (60 KB) is read in under 400 ms', () => {
		expect(ms(() => readPictureHeader(enc(`<svg a = "${'x'.repeat(60000)}`)))).toBeLessThan(400);
	});
});
