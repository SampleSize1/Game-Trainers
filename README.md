# Game Trainers

Three trainers for the skills behind card and board games: blackjack basic strategy and card counting, which poker hands to play and when a call is worth it, and chess openings against an engine that stops you at your first mistake. All in the browser, with no account.

Made by [@samplesize_1](https://www.instagram.com/samplesize_1/). **Use them at [samplesize1.com/tools/games](https://samplesize1.com/tools/games/).**

| Trainer | What you learn | Use it | Code |
| --- | --- | --- | --- |
| Blackjack Trainer | Perfect basic strategy, then card counting | [Open](https://samplesize1.com/tools/blackjack-trainer/) | [`blackjack-trainer/`](blackjack-trainer/) |
| Poker Trainer | Which hands to play, and when a call is worth it | [Open](https://samplesize1.com/tools/poker-trainer/) | [`poker-trainer/`](poker-trainer/) |
| Chess Opening Trainer | Your openings, against an engine that stops you at your first mistake | [Open](https://samplesize1.com/tools/chess-opening-trainer/) | [`chess-opening-trainer/`](chess-opening-trainer/) |

Each trainer's folder has its own README: what it does, its files, and where its answers come from.

## Run them yourself

They're plain web pages with no build step. Their scripts are JavaScript modules (and the chess engine is WebAssembly), so serve the whole repository with any static file server rather than opening the files directly:

```sh
git clone https://github.com/SampleSize1/Game-Trainers.git
cd Game-Trainers
python3 -m http.server 8000
```

Then open a trainer's folder, such as http://localhost:8000/blackjack-trainer/. Serve the repository itself, not one trainer's folder: they load the shared files from the folder above them.

| Shared file | What it is |
| --- | --- |
| `js/progress.js` | Saves progress and best scores in the browser (localStorage) |
| `js/language.js` | Languages: picks one (a `?lang=` link, the one picked before, the browser's), the menu, and the text in it |

## Licences and credits

- **Code**: MIT, see [LICENSE](LICENSE).
- **Chess Opening Trainer** also bundles the Stockfish engine (GPLv3), chess.js (BSD 2-Clause), chess pieces by Colin M.L. Burnett (BSD 3-Clause) and the Lichess opening names (CC0): see [its README](chess-opening-trainer/README.md#credits-and-licences) and the [licenses](licenses/) folder.

## Updates and feedback

This repository is copied automatically from [samplesize1.com](https://samplesize1.com/tools/) whenever a trainer changes, so edits made directly here would be overwritten. Spotted a wrong answer or a bug? [Open an issue](https://github.com/SampleSize1/Game-Trainers/issues) and say which trainer it's about.
