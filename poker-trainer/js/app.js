/* Poker Trainer
 *
 * Six drills in the order a beginner needs them, each with three modes (Study, Practice, Test):
 *   Hand ranks, Who wins?         reading hand strength
 *   Starting hands                which two cards to raise from which seat
 *   Count your outs, The odds, Call or fold?   when chasing a draw is worth the price
 *
 * Plain modules, no framework and no build step. Everything the tool knows about poker is in
 * js/core/ (the hand evaluator, the chart, the draw maths, the question makers); this file is the
 * page: what each drill shows, the buttons, the scoring. Settings, best scores and the starting
 * hands you miss are saved in the browser through /js/progress.js. Every word it shows is in
 * js/text.js, looked up through the site's language module (/js/language.js).
 */
import { EN, t, useLanguage, language } from './text.js';
import { RANKS, RANK_LABELS, SUITS, suitName, categoryName, FIVE_CARD_COUNTS, FIVE_CARD_TOTAL, cards as parse } from './core/cards.js';
import { seat, seatName, raises, share, raisedFrom, rule, handName } from './core/chart.js';
import { DRAWS, BET_SIZES, OUT_COUNTS, hitChance, ruleOfThumb } from './core/draws.js';
import { MAKERS, makeWinner, makeCall, buildTest, TEST_SIZE, PASS_MARK, passes } from './core/questions.js';
import { createReview } from './core/review.js';

const lang = await SiteLanguage.open({ layers: [{ text: EN, files: new URL('../lang/', import.meta.url) }] });
useLanguage(lang);

const $ = (id) => document.getElementById(id);
const saved = window.SiteProgress ? window.SiteProgress.tool('poker-trainer') : { get: (k, d) => d, set: () => {} };

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
const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

const SUIT_MARK = ['♣', '♦', '♥', '♠'];
/** Cards as text, for lists: A♥ K♦ */
const txt = (cs) => cs.map((c) => RANK_LABELS[c >> 2] + SUIT_MARK[c & 3]).join(' ');

// ------------------------------------------------------------------ settings
const DRILLS = ['ranks', 'winner', 'preflop', 'outs', 'odds', 'call'].map((id) => ({
	id,
	get label() {
		return t('drill.' + id);
	},
}));
const drillOf = (id) => DRILLS.find((d) => d.id === id);
const S = {
	drill: 'ranks',
	mode: { ranks: 'study', winner: 'study', preflop: 'study', outs: 'study', odds: 'study', call: 'study' },
	seat: 'all', // starting hands: one seat, or all of them
};
(function load() {
	const s = saved.get('settings', null);
	if (!s || typeof s !== 'object') return;
	if (drillOf(s.drill)) S.drill = s.drill;
	// a drill left in Test reopens in Practice, so the clock isn't already running when the page loads
	for (const k in S.mode) if (s.mode && ['study', 'practice', 'test'].includes(s.mode[k])) S.mode[k] = s.mode[k] === 'test' ? 'practice' : s.mode[k];
	if (s.seat === 'all' || seat(s.seat)) S.seat = s.seat;
})();
const saveSettings = () => saved.set('settings', S);
const mode = () => S.mode[S.drill];

// best test per drill (starting hands: per seat setting), and the starting hands missed in practice
const bests = saved.get('best', {});
const misses = saved.get('misses', {});
const bestKey = (id) => (id === 'preflop' ? 'preflop:' + S.seat : id);
const passed = (id) => {
	const b = bests[id === 'preflop' ? 'preflop:all' : id];
	return !!b && passes(b.score, b.total);
};

