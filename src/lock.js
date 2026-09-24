'use strict';
/**
 * Locking the vault: a PIN on launch, and everything personal encrypted on
 * the disk behind it.
 *
 * What is encrypted: what you wrote. Notes, messages, the calendar, what you
 * marked on the map, who is in the house and how far each of them has got.
 * What is not: the library itself. Fifty gigabytes of Wikipedia is public
 * knowledge that anyone can download, encrypting it would double the write
 * cost of every pack, and it tells a searcher nothing about you. The indexes
 * and caches built from it are left alone for the same reason.
 *
 * How the key is held. A random 32-byte data key encrypts the files. That key
 * is then stored twice, wrapped: once under a key derived from the PIN, and
 * once under a key derived from the recovery phrase. So changing the PIN
 * rewraps one small blob instead of re-encrypting everything, and losing the
 * PIN is survivable if the phrase was written down.
 *
 * The honest limitation: a PIN is a short secret, and anybody holding the
 * disk can guess at it offline as fast as their machine allows. scrypt is
 * set deliberately heavy to make each guess cost about a second, and the
 * interface says plainly that six digits is not the same as a passphrase.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { RECOVERY_WORDS } = require('./recovery-words');

const MAGIC = Buffer.from('VLT1');
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHECK_TEXT = 'vault-unlocked';

// scrypt, sized so one guess costs about a second on an ordinary machine.
// maxmem has to be raised to match: the default 32 MB is not enough for N
// this large, and node throws rather than quietly using less.
const KDF = { N: 1 << 17, r: 8, p: 1, keylen: KEY_BYTES, maxmem: 256 * 1024 * 1024 };

const MIN_PIN = 6;

function deriveKey(secret, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret).normalize('NFKC'), salt, KDF.keylen, KDF, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

/** AES-256-GCM. The output is magic | iv | tag | ciphertext. */
function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(key, blob) {
  if (!looksEncrypted(blob)) throw new Error('not an encrypted file');
  const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = blob.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = blob.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

const looksEncrypted = (blob) =>
  Buffer.isBuffer(blob) && blob.length > MAGIC.length + IV_BYTES + TAG_BYTES && blob.subarray(0, 4).equals(MAGIC);

// ------------------------------------------------------------ recovery phrase

/** Twelve words from the list: 96 bits, and writable on paper without error. */
function makeRecoveryPhrase(words = 12) {
  const out = [];
  for (let i = 0; i < words; i++) {
    // randomInt is uniform; the list is exactly 256 long so a byte would do,
    // but this says what it means.
    out.push(RECOVERY_WORDS[crypto.randomInt(RECOVERY_WORDS.length)]);
  }
  return out.join(' ');
}

/**
 * Tidy a phrase somebody has typed back in: case, punctuation and extra
 * spaces are forgiven, an unknown word is not — better to say which word is
 * wrong than to fail with "incorrect phrase".
 */
function normalisePhrase(phrase) {
  const words = String(phrase).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const unknown = words.filter((w) => !RECOVERY_WORDS.includes(w));
  if (unknown.length) {
    const error = new Error(`Not a word from the recovery list: ${unknown.slice(0, 3).join(', ')}`);
    error.unknown = unknown;
    throw error;
  }
  return words.join(' ');
}

// ------------------------------------------------------------------ the lock

class VaultLock {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, 'vault.lock');
    this.key = null;        // the data key, once unlocked
    this.meta = null;
  }

  exists() {
    try { return fs.existsSync(this.filePath); } catch { return false; }
  }

  load() {
    if (this.meta) return this.meta;
    try {
      this.meta = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      this.meta = null;
    }
    return this.meta;
  }

  get locked() {
    return this.exists() && !this.key;
  }

  /** Wrap the data key under a secret, with its own salt. */
  async _wrap(dataKey, secret) {
    const salt = crypto.randomBytes(16);
    const key = await deriveKey(secret, salt);
    return { salt: salt.toString('hex'), blob: encrypt(key, dataKey).toString('base64') };
  }

  async _unwrap(entry, secret) {
    const key = await deriveKey(secret, Buffer.from(entry.salt, 'hex'));
    return decrypt(key, Buffer.from(entry.blob, 'base64'));
  }

  /**
   * Turn the lock on for the first time. Returns the recovery phrase, which
   * is shown once and never stored — only a key derived from it is.
   */
  async enable(pin) {
    if (this.exists()) throw new Error('This vault already has a PIN.');
    checkPin(pin);

    const dataKey = crypto.randomBytes(KEY_BYTES);
    const phrase = makeRecoveryPhrase();

    this.meta = {
      version: 1,
      created: new Date().toISOString(),
      kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p },
      pin: await this._wrap(dataKey, pin),
      recovery: await this._wrap(dataKey, phrase),
      // A known plaintext, so a wrong PIN is reported as a wrong PIN rather
      // than as a corrupt file.
      check: encrypt(dataKey, Buffer.from(CHECK_TEXT)).toString('base64'),
    };
    await this._save();
    this.key = dataKey;
    return phrase;
  }

  async _save() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.meta, null, 2));
    await fsp.rename(tmp, this.filePath);
  }

  /** Open with the PIN. Returns true, or throws with a plain reason. */
  async unlock(pin) {
    const meta = this.load();
    if (!meta) throw new Error('This vault is not locked.');
    let dataKey;
    try {
      dataKey = await this._unwrap(meta.pin, pin);
    } catch {
      throw new Error('That PIN is not right.');
    }
    this._verify(dataKey);
    this.key = dataKey;
    return true;
  }

  /** Open with the recovery phrase instead, when the PIN is forgotten. */
  async unlockWithPhrase(phrase) {
    const meta = this.load();
    if (!meta) throw new Error('This vault is not locked.');
    const tidy = normalisePhrase(phrase); // throws naming the wrong word
    let dataKey;
    try {
      dataKey = await this._unwrap(meta.recovery, tidy);
    } catch {
      throw new Error('That recovery phrase does not open this vault.');
    }
    this._verify(dataKey);
    this.key = dataKey;
    return true;
  }

  _verify(dataKey) {
    const plain = decrypt(dataKey, Buffer.from(this.meta.check, 'base64')).toString();
    if (plain !== CHECK_TEXT) throw new Error('The lock file is damaged.');
  }

  /**
   * Change the PIN. Only the small wrapped key is rewritten, so this takes a
   * moment rather than re-encrypting every file.
   */
  async changePin(currentPin, nextPin) {
    const meta = this.load();
    if (!meta) throw new Error('This vault is not locked.');
    checkPin(nextPin);
    let dataKey;
    try {
      dataKey = await this._unwrap(meta.pin, currentPin);
    } catch {
      throw new Error('The current PIN is not right.');
    }
    this._verify(dataKey);
    meta.pin = await this._wrap(dataKey, nextPin);
    meta.changed = new Date().toISOString();
    await this._save();
    this.key = dataKey;
    return true;
  }

  /** A new recovery phrase, replacing the old one. Needs the PIN. */
  async newRecoveryPhrase(pin) {
    const meta = this.load();
    if (!meta) throw new Error('This vault is not locked.');
    let dataKey;
    try {
      dataKey = await this._unwrap(meta.pin, pin);
    } catch {
      throw new Error('That PIN is not right.');
    }
    const phrase = makeRecoveryPhrase();
    meta.recovery = await this._wrap(dataKey, phrase);
    await this._save();
    return phrase;
  }

  /** Take the lock off entirely. Needs the PIN; the caller decrypts the files. */
  async disable(pin) {
    const meta = this.load();
    if (!meta) return false;
    try {
      await this._unwrap(meta.pin, pin);
    } catch {
      throw new Error('That PIN is not right.');
    }
    await fsp.rm(this.filePath, { force: true });
    this.meta = null;
    this.key = null;
    return true;
  }
}

