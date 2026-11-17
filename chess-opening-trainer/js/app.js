/* Chess Opening Trainer
 *
 * You play the opening against a chess engine. The first time you make a mistake, or miss a chance
 * the opponent gave you, the run stops and shows the better move and why. Then you go again.
 *
 * Plain modules, no framework and no build step. Everything the tool knows about chess is in
 * js/core/ (the opening book, talking to the engine, judging a move, the opponent, the explanation,
 * the run itself) and the rules come from js/vendor/chess.js; js/board.js draws the board. This file
 * is the page: what is on screen in each state, the buttons, the scores. Settings, scores and the
 * mistakes still to fix are saved in the browser through /js/progress.js.
 */
import { Chess } from './vendor/chess.js';
import { BOOK } from '../data/book.js';
import { OPENINGS } from '../data/openings.js';
import { makeBook } from './core/book.js';
import { createEngine } from './core/engine.js';
import { createTrainer } from './core/trainer.js';
import { STRICTNESS, strictness, formatEval, winChance } from './core/judge.js';
import { OPPONENTS, opponent } from './core/opponent.js';
import { numbered } from './core/explain.js';
import { createBoard } from './board.js';
import { EN, t, useLanguage } from './text.js';

const $ = (id) => document.getElementById(id);
const saved = window.SiteProgress ? window.SiteProgress.tool('chess-opening-trainer') : { get: (k, d) => d, set: () => {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The page's words, in the language picked (/js/language.js, which the page started)
const lang = await SiteLanguage.open({ layers: [{ text: EN, files: new URL('../lang/', import.meta.url) }] });
useLanguage(lang);

function h(tag, attrs, kids) {
	const el = document.createElement(tag);
	for (const k in attrs || {}) {
		const v = attrs[k];
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'text') el.textContent = v;
		else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of [].concat(kids || [])) if (kid) el.append(kid);
	return el;
}

// ------------------------------------------------------------------ settings and what is saved
const LENGTHS = [8, 10, 12, 15];
const S = { color: 'w', level: 'club', strict: 'standard', opening: '', length: 10 };
(function load() {
	const s = saved.get('settings', null);
	if (!s || typeof s !== 'object') return;
	if (['w', 'b', 'either'].includes(s.color)) S.color = s.color;
	if (OPPONENTS.some((o) => o.id === s.level)) S.level = s.level;
	if (STRICTNESS.some((x) => x.id === s.strict)) S.strict = s.strict;
	if (OPENINGS.some((o) => o.name === s.opening)) S.opening = s.opening;
	if (LENGTHS.includes(s.length)) S.length = s.length;
})();
const saveSettings = () => saved.set('settings', S);

const stats = Object.assign({ runs: 0, clean: 0, streak: 0, best: 0 }, saved.get('stats', {}));
// The positions you slipped in and haven't yet got right: newest first, forty at most
let mistakes = saved.get('mistakes', []);
if (!Array.isArray(mistakes)) mistakes = [];
const saveMistakes = () => saved.set('mistakes', mistakes);
const samePosition = (a, b) => a.split(' ').slice(0, 4).join(' ') === b.split(' ').slice(0, 4).join(' ');

// ------------------------------------------------------------------ the engine, the book, the board
const book = makeBook(BOOK);
const listeners = [];
let worker = null;
// What the page is showing, apart from the run itself
const V = {
	mode: 'play', // 'play': opening runs; 'fix': the saved mistakes, one position at a time
	busy: null, // 'check' while your move is being judged, 'opp' while the opponent chooses
	pending: null, // your move, shown on the board while it is judged
	shown: null, // after a stop: { line: 'played' | 'best', index } of the move being looked at
	notice: null, // a line under the prompt (a chance taken)
	flip: false,
	engine: 'loading', // 'ready', or 'failed'
	fixed: null, // fix mode: the mistake just put right
};
const engine = createEngine({ post: (command) => worker && worker.postMessage(command), listen: (fn) => listeners.push(fn) });
const trainer = createTrainer({ engine, book });

// The engine can die (rarely, and for reasons of its own). When it does, a fresh one is started and
// asked again for whatever was being searched; after three deaths in a visit the page gives up.
let restarts = 0;
let heard = Date.now();
function startWorker() {
	try {
		worker = new Worker(new URL('../engine/stockfish-19-lite-single.js', import.meta.url));
		worker.onmessage = (e) => {
			heard = Date.now();
			listeners.forEach((fn) => fn(e.data));
		};
		worker.onerror = (e) => {
			if (e && e.preventDefault) e.preventDefault();
			engineDied();
		};
	} catch {
		worker = null;
	}
}
function engineDied() {
	if (worker) worker.terminate();
	worker = null;
	if (++restarts <= 3) startWorker();
	if (!worker) {
		V.engine = 'failed';
		return render();
	}
	heard = Date.now();
	engine.restart();
}
startWorker();
// An engine that is loading or searching says something every few seconds: a long silence means it has died quietly
setInterval(() => {
	if (V.engine !== 'failed' && (V.engine === 'loading' || engine.busy) && Date.now() - heard > 25000) engineDied();
}, 5000);

const board = createBoard($('board'), {
	targets: (from) => (canMove() ? trainer.run.chess.moves({ square: from, verbose: true }).map((m) => m.to) : []),
	move: (from, to) => userMove(from, to),
});
const run = () => trainer.run;
const canMove = () => !!run() && run().status === 'play' && run().turn === 'you' && !V.busy && V.engine !== 'failed';

// ------------------------------------------------------------------ a run
function newRun() {
	V.mode = 'play';
	V.busy = V.pending = V.shown = V.notice = V.fixed = null;
	const color = S.color === 'either' ? (Math.random() < 0.5 ? 'w' : 'b') : S.color;
	const opening = OPENINGS.find((o) => o.name === S.opening) || null;
	// Half the time, the opponent heads back into a line you slipped in (for as long as you repeat your moves)
	const again = mistakes.filter((m) => m.color === color && m.path && (!opening || m.path.startsWith(opening.moves)));
	const revisit = again.length && Math.random() < 0.5 ? again[Math.floor(Math.random() * again.length)].path : null;
	trainer.start({ color, level: S.level, strict: S.strict, length: S.length, opening, revisit });
	render();
	if (run().turn === 'opp') opponentTurn();
}

async function opponentTurn() {
	const mine = run();
	V.busy = 'opp';
	render();
	const [rec] = await Promise.all([trainer.reply(), sleep(380)]);
	if (run() !== mine || !rec) return;
	V.busy = null;
	if (mine.status === 'done') finishRun();
	render({ slide: true });
}

async function userMove(from, to) {
	if (!canMove()) return;
	const mine = run();
	const options = mine.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
	if (!options.length) return;
	let promotion = '';
	if (options.some((m) => m.promotion)) {
		promotion = await board.promote(mine.color);
		if (run() !== mine) return;
	}
	const uci = from + to + promotion;
	const before = mine.chess.fen();
	const shownMove = options.find((m) => (m.promotion || '') === promotion) || options[0];
	V.busy = 'check';
	V.pending = { after: shownMove.after, from, to };
	V.notice = null;
	render();
	const result = await trainer.play(uci);
	if (run() !== mine || !result) return;
	V.busy = V.pending = null;

	if (!result.ok) return stopped(result.stop);

	// A saved mistake put right, here or in a run
	const had = mistakes.find((m) => samePosition(m.fen, before));
	if (had) {
		mistakes = mistakes.filter((m) => m !== had);
		saveMistakes();
		if (V.mode === 'fix') V.fixed = { ...had, now: result.move.san };
	}
	if (result.punished) {
		const slip = mine.moves[mine.moves.length - 2];
		V.notice = slip && slip.by === 'opp' ? t('punished', { move: numbered(slip) }) : t('well_taken');
	}
	if (result.done) {
		finishRun();
		return render();
	}
	render();
	opponentTurn();
}

function stopped(stop) {
	const mine = run();
	V.shown = null;
	if (V.mode === 'play') {
		if (!mine.counted) {
			mine.counted = true;
			stats.runs++;
			stats.streak = 0;
			saved.set('stats', stats);
		}
		mistakes = mistakes.filter((m) => !samePosition(m.fen, stop.fen));
		mistakes.unshift({
			fen: stop.fen,
			path: stop.path,
			color: stop.color,
			played: stop.played,
			playedSan: stop.playedSan,
			best: stop.best,
			bestSan: stop.bestSan,
			name: stop.opening ? stop.opening.name : null,
			number: stop.number,
		});
		mistakes = mistakes.slice(0, 40);
		saveMistakes();
	}
	render();
}

function finishRun() {
	const mine = run();
	if (V.mode !== 'play' || mine.counted) return;
	mine.counted = true;
	stats.runs++;
	if (mine.clean) {
		stats.clean++;
		stats.streak++;
		stats.best = Math.max(stats.best, stats.streak);
	}
	saved.set('stats', stats);
}

function tryAgain() {
	if (!run() || run().status !== 'stopped') return;
	trainer.retry();
	V.shown = null;
	V.notice = t('same_position');
	render();
}

// ------------------------------------------------------------------ fixing saved mistakes
let fixAt = 0;
function startFix(step = 0) {
	if (!mistakes.length) return newRun();
	V.mode = 'fix';
	V.busy = V.pending = V.shown = V.notice = V.fixed = null;
	fixAt = (fixAt + step + mistakes.length) % mistakes.length;
	const m = mistakes[fixAt];
	trainer.start({ color: m.color, level: S.level, strict: S.strict, opening: { moves: m.path }, single: true });
	run().fixing = m;
	render({ slide: true });
}

// ------------------------------------------------------------------ what is on screen
function label(move, first) {
	return first || move.color === 'w' ? numbered(move) : move.san;
}

function render(opts = {}) {
	const r = run();
	if (!r) return;
	const stop = r.status === 'stopped' ? r.stop : null;
	const view = (r.color === 'w') !== V.flip ? 'w' : 'b';

	// ----- the board
	let fen = r.chess.fen();
	let last = r.moves.length ? [r.moves[r.moves.length - 1].uci.slice(0, 2), r.moves[r.moves.length - 1].uci.slice(2, 4)] : null;
	let arrows = [];
	let barCp = null; // the score the bar shows, for you
	if (V.pending) {
		fen = V.pending.after;
		last = [V.pending.from, V.pending.to];
	} else if (stop && V.shown) {
		const m = stop.why[V.shown.line][V.shown.index];
		fen = m.after;
		last = [m.uci.slice(0, 2), m.uci.slice(2, 4)];
		barCp = V.shown.line === 'best' ? stop.bestCp : stop.playedCp;
	} else if (stop) {
		arrows = [
			{ from: stop.played.slice(0, 2), to: stop.played.slice(2, 4), kind: 'bad' },
			{ from: stop.best.slice(0, 2), to: stop.best.slice(2, 4), kind: 'good' },
		];
		barCp = stop.bestCp;
	}
	const shownGame = new Chess(fen);
	const check = shownGame.inCheck() ? shownGame.findPiece({ type: 'k', color: shownGame.turn() })[0] : null;
	board.show({ fen, view, last, arrows, check, mover: canMove() ? r.color : null, slide: !!opts.slide || !!(stop && V.shown) });
	$('board').setAttribute('aria-label', t('board_aria_side', { side: t(r.color === 'w' ? 'white' : 'black') }));

	const bar = $('evalBar');
	bar.classList.toggle('is-on', barCp != null);
	bar.classList.toggle('flip', view === 'b');
	if (barCp != null) $('evalFill').style.height = winChance(r.color === 'w' ? barCp : -barCp).toFixed(1) + '%';

	// ----- the prompt
	const prompt = $('prompt');
	const who = opponent(r.level);
	const moveNo = Number(r.chess.fen().split(' ')[5]);
	const openingName = r.opening ? r.opening.name : null;
	let eyebrow;
	let name;
	let meta;
	let tips = [];
	let state = '';
	if (V.engine === 'failed') {
		eyebrow = t('engine_failed');
		name = t('engine_failed_name');
		meta = t('engine_failed_meta');
		state = 'is-bad';
	} else if (stop) {
		const kind = stop.kind === 'missed' ? t('missed_chance') : t('grade.' + (stop.grade === 'good' ? 'mistake' : stop.grade));
		eyebrow = t('stop_eyebrow', { kind, n: stop.number });
		name = stop.why.title;
		meta = openingName || t('before_opening');
		tips = stop.why.points;
		state = 'is-bad';
	} else if (V.mode === 'fix' && V.fixed) {
		eyebrow = t('fixed');
		name = t('is_the_move', { move: V.fixed.now });
		meta = `${t('last_time', { move: V.fixed.playedSan })} · ${mistakes.length ? t('n_left', { n: mistakes.length }) : t('none_left')}`;
		state = 'is-ok';
	} else if (r.status === 'done' && V.mode === 'play') {
		if (r.over === 'checkmate') {
			eyebrow = t(r.turn === 'opp' ? 'checkmate' : 'checkmated');
			name = t(r.turn === 'opp' ? 'mate_finish' : 'you_were_mated');
		} else if (r.clean) {
			eyebrow = t('clean_run');
			name = t('clean_moves', { n: r.played });
		} else {
			eyebrow = t('run_complete');
			name = t('finished_stop');
		}
		meta = [openingName, t('against_the', { who: t('level_in.' + who.id) })].filter(Boolean).join(' · ');
		state = r.clean && r.turn === 'opp' ? 'is-ok' : '';
		if (r.clean) tips = [`${t('clean_streak', { n: stats.streak })} ${t(mistakes.length ? 'comes_back' : 'go_again_hint')}`];
	} else {
		if (V.busy === 'check') eyebrow = t('checking');
		else if (V.busy === 'opp') eyebrow = t('opp_to_move');
		else if (V.mode === 'fix') eyebrow = t('fix_it', { i: fixAt + 1, n: mistakes.length });
		else eyebrow = t('your_move', { i: Math.min(moveNo, r.length), n: r.length });
		const side = t(r.color === 'w' ? 'white' : 'black');
		if (V.mode === 'fix' && r.fixing) {
			name = t('find_better', { move: r.fixing.playedSan });
			meta = `${openingName || t('before_opening')} · ${t('you_are', { side })}`;
		} else {
			name = openingName || t(r.moves.length ? 'no_opening_yet' : 'first_move');
			meta = `${r.opening ? r.opening.eco + ' · ' : ''}${t('side_against', { side, who: t('level_in.' + who.id) })}`;
		}
		if (V.engine === 'loading' && V.busy) meta = t('loading_engine');
		if (V.notice) tips = [V.notice];
	}
	prompt.className = 'prompt ' + state + (V.busy ? ' is-busy' : '');
	$('pEyebrow').textContent = eyebrow;
	$('pName').textContent = name;
	$('pMeta').textContent = meta;
	const tip = $('pTip');
	tip.textContent = '';
	tip.hidden = !tips.length;
	for (const text of tips) tip.append(h('p', { text }));

	// ----- the two lines after a stop
	const lines = $('pLines');
	lines.textContent = '';
	lines.hidden = !stop;
	if (stop) {
		for (const [key, text, cls] of [['played', t('you_played'), 'bad'], ['best', t('better'), 'good']]) {
			const row = h('div', { class: 'lrow ' + cls }, [h('span', { class: 'lab', text })]);
			stop.why[key].slice(0, 7).forEach((m, i) => {
				const on = !!V.shown && V.shown.line === key && V.shown.index === i;
				row.append(h('button', { class: 'chipmove', type: 'button', 'aria-pressed': String(on), text: label(m, i === 0), onclick: () => show(on ? null : { line: key, index: i }) }));
			});
			row.append(h('span', { class: 'lab', text: formatEval(key === 'best' ? stop.bestCp : stop.playedCp) }));
			lines.append(row);
		}
	}

	// ----- the buttons
	const actions = $('actions');
	actions.textContent = '';
	const act = (text, key, fn, primary) => actions.append(h('button', { class: 'act' + (primary ? ' primary' : ''), type: 'button', onclick: fn, 'data-key': key }, [text, h('kbd', { text: key })]));
	if (V.engine !== 'failed') {
		if (V.mode === 'fix') {
			if (stop) {
				act(t('try_again'), 'T', tryAgain);
				act(t(mistakes.length > 1 ? 'next_mistake' : 'back_to_play'), '↵', () => (mistakes.length > 1 ? startFix(1) : newRun()), true);
			} else if (V.fixed) {
				act(t(mistakes.length ? 'next_mistake' : 'back_to_play'), '↵', () => (mistakes.length ? startFix(0) : newRun()), true);
			}
		} else if (stop) {
			act(t('try_again'), 'T', tryAgain);
			act(t('new_run'), '↵', newRun, true);
		} else if (r.status === 'done') {
			act(t('new_run'), '↵', newRun, true);
		}
	}
	$('newBtn').hidden = actions.childElementCount > 0 && V.mode === 'play';
	$('newBtn').textContent = t(V.mode === 'fix' ? 'back_to_play' : 'new_run');

	// ----- this run's moves
	$('openingName').textContent = '';
	$('openingName').append(openingName || t('start_pos'), r.opening ? h('small', { text: r.opening.eco }) : '');
	const list = $('moveList');
	list.textContent = '';
	// An opponent's mistake is marked only once you have answered it: spotting it is the exercise
	const answered = (i) => i < r.moves.length - 1 || r.status !== 'play';
	const cells = r.moves.map((m, i) => ({ ...m, cls: m.by === 'setup' ? 'setup' : m.by === 'opp' && m.loss >= 10 && answered(i) ? 'slip' : '' }));
	if (stop) cells.push({ san: stop.playedSan, color: stop.color, number: stop.number, cls: 'bad' });
	for (let i = 0; i < cells.length; i++) {
		const m = cells[i];
		if (m.color === 'w' || i === 0) list.append(h('span', { class: 'n', text: m.number + '.' }));
		if (m.color === 'b' && i === 0) list.append(h('span', { class: 'm setup', text: '…' }));
		list.append(h('span', { class: 'm ' + m.cls, text: m.san + (m.cls === 'slip' ? '?' : '') }));
	}

	// ----- scores, and the mistakes waiting
	$('sClean').textContent = stats.runs ? `${stats.clean}/${stats.runs}` : '–';
	$('sStreak').textContent = stats.streak;
	$('sBest').textContent = stats.best;
	$('phoneStats').textContent = stats.runs ? t('phone_stats', { clean: stats.clean, runs: stats.runs, streak: stats.streak, best: stats.best }) : t('no_runs');
	const n = mistakes.length;
	$('fixText').textContent = n ? t('fix_text', { n }) : t('fix_none');
	for (const id of ['fixBtn', 'fixBtn2']) {
		$(id).disabled = !n;
		$(id).textContent = n ? t('fix_n', { n }) : t('fix_mistakes');
	}
}

function show(shown) {
	V.shown = shown;
	render();
}
// Step along the line being looked at; from the stop position, right starts the better line
function step(by) {
	const r = run();
	if (!r || r.status !== 'stopped') return;
	if (!V.shown) return by > 0 ? show({ line: 'best', index: 0 }) : undefined;
	const index = V.shown.index + by;
	if (index < 0) return show(null);
	if (index < Math.min(r.stop.why[V.shown.line].length, 7)) show({ line: V.shown.line, index });
}

// ------------------------------------------------------------------ controls
function seg(id, items, get, set) {
	const box = $(id);
	// (their words: data-i18n, so the language module puts them in the language picked)
	if (items) for (const item of items) box.append(h('button', { type: 'button', 'data-v': item.id, 'data-i18n': items.key + '.' + item.id, text: t(items.key + '.' + item.id) }));
	const paint = () => {
		for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(get())));
	};
	box.addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if (!b) return;
		set(b.dataset.v);
		saveSettings();
		paint();
		hints();
	});
	paint();
}
function hints() {
	$('levelHint').textContent = t('level_hint.' + opponent(S.level).id);
	$('strictHint').textContent = t('strict_hint.' + strictness(S.strict).id);
	const o = OPENINGS.find((x) => x.name === S.opening);
	$('openingHint').textContent = o ? t('opening_hint', { eco: o.eco }) : t('any_opening_hint');
}
// A new setting takes effect on the next run; if nothing has been played yet, that is now
const fresh = () => !run() || run().played === 0 || run().status !== 'play';
const applied = () => {
	if (V.mode === 'play' && fresh()) newRun();
};
seg('colorSeg', null, () => S.color, (v) => { S.color = v; applied(); });
seg('levelSeg', Object.assign([...OPPONENTS], { key: 'level' }), () => S.level, (v) => { S.level = v; applied(); });
seg('strictSeg', Object.assign([...STRICTNESS], { key: 'strict' }), () => S.strict, (v) => { S.strict = v; applied(); });
seg('lengthSeg', null, () => S.length, (v) => { S.length = Number(v); applied(); });
const pick = $('openingPick');
for (const group of [...new Set(OPENINGS.map((o) => o.group))]) {
	pick.append(h('optgroup', { label: group }, OPENINGS.filter((o) => o.group === group).map((o) => h('option', { value: o.name, text: o.name }))));
}
pick.value = S.opening;
pick.addEventListener('change', () => {
	S.opening = pick.value;
	saveSettings();
	hints();
	applied();
});
hints();