// ------------------------------------------------------------------ cards and tables
const felt = $('felt');
function cardEl(c, cls) {
	const svg = (k) => `<svg class="${k}" viewBox="0 0 24 24" aria-hidden="true"><use href="#suit-${SUITS[c & 3]}"/></svg>`;
	const red = (c & 3) === 1 || (c & 3) === 2;
	return h('div', {
		class: 'card' + (red ? ' red' : '') + (cls ? ' ' + cls : ''),
		role: 'img',
		'aria-label': t('card_aria', { rank: RANK_LABELS[c >> 2], suit: suitName(c & 3) }),
		html: `<span class="cr">${RANK_LABELS[c >> 2]}</span>${svg('cs')}${svg('cp')}`,
	});
}
const slotEl = () => h('div', { class: 'card slot', role: 'img', 'aria-label': t('slot_aria') });
/** A labelled row of cards. lit: after the answer, the cards that count stay bright and the rest fade. */
function group(label, cs, o = {}) {
	const row = h('div', { class: 'cardrow' });
	for (const c of cs) row.append(cardEl(c, (o.fresh ? 'in ' : '') + (o.lit ? (o.lit.includes(c) ? 'lit' : 'dim') : '')));
	for (let i = 0; i < (o.slots || 0); i++) row.append(slotEl());
	return h('div', { class: 'grp ' + (o.cls || '') }, [h('div', { class: 'tag' + (o.tagCls ? ' ' + o.tagCls : ''), text: label }), row, o.under || null]);
}
const tile = (label, value, cls) => h('div', { class: 'chip' + (cls ? ' ' + cls : '') }, [h('small', { text: label }), h('b', { text: value })]);

/** The six seats seen from above, you at the bottom; play runs clockwise, so the seats to your left act after you. */
function seatsEl(heroId) {
	const order = ['utg', 'hj', 'co', 'btn', 'sb', 'bb'];
	const hero = order.indexOf(heroId);
	const cx = 160;
	const cy = 86;
	const at = (k, f) => {
		const a = ([90, 150, 210, 270, 330, 30][(k - hero + 6) % 6] * Math.PI) / 180;
		return [cx + 122 * f * Math.cos(a), cy + 58 * f * Math.sin(a)];
	};
	let out = `<ellipse class="rail-line" cx="${cx}" cy="${cy}" rx="122" ry="58"/>`;
	order.forEach((id, k) => {
		const [x, y] = at(k, 1);
		const cls = k < hero ? 'out' : k === hero ? 'you' : '';
		out += `<g class="seat ${cls}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${id === 'bb' ? 'BB' : seat(id).short}</text></g>`;
	});
	const [bx, by] = at(3, 0.66);
	out += `<g class="dealer"><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="7.5"/><text x="${bx.toFixed(1)}" y="${(by + 3.2).toFixed(1)}">D</text></g>`;
	const s = seat(heroId);
	const line = hero === 0 ? t('you_act_first') : t('n_folded', { n: hero });
	out += `<text class="mid" x="${cx}" y="${cy - 3}">${line}</text><text class="mid" x="${cx}" y="${cy + 11}">${t('still_to_act', { n: s.behind })}</text>`;
	const aria = t('seats_aria', { seat: seatName(heroId), line: lang.midSentence(line), n: s.behind });
	return h('div', { style: 'display:contents', html: `<svg class="seats" viewBox="0 0 320 172" role="img" aria-label="${aria}">${out}</svg>` });
}