/**
 * What a PIN has to be. Six is the floor rather than four because a four-digit
 * PIN is ten thousand guesses, and a machine that has your disk can try them
 * all in a few hours whatever the key derivation costs.
 */
function checkPin(pin) {
  const value = String(pin || '');
  if (value.length < MIN_PIN) {
    throw new Error(`A PIN needs at least ${MIN_PIN} characters. Letters and words are allowed and are much stronger than digits.`);
  }
  if (value.length > 128) throw new Error('That is longer than a PIN needs to be.');
  return true;
}

/** How hard this PIN would be to guess, in plain words. */
function pinStrength(pin) {
  const value = String(pin || '');
  const classes = [/[0-9]/, /[a-z]/, /[A-Z]/, /[^0-9a-zA-Z]/].filter((r) => r.test(value)).length;
  if (value.length < MIN_PIN) return { level: 'too short', note: `At least ${MIN_PIN} characters.` };
  if (/^\d+$/.test(value)) {
    if (value.length <= 6) return { level: 'weak', note: 'Six digits is a million guesses — days of work for somebody with your disk. A word or two would be far stronger.' };
    if (value.length <= 8) return { level: 'fair', note: 'Digits only. A word or two would be far stronger.' };
    return { level: 'good', note: 'Long, but still only digits.' };
  }
  if (value.length >= 12 || (value.length >= 8 && classes >= 3)) return { level: 'strong', note: 'This would take a very long time to guess.' };
  return { level: 'fair', note: 'Longer is better than more complicated. Three unrelated words beat everything else.' };
}

module.exports = {
  VaultLock, deriveKey, encrypt, decrypt, looksEncrypted,
  makeRecoveryPhrase, normalisePhrase, checkPin, pinStrength,
  RECOVERY_WORDS, MIN_PIN, MAGIC,
};
