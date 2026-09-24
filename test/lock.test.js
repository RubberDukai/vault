'use strict';
/**
 * The PIN and the encryption behind it.
 *
 * The thing these guard against is not a clever attacker — it is the ordinary
 * case of a machine being lost, sold, borrowed or searched. So the tests are
 * about the promises made on the Setup page: what is written here cannot be
 * read off the disk without the PIN, the PIN can be changed without
 * re-encrypting everything, a written-down phrase always gets you back in,
 * and taking the lock off leaves readable files rather than rubble.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  VaultLock, encrypt, decrypt, looksEncrypted,
  makeRecoveryPhrase, normalisePhrase, checkPin, pinStrength, RECOVERY_WORDS, MIN_PIN,
} = require('../src/lock');
const { Store } = require('../src/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vault-lock-test-'));

// ------------------------------------------------------------- the wordlist

test('the recovery wordlist is fixed, unique and unambiguous', () => {
  assert.strictEqual(RECOVERY_WORDS.length, 256, 'twelve words of 256 is 96 bits');
  assert.strictEqual(new Set(RECOVERY_WORDS).size, 256, 'no duplicates');
  for (const word of RECOVERY_WORDS) assert.match(word, /^[a-z]{3,10}$/, word);
  // No word may be the start of another, or a phrase read back is ambiguous.
  for (const word of RECOVERY_WORDS) {
    const clash = RECOVERY_WORDS.find((other) => other !== word && other.startsWith(word));
    assert.strictEqual(clash, undefined, `${word} is a prefix of ${clash}`);
  }
});

test('a phrase is twelve words from the list', () => {
  const phrase = makeRecoveryPhrase().split(' ');
  assert.strictEqual(phrase.length, 12);
  for (const word of phrase) assert.ok(RECOVERY_WORDS.includes(word), word);
});

test('two phrases are not the same', () => {
  assert.notStrictEqual(makeRecoveryPhrase(), makeRecoveryPhrase());
});

test('reading a phrase back forgives case and punctuation', () => {
  assert.strictEqual(normalisePhrase('Acorn,  AMBER.  anchor'), 'acorn amber anchor');
  assert.strictEqual(normalisePhrase('\n acorn \t amber \n'), 'acorn amber');
});

test('a word that is not on the list is named, not swallowed', () => {
  assert.throws(() => normalisePhrase('acorn zzzz amber'), /zzzz/);
});

// ----------------------------------------------------------------- the PIN

test('a PIN has to be long enough to be worth having', () => {
  assert.throws(() => checkPin('12345'), new RegExp(String(MIN_PIN)));
  assert.throws(() => checkPin(''), /at least/);
  assert.ok(checkPin('123456'));
  assert.ok(checkPin('a passphrase is fine too'));
});

test('the strength note is honest about digits', () => {
  assert.strictEqual(pinStrength('12345').level, 'too short');
  assert.strictEqual(pinStrength('123456').level, 'weak');
  assert.strictEqual(pinStrength('three unrelated words').level, 'strong');
});

// -------------------------------------------------------------- encryption

test('ciphertext does not contain the plaintext', () => {
  const key = Buffer.alloc(32, 7);
  const blob = encrypt(key, Buffer.from('the well is behind the barn'));
  assert.ok(looksEncrypted(blob));
  assert.ok(!blob.includes(Buffer.from('barn')));
  assert.strictEqual(decrypt(key, blob).toString(), 'the well is behind the barn');
});

test('a tampered file is refused, not silently accepted', () => {
  const key = Buffer.alloc(32, 7);
  const blob = encrypt(key, Buffer.from('hello'));
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => decrypt(key, blob), /auth|unable to authenticate|tag/i);
});

test('the wrong key does not decrypt', () => {
  const blob = encrypt(Buffer.alloc(32, 7), Buffer.from('hello'));
  assert.throws(() => decrypt(Buffer.alloc(32, 8), blob));
});

test('plain JSON is not mistaken for ciphertext', () => {
  assert.ok(!looksEncrypted(Buffer.from('{"profiles":[]}')));
});

// --------------------------------------------------------------- the lock

test('enabling produces a phrase and leaves the vault open', async () => {
  const lock = new VaultLock(tmp());
  assert.strictEqual(lock.locked, false, 'nothing is locked before it is set up');
  const phrase = await lock.enable('a good long pin');
  assert.strictEqual(phrase.split(' ').length, 12);
  assert.ok(lock.key, 'and we hold the key straight away');
  assert.strictEqual(lock.locked, false);
});

test('a second process finds it locked, and the right PIN opens it', async () => {
  const dir = tmp();
  const first = new VaultLock(dir);
  await first.enable('a good long pin');

  const second = new VaultLock(dir);
  assert.strictEqual(second.locked, true);
  await assert.rejects(second.unlock('some other pin'), /not right/);
  await second.unlock('a good long pin');
  assert.ok(second.key.equals(first.key), 'the same data key comes back');
});

test('the recovery phrase opens it whatever the PIN is', async () => {
  const dir = tmp();
  const first = new VaultLock(dir);
  const phrase = await first.enable('a good long pin');

  const second = new VaultLock(dir);
  await second.unlockWithPhrase(phrase.toUpperCase().replace(/ /g, ', '));
  assert.ok(second.key.equals(first.key));
});

test('changing the PIN keeps the data key, so nothing needs re-encrypting', async () => {
  const dir = tmp();
  const lock = new VaultLock(dir);
  await lock.enable('the first pin');
  const original = Buffer.from(lock.key);
  const secret = encrypt(lock.key, Buffer.from('written before the change'));

  await lock.changePin('the first pin', 'the second pin');
  assert.ok(lock.key.equals(original), 'the key is unchanged');
  assert.strictEqual(decrypt(lock.key, secret).toString(), 'written before the change');

  const reopened = new VaultLock(dir);
  await assert.rejects(reopened.unlock('the first pin'), /not right/);
  await reopened.unlock('the second pin');
});

test('changing the PIN needs the old one', async () => {
  const lock = new VaultLock(tmp());
  await lock.enable('the first pin');
  await assert.rejects(lock.changePin('guessing', 'something else'), /current PIN/);
});

test('a new recovery phrase retires the old one', async () => {
  const dir = tmp();
  const lock = new VaultLock(dir);
  const old = await lock.enable('a good long pin');
  const fresh = await lock.newRecoveryPhrase('a good long pin');
  assert.notStrictEqual(old, fresh);

  const reopened = new VaultLock(dir);
  await assert.rejects(reopened.unlockWithPhrase(old), /does not open/);
  await reopened.unlockWithPhrase(fresh);
});

test('taking the lock off needs the PIN', async () => {
  const lock = new VaultLock(tmp());
  await lock.enable('a good long pin');
  await assert.rejects(lock.disable('not the pin'), /not right/);
  assert.ok(await lock.disable('a good long pin'));
  assert.strictEqual(lock.exists(), false);
});

// -------------------------------------------------- the store, encrypted

test('a keyed store writes ciphertext and reads it back', async () => {
  const dir = tmp();
  const file = path.join(dir, 'notes.json');
  const key = Buffer.alloc(32, 3);

  const store = new Store(file, { notes: [] }).setKey(key);
  await store.update((d) => { d.notes.push('the spare key is under the water butt'); });

  const raw = fs.readFileSync(file);
  assert.ok(looksEncrypted(raw), 'the file is ciphertext');
  assert.ok(!raw.includes(Buffer.from('water butt')), 'and the words are not in it');

  const reopened = new Store(file, { notes: [] }).setKey(key);
  assert.deepStrictEqual(reopened.get().notes, ['the spare key is under the water butt']);
});

test('an encrypted store will not open without the key, and is not destroyed', () => {
  const dir = tmp();
  const file = path.join(dir, 'notes.json');
  const key = Buffer.alloc(32, 3);
  const store = new Store(file, { notes: [] }).setKey(key);
  store.update((d) => { d.notes.push('private'); });

  // Wait for the write, then try to read it with no key at all.
  return new Promise((resolve) => setTimeout(() => {
    const locked = new Store(file, { notes: [] });
    assert.throws(() => locked.get(), /encrypted and the vault is locked/);
    // Crucially it must not have been quarantined as "corrupt".
    assert.ok(fs.existsSync(file), 'the file is still there');
    assert.strictEqual(fs.readdirSync(dir).filter((f) => f.includes('.corrupt-')).length, 0);
    resolve();
  }, 200));
});

test('a store written before the lock existed still opens after it', async () => {
  const dir = tmp();
  const file = path.join(dir, 'notes.json');
  const plain = new Store(file, { notes: [] });
  await plain.update((d) => { d.notes.push('written in the clear'); });

  // Turning the lock on must read the old plaintext, not throw at it.
  const key = Buffer.alloc(32, 5);
  const keyed = new Store(file, { notes: [] }).setKey(key);
  assert.deepStrictEqual(keyed.get().notes, ['written in the clear']);
  await keyed.save();
  assert.ok(looksEncrypted(fs.readFileSync(file)), 'and writes it back encrypted');
});
