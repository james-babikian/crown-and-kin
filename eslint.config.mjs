// Enforces the module and DOM rules of the plugin (see "The layers" in MAINTAINERS.md).
// Flat config: when two blocks set the same rule for a file, the later block replaces the
// earlier options, so each block below repeats every restriction that applies to its files.
// esbuild.config.mjs also fails the build if anything resolves to elkjs.
import tseslint from 'typescript-eslint';

const ELK = {
	group: ['elkjs', 'elkjs/*'],
	message: 'Plugin code must not use elkjs (spec §3, D9). It is only for the picture scripts.',
};
const NO_OBSIDIAN_IN_CORE = {
	name: 'obsidian',
	message: 'src/core must not import obsidian (spec §3).',
};
const NO_PLATFORM_IMPORT = {
	name: 'obsidian',
	importNames: ['Platform'],
	message: 'Do not use Platform in src (spec §7). Decide behaviour by pointer type and viewport.',
};

const NO_DOCUMENT_WRITE = ['write', 'writeln'].map((property) => ({
	object: 'document',
	property,
	message: 'Build DOM with createEl/createSvg/setText. No HTML strings (spec §3).',
}));

const HTML_MSG = 'Build DOM with createEl/createSvg/setText. No HTML strings or HTML parsers (spec §3).';
const HTML_NAMES = 'innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|parseHTMLUnsafe|setHTMLUnsafe|srcdoc';
// Names as identifiers (member access, object keys, `new DOMParser`) and as strings
// (`el['innerHTML']`, `Reflect.set(el, 'innerHTML')`). A string that ends in "HTML" is also
// refused so that `'inner' + 'HTML'` cannot build the name.
const SYNTAX_HTML = [
	{ selector: `Identifier[name=/^(${HTML_NAMES})$/]`, message: HTML_MSG },
	{ selector: `Literal[value=/^(${HTML_NAMES})$/]`, message: HTML_MSG },
	{ selector: 'Literal[value=/HTML$/]', message: HTML_MSG },
	{ selector: `TemplateElement[value.raw=/(${HTML_NAMES}|HTML$)/]`, message: HTML_MSG },
];

const SYNTAX_EMULATE_MOBILE = {
	selector: "Identifier[name='emulateMobile'], Literal[value='emulateMobile']",
	message: 'Never call emulateMobile in plugin code (spec §7.8).',
};
const SYNTAX_PLATFORM = {
	selector: "Identifier[name='Platform']:not(ImportSpecifier > Identifier)",
	message: 'Do not use Platform in src (spec §7). Decide behaviour by pointer type and viewport.',
};
const SYNTAX_REEXPORT_OBSIDIAN = {
	selector: "ExportAllDeclaration[source.value='obsidian']",
	message: 'Do not re-export obsidian; it would pass on Platform (spec §7).',
};
const SYNTAX_ELK = [
	{ selector: 'ImportExpression[source.value=/^elkjs(\\/|$)/]', message: 'Plugin code must not use elkjs (spec §3, D9).' },
	{
		selector: "ImportExpression:not([source.type='Literal'])",
		message: 'Use a plain string in import() so the elkjs ban (spec §3, D9) can be checked.',
	},
	{ selector: "CallExpression[callee.name='require']", message: 'Use import, not require, in plugin code.' },
];

