/**
 * Finds which people need the D14 "illegitimate" sign drawn on their card, from a finished
 * `EdgeDrawing`. `render/svg-string.ts` and `render/dom/scene.ts` both call `illegitimateSigns`
 * so that the sign and the dashed illegitimate line never both appear for the same person.
 */
import type { FamilyGraph } from '../core/derive';
import type { Person } from '../core/types';
import type { EdgeDrawing } from './model';

/**
 * People whose card carries the "illegitimate" sign (spec D14): `illegitimate: true`, and no
 * dashed illegitimate line comes down to their card. That happens when they have no birth
 * parents listed, or when they sit under adoptive or ward parents (those lines keep their own
 * style). Renderers draw the sign where `cardText(geo).sign` says.
 *
 * Only the line that ends at the child counts: a drop lists the child first and then exactly
 * its placement parents (the decision notes, "What EdgePath.people lists"). A trunk lists the parents
 * first, so an illegitimate parent of illegitimate children is not taken as shown by their
 * children's trunk.
 */
export function illegitimateSigns(g: FamilyGraph, edges: EdgeDrawing): Set<string> {
	const shown = new Set<string>();
	for (const p of edges.paths) {
		if (p.kind !== 'illegitimate' || !p.people.length) continue;
		const child = p.people[0];
		const parents = g.placementParents.get(child) ?? [];
		const rest = p.people.slice(1);
		if (parents.length && rest.length === parents.length && parents.every((x) => rest.includes(x))) shown.add(child);
	}
	return new Set(g.people.filter((p) => p.illegitimate && !shown.has(p.id)).map((p) => p.id));
}

/**
 * A cheap superset of `illegitimateSigns`, from the graph alone (no lines needed): `illegitimate: true` and no birth-type placement parent,
 * or placement parents that are adoptive or ward. A person with birth parents always has the dashed illegitimate line, so is never in the real
 * set. `tallCardsFor` asks this before it asks for a second layout pass: the sign narrows the name room, so the signs of every illegitimate person matter, and most of them are not signed.
 */
export function couldBeSigned(g: FamilyGraph, p: Person): boolean {
	return !!p.illegitimate && g.placementType.get(p.id) !== 'birth';
}
