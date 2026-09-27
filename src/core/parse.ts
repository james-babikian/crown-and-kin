import { isScalar, Lexer, parseDocument, type Document } from 'yaml';
import type { CodedIssue, HardError } from './issues';
import { blankPlainNulls, bool, int, isEmpty, isMap, linkValue, list, str, type Raw, type RawMap } from './tolerate';
import type { House, ParentRef, ParseResult, Person, Tree, TreeOptions, Union } from './types';

type Section = 'people' | 'houses' | 'unions';

/** Reads one block. Collects shape issues; reference and value checks happen in `validate.ts`. */
class Reader {
	readonly issues: CodedIssue[] = [];

	constructor(
		private readonly doc: Document,
		private readonly source: string,
	) {}

	warn(code: CodedIssue['code'], params: CodedIssue['params'], ids?: string[]) {
		this.issues.push(ids ? { code, level: 'warning', params, ids } : { code, level: 'warning', params });
	}

	/**
	 * Entries of a list section. The §8 "single string where a list was expected" tolerance is
	 * for lists of ids (`parents`, `partners`); a section of another shape is reported and not used.
	 */
	section(v: Raw, name: Section): Raw[] {
		if (isEmpty(v)) return [];
		if (Array.isArray(v)) return v;
		this.warn('section-wrong-shape', { section: name });
		return [];
	}

	options(v: Raw): TreeOptions {
		if (isEmpty(v)) return {};
		if (!isMap(v)) {
			this.warn('section-wrong-shape', { section: 'options' });
			return {};
		}
		return { start: str(v.start), focus: str(v.focus), generations: int(v.generations), height: int(v.height) };
	}

	houses(v: Raw): House[] {
		const houses: House[] = [];
		this.section(v, 'houses').forEach((h, i) => {
			if (!isMap(h)) {
				this.warn('entry-not-map', { section: 'houses', index: i + 1 });
				return;
			}
			const id = str(h.id);
			const name = str(h.name);
			if (!id) {
				this.warn('missing-id', name ? { section: 'houses', index: i + 1, name } : { section: 'houses', index: i + 1 });
				return;
			}
			if (Object.prototype.hasOwnProperty.call(h, 'color') && isEmpty(h.color)) {
				const params: CodedIssue['params'] = { house: name ?? id, id };
				const written = this.commentedColour(['houses', i, 'color']);
				if (written) params.value = written;
				this.warn('house-color-null', params, [id]);
			}
			houses.push({ id, name: name ?? id, color: str(h.color) });
		});
		return houses;
	}

	/** A list item's text as `UnionRef.text` compares it: comments dropped, whitespace runs as one space. */
	private itemText(path: (string | number)[]): string | undefined {
		try {
			const node = this.doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
			if (!node?.range) return undefined;
			return textWithoutComments(this.source.slice(node.range[0], node.range[1]));
		} catch {
			return undefined;
		}
	}