// ------------------------------------------------------------------ what each drill shows
const boardTag = (q) => t(q.board.length === 3 ? 'the_flop' : q.board.length === 4 ? 'the_turn' : 'board');
const cardsOn = (hole, board) => t('cards_on', { hole: txt(hole), board: txt(board) });
const VIEW = {
	ranks: {
		ask: () => ({ name: t('ranks_ask'), meta: t('ranks_meta') }),
		table: (q, done) => [
			h('div', { class: 'deal' }, [group(t('board'), q.board, { cls: 'board', lit: done && q.best, fresh: !done }), group(t('your_cards'), q.hole, { cls: 'mine', lit: done && q.best, fresh: !done })]),
		],
		buttons: () => Array.from({ length: 9 }, (_, i) => ({ id: String(i), label: categoryName(i), key: String(i + 1), wide: true })),
		answerText: (q) => categoryName(q.answer),
		result: (q) => q.name,
		line: (q) => cardsOn(q.hole, q.board),
	},
	winner: {
		ask: () => ({ name: t('winner_ask'), meta: t('winner_meta') }),
		table: (q, done) => {
			const who = (i) => {
				const won = done && (q.answer === 'split' || q.answer === 'AB'[i]);
				return group(t('player', { who: 'AB'[i] }) + (done ? (q.answer === 'split' ? ' · ' + t('splits') : won ? ' · ' + t('wins') : '') : ''), q.hands[i], {
					cls: won ? 'is-win' : '',
					tagCls: won ? 'win' : '',
					fresh: !done,
					under: h('div', { class: 'res', text: done ? q.names[i] : '' }),
				});
			};
			return [h('div', { class: 'deal' }, [group(t('board'), q.board, { cls: 'board', fresh: !done }), h('div', { class: 'players' }, [who(0), who(1)])])];
		},
		buttons: () => [
			{ id: 'A', label: t('x_wins', { who: 'A' }), key: 'a' },
			{ id: 'split', label: t('split'), key: 's', color: 'split' },
			{ id: 'B', label: t('x_wins', { who: 'B' }), key: 'b' },
		],
		answerText: (q) => (q.answer === 'split' ? t('split') : t('x_wins', { who: q.answer })),
		result: (q) => (q.answer === 'split' ? t('split_pot') : t('player_wins', { who: q.answer })),
		line: (q) => t('winner_line', { a: txt(q.hands[0]), b: txt(q.hands[1]), board: txt(q.board) }),
	},
	preflop: {
		ask: (q) => {
			const left = t('left', { n: seat(q.seat).behind });
			return { name: seatName(q.seat), meta: t(q.seat === 'utg' ? 'first_to_act' : 'all_folded') + ' · ' + left };
		},
		table: (q, done) => [h('div', { class: 'deal' }, [seatsEl(q.seat), group(t('your_cards'), q.hole, { cls: 'mine', fresh: !done })])],
		buttons: () => [
			{ id: 'raise', label: t('answer.raise'), key: 'r', color: 'raise' },
			{ id: 'fold', label: t('answer.fold'), key: 'f', color: 'fold' },
		],
		answerText: (q) => t('answer.' + q.answer),
		result: (q) => t('answer.' + q.answer) + ' · ' + q.name,
		tip: (q) => {
			const from = raisedFrom(q.hand).map(seatName);
			return q.why + ' ' + (from.length ? t('raised_from', { seats: from.join(', ') }) : t('raised_nowhere'));
		},
		line: (q) => t('seat_hand', { seat: seatName(q.seat), hand: q.name }),
	},
	outs: {
		ask: (q) => ({ name: t('outs_ask'), meta: t('outs_meta', { toCome: t('to_come', { n: q.toCome }) }) }),
		table: (q, done) => [
			h('div', { class: 'deal' }, [
				group(boardTag(q), q.board, { cls: 'board', slots: 5 - q.board.length, fresh: !done }),
				group(t('your_cards'), q.hole, { cls: 'mine', fresh: !done }),
				done ? h('div', { class: 'grp' }, [h('div', { class: 'tag', text: t('your_outs') }), h('div', { class: 'strip' }, sortOuts(q).map((c) => cardEl(c)))]) : null,
			]),
		],
		buttons: () => OUT_COUNTS.map((n, i) => ({ id: String(n), label: String(n), key: String(i + 1), num: true })),
		answerText: (q) => t('n_outs', { n: q.answer }),
		result: (q) => t('n_outs', { n: q.answer }),
		tip: (q) => t('tip_named', { name: q.name, why: q.why }),
		line: (q) => cardsOn(q.hole, q.board),
	},
	odds: {
		ask: (q) =>
			q.kind === 'chance'
				? { name: t('odds_hit'), meta: t('odds_rule') }
				: { name: t('odds_need'), meta: t('odds_price') },
		table: (q) =>
			q.kind === 'chance'
				? [h('div', { class: 'tiles' }, [tile(t('outs'), String(q.outs), 'big'), tile(t('cards_to_come', { n: q.toCome }), String(q.toCome), 'big')])]
				: [
						h('div', { class: 'tiles' }, [tile(t('pot'), '$' + q.pot, 'big'), tile(t('their_bet'), '$' + q.bet, 'big')]),
						h('p', { class: 'note', text: t('opp_bets', { bet: q.bet, pot: q.pot }) }),
					],
		buttons: (q) => q.options.map((n, i) => ({ id: String(n), label: n + '%', key: String(i + 1), num: true })),
		answerText: (q) => q.answer + '%',
		result: (q) => q.name,
		line: (q) => (q.kind === 'chance' ? t('odds_line', { n: q.toCome, outs: q.outs }) : t('bet_into', { bet: q.bet, pot: q.pot })),
	},
	call: {
		ask: (q) => ({ name: t('call_ask'), meta: t(q.toCome === 1 ? 'call_meta_turn' : 'call_meta_flop') }),
		table: (q, done) => [
			h('div', { class: 'deal' }, [
				group(boardTag(q), q.board, { cls: 'board', slots: 5 - q.board.length, fresh: !done }),
				group(t('your_cards'), q.hole, { cls: 'mine', fresh: !done }),
				done
					? h('div', { class: 'tiles' }, [
							tile(t('you_hit'), Math.round(100 * q.hit) + '%', q.answer === 'call' ? 'good' : 'poor'),
							h('span', { class: 'versus', text: t(q.answer === 'call' ? 'more_than' : 'less_than') }),
							tile(t('you_need'), Math.round(100 * q.need) + '%'),
						])
					: h('div', { class: 'tiles' }, [tile(t('pot'), '$' + q.pot), tile(t(q.toCome === 2 ? 'their_allin' : 'their_bet'), '$' + q.bet)]),
			]),
		],
		buttons: () => [
			{ id: 'call', label: t('answer.call'), key: 'c', color: 'call' },
			{ id: 'fold', label: t('answer.fold'), key: 'f', color: 'fold' },
		],
		answerText: (q) => t('answer.' + q.answer),
		result: (q) => t('answer.' + q.answer),
		line: (q) => t('call_line', { n: q.toCome, draw: t('draw.' + q.kind), bet: q.bet, pot: q.pot }),
	},
};
/** A draw's outs, flush cards first, then by rank. */
function sortOuts(q) {
	const suit = q.draw.suit;
	return q.outs.slice().sort((a, b) => ((b & 3) === suit) - ((a & 3) === suit) || (b >> 2) - (a >> 2) || (a & 3) - (b & 3));
}

