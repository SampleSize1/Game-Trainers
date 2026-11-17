// Explaining a mistake in plain words, from the engine's lines. No page code.
//
// The engine gives two things for the position where the run stopped: the line it expects after the
// move that was played, and the line after the move it prefers. From those this file works out what
// can be said safely: a checkmate, material won or lost by the end of the line, or (when nothing
// concrete happens) how far the evaluation moved, plus a fact or two about what the better move does.
// It is a description of the engine's lines, not a coach: it never guesses at a plan. Its sentences are in ../text.js.
import { Chess } from '../vendor/chess.js';
import { isMate, mateIn, formatEval, describeEval } from './judge.js';
import { t, language } from '../text.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const pieceName = (type) => t('piece.' + type);
const HOME_MINORS = { w: ['b1', 'g1', 'c1', 'f1'], b: ['b8', 'g8', 'c8', 'f8'] };

const split = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** Plays a line of UCI moves from a position: [{ uci, san, color, piece, captured, before, after, number }] */
export function playLine(fen, ucis) {
	const chess = new Chess(fen);
	const out = [];
	for (const uci of ucis) {
		let move;
		try {
			move = chess.move(split(uci));
		} catch {
			break; // an engine line can run past the end of the game
		}
		out.push({
			uci,
			san: move.san,
			color: move.color,
			piece: move.piece,
			captured: move.captured || null,
			before: move.before,
			after: move.after,
			number: Number(move.before.split(' ')[5]),
		});
	}
	return out;
}

/** A move with its number, as in a scoresheet: "8.c3" for White, "7...Qa5+" for Black */
export const numbered = (m) => m.number + (m.color === 'w' ? '.' : '...') + m.san;

/** A line as text: "7...Qa5+ 8.c3 Qxe5" */
export function lineText(line) {
	return line.map((m, i) => (m.color === 'w' || i === 0 ? numbered(m) : m.san)).join(' ');
}

function census(fen) {
	const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
	for (const ch of fen.split(' ')[0]) {
		const type = ch.toLowerCase();
		if (type in VALUE) counts[ch === type ? 'b' : 'w'][type]++;
	}
	return counts;
}

/**
 * What a line wins or loses for `side` by the time the dust settles: the first six moves of it
 * (the far end of an engine's line is guesswork), and on through any captures still being traded,
 * so that a piece taken at the end and about to be taken back isn't counted as won. { mine: ['n'], theirs: ['p'], net: -2 }: pieces
 * each side has lost (a knight for a pawn), like for like cancelled out, and the balance in pawns.
 */
export function material(line, side) {
	if (!line.length) return { mine: [], theirs: [], net: 0 };
	let end = Math.min(line.length, 6);
	// a trade isn't over while the next move, or the one after a quiet move in between, is a capture
	while (end < line.length) {
		if (line[end].captured) end++;
		else if (end + 1 < line.length && line[end + 1].captured) end += 2;
		else break;
	}
	const start = census(line[0].before);
	const finish = census(line[end - 1].after);
	const other = side === 'w' ? 'b' : 'w';
	const mine = [];
	const theirs = [];
	for (const type of ['q', 'r', 'b', 'n', 'p']) {
		const lostMine = Math.max(0, start[side][type] - finish[side][type]);
		const lostTheirs = Math.max(0, start[other][type] - finish[other][type]);
		const even = Math.min(lostMine, lostTheirs);
		for (let i = even; i < lostMine; i++) mine.push(type);
		for (let i = even; i < lostTheirs; i++) theirs.push(type);
	}
	const sum = (list) => list.reduce((n, type) => n + VALUE[type], 0);
	return { mine, theirs, net: sum(theirs) - sum(mine) };
}

/** ['n', 'p', 'p'] -> "a knight and two pawns" */
export function pieceList(types) {
	const parts = [];
	const words = language().list('number_words');
	for (const type of ['q', 'r', 'b', 'n', 'p']) {
		const n = types.filter((x) => x === type).length;
		if (n) parts.push(t('pieces.' + type, { n, word: words[n] || String(n) }));
	}
	return parts.length ? language().join(parts) : t('nothing');
}

