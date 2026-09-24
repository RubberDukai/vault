'use strict';
/* Vault card and table games: patience, blackjack and roulette.
   Loaded before app.js, drawn into the Games page by games.js. No money, no
   accounts, no network — a pack of cards and a wheel for a long evening. */

// ============================================================ the pack

const SUITS = [
  { id: 'S', glyph: '♠', colour: 'black', name: 'spades' },
  { id: 'H', glyph: '♥', colour: 'red', name: 'hearts' },
  { id: 'D', glyph: '♦', colour: 'red', name: 'diamonds' },
  { id: 'C', glyph: '♣', colour: 'black', name: 'clubs' },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A card is { r: rank index 0-12, s: suit index 0-3, up: face up? }. */
const cardRank = (c) => RANKS[c.r];
const cardSuit = (c) => SUITS[c.s];
const isRed = (c) => SUITS[c.s].colour === 'red';

function freshDeck(packs = 1) {
  const cards = [];
  for (let p = 0; p < packs; p++) {
    for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) cards.push({ r, s, up: false });
  }
  return cards;
}

/**
 * Fisher–Yates, from the browser's own randomness where it has it.
 *
 * Math.random is fine for patience; for anything where a person is betting
 * against the house it is worth using the real generator, so nobody has to
 * wonder whether the shuffle is honest.
 */