// ------------------------------------------------------------------ prompt, buttons, score
let actions = [];
let advance = null; // what Space does when no button claims it
let run = 0; // goes up on every restart, so a pending step from the old run does nothing
const session = { right: 0, total: 0, streak: 0, t0: 0, frozen: null };
const peek = {}; // the question on screen and its answer, for the checks in tools-src/poker-trainer/verify/

function prompt(p) {
	const box = $('prompt');
	box.classList.toggle('is-ok', p.state === 'ok');
	box.classList.toggle('is-bad', p.state === 'bad');
	$('pEyebrow').textContent = p.eyebrow || eyebrow();
	$('pName').textContent = p.name || '';
	$('pMeta').textContent = p.meta || ' ';
	$('pBarWrap').classList.toggle('is-off', p.bar == null);
	if (p.bar != null) $('pBar').style.width = Math.round(p.bar * 100) + '%';
	$('pTip').hidden = !p.tip;
	$('pTip').innerHTML = p.tip || '';
}
const eyebrow = (extra) => drillOf(S.drill).label + ' · ' + t('mode_' + mode()) + (extra ? ' · ' + extra : '');

/** Buttons under the table. Each: { id, label, key, color, primary, wide, num, on }. */
function setActions(list) {
	actions = list || [];
	const box = $('actions');
	box.innerHTML = '';
	for (const a of actions) {
		a.el = h(
			'button',
			{
				class: 'act' + (a.primary ? ' primary' : '') + (a.wide ? ' wide' : '') + (a.num ? ' num' : ''),
				type: 'button',
				'data-id': a.id,
				'data-c': a.color ? '' : null,
				style: a.color ? '--c: var(--' + a.color + ')' : null,
				onclick: () => a.on && a.on(a.id),
			},
			[document.createTextNode(a.label), a.key ? h('kbd', { text: a.key === ' ' ? t('key_space') : a.key.toUpperCase() }) : null]
		);
		box.append(a.el);
	}
}
const nextButton = (label, on) => ({ id: 'next', label, key: ' ', primary: true, on });

function mark(right) {
	session.total++;
	if (right) {
		session.right++;
		session.streak++;
	} else session.streak = 0;
	showStats();
}
const elapsed = () => (session.frozen != null ? session.frozen : session.t0 ? (Date.now() - session.t0) / 1000 : 0);
function showStats() {
	$('sAcc').textContent = session.total ? Math.round((100 * session.right) / session.total) + '%' : '–';
	$('sStreak').textContent = session.streak;
	$('sTime').textContent = clock(elapsed());
}
setInterval(() => {
	if (session.t0 && session.frozen == null) $('sTime').textContent = clock(elapsed());
}, 500);
function flash(right) {
	const box = $('stageBox');
	box.classList.remove('flash-ok', 'flash-bad');
	void box.offsetWidth;
	box.classList.add(right ? 'flash-ok' : 'flash-bad');
	setTimeout(() => box.classList.remove('flash-ok', 'flash-bad'), 450);
}
function show(kids, top) {
	felt.classList.toggle('is-top', !!top);
	felt.replaceChildren(...[].concat(kids).filter(Boolean));
	felt.scrollTop = 0;
}

