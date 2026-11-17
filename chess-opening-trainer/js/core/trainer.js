// One opening run: the opponent's moves, the judging of yours, and when the run stops. No page code.
//
//   const trainer = createTrainer({ engine, book });
//   let run = trainer.start({ color: 'w', level: 'club', strict: 'standard', length: 10 });
//   if (run.turn === 'opp') await trainer.reply();          // the opponent moves
//   const result = await trainer.play('e2e4');              // your move
//   result.ok      -> it stands; result.done: the run is complete; result.punished: you took a chance
//   result.stop    -> the run stops here: what you played, what was better, and why (explain.js)
//
// How a move is judged:
//   1. A move that is known theory (in the opening book) is accepted at once unless the book's own
//      evaluation calls it a real mistake.
//   2. Otherwise the engine has been thinking about the position since it appeared (three best moves).
//      Its first choice, or a move it scores close to it, is accepted.
//   3. Anything else is checked properly before the run is stopped over it: the move played and the
//      engine's choice are searched deeper, side by side. Only if the gap is still there does the run stop.
// When the opponent has just slipped, the bar for your reply is lower (judge.js): you are expected
// to take what was offered, and a stop then is a "missed chance".
import { Chess } from '../vendor/chess.js';
import { lossOf, stops, strictness, grade, winChance, OPPORTUNITY } from './judge.js';
import { opponent, bookMove, engineMove } from './opponent.js';
import { explain } from './explain.js';

// How hard the engine looks: depth in half-moves, and a ceiling on the positions it may examine
// (which is what bounds the wait on a slow phone; the engine is never interrupted, see engine.js).
export const SEARCH = {
	think: { depth: 13, lines: 3, nodes: 400000 }, // while you choose your move
	verify: { depth: 15, lines: 2, nodes: 600000 }, // before stopping a run
	best: { depth: 12, lines: 3, nodes: 400000 }, // the master's own move
	all: { depth: 8, lines: 80, nodes: 400000 }, // every legal move scored, for an opponent that errs
};

const split = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

