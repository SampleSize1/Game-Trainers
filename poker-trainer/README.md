# Poker Trainer

Learn the basics of Texas hold'em in six short drills: read your hand, know who wins, pick your starting hands, and work out when a call is worth it.

**Use it here: [samplesize1.com/tools/poker-trainer](https://samplesize1.com/tools/poker-trainer/)**

**In beta.** Made by [@samplesize_1](https://www.instagram.com/samplesize_1/).

## What it does

Six drills, in the order a beginner needs them. Each has **Study** (shows the answers), **Practice** (quizzes you; a question you miss comes back three questions later, then once more) and **Test** (timed; 90% is a pass and puts a tick beside the drill).

1. **Hand ranks**: two cards and a board, name your best five-card hand
2. **Who wins?**: a board and two players' cards. Kickers, split pots, and the times the board plays
3. **Starting hands**: a seat at a six-player table and two cards, everyone before you has folded. Raise or fold? Study mode is the chart, for one seat or all of them at once
4. **Count your outs**: the cards that complete your straight or flush, on the flop or the turn
5. **The odds**: the two percentages a call comes down to. How often you'll hit (the rule of 2 and 4) and how often you need to (the call as a share of the pot)
6. **Call or fold?**: a draw, a pot and a bet. Put the two numbers together

Progress and best scores stay in your browser: no account, nothing is sent anywhere. There are no bets and no money in it, and it is a study tool: nothing in it is for use during a real hand.

## Files

This tool is one folder of [Game Trainers](../README.md). To run it on your computer, see [Run them yourself](../README.md#run-them-yourself).

| File | What it is |
| --- | --- |
| `index.html` | The page: markup and styles |
| `js/app.js` | The page's behaviour: what each drill shows, the buttons, the scoring |
| `js/core/cards.js` | Cards and the hand evaluator: how strong the best five of seven cards are, and why one hand beats another |
| `js/core/chart.js` | The starting-hand chart and the rule each hand falls under |
| `js/core/draws.js` | Counting outs, the chance of hitting, the price of a call |
| `js/core/questions.js` | The questions each drill asks, and the tests |
| `js/core/review.js` | Bringing missed questions back |
| `js/text.js` | Every word the page shows (English) |

## Where the answers come from

Nothing is looked up from a table of answers. Hands are compared by an evaluator written for this tool; it is checked by sorting all 2,598,960 five-card hands into their nine categories and matching the known count of each. Outs are found by trying every unseen card. The percentages are exact (the rule of 2 and 4 is shown beside them), and "Call or fold?" only asks spots where the rule of thumb and the exact figure agree and the gap is at least three points.

The starting-hand chart is this tool's own. It follows the shape that computer-solved charts share (the later you act, the more hands you raise: about 11% of hands under the gun, 17% from the hijack, 26% from the cutoff, 44% on the button), but it is simpler and a little tighter in the early seats, and the small blind plays the cutoff's chart. Each kind of hand is raised from one cut-off upward with nothing mixed, so every hand has one answer and a one-line rule. It is a chart to learn the game with, not a solver's output.

## Licence

MIT, see [LICENSE](../LICENSE).

## Updates and feedback

This folder is copied automatically from [samplesize1.com](https://samplesize1.com/tools/) whenever the tool changes, so edits made directly here would be overwritten. Spotted a wrong answer or a bug? [Open an issue](https://github.com/SampleSize1/Game-Trainers/issues) and say which trainer it's about.
