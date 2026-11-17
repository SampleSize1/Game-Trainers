/* Blackjack Trainer
 *
 * Two skills, each split into drills, each drill with three modes (Study, Practice, Test):
 *   Strategy  the best play for every hand against every dealer card (basic strategy)
 *   Counting  card values, running count, true count, index plays, and a full table to put it together
 *
 * The page is plain HTML built by this file; there is no framework and no build step.
 * data.js holds the expected value of every play (window.BJ_EV); the strategy charts are read off those
 * numbers here (decide), so the chart, the quiz answers and the "that cost you X%" notes can never disagree.
 * Settings, best scores and the hands you miss are saved in the browser through /js/progress.js.
 * Every word it shows is in text.js, looked up through the site's language module (/js/language.js).
 */
import { EN, t, useLanguage } from './text.js';

const lang = await SiteLanguage.open({ layers: [{ text: EN, files: new URL('lang/', import.meta.url) }] });
useLanguage(lang);

(function () {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const saved = window.SiteProgress
		? SiteProgress.tool('blackjack-trainer')
		: { get: (k, d) => d, set: () => {} };

	// ------------------------------------------------------------------ small helpers
	function h(tag, attrs, kids) {
		const el = document.createElement(tag);
		for (const k in attrs || {}) {
			const v = attrs[k];
			if (v == null || v === false) continue;
			if (k === 'class') el.className = v;
			else if (k === 'text') el.textContent = v;
			else if (k === 'html') el.innerHTML = v;
			else if (k === 'style') el.style.cssText = v;
			else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
			else el.setAttribute(k, v === true ? '' : v);
		}
		for (const kid of [].concat(kids || [])) if (kid) el.append(kid);
		return el;
	}
	const rnd = (n) => Math.floor(Math.random() * n);
	const pick = (arr) => arr[rnd(arr.length)];
	function shuffle(arr) {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = rnd(i + 1);
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	const signed = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0');
	const pct = (ev) => (ev >= 0 ? '+' : '−') + Math.abs(ev * 100).toFixed(1) + '%';
	const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
	const cap = (s) => s.charAt(0).toLocaleUpperCase(lang.tag) + s.slice(1);
	function decksText(x) {
		const whole = Math.floor(x + 1e-9);
		const frac = { 0: '', 25: '¼', 50: '½', 75: '¾' }[Math.round((x - whole) * 100)];
		if (frac === undefined) return x.toFixed(1);
		return (whole || !frac ? whole : '') + frac;
	}

	// ------------------------------------------------------------------ settings
	const S = {
		skill: 'strategy',
		section: { strategy: 'all', counting: 'values' },
		mode: { strategy: 'study', counting: 'study' },
		rules: { decks: 6, h17: false, das: true, surrender: true },
		system: 'hilo',
		group: 1, // running count: cards shown at a time
		speed: 1.2, // running count: seconds per flash
		len: 20, // running count: cards per round
		level: 'easy', // true count: easy shows deck marks on the tray
		others: 2, // full table: other players
		deal: 400, // full table: milliseconds per card
		indexPlays: false, // full table and bankroll: check plays against the Illustrious 18 / Fab 4 too (Hi-Lo)
		unit: 25, // bankroll: dollars per unit
		bank: 200, // bankroll: starting bankroll, in units
		peekChart: false, // strategy practice: show the chart while answering
	};
	(function load() {
		const s = saved.get('settings', null);
		if (!s || typeof s !== 'object') return;
		for (const k in S) {
			if (s[k] == null) continue;
			if (typeof S[k] === 'object') Object.assign(S[k], s[k]);
			else S[k] = s[k];
		}
	})();
	const saveSettings = () => saved.set('settings', S);
	const mode = () => S.mode[S.skill];
	const section = () => S.section[S.skill];

	// ------------------------------------------------------------------ cards
	const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
	const SUITS = ['s', 'h', 'd', 'c'];
	const pip = (c) => (c.r === 0 ? 11 : Math.min(c.r + 1, 10)); // blackjack value, ace as 11
	const val = (c) => Math.min(c.r, 9); // 0 ace, 1..8 = 2..9, 9 = any ten
	const isRed = (c) => c.s === 1 || c.s === 2;

	function newDecks(n) {
		const out = [];
		for (let d = 0; d < n; d++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) out.push({ r, s });
		return out;
	}
	/** A card worth `v` (0 ace, 1..8 = 2..9, 9 = ten) in a random suit; tens come as 10, J, Q or K. */
	const cardOf = (v) => ({ r: v === 9 ? 9 + rnd(4) : v, s: rnd(4) });

	function cardEl(c, extra) {
		if (!c) return h('div', { class: 'card back' + (extra ? ' ' + extra : ''), 'aria-label': t('card_back') });
		const svg = (cls) =>
			`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#suit-${SUITS[c.s]}"/></svg>`;
		const el = h('div', {
			class: 'card' + (isRed(c) ? ' red' : '') + (extra ? ' ' + extra : ''),
			'aria-label': t('card_aria', { rank: RANKS[c.r], suit: t('suit.' + SUITS[c.s]) }),
			html: `<span class="cr">${RANKS[c.r]}</span>${svg('cs')}${svg('cp')}`,
		});
		if (c.fresh) {
			el.classList.add('in');
			c.fresh = false;
		}
		return el;
	}
	function handTotal(cards) {
		let sum = 0;
		let aces = 0;
		for (const c of cards) {
			sum += c.r === 0 ? 1 : pip(c);
			if (c.r === 0) aces++;
		}
		const soft = aces > 0 && sum + 10 <= 21;
		return { t: soft ? sum + 10 : sum, soft };
	}

	// ------------------------------------------------------------------ strategy: the best play
	const UPS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
	const upIndex = (c) => (c.r === 0 ? 9 : pip(c) - 2);
	// a play in words: 'play.<letter>' in text.js ('Hit'), and mid-sentence 'play_word.<letter>' ('hit')
	const PAIRS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];

	/**
	 * The best play and the value of each one, for a hand (kind + key, as in data.js) against upcard `ui`.
	 * avail says what the rules allow right now: { double, split, surrender }.
	 */
	function decide(kind, key, ui, avail) {
		const R = S.rules;
		const row = window.BJ_EV[R.decks + (R.h17 ? 'H' : 'S')][kind][key];
		const a = Object.assign({ double: true, split: kind === 'pair', surrender: R.surrender }, avail);
		const ev = { H: row.H[ui], S: row.S[ui] };
		if (a.double) ev.D = row.D[ui];
		if (a.split && kind === 'pair') ev.P = (R.das ? row.P : row.N)[ui];
		if (a.surrender) ev.R = -0.5;
		let best = 'H';
		for (const k in ev) if (ev[k] > ev[best]) best = k;
		return { best, ev };
	}
	/** Chart code for a cell: H, S, D (else hit), Ds (else stand), P, Rh / Rs / Rp (surrender, else ...). */
	function chartCode(kind, key, ui) {
		const full = decide(kind, key, ui);
		const noR = decide(kind, key, ui, { surrender: false });
		const basic = decide(kind, key, ui, { double: false, split: false, surrender: false }).best;
		let code = noR.best === 'D' ? (basic === 'H' ? 'D' : 'Ds') : noR.best;
		if (full.best === 'R') code = 'R' + (noR.best === 'P' ? 'p' : basic.toLowerCase());
		return code;
	}
	// a chart code in words: 'code.<code>' in text.js ('Double (hit if you can’t)'), and mid-sentence 'code_word.<code>'

	function handName(kind, key) {
		if (kind === 'pair') return t('hand.pair', { cards: key === 'A' ? t('pair_aces') : t('pair_n', { n: key === 'T' ? '10' : key }) });
		return t('hand.' + kind, { n: key });
	}
	function upRanges(list) {
		const runs = [];
		for (const i of list) {
			const last = runs[runs.length - 1];
			if (last && last[1] === i - 1) last[1] = i;
			else runs.push([i, i]);
		}
		const bits = [];
		for (const [a, b] of runs) {
			if (b - a >= 2) bits.push(UPS[a] + '–' + UPS[b]);
			else for (let i = a; i <= b; i++) bits.push(UPS[i]);
		}
		return lang.join(bits);
	}
	/** The whole row in words, e.g. "Stand against 4–6. Otherwise hit." */
	function rowRule(kind, key) {
		const groups = {};
		UPS.forEach((_, i) => {
			const c = chartCode(kind, key, i);
			(groups[c] = groups[c] || []).push(i);
		});
		const names = Object.keys(groups);
		if (names.length === 1) return t('rule_always', { play: t('code_word.' + names[0]) });
		const bySize = (a, b) => groups[b].length - groups[a].length;
		const other = ['H', 'S'].filter((c) => groups[c]).sort(bySize)[0] || names.sort(bySize)[0];
		const parts = ['Rh', 'Rs', 'Rp', 'P', 'D', 'Ds', 'S', 'H']
			.filter((c) => groups[c] && c !== other)
			.map((c) => t('rule_against', { play: cap(t('code_word.' + c)), ups: upRanges(groups[c]) }));
		return parts.concat(t('rule_otherwise', { play: t('code_word.' + other) })).join(' ');
	}
	/** Which row of the tables a hand on the table belongs to (null: 21, nothing to decide). */
	function describe(cards) {
		const { t: total, soft } = handTotal(cards);
		if (cards.length === 2 && pip(cards[0]) === pip(cards[1])) {
			const p = pip(cards[0]);
			return { kind: 'pair', key: p === 11 ? 'A' : p === 10 ? 'T' : String(p) };
		}
		if (total >= 21) return null;
		return { kind: soft ? 'soft' : 'hard', key: total };
	}

	// ------------------------------------------------------------------ counting systems
	// Tag of each card value: ace, 2..9, ten. start(decks): where an unbalanced count starts a shoe.
	// (what each one is like, in words: 'system_note.<id>' in text.js)
	const SYSTEMS = {
		hilo: { name: 'Hi-Lo', tags: [-1, 1, 1, 1, 1, 1, 0, 0, 0, -1] },
		ko: {
			name: 'KO (Knock-Out)',
			tags: [-1, 1, 1, 1, 1, 1, 1, 0, 0, -1],
			start: (d) => 4 - 4 * d,
		},
		red7: {
			name: 'Red Seven',
			tags: [-1, 1, 1, 1, 1, 1, 0, 0, 0, -1],
			red7: true,
			start: (d) => -2 * d,
		},
		hiopt1: { name: 'Hi-Opt I', tags: [0, 0, 1, 1, 1, 1, 0, 0, 0, -1] },
		hiopt2: { name: 'Hi-Opt II', tags: [0, 1, 1, 2, 2, 1, 1, 0, 0, -2] },
		omega2: { name: 'Omega II', tags: [0, 1, 1, 2, 2, 2, 1, 0, -1, -2] },
		zen: { name: 'Zen Count', tags: [-1, 1, 1, 2, 2, 2, 1, 0, 0, -2] },
	};
	const sys = () => SYSTEMS[S.system] || SYSTEMS.hilo;
	const tagOf = (c, system) => {
		const y = system || sys();
		if (y.red7 && c.r === 6) return isRed(c) ? 1 : 0;
		return y.tags[val(c)];
	};
	const deckSum = (y) => newDecks(1).reduce((n, c) => n + tagOf(c, y), 0);
	const balanced = (y) => deckSum(y || sys()) === 0;
	const tagValues = (y) => {
		const set = new Set((y || sys()).tags);
		if ((y || sys()).red7) set.add(1);
		return [...set].sort((a, b) => a - b);
	};
	const tagClass = (n) => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'zero');

	// ------------------------------------------------------------------ the page: prompt, buttons, stats
	const felt = $('felt');
	let run = 0; // goes up whenever a drill (re)starts; anything still waiting from the old one stops
	let actions = []; // the buttons under the table right now
	let numberCb = null; // set while a count is being typed
	let numberBuf = { neg: false, digits: '' };
	let advance = null; // what Space / Enter does when there's no primary button
	const session = { right: 0, total: 0, streak: 0, t0: 0, frozen: null };
	const peek = {}; // the answer to the question on screen, for the automated checks in tools-src/

	function prompt(p) {
		const box = $('prompt');
		box.classList.toggle('is-ok', p.state === 'ok');
		box.classList.toggle('is-bad', p.state === 'bad');
		$('pEyebrow').textContent = p.eyebrow || eyebrow();
		$('pName').innerHTML = p.name || '';
		$('pMeta').innerHTML = p.meta || '&nbsp;';
		$('pBarWrap').classList.toggle('is-off', p.bar == null);
		if (p.bar != null) $('pBar').style.width = Math.round(p.bar * 100) + '%';
		$('pTip').hidden = !p.tip;
		$('pTip').innerHTML = p.tip || '';
		$('pEvs').hidden = !p.evs;
		if (p.evs) {
			$('pEvs').innerHTML = '';
			$('pEvs').append(h('small', { text: t('evs_caption') }));
			const list = Object.entries(p.evs).sort((a, b) => b[1] - a[1]);
			list.forEach(([k, v], i) => {
				$('pEvs').append(h('span', { class: i === 0 ? 'best' : '', text: t('play.' + k) }), h('b', { text: pct(v) }));
			});
		}
		if (!p.keepAnswer) $('answerBox').hidden = true;
	}
	function eyebrow() {
		const d = DRILLS[S.skill].find((x) => x.id === section());
		return t('skill.' + S.skill) + ' · ' + d.label + ' · ' + t('mode.' + mode());
	}
	const vs = (a, b) => `${a}<span class="vs">${t('vs')}</span>${b}`;

	/** Buttons under the table. Each: { id, label, key, color, primary, disabled, wide, on }. */
	function setActions(list) {
		actions = list || [];
		const box = $('actions');
		box.innerHTML = '';
		for (const a of actions) {
			a.el = h(
				'button',
				{
					class: 'act' + (a.primary ? ' primary' : '') + (a.wide ? ' wide' : '') + (a.bet ? ' bet' : ''),
					type: 'button',
					disabled: a.disabled,
					'data-c': a.color ? '' : null,
					style: a.color ? '--c: var(--' + a.color + ')' : null,
					onclick: () => a.on && a.on(a.id),
				},
				[document.createTextNode(a.label), a.sub ? h('small', { text: a.sub }) : null, a.key ? h('kbd', { text: a.key === ' ' ? t('key_space') : a.key.toUpperCase() }) : null]
			);
			box.append(a.el);
		}
	}
	const PLAY_BUTTONS = [
		{ id: 'H', key: 'h', color: 'hit' },
		{ id: 'S', key: 's', color: 'stand' },
		{ id: 'D', key: 'd', color: 'double' },
		{ id: 'P', key: 'p', color: 'split' },
		{ id: 'R', key: 'r', color: 'surrender' },
	];
	/** The play buttons; allow: which ones can be pressed; on: called with the play's letter. */
	function playButtons(allow, on) {
		return PLAY_BUTTONS.filter((b) => b.id !== 'R' || S.rules.surrender || allow.R).map((b) =>
			Object.assign({}, b, { label: t('play.' + b.id), disabled: !allow[b.id], on })
		);
	}
	const nextButton = (label, on) => ({ id: 'next', label, key: ' ', primary: true, on });

	/** Ask for a whole number (a count) with the keypad or the keyboard. */
	function askNumber(cb) {
		numberCb = cb;
		numberBuf = { neg: false, digits: '' };
		$('keypad').hidden = false;
		$('answerBox').hidden = false;
		$('answerBox').classList.add('is-active');
		showNumber();
	}
	function closeNumber(keepShown) {
		numberCb = null;
		$('keypad').hidden = true;
		$('answerBox').classList.remove('is-active');
		if (!keepShown) $('answerBox').hidden = true;
	}
	function showNumber() {
		const n = numberBuf.digits === '' ? null : Number(numberBuf.digits) * (numberBuf.neg ? -1 : 1);
		$('answerOut').textContent = n == null ? (numberBuf.neg ? '−' : '') : numberBuf.neg && n === 0 ? '−0' : signed(n);
	}
	function numberKey(k) {
		if (!numberCb) return false;
		if (/^[0-9]$/.test(k)) {
			if (numberBuf.digits.length < 3) numberBuf.digits = String(Number(numberBuf.digits + k));
		} else if (k === 'sign') numberBuf.neg = !numberBuf.neg;
		else if (k === '-') numberBuf.neg = true;
		else if (k === '+') numberBuf.neg = false;
		else if (k === 'back') {
			if (numberBuf.digits) numberBuf.digits = numberBuf.digits.slice(0, -1);
			else numberBuf.neg = false;
		} else if (k === 'enter') {
			if (numberBuf.digits === '') return true;
			const n = Number(numberBuf.digits) * (numberBuf.neg ? -1 : 1);
			const cb = numberCb;
			closeNumber(true);
			cb(n);
			return true;
		} else return false;
		showNumber();
		return true;
	}
	const waitNumber = () => new Promise((res) => askNumber(res));
	const waitAction = (list) =>
		new Promise((res) => setActions(list.map((a) => Object.assign({}, a, { on: (id) => res(id) }))));

	function mark(right) {
		session.total++;
		if (right) {
			session.right++;
			session.streak++;
		} else session.streak = 0;
		showStats();
	}
	function showStats() {
		$('sAcc').textContent = session.total ? Math.round((100 * session.right) / session.total) + '%' : '–';
		$('sStreak').textContent = session.streak;
		$('sTime').textContent = clock(elapsed());
	}
	const elapsed = () => (session.frozen != null ? session.frozen : session.t0 ? (Date.now() - session.t0) / 1000 : 0);
	const startClock = () => {
		session.t0 = Date.now();
		session.frozen = null;
	};
	const stopClock = () => {
		session.frozen = elapsed();
		return session.frozen;
	};
	setInterval(() => {
		if (session.t0 && session.frozen == null) $('sTime').textContent = clock(elapsed());
	}, 500);

	let toastTimer = 0;
	function toast(text, kind) {
		const box = $('toast');
		box.textContent = text;
		box.className = 'toast show' + (kind ? ' ' + kind : '');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (box.className = 'toast'), 2600);
	}

	// best scores, kept per drill and settings
	const bests = saved.get('best', {});
	function saveBest(key, result, better) {
		const old = bests[key];
		if (old && !better(result, old)) return false;
		bests[key] = result;
		saved.set('best', bests);
		return true;
	}

	// ------------------------------------------------------------------ strategy drills
	const KIND_OF = { hard: ['hard'], soft: ['soft'], pairs: ['pair'], all: ['hard', 'soft', 'pair'], trouble: ['hard', 'soft', 'pair'] };
	const CHART_ROWS = {
		hard: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => ({ key: n, label: n === 8 ? '5–8' : n === 18 ? '18+' : String(n) })),
		soft: [13, 14, 15, 16, 17, 18, 19, 20].map((n) => ({ key: n, label: 'A,' + (n - 11) })),
		pair: PAIRS.map((k) => ({ key: k, label: (k === 'T' ? '10' : k) + ',' + (k === 'T' ? '10' : k) })),
	};
	// (each kind's title: 'kind.<kind>' in text.js)
	const cellId = (c) => c.kind + ':' + c.key + ':' + c.ui;

	// how you've done on each hand: id -> [times seen, times missed, right answers in a row]
	const cellStats = saved.get('cells', {});
	function recordCell(c, right) {
		const s = cellStats[cellId(c)] || [0, 0, 0];
		s[0]++;
		if (right) s[2]++;
		else {
			s[1]++;
			s[2] = 0;
		}
		cellStats[cellId(c)] = s;
		saved.set('cells', cellStats);
	}
	const isTrouble = (id) => cellStats[id] && cellStats[id][1] > 0 && cellStats[id][2] < 2;
	function troubleCells() {
		return Object.keys(cellStats)
			.filter(isTrouble)
			.map((id) => {
				const [kind, key, ui] = id.split(':');
				return { kind, key: kind === 'pair' ? key : Number(key), ui: Number(ui) };
			});
	}
	/** Every hand of a section. Tests use the chart's rows; practice adds the easy totals, asked less often. */
	function cellsFor(sec, forTest) {
		if (sec === 'trouble') return troubleCells();
		const out = [];
		for (const kind of KIND_OF[sec]) {
			let keys;
			if (kind === 'hard') keys = forTest ? [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] : [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
			else if (kind === 'soft') keys = [13, 14, 15, 16, 17, 18, 19, 20];
			else keys = PAIRS;
			for (const key of keys) for (let ui = 0; ui < 10; ui++) out.push({ kind, key, ui });
		}
		return out;
	}
	function cellWeight(c) {
		let w = 1;
		if (c.kind === 'hard' && (c.key < 8 || c.key > 17)) w = 0.2;
		else if (c.kind === 'hard' && c.key === 8) w = 0.5;
		else if (c.kind === 'soft' && c.key > 18) w = 0.5;
		const s = cellStats[cellId(c)];
		if (s && s[1] && s[2] < 2) w *= 3; // missed and not yet right twice running
		return w;
	}
	function weightedPick(cells, not) {
		let sum = 0;
		for (const c of cells) sum += c === not ? 0 : cellWeight(c);
		let x = Math.random() * sum;
		for (const c of cells) {
			if (c === not) continue;
			x -= cellWeight(c);
			if (x <= 0) return c;
		}
		return cells[0];
	}
	/** Two cards that make the hand, and a dealer upcard. */
	function dealCell(c) {
		let cards;
		if (c.kind === 'pair') {
			const first = cardOf(c.key === 'A' ? 0 : c.key === 'T' ? 9 : Number(c.key) - 1);
			cards = [first, { r: first.r, s: (first.s + 1 + rnd(3)) % 4 }];
		} else if (c.kind === 'soft') cards = shuffle([cardOf(0), cardOf(c.key - 12)]);
		else {
			const opts = [];
			for (let a = 2; a <= 10; a++) {
				const b = c.key - a;
				if (b > a && b <= 10) opts.push([a, b]);
			}
			const [a, b] = opts.length ? pick(opts) : [c.key / 2, c.key / 2];
			cards = shuffle([cardOf(a - 1), cardOf(b - 1)]);
		}
		return { cards, up: cardOf(c.ui === 9 ? 0 : c.ui + 1) };
	}
	function duel(cards, up, extra, cls) {
		return h('div', { class: 'duel' + (cls ? ' ' + cls : '') }, [
			h('div', { class: 'tag', text: t('dealer') }),
			h('div', { class: 'hand dealer' }, [cardEl(up), cardEl(null)]),
			extra,
			h('div', { class: 'hand' }, cards.map((c) => cardEl(c))),
			h('div', { class: 'tag', text: t('you') }),
		]);
	}
	const withFresh = (d) => {
		for (const c of d.cards) c.fresh = true;
		d.up.fresh = true;
		return d;
	};

	function chartTable(kind, opt) {
		const tbl = h('table', { class: 'chart' });
		tbl.append(h('caption', { class: 'tag', text: t('kind.' + kind) }));
		tbl.append(
			h('tr', {}, [h('th', { class: 'rowh', text: '' })].concat(UPS.map((u) => h('th', { scope: 'col', text: u }))))
		);
		for (const row of CHART_ROWS[kind]) {
			const tr = h('tr', {}, [h('th', { class: 'rowh', scope: 'row', text: row.label })]);
			for (let ui = 0; ui < 10; ui++) {
				const c = { kind, key: row.key, ui };
				const code = chartCode(kind, row.key, ui);
				const b = h('button', {
					type: 'button',
					'data-cell': kind + ':' + row.key + ':' + ui,
					class: 'a-' + code[0] + (opt.miss && opt.miss(c) ? ' is-miss' : '') + (opt.dim && opt.dim(c) ? ' is-dim' : ''),
					text: code,
					'aria-label': t('cell_aria', { hand: handName(kind, row.key), up: UPS[ui], play: t('code.' + code) }),
					'aria-pressed': 'false',
					onclick: () => {
						felt.querySelectorAll('.chart button[aria-pressed="true"]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
						b.setAttribute('aria-pressed', 'true');
						showCell(c);
					},
				});
				tr.append(h('td', {}, b));
			}
			tbl.append(tr);
		}
		return tbl;
	}
	function chartLegend() {
		const item = (cls, code, text) => h('span', {}, [h('i', { class: cls, text: code }), document.createTextNode(text)]);
		return h('div', { class: 'legend' }, [
			item('a-H', 'H', t('legend.H')),
			item('a-S', 'S', t('legend.S')),
			item('a-D', 'D', t('legend.D')),
			item('a-D', 'Ds', t('legend.Ds')),
			item('a-P', 'P', t('legend.P')),
			S.rules.surrender ? item('a-R', 'R', t('legend.R')) : null,
		]);
	}
	function showCharts(sec, opt) {
		felt.className = 'felt is-top';
		felt.innerHTML = '';
		const wrap = h('div', { class: 'charts' });
		for (const kind of KIND_OF[sec]) wrap.append(chartTable(kind, opt || {}));
		wrap.append(chartLegend());
		felt.append(wrap);
		felt.scrollTop = 0;
	}
	/** One cell explained: the play, what each play is worth, and the rule for the whole row. */
	function showCell(c, head) {
		const code = chartCode(c.kind, c.key, c.ui);
		const d = decide(c.kind, c.key, c.ui);
		prompt({
			eyebrow: head,
			name: vs(rowLabel(c), UPS[c.ui]),
			meta: t('code.' + code),
			evs: d.ev,
			tip: '<b>' + rowLabel(c) + ':</b> ' + rowRule(c.kind, c.key),
		});
	}
	const rowLabel = (c) => (c.kind === 'hard' && c.key === 8 ? handName('hard', '5–8') : c.kind === 'hard' && c.key === 18 ? handName('hard', '18+') : handName(c.kind, c.key));
	const dealerRule = () => t(S.rules.h17 ? 'dealer_h17' : 'dealer_s17');
	const rulesText = () =>
		[t('n_decks', { n: S.rules.decks }), dealerRule(), S.rules.das ? null : t('no_das'), S.rules.surrender ? null : t('no_surrender')].filter(Boolean).join(', ');

	const strategy = {
		study() {
			const sec = section();
			const trouble = sec === 'trouble' ? new Set(troubleCells().map(cellId)) : null;
			showCharts(sec, { dim: trouble ? (c) => !trouble.has(cellId(c)) : null });
			prompt({
				name: t(sec === 'trouble' ? 'trouble_spots' : 'basic_strategy'),
				meta: rulesText(),
				tip: t(sec === 'trouble' && !trouble.size ? 'trouble_empty' : 'chart_tip'),
			});
			setActions([nextButton(t('practise_these'), () => setMode('practice'))]);
		},

		practice() {
			const sec = section();
			const cells = cellsFor(sec, false);
			if (!cells.length) return emptyTrouble();
			startClock();
			const due = []; // misses waiting to come back: { c, at }
			let asked = 0;
			let last = null;
			const ask = () => {
				let c;
				const i = due.findIndex((x) => x.at <= asked);
				if (i >= 0) c = due.splice(i, 1)[0].c;
				else c = cells.length > 1 ? weightedPick(cells, last) : cells[0];
				last = c;
				asked++;
				const d = withFresh(dealCell(c));
				felt.className = 'felt' + (S.peekChart ? ' is-top' : '');
				felt.innerHTML = '';
				felt.append(duel(d.cards, d.up, null, S.peekChart ? 'small' : ''));
				if (S.peekChart) {
					// the chart for this kind of hand, with this hand's square outlined
					const rowKey = c.kind === 'hard' ? Math.min(18, Math.max(8, c.key)) : c.key;
					const wrap = h('div', { class: 'charts' }, chartTable(c.kind, {}));
					felt.append(wrap);
					const cell = wrap.querySelector(`[data-cell="${c.kind}:${rowKey}:${c.ui}"]`);
					if (cell) cell.setAttribute('aria-pressed', 'true');
					felt.scrollTop = 0;
				}
				prompt({
					name: vs(handName(c.kind, c.key), UPS[c.ui]),
					meta: session.total ? t('n_answered', { n: session.total }) + (due.length ? ' · ' + t('to_come_back', { n: due.length }) : '') : t('best_play_q'),
				});
				peek.answer = decide(c.kind, c.key, c.ui).best;
				const allow = { H: true, S: true, D: true, P: c.kind === 'pair', R: S.rules.surrender };
				advance = null;
				setActions(playButtons(allow, (id) => answer(c, id)));
			};
			const answer = (c, id) => {
				const d = decide(c.kind, c.key, c.ui);
				const right = id === d.best;
				mark(right);
				recordCell(c, right);
				fillRail();
				for (const a of actions) {
					a.el.disabled = true;
					if (a.id === d.best) a.el.classList.add('is-right');
					else if (a.id === id) a.el.classList.add('is-wrong');
				}
				const rule = '<b>' + rowLabel(c) + ':</b> ' + rowRule(c.kind, c.key);
				if (right) {
					prompt({ state: 'ok', eyebrow: t('correct'), name: vs(handName(c.kind, c.key), UPS[c.ui]), meta: t('play.' + d.best), tip: rule });
					const my = run;
					advance = ask;
					setTimeout(() => my === run && advance === ask && ask(), 650);
				} else {
					due.push({ c, at: asked + 3 + rnd(3) });
					const cost = (d.ev[d.best] - d.ev[id]) * 100;
					prompt({
						state: 'bad',
						eyebrow: t('not_quite'),
						name: vs(handName(c.kind, c.key), UPS[c.ui]),
						meta: t('you_said_play', { said: t('play_word.' + id), best: t('play_word.' + d.best) }),
						evs: d.ev,
						tip: rule + ` <span class="miss">${costText(cost)}</span>`,
					});
					advance = ask;
					$('actions').append(nextAfter(ask));
				}
			};
			ask();
		},

		test() {
			const sec = section();
			const cells = shuffle(cellsFor(sec, true));
			if (!cells.length) return emptyTrouble();
			const misses = [];
			let i = 0;
			let started = false;
			const ask = () => {
				if (i >= cells.length) return finish();
				const c = cells[i];
				const d = withFresh(dealCell(c));
				felt.className = 'felt';
				felt.innerHTML = '';
				felt.append(duel(d.cards, d.up));
				prompt({
					name: t('whats_the_play'),
					meta: t('n_of', { i: i + 1, n: cells.length }),
					bar: i / cells.length,
					tip: started ? '' : t('strategy_test_tip'),
				});
				peek.answer = decide(c.kind, c.key, c.ui).best;
				const allow = { H: true, S: true, D: true, P: c.kind === 'pair', R: S.rules.surrender };
				setActions(playButtons(allow, (id) => answer(c, id)));
			};
			const answer = (c, id) => {
				if (!started) {
					started = true;
					startClock();
				}
				const right = id === decide(c.kind, c.key, c.ui).best;
				mark(right);
				recordCell(c, right);
				if (!right) misses.push(c);
				flash(right);
				i++;
				ask();
			};
			const finish = () => {
				const time = stopClock();
				const score = cells.length - misses.length;
				const key = 'strategy.' + sec + '.' + ruleKey();
				const isBest = saveBest(key, { score, total: cells.length, time }, (a, b) => a.score > b.score || (a.score === b.score && a.time < b.time));
				fillRail();
				showBest();
				const missed = new Set(misses.map(cellId));
				showCharts(sec === 'trouble' ? 'all' : sec, { miss: (c) => missed.has(cellId(c)) });
				prompt({
					state: misses.length ? null : 'ok',
					eyebrow: t('test_complete'),
					name: `${score} / ${cells.length}`,
					meta: `${Math.round((100 * score) / cells.length)}% · ${clock(time)}${newBest(isBest)}`,
					bar: 1,
					tip: misses.length ? t('misses_outlined', { n: misses.length }) : t('perfect_run'),
				});
				const list = [nextButton(t('go_again'), start)];
				if (misses.length)
					list.push({ id: 'misses', label: t('practise_misses'), wide: true, on: () => {
						S.section.strategy = 'trouble';
						setMode('practice');
					} });
				setActions(list);
			};
			ask();
		},
	};
	function emptyTrouble() {
		felt.className = 'felt';
		felt.innerHTML = '';
		felt.append(h('p', { class: 'note', html: t('no_trouble') }));
		prompt({ name: t('nothing_to_fix'), meta: t('pick_another') });
		setActions([]);
	}
	const costText = (cost) => (cost < 0.05 ? t('near_coin_flip') : t('costs_about', { pct: cost.toFixed(1) }));
	/** ' · new best' after a result, when it is one */
	const newBest = (yes) => (yes ? ' · ' + t('new_best') : '');
	/** The Next button put up after a wrong answer, beside the marked play buttons */
	const nextAfter = (on) => h('button', { class: 'act primary', type: 'button', onclick: on }, [document.createTextNode(t('next')), h('kbd', { text: t('key_space') })]);
	const ruleKey = () => S.rules.decks + (S.rules.h17 ? 'H' : 'S') + (S.rules.das ? 'd' : '') + (S.rules.surrender ? 'r' : '');
	/** A quick green or red blink round the table, for tests (no pause, no explanation). */
	function flash(right) {
		const box = $('stageBox');
		box.classList.remove('flash-ok', 'flash-bad');
		void box.offsetWidth;
		box.classList.add(right ? 'flash-ok' : 'flash-bad');
		setTimeout(() => box.classList.remove('flash-ok', 'flash-bad'), 300);
	}

	// ------------------------------------------------------------------ counting: card values
	function valueGroupsText() {
		const y = sys();
		const names = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10, J, Q, K'];
		return tagValues(y)
			.slice()
			.reverse()
			.map((n) => {
				const list = names.filter((_, v) => y.tags[v] === n && !(y.red7 && v === 6));
				if (y.red7 && n === 1) list.push(t('red_7'));
				if (y.red7 && n === 0) list.unshift(t('black_7'));
				return t('value_group', { value: signed(n), cards: list.join(', ') });
			})
			.join(' · ');
	}
	function balanceText() {
		const y = sys();
		const sum = deckSum(y);
		return sum === 0 ? t('deck_zero') : t('deck_unbalanced', { sum: signed(sum) });
	}
	const values = {
		study() {
			const y = sys();
			felt.className = 'felt';
			felt.innerHTML = '';
			const figs = [];
			const add = (c) => figs.push(h('figure', {}, [cardEl(c), h('figcaption', { class: tagClass(tagOf(c)), text: signed(tagOf(c)) })]));
			for (let v = 1; v <= 9; v++) {
				if (y.red7 && v === 6) {
					add({ r: 6, s: 1 });
					add({ r: 6, s: 0 });
				} else add({ r: v, s: v % 4 });
			}
			add({ r: 0, s: 0 });
			felt.append(h('div', { class: 'values', style: y.red7 ? 'grid-template-columns: repeat(4, auto)' : null }, figs));
			felt.append(h('p', { class: 'note', html: t('face_same') }));
			prompt({
				name: t('system_values', { system: y.name }),
				meta: balanceText(),
				tip: valueGroupsText() + '. ' + t('values_why'),
			});
			setActions([nextButton(t('practise_these'), () => setMode('practice'))]);
		},
		practice() {
			startClock();
			const due = [];
			let asked = 0;
			let last = -1;
			const ask = () => {
				let c;
				const i = due.findIndex((x) => x.at <= asked);
				if (i >= 0) c = due.splice(i, 1)[0].c;
				else
					do c = { r: rnd(13), s: rnd(4) };
					while (c.r === last);
				last = c.r;
				asked++;
				oneCard(c, ask, (right) => !right && due.push({ c: { r: c.r, s: c.s }, at: asked + 2 + rnd(3) }), t('n_answered', { n: session.total }));
			};
			ask();
		},
		test() {
			const deck = shuffle(newDecks(1));
			let i = 0;
			let wrong = 0;
			let started = false;
			const ask = () => {
				if (i >= deck.length) {
					const time = stopClock();
					const key = 'values.' + S.system;
					const isBest = saveBest(key, { score: 52 - wrong, total: 52, time }, (a, b) => a.score > b.score || (a.score === b.score && a.time < b.time));
					showBest();
					felt.innerHTML = '';
					felt.append(h('div', { class: 'bigcount', text: `${52 - wrong} / 52` }));
					prompt({
						state: wrong ? null : 'ok',
						eyebrow: t('test_complete'),
						name: t('n_seconds', { n: time.toFixed(1) }),
						meta: t('right_of', { n: 52 - wrong, total: 52 }) + newBest(isBest),
						bar: 1,
						tip: t(wrong ? 'values_retry' : 'values_perfect'),
					});
					return setActions([nextButton(t('go_again'), start)]);
				}
				const c = deck[i];
				oneCard(c, ask, (right) => {
					if (!started) {
						started = true;
						startClock();
					}
					if (!right) wrong++;
					i++;
				}, t('n_of', { i: i + 1, n: 52 }), i / 52, true);
			};
			ask();
		},
	};
	/** One card, one question: what does it count? quick = no pause on a wrong answer (tests). */
	function oneCard(c, next, after, meta, bar, quick) {
		c.fresh = true;
		felt.className = 'felt';
		felt.innerHTML = '';
		felt.append(h('div', { class: 'flash' }, cardEl(c)));
		prompt({ name: t('card_q'), meta, bar });
		const vals = tagValues();
		peek.answer = tagOf(c);
		advance = null;
		setActions(
			vals.map((v, i) => ({
				id: v,
				label: signed(v),
				key: String(i + 1),
				on: (id) => {
					const truth = tagOf(c);
					const right = id === truth;
					mark(right);
					after(right);
					if (quick) {
						flash(right);
						return next();
					}
					for (const a of actions) {
						a.el.disabled = true;
						if (a.id === truth) a.el.classList.add('is-right');
						else if (a.id === id) a.el.classList.add('is-wrong');
					}
					const my = run;
					advance = next;
					if (right) setTimeout(() => my === run && advance === next && next(), 380);
					else {
						prompt({ state: 'bad', eyebrow: t('not_quite'), name: t('counts', { card: RANKS[c.r], value: signed(truth) }), meta, tip: valueGroupsText() + '.' });
						$('actions').append(nextAfter(next));
					}
				},
			}))
		);
	}

	// ------------------------------------------------------------------ counting: running count
	function stripOf(cards, upto, now) {
		let n = 0;
		return h(
			'div',
			{ class: 'strip' },
			cards.slice(0, upto).map((c, i) => {
				n += tagOf(c);
				return h('figure', { class: i === now ? 'is-now' : '' }, [cardEl(c), h('figcaption', { text: signed(n) })]);
			})
		);
	}
	const running = {
		study() {
			const cards = shuffle(newDecks(1)).slice(0, 20);
			let shown = 0;
			const draw = () => {
				const count = cards.slice(0, shown).reduce((n, c) => n + tagOf(c), 0);
				felt.className = 'felt';
				felt.innerHTML = '';
				felt.append(h('div', { class: 'chip' }, [h('small', { text: t('running_count') }), h('b', { text: signed(count) })]));
				if (shown) cards[shown - 1].fresh = true;
				felt.append(stripOf(cards, shown, shown - 1));
				const c = cards[shown - 1];
				prompt({
					name: shown ? t('counts', { card: RANKS[c.r], value: signed(tagOf(c)) }) : t('keep_one'),
					meta: shown ? t('card_of', { i: shown, n: cards.length, count: signed(count) }) : t('start_at_zero'),
					bar: shown / cards.length,
					tip: t('running_tip'),
				});
				setActions([
					shown < cards.length
						? nextButton(t(shown ? 'next_card' : 'deal_first'), () => {
								shown++;
								draw();
						  })
						: nextButton(t('deal_again'), start),
					{ id: 'go', label: t('practise'), wide: true, on: () => setMode('practice') },
				]);
			};
			draw();
		},

		async practice() {
			const my = run;
			const cards = shuffle(newDecks(S.len > 52 ? 2 : 1)).slice(0, S.len);
			felt.className = 'felt';
			felt.innerHTML = '';
			felt.append(h('p', { class: 'note', html: t('running_setup', { len: S.len, n: S.group, speed: S.speed.toFixed(1).replace('.0', '') }) }));
			prompt({ name: t('running_count'), meta: t('press_start'), tip: t('running_practice_tip') });
			await waitAction([nextButton(t('start'))]);
			if (my !== run) return;
			setActions([]);
			startClock();
			for (let i = 0; i < cards.length; i += S.group) {
				const part = cards.slice(i, i + S.group);
				part.forEach((c) => (c.fresh = true));
				felt.innerHTML = '';
				felt.append(h('div', { class: 'flash g' + S.group }, part.map((c) => cardEl(c))));
				prompt({ name: t('keep_count'), meta: t('n_of', { i: Math.min(i + S.group, cards.length), n: cards.length }), bar: (i + part.length) / cards.length });
				await sleep(S.speed * 1000);
				if (my !== run) return;
				felt.innerHTML = '';
				await sleep(70);
				if (my !== run) return;
			}
			stopClock();
			const truth = cards.reduce((n, c) => n + tagOf(c), 0);
			peek.answer = truth;
			felt.append(h('p', { class: 'note', text: t('all_dealt') }));
			prompt({ name: t('whats_running'), meta: t('type_it'), keepAnswer: true });
			const said = await waitNumber();
			if (my !== run) return;
			const right = said === truth;
			mark(right);
			felt.className = 'felt is-top';
			felt.innerHTML = '';
			felt.append(stripOf(cards, cards.length, -1));
			prompt({
				state: right ? 'ok' : 'bad',
				eyebrow: t(right ? 'correct' : 'not_quite'),
				name: t('count_is', { n: signed(truth) }),
				meta: right ? t('cards_at', { len: S.len, speed: S.speed.toFixed(1).replace('.0', '') }) : t('you_said', { n: signed(said) }),
				keepAnswer: false,
				tip: t(right ? (session.streak >= 3 ? 'three_in_row' : 'shown_below') : 'shown_below_slip'),
			});
			setActions([nextButton(t('again'), start)]);
		},

		/** The classic benchmark: count down a whole deck with one card held back, as fast as you can. */
		async test() {
			const my = run;
			const deck = shuffle(newDecks(1));
			const hidden = deck.pop();
			const y = sys();
			felt.className = 'felt';
			felt.innerHTML = '';
			felt.append(h('div', { class: 'flash' }, cardEl(null)));
			felt.append(h('p', { class: 'note', html: t('countdown_note') }));
			prompt({ name: t('deck_countdown'), meta: t('countdown_goal'), tip: t('countdown_tip', { sum: signed(deckSum(y)) }) });
			await waitAction([nextButton(t('flip'))]);
			if (my !== run) return;
			startClock();
			for (let i = 0; i < deck.length; i += S.group) {
				const part = deck.slice(i, i + S.group);
				part.forEach((c) => (c.fresh = true));
				felt.innerHTML = '';
				felt.append(h('div', { class: 'flash g' + S.group }, part.map((c) => cardEl(c))));
				prompt({ name: t('keep_count'), meta: t('n_of', { i: Math.min(i + S.group, deck.length), n: deck.length }), bar: (i + part.length) / deck.length });
				await waitAction([nextButton(t(i + S.group >= deck.length ? 'done' : 'flip'))]);
				if (my !== run) return;
			}
			const time = stopClock();
			const truth = deck.reduce((n, c) => n + tagOf(c), 0);
			peek.answer = truth;
			felt.innerHTML = '';
			felt.append(h('div', { class: 'flash' }, cardEl(null)));
			setActions([]);
			prompt({ name: t('whats_running'), meta: t('n_seconds', { n: time.toFixed(1) }), keepAnswer: true });
			const said = await waitNumber();
			if (my !== run) return;
			const right = said === truth;
			mark(right);
			const key = 'countdown.' + S.system + '.' + S.group;
			const isBest = right && saveBest(key, { time }, (a, b) => a.time < b.time);
			showBest();
			hidden.fresh = true;
			felt.innerHTML = '';
			felt.append(h('div', { class: 'flash' }, cardEl(hidden)));
			felt.append(h('p', { class: 'note', html: t('held_back', { sum: signed(truth), held: signed(deckSum(y) - truth) }) }));
			prompt({
				state: right ? 'ok' : 'bad',
				eyebrow: t(right ? 'correct' : 'not_quite'),
				name: t('n_seconds', { n: time.toFixed(1) }),
				meta: right ? t('count_n', { n: signed(truth) }) + newBest(isBest) : t('count_was', { truth: signed(truth), said: signed(said) }),
				tip: t(right ? (time <= 30 ? 'casino_speed' : 'under_30') : 'speed_counts'),
			});
			setActions([nextButton(t('go_again'), start)]);
		},
	};

	// ------------------------------------------------------------------ counting: true count
	function trayEl(dealt, decks, marks, small) {
		const hgt = small ? 96 : Math.min(210, 60 + decks * 22);
		const ticks = h('div', { class: 'ticks' });
		if (marks) for (let d = 1; d <= decks; d++) ticks.append(h('span', { style: `bottom:${(100 * d) / decks}%`, text: String(d) }));
		return h('div', { class: 'tray', style: `--h:${hgt}px; --fill:${(100 * dealt) / decks}%`, role: 'img', 'aria-label': t('discard_tray') }, [h('div', { class: 'stack' }), ticks]);
	}
	function tcScenario() {
		const decks = S.rules.decks;
		const step = S.level === 'easy' ? 0.5 : 0.25;
		const maxDealt = decks - (decks > 2 ? 1 : 0.5);
		const dealt = step * (1 + rnd(Math.round(maxDealt / step)));
		const left = decks - dealt;
		// a count that could really happen: early in a shoe it can't have run far yet
		const cap = Math.min(30, Math.floor(dealt * 26));
		let rc = 0;
		while (rc === 0) rc = Math.max(-cap, Math.min(cap, Math.round((Math.random() * 13 - 5) * left)));
		const exact = rc / left;
		const est = rc / Math.max(0.5, Math.round(left * 2) / 2);
		return { decks, dealt, left, rc, exact, lo: Math.floor(Math.min(exact, est) + 1e-9), hi: Math.ceil(Math.max(exact, est) - 1e-9) };
	}
	function tcView(q, showAnswer) {
		felt.className = 'felt';
		felt.innerHTML = '';
		const easy = S.level === 'easy' || showAnswer;
		felt.append(
			h('div', { class: 'trayrow' }, [
				h('div', { class: 'trayside' }, [h('div', { class: 'tag', text: t('running_count') }), h('div', { class: 'bigcount', text: signed(q.rc) })]),
				h('div', {}, [
					trayEl(q.dealt, q.decks, easy),
					h('div', { class: 'traycap', html: easy ? t('tray_easy', { dealt: decksText(q.dealt), n: q.decks }) : t('tray_hard', { n: q.decks }) }),
				]),
			])
		);
	}
	const tcAnswer = (q) => (q.lo === q.hi ? signed(q.lo) : lang.join([signed(q.lo), signed(q.hi)], 'or'));
	const tcWork = (q) =>
		t('tc_work', { n: q.decks, dealt: decksText(q.dealt), left: decksText(q.left), rc: signed(q.rc), tc: (q.exact >= 0 ? '+' : '−') + Math.abs(q.exact).toFixed(1) });
	function unbalancedNote(what) {
		const y = sys();
		felt.className = 'felt';
		felt.innerHTML = '';
		felt.append(h('p', { class: 'note', html: t('unbalanced_1', { system: y.name, sum: signed(deckSum(y)) }) }));
		felt.append(h('p', { class: 'note', html: what ? t('unbalanced_play', { drill: what }) : t('unbalanced_practise') }));
		prompt({ name: what ? t('needs_tc', { drill: what }) : t('not_needed', { system: y.name }), meta: t('for_balanced') });
		setActions([]);
	}
	const trueCount = {
		study() {
			if (!balanced()) return unbalancedNote();
			const q = tcScenario();
			tcView(q, true);
			prompt({
				name: t('true_count_is', { n: tcAnswer(q) }),
				meta: t('tc_formula'),
				tip: tcWork(q) + ' ' + t('tc_tip'),
			});
			setActions([nextButton(t('another_example'), start), { id: 'go', label: t('practise'), wide: true, on: () => setMode('practice') }]);
		},
		practice() {
			if (!balanced()) return unbalancedNote();
			startClock();
			const ask = async () => {
				const my = run;
				const q = tcScenario();
				peek.answer = q.lo;
				tcView(q, false);
				prompt({ name: t('whats_true'), meta: session.total ? t('n_answered', { n: session.total }) : t('tc_short'), keepAnswer: true });
				setActions([]);
				const said = await waitNumber();
				if (my !== run) return;
				const right = said >= q.lo && said <= q.hi;
				mark(right);
				tcView(q, true);
				prompt({
					state: right ? 'ok' : 'bad',
					eyebrow: t(right ? 'correct' : 'not_quite'),
					name: t('true_count_is', { n: tcAnswer(q) }),
					meta: right ? '&nbsp;' : t('you_said', { n: signed(said) }),
					tip: tcWork(q),
				});
				advance = ask;
				setActions([nextButton(t('next'), ask)]);
			};
			ask();
		},
		test() {
			if (!balanced()) return unbalancedNote();
			const total = 20;
			let i = 0;
			let wrong = 0;
			let started = false;
			const ask = async () => {
				const my = run;
				if (i >= total) {
					const time = stopClock();
					const key = 'true.' + S.rules.decks + '.' + S.level;
					const isBest = saveBest(key, { score: total - wrong, total, time }, (a, b) => a.score > b.score || (a.score === b.score && a.time < b.time));
					showBest();
					felt.innerHTML = '';
					felt.append(h('div', { class: 'bigcount', text: `${total - wrong} / ${total}` }));
					prompt({
						state: wrong ? null : 'ok',
						eyebrow: t('test_complete'),
						name: clock(time),
						meta: t('right_of', { n: total - wrong, total }) + newBest(isBest),
						bar: 1,
						tip: t(S.level === 'easy' ? 'tc_easy_tip' : 'tc_hard_tip'),
					});
					return setActions([nextButton(t('go_again'), start)]);
				}
				const q = tcScenario();
				peek.answer = q.lo;
				tcView(q, false);
				prompt({ name: t('whats_true'), meta: t('n_of', { i: i + 1, n: total }), bar: i / total, keepAnswer: true });
				setActions([]);
				const said = await waitNumber();
				if (my !== run) return;
				if (!started) {
					started = true;
					startClock();
				}
				const right = said >= q.lo && said <= q.hi;
				mark(right);
				if (!right) wrong++;
				flash(right);
				i++;
				ask();
			};
			ask();
		},
	};

	// ------------------------------------------------------------------ counting: index plays
	// Don Schlesinger's Illustrious 18 and Fab 4 (Hi-Lo, shoe game, dealer stands on soft 17):
	// at a true count of `at` or more make the `hi` play, below it the `lo` play.
	const INDEX_PLAYS = [
		{ id: 'ins', up: 9, at: 3, hi: 'Y', lo: 'N' },
		{ id: '16vT', total: 16, up: 8, at: 0, hi: 'S', lo: 'H' },
		{ id: '15vT', total: 15, up: 8, at: 4, hi: 'S', lo: 'H' },
		{ id: 'TTv5', pair: 9, up: 3, at: 5, hi: 'P', lo: 'S' },
		{ id: 'TTv6', pair: 9, up: 4, at: 4, hi: 'P', lo: 'S' },
		{ id: '10vT', total: 10, up: 8, at: 4, hi: 'D', lo: 'H' },
		{ id: '12v3', total: 12, up: 1, at: 2, hi: 'S', lo: 'H' },
		{ id: '12v2', total: 12, up: 0, at: 3, hi: 'S', lo: 'H' },
		{ id: '11vA', total: 11, up: 9, at: 1, hi: 'D', lo: 'H' },
		{ id: '9v2', total: 9, up: 0, at: 1, hi: 'D', lo: 'H' },
		{ id: '10vA', total: 10, up: 9, at: 4, hi: 'D', lo: 'H' },
		{ id: '9v7', total: 9, up: 5, at: 3, hi: 'D', lo: 'H' },
		{ id: '16v9', total: 16, up: 7, at: 5, hi: 'S', lo: 'H' },
		{ id: '13v2', total: 13, up: 0, at: -1, hi: 'S', lo: 'H' },
		{ id: '12v4', total: 12, up: 2, at: 0, hi: 'S', lo: 'H' },
		{ id: '12v5', total: 12, up: 3, at: -2, hi: 'S', lo: 'H' },
		{ id: '12v6', total: 12, up: 4, at: -1, hi: 'S', lo: 'H' },
		{ id: '13v3', total: 13, up: 1, at: -2, hi: 'S', lo: 'H' },
		{ id: 's14vT', total: 14, up: 8, at: 3, hi: 'R', lo: 'H', fab: true },
		{ id: 's15vT', total: 15, up: 8, at: 0, hi: 'R', lo: 'H', fab: true },
		{ id: 's15v9', total: 15, up: 7, at: 2, hi: 'R', lo: 'H', fab: true },
		{ id: 's15vA', total: 15, up: 9, at: 1, hi: 'R', lo: 'H', fab: true },
	];
	// (Y and N, taking insurance or not, are plays too: 'play.Y' in text.js)
	const devName = (p) => (p.id === 'ins' ? t('insurance') : t('dev_vs', { hand: p.pair != null ? '10,10' : p.total, up: UPS[p.up] }));
	/** The rule for an index play: "16 vs 10: stand at a true count of 0 or more, otherwise hit." short: without the hand */
	const devRule = (p, short) => {
		if (p.id === 'ins') return t('ins_rule');
		const rule = t('dev_rule', { hi: t('play_word.' + p.hi), at: signed(p.at), lo: t('play_word.' + p.lo) });
		return short ? rule : t('dev_rule_full', { hand: cap(devName(p)), rule });
	};
	const devList = () => INDEX_PLAYS.filter((p) => !p.fab || S.rules.surrender);
	function devCards(p) {
		if (p.id === 'ins') {
			const total = 12 + rnd(8);
			return dealCell({ kind: 'hard', key: total, ui: 9 });
		}
		if (p.pair != null) return dealCell({ kind: 'pair', key: 'T', ui: p.up });
		return dealCell({ kind: 'hard', key: p.total, ui: p.up });
	}
	function notHiLo() {
		felt.className = 'felt';
		felt.innerHTML = '';
		felt.append(h('p', { class: 'note', html: t('not_hilo', { system: sys().name }) }));
		prompt({ name: t('hilo_only'), meta: t('index_depends') });
		setActions([]);
	}
	function devAsk(p, tc, meta, bar, onAnswer) {
		const d = withFresh(devCards(p));
		felt.className = 'felt';
		felt.innerHTML = '';
		felt.append(duel(d.cards, d.up, h('div', { class: 'tcbadge', html: t('tc_badge', { n: signed(tc) }) })));
		prompt({ name: p.id === 'ins' ? t('insurance_q') : vs(p.pair != null ? handName('pair', 'T') : handName('hard', p.total), UPS[p.up]), meta, bar });
		const truth = tc >= p.at ? p.hi : p.lo;
		peek.answer = truth;
		advance = null;
		if (p.id === 'ins')
			setActions([
				{ id: 'Y', label: t('play.Y'), key: 'y', wide: true, on: (id) => onAnswer(id, truth) },
				{ id: 'N', label: t('play.N'), key: 'n', wide: true, on: (id) => onAnswer(id, truth) },
			]);
		else setActions(playButtons({ H: true, S: true, D: !p.fab, P: p.pair != null, R: !!p.fab }, (id) => onAnswer(id, truth)).filter((b) => b.id !== 'R' || p.fab));
	}
	const deviations = {
		study() {
			if (S.system !== 'hilo') return notHiLo();
			felt.className = 'felt is-top';
			felt.innerHTML = '';
			const tbl = h('table', { class: 'devs' });
			tbl.append(h('tr', {}, ['th_hand', 'th_tc', 'th_at_above', 'th_below'].map((x) => h('th', { text: t(x) }))));
			const row = (p) => h('tr', {}, [h('td', { text: devName(p) }), h('td', { class: 'ix', text: signed(p.at) }), h('td', { text: t('play.' + p.hi) }), h('td', { text: t('play.' + p.lo) })]);
			tbl.append(h('tr', { class: 'grp' }, h('td', { colspan: 4, text: t('illustrious') })));
			INDEX_PLAYS.filter((p) => !p.fab).forEach((p) => tbl.append(row(p)));
			if (S.rules.surrender) {
				tbl.append(h('tr', { class: 'grp' }, h('td', { colspan: 4, text: t('fab4') })));
				INDEX_PLAYS.filter((p) => p.fab).forEach((p) => tbl.append(row(p)));
			}
			felt.append(tbl);
			prompt({ name: t('index_title'), meta: t('index_meta'), tip: t('index_tip') });
			setActions([nextButton(t('practise_these'), () => setMode('practice'))]);
		},
		practice() {
			if (S.system !== 'hilo') return notHiLo();
			startClock();
			const list = devList();
			const due = [];
			let asked = 0;
			let last = null;
			const ask = () => {
				let p;
				const i = due.findIndex((x) => x.at <= asked);
				if (i >= 0) p = due.splice(i, 1)[0].p;
				else
					do p = pick(list);
					while (p === last);
				last = p;
				asked++;
				const tc = Math.random() < 0.5 ? p.at + pick([0, 0, 1, 2]) : p.at - pick([1, 1, 2, 3]);
				devAsk(p, tc, session.total ? t('n_answered', { n: session.total }) : t('index_q'), null, (id, truth) => {
					const right = id === truth;
					mark(right);
					for (const a of actions) {
						a.el.disabled = true;
						if (a.id === truth) a.el.classList.add('is-right');
						else if (a.id === id) a.el.classList.add('is-wrong');
					}
					if (!right) due.push({ p, at: asked + 2 + rnd(3) });
					prompt({
						state: right ? 'ok' : 'bad',
						eyebrow: t(right ? 'correct' : 'not_quite'),
						name: t('play.' + truth),
						meta: t('index_result', { tc: signed(tc), at: signed(p.at) }),
						tip: devRule(p),
					});
					const my = run;
					advance = ask;
					if (right) setTimeout(() => my === run && advance === ask && ask(), 900);
					else $('actions').append(nextAfter(ask));
				});
			};
			ask();
		},
		test() {
			if (S.system !== 'hilo') return notHiLo();
			// every play twice: once at or above its index, once below
			const qs = shuffle(devList().flatMap((p) => [{ p, tc: p.at + pick([0, 0, 1]) }, { p, tc: p.at - pick([1, 1, 2]) }]));
			let i = 0;
			let started = false;
			const missed = [];
			const ask = () => {
				if (i >= qs.length) {
					const time = stopClock();
					const score = qs.length - missed.length;
					const key = 'index.' + (S.rules.surrender ? 'r' : 'n');
					const isBest = saveBest(key, { score, total: qs.length, time }, (a, b) => a.score > b.score || (a.score === b.score && a.time < b.time));
					showBest();
					felt.className = 'felt is-top';
					felt.innerHTML = '';
					felt.append(h('div', { class: 'bigcount', text: `${score} / ${qs.length}` }));
					if (missed.length) {
						const tbl = h('table', { class: 'devs' });
						tbl.append(h('tr', { class: 'grp' }, h('td', { colspan: 2, text: t('missed') })));
						[...new Set(missed)].forEach((p) => tbl.append(h('tr', {}, [h('td', { text: devName(p) }), h('td', { text: devRule(p, true) })])));
						felt.append(tbl);
					}
					prompt({ state: missed.length ? null : 'ok', eyebrow: t('test_complete'), name: `${score} / ${qs.length}`, meta: clock(time) + newBest(isBest), bar: 1 });
					return setActions([nextButton(t('go_again'), start)]);
				}
				const q = qs[i];
				devAsk(q.p, q.tc, t('n_of', { i: i + 1, n: qs.length }), i / qs.length, (id, truth) => {
					if (!started) {
						started = true;
						startClock();
					}
					const right = id === truth;
					mark(right);
					if (!right) missed.push(q.p);
					flash(right);
					i++;
					ask();
				});
			};
			ask();
		},
	};

	// ------------------------------------------------------------------ counting: the bet spread and the long run
	// How much to bet at each true count, in units: [true count at or above, units]. Below the first rung: 1 unit.
	// A 1–8 spread for double deck, 1–12 for a shoe: the ramps most counting courses teach.
	const spreadFor = (decks) => (decks <= 2 ? [[1, 1], [2, 2], [3, 4], [4, 8]] : [[1, 1], [2, 2], [3, 4], [4, 8], [5, 12]]);
	function betUnits(tc, decks) {
		let u = 1;
		for (const [at, n] of spreadFor(decks)) if (tc >= at) u = n;
		return u;
	}
	const rungs = (decks) => [1].concat(spreadFor(decks).map((r) => r[1]).filter((n) => n > 1));
	const money = (units) => {
		const d = units * S.unit;
		const abs = Math.abs(d);
		const txt = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 }) : abs % 1 ? abs.toFixed(2) : String(abs);
		return (d < 0 ? '−' : '') + '$' + txt;
	};
	const signedMoney = (units) => (units > 0 ? '+' : '') + money(units);

	/**
	 * The house edge for the current rules, playing perfect basic strategy from a full shoe: the average
	 * result of a hand, in bets. Worked out from the same numbers as the chart.
	 */
	function houseEdge() {
		const R = S.rules;
		const n = R.decks * 52;
		const count = (v) => (v === 9 ? 16 : 4) * R.decks; // cards of each value in the shoe
		let total = 0;
		for (let u = 0; u < 10; u++) {
			const pUp = count(u) / n;
			const bar = u === 0 ? 9 : u === 9 ? 0 : -1; // the hole card that makes a dealer blackjack
			const pBJ = bar < 0 ? 0 : count(bar) / (n - 1);
			const ui = u === 0 ? 9 : u - 1;
			let ev = 0;
			for (let a = 0; a < 10; a++)
				for (let b = a; b < 10; b++) {
					const ca = count(a) - (a === u ? 1 : 0);
					const cb = count(b) - (b === u ? 1 : 0) - (a === b ? 1 : 0);
					const p = (a === b ? ca * cb / 2 : ca * cb) / (((n - 1) * (n - 2)) / 2);
					if ((a === 0 && b === 9)) {
						ev += p * 1.5 * (1 - pBJ); // blackjack: paid 3:2 unless the dealer has one too (push)
						continue;
					}
					const kind = a === b ? 'pair' : a === 0 ? 'soft' : 'hard';
					const key = kind === 'pair' ? PAIRS[a === 0 ? 9 : a === 9 ? 8 : a - 1] : kind === 'soft' ? 12 + b : a + b + 2;
					const d = decide(kind, key, ui);
					ev += p * (d.ev[d.best] * (1 - pBJ) - pBJ);
				}
			total += pUp * ev;
		}
		return total;
	}
	/** How often each true count comes up at the start of a round, from dealing out many shoes. */
	function trueCountFreq(decks, players) {
		const freq = {};
		const perRound = 2.8 + 2.7 * players; // cards a round uses, on average
		let rounds = 0;
		for (let shoe = 0; shoe < 1500; shoe++) {
			const cards = shuffle(newDecks(decks));
			const cut = Math.floor(cards.length * 0.75);
			let pos = 0;
			let rc = 0;
			while (pos < cut) {
				const tc = Math.floor(rc / Math.max(0.5, Math.round(((cards.length - pos) / 52) * 2) / 2));
				freq[tc] = (freq[tc] || 0) + 1;
				rounds++;
				const take = Math.max(3, Math.round(perRound + (Math.random() - 0.5) * 3));
				for (let i = 0; i < take && pos < cards.length; i++) rc += SYSTEMS.hilo.tags[val(cards[pos++])];
			}
		}
		for (const k in freq) freq[k] /= rounds;
		return freq;
	}
	const EDGE_PER_TC = 0.005; // rule of thumb: each true count point is worth about half a percent to the player
	const edgeAt = (base, tc) => base + EDGE_PER_TC * tc;

	// ------------------------------------------------------------------ counting: full table and bankroll
	/**
	 * A real game. Full table: you play your hand by basic strategy and keep the count as the cards go round.
	 * Bankroll: the same table with money on it. You size each bet from the count, and the session tracks
	 * what you win or lose against what the bets should have made.
	 */
	async function tableGame() {
		const my = run;
		const alive = () => my === run;
		const md = mode();
		const cash = section() === 'bankroll';
		const y = sys();
		const R = S.rules;
		if (cash && !balanced(y)) return unbalancedNote(t('drill.bankroll'));
		const firstCount = () => (y.start ? y.start(R.decks) : 0);
		const indexed = S.indexPlays && S.system === 'hilo';
		let shoe = shuffle(newDecks(R.decks));
		let pos = 0;
		const cut = Math.floor(shoe.length * 0.75);
		let rc = firstCount();
		let round = 0;
		const plays = { right: 0, total: 0 };
		const bets = { right: 0, total: 0 };
		const checks = []; // test: { said, truth }
		const bank = { start: S.bank, now: S.bank, history: [S.bank], expected: 0, hands: 0, shoes: 0 };
		const base = cash ? houseEdge() : 0;
		let dealer = { cards: [], hidden: true };
		let seats = [];
		let turn = null; // the hand being played
		let bet = 1; // your bet this round, in units
		let insurance = 0; // your insurance bet, in units
		let lastNet = null;
		const pause = (f) => sleep(S.deal * (f || 1));

		const draw = (faceUp) => {
			const c = shoe[pos++];
			c.fresh = true;
			if (faceUp !== false) rc += tagOf(c);
			return c;
		};
		const decksLeft = () => (shoe.length - pos) / 52;
		const trueNow = () => rc / Math.max(0.5, decksLeft());
		// the true count as a player would work it out: decks left to the nearest half, rounded down
		const trueEst = () => Math.floor(rc / Math.max(0.5, Math.round(decksLeft() * 2) / 2));
		const trueExact = () => Math.floor(trueNow());

		function render() {
			felt.className = 'felt';
			felt.innerHTML = '';
			const handBox = (hand, seat) => {
				const box = h('div', { class: 'handbox' + (hand === turn ? ' is-turn' : '') });
				box.append(h('div', { class: 'hand' + (seat.you ? ' spread' : '') }, hand.cards.map((c, i) => cardEl(c, hand.doubled && i === 2 ? 'side' : ''))));
				// hand.res is how the hand ended ('Win', 'Bust'…), shown in words as 'res.<how>'
				const res = hand.res ? t('res.' + hand.res) + (seat.you && hand.net != null ? ' ' + signedMoney(hand.net) : '') : '';
				box.append(h('div', { class: 'res ' + (hand.cls || ''), text: res }));
				return box;
			};
			const live = [];
			if (md === 'study') {
				live.push(h('div', { class: 'chip' }, [h('small', { text: t('running') }), h('b', { text: signed(rc) })]));
				if (balanced(y)) live.push(h('div', { class: 'chip' }, [h('small', { text: t('true') }), h('b', { text: (trueNow() >= 0 ? '+' : '−') + Math.abs(trueNow()).toFixed(1) })]));
			}
			if (cash) {
				const diff = bank.now - bank.start;
				live.push(h('div', { class: 'chip' }, [h('small', { text: t('chip.bankroll') }), h('b', { text: money(bank.now) }), h('i', { class: diff > 0 ? 'plus' : diff < 0 ? 'minus' : 'zero', text: signedMoney(diff) })]));
				if (round && bet) live.push(h('div', { class: 'chip' }, [h('small', { text: t('bet') }), h('b', { text: money(bet) })]));
			}
			const you = seats.find((s) => s.you);
			const total = you && you.hands[0].cards.length ? handTotal((turn && you.hands.includes(turn) ? turn : you.hands[0]).cards) : null;
			felt.append(
				h('div', { class: 'table' }, [
					h('div', { class: 'livecount' }, live),
					h('div', { class: 'minitray' }, [trayEl(pos / 52, R.decks, false, true), h('div', { class: 'seatlabel', text: t('discards') })]),
					h('div', { class: 'dealerbox' }, [
						h('div', { class: 'seatlabel', text: t('dealer') }),
						h('div', { class: 'hand spread' }, dealer.cards.map((c, i) => (i === 1 && dealer.hidden ? cardEl(null) : cardEl(c)))),
					]),
					h('div', { class: 'others' }, seats.filter((s) => !s.you).map((s, i) => h('div', { class: 'seat' }, [h('div', { class: 'hands' }, s.hands.map((hd) => handBox(hd, s))), h('div', { class: 'seatlabel', text: t('seat_n', { n: i + 1 }) })]))),
					h('div', {}),
					you
						? h('div', { class: 'you' }, [
								h('div', { class: 'hands' }, you.hands.map((hd) => handBox(hd, you))),
								h('div', { class: 'seatlabel', text: t('you') + (md === 'study' && total ? ' · ' + t(total.soft ? 'total_soft' : 'total_hard', { n: total.t }) : '') }),
						  ])
						: null,
				])
			);
		}
		const roundBits = () => {
			const bits = [t('round_n', { n: round })];
			if (cash && bets.total) bits.push(t('bets_x', { right: bets.right, total: bets.total }));
			if (plays.total) bits.push(t('plays_x', { right: plays.right, total: plays.total }));
			return bits;
		};
		const roundMeta = () => roundBits().join(' · ');
		const say = (name, meta, extra) => prompt(Object.assign({ name, meta: meta || roundMeta(), bar: md === 'test' && !cash ? Math.min(1, pos / cut) : null }, extra));

		const canDo = (seat, hand) => {
			const two = hand.cards.length === 2;
			return {
				double: two && !hand.splitAces && (!hand.split || R.das),
				split: two && pip(hand.cards[0]) === pip(hand.cards[1]) && seat.hands.length < 4 && !hand.splitAces,
				surrender: R.surrender && two && !hand.split,
			};
		};
		/** The index play for this hand at this count, if one applies and index plays are on. */
		const indexFor = (seat, hand) => {
			if (!indexed) return null;
			const can = canDo(seat, hand);
			const { t: total, soft } = handTotal(hand.cards);
			if (soft) return null;
			const ui = upIndex(dealer.cards[0]);
			const pair = hand.cards.length === 2 && pip(hand.cards[0]) === pip(hand.cards[1]);
			const tc = trueExact();
			for (const p of INDEX_PLAYS) {
				if (p.id === 'ins' || p.up !== ui) continue;
				if (p.pair != null) {
					if (!(pair && pip(hand.cards[0]) === 10 && can.split)) continue;
				} else if (p.total !== total || (pair && pip(hand.cards[0]) === 8)) continue;
				if (p.fab && !can.surrender) continue;
				if (p.hi === 'D' && !can.double) continue;
				const play = tc >= p.at ? p.hi : p.lo;
				return { play, p, tc };
			}
			return null;
		};
		const bestFor = (seat, hand) => {
			const d = describe(hand.cards);
			if (!d) return null;
			const out = Object.assign(decide(d.kind, d.key, upIndex(dealer.cards[0]), canDo(seat, hand)), d);
			const ix = indexFor(seat, hand);
			if (ix) {
				out.best = ix.play;
				out.index = ix;
			}
			return out;
		};
		/** Play one seat to the end. choose(seat, hand) gives the play: basic strategy for the others, your buttons for you. */
		async function playSeat(seat, choose) {
			for (let i = 0; i < seat.hands.length; i++) {
				const hand = seat.hands[i];
				turn = hand;
				if (hand.cards.length === 1) {
					// the second card of a split hand
					hand.cards.push(draw());
					render();
					await pause();
					if (!alive()) return;
					if (hand.splitAces) continue;
				}
				while (!hand.done) {
					if (handTotal(hand.cards).t >= 21) break;
					const act = await choose(seat, hand);
					if (!alive()) return;
					if (act === 'S') hand.done = true;
					else if (act === 'R') {
						hand.done = hand.surrendered = true;
						hand.res = 'Surrender';
						hand.cls = 'lose';
					} else if (act === 'H' || act === 'D') {
						hand.cards.push(draw());
						if (act === 'D') hand.doubled = hand.done = true;
						if (handTotal(hand.cards).t > 21) {
							hand.done = true;
							hand.res = 'Bust';
							hand.cls = 'lose';
						}
					} else if (act === 'P') {
						const aces = hand.cards[0].r === 0;
						const second = { cards: [hand.cards.pop()], split: true, splitAces: aces };
						hand.split = true;
						hand.splitAces = aces;
						seat.hands.splice(i + 1, 0, second);
						hand.cards.push(draw());
						if (aces) hand.done = true;
					}
					render();
					await pause();
					if (!alive()) return;
				}
				hand.done = true;
			}
			turn = null;
		}
		const autoChoose = async (seat, hand) => {
			const b = bestFor(seat, hand);
			return b ? b.best : 'S';
		};
		const youChoose = async (seat, hand) => {
			render();
			const can = canDo(seat, hand);
			// doubling or splitting needs the money
			if (cash) {
				const afford = bank.now - bet * (seat.hands.length + seat.hands.filter((x) => x.doubled).length);
				if (afford < bet) can.double = can.split = false;
			}
			say(t('your_play'));
			const b = bestFor(seat, hand);
			peek.answer = (b || { best: 'S' }).best;
			const act = await waitAction(playButtons({ H: true, S: true, D: can.double, P: can.split, R: can.surrender }));
			if (!alive()) return 'S';
			setActions([]);
			if (b) {
				const right = act === b.best;
				plays.total++;
				if (right) plays.right++;
				else if (md !== 'test') {
					if (b.index)
						toast(t('toast_index', { hand: devName(b.index.p), tc: signed(b.index.tc), play: t('play_word.' + b.best), at: signed(b.index.p.at) }), 'bad');
					else {
						const cost = (b.ev[b.best] - b.ev[act]) * 100;
						toast(t('toast_basic', { play: t('play_word.' + b.best), hand: lang.midSentence(handName(b.kind, b.key)), up: UPS[upIndex(dealer.cards[0])], cost: cost.toFixed(1) }), 'bad');
					}
				}
			}
			say(t('keep_count'));
			return act;
		};

		/** Bankroll: pick the bet for the next round from the count. */
		async function placeBet() {
			const est = trueEst();
			const want = betUnits(est, R.decks);
			const alsoOk = betUnits(trueExact(), R.decks); // if the decks-left estimate is borderline, either answer is fair
			peek.answer = want;
			const max = Math.floor(bank.now);
			say(
				t(round ? 'place_bet' : 'place_first'),
				md === 'study' ? t('spread_says', { tc: signed(est), n: want }) : t('hand_n', { n: round + 1 }) + (bets.total ? ' · ' + t('bets_x', { right: bets.right, total: bets.total }) : ''),
				md === 'study' && round ? { tip: t('bet_tip', { rc: signed(rc), left: decksText(Math.round(decksLeft() * 2) / 2) }) } : {}
			);
			const list = rungs(R.decks).map((u) => ({
				id: u,
				label: money(u),
				sub: t('n_units', { n: u }),
				bet: true,
				disabled: u > max,
				primary: md === 'study' && u === want,
			}));
			if (max < 1) return null;
			const chosen = await waitAction(list);
			if (!alive()) return null;
			setActions([]);
			bets.total++;
			const right = chosen === want || chosen === alsoOk;
			if (right) bets.right++;
			else if (md !== 'test') toast(t('toast_bet', { tc: signed(est), n: want, money: money(want), bet: chosen }), 'bad');
			bank.expected += chosen * edgeAt(base, est);
			return chosen;
		}
		/** Bankroll: the summary at the end of a shoe. Returns true to keep playing. */
		async function sessionSummary(broke) {
			bank.shoes++;
			const net = bank.now - bank.start;
			const key = 'bankroll.' + R.decks + '.' + S.others;
			const score = (r) => r.betsRight / Math.max(1, r.bets) + r.plays / Math.max(1, r.playsTotal);
			const result = { hands: bank.hands, net, betsRight: bets.right, bets: bets.total, plays: plays.right, playsTotal: plays.total };
			const isBest = saveBest(key, result, (a, b) => score(a) > score(b) || (score(a) === score(b) && a.net > b.net));
			showBest();
			fillRail();
			felt.className = 'felt is-top';
			felt.innerHTML = '';
			// bankroll over the session
			const hist = bank.history;
			const lo = Math.min(...hist);
			const hi = Math.max(...hist);
			const W = 560;
			const H = 120;
			const px = (i) => (i / Math.max(1, hist.length - 1)) * W;
			const py = (v) => (hi === lo ? H / 2 : H - ((v - lo) / (hi - lo)) * (H - 10) - 5);
			const pts = hist.map((v, i) => px(i).toFixed(1) + ',' + py(v).toFixed(1)).join(' ');
			felt.append(
				h('div', { class: 'spark', html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${py(bank.start).toFixed(1)}" y2="${py(bank.start).toFixed(1)}" class="base"/><polyline points="${pts}" class="${net >= 0 ? 'up' : 'down'}"/></svg><div class="sparkcap"><span>${t('spark_start', { money: money(hist[0]) })}</span><span>${t('n_hands', { n: hist.length - 1 })}</span><span>${t('spark_now', { money: money(bank.now) })}</span></div>` })
			);
			const tbl = h('table', { class: 'devs' });
			const row = (a, b, cls) => tbl.append(h('tr', {}, [h('td', { text: t(a) }), h('td', { class: 'ix ' + (cls || ''), html: b })]));
			const units = (n) => t('units_value', { n: (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1) });
			row('row_result', signedMoney(net) + ` (${units(net)})`, net > 0 ? 'plus' : net < 0 ? 'minus' : '');
			row('row_expected', signedMoney(bank.expected) + ` <small>${units(bank.expected)}</small>`);
			row('row_bets', `${bets.right}/${bets.total}`, bets.right === bets.total ? 'plus' : '');
			row('row_plays', `${plays.right}/${plays.total}`, plays.right === plays.total ? 'plus' : '');
			row('row_shoes', String(bank.shoes));
			felt.append(tbl);
			const luck = net - bank.expected;
			const bits = roundBits();
			prompt({
				state: broke ? 'bad' : bets.right === bets.total && plays.right === plays.total ? 'ok' : null,
				eyebrow: t(broke ? 'out_of_money' : 'shoe_complete'),
				name: t('over_hands', { net: signedMoney(net), n: bank.hands }),
				// the bets and plays so far, without the round
				meta: isBest ? t('new_best_session') : (bits.length > 1 ? bits.slice(1) : bits).join(' · '),
				bar: 1,
				tip:
					t('luck', { expected: signedMoney(bank.expected), luck: signedMoney(luck) }) + ' ' +
					(bets.right === bets.total && plays.right === plays.total
						? t('all_skill')
						: t('mostly_luck') + ' ' + (bets.right < bets.total ? t('count_lost') : '')),
			});
			if (broke) {
				await waitAction([nextButton(t('new_session'), start)]);
				return false;
			}
			const pick = await waitAction([nextButton(t('next_shoe')), { id: 'new', label: t('new_session'), wide: true }]);
			if (!alive()) return false;
			if (pick === 'new') {
				start();
				return false;
			}
			return true;
		}

		while (alive()) {
			// ---- shuffle when the cut card has come out
			if (pos >= cut || round === 0) {
				if (round > 0 && cash) {
					if (!(await sessionSummary(false))) return;
					if (!alive()) return;
				} else if (round > 0 && md === 'test') break;
				shoe = shuffle(newDecks(R.decks));
				pos = 0;
				rc = firstCount();
				dealer = { cards: [], hidden: true };
				seats = [];
				render();
				const startText = y.start ? t('starts_at', { system: y.name, n: R.decks, count: signed(firstCount()) }) : t('starts_zero');
				const steps = spreadFor(R.decks).slice(1);
				// the last step reads "or more" when it is the top of the ramp (double deck: the shoe ramp goes one higher)
				const stepText = steps.map(([at, n], i) => t(i === steps.length - 1 && R.decks <= 2 ? 'spread_step_more' : 'spread_step', { n, tc: signed(at) })).join(', ');
				const spreadText = t('spread_text', { money: money(1), tc: signed(1), steps: stepText });
				prompt({
					name: round ? t('shuffle') : t(cash ? 'drill.bankroll' : 'drill.table'),
					meta: [t('n_decks', { n: R.decks }), t('n_others', { n: S.others }), dealerRule()].join(' · ') + (cash ? ' · ' + t('unit_of', { money: money(1) }) : ''),
					tip:
						(round ? t('cut_card') + ' ' : '') +
						startText +
						' ' +
						(cash
							? spreadText + ' ' + t('cash_' + md) + (indexed ? ' ' + t('index_on') : '')
							: t('table_' + md)),
				});
				await waitAction([nextButton(t(round ? 'deal' : cash ? 'sit_down' : 'deal'))]);
				if (!alive()) return;
				if (round === 0) startClock();
			}
			// ---- the bet
			if (cash) {
				const chosen = await placeBet();
				if (!alive()) return;
				if (chosen == null) {
					await sessionSummary(true);
					return;
				}
				bet = chosen;
				insurance = 0;
			}
			round++;
			// ---- deal
			seats = [];
			for (let i = 0; i < S.others; i++) seats.push({ hands: [{ cards: [] }] });
			seats.push({ you: true, hands: [{ cards: [] }] });
			dealer = { cards: [], hidden: true };
			turn = null;
			setActions([]);
			say(t('keep_count'));
			for (let n = 0; n < 2; n++) {
				for (const s of seats) {
					s.hands[0].cards.push(draw());
					render();
					await pause(0.7);
					if (!alive()) return;
				}
				dealer.cards.push(draw(n === 0));
				render();
				await pause(0.7);
				if (!alive()) return;
			}
			for (const s of seats) {
				const hd = s.hands[0];
				if (handTotal(hd.cards).t === 21) {
					hd.done = hd.blackjack = true;
					hd.res = 'Blackjack';
					hd.cls = 'win';
				}
			}
			render();
			// ---- insurance, offered when the dealer shows an ace (bankroll only)
			if (cash && dealer.cards[0].r === 0 && bank.now - bet >= bet / 2) {
				const tc = trueExact();
				const want = indexed && tc >= 3 ? 'Y' : 'N';
				peek.answer = want;
				say(t('insurance_q'), md === 'study' ? t(want === 'Y' ? 'ins_meta_yes' : 'ins_meta_no', { tc: signed(tc) }) : null, {
					tip: md === 'study' ? t(indexed ? 'ins_index_tip' : 'ins_basic_tip') : '',
				});
				const pick = await waitAction([
					{ id: 'Y', label: t('play.Y'), key: 'y', wide: true, sub: money(bet / 2) },
					{ id: 'N', label: t('play.N'), key: 'n', wide: true },
				]);
				if (!alive()) return;
				setActions([]);
				plays.total++;
				if (pick === want) plays.right++;
				else if (md !== 'test') toast(indexed ? t(want === 'Y' ? 'toast_ins_yes' : 'toast_ins_no', { tc: signed(tc) }) : t('toast_ins_never'), 'bad');
				if (pick === 'Y') insurance = bet / 2;
				say(t('keep_count'));
			}
			const dealerBJ = handTotal(dealer.cards).t === 21;
			if (!dealerBJ) {
				for (const s of seats) {
					if (s.hands[0].blackjack) continue;
					await playSeat(s, s.you ? youChoose : autoChoose);
					if (!alive()) return;
				}
			}
			// ---- dealer: turn the hole card over (it counts now), then draw
			turn = null;
			dealer.hidden = false;
			dealer.cards[1].fresh = true;
			rc += tagOf(dealer.cards[1]);
			render();
			await pause(1.2);
			if (!alive()) return;
			const anyLive = seats.some((s) => s.hands.some((hd) => !hd.blackjack && !hd.surrendered && handTotal(hd.cards).t <= 21));
			if (anyLive && !dealerBJ) {
				for (;;) {
					const d = handTotal(dealer.cards);
					if (d.t > 17 || (d.t === 17 && !(d.soft && R.h17))) break;
					dealer.cards.push(draw());
					render();
					await pause();
					if (!alive()) return;
				}
			}
			// ---- results
			const dt = handTotal(dealer.cards).t;
			let net = 0;
			for (const s of seats)
				for (const hd of s.hands) {
					if (!hd.res || hd.blackjack) {
						const mine = handTotal(hd.cards).t;
						let res;
						if (hd.blackjack) res = dealerBJ ? 'Push' : 'Blackjack';
						else if (dealerBJ) res = 'Lose';
						else res = dt > 21 || mine > dt ? 'Win' : mine < dt ? 'Lose' : 'Push';
						hd.res = res;
						hd.cls = res === 'Win' || res === 'Blackjack' ? 'win' : res === 'Lose' ? 'lose' : '';
					}
					if (cash && s.you) {
						const stake = bet * (hd.doubled ? 2 : 1);
						hd.net = hd.res === 'Blackjack' ? bet * 1.5 : hd.res === 'Win' ? stake : hd.res === 'Push' ? 0 : hd.res === 'Surrender' ? -bet / 2 : -stake;
						net += hd.net;
					}
				}
			if (cash) {
				if (insurance) net += dealerBJ ? insurance * 2 : -insurance;
				bank.now += net;
				bank.hands++;
				bank.history.push(bank.now);
				lastNet = net;
			}
			render();
			const lastRound = pos >= cut;
			// ---- the count
			if (cash) {
				const insText = insurance ? ' ' + (dealerBJ ? t('ins_paid', { money: signedMoney(insurance * 2) }) : t('ins_lost', { money: money(insurance) })) : '';
				if (md === 'study') {
					say(t('round_over_net', { net: signedMoney(net) }), null, { tip: t('next_bet', { rc: signed(rc), left: decksText(Math.round(decksLeft() * 2) / 2), tc: signed(trueEst()), n: betUnits(trueEst(), R.decks) }) + insText });
					await waitAction([nextButton(t(lastRound ? 'shuffle' : 'next_hand'))]);
				} else {
					say(t('round_over_net', { net: signedMoney(net) }), null, { tip: insText });
					await sleep(Math.max(600, S.deal * 2.5));
				}
			} else if (md === 'study') {
				say(t('round_over'), null, { tip: balanced(y) ? t('rc_tc', { rc: signed(rc), left: decksText(Math.round(decksLeft() * 2) / 2), tc: signed(Math.round(trueNow())) }) : t('rc_only', { rc: signed(rc) }) });
				await waitAction([nextButton(t(lastRound ? 'shuffle' : 'next_round'))]);
			} else if (md === 'practice' || lastRound || round === 1 || Math.random() < 0.45) {
				say(t('whats_running'), null, { keepAnswer: true });
				peek.answer = rc;
				const said = await waitNumber();
				if (!alive()) return;
				if (md === 'test') {
					checks.push({ said, truth: rc, round });
					say(t('noted'), t('round_n', { n: round }) + ' · ' + t('checks_so_far', { n: checks.length }));
					await sleep(350);
				} else {
					const right = said === rc;
					mark(right);
					const left = Math.round(decksLeft() * 2) / 2;
					say(t('count_is', { n: signed(rc) }), right ? null : t('you_said', { n: signed(said) }), {
						state: right ? 'ok' : 'bad',
						eyebrow: t(right ? 'correct' : 'not_quite'),
						tip: balanced(y)
							? t('tc_about', { left: decksText(left), rc: signed(rc), tc: signed(Math.round(trueNow())) }) + (right ? '' : ' ' + t('carry_on'))
							: right ? '' : t('carry_on'),
					});
					await waitAction([nextButton(t(lastRound ? 'shuffle' : 'next_round'))]);
				}
			} else {
				say(t('round_over'));
				await sleep(Math.max(500, S.deal * 2));
			}
			if (!alive()) return;
		}
		if (!alive()) return;
		// ---- full table test results
		const time = stopClock();
		const good = checks.filter((c) => c.said === c.truth).length;
		checks.forEach((c) => mark(c.said === c.truth));
		const key = 'table.' + S.system + '.' + R.decks + '.' + S.others;
		const result = { count: good, checks: checks.length, plays: plays.right, playsTotal: plays.total, time };
		const frac = (r) => r.count / Math.max(1, r.checks) + r.plays / Math.max(1, r.playsTotal);
		const isBest = saveBest(key, result, (a, b) => frac(a) > frac(b) || (frac(a) === frac(b) && a.time < b.time));
		showBest();
		fillRail();
		felt.className = 'felt is-top';
		felt.innerHTML = '';
		const tbl = h('table', { class: 'devs' });
		tbl.append(h('tr', {}, ['th_after', 'th_count', 'th_said'].map((x) => h('th', { text: t(x) }))));
		checks.forEach((c) => tbl.append(h('tr', {}, [h('td', { text: String(c.round) }), h('td', { class: 'ix', text: signed(c.truth) }), h('td', { class: 'ix ' + (c.said === c.truth ? 'plus' : 'minus'), text: signed(c.said) })])));
		felt.append(tbl);
		prompt({
			state: good === checks.length && plays.right === plays.total ? 'ok' : null,
			eyebrow: t('shoe_complete'),
			name: t('table_result', { count: `${good}/${checks.length}`, plays: `${plays.right}/${plays.total}` }),
			meta: clock(time) + newBest(isBest),
			bar: 1,
			tip: t(good === checks.length ? 'held_count' : 'one_slip'),
		});
		setActions([nextButton(t('go_again'), start)]);
	}
	const table = { study: tableGame, practice: tableGame, test: tableGame };

	/** Bankroll, Study: what a bet spread is and what it's worth in the long run. */
	function bankrollStudy() {
		if (!balanced()) return unbalancedNote(t('drill.bankroll'));
		const R = S.rules;
		const base = houseEdge();
		const freq = trueCountFreq(R.decks, S.others + 1);
		let avgBet = 0;
		let perHand = 0;
		let variance = 0;
		for (const k in freq) {
			const tc = Number(k);
			const u = betUnits(tc, R.decks);
			avgBet += freq[k] * u;
			perHand += freq[k] * u * edgeAt(base, tc);
			variance += freq[k] * Math.pow(1.15 * u, 2); // the swing of one blackjack hand is about 1.15 bets
		}
		const sd100 = Math.sqrt(100 * variance);
		felt.className = 'felt is-top';
		felt.innerHTML = '';
		const tbl = h('table', { class: 'devs' });
		tbl.append(h('tr', {}, ['th_tc', 'th_bet', 'th_edge', 'th_often'].map((x) => h('th', { text: t(x) }))));
		const bands = spreadFor(R.decks).map(([at], i, arr) => [at, arr[i + 1] ? arr[i + 1][0] - 1 : Infinity]);
		bands.unshift([-Infinity, 0]);
		for (const [lo, hi] of bands) {
			let f = 0;
			let e = 0;
			for (const k in freq)
				if (Number(k) >= lo && Number(k) <= hi) {
					f += freq[k];
					e += freq[k] * edgeAt(base, Number(k));
				}
			const u = betUnits(Math.max(lo, 0), R.decks);
			const edge = f ? e / f : edgeAt(base, Math.max(lo, 0));
			const label = lo === -Infinity ? t('tc_or_less', { tc: '0' }) : hi === Infinity ? t('tc_or_more', { tc: signed(lo) }) : lo === hi ? signed(lo) : t('tc_to', { lo: signed(lo), hi: signed(hi) });
			tbl.append(h('tr', {}, [h('td', { text: label }), h('td', { class: 'ix', html: `${t('n_units', { n: u })} <small>${money(u)}</small>` }), h('td', { class: 'ix ' + (edge > 0 ? 'plus' : 'minus'), text: (edge >= 0 ? '+' : '−') + Math.abs(edge * 100).toFixed(1) + '%' }), h('td', { class: 'ix', text: Math.round(f * 100) + '%' })]));
		}
		felt.append(tbl);
		felt.append(
			h('p', { class: 'note', html: t('flat_note', { house: (Math.abs(base) * 100).toFixed(2), flat: signedMoney(100 * base), avg: avgBet.toFixed(1), spread: signedMoney(100 * perHand) }) })
		);
		felt.append(
			h('p', { class: 'note', html: t('catch_note', { swing: money(2 * sd100), unit: money(1), bank: S.bank, bankMoney: money(S.bank) }) })
		);
		prompt({
			name: t('bet_count'),
			meta: [t('n_decks', { n: R.decks }), t('unit_of', { money: money(1) }), t('spread_range', { top: rungs(R.decks).slice(-1)[0] })].join(' · '),
			tip: t('bankroll_tip'),
		});
		setActions([nextButton(t('play_session'), () => setMode('practice'))]);
	}
	const bankroll = { study: bankrollStudy, practice: tableGame, test: tableGame };

	// ------------------------------------------------------------------ drills, settings panel, start
	// each drill's name is 'drill.<id>' in text.js; what each mode does is 'hint.<drill>.<mode>' (strategy: 'hint.strategy.<mode>')
	const drill = (id, run) => ({
		id,
		run,
		get label() {
			return t('drill.' + id);
		},
	});
	const DRILLS = {
		strategy: [drill('all', strategy), drill('hard', strategy), drill('soft', strategy), drill('pairs', strategy), drill('trouble', strategy)],
		counting: [drill('values', values), drill('running', running), drill('true', trueCount), drill('index', deviations), drill('table', table), drill('bankroll', bankroll)],
	};
	// the keys to press, in words: 'keys.plays', 'keys.number' and 'keys.values' in text.js

	function setSeg(id, value) {
		for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
	}
	function onSeg(id, fn) {
		$(id).addEventListener('click', (e) => {
			const b = e.target.closest('button');
			if (b) fn(b.dataset.v);
		});
	}
	function fillRail(scroll) {
		const list = $('railList');
		list.innerHTML = '';
		DRILLS[S.skill].forEach((d) => {
			const p = progressOf(d.id);
			list.append(
				h('button', { class: 'item', type: 'button', 'aria-pressed': String(d.id === section()), title: p.title, onclick: () => setSection(d.id) }, [
					h('span', { text: d.label }),
					h('em', { class: p.done ? 'done' : '', text: p.text }),
				])
			);
		});
		$('railPath').textContent = t(S.skill === 'strategy' ? 'path_strategy' : 'path_counting');
		setSeg('skillSeg', S.skill);
		// phones: the drills are one scrolling row, so bring the open one into view
		const open = list.querySelector('[aria-pressed="true"]');
		if (scroll && open && open.scrollIntoView) open.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}
	/** What to show beside a drill in the rail: the best result for the current settings, and whether it meets the benchmark. */
	function progressOf(id) {
		const b = (k) => bests[k];
		if (S.skill === 'strategy') {
			if (id === 'trouble') {
				const n = troubleCells().length;
				return { text: String(n), done: false, title: n ? t('n_to_fix', { n }) : t('nothing_to_fix') };
			}
			const total = { all: 280, hard: 100, soft: 80, pairs: 100 }[id];
			const r = b('strategy.' + id + '.' + ruleKey());
			return r ? { text: `${r.score}/${r.total}`, done: r.score === r.total, title: t('best_for_rules') } : { text: String(total), done: false, title: t('hands_no_test', { n: total }) };
		}
		if (id === 'values') {
			const r = b('values.' + S.system);
			return r ? { text: r.score === 52 ? t('secs_short', { n: r.time.toFixed(0) }) : `${r.score}/52`, done: r.score === 52 && r.time <= 60, title: t('bench_values') } : { text: '1', title: t('bench_values') };
		}
		if (id === 'running') {
			const r = b('countdown.' + S.system + '.' + S.group);
			return r ? { text: t('secs_short', { n: r.time.toFixed(0) }), done: r.time <= 30, title: t('bench_running') } : { text: '2', title: t('bench_running') };
		}
		if (id === 'true') {
			const r = b('true.' + S.rules.decks + '.' + S.level);
			return r ? { text: `${r.score}/20`, done: r.score === 20, title: t('bench_true') } : { text: '3', title: t('bench_true') };
		}
		if (id === 'index') {
			const r = b('index.' + (S.rules.surrender ? 'r' : 'n'));
			return r ? { text: `${r.score}/${r.total}`, done: r.score === r.total, title: t('bench_index') } : { text: '4', title: t('bench_index') };
		}
		if (id === 'table') {
			const r = b('table.' + S.system + '.' + S.rules.decks + '.' + S.others);
			return r ? { text: `${r.count}/${r.checks}`, done: r.count === r.checks && r.plays === r.playsTotal, title: t('bench_table') } : { text: '5', title: t('bench_table') };
		}
		if (id === 'bankroll') {
			const r = b('bankroll.' + S.rules.decks + '.' + S.others);
			return r ? { text: `${r.betsRight}/${r.bets}`, done: r.betsRight === r.bets && r.plays === r.playsTotal, title: t('bench_bankroll') } : { text: '6', title: t('bench_bankroll') };
		}
		return { text: '' };
	}
	function showBest() {
		const sec = section();
		let text = '';
		const bestTest = (b, time) => t('best_test', { result: t('score_in', { score: b.score, total: b.total, time: time || clock(b.time) }) });
		if (S.skill === 'strategy') {
			const b = bests['strategy.' + sec + '.' + ruleKey()];
			text = b ? bestTest(b) : t('no_test_rules');
		} else if (sec === 'values') {
			const b = bests['values.' + S.system];
			text = b ? bestTest({ score: b.score, total: 52 }, t('sec', { n: b.time.toFixed(1) })) : t('no_test');
		} else if (sec === 'running') {
			const b = bests['countdown.' + S.system + '.' + S.group];
			text = b ? t('best_countdown', { time: t('sec', { n: b.time.toFixed(1) }) }) : t('no_countdown');
		} else if (sec === 'true') {
			const b = bests['true.' + S.rules.decks + '.' + S.level];
			text = b ? bestTest(b) : t('no_test');
		} else if (sec === 'index') {
			const b = bests['index.' + (S.rules.surrender ? 'r' : 'n')];
			text = b ? bestTest(b) : t('no_test');
		} else if (sec === 'table') {
			const b = bests['table.' + S.system + '.' + S.rules.decks + '.' + S.others];
			text = b ? t('best_shoe', { count: `${b.count}/${b.checks}`, plays: `${b.plays}/${b.playsTotal}` }) : t('no_shoe');
		} else if (sec === 'bankroll') {
			const b = bests['bankroll.' + S.rules.decks + '.' + S.others];
			text = b ? t('best_session', { bets: `${b.betsRight}/${b.bets}`, plays: `${b.plays}/${b.playsTotal}`, net: signedMoney(b.net), hands: b.hands }) : t('no_session');
		}
		$('best').innerHTML = text;
	}
	function fillPanel() {
		const sec = section();
		const counting = S.skill === 'counting';
		setSeg('modeSeg', mode());
		$('modeHint').textContent = t('hint.' + (counting ? sec : 'strategy') + '.' + mode());
		$('systemBox').hidden = !counting;
		$('systemSel').value = S.system;
		const y = sys();
		$('systemHint').textContent = t('system_note.' + (SYSTEMS[S.system] ? S.system : 'hilo')) + (y.start ? ' ' + t('shoe_starts', { n: S.rules.decks, count: signed(y.start(S.rules.decks)) }) : '');
		const show = {
			groupField: counting && sec === 'running' && mode() !== 'study',
			speedField: counting && sec === 'running' && mode() === 'practice',
			lenField: counting && sec === 'running' && mode() === 'practice',
			levelField: counting && sec === 'true' && mode() !== 'study',
			othersField: counting && (sec === 'table' || sec === 'bankroll'),
			dealField: counting && (sec === 'table' || sec === 'bankroll') && mode() !== 'study',
			indexField: counting && (sec === 'table' || sec === 'bankroll') && S.system === 'hilo',
			unitField: counting && sec === 'bankroll',
			bankField: counting && sec === 'bankroll',
			peekField: !counting && mode() === 'practice',
		};
		let any = false;
		for (const id in show) {
			$(id).hidden = !show[id];
			any = any || show[id];
		}
		$('drillBox').hidden = !any;
		$('drillTitle').textContent = any ? DRILLS[S.skill].find((d) => d.id === sec).label : '';
		$('drillHint').textContent =
			!counting
				? t('hint_peek')
				: sec === 'true' && show.levelField
				? t('hint_level')
				: sec === 'table'
				? t('hint_table')
				: sec === 'bankroll'
				? t('hint_bankroll', { top: rungs(S.rules.decks).slice(-1)[0] })
				: '';
		$('drillHint').hidden = !$('drillHint').textContent;
		setSeg('groupSeg', S.group);
		setSeg('speedSeg', S.speed);
		setSeg('lenSeg', S.len);
		setSeg('levelSeg', S.level);
		setSeg('othersSeg', S.others);
		setSeg('dealSeg', S.deal);
		setSeg('indexSeg', S.indexPlays ? 1 : 0);
		setSeg('unitSeg', S.unit);
		setSeg('bankSeg', S.bank);
		setSeg('peekSeg', S.peekChart ? 1 : 0);
		$('rulesBox').hidden = counting && (sec === 'values' || sec === 'running');
		setSeg('decksSeg', S.rules.decks);
		setSeg('h17Seg', S.rules.h17 ? 1 : 0);
		setSeg('dasSeg', S.rules.das ? 1 : 0);
		setSeg('surSeg', S.rules.surrender ? 1 : 0);
		$('rulesHint').textContent = t(!counting ? 'rules_strategy' : sec === 'true' ? 'rules_true' : sec === 'index' ? 'rules_index' : sec === 'bankroll' ? 'rules_bankroll' : 'rules_table');
		$('keysHint').innerHTML = !counting || sec === 'index' || sec === 'bankroll' ? t('keys.plays') : sec === 'values' ? t('keys.values') : sec === 'table' ? t('keys.plays') + '. ' + t('keys.number') : t('keys.number');
		showBest();
	}

	function start() {
		run++;
		advance = null;
		closeNumber();
		setActions([]);
		session.right = session.total = session.streak = 0;
		session.t0 = 0;
		session.frozen = null;
		showStats();
		fillRail(true);
		fillPanel();
		$('prompt').classList.remove('is-ok', 'is-bad');
		const open = DRILLS[S.skill].find((d) => d.id === section()) || DRILLS[S.skill][0];
		open.run[mode()]();
	}
	function setMode(m) {
		S.mode[S.skill] = m;
		saveSettings();
		start();
	}
	function setSection(id) {
		S.section[S.skill] = id;
		saveSettings();
		start();
	}
	function change(fn) {
		fn();
		saveSettings();
		start();
	}

	onSeg('skillSeg', (v) => change(() => (S.skill = v)));
	onSeg('modeSeg', setMode);
	onSeg('groupSeg', (v) => change(() => (S.group = Number(v))));
	onSeg('speedSeg', (v) => change(() => (S.speed = Number(v))));
	onSeg('lenSeg', (v) => change(() => (S.len = Number(v))));
	onSeg('levelSeg', (v) => change(() => (S.level = v)));
	onSeg('othersSeg', (v) => change(() => (S.others = Number(v))));
	onSeg('dealSeg', (v) => change(() => (S.deal = Number(v))));
	onSeg('indexSeg', (v) => change(() => (S.indexPlays = v === '1')));
	onSeg('unitSeg', (v) => change(() => (S.unit = Number(v))));
	onSeg('bankSeg', (v) => change(() => (S.bank = Number(v))));
	onSeg('peekSeg', (v) => change(() => (S.peekChart = v === '1')));
	onSeg('decksSeg', (v) => change(() => (S.rules.decks = Number(v))));
	onSeg('h17Seg', (v) => change(() => (S.rules.h17 = v === '1')));
	onSeg('dasSeg', (v) => change(() => (S.rules.das = v === '1')));
	onSeg('surSeg', (v) => change(() => (S.rules.surrender = v === '1')));
	for (const id in SYSTEMS) $('systemSel').append(h('option', { value: id, text: SYSTEMS[id].name }));
	$('systemSel').addEventListener('change', (e) => change(() => (S.system = e.target.value)));
	$('restartBtn').addEventListener('click', () => {
		document.body.classList.remove('sheet-open');
		start();
	});
	// tapping the big card works like the main button (quicker on a phone during the deck countdown)
	felt.addEventListener('click', (e) => {
		if (!e.target.closest('.flash')) return;
		const a = actions.find((x) => x.primary && x.el && !x.el.disabled);
		if (a && a.on) a.on(a.id);
	});
	$('keypad').addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if (b) numberKey(b.dataset.k);
	});

	// settings sheet (phones), clean view, intro
	$('settingsBtn').addEventListener('click', () => document.body.classList.toggle('sheet-open'));
	$('closeSheet').addEventListener('click', () => document.body.classList.remove('sheet-open'));
	const setClean = (on) => document.body.classList.toggle('clean', on);
	$('cleanBtn').addEventListener('click', () => {
		document.body.classList.remove('sheet-open');
		setClean(true);
	});
	$('cleanExit').addEventListener('click', () => setClean(false));
	const intro = (on) => {
		$('intro').hidden = !on;
		if (on) $('introGo').focus();
		else saved.set('seenIntro', true);
	};
	$('howBtn').addEventListener('click', () => intro(true));
	$('introGo').addEventListener('click', () => intro(false));
	$('intro').addEventListener('click', (e) => e.target === $('intro') && intro(false));

	document.addEventListener('keydown', (e) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const tag = (e.target.tagName || '').toLowerCase();
		if (tag === 'select' || tag === 'input' || tag === 'textarea') return;
		if (!$('intro').hidden) {
			if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				intro(false);
			}
			return;
		}
		if (e.key === 'Escape') {
			document.body.classList.remove('sheet-open');
			setClean(false);
			return;
		}
		if (numberCb) {
			const k = e.key === 'Enter' ? 'enter' : e.key === 'Backspace' ? 'back' : e.key;
			if (numberKey(k)) e.preventDefault();
			return;
		}
		const key = e.key === 'Enter' ? ' ' : e.key.toLowerCase();
		const a = actions.find((x) => x.key === key && x.el && !x.el.disabled);
		if (a) {
			e.preventDefault();
			// a focused button would also fire on Space/Enter: drop focus so it runs once
			if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
			a.on && a.on(a.id);
		} else if (key === ' ' && advance) {
			e.preventDefault();
			if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
			advance();
		}
	});

	if (!window.BJ_EV) {
		prompt({ eyebrow: t('error'), name: t('data_fail'), meta: t('reload') });
		return;
	}
	if (!DRILLS[S.skill]) S.skill = 'strategy';
	for (const k in DRILLS) if (!DRILLS[k].some((d) => d.id === S.section[k])) S.section[k] = DRILLS[k][0].id;
	start();
	if (!saved.get('seenIntro', false)) intro(true);
	// another language starts the drill again, as changing any other setting does
	lang.onChange(start);

	// handles for the checks in tools-src/blackjack-trainer/verify/
	window.BJT = { S, peek, decide, chartCode, rowRule, SYSTEMS, deckSum, INDEX_PLAYS, houseEdge, betUnits, start };
})();