	/** `color: #8b1e3f` without quotes: YAML reads the colour as a comment. Recover it for the message. */
	private commentedColour(path: (string | number)[]): string | undefined {
		try {
			const node = this.doc.getIn(path, true);
			if (!isScalar(node) || !node.range) return undefined;
			const rest = this.source.slice(node.range[0]).split(/\r?\n/, 1)[0];
			return /^\s*(#[0-9a-fA-F]{3,8})\b/.exec(rest)?.[1];
		} catch {
			return undefined;
		}
	}

	/** `taken`: every id written anywhere as a person or a reference to one. */
	people(v: Raw, taken: Set<string>): Person[] {
		const entries = this.section(v, 'people');
		const people: Person[] = [];
		entries.forEach((p, index) => {
			if (!isMap(p)) {
				this.warn('entry-not-map', { section: 'people', index: index + 1 });
				return;
			}
			const name = str(p.name);
			let id = str(p.id);
			if (!id) {
				// Still drawn, under an id that nothing in the block uses, so nothing links to it by accident.
				id = `~${index + 1}`;
				while (taken.has(id)) id = `~${id}`;
				this.warn('missing-id', name ? { section: 'people', index: index + 1, name } : { section: 'people', index: index + 1 }, [id]);
			}
			people.push({
				id,
				name: name ?? id,
				title: str(p.title),
				house: str(p.house),
				sex: str(p.sex),
				born: str(p.born),
				died: str(p.died),
				parents: this.parents(p.parents, id, name ?? id),
				placement: str(p.placement),
				illegitimate: bool(p.illegitimate),
				union: str(p.union),
				link: linkValue(p.link),
				notes: str(p.notes),
				index,
			});
		});
		return people;
	}

	private parents(v: Raw, owner: string, ownerName: string): ParentRef[] {
		const refs: ParentRef[] = [];
		list(v).forEach((raw, i) => {
			if (isMap(raw)) {
				const id = str(raw.id);
				if (!id) {
					this.warn('missing-id', { section: 'parents', index: i + 1, person: ownerName }, [owner]);
					return;
				}
				refs.push({ id, type: str(raw.type) ?? 'birth' });
				return;
			}
			const id = str(raw);
			if (id) refs.push({ id, type: 'birth' });
			else if (!isEmpty(raw)) this.warn('entry-not-map', { section: 'parents', index: i + 1, person: ownerName }, [owner]);
		});
		return refs;
	}

	unions(v: Raw): Union[] {
		const unions: Union[] = [];
		this.section(v, 'unions').forEach((u, index) => {
			if (!isMap(u)) {
				this.warn('entry-not-map', { section: 'unions', index: index + 1 });
				return;
			}
			unions.push({
				id: str(u.id),
				partners: list(u.partners).map(str).filter((s): s is string => s !== undefined),
				type: str(u.type) ?? 'marriage',
				start: str(u.start),
				end: str(u.end),
				index,
				text: this.itemText(['unions', index]),
			});
		});
		return unions;
	}
}

/**
 * YAML text without its comments, whitespace runs as one space. Comment-like text in scalars
 * stays, and quoted scalars keep their inner spaces (they are part of the value).
 */
export function textWithoutComments(text: string): string {
	let out = '';
	let plain = '';
	for (const token of new Lexer().lex(text)) {
		// The lexer adds a few one-character markers that are not in the text.
		if (token === '\x02' || token === '\x18' || token === '\x1f' || token.startsWith('#')) continue;
		if (token.startsWith('"') || token.startsWith("'")) {
			out += plain.replace(/\s+/g, ' ') + token;
			plain = '';
		} else plain += token;
	}
	return (out + plain.replace(/\s+/g, ' ')).trim();
}

/** Person ids and every reference to a person, as written; generated ids must avoid all of them. */
export function referencedIds(data: RawMap): Set<string> {
	const ids = new Set<string>();
	const add = (v: Raw) => {
		const s = str(isMap(v) ? v.id : v);
		if (s !== undefined) ids.add(s);
	};
	if (isMap(data.options)) {
		add(data.options.start);
		add(data.options.focus);
	}
	for (const p of Array.isArray(data.people) ? data.people : []) {
		if (!isMap(p)) continue;
		add(p.id);
		list(p.parents).forEach(add);
	}
	for (const u of Array.isArray(data.unions) ? data.unions : []) if (isMap(u)) list(u.partners).forEach(add);
	return ids;
}

/** The parser's first sentence, without the position (the error box shows the line itself). */
function cleanDetail(message: string): string {
	return message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '').trim();
}

function yamlError(e: unknown): HardError {
	const err = e as { message?: unknown; linePos?: { line: number }[] };
	const detail = typeof err?.message === 'string' ? cleanDetail(err.message) : String(e);
	const line = err?.linePos?.[0]?.line;
	return typeof line === 'number' ? { code: 'yaml-invalid', line, detail } : { code: 'yaml-invalid', detail };
}

export type ParsedBody = { ok: true; doc: Document; data: Raw } | { ok: false; error: HardError };

/**
 * The one YAML parse used for reading and for editing (`yaml-edit.ts`). The failsafe schema
 * keeps every scalar exactly as written (fictional dates, leading zeros, numeric-looking ids,
 * and free text such as `1e3` or `null`); see the decision notes.
 *
 * Never throws and never writes to the console: `logLevel: 'error'` keeps the yaml package's
 * warnings (unknown tags, stringified keys) out of Obsidian's console.
 */
export function parseBody(source: string): ParsedBody {
	try {
		const doc = parseDocument(source, { schema: 'failsafe', logLevel: 'error' });
		if (doc.errors.length) return { ok: false, error: yamlError(doc.errors[0]) };
		blankPlainNulls(doc);
		const data: Raw = doc.toJS();
		if (!isEmpty(data) && !isMap(data)) return { ok: false, error: { code: 'not-a-map' } };
		return { ok: true, doc, data };
	} catch (e) {
		// Unresolved or excessive aliases surface only while converting.
		return { ok: false, error: yamlError(e) };
	}
}

/** Parses a dynasty block body into a read-only model. Never throws. */
export function parseDynasty(source: string): ParseResult {
	const parsed = parseBody(source);
	if (!parsed.ok) return parsed;
	return { ok: true, tree: readTree(parsed.doc, parsed.data, source) };
}

/** The model of a body that `parseBody` accepted. */
export function readTree(doc: Document, data: Raw, source: string): Tree {
	if (!isMap(data)) return { options: {}, houses: [], people: [], unions: [], issues: [] };

	const r = new Reader(doc, source);
	const taken = referencedIds(data);
	return {
		options: r.options(data.options),
		houses: r.houses(data.houses),
		people: r.people(data.people, taken),
		unions: r.unions(data.unions),
		issues: r.issues,
	};
}
