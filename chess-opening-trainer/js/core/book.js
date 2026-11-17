// The opening book: which positions have a name, and which moves from them are known theory.
// No page code. The data (data/book.js) is made by tools-src/chess-opening-trainer/build/make_book.mjs
// from the Lichess opening names (CC0) and Stockfish's evaluation of every position in them.

// A position's identity for the book: pieces, side to move, castling rights and en passant square
// (the first four fields of a FEN; the move counters don't matter), hashed to a short string.
export function positionKey(fen) {
	const epd = fen.split(' ').slice(0, 4).join(' ');
	// cyrb53: a 53-bit string hash. Among the book's ~10,000 positions a clash is a one-in-a-billion matter.
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < epd.length; i++) {
		const c = epd.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// data: { names: [[eco, name], ...], positions: { key: [nameIndex or -1, value, 'e2e4:0:812 d2d4:6:650'] } }
//   value: what the position is worth to the side to move, in centipawns (Stockfish's score, or
//   the best book move's if that is higher)
//   each move: its UCI form, how many centipawns it gives up against the best move, and how many
//   named openings run through it (a rough measure of how much theory follows)
export function makeBook(data) {
	const cache = new Map();

	function at(fen) {
		const key = positionKey(fen);
		if (cache.has(key)) return cache.get(key);
		const raw = data.positions[key];
		let entry = null;
		if (raw) {
			const named = raw[0] >= 0 ? data.names[raw[0]] : null;
			entry = {
				eco: named ? named[0] : null,
				name: named ? named[1] : null,
				value: raw[1],
				moves: raw[2]
					? raw[2].split(' ').map((m) => {
							const [uci, loss, lines] = m.split(':');
							return { uci, loss: Number(loss), lines: Number(lines) };
						})
					: [],
			};
		}
		cache.set(key, entry);
		return entry;
	}

	return {
		at,
		// The book's entry for one move from a position, or null when the move isn't theory
		move(fen, uci) {
			const entry = at(fen);
			return entry ? entry.moves.find((m) => m.uci === uci) || null : null;
		},
		size: Object.keys(data.positions).length,
	};
}

// "Sicilian Defense: Najdorf Variation, English Attack" -> "Sicilian Defense"
export function family(name) {
	return name.split(':')[0].trim();
}
