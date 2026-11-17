// Talking to the chess engine (Stockfish) in its own language, UCI. No page code: the engine is
// reached through two functions, so the same code drives the browser's worker and, in the build
// scripts and tests, the engine running under Node.
//
//   const engine = createEngine({ post: (command) => worker.postMessage(command), listen: (onLine) => ... });
//   await engine.ready();
//   const result = await engine.analyse({ fen, depth: 13, lines: 3 });
//   result.lines[0]   { move: 'e2e4', cp: 31, depth: 13, pv: ['e2e4', 'e7e5', ...] }   best first
//
// Scores are in centipawns for the side to move; a forced mate is MATE - n (see judge.js).
//
// The engine is never told to "stop", and never given a time limit ("movetime"). In Stockfish.js
// 19.0.1 (single-threaded) a search that is stopped part-way can crash the engine during a later
// search ("table index is out of bounds", "memory access out of bounds"): found with
// verify/engine_stress.mjs, which also shows that searches left to finish are safe. So a search is
// bounded by depth and by a number of positions to look at ("nodes"), which also bounds the time it
// takes on a slow phone, and a search nobody wants any more is left to finish and its answer dropped.
import { MATE } from './judge.js';

export function createEngine({ post, listen }) {
	let current = null; // the search in progress
	const queue = [];
	let waitFor = null; // { pattern, done }: a reply that isn't a search (uciok, readyok)
	let started = null;

	listen((data) => {
		// The worker sends text, one line or several
		for (const line of String(data).split('\n')) onLine(line.trim());
	});

	function onLine(line) {
		if (waitFor && waitFor.pattern.test(line)) {
			const { done } = waitFor;
			waitFor = null;
			done(line);
			return;
		}
		if (!current) return;
		if (line.startsWith('info ') && line.includes(' pv ')) {
			const info = parseInfo(line);
			// "lowerbound" / "upperbound" lines are a search still narrowing in: not a score yet
			if (info && !info.bound) current.found.set(info.multipv, info);
		} else if (line.startsWith('bestmove')) {
			const job = current;
			current = null;
			const lines = [...job.found.values()].sort((a, b) => a.multipv - b.multipv).map(({ multipv, bound, ...rest }) => rest);
			job.done(job.dropped ? null : { lines, best: lines[0] || null });
			next();
		}
	}

	function next() {
		if (current || !queue.length) return;
		current = queue.shift();
		const { fen, depth, lines = 1, moves, nodes } = current.ask;
		post('setoption name MultiPV value ' + lines);
		post('position fen ' + fen);
		post('go depth ' + depth + (nodes ? ' nodes ' + nodes : '') + (moves && moves.length ? ' searchmoves ' + moves.join(' ') : ''));
	}

	const reply = (pattern, command) =>
		new Promise((done) => {
			waitFor = { pattern, done };
			post(command);
		});

	return {
		/** Resolves once the engine has loaded and answered */
		ready() {
			if (!started) {
				started = (async () => {
					await reply(/^uciok/, 'uci');
					post('setoption name Hash value 32');
					await reply(/^readyok/, 'isready');
				})();
			}
			return started;
		},

		/**
		 * Search a position. ask: { fen, depth, lines (how many moves to score, best first),
		 * moves (only consider these), nodes (stop looking after this many positions) }
		 */
		analyse(ask) {
			return new Promise((done) => {
				queue.push({ ask, done, found: new Map(), dropped: false });
				next();
			});
		},

		/** Nobody wants the searches asked for so far: they answer null (the running one when it finishes) */
		cancel() {
			for (const job of queue.splice(0)) job.done(null);
			if (current) current.dropped = true;
		},

		/** The engine died and has been started again: set it up, and ask again for what it was searching */
		restart() {
			waitFor = null;
			started = null;
			if (current) {
				current.found = new Map();
				queue.unshift(current);
				current = null;
			}
			return this.ready().then(next);
		},

		get busy() {
			return !!current || queue.length > 0;
		},
	};
}

/** One "info ... pv ..." line of the engine's output */
export function parseInfo(line) {
	const word = (name) => {
		const m = line.match(new RegExp('\\b' + name + ' (-?\\d+)'));
		return m ? Number(m[1]) : null;
	};
	const score = line.match(/\bscore (cp|mate) (-?\d+)( lowerbound| upperbound)?/);
	const pv = line.match(/ pv (.+)$/);
	if (!score || !pv) return null;
	const n = Number(score[2]);
	const cp = score[1] === 'cp' ? n : n > 0 ? MATE - n : n < 0 ? -MATE - n : -MATE;
	const moves = pv[1].trim().split(/\s+/);
	return { multipv: word('multipv') || 1, depth: word('depth') || 0, cp, bound: !!score[3], move: moves[0], pv: moves };
}
