'use strict';
/* Vault games: chess and draughts, for two people at one screen or one person
   against the machine. The machine is not strong — a few moves deep — which
   is exactly right for learning and for winter evenings. */

// ==================================================================== chess

const PIECE_GLYPHS = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};
const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// Piece-square tables (from white's side, rank 8 first), the classic simple ones.
const PST = {
  P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

class Chess {
  constructor(state) {
    if (state) { Object.assign(this, state); return; }
    this.board = Chess.startBoard();
    this.turn = 'w';
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = null;   // square index a pawn may capture onto
    this.halfmove = 0;
    this.history = [];       // { san, from, to, captured }
    this.snapshots = [];     // for undo
  }

  static startBoard() {
    const b = new Array(64).fill(null);
    const back = 'RNBQKBNR';
    for (let i = 0; i < 8; i++) {
      b[i] = 'b' + back[i];
      b[8 + i] = 'bP';
      b[48 + i] = 'wP';
      b[56 + i] = 'w' + back[i];
    }
    return b;
  }

  static sq(file, rank) { return rank * 8 + file; }  // rank 0 = top (8th rank)
  static name(i) { return 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8)); }

  snapshot() {
    return {
      board: this.board.slice(), turn: this.turn, castling: { ...this.castling },
      enPassant: this.enPassant, halfmove: this.halfmove, history: this.history.slice(),
    };
  }

  /** Pseudo-legal moves for a colour, before king safety. */
  pseudoMoves(colour) {
    const moves = [];
    const board = this.board;
    const enemy = colour === 'w' ? 'b' : 'w';
    const dir = colour === 'w' ? -1 : 1;
    for (let i = 0; i < 64; i++) {
      const piece = board[i];
      if (!piece || piece[0] !== colour) continue;
      const type = piece[1];
      const file = i % 8;
      const rank = Math.floor(i / 8);
      const push = (to, extra = {}) => moves.push({ from: i, to, piece, ...extra });

      if (type === 'P') {
        const one = i + dir * 8;
        if (one >= 0 && one < 64 && !board[one]) {
          const promo = Math.floor(one / 8) === (colour === 'w' ? 0 : 7);
          push(one, promo ? { promote: 'Q' } : {});
          const startRank = colour === 'w' ? 6 : 1;
          const two = i + dir * 16;
          if (rank === startRank && !board[two]) push(two, { double: true });
        }
        for (const df of [-1, 1]) {
          const f = file + df;
          if (f < 0 || f > 7) continue;
          const to = one + df;
          if (to < 0 || to > 63) continue;
          const promo = Math.floor(to / 8) === (colour === 'w' ? 0 : 7);
          if (board[to] && board[to][0] === enemy) push(to, promo ? { promote: 'Q' } : {});
          else if (to === this.enPassant) push(to, { enPassant: true });
        }
        continue;
      }

      const rays = type === 'N' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
        : type === 'K' ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
        : type === 'B' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        : type === 'R' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      const sliding = type === 'B' || type === 'R' || type === 'Q';
      for (const [df, dr] of rays) {
        let f = file + df;
        let r = rank + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const to = r * 8 + f;
          if (!board[to]) push(to);
          else { if (board[to][0] === enemy) push(to); break; }
          if (!sliding) break;
          f += df; r += dr;
        }
      }

      if (type === 'K') {
        const home = colour === 'w' ? 60 : 4;
        if (i === home && !this.attacked(home, enemy)) {
          if (this.castling[colour + 'K'] && !board[home + 1] && !board[home + 2] && board[home + 3] === colour + 'R'
            && !this.attacked(home + 1, enemy) && !this.attacked(home + 2, enemy)) push(home + 2, { castle: 'K' });
          if (this.castling[colour + 'Q'] && !board[home - 1] && !board[home - 2] && !board[home - 3] && board[home - 4] === colour + 'R'
            && !this.attacked(home - 1, enemy) && !this.attacked(home - 2, enemy)) push(home - 2, { castle: 'Q' });
        }
      }
    }
    return moves;
  }

  /** Is this square attacked by that colour? */
  attacked(square, by) {
    const board = this.board;
    const file = square % 8;
    const rank = Math.floor(square / 8);
    const pawnDir = by === 'w' ? 1 : -1; // a white pawn attacks upward (towards rank 0)
    for (const df of [-1, 1]) {
      const f = file + df;
      const r = rank + pawnDir;
      if (f >= 0 && f < 8 && r >= 0 && r < 8 && board[r * 8 + f] === by + 'P') return true;
    }
    for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      const f = file + df;
      const r = rank + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8 && board[r * 8 + f] === by + 'N') return true;
    }
    for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      let f = file + df;
      let r = rank + dr;
      let steps = 0;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        steps++;
        const p = board[r * 8 + f];
        if (p) {
          if (p[0] === by) {
            const t = p[1];
            const diagonal = df !== 0 && dr !== 0;
            if (t === 'Q' || (t === 'B' && diagonal) || (t === 'R' && !diagonal) || (t === 'K' && steps === 1)) return true;
          }
          break;
        }
        f += df; r += dr;
      }
    }
    return false;
  }

  kingSquare(colour) { return this.board.indexOf(colour + 'K'); }

  inCheck(colour = this.turn) {
    const k = this.kingSquare(colour);
    return k >= 0 && this.attacked(k, colour === 'w' ? 'b' : 'w');
  }

  legalMoves(colour = this.turn) {
    const out = [];
    for (const move of this.pseudoMoves(colour)) {
      const snap = this.snapshot();
      this.apply(move, true);
      if (!this.inCheck(colour)) out.push(move);
      Object.assign(this, snap);
    }
    return out;
  }

  /** Play a move. Assumes it is legal. */
  apply(move, silent = false) {
    const board = this.board;
    const piece = board[move.from];
    const colour = piece[0];
    let captured = board[move.to];
    if (!silent) this.snapshots.push(this.snapshot());

    if (move.enPassant) {
      const capSq = move.to + (colour === 'w' ? 8 : -8);
      captured = board[capSq];
      board[capSq] = null;
    }
    board[move.to] = move.promote ? colour + move.promote : piece;
    board[move.from] = null;
    if (move.castle === 'K') { board[move.to - 1] = board[move.to + 1]; board[move.to + 1] = null; }
    if (move.castle === 'Q') { board[move.to + 1] = board[move.to - 2]; board[move.to - 2] = null; }

    if (piece[1] === 'K') { this.castling[colour + 'K'] = false; this.castling[colour + 'Q'] = false; }
    for (const [sq, key] of [[63, 'wK'], [56, 'wQ'], [7, 'bK'], [0, 'bQ']]) {
      if (move.from === sq || move.to === sq) this.castling[key] = false;
    }
    this.enPassant = move.double ? move.from + (colour === 'w' ? -8 : 8) : null;
    this.halfmove = piece[1] === 'P' || captured ? 0 : this.halfmove + 1;
    this.turn = colour === 'w' ? 'b' : 'w';

    if (!silent) {
      const check = this.inCheck(this.turn);
      const mate = check && this.legalMoves(this.turn).length === 0;
      let san = move.castle === 'K' ? 'O-O' : move.castle === 'Q' ? 'O-O-O'
        : `${piece[1] === 'P' ? (captured ? 'abcdefgh'[move.from % 8] : '') : piece[1]}${captured ? 'x' : ''}${Chess.name(move.to)}${move.promote ? '=' + move.promote : ''}`;
      san += mate ? '#' : check ? '+' : '';
      this.history.push({ san, from: move.from, to: move.to });
    }
    return captured;
  }

  undo() {
    const snap = this.snapshots.pop();
    if (snap) Object.assign(this, snap);
  }

  status() {
    const moves = this.legalMoves(this.turn);
    const check = this.inCheck(this.turn);
    if (moves.length === 0) return check ? { over: true, result: this.turn === 'w' ? 'b' : 'w', reason: 'checkmate' } : { over: true, result: 'draw', reason: 'stalemate' };
    if (this.halfmove >= 100) return { over: true, result: 'draw', reason: 'fifty moves without a capture or pawn move' };
    const pieces = this.board.filter(Boolean);
    if (pieces.length <= 3 && pieces.every((p) => 'KNB'.includes(p[1]))) return { over: true, result: 'draw', reason: 'not enough material to mate' };
    return { over: false, check, moves };
  }

  evaluate() {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (!p) continue;
      const idx = p[0] === 'w' ? i : (7 - Math.floor(i / 8)) * 8 + (i % 8);
      const v = PIECE_VALUES[p[1]] + PST[p[1]][idx];
      score += p[0] === 'w' ? v : -v;
    }
    return score;
  }

  /** Alpha-beta search; returns the best move for the side to move. */
  bestMove(depth = 3) {
    const me = this.turn;
    const sign = me === 'w' ? 1 : -1;
    const search = (d, alpha, beta, colour) => {
      const moves = this.legalMoves(colour);
      if (moves.length === 0) return this.inCheck(colour) ? -100000 - d : 0;
      if (d === 0) return this.evaluate() * (colour === 'w' ? 1 : -1);
      // Captures first: cheaper cut-offs.
      moves.sort((a, b) => (this.board[b.to] ? PIECE_VALUES[this.board[b.to][1]] : 0) - (this.board[a.to] ? PIECE_VALUES[this.board[a.to][1]] : 0));
      let best = -Infinity;
      for (const move of moves) {
        const snap = this.snapshot();
        this.apply(move, true);
        const score = -search(d - 1, -beta, -alpha, colour === 'w' ? 'b' : 'w');
        Object.assign(this, snap);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    };
    const moves = this.legalMoves(me);
    let bestScore = -Infinity;
    let best = null;
    const shuffled = moves.slice().sort(() => Math.random() - 0.5);
    for (const move of shuffled) {
      const snap = this.snapshot();
      this.apply(move, true);
      const score = -search(depth - 1, -Infinity, Infinity, me === 'w' ? 'b' : 'w');
      Object.assign(this, snap);
      if (score > bestScore) { bestScore = score; best = move; }
    }
    void sign;
    return best;
  }
}

