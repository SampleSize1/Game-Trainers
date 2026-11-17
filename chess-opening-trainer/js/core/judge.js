// Judging a move: how much it gives up against the best move, and whether that stops the run.
// No page code. (Its words are in ../text.js.)
import { t } from '../text.js';
//
// Engines score a position in centipawns (hundredths of a pawn). A hundred centipawns matter a lot
// in an equal position and hardly at all when one side is a queen up, so moves are compared by the
// chance of winning instead, the way Lichess and Chess.com grade moves.

export const MATE = 10000; // a forced mate in n is scored MATE - n (or n - MATE when you are the one mated)

export const isMate = (cp) => Math.abs(cp) >= MATE - 200;
/** Moves until mate for a mate score; positive when the side the score belongs to gives it */
export const mateIn = (cp) => (cp > 0 ? MATE - cp : -(MATE + cp));

/** The chance of winning, 0 to 100, for the side a centipawn score belongs to (Lichess's curve) */
export function winChance(cp) {
	if (isMate(cp)) return cp > 0 ? 100 : 0;
	return 100 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp))));
}

/** What a move gave up: the winning chances after the best move less those after the move played */
export const lossOf = (bestCp, playedCp) => Math.max(0, winChance(bestCp) - winChance(playedCp));

// How strict the trainer is: a move that gives up at least `stop` points of winning chance ends the run.
// Near an equal position 5 points is about half a pawn, 10 about a pawn, 20 about two and a half.
// (Each one's name and description: 'strict.<id>' and 'strict_hint.<id>' in ../text.js.)
export const STRICTNESS = [
	{ id: 'relaxed', stop: 20 },
	{ id: 'standard', stop: 10 },
	{ id: 'strict', stop: 5 },
];
export const strictness = (id) => STRICTNESS.find((s) => s.id === id) || STRICTNESS[1];

// A move that is known theory is only stopped when it is a real mistake, however strict the setting:
// respectable openings (the King's Indian, the Dutch, the King's Gambit) cost a third to two thirds of
// a pawn by the engine's count, and are played at every level all the same.
export const BOOK_STOP = 10;
// An opponent's move that hands you this much is a chance you are expected to take...
export const OPPORTUNITY = 10;
// ...and the bar for your reply is lower by this factor: at the usual setting, a reply that lets a
// clean pawn go (about 9 points) counts as a missed chance, where a 9-point slip in a level
// position would pass.
export const CHANCE_FACTOR = 0.7;

export function grade(loss) {
	if (loss >= 20) return 'blunder';
	if (loss >= 10) return 'mistake';
	if (loss >= 5) return 'inaccuracy';
	return 'good';
}

/**
 * Does this move end the run? `book`: the move is known theory. `chance`: the opponent has just
 * slipped and there is something to take.
 */
export function stops(loss, strictId, book = false, chance = false) {
	const limit = strictness(strictId).stop * (chance ? CHANCE_FACTOR : 1);
	return loss >= (book ? Math.max(limit, BOOK_STOP) : limit);
}

/** A score as chess players write it: +0.3, −2.1, M3 (mate in three for the side it belongs to), −M2 */
export function formatEval(cp) {
	if (isMate(cp)) return (cp > 0 ? 'M' : '−M') + Math.abs(mateIn(cp));
	const pawns = Math.abs(cp) / 100;
	if (pawns < 0.05) return '0.0';
	return (cp > 0 ? '+' : '−') + pawns.toFixed(1);
}

/** The same score in plain words, from the point of view of the side it belongs to */
export function describeEval(cp) {
	if (isMate(cp)) return t(cp > 0 ? 'eval.mating' : 'eval.mated');
	const a = Math.abs(cp);
	if (a < 35) return t('eval.equal');
	if (a < 90) return t(cp > 0 ? 'eval.slightly_better' : 'eval.slightly_worse');
	if (a < 200) return t(cp > 0 ? 'eval.clearly_better' : 'eval.clearly_worse');
	if (a < 500) return t(cp > 0 ? 'eval.winning' : 'eval.losing');
	return t(cp > 0 ? 'eval.completely_winning' : 'eval.completely_lost');
}
