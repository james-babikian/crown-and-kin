/*
 * Turns the key table of `keys.ts` into text: the whole document `docs/format.md`. A pure function, so
 * `tests/core/format-table.test.ts` can compare the file with the output. `generate.ts` writes the file. The README has only a
 * short example and a link to the document, so that it stays short.
 */

import { calendarDoc } from './calendar-doc';
import { KEYS, SECTIONS, TOLERATED, VALUE_LISTS, keysOf, type FormatKey, type FormatSection } from './keys';

const RESERVED = KEYS.filter((x) => x.reserved).length;
const cell = (text: string) => text.replace(/\|/g, '\\|');
const code = (words: readonly string[]) => words.map((w) => `\`${w}\``).join(', ');

/** Names that a user should not mistake for another key: reserved keys carry the mark in the key cell. */
const keyCell = (x: FormatKey) => `\`${x.key}\`${x.reserved ? ' (reserved)' : ''}`;

const RULES = [
	'A new plugin version 1.x can add a key. It never changes what an old key means.',
	'If the plugin does not know a key, it does not remove the key when you change the tree in a window. It keeps your comments too. A comment is a text line that starts with #.',
	'A tree that works in plugin version 1.0 works in every later plugin version 1.x.',
	'A change that breaks these rules needs plugin version 2.0. The key `format` in `options` is reserved for that. You do not need to write it. Plugin version 1.x never writes it.',
];

function sectionTable(s: FormatSection): string[] {
	const out = [`| Key | Meaning | Accepted forms | Written form | Since |`, '|---|---|---|---|---|'];
	for (const x of keysOf(s.id)) out.push(`| ${keyCell(x)} | ${cell(x.meaning)} | ${cell(x.accepts)} | ${cell(x.written)} | ${x.since} |`);
	return out;
}

function valueTable(): string[] {
	const out = ['| Section | Key | Values | Old names, read as the value on the right |', '|---|---|---|---|'];
	for (const v of VALUE_LISTS) {
		const old = v.old ? Object.entries(v.old).map(([from, to]) => `\`${from}\` = \`${to}\``).join(', ') : 'None';
		out.push(`| ${SECTIONS.find((s) => s.id === v.section)!.heading} | \`${v.key}\` | ${code(v.values)} | ${old} |`);
	}
	return out;
}

/** The whole text of `docs/format.md`. */
export function formatDoc(): string {
	const lines: string[] = [
		'# Format 1: the tree text',
		'',
		'This file is generated. Do not edit it by hand. Change `scripts/format/keys.ts` and run `npm run format-doc`.',
		'',
		`Format 1 is the form of the tree text in plugin version 0.3 and in every plugin version 1.x. Format 1 has ${KEYS.length} keys, ${RESERVED} of them reserved. The plugin reads the other ${KEYS.length - RESERVED}. The README has a short example of a tree.`,
		'',
		'## The rules of Format 1',
		'',
		...RULES.map((r, i) => `${i + 1}. ${r}`),
		'',
		'## How the plugin reads a tree',
		'',
		'- The tree is YAML in a code block with the language `kin`. If the YAML is not valid, or the top level is not a map, the plugin shows an error box and no tree.',
		'- Every value is read as text, exactly as you wrote it. `born: 1102` is the text "1102". The plugin reads a date only to find its year (see "The calendar note"). It never changes the text of a date.',
		'- If two people have the same `id`, or two partnerships have the same `id`, the plugin shows the tree but does not let you edit it.',
		'- Every other fault is a warning. The tree still shows, with a warning button and a list.',
		'- A key that the plugin does not know gives no warning. It stays in the note at every level.',
		'',
		'## How the plugin writes a tree',
		'',
		'- The plugin changes only the text lines that must change. Comments, the order of keys, quotes and the flow style of the lines that it does not change stay as they are.',
		'- A new key goes after the nearest earlier key in the write order of its section. The write order is below each table.',
		'- A value is written plain if plain YAML reads it back as the same text. If not, it is written in double quotes. A value that you wrote in quotes keeps its quotes when the plugin changes it.',
		'- A list that the plugin writes is a flow list, for example `[aldric, hugo]`. A block list that you typed keeps its form.',
		'',
		'## The keys',
		'',
		'The column "Since" is the plugin version that added the key. "0.1" is the original format. For a reserved key, it is the version that reserved it.',
		'',
	];
	for (const s of SECTIONS) {
		lines.push(`### ${s.heading}`, '', s.where, '', ...sectionTable(s), '');
		if (s.order) lines.push(`Write order: ${code(s.order)}.`, '');
	}
	lines.push('## Values', '', 'Some keys take one of a fixed list of values. The plugin compares the values after it trims the text and makes it lower case. An old name stays as you wrote it.', '', ...valueTable(), '');
	lines.push('## Forms that the plugin accepts without a warning', '', ...TOLERATED.map((t) => `- ${t}`), '');
	lines.push(...calendarDoc());
	const reserved = KEYS.filter((x) => x.reserved);
	lines.push('## Reserved keys', '', 'The plugin keeps these keys and never reads them. It never writes them.', '', ...reserved.map((x) => `- \`${x.key}\` in ${SECTIONS.find((s) => s.id === x.section)!.heading}: ${x.meaning}`), '');
	lines.push(
		'## Older and newer plugin versions',
		'',
		'- A newer version reads without error every tree that an older version wrote. The sample trees of the versions 0.1.0 and 0.2.0 are part of the tests.',
		'- The meaning of an old word can change. Since version 0.2.8, the partnership types `engaged`, `mistress`, `lover`, `liaison` and `concubine` mean a known type. Before, the plugin drew them as a marriage.',
		'- Since version 0.5, the partnership key `ended-by` says why a marriage ended. An older version keeps the key and ignores it.',
		'- An older version keeps the keys that it does not know when it writes the note. It does not show them. Update the plugin on all your devices.',
		'',
	);
	return lines.join('\n');
}
