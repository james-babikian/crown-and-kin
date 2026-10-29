/**
 * The compaction step of the placement (spec §5.1 step 4, D231), with two changes made for the card-and-line build. Part (c) moves the whole piece of an only child (the child's
 * block with everything that hangs below it), so a snap never moves a child away from its own children (the fault of D238 "an only child moved away from its own children").
 * The cards are read and moved through the small type `Placed`, so the plan's own items are given to it with no copy.
 *
 * What the step does: after the centring sweeps it closes the empty space between sibling groups. Three parts, each with a fixed amount
 * of work and no tolerance: (a) each sibling group with everything that hangs below it moves left as far as the smallest gaps
 * allow, then centres under its dot; (b) one pass up and one pass down in which every block with everything below it moves, as one
 * piece, to the smallest total of three penalties (children off their dot, gaps wider than the smallest gap, partners far apart),
 * never past the order or a smallest gap; (c) an only child goes under its dot where the room beside its piece allows.
 * `compactor` reads the structure of the layout once (blocks, families, the terms of the penalties); the function it returns runs
 * the step again on the cards as the placement left them, and moves the cards in place. The order of a row and the smallest gaps
 * never change, so the sibling order (D2) stays.
 */
import type { FamilyGraph, FamilyUnion } from '../core/derive';
import { soloKey } from '../core/order';
import { TIE } from './geometry';

/** What the step reads of a card and moves: where it stands along its row, how wide it is, and its row (a plan `Item` has all three). */
export interface Placed {
	x: number;
	w: number;
	row: number;
}

/** Weights of the penalties, as the Centred placement of the research weighed them: a family counts once for each child. */
const COUPLE_PULL = 0.03;
const GAP_PULL = 0.01;
/** An only child less than this far from its dot is left where it is (px). */
const SNAP = 0.01;
/** A half: the dot of side-by-side partners is the middle of the two, and the middle of the children is the middle of the first and the last. */
const HALF = 0.5;
/** The walks of one pass visit at most this many blocks for each block of the tree, so the step stays linear on a very deep tree. */
const WALK_BUDGET = 64;
/** An only child's piece pushes at most this many neighbour pieces beside it (they stand at their smallest gap); a bound on the work, not a tuning. */
const TRAIN_MAX = 6;

/**
 * One run of the step. `gaps` holds, for each row and card, the smallest centre distance to the card before it, as the last `placeRow` set it;
 * `dots` holds the x of the dot of each union that has children. Returns how many of the three passes spent their whole walk budget (0 on every real tree).
 * `snaps` limits part (c) to that many snaps: the test of part (c) (`layout-snap`) runs the step again with one more snap each time and
 * reads the move of a single snap from the difference.
 */
type CompactStep = (gaps: number[][], dots: ReadonlyMap<string, number>, snaps?: number) => number;

/** An integer array of `n` places, all `fill`. */
const ints = (n: number, fill = 0): Int32Array => new Int32Array(n).fill(fill);

/**
 * Reads the structure of the placed rows once and returns the step; see the file header. `blocks` are the partners placed together,
 * `rowBlocks` the blocks of each row in order, `families` the children of each family.
 * Exempt from the size rule (an internal test holds its size): 374 code lines and 119 branches (part (c)
 * and the push train grew it). Its parts (a), (b) and (c) share closures over typed arrays that one pass fills, and a split costs the hot path; a split is a later clean-up.
 */
