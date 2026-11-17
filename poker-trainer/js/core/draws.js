/* Draws: counting outs, and the two percentages a call comes down to. No page code. */
import { strength, RANK_LABELS, suitName } from './cards.js';
import { t, language } from '../text.js';

// (each one's name and how its outs add up: 'draw.<kind>' and 'draw_note.<kind>' in ../text.js)
export const DRAWS = {
	gutshot: { outs: 4 },
	oesd: { outs: 8 },
	double: { outs: 8 },
	flush: { outs: 9 },
	'flush+gutshot': { outs: 12 },
	'flush+oesd': { outs: 15 },
};
export const OUT_COUNTS = [4, 8, 9, 12, 15];

/**
 * The cards that would complete a straight or flush for `hole` on `board` (3 or 4 cards).
 * Returns null unless it's a clean draw to drill: nothing made yet (not even a pair), the flush
 * draw uses both hole cards, and no out makes the hand on the board alone. Otherwise
 * { kind, total, flush: [cards], straight: [cards], both: [cards], straightRanks, suit }.
 */
export function readDraw(hole, board) {
	const seen = [...hole, ...board];
	if (strength(seen) >> 20 !== 0) return null;
	const suitCount = [0, 0, 0, 0];
	for (const c of board) suitCount[c & 3]++;
	if (Math.max(...suitCount) > 2) return null;
	const flushSuit = (hole[0] & 3) === (hole[1] & 3) && suitCount[hole[0] & 3] === 2 ? hole[0] & 3 : -1;

	const taken = new Set(seen);
	const flush = [];
	const straightRanks = new Set();
	for (let c = 0; c < 52; c++) {
		if (taken.has(c)) continue;
		const cat = strength([...seen, c]) >> 20;
		if (cat !== 4 && cat !== 5 && cat !== 8) continue;
		if (board.length === 4 && strength([...board, c]) >> 20 >= 4) return null;
		if ((c & 3) === flushSuit) flush.push(c);
		if (cat === 4) straightRanks.add(c >> 2);
	}
	// a card of the flush suit can complete the straight too: find the ranks from the other suits
	const ranks = [...straightRanks].sort((a, b) => a - b);
	if (ranks.length > 2) return null;
	const straight = [];
	for (let c = 0; c < 52; c++) if (!taken.has(c) && straightRanks.has(c >> 2)) straight.push(c);
	const both = straight.filter((c) => (c & 3) === flushSuit);
	const total = flush.length + straight.length - both.length;

	// four in a row already (the ace can sit below the two)? Then it's open-ended, or one-ended
	let have = 0;
	for (const c of seen) have |= 1 << (c >> 2);
	const has = (r) => (have >> (r < 0 ? 12 : r)) & 1;
	let fourInARow = false;
	for (let lo = -1; lo <= 9; lo++) if (has(lo) && has(lo + 1) && has(lo + 2) && has(lo + 3)) fourInARow = true;
	let run = '';
	if (ranks.length === 1) {
		if (fourInARow) return null; // A-2-3-4 or J-Q-K-A: one end only, a rarer case left out
		run = 'gutshot';
	} else if (ranks.length === 2) run = fourInARow ? 'oesd' : 'double';
	const kind = flush.length && run ? 'flush+' + run : flush.length ? 'flush' : run;
	if (!DRAWS[kind] || DRAWS[kind].outs !== total) return null;
	return { kind, total, flush, straight, both, straightRanks: ranks, suit: flushSuit };
}

/** The count spelled out: "9 hearts make your flush. Any 9 or ace makes your straight (8 cards)..." */
export function explainDraw(d) {
	const parts = [];
	if (d.flush.length) parts.push(t('flush_left', { n: d.flush.length, suit: suitName(d.suit) }));
	if (d.straight.length) {
		const names = d.straightRanks.map((r) => RANK_LABELS[r]).reverse();
		parts.push(t('straight_any', { ranks: language().join(names, 'or'), n: d.straight.length }));
	}
	if (d.both.length) {
		parts.push(t('counted_twice', { n: d.both.length, flush: d.flush.length, straight: d.straight.length, both: d.both.length, total: d.total }));
	}
	return parts.join(' ');
}

/** The exact chance of hitting one of `outs` cards with 1 or 2 cards to come, 0..1. */
export function hitChance(outs, toCome) {
	const unseen = toCome === 2 ? 47 : 46; // 52 minus your two cards and the board
	if (toCome === 1) return outs / unseen;
	const miss = ((unseen - outs) * (unseen - outs - 1)) / (unseen * (unseen - 1));
	return 1 - miss;
}
/** The rule of 2 and 4: outs × 2 with one card to come, × 4 with two. A percentage. */
export const ruleOfThumb = (outs, toCome) => outs * (toCome === 2 ? 4 : 2);
/** The share of the time a call has to win to break even: the call over the pot after you call. 0..1. */
export const priceOfCall = (pot, bet) => bet / (pot + 2 * bet);

/** The bet sizes drilled, as a share of the pot, and what each one needs (a whole percentage). */
export const BET_SIZES = [
	// (each one in words: 'size.<id>' in ../text.js)
	{ id: 'quarter', of: 1 / 4 },
	{ id: 'third', of: 1 / 3 },
	{ id: 'half', of: 1 / 2 },
	{ id: 'twothirds', of: 2 / 3 },
	{ id: 'pot', of: 1 },
	{ id: 'double', of: 2 },
].map((b) => ({ ...b, needs: Math.round(100 * priceOfCall(1, b.of)) }));