function shuffle(cards) {
  const random = (n) => {
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      // Rejection sampling, so the modulo does not favour the low numbers.
      const limit = Math.floor(0xffffffff / n) * n;
      let v;
      do { window.crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
      return v % n;
    }
    return Math.floor(Math.random() * n);
  };
  for (let i = cards.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** One card as HTML. Face down cards show their back. */
function cardHtml(card, extra = '') {
  if (!card) return `<span class="card empty ${extra}"></span>`;
  if (!card.up) return `<span class="card down ${extra}"></span>`;
  const suit = cardSuit(card);
  return `<span class="card ${suit.colour} ${extra}">
    <span class="card-rank">${cardRank(card)}</span><span class="card-suit">${suit.glyph}</span>
  </span>`;
}

// ================================================================ patience

/**
 * Klondike, the patience everybody means when they say patience.
 *
 * Click a card, then click where it goes — no dragging, because dragging is
 * fiddly with a trackpad and impossible with a finger on a small screen.
 */
class Klondike {
  constructor(state) {
    if (state) { Object.assign(this, state); return; }
    this.newDeal();
  }

  newDeal(drawThree = this.drawThree || false) {
    const deck = shuffle(freshDeck());
    this.tableau = [];
    for (let i = 0; i < 7; i++) {
      const pile = deck.splice(0, i + 1);
      pile[pile.length - 1].up = true;   // only the last of each pile shows
      this.tableau.push(pile);
    }
    this.stock = deck;
    this.waste = [];
    this.foundations = [[], [], [], []]; // one per suit, in the SUITS order
    this.drawThree = drawThree;
    this.moves = 0;
    this.redeals = 0;
    this.history = [];
  }

  snapshot() {
    return JSON.parse(JSON.stringify({
      tableau: this.tableau, stock: this.stock, waste: this.waste,
      foundations: this.foundations, moves: this.moves, redeals: this.redeals,
    }));
  }

  remember() {
    this.history.push(this.snapshot());
    if (this.history.length > 60) this.history.shift();
  }

  undo() {
    const previous = this.history.pop();
    if (previous) Object.assign(this, previous);
  }

  /** Turn one card (or three) from the stock; an empty stock turns the waste back over. */
  draw() {
    this.remember();
    if (!this.stock.length) {
      if (!this.waste.length) return false;
      this.stock = this.waste.reverse().map((c) => ({ ...c, up: false }));
      this.waste = [];
      this.redeals++;
      return true;
    }
    const n = this.drawThree ? 3 : 1;
    for (let i = 0; i < n && this.stock.length; i++) {
      const card = this.stock.pop();
      card.up = true;
      this.waste.push(card);
    }
    this.moves++;
    return true;
  }

  /** May this card go on that foundation? Ace first, then up in the same suit. */
  canFound(card, index) {
    if (!card) return false;
    const pile = this.foundations[index];
    if (!pile.length) return card.r === 0 && card.s === index;
    const top = pile[pile.length - 1];
    return card.s === top.s && card.r === top.r + 1;
  }

  /** May this card start or continue that tableau pile? Down in rank, alternating colour. */
  canStack(card, pileIndex) {
    const pile = this.tableau[pileIndex];
    if (!pile.length) return card.r === 12; // only a king may take an empty column
    const top = pile[pile.length - 1];
    if (!top.up) return false;
    return top.r === card.r + 1 && isRed(top) !== isRed(card);
  }

  /**
   * Move a card (and anything sitting on it) from one place to another.
   * `from` is { zone: 'waste'|'tableau'|'foundation', pile, index }.
   */
  move(from, to) {
    const cards = this.take(from, true);
    if (!cards.length) return false;

    if (to.zone === 'foundation') {
      if (cards.length !== 1 || !this.canFound(cards[0], to.pile)) return false;
      this.remember();
      this.take(from);
      this.foundations[to.pile].push(cards[0]);
    } else if (to.zone === 'tableau') {
      if (!this.canStack(cards[0], to.pile)) return false;
      this.remember();
      this.take(from);
      this.tableau[to.pile].push(...cards);
    } else return false;

    // Uncover whatever was underneath.
    if (from.zone === 'tableau') {
      const pile = this.tableau[from.pile];
      if (pile.length && !pile[pile.length - 1].up) pile[pile.length - 1].up = true;
    }
    this.moves++;
    return true;
  }

  /** The cards a selection refers to. `peek` looks without removing. */
  take(from, peek = false) {
    if (from.zone === 'waste') {
      if (!this.waste.length) return [];
      return peek ? [this.waste[this.waste.length - 1]] : [this.waste.pop()];
    }
    if (from.zone === 'foundation') {
      const pile = this.foundations[from.pile];
      if (!pile.length) return [];
      return peek ? [pile[pile.length - 1]] : [pile.pop()];
    }
    const pile = this.tableau[from.pile];
    if (from.index === undefined || from.index >= pile.length) return [];
    if (!pile[from.index].up) return [];
    return peek ? pile.slice(from.index) : pile.splice(from.index);
  }

  /** Send everything that can go up, up. The tidying-up button. */
  autoFound() {
    let moved = 0;
    for (let pass = 0; pass < 60; pass++) {
      let did = false;
      const sources = [{ zone: 'waste' }];
      for (let p = 0; p < 7; p++) {
        const pile = this.tableau[p];
        if (pile.length) sources.push({ zone: 'tableau', pile: p, index: pile.length - 1 });
      }
      for (const from of sources) {
        const [card] = this.take(from, true);
        if (!card) continue;
        for (let f = 0; f < 4; f++) {
          if (this.canFound(card, f) && this.move(from, { zone: 'foundation', pile: f })) {
            moved++; did = true; break;
          }
        }
        if (did) break;
      }
      if (!did) break;
    }
    return moved;
  }

  won() { return this.foundations.every((f) => f.length === 13); }
}

// =============================================================== blackjack

/** The value of a hand, counting aces as 11 until that would bust. */
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.r === 0) { aces++; total += 11; }
    else total += Math.min(10, card.r + 1);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

/**
 * Blackjack against the house, with counters rather than money.
 *
 * Six packs, dealer stands on all 17s, blackjack pays 3 to 2 — the ordinary
 * rules, so that what is learned here is true at a real table. The point is
 * the arithmetic and the discipline, not the gambling: the stake is a pile of
 * counters that resets when it runs out.
 */
class Blackjack {
  constructor(state) {
    if (state) { Object.assign(this, state); return; }
    this.bank = 500;
    this.stake = 25;
    this.shoe = [];
    this.player = [];
    this.dealer = [];
    this.phase = 'betting';   // betting | playing | dealer | done
    this.message = 'Place your bet.';
    this.doubled = false;
    this.record = { won: 0, lost: 0, pushed: 0 };
  }

  refillShoe() {
    // Six packs, reshuffled when a quarter is left, as a real shoe is.
    this.shoe = shuffle(freshDeck(6));
  }

  drawCard(faceUp = true) {
    if (this.shoe.length < 78) this.refillShoe();
    const card = this.shoe.pop();
    card.up = faceUp;
    return card;
  }

  deal() {
    if (this.stake > this.bank) return false;
    this.bank -= this.stake;
    this.doubled = false;
    this.player = [this.drawCard(), this.drawCard()];
    this.dealer = [this.drawCard(), this.drawCard(false)];
    this.phase = 'playing';
    this.message = '';

    if (isBlackjack(this.player)) {
      this.dealer[1].up = true;
      if (isBlackjack(this.dealer)) this.settle('push', 'Both blackjack — a push.');
      else this.settle('blackjack', 'Blackjack! Paid three to two.');
    }
    return true;
  }

  hit() {
    if (this.phase !== 'playing') return;
    this.player.push(this.drawCard());
    const { total } = handValue(this.player);
    if (total > 21) { this.dealer[1].up = true; this.settle('lose', `Bust with ${total}.`); }
    else if (total === 21) this.stand();
  }

  double() {
    if (this.phase !== 'playing' || this.player.length !== 2 || this.bank < this.stake) return;
    this.bank -= this.stake;
    this.doubled = true;
    this.player.push(this.drawCard());
    const { total } = handValue(this.player);
    if (total > 21) { this.dealer[1].up = true; this.settle('lose', `Doubled and bust with ${total}.`); }
    else this.stand();
  }

  stand() {
    if (this.phase !== 'playing') return;
    this.phase = 'dealer';
    this.dealer[1].up = true;
    while (handValue(this.dealer).total < 17) this.dealer.push(this.drawCard());

    const mine = handValue(this.player).total;
    const theirs = handValue(this.dealer).total;
    if (theirs > 21) this.settle('win', `The dealer bust with ${theirs}.`);
    else if (theirs > mine) this.settle('lose', `${theirs} beats your ${mine}.`);
    else if (theirs < mine) this.settle('win', `Your ${mine} beats ${theirs}.`);
    else this.settle('push', `Both ${mine} — a push.`);
  }

  settle(result, message) {
    const stake = this.doubled ? this.stake * 2 : this.stake;
    if (result === 'blackjack') { this.bank += stake + Math.round(stake * 1.5); this.record.won++; }
    else if (result === 'win') { this.bank += stake * 2; this.record.won++; }
    else if (result === 'push') { this.bank += stake; this.record.pushed++; }
    else this.record.lost++;
    this.phase = 'done';
    this.message = message;
    if (this.bank < 5) { this.bank = 500; this.message += ' Out of counters — here are five hundred more.'; }
  }
}

// ================================================================ roulette

// A European wheel: one zero, in the order the numbers actually sit on it.
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const numberColour = (n) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

/** Every kind of bet, what it pays, and whether a given number wins it. */
const ROULETTE_BETS = {
  red: { label: 'Red', pays: 1, wins: (n) => numberColour(n) === 'red' },
  black: { label: 'Black', pays: 1, wins: (n) => numberColour(n) === 'black' },
  odd: { label: 'Odd', pays: 1, wins: (n) => n !== 0 && n % 2 === 1 },
  even: { label: 'Even', pays: 1, wins: (n) => n !== 0 && n % 2 === 0 },
  low: { label: '1–18', pays: 1, wins: (n) => n >= 1 && n <= 18 },
  high: { label: '19–36', pays: 1, wins: (n) => n >= 19 && n <= 36 },
  dozen1: { label: '1st 12', pays: 2, wins: (n) => n >= 1 && n <= 12 },
  dozen2: { label: '2nd 12', pays: 2, wins: (n) => n >= 13 && n <= 24 },
  dozen3: { label: '3rd 12', pays: 2, wins: (n) => n >= 25 && n <= 36 },
  col1: { label: 'Column 1', pays: 2, wins: (n) => n !== 0 && n % 3 === 1 },
  col2: { label: 'Column 2', pays: 2, wins: (n) => n !== 0 && n % 3 === 2 },
  col3: { label: 'Column 3', pays: 2, wins: (n) => n !== 0 && n % 3 === 0 },
};

/**
 * Roulette, with counters.
 *
 * The house edge is shown on the page, because that is the only genuinely
 * useful thing roulette has to teach: a single-zero wheel pays 35 to 1 on a
 * number that comes up once in 37, which is a loss of 2.7% of everything
 * staked, for ever, whatever system anybody tells you about.
 */
class Roulette {
  constructor(state) {
    if (state) { Object.assign(this, state); return; }
    this.bank = 500;
    this.chip = 10;
    this.bets = {};          // key -> amount; a number key is a straight-up bet
    this.lastSpin = null;
    this.recent = [];
    this.message = 'Place your chips.';
    this.spun = 0;
    this.staked = 0;
    this.returned = 0;
  }

  staking() { return Object.values(this.bets).reduce((n, v) => n + v, 0); }

  place(key) {
    if (this.bank < this.chip) return false;
    this.bank -= this.chip;
    this.bets[key] = (this.bets[key] || 0) + this.chip;
    return true;
  }

  clearBets() {
    this.bank += this.staking();
    this.bets = {};
  }

  spin() {
    const staked = this.staking();
    if (!staked) { this.message = 'Place a chip first.'; return null; }

    const pocket = WHEEL[shuffle([...WHEEL.keys()])[0]];
    this.lastSpin = pocket;
    this.recent.unshift(pocket);
    this.recent = this.recent.slice(0, 18);
    this.spun++;
    this.staked += staked;

    let won = 0;
    for (const [key, amount] of Object.entries(this.bets)) {
      const straight = Number(key);
      if (Number.isInteger(straight) && String(straight) === key) {
        if (straight === pocket) won += amount * 36; // 35 to 1, plus the stake
        continue;
      }
      const bet = ROULETTE_BETS[key];
      if (bet && bet.wins(pocket)) won += amount * (bet.pays + 1);
    }

    this.bank += won;
    this.returned += won;
    this.bets = {};
    const colour = numberColour(pocket);
    this.message = won
      ? `${pocket} ${colour} — you win ${won} back on ${staked} staked.`
      : `${pocket} ${colour} — nothing this time.`;
    if (this.bank < this.chip) { this.bank = 500; this.message += ' Out of counters — here are five hundred more.'; }
    return pocket;
  }
}

// ====================================================================== ui

const CARD_STATE_KEY = 'vault.cardgames';
let CARD_STATE = null;
try { CARD_STATE = JSON.parse(localStorage.getItem(CARD_STATE_KEY) || 'null'); } catch { CARD_STATE = null; }
if (!CARD_STATE) CARD_STATE = { klondike: null, blackjack: null, roulette: null };
const saveCards = () => { try { localStorage.setItem(CARD_STATE_KEY, JSON.stringify(CARD_STATE)); } catch { /* fine */ } };

const esc2 = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------- patience ui

function renderKlondike(root) {
  let game = CARD_STATE.klondike ? new Klondike(CARD_STATE.klondike) : new Klondike();
  let picked = null; // { zone, pile, index }

  const store = () => { CARD_STATE.klondike = JSON.parse(JSON.stringify(game)); saveCards(); };

  const paint = () => {
    const won = game.won();
    root.innerHTML = `
      <div class="row-between" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" id="k-new">New deal</button>
          <button class="btn btn-sm" id="k-undo" ${game.history.length ? '' : 'disabled'}>Undo</button>
          <button class="btn btn-sm" id="k-auto">Send up</button>
          <label class="checkbox-row" style="font-size:13px;margin-left:6px">
            <input type="checkbox" id="k-three" ${game.drawThree ? 'checked' : ''}><span>Turn three</span>
          </label>
        </div>
        <span class="faint mono">${game.moves} moves${game.redeals ? ` · ${game.redeals} times through` : ''}</span>
      </div>

      ${won ? '<p class="game-status over">Out! Every card home.</p>' : ''}

      <div class="klondike">
        <div class="k-row">
          <button class="k-slot stock" id="k-stock" title="Turn a card">
            ${game.stock.length ? cardHtml({ up: false }) : '<span class="card empty recycle">↻</span>'}
            <span class="k-count">${game.stock.length}</span>
          </button>
          <div class="k-slot waste" id="k-waste">
            ${game.waste.slice(-3).map((c, i, a) => cardHtml(c, i === a.length - 1 ? 'top' : 'under')).join('') || cardHtml(null)}
          </div>
          <div class="k-gap"></div>
          ${game.foundations.map((pile, i) => `
            <div class="k-slot foundation" data-found="${i}">
              ${pile.length ? cardHtml(pile[pile.length - 1]) : `<span class="card empty">${SUITS[i].glyph}</span>`}
            </div>`).join('')}
        </div>

        <div class="k-row tableau">
          ${game.tableau.map((pile, p) => `
            <div class="k-col" data-col="${p}">
              ${pile.length
                ? pile.map((c, i) => `<span class="k-card" data-col="${p}" data-index="${i}" style="--i:${i}">${cardHtml(c)}</span>`).join('')
                : `<span class="k-card" data-col="${p}" data-index="0" style="--i:0">${cardHtml(null)}</span>`}
            </div>`).join('')}
        </div>
      </div>

      <details style="margin-top:14px"><summary class="faint">How to play</summary>
        <p class="faint">Build the four piles at the top from ace to king, one suit each. Down here, stack cards downwards in
        alternating colours — a red eight on a black nine — and only a king may go into an empty column. Click a card, then
        click where it should go. Turn the stock for more; when it runs out, click it again to turn the pile back over.
        <strong>Send up</strong> sends every card that can go home. Not every deal can be won: about four in five can.</p>
      </details>`;

    // --- picking up and putting down ---
    const select = (sel) => { picked = sel; paint(); highlight(); };
    const highlight = () => {
      if (!picked) return;
      const selector = picked.zone === 'waste' ? '#k-waste .card.top'
        : picked.zone === 'foundation' ? `[data-found="${picked.pile}"] .card`
        : `.k-card[data-col="${picked.pile}"][data-index="${picked.index}"] .card`;
      root.querySelector(selector)?.classList.add('picked');
      if (picked.zone === 'tableau') {
        for (const el of root.querySelectorAll(`.k-card[data-col="${picked.pile}"]`)) {
          if (Number(el.dataset.index) > picked.index) el.querySelector('.card')?.classList.add('picked');
        }
      }
    };

    const tryMove = (to) => {
      if (!picked) return;
      if (game.move(picked, to)) { store(); picked = null; paint(); return; }
      picked = null;
      paint();
    };

    document.getElementById('k-stock').onclick = () => { picked = null; game.draw(); store(); paint(); };
    document.getElementById('k-new').onclick = () => { game.newDeal(game.drawThree); store(); picked = null; paint(); };
    document.getElementById('k-undo').onclick = () => { game.undo(); store(); picked = null; paint(); };
    document.getElementById('k-auto').onclick = () => { game.autoFound(); store(); picked = null; paint(); };
    document.getElementById('k-three').onchange = (e) => { game.drawThree = e.target.checked; game.newDeal(e.target.checked); store(); paint(); };

    const wasteEl = document.getElementById('k-waste');
    wasteEl.onclick = () => {
      if (!game.waste.length) return;
      if (picked && picked.zone === 'waste') { picked = null; paint(); return; }
      select({ zone: 'waste' });
    };

    for (const el of root.querySelectorAll('[data-found]')) {
      el.onclick = () => {
        const index = Number(el.dataset.found);
        if (picked) { tryMove({ zone: 'foundation', pile: index }); return; }
        if (game.foundations[index].length) select({ zone: 'foundation', pile: index });
      };
    }

    for (const el of root.querySelectorAll('.k-card')) {
      el.onclick = (e) => {
        e.stopPropagation();
        const pile = Number(el.dataset.col);
        const index = Number(el.dataset.index);
        if (picked) { tryMove({ zone: 'tableau', pile }); return; }
        const card = game.tableau[pile][index];
        if (card && card.up) select({ zone: 'tableau', pile, index });
      };
    }
    for (const el of root.querySelectorAll('.k-col')) {
      el.onclick = () => { if (picked) tryMove({ zone: 'tableau', pile: Number(el.dataset.col) }); };
    }

    highlight();
  };

  paint();
}

// ------------------------------------------------------------ blackjack ui

function renderBlackjack(root) {
  let game = CARD_STATE.blackjack ? new Blackjack(CARD_STATE.blackjack) : new Blackjack();
  if (!game.shoe || !game.shoe.length) game.refillShoe();
  const store = () => { CARD_STATE.blackjack = JSON.parse(JSON.stringify(game)); saveCards(); };

  const paint = () => {
    const mine = handValue(game.player);
    const theirs = handValue(game.dealer.filter((c) => c.up));
    const betting = game.phase === 'betting' || game.phase === 'done';

    root.innerHTML = `
      <div class="row-between" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <span class="mono">Counters: <strong>${game.bank}</strong></span>
        <span class="faint mono">won ${game.record.won} · lost ${game.record.lost} · pushed ${game.record.pushed}</span>
      </div>

      <div class="bj-table">
        <div class="bj-hand">
          <span class="faint">Dealer${game.dealer.length ? ` — ${theirs.total}${game.dealer.some((c) => !c.up) ? '+' : ''}` : ''}</span>
          <div class="bj-cards">${game.dealer.map((c) => cardHtml(c)).join('') || '<span class="card empty"></span>'}</div>
        </div>
        <div class="bj-hand">
          <span class="faint">You${game.player.length ? ` — ${mine.total}${mine.soft ? ' (soft)' : ''}` : ''}</span>
          <div class="bj-cards">${game.player.map((c) => cardHtml(c)).join('') || '<span class="card empty"></span>'}</div>
        </div>
      </div>

      <p class="game-status ${game.phase === 'done' ? 'over' : ''}">${esc2(game.message || '')}</p>

      ${betting ? `
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <span class="faint">Bet</span>
          ${[5, 25, 100].map((v) => `<button class="btn btn-sm bj-chip ${game.stake === v ? 'btn-active' : ''}" data-v="${v}">${v}</button>`).join('')}
          <button class="btn btn-primary" id="bj-deal" ${game.stake > game.bank ? 'disabled' : ''}>Deal — ${game.stake}</button>
        </div>`
      : `
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-primary" id="bj-hit">Hit</button>
          <button class="btn" id="bj-stand">Stand</button>
          <button class="btn" id="bj-double" ${game.player.length === 2 && game.bank >= game.stake ? '' : 'disabled'}>Double</button>
        </div>`}

      <details style="margin-top:12px"><summary class="faint">How to play, and the arithmetic</summary>
        <p class="faint">Get closer to 21 than the dealer without going over. Picture cards are ten; an ace is eleven until
        that would bust you, then it is one. Two cards making 21 is blackjack and pays three to two. The dealer must draw
        to 16 and stand on 17 — it has no choice, which is what makes the game solvable.</p>
        <p class="faint">Six packs, shuffled when the shoe runs low. The counters are only counters; when they run out you
        get five hundred more, because the point here is the arithmetic and not the gambling. Knowing that the dealer's
        rules are fixed and that the house still wins over time is the real lesson.</p>
      </details>`;

    for (const chip of root.querySelectorAll('.bj-chip')) {
      chip.onclick = () => { game.stake = Number(chip.dataset.v); store(); paint(); };
    }
    const deal = document.getElementById('bj-deal');
    if (deal) deal.onclick = () => { game.deal(); store(); paint(); };
    const hit = document.getElementById('bj-hit');
    if (hit) hit.onclick = () => { game.hit(); store(); paint(); };
    const stand = document.getElementById('bj-stand');
    if (stand) stand.onclick = () => { game.stand(); store(); paint(); };
    const dbl = document.getElementById('bj-double');
    if (dbl) dbl.onclick = () => { game.double(); store(); paint(); };
  };

  paint();
}

// ------------------------------------------------------------- roulette ui

function renderRoulette(root) {
  let game = CARD_STATE.roulette ? new Roulette(CARD_STATE.roulette) : new Roulette();
  const store = () => { CARD_STATE.roulette = JSON.parse(JSON.stringify(game)); saveCards(); };
  let spinning = false;

  const chipsOn = (key) => (game.bets[key] ? `<span class="rl-chip">${game.bets[key]}</span>` : '');

  const paint = () => {
    // The table, laid out as it is in life: three columns of twelve.
    const numbers = [];
    for (let row = 0; row < 12; row++) {
      for (let col = 3; col >= 1; col--) {
        const n = row * 3 + col;
        numbers.push(`<button class="rl-num ${numberColour(n)} ${game.lastSpin === n ? 'hit' : ''}" data-bet="${n}">${n}${chipsOn(String(n))}</button>`);
      }
    }

    const outside = (key) => {
      const bet = ROULETTE_BETS[key];
      return `<button class="rl-out ${key}" data-bet="${key}">${bet.label}<span class="faint"> ${bet.pays}:1</span>${chipsOn(key)}</button>`;
    };

    root.innerHTML = `
      <div class="row-between" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <span class="mono">Counters: <strong>${game.bank}</strong>${game.staking() ? ` · staked ${game.staking()}` : ''}</span>
        <div class="row" style="gap:6px;align-items:center">
          <span class="faint">Chip</span>
          ${[1, 5, 25].map((v) => `<button class="btn btn-sm rl-chipsize ${game.chip === v ? 'btn-active' : ''}" data-v="${v}">${v}</button>`).join('')}
        </div>
      </div>

      <div class="rl-result ${game.lastSpin === null ? 'faint' : numberColour(game.lastSpin)}">
        ${game.lastSpin === null ? '—' : game.lastSpin}
      </div>
      <p class="game-status">${esc2(game.message || '')}</p>

      <div class="rl-table">
        <button class="rl-num green zero" data-bet="0">0${chipsOn('0')}</button>
        <div class="rl-grid">${numbers.join('')}</div>
        <div class="rl-cols">${['col3', 'col2', 'col1'].map(outside).join('')}</div>
      </div>
      <div class="rl-outside">
        ${['dozen1', 'dozen2', 'dozen3'].map(outside).join('')}
      </div>
      <div class="rl-outside">
        ${['low', 'even', 'red', 'black', 'odd', 'high'].map(outside).join('')}
      </div>

      <div class="row" style="gap:8px;flex-wrap:wrap;margin:12px 0">
        <button class="btn btn-primary" id="rl-spin" ${spinning || !game.staking() ? 'disabled' : ''}>Spin</button>
        <button class="btn" id="rl-clear" ${game.staking() ? '' : 'disabled'}>Take the chips back</button>
      </div>

      ${game.recent.length ? `<p class="faint">Last spins: ${game.recent.map((n) => `<span class="rl-recent ${numberColour(n)}">${n}</span>`).join('')}</p>` : ''}

      <details style="margin-top:12px"><summary class="faint">How it works, and why the house wins</summary>
        <p class="faint">Click the table to put a chip down, then spin. A single number pays 35 to 1; red or black, odd or
        even, high or low pay evens; a dozen or a column pays 2 to 1.</p>
        <p class="faint"><strong>Here is the whole of it.</strong> This is a European wheel: 37 pockets, numbered 0 to 36.
        A single number comes up once in 37 spins and pays 35 to 1 — so for every 37 counters staked you get 36 back.
        Zero is not red, black, odd or even, so it takes the even-money bets too. Every bet on the table loses the same
        2.7% of everything staked, for ever. No system changes it, because the wheel has no memory: after ten reds in a
        row, red is still exactly as likely as it was the first time.</p>
      </details>`;

    for (const el of root.querySelectorAll('[data-bet]')) {
      el.onclick = () => { if (!spinning && game.place(el.dataset.bet)) { store(); paint(); } };
    }
    for (const el of root.querySelectorAll('.rl-chipsize')) {
      el.onclick = () => { game.chip = Number(el.dataset.v); store(); paint(); };
    }
    const clear = document.getElementById('rl-clear');
    if (clear) clear.onclick = () => { game.clearBets(); store(); paint(); };

    const spin = document.getElementById('rl-spin');
    if (spin) spin.onclick = () => {
      if (spinning || !game.staking()) return;
      spinning = true;
      const result = root.querySelector('.rl-result');
      // A moment of the wheel turning, so the number does not simply appear.
      let ticks = 0;
      const rattle = setInterval(() => {
        const n = WHEEL[Math.floor(Math.random() * WHEEL.length)];
        result.textContent = n;
        result.className = `rl-result ${numberColour(n)}`;
        if (++ticks > 14) {
          clearInterval(rattle);
          spinning = false;
          game.spin();
          store();
          paint();
        }
      }, 60);
      spin.disabled = true;
    };
  };

  paint();
}

window.vaultCards = {
  SUITS, RANKS, freshDeck, shuffle, cardHtml, cardRank, cardSuit, isRed,
  Klondike, Blackjack, handValue, isBlackjack,
  Roulette, WHEEL, RED_NUMBERS, numberColour, ROULETTE_BETS,
  renderKlondike, renderBlackjack, renderRoulette,
};