// ------------------------------------------------------------------ practice and test
// a fresh question; starting hands follow the seat setting and lean towards the hands you've missed
const fresh = () => (S.drill === 'preflop' ? MAKERS.preflop(Math.random, { seat: S.seat, misses }) : MAKERS[S.drill](Math.random));

/** Put a question on the table and wait for an answer. o: { eyebrow, meta, bar, onAnswer(right, picked) } */
function ask(q, o) {
	const v = VIEW[q.drill];
	const a = v.ask(q);
	peek.q = q;
	peek.answer = String(q.answer);
	prompt({ eyebrow: o.eyebrow, name: a.name, meta: o.meta || a.meta, bar: o.bar });
	show(v.table(q, false));
	if (!session.t0) session.t0 = Date.now();
	setActions(v.buttons(q).map((b) => Object.assign(b, { on: (id) => o.onAnswer(id === String(q.answer), id) })));
	advance = null;
}

function practice() {
	const mine = run;
	const review = createReview();
	const next = () => {
		if (mine !== run) return;
		const item = review.due();
		const q = item ? item.q : fresh();
		const v = VIEW[q.drill];
		ask(q, {
			eyebrow: item ? eyebrow(t('eyebrow_again')) : null,
			onAnswer: (right, picked) => {
				mark(right);
				flash(right);
				review.record(q, right, item);
				if (q.drill === 'preflop') {
					const n = (misses[q.key] || 0) + (right ? -1 : 1);
					if (n > 0) misses[q.key] = Math.min(3, n);
					else delete misses[q.key];
					saved.set('misses', misses);
				}
				const said = v.buttons(q).find((b) => b.id === picked);
				const waiting = review.waiting();
				prompt({
					eyebrow: right ? t('correct') : said ? t('you_said', { answer: said.label.toLocaleLowerCase(lang.locale) }) : t('not_quite'),
					name: v.result(q),
					meta: waiting ? t('to_come_back', { n: waiting }) : null,
					tip: v.tip ? v.tip(q) : q.why,
					state: right ? 'ok' : 'bad',
				});
				show(v.table(q, true));
				setActions([nextButton(t('next'), next)]);
				advance = next;
			},
		});
	};
	next();
}

function test() {
	const mine = run;
	const qs = buildTest(S.drill, Math.random, { seat: S.seat });
	const missed = [];
	let i = 0;
	const step = () => {
		if (mine !== run) return;
		if (i >= qs.length) return finish();
		const q = qs[i];
		ask(q, {
			eyebrow: eyebrow(t('n_of', { i: i + 1, n: qs.length })),
			bar: i / qs.length,
			onAnswer: (right, picked) => {
				for (const a of actions) {
					a.on = null;
					a.el.disabled = true;
					if (a.id === picked) a.el.classList.add(right ? 'is-right' : 'is-wrong');
				}
				mark(right);
				flash(right);
				if (!right) missed.push(q);
				i++;
				setTimeout(step, 380);
			},
		});
	};
	const finish = () => {
		session.frozen = elapsed();
		const score = qs.length - missed.length;
		const time = session.frozen;
		const key = bestKey(S.drill);
		const old = bests[key];
		const better = !old || score > old.score || (score === old.score && time < old.time);
		if (better) {
			bests[key] = { score, total: qs.length, time };
			saved.set('best', bests);
		}
		const ok = passes(score, qs.length);
		peek.q = null;
		peek.result = { score, total: qs.length, passed: ok };
		const v = VIEW[S.drill];
		const need = Math.ceil(PASS_MARK * qs.length);
		prompt({
			eyebrow: eyebrow(t('eyebrow_result')),
			name: t(ok ? 'passed' : 'not_yet'),
			meta: t('to_pass', { need, n: qs.length }) + (better && old ? ' · ' + t('new_best') : ''),
			tip: ok ? (nextDrill() ? t('mark_next', { drill: nextDrill().label }) : t('mark_last')) : t('missed_below'),
			state: ok ? 'ok' : 'bad',
			bar: 1,
		});
		show(
			h('div', { class: 'summary' }, [
				h('div', { class: 'tiles' }, [tile(t('score'), `${score}/${qs.length}`, 'big ' + (ok ? 'good' : 'poor')), tile(t('time'), clock(time), 'big')]),
				missed.length
					? h('div', { class: 'misses' }, missed.map((q) => h('div', {}, [h('span', { text: v.line(q) }), h('b', { text: v.answerText(q) })])))
					: h('p', { class: 'note', text: t('nothing_missed') }),
			]),
			true
		);
		const nd = nextDrill();
		const again = { id: 'again', label: t('try_again'), key: 't', on: start };
		const more = { id: 'practice', label: t('mode_practice'), key: 'p', on: () => setMode('practice') };
		setActions(ok && nd ? [nextButton(t('next_drill'), () => setDrill(nd.id)), again, more] : [Object.assign(again, { primary: true, key: ' ' }), more]);
		advance = null;
		fillRail(false);
		showBest();
	};
	step();
}
const nextDrill = () => DRILLS[DRILLS.findIndex((d) => d.id === S.drill) + 1] || null;