const COLOUR_ATTR = '/^(fill|stroke|style|color|stop-color)$/';
const COLOUR_MSG = 'Set colours only through dynasty- classes in styles.css (spec §5.8). A house colour goes through --dynasty-house-color.';
const SYNTAX_DOM_COLOURS = [
	{
		selector: `CallExpression[callee.property.name=/^(setAttribute|setAttr)$/][arguments.0.value=${COLOUR_ATTR}]`,
		message: COLOUR_MSG,
	},
	{
		selector: `CallExpression[callee.property.name='setAttributeNS'][arguments.1.value=${COLOUR_ATTR}]`,
		message: COLOUR_MSG,
	},
	{
		selector: "CallExpression[callee.property.name=/^(setAttribute|setAttr)$/][arguments.0.type!='Literal']",
		message: 'In src/render/dom and src/obsidian, write attribute names as plain strings so the colour rule (spec §5.8) can be checked.',
	},
	{
		selector: "CallExpression[callee.property.name='setAttributeNS'][arguments.1.type!='Literal']",
		message: 'In src/render/dom and src/obsidian, write attribute names as plain strings so the colour rule (spec §5.8) can be checked.',
	},
	{
		selector: `Property[key.name='attr'] > ObjectExpression > Property[key.name=${COLOUR_ATTR}]`,
		message: COLOUR_MSG,
	},
	{
		selector: `Property[key.name='attr'] > ObjectExpression > Property[key.value=${COLOUR_ATTR}]`,
		message: COLOUR_MSG,
	},
	{
		selector: "Property[key.name='attr'] > ObjectExpression > :matches(Property[computed=true], SpreadElement)",
		message: 'In src/render/dom and src/obsidian, write attr keys as plain names so the colour rule (spec §5.8) can be checked.',
	},
	// The only allowed uses of `.style` are `.style.setProperty('--dynasty-…', …)` and removing such a property.
	{
		selector: "MemberExpression[property.name='style']:not(MemberExpression[property.name=/^(setProperty|removeProperty)$/] > MemberExpression.object)",
		message: `${COLOUR_MSG} Only .style.setProperty('--dynasty-…') is allowed.`,
	},
	{
		selector: "CallExpression[callee.property.name='removeProperty'][callee.object.property.name='style']:not([arguments.0.value=/^--dynasty-/])",
		message: `${COLOUR_MSG} Only custom properties that start with --dynasty- may be removed.`,
	},
	{
		selector: ":matches(ObjectPattern, ObjectExpression) > Property:matches([key.name='style'], [key.value='style'])",
		message: `${COLOUR_MSG} Only .style.setProperty('--dynasty-…') is allowed.`,
	},
	{
		selector: "MemberExpression[computed=true][property.value='style']",
		message: `${COLOUR_MSG} Only .style.setProperty('--dynasty-…') is allowed.`,
	},
	{
		selector: "CallExpression[callee.property.name='setProperty'][callee.object.property.name='style']:not([arguments.0.value=/^--dynasty-/])",
		message: `${COLOUR_MSG} Only custom properties that start with --dynasty- may be set.`,
	},
	{
		selector: "CallExpression[callee.property.name='setCssProps'] > ObjectExpression > :not(Property[key.value=/^--dynasty-/])",
		message: `${COLOUR_MSG} setCssProps may only set --dynasty- custom properties.`,
	},
	{
		selector: "Identifier[name='setCssStyles']",
		message: `${COLOUR_MSG} Use classes, or setCssProps with a --dynasty- custom property.`,
	},
];

export default tseslint.config(
	{
		ignores: ['main.js', 'node_modules/**', 'out/**'],
	},
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', { paths: [NO_PLATFORM_IMPORT], patterns: [ELK] }],
			'no-restricted-properties': ['error', ...NO_DOCUMENT_WRITE],
			'no-restricted-syntax': ['error', ...SYNTAX_HTML, SYNTAX_EMULATE_MOBILE, SYNTAX_PLATFORM, SYNTAX_REEXPORT_OBSIDIAN, ...SYNTAX_ELK],
		},
	},
	{
		files: ['src/core/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', { paths: [NO_OBSIDIAN_IN_CORE], patterns: [ELK] }],
		},
	},
	// The colour rule of src/render/dom holds for the plugin's windows too (M6: the Houses window writes house colours).
	{
		files: ['src/obsidian/**/*.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				...SYNTAX_HTML,
				SYNTAX_EMULATE_MOBILE,
				SYNTAX_PLATFORM,
				SYNTAX_REEXPORT_OBSIDIAN,
				...SYNTAX_ELK,
				...SYNTAX_DOM_COLOURS,
			],
		},
	},
	{
		files: ['src/render/dom/**/*.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				...SYNTAX_HTML,
				SYNTAX_EMULATE_MOBILE,
				SYNTAX_PLATFORM,
				SYNTAX_REEXPORT_OBSIDIAN,
				...SYNTAX_ELK,
				...SYNTAX_DOM_COLOURS,
			],
		},
	},
);
