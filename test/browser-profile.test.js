'use strict';
/**
 * Wiping the vault window's browser profile. Two things must both hold: the
 * browsing traces really go, and the app's own settings really stay — a wipe
 * that resets the theme and the selected person every launch would be
 * abandoned within a week, which is no privacy at all.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wipeProfile } = require('../src/browser-profile');

function fakeProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-profile-'));
  const write = (rel, text) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
  };
  // The shape Chromium actually leaves behind.
  write('Local State', '{}');
  write(path.join('Default', 'History'), 'visited pages');
  write(path.join('Default', 'Cookies'), 'cookies');
  write(path.join('Default', 'Preferences'), '{}');
  write(path.join('Default', 'Cache', 'Cache_Data', 'f_000001'), 'a cached page');
  write(path.join('Default', 'Sessions', 'Session_1'), 'open tabs');
  write(path.join('Default', 'Service Worker', 'ScriptCache', 'x'), 'sw');
  write(path.join('Default', 'Local Storage', 'leveldb', '000003.log'), 'vault.theme=terminal');
  return dir;
}

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

test('the history, cookies, cache and session all go', () => {
  const dir = fakeProfile();
  wipeProfile(dir);
  assert.ok(!exists(dir, path.join('Default', 'History')), 'history must be deleted');
  assert.ok(!exists(dir, path.join('Default', 'Cookies')), 'cookies must be deleted');
  assert.ok(!exists(dir, path.join('Default', 'Cache')), 'the cache must be deleted');
  assert.ok(!exists(dir, path.join('Default', 'Sessions')), 'the session must be deleted');
  assert.ok(!exists(dir, path.join('Default', 'Service Worker')), 'service workers must be deleted');
  assert.ok(!exists(dir, 'Local State'), 'browser-level state must be deleted');
});

test("the app's own settings survive", () => {
  const dir = fakeProfile();
  wipeProfile(dir);
  const kept = path.join('Default', 'Local Storage', 'leveldb', '000003.log');
  assert.ok(exists(dir, kept), 'Local Storage holds the theme and the selected person');
  assert.strictEqual(fs.readFileSync(path.join(dir, kept), 'utf8'), 'vault.theme=terminal');
});

test('keepSettings false wipes everything', () => {
  const dir = fakeProfile();
  wipeProfile(dir, { keepSettings: false });
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing should be left');
});

test('a wipe of a profile that is not there is harmless', () => {
  const dir = path.join(os.tmpdir(), `vault-profile-missing-${Date.now()}`);
  const result = wipeProfile(dir);
  assert.strictEqual(result.existed, false);
  assert.strictEqual(result.removed, 0);
});

test('wiping twice is safe and the second time finds nothing new', () => {
  const dir = fakeProfile();
  const first = wipeProfile(dir);
  const second = wipeProfile(dir);
  assert.ok(first.removed > 0);
  assert.strictEqual(second.removed, 0, 'nothing left to remove');
});

test('the profile folder itself is left in place for the browser to reuse', () => {
  const dir = fakeProfile();
  wipeProfile(dir);
  assert.ok(fs.existsSync(dir), 'the folder stays; only its contents go');
});