// ------------------------------------------------------------------ study pages
const toPractice = () => ({ id: 'practice', label: t('practise_this'), key: 'p', on: () => setMode('practice') });
// an example of each kind of hand, strongest first (what each one is: 'ladder.<kind>' in text.js)
const LADDER = [
	[8, 'Ts 9s 8s 7s 6s'],
	[7, 'Qs Qh Qd Qc 4d'],
	[6, 'Ks Kh Kd 7c 7s'],
	[5, 'Ad Jd 8d 6d 3d'],
	[4, '9c 8d 7s 6h 5c'],
	[3, '8s 8h 8d Kc 4s'],
	[2, 'Js Jd 6h 6c As'],
	[1, 'Ah Ad Ks 9c 4d'],
	[0, 'Ad Js 8c 6h 3d'],
];
function oneIn(cat) {
	const n = FIVE_CARD_TOTAL / FIVE_CARD_COUNTS[cat];
	const digits = n >= 10 ? 0 : 1;
	return t('one_in', { n: n.toLocaleString(lang.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }) });
}
/** Step through made-up examples with the answer already showing. */
function examples(make, intro) {
	const mine = run;
	const next = () => {
		if (mine !== run) return;
		const q = make();
		const v = VIEW[q.drill];
		peek.q = q;
		prompt({ eyebrow: eyebrow(t('eyebrow_example')), name: v.result(q), meta: v.ask(q).meta, tip: v.tip ? v.tip(q) : q.why });
		show(v.table(q, true));
		setActions([nextButton(t('another_example'), next), toPractice()]);
		advance = next;
	};
	if (!intro) return next();
	prompt(intro.prompt);
	show(intro.body, true);
	setActions([nextButton(t('see_examples'), next), toPractice()]);
	advance = next;
}
const STUDY = {
	ranks() {
		prompt({ name: t('nine_hands'), meta: t('strongest_top'), tip: t('ranks_tip') });
		show(
			h(
				'div',
				{ class: 'ladder' },
				LADDER.map(([cat, eg]) =>
					h('div', { class: 'rung' }, [
						h('div', { class: 'cardrow' }, parse(eg).map((c) => cardEl(c))),
						h('div', {}, [h('h4', {}, [document.createTextNode(categoryName(cat)), h('em', { text: oneIn(cat) })]), h('p', { text: t('ladder.' + cat) })]),
					])
				)
			),
			true
		);
		setActions([Object.assign(toPractice(), { primary: true, key: ' ' })]);
	},
	winner() {
		examples(() => makeWinner(Math.random), {
			prompt: { name: t('decided'), meta: t('five_rules') },
			body: h('ol', { class: 'rules', html: t('winner_rules') }),
		});
	},
	preflop() {
		let picked = null;
		const draw = () => {
			const one = S.seat !== 'all';
			const grid = h('div', { class: 'grid', role: 'group', 'aria-label': t('starting_hands') });
			for (let r = 12; r >= 0; r--) {
				for (let c = 12; c >= 0; c--) {
					// rows and columns both run ace to two: suited hands land above the diagonal, offsuit below
					const id = r === c ? RANKS[r] + RANKS[r] : r > c ? RANKS[r] + RANKS[c] + 's' : RANKS[c] + RANKS[r] + 'o';
					const from = raisedFrom(id);
					const on = one ? raises(S.seat, id) : from.length > 0;
					const colour = !on ? null : one ? 'var(--raise)' : `var(--seat-${from[0]})`;
					grid.append(
						h('button', {
							type: 'button',
							class: on ? '' : 'f',
							style: colour ? '--c: ' + colour : null,
							'aria-pressed': String(picked === id),
							'aria-label': t(on ? 'hand_raise' : 'hand_fold', { hand: handName(id) }),
							text: id,
							onclick: () => {
								picked = id;
								draw();
							},
						})
					);
				}
			}
			const legend = one
				? [['var(--raise)', 'raise'], ['#17242d', 'fold']]
				: [['var(--seat-utg)', 'every'], ['var(--seat-hj)', 'hj'], ['var(--seat-co)', 'co'], ['var(--seat-btn)', 'btn'], ['#17242d', 'fold']];
			show(
				h('div', { class: 'gridwrap' }, [
					grid,
					h('div', { class: 'legend' }, legend.map(([c, key]) => h('span', {}, [h('i', { style: '--c: ' + c }), document.createTextNode(t('legend.' + key))]))),
					h('p', { class: 'note', html: t('grid_note') }),
				]),
				true
			);
			const s = one ? seat(S.seat) : null;
			if (picked) {
				const from = raisedFrom(picked).map(seatName);
				prompt({
					name: handName(picked),
					meta: from.length ? t('raise_from', { seats: from.join(', ') }) : t('fold_everywhere'),
					tip: one ? rule(S.seat, picked) : from.length ? rule(raisedFrom(picked)[0], picked) : t('not_strong'),
				});
			} else {
				prompt({
					name: one ? seatName(S.seat) : t('which_hands'),
					meta: one ? t('raise_pct', { pct: Math.round(100 * share(S.seat)) }) + ' · ' + t('left_short', { n: s.behind }) : t('all_folded_raise'),
					tip: t(one && S.seat === 'sb' ? 'sb_note' : 'later_note') + ' ' + t('tap_hand'),
				});
			}
		};
		draw();
		setActions([Object.assign(toPractice(), { primary: true, key: ' ' })]);
	},
	outs() {
		const eg = { gutshot: ['9c 8d', '6h 5s 2c'], oesd: ['9c 8d', '7h 6s 2c'], double: ['Jc 9d', 'Kh 7s Tc'], flush: ['Ah 7h', 'Kh 9h 2c'], 'flush+gutshot': ['9h 8h', '6h 5s 2h'], 'flush+oesd': ['9h 8h', '7h 6s 2h'] };
		prompt({ name: t('outs_title'), meta: t('outs_def'), tip: t('outs_tip') });
		const table = h('table', { class: 'facts' }, [
			h('caption', { text: t('draws_to_know') }),
			h('tr', {}, [h('th', { text: t('th_draw') }), h('th', { text: t('th_example') }), h('th', { text: t('outs') })]),
			...Object.keys(DRAWS).map((k) =>
				h('tr', {}, [
					h('td', { text: t('draw.' + k) }),
					h('td', { html: `${cardsOn(parse(eg[k][0]), parse(eg[k][1]))}<br><small>${t('draw_note.' + k)}</small>` }),
					h('td', { class: 'n', text: String(DRAWS[k].outs) }),
				])
			),
		]);
		show(table, true);
		setActions([Object.assign(toPractice(), { primary: true, key: ' ' })]);
	},
	odds() {
		prompt({ name: t('two_pcts'), meta: t('two_pcts_meta'), tip: t('odds_tip') });
		const exact = (o, n) => (100 * hitChance(o, n)).toFixed(0);
		show(
			[
				h('table', { class: 'facts' }, [
					h('caption', { text: t('hit_caption') }),
					h('tr', {}, [h('th', { text: t('outs') }), h('th', { text: t('one_to_come') }), h('th', { text: t('two_to_come') })]),
					...OUT_COUNTS.map((o) =>
						h('tr', {}, [
							h('td', { text: String(o) }),
							h('td', { class: 'n', html: t('pct_exactly', { pct: ruleOfThumb(o, 1), exact: exact(o, 1) }) }),
							h('td', { class: 'n', html: t('pct_exactly', { pct: ruleOfThumb(o, 2), exact: exact(o, 2) }) }),
						])
					),
				]),
				h('table', { class: 'facts' }, [
					h('caption', { text: t('need_caption') }),
					h('tr', {}, [h('th', { text: t('they_bet') }), h('th', { text: t('for_example') }), h('th', { text: t('you_need') })]),
					...BET_SIZES.map((b) => {
						const bet = Math.round(60 * b.of);
						return h('tr', {}, [h('td', { text: t('size.' + b.id) }), h('td', { text: t('size_example', { bet, pot: 60, total: 60 + 2 * bet }) }), h('td', { class: 'n', text: b.needs + '%' })]);
					}),
				]),
			],
			true
		);
		setActions([Object.assign(toPractice(), { primary: true, key: ' ' })]);
	},
	call() {
		examples(() => makeCall(Math.random), {
			prompt: { name: t('call_worth'), meta: t('compare_two') },
			body: h('ol', { class: 'rules', html: t('call_rules') }),
		});
	},
};

