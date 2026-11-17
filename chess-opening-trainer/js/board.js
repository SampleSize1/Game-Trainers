// The board: draws a position and turns taps and drags into "from this square to that one".
// It knows nothing about the rules: the page tells it which squares a piece may go to.
//
//   const board = createBoard(element, { targets: (from) => ['e3', 'e4'], move: (from, to) => {...} });
//   board.show({ fen, view: 'w', last: ['e2', 'e4'], arrows: [{ from, to, kind: 'good' }], check: 'e8', mover: 'w', slide: true });
//
// mover: the colour whose pieces can be moved now (null: nobody's). slide: animate the last move.

import { t } from './text.js';

const FILES = 'abcdefgh';
const ARROW = { good: '#3fbf7f', bad: '#ff6a58', line: '#6fd0e8' };

export function createBoard(el, { targets, move }) {
	el.textContent = '';
	const squaresEl = add(el, 'div', 'squares');
	const piecesEl = add(el, 'div', 'pieces');
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('class', 'arrows');
	svg.setAttribute('viewBox', '0 0 8 8');
	el.append(svg);

	let now = { fen: null, view: 'w', last: null, arrows: [], check: null, mover: null };
	let pieces = new Map(); // square -> { code: 'wk', el }
	let selected = null;
	let allowed = [];
	let drag = null;
	const squareEls = new Map();

	function add(parent, tag, cls) {
		const node = document.createElement(tag);
		node.className = cls;
		parent.append(node);
		return node;
	}

	// column and row on screen (0,0 is top left) for a square, given who sits at the bottom
	function place(square) {
		const f = FILES.indexOf(square[0]);
		const r = Number(square[1]) - 1;
		return now.view === 'w' ? [f, 7 - r] : [7 - f, r];
	}
	function squareAt(x, y) {
		const box = el.getBoundingClientRect();
		const col = Math.floor(((x - box.left) / box.width) * 8);
		const row = Math.floor(((y - box.top) / box.height) * 8);
		if (col < 0 || col > 7 || row < 0 || row > 7) return null;
		return now.view === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
	}
	const at = (node, col, row) => (node.style.transform = `translate(${col * 100}%, ${row * 100}%)`);

	function drawSquares() {
		squaresEl.textContent = '';
		squareEls.clear();
		for (let row = 0; row < 8; row++) {
			for (let col = 0; col < 8; col++) {
				const square = now.view === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
				const light = (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 0; // a1 is dark
				const node = add(squaresEl, 'div', 'sq' + (light ? ' l' : ''));
				if (row === 7) add(node, 'span', 'co f').textContent = square[0];
				if (col === 0) add(node, 'span', 'co r').textContent = square[1];
				squareEls.set(square, node);
			}
		}
	}

	function marks() {
		for (const [square, node] of squareEls) {
			node.classList.toggle('last', !!now.last && now.last.includes(square));
			node.classList.toggle('sel', square === selected);
			node.classList.toggle('chk', square === now.check);
			node.classList.toggle('dot', allowed.includes(square));
			node.classList.toggle('cap', allowed.includes(square) && pieces.has(square));
		}
		el.classList.toggle('can-move', !!now.mover);
	}

	function drawPieces(slide) {
		piecesEl.textContent = '';
		pieces = new Map();
		const rows = now.fen.split(' ')[0].split('/');
		rows.forEach((row, i) => {
			let file = 0;
			for (const ch of row) {
				if (ch >= '1' && ch <= '8') {
					file += Number(ch);
					continue;
				}
				const square = FILES[file] + (8 - i);
				const code = (ch === ch.toLowerCase() ? 'b' : 'w') + ch.toLowerCase();
				const node = add(piecesEl, 'div', 'pc ' + code);
				at(node, ...place(square));
				pieces.set(square, { code, el: node });
				file++;
			}
		});
		// the piece that just moved slides in from where it was
		if (slide && now.last && pieces.has(now.last[1])) {
			const node = pieces.get(now.last[1]).el;
			at(node, ...place(now.last[0]));
			node.getBoundingClientRect(); // make the browser take the starting place in
			node.classList.add('move');
			at(node, ...place(now.last[1]));
		}
	}

	function drawArrows() {
		svg.textContent = '';
		for (const arrow of now.arrows || []) {
			const [x1, y1] = place(arrow.from).map((n) => n + 0.5);
			const [x2, y2] = place(arrow.to).map((n) => n + 0.5);
			const len = Math.hypot(x2 - x1, y2 - y1);
			if (!len) continue;
			const ux = (x2 - x1) / len;
			const uy = (y2 - y1) / len;
			const head = 0.42; // length of the arrowhead, in squares
			const bx = x2 - ux * head;
			const by = y2 - uy * head;
			const colour = ARROW[arrow.kind] || ARROW.line;
			const line = document.createElementNS(svg.namespaceURI, 'line');
			Object.entries({ x1: x1 + ux * 0.3, y1: y1 + uy * 0.3, x2: bx, y2: by, stroke: colour, 'stroke-width': 0.17, 'stroke-linecap': 'round', opacity: 0.85 }).forEach(([k, v]) => line.setAttribute(k, v));
			const tip = document.createElementNS(svg.namespaceURI, 'polygon');
			const w = 0.24;
			tip.setAttribute('points', `${x2},${y2} ${bx - uy * w},${by + ux * w} ${bx + uy * w},${by - ux * w}`);
			tip.setAttribute('fill', colour);
			tip.setAttribute('opacity', 0.9);
			svg.append(line, tip);
		}
	}

	function select(square) {
		selected = square;
		allowed = square ? targets(square) : [];
		marks();
	}

	const mine = (square) => now.mover && pieces.has(square) && pieces.get(square).code[0] === now.mover;

	el.addEventListener('pointerdown', (e) => {
		if (!now.mover || e.button > 0 || e.target.closest('.promo')) return;
		const square = squareAt(e.clientX, e.clientY);
		if (!square) return;
		e.preventDefault();
		if (selected && allowed.includes(square)) {
			const from = selected;
			select(null);
			move(from, square);
			return;
		}
		if (!mine(square)) return select(null);
		const again = selected === square;
		select(square);
		const piece = pieces.get(square).el;
		const box = el.getBoundingClientRect();
		drag = { square, piece, again, moved: false, size: box.width / 8, left: box.left, top: box.top, id: e.pointerId };
		try {
			el.setPointerCapture(e.pointerId);
		} catch {}
	});
	el.addEventListener('pointermove', (e) => {
		if (!drag || e.pointerId !== drag.id) return;
		const x = e.clientX - drag.left - drag.size / 2;
		const y = e.clientY - drag.top - drag.size / 2;
		if (!drag.moved) {
			const [col, row] = place(drag.square);
			if (Math.hypot(x - col * drag.size, y - row * drag.size) < drag.size * 0.18) return; // a tap, not a drag
			drag.moved = true;
			drag.piece.classList.remove('move');
			drag.piece.classList.add('drag');
		}
		drag.piece.style.transform = `translate(${x}px, ${y}px)`;
	});
	const drop = (e) => {
		if (!drag || e.pointerId !== drag.id) return;
		const { square, piece, again, moved } = drag;
		drag = null;
		piece.classList.remove('drag');
		const target = e.type === 'pointerup' ? squareAt(e.clientX, e.clientY) : null;
		if (moved && target && target !== square && allowed.includes(target)) {
			at(piece, ...place(target));
			select(null);
			move(square, target);
			return;
		}
		at(piece, ...place(square));
		// a second tap on the selected piece puts it down again
		if (!moved && again) select(null);
	};
	el.addEventListener('pointerup', drop);
	el.addEventListener('pointercancel', drop);

	return {
		show(next) {
			const turned = next.view && next.view !== now.view;
			now = { ...now, arrows: [], last: null, check: null, mover: null, ...next };
			selected = null;
			allowed = [];
			drag = null;
			if (turned || !squareEls.size) drawSquares();
			drawPieces(!!next.slide && !turned);
			drawArrows();
			marks();
		},
		/** Ask which piece a pawn becomes: resolves with 'q', 'r', 'b' or 'n' */
		promote(colour) {
			return new Promise((done) => {
				const layer = add(el, 'div', 'promo');
				const row = add(layer, 'div', '');
				for (const type of ['q', 'r', 'b', 'n']) {
					const button = add(row, 'button', '');
					button.type = 'button';
					button.setAttribute('aria-label', t('promote.' + type));
					add(button, 'span', 'pc ' + colour + type);
					button.addEventListener('click', () => {
						layer.remove();
						done(type);
					});
				}
			});
		},
		get view() {
			return now.view;
		},
	};
}
