import { badgeTap } from '../src/obsidian/focus-mode';

/** The tap square of the `+` badge (the `square` of `badgeTap`): what the tests of contract 4.2 measure. */
export const badgeSquare = (...args: Parameters<typeof badgeTap>) => badgeTap(...args).square;