// ------------------------------------------------------------------ rail, settings panel, wiring
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
	const upNext = DRILLS.find((d) => !passed(d.id));
	DRILLS.forEach((d, i) => {
		const b = bests[d.id === 'preflop' ? 'preflop:all' : d.id];
		const done = passed(d.id);
		list.append(
			h('button', { class: 'item', type: 'button', 'data-drill': d.id, 'aria-pressed': String(d.id === S.drill), title: done ? t('test_passed') : t('pass_mark', { need: Math.ceil(PASS_MARK * TEST_SIZE[d.id]), n: TEST_SIZE[d.id] }), onclick: () => setDrill(d.id) }, [
				h('span', {}, [h('i', { text: String(i + 1) }), document.createTextNode(d.label)]),
				h('em', { class: done ? 'done' : upNext === d && !b ? 'next' : '', text: b ? `${b.score}/${b.total}` : upNext === d ? t('up_next') : '' }),
			])
		);
	});
	$('railPath').textContent = t('rail_path');
	const open = list.querySelector('[aria-pressed="true"]');
	if (scroll && open && open.scrollIntoView) open.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function showBest() {
	const b = bests[bestKey(S.drill)];
	$('best').innerHTML = b ? t('best_test', { score: b.score, total: b.total, time: clock(b.time) }) : t('no_test');
}
function fillPanel() {
	setSeg('modeSeg', mode());
	const n = TEST_SIZE[S.drill];
	$('modeHint').textContent = mode() === 'test' ? t('mode_hint_test', { n, pass: Math.ceil(PASS_MARK * n) }) : t('mode_hint.' + mode());
	$('seatBox').hidden = S.drill !== 'preflop';
	setSeg('seatSeg', S.seat);
	$('seatHint').textContent = S.seat === 'all' ? t('seat_hint_all') : t('seat_hint', { seat: seatName(S.seat), n: seat(S.seat).behind });
	$('keysHint').innerHTML = t(mode() === 'study' ? 'keys_study' : 'keys_' + S.drill);
	showBest();
}

