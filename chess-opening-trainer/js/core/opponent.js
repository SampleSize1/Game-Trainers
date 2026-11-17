// The opponent: which move it plays. No page code.
//
// Three opponents, from the one who never slips to the one who slips often:
//   master    plays sound theory while the opening book lasts, then the engine's best moves
//   club      knows a fair amount of theory, including some dubious lines, and makes the odd mistake
//   beginner  leaves theory early and often, and blunders
//
// A weaker opponent's mistakes are real ones: the engine scores every legal move, and the opponent
// picks from the inaccurate, mistaken or blundering ones as often as its level says. People go wrong
// with natural-looking moves (a developing move that leaves something hanging, a capture that doesn't
// work), so a mistake has to be a move a person would play: when the only bad moves on offer are
// bizarre ones, the opponent plays a sound move this turn instead.
import { Chess } from '../vendor/chess.js';
import { lossOf } from './judge.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };

// (Each one's name and description: 'level.<id>' and 'level_hint.<id>' in ../text.js.)
export const OPPONENTS = [
	{
		id: 'beginner',
		book: 0.5, // how often it plays a book move when there is one
		bookLoss: 300, // the worst book move it will play (centipawns given up)
		mix: { good: 0.44, inaccuracy: 0.22, mistake: 0.2, blunder: 0.14 },
		natural: 0.5, // how natural a move must look (plausibility) for it to be this opponent's mistake
		sees: 0.35, // how much less often it puts a piece where it can simply be taken
	},
	{
		id: 'club',
		book: 0.85,
		bookLoss: 150,
		mix: { good: 0.6, inaccuracy: 0.2, mistake: 0.14, blunder: 0.06 },
		natural: 0.9,
		sees: 0.12,
	},
	{
		id: 'master',
		book: 1,
		bookLoss: 55,
		mix: { good: 1, inaccuracy: 0, mistake: 0, blunder: 0 },
		within: 1.5, // out of book: only moves this close to the engine's best (winning chances)
	},
];
export const opponent = (id) => OPPONENTS.find((o) => o.id === id) || OPPONENTS[1];

/** One item of a list, chosen with the given weights. `rng` returns a number from 0 up to 1. */
export function weighted(items, weight, rng) {
	const weights = items.map(weight);
	const total = weights.reduce((a, b) => a + b, 0);
	if (!(total > 0)) return items[Math.floor(rng() * items.length)];
	let at = rng() * total;
	for (let i = 0; i < items.length; i++) {
		at -= weights[i];
		if (at < 0) return items[i];
	}
	return items[items.length - 1];
}

/**
 * A move from the opening book for this opponent, or null when it leaves the book here
 * (there is no theory, none of it is good enough for this opponent, or it chose to go its own way).
 * entry: the book's entry for the position (book.at(fen)). always: don't choose to leave the book.
 */
export function bookMove(entry, level, rng, always = false) {
	if (!entry || !entry.moves.length) return null;
	const who = opponent(level);
	if (!always && rng() >= who.book) return null;
	const playable = entry.moves.filter((m) => m.loss <= who.bookLoss);
	if (!playable.length) return null;
	// The more named lines follow a move, the more it is played (1.e4 about four games in nine, 1.d4 three,
	// the rest shared out); a move that costs more is played less
	return weighted(playable, (m) => m.lines ** 0.75 * (1 - m.loss / (who.bookLoss * 2)), rng);
}

/** How good or bad a move is for the side making it, by the winning chances it gives up */
export function category(loss) {
	if (loss >= 20) return 'blunder';
	if (loss >= 10) return 'mistake';
	if (loss >= 4) return 'inaccuracy';
	return 'good';
}

/**
 * How likely a person is to play a move, as a weight: natural moves count for more.
 * move: a chess.js move ({ piece, from, to, flags, san, color }).
 */
