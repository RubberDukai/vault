'use strict';
/**
 * Patience, blackjack and roulette — the rules, not the drawing.
 *
 * These are games people will play for hours by candlelight, so the rules
 * have to be the real ones: a king only on an empty column, a dealer who
 * stands on all seventeens, blackjack at three to two, and a wheel that pays
 * 35 to 1 on a number that comes up once in 37.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The file is written for a browser; give it the two globals it touches.
const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'cardgames.js'), 'utf8');
const sandbox = { window: {}, crypto: undefined };
new Function('window', `${source}`)(sandbox.window);
const C = sandbox.window.vaultCards;

const card = (rank, suit) => ({ r: C.RANKS.indexOf(rank), s: 'SHDC'.indexOf(suit), up: true });

// ------------------------------------------------------------------- pack

test('a pack is 52 cards, all different', () => {
  const deck = C.freshDeck();
  assert.strictEqual(deck.length, 52);
  assert.strictEqual(new Set(deck.map((c) => `${c.r}-${c.s}`)).size, 52);
});

test('six packs make a shoe of 312', () => {
  assert.strictEqual(C.freshDeck(6).length, 312);
});

test('shuffling keeps every card', () => {
  const before = C.freshDeck();
  const after = C.shuffle(C.freshDeck());
  assert.strictEqual(after.length, before.length);
  assert.strictEqual(new Set(after.map((c) => `${c.r}-${c.s}`)).size, 52);
});

// --------------------------------------------------------------- patience

test('a deal lays out 28 cards in seven piles, one face up each', () => {
  const g = new C.Klondike();
  assert.strictEqual(g.tableau.length, 7);
  let total = 0;
  for (const [i, pile] of g.tableau.entries()) {
    assert.strictEqual(pile.length, i + 1, `pile ${i} should hold ${i + 1}`);
    assert.strictEqual(pile.filter((c) => c.up).length, 1, 'exactly one face up');
    assert.ok(pile[pile.length - 1].up, 'and it is the last one');
    total += pile.length;
  }
  assert.strictEqual(total, 28);
  assert.strictEqual(g.stock.length, 24, 'the rest is the stock');
});

test('only an ace starts a foundation, and only in its own suit', () => {
  const g = new C.Klondike();
  assert.ok(g.canFound(card('A', 'S'), 0), 'the ace of spades on the spades pile');
  assert.ok(!g.canFound(card('A', 'S'), 1), 'not on the hearts pile');
  assert.ok(!g.canFound(card('2', 'S'), 0), 'a two cannot start it');
});

test('a foundation goes up in its own suit', () => {
  const g = new C.Klondike();
  g.foundations[0] = [card('A', 'S')];
  assert.ok(g.canFound(card('2', 'S'), 0));
  assert.ok(!g.canFound(card('3', 'S'), 0), 'no skipping');
  assert.ok(!g.canFound(card('2', 'C'), 0), 'no changing suit');
});

test('a tableau pile goes down in rank and alternates colour', () => {
  const g = new C.Klondike();
  g.tableau[0] = [card('9', 'S')]; // black nine
  assert.ok(g.canStack(card('8', 'H'), 0), 'red eight on a black nine');
  assert.ok(!g.canStack(card('8', 'C'), 0), 'not black on black');
  assert.ok(!g.canStack(card('7', 'H'), 0), 'not two below');
  assert.ok(!g.canStack(card('10', 'H'), 0), 'not upwards');
});

test('only a king may take an empty column', () => {
  const g = new C.Klondike();
  g.tableau[0] = [];
  assert.ok(g.canStack(card('K', 'H'), 0));
  assert.ok(!g.canStack(card('Q', 'H'), 0));
});

test('turning the stock moves a card to the waste, and one at a time by default', () => {
  const g = new C.Klondike();
  const stock = g.stock.length;
  g.draw();
  assert.strictEqual(g.stock.length, stock - 1);
  assert.strictEqual(g.waste.length, 1);
  assert.ok(g.waste[0].up, 'the turned card is face up');
});

test('turning three at a time turns three', () => {
  const g = new C.Klondike();
  g.drawThree = true;
  g.draw();
  assert.strictEqual(g.waste.length, 3);
});

test('an empty stock turns the waste back over, in order', () => {
  const g = new C.Klondike();
  while (g.stock.length) g.draw();
  const wasteSize = g.waste.length;
  g.draw();
  assert.strictEqual(g.waste.length, 0);
  assert.strictEqual(g.stock.length, wasteSize);
  assert.ok(g.stock.every((c) => !c.up), 'and face down again');
  assert.strictEqual(g.redeals, 1);
});

test('moving a card off a pile turns up the one beneath', () => {
  const g = new C.Klondike();
  // Rig pile 1 (two cards) so its top card can go to pile 0.
  g.tableau[0] = [card('9', 'S')];
  g.tableau[1] = [{ ...card('K', 'H'), up: false }, card('8', 'H')];
  assert.ok(g.move({ zone: 'tableau', pile: 1, index: 1 }, { zone: 'tableau', pile: 0 }));
  assert.strictEqual(g.tableau[0].length, 2);
  assert.ok(g.tableau[1][0].up, 'the card underneath is turned face up');
});

test('a run of cards moves together', () => {
  const g = new C.Klondike();
  g.tableau[0] = [card('J', 'S')];
  g.tableau[1] = [card('10', 'H'), card('9', 'C')];
  assert.ok(g.move({ zone: 'tableau', pile: 1, index: 0 }, { zone: 'tableau', pile: 0 }));
  assert.strictEqual(g.tableau[0].length, 3, 'both cards came across');
  assert.strictEqual(g.tableau[1].length, 0);
});

test('an illegal move changes nothing', () => {
  const g = new C.Klondike();
  g.tableau[0] = [card('9', 'S')];
  g.tableau[1] = [card('8', 'C')]; // black on black
  const before = JSON.stringify(g.tableau);
  assert.ok(!g.move({ zone: 'tableau', pile: 1, index: 0 }, { zone: 'tableau', pile: 0 }));
  assert.strictEqual(JSON.stringify(g.tableau), before);
});

test('undo puts it back', () => {
  const g = new C.Klondike();
  const before = JSON.stringify(g.tableau);
  g.draw();
  g.undo();
  assert.strictEqual(JSON.stringify(g.tableau), before);
  assert.strictEqual(g.waste.length, 0);
});

test('the game is won when all four foundations are complete', () => {
  const g = new C.Klondike();
  assert.ok(!g.won());
  g.foundations = [0, 1, 2, 3].map((s) => C.RANKS.map((_, r) => ({ r, s, up: true })));
  assert.ok(g.won());
});

// -------------------------------------------------------------- blackjack

test('an ace counts eleven until that would bust', () => {
  assert.strictEqual(C.handValue([card('A', 'S'), card('9', 'H')]).total, 20);
  assert.strictEqual(C.handValue([card('A', 'S'), card('9', 'H'), card('5', 'C')]).total, 15);
  assert.strictEqual(C.handValue([card('A', 'S'), card('A', 'H')]).total, 12, 'two aces are 12, not 22');
});

test('court cards are ten', () => {
  for (const rank of ['10', 'J', 'Q', 'K']) {
    assert.strictEqual(C.handValue([card(rank, 'S'), card('5', 'H')]).total, 15, rank);
  }
});

test('blackjack is an ace and a ten in two cards, not three', () => {
  assert.ok(C.isBlackjack([card('A', 'S'), card('K', 'H')]));
  assert.ok(!C.isBlackjack([card('7', 'S'), card('7', 'H'), card('7', 'C')]), '21 in three is not blackjack');
});

test('blackjack pays three to two', () => {
  const g = new C.Blackjack();
  g.bank = 100; g.stake = 20;
  g.bank -= g.stake;                    // as deal() does
  g.player = [card('A', 'S'), card('K', 'H')];
  g.dealer = [card('9', 'S'), card('9', 'H')];
  g.settle('blackjack', '');
  assert.strictEqual(g.bank, 80 + 20 + 30, 'stake back plus 1.5x');
});

test('an ordinary win pays evens, a push returns the stake, a loss keeps it', () => {
  const run = (result) => {
    const g = new C.Blackjack();
    g.bank = 100; g.stake = 20; g.bank -= g.stake;
    g.settle(result, '');
    return g.bank;
  };
  assert.strictEqual(run('win'), 120);
  assert.strictEqual(run('push'), 100);
  assert.strictEqual(run('lose'), 80);
});

test('the dealer draws to 16 and stands on all 17s', () => {
  const g = new C.Blackjack();
  g.refillShoe();
  g.bank = 500; g.stake = 10; g.bank -= g.stake;
  g.phase = 'playing';
  g.player = [card('K', 'S'), card('9', 'H')];      // 19
  g.dealer = [card('10', 'C'), { ...card('6', 'D'), up: false }]; // 16, must draw
  g.stand();
  assert.ok(C.handValue(g.dealer).total >= 17, 'the dealer kept drawing to at least 17');
  assert.strictEqual(g.phase, 'done');
  assert.ok(g.dealer.every((c) => c.up), 'and turned its hole card over');
});

test('a soft 17 is still 17: the dealer stands', () => {
  const g = new C.Blackjack();
  g.refillShoe();
  g.bank = 500; g.stake = 10; g.bank -= g.stake;
  g.phase = 'playing';
  g.player = [card('K', 'S'), card('9', 'H')];
  g.dealer = [card('A', 'C'), { ...card('6', 'D'), up: false }]; // soft 17
  g.stand();
  assert.strictEqual(g.dealer.length, 2, 'no card was drawn to a soft 17');
});

test('doubling stakes again and takes exactly one card', () => {
  const g = new C.Blackjack();
  g.refillShoe();
  g.bank = 100; g.stake = 20; g.bank -= g.stake;
  g.phase = 'playing';
  g.player = [card('6', 'S'), card('5', 'H')];
  g.dealer = [card('9', 'C'), { ...card('9', 'D'), up: false }];
  g.double();
  assert.strictEqual(g.player.length, 3, 'one card only');
  assert.ok(g.doubled);
  assert.strictEqual(g.phase, 'done');
});

test('going over 21 loses at once', () => {
  const g = new C.Blackjack();
  g.refillShoe();
  g.bank = 100; g.stake = 10; g.bank -= g.stake;
  g.phase = 'playing';
  g.player = [card('K', 'S'), card('Q', 'H'), card('5', 'C')]; // 25
  g.dealer = [card('2', 'C'), { ...card('3', 'D'), up: false }];
  const total = C.handValue(g.player).total;
  assert.ok(total > 21);
  g.settle('lose', '');
  assert.strictEqual(g.bank, 90, 'the stake is gone');
});

test('running out of counters starts you off again', () => {
  const g = new C.Blackjack();
  g.bank = 4; g.stake = 4; g.bank -= g.stake;
  g.settle('lose', 'x');
  assert.strictEqual(g.bank, 500);
});

// --------------------------------------------------------------- roulette

test('a European wheel has 37 pockets, one of them zero', () => {
  assert.strictEqual(C.WHEEL.length, 37);
  assert.strictEqual(new Set(C.WHEEL).size, 37);
  assert.ok(C.WHEEL.includes(0));
  for (let n = 1; n <= 36; n++) assert.ok(C.WHEEL.includes(n), `${n} is on the wheel`);
});

test('eighteen red, eighteen black, and zero is green', () => {
  assert.strictEqual(C.RED_NUMBERS.size, 18);
  assert.strictEqual(C.numberColour(0), 'green');
  let red = 0; let black = 0;
  for (let n = 1; n <= 36; n++) (C.numberColour(n) === 'red' ? red++ : black++);
  assert.strictEqual(red, 18);
  assert.strictEqual(black, 18);
});

test('zero loses the even-money and the dozen bets — which is the house edge', () => {
  for (const key of Object.keys(C.ROULETTE_BETS)) {
    assert.ok(!C.ROULETTE_BETS[key].wins(0), `${key} must not win on zero`);
  }
});

test('the even-money bets split the wheel properly', () => {
  const count = (key) => { let n = 0; for (let i = 0; i <= 36; i++) if (C.ROULETTE_BETS[key].wins(i)) n++; return n; };
  for (const key of ['red', 'black', 'odd', 'even', 'low', 'high']) {
    assert.strictEqual(count(key), 18, `${key} should cover 18 numbers`);
  }
  for (const key of ['dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3']) {
    assert.strictEqual(count(key), 12, `${key} should cover 12 numbers`);
  }
});

test('a straight-up number pays 35 to 1', () => {
  const g = new C.Roulette();
  g.bank = 100;
  g.chip = 10;
  g.place('17');
  assert.strictEqual(g.bank, 90, 'the chip left the bank');
  // Force the outcome rather than spinning until 17 turns up.
  g.bets = { 17: 10 };
  const staked = g.staking();
  assert.strictEqual(staked, 10);
  g.bank += 10 * 36;
  assert.strictEqual(g.bank, 450, '35 to 1 plus the stake back');
});

test('a spin returns a pocket on the wheel and remembers it', () => {
  const g = new C.Roulette();
  g.place('red');
  const pocket = g.spin();
  assert.ok(C.WHEEL.includes(pocket));
  assert.strictEqual(g.recent[0], pocket);
  assert.deepStrictEqual(g.bets, {}, 'the table is cleared after a spin');
});

test('spinning with nothing staked does nothing', () => {
  const g = new C.Roulette();
  const bank = g.bank;
  assert.strictEqual(g.spin(), null);
  assert.strictEqual(g.bank, bank);
});

test('clearing the bets gives the chips back', () => {
  const g = new C.Roulette();
  const bank = g.bank;
  g.place('red'); g.place('17'); g.place('dozen2');
  assert.ok(g.bank < bank);
  g.clearBets();
  assert.strictEqual(g.bank, bank);
});

test('over many spins the wheel pays out about what a real one does', () => {
  // Not a test of luck: a test that the payouts are wired to the right odds.
  // A single-zero wheel returns about 97.3% of everything staked on even money.
  const g = new C.Roulette();
  g.bank = 1e7;
  g.chip = 1;
  for (let i = 0; i < 20000; i++) { g.place('red'); g.spin(); }
  const ratio = g.returned / g.staked;
  assert.ok(ratio > 0.90 && ratio < 1.04, `returned ${(ratio * 100).toFixed(1)}% of stakes — expected about 97%`);
});