function start() {
	run++;
	advance = null;
	setActions([]);
	session.right = session.total = session.streak = 0;
	session.t0 = 0;
	session.frozen = null;
	peek.q = null;
	peek.result = null;
	showStats();
	fillRail(true);
	fillPanel();
	$('prompt').classList.remove('is-ok', 'is-bad');
	if (mode() === 'study') STUDY[S.drill]();
	else if (mode() === 'practice') practice();
	else test();
}
function setMode(m) {
	S.mode[S.drill] = m;
	saveSettings();
	start();
}
function setDrill(id) {
	S.drill = id;
	saveSettings();
	start();
}

onSeg('modeSeg', setMode);
onSeg('seatSeg', (v) => {
	S.seat = v;
	saveSettings();
	start();
});
$('restartBtn').addEventListener('click', () => {
	document.body.classList.remove('sheet-open');
	start();
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
	const key = e.key === 'Enter' ? ' ' : e.key.toLowerCase();
	const a = actions.find((x) => x.key === key && x.el && !x.el.disabled);
	if (a) {
		e.preventDefault();
		// a focused button would also fire on Space/Enter: drop focus so it runs once
		if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
		if (a.on) a.on(a.id);
	} else if (key === ' ' && advance) {
		e.preventDefault();
		if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
		advance();
	}
});

// a first visit opens the first drill in Study; a later one opens wherever you left off. Another language starts the
// drill again, as changing any other setting does.
start();
lang.onChange(start);
if (!saved.get('seenIntro', false)) intro(true);

// handles for the checks in tools-src/poker-trainer/verify/
window.PT = { S, peek, start, setMode, setDrill, session };
