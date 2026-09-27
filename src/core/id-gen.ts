/** Turns a display name into a slug: "Aldric Valmont" → "aldric-valmont", "Þórr" → "thorr". */
export function slugify(name: string): string {
	const slug = name
		.replace(/[Þþ]/g, 'th')
		.replace(/[Ææ]/g, 'ae')
		.replace(/[Øø]/g, 'o')
		.replace(/ß/g, 'ss')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (slug === '') return 'person';
	return /^\d+$/.test(slug) ? `p-${slug}` : slug;
}

/** A new id for `name` that isn't in `taken`: "aldric", then "aldric-2", "aldric-3"… */
export function uniqueId(name: string, taken: ReadonlySet<string>): string {
	const base = slugify(name);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}