export function plausibility(move) {
	let w = 1;
	const home = move.color === 'w' ? '1' : '8';
	const capture = move.flags.includes('c') || move.flags.includes('e');
	const castles = move.flags.includes('k') || move.flags.includes('q');
	const early = Number(move.before.split(' ')[5]) <= 12;
	if (capture) w *= 2.2;
	if (move.san.includes('+')) w *= 1.4;
	if (castles) w *= 2.5;
	// bringing a knight or bishop out
	if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === home && move.to[1] !== home) w *= 2;
	if (move.piece === 'p') {
		// a centre pawn; a wing pawn, and less so two squares at once
		if ('cdef'.includes(move.to[0])) w *= 1.4;
		else w *= Math.abs(Number(move.to[1]) - Number(move.from[1])) === 2 ? 0.6 : 0.9;
	}
	// walking the king, or putting a piece back on the back rank, is rarely anyone's idea
	if (move.piece === 'k' && !castles && !capture) w *= 0.15;
	if (move.piece !== 'k' && move.piece !== 'r' && move.piece !== 'p' && move.from[1] !== home && move.to[1] === home && !capture) w *= 0.35;
	// knights on the rim, rooks shuffling about in the opening, the queen wandering
	if (move.piece === 'n' && 'ah'.includes(move.to[0]) && !capture) w *= 0.6;
	if (move.piece === 'r' && early && !capture) w *= 0.3;
	if (move.piece === 'q' && !capture) w *= 0.8;
	return w;
}

/** Does the move put the piece where it can simply be taken: attacked, and undefended or worth more than its attacker? */
export function hangs(move) {
	if (move.piece === 'k') return false;
	const worth = VALUE[move.promotion || move.piece];
	if (move.captured && VALUE[move.captured] >= worth) return false; // a trade, not a gift
	const after = new Chess(move.after);
	const attackers = after.attackers(move.to, after.turn());
	if (!attackers.length) return false;
	const cheapest = Math.min(...attackers.map((sq) => VALUE[after.get(sq).type]));
	return after.attackers(move.to, move.color).length === 0 || cheapest < worth;
}

/**
 * A move from the engine's scores for every legal move.
 * scored: [{ uci, cp }] (centipawns for the side to move), in any order.
 * moves: the position's legal moves from chess.js (verbose), to judge how natural each is.
 * Returns { uci, cp, loss, category } (loss: winning chances given up against the best move).
 */
export function engineMove(scored, moves, level, rng) {
	const who = opponent(level);
	const best = Math.max(...scored.map((s) => s.cp));
	const byUci = new Map(moves.map((m) => [m.lan, m]));
	const options = scored.map((s) => {
		const loss = lossOf(best, s.cp);
		return { uci: s.uci, cp: s.cp, loss, category: category(loss), move: byUci.get(s.uci) };
	});

	// The kind of move this turn. If no move of that kind looks natural here, a milder kind.
	const order = ['good', 'inaccuracy', 'mistake', 'blunder'];
	const want = weighted(order, (k) => who.mix[k], rng);
	const looks = (o) => (o.move ? plausibility(o.move) : 1);
	let pool = [];
	for (let k = order.indexOf(want); k >= 0 && !pool.length; k--) {
		pool = options.filter((o) => o.category === order[k] && (k === 0 || looks(o) >= (who.natural || 0)));
	}
	if (who.within != null) pool = pool.filter((o) => o.loss <= who.within);
	const pick = weighted(
		pool,
		(o) => {
			if (who.within != null) return Math.exp(-o.loss * 2);
			let w = looks(o);
			// the cruder the error, the rarer: people mostly see that a square is covered
			if (o.category !== 'good' && o.move && hangs(o.move)) w *= who.sees;
			// among good moves the better ones are played more; a blunder that loses everything at once less
			if (o.category === 'good') w *= Math.exp(-o.loss / 2);
			if (o.loss > 60) w *= 0.4;
			return w;
		},
		rng,
	);
	return { uci: pick.uci, cp: pick.cp, loss: pick.loss, category: pick.category };
}
