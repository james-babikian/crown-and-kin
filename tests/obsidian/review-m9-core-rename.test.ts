import { beforeEach, describe, expect, it } from 'vitest';

import { resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';
import { renameVault as vault } from '../support/rename-vault';

/*
 * code-reviewer, M9 core (WP 9.1). The finding of the removed review-m9-core-links.test.ts (its checks live in m9-fix-core and pictures), end to end: the real
 * LinkUpdater and the rewrite-links op (the fake vault of support/rename-vault.ts, B16).
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

const NOTE = ['```kin', 'people:', '  - id: a', '    name: A', '    link: "[[x.png.md]]"', '    portrait: "[[x.png]]"', '```', ''].join('\n');

describe('review M9 core: a rename in the vault, note "x.png.md" and picture "x.png"', () => {
	it('the rename of the note x.png.md keeps the portrait x.png', async () => {
		const v = vault({ 'Tree.md': NOTE, 'x.png.md': 'A note.' }, ['x.png']);
		await v.rename('x.png.md', 'y.md');
		expect(v.texts.get('Tree.md')).toContain('    portrait: "[[x.png]]"');
	});

	it('the rename of the picture x.png keeps the link to the note x.png.md', async () => {
		const v = vault({ 'Tree.md': NOTE, 'x.png.md': 'A note.' }, ['x.png']);
		await v.rename('x.png', 'z.png');
		expect(v.texts.get('Tree.md')).toContain('    link: "[[x.png.md]]"');
	});
});