export function createTrainer({ engine, book, rng = Math.random }) {
	let run = null;

	function record(move, by, extra = {}) {
		const entry = book.at(move.after);
		if (entry && entry.name) run.opening = { eco: entry.eco, name: entry.name };
		const rec = { uci: move.lan, san: move.san, color: move.color, by, before: move.before, after: move.after, number: Number(move.before.split(' ')[5]), ...extra };
		run.moves.push(rec);
		return rec;
	}

	function think() {
		const fen = run.chess.fen();
		run.thinking = { fen, result: engine.analyse({ fen, ...SEARCH.think }) };
	}

	async function thought(mine) {
		const fen = mine.chess.fen();
		let result = mine.thinking && mine.thinking.fen === fen ? await mine.thinking.result : null;
		if (run !== mine) return null;
		// a search that was dropped part-way is done again
		if (!result || !result.lines.length) result = await engine.analyse({ fen, ...SEARCH.think });
		return result;
	}

	function finishIfOver() {
		if (run.chess.isGameOver()) {
			run.status = 'done';
			run.over = run.chess.isCheckmate() ? 'checkmate' : 'draw';
		}
	}

	return {
		get run() {
			return run;
		},

		/**
		 * Begin a run.
		 *   color     the side you play
		 *   level     the opponent (opponent.js); strict: how small a slip stops the run (judge.js)
		 *   length    the run is complete once you have played this move number
		 *   opening   { moves: 'e2e4 c7c5' }: start from this position instead of the first move
		 *   revisit   moves of an earlier run you slipped in: the opponent steers back into it for as
		 *             long as you play the same moves
		 *   single    stop after one accepted move (fixing a saved mistake)
		 */
		start({ color, level = 'club', strict = 'standard', length = 10, opening = null, revisit = null, single = false }) {
			engine.cancel();
			const chess = new Chess();
			run = {
				color,
				level,
				strict,
				length,
				single,
				chess,
				moves: [],
				opening: null,
				revisit: revisit ? revisit.split(' ') : null,
				lastCp: null, // your score after your last move
				slip: null, // the opponent's last move, when it gave something away
				clean: true, // no stop so far
				played: 0, // moves of your own
				status: 'play',
				over: null,
				thinking: null,
			};
			for (const uci of opening && opening.moves ? opening.moves.split(' ') : []) record(chess.move(split(uci)), 'setup');
			run.turn = chess.turn() === color ? 'you' : 'opp';
			if (run.turn === 'you') think();
			else {
				// what the position is worth to you before the opponent's first move, if the book knows
				const entry = book.at(chess.fen());
				if (entry) run.lastCp = -entry.value;
			}
			return run;
		},

		/** The opponent's move. Resolves with its record, or null if the run was replaced meanwhile. */
		async reply() {
			const mine = run;
			const chess = mine.chess;
			const fen = chess.fen();
			const entry = book.at(fen);
			const who = opponent(mine.level);
			const path = mine.moves.map((m) => m.uci);
			let uci = null;
			let loss = null;

			// 1. back into a line you slipped in before
			if (mine.revisit && mine.revisit.length > path.length && path.every((m, i) => m === mine.revisit[i])) {
				const again = mine.revisit[path.length];
				if (chess.moves({ verbose: true }).some((m) => m.lan === again)) uci = again;
			} else mine.revisit = null;
			// 2. theory (the first move of the game is always a book move)
			if (!uci) {
				const pick = bookMove(entry, mine.level, rng, path.length < 2);
				if (pick) uci = pick.uci;
			}
			if (uci && entry) {
				const known = entry.moves.find((m) => m.uci === uci);
				if (known) loss = lossOf(entry.value, entry.value - known.loss);
			}
			// 3. the engine: its best moves for the master, every move scored for the others
			if (!uci) {
				const result = await engine.analyse({ fen, ...(who.within != null ? SEARCH.best : SEARCH.all) });
				if (run !== mine) return null;
				if (!result || !result.lines.length) return null;
				const pick = engineMove(result.lines.map((l) => ({ uci: l.move, cp: l.cp })), chess.moves({ verbose: true }), mine.level, rng);
				uci = pick.uci;
				loss = pick.loss;
			}

			const rec = record(chess.move(split(uci)), 'opp', { loss });
			mine.slip = loss != null && loss >= OPPORTUNITY ? rec : null;
			mine.oppLoss = loss;
			mine.turn = 'you';
			finishIfOver();
			if (mine.status === 'play') think();
			return rec;
		},

		/**
		 * Your move. Resolves with { ok: true, move, done, punished } or { ok: false, stop }, or null
		 * if the run was replaced meanwhile. An illegal move throws.
		 */
		async play(uci) {
			const mine = run;
			const chess = mine.chess;
			const fen = chess.fen();
			const legal = chess.moves({ verbose: true });
			if (!legal.some((m) => m.lan === uci)) throw new Error('Illegal move: ' + uci);
			const limit = strictness(mine.strict).stop;
			const entry = book.at(fen);
			const known = entry ? entry.moves.find((m) => m.uci === uci) : null;

			let bestCp = null;
			let playedCp = null;
			let verdict = null; // set when the run stops

			// Did the opponent's last move hand you something? Judged by how much better off you are than
			// after your own last move: the opponent's slip as it was measured when it chose the move,
			// confirmed by the search of this position (or, without that first measurement, a bigger jump).
			const chanceNow = () => {
				const gain = mine.lastCp == null ? 0 : winChance(bestCp) - winChance(mine.lastCp);
				return mine.slip ? gain >= OPPORTUNITY * 0.6 : gain >= OPPORTUNITY * 1.5;
			};
			const accept = () => {
				const chance = chanceNow();
				const loss = lossOf(bestCp, playedCp);
				const rec = record(chess.move(split(uci)), 'you', { loss, grade: known && loss < 5 ? 'book' : grade(loss), cp: playedCp, book: !!known });
				mine.lastCp = playedCp;
				mine.slip = null;
				mine.played++;
				mine.turn = 'opp';
				finishIfOver();
				if (mine.status === 'play' && (mine.single || rec.number >= mine.length)) mine.status = 'done';
				return { ok: true, move: rec, done: mine.status === 'done', punished: chance && loss < 5 };
			};

			// 1. theory
			if (known) {
				bestCp = entry.value;
				playedCp = entry.value - known.loss;
				if (!stops(lossOf(bestCp, playedCp), mine.strict, true, chanceNow())) return accept();
			}
			// 2. the search that has been running since the position appeared
			const first = await thought(mine);
			if (run !== mine || !first || !first.lines.length) return null;
			const top = first.lines[0];
			const here = first.lines.find((l) => l.move === uci);
			if (!known) {
				bestCp = top.cp;
				if (here && (here === top || lossOf(top.cp, here.cp) < limit / 2)) {
					playedCp = here.cp;
					return accept();
				}
			}
			// 3. the deeper check, the two moves side by side
			const rival = top.move !== uci ? top.move : first.lines[1] ? first.lines[1].move : null;
			if (!rival) {
				playedCp = bestCp = top.cp;
				return accept();
			}
			const check = await engine.analyse({ fen, ...SEARCH.verify, moves: [rival, uci] });
			if (run !== mine) return null;
			const a = check && check.lines.find((l) => l.move === rival);
			const b = check && check.lines.find((l) => l.move === uci);
			if (!a || !b) {
				// the engine gave no answer for one of the two: give the move the benefit of the doubt
				playedCp = bestCp = top.cp;
				return accept();
			}
			bestCp = Math.max(a.cp, b.cp);
			playedCp = b.cp;
			const loss = lossOf(bestCp, playedCp);
			const missed = chanceNow();
			if (b.cp >= a.cp || !stops(loss, mine.strict, !!known, missed)) return accept();

			// The run stops here
			const last = mine.moves[mine.moves.length - 1];
			const kind = missed ? 'missed' : 'mistake';
			const why = explain({
				fen,
				playedPv: b.pv,
				bestPv: a.pv,
				playedCp,
				bestCp,
				kind,
				oppSan: last && last.by === 'opp' ? last.san : null,
				theory: !!known,
				recapture: !!last && last.by === 'opp' && last.san.includes('x') && last.uci.slice(2, 4) === rival.slice(2, 4),
				bookName: known ? nameAfter(book, fen, uci) : null,
			});
			verdict = {
				kind,
				grade: grade(loss),
				loss,
				fen,
				number: Number(fen.split(' ')[5]),
				color: mine.color,
				played: uci,
				playedSan: why.played[0].san,
				best: rival,
				bestSan: why.best[0].san,
				playedCp,
				bestCp,
				why,
				path: mine.moves.map((m) => m.uci).join(' '),
				opening: mine.opening,
				level: mine.level,
			};
			mine.clean = false;
			mine.status = 'stopped';
			mine.stop = verdict;
			return { ok: false, stop: verdict };
		},

		/** After a stop: take the move back and have another go at the same position */
		retry() {
			if (!run || run.status !== 'stopped') return;
			run.status = 'play';
			run.stop = null;
		},
	};
}

// The opening a book move leads to, for the note that a risky move is still theory
function nameAfter(book, fen, uci) {
	const chess = new Chess(fen);
	chess.move(split(uci));
	const entry = book.at(chess.fen());
	return entry && entry.name ? entry.name : null;
}