/** Facts about one move in a position, each a plain yes or no */
export function moveFacts(fen, uci) {
	const chess = new Chess(fen);
	const side = chess.turn();
	const other = side === 'w' ? 'b' : 'w';
	const { from, to } = split(uci);
	const piece = chess.get(from);
	const home = side === 'w' ? '1' : '8';
	const undeveloped = HOME_MINORS[side].filter((sq) => {
		const p = chess.get(sq);
		return p && p.color === side && (p.type === 'n' || p.type === 'b');
	}).length;
	// in danger: attacked, and either not defended or attacked by something cheaper
	let attacked = false;
	if (piece && piece.type !== 'k' && piece.type !== 'p') {
		const attackers = chess.attackers(from, other);
		const defenders = chess.attackers(from, side);
		const cheapest = Math.min(...attackers.map((sq) => VALUE[chess.get(sq).type] || 99));
		attacked = attackers.length > 0 && (defenders.length === 0 || cheapest < VALUE[piece.type]);
	}
	const inCheck = chess.inCheck();
	const rights = fen.split(' ')[2];
	const canCastle = side === 'w' ? /[KQ]/.test(rights) : /[kq]/.test(rights);
	const move = chess.move(split(uci));
	const castles = move.flags.includes('k') || move.flags.includes('q');
	return {
		san: move.san,
		piece: move.piece,
		to,
		number: Number(fen.split(' ')[5]),
		captures: move.captured || null,
		check: move.san.includes('+') || move.san.includes('#'),
		castles,
		develops: (move.piece === 'n' || move.piece === 'b') && from[1] === home && to[1] !== home,
		centre: move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(to),
		escapes: attacked,
		// rules of thumb a move can break
		queenEarly: move.piece === 'q' && !move.captured && !attacked && undeveloped >= 2 && Number(fen.split(' ')[5]) <= 6,
		movedAgain: (move.piece === 'n' || move.piece === 'b') && from[1] !== home && !move.captured && !attacked && undeveloped >= 1 && Number(fen.split(' ')[5]) <= 10,
		kingWalk: move.piece === 'k' && !castles && !inCheck && canCastle,
	};
}

/**
 * The explanation shown when a run stops.
 *   fen        the position the move was played in
 *   playedPv   the engine's line starting with the move played; bestPv: starting with its preferred move
 *   playedCp, bestCp   the two moves' scores, for the player who moved
 *   kind       'mistake', or 'missed' when the opponent's last move was itself a mistake
 *   oppSan     the opponent's last move (for 'missed')
 *   theory     the move played is in the opening book; bookName: the opening it leads to, if named
 *   recapture  the opponent has just taken something and the better move takes back on that square
 * Returns { title, points: [sentences], played: line, best: line } (lines as playLine gives them).
 */
