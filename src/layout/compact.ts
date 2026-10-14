/**
 * The added step of the placement (spec §5.1 step 4, D231): after today's sweeps it closes the empty space between sibling groups.
 * Three parts, each with a fixed amount of work and no tolerance: (a) each sibling group with everything that hangs below it moves
 * left as far as the smallest gaps allow, then centres under its dot; (b) one pass up and one pass down in which every block with
 * everything below it moves, as one piece, to the smallest total of three penalties (children off their dot, gaps wider than the
 * smallest gap, partners far apart), never past the order or a smallest gap; (c) an only child goes under its dot where the room allows.
 * `compactor` reads the structure of the layout once (blocks, families, the terms of the penalties); the function it returns
 * runs the step again on the cards as `placeRow` left them, and moves the cards in place. The order of a row and the smallest
 * gaps never change, so the sibling order (D2) stays.
 */
import type { FamilyGraph, FamilyUnion } from '../core/derive';
import type { PersonBox, UnionPoint } from './model';

/** Weights of the penalties, as the Centred placement of the research weighed them: a family counts once for each child. */
const COUPLE_PULL = 0.03;
const GAP_PULL = 0.01;
/** An only child less than this far from its dot is left where it is (px). */
const SNAP = 0.01;
/** The walks of one pass visit at most this many blocks for each block of the tree, so the step stays linear on a very deep tree. */
const WALK_BUDGET = 64;

/**
 * One run of the step. `gaps` holds, for each row and card, the smallest centre distance to the card before it, as the last `placeRow` set it;
 * `dots` holds the dots of the unions that have children. Returns how many of the three passes spent their whole walk budget (0 on every real tree).
 */
export type CompactStep = (gaps: number[][], dots: ReadonlyMap<string, UnionPoint>) => number;

/**
 * Reads the structure of the placed rows once and returns the step; see the file header. `blocks` are the partners placed together,
 * `rowBlocks` the blocks of each row in order, `families` the children of each family, `attach` where a child's axis lies in its card.
 */
export function compactor(g: FamilyGraph, anchors: ReadonlyMap<string, string>, persons: ReadonlyMap<string, PersonBox>, blocks: string[][], rowBlocks: number[][], families: string[][], attach: number): CompactStep {
	const nB = blocks.length;
	const R = rowBlocks.length;
	const nF = families.length;
	// Cards in row order, each block's first card, the block of each card and the neighbours of each block. A block is rigid in the shape `placeRow` left it.
	const pid = new Map<string, number>();
	const cards: PersonBox[] = [];
	const pb: number[] = [];
	const first = new Int32Array(nB);
	const [lnb, rnb, head, aHead, seen] = Array.from({ length: 5 }, () => new Int32Array(nB).fill(-1));
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
	const beside = (a: number, b: number) => cards[a].gen === cards[b].gen && Math.abs(a - b) === 1;

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
	const fPar = new Int32Array(nF).fill(-1);
	const [fLo, fHi, fKids, fTerm, fAnc, fbPtr] = Array.from({ length: 6 }, () => new Int32Array(nF + 1));
	const fOne = new Uint8Array(nF);
	const fb: number[] = [];
	const byRow: number[][] = Array.from({ length: R }, () => []);
	families.forEach((kids, f) => {
		const union = g.primaryUnion.get(kids[0]);
		fKey[f] = union ?? '';
		if (union === undefined) {
			fPar[f] = pid.get(g.placementParents.get(kids[0])![0])!;
			add((fAnc[f] = pb[fPar[f]]), 1);
		} else {
			const [a, b] = partners(g.unionByKey.get(union)!);
			if (!beside(a, b) && pb[a] !== pb[b]) add((fAnc[f] = pb[pid.get(anchors.get(union)!)!]), 1);
			else {
				fAnc[f] = pb[beside(a, b) ? Math.min(a, b) : a];
				add(pb[a], 0.5);
				add(pb[b], 0.5);
			}
		}
		let lo = pid.get(kids[0])!;
		let hi = lo;
		const row0 = cards[lo].gen;
		fOne[f] = 1;
		for (const name of kids) {
			const k = pid.get(name)!;
			lo = Math.min(lo, k);
			hi = Math.max(hi, k);
			if (cards[k].gen !== row0) fOne[f] = 0;
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
		add(pb[lo], -0.5);
		add(pb[hi], -0.5);
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
	const aNext = new Int32Array(nF);
	for (let f = nF - 1; f >= 0; f--) {
		aNext[f] = aHead[fAnc[f]];
		aHead[fAnc[f]] = f;
	}

	const nT = tw.length;
	const res = new Float64Array(nT);
	const acc = new Float64Array(nT);
	const [mark, touched] = Array.from({ length: 2 }, () => new Int32Array(nT));
	const [x, x0, sepL, ps, po] = Array.from({ length: 5 }, () => new Float64Array(nB));
	const [stamp, mem, stack, ends, pc] = Array.from({ length: 5 }, () => new Int32Array(nB));
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
	/** Runs one pass with a fresh walk budget; 1 when the budget ran out. */
	const pass = (run: () => void) => {
		spent = 0;
		run();
		return spent > cap ? 1 : 0;
	};

	return (gaps, dots) => {
		// What changes from round to round: the block positions, the room between blocks and the residual of each term.
		rowBlocks.forEach((row, r) => {
			row.forEach((b, k) => {
				x[b] = cx(first[b]);
				if (k) sepL[b] = cx(first[b] - 1) - x[row[k - 1]] + gaps[r][first[b] - first[row[0]]];
			});
		});
		families.forEach((_, f) => {
			if (fTerm[f] >= 0) res[fTerm[f]] = (fPar[f] >= 0 ? cx(fPar[f]) : dots.get(fKey[f])!.x) - (cx(fLo[f]) + cx(fHi[f])) / 2 - attach;
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

		// (c) An only child goes under its dot where the room beside it allows (never a push), rows top first.
		for (const list of byRow) {
			for (const f of list) {
				if (fKids[f] !== 1 || fTerm[f] < 0 || Math.abs(res[fTerm[f]]) < SNAP) continue;
				const b = pb[fLo[f]];
				const left = lnb[b] < 0 ? Infinity : x[b] - x[lnb[b]] - sepL[b];
				const right = rnb[b] < 0 ? Infinity : x[rnb[b]] - x[b] - sepL[rnb[b]];
				move(b, Math.max(-left, Math.min(right, res[fTerm[f]])));
			}
		}
		cards.forEach((c, p) => (c.x += x[pb[p]] - x0[pb[p]]));
		return spentPasses;
	};
}
