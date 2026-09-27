/**
 * Milestone 6 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Link maintenance (spec §6.9, D6, D35). `link-rewrite.ts` implements `LinkTargets`,
 * `NormaliseTarget` and the `rewrite-links` op (`RewriteLinksOp` in `edit.ts`) (WP6.1). The plugin
 * decides which targets pointed to the renamed note (it resolves them against the vault); the
 * core only reads and rewrites text.
 */

/**
 * The link targets of every person `link` in a tree body, in document order, without `[[`, `]]`,
 * `#heading` and `|alias` (for example `folder/Old` or `Old.md`). Every written form counts: a
 * quoted "[[Old]]", a plain string, and the unquoted [[Old]] that YAML reads as a nested flow
 * sequence (spec §4.1 tolerate). Returns [] when the body does not parse. Never throws.
 */
export type LinkTargets = (body: string) => string[];

/**
 * The form of a link target used for comparison and for `RewriteLinksOp.map` keys: backslashes
 * become `/`, a trailing `.md` is removed, and the text is lower case.
 */
export type NormaliseTarget = (target: string) => string;