export function explain({ fen, playedPv, bestPv, playedCp, bestCp, kind = 'mistake', oppSan = null, theory = false, bookName = null, recapture = false }) {
	const side = fen.split(' ')[1];
	const played = playLine(fen, playedPv);
	const best = playLine(fen, bestPv);
	const p = played[0];
	const b = best[0];
	const lost = material(played, side);
	const won = material(best, side);
	const drop = Math.max(-2000, Math.min(2000, bestCp)) - Math.max(-2000, Math.min(2000, playedCp));
	// Only speak of material when the evaluation moved along with it (an engine line can stop mid-trade)
	const losesMaterial = lost.net <= -1 && lost.net < won.net && drop >= 50 * Math.min(-lost.net, 4);
	const missesMaterial = won.net >= 1 && won.net > lost.net && drop >= 50 * Math.min(won.net, 4);
	const matedIn = isMate(playedCp) && playedCp < 0 ? -mateIn(playedCp) : 0;
	const mateMissed = isMate(bestCp) && bestCp > 0 ? mateIn(bestCp) : 0;
	const inMoves = (n) => t('in_moves', { n: Math.max(1, n) });

	// the title is about the move played (`about` 'played'), the better one ('best'), or neither
	let title;
	let about = 'played';
	let concrete = true;
	if (matedIn) title = t('title_allows_mate', { move: p.san, when: inMoves(matedIn) });
	else if (mateMissed) {
		title = t('title_missed_mate', { when: t('mate_in', { n: Math.max(1, mateMissed) }), move: b.san });
		about = null;
	}
	// in the middle of a trade, taking back wins nothing: not taking back is the mistake
	else if (recapture && missesMaterial) title = t('title_no_recapture', { move: p.san, square: b.uci.slice(2, 4) });
	// a win that was there outranks a smaller loss (and always when the opponent had just slipped)
	else if (missesMaterial && (!losesMaterial || kind === 'missed' || won.net > -lost.net)) {
		title = won.mine.length
			? t('title_wins_for', { move: b.san, pieces: pieceList(won.theirs), cost: pieceList(won.mine) })
			: t('title_wins', { move: b.san, pieces: pieceList(won.theirs) });
		about = 'best';
	} else if (losesMaterial) {
		title = lost.theirs.length
			? t('title_loses_for', { move: p.san, pieces: pieceList(lost.mine), gain: pieceList(lost.theirs) })
			: t('title_loses', { move: p.san, pieces: pieceList(lost.mine) });
	} else {
		concrete = false;
		if (kind === 'missed') {
			title = t('title_punish', { move: b.san, opp: oppSan || t('that') });
			about = 'best';
		} else if (playedCp <= -90 && bestCp > -90) title = t('title_leaves', { move: p.san, eval: describeEval(playedCp) });
		else if (bestCp >= 90) title = t('title_slip', { move: p.san });
		else title = t('title_ground', { move: p.san });
	}

	const points = [];
	// 1. the two evaluations
	const wordsBest = describeEval(bestCp);
	const wordsPlayed = describeEval(playedCp);
	if (wordsBest !== wordsPlayed) {
		points.push(t('point_evals', { best: b.san, bestWords: wordsBest, bestEval: formatEval(bestCp), played: p.san, playedWords: wordsPlayed, playedEval: formatEval(playedCp) }));
	} else {
		points.push(t('point_better_by', { best: b.san, pawns: (drop / 100).toFixed(1), bestEval: formatEval(bestCp), playedEval: formatEval(playedCp) }));
	}
	// 2. the opponent's answer
	if (played[1]) {
		if (matedIn || (losesMaterial && about === 'played')) points.push(t('point_punishment', { move: numbered(played[1]) }));
		else points.push(t('point_answer', { played: p.san, move: numbered(played[1]) }));
	}
	// 3. what the better move does
	const facts = moveFacts(fen, b.uci);
	if (mateMissed || (missesMaterial && about === 'best')) {
		if (best.length > 1) points.push(t('point_line', { line: lineText(best.slice(0, Math.min(best.length, 6))) }));
	} else if (facts.castles) points.push(t('point_castles', { move: b.san }));
	else if (facts.captures) points.push(t('point_captures', { move: b.san, piece: pieceName(facts.captures), square: facts.to }));
	else if (facts.escapes) points.push(t('point_escapes', { move: b.san, piece: pieceName(facts.piece) }));
	else if (facts.develops) points.push(t('point_develops', { move: b.san }));
	else if (facts.centre) points.push(t('point_centre', { move: b.san }));
	// 4. a rule of thumb the move played breaks (only when nothing concrete went wrong)
	if (!concrete) {
		const mine = moveFacts(fen, p.uci);
		if (mine.queenEarly) points.push(t('rule_queen'));
		else if (mine.kingWalk) points.push(t('rule_king'));
		else if (mine.movedAgain && !facts.movedAgain) points.push(t('rule_again'));
	}
	// 5. a known but risky line
	if (theory) points.push(bookName ? t('point_theory_named', { move: p.san, book: bookName }) : t('point_theory', { move: p.san }));

	return { title, points, played, best, concrete };
}
