/*
 * The switch rows of the Rules section of the Titles window (D291): a switch with its label and its hint
 * spans, and the change of those spans in place. The section `succession-section.ts` uses them; they hold no state of their own.
 */

const hintId = (key: string, tail: string): string => `dynasty-succ-hint-${key}${tail}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The hint spans of a switch row change in place: a span is made, changed or removed, and `aria-describedby` follows. The row and
 * its input stay, so a tap that is under way on the switch (the blur of the year field comes first) still hits the same element.
 */
export function setRowHints(pair: HTMLElement, key: string, hints: { first: string; cadet: string }): void {
	const text = pair.querySelector<HTMLElement>('.dynasty-rule-text');
	const input = pair.querySelector<HTMLElement>('input');
	if (!text || !input) return;
	const span = (name: 'first' | 'cadet', value: string): HTMLElement | null => {
		let el = text.querySelector<HTMLElement>(`[data-hint="${name}"]`);
		if (!value) {
			el?.remove();
			return null;
		}
		if (el) {
			if (el.getText() !== value) el.setText(value);
			return el;
		}
		el = text.createSpan({ cls: 'dynasty-sheet-hint', text: value, attr: { id: hintId(key, name === 'cadet' ? '-x' : ''), 'data-hint': name } });
		// The first hint stands before the cadet hint.
		const cadet = text.querySelector<HTMLElement>('[data-hint="cadet"]');
		if (name === 'first' && cadet && cadet !== el) text.insertBefore(el, cadet);
		return el;
	};
	const ids = [span('first', hints.first), span('cadet', hints.cadet)].flatMap((h) => (h ? [h.getAttribute('id') ?? ''] : [])).join(' ');
	if (ids) input.setAttribute('aria-describedby', ids);
	else input.removeAttribute('aria-describedby');
}

/** A switch with its label and an optional hint: one row (`dynasty-rule`), the switch at the right. */
export function switchRow(box: HTMLElement, o: { key: string; label: string; hint: string; extra?: string; on: boolean; set: (v: boolean) => void }): HTMLElement {
	const pair = box.createDiv({ cls: 'dynasty-succ-pair', attr: { 'data-succ': o.key } });
	const row = pair.createEl('label', { cls: ['dynasty-succ-switch', 'dynasty-rule'] });
	const text = row.createSpan({ cls: 'dynasty-rule-text' });
	text.createSpan({ cls: 'dynasty-succ-switch-text', text: o.label });
	// The hint stands in the text span, under its own label, as in the settings of Obsidian: it is then never nearer to the next switch.
	const hint = o.hint ? text.createSpan({ cls: 'dynasty-sheet-hint', text: o.hint, attr: { id: hintId(o.key, ''), 'data-hint': 'first' } }) : null;
	// The second hint (the cadet hint) is a hint of its own, so a screen reader reads it with the first.
	const extra = o.extra ? text.createSpan({ cls: 'dynasty-sheet-hint', text: o.extra, attr: { id: hintId(o.key, '-x'), 'data-hint': 'cadet' } }) : null;
	const described = [hint, extra].flatMap((h) => (h ? [h.getAttribute('id') ?? ''] : [])).join(' ');
	const track = row.createDiv({ cls: o.on ? ['checkbox-container', 'is-enabled'] : ['checkbox-container'] });
	const input = track.createEl('input', { attr: { type: 'checkbox', role: 'switch', 'aria-label': o.label, 'aria-describedby': described || null, 'data-focus': `succ-${o.key}` } });
	input.checked = o.on;
	input.addEventListener('change', () => o.set(input.checked));
	return pair;
}
