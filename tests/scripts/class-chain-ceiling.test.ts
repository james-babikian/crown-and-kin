// A ceiling for the two class chains (architecture review step 2, D369). The tree view is one object spread over eight classes
// (`TreeViewBase` … `TreeView`, src/obsidian/tree-view*.ts; its pictures and finder bars are objects of their own since step 11) and the edit sheet over seven (`EditSheetBase` … `EditSheet`, edit-sheet*.ts).
// The size rule counts lines per file and per function, so a chain can grow by a layer and no file is over the rule. Here the members of
// each chain are counted from the parsed source: methods (static methods and accessors included, constructors not), fields (static
// included) and `abstract` members, which are the up-calls of a lower layer into a higher one. The numbers are exact: a rise fails, and a
// change that makes a chain smaller fails until it lowers the numbers here in the same commit, so the ceiling follows the chain down.
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface ChainCount {
	classes: string[];
	methods: number;
	fields: number;
	upCalls: number;
}

/** Counts the chain that ends at the class `leaf` among the classes of the given source texts; a base class outside them ends the chain. */
function countChainIn(texts: string[], leaf: string): ChainCount {
	const decls = new Map<string, ts.ClassDeclaration>();
	for (const text of texts) {
		const sf = ts.createSourceFile('chain.ts', text, ts.ScriptTarget.Latest, true);
		for (const s of sf.statements) if (ts.isClassDeclaration(s) && s.name) decls.set(s.name.text, s);
	}
	const out: ChainCount = { classes: [], methods: 0, fields: 0, upCalls: 0 };
	for (let name: string | undefined = leaf; name !== undefined && decls.has(name); ) {
		const node: ts.ClassDeclaration = decls.get(name)!;
		out.classes.push(name);
		for (const m of node.members) {
			const abstract = (ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : []).some((x) => x.kind === ts.SyntaxKind.AbstractKeyword);
			if (ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)) {
				if (abstract) out.upCalls++;
				else out.methods++;
			} else if (ts.isPropertyDeclaration(m)) {
				if (abstract) out.upCalls++;
				else out.fields++;
			}
		}
		const base = node.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
		name = base && ts.isIdentifier(base) ? base.text : undefined;
	}
	return out;
}

/** Counts the chain that ends at `leaf` in the files of src/obsidian whose names start with `prefix`. */
const countChain = (prefix: string, leaf: string): ChainCount =>
	countChainIn(
		readdirSync('src/obsidian')
			.filter((n) => n.startsWith(prefix) && n.endsWith('.ts'))
			.map((n) => readFileSync(`src/obsidian/${n}`, 'utf8')),
		leaf,
	);

describe('the class chains do not grow (exact ceilings)', () => {
	it('the tree view: 8 classes, 249 methods, 98 fields, 45 abstract up-calls', () => {
		expect(countChain('tree-view', 'TreeView')).toEqual({
			classes: ['TreeView', 'TreeViewList', 'TreeViewActions', 'TreeViewToolbar', 'TreeViewScene', 'TreeViewPlacement', 'TreeViewLifecycle', 'TreeViewBase'],
			methods: 249,
			fields: 98,
			upCalls: 45,
		});
	});

	it('the edit sheet: 7 classes, 152 methods, 51 fields, 38 abstract up-calls', () => {
		expect(countChain('edit-sheet', 'EditSheet')).toEqual({
			classes: ['EditSheet', 'EditSheetWrites', 'EditSheetActions', 'EditSheetFamily', 'EditSheetForm', 'EditSheetPortrait', 'EditSheetBase'],
			methods: 152,
			fields: 51,
			upCalls: 38,
		});
	});

	it('counts methods, accessors, fields and abstract members of a made-up chain, and stops at a class outside the texts', () => {
		const a = 'abstract class A extends Modal { a = 1; static s = 2; abstract up(): void; abstract f: number; m() {} get g() { return 1; } constructor() { super(); } }';
		const b = 'class B extends A { b = 2; up() {} static t() {} }\nclass C { c = 3; n() {} }';
		expect(countChainIn([a, b], 'B')).toEqual({ classes: ['B', 'A'], methods: 4, fields: 3, upCalls: 2 });
	});
});
