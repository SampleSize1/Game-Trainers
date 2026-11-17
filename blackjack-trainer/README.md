# Blackjack Trainer

Learn the two skills of blackjack: perfect basic strategy, then card counting.

**Use it here: [samplesize1.com/tools/blackjack-trainer](https://samplesize1.com/tools/blackjack-trainer/)**

**In beta.** Made by [@samplesize_1](https://www.instagram.com/samplesize_1/).

## What it does

Two skills, each split into drills, each drill with **Study** (shows the answers), **Practice** (quizzes you, misses come back) and **Test** (timed, best score saved).

**Strategy**: the best play for every hand against every dealer card

- The full chart for your rules: 2, 6 or 8 decks, dealer stands on or hits soft 17, double after split, surrender
- Tap any square to see what each play is worth on average and the rule for the whole row in words
- Practice by section (hard totals, soft totals, pairs); each miss shows what it costs you and comes back a few hands later
- Hands you miss collect in Trouble spots until you get them right twice in a row
- Test: every hand in a section once, timed, with the misses outlined on the chart at the end

**Counting**: five drills, in the order you'd learn them

1. Card values: what each card adds to the count
2. Running count: cards flash by one, two or three at a time at a speed you choose; the test is the classic deck countdown (a full deck with one card held back, against the clock)
3. True count: read the discard tray, work out the decks left, divide
4. Index plays: the Illustrious 18 and Fab 4, the plays that change with the count
5. Full table: play your hand by basic strategy with other players at the table and keep the count through a shoe
6. Bankroll: the same table with money on it. Size each bet from the count using a standard spread (1–8 units for two decks, 1–12 for a shoe), take or refuse insurance, and see what you won against what your bets should have made; the rest is luck. Study mode shows what the spread is worth in the long run for your rules, and how big the swings are

Counting systems: Hi-Lo, KO, Red Seven, Hi-Opt I, Hi-Opt II, Omega II and Zen. Index plays (the Illustrious 18 and Fab 4) can be switched on at the table for Hi-Lo.

Beside each drill the list shows your best result and a tick once you've hit its benchmark (the whole chart without a miss, a deck counted down in under 30 seconds, and so on).

Progress and best scores stay in your browser: no account, nothing is sent anywhere. There are no bets and no money in it.

## Files

This tool is one folder of [Game Trainers](../README.md). To run it on your computer, see [Run them yourself](../README.md#run-them-yourself).

| File | What it is |
| --- | --- |
| `index.html` | The page: markup and styles |
| `app.js` | The app: the drills, the table game, scoring |
| `data.js` | The expected value of every play for each set of rules; the charts are read off these numbers |
| `text.js` | Every word the page shows (English) |
| `lang/<code>.json` | The same words in 17 other languages |

## Where the strategy comes from

Nothing is copied from a chart. For each starting hand and dealer card, the expected result of standing, hitting, doubling and splitting is worked out exactly from the cards left in the shoe, and the best play is whichever is worth most. The charts that come out match the published ones for every combination of rules: the 4 to 8 deck charts on [Wizard of Odds](https://wizardofodds.com/games/blackjack/strategy/4-decks/), and the 2-deck charts from the [Blackjack Basic Strategy Engine](https://www.blackjackinfo.com/blackjack-basic-strategy-engine/) at blackjackinfo.com. The house edge shown in the Bankroll drill comes from the same numbers.

The index plays are Don Schlesinger's Illustrious 18 and Fab 4 for Hi-Lo.

## Licence

MIT, see [LICENSE](../LICENSE).

## Updates and feedback

This folder is copied automatically from [samplesize1.com](https://samplesize1.com/tools/) whenever the tool changes, so edits made directly here would be overwritten. Spotted a wrong play or a bug? [Open an issue](https://github.com/SampleSize1/Game-Trainers/issues) and say which trainer it's about.