// ================================================================= draughts

/** English draughts: 8×8, men move forward, captures compulsory, kings both ways. */
class Draughts {
  constructor(state) {
    if (state) { Object.assign(this, state); return; }
    this.board = new Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8);
      const dark = (r + i) % 2 === 1;
      if (!dark) continue;
      if (r < 3) this.board[i] = 'bM';
      else if (r > 4) this.board[i] = 'wM';
    }
    this.turn = 'w';
    this.history = [];
    this.snapshots = [];
    this.mustContinue = null; // a piece mid-multi-jump
  }

  snapshot() { return { board: this.board.slice(), turn: this.turn, history: this.history.slice(), mustContinue: this.mustContinue }; }

  /** All jumps from a square (single steps of a capture chain). */
  jumpsFrom(i, colour) {
    const piece = this.board[i];
    if (!piece) return [];
    const king = piece[1] === 'K';
    const dirs = king ? [-1, 1] : [colour === 'w' ? -1 : 1];
    const out = [];
    const f = i % 8;
    const r = Math.floor(i / 8);
    for (const dr of dirs) for (const df of [-1, 1]) {
      const mr = r + dr; const mf = f + df;
      const tr = r + 2 * dr; const tf = f + 2 * df;
      if (tr < 0 || tr > 7 || tf < 0 || tf > 7) continue;
      const mid = this.board[mr * 8 + mf];
      if (mid && mid[0] !== colour && !this.board[tr * 8 + tf]) out.push({ from: i, to: tr * 8 + tf, over: mr * 8 + mf });
    }
    return out;
  }

  legalMoves(colour = this.turn) {
    if (this.mustContinue !== null) return this.jumpsFrom(this.mustContinue, colour);
    const jumps = [];
    const steps = [];
    for (let i = 0; i < 64; i++) {
      const piece = this.board[i];
      if (!piece || piece[0] !== colour) continue;
      jumps.push(...this.jumpsFrom(i, colour));
      const king = piece[1] === 'K';
      const dirs = king ? [-1, 1] : [colour === 'w' ? -1 : 1];
      const f = i % 8;
      const r = Math.floor(i / 8);
      for (const dr of dirs) for (const df of [-1, 1]) {
        const tr = r + dr; const tf = f + df;
        if (tr < 0 || tr > 7 || tf < 0 || tf > 7) continue;
        if (!this.board[tr * 8 + tf]) steps.push({ from: i, to: tr * 8 + tf });
      }
    }
    return jumps.length ? jumps : steps; // a capture, when available, is compulsory
  }

  apply(move, silent = false) {
    if (!silent) this.snapshots.push(this.snapshot());
    const piece = this.board[move.from];
    const colour = piece[0];
    this.board[move.to] = piece;
    this.board[move.from] = null;
    if (move.over !== undefined) this.board[move.over] = null;
    const crowned = piece[1] === 'M' && Math.floor(move.to / 8) === (colour === 'w' ? 0 : 7);
    if (crowned) this.board[move.to] = colour + 'K';

    // A capture may continue from the landing square (not after crowning).
    if (move.over !== undefined && !crowned && this.jumpsFrom(move.to, colour).length) {
      this.mustContinue = move.to;
    } else {
      this.mustContinue = null;
      this.turn = colour === 'w' ? 'b' : 'w';
    }
    if (!silent) this.history.push({ from: move.from, to: move.to, capture: move.over !== undefined });
  }

  undo() {
    const snap = this.snapshots.pop();
    if (snap) Object.assign(this, snap);
  }

  status() {
    const moves = this.legalMoves(this.turn);
    if (moves.length === 0) return { over: true, result: this.turn === 'w' ? 'b' : 'w', reason: 'no moves left' };
    return { over: false, moves };
  }

  evaluate() {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (!p) continue;
      const r = Math.floor(i / 8);
      let v = p[1] === 'K' ? 160 : 100 + (p[0] === 'w' ? (7 - r) : r) * 3; // men gain value as they advance
      if (i % 8 === 0 || i % 8 === 7) v += 5; // edge pieces cannot be jumped
      s += p[0] === 'w' ? v : -v;
    }
    return s;
  }

  bestMove(depth = 6) {
    const me = this.turn;
    const search = (d, alpha, beta) => {
      const colour = this.turn;
      const moves = this.legalMoves(colour);
      if (moves.length === 0) return -100000 - d;
      if (d === 0) return this.evaluate() * (colour === 'w' ? 1 : -1);
      let best = -Infinity;
      for (const move of moves) {
        const snap = this.snapshot();
        this.apply(move, true);
        // The same side moves again mid-capture: no sign flip.
        const score = this.turn === colour ? search(d, alpha, beta) : -search(d - 1, -beta, -alpha);
        Object.assign(this, snap);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    };
    const moves = this.legalMoves(me).sort(() => Math.random() - 0.5);
    let best = null;
    let bestScore = -Infinity;
    for (const move of moves) {
      const snap = this.snapshot();
      this.apply(move, true);
      const score = this.turn === me ? search(depth, -Infinity, Infinity) : -search(depth - 1, -Infinity, Infinity);
      Object.assign(this, snap);
      if (score > bestScore) { bestScore = score; best = move; }
    }
    return best;
  }
}

