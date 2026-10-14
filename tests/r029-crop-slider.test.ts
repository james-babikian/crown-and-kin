// R029 N01 (scratch proof): the knob of the crop zoom slider sits above the track because two shifts add up.
// Obsidian's own rule `input[type=range]::-webkit-slider-thumb { position: relative; top: var(--slider-thumb-y) }` (-6px on the
// computer, -9px under `body.is-mobile`) is still in force for the crop slider, and the plugin adds `margin-top: -9.5px` on top.
// The engines (Chromium and WebKit alike, measured by an internal script) put the knob at the top of the track, so
// the knob needs exactly -9.5 px and the Obsidian shift must be cancelled (`top: 0`). This test fails while the rule keeps the margin
// and does not cancel `top`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/24-crop-tool.css', import.meta.url), 'utf8');

function rule(selector: string): string {
	const i = css.indexOf(selector);
	if (i < 0) throw new Error(`no rule ${selector}`);
	return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}

describe('crop zoom slider knob (N01)', () => {
	const thumb = rule('.dynasty-crop input.dynasty-crop-slider::-webkit-slider-thumb');
	it('cancels the Obsidian shift (top) when it uses a negative margin-top to centre the knob', () => {
		const usesMargin = /margin-top:\s*-/.test(thumb);
		const cancelsTop = /(^|[;\s])top:\s*0(px)?\s*(;|$)/.test(thumb) || /position:\s*static/.test(thumb);
		expect(usesMargin && !cancelsTop, `knob rule: ${thumb.replace(/\s+/g, ' ').trim()}`).toBe(false);
	});
});
