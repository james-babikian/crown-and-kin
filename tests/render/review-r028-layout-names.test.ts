/*
 * Search round 0.2.8, area A3 (layout): name lines.
 * Each test fails on the base commit and its name says why.
 */
import { describe, expect, it } from 'vitest';
import { cardText, cardForm, drawnGeometry, geometryFor, nameRoom } from '../../src/layout/geometry';
import { cardNameLines, runsText } from '../../src/render/name-lines';

const FAR = { maxCardWidths: 3, maxGenerations: 1 };
const eight = (s: string) => [...s].length * 8;

describe('a signed card (D14 sign) in a tree with a picture', () => {
	const geo = drawnGeometry(cardForm(geometryFor(16), 'down'), { sweeps: 4, far: FAR, portraits: ['x'] });
	const room = nameRoom(geo, cardText(geo), true, undefined);

	it('has a room where the one-line width (112 px) is narrower than the last-line width (160 px)', () => {
		expect(room.only).toBeLessThan(room.last);
	});

	it('a name wider than the one-line room (112 px) but not wider than the last-line room (160 px) does not stay on ONE text line under the sign', () => {
		const name = 'Alexander Bartholome'; // 20 characters, 160 px
		expect(eight(name)).toBeGreaterThan(room.only);
		expect(eight(name)).toBeLessThanOrEqual(room.last);
		const lines = cardNameLines(name, undefined, room, (s) => eight(s), 3);
		// One line is only right when it fits `only`; else the name must wrap to a second text line.
		const oneLineWidth = lines.length === 1 ? eight(runsText(lines[0])) : 0;
		expect(oneLineWidth, `lines: ${lines.map(runsText).join(' | ')}`).toBeLessThanOrEqual(room.only);
	});

	it('a name cut on a card made for ONE text line stops at the one-line room, not at the last-line room', () => {
		const lines = cardNameLines('Alexander Bartho Fitzgerald', undefined, room, (s) => eight(s), 1);
		expect(lines).toHaveLength(1);
		expect(eight(runsText(lines[0])), runsText(lines[0])).toBeLessThanOrEqual(room.only);
	});
});