export function compactor(g: FamilyGraph, anchors: ReadonlyMap<string, string>, persons: ReadonlyMap<string, Placed>, blocks: string[][], rowBlocks: number[][], families: string[][], dropInset?: number): CompactStep {
	const nB = blocks.length;
	const R = rowBlocks.length;
	const nF = families.length;
	// Cards in row order, each block's first card, the block of each card and the neighbours of each block. A block is rigid in the shape `placeRow` left it.
	const pid = new Map<string, number>();
	const cards: Placed[] = [];
	const pb: number[] = [];
	const first = ints(nB);
	const lnb = ints(nB, -1);
	const rnb = ints(nB, -1);
	const head = ints(nB, -1);
	const aHead = ints(nB, -1);
	const seen = ints(nB, -1);
	for (const row of rowBlocks) {
		row.forEach((b, k) => {
			first[b] = cards.length;
			for (const name of blocks[b]) {
				pid.set(name, cards.length);
				cards.push(persons.get(name)!);
				pb.push(b);
			}
			if (k) {
				lnb[b] = row[k - 1];
				rnb[row[k - 1]] = b;
			}
		});
	}
	const cx = (p: number) => cards[p].x + cards[p].w / 2;
	const partners = (fu: FamilyUnion) => fu.partners.map((name) => pid.get(name)!);
	const beside = (a: number, b: number) => cards[a].row === cards[b].row && Math.abs(a - b) === 1;

	// The terms: weight × (Σ coefficient × block position + constant)². Each block keeps a list of the entries that name it.
	const eT: number[] = [];
	const eK: number[] = [];
	const eN: number[] = [];
	const tw: number[] = [];
	const lb: number[] = [];
	const lk: number[] = [];
	const add = (b: number, k: number) => {
		const i = lb.indexOf(b);
		if (i < 0) {
			lb.push(b);
			lk.push(k);
		} else lk[i] += k;
	};
	/** Ends the term being built: entries that cancel are dropped, and a term with none left is dropped (-1). */
	const close = (weight: number) => {
		let id = -1;
		lb.forEach((b, i) => {
			if (lk[i] === 0) return;
			if (id < 0) tw.push(weight);
			id = tw.length - 1;
			eN.push(head[b]);
			head[b] = eT.length;
			eT.push(id);
			eK.push(lk[i]);
		});
		lb.length = lk.length = 0;
		return id;
	};
	// A family: its dot, the first and last child, the block it hangs from, and the distinct blocks of its children (in row order, by the sibling order D2).
	const fKey: string[] = [];
	const fPar = ints(nF, -1);
	const fLo = ints(nF + 1);
	const fHi = ints(nF + 1);
	const fKids = ints(nF + 1);
	const fTerm = ints(nF + 1);
	const fAnc = ints(nF + 1);
	const fbPtr = ints(nF + 1);
	const fOne = new Uint8Array(nF);
	const fb: number[] = [];
	const byRow: number[][] = Array.from({ length: R }, () => []);
	families.forEach((kids, f) => {
		const union = g.primaryUnion.get(kids[0]);
		fKey[f] = union ?? '';
		if (union === undefined) {
			const parent = g.placementParents.get(kids[0])![0];
			fKey[f] = soloKey(parent);
			// The trunk hangs from the item the plan names (the parent's card, or a hang passage when the card's edge is full).
			fPar[f] = pid.get(anchors.get(fKey[f]) ?? parent)!;
			add((fAnc[f] = pb[fPar[f]]), 1);
		} else {
			const [a, b] = partners(g.unionByKey.get(union)!);
			if (!beside(a, b) && pb[a] !== pb[b]) add((fAnc[f] = pb[pid.get(anchors.get(union)!)!]), 1);
			else {
				fAnc[f] = pb[beside(a, b) ? Math.min(a, b) : a];
				add(pb[a], HALF);
				add(pb[b], HALF);
			}
		}
		let lo = pid.get(kids[0])!;
		let hi = lo;
		const row0 = cards[lo].row;
		fOne[f] = 1;
		for (const name of kids) {
			const k = pid.get(name)!;
			lo = Math.min(lo, k);
			hi = Math.max(hi, k);
			if (cards[k].row !== row0) fOne[f] = 0;
			if (seen[pb[k]] !== f) {
				seen[pb[k]] = f;
				fb.push(pb[k]);
			}
		}
		fLo[f] = lo;
		fHi[f] = hi;
		fKids[f] = kids.length;
		fbPtr[f + 1] = fb.length;
		byRow[row0].push(f);
		add(pb[lo], -HALF);
		add(pb[hi], -HALF);
		fTerm[f] = close(kids.length);
	});
	// Partners in different blocks, not side by side, pull on each other.
	const couples: [number, number, number][] = [];
	for (const fu of g.unions) {
		const [a, b] = partners(fu);
		if (beside(a, b) || pb[a] === pb[b]) continue;
		add(pb[a], 1);
		add(pb[b], -1);
		couples.push([a, b, close(COUPLE_PULL)]);
	}
	// The families that hang from each block, in family order.
	const aNext = ints(nF);
	for (let f = nF - 1; f >= 0; f--) {
		aNext[f] = aHead[fAnc[f]];
		aHead[fAnc[f]] = f;
	}

	const nT = tw.length;
	const res = new Float64Array(nT);
	// How far the line of an only child may stand from its dot without a bend: a text card (`dropInset` set) takes the drop anywhere between its insets; a Roundel only on its axis.
	const slack = new Float64Array(nT);
	// Families with more than one child: their centring over the children is not a bend, and a push may not make it worse.
	const several = new Uint8Array(nT);
	for (let f = 0; f < nF; f++) {
		if (fTerm[f] < 0) continue;
		if (fKids[f] > 1) several[fTerm[f]] = 1;
		else if (dropInset !== undefined) slack[fTerm[f]] = Math.max(0, cards[fLo[f]].w / 2 - dropInset);
	}
	const acc = new Float64Array(nT);
	const mark = ints(nT);
	const touched = ints(nT);
	// The block positions, their start values, the room between blocks, and the scratch of the pool-adjacent-violators of `upRow`.
	const x = new Float64Array(nB);
	const x0 = new Float64Array(nB);
	const sepL = new Float64Array(nB);
	const ps = new Float64Array(nB);
	const po = new Float64Array(nB);
	const stamp = ints(nB);
	const mem = ints(nB);
	const stack = ints(nB);
	const ends = ints(nB);
	const pc = ints(nB);
	const cap = WALK_BUDGET * nB;
	let nTouched = 0;
	let markId = 0;
	let stampId = 1;
	let spent = 0;

	const move = (b: number, d: number) => {
		x[b] += d;
		for (let n = head[b]; n >= 0; n = eN[n]) res[eT[n]] += eK[n] * d;
	};
	/** Adds the piece of `root` (the block and, as far as it goes, every block that hangs from it) to mem from `m`, stamped `id`; -1 on a block stamped `lo` or later, or when the walk budget is spent. */
	const collect = (root: number, id: number, lo: number, m: number) => {
		let top = 0;
		stack[top++] = root;
		stamp[root] = id;
		// Bounded: every pass of the loop spends one unit of the walk budget `cap`.
		while (top > 0) {
			if (++spent > cap) return -1;
			const b = stack[--top];
			mem[m++] = b;
			for (let f = aHead[b]; f >= 0; f = aNext[f]) {
				for (let z = fbPtr[f]; z < fbPtr[f + 1]; z++) {
					const c = fb[z];
					if (stamp[c] === id) continue;
					if (stamp[c] >= lo) return -1;
					stamp[c] = id;
					stack[top++] = c;
				}
			}
		}
		return m;
	};
	// The terms that cross the edge of mem[0..m): the sum of the coefficients of their entries inside it is not 0.
	const sums = (a: number, e: number) => {
		nTouched = 0;
		markId++;
		for (let q = a; q < e; q++) {
			for (let n = head[mem[q]]; n >= 0; n = eN[n]) {
				const k = eT[n];
				if (mark[k] !== markId) {
					mark[k] = markId;
					acc[k] = 0;
					touched[nTouched++] = k;
				}
				acc[k] += eK[n];
			}
		}
	};
	/** Moves mem[a..e) by d; only the terms that cross the edge change. */
	const shift = (a: number, e: number, d: number) => {
		if (d === 0) return;
		sums(a, e);
		for (let q = a; q < e; q++) x[mem[q]] += d;
		for (let i = 0; i < nTouched; i++) res[touched[i]] += acc[touched[i]] * d;
	};
	// The row above is centred over its children: each block follows the child-count-weighted mean of its families' residuals, then the row is packed by pool adjacent violators.
	const upRow = (r: number) => {
		const row = rowBlocks[r];
		row.forEach((b, k) => {
			let sum = 0;
			let weight = 0;
			for (let f = aHead[b]; f >= 0; f = aNext[f]) {
				if (fTerm[f] < 0) continue;
				sum -= fKids[f] * res[fTerm[f]];
				weight += fKids[f];
			}
			po[k] = k ? po[k - 1] + sepL[b] : 0;
			ps[k] = (weight ? x[b] + sum / weight : x[b]) - po[k];
		});
		let top = -1;
		for (let i = 0; i < row.length; i++) {
			ps[++top] = ps[i];
			pc[top] = 1;
			// Bounded: every pass joins two groups, so `top` falls.
			while (top > 0 && !(ps[top - 1] / pc[top - 1] <= ps[top] / pc[top])) {
				ps[top - 1] += ps[top];
				pc[top - 1] += pc[top];
				top--;
			}
		}
		for (let s = 0, k = 0; s <= top; s++) for (let c = 0; c < pc[s]; c++, k++) move(row[k], ps[s] / pc[s] + po[k] - x[row[k]]);
	};
	/** Moves a block with everything that hangs from it to the exact minimum of the penalties it changes. */
	const piece = (root: number) => {
		const l0 = lnb[root];
		const r0 = rnb[root];
		if (l0 >= 0 && r0 >= 0 && x[root] - x[l0] - sepL[root] <= 0 && x[r0] - x[root] - sepL[r0] <= 0) return;
		const id = stampId++;
		const m = collect(root, id, Infinity, 0);
		if (m < 0) return;
		sums(0, m);
		let grad = 0;
		let curv = 0;
		let roomL = Infinity;
		let roomR = Infinity;
		for (let q = 0; q < m; q++) {
			const b = mem[q];
			if (lnb[b] >= 0 && stamp[lnb[b]] !== id) {
				const e = x[b] - x[lnb[b]] - sepL[b];
				grad += 2 * GAP_PULL * e;
				curv += 2 * GAP_PULL;
				roomL = Math.min(roomL, e);
			}
			if (rnb[b] >= 0 && stamp[rnb[b]] !== id) {
				const e = x[rnb[b]] - x[b] - sepL[rnb[b]];
				grad -= 2 * GAP_PULL * e;
				curv += 2 * GAP_PULL;
				roomR = Math.min(roomR, e);
			}
		}
		for (let i = 0; i < nTouched; i++) {
			const k = touched[i];
			grad += 2 * tw[k] * res[k] * acc[k];
			curv += 2 * tw[k] * acc[k] * acc[k];
		}
		if (curv !== 0) shift(0, m, Math.max(-Math.max(0, roomL), Math.min(Math.max(0, roomR), -grad / curv)));
	};
	// What `reach` finds out about the group mem[0..m): the room beside it on each side (to the nearest outer neighbour's smallest gap) and the block that sets each room.
	let roomL = Infinity;
	let roomR = Infinity;
	let blockL = Infinity;
	let blockR = Infinity;
	const reach = (m: number, id: number) => {
		roomL = roomR = Infinity;
		blockL = blockR = Infinity;
		for (let q = 0; q < m; q++) {
			const p = mem[q];
			// The block that sets a room: the nearest; neighbours within TIE of each other count as equally near and the lower block number wins, so a round-off never picks another.
			if (lnb[p] >= 0 && stamp[lnb[p]] !== id) {
				const e = x[p] - x[lnb[p]] - sepL[p];
				if (e < roomL - TIE || (e <= roomL + TIE && lnb[p] < blockL)) blockL = lnb[p];
				roomL = Math.min(roomL, e);
			}
			if (rnb[p] >= 0 && stamp[rnb[p]] !== id) {
				const e = x[rnb[p]] - x[p] - sepL[rnb[p]];
				if (e < roomR - TIE || (e <= roomR + TIE && rnb[p] < blockR)) blockR = rnb[p];
				roomR = Math.min(roomR, e);
			}
		}
	};
	/**
	 * How much better the lines get when the group mem[0..m) moves by `d`: the fall of the sum of the distances of the only children from their dots
	 * (the distance an only child's drop absorbs is not counted) and, by their small weight, of partners from each other. Negative infinity when
	 * a family that stands straight would stand off its dot (a new bend) or a family of several children would be centred worse.
	 */
	const gain = (m: number, d: number) => {
		sums(0, m);
		let better = 0;
		for (let i = 0; i < nTouched; i++) {
			const k = touched[i];
			const before = Math.max(0, Math.abs(res[k]) - slack[k]);
			const after = Math.max(0, Math.abs(res[k] + acc[k] * d) - slack[k]);
			if (several[k] ? after > before + TIE : before < SNAP && after >= SNAP) return -Infinity;
			if (!several[k]) better += (tw[k] < 1 ? tw[k] : 1) * (before - after);
		}
		return better;
	};
	/**
	 * Part (c) for one only child: its piece moves by the child's residual `res[term]`, as far as the room beside it allows. A neighbour at its
	 * smallest gap that is in the way is pushed with everything that hangs from it (up to `TRAIN_MAX` pieces), but only when the lines are no worse
	 * for it (`gain`: the bends are no longer in sum, one fewer when the child reaches its dot, and no straight line gets a bend). If that is not so, or the room does not reach the dot,
	 * the piece moves alone as far as its own room goes.
	 */
	const snapTrain = (term: number, root: number) => {
		const id = stampId++;
		const own = collect(root, id, Infinity, 0);
		if (own < 0) return;
		const want = res[term];
		const clamped = () => Math.max(-Math.max(0, roomL), Math.min(Math.max(0, roomR), want));
		reach(own, id);
		const alone = clamped();
		let m = own;
		if (Math.abs(alone - want) > TIE) {
			// The room beside the piece is short of the dot: take in the neighbour in the way, then the one in the way of that, until the room is enough.
			for (let pushed = 0; pushed < TRAIN_MAX; pushed++) {
				const room = want > 0 ? roomR : roomL;
				const block = want > 0 ? blockR : blockL;
				if (room >= Math.abs(want) - TIE || block === Infinity) break;
				const more = collect(block, id, Infinity, m);
				if (more < 0) break;
				m = more;
				reach(m, id);
			}
			const d = clamped();
			if (m > own && Math.abs(d) > Math.abs(alone) + TIE && gain(m, d) >= (Math.abs(d - want) <= TIE ? -TIE : TIE)) {
				shift(0, m, d);
				return;
			}
		}
		shift(0, own, alone);
	};
	/** Runs one pass with a fresh walk budget; 1 when the budget ran out. */
	const pass = (run: () => void) => {
		spent = 0;
		run();
		return spent > cap ? 1 : 0;
	};

	return (gaps, dots, snaps = Infinity) => {
		// What changes from round to round: the block positions, the room between blocks and the residual of each term.
		rowBlocks.forEach((row, r) => {
			row.forEach((b, k) => {
				x[b] = cx(first[b]);
				if (k) sepL[b] = cx(first[b] - 1) - x[row[k - 1]] + gaps[r][first[b] - first[row[0]]];
			});
		});
		families.forEach((_, f) => {
			if (fTerm[f] >= 0) res[fTerm[f]] = (fPar[f] >= 0 ? (dots.get(fKey[f]) ?? cx(fPar[f])) : dots.get(fKey[f])!) - (cx(fLo[f]) + cx(fHi[f])) / 2;
		});
		for (const [a, b, k] of couples) if (k >= 0) res[k] = cx(a) - cx(b);
		x0.set(x);

		// (a) Each family's children close ranks and centre under their dot; the row above is centred over its children.
		const closeRanks = () => {
			for (let r = R - 1; r >= 1; r--) {
				for (const f of byRow[r]) {
					const a = fbPtr[f];
					const nb = fbPtr[f + 1] - a;
					if (nb < 2 || !fOne[f]) continue;
					const lo = stampId;
					let m = 0;
					for (let j = 0; j < nb && m >= 0; j++) ends[j] = m = collect(fb[a + j], stampId++, lo, m);
					if (m < 0) continue;
					for (let j = 1, from = ends[0]; j < nb; from = ends[j++]) {
						let room = Infinity;
						for (let q = from; q < ends[j]; q++) {
							const l = lnb[mem[q]];
							if (l >= 0 && stamp[l] !== lo + j) room = Math.min(room, x[mem[q]] - x[l] - sepL[mem[q]]);
						}
						shift(from, ends[j], room === Infinity ? 0 : -Math.max(0, room));
					}
					if (fTerm[f] < 0) continue;
					const want = res[fTerm[f]];
					let room = Infinity;
					for (let q = 0; q < m; q++) {
						const b = mem[q];
						const nbr = want > 0 ? rnb[b] : lnb[b];
						if (nbr >= 0 && stamp[nbr] < lo) room = Math.min(room, want > 0 ? x[nbr] - x[b] - sepL[nbr] : x[b] - x[nbr] - sepL[b]);
					}
					shift(0, m, want > 0 ? Math.min(want, Math.max(0, room)) : -Math.min(-want, Math.max(0, room)));
				}
				upRow(r - 1);
			}
		};
		// (b) Each block with everything that hangs from it moves, as one piece, to the exact minimum of the penalties it changes: rows from the bottom, then from the top.
		const spentPasses = pass(closeRanks) + pass(() => [...rowBlocks].reverse().forEach((row) => row.forEach(piece))) + pass(() => rowBlocks.forEach((row) => row.forEach(piece)));

		// (c) An only child goes under its dot where the room allows, rows top first, with everything that hangs below it as one piece,
		// so no family of the piece is left behind (D238: "an only child moved away from its own children"). The families above the piece (the parents of a married-in member)
		// may lose, as today. Where the neighbours stand at their smallest gap, the piece may push them (`snapTrain`).
		let snapsLeft = snaps;
		for (const list of byRow) {
			for (const f of list) {
				if (snapsLeft <= 0) break;
				if (fKids[f] !== 1 || fTerm[f] < 0 || Math.abs(res[fTerm[f]]) < SNAP) continue;
				snapTrain(fTerm[f], pb[fLo[f]]);
				snapsLeft--;
			}
		}
		cards.forEach((c, p) => (c.x += x[pb[p]] - x0[pb[p]]));
		return spentPasses;
	};
}
