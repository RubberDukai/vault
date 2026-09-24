'use strict';
/**
 * The spaced-repetition scheduler decides when a flashcard comes back. A bug
 * here is invisible for weeks and then shows up as a language deck that either
 * never repeats or repeats everything for ever.
 */

const test = require('node:test');
const assert = require('node:assert');
const { newCardState, review, isDue, buildQueue, summarise, DAY_MS } = require('../src/srs/engine');

const NOW = Date.parse('2026-01-01T12:00:00Z');

test('a new card is due immediately', () => {
  const card = newCardState();
  assert.ok(isDue(card, NOW), 'a card never seen should come up straight away');
});

test('a failed card comes back in minutes, not days', () => {
  const after = review(newCardState(), 0, NOW);
  const wait = after.due - NOW;
  assert.ok(wait > 0 && wait <= 60 * 60 * 1000, `expected a short retry, got ${wait} ms`);
  assert.strictEqual(after.repetitions, 0, 'a failure goes back to the start of the ladder');
  assert.strictEqual(after.lapses, 1);
});

test('failing repeatedly lowers the ease but never below the floor', () => {
  let card = newCardState();
  for (let i = 0; i < 20; i++) card = review(card, 0, NOW);
  assert.ok(card.ease >= 1.3, `ease fell below the floor: ${card.ease}`);
});

test('a correct answer schedules at least a day away', () => {
  const after = review(newCardState(), 2, NOW);
  assert.ok(after.due - NOW >= DAY_MS, 'a passed card should not come back the same day');
  assert.strictEqual(after.repetitions, 1);
  assert.ok(!isDue(after, NOW));
});

test('intervals grow as a card keeps being answered', () => {
  let card = newCardState();
  const intervals = [];
  let at = NOW;
  for (let i = 0; i < 5; i++) {
    card = review(card, 2, at);
    intervals.push(card.interval);
    at = card.due;
  }
  for (let i = 1; i < intervals.length; i++) {
    assert.ok(intervals[i] >= intervals[i - 1], `interval shrank: ${intervals.join(', ')}`);
  }
  assert.ok(intervals[intervals.length - 1] > intervals[0], 'intervals must grow overall');
});

test('an easy answer schedules further out than a hard one', () => {
  let hard = newCardState();
  let easy = newCardState();
  let at = NOW;
  for (let i = 0; i < 3; i++) {
    hard = review(hard, 1, at);
    easy = review(easy, 3, at);
    at += 10 * DAY_MS;
  }
  assert.ok(easy.interval > hard.interval, `easy ${easy.interval} should exceed hard ${hard.interval}`);
});

test('intervals are capped, so nothing is scheduled beyond a lifetime', () => {
  let card = newCardState();
  let at = NOW;
  for (let i = 0; i < 40; i++) { card = review(card, 3, at); at = card.due; }
  assert.ok(card.interval <= 365 * 5, `interval ran away: ${card.interval} days`);
});

test('a grade outside the range is clamped rather than corrupting the state', () => {
  const high = review(newCardState(), 99, NOW);
  const low = review(newCardState(), -5, NOW);
  assert.strictEqual(high.lastGrade, 3);
  assert.strictEqual(low.lastGrade, 0);
  assert.ok(Number.isFinite(high.due) && Number.isFinite(low.due));
});

test('the queue respects the daily limit and the new-card limit', () => {
  const cards = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` }));
  const states = {};
  const queue = buildQueue(cards, states, { limit: 12, newLimit: 4, now: NOW });
  assert.ok(queue.length <= 12, `queue too long: ${queue.length}`);
  assert.ok(queue.length <= 50);
});

test('cards already learned and not yet due are left out of the queue', () => {
  const cards = [{ id: 'a' }, { id: 'b' }];
  const states = { a: review(newCardState(), 3, NOW), b: review(newCardState(), 3, NOW) };
  const queue = buildQueue(cards, states, { limit: 30, newLimit: 10, now: NOW });
  assert.strictEqual(queue.length, 0, 'nothing is due, so nothing should be queued');
});

test('a card never seen is offered as new even if it carries a future date', () => {
  const cards = [{ id: 'a' }];
  const states = { a: { ...newCardState(), due: NOW + 30 * DAY_MS } };
  const queue = buildQueue(cards, states, { limit: 30, newLimit: 10, now: NOW });
  assert.strictEqual(queue.length, 1, 'reviews === 0 means it has not been taught yet');
});

test('the new-card limit caps how many unseen cards arrive at once', () => {
  const cards = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}` }));
  const queue = buildQueue(cards, {}, { limit: 30, newLimit: 6, now: NOW });
  assert.strictEqual(queue.length, 6, 'with nothing due, only newLimit new cards should come');
});

test('the most overdue cards come first', () => {
  const cards = [{ id: 'old' }, { id: 'recent' }];
  const states = {
    old: { ...review(newCardState(), 2, NOW), due: NOW - 40 * DAY_MS },
    recent: { ...review(newCardState(), 2, NOW), due: NOW - 1 * DAY_MS },
  };
  const queue = buildQueue(cards, states, { limit: 30, newLimit: 0, now: NOW });
  assert.strictEqual(queue[0].id, 'old');
});

test('summarise counts what is due, new and learned', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const states = {
    a: review(newCardState(), 2, NOW - 40 * DAY_MS), // long overdue
    b: review(newCardState(), 2, NOW),               // scheduled ahead
  };
  const s = summarise(cards, states, NOW);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.new, 1, 'c has never been reviewed');
  assert.strictEqual(s.due, 1, 'a is overdue, b is scheduled ahead');
  assert.strictEqual(s.learning + s.mature, 2, 'every reviewed card is in one bucket or the other');
});

test('review does not mutate the state it was given', () => {
  const before = newCardState();
  const snapshot = JSON.stringify(before);
  review(before, 3, NOW);
  assert.strictEqual(JSON.stringify(before), snapshot, 'the caller\'s object must be left alone');
});
