// The two owned parts of the tree view (review step 11, the decision notes "Owned parts of the tree view"): the pictures (`view-pictures.ts`) and the bars of
// the finder and the Show view (`finder-bars.ts`). Each is an object with a narrow port. The scan keeps the cut clean: the two files import no layer of the
// view chain (`tree-view-*.ts`, only the shared types of `tree-view-types.ts` and the `block-views.ts` types), neither imports the other, the chain holds no
// field or method of the state that moved, and the chain has one handle for each object (`pictures`, `finder`).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'src/obsidian';
const read = (name: string) => readFileSync(`${dir}/${name}`, 'utf8');
const imports = (text: string) => [...text.matchAll(/^import[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
const chain = readdirSync(dir).filter((n) => /^tree-view(-[a-z]+)?\.ts$/.test(n) && n !== 'tree-view-types.ts');

describe('the owned parts of the tree view', () => {
	for (const file of ['view-pictures.ts', 'finder-bars.ts']) {
		it(`${file} imports no layer of the view chain and no other owned part`, () => {
			const bad = imports(read(file)).filter((p) => (/^\.\/tree-view/.test(p) && p !== './tree-view-types') || /view-pictures|finder-bars/.test(p));
			expect(bad).toEqual([]);
		});
	}

	it('the chain holds no state or method that moved into the pictures or the finder bars', () => {
		// A call through the object is `this.pictures.name` or `this.finder.name`; a use as a member of the chain is `this.name` or a declaration.
		const names = 'pictureInfo|picturesOn|pictureToken|textIssues|picturesLookAgain|resolvePictures|pictureFile|makeLive|startPictures|showPictures|checkPictures|fileProblem|picturesChanged|linksResolved|hiddenUnderFull|closeFinder|closeSuccession|linePeopleNow|startFinder|showViewFor|buildResultBar|buildSuccessionBar|toggleBannerOptions|finderChange';
		const moved = new RegExp(String.raw`this\.(${names})\b|^\s*(protected |private |abstract )+(async )?(${names})\b`, 'm');
		const hits = chain.filter((n) => moved.test(read(n)));
		expect(hits).toEqual([]);
	});

	it('the chain has the handles: `pictures` in the base, `finder` in the base and made in the list layer', () => {
		expect(read('tree-view-base.ts')).toMatch(/readonly pictures: ViewPictures = new ViewPictures\(/);
		expect(read('tree-view-base.ts')).toMatch(/protected finder!: FinderBars</);
		expect(read('tree-view-list.ts')).toMatch(/this\.finder = new FinderBars\(this\.finderPort\(\)\)/);
		expect(chain).not.toContain('tree-view-pictures.ts');
		expect(chain).not.toContain('tree-view-finder.ts');
	});

	it('the self-test: the import reader finds a layer import', () => {
		expect(imports("import { A } from './tree-view-base';\nimport type { B } from './tree-view-types';")).toEqual(['./tree-view-base', './tree-view-types']);
	});
});