// a new language: everything this file draws is drawn again
lang.onChange(() => {
	hints();
	render();
});

const closeSheet = () => document.body.classList.remove('sheet-open');
$('settingsBtn').addEventListener('click', () => document.body.classList.toggle('sheet-open'));
$('closeSheet').addEventListener('click', closeSheet);
$('newBtn').addEventListener('click', newRun);
$('restartBtn').addEventListener('click', () => { closeSheet(); newRun(); });
for (const id of ['fixBtn', 'fixBtn2']) $(id).addEventListener('click', () => { closeSheet(); fixAt = 0; startFix(0); });
$('cleanBtn').addEventListener('click', () => { closeSheet(); document.body.classList.add('clean'); });
$('cleanExit').addEventListener('click', () => document.body.classList.remove('clean'));
$('howBtn').addEventListener('click', () => ($('intro').hidden = false));
$('introGo').addEventListener('click', () => {
	$('intro').hidden = true;
	saved.set('seen', true);
});

document.addEventListener('keydown', (e) => {
	if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('select, input, textarea')) return;
	if (!$('intro').hidden) {
		if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') $('introGo').click();
		return;
	}
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if (key === 'Escape') return closeSheet(), document.body.classList.remove('clean');
	if (key === 'n') return newRun();
	if (key === 't') return tryAgain();
	if (key === 'f') return (V.flip = !V.flip), render();
	if (key === 'ArrowRight') return step(1);
	if (key === 'ArrowLeft') return step(-1);
	if (key === 'Enter' || key === ' ') {
		const primary = document.querySelector('#actions .act.primary');
		if (primary) {
			e.preventDefault();
			// a focused button would fire on Enter as well: drop the focus so only the main button does
			if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
			primary.click();
		}
	}
});

// ------------------------------------------------------------------ start
engine.ready().then(() => {
	V.engine = 'ready';
	render();
});
if (!worker) V.engine = 'failed';
if (!saved.get('seen', false)) $('intro').hidden = false;
newRun();

// For the browser check (tools-src/chess-opening-trainer/verify/drive.cjs)
window.COT = {
	S,
	V,
	stats,
	trainer,
	engine,
	book,
	get mistakes() {
		return mistakes;
	},
	newRun,
	startFix,
	/** As if the engine had crashed */
	kill() {
		engineDied();
	},
	/** The engine's best and worst legal moves in the position on the board */
	async rank() {
		const result = await engine.analyse({ fen: trainer.run.chess.fen(), depth: 10, lines: 80, nodes: 800000 });
		return result.lines.map((l) => ({ uci: l.move, cp: l.cp }));
	},
};
