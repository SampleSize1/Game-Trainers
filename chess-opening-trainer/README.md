# Chess Opening Trainer

Play a chess opening against an engine until you make a mistake or miss a chance. The run stops there, shows the better move and why, and you go again.

**Use it here: [samplesize1.com/tools/chess-opening-trainer](https://samplesize1.com/tools/chess-opening-trainer/)**

**In beta.** Made by [@samplesize_1](https://www.instagram.com/samplesize_1/).

## What it does

- **Runs.** You play the first moves of a game (8 to 15, your choice) as White, Black or either. Known opening moves are accepted at once and the opening's name appears as you go. The first move that gives up too much stops the run.
- **Three opponents.** The **Master** plays sound theory and then the engine's best moves: nothing is handed to you. The **Club player** and the **Beginner** make mistakes, and you are expected to punish them: missing a chance stops the run just as a mistake does.
- **The explanation.** The move you played and the better one as arrows on the board, the engine's score for both in plain words, what it comes to (a checkmate, a piece, a pawn, or just a worse position), and the line after each move, which you can step through on the board.
- **Mistakes come back.** A position you slipped in is kept. Later runs steer back into that line, "Fix mistakes" goes through the list one position at a time, and a position leaves the list when you play it right.
- **Settings.** How strict it is (stop on blunders, mistakes or inaccuracies), a menu of about sixty openings to start from, and the length of a run.

Progress stays in your browser: no account, nothing is sent anywhere. The engine runs in your browser too.

## Files

This tool is one folder of [Game Trainers](../README.md). To run it on your computer, see [Run them yourself](../README.md#run-them-yourself).

| File | What it is |
| --- | --- |
| `index.html` | The page: markup and styles |
| `js/app.js` | The page's behaviour: what is on screen in each state, the buttons, the scores |
| `js/board.js` | The board: drawing a position, taps and drags |
| `js/core/trainer.js` | A run: the opponent's moves, the judging of yours, when it stops |
| `js/core/judge.js` | How much a move gives up (in winning chances), and the limits |
| `js/core/opponent.js` | The three opponents and how they choose a move |
| `js/core/explain.js` | The explanation, worked out from the engine's lines |
| `js/core/book.js`, `data/book.js` | The opening book: about 8,000 positions with their names and the engine's evaluation of each |
| `js/core/engine.js` | Talking to the engine (UCI) |
| `js/vendor/chess.js` | [chess.js](https://github.com/jhlywa/chess.js): the rules of chess |
| `engine/` | [Stockfish](https://stockfishchess.org/) 19 for the browser ([Stockfish.js](https://github.com/nmrugg/stockfish.js)) |
| `pieces.css` | The chess pieces |
| `js/text.js` | Every word the page shows (English) |

## How a move is judged

Moves are compared by winning chances rather than raw pawns, the way Lichess and Chess.com grade moves: a pawn matters a lot in an equal position and hardly at all when one side is a queen up. By default a move that gives up ten points of winning chance (about a pawn near equality) stops the run.

A move that is known theory is accepted unless the book itself rates it a real mistake. Otherwise the engine has been looking at the position since it appeared; its first choice, or anything it scores close to it, is accepted. A move it doesn't like is checked again, deeper, side by side with the engine's choice, before the run is stopped over it.

Two honest limits. The engine is the small "lite" Stockfish searching for a second or two in your browser: far stronger than any person, but its verdict on a quiet move is an opinion, and close calls can be argued. And the explanation describes the engine's lines; it is not a coach and does not explain plans.

## Credits and licences

- This tool's own code: MIT, see [LICENSE](../LICENSE).
- **Stockfish** (`engine/`): GPLv3, by the Stockfish developers; the WebAssembly build is Stockfish.js by Nathan Rugg and Chess.com. It runs as a separate program that the page talks to in text. See [licenses/stockfish.txt](../licenses/stockfish.txt) for the source code links.
- **chess.js** by Jeff Hlywa: BSD 2-Clause, [licenses/chess.js.txt](../licenses/chess.js.txt).
- **Opening names**: the [Lichess chess-openings](https://github.com/lichess-org/chess-openings) data set, CC0.
- **Pieces**: by Colin M.L. Burnett, BSD 3-Clause, [licenses/chess-pieces.txt](../licenses/chess-pieces.txt).

## Updates and feedback

This folder is copied automatically from [samplesize1.com](https://samplesize1.com/tools/) whenever the tool changes, so edits made directly here would be overwritten. Spotted a wrong verdict or a bug? [Open an issue](https://github.com/SampleSize1/Game-Trainers/issues) and say which trainer it's about.