// ====================================================================== ui

let GAMES_STATE = null;
try { GAMES_STATE = JSON.parse(localStorage.getItem('vault.games') || 'null'); } catch { GAMES_STATE = null; }
if (!GAMES_STATE) GAMES_STATE = { game: 'chess', chess: null, draughts: null, opponent: 'human', side: 'w', flip: false };
const saveGames = () => { try { localStorage.setItem('vault.games', JSON.stringify(GAMES_STATE)); } catch { /* fine */ } };

function loadGame(kind) {
  const saved = GAMES_STATE[kind];
  if (kind === 'chess') return saved ? new Chess({ ...saved, snapshots: saved.snapshots || [] }) : new Chess();
  return saved ? new Draughts({ ...saved, snapshots: saved.snapshots || [] }) : new Draughts();
}
function storeGame(kind, game) {
  const { snapshots, ...rest } = game;
  GAMES_STATE[kind] = { ...rest, snapshots: (snapshots || []).slice(-40) };
  saveGames();
}

async function renderGames(params) {
  const gameParam = params && params.get('game');
  if (gameParam === 'chess' || gameParam === 'draughts') GAMES_STATE.game = gameParam;

  view.innerHTML = `
    <div class="row-between" style="flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <h1 style="margin:0">Games</h1>
      <div class="row" style="gap:6px">
        <button class="btn btn-sm game-tab" data-game="chess">Chess</button>
        <button class="btn btn-sm game-tab" data-game="draughts">Draughts</button>
      </div>
    </div>
    <div class="game-shell">
      <div class="board-wrap"><div class="board" id="board"></div></div>
      <aside class="game-side" id="game-side"></aside>
    </div>`;

  for (const t of view.querySelectorAll('.game-tab')) {
    t.classList.toggle('btn-active', t.dataset.game === GAMES_STATE.game);
    t.onclick = () => { GAMES_STATE.game = t.dataset.game; saveGames(); renderGames(); };
  }

  const kind = GAMES_STATE.game;
  let game = loadGame(kind);
  const boardEl = document.getElementById('board');
  const side = document.getElementById('game-side');
  let selected = null;
  let thinking = false;
  let lastMove = game.history.length ? game.history[game.history.length - 1] : null;

  const humanTurn = () => GAMES_STATE.opponent === 'human' || game.turn === GAMES_STATE.side;

  const paintBoard = () => {
    const status = game.status();
    const legal = status.over ? [] : status.moves;
    const targets = selected === null ? [] : legal.filter((m) => m.from === selected).map((m) => m.to);
    const movable = new Set(legal.map((m) => m.from));
    const cells = [];
    for (let n = 0; n < 64; n++) {
      const i = GAMES_STATE.flip ? 63 - n : n;
      const r = Math.floor(i / 8);
      const f = i % 8;
      const dark = (r + f) % 2 === 1;
      const piece = game.board[i];
      const classes = ['sq', dark ? 'dark' : 'light'];
      if (selected === i) classes.push('selected');
      if (targets.includes(i)) classes.push('target');
      if (lastMove && (lastMove.from === i || lastMove.to === i)) classes.push('last');
      if (movable.has(i) && humanTurn() && !status.over) classes.push('movable');
      if (kind === 'chess' && piece && piece[1] === 'K' && status.check && piece[0] === game.turn) classes.push('check');
      let glyph = '';
      if (piece) {
        glyph = kind === 'chess' ? `<span class="piece ${piece[0]}">${PIECE_GLYPHS[piece]}</span>`
          : `<span class="man ${piece[0] === 'w' ? 'white' : 'black'}${piece[1] === 'K' ? ' king' : ''}">${piece[1] === 'K' ? '♛' : ''}</span>`;
      }
      const coord = f === 0 ? `<span class="coord rank">${8 - r}</span>` : '';
      const fileLabel = r === 7 ? `<span class="coord file">${'abcdefgh'[f]}</span>` : '';
      cells.push(`<button class="${classes.join(' ')}" data-i="${i}">${glyph}${coord}${fileLabel}</button>`);
    }
    boardEl.innerHTML = cells.join('');
    for (const cell of boardEl.querySelectorAll('.sq')) cell.onclick = () => onSquare(Number(cell.dataset.i));
    paintSide(status);
  };

  const paintSide = (status) => {
    const turnName = game.turn === 'w' ? 'White' : 'Black';
    let line;
    if (status.over) {
      line = status.result === 'draw' ? `Draw — ${status.reason}.` : `${status.result === 'w' ? 'White' : 'Black'} wins — ${status.reason}.`;
    } else if (thinking) line = 'The machine is thinking…';
    else line = `${turnName} to move${status.check ? ' — check!' : ''}${game.mustContinue !== null ? ' — keep jumping' : ''}`;

    const moves = kind === 'chess'
      ? game.history.map((h, i) => (i % 2 === 0 ? `<span class="mv-no">${i / 2 + 1}.</span> ` : '') + `<span class="mv">${esc(h.san)}</span> `).join('')
      : game.history.map((h, i) => `<span class="mv">${'abcdefgh'[h.from % 8]}${8 - Math.floor(h.from / 8)}${h.capture ? 'x' : '-'}${'abcdefgh'[h.to % 8]}${8 - Math.floor(h.to / 8)}</span>${i % 2 ? '<br>' : ' '}`).join('');

    side.innerHTML = `
      <p class="game-status ${status.over ? 'over' : ''}">${line}</p>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-sm" id="g-undo" ${game.snapshots.length ? '' : 'disabled'}>Undo</button>
        <button class="btn btn-sm" id="g-flip">Flip board</button>
        <button class="btn btn-sm" id="g-new">New game</button>
      </div>
      <h3 style="margin:0 0 6px">Opponent</h3>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <select class="map-select" id="g-opponent" style="width:auto">
          <option value="human" ${GAMES_STATE.opponent === 'human' ? 'selected' : ''}>Two people, one screen</option>
          <option value="easy" ${GAMES_STATE.opponent === 'easy' ? 'selected' : ''}>Machine — easy</option>
          <option value="normal" ${GAMES_STATE.opponent === 'normal' ? 'selected' : ''}>Machine — normal</option>
          <option value="hard" ${GAMES_STATE.opponent === 'hard' ? 'selected' : ''}>Machine — takes its time</option>
        </select>
        <select class="map-select" id="g-side" style="width:auto" ${GAMES_STATE.opponent === 'human' ? 'disabled' : ''}>
          <option value="w" ${GAMES_STATE.side === 'w' ? 'selected' : ''}>I play white</option>
          <option value="b" ${GAMES_STATE.side === 'b' ? 'selected' : ''}>I play black</option>
        </select>
      </div>
      <h3 style="margin:0 0 6px">Moves</h3>
      <div class="move-list mono">${moves || '<span class="faint">None yet.</span>'}</div>
      <details style="margin-top:12px"><summary class="faint">How to play</summary>
        ${kind === 'chess' ? `<p class="faint">Click a piece, then a square. Castling: move the king two squares. Pawns promote to queens. En passant works. The machine looks a few moves ahead; "takes its time" looks further and may pause a second or two.</p>`
        : `<p class="faint">Men move one square diagonally forward. Jump an enemy piece to capture it — you must capture when you can, and keep jumping while you can. Reach the far side to be crowned a king, which moves both ways. Win by leaving the other side no moves.</p>`}
      </details>`;

    document.getElementById('g-undo').onclick = () => {
      game.undo();
      if (GAMES_STATE.opponent !== 'human' && game.turn !== GAMES_STATE.side && game.snapshots.length) game.undo();
      selected = null; lastMove = game.history[game.history.length - 1] || null;
      storeGame(kind, game); paintBoard();
    };
    document.getElementById('g-flip').onclick = () => { GAMES_STATE.flip = !GAMES_STATE.flip; saveGames(); paintBoard(); };
    document.getElementById('g-new').onclick = () => {
      if (game.history.length && !confirm('Start a new game? The current one is lost.')) return;
      game = kind === 'chess' ? new Chess() : new Draughts();
      selected = null; lastMove = null;
      storeGame(kind, game); paintBoard(); maybeMachine();
    };
    document.getElementById('g-opponent').onchange = (e) => { GAMES_STATE.opponent = e.target.value; saveGames(); paintBoard(); maybeMachine(); };
    document.getElementById('g-side').onchange = (e) => { GAMES_STATE.side = e.target.value; GAMES_STATE.flip = e.target.value === 'b'; saveGames(); paintBoard(); maybeMachine(); };
  };

  const onSquare = (i) => {
    if (thinking || !humanTurn()) return;
    const status = game.status();
    if (status.over) return;
    const move = status.moves.find((m) => m.from === selected && m.to === i);
    if (move) {
      if (kind === 'chess' && move.promote) {
        const choice = (prompt('Promote to: Q (queen), R (rook), B (bishop) or N (knight)', 'Q') || 'Q').toUpperCase()[0];
        move.promote = 'QRBN'.includes(choice) ? choice : 'Q';
      }
      game.apply(move);
      lastMove = { from: move.from, to: move.to };
      selected = game.mustContinue !== null ? move.to : null;
      storeGame(kind, game);
      paintBoard();
      maybeMachine();
      return;
    }
    const piece = game.board[i];
    if (piece && piece[0] === game.turn && (game.mustContinue === null || game.mustContinue === i)) selected = selected === i ? null : i;
    else selected = null;
    paintBoard();
  };

  const maybeMachine = () => {
    if (GAMES_STATE.opponent === 'human' || game.turn === GAMES_STATE.side || game.status().over) return;
    thinking = true;
    paintSide(game.status());
    const depth = kind === 'chess'
      ? { easy: 1, normal: 3, hard: 4 }[GAMES_STATE.opponent]
      : { easy: 2, normal: 6, hard: 9 }[GAMES_STATE.opponent];
    setTimeout(() => {
      const move = game.bestMove(depth);
      thinking = false;
      if (!move) { paintBoard(); return; }
      game.apply(move);
      lastMove = { from: move.from, to: move.to };
      storeGame(kind, game);
      paintBoard();
      if (game.mustContinue !== null) maybeMachine(); // a multi-jump continues
    }, 120);
  };

  paintBoard();
  maybeMachine();
}

window.renderGames = renderGames;
window.vaultGames = { Chess, Draughts };
