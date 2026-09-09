'use strict';
/**
 * Spaced repetition, SM-2.
 *
 * SM-2 is from 1987, is four lines of arithmetic, and works. Newer schedulers
 * are better tuned but carry more machinery; this one you could re-derive from
 * memory on paper, which felt like the right property for this project.
 *
 * Grades: 0 again · 1 hard · 2 good · 3 easy
 */

const DAY_MS = 86400000;

const DEFAULT_CARD = {
  ease: 2.5,
  interval: 0,
  repetitions: 0,
  due: 0,
  lapses: 0,
  reviews: 0,
  lastGrade: null,
  lastReviewed: null,
};

function newCardState() {
  return { ...DEFAULT_CARD };
}

/** Apply a review to a card's scheduling state and return the new state. */
function review(state, grade, now = Date.now()) {
  const card = { ...DEFAULT_CARD, ...(state || {}) };
  const q = Math.max(0, Math.min(3, Number(grade)));

  card.reviews += 1;
  card.lastGrade = q;
  card.lastReviewed = now;

  if (q === 0) {
    // Failed: back to the start of the ladder, but keep some of the ease.
    card.repetitions = 0;
    card.lapses += 1;
    card.interval = 0;
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.due = now + 10 * 60 * 1000; // try again in ten minutes
    return card;
  }

  card.repetitions += 1;

  if (card.repetitions === 1) {
    card.interval = q === 1 ? 1 : q === 2 ? 1 : 3;
  } else if (card.repetitions === 2) {
    card.interval = q === 1 ? 3 : q === 2 ? 6 : 8;
  } else {
    const multiplier = q === 1 ? 1.2 : q === 2 ? card.ease : card.ease * 1.3;
    card.interval = Math.round(card.interval * multiplier);
  }

  // SM-2 ease adjustment, with q mapped onto the original 0-5 scale.
  const q5 = q === 1 ? 3 : q === 2 ? 4 : 5;
  card.ease = Math.max(1.3, card.ease + (0.1 - (5 - q5) * (0.08 + (5 - q5) * 0.02)));
  card.interval = Math.max(1, Math.min(card.interval, 365 * 5));
  card.due = now + card.interval * DAY_MS;

  return card;
}

function isDue(state, now = Date.now()) {
  if (!state || !state.due) return true;
  return state.due <= now;
}

/**
 * Build a review queue: due cards first (most overdue first), then new ones,
 * capped so a session is finishable rather than infinite.
 */
function buildQueue(cards, states, { limit = 30, newLimit = 10, now = Date.now() } = {}) {
  const due = [];
  const fresh = [];

  for (const card of cards) {
    const state = states[card.id];
    if (!state || state.reviews === 0) fresh.push(card);
    else if (isDue(state, now)) due.push({ card, overdue: now - state.due });
  }

  due.sort((a, b) => b.overdue - a.overdue);
  const queue = due.slice(0, limit).map((d) => d.card);
  const room = Math.min(newLimit, Math.max(0, limit - queue.length));
  queue.push(...fresh.slice(0, room));

  return queue;
}

function summarise(cards, states, now = Date.now()) {
  let due = 0;
  let fresh = 0;
  let learning = 0;
  let mature = 0;

  for (const card of cards) {
    const state = states[card.id];
    if (!state || state.reviews === 0) { fresh += 1; continue; }
    if (isDue(state, now)) due += 1;
    if (state.interval >= 21) mature += 1;
    else learning += 1;
  }

  return { total: cards.length, due, new: fresh, learning, mature };
}

module.exports = { newCardState, review, isDue, buildQueue, summarise, DAY_MS };
