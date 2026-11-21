/**
 * The fold controls of the headless SVG (part of `renderSvg`, see `svg-string.ts`): the "+ N" signs of the
 * folded families and, outside a saved picture, the "−" buttons of the open ones.
 */
import { FOLD_EM } from '../layout/fold-spots';
import { FOLD_CHIP_EM, signText } from './scene-model';
import { fontOf } from './saved-picture';
import { esc, textWidth, type SvgCtx, type SvgFolds } from './svg-ctx';

/** Draws the fold signs (and, when `buttons` is set, the minus chips) of `layout.folds`; a saved picture draws signs only, and only when it asks for them. */
export function drawFolds(ctx: SvgCtx): void {
	const { layout, opts, saved, c, fonts, measured, ground, di, out } = ctx;
	const foldMode: SvgFolds | undefined = saved ? (saved.folds ? { buttons: false } : undefined) : opts.folds;
	if (!foldMode) return;
	const em = layout.geometry.fontPx;
	const sized = FOLD_EM.signText * em;
	const signFont = fontOf('600', sized, fonts.ui);
	for (const control of layout.folds ?? []) {
		const { spot } = control;
		if (!control.folded) {
			if (!foldMode.buttons) continue;
			// A small square chip with rounded corners and a round-capped minus.
			const side = FOLD_CHIP_EM * em;
			const arm = 0.28 * em;
			out.push(`<rect x="${spot.x - side / 2}" y="${spot.y - side / 2}" width="${side}" height="${side}" rx="${0.15 * em}" fill="${ground}" stroke="${c.textMuted}" stroke-width="1"/>`);
			out.push(`<path d="M${spot.x - arm} ${spot.y}H${spot.x + arm}" fill="none" stroke="${c.text}" stroke-width="${0.11 * em}" stroke-linecap="round"/>`);
			continue;
		}
		const text = signText(control.count);
		const textW = measured ? measured(text, signFont) : textWidth(text, sized, true);
		const h = FOLD_EM.signHeight * em;
		// D206: the sign is centred on the line; D207: in a sideways layout the line runs along it, so it starts where the open chip starts.
		const width = textW + FOLD_EM.signPad * em;
		const anchored = layout.orientation === 'sideways';
		const left = anchored ? spot.x - (FOLD_CHIP_EM / 2) * em : spot.x - width / 2;
		const group = saved ? `<g${di(`fold:${control.key}`)}>` : '';
		if (group) out.push(group);
		out.push(`<rect x="${left}" y="${spot.y - h / 2}" width="${width}" height="${h}" rx="${0.25 * em}" fill="${ground}" stroke="${c.textMuted}" stroke-width="1"/>`);
		out.push(`<text x="${anchored ? left + 0.45 * em : spot.x}" y="${spot.y + 0.35 * sized}" font-size="${sized}" font-weight="600"${anchored ? '' : ' text-anchor="middle"'}${saved ? ` font-family="${esc(fonts.ui)}"` : ''} fill="${c.text}">${esc(text)}</text>`);
		if (group) out.push('</g>');
	}
}
